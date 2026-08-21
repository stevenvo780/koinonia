/**
 * Eventos (A.7) y su encadenamiento.
 *
 * ═══ DECISIÓN A.9 — el orden canónico de replay es por `seq`, NUNCA por `occurredAt` ═══
 *
 * Dos eventos pueden compartir milisegundo. Un orden por marca temporal no es total ⇒ el escrutinio
 * dejaría de ser determinista exactamente en el caso más litigioso: dos votos en el instante del
 * cierre. `seq` es denso (1, 2, 3…), único por decisión y asignado por el almacén con exclusión
 * mutua.
 *
 * ═══ El hash del evento ═══
 *
 * DECISIÓN: A.7 define `hash = hash({eventId, decisionId, seq, occurredAt, actor, payload,
 * prevHash})`, con `prevHash` **dentro** del objeto. Aquí se usa `hashEvent` de `@koinonia/crypto`,
 * que calcula `SHA256(0x02 ‖ prevHash(32 B) ‖ jcs_utf8(cuerpo))` con `prevHash` como **prefijo
 * binario de longitud fija**. Es la misma información con dos ventajas: el octeto de separación de
 * dominio impide confundir un `eventHash` con un nodo del árbol de Merkle, y como el primer operando
 * mide siempre exactamente 32 bytes la partición de la concatenación es única. La divergencia se
 * declara aquí y se reporta; el paquete `crypto` ya estaba congelado con esta construcción.
 */

import { fromHex, hashEvent, toHex } from '@koinonia/crypto';

import { toCanonicalJson } from './canonical.js';
import type { Ballot } from './ballot.js';
import type { Objection } from './ballot.js';
import type { DecisionConfig, Delegation, DraftConfig } from './config.js';
import { BrokenLogError } from './errors.js';
import {
  type BallotId,
  type DecisionId,
  type DelegationId,
  type EventId,
  type Hash,
  hash as toHashBrand,
  type Instant,
  type MemberId,
  type ObjectionId,
  ZERO_HASH,
} from './ids.js';
import type { DecisionEventType } from './state-machine.js';

/** Causa del cierre (A.7 / D.4). */
export type CloseCause = 'window' | 'early-irreversible' | 'full-turnout' | 'manual';

/** Clase de desenlace, replicada en `ResultComputed` para poder indexar sin recomputar. */
export type OutcomeKind = 'approved' | 'rejected' | 'no-quorum' | 'needs-new-round';

export type DecisionEventPayload =
  | { readonly type: 'DecisionDrafted'; readonly draft: DraftConfig }
  | { readonly type: 'DecisionOpened'; readonly config: DecisionConfig }
  | { readonly type: 'BallotCast'; readonly ballot: Ballot }
  | {
      readonly type: 'BallotVoided';
      readonly ballotId: BallotId;
      readonly motivation: string;
      /** A.2: anular un voto es un acto político visible; exige dos firmas del círculo de garantías. */
      readonly signers: readonly MemberId[];
    }
  | { readonly type: 'DelegationGranted'; readonly delegation: Delegation }
  | {
      readonly type: 'DelegationRevoked';
      readonly delegationId: DelegationId;
      readonly at: Instant;
    }
  | { readonly type: 'ObjectionRaised'; readonly objection: Objection; readonly by: MemberId }
  | {
      readonly type: 'ObjectionAdmitted';
      readonly objectionId: ObjectionId;
      readonly panel: readonly MemberId[];
      readonly votes: number;
    }
  | {
      readonly type: 'ObjectionDismissed';
      readonly objectionId: ObjectionId;
      readonly panel: readonly MemberId[];
      /**
       * Votos del panel a favor de desestimar.
       *
       * DECISIÓN: A.7 pone `votes` en `ObjectionAdmitted` y no en `ObjectionDismissed`, que es
       * justo al revés de lo que exige B.3.a: la admisión es la **presunción** y no requiere
       * votación; **desestimar** es lo que exige 2/3 del panel. Se añade aquí, sin quitarlo de allá
       * (un panel también puede admitir expresamente). Reportado.
       */
      readonly votes: number;
      readonly motivation: string;
    }
  | {
      readonly type: 'ObjectionIntegrated';
      readonly objectionId: ObjectionId;
      readonly newProposalVersionHash: Hash;
      /**
       * DECISIÓN: B.3.b exige que la integración esté «firmada por quien objetó, declarando que la
       * enmienda atiende su objeción», pero el payload de A.7 **no tiene dónde poner esa firma**.
       * Se añade el campo: sin él, «integrar» degenera en «cambiarle una coma y declarar resuelto»,
       * que es el abuso documentado más frecuente en las implementaciones de sociocracia.
       * Reportado.
       */
      readonly signedBy: MemberId;
    }
  | { readonly type: 'ObjectionWithdrawn'; readonly objectionId: ObjectionId }
  | {
      readonly type: 'RoundOpened';
      readonly round: number;
      readonly proposalVersionHash: Hash;
    }
  | { readonly type: 'WindowExtended'; readonly newClosesAt: Instant; readonly reason: 'quorum' }
  | {
      readonly type: 'SeedRevealed';
      /** 32 bytes en hex, comprometidos antes de `opensAt`. */
      readonly seedAdmin: string;
      /**
       * Faro externo posterior al cierre (B.0.3).
       *
       * DECISIÓN: A.7 define el payload como `{ seed, commitment }`, con una sola semilla, pero
       * B.0.3 exige que la semilla sea **compuesta** (`sha256(seedAdmin ‖ "|" ‖ beaconValue)`) y
       * que `SeedRevealed` publique las dos partes. Los dos apartados se contradicen; manda B.0.3,
       * porque sin el faro externo quien genera la semilla puede molerla offline y el «sorteo
       * verificable» es teatro criptográfico. Reportado.
       */
      readonly beaconValue: string;
      readonly commitment: Hash;
    }
  | {
      readonly type: 'DecisionClosed';
      readonly at: Instant;
      readonly cause: CloseCause;
      /**
       * Firmas del cierre manual.
       *
       * DECISIÓN: A.8.1 exige «cierre manual con 2 firmas», pero el payload de A.7 es sólo
       * `{ at, cause }` y no tiene dónde ponerlas. Sin el campo, `cause: 'manual'` sería una puerta
       * abierta para cerrar la urna sin autorización y esquivando de paso todas las condiciones del
       * cierre anticipado (D.4). Se añade. Reportado.
       */
      readonly signers?: readonly MemberId[];
    }
  | {
      readonly type: 'ResultComputed';
      readonly resultHash: Hash;
      readonly outcomeKind: OutcomeKind;
    }
  | { readonly type: 'DecisionRatified' }
  | { readonly type: 'DecisionRejected'; readonly reason: string }
  | {
      readonly type: 'DecisionAnnulled';
      readonly motivation: string;
      readonly signers: readonly MemberId[];
    };

export interface DecisionEvent {
  readonly eventId: EventId;
  readonly decisionId: DecisionId;
  /** Monotónico, denso (1, 2, 3…), único por decisión. Orden canónico de replay (A.9). */
  readonly seq: number;
  /** Reloj del SERVIDOR. Es el único válido para la ventana (A.10). */
  readonly occurredAt: Instant;
  readonly actor: MemberId | 'system';
  readonly payload: DecisionEventPayload;
  /** Hash del evento `seq - 1`, o 64 ceros si `seq === 1`. */
  readonly prevHash: Hash;
  readonly hash: Hash;
}

export type DecisionLog = readonly DecisionEvent[];

/** Lo que aporta el llamante; `seq`, `prevHash` y `hash` los calcula `appendEvent`. */
export interface EventInput {
  readonly eventId: EventId;
  readonly decisionId: DecisionId;
  readonly occurredAt: Instant;
  readonly actor: MemberId | 'system';
  readonly payload: DecisionEventPayload;
}

/** El cuerpo hasheado: todo el evento menos `prevHash` (que va como prefijo binario) y `hash`. */
export function eventBody(event: Omit<DecisionEvent, 'prevHash' | 'hash'>): unknown {
  return {
    eventId: event.eventId,
    decisionId: event.decisionId,
    seq: event.seq,
    occurredAt: event.occurredAt,
    actor: event.actor,
    payload: event.payload,
  };
}

async function linkHash(prevHash: Hash, body: unknown): Promise<Hash> {
  return toHashBrand(toHex(await hashEvent(fromHex(prevHash), toCanonicalJson(body))));
}

/** Sella un evento: le asigna `seq` denso, lo encadena al anterior y calcula su hash. */
export async function appendEvent(log: DecisionLog, input: EventInput): Promise<DecisionEvent> {
  const previous = log.at(-1);
  const seq = log.length + 1;
  const prevHash = previous?.hash ?? ZERO_HASH;
  const partial = {
    eventId: input.eventId,
    decisionId: input.decisionId,
    seq,
    occurredAt: input.occurredAt,
    actor: input.actor,
    payload: input.payload,
  };
  const hash = await linkHash(prevHash, eventBody(partial));
  return { ...partial, prevHash, hash };
}

/** Azúcar: sella y devuelve el log nuevo. El log es inmutable; nunca se muta el arreglo recibido. */
export async function append(log: DecisionLog, input: EventInput): Promise<DecisionLog> {
  return [...log, await appendEvent(log, input)];
}

/**
 * INV-19 — la cadena de hashes del log es consistente: `seq` denso desde 1, `prevHash` encadenado y
 * cada `hash` recomputable. Detecta borrado, inserción y reordenamiento de cualquier evento.
 */
export async function verifyLogChain(log: DecisionLog): Promise<void> {
  let expectedPrev: Hash = ZERO_HASH;
  for (let i = 0; i < log.length; i++) {
    const event = log[i];
    if (event === undefined) throw new BrokenLogError(i + 1, 'hueco en el arreglo de eventos');
    if (event.seq !== i + 1) {
      throw new BrokenLogError(
        event.seq,
        `seq debe ser denso: se esperaba ${String(i + 1)} y llegó ${String(event.seq)}`,
      );
    }
    if (event.prevHash !== expectedPrev) {
      throw new BrokenLogError(event.seq, 'prevHash no coincide con el hash del evento anterior');
    }
    const recomputed = await linkHash(event.prevHash, eventBody(event));
    if (recomputed !== event.hash) {
      throw new BrokenLogError(event.seq, 'el hash almacenado no corresponde al contenido');
    }
    expectedPrev = event.hash;
  }
}

/** ¿La cadena es consistente? Variante no excepcional. */
export async function isLogChainIntact(log: DecisionLog): Promise<boolean> {
  try {
    await verifyLogChain(log);
    return true;
  } catch (error) {
    if (error instanceof BrokenLogError) return false;
    throw error;
  }
}

/** El tipo del evento, para la máquina de estados. */
export function eventType(event: DecisionEvent): DecisionEventType {
  return event.payload.type;
}
