/**
 * La evaluación: contrastar contra criterios que no se pueden mover, recomputar el resultado y
 * poder decir que algo no funcionó.
 *
 * Lo que estas pruebas atacan, en orden de importancia:
 *
 *  1. que unos criterios distintos de los acordados **no lleguen a plegarse**, ni por la orden ni
 *     por un log editado a mano con la cadena rehecha;
 *  2. que el desenlace salga de los hechos y no de un campo, y que una discrepancia se declare;
 *  3. que se pueda cerrar en fracaso o inconcluso con trabajo abierto, y que terminar el trabajo no
 *     baste para declarar éxito;
 *  4. que ninguna transición fuera de la tabla se acepte.
 *
 * Se afirma sobre el `code` estable del error y no sobre su prosa: el mensaje está para leerlo, el
 * código para depender de él.
 */

import { describe, expect, it } from 'vitest';

import {
  activateInitiative,
  type Actor,
  acceptTaskBy,
  acceptTaskReviewBy,
  addTaskEvidenceBy,
  admitTaskCapacity,
  appendChained,
  assessCriterionBy,
  closeEvaluationBy,
  createInitiative,
  deliverTaskBy,
  escalateEvaluationBy,
  type EvaluationEvent,
  EVALUATION_EVENT_TYPES,
  type EvaluationLifecycle,
  EVALUATION_LIFECYCLE,
  type EvaluationLog,
  type EvaluationPayload,
  evaluationId,
  evaluationPublicStatus,
  evaluationReport,
  type ExecutionPlan,
  freezeSuccessCriteria,
  type FrozenCriteria,
  hash,
  type InitiativeLog,
  initiativeId,
  instant,
  isLegalEvaluationTransition,
  learningId,
  learningTag,
  milestoneId,
  offerTaskBy,
  openEvaluationBy,
  planMilestoneBy,
  prepareTaskAcceptanceBy,
  publishEvaluationResultBy,
  recomputeEvaluationOutcome,
  recordLearningBy,
  replayEvaluation,
  replayInitiative,
  startTaskBy,
  type TaskId,
  taskId,
  toPrivateMaterialCommitment,
  verifyEvaluationLog,
} from '../src/index.js';
import {
  circleIdAt,
  DECISION_ID,
  eventIdAt,
  hex32,
  memberIdAt,
  PROPOSAL_ID,
  T0,
} from './arbitraries.js';

// ── Afirmar sobre el código, no sobre la prosa ─────────────────────────────────────────────────

const NO_THREW = 'NO_LANZO';

function codeOfError(error: unknown): string {
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : `SIN_CODIGO(${String(error)})`;
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return codeOfError(error);
  }
  return NO_THREW;
}

function throwCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return codeOfError(error);
  }
  return NO_THREW;
}

// ── Escenario ──────────────────────────────────────────────────────────────────────────────────

const CREATED_AT = instant(T0 + 10_000);
const REVIEW_AT = instant(CREATED_AT + 1_000_000);
const OPENED_AT = instant(REVIEW_AT + 1_000);
const CIRCLE = circleIdAt(1);
const OTHER_CIRCLE = circleIdAt(2);

const RESPONSIBLE = memberIdAt(101);
const WORKER = memberIdAt(102);
const AUDITOR = memberIdAt(103);

const owner: Actor = { memberId: RESPONSIBLE, roles: ['member'], circles: [CIRCLE] };
const worker: Actor = { memberId: WORKER, roles: ['member'], circles: [CIRCLE] };
const auditor: Actor = { memberId: AUDITOR, roles: ['member'], circles: [CIRCLE] };
const facilitator: Actor = { memberId: AUDITOR, roles: ['facilitator'], circles: [CIRCLE] };
const admin: Actor = { memberId: memberIdAt(199), roles: ['tech-admin'], circles: [CIRCLE] };
const outsider: Actor = { memberId: memberIdAt(198), roles: ['member'], circles: [OTHER_CIRCLE] };
const anonymous: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

const commitment = (digit: string) => toPrivateMaterialCommitment(digit.repeat(64));

/** Una evidencia de la iniciativa a la que apuntar; basta con que exista y esté encadenada. */
const SOME_EVIDENCE = eventIdAt(777);

function planWith(criteria: number, salt = ''): ExecutionPlan {
  return {
    objective: `Ampliar el horario de la sala de estudio para el semestre entrante${salt}.`,
    responsibleId: RESPONSIBLE,
    reviewAt: REVIEW_AT,
    successCriteria: Array.from({ length: criteria }, (_, index) => ({
      description: `La sala abre hasta las diez de la noche los días hábiles del semestre ${String(index)}${salt}.`,
      evidenceSource: `Registro de apertura de la portería ${String(index)}`,
    })),
  };
}

async function activatedInitiative(plan: ExecutionPlan, base: number): Promise<InitiativeLog> {
  let log = await createInitiative(
    { eventId: eventIdAt(base), at: CREATED_AT, actor: 'system' },
    {
      initiativeId: initiativeId(hex32(0xe0_000 + base)),
      outcomeKind: 'approved',
      decisionId: DECISION_ID,
      proposalId: PROPOSAL_ID,
      proposalVersionHash: hash('a'.repeat(64)),
      decisionResultHash: hash('b'.repeat(64)),
      circleId: CIRCLE,
      executionPlan: plan,
    },
  );
  log = await activateInitiative(
    log,
    { eventId: eventIdAt(base + 1), at: instant(CREATED_AT + 1), actor: 'system' },
    { ratificationEventId: eventIdAt(base + 9), ratificationEventHash: hash('c'.repeat(64)) },
  );
  return log;
}

interface Scenario {
  readonly plan: ExecutionPlan;
  readonly frozen: FrozenCriteria;
  readonly initiativeLog: InitiativeLog;
  readonly log: EvaluationLog;
  readonly base: number;
}

async function openedEvaluation(criteria: number, base: number): Promise<Scenario> {
  const plan = planWith(criteria);
  const initiativeLog = await activatedInitiative(plan, base);
  const frozen = await freezeSuccessCriteria(plan);
  const log = await openEvaluationBy(
    { eventId: eventIdAt(base + 10), at: OPENED_AT, by: auditor },
    {
      evaluationId: evaluationId(hex32(0xf0_000 + base)),
      initiative: replayInitiative(initiativeLog),
    },
    frozen,
  );
  return { plan, frozen, initiativeLog, log, base };
}

describe('apertura: los criterios entran sellados o no entran', () => {
  it('abre contra el plan de la iniciativa y copia huella, número y fecha del plan', async () => {
    const { log, frozen, plan } = await openedEvaluation(3, 1_000);
    const state = replayEvaluation(log, frozen);
    expect(state.criteriaCount).toBe(3);
    expect(state.planHash).toBe(frozen.planHash);
    expect(state.reviewAt).toBe(plan.reviewAt);
    expect(state.status).toBe('en-curso');
    expect(state.verdicts).toEqual([undefined, undefined, undefined]);
  });

  it('no se adelanta a la fecha comprometida: evaluar antes de tiempo es una emboscada', async () => {
    const plan = planWith(1);
    const initiativeLog = await activatedInitiative(plan, 1_100);
    const frozen = await freezeSuccessCriteria(plan);
    expect(
      await rejectionCode(
        openEvaluationBy(
          { eventId: eventIdAt(1_110), at: instant(REVIEW_AT - 1), by: auditor },
          {
            evaluationId: evaluationId(hex32(0xf1_100)),
            initiative: replayInitiative(initiativeLog),
          },
          frozen,
        ),
      ),
    ).toBe('EVALUATION_BEFORE_REVIEW_DATE');
  });

  it('no evalúa una iniciativa que nunca se ratificó', async () => {
    const plan = planWith(1);
    const provisional = await createInitiative(
      { eventId: eventIdAt(1_200), at: CREATED_AT, actor: 'system' },
      {
        initiativeId: initiativeId(hex32(0xe1_200)),
        outcomeKind: 'approved',
        decisionId: DECISION_ID,
        proposalId: PROPOSAL_ID,
        proposalVersionHash: hash('a'.repeat(64)),
        decisionResultHash: hash('b'.repeat(64)),
        circleId: CIRCLE,
        executionPlan: plan,
      },
    );
    expect(
      await rejectionCode(
        openEvaluationBy(
          { eventId: eventIdAt(1_210), at: OPENED_AT, by: auditor },
          {
            evaluationId: evaluationId(hex32(0xf1_200)),
            initiative: replayInitiative(provisional),
          },
          await freezeSuccessCriteria(plan),
        ),
      ),
    ).toBe('EVALUATION_INITIATIVE_NOT_ACTIVE');
  });

  it('la orden rechaza unos criterios que no son los de la iniciativa', async () => {
    const plan = planWith(2);
    const initiativeLog = await activatedInitiative(plan, 1_300);
    const otro = await freezeSuccessCriteria(planWith(2, ' (retocado)'));
    expect(
      await rejectionCode(
        openEvaluationBy(
          { eventId: eventIdAt(1_310), at: OPENED_AT, by: auditor },
          {
            evaluationId: evaluationId(hex32(0xf1_300)),
            initiative: replayInitiative(initiativeLog),
          },
          otro,
        ),
      ),
    ).toBe('EVALUATION_CRITERIA_TAMPERED');
  });

  it('unos criterios fabricados a mano no llevan la marca y no se aceptan', async () => {
    const { log, frozen } = await openedEvaluation(1, 1_400);
    const falsificado = {
      planHash: frozen.planHash,
      objective: frozen.objective,
      responsibleId: frozen.responsibleId,
      reviewAt: frozen.reviewAt,
      criteria: [...frozen.criteria],
    } as unknown as FrozenCriteria;
    expect(throwCode(() => replayEvaluation(log, falsificado))).toBe('FROZEN_CRITERIA_REQUIRED');
  });

  it('no la abre quien administra el servidor, ni quien no está en el círculo, ni un anónimo', async () => {
    const plan = planWith(1);
    const initiativeLog = await activatedInitiative(plan, 1_500);
    const frozen = await freezeSuccessCriteria(plan);
    const initiative = replayInitiative(initiativeLog);
    const esperado = [
      'UNAUTHORIZED_ROLE_NOT_GRANTED',
      'UNAUTHORIZED_NOT_IN_CIRCLE',
      'UNAUTHORIZED_NOT_AUTHENTICATED',
    ];
    const obtenido: string[] = [];
    for (const actor of [admin, outsider, anonymous]) {
      obtenido.push(
        await rejectionCode(
          openEvaluationBy(
            { eventId: eventIdAt(1_510), at: OPENED_AT, by: actor },
            { evaluationId: evaluationId(hex32(0xf1_500)), initiative },
            frozen,
          ),
        ),
      );
    }
    expect(obtenido).toEqual(esperado);
  });
});

describe('el pliegue rechaza un log forjado, no sólo la orden', () => {
  /** Reconstruye la cadena entera desde los payloads: el log resultante verifica sin una sola rotura. */
  async function reforge(
    log: EvaluationLog,
    edit: (payloads: EvaluationPayload[]) => EvaluationPayload[],
  ): Promise<EvaluationLog> {
    const payloads = edit(log.map((event) => ({ ...event.payload })));
    let forged: EvaluationLog = [];
    for (let i = 0; i < payloads.length; i++) {
      const source = log[i]!;
      const event = await appendChained<EvaluationPayload>(forged, {
        eventId: source.eventId,
        aggregateId: source.aggregateId,
        occurredAt: source.occurredAt,
        actor: source.actor,
        payload: payloads[i]!,
      });
      forged = [...forged, event];
    }
    return forged;
  }

  it('cambiar el TEXTO de un criterio: la huella deja de coincidir y el pliegue lanza', async () => {
    const { log, plan } = await openedEvaluation(2, 2_000);
    const retocado: ExecutionPlan = {
      ...plan,
      successCriteria: [
        {
          description: 'Basta con que la sala abra algún día suelto del semestre entrante.',
          evidenceSource: plan.successCriteria[0]!.evidenceSource,
        },
        plan.successCriteria[1]!,
      ],
    };
    const criteriosRetocados = await freezeSuccessCriteria(retocado);
    // El log no se tocó: lo que cambió es la vara. El pliegue lo ve igual.
    expect(throwCode(() => replayEvaluation(log, criteriosRetocados))).toBe(
      'EVALUATION_CRITERIA_TAMPERED',
    );
  });

  it('cambiar la HUELLA del evento génesis, con la cadena rehecha, también lanza', async () => {
    const { log, frozen } = await openedEvaluation(2, 2_100);
    const forged = await reforge(log, (payloads) =>
      payloads.map((payload) =>
        payload.type === 'EvaluationOpened'
          ? { ...payload, planHash: hash('9'.repeat(64)) }
          : payload,
      ),
    );
    // La cadena está intacta —el forjador rehízo todos los eslabones— y aun así no pliega.
    expect(throwCode(() => replayEvaluation(forged, frozen))).toBe('EVALUATION_CRITERIA_TAMPERED');
    expect(await rejectionCode(verifyEvaluationLog(forged, frozen))).toBe(
      'EVALUATION_CRITERIA_TAMPERED',
    );
  });

  it('cambiar el NÚMERO de criterios, con la cadena rehecha, también lanza', async () => {
    const { log, frozen } = await openedEvaluation(2, 2_200);
    const forged = await reforge(log, (payloads) =>
      payloads.map((payload) =>
        payload.type === 'EvaluationOpened' ? { ...payload, criteriaCount: 1 } : payload,
      ),
    );
    expect(throwCode(() => replayEvaluation(forged, frozen))).toBe('EVALUATION_CRITERIA_TAMPERED');
  });

  it('cambiar la FECHA de revisión sellada, con la cadena rehecha, también lanza', async () => {
    const { log, frozen } = await openedEvaluation(1, 2_300);
    const forged = await reforge(log, (payloads) =>
      payloads.map((payload) =>
        payload.type === 'EvaluationOpened'
          ? { ...payload, reviewAt: instant(REVIEW_AT - 500_000) }
          : payload,
      ),
    );
    expect(throwCode(() => replayEvaluation(forged, frozen))).toBe('EVALUATION_CRITERIA_TAMPERED');
  });

  it('meter un campo con una persona en un payload lo rechaza el vocabulario cerrado', async () => {
    const { log, frozen } = await openedEvaluation(1, 2_400);
    const forged = await reforge(log, (payloads) =>
      payloads.map((payload) =>
        payload.type === 'EvaluationOpened'
          ? ({ ...payload, memberId: RESPONSIBLE } as unknown as EvaluationPayload)
          : payload,
      ),
    );
    expect(throwCode(() => replayEvaluation(forged, frozen))).toBe(
      'EVALUATION_PAYLOAD_UNKNOWN_FIELD',
    );
  });
});

describe('valorar un criterio: afirmar cuesta un hecho, negar no cuesta nada', () => {
  it('cumplido exige evidencia verificada y el evento que la sostiene', async () => {
    const { log, frozen, base } = await openedEvaluation(1, 3_000);
    expect(
      await rejectionCode(
        assessCriterionBy(
          log,
          { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
          { criterionIndex: 0, verdict: 'cumplido', evidence: 'sin-verificar' },
          frozen,
        ),
      ),
    ).toBe('CRITERION_MET_NEEDS_EVIDENCE');
    expect(
      await rejectionCode(
        assessCriterionBy(
          log,
          { eventId: eventIdAt(base + 21), at: instant(OPENED_AT + 1), by: auditor },
          { criterionIndex: 0, verdict: 'cumplido', evidence: 'verificada' },
          frozen,
        ),
      ),
    ).toBe('CRITERION_MET_NEEDS_EVIDENCE');
  });

  it('incumplido no exige nada; sin-evidencia además prohíbe señalar una', async () => {
    const { log, frozen, base } = await openedEvaluation(1, 3_100);
    await expect(
      assessCriterionBy(
        log,
        { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
        { criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' },
        frozen,
      ),
    ).resolves.toHaveLength(2);
    expect(
      await rejectionCode(
        assessCriterionBy(
          log,
          { eventId: eventIdAt(base + 21), at: instant(OPENED_AT + 1), by: auditor },
          {
            criterionIndex: 0,
            verdict: 'sin-evidencia',
            evidence: 'sin-verificar',
            evidenceRef: SOME_EVIDENCE,
          },
          frozen,
        ),
      ),
    ).toBe('CRITERION_MISSING_EVIDENCE_MISMATCH');
  });

  it('corregir un veredicto no borra el anterior', async () => {
    const { log, frozen, base } = await openedEvaluation(1, 3_200);
    let next = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
      { criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' },
      frozen,
    );
    next = await assessCriterionBy(
      next,
      { eventId: eventIdAt(base + 21), at: instant(OPENED_AT + 2), by: auditor },
      {
        criterionIndex: 0,
        verdict: 'cumplido',
        evidence: 'verificada',
        evidenceRef: SOME_EVIDENCE,
      },
      frozen,
    );
    const state = replayEvaluation(next, frozen);
    expect(state.assessments).toHaveLength(2);
    expect(state.verdicts).toEqual(['cumplido']);
  });

  it('un criterio que no existe en el plan no se valora', async () => {
    const { log, frozen, base } = await openedEvaluation(2, 3_300);
    expect(
      await rejectionCode(
        assessCriterionBy(
          log,
          { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
          { criterionIndex: 2, verdict: 'incumplido', evidence: 'sin-verificar' },
          frozen,
        ),
      ),
    ).toBe('UNKNOWN_CRITERION');
  });
});

type Verdict = 'cumplido' | 'incumplido' | 'sin-evidencia' | 'no-aplica';

async function assessAll(scenario: Scenario, verdicts: readonly Verdict[]): Promise<EvaluationLog> {
  let log = scenario.log;
  for (let index = 0; index < verdicts.length; index++) {
    const verdict = verdicts[index]!;
    log = await assessCriterionBy(
      log,
      {
        eventId: eventIdAt(scenario.base + 30 + index),
        at: instant(OPENED_AT + 1 + index),
        by: auditor,
      },
      verdict === 'cumplido'
        ? { criterionIndex: index, verdict, evidence: 'verificada', evidenceRef: SOME_EVIDENCE }
        : verdict === 'no-aplica'
          ? { criterionIndex: index, verdict, evidence: 'no-aplica' }
          : { criterionIndex: index, verdict, evidence: 'sin-verificar' },
      scenario.frozen,
    );
  }
  return log;
}

describe('el resultado es una función, no un campo', () => {
  it('todos cumplidos ⇒ logrado; ninguno ⇒ fallido; la mitad ⇒ parcial', async () => {
    const a = await openedEvaluation(2, 4_000);
    expect(
      recomputeEvaluationOutcome(
        replayEvaluation(await assessAll(a, ['cumplido', 'cumplido']), a.frozen),
      ),
    ).toBe('logrado');
    const b = await openedEvaluation(2, 4_100);
    expect(
      recomputeEvaluationOutcome(
        replayEvaluation(await assessAll(b, ['incumplido', 'incumplido']), b.frozen),
      ),
    ).toBe('fallido');
    const c = await openedEvaluation(2, 4_200);
    expect(
      recomputeEvaluationOutcome(
        replayEvaluation(await assessAll(c, ['cumplido', 'incumplido']), c.frozen),
      ),
    ).toBe('parcial');
  });

  it('un solo criterio sin evidencia vuelve todo inconcluso, aunque el resto esté cumplido', async () => {
    const scenario = await openedEvaluation(3, 4_300);
    const log = await assessAll(scenario, ['cumplido', 'cumplido', 'sin-evidencia']);
    expect(recomputeEvaluationOutcome(replayEvaluation(log, scenario.frozen))).toBe('inconcluso');
  });

  it('cero de cero no es unanimidad: todo «no aplica» da inconcluso', async () => {
    const scenario = await openedEvaluation(2, 4_400);
    const log = await assessAll(scenario, ['no-aplica', 'no-aplica']);
    expect(recomputeEvaluationOutcome(replayEvaluation(log, scenario.frozen))).toBe('inconcluso');
  });

  it('el silencio no aprueba: sin valorar nada el desenlace es inconcluso', async () => {
    const scenario = await openedEvaluation(2, 4_500);
    expect(recomputeEvaluationOutcome(replayEvaluation(scenario.log, scenario.frozen))).toBe(
      'inconcluso',
    );
  });

  it('no se publica con criterios sin mirar', async () => {
    const scenario = await openedEvaluation(2, 4_600);
    const log = await assessAll(scenario, ['cumplido']);
    expect(
      await rejectionCode(
        publishEvaluationResultBy(
          log,
          { eventId: eventIdAt(scenario.base + 40), at: instant(OPENED_AT + 50), by: auditor },
          scenario.frozen,
        ),
      ),
    ).toBe('EVALUATION_INCOMPLETE_ASSESSMENT');
  });

  it('publicar no recibe desenlace: lo calcula y coincide con lo recomputado', async () => {
    const scenario = await openedEvaluation(2, 4_700);
    let log = await assessAll(scenario, ['cumplido', 'incumplido']);
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(scenario.base + 40), at: instant(OPENED_AT + 50), by: auditor },
      scenario.frozen,
    );
    const state = await verifyEvaluationLog(log, scenario.frozen);
    expect(state.published?.outcome).toBe('parcial');
    expect(state.discrepancy).toBeUndefined();
    expect(evaluationPublicStatus(state)).toBe('publicada');
  });

  it('un desenlace guardado que no corresponde a los hechos SE DECLARA y anula lo publicado', async () => {
    const scenario = await openedEvaluation(2, 4_800);
    let log = await assessAll(scenario, ['incumplido', 'incumplido']);
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(scenario.base + 40), at: instant(OPENED_AT + 50), by: auditor },
      scenario.frozen,
    );
    // El ataque más barato: cambiar «fallido» por «logrado» y rehacer el eslabón.
    const last = log.at(-1)!;
    const forged = await appendChained<EvaluationPayload>(log.slice(0, -1), {
      eventId: last.eventId,
      aggregateId: last.aggregateId,
      occurredAt: last.occurredAt,
      actor: last.actor,
      payload: {
        type: 'EvaluationResultPublished',
        outcome: 'logrado',
        outcomeHash: hash('7'.repeat(64)),
      },
    });
    const state = await verifyEvaluationLog([...log.slice(0, -1), forged], scenario.frozen);
    expect(state.discrepancy).toEqual({
      reason: 'outcome-mismatch',
      published: 'logrado',
      recomputed: 'fallido',
    });
    expect(evaluationPublicStatus(state)).toBe('anulada-por-inconsistencia');
    expect(evaluationReport(state, scenario.frozen).outcome).toBe('fallido');
  });

  it('cambiar sólo la HUELLA del resultado también se declara', async () => {
    const scenario = await openedEvaluation(1, 4_900);
    let log = await assessAll(scenario, ['incumplido']);
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(scenario.base + 40), at: instant(OPENED_AT + 50), by: auditor },
      scenario.frozen,
    );
    const last = log.at(-1)!;
    const forged = await appendChained<EvaluationPayload>(log.slice(0, -1), {
      eventId: last.eventId,
      aggregateId: last.aggregateId,
      occurredAt: last.occurredAt,
      actor: last.actor,
      payload: {
        type: 'EvaluationResultPublished',
        outcome: 'fallido',
        outcomeHash: hash('5'.repeat(64)),
      },
    });
    const state = await verifyEvaluationLog([...log.slice(0, -1), forged], scenario.frozen);
    expect(state.discrepancy?.reason).toBe('outcome-hash-mismatch');
    expect(evaluationPublicStatus(state)).toBe('anulada-por-inconsistencia');
  });

  it('no se cierra un acuerdo sobre un resultado discrepante', async () => {
    const scenario = await openedEvaluation(1, 5_000);
    let log = await assessAll(scenario, ['incumplido']);
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(scenario.base + 40), at: instant(OPENED_AT + 50), by: auditor },
      scenario.frozen,
    );
    const last = log.at(-1)!;
    const forged = await appendChained<EvaluationPayload>(log.slice(0, -1), {
      eventId: last.eventId,
      aggregateId: last.aggregateId,
      occurredAt: last.occurredAt,
      actor: last.actor,
      payload: {
        type: 'EvaluationResultPublished',
        outcome: 'logrado',
        outcomeHash: hash('7'.repeat(64)),
      },
    });
    expect(
      await rejectionCode(
        closeEvaluationBy(
          [...log.slice(0, -1), forged],
          { eventId: eventIdAt(scenario.base + 41), at: instant(OPENED_AT + 60), by: facilitator },
          { disposition: 'derogar' },
          scenario.frozen,
        ),
      ),
    ).toBe('EVALUATION_RESULT_DISCREPANCY');
  });
});

describe('terminar el trabajo no es haberlo conseguido', () => {
  it('con TODAS las tareas completadas, un criterio incumplido da fallido', async () => {
    const plan = planWith(1);
    const base = 6_000;
    let initiativeLog = await activatedInitiative(plan, base);
    const milestone = milestoneId(hex32(0xd0_001));
    const task: TaskId = taskId(hex32(0xd0_002));
    initiativeLog = await planMilestoneBy(
      initiativeLog,
      { eventId: eventIdAt(base + 2), at: instant(CREATED_AT + 2), by: owner },
      {
        milestoneId: milestone,
        title: 'Ampliar el horario de la sala',
        completionCriterion: 'La portería registra la apertura ampliada durante el semestre.',
        dueAt: instant(REVIEW_AT - 1_000),
      },
    );
    const offerId = eventIdAt(base + 3);
    initiativeLog = await offerTaskBy(
      initiativeLog,
      { eventId: offerId, at: instant(CREATED_AT + 3), by: owner },
      {
        taskId: task,
        milestoneId: milestone,
        offeredTo: WORKER,
        recipient: worker,
        title: 'Gestionar la ampliación con la portería',
        description: 'Hablar con la portería y dejar registro del acuerdo de apertura ampliada.',
        effortMinutes: 60,
        dueAt: instant(REVIEW_AT - 2_000),
        dependsOn: [],
      },
    );
    const revision = (): number =>
      replayInitiative(initiativeLog).tasks.find((candidate) => candidate.taskId === task)!.lastSeq;
    const accept = { taskId: task, offerId, expectedTaskSeq: revision() };
    const acceptMeta = { eventId: eventIdAt(base + 4), at: instant(CREATED_AT + 4), by: worker };
    initiativeLog = await acceptTaskBy(
      initiativeLog,
      acceptMeta,
      accept,
      admitTaskCapacity(prepareTaskAcceptanceBy(initiativeLog, acceptMeta, accept), {
        currentLoadMinutes: 0,
        weeklyCapacityMinutes: 10_080,
      }),
    );
    initiativeLog = await startTaskBy(
      initiativeLog,
      { eventId: eventIdAt(base + 5), at: instant(CREATED_AT + 5), by: worker },
      { taskId: task, offerId, expectedTaskSeq: revision() },
    );
    const evidenceId = eventIdAt(base + 6);
    initiativeLog = await addTaskEvidenceBy(
      initiativeLog,
      { eventId: evidenceId, at: instant(CREATED_AT + 6), by: worker },
      {
        taskId: task,
        offerId,
        expectedTaskSeq: revision(),
        objectCommitment: commitment('d'),
        kindCode: 'documento',
        sizeClass: 'mediana',
        visibility: 'restricted',
      },
    );
    const deliveryId = eventIdAt(base + 7);
    initiativeLog = await deliverTaskBy(
      initiativeLog,
      { eventId: deliveryId, at: instant(CREATED_AT + 7), by: worker },
      {
        taskId: task,
        offerId,
        expectedTaskSeq: revision(),
        evidenceIds: [evidenceId],
        summaryCommitment: commitment('e'),
      },
    );
    initiativeLog = await acceptTaskReviewBy(
      initiativeLog,
      { eventId: eventIdAt(base + 8), at: instant(CREATED_AT + 8), by: owner },
      {
        taskId: task,
        deliveryId,
        expectedTaskSeq: revision(),
        outcomeCriterionEvidence: 'verificada',
      },
    );
    const initiative = replayInitiative(initiativeLog);
    expect(initiative.tasks.every((candidate) => candidate.status === 'completada')).toBe(true);

    const frozen = await freezeSuccessCriteria(plan);
    let log = await openEvaluationBy(
      { eventId: eventIdAt(base + 10), at: OPENED_AT, by: auditor },
      { evaluationId: evaluationId(hex32(0xf6_000)), initiative },
      frozen,
    );
    // El trabajo se hizo entero y el efecto prometido no se produjo. Son dos cosas distintas, y el
    // desenlace sale de la segunda.
    log = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 11), at: instant(OPENED_AT + 1), by: auditor },
      { criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' },
      frozen,
    );
    expect(recomputeEvaluationOutcome(replayEvaluation(log, frozen))).toBe('fallido');
  });

  it('se publica y se cierra con trabajo abierto: la evaluación no espera a nadie', async () => {
    const plan = planWith(1);
    const base = 6_100;
    let initiativeLog = await activatedInitiative(plan, base);
    const milestone = milestoneId(hex32(0xd1_001));
    const task: TaskId = taskId(hex32(0xd1_002));
    initiativeLog = await planMilestoneBy(
      initiativeLog,
      { eventId: eventIdAt(base + 2), at: instant(CREATED_AT + 2), by: owner },
      {
        milestoneId: milestone,
        title: 'Ampliar el horario de la sala',
        completionCriterion: 'La portería registra la apertura ampliada durante el semestre.',
        dueAt: instant(REVIEW_AT - 1_000),
      },
    );
    initiativeLog = await offerTaskBy(
      initiativeLog,
      { eventId: eventIdAt(base + 3), at: instant(CREATED_AT + 3), by: owner },
      {
        taskId: task,
        milestoneId: milestone,
        offeredTo: WORKER,
        recipient: worker,
        title: 'Gestionar la ampliación con la portería',
        description: 'Hablar con la portería y dejar registro del acuerdo de apertura ampliada.',
        effortMinutes: 60,
        dueAt: instant(REVIEW_AT - 2_000),
        dependsOn: [],
      },
    );
    const initiative = replayInitiative(initiativeLog);
    expect(initiative.tasks.every((candidate) => candidate.status !== 'completada')).toBe(true);

    const frozen = await freezeSuccessCriteria(plan);
    let log = await openEvaluationBy(
      { eventId: eventIdAt(base + 10), at: OPENED_AT, by: auditor },
      { evaluationId: evaluationId(hex32(0xf6_100)), initiative },
      frozen,
    );
    log = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 11), at: instant(OPENED_AT + 1), by: auditor },
      { criterionIndex: 0, verdict: 'sin-evidencia', evidence: 'sin-verificar' },
      frozen,
    );
    log = await recordLearningBy(
      log,
      { eventId: eventIdAt(base + 12), at: instant(OPENED_AT + 2), by: auditor },
      {
        learningId: learningId(hex32(0xa1_001)),
        kind: 'lo-que-faltaba-saber',
        statement:
          'Nadie había hablado con la portería antes de comprometer el horario, y sin ese permiso la tarea no podía empezar.',
        tags: [learningTag('horarios'), learningTag('porteria')],
      },
      frozen,
    );
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(base + 13), at: instant(OPENED_AT + 3), by: auditor },
      frozen,
    );
    log = await closeEvaluationBy(
      log,
      { eventId: eventIdAt(base + 14), at: instant(OPENED_AT + 4), by: facilitator },
      { disposition: 'derogar' },
      frozen,
    );
    const state = await verifyEvaluationLog(log, frozen);
    expect(state.status).toBe('cerrada');
    expect(state.published?.outcome).toBe('inconcluso');
    expect(state.closure?.disposition).toBe('derogar');
  });
});

describe('cerrar el acuerdo (ADR-0033)', () => {
  async function publishedWith(
    verdict: Verdict,
    base: number,
    conAprendizaje = true,
  ): Promise<Scenario & { readonly published: EvaluationLog }> {
    const scenario = await openedEvaluation(1, base);
    let log = await assessAll(scenario, [verdict]);
    if (conAprendizaje) {
      log = await recordLearningBy(
        log,
        { eventId: eventIdAt(base + 50), at: instant(OPENED_AT + 20), by: auditor },
        {
          learningId: learningId(hex32(0xa2_000 + base)),
          kind: 'lo-que-no-funciono',
          statement:
            'Comprometer un horario sin confirmar antes quién abre la sala deja la tarea bloqueada desde el primer día.',
          tags: [learningTag('horarios')],
        },
        scenario.frozen,
      );
    }
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(base + 51), at: instant(OPENED_AT + 30), by: auditor },
      scenario.frozen,
    );
    return { ...scenario, published: log };
  }

  it('mantener un acuerdo fallido no está permitido', async () => {
    const { published, frozen } = await publishedWith('incumplido', 7_000);
    expect(
      await rejectionCode(
        closeEvaluationBy(
          published,
          { eventId: eventIdAt(7_060), at: instant(OPENED_AT + 40), by: facilitator },
          { disposition: 'mantener', nextReviewAt: instant(OPENED_AT + 1_000_000) },
          frozen,
        ),
      ),
    ).toBe('CANNOT_KEEP_A_FAILED_AGREEMENT');
  });

  it('mantener exige comprometer la próxima revisión', async () => {
    const { published, frozen } = await publishedWith('cumplido', 7_100);
    expect(
      await rejectionCode(
        closeEvaluationBy(
          published,
          { eventId: eventIdAt(7_160), at: instant(OPENED_AT + 40), by: facilitator },
          { disposition: 'mantener' },
          frozen,
        ),
      ),
    ).toBe('KEEPING_NEEDS_A_NEW_REVIEW');
  });

  it('cerrar sin lograrlo exige al menos un aprendizaje', async () => {
    const { published, frozen } = await publishedWith('incumplido', 7_200, false);
    expect(
      await rejectionCode(
        closeEvaluationBy(
          published,
          { eventId: eventIdAt(7_260), at: instant(OPENED_AT + 40), by: facilitator },
          { disposition: 'enmendar' },
          frozen,
        ),
      ),
    ).toBe('CLOSING_NEEDS_A_LEARNING');
  });

  it('un miembro raso no cierra; la facilitación sí', async () => {
    const { published, frozen } = await publishedWith('cumplido', 7_300);
    expect(
      await rejectionCode(
        closeEvaluationBy(
          published,
          { eventId: eventIdAt(7_360), at: instant(OPENED_AT + 40), by: auditor },
          { disposition: 'mantener', nextReviewAt: instant(OPENED_AT + 1_000_000) },
          frozen,
        ),
      ),
    ).toBe('UNAUTHORIZED_ROLE_NOT_GRANTED');
    await expect(
      closeEvaluationBy(
        published,
        { eventId: eventIdAt(7_361), at: instant(OPENED_AT + 40), by: facilitator },
        { disposition: 'mantener', nextReviewAt: instant(OPENED_AT + 1_000_000) },
        frozen,
      ),
    ).resolves.toHaveLength(5);
  });
});

describe('la escalera del ADR-0040: sobre la tarea, y preguntando primero', () => {
  async function withBreach(
    base: number,
  ): Promise<Scenario & { readonly breached: EvaluationLog }> {
    const scenario = await openedEvaluation(1, base);
    const breached = await assessAll(scenario, ['incumplido']);
    return { ...scenario, breached };
  }

  it('no se salta el escalón: primero se pregunta, después se lleva al colectivo', async () => {
    const { breached, frozen, base } = await withBreach(8_000);
    const target = {
      criterionIndex: 0,
      targetKind: 'tarea' as const,
      taskId: taskId(hex32(0xd2_001)),
    };
    expect(
      await rejectionCode(
        escalateEvaluationBy(
          breached,
          { eventId: eventIdAt(base + 60), at: instant(OPENED_AT + 20), by: auditor },
          { ...target, rung: 'en-revision-colectiva' },
          frozen,
        ),
      ),
    ).toBe('ESCALATION_SKIPS_A_RUNG');
    const asked = await escalateEvaluationBy(
      breached,
      { eventId: eventIdAt(base + 61), at: instant(OPENED_AT + 20), by: auditor },
      { ...target, rung: 'consultada' },
      frozen,
    );
    await expect(
      escalateEvaluationBy(
        asked,
        { eventId: eventIdAt(base + 62), at: instant(OPENED_AT + 21), by: auditor },
        { ...target, rung: 'en-revision-colectiva' },
        frozen,
      ),
    ).resolves.toHaveLength(4);
  });

  it('no se escala un criterio cumplido', async () => {
    const scenario = await openedEvaluation(1, 8_100);
    const met = await assessAll(scenario, ['cumplido']);
    expect(
      await rejectionCode(
        escalateEvaluationBy(
          met,
          { eventId: eventIdAt(8_160), at: instant(OPENED_AT + 20), by: auditor },
          { criterionIndex: 0, rung: 'consultada', targetKind: 'acuerdo' },
          scenario.frozen,
        ),
      ),
    ).toBe('ESCALATION_WITHOUT_BREACH');
  });

  it('escalar sobre una tarea exige decir cuál; sobre acuerdo o carga, no señala ninguna', async () => {
    const { breached, frozen, base } = await withBreach(8_200);
    expect(
      await rejectionCode(
        escalateEvaluationBy(
          breached,
          { eventId: eventIdAt(base + 60), at: instant(OPENED_AT + 20), by: auditor },
          { criterionIndex: 0, rung: 'consultada', targetKind: 'tarea' },
          frozen,
        ),
      ),
    ).toBe('ESCALATION_TARGET_MISSING');
    expect(
      await rejectionCode(
        escalateEvaluationBy(
          breached,
          { eventId: eventIdAt(base + 61), at: instant(OPENED_AT + 20), by: auditor },
          {
            criterionIndex: 0,
            rung: 'consultada',
            targetKind: 'carga',
            taskId: taskId(hex32(0xd2_002)),
          },
          frozen,
        ),
      ),
    ).toBe('ESCALATION_TARGET_MISMATCH');
  });
});

describe('la tabla de transiciones es un dato, y lo que no está no existe', () => {
  it('la tabla tiene exactamente ocho parejas legales', () => {
    const legales: string[] = [];
    for (const from of EVALUATION_LIFECYCLE) {
      for (const type of EVALUATION_EVENT_TYPES) {
        if (isLegalEvaluationTransition(from, type)) legales.push(`${from}/${type}`);
      }
    }
    expect(legales).toHaveLength(8);
    expect(legales).not.toContain('publicada/CriterionAssessed');
    expect(legales).not.toContain('en-curso/EvaluationClosed');
    for (const type of EVALUATION_EVENT_TYPES) {
      expect(legales).not.toContain(`cerrada/${type}`);
    }
  });

  it('toda pareja ausente de la tabla se rechaza al plegar', async () => {
    const scenario = await openedEvaluation(1, 9_000);
    const state = replayEvaluation(scenario.log, scenario.frozen);
    const from: EvaluationLifecycle = 'en-curso';
    let probadas = 0;
    for (const type of EVALUATION_EVENT_TYPES) {
      if (isLegalEvaluationTransition(from, type)) continue;
      probadas += 1;
      const payload: EvaluationPayload =
        type === 'EvaluationClosed'
          ? { type, disposition: 'mantener' }
          : ({ type } as unknown as EvaluationPayload);
      const prospective = {
        eventId: eventIdAt(9_060),
        aggregateId: state.evaluationId,
        seq: state.lastSeq + 1,
        occurredAt: instant(OPENED_AT + 1),
        actor: AUDITOR,
        payload,
        prevHash: scenario.log.at(-1)!.hash,
        hash: scenario.log.at(-1)!.hash,
      } as EvaluationEvent;
      expect(
        throwCode(() => replayEvaluation([...scenario.log, prospective], scenario.frozen)),
      ).not.toBe(NO_THREW);
    }
    // `EvaluationOpened` y `EvaluationClosed` son las dos ilegales desde `en-curso`.
    expect(probadas).toBe(2);
  });

  it('una evaluación cerrada no se reabre', async () => {
    const scenario = await openedEvaluation(1, 9_100);
    let log = await assessAll(scenario, ['cumplido']);
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(9_160), at: instant(OPENED_AT + 20), by: auditor },
      scenario.frozen,
    );
    log = await closeEvaluationBy(
      log,
      { eventId: eventIdAt(9_161), at: instant(OPENED_AT + 21), by: facilitator },
      { disposition: 'mantener', nextReviewAt: instant(OPENED_AT + 9_000_000) },
      scenario.frozen,
    );
    expect(
      await rejectionCode(
        recordLearningBy(
          log,
          { eventId: eventIdAt(9_162), at: instant(OPENED_AT + 22), by: auditor },
          {
            learningId: learningId(hex32(0xa3_001)),
            kind: 'lo-que-funciono',
            statement:
              'Confirmar con la portería antes de comprometer el horario es lo que permitió que la tarea empezara el primer día.',
            tags: [],
          },
          scenario.frozen,
        ),
      ),
    ).toBe('ILLEGAL_TRANSITION');
  });

  it('después de publicar no se mueve un veredicto', async () => {
    const scenario = await openedEvaluation(1, 9_200);
    let log = await assessAll(scenario, ['incumplido']);
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(9_260), at: instant(OPENED_AT + 20), by: auditor },
      scenario.frozen,
    );
    expect(
      await rejectionCode(
        assessCriterionBy(
          log,
          { eventId: eventIdAt(9_261), at: instant(OPENED_AT + 21), by: auditor },
          {
            criterionIndex: 0,
            verdict: 'cumplido',
            evidence: 'verificada',
            evidenceRef: SOME_EVIDENCE,
          },
          scenario.frozen,
        ),
      ),
    ).toBe('ILLEGAL_TRANSITION');
  });
});
