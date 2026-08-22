/**
 * Anclaje 2 — **commit firmado, empujado a dos forjas**. Clase de independencia: `vcs`.
 *
 * ═══ EL PUNTO CRÍTICO, Y ES DE DISEÑO, NO DE IMPLEMENTACIÓN ═══
 *
 * Si la clave privada vive en el VPS, este anclaje es **teatro**. El mismo administrador que
 * reescribe la historia firma la raíz nueva, la empuja a las dos forjas, y el resultado es un
 * anclaje impecable de una mentira. No hay criptografía que arregle eso: el atacante tiene la clave.
 *
 * Por eso aquí `submit()` **no firma**. No puede: no tiene con qué. Lo que hace es producir la
 * *solicitud de firma* —el fichero de checkpoint y la línea de compromiso— para que alguien de la
 * veeduría la firme **en su equipo** y la empuje. El recibo nace `pendiente` y sólo pasa a
 * `confirmado` cuando aparece el commit firmado. El flujo, no una advertencia en un manual, es lo
 * que mantiene la clave fuera del servidor.
 *
 * Y para el caso en que alguien lo despliegue mal, hay una segunda red: `signingKeyOffHost` es un
 * campo obligatorio de la configuración, y la política de quórum **descuenta** a los proveedores
 * cuya clave vive en la máquina verificada. Un despliegue con la clave dentro no produce un anclaje
 * débil: produce un anclaje que no cuenta, y lo dice.
 *
 * ═══ Qué se verifica sin red ═══
 *
 *  1. El identificador del commit es realmente `SHA1(...)` de sus bytes. (No nos dieron otro commit.)
 *  2. La firma `SSHSIG` sobre el objeto sin la cabecera `gpgsig` es válida (Ed25519, WebCrypto).
 *  3. El `namespace` es `git`. (No es una firma de otro contexto reutilizada.)
 *  4. La clave que firma está en el **padrón de la veeduría**, fijado fuera del export.
 *  5. El mensaje del commit contiene la línea de compromiso con ESTE `checkpointHash`.
 *
 * Lo único que necesita red: que el commit esté **presente** en las dos forjas. Eso es
 * disponibilidad, no criptografía, y queda como afirmación pendiente con su instrucción.
 */

import { fromBase64Url, toBase64Url, toHex } from '@koinonia/crypto';

import { toBase64 } from '../base64.js';
import {
  commitOid,
  type GitCommit,
  parseCommit,
  parseSshSignature,
  verifySshEd25519,
} from '../git/objects.js';
import {
  type AnchorProvider,
  type AnchorReceipt,
  check,
  type CheckOutcome,
  invalidOutcome,
  type ProviderMetadata,
  type ResidualClaim,
  type VerificationOutcome,
} from '../types.js';

export const SIGNED_GIT_ID = 'git';
export const GIT_SIGNATURE_NAMESPACE = 'git';

/** La línea que el commit debe contener. Legible por un humano, como pide §8.2. */
export function checkpointBindingLine(checkpointHash: Uint8Array | string): string {
  const hex = typeof checkpointHash === 'string' ? checkpointHash : toHex(checkpointHash);
  return `koinonia-checkpoint: ${hex}`;
}

/** Una clave admitida de la veeduría. Es el padrón que se fija FUERA del export. */
export interface AllowedSigner {
  /** Quién es, en prosa: 'Veeduría 2026-2 — María Restrepo <maria@ejemplo.org>'. */
  readonly identity: string;
  /** Blob de clave pública SSH en base64, tal como aparece en `~/.ssh/allowed_signers`. */
  readonly publicKey: string;
}

/** Puerto de la forja. Sólo hace falta para `poll()`, que por definición sale a la red. */
export interface GitForgeClient {
  readonly name: string;
  /** Bytes del objeto commit, o `undefined` si la forja no lo tiene. */
  fetchCommit(oid: string): Promise<Uint8Array | undefined>;
  /** El commit que hay hoy en la rama de anclaje. */
  head(): Promise<string | undefined>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// EL CORAZÓN DE LA CLASE `vcs`: comprobar que las dos forjas dicen LO MISMO
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Lo que una forja entregó. **No trae OID**: el identificador se recalcula aquí sobre los bytes.
 *
 * Aceptar el OID que declara la forja sería preguntarle al sospechoso si dice la verdad. Un `oid` en
 * esta estructura permitiría que dos forjas «coincidieran» declarando el mismo identificador para
 * objetos distintos, que es exactamente lo que esta comprobación existe para detectar.
 */
export interface ForgeSighting {
  readonly forge: string;
  readonly bytes: Uint8Array;
}

/** Un objeto distinto, y qué forjas lo sirvieron. */
export interface ForgeVariant {
  readonly oid: string;
  readonly forges: readonly string[];
}

export type ForgeDivergenceReason = 'objetos-distintos' | 'colision-de-identificador';

export type ForgeCrossCheck =
  | {
      readonly kind: 'acuerdo';
      readonly oid: string;
      readonly bytes: Uint8Array;
      readonly forges: readonly string[];
    }
  | {
      readonly kind: 'discrepancia';
      readonly reason: ForgeDivergenceReason;
      readonly variants: readonly ForgeVariant[];
      readonly detail: string;
    }
  | { readonly kind: 'sin_respuesta' };

/**
 * Compara lo que devolvió cada forja. **Es la razón de ser de la clase `vcs`.**
 *
 * Empujar a dos forjas no protege de nada si después se le pregunta a una sola, o si se pregunta a
 * las dos y no se comparan las respuestas: un `push --force` en una de ellas pasaría inadvertido y el
 * anclaje daría verde. Un anclaje que aprueba porque no miró es peor que no tener anclaje, porque
 * produce un verde que nadie se ganó.
 *
 * Se detectan dos cosas distintas, y la segunda es peor que la primera:
 *
 *  - **`objetos-distintos`** — las forjas sirven commits con identificadores distintos para el mismo
 *    checkpoint. Es la firma de un `push --force` en una sola forja, o de dos firmas del mismo
 *    compromiso. Sea cual sea la causa, la historia publicada ya no es una.
 *  - **`colision-de-identificador`** — dos objetos con **bytes distintos** y el **mismo** OID. Git
 *    identifica objetos con SHA-1, y SHA-1 tiene colisiones de prefijo elegido desde 2019. Que esto
 *    aparezca en la vida real significa que alguien pagó por fabricarlas, y no lo hizo por deporte.
 */
export async function crossCheckForges(
  sightings: readonly ForgeSighting[],
  /**
   * Cómo se calcula el identificador. **En producción no se toca**: el valor por defecto es
   * `commitOid`, que es SHA-1 del objeto, que es lo que hace git.
   *
   * Es un parámetro por una razón concreta: la rama `colision-de-identificador` de abajo es
   * imposible de probar de otro modo. Fabricar dos objetos git con el mismo SHA-1 costó 6 500 años
   * de CPU en 2017 y sigue costando decenas de miles de dólares; meter en el repositorio los 800 kB
   * de una colisión conocida para ejercitar seis líneas sería peor remedio. Con esto, la prueba
   * inyecta un resumen que colisiona a propósito y comprueba que el código **detecta bytes distintos
   * bajo el mismo identificador**, que es lo único que hay que comprobar.
   */
  oidOf: (bytes: Uint8Array) => Promise<string> = commitOid,
): Promise<ForgeCrossCheck> {
  if (sightings.length === 0) return { kind: 'sin_respuesta' };

  const porOid = new Map<string, { readonly bytes: Uint8Array; readonly forges: string[] }>();
  let colision: ForgeVariant | undefined;

  for (const sighting of sightings) {
    const oid = await oidOf(sighting.bytes);
    const grupo = porOid.get(oid);
    if (grupo === undefined) {
      porOid.set(oid, { bytes: sighting.bytes, forges: [sighting.forge] });
      continue;
    }
    if (!bytesEqual(grupo.bytes, sighting.bytes)) {
      colision = { oid, forges: [...grupo.forges, sighting.forge] };
    }
    grupo.forges.push(sighting.forge);
  }

  if (colision !== undefined) {
    return {
      kind: 'discrepancia',
      reason: 'colision-de-identificador',
      variants: [colision],
      detail:
        `las forjas ${colision.forges.join(' y ')} sirvieron objetos con bytes DISTINTOS y el ` +
        `mismo identificador ${colision.oid}. Git identifica objetos con SHA-1: esto es una ` +
        'colisión, no un error de red, y fabricar una cuesta dinero. Trátese como un ataque en curso',
    };
  }

  const variants: ForgeVariant[] = [...porOid].map(([oid, grupo]) => ({
    oid,
    forges: grupo.forges,
  }));
  const primero = variants[0];
  if (primero === undefined) return { kind: 'sin_respuesta' };

  if (variants.length > 1) {
    return {
      kind: 'discrepancia',
      reason: 'objetos-distintos',
      variants,
      detail:
        'las forjas NO coinciden en qué commit ancla este checkpoint: ' +
        variants
          .map((variant) => `${variant.forges.join(' y ')} → ${variant.oid.slice(0, 12)}…`)
          .join(' · ') +
        '. Así es como se ve un `push --force` en una sola forja, y es justo lo que esta clase de ' +
        'independencia existe para detectar',
    };
  }

  const grupo = porOid.get(primero.oid);
  if (grupo === undefined) return { kind: 'sin_respuesta' };
  return { kind: 'acuerdo', oid: primero.oid, bytes: grupo.bytes, forges: grupo.forges };
}

/**
 * Las forjas discrepan.
 *
 * Se lanza en vez de devolverse porque el ciclo de anclaje convierte toda excepción de `poll()` en un
 * evento `AnclajeFallido` **dentro del ledger**, con este mensaje como motivo. Devolver un recibo
 * «casi bueno» dejaría la discrepancia en un campo que nadie mira; lanzarla la escribe en la
 * estructura que el propio anclaje protege, y taparla exige entonces alterar el ledger.
 */
export class ForgeDivergenceError extends Error {
  readonly checkpointHash: string;
  readonly reason: ForgeDivergenceReason;
  readonly variants: readonly ForgeVariant[];

  constructor(
    checkpointHash: string,
    crossCheck: Extract<ForgeCrossCheck, { readonly kind: 'discrepancia' }>,
  ) {
    super(
      `las forjas discrepan sobre el anclaje de ${checkpointHash.slice(0, 16)}…: ${crossCheck.detail}`,
    );
    this.name = 'ForgeDivergenceError';
    this.checkpointHash = checkpointHash;
    this.reason = crossCheck.reason;
    this.variants = crossCheck.variants;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface SignedGitOptions {
  /** Padrón de firmantes. **Se fija fuera del export**: si lo pusiera el export, no probaría nada. */
  readonly allowedSigners: readonly AllowedSigner[];
  /**
   * **Obligatorio y sin valor por defecto.** Declarar que la clave vive fuera del servidor es una
   * afirmación del despliegue, y quien la haga tiene que escribirla. Un valor por defecto `true`
   * sería exactamente la mentira cómoda que este anclaje existe para no permitir.
   */
  readonly signingKeyOffHost: boolean;
  /** Forjas donde debe estar el commit. Con una sola, el anclaje tiene un punto único de fallo. */
  readonly forges: readonly string[];
  /** Cuántas forjas hacen falta. Por defecto, todas las declaradas. */
  readonly minForges?: number;
  readonly clock: () => string;
  readonly forgeClients?: readonly GitForgeClient[];
  readonly id?: string;
}

export class SignedGitProvider implements AnchorProvider {
  readonly meta: ProviderMetadata;
  readonly #signers: readonly AllowedSigner[];
  readonly #forges: readonly string[];
  readonly #minForges: number;
  readonly #clock: () => string;
  readonly #forgeClients: readonly GitForgeClient[];

  constructor(options: SignedGitOptions) {
    this.#signers = options.allowedSigners;
    this.#forges = options.forges;
    this.#minForges = options.minForges ?? options.forges.length;
    this.#clock = options.clock;
    this.#forgeClients = options.forgeClients ?? [];
    this.meta = {
      id: options.id ?? SIGNED_GIT_ID,
      independenceClass: 'vcs',
      trustAssumption: options.signingKeyOffHost
        ? 'para falsificarlo hay que robar la clave privada de la veeduría, que no está en este ' +
          'servidor, y además conseguir que las dos forjas acepten un push que contradice lo que ' +
          'ya clonó cualquiera'
        : '⚠ NINGUNA: la clave privada vive en la máquina que se está auditando. Quien pueda ' +
          'reescribir la historia puede firmar la versión falsa. Este anclaje NO cuenta para el ' +
          'quórum, y por eso este texto existe',
      verificationNeedsNetwork: true,
      signingKeyOffHost: options.signingKeyOffHost,
      maturationHint:
        'depende de una persona: el commit se firma en el equipo de la veeduría y se empuja a mano ' +
        'o con una tarea programada de su lado',
    };
  }

  /**
   * NO firma. Produce la solicitud que la veeduría firmará en su equipo.
   *
   * El recibo resultante es válido y **pendiente**: afirma «se pidió anclar este checkpoint», que
   * es exactamente lo que ocurrió. Fingir un `confirmado` aquí sería el error que hace inútil todo
   * el mecanismo.
   */
  submit(checkpointHash: Uint8Array): Promise<AnchorReceipt> {
    const hex = toHex(checkpointHash);
    const receipt: AnchorReceipt = {
      provider: this.meta.id,
      independenceClass: 'vcs',
      checkpointHash: hex,
      externalRef: `solicitud:${hex.slice(0, 32)}`,
      submittedAt: this.#clock(),
      raw: {
        requestKind: 'firma_pendiente_de_veeduria',
        bindingLine: checkpointBindingLine(hex),
        fileName: `checkpoints/${hex}.txt`,
        forges: [...this.#forges],
        instructions:
          'En el equipo de la veeduría: añadí la línea de compromiso a CHECKPOINTS.txt, ' +
          'firmá el commit con la clave SSH del padrón y empujalo a las forjas declaradas. ' +
          'La clave privada NO debe copiarse a este servidor bajo ningún concepto.',
      },
    };
    return Promise.resolve(receipt);
  }

  /**
   * Busca el commit firmado en las forjas y **compara lo que devuelve cada una**.
   *
   * Tres decisiones, y las tres corrigen un fallo de la versión anterior de este método:
   *
   *  1. Se pregunta a **todas** las forjas y se cruzan las respuestas (`crossCheckForges`). Antes se
   *     tomaban los bytes de la primera que respondiera y se apuntaba el nombre de todas las demás,
   *     de modo que `forgesSeen: ['codeberg','github']` podía significar «las dos sirvieron commits
   *     distintos y nadie miró».
   *  2. Sólo cuenta el commit que **menciona este checkpoint**. Buscando por `head()`, una forja que
   *     va con retraso sirve el ancla del checkpoint anterior; sin este filtro, el retraso normal se
   *     convertiría en una alarma de discrepancia, y una alarma que salta sola deja de leerse.
   *  3. Si las forjas discrepan, **se lanza**. Lo que produce un `AnclajeFallido` en el ledger y
   *     deja el recibo sin confirmar. Es la falla ruidosa que esta clase de independencia compra.
   */
  async poll(receipt: AnchorReceipt): Promise<AnchorReceipt> {
    const conocido = receipt.externalRef.startsWith('solicitud:') ? undefined : receipt.externalRef;
    const binding = checkpointBindingLine(receipt.checkpointHash);

    const sightings: ForgeSighting[] = [];
    const sinAncla: string[] = [];
    const errores: string[] = [];

    for (const forge of this.#forgeClients) {
      try {
        const target = conocido ?? (await forge.head());
        if (target === undefined) {
          sinAncla.push(forge.name);
          continue;
        }
        const fetched = await forge.fetchCommit(target);
        if (fetched === undefined) {
          sinAncla.push(forge.name);
          continue;
        }
        if (!anclaEste(fetched, binding)) {
          sinAncla.push(forge.name);
          continue;
        }
        sightings.push({ forge: forge.name, bytes: fetched });
      } catch (error) {
        // Una forja caída no invalida el anclaje, pero tampoco se calla: si al final no hay
        // acuerdo, este texto es lo que explica por qué.
        errores.push(`${forge.name}: ${error instanceof Error ? error.message : 'ilegible'}`);
      }
    }

    const cruce = await crossCheckForges(sightings);
    if (cruce.kind === 'discrepancia') {
      throw new ForgeDivergenceError(receipt.checkpointHash, cruce);
    }
    if (cruce.kind === 'sin_respuesta') {
      if (errores.length > 0 && errores.length === this.#forgeClients.length) {
        throw new Error(`ninguna forja respondió: ${errores.join(' · ')}`);
      }
      return receipt;
    }

    return {
      provider: this.meta.id,
      independenceClass: 'vcs',
      checkpointHash: receipt.checkpointHash,
      externalRef: cruce.oid,
      submittedAt: receipt.submittedAt,
      confirmedAt: this.#clock(),
      proof: toBase64Url(cruce.bytes),
      raw: {
        requestKind: 'commit_firmado',
        forgesSeen: [...cruce.forges],
        forgesExpected: [...this.#forges],
        ...(sinAncla.length === 0 ? {} : { forgesSinAncla: sinAncla }),
        ...(errores.length === 0 ? {} : { forgesConError: errores }),
      },
    };
  }

  async verify(receipt: AnchorReceipt, checkpointHash: Uint8Array): Promise<VerificationOutcome> {
    const checks: CheckOutcome[] = [];
    const residualClaims: ResidualClaim[] = [];

    if (receipt.independenceClass !== this.meta.independenceClass) {
      return invalidOutcome(
        this.meta,
        `el recibo se declara de clase '${receipt.independenceClass}' y este proveedor es 'vcs'`,
      );
    }

    const expectedHex = toHex(checkpointHash);
    if (receipt.checkpointHash !== expectedHex) {
      return invalidOutcome(
        this.meta,
        `el recibo ancla ${receipt.checkpointHash.slice(0, 16)}… y el checkpoint es ` +
          `${expectedHex.slice(0, 16)}…: no son el mismo resumen`,
      );
    }
    checks.push(check('compromiso', true, 'el recibo se refiere a este checkpoint y no a otro'));

    const proof = receipt.proof;
    if (proof === undefined) {
      return {
        status: 'pendiente',
        provider: this.meta.id,
        independenceClass: 'vcs',
        offline: true,
        checks,
        residualClaims: [
          {
            claim: 'la veeduría todavía no firmó ni empujó el commit de este checkpoint',
            verifyBy:
              'mirá la rama de anclaje en las forjas públicas; si pasan horas sin commit, avisá a ' +
              'la veeduría: puede que la persona con la clave ya no esté disponible',
          },
        ],
        detail:
          'se pidió el anclaje y aún no hay commit firmado. La firma ocurre en el equipo de la ' +
          'veeduría, no en este servidor: por eso puede tardar',
      };
    }

    let commit: GitCommit;
    try {
      commit = parseCommit(fromBase64Url(proof));
    } catch (error) {
      return invalidOutcome(
        this.meta,
        `el objeto commit no se puede leer (${error instanceof Error ? error.message : 'ilegible'})`,
        checks,
      );
    }

    const oid = await commitOid(commit.bytes);
    if (oid !== receipt.externalRef) {
      return invalidOutcome(
        this.meta,
        `el recibo dice que el commit es ${receipt.externalRef.slice(0, 12)}… y los bytes que trae ` +
          `producen ${oid.slice(0, 12)}…: nos están enseñando un commit distinto del que dicen`,
        [...checks, check('identificador', false, 'el OID recalculado no coincide')],
      );
    }
    checks.push(check('identificador', true, `el commit es realmente ${oid}`));

    const armored = commit.signature;
    if (armored === undefined) {
      return invalidOutcome(
        this.meta,
        'el commit no está firmado. Un commit sin firma sólo prueba que alguien con acceso de ' +
          'escritura al repositorio lo escribió, y ese alguien puede ser el propio administrador',
        [...checks, check('firma', false, 'sin cabecera gpgsig')],
      );
    }

    let signatureOk: boolean;
    let signerKey: string;
    let namespace: string;
    try {
      const signature = parseSshSignature(armored);
      namespace = signature.namespace;
      signerKey = base64OfKeyBlob(signature.publicKeyBlob);
      signatureOk = await verifySshEd25519(signature, commit.signedPayload);
    } catch (error) {
      return invalidOutcome(
        this.meta,
        `la firma del commit no se puede leer (${error instanceof Error ? error.message : 'ilegible'})`,
        [...checks, check('firma', false, 'firma ilegible')],
      );
    }

    if (!signatureOk) {
      return invalidOutcome(
        this.meta,
        'la firma del commit NO es válida: el contenido del commit cambió después de firmarse, o ' +
          'la firma se copió de otro commit',
        [...checks, check('firma', false, 'Ed25519 rechaza la firma')],
      );
    }
    checks.push(check('firma', true, 'la firma Ed25519 del commit es válida'));

    if (namespace !== GIT_SIGNATURE_NAMESPACE) {
      return invalidOutcome(
        this.meta,
        `la firma es del contexto '${namespace}' y no de 'git': es una firma de otra cosa, ` +
          'reutilizada aquí',
        [...checks, check('contexto', false, `namespace='${namespace}'`)],
      );
    }
    checks.push(check('contexto', true, "la firma se hizo para git (namespace 'git')"));

    const signer = this.#signers.find((candidate) => candidate.publicKey === signerKey);
    if (signer === undefined) {
      return invalidOutcome(
        this.meta,
        'el commit está firmado por una clave que NO está en el padrón de la veeduría. Una firma ' +
          'válida de un desconocido no prueba nada: cualquiera puede generar una clave',
        [...checks, check('firmante', false, `clave desconocida ${signerKey.slice(0, 24)}…`)],
      );
    }
    checks.push(check('firmante', true, `firmado por ${signer.identity}`));

    const binding = checkpointBindingLine(expectedHex);
    if (!commit.message.includes(binding)) {
      return invalidOutcome(
        this.meta,
        'el commit está bien firmado pero NO menciona este checkpoint. Una firma sobre otro texto ' +
          'no ancla nada: hace falta que lo firmado diga exactamente qué se está anclando',
        [...checks, check('compromiso_firmado', false, `falta la línea "${binding}"`)],
      );
    }
    checks.push(
      check('compromiso_firmado', true, 'lo firmado incluye la línea de compromiso del checkpoint'),
    );

    if (!this.meta.signingKeyOffHost) {
      checks.push(
        check(
          'clave_fuera_del_servidor',
          false,
          '⚠ la clave privada vive en el servidor auditado: la firma es válida y no prueba nada',
        ),
      );
    } else {
      checks.push(
        check('clave_fuera_del_servidor', true, 'la clave privada no vive en el servidor auditado'),
      );
    }

    // `forgesSeen` viene del recibo, que viaja en un export público servido por el mismo servidor
    // que se audita: es un dato hostil. Se recorta al padrón de forjas declarado FUERA del export,
    // porque si no, inflar la cuenta sería tan barato como escribir dos nombres inventados.
    const declaradas = new Set(this.#forges);
    const forgesSeen = readStringArray(receipt.raw['forgesSeen']);
    const reconocidas = [...new Set(forgesSeen.filter((forge) => declaradas.has(forge)))];
    const impostoras = forgesSeen.filter((forge) => !declaradas.has(forge));

    if (impostoras.length > 0) {
      checks.push(
        check(
          'forjas_declaradas',
          false,
          `el recibo dice haber visto el commit en ${impostoras.join(', ')}, que no está(n) en el ` +
            'padrón de forjas: no cuenta(n)',
        ),
      );
    }

    if (reconocidas.length < this.#minForges) {
      residualClaims.push({
        claim:
          `el recibo dice haber visto el commit en ${String(reconocidas.length)} forja(s) del ` +
          `padrón y hacen falta ${String(this.#minForges)}`,
        verifyBy: `buscá el commit ${oid} en: ${this.#forges.join(', ')}`,
      });
    }
    residualClaims.push({
      claim: `el commit ${oid} está publicado y es alcanzable en ${this.#forges.join(' y ')}`,
      verifyBy:
        'clonalos y comprobá que los dos tienen ese commit con esa firma. Si una forja lo tiene y ' +
        'la otra no, alguien reescribió una de las dos',
    });

    return {
      status: 'confirmado',
      provider: this.meta.id,
      independenceClass: 'vcs',
      offline: true,
      checks,
      residualClaims,
      detail: `el resumen de esta historia lo firmó ${signer.identity} y quedó en un repositorio público`,
      ...(receipt.confirmedAt === undefined ? {} : { attestedAt: receipt.confirmedAt }),
    };
  }
}

/**
 * La clave se compara en su forma **textual** —la misma que aparece en `~/.ssh/allowed_signers`—
 * porque es la que una persona de la veeduría puede cotejar a ojo contra lo que tiene en su equipo.
 * Comparar bytes internos sería equivalente y no auditable a mano.
 */
function base64OfKeyBlob(blob: Uint8Array): string {
  return toBase64(blob);
}

/**
 * ¿Estos bytes son el ancla de ESTE checkpoint?
 *
 * Un objeto ilegible se descarta en silencio a propósito: la forja pudo servir basura, y eso es un
 * problema de esa forja, no una discrepancia entre forjas. Lo que no se descarta nunca es una
 * discrepancia entre dos objetos legibles: eso se lanza.
 */
function anclaEste(bytes: Uint8Array, binding: string): boolean {
  try {
    return parseCommit(bytes).message.includes(binding);
  } catch {
    return false;
  }
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
