/**
 * El agregado `#anclaje`: **la falla de anclaje se registra dentro de la estructura protegida**.
 *
 * Esto es circular a propósito, y en el sentido correcto. Para ocultar que un anclaje falló hay que
 * alterar el ledger; alterar el ledger es exactamente lo que el anclaje detecta. La circularidad no
 * cierra el ciclo: **escala el coste del encubrimiento** (§8.4.2).
 *
 * El fallo nunca se resuelve reanclando en silencio con fecha vieja. El checkpoint se ancla cuando
 * se ancla, y la brecha temporal queda registrada para siempre.
 */

import { type JsonObject, toHex } from '@koinonia/crypto';

import type { PublicAnchorState, QuorumVerdict, RejectedAnchor } from './quorum.js';
import type { AnchorReceipt, IndependenceClass } from './types.js';

/** Singleton, como la espina. 32 hex minúsculas: no es un UUID (§1.1-bis). */
export const ANCHOR_AGGREGATE_ID = '00000000000000000000000000000002';
export const ANCHOR_AGGREGATE_TYPE = '#anclaje';

export const ANCHOR_ATTEMPTED = 'AnclajeIntentado';
export const ANCHOR_CONFIRMED = 'AnclajeConfirmado';
export const ANCHOR_FAILED = 'AnclajeFallido';
/** Publicación del estado tras evaluar el quórum. Es lo que la portada lee. */
export const ANCHOR_STATE_PUBLISHED = 'AnclajeEstadoPublicado';

/**
 * Borrador de evento, con la forma que espera `append` de `services/api`.
 *
 * Se define aquí y no se importa de `@koinonia/api` a propósito: este paquete no depende de la capa
 * que hace I/O, para poder correr en el verificador independiente y en el navegador.
 */
export interface AnchorEventDraft {
  readonly eventType: string;
  readonly eventVersion?: number;
  readonly occurredAt: string;
  readonly payload: JsonObject;
}

function treeSizeAsNumber(treeSize: bigint): number {
  const value = Number(treeSize);
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      'treeSize fuera del rango entero seguro: el perfil canónico lo rechazaría',
    );
  }
  return value;
}

export function anchorAttempted(input: {
  readonly treeSize: bigint;
  readonly checkpointHash: Uint8Array | string;
  readonly provider: string;
  readonly independenceClass: IndependenceClass;
  readonly externalRef: string;
  readonly occurredAt: string;
}): AnchorEventDraft {
  return {
    eventType: ANCHOR_ATTEMPTED,
    eventVersion: 1,
    occurredAt: input.occurredAt,
    payload: {
      treeSize: treeSizeAsNumber(input.treeSize),
      checkpointHash: asHex(input.checkpointHash),
      provider: input.provider,
      independenceClass: input.independenceClass,
      externalRef: input.externalRef,
    },
  };
}

export function anchorConfirmed(input: {
  readonly treeSize: bigint;
  readonly checkpointHash: Uint8Array | string;
  readonly provider: string;
  readonly independenceClass: IndependenceClass;
  readonly externalRef: string;
  /** Hash canónico del recibo: lo ata al ledger sin meter el recibo entero en la preimagen. */
  readonly receiptHash: Uint8Array | string;
  /** Instante EXTERNO demostrado, si lo hay. No es `occurredAt`, que lo pone el servidor. */
  readonly attestedAt?: string;
  readonly occurredAt: string;
}): AnchorEventDraft {
  return {
    eventType: ANCHOR_CONFIRMED,
    eventVersion: 1,
    occurredAt: input.occurredAt,
    payload: {
      treeSize: treeSizeAsNumber(input.treeSize),
      checkpointHash: asHex(input.checkpointHash),
      provider: input.provider,
      independenceClass: input.independenceClass,
      externalRef: input.externalRef,
      receiptHash: asHex(input.receiptHash),
      ...(input.attestedAt === undefined ? {} : { attestedAt: input.attestedAt }),
    },
  };
}

export function anchorFailed(input: {
  readonly treeSize: bigint;
  readonly checkpointHash: Uint8Array | string;
  readonly provider: string;
  readonly independenceClass: IndependenceClass;
  readonly motivo: string;
  readonly attemptNo?: number;
  readonly occurredAt: string;
}): AnchorEventDraft {
  return {
    eventType: ANCHOR_FAILED,
    eventVersion: 1,
    occurredAt: input.occurredAt,
    payload: {
      treeSize: treeSizeAsNumber(input.treeSize),
      checkpointHash: asHex(input.checkpointHash),
      provider: input.provider,
      independenceClass: input.independenceClass,
      // El motivo se guarda entero: un «falló» sin motivo no permite ni reparar ni acusar.
      motivo: input.motivo.slice(0, 2000),
      attemptNo: input.attemptNo ?? 1,
    },
  };
}

export function anchorStatePublished(input: {
  readonly treeSize: bigint;
  readonly checkpointHash: Uint8Array | string;
  readonly verdict: QuorumVerdict;
  readonly occurredAt: string;
}): AnchorEventDraft {
  const { verdict } = input;
  return {
    eventType: ANCHOR_STATE_PUBLISHED,
    eventVersion: 1,
    occurredAt: input.occurredAt,
    payload: {
      treeSize: treeSizeAsNumber(input.treeSize),
      checkpointHash: asHex(input.checkpointHash),
      estado: verdict.state satisfies PublicAnchorState,
      firme: verdict.firm,
      clasesConfirmadas: [...verdict.confirmedClasses],
      proveedores: [...verdict.countedProviders],
      decisionesPendientesDeIntegridad: verdict.decisionsPendingIntegrity,
      horasDesdeEmision: Math.floor(verdict.hoursSinceIssued),
      descartados: verdict.rejected.map((item: RejectedAnchor) => ({
        provider: item.provider,
        independenceClass: item.independenceClass,
        motivo: item.reason,
      })),
    },
  };
}

/** Los eventos que produce un recibo recién enviado. */
export function eventsForSubmission(input: {
  readonly treeSize: bigint;
  readonly receipt: AnchorReceipt;
  readonly occurredAt: string;
}): AnchorEventDraft {
  return anchorAttempted({
    treeSize: input.treeSize,
    checkpointHash: input.receipt.checkpointHash,
    provider: input.receipt.provider,
    independenceClass: input.receipt.independenceClass,
    externalRef: input.receipt.externalRef,
    occurredAt: input.occurredAt,
  });
}

function asHex(value: Uint8Array | string): string {
  return typeof value === 'string' ? value : toHex(value);
}
