/** Agregado minimo que enlaza un resultado aprobado con su promesa de ejecucion congelada. */

import type { OutcomeKind } from '../events.js';
import { PreconditionError } from '../errors.js';
import type {
  CircleId,
  DecisionId,
  EventId,
  Hash,
  InitiativeId,
  Instant,
  MemberId,
  ProposalId,
} from '../ids.js';
import { initiativeId as toInitiativeId } from '../ids.js';
import { appendChained, type ChainedEvent, type ChainedLog, verifyChain } from './chain.js';
import { type ExecutionPlan, validateExecutionPlanStructure } from './execution-plan.js';

export interface InitiativeCreated {
  readonly type: 'InitiativeCreated';
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly proposalVersionHash: Hash;
  readonly decisionResultHash: Hash;
  readonly circleId: CircleId;
  readonly executionPlan: ExecutionPlan;
}

export type InitiativePayload = InitiativeCreated;
export type InitiativeEvent = ChainedEvent<InitiativePayload>;
export type InitiativeLog = ChainedLog<InitiativePayload>;
export type InitiativeStatus = 'por-empezar';

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
  readonly lastSeq: number;
}

export function applyInitiative(
  state: InitiativeState | undefined,
  event: InitiativeEvent,
): InitiativeState {
  if (state !== undefined) {
    throw new PreconditionError(
      'INITIATIVE_ALREADY_CREATED',
      'una decision aprobada crea exactamente una iniciativa',
    );
  }
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
    status: 'por-empezar',
    createdAt: event.occurredAt,
    lastSeq: event.seq,
  };
}

export function replayInitiative(log: InitiativeLog): InitiativeState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacio no identifica ninguna iniciativa');
  }
  let state = applyInitiative(undefined, first);
  for (const event of log.slice(1)) state = applyInitiative(state, event);
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
