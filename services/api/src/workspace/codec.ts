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
  type ExecutionPlan,
  type EvidenceCertainty,
  EVIDENCE_CERTAINTIES,
  eventId,
  hash as toHash,
  type InitiativePayload,
  type InitiativeEvent,
  initiativeId,
  instant,
  memberId,
  milestoneId,
  OUTCOME_CRITERION_EVIDENCE,
  type OutcomeCriterionEvidence,
  type ProblemPayload,
  type ProblemStatus,
  type ProposalPayload,
  proposalId,
  TASK_BLOCK_CATEGORIES,
  type TaskBlockCategory,
  TASK_CHANGE_REASONS,
  type TaskChangeReason,
  TASK_EVIDENCE_KIND_CODES,
  type TaskEvidenceKindCode,
  TASK_EVIDENCE_SIZE_CLASSES,
  type TaskEvidenceSizeClass,
  TASK_EVIDENCE_VISIBILITIES,
  type TaskEvidenceVisibility,
  TASK_HELP_CATEGORIES,
  type TaskHelpCategory,
  type TaskResponseReason,
  TASK_RESPONSE_REASONS,
  taskId,
  toPrivateMaterialCommitment,
} from '@koinonia/domain';

import { instantToIso, isoToInstant } from '../decision/codec.js';
import type { LedgerEventDraft, StoredEvent } from '../ledger/types.js';

/** Tipos de agregado en el ledger. Cumplen `^#?[a-z][a-z0-9_]*$`. */
export const PROBLEM_AGGREGATE_TYPE = 'problem';
export const PROPOSAL_AGGREGATE_TYPE = 'proposal';
export const INITIATIVE_AGGREGATE_TYPE = 'initiative';
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

function assertExactKeys(source: JsonObject, expected: readonly string[], path: string): void {
  const wanted = new Set(expected);
  const actual = Object.keys(source);
  const unknown = actual.find((key) => !wanted.has(key));
  if (unknown !== undefined) {
    throw new WorkspaceCodecError(`${path}.${unknown}`, 'campo desconocido o prohibido');
  }
  const missing = expected.find((key) => !Object.prototype.hasOwnProperty.call(source, key));
  if (missing !== undefined) {
    throw new WorkspaceCodecError(`${path}.${missing}`, 'clave ausente');
  }
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

function obj(source: JsonObject, key: string, path: string): JsonObject {
  const value = source[key];
  if (!isObject(value)) {
    throw new WorkspaceCodecError(`${path}.${key}`, 'se esperaba un objeto');
  }
  return value;
}

function arr(source: JsonObject, key: string, path: string): readonly JsonValue[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new WorkspaceCodecError(`${path}.${key}`, 'se esperaba un arreglo');
  }
  return value as readonly JsonValue[];
}

function stringArray(source: JsonObject, key: string, path: string): readonly string[] {
  return arr(source, key, path).map((value, index) => {
    if (typeof value !== 'string') {
      throw new WorkspaceCodecError(`${path}.${key}[${String(index)}]`, 'se esperaba texto');
    }
    return value;
  });
}

function taskResponseReason(source: JsonObject, key: string, path: string): TaskResponseReason {
  const value = str(source, key, path);
  if (!(TASK_RESPONSE_REASONS as readonly string[]).includes(value)) {
    throw new WorkspaceCodecError(
      `${path}.${key}`,
      'se esperaba un motivo público y no sensible de respuesta a tarea',
    );
  }
  return value as TaskResponseReason;
}

function closedTaskValue<T extends string>(
  source: JsonObject,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  return oneOf<T>(str(source, key, path), allowed, `${path}.${key}`);
}

function encodeExecutionPlan(plan: ExecutionPlan): JsonObject {
  return {
    objective: plan.objective,
    responsibleId: plan.responsibleId,
    reviewAt: plan.reviewAt,
    successCriteria: plan.successCriteria.map((criterion) => ({
      description: criterion.description,
      evidenceSource: criterion.evidenceSource,
    })),
  };
}

function decodeExecutionPlan(source: JsonObject, path: string): ExecutionPlan {
  assertExactKeys(source, ['objective', 'responsibleId', 'reviewAt', 'successCriteria'], path);
  return {
    objective: str(source, 'objective', path),
    responsibleId: memberId(str(source, 'responsibleId', path)),
    reviewAt: instant(int(source, 'reviewAt', path)),
    successCriteria: arr(source, 'successCriteria', path).map((raw, index) => {
      const criterionPath = `${path}.successCriteria[${String(index)}]`;
      if (!isObject(raw)) {
        throw new WorkspaceCodecError(criterionPath, 'se esperaba un objeto');
      }
      assertExactKeys(raw, ['description', 'evidenceSource'], criterionPath);
      return {
        description: str(raw, 'description', criterionPath),
        evidenceSource: str(raw, 'evidenceSource', criterionPath),
      };
    }),
  };
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
        ...(payload.executionPlan === undefined
          ? {}
          : { executionPlan: encodeExecutionPlan(payload.executionPlan) }),
        ...(payload.executionPlanHash === undefined
          ? {}
          : { executionPlanHash: payload.executionPlanHash }),
      };
    case 'ProposalAmended':
      return {
        version: payload.version,
        title: payload.title,
        body: payload.body,
        versionHash: payload.versionHash,
        rationale: payload.rationale,
        ...(payload.executionPlan === undefined
          ? {}
          : { executionPlan: encodeExecutionPlan(payload.executionPlan) }),
        ...(payload.executionPlanHash === undefined
          ? {}
          : { executionPlanHash: payload.executionPlanHash }),
      };
    case 'DecisionLinked':
      return { decisionId: payload.decisionId, versionHash: payload.versionHash };
  }
}

function decodeProposalBody(type: string, body: JsonObject): ProposalPayload {
  switch (type) {
    case 'ProposalDrafted': {
      const executionPlan = body['executionPlan'];
      const executionPlanHash = optStr(body, 'executionPlanHash', type);
      return {
        type,
        problemId: str(body, 'problemId', type),
        circleId: circleId(str(body, 'circleId', type)),
        title: str(body, 'title', type),
        body: str(body, 'body', type),
        versionHash: toHash(str(body, 'versionHash', type)),
        ...(executionPlan === undefined
          ? {}
          : {
              executionPlan: decodeExecutionPlan(
                obj(body, 'executionPlan', type),
                `${type}.executionPlan`,
              ),
            }),
        ...(executionPlanHash === undefined
          ? {}
          : { executionPlanHash: toHash(executionPlanHash) }),
      };
    }
    case 'ProposalAmended': {
      const executionPlan = body['executionPlan'];
      const executionPlanHash = optStr(body, 'executionPlanHash', type);
      return {
        type,
        version: int(body, 'version', type),
        title: str(body, 'title', type),
        body: str(body, 'body', type),
        versionHash: toHash(str(body, 'versionHash', type)),
        rationale: str(body, 'rationale', type),
        ...(executionPlan === undefined
          ? {}
          : {
              executionPlan: decodeExecutionPlan(
                obj(body, 'executionPlan', type),
                `${type}.executionPlan`,
              ),
            }),
        ...(executionPlanHash === undefined
          ? {}
          : { executionPlanHash: toHash(executionPlanHash) }),
      };
    }
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
// Iniciativa
// ═════════════════════════════════════════════════════════════════════════════════════════════

const INITIATIVE_BODY_KEYS = {
  InitiativeCreated: [
    'decisionId',
    'proposalId',
    'proposalVersionHash',
    'decisionResultHash',
    'circleId',
    'executionPlan',
  ],
  InitiativeActivated: ['ratificationEventId', 'ratificationEventHash'],
  MilestonePlanned: ['milestoneId', 'title', 'completionCriterion', 'dueAt'],
  TaskOffered: [
    'taskId',
    'milestoneId',
    'offeredTo',
    'title',
    'description',
    'effortMinutes',
    'dueAt',
    'dependsOn',
  ],
  TaskAccepted: ['taskId', 'offerId', 'expectedTaskSeq'],
  TaskRejected: ['taskId', 'offerId', 'expectedTaskSeq', 'reason'],
  TaskReassignmentRequested: ['taskId', 'offerId', 'expectedTaskSeq', 'reason'],
  TaskReoffered: ['taskId', 'previousOfferId', 'offeredTo'],
  TaskStarted: ['taskId', 'offerId', 'expectedTaskSeq'],
  TaskBlocked: ['taskId', 'offerId', 'expectedTaskSeq', 'category'],
  TaskHelpRequested: ['taskId', 'offerId', 'expectedTaskSeq', 'category'],
  TaskResumed: ['taskId', 'offerId', 'expectedTaskSeq', 'pauseId'],
  TaskEvidenceAdded: [
    'taskId',
    'offerId',
    'expectedTaskSeq',
    'objectCommitment',
    'kindCode',
    'sizeClass',
    'visibility',
  ],
  TaskDelivered: ['taskId', 'offerId', 'expectedTaskSeq', 'evidenceIds', 'summaryCommitment'],
  TaskChangesRequested: ['taskId', 'deliveryId', 'expectedTaskSeq', 'reason'],
  TaskReviewAccepted: ['taskId', 'deliveryId', 'expectedTaskSeq', 'outcomeCriterionEvidence'],
} satisfies Readonly<Record<InitiativePayload['type'], readonly string[]>>;

function assertInitiativeBodyKeys(type: string, body: JsonObject): void {
  // La tabla sigue siendo exhaustiva por el `satisfies`; esta vista más amplia expresa que el
  // discriminante llega de JSON hostil y puede no ser una de sus claves.
  const base = (INITIATIVE_BODY_KEYS as Readonly<Record<string, readonly string[] | undefined>>)[
    type
  ];
  if (base === undefined) {
    throw new WorkspaceCodecError('eventType', `${type} no es un evento de iniciativa`);
  }
  const optionalCommitment =
    type === 'TaskBlocked' || type === 'TaskHelpRequested' || type === 'TaskChangesRequested';
  assertExactKeys(
    body,
    optionalCommitment && body['privateDetailCommitment'] !== undefined
      ? [...base, 'privateDetailCommitment']
      : base,
    type,
  );
}

function encodeInitiativeBody(payload: InitiativePayload): JsonObject {
  switch (payload.type) {
    case 'InitiativeCreated':
      return {
        decisionId: payload.decisionId,
        proposalId: payload.proposalId,
        proposalVersionHash: payload.proposalVersionHash,
        decisionResultHash: payload.decisionResultHash,
        circleId: payload.circleId,
        executionPlan: encodeExecutionPlan(payload.executionPlan),
      };
    case 'InitiativeActivated':
      return {
        ratificationEventId: payload.ratificationEventId,
        ratificationEventHash: payload.ratificationEventHash,
      };
    case 'MilestonePlanned':
      return {
        milestoneId: payload.milestoneId,
        title: payload.title,
        completionCriterion: payload.completionCriterion,
        dueAt: payload.dueAt,
      };
    case 'TaskOffered':
      return {
        taskId: payload.taskId,
        milestoneId: payload.milestoneId,
        offeredTo: payload.offeredTo,
        title: payload.title,
        description: payload.description,
        effortMinutes: payload.effortMinutes,
        dueAt: payload.dueAt,
        dependsOn: [...payload.dependsOn],
      };
    case 'TaskAccepted':
    case 'TaskStarted':
      return {
        taskId: payload.taskId,
        offerId: payload.offerId,
        expectedTaskSeq: payload.expectedTaskSeq,
      };
    case 'TaskRejected':
    case 'TaskReassignmentRequested':
      return {
        taskId: payload.taskId,
        offerId: payload.offerId,
        expectedTaskSeq: payload.expectedTaskSeq,
        reason: payload.reason,
      };
    case 'TaskBlocked':
      return {
        taskId: payload.taskId,
        offerId: payload.offerId,
        expectedTaskSeq: payload.expectedTaskSeq,
        category: payload.category,
        ...(payload.privateDetailCommitment === undefined
          ? {}
          : { privateDetailCommitment: payload.privateDetailCommitment }),
      };
    case 'TaskHelpRequested':
      return {
        taskId: payload.taskId,
        offerId: payload.offerId,
        expectedTaskSeq: payload.expectedTaskSeq,
        category: payload.category,
        ...(payload.privateDetailCommitment === undefined
          ? {}
          : { privateDetailCommitment: payload.privateDetailCommitment }),
      };
    case 'TaskResumed':
      return {
        taskId: payload.taskId,
        offerId: payload.offerId,
        expectedTaskSeq: payload.expectedTaskSeq,
        pauseId: payload.pauseId,
      };
    case 'TaskEvidenceAdded':
      return {
        taskId: payload.taskId,
        offerId: payload.offerId,
        expectedTaskSeq: payload.expectedTaskSeq,
        objectCommitment: payload.objectCommitment,
        kindCode: payload.kindCode,
        sizeClass: payload.sizeClass,
        visibility: payload.visibility,
      };
    case 'TaskDelivered':
      return {
        taskId: payload.taskId,
        offerId: payload.offerId,
        expectedTaskSeq: payload.expectedTaskSeq,
        evidenceIds: [...payload.evidenceIds],
        summaryCommitment: payload.summaryCommitment,
      };
    case 'TaskChangesRequested':
      return {
        taskId: payload.taskId,
        deliveryId: payload.deliveryId,
        expectedTaskSeq: payload.expectedTaskSeq,
        reason: payload.reason,
        ...(payload.privateDetailCommitment === undefined
          ? {}
          : { privateDetailCommitment: payload.privateDetailCommitment }),
      };
    case 'TaskReviewAccepted':
      return {
        taskId: payload.taskId,
        deliveryId: payload.deliveryId,
        expectedTaskSeq: payload.expectedTaskSeq,
        outcomeCriterionEvidence: payload.outcomeCriterionEvidence,
      };
    case 'TaskReoffered':
      return {
        taskId: payload.taskId,
        previousOfferId: payload.previousOfferId,
        offeredTo: payload.offeredTo,
      };
  }
}

function decodeInitiativeBody(type: string, body: JsonObject): InitiativePayload {
  assertInitiativeBodyKeys(type, body);
  switch (type) {
    case 'InitiativeCreated':
      return {
        type,
        decisionId: decisionId(str(body, 'decisionId', type)),
        proposalId: proposalId(str(body, 'proposalId', type)),
        proposalVersionHash: toHash(str(body, 'proposalVersionHash', type)),
        decisionResultHash: toHash(str(body, 'decisionResultHash', type)),
        circleId: circleId(str(body, 'circleId', type)),
        executionPlan: decodeExecutionPlan(
          obj(body, 'executionPlan', type),
          `${type}.executionPlan`,
        ),
      };
    case 'InitiativeActivated':
      return {
        type,
        ratificationEventId: eventId(str(body, 'ratificationEventId', type)),
        ratificationEventHash: toHash(str(body, 'ratificationEventHash', type)),
      };
    case 'MilestonePlanned':
      return {
        type,
        milestoneId: milestoneId(str(body, 'milestoneId', type)),
        title: str(body, 'title', type),
        completionCriterion: str(body, 'completionCriterion', type),
        dueAt: instant(int(body, 'dueAt', type)),
      };
    case 'TaskOffered':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        milestoneId: milestoneId(str(body, 'milestoneId', type)),
        offeredTo: memberId(str(body, 'offeredTo', type)),
        title: str(body, 'title', type),
        description: str(body, 'description', type),
        effortMinutes: int(body, 'effortMinutes', type),
        dueAt: instant(int(body, 'dueAt', type)),
        dependsOn: stringArray(body, 'dependsOn', type).map(taskId),
      };
    case 'TaskAccepted':
    case 'TaskStarted':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        offerId: eventId(str(body, 'offerId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
      };
    case 'TaskRejected':
    case 'TaskReassignmentRequested':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        offerId: eventId(str(body, 'offerId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        reason: taskResponseReason(body, 'reason', type),
      };
    case 'TaskBlocked': {
      const privateDetailCommitment = optStr(body, 'privateDetailCommitment', type);
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        offerId: eventId(str(body, 'offerId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        category: closedTaskValue<TaskBlockCategory>(body, 'category', type, TASK_BLOCK_CATEGORIES),
        ...(privateDetailCommitment === undefined
          ? {}
          : { privateDetailCommitment: toPrivateMaterialCommitment(privateDetailCommitment) }),
      };
    }
    case 'TaskHelpRequested': {
      const privateDetailCommitment = optStr(body, 'privateDetailCommitment', type);
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        offerId: eventId(str(body, 'offerId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        category: closedTaskValue<TaskHelpCategory>(body, 'category', type, TASK_HELP_CATEGORIES),
        ...(privateDetailCommitment === undefined
          ? {}
          : { privateDetailCommitment: toPrivateMaterialCommitment(privateDetailCommitment) }),
      };
    }
    case 'TaskResumed':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        offerId: eventId(str(body, 'offerId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        pauseId: eventId(str(body, 'pauseId', type)),
      };
    case 'TaskEvidenceAdded':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        offerId: eventId(str(body, 'offerId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        objectCommitment: toPrivateMaterialCommitment(str(body, 'objectCommitment', type)),
        kindCode: closedTaskValue<TaskEvidenceKindCode>(
          body,
          'kindCode',
          type,
          TASK_EVIDENCE_KIND_CODES,
        ),
        sizeClass: closedTaskValue<TaskEvidenceSizeClass>(
          body,
          'sizeClass',
          type,
          TASK_EVIDENCE_SIZE_CLASSES,
        ),
        visibility: closedTaskValue<TaskEvidenceVisibility>(
          body,
          'visibility',
          type,
          TASK_EVIDENCE_VISIBILITIES,
        ),
      };
    case 'TaskDelivered':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        offerId: eventId(str(body, 'offerId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        evidenceIds: stringArray(body, 'evidenceIds', type).map(eventId),
        summaryCommitment: toPrivateMaterialCommitment(str(body, 'summaryCommitment', type)),
      };
    case 'TaskChangesRequested': {
      const privateDetailCommitment = optStr(body, 'privateDetailCommitment', type);
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        deliveryId: eventId(str(body, 'deliveryId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        reason: closedTaskValue<TaskChangeReason>(body, 'reason', type, TASK_CHANGE_REASONS),
        ...(privateDetailCommitment === undefined
          ? {}
          : { privateDetailCommitment: toPrivateMaterialCommitment(privateDetailCommitment) }),
      };
    }
    case 'TaskReviewAccepted':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        deliveryId: eventId(str(body, 'deliveryId', type)),
        expectedTaskSeq: int(body, 'expectedTaskSeq', type),
        outcomeCriterionEvidence: closedTaskValue<OutcomeCriterionEvidence>(
          body,
          'outcomeCriterionEvidence',
          type,
          OUTCOME_CRITERION_EVIDENCE,
        ),
      };
    case 'TaskReoffered':
      return {
        type,
        taskId: taskId(str(body, 'taskId', type)),
        previousOfferId: eventId(str(body, 'previousOfferId', type)),
        offeredTo: memberId(str(body, 'offeredTo', type)),
      };
    default:
      throw new WorkspaceCodecError('eventType', `${type} no es un evento de iniciativa`);
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
  assertExactKeys(event.payload, ['eventId', 'body'], 'payload');
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

export function encodeInitiativeEvent(event: InitiativeEvent): LedgerEventDraft {
  return encode(event, encodeInitiativeBody);
}

export function decodeInitiativeEvent(stored: StoredEvent): ChainedInput<InitiativePayload> {
  const { event, body, id } = decodeEnvelope(stored, INITIATIVE_AGGREGATE_TYPE);
  return {
    eventId: eventId(id),
    aggregateId: initiativeId(event.aggregateId),
    occurredAt: isoToInstant(event.occurredAt),
    actor: event.actor === undefined ? 'system' : memberId(event.actor),
    payload: decodeInitiativeBody(event.eventType, body),
  };
}
