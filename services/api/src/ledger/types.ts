/**
 * Tipos de la capa de persistencia del ledger.
 *
 * La frontera importante de este fichero es la que separa la **preimagen** del **sobre** (§1.1):
 * `CanonicalEvent` es lo que se hashea; `leafIndex`, `prevHash`, `eventHash`, `requestId` y
 * `recordedAt` son metadatos de almacenamiento o resultados del hash y no entran a ninguna
 * preimagen. Confundir las dos zonas es la forma más rápida de romper la verificación.
 */

import type { CanonicalEvent, JsonObject } from '@koinonia/crypto';

/** Identificador de la espina dorsal, para no importar `@koinonia/crypto` en cada módulo. */
export { SPINE_AGGREGATE_ID, SPINE_AGGREGATE_TYPE } from '@koinonia/crypto';

/** Tipo de evento que la espina emite al nacer un agregado (§2.3). */
export const AGGREGATE_OPENED = 'AgregadoAbierto';
/** Génesis de la espina: el único evento del sistema con `prevHash` en 32 ceros (§2.3). */
export const LEDGER_OPENED = 'LedgerAbierto';
/** Auto-registro del checkpoint en la espina (§6.4). */
export const CHECKPOINT_EMITTED = 'CheckpointEmitido';

/** Lo que aporta el llamante. `seq`, `prevHash`, `eventHash` y `leafIndex` los pone el almacén. */
export interface LedgerEventDraft {
  readonly eventType: string;
  /** Por defecto 1. */
  readonly eventVersion?: number | undefined;
  /** RFC 3339 UTC exacto: `YYYY-MM-DDTHH:MM:SS.sssZ`. */
  readonly occurredAt: string;
  /** `MemberId` de 32 hex. Ausente ⇒ el actor es el sistema; **nunca** `null` (§1.3.d). */
  readonly actor?: string | undefined;
  readonly payload: JsonObject;
}

/** Un evento tal como quedó escrito: preimagen, sobre y posición global. */
export interface StoredEvent {
  readonly leafIndex: bigint;
  /** El objeto canónico reconstruido desde las columnas. Es lo que se rehashea al verificar. */
  readonly event: CanonicalEvent;
  /** El texto canónico EXACTO que está en la columna `payload`. Fuente de verdad del payload. */
  readonly payloadText: string;
  readonly prevHash: Uint8Array;
  readonly eventHash: Uint8Array;
  /** Cabeza de la espina de la que cuelga este génesis. Ausente en todo lo demás. */
  readonly spineHash: Uint8Array | undefined;
  readonly requestId: string;
}

/** Cabeza de cadena de un agregado. */
export interface AggregateHead {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly seq: number;
  readonly hash: Uint8Array;
}

/**
 * Qué se espera encontrar en la cabeza antes de escribir.
 *
 * `'any'` es reintentable —el llamante no afirma nada sobre el estado previo—; `'new'` y `'at'`
 * **no lo son**: son afirmaciones del dominio, y reintentarlas en silencio convertiría un conflicto
 * real de concurrencia («alguien votó antes que yo y mi comando ya no aplica») en una escritura
 * sobre un estado que el llamante nunca vio.
 */
export type ExpectedHead =
  | { readonly kind: 'new' }
  | { readonly kind: 'at'; readonly seq: number; readonly hash: Uint8Array }
  | { readonly kind: 'any' };

export interface AppendCommand {
  readonly aggregateId: string;
  readonly aggregateType: string;
  /** Al menos uno. Se escriben todos o ninguno. */
  readonly events: readonly LedgerEventDraft[];
  readonly expectedHead: ExpectedHead;
  /** Clave de idempotencia del COMANDO (§3.5). UUID v4 generado por el cliente. */
  readonly requestId: string;
}

export interface AppendedEvent {
  readonly leafIndex: bigint;
  readonly event: CanonicalEvent;
  readonly payloadText: string;
  readonly prevHash: Uint8Array;
  readonly eventHash: Uint8Array;
}

export interface AppendResult {
  readonly aggregateId: string;
  readonly firstLeafIndex: bigint;
  readonly events: readonly AppendedEvent[];
  readonly head: AggregateHead;
  /** El `AgregadoAbierto` que la espina escribió en el mismo commit. Sólo al nacer el agregado. */
  readonly spineEvent: AppendedEvent | undefined;
  /** `true` ⇒ el `requestId` ya se había ejecutado; no se escribió nada nuevo (§3.5). */
  readonly idempotentReplay: boolean;
}

/** El estado previo no era el que el llamante afirmó. No se reintenta: es un conflicto real. */
export class HeadConflictError extends Error {
  readonly aggregateId: string;
  readonly expected: string;
  readonly actual: string;

  constructor(aggregateId: string, expected: string, actual: string) {
    super(
      `conflicto de cabeza en ${aggregateId}: se esperaba ${expected} y la cabeza está en ${actual}`,
    );
    this.name = 'HeadConflictError';
    this.aggregateId = aggregateId;
    this.expected = expected;
    this.actual = actual;
  }
}

/** El ledger no está inicializado: falta el génesis de la espina (§2.3). */
export class SpineMissingError extends Error {
  constructor() {
    super(
      'la espina #ledger no existe: ningún agregado puede nacer sin una cabeza de la que colgar. ' +
        'Ejecutá ensureSpine() antes del primer append.',
    );
    this.name = 'SpineMissingError';
  }
}

export class LedgerAppendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LedgerAppendError';
  }
}
