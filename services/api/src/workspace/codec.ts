/**
 * Codec entre los eventos de los agregados de trabajo y los eventos del ledger.
 *
 * Mismo principio que `decision/codec.ts` y por la misma razón: **el decodificador valida**. Un
 * payload que no encaje se rechaza, no se acomoda. Aquí es más corto porque estos agregados no
 * transportan fracciones exactas ni padrones congelados: son texto, etiquetas e identificadores.
 *
 * Lo que **no** se almacena, aquí igual que allá: `seq`, `prevHash` y `hash` del dominio. Son
 * función del resto y se recomputan al rehidratar. Guardarlos permitiría que la copia y el original
 * discreparan sin que nadie lo notara, que es la única clase de fallo que este proyecto existe para
 * hacer imposible.
 */

import type { CanonicalEvent, JsonObject, JsonValue } from '@koinonia/crypto';
import {
  type ChainedEvent,
  type ChainedInput,
  circleId,
  decisionId,
  type EvidenceCertainty,
  EVIDENCE_CERTAINTIES,
  eventId,
  hash as toHash,
  memberId,
  type ProblemPayload,
  type ProblemStatus,
  type ProposalPayload,
} from '@koinonia/domain';

import { instantToIso, isoToInstant } from '../decision/codec.js';
import type { LedgerEventDraft, StoredEvent } from '../ledger/types.js';

/** Tipos de agregado en el ledger. Cumplen `^#?[a-z][a-z0-9_]*$`. */
export const PROBLEM_AGGREGATE_TYPE = 'problem';
export const PROPOSAL_AGGREGATE_TYPE = 'proposal';
export const WORKSPACE_EVENT_VERSION = 1;

export class WorkspaceCodecError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path === '' ? '<payload>' : path}: ${detail}`);
    this.name = 'WorkspaceCodecError';
    this.path = path;
  }
}

const PROBLEM_STATUSES: readonly ProblemStatus[] = [
  'recogiendo-evidencia',
  'con-propuesta',
  'resuelto',
  'archivado',
];

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(source: JsonObject, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new WorkspaceCodecError(`${path}.${key}`, 'se esperaba texto');
  }
  return value;
}

function optStr(source: JsonObject, key: string, path: string): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new WorkspaceCodecError(`${path}.${key}`, 'se esperaba texto');
  }
  return value;
}

function int(source: JsonObject, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new WorkspaceCodecError(`${path}.${key}`, 'se esperaba un entero seguro');
  }
  return value;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], path: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new WorkspaceCodecError(path, `${value} no está en {${allowed.join(', ')}}`);
  }
  return value as T;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Problema
// ═════════════════════════════════════════════════════════════════════════════════════════════

function encodeProblemBody(payload: ProblemPayload): JsonObject {
  switch (payload.type) {
    case 'ProblemOpened':
      return { title: payload.title, body: payload.body, circleId: payload.circleId };
    case 'EvidenceAttached':
      return {
        evidenceId: payload.evidenceId,
        certainty: payload.certainty,
        body: payload.body,
        // Omitir, jamás `null`: `{}` y `{"source":null}` hashean distinto (§1.3.d).
        ...(payload.source === undefined ? {} : { source: payload.source }),
      };
    case 'EvidenceRetracted':
      return { evidenceId: payload.evidenceId, motivation: payload.motivation };
    case 'MeTooRecorded':
      return {};
    case 'ProblemStatusChanged':
      return { status: payload.status };
  }
}

function decodeProblemBody(type: string, body: JsonObject): ProblemPayload {
  switch (type) {
    case 'ProblemOpened':
      return {
        type,
        title: str(body, 'title', type),
        body: str(body, 'body', type),
        circleId: circleId(str(body, 'circleId', type)),
      };
    case 'EvidenceAttached': {
      const source = optStr(body, 'source', type);
      return {
        type,
        evidenceId: str(body, 'evidenceId', type),
        certainty: oneOf<EvidenceCertainty>(
          str(body, 'certainty', type),
          EVIDENCE_CERTAINTIES,
          `${type}.certainty`,
        ),
        body: str(body, 'body', type),
        ...(source === undefined ? {} : { source }),
      };
    }
    case 'EvidenceRetracted':
      return {
        type,
        evidenceId: str(body, 'evidenceId', type),
        motivation: str(body, 'motivation', type),
      };
    case 'MeTooRecorded':
      return { type };
    case 'ProblemStatusChanged':
      return {
        type,
        status: oneOf<ProblemStatus>(str(body, 'status', type), PROBLEM_STATUSES, `${type}.status`),
      };
    default:
      throw new WorkspaceCodecError('eventType', `${type} no es un evento de problema`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Propuesta
// ═════════════════════════════════════════════════════════════════════════════════════════════

function encodeProposalBody(payload: ProposalPayload): JsonObject {
  switch (payload.type) {
    case 'ProposalDrafted':
      return {
        problemId: payload.problemId,
        circleId: payload.circleId,
        title: payload.title,
        body: payload.body,
        versionHash: payload.versionHash,
      };
    case 'ProposalAmended':
      return {
        version: payload.version,
        title: payload.title,
        body: payload.body,
        versionHash: payload.versionHash,
        rationale: payload.rationale,
      };
    case 'DecisionLinked':
      return { decisionId: payload.decisionId, versionHash: payload.versionHash };
  }
}

function decodeProposalBody(type: string, body: JsonObject): ProposalPayload {
  switch (type) {
    case 'ProposalDrafted':
      return {
        type,
        problemId: str(body, 'problemId', type),
        circleId: circleId(str(body, 'circleId', type)),
        title: str(body, 'title', type),
        body: str(body, 'body', type),
        versionHash: toHash(str(body, 'versionHash', type)),
      };
    case 'ProposalAmended':
      return {
        type,
        version: int(body, 'version', type),
        title: str(body, 'title', type),
        body: str(body, 'body', type),
        versionHash: toHash(str(body, 'versionHash', type)),
        rationale: str(body, 'rationale', type),
      };
    case 'DecisionLinked':
      return {
        type,
        decisionId: decisionId(str(body, 'decisionId', type)),
        versionHash: toHash(str(body, 'versionHash', type)),
      };
    default:
      throw new WorkspaceCodecError('eventType', `${type} no es un evento de propuesta`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Frontera
// ═════════════════════════════════════════════════════════════════════════════════════════════

function encode<P extends { readonly type: string }>(
  event: ChainedEvent<P>,
  encodeBody: (payload: P) => JsonObject,
): LedgerEventDraft {
  return {
    eventType: event.payload.type,
    eventVersion: WORKSPACE_EVENT_VERSION,
    occurredAt: instantToIso(event.occurredAt),
    // `actor: 'system'` se traduce OMITIENDO la clave, jamás poniéndola a `null` (§1.3.d).
    ...(event.actor === 'system' ? {} : { actor: event.actor }),
    payload: { eventId: event.eventId, body: encodeBody(event.payload) },
  };
}

function decodeEnvelope(
  stored: StoredEvent,
  expectedType: string,
): { readonly event: CanonicalEvent; readonly body: JsonObject; readonly id: string } {
  const event = stored.event;
  if (event.aggregateType !== expectedType) {
    throw new WorkspaceCodecError('aggregateType', `${event.aggregateType} no es ${expectedType}`);
  }
  const idRaw = event.payload['eventId'];
  if (typeof idRaw !== 'string') {
    throw new WorkspaceCodecError('payload.eventId', 'clave ausente');
  }
  const bodyRaw = event.payload['body'];
  if (!isObject(bodyRaw)) throw new WorkspaceCodecError('payload.body', 'se esperaba un objeto');
  return { event, body: bodyRaw, id: idRaw };
}

export function encodeProblemEvent(event: ChainedEvent<ProblemPayload>): LedgerEventDraft {
  return encode(event, encodeProblemBody);
}

export function decodeProblemEvent(stored: StoredEvent): ChainedInput<ProblemPayload> {
  const { event, body, id } = decodeEnvelope(stored, PROBLEM_AGGREGATE_TYPE);
  return {
    eventId: eventId(id),
    aggregateId: event.aggregateId,
    occurredAt: isoToInstant(event.occurredAt),
    actor: event.actor === undefined ? 'system' : memberId(event.actor),
    payload: decodeProblemBody(event.eventType, body),
  };
}

export function encodeProposalEvent(event: ChainedEvent<ProposalPayload>): LedgerEventDraft {
  return encode(event, encodeProposalBody);
}

export function decodeProposalEvent(stored: StoredEvent): ChainedInput<ProposalPayload> {
  const { event, body, id } = decodeEnvelope(stored, PROPOSAL_AGGREGATE_TYPE);
  return {
    eventId: eventId(id),
    aggregateId: event.aggregateId,
    occurredAt: isoToInstant(event.occurredAt),
    actor: event.actor === undefined ? 'system' : memberId(event.actor),
    payload: decodeProposalBody(event.eventType, body),
  };
}
