/**
 * El pliegue y las órdenes de la evaluación.
 *
 * ═══ Tres construcciones, no tres comprobaciones ═══
 *
 *  1. **Los criterios entran por la marca, no por el payload.** `replayEvaluation` exige un
 *     `FrozenCriteria` —que sólo emite `freezeSuccessCriteria`— y compara su huella contra la
 *     sellada en el génesis. Un log forjado que altere criterios, huella o cardinalidad no llega a
 *     plegar: lanza antes de construir estado. No hay bandera que lo desactive porque no hay
 *     bandera: es el primer paso del pliegue y sin él no hay `EvaluationState` que devolver.
 *
 *  2. **El resultado no es un parámetro de ninguna orden.** `publishEvaluationResultBy` no recibe
 *     desenlace: lo calcula. No hay firma en este módulo donde quepa un «esto salió bien». Y el
 *     pliegue vuelve a calcularlo al leer: si lo guardado no corresponde a los hechos anotados, la
 *     discrepancia se **declara** y el estado público pasa a `anulada-por-inconsistencia` (ADR-0026).
 *     No es una alerta que alguien deba mirar; es lo que devuelve la lectura.
 *
 *  3. **Nadie aparece en la salida.** Ningún payload admite un `MemberId` y la proyección no guarda
 *     el `actor` de ningún evento. Quién escribió cada hecho sigue en el log encadenado, como en
 *     todo el sistema; la evaluación no lo proyecta y por tanto no puede agregarlo (ADR-0040).
 *
 * ═══ Autorización: filas que todavía no están en `access.ts` ═══
 *
 * Este incremento no puede tocar `access.ts`. Las siete filas que hacen falta están declaradas como
 * datos en `PROPOSED_EVALUATION_ACCESS_RULES` y se aplican aquí con la misma semántica que
 * `authorize`, incluidos los mismos `code` de error. En cuanto las filas entren en la matriz, este
 * módulo debe pasar a llamar a `authorize` y `EvaluationUnauthorizedError` desaparece. Lo que no
 * cambia en ninguno de los dos mundos: **`tech-admin` no aparece en ninguna regla**, y `observer`
 * tampoco en las de escritura.
 */

import { hashCanonical } from '../canonical.js';
import { DomainError, PreconditionError } from '../errors.js';
import type { Fraction } from '../fraction.js';
import {
  type CircleId,
  type EventId,
  eventId as toEventId,
  type Hash,
  hash as toHash,
  type InitiativeId,
  type Instant,
  instant as toInstant,
  type MemberId,
  type TaskId,
  taskId as toTaskId,
  ZERO_HASH,
} from '../ids.js';
import type { Actor, DenialReason, Role } from '../access.js';
import { appendChained, verifyChain } from '../workspace/chain.js';
import { executionPlanHash } from '../workspace/execution-plan.js';
import type { InitiativeState } from '../workspace/initiative.js';
import {
  evaluationPublicStatus,
  type EvaluationPublicStatus,
  nextEvaluationStatus,
} from './state-machine.js';
import {
  AGREEMENT_DISPOSITIONS,
  type AgreementDisposition,
  assertExactEvaluationPayload,
  assertFrozenCriteria,
  assertLearningShape,
  assertNoIndividualActivityMetric,
  assertVerdictEvidence,
  type CriterionAssessed,
  type CriterionAssessmentRecord,
  type CriterionVerdict,
  ESCALATION_PRESCRIPTION_MS,
  ESCALATION_RUNGS,
  ESCALATION_TARGET_KINDS,
  type EscalationRecord,
  type EscalationRung,
  type EscalationTargetKind,
  EVALUATION_OUTCOMES,
  type EvaluationClosed,
  type EvaluationDiscrepancy,
  type EvaluationEscalated,
  type EvaluationEvent,
  evaluationId as toEvaluationId,
  type EvaluationId,
  type EvaluationLog,
  type EvaluationOpened,
  evaluationOutcomePreimage,
  type EvaluationOutcome,
  type EvaluationPayload,
  type EvaluationResultPublished,
  type EvaluationState,
  type FrozenCriteria,
  type LearningIndexEntry,
  type LearningRecord,
  type LearningRecorded,
  MAX_LEARNINGS_PER_EVALUATION,
  metShare,
  outcomeFromVerdicts,
} from './types.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Autorización provisional (las filas que hay que añadir a `access.ts`)
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type EvaluationAction =
  | 'evaluation:read'
  | 'evaluation:open'
  | 'evaluation:assess'
  | 'evaluation:escalate'
  | 'evaluation:record-learning'
  | 'evaluation:publish'
  | 'evaluation:close';

export interface ProposedAccessRule {
  readonly action: EvaluationAction;
  readonly roles: readonly Role[];
  readonly authenticated: boolean;
  readonly circleOnly: boolean;
  /** Ninguna de estas siete lo usa, y la razón está en `note`. */
  readonly ownerOnly: boolean;
  readonly note: string;
}

const CIRCLE_ROLES: readonly Role[] = ['member', 'facilitator', 'guarantees'];
const EVERYONE: readonly Role[] = ['observer', 'member', 'facilitator', 'guarantees', 'tech-admin'];

/**
 * Las siete filas propuestas para `RULES` de `access.ts`.
 *
 * La decisión de diseño que hay que leer con cuidado es que **ninguna es `ownerOnly`**. Es
 * deliberado y va contra el patrón del resto del agregado de ejecución, donde `initiative:plan`,
 * `task:offer` y las dos de revisión sí lo son:
 *
 *  - si sólo quien asumió el plan pudiera **abrir** la revisión, bastaría con no abrirla nunca. El
 *    antipatrón número cinco del corpus —«actas impecables, realidad idéntica»— no necesita mala fe:
 *    le basta con que evaluar sea opcional para el evaluado;
 *  - si sólo esa persona pudiera **valorar** un criterio, la evaluación sería una autocertificación,
 *    y una autocertificación que sólo puede salir bien es teatro;
 *  - si sólo esa persona pudiera **publicar**, podría retener indefinidamente un resultado adverso —y
 *    además no serviría de nada, porque el resultado es derivado y cualquiera lo recomputa.
 *
 * Lo que sustituye a `ownerOnly` es la pertenencia al círculo competente: es el principio 4 de
 * Ostrom —monitoreo por los propios miembros— sin inventar un panel de vigilancia.
 */
export const PROPOSED_EVALUATION_ACCESS_RULES: readonly ProposedAccessRule[] = [
  {
    action: 'evaluation:read',
    roles: EVERYONE,
    authenticated: false,
    circleOnly: false,
    ownerOnly: false,
    note: 'La memoria es pública, como el resto del historial. Un aprendizaje que sólo ve el círculo que lo vivió no sobrevive a que ese círculo rote.',
  },
  {
    action: 'evaluation:open',
    roles: CIRCLE_ROLES,
    authenticated: true,
    circleOnly: true,
    ownerOnly: false,
    note: 'Cualquier miembro del círculo convoca la revisión a partir de la fecha comprometida (ADR-0033). No es `ownerOnly` para que no se pueda evitar no convocándola.',
  },
  {
    action: 'evaluation:assess',
    roles: CIRCLE_ROLES,
    authenticated: true,
    circleOnly: true,
    ownerOnly: false,
    note: 'Valorar un criterio contra su evidencia lo hace el círculo, no quien lo prometió. La asimetría que sostiene esto no está aquí sino en el dominio: `cumplido` exige evidencia verificada y el evento que la sostiene.',
  },
  {
    action: 'evaluation:escalate',
    roles: CIRCLE_ROLES,
    authenticated: true,
    circleOnly: true,
    ownerOnly: false,
    note: 'Los dos escalones que la evaluación puede pulsar recaen sobre la tarea, el acuerdo o la carga (ADR-0040). `dominio-suspendido` no está en el vocabulario y no debe añadirse aquí: exige consentimiento del círculo y es apelable.',
  },
  {
    action: 'evaluation:record-learning',
    roles: CIRCLE_ROLES,
    authenticated: true,
    circleOnly: true,
    ownerOnly: false,
    note: 'Anotar lo aprendido es un derecho de miembro del círculo. Cerrar con un desenlace distinto de `logrado` exige al menos uno.',
  },
  {
    action: 'evaluation:publish',
    roles: CIRCLE_ROLES,
    authenticated: true,
    circleOnly: true,
    ownerOnly: false,
    note: 'Publicar sólo ancla en el historial un valor que la función ya determina. Restringirlo a facilitación daría a un rol la capacidad de retener un resultado adverso sin ganar ninguna garantía.',
  },
  {
    action: 'evaluation:close',
    roles: ['facilitator', 'guarantees'],
    authenticated: true,
    circleOnly: true,
    ownerOnly: false,
    note: 'Cerrar decide qué pasa con el acuerdo —mantener, enmendar, derogar o escalar— y eso sí es procedimiento (§7). Es la única de las siete que no es de miembro raso, y aun así no es `ownerOnly`.',
  },
];

const RULE_INDEX = new Map<EvaluationAction, ProposedAccessRule>(
  PROPOSED_EVALUATION_ACCESS_RULES.map((rule) => [rule.action, rule]),
);

/**
 * Denegación de una acción de evaluación.
 *
 * Lleva los mismos `code` que `UnauthorizedError` (`UNAUTHORIZED_<motivo>`) para que la capa de
 * aplicación la trate igual. Existe sólo porque `Action` es una unión cerrada de `access.ts` y este
 * incremento no puede ampliarla; desaparece con las siete filas.
 */
export class EvaluationUnauthorizedError extends DomainError {
  readonly reason: DenialReason;
  readonly action: EvaluationAction;

  constructor(reason: DenialReason, action: EvaluationAction, detail: string) {
    super(`UNAUTHORIZED_${reason}`, `no autorizado para ${action} (${reason}): ${detail}`);
    this.name = 'EvaluationUnauthorizedError';
    this.reason = reason;
    this.action = action;
  }
}

/** Misma semántica y mismo orden de comprobaciones que `authorize`. */
export function authorizeEvaluation(
  actor: Actor,
  action: EvaluationAction,
  circleId: CircleId | undefined,
): void {
  const rule = RULE_INDEX.get(action);
  if (rule === undefined) {
    throw new EvaluationUnauthorizedError(
      'ROLE_NOT_GRANTED',
      action,
      'la acción no tiene fila en la matriz: la ausencia de política nunca concede acceso',
    );
  }
  if (rule.authenticated && actor.memberId === undefined) {
    throw new EvaluationUnauthorizedError(
      'NOT_AUTHENTICATED',
      action,
      'este acto exige una cuenta verificada con el correo institucional',
    );
  }
  if (!actor.roles.some((role) => rule.roles.includes(role))) {
    throw new EvaluationUnauthorizedError(
      'ROLE_NOT_GRANTED',
      action,
      `se exige alguno de [${rule.roles.join(', ')}] y el actor tiene [${actor.roles.join(', ')}]`,
    );
  }
  if (rule.circleOnly) {
    if (circleId === undefined) {
      throw new EvaluationUnauthorizedError(
        'NOT_IN_CIRCLE',
        action,
        'el recurso no declara círculo competente y esta acción se decide por círculo (§3)',
      );
    }
    if (!actor.circles.includes(circleId)) {
      throw new EvaluationUnauthorizedError(
        'NOT_IN_CIRCLE',
        action,
        'quien evalúa un acuerdo tiene que pertenecer al círculo que lo tomó (§3)',
      );
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Pliegue
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El paso que hace imposible cambiar los criterios: se compara la huella de lo aportado contra la
 * huella sellada. Es una comparación de cadenas, así que el pliegue sigue siendo síncrono.
 */
function assertBoundCriteria(planHash: Hash, criteriaCount: number, frozen: FrozenCriteria): void {
  assertFrozenCriteria(frozen);
  if (frozen.planHash !== planHash) {
    throw new PreconditionError(
      'EVALUATION_CRITERIA_TAMPERED',
      'los criterios aportados no son los que se congelaron al acordar: su huella no coincide con ' +
        'la sellada en la apertura de la evaluación. No se evalúa contra una vara distinta de la ' +
        'que se prometió (ADR-0033)',
    );
  }
  if (frozen.criteria.length !== criteriaCount) {
    throw new PreconditionError(
      'EVALUATION_CRITERIA_TAMPERED',
      'el número de criterios aportados no coincide con el sellado en la apertura',
    );
  }
}

function assertCriterionIndex(state: EvaluationState, index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.criteriaCount) {
    throw new PreconditionError(
      'UNKNOWN_CRITERION',
      'el criterio no existe en el plan congelado de esta evaluación',
    );
  }
}

function assertVocabulary<T extends string>(
  value: string,
  vocabulary: readonly T[],
  code: string,
  detail: string,
): asserts value is T {
  if (!(vocabulary as readonly string[]).includes(value)) {
    throw new PreconditionError(code, detail);
  }
}

function applyOpened(
  event: EvaluationEvent & { readonly payload: EvaluationOpened },
  frozen: FrozenCriteria,
): EvaluationState {
  toEventId(event.eventId);
  if (event.seq !== 1) {
    throw new PreconditionError(
      'EVALUATION_GENESIS_REQUIRED',
      'EvaluationOpened debe ser el génesis del agregado',
    );
  }
  if (event.actor === 'system') {
    throw new PreconditionError(
      'EVALUATION_NEEDS_A_PERSON',
      'la revisión la convoca alguien del círculo; una evaluación que se abre sola no es monitoreo ' +
        'por los propios miembros, es un trabajo programado',
    );
  }
  const payload = event.payload;
  toHash(payload.planHash);
  toInstant(payload.reviewAt);
  assertBoundCriteria(payload.planHash, payload.criteriaCount, frozen);
  if (frozen.reviewAt !== payload.reviewAt) {
    throw new PreconditionError(
      'EVALUATION_CRITERIA_TAMPERED',
      'la fecha de revisión sellada no es la del plan congelado',
    );
  }
  if (event.occurredAt < payload.reviewAt) {
    throw new PreconditionError(
      'EVALUATION_BEFORE_REVIEW_DATE',
      'la revisión no se adelanta a la fecha comprometida: evaluar antes de tiempo garantiza el ' +
        'incumplimiento y convierte la evaluación en una emboscada (ADR-0033)',
    );
  }
  return {
    evaluationId: toEvaluationId(event.aggregateId),
    initiativeId: payload.initiativeId,
    decisionId: payload.decisionId,
    proposalId: payload.proposalId,
    circleId: payload.circleId,
    planHash: payload.planHash,
    criteriaCount: payload.criteriaCount,
    reviewAt: payload.reviewAt,
    status: 'en-curso',
    openedAt: event.occurredAt,
    assessments: [],
    verdicts: Array.from({ length: payload.criteriaCount }, () => undefined),
    learnings: [],
    escalations: [],
    published: undefined,
    closure: undefined,
    discrepancy: undefined,
    eventIds: [event.eventId],
    lastSeq: event.seq,
  };
}

function applyAssessed(
  state: EvaluationState,
  base: EvaluationState,
  event: EvaluationEvent,
  payload: CriterionAssessed,
): EvaluationState {
  assertCriterionIndex(state, payload.criterionIndex);
  assertVerdictEvidence(payload);
  if (payload.evidenceRef !== undefined) toEventId(payload.evidenceRef);
  const record: CriterionAssessmentRecord = {
    criterionIndex: payload.criterionIndex,
    verdict: payload.verdict,
    evidence: payload.evidence,
    evidenceRef: payload.evidenceRef,
    at: event.occurredAt,
    seq: event.seq,
  };
  return {
    ...base,
    assessments: [...state.assessments, record],
    verdicts: state.verdicts.map((verdict, index) =>
      index === payload.criterionIndex ? payload.verdict : verdict,
    ),
  };
}

function applyEscalated(
  state: EvaluationState,
  base: EvaluationState,
  event: EvaluationEvent,
  payload: EvaluationEscalated,
): EvaluationState {
  assertCriterionIndex(state, payload.criterionIndex);
  assertVocabulary<EscalationRung>(
    payload.rung,
    ESCALATION_RUNGS,
    'UNKNOWN_ESCALATION_RUNG',
    'una evaluación sólo puede preguntar o llevarlo al colectivo: los demás escalones los mueve la ' +
      'máquina de la tarea, y `dominio-suspendido` nunca es automático (ADR-0040)',
  );
  assertVocabulary<EscalationTargetKind>(
    payload.targetKind,
    ESCALATION_TARGET_KINDS,
    'UNKNOWN_ESCALATION_TARGET',
    'el objeto de la escalada no pertenece al vocabulario cerrado',
  );
  const taskId: TaskId | undefined = payload.taskId;
  if (payload.targetKind === 'tarea') {
    if (taskId === undefined) {
      throw new PreconditionError(
        'ESCALATION_TARGET_MISSING',
        'escalar sobre una tarea exige decir cuál',
      );
    }
    toTaskId(taskId);
  } else if (taskId !== undefined) {
    throw new PreconditionError(
      'ESCALATION_TARGET_MISMATCH',
      'una escalada sobre el acuerdo o sobre la carga no señala una tarea concreta',
    );
  }

  const verdict = state.verdicts[payload.criterionIndex];
  if (verdict === 'cumplido' || verdict === 'no-aplica') {
    throw new PreconditionError(
      'ESCALATION_WITHOUT_BREACH',
      'no se escala un criterio cumplido o que no aplica: la escalera existe para el ' +
        'incumplimiento, no para el desacuerdo',
    );
  }
  if (payload.rung === 'en-revision-colectiva') {
    if (verdict === undefined) {
      throw new PreconditionError(
        'ESCALATION_WITHOUT_BREACH',
        'llevarlo al colectivo exige haber valorado antes el criterio',
      );
    }
    const asked = state.escalations.some(
      (previous) =>
        previous.rung === 'consultada' &&
        previous.criterionIndex === payload.criterionIndex &&
        previous.targetKind === payload.targetKind &&
        previous.taskId === taskId,
    );
    if (!asked) {
      throw new PreconditionError(
        'ESCALATION_SKIPS_A_RUNG',
        'antes de llevarlo al colectivo hay que preguntar: la escalera del ADR-0040 empieza por ' +
          'una pregunta —«sigo» / «necesito ayuda» / «no puedo»—, no por un reproche, y saltarse ' +
          'ese escalón es exactamente la deriva punitiva que el ADR existe para impedir',
      );
    }
  }
  const record: EscalationRecord = {
    escalationId: event.eventId,
    criterionIndex: payload.criterionIndex,
    rung: payload.rung,
    targetKind: payload.targetKind,
    taskId,
    at: event.occurredAt,
    seq: event.seq,
  };
  return { ...base, escalations: [...state.escalations, record] };
}

function applyLearning(
  state: EvaluationState,
  base: EvaluationState,
  event: EvaluationEvent,
  payload: LearningRecorded,
): EvaluationState {
  assertLearningShape(payload);
  if (state.learnings.length >= MAX_LEARNINGS_PER_EVALUATION) {
    throw new PreconditionError(
      'TOO_MANY_LEARNINGS',
      `una evaluación admite hasta ${String(MAX_LEARNINGS_PER_EVALUATION)} aprendizajes`,
    );
  }
  if (state.learnings.some((learning) => learning.learningId === payload.learningId)) {
    throw new PreconditionError(
      'DUPLICATE_LEARNING_ID',
      'un aprendizaje sólo puede aparecer una vez en el historial de la evaluación',
    );
  }
  const record: LearningRecord = {
    learningId: payload.learningId,
    kind: payload.kind,
    statement: payload.statement,
    tags: [...payload.tags],
    at: event.occurredAt,
    seq: event.seq,
  };
  return { ...base, learnings: [...state.learnings, record] };
}

function applyPublished(
  state: EvaluationState,
  base: EvaluationState,
  event: EvaluationEvent,
  payload: EvaluationResultPublished,
): EvaluationState {
  assertVocabulary<EvaluationOutcome>(
    payload.outcome,
    EVALUATION_OUTCOMES,
    'UNKNOWN_EVALUATION_OUTCOME',
    'el desenlace publicado no pertenece al vocabulario cerrado',
  );
  toHash(payload.outcomeHash);
  const pending = state.verdicts.findIndex((verdict) => verdict === undefined);
  if (pending !== -1) {
    throw new PreconditionError(
      'EVALUATION_INCOMPLETE_ASSESSMENT',
      'no se publica un resultado con criterios sin mirar: los que faltan no se redondean a favor ' +
        'ni en contra, se miran',
    );
  }
  // ADR-0026. No se lanza: se declara. Lanzar dejaría el registro manipulado en pie mientras nadie
  // volviera a leerlo, que es exactamente lo contrario de lo que la regla busca.
  const recomputed = outcomeFromVerdicts(state.verdicts);
  const discrepancy: EvaluationDiscrepancy | undefined =
    recomputed === payload.outcome
      ? undefined
      : { reason: 'outcome-mismatch', published: payload.outcome, recomputed };
  return {
    ...base,
    published: {
      outcome: payload.outcome,
      outcomeHash: payload.outcomeHash,
      at: event.occurredAt,
      seq: event.seq,
    },
    discrepancy: state.discrepancy ?? discrepancy,
  };
}

function applyClosed(
  state: EvaluationState,
  base: EvaluationState,
  event: EvaluationEvent,
  payload: EvaluationClosed,
): EvaluationState {
  assertVocabulary<AgreementDisposition>(
    payload.disposition,
    AGREEMENT_DISPOSITIONS,
    'UNKNOWN_AGREEMENT_DISPOSITION',
    'lo que se hace con el acuerdo no pertenece al vocabulario cerrado del ADR-0033',
  );
  if (state.discrepancy !== undefined) {
    throw new PreconditionError(
      'EVALUATION_RESULT_DISCREPANCY',
      'no se cierra un acuerdo sobre un resultado que no corresponde a sus propios hechos: ' +
        'primero se explica la discrepancia (ADR-0026)',
    );
  }
  const recomputed = outcomeFromVerdicts(state.verdicts);
  if (payload.nextReviewAt !== undefined) {
    toInstant(payload.nextReviewAt);
    if (payload.nextReviewAt <= event.occurredAt) {
      throw new PreconditionError(
        'NEXT_REVIEW_NOT_FUTURE',
        'la nueva fecha de revisión debe quedar por delante del cierre',
      );
    }
  }
  if (payload.disposition === 'mantener') {
    if (recomputed === 'fallido') {
      throw new PreconditionError(
        'CANNOT_KEEP_A_FAILED_AGREEMENT',
        'un acuerdo que no cumplió ninguno de sus criterios no se mantiene tal cual: se enmienda, ' +
          'se deroga o se escala. Mantener sin evidencia es lo que convierte el corpus normativo ' +
          'en un cementerio (ADR-0033)',
      );
    }
    if (payload.nextReviewAt === undefined) {
      throw new PreconditionError(
        'KEEPING_NEEDS_A_NEW_REVIEW',
        'mantener un acuerdo exige comprometer la próxima fecha de revisión: sin renovación ' +
          'explícita la inercia trabaja a favor de la acumulación (ADR-0033)',
      );
    }
  }
  if (recomputed !== 'logrado' && state.learnings.length === 0) {
    throw new PreconditionError(
      'CLOSING_NEEDS_A_LEARNING',
      'cerrar sin lograrlo exige anotar al menos un aprendizaje: lo que sobrevive del intento es ' +
        'lo que enseña, y sin eso el fracaso se pierde y se repite',
    );
  }
  return {
    ...base,
    closure: {
      disposition: payload.disposition,
      nextReviewAt: payload.nextReviewAt,
      at: event.occurredAt,
    },
  };
}

function applyEvaluationInternal(
  state: EvaluationState | undefined,
  event: EvaluationEvent,
  frozen: FrozenCriteria,
  trackEventId: boolean,
): EvaluationState {
  // Primero la forma cruda: un `getter` que devuelve una cosa al validar y otra al hashear no lo ve
  // ningún `typeof`.
  assertExactEvaluationPayload(event.payload);
  if (state === undefined) {
    if (event.payload.type !== 'EvaluationOpened') {
      throw new PreconditionError(
        'EVALUATION_GENESIS_REQUIRED',
        'el primer evento de una evaluación debe ser EvaluationOpened',
      );
    }
    return applyOpened(event as EvaluationEvent & { readonly payload: EvaluationOpened }, frozen);
  }

  // Se vuelve a comprobar en cada paso, no sólo en el génesis: plegar es leer, y quien lee tiene que
  // estar leyendo contra los criterios acordados en todo momento.
  assertBoundCriteria(state.planHash, state.criteriaCount, frozen);

  if (event.aggregateId !== state.evaluationId) {
    throw new PreconditionError('WRONG_AGGREGATE', 'el evento pertenece a otra evaluación');
  }
  toEventId(event.eventId);
  if (trackEventId && state.eventIds.includes(event.eventId)) {
    throw new PreconditionError(
      'DUPLICATE_EVALUATION_EVENT_ID',
      'un eventId sólo puede aparecer una vez en todo el historial de la evaluación',
    );
  }
  if (event.seq !== state.lastSeq + 1) {
    throw new PreconditionError(
      'NON_CONSECUTIVE_EVALUATION_EVENT',
      'los eventos de evaluación deben tener secuencia densa y consecutiva',
    );
  }
  if (event.occurredAt < state.openedAt) {
    throw new PreconditionError(
      'EVALUATION_EVENT_BEFORE_OPENING',
      'ningún hecho de la evaluación es anterior a su apertura',
    );
  }

  const payload = event.payload;
  const status = nextEvaluationStatus(state.status, payload.type);
  const base: EvaluationState = {
    ...state,
    status,
    eventIds: trackEventId ? [...state.eventIds, event.eventId] : state.eventIds,
    lastSeq: event.seq,
  };

  switch (payload.type) {
    case 'EvaluationOpened':
      // Inalcanzable: la tabla no tiene ninguna transición hacia `EvaluationOpened` desde un estado
      // existente. Se conserva para que el `switch` siga siendo exhaustivo si la tabla cambia.
      throw new PreconditionError(
        'EVALUATION_ALREADY_OPENED',
        'una iniciativa evaluada abre exactamente una evaluación por fecha de revisión',
      );
    case 'CriterionAssessed':
      return applyAssessed(state, base, event, payload);
    case 'EvaluationEscalated':
      return applyEscalated(state, base, event, payload);
    case 'LearningRecorded':
      return applyLearning(state, base, event, payload);
    case 'EvaluationResultPublished':
      return applyPublished(state, base, event, payload);
    case 'EvaluationClosed':
      return applyClosed(state, base, event, payload);
  }
}

/** Aplica un único evento y conserva el índice necesario para detectar reutilización de `eventId`. */
export function applyEvaluation(
  state: EvaluationState | undefined,
  event: EvaluationEvent,
  frozen: FrozenCriteria,
): EvaluationState {
  return applyEvaluationInternal(state, event, frozen, true);
}

/** El pliegue. Sin criterios congelados que coincidan con los sellados, no devuelve estado: lanza. */
export function replayEvaluation(log: EvaluationLog, frozen: FrozenCriteria): EvaluationState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacío no identifica ninguna evaluación');
  }
  const seen = new Set<EventId>();
  const eventIds: EventId[] = [];
  for (const event of log) {
    toEventId(event.eventId);
    if (seen.has(event.eventId)) {
      throw new PreconditionError(
        'DUPLICATE_EVALUATION_EVENT_ID',
        'un eventId sólo puede aparecer una vez en todo el historial de la evaluación',
      );
    }
    seen.add(event.eventId);
    eventIds.push(event.eventId);
  }
  let state: EvaluationState | undefined;
  for (const event of log) state = applyEvaluationInternal(state, event, frozen, false);
  if (state === undefined) throw new PreconditionError('EMPTY_LOG', 'un log vacío');
  return { ...state, eventIds };
}

/** Estado vigente. Nombre simétrico con `currentInitiative`. */
export function currentEvaluation(log: EvaluationLog, frozen: FrozenCriteria): EvaluationState {
  return replayEvaluation(log, frozen);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El resultado, recomputado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El desenlace real, ahora mismo, desde los hechos anotados.
 *
 * Se puede llamar en cualquier momento y no lee nada de lo publicado. Con criterios sin mirar
 * devuelve `inconcluso`: el silencio no aprueba.
 */
export function recomputeEvaluationOutcome(state: EvaluationState): EvaluationOutcome {
  return outcomeFromVerdicts(state.verdicts);
}

/** `cumplidos de aplicables`, exacta. `undefined` si no hay aplicables (ADR-0027 B.0.d). */
export function evaluationMetShare(state: EvaluationState): Fraction | undefined {
  return metShare(state.verdicts);
}

async function outcomeHashFor(
  state: EvaluationState,
  verdicts: readonly (CriterionVerdict | undefined)[],
  outcome: EvaluationOutcome,
  publishedAtSeq: number,
): Promise<Hash> {
  return hashCanonical(
    evaluationOutcomePreimage({
      evaluationId: state.evaluationId,
      initiativeId: state.initiativeId,
      decisionId: state.decisionId,
      proposalId: state.proposalId,
      circleId: state.circleId,
      planHash: state.planHash,
      reviewAt: state.reviewAt,
      verdicts,
      outcome,
      publishedAtSeq,
    }),
  );
}

/**
 * Recomputa la huella del resultado publicado. `undefined` si todavía no se publicó nada.
 *
 * Incluye `planHash` en la preimagen: un resultado calculado contra otros criterios produce otra
 * huella. La promesa evaluada es parte del resultado, no su contexto.
 */
export async function recomputeEvaluationOutcomeHash(
  state: EvaluationState,
): Promise<Hash | undefined> {
  const published = state.published;
  if (published === undefined) return undefined;
  return outcomeHashFor(state, state.verdicts, recomputeEvaluationOutcome(state), published.seq);
}

/**
 * Verificación completa: pliegue, cadena y huella del resultado.
 *
 * La cadena rota lanza —el agregado queda en cuarentena—; la discrepancia **no lanza**, se devuelve
 * dentro del estado, porque una discrepancia es un hecho que hay que poder leer y publicar, no una
 * excepción que se traga un `catch`.
 */
export async function verifyEvaluationLog(
  log: EvaluationLog,
  frozen: FrozenCriteria,
): Promise<EvaluationState> {
  const state = replayEvaluation(log, frozen);
  await verifyChain(log);
  const published = state.published;
  if (published === undefined || state.discrepancy !== undefined) return state;
  const expected = await outcomeHashFor(
    state,
    state.verdicts,
    recomputeEvaluationOutcome(state),
    published.seq,
  );
  if (expected === published.outcomeHash) return state;
  return {
    ...state,
    discrepancy: {
      reason: 'outcome-hash-mismatch',
      published: published.outcome,
      recomputed: recomputeEvaluationOutcome(state),
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que se enseña
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface EvaluationCriterionReport {
  readonly index: number;
  readonly description: string;
  readonly evidenceSource: string;
  readonly verdict: CriterionVerdict | undefined;
  readonly evidenceRef: EventId | undefined;
}

export interface EvaluationReport {
  readonly evaluationId: EvaluationId;
  readonly initiativeId: InitiativeId;
  readonly planHash: Hash;
  readonly status: EvaluationPublicStatus;
  readonly reviewAt: Instant;
  /** El desenlace de volver a contar. Es el único que vale. */
  readonly outcome: EvaluationOutcome;
  /** Lo que dice el registro. Puede no coincidir, y entonces se dice. */
  readonly publishedOutcome: EvaluationOutcome | undefined;
  readonly discrepancy: EvaluationDiscrepancy | undefined;
  readonly criteria: readonly EvaluationCriterionReport[];
  readonly metShare: Fraction | undefined;
  readonly learnings: readonly LearningRecord[];
  readonly escalations: readonly EscalationRecord[];
  readonly disposition: AgreementDisposition | undefined;
  readonly narrative: string;
}

const OUTCOME_NARRATIVE: Readonly<Record<EvaluationOutcome, string>> = {
  logrado: 'Se cumplieron todos los criterios que se acordaron antes de decidir.',
  parcial: 'Se cumplió parte de lo acordado y parte no.',
  fallido: 'No se cumplió lo que se acordó.',
  inconcluso: 'No se puede afirmar qué pasó: falta evidencia sobre al menos un criterio.',
};

/**
 * Lo que se publica. **Aquí no hay nadie**: ni un identificador de persona, ni un contador por
 * persona, ni nada indexado por persona — y no porque el tipo lo prohíba, sino porque antes de
 * devolverlo se comprueba sobre el objeto real (ADR-0040).
 *
 * Tampoco hay «cuántas tareas se completaron». No es un olvido: haber trabajado no es haber
 * conseguido, y meterlo en el informe invitaría a leerlo como si lo fuera.
 */
export function evaluationReport(state: EvaluationState, frozen: FrozenCriteria): EvaluationReport {
  assertBoundCriteria(state.planHash, state.criteriaCount, frozen);
  const latest = new Map<number, CriterionAssessmentRecord>();
  for (const assessment of state.assessments) latest.set(assessment.criterionIndex, assessment);

  const criteria: readonly EvaluationCriterionReport[] = frozen.criteria.map(
    (criterion, index) => ({
      index,
      description: criterion.description,
      evidenceSource: criterion.evidenceSource,
      verdict: state.verdicts[index],
      evidenceRef: latest.get(index)?.evidenceRef,
    }),
  );
  const outcome = recomputeEvaluationOutcome(state);
  const status = evaluationPublicStatus(state);
  const report: EvaluationReport = {
    evaluationId: state.evaluationId,
    initiativeId: state.initiativeId,
    planHash: state.planHash,
    status,
    reviewAt: state.reviewAt,
    outcome,
    publishedOutcome: state.published?.outcome,
    discrepancy: state.discrepancy,
    criteria,
    metShare: metShare(state.verdicts),
    learnings: state.learnings,
    escalations: state.escalations,
    disposition: state.closure?.disposition,
    narrative:
      status === 'anulada-por-inconsistencia'
        ? `${OUTCOME_NARRATIVE[outcome]} Además, lo guardado no corresponde a estos hechos.`
        : OUTCOME_NARRATIVE[outcome],
  };
  // El guardián del ADR-0040 corre sobre la salida de verdad, no sobre su tipo: un tipo se borra al
  // compilar y este informe se construye en tiempo de ejecución.
  assertNoIndividualActivityMetric(report);
  return report;
}

/** Escaladas vigentes en un instante. Los atrasos prescriben a los dos semestres (ADR-0040). */
export function escalationsInForce(
  state: EvaluationState,
  at: Instant,
): readonly EscalationRecord[] {
  return state.escalations.filter((escalation) => at - escalation.at < ESCALATION_PRESCRIPTION_MS);
}

/**
 * Las filas que esta evaluación aporta a la memoria institucional.
 *
 * Los aprendizajes **no prescriben** y no llevan autor: por eso sobreviven a que el 20 % del
 * colectivo se gradúe cada año, que es el único plazo que de verdad amenaza a esta memoria.
 */
export function learningsOf(state: EvaluationState): readonly LearningIndexEntry[] {
  const outcome = recomputeEvaluationOutcome(state);
  return state.learnings.map((learning) => ({
    evaluationId: state.evaluationId,
    initiativeId: state.initiativeId,
    decisionId: state.decisionId,
    proposalId: state.proposalId,
    circleId: state.circleId,
    outcome,
    disposition: state.closure?.disposition,
    learning,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface EvaluationCommandMeta {
  readonly eventId: EventId;
  readonly at: Instant;
  readonly by: Actor;
}

function authorizedMember(meta: EvaluationCommandMeta, action: EvaluationAction): MemberId {
  const actor = meta.by.memberId;
  if (actor === undefined) {
    throw new EvaluationUnauthorizedError(
      'NOT_AUTHENTICATED',
      action,
      'este acto exige identidad verificada',
    );
  }
  return actor;
}

async function emitEvaluation(
  log: EvaluationLog,
  state: EvaluationState,
  frozen: FrozenCriteria,
  input: {
    readonly eventId: EventId;
    readonly at: Instant;
    readonly actor: MemberId;
    readonly payload: EvaluationPayload;
  },
): Promise<EvaluationLog> {
  toEventId(input.eventId);
  if (state.eventIds.includes(input.eventId)) {
    throw new PreconditionError(
      'DUPLICATE_EVALUATION_EVENT_ID',
      'un eventId sólo puede aparecer una vez en todo el historial de la evaluación',
    );
  }
  // Se juzga el hecho crudo antes de canonicalizarlo, para que un valor inválido falle con la regla
  // semántica y no antes con un error del serializador.
  const prospective: EvaluationEvent = {
    eventId: input.eventId,
    aggregateId: state.evaluationId,
    seq: state.lastSeq + 1,
    occurredAt: input.at,
    actor: input.actor,
    payload: input.payload,
    prevHash: log.at(-1)?.hash ?? ZERO_HASH,
    hash: ZERO_HASH,
  };
  applyEvaluation(state, prospective, frozen);
  const event = await appendChained<EvaluationPayload>(log, {
    eventId: input.eventId,
    aggregateId: state.evaluationId,
    occurredAt: input.at,
    actor: input.actor,
    payload: input.payload,
  });
  return [...log, event];
}

export interface OpenEvaluationInput {
  readonly evaluationId: EvaluationId;
  /** La iniciativa **plegada**, no sus identificadores sueltos: el vínculo no lo aporta quien pide. */
  readonly initiative: InitiativeState;
}

/**
 * Convoca la revisión.
 *
 * Los criterios, su número y la fecha comprometida salen del plan congelado de la iniciativa; quien
 * convoca no aporta ninguno de los tres. Y antes de sellar nada se vuelve a hashear el plan de la
 * iniciativa y se compara con la huella de lo aportado: si alguien trae otros criterios, aquí se
 * acaba.
 */
export async function openEvaluationBy(
  meta: EvaluationCommandMeta,
  input: OpenEvaluationInput,
  frozen: FrozenCriteria,
): Promise<EvaluationLog> {
  assertFrozenCriteria(frozen);
  const initiative = input.initiative;
  authorizeEvaluation(meta.by, 'evaluation:open', initiative.circleId);
  const actor = authorizedMember(meta, 'evaluation:open');
  if (initiative.activatedAt === undefined) {
    throw new PreconditionError(
      'EVALUATION_INITIATIVE_NOT_ACTIVE',
      'no se evalúa una iniciativa provisional: hasta la ratificación no hubo mandato que cumplir ' +
        '(ADR-0043)',
    );
  }
  const planHash = await executionPlanHash(initiative.executionPlan);
  if (planHash !== frozen.planHash) {
    throw new PreconditionError(
      'EVALUATION_CRITERIA_TAMPERED',
      'los criterios aportados no son los del plan que la iniciativa lleva sellado desde su ' +
        'creación',
    );
  }
  const payload: EvaluationOpened = {
    type: 'EvaluationOpened',
    initiativeId: initiative.initiativeId,
    decisionId: initiative.decisionId,
    proposalId: initiative.proposalId,
    circleId: initiative.circleId,
    planHash,
    criteriaCount: frozen.criteria.length,
    reviewAt: frozen.reviewAt,
  };
  assertExactEvaluationPayload(payload);
  const event = await appendChained<EvaluationPayload>([], {
    eventId: meta.eventId,
    aggregateId: input.evaluationId,
    occurredAt: meta.at,
    actor,
    payload,
  });
  applyEvaluation(undefined, event, frozen);
  return [event];
}

export interface AssessCriterionInput {
  readonly criterionIndex: number;
  readonly verdict: CriterionVerdict;
  readonly evidence: CriterionAssessed['evidence'];
  readonly evidenceRef?: EventId | undefined;
}

/** Valora **un criterio** contra su evidencia. Nunca a una persona contra nada. */
export async function assessCriterionBy(
  log: EvaluationLog,
  meta: EvaluationCommandMeta,
  input: AssessCriterionInput,
  frozen: FrozenCriteria,
): Promise<EvaluationLog> {
  const state = replayEvaluation(log, frozen);
  authorizeEvaluation(meta.by, 'evaluation:assess', state.circleId);
  const actor = authorizedMember(meta, 'evaluation:assess');
  const payload: CriterionAssessed = {
    type: 'CriterionAssessed',
    criterionIndex: input.criterionIndex,
    verdict: input.verdict,
    evidence: input.evidence,
    ...(input.evidenceRef === undefined ? {} : { evidenceRef: input.evidenceRef }),
  };
  return emitEvaluation(log, state, frozen, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload,
  });
}

export interface EscalateEvaluationInput {
  readonly criterionIndex: number;
  readonly rung: EscalationRung;
  readonly targetKind: EscalationTargetKind;
  readonly taskId?: TaskId | undefined;
}

/** Pulsa un escalón sobre la tarea, el acuerdo o la carga. El payload no admite una persona. */
export async function escalateEvaluationBy(
  log: EvaluationLog,
  meta: EvaluationCommandMeta,
  input: EscalateEvaluationInput,
  frozen: FrozenCriteria,
): Promise<EvaluationLog> {
  const state = replayEvaluation(log, frozen);
  authorizeEvaluation(meta.by, 'evaluation:escalate', state.circleId);
  const actor = authorizedMember(meta, 'evaluation:escalate');
  const payload: EvaluationEscalated = {
    type: 'EvaluationEscalated',
    criterionIndex: input.criterionIndex,
    rung: input.rung,
    targetKind: input.targetKind,
    ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
  };
  return emitEvaluation(log, state, frozen, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload,
  });
}

export type RecordLearningInput = Omit<LearningRecorded, 'type'>;

/** Anota lo aprendido. Sin autor en la proyección: la memoria tiene que sobrevivir a las personas. */
export async function recordLearningBy(
  log: EvaluationLog,
  meta: EvaluationCommandMeta,
  input: RecordLearningInput,
  frozen: FrozenCriteria,
): Promise<EvaluationLog> {
  const state = replayEvaluation(log, frozen);
  authorizeEvaluation(meta.by, 'evaluation:record-learning', state.circleId);
  const actor = authorizedMember(meta, 'evaluation:record-learning');
  const payload: LearningRecorded = {
    type: 'LearningRecorded',
    learningId: input.learningId,
    kind: input.kind,
    statement: input.statement,
    tags: [...input.tags],
  };
  return emitEvaluation(log, state, frozen, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload,
  });
}

/**
 * Ancla el resultado en el historial.
 *
 * **No hay parámetro de desenlace.** No es que se ignore lo que pida quien publica: es que no hay
 * dónde ponerlo. La firma de esta función es el sitio donde el ADR-0026 deja de ser una intención.
 *
 * Tampoco mira las tareas: se publica con tareas abiertas si hace falta. Esperar a que todo cierre
 * para poder decir «esto no funcionó» es exactamente cómo un fracaso se convierte en un expediente
 * eternamente en curso.
 */
export async function publishEvaluationResultBy(
  log: EvaluationLog,
  meta: EvaluationCommandMeta,
  frozen: FrozenCriteria,
): Promise<EvaluationLog> {
  const state = replayEvaluation(log, frozen);
  authorizeEvaluation(meta.by, 'evaluation:publish', state.circleId);
  const actor = authorizedMember(meta, 'evaluation:publish');
  const outcome = recomputeEvaluationOutcome(state);
  const outcomeHash = await outcomeHashFor(state, state.verdicts, outcome, state.lastSeq + 1);
  const payload: EvaluationResultPublished = {
    type: 'EvaluationResultPublished',
    outcome,
    outcomeHash,
  };
  return emitEvaluation(log, state, frozen, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload,
  });
}

export interface CloseEvaluationInput {
  readonly disposition: AgreementDisposition;
  readonly nextReviewAt?: Instant | undefined;
}

/** Cierra: mantener, enmendar, derogar o escalar (ADR-0033). Mantener lo fallido no está permitido. */
export async function closeEvaluationBy(
  log: EvaluationLog,
  meta: EvaluationCommandMeta,
  input: CloseEvaluationInput,
  frozen: FrozenCriteria,
): Promise<EvaluationLog> {
  const state = replayEvaluation(log, frozen);
  authorizeEvaluation(meta.by, 'evaluation:close', state.circleId);
  const actor = authorizedMember(meta, 'evaluation:close');
  const payload: EvaluationClosed = {
    type: 'EvaluationClosed',
    disposition: input.disposition,
    ...(input.nextReviewAt === undefined ? {} : { nextReviewAt: input.nextReviewAt }),
  };
  return emitEvaluation(log, state, frozen, {
    eventId: meta.eventId,
    at: meta.at,
    actor,
    payload,
  });
}
