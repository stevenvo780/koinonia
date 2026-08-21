/**
 * Cadena de hashes por agregado (§2 de `10-ledger-inmutable.md`).
 *
 *     eventHash_n = SHA256( 0x02 ‖ prevHash_{n-1}(32B) ‖ JCS_utf8(evento_n) )
 *
 * La cadena detecta con certeza la **modificación** y la **eliminación parcial** dentro de un
 * agregado. No detecta la desaparición del agregado entero: eso lo cubren la espina `#ledger`, el
 * índice global denso y el `headsRoot` del checkpoint (§2.3), que viven fuera de este paquete.
 *
 * Este módulo no basta con decir "la cadena está rota": devuelve **en qué evento** se rompió y por
 * qué. Un verificador que sólo dice "rojo" no permite ni reparar ni acusar.
 */

import type { JsonObject } from './canonical.js';
import { assertHash, bytesEqual, hashEvent, toHex, zeroHash } from './hash.js';

/** El objeto que se hashea. No incluye `prevHash`, `eventHash`, `leafIndex` ni `recordedAt` (§1.1). */
export interface CanonicalEvent {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly seq: number;
  readonly eventType: string;
  readonly eventVersion: number;
  /** RFC 3339 UTC, exactamente `YYYY-MM-DDTHH:MM:SS.sssZ`. */
  readonly occurredAt: string;
  /** `MemberId`: 32 hex minúsculas. **Ausente** —nunca `null`— si el actor es el sistema. */
  readonly actor?: string;
  readonly payload: JsonObject;
}

/** UUID del agregado singleton que sirve de raíz de confianza (§2.3). */
export const SPINE_AGGREGATE_ID = '00000000-0000-0000-0000-00000000ffff';
export const SPINE_AGGREGATE_TYPE = '#ledger';

/**
 * DECISIÓN: la spec dice en §1.1 que `aggregateId` es un "UUID v4", pero en §2.3 fija el de la
 * espina en `00000000-0000-0000-0000-00000000ffff`, que **no es un UUID v4** (el nibble de versión
 * es 0). Validar la versión rechazaría el único agregado que la spec declara axiomático. Se valida
 * la **forma** textual —36 caracteres, minúsculas, con guiones— y no la versión.
 */
const UUID_TEXTUAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** `MemberId`: 128 bits aleatorios en hex minúscula, sin guiones (ADR-0006, §1.1). */
const MEMBER_ID = /^[0-9a-f]{32}$/u;
/** `#` inicial reservado a los agregados de sistema: `#ledger`, `#anclaje`. */
const AGGREGATE_TYPE = /^#?[a-z][a-z0-9_]*$/u;
const EVENT_TYPE = /^[A-Z][A-Za-z0-9]*$/u;
const RFC3339_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const HEADER_KEYS = new Set([
  'aggregateId',
  'aggregateType',
  'seq',
  'eventType',
  'eventVersion',
  'occurredAt',
  'actor',
  'payload',
]);

export class InvalidEventError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`evento inválido en '${field}': ${detail}`);
    this.name = 'InvalidEventError';
    this.field = field;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Valida el encabezado del evento. El `payload` no se valida aquí en profundidad: lo hace la
 * canonicalización, que rechaza flotantes, `null`, claves fuera de patrón y texto no NFC.
 *
 * Se rechazan también las **claves desconocidas**: un campo de más cambia la preimagen y por tanto
 * el hash, y no queremos que un campo añadido por descuido pase por el borde y quede en la historia.
 */
export function assertCanonicalEvent(value: unknown): asserts value is CanonicalEvent {
  if (!isPlainRecord(value)) throw new InvalidEventError('<evento>', 'no es un objeto JSON plano');

  for (const key of Object.keys(value)) {
    if (!HEADER_KEYS.has(key))
      throw new InvalidEventError(key, 'clave desconocida en el encabezado');
  }

  const aggregateId = value['aggregateId'];
  if (typeof aggregateId !== 'string' || !UUID_TEXTUAL.test(aggregateId)) {
    throw new InvalidEventError(
      'aggregateId',
      'debe ser un UUID textual en minúsculas con guiones',
    );
  }

  const aggregateType = value['aggregateType'];
  if (typeof aggregateType !== 'string' || !AGGREGATE_TYPE.test(aggregateType)) {
    throw new InvalidEventError('aggregateType', `no cumple ${AGGREGATE_TYPE.source}`);
  }

  const seq = value['seq'];
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    throw new InvalidEventError('seq', 'debe ser un entero seguro >= 0');
  }

  const eventType = value['eventType'];
  if (typeof eventType !== 'string' || !EVENT_TYPE.test(eventType)) {
    throw new InvalidEventError('eventType', `no cumple ${EVENT_TYPE.source}`);
  }

  const eventVersion = value['eventVersion'];
  if (typeof eventVersion !== 'number' || !Number.isSafeInteger(eventVersion) || eventVersion < 1) {
    throw new InvalidEventError('eventVersion', 'debe ser un entero >= 1');
  }

  const occurredAt = value['occurredAt'];
  if (typeof occurredAt !== 'string' || !RFC3339_UTC_MS.test(occurredAt)) {
    throw new InvalidEventError('occurredAt', 'debe ser exactamente YYYY-MM-DDTHH:MM:SS.sssZ');
  }
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== occurredAt) {
    throw new InvalidEventError('occurredAt', `${occurredAt} no es un instante real`);
  }

  if ('actor' in value) {
    const actor = value['actor'];
    if (actor === null) {
      throw new InvalidEventError(
        'actor',
        'null está prohibido: omití la clave si el actor es el sistema',
      );
    }
    if (typeof actor !== 'string' || !MEMBER_ID.test(actor)) {
      throw new InvalidEventError('actor', 'debe ser un MemberId de 32 hex minúsculas');
    }
  }

  if (!isPlainRecord(value['payload'])) {
    throw new InvalidEventError('payload', 'debe ser un objeto JSON plano');
  }
}

/** Un eslabón: el evento, de qué cuelga y qué hash produjo. */
export interface ChainLink {
  readonly event: CanonicalEvent;
  readonly prevHash: Uint8Array;
  readonly eventHash: Uint8Array;
}

export interface ChainOptions {
  /**
   * `prevHash` del evento con `seq` inicial. Sólo el génesis de la espina `#ledger` usa 32 ceros;
   * cualquier otro agregado nace colgado de la cabeza de la espina (§2.3).
   */
  readonly genesisPrevHash?: Uint8Array;
  /** Identidad esperada del agregado. Si se omite, se toma la del primer eslabón. */
  readonly aggregateId?: string;
  /** `seq` esperado del primer eslabón. Por defecto 0. */
  readonly initialSeq?: number;
}

/** Calcula el eslabón siguiente a partir de la cabeza actual. */
export async function linkEvent(prevHash: Uint8Array, event: unknown): Promise<ChainLink> {
  assertCanonicalEvent(event);
  assertHash(prevHash, 'prevHash');
  return { event, prevHash, eventHash: await hashEvent(prevHash, event) };
}

/** Construye la cadena completa de un agregado a partir de sus eventos en orden de `seq`. */
export async function buildChain(
  events: readonly unknown[],
  options: ChainOptions = {},
): Promise<ChainLink[]> {
  const links: ChainLink[] = [];
  let prevHash = options.genesisPrevHash ?? zeroHash();
  for (const event of events) {
    const link = await linkEvent(prevHash, event);
    links.push(link);
    prevHash = link.eventHash;
  }
  return links;
}

export type ChainBreakReason =
  | 'invalid-event'
  | 'aggregate-mismatch'
  | 'seq-mismatch'
  | 'prev-hash-mismatch'
  | 'event-hash-mismatch';

export interface ChainIntact {
  readonly ok: true;
  readonly length: number;
  /** Hash del último eslabón: la cabeza del agregado. Vacía la cadena, es el `genesisPrevHash`. */
  readonly head: Uint8Array;
}

export interface ChainBroken {
  readonly ok: false;
  /** Índice **exacto** del eslabón donde se detecta la ruptura, dentro del arreglo recibido. */
  readonly brokenAt: number;
  /** `seq` del evento roto, si el evento es estructuralmente legible. */
  readonly brokenAtSeq: number | null;
  readonly reason: ChainBreakReason;
  readonly detail: string;
  /** En hexadecimal, para poder pegarlo en un informe. */
  readonly expected: string | null;
  readonly actual: string | null;
}

export type ChainVerification = ChainIntact | ChainBroken;

function broken(
  brokenAt: number,
  brokenAtSeq: number | null,
  reason: ChainBreakReason,
  detail: string,
  expected: string | null = null,
  actual: string | null = null,
): ChainBroken {
  return { ok: false, brokenAt, brokenAtSeq, reason, detail, expected, actual };
}

/**
 * Verifica una cadena completa y, si está rota, dice exactamente dónde.
 *
 * El orden de las comprobaciones importa: se recorre en orden ascendente y se informa **la primera**
 * incoherencia. Alterar el evento `i` produce siempre `brokenAt === i`, nunca `i+1`, porque el hash
 * recomputado del propio evento `i` se comprueba antes de usar su hash como padre del `i+1`.
 */
export async function verifyChain(
  links: readonly ChainLink[],
  options: ChainOptions = {},
): Promise<ChainVerification> {
  const genesisPrevHash = options.genesisPrevHash ?? zeroHash();
  const first = links[0];
  if (first === undefined) {
    return { ok: true, length: 0, head: genesisPrevHash };
  }

  const aggregateId = options.aggregateId ?? first.event.aggregateId;
  const initialSeq = options.initialSeq ?? 0;
  let expectedPrev = genesisPrevHash;

  for (let index = 0; index < links.length; index++) {
    // `noUncheckedIndexedAccess`: el índice viene del propio bucle, pero el tipo no lo sabe.
    const link = links[index];
    if (link === undefined) continue;

    try {
      assertCanonicalEvent(link.event);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return broken(index, null, 'invalid-event', detail);
    }

    if (link.event.aggregateId !== aggregateId) {
      return broken(
        index,
        link.event.seq,
        'aggregate-mismatch',
        'el evento pertenece a otro agregado',
        aggregateId,
        link.event.aggregateId,
      );
    }

    const expectedSeq = initialSeq + index;
    if (link.event.seq !== expectedSeq) {
      return broken(
        index,
        link.event.seq,
        'seq-mismatch',
        'hueco o desorden en la secuencia del agregado',
        String(expectedSeq),
        String(link.event.seq),
      );
    }

    if (!bytesEqual(link.prevHash, expectedPrev)) {
      return broken(
        index,
        link.event.seq,
        'prev-hash-mismatch',
        'el eslabón no cuelga del evento anterior',
        toHex(expectedPrev),
        toHex(link.prevHash),
      );
    }

    const recomputed = await hashEvent(link.prevHash, link.event);
    if (!bytesEqual(recomputed, link.eventHash)) {
      return broken(
        index,
        link.event.seq,
        'event-hash-mismatch',
        'el contenido del evento no produce el hash registrado: fue alterado',
        toHex(recomputed),
        toHex(link.eventHash),
      );
    }

    expectedPrev = link.eventHash;
  }

  return { ok: true, length: links.length, head: expectedPrev };
}
