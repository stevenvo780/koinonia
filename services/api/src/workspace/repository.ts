/**
 * Persistencia y rehidratación de problemas y propuestas.
 *
 * Copia deliberada de la estructura de `decision/repository.ts`: el `seq` del dominio es denso desde
 * 1 y el del ledger desde 0, la correspondencia es `ledgerSeq = domainSeq - 1`, y **se comprueba**.
 * Un log que no continúe exactamente donde el ledger se quedó se rechaza en vez de escribir un tramo
 * que dejaría un hueco o un solape.
 *
 * La propiedad que sostiene, igual que allá: lo que se lee de la base es idéntico a lo que se
 * escribió, y su cadena de hashes vuelve a cuadrar. No se *supone* correcto: se *comprueba*.
 */

import {
  appendChained,
  type ChainedEvent,
  type ChainedInput,
  type ChainedLog,
  type ProblemLog,
  type ProblemPayload,
  type ProblemState,
  type InitiativeLog,
  type InitiativePayload,
  type InitiativeState,
  type ProposalLog,
  type ProposalPayload,
  type ProposalState,
  replayProblem,
  verifyInitiativeLog,
  verifyChain,
  verifyProposalLog,
} from '@koinonia/domain';

import type { PgClient, PgPool, PgPoolClient } from '../db/client.js';
import { append, appendWithin, readHead, readStream } from '../ledger/event-store.js';
import type {
  AggregateHead,
  ExpectedHead,
  LedgerEventDraft,
  StoredEvent,
} from '../ledger/types.js';
import {
  decodeProblemEvent,
  decodeInitiativeEvent,
  decodeProposalEvent,
  encodeProblemEvent,
  encodeInitiativeEvent,
  INITIATIVE_AGGREGATE_TYPE,
  encodeProposalEvent,
  PROBLEM_AGGREGATE_TYPE,
  PROPOSAL_AGGREGATE_TYPE,
} from './codec.js';

export class WorkspacePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePersistenceError';
  }
}

export interface WorkspacePersistResult {
  readonly aggregateId: string;
  readonly appended: number;
  readonly head: AggregateHead | undefined;
  readonly idempotentReplay: boolean;
}

interface Codec<P> {
  readonly aggregateType: string;
  readonly encode: (event: ChainedEvent<P>) => LedgerEventDraft;
  readonly decode: (stored: StoredEvent) => ChainedInput<P>;
}

const PROBLEM_CODEC: Codec<ProblemPayload> = {
  aggregateType: PROBLEM_AGGREGATE_TYPE,
  encode: encodeProblemEvent,
  decode: decodeProblemEvent,
};

const PROPOSAL_CODEC: Codec<ProposalPayload> = {
  aggregateType: PROPOSAL_AGGREGATE_TYPE,
  encode: encodeProposalEvent,
  decode: decodeProposalEvent,
};

const INITIATIVE_CODEC: Codec<InitiativePayload> = {
  aggregateType: INITIATIVE_AGGREGATE_TYPE,
  encode: encodeInitiativeEvent,
  decode: decodeInitiativeEvent,
};

function pendingFor<P>(
  log: ChainedLog<P>,
  current: AggregateHead | undefined,
): {
  readonly aggregateId: string;
  readonly current: AggregateHead | undefined;
  readonly pending: readonly ChainedEvent<P>[];
  readonly expectedHead: ExpectedHead;
} {
  const first = log[0];
  if (first === undefined) throw new WorkspacePersistenceError('un log vacío no identifica nada');
  const aggregateId = first.aggregateId;
  const persisted = current === undefined ? 0 : current.seq + 1;
  if (persisted > log.length) {
    throw new WorkspacePersistenceError(
      `el ledger tiene ${String(persisted)} eventos de ${aggregateId} y el log trae ` +
        `${String(log.length)}: el log recibido es más corto que la historia ya escrita`,
    );
  }
  const pending = log.slice(persisted);
  for (const [offset, event] of pending.entries()) {
    const expected = persisted + offset + 1;
    if (event.seq !== expected) {
      throw new WorkspacePersistenceError(
        `el evento ${String(offset)} del tramo pendiente dice seq=${String(event.seq)} y le toca ` +
          `${String(expected)}: el log no continúa donde el ledger se quedó`,
      );
    }
    if (event.aggregateId !== aggregateId) {
      throw new WorkspacePersistenceError('el log mezcla eventos de dos agregados');
    }
  }
  const expectedHead: ExpectedHead =
    current === undefined ? { kind: 'new' } : { kind: 'at', seq: current.seq, hash: current.hash };
  return { aggregateId, current, pending, expectedHead };
}

async function persist<P>(
  pool: PgPool,
  log: ChainedLog<P>,
  codec: Codec<P>,
  options: { readonly requestId: string },
): Promise<WorkspacePersistResult> {
  const first = log[0];
  if (first === undefined) throw new WorkspacePersistenceError('un log vacío no identifica nada');
  const aggregateId = first.aggregateId;

  const client = await pool.connect();
  let current: AggregateHead | undefined;
  try {
    current = await readHead(client, aggregateId);
  } finally {
    client.release();
  }

  const prepared = pendingFor(log, current);
  const pending = prepared.pending;
  if (pending.length === 0) {
    return { aggregateId, appended: 0, head: current, idempotentReplay: false };
  }

  const result = await append(pool, {
    aggregateId,
    aggregateType: codec.aggregateType,
    events: pending.map(codec.encode),
    expectedHead: prepared.expectedHead,
    requestId: options.requestId,
  });

  return {
    aggregateId,
    appended: result.idempotentReplay ? 0 : pending.length,
    head: result.head,
    idempotentReplay: result.idempotentReplay,
  };
}

async function persistWithin<P>(
  client: PgPoolClient,
  log: ChainedLog<P>,
  codec: Codec<P>,
  options: { readonly requestId: string },
): Promise<WorkspacePersistResult> {
  const first = log[0];
  if (first === undefined) throw new WorkspacePersistenceError('un log vacío no identifica nada');
  const current = await readHead(client, first.aggregateId);
  const prepared = pendingFor(log, current);
  if (prepared.pending.length === 0) {
    return {
      aggregateId: prepared.aggregateId,
      appended: 0,
      head: prepared.current,
      idempotentReplay: false,
    };
  }
  const result = await appendWithin(client, {
    aggregateId: prepared.aggregateId,
    aggregateType: codec.aggregateType,
    events: prepared.pending.map(codec.encode),
    expectedHead: prepared.expectedHead,
    requestId: options.requestId,
  });
  return {
    aggregateId: prepared.aggregateId,
    appended: result.idempotentReplay ? 0 : prepared.pending.length,
    head: result.head,
    idempotentReplay: result.idempotentReplay,
  };
}

async function load<P>(
  client: PgClient,
  aggregateId: string,
  codec: Codec<P>,
): Promise<ChainedLog<P>> {
  const stored = await readStream(client, aggregateId);
  let log: ChainedLog<P> = [];
  for (const row of stored) {
    if (row.event.seq !== log.length) {
      throw new WorkspacePersistenceError(
        `hueco en el ledger de ${aggregateId}: se esperaba seq=${String(log.length)} y llegó ` +
          `${String(row.event.seq)} (leaf_index=${row.leafIndex.toString()})`,
      );
    }
    log = [...log, await appendChained<P>(log, codec.decode(row))];
  }
  return log;
}

export async function persistProblemLog(
  pool: PgPool,
  log: ProblemLog,
  options: { readonly requestId: string },
): Promise<WorkspacePersistResult> {
  return persist(pool, log, PROBLEM_CODEC, options);
}

export async function loadProblemLog(client: PgClient, problemId: string): Promise<ProblemLog> {
  return load(client, problemId, PROBLEM_CODEC);
}

/** Rehidrata y pliega, verificando la cadena por el camino. */
export async function loadProblemState(client: PgClient, problemId: string): Promise<ProblemState> {
  const log = await loadProblemLog(client, problemId);
  await verifyChain(log);
  return replayProblem(log);
}

export async function persistProposalLog(
  pool: PgPool,
  log: ProposalLog,
  options: { readonly requestId: string },
): Promise<WorkspacePersistResult> {
  return persist(pool, log, PROPOSAL_CODEC, options);
}

/** Misma persistencia de propuesta, dentro de una transaccion coordinada por el servicio. */
export async function persistProposalLogWithin(
  client: PgPoolClient,
  log: ProposalLog,
  options: { readonly requestId: string },
): Promise<WorkspacePersistResult> {
  return persistWithin(client, log, PROPOSAL_CODEC, options);
}

export async function loadProposalLog(client: PgClient, proposalId: string): Promise<ProposalLog> {
  return load(client, proposalId, PROPOSAL_CODEC);
}

/**
 * Rehidrata, verifica la cadena **y** comprueba que el comprobante de cada versión corresponde de
 * verdad a su texto. Lo segundo es lo que impide alterar la V1 después de que se votó sobre ella.
 */
export async function loadProposalState(
  client: PgClient,
  proposalId: string,
): Promise<ProposalState> {
  return verifyProposalLog(await loadProposalLog(client, proposalId));
}

export async function persistInitiativeLogWithin(
  client: PgPoolClient,
  log: InitiativeLog,
  options: { readonly requestId: string },
): Promise<WorkspacePersistResult> {
  return persistWithin(client, log, INITIATIVE_CODEC, options);
}

export async function loadInitiativeLog(
  client: PgClient,
  initiativeId: string,
): Promise<InitiativeLog> {
  return load(client, initiativeId, INITIATIVE_CODEC);
}

export async function loadInitiativeState(
  client: PgClient,
  initiativeId: string,
): Promise<InitiativeState> {
  return verifyInitiativeLog(await loadInitiativeLog(client, initiativeId));
}

/** Identificadores de todos los agregados de un tipo, en orden de nacimiento. */
export async function listAggregateIds(
  client: PgClient,
  aggregateType: string,
): Promise<readonly string[]> {
  const { rows } = await client.query<{ aggregate_id: string; leaf_index: string }>(
    `SELECT aggregate_id, MIN(leaf_index)::text AS leaf_index
       FROM governance.event
      WHERE aggregate_type = $1
      GROUP BY aggregate_id
      ORDER BY MIN(leaf_index) ASC`,
    [aggregateType],
  );
  return rows.map((row) => row.aggregate_id.trimEnd());
}

export { INITIATIVE_AGGREGATE_TYPE, PROBLEM_AGGREGATE_TYPE, PROPOSAL_AGGREGATE_TYPE };
