/** Ejecución técnica de una supresión propia ya autorizada (ADR-0021/0045). */

import { createHash } from 'node:crypto';

import { type InitiativeLog, verifyInitiativeLog, type MemberId, memberId } from '@koinonia/domain';

import { type PgPool, type PgPoolClient, withTransaction } from '../db/client.js';
import { appendWithin, lockLedgerWithin, readStream } from '../ledger/event-store.js';
import { requestIdFromHash } from '../ledger/anchor-store.js';
import { type StoredEvent } from '../ledger/types.js';
import { verifyAggregate } from '../ledger/verify.js';
import {
  INITIATIVE_AGGREGATE_TYPE,
  listAggregateIds,
  loadInitiativeLog,
} from '../workspace/repository.js';
import {
  PII_ERASURE_AGGREGATE_TYPE,
  PII_ERASURE_AUTHORIZATION_KIND,
  PII_ERASURE_EXECUTED_EVENT,
  PII_ERASURE_LEGAL_BASES,
  PII_ERASURE_REQUESTED_EVENT,
  privateMaterialsForSuppressionWithin,
  PrivateMaterialSuppressionUnavailableError,
} from './private-material-store.js';
import type { ClockPort, RandomPort, VaultCryptoPort } from './ports.js';

const EXECUTION_REQUEST_SCOPE = 'internal:pii-erasure-execution';
const EXECUTION_REQUEST_LABEL = '\0execute-pii-erasure-v1';

export type PiiErasureLegalBasis = (typeof PII_ERASURE_LEGAL_BASES)[number];

export interface ErasureRequestReceipt {
  readonly erasureId: string;
  readonly requestEventId: string;
  readonly requestEventHash: string;
  readonly claimRef: string;
  readonly subjectId: MemberId;
  readonly requestedAt: number;
  readonly legalBasis: PiiErasureLegalBasis;
  readonly idempotentReplay: boolean;
}

export interface ExecuteErasureOptions {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly vault: VaultCryptoPort;
}

export interface ExecuteErasureResult {
  readonly erasureId: string;
  readonly executedAt: number;
  readonly erasedPrivateMaterialCount: number;
  readonly idempotentReplay: boolean;
}

/** Ausencia, alteración, cruce de sujeto y autorización consumida comparten una salida opaca. */
export class PrivateErasureAuthorizationUnavailableError extends Error {
  constructor() {
    super('no hay una solicitud propia vigente que autorice esta supresión');
    this.name = 'PrivateErasureAuthorizationUnavailableError';
  }
}

type ErasureLedgerEvent = Pick<StoredEvent, 'event' | 'eventHash'>;

function validOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/u.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function eventPayload(event: ErasureLedgerEvent): Record<string, unknown> {
  const payload: unknown = event.event.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new PrivateErasureAuthorizationUnavailableError();
  }
  return payload as Record<string, unknown>;
}

/** Parser estricto compartido por alta/replay/ejecución; nunca usa `payload_idx`. */
export function erasureRequestReceipt(
  event: ErasureLedgerEvent,
  idempotentReplay: boolean,
): ErasureRequestReceipt {
  const payload = eventPayload(event);
  const eventHash = Buffer.from(event.eventHash).toString('hex');
  if (
    !validOpaqueId(event.event.aggregateId) ||
    event.event.aggregateType !== PII_ERASURE_AGGREGATE_TYPE ||
    event.event.seq !== 0 ||
    event.event.eventType !== PII_ERASURE_REQUESTED_EVENT ||
    event.event.eventVersion !== 1 ||
    !exactKeys(payload, [
      'authorizationKind',
      'claimRef',
      'eventId',
      'legalBasis',
      'requestedAt',
      'subjectId',
    ]) ||
    payload['authorizationKind'] !== PII_ERASURE_AUTHORIZATION_KIND ||
    !validOpaqueId(payload['claimRef']) ||
    !validOpaqueId(payload['eventId']) ||
    !PII_ERASURE_LEGAL_BASES.some((basis) => basis === payload['legalBasis']) ||
    !Number.isSafeInteger(payload['requestedAt']) ||
    (payload['requestedAt'] as number) < 0 ||
    !validOpaqueId(payload['subjectId']) ||
    event.event.actor !== payload['subjectId'] ||
    Date.parse(event.event.occurredAt) !== payload['requestedAt'] ||
    !validHash(eventHash)
  ) {
    throw new PrivateErasureAuthorizationUnavailableError();
  }
  return {
    erasureId: event.event.aggregateId,
    requestEventId: payload['eventId'],
    requestEventHash: eventHash,
    claimRef: payload['claimRef'],
    subjectId: memberId(payload['subjectId']),
    requestedAt: payload['requestedAt'],
    legalBasis: payload['legalBasis'] as PiiErasureLegalBasis,
    idempotentReplay,
  };
}

interface ParsedExecution {
  readonly eventId: string;
  readonly subjectId: MemberId;
  readonly requestEventId: string;
  readonly requestEventHash: string;
  readonly materialIds: readonly string[];
  readonly executedAt: number;
}

function parseExecution(event: StoredEvent, request: ErasureRequestReceipt): ParsedExecution {
  const payload = eventPayload(event);
  const materialIds = payload['materialIds'];
  if (
    event.event.aggregateId !== request.erasureId ||
    event.event.aggregateType !== PII_ERASURE_AGGREGATE_TYPE ||
    event.event.seq !== 1 ||
    event.event.eventType !== PII_ERASURE_EXECUTED_EVENT ||
    event.event.eventVersion !== 1 ||
    event.event.actor !== undefined ||
    !exactKeys(payload, [
      'eventId',
      'executedAt',
      'materialIds',
      'requestEventHash',
      'requestEventId',
      'subjectId',
    ]) ||
    !validOpaqueId(payload['eventId']) ||
    !Number.isSafeInteger(payload['executedAt']) ||
    (payload['executedAt'] as number) < request.requestedAt ||
    !Array.isArray(materialIds) ||
    !materialIds.every(validOpaqueId) ||
    new Set(materialIds).size !== materialIds.length ||
    [...materialIds].sort().some((value, index) => value !== materialIds[index]) ||
    payload['requestEventId'] !== request.requestEventId ||
    payload['requestEventHash'] !== request.requestEventHash ||
    payload['subjectId'] !== request.subjectId ||
    Date.parse(event.event.occurredAt) !== payload['executedAt']
  ) {
    throw new PrivateErasureAuthorizationUnavailableError();
  }
  return {
    eventId: payload['eventId'],
    subjectId: request.subjectId,
    requestEventId: request.requestEventId,
    requestEventHash: request.requestEventHash,
    materialIds,
    executedAt: payload['executedAt'],
  };
}

function executionRequestId(requestHash: string): string {
  const digest = createHash('sha256')
    .update(Buffer.from(requestHash, 'hex'))
    .update(EXECUTION_REQUEST_LABEL, 'utf8')
    .digest();
  return requestIdFromHash(digest);
}

async function loadAuthorization(
  client: PgPoolClient,
  erasureId: string,
): Promise<{
  readonly request: ErasureRequestReceipt;
  readonly execution: ParsedExecution | undefined;
  readonly head: StoredEvent;
}> {
  if (!validOpaqueId(erasureId)) throw new PrivateErasureAuthorizationUnavailableError();
  const verification = await verifyAggregate(client, erasureId);
  if (!verification.ok) throw new PrivateErasureAuthorizationUnavailableError();
  const stream = await readStream(client, erasureId);
  if (stream.length < 1 || stream.length > 2) {
    throw new PrivateErasureAuthorizationUnavailableError();
  }
  const first = stream[0];
  if (first === undefined) throw new PrivateErasureAuthorizationUnavailableError();
  const request = erasureRequestReceipt(first, false);
  const second = stream[1];
  const execution = second === undefined ? undefined : parseExecution(second, request);
  return { request, execution, head: second ?? first };
}

async function hasPrivateResidue(client: PgPoolClient, subjectId: MemberId): Promise<boolean> {
  const residue = await client.query<{ remains: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM identity.member WHERE member_id = $1) OR
       EXISTS (SELECT 1 FROM identity.subject_data_key WHERE member_id = $1) OR
       EXISTS (SELECT 1 FROM identity.contribution_capacity WHERE member_id = $1) OR
       EXISTS (SELECT 1 FROM identity.private_material WHERE owner_id = $1) AS remains`,
    [subjectId],
  );
  return residue.rows[0]?.remains !== false;
}

/**
 * Consume una autorización durable. El ejecutor sólo elige `erasureId`: el sujeto sale de seq 0.
 * Dos ejecutores derivan la misma UUID técnica y el segundo obtiene el mismo cierre, sin otro evento.
 */
export async function executeAuthorizedErasure(
  pool: PgPool,
  erasureId: string,
  options: ExecuteErasureOptions,
): Promise<ExecuteErasureResult> {
  return await withTransaction(pool, async (client) => {
    await lockLedgerWithin(client);
    const loaded = await loadAuthorization(client, erasureId);
    if (loaded.execution !== undefined) {
      if (await hasPrivateResidue(client, loaded.request.subjectId)) {
        throw new PrivateErasureAuthorizationUnavailableError();
      }
      return {
        erasureId,
        executedAt: loaded.execution.executedAt,
        erasedPrivateMaterialCount: loaded.execution.materialIds.length,
        idempotentReplay: true,
      };
    }

    const subjectId = loaded.request.subjectId;
    const locked = await client.query(
      'SELECT member_id FROM identity.member WHERE member_id = $1 FOR UPDATE',
      [subjectId],
    );
    if (locked.rows[0] === undefined) throw new PrivateErasureAuthorizationUnavailableError();

    const logs: InitiativeLog[] = [];
    for (const id of await listAggregateIds(client, INITIATIVE_AGGREGATE_TYPE)) {
      const log = await loadInitiativeLog(client, id);
      await verifyInitiativeLog(log);
      logs.push(log);
    }
    const materialIds = await privateMaterialsForSuppressionWithin(
      client,
      options.vault,
      logs,
      subjectId,
    );

    const deleted = await client.query('DELETE FROM identity.member WHERE member_id = $1', [
      subjectId,
    ]);
    if (deleted.rowCount !== 1) throw new PrivateMaterialSuppressionUnavailableError();
    if (await hasPrivateResidue(client, subjectId)) {
      throw new PrivateMaterialSuppressionUnavailableError();
    }

    const eventId = options.random.opaqueId();
    const executedAt = options.clock.now();
    if (
      !validOpaqueId(eventId) ||
      !Number.isSafeInteger(executedAt) ||
      executedAt < loaded.request.requestedAt ||
      !Number.isFinite(new Date(executedAt).getTime())
    ) {
      throw new PrivateMaterialSuppressionUnavailableError();
    }
    await appendWithin(client, {
      aggregateId: erasureId,
      aggregateType: PII_ERASURE_AGGREGATE_TYPE,
      expectedHead: {
        kind: 'at',
        seq: loaded.head.event.seq,
        hash: loaded.head.eventHash,
      },
      requestId: executionRequestId(loaded.request.requestEventHash),
      requestScope: EXECUTION_REQUEST_SCOPE,
      events: [
        {
          eventType: PII_ERASURE_EXECUTED_EVENT,
          eventVersion: 1,
          occurredAt: new Date(executedAt).toISOString(),
          payload: {
            eventId,
            executedAt,
            materialIds: [...materialIds],
            requestEventHash: loaded.request.requestEventHash,
            requestEventId: loaded.request.requestEventId,
            subjectId,
          },
        },
      ],
    });
    return {
      erasureId,
      executedAt,
      erasedPrivateMaterialCount: materialIds.length,
      idempotentReplay: false,
    };
  });
}
