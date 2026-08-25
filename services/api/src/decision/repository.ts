/**
 * Persistencia y rehidratación de un `DecisionLog`.
 *
 * El dominio produce logs; esta capa los escribe en el ledger y los vuelve a leer. La propiedad que
 * tiene que sostener es exigente y se comprueba en `tests/integration/flujo-decision.test.ts`:
 *
 *     verifyLog(loadDecisionLog(persist(log))) === verifyLog(log)   bit a bit, incluido el resultHash
 *
 * Que la igualdad sea *bit a bit* y no *equivalente* es el punto entero. El `resultHash` de una
 * decisión es lo que la asamblea publica; si la copia leída de la base produjera otro, no habría
 * forma de saber cuál de los dos es el bueno.
 */

import { toHex } from '@koinonia/crypto';
import {
  appendEvent,
  type DecisionEvent,
  type DecisionLog,
  type DecisionState,
  replay,
  verifyLog,
} from '@koinonia/domain';

import type { PgClient, PgPool, PgPoolClient } from '../db/client.js';
import { append, appendWithin, readEventAt, readHead, readStream } from '../ledger/event-store.js';
import { HeadConflictError, type AggregateHead, type ExpectedHead } from '../ledger/types.js';
import { DECISION_AGGREGATE_TYPE, decodeDecisionEvent, encodeDecisionEvent } from './codec.js';

export class DecisionPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecisionPersistenceError';
  }
}

export interface PersistResult {
  readonly decisionId: string;
  readonly appended: number;
  readonly head: AggregateHead | undefined;
  readonly idempotentReplay: boolean;
}

/**
 * Escribe en el ledger los eventos del log que todavía no están.
 *
 * El `seq` del dominio es denso desde 1 y el del ledger desde 0 (el ledger exige que el génesis sea
 * `seq = 0`). La correspondencia es `ledgerSeq = domainSeq - 1`, y se **comprueba**: si el log que
 * llega no continúa exactamente donde el ledger se quedó, se rechaza en vez de escribir un tramo que
 * dejaría un hueco o un solape.
 */
export async function persistDecisionLog(
  pool: PgPool,
  log: DecisionLog,
  options: { readonly requestId: string; readonly requestScope?: string },
): Promise<PersistResult> {
  const first = log[0];
  if (first === undefined) throw new DecisionPersistenceError('un log vacío no identifica nada');
  const decisionId: string = first.decisionId;

  const client = await pool.connect();
  let current: AggregateHead | undefined;
  let cabezaAjena = false;
  try {
    current = await readHead(client, decisionId);
    // Cuando no queda nada por escribir hay que averiguar POR QUÉ, y hasta el 2026-08-25 no se
    // averiguaba: se devolvía éxito. Ver el comentario largo debajo de `pending.length === 0`.
    if (current !== undefined && current.seq + 1 === log.length) {
      cabezaAjena = !(await laCabezaEsNuestra(client, decisionId, current.seq, log));
    }
  } finally {
    client.release();
  }

  const persisted = current === undefined ? 0 : current.seq + 1;
  if (persisted > log.length) {
    throw new DecisionPersistenceError(
      `el ledger tiene ${String(persisted)} eventos de ${decisionId} y el log trae ${String(log.length)}: ` +
        'el log recibido es más corto que la historia ya escrita',
    );
  }
  const pending: readonly DecisionEvent[] = log.slice(persisted);
  if (pending.length === 0) {
    /*
     * «Nada pendiente» significa una de dos cosas, y confundirlas costaba votos.
     *
     * La buena: este mismo log ya está escrito y alguien vuelve a guardarlo. Ahí no hay nada que
     * hacer y devolver éxito es correcto.
     *
     * La mala: el ledger avanzó EXACTAMENTE lo mismo que mide este log porque el evento de OTRA
     * persona ocupó por casualidad ese mismo número de posición. La cuenta cuadra y el contenido
     * no. Hasta el 2026-08-25 esta rama no miraba el contenido, así que devolvía éxito sobre una
     * escritura que nunca ocurrió — y quien llamaba respondía «tu voto se registró» a alguien cuyo
     * voto no existía. Las pruebas de carga lo midieron: 174 de 176 confirmaciones eran falsas
     * (`docs/TESTING.md` §11.2).
     *
     * Ahora se distinguen comparando el evento que de verdad está en la cabeza con el último de
     * este log. Si no es el mismo, esto es un conflicto de cabeza como cualquier otro y se dice
     * así, en vez de fingir que se escribió.
     */
    if (cabezaAjena) {
      const ultimo = log[log.length - 1];
      throw new HeadConflictError(
        decisionId,
        `el evento ${ultimo === undefined ? '(ninguno)' : ultimo.eventId} en seq=${String(log.length - 1)}`,
        'ese lugar lo ocupó otro evento: alguien escribió primero',
      );
    }
    return { decisionId, appended: 0, head: current, idempotentReplay: false };
  }

  for (const [offset, event] of pending.entries()) {
    const expectedDomainSeq = persisted + offset + 1;
    if (event.seq !== expectedDomainSeq) {
      throw new DecisionPersistenceError(
        `el evento ${String(offset)} del tramo pendiente dice seq=${String(event.seq)} y le toca ` +
          `${String(expectedDomainSeq)}: el log no continúa donde el ledger se quedó`,
      );
    }
    if (event.decisionId !== decisionId) {
      throw new DecisionPersistenceError('el log mezcla eventos de dos decisiones');
    }
  }

  const expectedHead: ExpectedHead =
    current === undefined ? { kind: 'new' } : { kind: 'at', seq: current.seq, hash: current.hash };

  const result = await append(pool, {
    aggregateId: decisionId,
    aggregateType: DECISION_AGGREGATE_TYPE,
    events: pending.map(encodeDecisionEvent),
    expectedHead,
    requestId: options.requestId,
    ...(options.requestScope === undefined ? {} : { requestScope: options.requestScope }),
  });

  return {
    decisionId,
    appended: result.idempotentReplay ? 0 : pending.length,
    head: result.head,
    idempotentReplay: result.idempotentReplay,
  };
}

/**
 * ¿El evento que está en la cabeza del agregado es el último de ESTE log?
 *
 * Se compara por `eventId`, que el dominio genera uno por evento y no se repite. No se compara por
 * huella: la del ledger se calcula sobre el sobre almacenado y la del dominio sobre su propia
 * preimagen, y hacerlas coincidir aquí sería reimplementar dos canonizaciones para responder una
 * pregunta que el identificador ya contesta.
 *
 * Cuesta una consulta más, y sólo en el caso raro en que la cuenta de eventos cuadra sin haber
 * escrito nada. En el camino normal —hay eventos pendientes— no se ejecuta.
 */
async function laCabezaEsNuestra(
  client: PgClient,
  decisionId: string,
  ledgerSeq: number,
  log: DecisionLog,
): Promise<boolean> {
  const ultimo = log[log.length - 1];
  if (ultimo === undefined) return false;
  const escrito = await readEventAt(client, decisionId, ledgerSeq);
  if (escrito === undefined) return false;
  return decodeDecisionEvent(escrito).eventId === ultimo.eventId;
}

/** Misma persistencia, dentro de la transaccion coordinada por el servicio de aplicacion. */
export async function persistDecisionLogWithin(
  client: PgPoolClient,
  log: DecisionLog,
  options: { readonly requestId: string; readonly requestScope?: string },
): Promise<PersistResult> {
  const first = log[0];
  if (first === undefined) throw new DecisionPersistenceError('un log vacío no identifica nada');
  const decisionId: string = first.decisionId;
  const current = await readHead(client, decisionId);
  const persisted = current === undefined ? 0 : current.seq + 1;
  if (persisted > log.length) {
    throw new DecisionPersistenceError(
      `el ledger tiene ${String(persisted)} eventos de ${decisionId} y el log trae ${String(log.length)}: ` +
        'el log recibido es más corto que la historia ya escrita',
    );
  }
  const pending: readonly DecisionEvent[] = log.slice(persisted);
  if (pending.length === 0) {
    return { decisionId, appended: 0, head: current, idempotentReplay: false };
  }
  for (const [offset, event] of pending.entries()) {
    const expectedDomainSeq = persisted + offset + 1;
    if (event.seq !== expectedDomainSeq) {
      throw new DecisionPersistenceError(
        `el evento ${String(offset)} del tramo pendiente dice seq=${String(event.seq)} y le toca ` +
          `${String(expectedDomainSeq)}: el log no continúa donde el ledger se quedó`,
      );
    }
    if (event.decisionId !== decisionId) {
      throw new DecisionPersistenceError('el log mezcla eventos de dos decisiones');
    }
  }
  const expectedHead: ExpectedHead =
    current === undefined ? { kind: 'new' } : { kind: 'at', seq: current.seq, hash: current.hash };
  const result = await appendWithin(client, {
    aggregateId: decisionId,
    aggregateType: DECISION_AGGREGATE_TYPE,
    events: pending.map(encodeDecisionEvent),
    expectedHead,
    requestId: options.requestId,
    ...(options.requestScope === undefined ? {} : { requestScope: options.requestScope }),
  });
  return {
    decisionId,
    appended: result.idempotentReplay ? 0 : pending.length,
    head: result.head,
    idempotentReplay: result.idempotentReplay,
  };
}

/**
 * Rehidrata el log completo desde el ledger.
 *
 * `seq`, `prevHash` y `hash` NO se leen: los recomputa `appendEvent`, exactamente igual que cuando
 * el log se creó. Si el contenido rehidratado difiere en un byte del original, la cadena de hashes
 * del dominio deja de cuadrar y `verifyLog` lo denuncia. Es decir: la reconstrucción no se
 * *supone* correcta, se *comprueba*.
 */
export async function loadDecisionLog(client: PgClient, decisionId: string): Promise<DecisionLog> {
  const stored = await readStream(client, decisionId);
  let log: DecisionLog = [];
  for (const row of stored) {
    if (row.event.seq !== log.length) {
      throw new DecisionPersistenceError(
        `hueco en el ledger de ${decisionId}: se esperaba seq=${String(log.length)} y llegó ` +
          `${String(row.event.seq)} (leaf_index=${row.leafIndex.toString()}, ` +
          `event_hash=${toHex(row.eventHash)})`,
      );
    }
    log = [...log, await appendEvent(log, decodeDecisionEvent(row))];
  }
  return log;
}

/** Rehidrata y pliega, verificando la cadena de hashes del dominio por el camino (INV-19). */
export async function loadDecisionState(
  client: PgClient,
  decisionId: string,
): Promise<DecisionState> {
  return verifyLog(await loadDecisionLog(client, decisionId));
}

/** Pliega sin criptografía. Útil cuando ya se verificó la cadena. */
export function replayDecision(log: DecisionLog): DecisionState {
  return replay(log);
}
