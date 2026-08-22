/**
 * Anclaje 3 — **testigos por correo**. Clase de independencia: `human-witness`.
 *
 * El correo a cinco destinatarios de dominios distintos es el anclaje más débil de los tres y el
 * más fácil de explicar en una asamblea: cinco personas ajenas recibieron el resumen en una fecha.
 * Para desmentirlo hay que conseguir que todas pierdan o entreguen su buzón.
 *
 * ═══ El error que hay que evitar aquí ═══
 *
 * Firmar el correo con **nuestra** clave y llamarlo prueba. No lo es: la clave está en el mismo
 * servidor, y el administrador que reescribe la historia manda un correo nuevo con la raíz nueva. La
 * evidencia con valor es la que produce **el otro lado**: el acuse del testigo, firmado por el
 * testigo.
 *
 * Por eso lo que cuenta aquí son los **acuses firmados**, cada uno con la clave de su testigo, y el
 * umbral se mide en **dominios distintos**: cinco acuses del mismo dominio son un solo proveedor de
 * correo, y un solo proveedor es un solo punto de falla.
 *
 * ═══ Cómo firma un testigo, en la práctica ═══
 *
 * Con `ssh-keygen`, que ya tiene:
 *
 *     ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n koinonia-anclaje acuse.json
 *
 * `acuse.json` es la preimagen canónica del acuse. No hace falta instalar nada nuestro, y el
 * verificador comprueba esa firma sin red. Un acuse **sin firma** se registra igual, pero no cuenta
 * para el umbral: sólo prueba algo si el testigo conserva su propia copia y la exhibe.
 */

import { canonicalizeToBytes, type JsonObject, type JsonValue, toHex } from '@koinonia/crypto';

import { toBase64 } from '../base64.js';
import { parseSshSignature, verifySshEd25519 } from '../git/objects.js';
import {
  ANCHOR_DOMAIN,
  type AnchorProvider,
  type AnchorReceipt,
  check,
  type CheckOutcome,
  invalidOutcome,
  type ProviderMetadata,
  type ResidualClaim,
  type VerificationOutcome,
} from '../types.js';

export const WITNESS_EMAIL_ID = 'correo';
export const WITNESS_SIGNATURE_NAMESPACE = 'koinonia-anclaje';

/** Un testigo del padrón. Igual que en git: **se fija fuera del export**. */
export interface Witness {
  /** Identificador estable del testigo: 'representacion_estudiantil', 'externa_uniandes'… */
  readonly id: string;
  /** Correo desde el que acusa recibo. Su dominio es lo que cuenta para el umbral. */
  readonly address: string;
  /** Blob de clave pública SSH en base64. Vacío ⇒ el testigo no firma y sus acuses no cuentan. */
  readonly publicKey: string;
}

export interface WitnessAck {
  readonly witness: string;
  readonly address: string;
  readonly seenAt: string;
  /** Armadura `-----BEGIN SSH SIGNATURE-----`. Ausente ⇒ acuse informativo. */
  readonly signature?: string;
}

/**
 * Un destinatario al que el correo **no llegó**.
 *
 * ═══ Por qué un rebote es una falla de anclaje y no una anécdota de operación ═══
 *
 * El umbral se mide en dominios distintos porque la garantía es «hacen falta N personas ajenas para
 * desmentir esto». Una dirección que ya no existe —alguien que se fue del instituto, un dominio que
 * caducó— no es un testigo que todavía no contestó: es un testigo que **ya no está**, y el anclaje
 * pasó de cinco destinatarios a cuatro sin que nadie lo decidiera. Si eso no se registra, el padrón
 * se erosiona en silencio hasta el día en que no queda margen y nadie sabe desde cuándo.
 */
export interface WitnessBounce {
  /** `id` del testigo, si la dirección que rebotó está en el padrón. */
  readonly witness: string | undefined;
  readonly address: string;
  /**
   * `permanente` (5.x.x — la dirección no existe: hay que sustituir al testigo) o `transitorio`
   * (4.x.x — buzón lleno o servidor caído: se reintenta).
   */
  readonly kind: 'permanente' | 'transitorio';
  /** Código ampliado RFC 3463 tal como lo dio el informe: `5.1.1`. Ausente si no lo trajo. */
  readonly status?: string;
  readonly detail: string;
}

/** Qué pasó con el envío, destinatario a destinatario. */
export interface EmailDeliveryReport {
  /** Direcciones que el servidor aceptó. Aceptar no es entregar: el rebote puede llegar después. */
  readonly accepted: readonly string[];
  /** Rechazos **en el acto** (`RCPT TO` con 5xx). Los diferidos llegan por `AckCollector`. */
  readonly bounced: readonly WitnessBounce[];
}

/** Puerto de envío. Lo único de este anclaje que sale a la red. */
export interface EmailTransport {
  send(message: {
    readonly messageId: string;
    readonly subject: string;
    readonly body: string;
    readonly recipients: readonly string[];
  }): Promise<EmailDeliveryReport>;
}

/**
 * Puerto de recogida.
 *
 * Recoge las **dos** cosas que vuelven al buzón: los acuses de los testigos y los informes de no
 * entrega. Separarlos en dos puertos obligaría a abrir el buzón dos veces y, sobre todo, dejaría el
 * rebote como una función opcional que un despliegue puede no enganchar; aquí no se puede recoger
 * acuses sin enterarse de los rebotes.
 */
export interface AckCollection {
  readonly acks: readonly WitnessAck[];
  readonly bounces: readonly WitnessBounce[];
}

export interface AckCollector {
  collect(messageId: string): Promise<AckCollection>;
}

export interface WitnessEmailOptions {
  readonly witnesses: readonly Witness[];
  /** Dominios de la propia organización: un testigo de casa no es independiente. */
  readonly selfDomains?: readonly string[];
  /** Cuántos **dominios distintos** hacen falta. Por defecto 3, sobre cinco destinatarios (§8.2). */
  readonly minDistinctDomains?: number;
  readonly clock: () => string;
  readonly transport?: EmailTransport;
  readonly collector?: AckCollector;
  readonly id?: string;
}

/** Preimagen canónica del acuse. Es lo que el testigo firma, y lo único que se firma. */
export function ackPreimage(input: {
  readonly address: string;
  readonly checkpointHash: string;
  readonly messageId: string;
  readonly seenAt: string;
  readonly witness: string;
}): JsonObject {
  return {
    address: input.address,
    checkpointHash: input.checkpointHash,
    messageId: input.messageId,
    seenAt: input.seenAt,
    witness: input.witness,
  };
}

/** Los bytes exactos que firma el testigo: octeto de dominio + JCS de la preimagen. */
export function ackSignedBytes(preimage: JsonObject): Uint8Array {
  const body = canonicalizeToBytes(preimage);
  const out = new Uint8Array(body.length + 1);
  out[0] = ANCHOR_DOMAIN.emailAck;
  out.set(body, 1);
  return out;
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

export class WitnessEmailProvider implements AnchorProvider {
  readonly meta: ProviderMetadata;
  readonly #witnesses: readonly Witness[];
  readonly #selfDomains: ReadonlySet<string>;
  readonly #minDistinctDomains: number;
  readonly #clock: () => string;
  readonly #transport: EmailTransport | undefined;
  readonly #collector: AckCollector | undefined;

  constructor(options: WitnessEmailOptions) {
    this.#witnesses = options.witnesses;
    this.#selfDomains = new Set((options.selfDomains ?? []).map((d) => d.toLowerCase()));
    this.#minDistinctDomains = options.minDistinctDomains ?? 3;
    this.#clock = options.clock;
    this.#transport = options.transport;
    this.#collector = options.collector;
    this.meta = {
      id: options.id ?? WITNESS_EMAIL_ID,
      independenceClass: 'human-witness',
      trustAssumption:
        `hace falta que ${String(this.#minDistinctDomains)} personas de dominios distintos ` +
        'pierdan, borren o entreguen su copia a la vez. Ninguna de ellas depende de este servidor',
      // Las firmas de los acuses se comprueban con los bytes del recibo. La única afirmación que
      // queda fuera es que el correo se entregó de verdad, y eso lo dicen los propios acuses.
      verificationNeedsNetwork: false,
      // Lo que cuenta lo firman los testigos con SUS claves. Aquí no hay clave nuestra que valga.
      signingKeyOffHost: true,
      maturationHint: 'minutos u horas: depende de que las personas lean el correo y respondan',
    };
  }

  async submit(checkpointHash: Uint8Array): Promise<AnchorReceipt> {
    const hex = toHex(checkpointHash);
    const messageId = `<koinonia-${hex.slice(0, 32)}@anclaje.koinonia>`;
    const subject = `Koinonía — resumen de integridad ${hex.slice(0, 16)}`;
    const body = [
      'Este correo es un anclaje: guardalo.',
      '',
      `koinonia-checkpoint: ${hex}`,
      '',
      'Si alguna vez alguien discute qué decidió la asamblea, este resumen prueba qué historia',
      'existía el día en que lo recibiste. No hace falta que entiendas cómo funciona: basta con',
      'que NO lo borres.',
    ].join('\n');
    const recipients = this.#witnesses.map((witness) => witness.address);

    // El transporte real —SMTP con DKIM sobre el dominio del instituto— vive en
    // `services/api/src/anchor/`: este paquete no hace I/O. Lo que sí se hace aquí es lo que sostiene
    // la garantía: registrar quién rechazó el correo en el acto, para que el desgaste del padrón sea
    // un dato del recibo y no un silencio.
    const report = await this.#transport?.send({ messageId, subject, body, recipients });
    const bounced = report?.bounced ?? [];

    return {
      provider: this.meta.id,
      independenceClass: 'human-witness',
      checkpointHash: hex,
      externalRef: messageId,
      submittedAt: this.#clock(),
      raw: {
        subject,
        recipients,
        acks: [],
        minDistinctDomains: this.#minDistinctDomains,
        ...(report === undefined ? {} : { accepted: [...report.accepted] }),
        ...(bounced.length === 0 ? {} : { bounces: bounced.map(serializeBounce) }),
      },
    };
  }

  async poll(receipt: AnchorReceipt): Promise<AnchorReceipt> {
    if (this.#collector === undefined) return receipt;
    const { acks, bounces } = await this.#collector.collect(receipt.externalRef);
    if (acks.length === 0 && bounces.length === 0) return receipt;
    return withAcks(receipt, acks, this.#clock(), bounces);
  }

  async verify(receipt: AnchorReceipt, checkpointHash: Uint8Array): Promise<VerificationOutcome> {
    const checks: CheckOutcome[] = [];
    const residualClaims: ResidualClaim[] = [];

    if (receipt.independenceClass !== this.meta.independenceClass) {
      return invalidOutcome(
        this.meta,
        `el recibo se declara de clase '${receipt.independenceClass}' y este proveedor es ` +
          "'human-witness'",
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

    const acks = parseAcks(receipt.raw['acks']);
    if (acks === undefined) {
      return invalidOutcome(this.meta, 'la lista de acuses del recibo está mal formada', checks);
    }

    const bounces = parseBounces(receipt.raw['bounces']);
    if (bounces === undefined) {
      return invalidOutcome(this.meta, 'la lista de rebotes del recibo está mal formada', checks);
    }

    const validDomains = new Set<string>();
    let informativos = 0;

    // Los rebotes se procesan ANTES que los acuses: si una dirección rebotó, lo que hay que explicar
    // no es que falte su acuse —eso ya se ve— sino que ese testigo dejó de existir para el anclaje.
    const caidos = new Set<string>();
    for (const bounce of bounces) {
      const witness = this.#witnesses.find(
        (candidate) =>
          candidate.id === bounce.witness ||
          candidate.address.toLowerCase() === bounce.address.toLowerCase(),
      );
      const quien = witness?.id ?? bounce.address;
      const codigo = bounce.status === undefined ? '' : ` [${bounce.status}]`;
      if (bounce.kind === 'permanente' && witness !== undefined) caidos.add(witness.id);
      checks.push(
        check(
          'rebote',
          false,
          `el correo NO llegó a ${quien}${codigo}: ${bounce.detail}` +
            (bounce.kind === 'permanente'
              ? '. Es un rebote permanente: ese testigo ya no cuenta hasta que se reponga el padrón'
              : '. Es transitorio: puede llegar en el reintento'),
        ),
      );
    }

    for (const ack of acks) {
      const witness = this.#witnesses.find((candidate) => candidate.id === ack.witness);
      if (witness === undefined) {
        checks.push(
          check('acuse', false, `'${ack.witness}' no está en el padrón de testigos: no cuenta`),
        );
        continue;
      }
      if (witness.address.toLowerCase() !== ack.address.toLowerCase()) {
        checks.push(
          check(
            'acuse',
            false,
            `${witness.id} acusa desde ${ack.address} y el padrón dice ${witness.address}: no cuenta`,
          ),
        );
        continue;
      }
      const domain = domainOf(ack.address);
      if (this.#selfDomains.has(domain)) {
        checks.push(
          check(
            'acuse',
            false,
            `${witness.id} está en un dominio nuestro (${domain}): un testigo de casa no es testigo`,
          ),
        );
        continue;
      }

      if (ack.signature === undefined) {
        informativos++;
        checks.push(
          check(
            'acuse',
            false,
            `${witness.id} acusó recibo sin firmar: queda como informativo y no cuenta para el umbral`,
          ),
        );
        continue;
      }

      const preimage = ackPreimage({
        address: ack.address,
        checkpointHash: expectedHex,
        messageId: receipt.externalRef,
        seenAt: ack.seenAt,
        witness: ack.witness,
      });

      let firmaValida: boolean;
      try {
        const signature = parseSshSignature(ack.signature);
        if (signature.namespace !== WITNESS_SIGNATURE_NAMESPACE) {
          checks.push(
            check(
              'acuse',
              false,
              `el acuse de ${witness.id} se firmó para '${signature.namespace}' y no para ` +
                `'${WITNESS_SIGNATURE_NAMESPACE}': es una firma de otro contexto`,
            ),
          );
          continue;
        }
        if (toBase64(signature.publicKeyBlob) !== witness.publicKey) {
          checks.push(
            check('acuse', false, `el acuse de ${witness.id} lo firmó otra clave: no cuenta`),
          );
          continue;
        }
        firmaValida = await verifySshEd25519(signature, ackSignedBytes(preimage));
      } catch (error) {
        checks.push(
          check(
            'acuse',
            false,
            `el acuse de ${witness.id} tiene una firma ilegible ` +
              `(${error instanceof Error ? error.message : 'ilegible'})`,
          ),
        );
        continue;
      }

      if (!firmaValida) {
        checks.push(
          check(
            'acuse',
            false,
            `la firma del acuse de ${witness.id} NO es válida: el acuse fue alterado o es inventado`,
          ),
        );
        continue;
      }

      validDomains.add(domain);
      checks.push(check('acuse', true, `${witness.id} (${domain}) acusó recibo y lo firmó`));
    }

    const total = validDomains.size;

    if (caidos.size > 0) {
      // Cuántos dominios distintos quedan **alcanzables**: los del padrón que no son de casa y a los
      // que el correo sigue llegando. Si ese número ya es menor que el umbral, el anclaje no está
      // «tardando»: no puede confirmarse nunca con este padrón, y decir «pendiente» a secas sería
      // dejar en ámbar permanente algo que sólo se arregla reponiendo testigos.
      const alcanzables = new Set(
        this.#witnesses
          .filter((witness) => !caidos.has(witness.id))
          .map((witness) => domainOf(witness.address))
          .filter((domain) => domain !== '' && !this.#selfDomains.has(domain)),
      );
      residualClaims.push({
        claim:
          `${String(caidos.size)} testigo(s) del padrón ya no reciben el correo: ` +
          [...caidos].join(', '),
        verifyBy:
          alcanzables.size < this.#minDistinctDomains
            ? `quedan ${String(alcanzables.size)} dominios alcanzables y hacen falta ` +
              `${String(this.#minDistinctDomains)}: con este padrón el anclaje por testigos NO ` +
              'puede confirmarse. Hay que reponer testigos antes del próximo checkpoint'
            : 'confirmá con la veeduría si esas personas siguen en el instituto y actualizá el ' +
              'padrón. Un padrón que se erosiona sin que nadie lo note acaba en un umbral que ya ' +
              'no se alcanza',
      });
    }

    if (informativos > 0) {
      residualClaims.push({
        claim: `${String(informativos)} testigo(s) acusaron recibo sin firmar`,
        verifyBy:
          'pediles que exhiban su propia copia del correo. Un acuse sin firma sólo vale si lo ' +
          'presenta quien lo recibió',
      });
    }

    if (total >= this.#minDistinctDomains) {
      const attestedAt = latestSeenAt(acks);
      return {
        status: 'confirmado',
        provider: this.meta.id,
        independenceClass: 'human-witness',
        offline: true,
        checks,
        residualClaims,
        detail:
          `${String(total)} personas de dominios de correo distintos confirmaron por escrito, y con ` +
          'su firma, que recibieron este resumen',
        ...(attestedAt === undefined ? {} : { attestedAt }),
      };
    }

    return {
      status: 'pendiente',
      provider: this.meta.id,
      independenceClass: 'human-witness',
      offline: true,
      checks,
      residualClaims: [
        ...residualClaims,
        {
          claim:
            `hacen falta ${String(this.#minDistinctDomains)} dominios distintos y hay ` +
            String(total),
          verifyBy:
            'si pasan horas sin acuses, avisá a la veeduría: puede que el correo esté cayendo en ' +
            'spam o que las direcciones ya no existan',
        },
      ],
      detail:
        `todavía no hay suficientes testigos: ${String(total)} de ${String(this.#minDistinctDomains)} ` +
        'dominios distintos',
    };
  }
}

/**
 * Añade acuses —y, si los hay, rebotes— a un recibo, conservando el resto.
 *
 * Los rebotes se **acumulan** con los que ya trajera el recibo, mientras que los acuses se
 * sustituyen. No es asimetría gratuita: un acuse es el estado actual de un testigo y el último gana;
 * un rebote es un hecho que ocurrió una vez, y borrarlo porque la siguiente recogida no lo repitió
 * sería exactamente cómo se pierde el rastro del desgaste del padrón.
 */
export function withAcks(
  receipt: AnchorReceipt,
  acks: readonly WitnessAck[],
  confirmedAt: string,
  bounces: readonly WitnessBounce[] = [],
): AnchorReceipt {
  const serialized: JsonValue[] = acks.map((ack) => ({
    witness: ack.witness,
    address: ack.address,
    seenAt: ack.seenAt,
    ...(ack.signature === undefined ? {} : { signature: ack.signature }),
  }));

  const previos = parseBounces(receipt.raw['bounces']) ?? [];
  const todos = [...previos];
  for (const bounce of bounces) {
    const yaEsta = todos.some(
      (previo) =>
        previo.address.toLowerCase() === bounce.address.toLowerCase() &&
        previo.kind === bounce.kind,
    );
    if (!yaEsta) todos.push(bounce);
  }

  return {
    ...receipt,
    confirmedAt,
    raw: {
      ...receipt.raw,
      acks: serialized,
      ...(todos.length === 0 ? {} : { bounces: todos.map(serializeBounce) }),
    },
  };
}

function serializeBounce(bounce: WitnessBounce): JsonValue {
  return {
    ...(bounce.witness === undefined ? {} : { witness: bounce.witness }),
    address: bounce.address,
    kind: bounce.kind,
    ...(bounce.status === undefined ? {} : { status: bounce.status }),
    detail: bounce.detail,
  };
}

/** `undefined` ⇒ la lista está mal formada, que no es lo mismo que estar vacía. */
function parseBounces(value: JsonValue | undefined): readonly WitnessBounce[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const out: WitnessBounce[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
    const record = item as Record<string, JsonValue | undefined>;
    const address = record['address'];
    const kind = record['kind'];
    const detail = record['detail'];
    const witness = record['witness'];
    const status = record['status'];
    if (typeof address !== 'string' || typeof detail !== 'string') return undefined;
    if (kind !== 'permanente' && kind !== 'transitorio') return undefined;
    if (witness !== undefined && typeof witness !== 'string') return undefined;
    if (status !== undefined && typeof status !== 'string') return undefined;
    out.push({
      witness,
      address,
      kind,
      ...(status === undefined ? {} : { status }),
      detail,
    });
  }
  return out;
}

function parseAcks(value: JsonValue | undefined): readonly WitnessAck[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const out: WitnessAck[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined;
    const record = item as Record<string, JsonValue | undefined>;
    const witness = record['witness'];
    const address = record['address'];
    const seenAt = record['seenAt'];
    const signature = record['signature'];
    if (typeof witness !== 'string' || typeof address !== 'string' || typeof seenAt !== 'string') {
      return undefined;
    }
    if (signature !== undefined && typeof signature !== 'string') return undefined;
    out.push({
      witness,
      address,
      seenAt,
      ...(signature === undefined ? {} : { signature }),
    });
  }
  return out;
}

function latestSeenAt(acks: readonly WitnessAck[]): string | undefined {
  let latest: string | undefined;
  for (const ack of acks) {
    if (latest === undefined || ack.seenAt > latest) latest = ack.seenAt;
  }
  return latest;
}
