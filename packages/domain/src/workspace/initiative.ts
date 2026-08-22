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
import { assertLedgerText, MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from './text.js';

export const MAX_MILESTONE_CRITERION_LENGTH = 500;
export const MIN_MILESTONE_CRITERION_LENGTH = 20;
export const MIN_EXECUTION_TITLE_LENGTH = 10;
export const MIN_TASK_DESCRIPTION_LENGTH = 20;
export const MAX_TASK_EFFORT_MINUTES = 10_080;
export const MAX_TASK_DEPENDENCIES = 50;

/** Motivos publicables: nunca texto libre que pueda inmortalizar salud, trabajo u otra PII. */
export const TASK_RESPONSE_REASONS = [
  'sin-disponibilidad',
  'plazo-inviable',
  'alcance-no-claro',
  'otra-persona-mas-adecuada',
  'razon-privada',
] as const;
export type TaskResponseReason = (typeof TASK_RESPONSE_REASONS)[number];

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

export type InitiativePayload =
  | InitiativeCreated
  | InitiativeActivated
  | MilestonePlanned
  | TaskOffered
  | TaskAccepted
  | TaskRejected
  | TaskReassignmentRequested
  | TaskReoffered;
export type InitiativeEvent = ChainedEvent<InitiativePayload>;
export type InitiativeLog = ChainedLog<InitiativePayload>;
export type InitiativeStatus = 'por-empezar';
export type TaskStatus = 'ofrecida' | 'aceptada' | 'rechazada' | 'reasignacion-solicitada';

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
      'sólo quien asumió el plan inicial puede descomponerlo o volver a ofrecer sus tareas',
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
  const expected = task.status === 'aceptada' ? task.assigneeId : task.offeredTo;
  if (expected === undefined || event.actor !== expected) {
    throw new PreconditionError(
      'TASK_ACTOR_MISMATCH',
      'nadie acepta, rechaza ni pide reasignación en nombre de otra persona',
    );
  }
  return expected;
}

function validateTaskResponseReason(value: string): asserts value is TaskResponseReason {
  if (!(TASK_RESPONSE_REASONS as readonly string[]).includes(value)) {
    throw new PreconditionError(
      'INVALID_TASK_RESPONSE_REASON',
      'el motivo debe pertenecer al vocabulario público y no sensible de respuestas',
    );
  }
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
    lastSeq: event.seq,
  };
}

export function applyInitiative(
  state: InitiativeState | undefined,
  event: InitiativeEvent,
): InitiativeState {
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
  if (event.seq !== state.lastSeq + 1) {
    throw new PreconditionError(
      'NON_CONSECUTIVE_INITIATIVE_EVENT',
      'los eventos de iniciativa deben tener secuencia densa y consecutiva',
    );
  }

  const base: InitiativeState = { ...state, lastSeq: event.seq };
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
      if (task.status !== 'ofrecida' && task.status !== 'aceptada') {
        throw new PreconditionError(
          'TASK_REASSIGNMENT_NOT_ALLOWED',
          'sólo una oferta pendiente o una tarea aceptada puede pedir reasignación',
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
        offers: [...task.offers, offer],
        lastSeq: event.seq,
      };
      return { ...base, tasks: replaceTask(state, next) };
    }
  }
}

export function replayInitiative(log: InitiativeLog): InitiativeState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacio no identifica ninguna iniciativa');
  }
  let state: InitiativeState | undefined;
  for (const event of log) state = applyInitiative(state, event);
  // El primer evento no vacío sólo puede ser InitiativeCreated, por lo que `state` ya existe.
  if (state === undefined) throw new PreconditionError('EMPTY_LOG', 'un log vacio');
  return state;
}

export async function verifyInitiativeLog(log: InitiativeLog): Promise<InitiativeState> {
  await verifyChain(log);
  return replayInitiative(log);
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
  const subject = task.status === 'aceptada' ? task.assigneeId : task.offeredTo;
  authorize(meta.by, action, {
    kind: 'task',
    ...(subject === undefined ? {} : { subject }),
    circleId: state.circleId,
  });
  return authorizedMember(meta);
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
  validateExecutionPlanStructure(input.executionPlan);
  const event = await appendChained<InitiativePayload>([], {
    eventId: meta.eventId,
    aggregateId: input.initiativeId,
    occurredAt: meta.at,
    actor: meta.actor,
    payload: {
      type: 'InitiativeCreated',
      decisionId: input.decisionId,
      proposalId: input.proposalId,
      proposalVersionHash: input.proposalVersionHash,
      decisionResultHash: input.decisionResultHash,
      circleId: input.circleId,
      executionPlan: input.executionPlan,
    },
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
    payload: { type: 'MilestonePlanned', ...input },
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
  const { recipient: _recipient, ...payload } = input;
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: { type: 'TaskOffered', ...payload },
  });
}

export async function acceptTaskBy(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskAccepted, 'type'>,
): Promise<InitiativeLog> {
  const state = replayInitiative(log);
  const actor = authorizeTaskResponse(state, meta, input.taskId, input.offerId, 'task:accept');
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: { type: 'TaskAccepted', ...input },
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
    payload: { type: 'TaskRejected', ...input },
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
    payload: { type: 'TaskReassignmentRequested', ...input },
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
  const { recipient: _recipient, ...payload } = input;
  return emitInitiative(log, state, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload: { type: 'TaskReoffered', ...payload },
  });
}
