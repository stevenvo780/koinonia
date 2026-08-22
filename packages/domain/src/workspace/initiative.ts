/**
 * Agregado de ejecución: una iniciativa provisional nace del resultado y sólo la ratificación la
 * habilita para recibir hitos y ofertas de trabajo (ADR-0044).
 */

import { type Action, type Actor, authorize } from '../access.js';
import type { OutcomeKind } from '../events.js';
import { PreconditionError } from '../errors.js';
import {
  type CircleId,
  type DecisionId,
  type EventId,
  eventId as toEventId,
  type Hash,
  hash as toHash,
  type InitiativeId,
  type Instant,
  instant as toInstant,
  type MemberId,
  memberId as toMemberId,
  type MilestoneId,
  milestoneId as toMilestoneId,
  type ProposalId,
  type TaskId,
  taskId as toTaskId,
  ZERO_HASH,
} from '../ids.js';
import { initiativeId as toInitiativeId } from '../ids.js';
import { appendChained, type ChainedEvent, type ChainedLog, verifyChain } from './chain.js';
import { type ExecutionPlan, validateExecutionPlanStructure } from './execution-plan.js';
import { type PrivateMaterialCommitment, toPrivateMaterialCommitment } from './private-material.js';
import { assertLedgerText, MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from './text.js';

export const MAX_MILESTONE_CRITERION_LENGTH = 500;
export const MIN_MILESTONE_CRITERION_LENGTH = 20;
export const MIN_EXECUTION_TITLE_LENGTH = 10;
export const MIN_TASK_DESCRIPTION_LENGTH = 20;
export const MAX_TASK_EFFORT_MINUTES = 10_080;
export const MAX_WEEKLY_CAPACITY_MINUTES = 10_080;
export const MAX_TASK_DEPENDENCIES = 50;
export const MAX_TASK_EVIDENCE_PER_DELIVERY = 50;

const TASK_ACCEPTANCE_CANDIDATE = Symbol('TaskAcceptanceCandidate');
const TASK_CAPACITY_ADMISSION = Symbol('TaskCapacityAdmission');

interface TaskAcceptanceBinding {
  readonly memberId: MemberId;
  readonly taskId: TaskId;
  readonly offerId: EventId;
  readonly effortMinutes: number;
  readonly checkedAt: Instant;
}

/** Resultado opaco de comprobar todas las reglas públicas antes de abrir el Vault. */
export interface TaskAcceptanceCandidate extends TaskAcceptanceBinding {
  readonly [TASK_ACCEPTANCE_CANDIDATE]: true;
}

/**
 * Prueba efímera de que la aceptación cupo bajo el lock del Vault. La marca no se serializa y no
 * puede reconstruirse desde JSON; sólo `admitTaskCapacity` la emite.
 */
export interface TaskCapacityAdmission extends TaskAcceptanceBinding {
  readonly [TASK_CAPACITY_ADMISSION]: true;
}

export interface TaskCapacityCheck {
  readonly currentLoadMinutes: number;
  readonly weeklyCapacityMinutes: number;
}

function assertIntegerWithin(
  value: number,
  min: number,
  max: number,
  code: string,
  detail: string,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new PreconditionError(code, detail);
  }
}

function assertTaskAcceptanceCandidate(candidate: TaskAcceptanceCandidate): void {
  const value: unknown = candidate;
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as Partial<TaskAcceptanceCandidate>)[TASK_ACCEPTANCE_CANDIDATE] !== true
  ) {
    throw new PreconditionError(
      'TASK_ACCEPTANCE_CANDIDATE_REQUIRED',
      'la capacidad sólo se evalúa después del preflight público de aceptación',
    );
  }
  toMemberId(candidate.memberId);
  toTaskId(candidate.taskId);
  toEventId(candidate.offerId);
  toInstant(candidate.checkedAt);
  assertIntegerWithin(
    candidate.effortMinutes,
    1,
    MAX_TASK_EFFORT_MINUTES,
    'TASK_CAPACITY_EFFORT_INVALID',
    'el esfuerzo sujeto a admisión debe ser un entero válido',
  );
}

/** Valida el cupo sin I/O y devuelve una admisión no serializable al ledger. */
export function admitTaskCapacity(
  candidate: TaskAcceptanceCandidate,
  capacity: TaskCapacityCheck,
): TaskCapacityAdmission {
  assertTaskAcceptanceCandidate(candidate);
  assertIntegerWithin(
    capacity.currentLoadMinutes,
    0,
    Number.MAX_SAFE_INTEGER - candidate.effortMinutes,
    'TASK_CAPACITY_LOAD_INVALID',
    'la carga vigente debe ser un entero no negativo',
  );
  assertIntegerWithin(
    capacity.weeklyCapacityMinutes,
    0,
    MAX_WEEKLY_CAPACITY_MINUTES,
    'TASK_WEEKLY_CAPACITY_INVALID',
    'la capacidad semanal debe ser un entero dentro del máximo semanal',
  );
  if (capacity.currentLoadMinutes + candidate.effortMinutes > capacity.weeklyCapacityMinutes) {
    throw new PreconditionError(
      'TASK_CAPACITY_EXCEEDED',
      'la aceptación supera la capacidad privada disponible para esa semana',
    );
  }
  return Object.freeze({
    memberId: candidate.memberId,
    taskId: candidate.taskId,
    offerId: candidate.offerId,
    effortMinutes: candidate.effortMinutes,
    checkedAt: candidate.checkedAt,
    [TASK_CAPACITY_ADMISSION]: true as const,
  });
}

/** Motivos publicables: nunca texto libre que pueda inmortalizar salud, trabajo u otra PII. */
export const TASK_RESPONSE_REASONS = [
  'sin-disponibilidad',
  'plazo-inviable',
  'alcance-no-claro',
  'otra-persona-mas-adecuada',
  'razon-privada',
] as const;
export type TaskResponseReason = (typeof TASK_RESPONSE_REASONS)[number];

/** Categorías deliberadamente gruesas: el detalle privado sólo entra como commitment opaco. */
export const TASK_BLOCK_CATEGORIES = [
  'dependencia',
  'recurso',
  'respuesta-externa',
  'alcance',
  'razon-privada',
] as const;
export type TaskBlockCategory = (typeof TASK_BLOCK_CATEGORIES)[number];

export const TASK_HELP_CATEGORIES = [
  'desbloqueo',
  'revision',
  'trabajo-compartido',
  'orientacion',
  'razon-privada',
] as const;
export type TaskHelpCategory = (typeof TASK_HELP_CATEGORIES)[number];

export const TASK_CHANGE_REASONS = [
  'criterio-no-cumplido',
  'evidencia-insuficiente',
  'alcance-incompleto',
  'razon-privada',
] as const;
export type TaskChangeReason = (typeof TASK_CHANGE_REASONS)[number];

/**
 * Clasificaciones gruesas: MIME, nombre y formato exactos viven fuera del ledger para evitar
 * filtrar detalles del material restringido.
 */
export const TASK_EVIDENCE_KIND_CODES = ['documento', 'imagen', 'tabla', 'texto'] as const;
export type TaskEvidenceKindCode = (typeof TASK_EVIDENCE_KIND_CODES)[number];

/** El tamaño exacto tampoco se publica; el borde de almacenamiento aplica sus propios límites. */
export const TASK_EVIDENCE_SIZE_CLASSES = ['pequena', 'mediana', 'grande'] as const;
export type TaskEvidenceSizeClass = (typeof TASK_EVIDENCE_SIZE_CLASSES)[number];

export const TASK_EVIDENCE_VISIBILITIES = ['public', 'restricted'] as const;
export type TaskEvidenceVisibility = (typeof TASK_EVIDENCE_VISIBILITIES)[number];

export const OUTCOME_CRITERION_EVIDENCE = ['verificada', 'sin-verificar', 'no-aplica'] as const;
export type OutcomeCriterionEvidence = (typeof OUTCOME_CRITERION_EVIDENCE)[number];

export interface InitiativeCreated {
  readonly type: 'InitiativeCreated';
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly proposalVersionHash: Hash;
  readonly decisionResultHash: Hash;
  readonly circleId: CircleId;
  readonly executionPlan: ExecutionPlan;
}

export interface InitiativeActivated {
  readonly type: 'InitiativeActivated';
  readonly ratificationEventId: EventId;
  readonly ratificationEventHash: Hash;
}

export interface MilestonePlanned {
  readonly type: 'MilestonePlanned';
  readonly milestoneId: MilestoneId;
  readonly title: string;
  readonly completionCriterion: string;
  readonly dueAt: Instant;
}

export interface TaskOffered {
  readonly type: 'TaskOffered';
  readonly taskId: TaskId;
  readonly milestoneId: MilestoneId;
  readonly offeredTo: MemberId;
  readonly title: string;
  readonly description: string;
  readonly effortMinutes: number;
  readonly dueAt: Instant;
  readonly dependsOn: readonly TaskId[];
}

export interface TaskAccepted {
  readonly type: 'TaskAccepted';
  readonly taskId: TaskId;
  readonly offerId: EventId;
  /** Revisión de la tarea que vio quien respondió; evita dos respuestas sobre la misma vista. */
  readonly expectedTaskSeq: number;
}

export interface TaskRejected {
  readonly type: 'TaskRejected';
  readonly taskId: TaskId;
  readonly offerId: EventId;
  readonly expectedTaskSeq: number;
  readonly reason: TaskResponseReason;
}

export interface TaskReassignmentRequested {
  readonly type: 'TaskReassignmentRequested';
  readonly taskId: TaskId;
  readonly offerId: EventId;
  readonly expectedTaskSeq: number;
  readonly reason: TaskResponseReason;
}

export interface TaskReoffered {
  readonly type: 'TaskReoffered';
  readonly taskId: TaskId;
  /** Oferta que quien reofrece vio. Impide que una orden atrasada sustituya otra oferta (ABA). */
  readonly previousOfferId: EventId;
  readonly offeredTo: MemberId;
}

interface AssigneeTaskCas {
  readonly taskId: TaskId;
  readonly offerId: EventId;
  readonly expectedTaskSeq: number;
}

export interface TaskStarted extends AssigneeTaskCas {
  readonly type: 'TaskStarted';
}

export interface TaskBlocked extends AssigneeTaskCas {
  readonly type: 'TaskBlocked';
  readonly category: TaskBlockCategory;
  readonly privateDetailCommitment?: PrivateMaterialCommitment;
}

export interface TaskHelpRequested extends AssigneeTaskCas {
  readonly type: 'TaskHelpRequested';
  readonly category: TaskHelpCategory;
  readonly privateDetailCommitment?: PrivateMaterialCommitment;
}

export interface TaskResumed extends AssigneeTaskCas {
  readonly type: 'TaskResumed';
  readonly pauseId: EventId;
}

export interface TaskEvidenceAdded extends AssigneeTaskCas {
  readonly type: 'TaskEvidenceAdded';
  readonly objectCommitment: PrivateMaterialCommitment;
  readonly kindCode: TaskEvidenceKindCode;
  readonly sizeClass: TaskEvidenceSizeClass;
  readonly visibility: TaskEvidenceVisibility;
}

export interface TaskDelivered extends AssigneeTaskCas {
  readonly type: 'TaskDelivered';
  readonly evidenceIds: readonly EventId[];
  readonly summaryCommitment: PrivateMaterialCommitment;
}

interface TaskReviewCas {
  readonly taskId: TaskId;
  readonly deliveryId: EventId;
  readonly expectedTaskSeq: number;
}

export interface TaskChangesRequested extends TaskReviewCas {
  readonly type: 'TaskChangesRequested';
  readonly reason: TaskChangeReason;
  readonly privateDetailCommitment?: PrivateMaterialCommitment;
}

export interface TaskReviewAccepted extends TaskReviewCas {
  readonly type: 'TaskReviewAccepted';
  readonly outcomeCriterionEvidence: OutcomeCriterionEvidence;
}

export type InitiativePayload =
  | InitiativeCreated
  | InitiativeActivated
  | MilestonePlanned
  | TaskOffered
  | TaskAccepted
  | TaskRejected
  | TaskReassignmentRequested
  | TaskReoffered
  | TaskStarted
  | TaskBlocked
  | TaskHelpRequested
  | TaskResumed
  | TaskEvidenceAdded
  | TaskDelivered
  | TaskChangesRequested
  | TaskReviewAccepted;

interface PayloadShape {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

const INITIATIVE_PAYLOAD_SHAPES: Readonly<Record<InitiativePayload['type'], PayloadShape>> = {
  InitiativeCreated: {
    required: [
      'type',
      'decisionId',
      'proposalId',
      'proposalVersionHash',
      'decisionResultHash',
      'circleId',
      'executionPlan',
    ],
  },
  InitiativeActivated: {
    required: ['type', 'ratificationEventId', 'ratificationEventHash'],
  },
  MilestonePlanned: {
    required: ['type', 'milestoneId', 'title', 'completionCriterion', 'dueAt'],
  },
  TaskOffered: {
    required: [
      'type',
      'taskId',
      'milestoneId',
      'offeredTo',
      'title',
      'description',
      'effortMinutes',
      'dueAt',
      'dependsOn',
    ],
  },
  TaskAccepted: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq'],
  },
  TaskRejected: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq', 'reason'],
  },
  TaskReassignmentRequested: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq', 'reason'],
  },
  TaskReoffered: {
    required: ['type', 'taskId', 'previousOfferId', 'offeredTo'],
  },
  TaskStarted: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq'],
  },
  TaskBlocked: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq', 'category'],
    optional: ['privateDetailCommitment'],
  },
  TaskHelpRequested: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq', 'category'],
    optional: ['privateDetailCommitment'],
  },
  TaskResumed: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq', 'pauseId'],
  },
  TaskEvidenceAdded: {
    required: [
      'type',
      'taskId',
      'offerId',
      'expectedTaskSeq',
      'objectCommitment',
      'kindCode',
      'sizeClass',
      'visibility',
    ],
  },
  TaskDelivered: {
    required: ['type', 'taskId', 'offerId', 'expectedTaskSeq', 'evidenceIds', 'summaryCommitment'],
  },
  TaskChangesRequested: {
    required: ['type', 'taskId', 'deliveryId', 'expectedTaskSeq', 'reason'],
    optional: ['privateDetailCommitment'],
  },
  TaskReviewAccepted: {
    required: ['type', 'taskId', 'deliveryId', 'expectedTaskSeq', 'outcomeCriterionEvidence'],
  },
};

function assertExactInitiativePayload(value: unknown): asserts value is InitiativePayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreconditionError(
      'INVALID_INITIATIVE_PAYLOAD',
      'el payload de iniciativa debe ser un objeto explícito',
    );
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PreconditionError(
      'INVALID_INITIATIVE_PAYLOAD',
      'el payload de iniciativa debe ser un objeto plano',
    );
  }
  const record = value as Record<string, unknown>;
  const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'type');
  if (typeDescriptor === undefined || !typeDescriptor.enumerable || !('value' in typeDescriptor)) {
    throw new PreconditionError(
      'INVALID_INITIATIVE_PAYLOAD',
      'el tipo del evento debe ser un dato propio y enumerable',
    );
  }
  const type: unknown = typeDescriptor.value;
  if (
    typeof type !== 'string' ||
    !Object.prototype.hasOwnProperty.call(INITIATIVE_PAYLOAD_SHAPES, type)
  ) {
    throw new PreconditionError(
      'UNKNOWN_INITIATIVE_EVENT_TYPE',
      'el tipo de evento de iniciativa no pertenece al vocabulario cerrado',
    );
  }
  const shape = INITIATIVE_PAYLOAD_SHAPES[type as InitiativePayload['type']];
  const allowed = new Set([...shape.required, ...(shape.optional ?? [])]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new PreconditionError(
        'INITIATIVE_PAYLOAD_UNKNOWN_FIELD',
        'el payload de iniciativa contiene un campo no permitido para ese evento',
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new PreconditionError(
        'INVALID_INITIATIVE_PAYLOAD',
        'todo campo del payload debe ser un dato propio y enumerable',
      );
    }
  }
  for (const key of shape.required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.value === undefined
    ) {
      throw new PreconditionError(
        'INITIATIVE_PAYLOAD_MISSING_FIELD',
        'el payload de iniciativa no contiene todos los campos exigidos por ese evento',
      );
    }
  }
  for (const key of shape.optional ?? []) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor && descriptor.value === undefined) {
      throw new PreconditionError(
        'INVALID_INITIATIVE_PAYLOAD',
        'un campo opcional ausente debe omitirse en lugar de serializarse como undefined',
      );
    }
  }

  if (type === 'InitiativeCreated') {
    assertExactExecutionPlanPayload(record['executionPlan']);
  } else if (type === 'TaskOffered') {
    assertExactArrayPayload(
      record['dependsOn'],
      'la lista de dependencias contiene propiedades desconocidas o no canónicas',
    );
  } else if (type === 'TaskDelivered') {
    assertExactArrayPayload(
      record['evidenceIds'],
      'la lista de evidencias contiene propiedades desconocidas o no canónicas',
    );
  }
}

function assertExactDataObject(
  value: unknown,
  expected: readonly string[],
  code: string,
  detail: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreconditionError(code, detail);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PreconditionError(code, detail);
  }
  const keys = new Set(expected);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !keys.has(key) ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new PreconditionError(code, detail);
    }
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.value === undefined
    ) {
      throw new PreconditionError(code, detail);
    }
  }
}

function assertExactExecutionPlanPayload(value: unknown): void {
  assertExactDataObject(
    value,
    ['objective', 'responsibleId', 'reviewAt', 'successCriteria'],
    'INVALID_INITIATIVE_EXECUTION_PLAN_PAYLOAD',
    'el plan del evento contiene campos desconocidos, ocultos o ausentes',
  );
  const criteria = value['successCriteria'];
  assertExactArrayPayload(
    criteria,
    'la lista de criterios contiene propiedades desconocidas o no canónicas',
  );
  for (const criterion of criteria) {
    assertExactDataObject(
      criterion,
      ['description', 'evidenceSource'],
      'INVALID_INITIATIVE_EXECUTION_PLAN_PAYLOAD',
      'un criterio de éxito contiene campos desconocidos, ocultos o ausentes',
    );
  }
}

function assertExactArrayPayload(
  value: unknown,
  detail: string,
): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new PreconditionError('INVALID_INITIATIVE_ARRAY_PAYLOAD', detail);
  }
  const expectedArrayKeys = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    'length',
  ]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !expectedArrayKeys.has(key)) {
      throw new PreconditionError('INVALID_INITIATIVE_ARRAY_PAYLOAD', detail);
    }
    if (key !== 'length') {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new PreconditionError('INVALID_INITIATIVE_ARRAY_PAYLOAD', detail);
      }
    }
  }
}

export type InitiativeEvent = ChainedEvent<InitiativePayload>;
export type InitiativeLog = ChainedLog<InitiativePayload>;
export type InitiativeStatus = 'por-empezar';
export type TaskStatus =
  | 'ofrecida'
  | 'aceptada'
  | 'en-curso'
  | 'bloqueada'
  | 'en-apoyo'
  | 'entregada'
  | 'completada'
  | 'rechazada'
  | 'reasignacion-solicitada';

export interface InitiativeMilestone {
  readonly milestoneId: MilestoneId;
  readonly title: string;
  readonly completionCriterion: string;
  readonly dueAt: Instant;
  readonly plannedAt: Instant;
  readonly seq: number;
}

export interface TaskOfferRecord {
  /** El identificador del evento TaskOffered/TaskReoffered es el identificador de esta oferta. */
  readonly offerId: EventId;
  readonly offeredTo: MemberId;
  readonly offeredAt: Instant;
  readonly seq: number;
}

export type TaskResponseRecord =
  | {
      readonly type: 'accepted';
      readonly offerId: EventId;
      readonly by: MemberId;
      readonly at: Instant;
      readonly seq: number;
    }
  | {
      readonly type: 'rejected' | 'reassignment-requested';
      readonly offerId: EventId;
      readonly by: MemberId;
      readonly reason: TaskResponseReason;
      readonly at: Instant;
      readonly seq: number;
    };

export interface TaskStartRecord {
  readonly offerId: EventId;
  readonly by: MemberId;
  readonly at: Instant;
  readonly seq: number;
}

export interface TaskPauseRecord {
  /** TaskBlocked o TaskHelpRequested que inició esta pausa. */
  readonly pauseId: EventId;
  readonly kind: 'blocked' | 'support';
  readonly category: TaskBlockCategory | TaskHelpCategory;
  readonly privateDetailCommitment: PrivateMaterialCommitment | undefined;
  readonly startedAt: Instant;
  readonly startedSeq: number;
  readonly endedAt: Instant | undefined;
  readonly endedSeq: number | undefined;
  readonly endedBy: 'resumed' | 'reassignment' | undefined;
}

export interface TaskHelpRequestRecord {
  readonly helpRequestId: EventId;
  readonly pauseId: EventId;
  readonly category: TaskHelpCategory;
  readonly privateDetailCommitment: PrivateMaterialCommitment | undefined;
  readonly requestedAt: Instant;
  readonly seq: number;
}

export interface TaskEvidenceRecord {
  /** Es exactamente el eventId de TaskEvidenceAdded. */
  readonly evidenceId: EventId;
  readonly offerId: EventId;
  readonly objectCommitment: PrivateMaterialCommitment;
  readonly kindCode: TaskEvidenceKindCode;
  readonly sizeClass: TaskEvidenceSizeClass;
  readonly visibility: TaskEvidenceVisibility;
  readonly addedBy: MemberId;
  readonly addedAt: Instant;
  readonly seq: number;
}

export type TaskDeliveryReview =
  | {
      readonly type: 'changes-requested';
      readonly by: MemberId;
      readonly reason: TaskChangeReason;
      readonly privateDetailCommitment: PrivateMaterialCommitment | undefined;
      readonly at: Instant;
      readonly seq: number;
    }
  | {
      readonly type: 'accepted';
      readonly by: MemberId;
      readonly outcomeCriterionEvidence: OutcomeCriterionEvidence;
      readonly at: Instant;
      readonly seq: number;
    };

export interface TaskDeliveryRecord {
  /** Es exactamente el eventId de TaskDelivered. */
  readonly deliveryId: EventId;
  readonly offerId: EventId;
  readonly evidenceIds: readonly EventId[];
  readonly summaryCommitment: PrivateMaterialCommitment;
  readonly deliveredBy: MemberId;
  readonly deliveredAt: Instant;
  readonly seq: number;
  readonly review: TaskDeliveryReview | undefined;
}

export interface InitiativeTask {
  readonly taskId: TaskId;
  readonly milestoneId: MilestoneId;
  readonly title: string;
  readonly description: string;
  readonly effortMinutes: number;
  readonly dueAt: Instant;
  readonly dependsOn: readonly TaskId[];
  readonly status: TaskStatus;
  readonly offeredTo: MemberId;
  readonly currentOfferId: EventId;
  /** Sólo existe después de TaskAccepted. Una oferta todavía no es una asignación. */
  readonly assigneeId: MemberId | undefined;
  readonly offers: readonly TaskOfferRecord[];
  readonly responses: readonly TaskResponseRecord[];
  readonly starts: readonly TaskStartRecord[];
  readonly startedAt: Instant | undefined;
  readonly pauses: readonly TaskPauseRecord[];
  readonly currentPause: TaskPauseRecord | undefined;
  readonly helpRequests: readonly TaskHelpRequestRecord[];
  readonly evidence: readonly TaskEvidenceRecord[];
  readonly deliveries: readonly TaskDeliveryRecord[];
  readonly currentDeliveryId: EventId | undefined;
  readonly completedAt: Instant | undefined;
  readonly createdAt: Instant;
  readonly lastSeq: number;
}

export interface InitiativeState {
  readonly initiativeId: InitiativeId;
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly proposalVersionHash: Hash;
  readonly decisionResultHash: Hash;
  readonly circleId: CircleId;
  readonly executionPlan: ExecutionPlan;
  readonly status: InitiativeStatus;
  readonly createdAt: Instant;
  readonly activatedAt: Instant | undefined;
  readonly ratificationEventId: EventId | undefined;
  readonly ratificationEventHash: Hash | undefined;
  readonly milestones: readonly InitiativeMilestone[];
  readonly tasks: readonly InitiativeTask[];
  /** Índice de replay para impedir que cualquier tipo de evento reutilice un eventId anterior. */
  readonly eventIds: readonly EventId[];
  readonly lastSeq: number;
}

function requireActive(state: InitiativeState): void {
  if (state.activatedAt === undefined) {
    throw new PreconditionError(
      'INITIATIVE_NOT_ACTIVE',
      'una iniciativa provisional no admite hitos ni tareas antes de la ratificación',
    );
  }
}

function assertResponsibleActor(state: InitiativeState, event: InitiativeEvent): void {
  if (event.actor !== state.executionPlan.responsibleId) {
    throw new PreconditionError(
      'INITIATIVE_RESPONSIBLE_ONLY',
      'sólo quien asumió el plan inicial puede descomponerlo, ofrecer trabajo o revisar entregas',
    );
  }
}

function requireTask(state: InitiativeState, id: TaskId): InitiativeTask {
  const task = state.tasks.find((candidate) => candidate.taskId === id);
  if (task === undefined) {
    throw new PreconditionError('UNKNOWN_TASK', 'la tarea no existe en esta iniciativa');
  }
  return task;
}

function privateMaterialReaders(
  responsibleId: MemberId,
  materialOwner: MemberId | undefined,
): readonly MemberId[] {
  return materialOwner === undefined || materialOwner === responsibleId
    ? [responsibleId]
    : [materialOwner, responsibleId];
}

function authorizePrivateTaskMaterialRead(
  state: InitiativeState,
  actor: Actor,
  materialOwner: MemberId | undefined,
): void {
  authorize(actor, 'task:read-private-material', {
    kind: 'task',
    authorizedReaders: privateMaterialReaders(state.executionPlan.responsibleId, materialOwner),
    circleId: state.circleId,
  });
}

/**
 * Autoriza abrir el objeto privado comprometido por una evidencia. Buscar antes de autorizar no
 * publica su existencia: si no aparece, sólo el responsable inicial queda como lector candidato;
 * cualquier tercero recibe el mismo rechazo que ante una evidencia real ajena.
 */
export function authorizeTaskEvidenceRead(
  state: InitiativeState,
  actor: Actor,
  taskId: TaskId,
  evidenceId: EventId,
): TaskEvidenceRecord {
  const task = state.tasks.find((candidate) => candidate.taskId === taskId);
  const evidence = task?.evidence.find((candidate) => candidate.evidenceId === evidenceId);
  authorizePrivateTaskMaterialRead(state, actor, evidence?.addedBy);
  if (task === undefined) {
    throw new PreconditionError('UNKNOWN_TASK', 'la tarea no existe en esta iniciativa');
  }
  if (evidence === undefined) {
    throw new PreconditionError(
      'UNKNOWN_TASK_EVIDENCE',
      'la evidencia solicitada no pertenece a esa tarea',
    );
  }
  return evidence;
}

/** Misma frontera para abrir el resumen privado de una entrega histórica. */
export function authorizeTaskDeliveryRead(
  state: InitiativeState,
  actor: Actor,
  taskId: TaskId,
  deliveryId: EventId,
): TaskDeliveryRecord {
  const task = state.tasks.find((candidate) => candidate.taskId === taskId);
  const delivery = task?.deliveries.find((candidate) => candidate.deliveryId === deliveryId);
  authorizePrivateTaskMaterialRead(state, actor, delivery?.deliveredBy);
  if (task === undefined) {
    throw new PreconditionError('UNKNOWN_TASK', 'la tarea no existe en esta iniciativa');
  }
  if (delivery === undefined) {
    throw new PreconditionError(
      'UNKNOWN_TASK_DELIVERY',
      'la entrega solicitada no pertenece a esa tarea',
    );
  }
  return delivery;
}

function replaceTask(state: InitiativeState, next: InitiativeTask): readonly InitiativeTask[] {
  return state.tasks.map((task) => (task.taskId === next.taskId ? next : task));
}

function assertCurrentOffer(task: InitiativeTask, offerId: EventId): void {
  if (task.currentOfferId !== offerId) {
    throw new PreconditionError(
      'STALE_TASK_OFFER',
      'la respuesta o reoferta apunta a una oferta que ya no es la vigente',
    );
  }
}

function assertTaskRevision(task: InitiativeTask, expectedTaskSeq: number): void {
  if (!Number.isSafeInteger(expectedTaskSeq) || expectedTaskSeq < 1) {
    throw new PreconditionError(
      'STALE_TASK_REVISION',
      'la revisión esperada de la tarea debe ser un entero positivo',
    );
  }
  if (task.lastSeq !== expectedTaskSeq) {
    throw new PreconditionError(
      'STALE_TASK_REVISION',
      'la tarea cambió después de que se mostró esta respuesta; hay que leer su estado vigente',
    );
  }
}

function assertTaskActor(task: InitiativeTask, event: InitiativeEvent): MemberId {
  const expected = task.status === 'ofrecida' ? task.offeredTo : task.assigneeId;
  if (expected === undefined || event.actor !== expected) {
    throw new PreconditionError(
      'TASK_ACTOR_MISMATCH',
      'nadie acepta, rechaza ni pide reasignación en nombre de otra persona',
    );
  }
  return expected;
}

function assertAssigneeActor(task: InitiativeTask, event: InitiativeEvent): MemberId {
  if (task.assigneeId === undefined || event.actor !== task.assigneeId) {
    throw new PreconditionError(
      'TASK_ACTOR_MISMATCH',
      'sólo quien aceptó la oferta vigente puede mover el trabajo de la tarea',
    );
  }
  return task.assigneeId;
}

function assertCurrentDelivery(task: InitiativeTask, deliveryId: EventId): TaskDeliveryRecord {
  toEventId(deliveryId);
  if (task.currentDeliveryId !== deliveryId) {
    throw new PreconditionError(
      'STALE_TASK_DELIVERY',
      'la revisión apunta a una entrega que ya no es la vigente',
    );
  }
  const delivery = task.deliveries.find((candidate) => candidate.deliveryId === deliveryId);
  if (delivery === undefined || delivery.review !== undefined) {
    throw new PreconditionError(
      'STALE_TASK_DELIVERY',
      'la entrega vigente debe existir y no haber recibido otra revisión',
    );
  }
  return delivery;
}

function validateOptionalPrivateCommitment(value: PrivateMaterialCommitment | undefined): void {
  if (value !== undefined) toPrivateMaterialCommitment(value);
}

function validateClosedValue(
  value: string,
  accepted: readonly string[],
  code: string,
  detail: string,
): void {
  if (!accepted.includes(value)) throw new PreconditionError(code, detail);
}

function validateTaskResponseReason(value: string): asserts value is TaskResponseReason {
  if (!(TASK_RESPONSE_REASONS as readonly string[]).includes(value)) {
    throw new PreconditionError(
      'INVALID_TASK_RESPONSE_REASON',
      'el motivo debe pertenecer al vocabulario público y no sensible de respuestas',
    );
  }
}

function closeCurrentPause(
  task: InitiativeTask,
  event: InitiativeEvent,
  endedBy: 'resumed' | 'reassignment',
): readonly TaskPauseRecord[] {
  const current = task.currentPause;
  if (current === undefined) return task.pauses;
  if (event.occurredAt < current.startedAt) {
    throw new PreconditionError(
      'TASK_PAUSE_TIME_REVERSED',
      'una pausa no puede terminar antes de haber comenzado',
    );
  }
  return task.pauses.map((pause) =>
    pause.pauseId === current.pauseId
      ? {
          ...pause,
          endedAt: event.occurredAt,
          endedSeq: event.seq,
          endedBy,
        }
      : pause,
  );
}

function replaceDelivery(
  task: InitiativeTask,
  next: TaskDeliveryRecord,
): readonly TaskDeliveryRecord[] {
  return task.deliveries.map((delivery) =>
    delivery.deliveryId === next.deliveryId ? next : delivery,
  );
}

function assertAcyclic(tasks: readonly InitiativeTask[]): void {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const visiting = new Set<TaskId>();
  const visited = new Set<TaskId>();

  const visit = (id: TaskId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new PreconditionError(
        'TASK_DEPENDENCY_CYCLE',
        'las dependencias de tareas no pueden formar ciclos',
      );
    }
    visiting.add(id);
    const task = byId.get(id);
    if (task !== undefined) {
      for (const dependency of task.dependsOn) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const task of tasks) visit(task.taskId);
}

function applyCreated(
  event: InitiativeEvent & { readonly payload: InitiativeCreated },
): InitiativeState {
  toEventId(event.eventId);
  if (event.seq !== 1) {
    throw new PreconditionError(
      'INITIATIVE_GENESIS_REQUIRED',
      'InitiativeCreated debe ser el genesis',
    );
  }
  if (event.actor !== 'system') {
    throw new PreconditionError(
      'INITIATIVE_SYSTEM_ONLY',
      'la iniciativa nace atomicamente del resultado y solo el sistema puede crearla',
    );
  }
  // La fecha se validó contra la versión cuando se acordó el plan. Si el cierre llega tarde, la
  // iniciativa debe nacer vencida y visible; bloquearla haría imposible cerrar la decisión.
  validateExecutionPlanStructure(event.payload.executionPlan);
  return {
    initiativeId: toInitiativeId(event.aggregateId),
    decisionId: event.payload.decisionId,
    proposalId: event.payload.proposalId,
    proposalVersionHash: event.payload.proposalVersionHash,
    decisionResultHash: event.payload.decisionResultHash,
    circleId: event.payload.circleId,
    executionPlan: event.payload.executionPlan,
    // Compatibilidad ADR-0043: el estado visible nunca cambia; `activatedAt` es la capacidad de
    // ejecutar y distingue un log histórico/provisional de uno ratificado.
    status: 'por-empezar',
    createdAt: event.occurredAt,
    activatedAt: undefined,
    ratificationEventId: undefined,
    ratificationEventHash: undefined,
    milestones: [],
    tasks: [],
    eventIds: [event.eventId],
    lastSeq: event.seq,
  };
}

function applyInitiativeInternal(
  state: InitiativeState | undefined,
  event: InitiativeEvent,
  trackEventId: boolean,
): InitiativeState {
  assertExactInitiativePayload(event.payload);
  if (state === undefined) {
    if (event.payload.type !== 'InitiativeCreated') {
      throw new PreconditionError(
        'INITIATIVE_GENESIS_REQUIRED',
        'el primer evento de una iniciativa debe ser InitiativeCreated',
      );
    }
    return applyCreated(event as InitiativeEvent & { readonly payload: InitiativeCreated });
  }

  if (event.aggregateId !== state.initiativeId) {
    throw new PreconditionError('WRONG_AGGREGATE', 'el evento pertenece a otra iniciativa');
  }
  toEventId(event.eventId);
  if (trackEventId && state.eventIds.includes(event.eventId)) {
    throw new PreconditionError(
      'DUPLICATE_INITIATIVE_EVENT_ID',
      'un eventId sólo puede aparecer una vez en todo el historial de la iniciativa',
    );
  }
  if (event.seq !== state.lastSeq + 1) {
    throw new PreconditionError(
      'NON_CONSECUTIVE_INITIATIVE_EVENT',
      'los eventos de iniciativa deben tener secuencia densa y consecutiva',
    );
  }

  const base: InitiativeState = {
    ...state,
    eventIds: trackEventId ? [...state.eventIds, event.eventId] : state.eventIds,
    lastSeq: event.seq,
  };
  const payload = event.payload;
  switch (payload.type) {
    case 'InitiativeCreated':
      throw new PreconditionError(
        'INITIATIVE_ALREADY_CREATED',
        'una decision aprobada crea exactamente una iniciativa',
      );

    case 'InitiativeActivated': {
      if (event.actor !== 'system') {
        throw new PreconditionError(
          'INITIATIVE_SYSTEM_ONLY',
          'la activación deriva de la ratificación y sólo la emite el sistema',
        );
      }
      if (state.activatedAt !== undefined) {
        throw new PreconditionError(
          'INITIATIVE_ALREADY_ACTIVATED',
          'una iniciativa sólo se activa una vez',
        );
      }
      if (event.occurredAt < state.createdAt) {
        throw new PreconditionError(
          'ACTIVATION_BEFORE_CREATION',
          'la activación no puede ocurrir antes del nacimiento provisional',
        );
      }
      toEventId(payload.ratificationEventId);
      toHash(payload.ratificationEventHash);
      return {
        ...base,
        status: 'por-empezar',
        activatedAt: event.occurredAt,
        ratificationEventId: payload.ratificationEventId,
        ratificationEventHash: payload.ratificationEventHash,
      };
    }

    case 'MilestonePlanned': {
      requireActive(state);
      assertResponsibleActor(state, event);
      toMilestoneId(payload.milestoneId);
      toInstant(payload.dueAt);
      if (state.milestones.some((milestone) => milestone.milestoneId === payload.milestoneId)) {
        throw new PreconditionError('DUPLICATE_MILESTONE', 'ese hito ya existe');
      }
      assertLedgerText(payload.title, {
        field: 'el título del hito',
        min: MIN_EXECUTION_TITLE_LENGTH,
        max: MAX_TITLE_LENGTH,
      });
      assertLedgerText(payload.completionCriterion, {
        field: 'el criterio observable del hito',
        min: MIN_MILESTONE_CRITERION_LENGTH,
        max: MAX_MILESTONE_CRITERION_LENGTH,
      });
      if (payload.dueAt > state.executionPlan.reviewAt) {
        throw new PreconditionError(
          'MILESTONE_AFTER_REVIEW',
          'la fecha del hito no puede superar la revisión congelada de la iniciativa',
        );
      }
      return {
        ...base,
        milestones: [
          ...state.milestones,
          {
            milestoneId: payload.milestoneId,
            title: payload.title,
            completionCriterion: payload.completionCriterion,
            dueAt: payload.dueAt,
            plannedAt: event.occurredAt,
            seq: event.seq,
          },
        ],
      };
    }

    case 'TaskOffered': {
      requireActive(state);
      assertResponsibleActor(state, event);
      toTaskId(payload.taskId);
      toMilestoneId(payload.milestoneId);
      toMemberId(payload.offeredTo);
      toInstant(payload.dueAt);
      if (state.tasks.some((task) => task.taskId === payload.taskId)) {
        throw new PreconditionError('DUPLICATE_TASK', 'esa tarea ya existe');
      }
      const milestone = state.milestones.find(
        (candidate) => candidate.milestoneId === payload.milestoneId,
      );
      if (milestone === undefined) {
        throw new PreconditionError('UNKNOWN_MILESTONE', 'la tarea exige un hito existente');
      }
      assertLedgerText(payload.title, {
        field: 'el título de la tarea',
        min: MIN_EXECUTION_TITLE_LENGTH,
        max: MAX_TITLE_LENGTH,
      });
      assertLedgerText(payload.description, {
        field: 'la descripción de la tarea',
        min: MIN_TASK_DESCRIPTION_LENGTH,
        max: MAX_BODY_LENGTH,
      });
      if (
        !Number.isSafeInteger(payload.effortMinutes) ||
        payload.effortMinutes < 1 ||
        payload.effortMinutes > MAX_TASK_EFFORT_MINUTES
      ) {
        throw new PreconditionError(
          'TASK_EFFORT_INVALID',
          `el esfuerzo debe ser un entero entre 1 y ${String(MAX_TASK_EFFORT_MINUTES)} minutos`,
        );
      }
      if (payload.dueAt > milestone.dueAt) {
        throw new PreconditionError(
          'TASK_DUE_AFTER_MILESTONE',
          'la fecha de la tarea no puede superar la fecha de su hito',
        );
      }
      if (new Set(payload.dependsOn).size !== payload.dependsOn.length) {
        throw new PreconditionError(
          'TASK_DEPENDENCY_DUPLICATE',
          'una dependencia sólo se declara una vez',
        );
      }
      if (payload.dependsOn.length > MAX_TASK_DEPENDENCIES) {
        throw new PreconditionError(
          'TOO_MANY_TASK_DEPENDENCIES',
          `una tarea admite como máximo ${String(MAX_TASK_DEPENDENCIES)} dependencias`,
        );
      }
      if (payload.dependsOn.includes(payload.taskId)) {
        throw new PreconditionError(
          'TASK_SELF_DEPENDENCY',
          'una tarea no puede depender de sí misma',
        );
      }
      for (const dependency of payload.dependsOn) {
        toTaskId(dependency);
        if (!state.tasks.some((task) => task.taskId === dependency)) {
          throw new PreconditionError(
            'UNKNOWN_TASK_DEPENDENCY',
            'toda dependencia debe existir antes de ofrecer la tarea',
          );
        }
      }
      const offer: TaskOfferRecord = {
        offerId: event.eventId,
        offeredTo: payload.offeredTo,
        offeredAt: event.occurredAt,
        seq: event.seq,
      };
      const task: InitiativeTask = {
        taskId: payload.taskId,
        milestoneId: payload.milestoneId,
        title: payload.title,
        description: payload.description,
        effortMinutes: payload.effortMinutes,
        dueAt: payload.dueAt,
        dependsOn: [...payload.dependsOn],
        status: 'ofrecida',
        offeredTo: payload.offeredTo,
        currentOfferId: event.eventId,
        assigneeId: undefined,
        offers: [offer],
        responses: [],
        starts: [],
        startedAt: undefined,
        pauses: [],
        currentPause: undefined,
        helpRequests: [],
        evidence: [],
        deliveries: [],
        currentDeliveryId: undefined,
        completedAt: undefined,
        createdAt: event.occurredAt,
        lastSeq: event.seq,
      };
      const tasks = [...state.tasks, task];
      assertAcyclic(tasks);
      return { ...base, tasks };
    }

    case 'TaskAccepted': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'ofrecida') {
        throw new PreconditionError(
          'TASK_OFFER_ALREADY_ANSWERED',
          'esa oferta ya recibió una respuesta y no se vuelve a responder',
        );
      }
      const actor = assertTaskActor(task, event);
      const next: InitiativeTask = {
        ...task,
        status: 'aceptada',
        assigneeId: actor,
        startedAt: undefined,
        currentPause: undefined,
        currentDeliveryId: undefined,
        completedAt: undefined,
        responses: [
          ...task.responses,
          {
            type: 'accepted',
            offerId: payload.offerId,
            by: actor,
            at: event.occurredAt,
            seq: event.seq,
          },
        ],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskRejected': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'ofrecida') {
        throw new PreconditionError(
          'TASK_OFFER_ALREADY_ANSWERED',
          'esa oferta ya recibió una respuesta y no se vuelve a responder',
        );
      }
      validateTaskResponseReason(payload.reason);
      const actor = assertTaskActor(task, event);
      const next: InitiativeTask = {
        ...task,
        status: 'rechazada',
        assigneeId: undefined,
        responses: [
          ...task.responses,
          {
            type: 'rejected',
            offerId: payload.offerId,
            by: actor,
            reason: payload.reason,
            at: event.occurredAt,
            seq: event.seq,
          },
        ],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskReassignmentRequested': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (
        task.status !== 'ofrecida' &&
        task.status !== 'aceptada' &&
        task.status !== 'en-curso' &&
        task.status !== 'bloqueada' &&
        task.status !== 'en-apoyo'
      ) {
        throw new PreconditionError(
          'TASK_REASSIGNMENT_NOT_ALLOWED',
          'sólo una oferta pendiente o una tarea con compromiso vigente puede pedir reasignación',
        );
      }
      validateTaskResponseReason(payload.reason);
      const actor = assertTaskActor(task, event);
      const next: InitiativeTask = {
        ...task,
        status: 'reasignacion-solicitada',
        // Pedir reemplazo revoca el compromiso en ese mismo hecho: no se presenta como responsable
        // a quien acaba de declarar que no puede continuar.
        assigneeId: undefined,
        startedAt: undefined,
        pauses: closeCurrentPause(task, event, 'reassignment'),
        currentPause: undefined,
        currentDeliveryId: undefined,
        responses: [
          ...task.responses,
          {
            type: 'reassignment-requested',
            offerId: payload.offerId,
            by: actor,
            reason: payload.reason,
            at: event.occurredAt,
            seq: event.seq,
          },
        ],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskStarted': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'aceptada') {
        throw new PreconditionError(
          'TASK_START_NOT_ALLOWED',
          'sólo una tarea aceptada y todavía no iniciada puede comenzar',
        );
      }
      const actor = assertAssigneeActor(task, event);
      for (const dependencyId of task.dependsOn) {
        const dependency = requireTask(state, dependencyId);
        if (dependency.status !== 'completada') {
          throw new PreconditionError(
            'TASK_DEPENDENCY_NOT_COMPLETED',
            'todas las dependencias deben estar completadas antes de iniciar la tarea',
          );
        }
      }
      const next: InitiativeTask = {
        ...task,
        status: 'en-curso',
        startedAt: event.occurredAt,
        starts: [
          ...task.starts,
          {
            offerId: payload.offerId,
            by: actor,
            at: event.occurredAt,
            seq: event.seq,
          },
        ],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskBlocked': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'en-curso' || task.currentPause !== undefined) {
        throw new PreconditionError(
          'TASK_BLOCK_NOT_ALLOWED',
          'sólo una tarea en curso y sin otra pausa vigente puede bloquearse',
        );
      }
      validateClosedValue(
        payload.category,
        TASK_BLOCK_CATEGORIES,
        'INVALID_TASK_BLOCK_CATEGORY',
        'la categoría pública del bloqueo no pertenece al vocabulario cerrado',
      );
      validateOptionalPrivateCommitment(payload.privateDetailCommitment);
      assertAssigneeActor(task, event);
      const pause: TaskPauseRecord = {
        pauseId: event.eventId,
        kind: 'blocked',
        category: payload.category,
        privateDetailCommitment: payload.privateDetailCommitment,
        startedAt: event.occurredAt,
        startedSeq: event.seq,
        endedAt: undefined,
        endedSeq: undefined,
        endedBy: undefined,
      };
      const next: InitiativeTask = {
        ...task,
        status: 'bloqueada',
        pauses: [...task.pauses, pause],
        currentPause: pause,
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskHelpRequested': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'en-curso' && task.status !== 'bloqueada') {
        throw new PreconditionError(
          'TASK_HELP_NOT_ALLOWED',
          'la ayuda sólo se pide desde una tarea en curso o bloqueada',
        );
      }
      validateClosedValue(
        payload.category,
        TASK_HELP_CATEGORIES,
        'INVALID_TASK_HELP_CATEGORY',
        'la categoría pública de ayuda no pertenece al vocabulario cerrado',
      );
      validateOptionalPrivateCommitment(payload.privateDetailCommitment);
      assertAssigneeActor(task, event);

      const pause: TaskPauseRecord = task.currentPause ?? {
        pauseId: event.eventId,
        kind: 'support',
        category: payload.category,
        privateDetailCommitment: payload.privateDetailCommitment,
        startedAt: event.occurredAt,
        startedSeq: event.seq,
        endedAt: undefined,
        endedSeq: undefined,
        endedBy: undefined,
      };
      const help: TaskHelpRequestRecord = {
        helpRequestId: event.eventId,
        pauseId: pause.pauseId,
        category: payload.category,
        privateDetailCommitment: payload.privateDetailCommitment,
        requestedAt: event.occurredAt,
        seq: event.seq,
      };
      const next: InitiativeTask = {
        ...task,
        status: 'en-apoyo',
        pauses: task.currentPause === undefined ? [...task.pauses, pause] : task.pauses,
        currentPause: pause,
        helpRequests: [...task.helpRequests, help],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskResumed': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'bloqueada' && task.status !== 'en-apoyo') {
        throw new PreconditionError(
          'TASK_RESUME_NOT_ALLOWED',
          'sólo una tarea bloqueada o en apoyo puede reanudarse',
        );
      }
      toEventId(payload.pauseId);
      if (task.currentPause === undefined || task.currentPause.pauseId !== payload.pauseId) {
        throw new PreconditionError(
          'STALE_TASK_PAUSE',
          'la reanudación apunta a una pausa que ya no es la vigente',
        );
      }
      assertAssigneeActor(task, event);
      const next: InitiativeTask = {
        ...task,
        status: 'en-curso',
        pauses: closeCurrentPause(task, event, 'resumed'),
        currentPause: undefined,
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskEvidenceAdded': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'en-curso' && task.status !== 'bloqueada' && task.status !== 'en-apoyo') {
        throw new PreconditionError(
          'TASK_EVIDENCE_NOT_ALLOWED',
          'la evidencia sólo se agrega mientras el trabajo está activo',
        );
      }
      toPrivateMaterialCommitment(payload.objectCommitment);
      validateClosedValue(
        payload.kindCode,
        TASK_EVIDENCE_KIND_CODES,
        'INVALID_TASK_EVIDENCE_KIND_CODE',
        'la clase pública del material no pertenece al vocabulario cerrado',
      );
      validateClosedValue(
        payload.sizeClass,
        TASK_EVIDENCE_SIZE_CLASSES,
        'INVALID_TASK_EVIDENCE_SIZE_CLASS',
        'la clase pública de tamaño no pertenece al vocabulario cerrado',
      );
      validateClosedValue(
        payload.visibility,
        TASK_EVIDENCE_VISIBILITIES,
        'INVALID_TASK_EVIDENCE_VISIBILITY',
        'la visibilidad de evidencia debe ser public o restricted',
      );
      if (
        state.tasks.some((candidate) =>
          candidate.evidence.some((record) => record.evidenceId === event.eventId),
        )
      ) {
        throw new PreconditionError(
          'TASK_EVIDENCE_ID_REUSED',
          'cada evidencia exige un eventId nuevo',
        );
      }
      const actor = assertAssigneeActor(task, event);
      const evidence: TaskEvidenceRecord = {
        evidenceId: event.eventId,
        offerId: payload.offerId,
        objectCommitment: payload.objectCommitment,
        kindCode: payload.kindCode,
        sizeClass: payload.sizeClass,
        visibility: payload.visibility,
        addedBy: actor,
        addedAt: event.occurredAt,
        seq: event.seq,
      };
      const next: InitiativeTask = {
        ...task,
        evidence: [...task.evidence, evidence],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskDelivered': {
      requireActive(state);
      const task = requireTask(state, payload.taskId);
      assertCurrentOffer(task, payload.offerId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'en-curso' || task.currentPause !== undefined) {
        throw new PreconditionError(
          'TASK_DELIVERY_NOT_ALLOWED',
          'la tarea debe estar en curso y sin pausa antes de entregarse',
        );
      }
      if (
        payload.evidenceIds.length < 1 ||
        payload.evidenceIds.length > MAX_TASK_EVIDENCE_PER_DELIVERY
      ) {
        throw new PreconditionError(
          'TASK_DELIVERY_EVIDENCE_COUNT_INVALID',
          `una entrega exige entre 1 y ${String(MAX_TASK_EVIDENCE_PER_DELIVERY)} evidencias`,
        );
      }
      if (new Set(payload.evidenceIds).size !== payload.evidenceIds.length) {
        throw new PreconditionError(
          'TASK_DELIVERY_EVIDENCE_DUPLICATE',
          'una entrega sólo referencia cada evidencia una vez',
        );
      }
      for (const evidenceId of payload.evidenceIds) {
        toEventId(evidenceId);
        if (!task.evidence.some((record) => record.evidenceId === evidenceId)) {
          throw new PreconditionError(
            'UNKNOWN_TASK_EVIDENCE',
            'toda evidencia de la entrega debe pertenecer a esa tarea',
          );
        }
      }
      toPrivateMaterialCommitment(payload.summaryCommitment);
      if (
        state.tasks.some((candidate) =>
          candidate.deliveries.some((delivery) => delivery.deliveryId === event.eventId),
        )
      ) {
        throw new PreconditionError(
          'TASK_DELIVERY_ID_REUSED',
          'cada entrega exige un eventId nuevo',
        );
      }
      const actor = assertAssigneeActor(task, event);
      const delivery: TaskDeliveryRecord = {
        deliveryId: event.eventId,
        offerId: payload.offerId,
        evidenceIds: [...payload.evidenceIds],
        summaryCommitment: payload.summaryCommitment,
        deliveredBy: actor,
        deliveredAt: event.occurredAt,
        seq: event.seq,
        review: undefined,
      };
      const next: InitiativeTask = {
        ...task,
        status: 'entregada',
        deliveries: [...task.deliveries, delivery],
        currentDeliveryId: delivery.deliveryId,
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskChangesRequested': {
      requireActive(state);
      assertResponsibleActor(state, event);
      const task = requireTask(state, payload.taskId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'entregada') {
        throw new PreconditionError(
          'TASK_REVIEW_NOT_ALLOWED',
          'sólo una entrega pendiente puede recibir revisión',
        );
      }
      const delivery = assertCurrentDelivery(task, payload.deliveryId);
      validateClosedValue(
        payload.reason,
        TASK_CHANGE_REASONS,
        'INVALID_TASK_CHANGE_REASON',
        'el motivo público de reapertura no pertenece al vocabulario cerrado',
      );
      validateOptionalPrivateCommitment(payload.privateDetailCommitment);
      const reviewed: TaskDeliveryRecord = {
        ...delivery,
        review: {
          type: 'changes-requested',
          by: state.executionPlan.responsibleId,
          reason: payload.reason,
          privateDetailCommitment: payload.privateDetailCommitment,
          at: event.occurredAt,
          seq: event.seq,
        },
      };
      const next: InitiativeTask = {
        ...task,
        status: 'en-curso',
        deliveries: replaceDelivery(task, reviewed),
        currentDeliveryId: undefined,
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskReviewAccepted': {
      requireActive(state);
      assertResponsibleActor(state, event);
      const task = requireTask(state, payload.taskId);
      assertTaskRevision(task, payload.expectedTaskSeq);
      if (task.status !== 'entregada') {
        throw new PreconditionError(
          'TASK_REVIEW_NOT_ALLOWED',
          'sólo una entrega pendiente puede aceptarse como completada',
        );
      }
      const delivery = assertCurrentDelivery(task, payload.deliveryId);
      validateClosedValue(
        payload.outcomeCriterionEvidence,
        OUTCOME_CRITERION_EVIDENCE,
        'INVALID_OUTCOME_CRITERION_EVIDENCE',
        'la evaluación de evidencia del criterio no pertenece al vocabulario cerrado',
      );
      const reviewed: TaskDeliveryRecord = {
        ...delivery,
        review: {
          type: 'accepted',
          by: state.executionPlan.responsibleId,
          outcomeCriterionEvidence: payload.outcomeCriterionEvidence,
          at: event.occurredAt,
          seq: event.seq,
        },
      };
      const next: InitiativeTask = {
        ...task,
        status: 'completada',
        deliveries: replaceDelivery(task, reviewed),
        currentDeliveryId: undefined,
        completedAt: event.occurredAt,
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }

    case 'TaskReoffered': {
      requireActive(state);
      assertResponsibleActor(state, event);
      const task = requireTask(state, payload.taskId);
      // Se comprueba antes del estado para que dos reofertas concurrentes sobre la misma respuesta
      // tengan un único ganador y la segunda falle inequívocamente como stale.
      assertCurrentOffer(task, payload.previousOfferId);
      if (task.status !== 'rechazada' && task.status !== 'reasignacion-solicitada') {
        throw new PreconditionError(
          'TASK_REOFFER_NOT_ALLOWED',
          'sólo una tarea rechazada o con reasignación solicitada puede volver a ofrecerse',
        );
      }
      toMemberId(payload.offeredTo);
      if (payload.offeredTo === task.offeredTo) {
        throw new PreconditionError(
          'TASK_REOFFER_SAME_RECIPIENT',
          'la nueva oferta debe dirigirse a otra persona',
        );
      }
      if (
        state.tasks.some((candidate) =>
          candidate.offers.some((offer) => offer.offerId === event.eventId),
        )
      ) {
        throw new PreconditionError('TASK_OFFER_ID_REUSED', 'cada oferta exige un eventId nuevo');
      }
      const offer: TaskOfferRecord = {
        offerId: event.eventId,
        offeredTo: payload.offeredTo,
        offeredAt: event.occurredAt,
        seq: event.seq,
      };
      const next: InitiativeTask = {
        ...task,
        status: 'ofrecida',
        offeredTo: payload.offeredTo,
        currentOfferId: event.eventId,
        assigneeId: undefined,
        startedAt: undefined,
        currentPause: undefined,
        currentDeliveryId: undefined,
        completedAt: undefined,
        offers: [...task.offers, offer],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }
  }
}

/** Aplica un único evento sobre una proyección y conserva el índice necesario para detectar ABA. */
export function applyInitiative(
  state: InitiativeState | undefined,
  event: InitiativeEvent,
): InitiativeState {
  return applyInitiativeInternal(state, event, true);
}

export function replayInitiative(log: InitiativeLog): InitiativeState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacio no identifica ninguna iniciativa');
  }
  const seen = new Set<EventId>();
  const eventIds: EventId[] = [];
  for (const event of log) {
    toEventId(event.eventId);
    if (seen.has(event.eventId)) {
      throw new PreconditionError(
        'DUPLICATE_INITIATIVE_EVENT_ID',
        'un eventId sólo puede aparecer una vez en todo el historial de la iniciativa',
      );
    }
    seen.add(event.eventId);
    eventIds.push(event.eventId);
  }
  let state: InitiativeState | undefined;
  for (const event of log) state = applyInitiativeInternal(state, event, false);
  // El primer evento no vacío sólo puede ser InitiativeCreated, por lo que `state` ya existe.
  if (state === undefined) throw new PreconditionError('EMPTY_LOG', 'un log vacio');
  return { ...state, eventIds };
}

export async function verifyInitiativeLog(log: InitiativeLog): Promise<InitiativeState> {
  // Valida primero la forma runtime para no ejecutar getters ni canonicalizar campos prohibidos.
  const state = replayInitiative(log);
  await verifyChain(log);
  return state;
}

/** Estado vigente del agregado; mantiene un nombre simetrico con currentVersion. */
export function currentInitiative(log: InitiativeLog): InitiativeState {
  return replayInitiative(log);
}

export interface InitiativeCommandMeta {
  readonly eventId: EventId;
  readonly at: Instant;
  readonly actor: MemberId | 'system';
}

export interface InitiativeByCommandMeta {
  readonly eventId: EventId;
  readonly at: Instant;
  readonly by: Actor;
}

export interface CreateInitiativeInput {
  readonly initiativeId: InitiativeId;
  readonly outcomeKind: OutcomeKind;
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly proposalVersionHash: Hash;
  readonly decisionResultHash: Hash;
  readonly circleId: CircleId;
  readonly executionPlan: ExecutionPlan;
}

async function emitInitiative(
  log: InitiativeLog,
  state: InitiativeState,
  input: {
    readonly eventId: EventId;
    readonly at: Instant;
    readonly actor: MemberId | 'system';
    readonly payload: InitiativePayload;
  },
): Promise<InitiativeLog> {
  toEventId(input.eventId);
  if (state.eventIds.includes(input.eventId)) {
    throw new PreconditionError(
      'DUPLICATE_INITIATIVE_EVENT_ID',
      'un eventId sólo puede aparecer una vez en todo el historial de la iniciativa',
    );
  }
  // Valida el hecho crudo antes de canonicalizarlo. En particular, un número fraccionario debe
  // fallar con la regla semántica de esfuerzo y no antes con un error del serializador.
  const prospective: InitiativeEvent = {
    eventId: input.eventId,
    aggregateId: state.initiativeId,
    seq: state.lastSeq + 1,
    occurredAt: input.at,
    actor: input.actor,
    payload: input.payload,
    prevHash: log.at(-1)?.hash ?? ZERO_HASH,
    hash: ZERO_HASH,
  };
  applyInitiative(state, prospective);
  const event = await appendChained<InitiativePayload>(log, {
    eventId: input.eventId,
    aggregateId: state.initiativeId,
    occurredAt: input.at,
    actor: input.actor,
    payload: input.payload,
  });
  return [...log, event];
}

function authorizedMember(meta: InitiativeByCommandMeta): MemberId {
  const actor = meta.by.memberId;
  if (actor === undefined) {
    throw new PreconditionError('NOT_AUTHENTICATED', 'este acto exige identidad verificada');
  }
  return actor;
}

interface PreparedTaskAcceptance {
  readonly state: InitiativeState;
  readonly candidate: TaskAcceptanceCandidate;
}

function prepareTaskAcceptance(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskAccepted, 'type'>,
): PreparedTaskAcceptance {
  const state = replayInitiative(log);
  const task = requireTask(state, input.taskId);
  // Este orden es deliberado: ningún acceso al Vault debe convertirse en oráculo de existencia,
  // oferta, revisión, estado o identidad.
  assertCurrentOffer(task, input.offerId);
  assertTaskRevision(task, input.expectedTaskSeq);
  if (task.status !== 'ofrecida') {
    throw new PreconditionError(
      'TASK_OFFER_ALREADY_ANSWERED',
      'esa oferta ya recibió una respuesta y no se vuelve a responder',
    );
  }
  authorize(meta.by, 'task:accept', {
    kind: 'task',
    subject: task.offeredTo,
    circleId: state.circleId,
  });
  const memberId = authorizedMember(meta);
  toInstant(meta.at);
  const candidate: TaskAcceptanceCandidate = Object.freeze({
    memberId,
    taskId: task.taskId,
    offerId: task.currentOfferId,
    effortMinutes: task.effortMinutes,
    checkedAt: meta.at,
    [TASK_ACCEPTANCE_CANDIDATE]: true as const,
  });
  return { state, candidate };
}

/** Preflight público y puro; no consulta capacidad ni produce un evento. */
export function prepareTaskAcceptanceBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskAccepted, 'type'>,
): TaskAcceptanceCandidate {
  return prepareTaskAcceptance(log, meta, input).candidate;
}

function assertTaskCapacityAdmission(
  admission: TaskCapacityAdmission,
  expected: TaskAcceptanceCandidate,
): void {
  const candidate: unknown = admission;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    (candidate as Partial<TaskCapacityAdmission>)[TASK_CAPACITY_ADMISSION] !== true
  ) {
    throw new PreconditionError(
      'TASK_CAPACITY_ADMISSION_REQUIRED',
      'aceptar exige una admisión de capacidad construida dentro de la transacción privada',
    );
  }
  toMemberId(admission.memberId);
  toTaskId(admission.taskId);
  toEventId(admission.offerId);
  toInstant(admission.checkedAt);
  if (
    admission.memberId !== expected.memberId ||
    admission.taskId !== expected.taskId ||
    admission.offerId !== expected.offerId ||
    admission.effortMinutes !== expected.effortMinutes ||
    admission.checkedAt !== expected.checkedAt
  ) {
    throw new PreconditionError(
      'TASK_CAPACITY_ADMISSION_MISMATCH',
      'la admisión privada no corresponde exactamente a esta aceptación',
    );
  }
}

function authorizeOwner(
  state: InitiativeState,
  meta: InitiativeByCommandMeta,
  action: Action,
): MemberId {
  authorize(meta.by, action, {
    kind: action === 'initiative:plan' ? 'initiative' : 'task',
    owner: state.executionPlan.responsibleId,
    circleId: state.circleId,
  });
  return authorizedMember(meta);
}

function authorizeRecipient(state: InitiativeState, recipient: Actor, offeredTo: MemberId): void {
  // La misma regla que gobernará la respuesta demuestra que el destinatario es hoy miembro del
  // círculo, tiene rol político y corresponde al identificador que se pretende registrar.
  authorize(recipient, 'task:accept', {
    kind: 'task',
    subject: offeredTo,
    circleId: state.circleId,
  });
}

function authorizeTaskResponse(
  state: InitiativeState,
  meta: InitiativeByCommandMeta,
  taskId: TaskId,
  offerId: EventId,
  action: 'task:accept' | 'task:reject' | 'task:request-reassignment',
): MemberId {
  // Se resuelve primero el CAS de la oferta. De otro modo una respuesta vieja podría fallar como
  // autorización cuando el contrato observable exige STALE_TASK_OFFER de forma determinista.
  const task = requireTask(state, taskId);
  assertCurrentOffer(task, offerId);
  const subject = task.status === 'ofrecida' ? task.offeredTo : task.assigneeId;
  authorize(meta.by, action, {
    kind: 'task',
    ...(subject === undefined ? {} : { subject }),
    circleId: state.circleId,
  });
  return authorizedMember(meta);
}

function authorizeAssigneeMutation(
  state: InitiativeState,
  meta: InitiativeByCommandMeta,
  input: AssigneeTaskCas,
  action:
    | 'task:start'
    | 'task:block'
    | 'task:request-help'
    | 'task:resume'
    | 'task:add-evidence'
    | 'task:deliver',
): MemberId {
  const task = requireTask(state, input.taskId);
  assertCurrentOffer(task, input.offerId);
  assertTaskRevision(task, input.expectedTaskSeq);
  authorize(meta.by, action, {
    kind: 'task',
    ...(task.assigneeId === undefined ? {} : { subject: task.assigneeId }),
    circleId: state.circleId,
  });
  return authorizedMember(meta);
}

function authorizeTaskReview(
  state: InitiativeState,
  meta: InitiativeByCommandMeta,
  input: TaskReviewCas,
  action: 'task:request-changes' | 'task:accept-review',
): MemberId {
  const task = requireTask(state, input.taskId);
  assertTaskRevision(task, input.expectedTaskSeq);
  assertCurrentDelivery(task, input.deliveryId);
  return authorizeOwner(state, meta, action);
}

export async function createInitiative(
  meta: InitiativeCommandMeta,
  input: CreateInitiativeInput,
): Promise<InitiativeLog> {
  if (meta.actor !== 'system') {
    throw new PreconditionError(
      'INITIATIVE_SYSTEM_ONLY',
      'la iniciativa nace atomicamente del resultado y solo el sistema puede crearla',
    );
  }
  if (input.outcomeKind !== 'approved') {
    throw new PreconditionError(
      'INITIATIVE_REQUIRES_APPROVED',
      `un desenlace ${input.outcomeKind} no crea una iniciativa`,
    );
  }
  const payload: InitiativeCreated = {
    type: 'InitiativeCreated',
    decisionId: input.decisionId,
    proposalId: input.proposalId,
    proposalVersionHash: input.proposalVersionHash,
    decisionResultHash: input.decisionResultHash,
    circleId: input.circleId,
    executionPlan: input.executionPlan,
  };
  assertExactInitiativePayload(payload);
  validateExecutionPlanStructure(input.executionPlan);
  const event = await appendChained<InitiativePayload>([], {
    eventId: meta.eventId,
    aggregateId: input.initiativeId,
    occurredAt: meta.at,
    actor: meta.actor,
    payload,
  });
  applyInitiative(undefined, event);
  return [event];
}

export async function activateInitiative(
  log: InitiativeLog,
  meta: InitiativeCommandMeta,
  input: {
    readonly ratificationEventId: EventId;
    readonly ratificationEventHash: Hash;
  },
): Promise<InitiativeLog> {
  if (meta.actor !== 'system') {
    throw new PreconditionError(
      'INITIATIVE_SYSTEM_ONLY',
      'la activación deriva de la ratificación y sólo la emite el sistema',
    );
  }
  const state = replayInitiative(log);
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor: 'system',
    payload: {
      type: 'InitiativeActivated',
      ratificationEventId: input.ratificationEventId,
      ratificationEventHash: input.ratificationEventHash,
    },
  });
}

export async function planMilestoneBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<MilestonePlanned, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeOwner(state, meta, 'initiative:plan');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'MilestonePlanned',
      milestoneId: input.milestoneId,
      title: input.title,
      completionCriterion: input.completionCriterion,
      dueAt: input.dueAt,
    },
  });
}

export async function offerTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskOffered, 'type'> & { readonly recipient: Actor },
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeOwner(state, meta, 'task:offer');
  authorizeRecipient(state, input.recipient, input.offeredTo);
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskOffered',
      taskId: input.taskId,
      milestoneId: input.milestoneId,
      offeredTo: input.offeredTo,
      title: input.title,
      description: input.description,
      effortMinutes: input.effortMinutes,
      dueAt: input.dueAt,
      dependsOn: input.dependsOn,
    },
  });
}

export async function acceptTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskAccepted, 'type'>,
  admission: TaskCapacityAdmission,
): Promise<InitiativeLog> {
  // Repite el preflight al entrar al append: una admisión obtenida para una vista anterior del
  // agregado no puede autorizar silenciosamente una oferta, revisión o identidad distinta.
  const prepared = prepareTaskAcceptance(log, meta, input);
  assertTaskCapacityAdmission(admission, prepared.candidate);
  return emitInitiative(log, prepared.state, {
    eventId: meta.eventId,
    at: meta.at,
    actor: prepared.candidate.memberId,
    payload: {
      type: 'TaskAccepted',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
    },
  });
}

export async function rejectTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskRejected, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeTaskResponse(state, meta, input.taskId, input.offerId, 'task:reject');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskRejected',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
      reason: input.reason,
    },
  });
}

export async function requestTaskReassignmentBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskReassignmentRequested, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeTaskResponse(
    state,
    meta,
    input.taskId,
    input.offerId,
    'task:request-reassignment',
  );
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskReassignmentRequested',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
      reason: input.reason,
    },
  });
}

export async function startTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskStarted, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeAssigneeMutation(state, meta, input, 'task:start');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskStarted',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
    },
  });
}

export async function blockTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskBlocked, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeAssigneeMutation(state, meta, input, 'task:block');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskBlocked',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
      category: input.category,
      ...(input.privateDetailCommitment === undefined
        ? {}
        : { privateDetailCommitment: input.privateDetailCommitment }),
    },
  });
}

export async function requestTaskHelpBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskHelpRequested, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeAssigneeMutation(state, meta, input, 'task:request-help');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskHelpRequested',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
      category: input.category,
      ...(input.privateDetailCommitment === undefined
        ? {}
        : { privateDetailCommitment: input.privateDetailCommitment }),
    },
  });
}

export async function resumeTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskResumed, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeAssigneeMutation(state, meta, input, 'task:resume');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskResumed',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
      pauseId: input.pauseId,
    },
  });
}

export async function addTaskEvidenceBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskEvidenceAdded, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeAssigneeMutation(state, meta, input, 'task:add-evidence');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskEvidenceAdded',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
      objectCommitment: input.objectCommitment,
      kindCode: input.kindCode,
      sizeClass: input.sizeClass,
      visibility: input.visibility,
    },
  });
}

export async function deliverTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskDelivered, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeAssigneeMutation(state, meta, input, 'task:deliver');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskDelivered',
      taskId: input.taskId,
      offerId: input.offerId,
      expectedTaskSeq: input.expectedTaskSeq,
      evidenceIds: input.evidenceIds,
      summaryCommitment: input.summaryCommitment,
    },
  });
}

export async function requestTaskChangesBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskChangesRequested, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeTaskReview(state, meta, input, 'task:request-changes');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskChangesRequested',
      taskId: input.taskId,
      deliveryId: input.deliveryId,
      expectedTaskSeq: input.expectedTaskSeq,
      reason: input.reason,
      ...(input.privateDetailCommitment === undefined
        ? {}
        : { privateDetailCommitment: input.privateDetailCommitment }),
    },
  });
}

export async function acceptTaskReviewBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskReviewAccepted, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeTaskReview(state, meta, input, 'task:accept-review');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskReviewAccepted',
      taskId: input.taskId,
      deliveryId: input.deliveryId,
      expectedTaskSeq: input.expectedTaskSeq,
      outcomeCriterionEvidence: input.outcomeCriterionEvidence,
    },
  });
}

export async function reofferTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskReoffered, 'type'> & { readonly recipient: Actor },
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeOwner(state, meta, 'task:reoffer');
  assertCurrentOffer(requireTask(state, input.taskId), input.previousOfferId);
  authorizeRecipient(state, input.recipient, input.offeredTo);
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: {
      type: 'TaskReoffered',
      taskId: input.taskId,
      previousOfferId: input.previousOfferId,
      offeredTo: input.offeredTo,
    },
  });
}
