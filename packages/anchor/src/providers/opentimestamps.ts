/**
 * Anclaje 1 — **OpenTimestamps sobre Bitcoin**. Clase de independencia: `blockchain`.
 *
 * Es el único de los tres que no tiene tercero de confianza: para desmentirlo hay que rehacer
 * trabajo acumulado de Bitcoin, no convencer a nadie. A cambio es el más lento (1–6 h hasta que el
 * sello madura) y el que más se apoya en un dato externo para cerrarse.
 *
 * ═══ Qué prueba exactamente un sello maduro ═══
 *
 * «El hash del checkpoint **existía antes** del bloque N». No prueba que existiera a las 21:07 del
 * día anterior, ni que lo que dice el evento sea cierto. Prueba una cota superior de tiempo, y esa
 * cota es justo lo que rompe el ataque del administrador: si reescribe la historia hoy, el
 * `checkpointHash` de ayer que ya está en Bitcoin no coincide con el que su historia nueva produce,
 * y no hay forma de meter el nuevo en un bloque del pasado.
 *
 * ═══ La cadena de comprobaciones, y dónde se corta sin red ═══
 *
 *  1. `fileDigest == SHA256(checkpointHash)` — el sello es de NUESTRO hash y no de otro. Offline.
 *  2. El árbol de operaciones lleva del `fileDigest` al digest que la atestación afirma. Offline.
 *  3. Ese digest **es** la raíz de Merkle del bloque N. ← necesita 80 bytes que no tenemos.
 *
 * El paso 3 no se finge nunca. Con la cabecera delante, `confirmado`; sin ella, `incompleto` y la
 * afirmación pendiente queda escrita con su nombre y con el sitio donde contrastarla.
 */

import { fromBase64Url, fromHex, toBase64Url, toHex } from '@koinonia/crypto';

import {
  blockInstant,
  type BitcoinHeaderSource,
  blockHashHex,
  merkleRootOf,
  NO_HEADERS,
} from '../ots/bitcoin.js';
import type { OtsCalendarClient } from '../ots/calendar.js';
import { applyOp, type OtsLeaf, parseDetachedTimestamp, walk } from '../ots/format.js';
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

export const OPENTIMESTAMPS_ID = 'ots';

export interface OpenTimestampsOptions {
  /**
   * Ausente en el verificador: comprobar un sello no exige poder emitirlo, y exigir un calendario
   * para verificar obligaría a quien audita a configurar una conexión que no va a usar.
   */
  readonly calendar?: OtsCalendarClient;
  /** Cabeceras de bloque conocidas. Sin ellas la verificación llega hasta donde puede y lo dice. */
  readonly headers?: BitcoinHeaderSource;
  /** Instante inyectado: este paquete no lee el reloj (el instante entra como dato). */
  readonly clock: () => string;
  readonly id?: string;
}

export class OpenTimestampsProvider implements AnchorProvider {
  readonly meta: ProviderMetadata;
  readonly #calendar: OtsCalendarClient | undefined;
  readonly #headers: BitcoinHeaderSource;
  readonly #clock: () => string;

  constructor(options: OpenTimestampsOptions) {
    this.#calendar = options.calendar;
    this.#headers = options.headers ?? NO_HEADERS;
    this.#clock = options.clock;
    this.meta = {
      id: options.id ?? OPENTIMESTAMPS_ID,
      independenceClass: 'blockchain',
      trustAssumption:
        'nadie en concreto: desmentirlo exige rehacer el trabajo acumulado de Bitcoin. El ' +
        'calendario que agrega los sellos puede caerse o negarse a sellar, pero NO puede falsificar ' +
        'un sello: si lo intentara, el paso 1 de la verificación lo detecta.',
      // La última afirmación —«el bloque N tiene esta raíz de Merkle»— sólo se cierra con la
      // cabecera del bloque. Si se precargaron cabeceras, `verify` no toca la red igualmente.
      verificationNeedsNetwork: true,
      // No hay clave: el sello no se firma, se ancla. Por eso este anclaje es inmune al problema
      // que sí tiene el de git.
      signingKeyOffHost: true,
      maturationHint: 'entre 1 y 6 horas: el sello espera a entrar en un bloque de Bitcoin',
    };
  }

  async submit(checkpointHash: Uint8Array): Promise<AnchorReceipt> {
    const fileDigest = await applyOp({ kind: 'sha256' }, checkpointHash);
    const otsBytes = await this.#requireCalendar().stamp(fileDigest);
    return this.#receiptFrom(checkpointHash, otsBytes, this.#clock());
  }

  async poll(receipt: AnchorReceipt): Promise<AnchorReceipt> {
    const proof = receipt.proof;
    if (proof === undefined) return receipt;
    const upgraded = await this.#requireCalendar().upgrade(fromBase64Url(proof));
    if (upgraded === undefined) return receipt;
    return this.#receiptFrom(fromHex(receipt.checkpointHash), upgraded, receipt.submittedAt);
  }

  #requireCalendar(): OtsCalendarClient {
    if (this.#calendar === undefined) {
      throw new Error(
        'este OpenTimestampsProvider se construyó sin calendario: sirve para VERIFICAR sellos, no ' +
          'para emitirlos',
      );
    }
    return this.#calendar;
  }

  async #receiptFrom(
    checkpointHash: Uint8Array,
    otsBytes: Uint8Array,
    submittedAt: string,
  ): Promise<AnchorReceipt> {
    const detached = await parseDetachedTimestamp(otsBytes);
    const leaves = walk(detached.timestamp);
    const bitcoin = leaves.find((leaf) => leaf.attestation.kind === 'bitcoin');
    const pending = leaves.find((leaf) => leaf.attestation.kind === 'pending');

    const height = bitcoin?.attestation.kind === 'bitcoin' ? bitcoin.attestation.height : undefined;
    const header = height === undefined ? undefined : this.#headers.get(height);

    const externalRef =
      height === undefined
        ? pending?.attestation.kind === 'pending'
          ? pending.attestation.uri
          : 'sin-atestacion'
        : `bitcoin:${String(height)}`;

    return {
      provider: this.meta.id,
      independenceClass: 'blockchain',
      checkpointHash: toHex(checkpointHash),
      externalRef,
      submittedAt,
      ...(header === undefined ? {} : { confirmedAt: blockInstant(header) }),
      proof: toBase64Url(otsBytes),
      raw: {
        // Informativo. El verificador NO lee nada de aquí: todo lo recalcula desde `proof`.
        fileHashOp: 'sha256',
        fileDigest: toHex(detached.fileDigest),
        ...(this.#calendar === undefined ? {} : { calendar: this.#calendar.uri }),
        ...(height === undefined ? {} : { blockHeight: height }),
        ...(header === undefined ? {} : { blockHash: await blockHashHex(header) }),
      },
    };
  }

  async verify(receipt: AnchorReceipt, checkpointHash: Uint8Array): Promise<VerificationOutcome> {
    const checks: CheckOutcome[] = [];
    const residualClaims: ResidualClaim[] = [];

    if (receipt.independenceClass !== this.meta.independenceClass) {
      return invalidOutcome(
        this.meta,
        `el recibo se declara de clase '${receipt.independenceClass}' y este proveedor es de clase ` +
          `'${this.meta.independenceClass}': un recibo disfrazado de otra clase inflaría el quórum`,
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
      return invalidOutcome(
        this.meta,
        'el recibo no trae el sello `.ots`: sin él no hay nada que comprobar',
        checks,
      );
    }

    let leaves: readonly OtsLeaf[];
    let fileDigest: Uint8Array;
    try {
      const detached = await parseDetachedTimestamp(fromBase64Url(proof));
      fileDigest = detached.fileDigest;
      const recomputed = await applyOp(detached.fileHashOp, checkpointHash);
      if (toHex(recomputed) !== toHex(fileDigest)) {
        return invalidOutcome(
          this.meta,
          'el sello no es de este checkpoint: el resumen que sella no es el que sale de nuestro ' +
            'hash. O el sello es de otra cosa, o alguien cambió el checkpoint después de sellarlo',
          [...checks, check('sello_del_hash', false, `sello sobre ${toHex(fileDigest)}`)],
        );
      }
      leaves = walk(detached.timestamp);
    } catch (error) {
      return invalidOutcome(
        this.meta,
        `el sello \`.ots\` no se puede leer (${error instanceof Error ? error.message : 'ilegible'}): ` +
          'está corrupto o fue manipulado',
        checks,
      );
    }
    checks.push(
      check(
        'sello_del_hash',
        true,
        `el sello es sobre SHA256(checkpoint) = ${toHex(fileDigest).slice(0, 16)}…`,
      ),
    );
    checks.push(
      check(
        'camino',
        true,
        `el árbol del sello se recorrió entero: ${String(leaves.length)} atestación(es)`,
      ),
    );

    let confirmedAt: string | undefined;
    let confirmed = false;
    let pending = false;

    for (const leaf of leaves) {
      const attestation = leaf.attestation;
      if (attestation.kind === 'pending') {
        pending = true;
        checks.push(
          check(
            'atestacion_pendiente',
            true,
            `el calendario ${attestation.uri} se comprometió a incluirlo; aún no hay bloque`,
          ),
        );
        continue;
      }
      if (attestation.kind !== 'bitcoin') {
        residualClaims.push({
          claim: `hay una atestación de tipo '${attestation.kind}' que este verificador no cierra`,
          verifyBy: 'usá el cliente oficial de OpenTimestamps sobre el fichero .ots del export',
        });
        continue;
      }

      const header = this.#headers.get(attestation.height);
      if (header === undefined) {
        residualClaims.push({
          claim:
            `el sello afirma que ${toHex(leaf.digest)} es la raíz de Merkle del bloque ` +
            `${String(attestation.height)} de Bitcoin`,
          verifyBy:
            `pedí la cabecera del bloque ${String(attestation.height)} a un nodo propio o a ` +
            'cualquier explorador y comprobá que su raíz de Merkle es ese valor',
        });
        checks.push(
          check(
            'bloque',
            false,
            `falta la cabecera del bloque ${String(attestation.height)} para cerrar la comprobación`,
          ),
        );
        continue;
      }

      if (toHex(merkleRootOf(header)) !== toHex(leaf.digest)) {
        return invalidOutcome(
          this.meta,
          `el sello dice que ${toHex(leaf.digest).slice(0, 16)}… es la raíz del bloque ` +
            `${String(attestation.height)}, y la cabecera de ese bloque dice ` +
            `${toHex(merkleRootOf(header)).slice(0, 16)}…: el sello es falso`,
          [...checks, check('bloque', false, 'la raíz de Merkle del bloque no coincide')],
        );
      }

      const instant = blockInstant(header);
      const blockHash = await blockHashHex(header);
      confirmed = true;
      confirmedAt = instant;
      checks.push(
        check(
          'bloque',
          true,
          `el resumen está dentro del bloque ${String(attestation.height)} de Bitcoin ` +
            `(${instant}), cuyo identificador es ${blockHash}`,
        ),
      );
      // Se comprueba SIEMPRE, aunque la cabecera venga del propio export: es la línea que una
      // persona puede contrastar contra el mundo en diez segundos, y la única que este verificador
      // no puede cerrar por sí mismo.
      residualClaims.push({
        claim: `el bloque ${String(attestation.height)} de Bitcoin es realmente ${blockHash}`,
        verifyBy:
          'comparalo con cualquier explorador de Bitcoin o con un nodo propio. Si coincide, la ' +
          'fecha de este checkpoint está demostrada contra una cadena que nadie de aquí controla',
      });
    }

    if (receipt.confirmedAt !== undefined && confirmedAt !== undefined) {
      if (receipt.confirmedAt !== confirmedAt) {
        return invalidOutcome(
          this.meta,
          `el recibo declara la fecha ${receipt.confirmedAt} y la cabecera del bloque dice ` +
            `${confirmedAt}: el recibo miente sobre cuándo se ancló`,
          [...checks, check('fecha_declarada', false, 'la fecha del recibo no es la del bloque')],
        );
      }
      checks.push(check('fecha_declarada', true, 'la fecha del recibo es la del bloque'));
    }

    if (confirmed) {
      return {
        status: 'confirmado',
        provider: this.meta.id,
        independenceClass: 'blockchain',
        offline: true,
        checks,
        residualClaims,
        detail:
          'el resumen de esta historia quedó registrado dentro de Bitcoin: para desmentirlo habría ' +
          'que rehacer la cadena entera, no bastaría con convencer a nadie',
        ...(confirmedAt === undefined ? {} : { attestedAt: confirmedAt }),
      };
    }

    if (residualClaims.length > 0) {
      return {
        status: 'incompleto',
        provider: this.meta.id,
        independenceClass: 'blockchain',
        offline: true,
        checks,
        residualClaims,
        detail:
          'el sello es coherente y se refiere a este checkpoint, pero falta un dato de Bitcoin ' +
          'para cerrarlo. No es un fallo: es una comprobación a medias, y aquí está lo que falta',
      };
    }

    if (pending) {
      return {
        status: 'pendiente',
        provider: this.meta.id,
        independenceClass: 'blockchain',
        offline: true,
        checks,
        residualClaims,
        detail:
          'el sello está enviado y todavía no entró en ningún bloque. Es lo normal durante las ' +
          'primeras horas',
      };
    }

    return invalidOutcome(
      this.meta,
      'el sello no contiene ninguna atestación: no afirma nada',
      checks,
    );
  }
}
