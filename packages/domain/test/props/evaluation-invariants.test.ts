/**
 * Invariantes de la evaluación, el resultado y los aprendizajes (ADR-0053).
 *
 * Semilla fija `30_000_821`, la misma del resto del catálogo: los contraejemplos son reproducibles
 * entre ejecuciones y entre máquinas.
 *
 *  - **INV-E1** los criterios congelados son idénticos antes y después de cualquier evaluación;
 *  - **INV-E2** un log forjado que los altere lo rechaza **el pliegue**, con la cadena rehecha;
 *  - **INV-E3** el desenlace se recomputa, y una discrepancia con lo publicado se declara;
 *  - **INV-E4** completar el trabajo no declara éxito: `logrado` sólo sale de los veredictos;
 *  - **INV-E5** se cierra con fracaso o inconcluso, con trabajo abierto y sin que nadie lo admita;
 *  - **INV-E6** ninguna salida contiene una métrica de actividad por persona;
 *  - **INV-E7** ninguna transición fuera de la tabla se acepta.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  activateInitiative,
  type Actor,
  appendChained,
  assessCriterionBy,
  assertNoIndividualActivityMetric,
  closeEvaluationBy,
  createInitiative,
  cmpFraction,
  escalateEvaluationBy,
  EVALUATION_EVENT_TYPES,
  type EvaluationEvent,
  type EvaluationEventType,
  type EvaluationLog,
  type EvaluationOutcome,
  type EvaluationPayload,
  type EvaluationState,
  evaluationId,
  evaluationPublicStatus,
  evaluationReport,
  type ExecutionPlan,
  executionPlanHash,
  freezeSuccessCriteria,
  type FrozenCriteria,
  hash,
  initiativeId,
  instant,
  isLegalEvaluationTransition,
  learningId,
  learningsOf,
  learningTag,
  MAX_SUCCESS_CRITERIA,
  ONE,
  outcomeFromVerdicts,
  publishEvaluationResultBy,
  ratio,
  recomputeEvaluationOutcome,
  recordLearningBy,
  openEvaluationBy,
  replayEvaluation,
  replayInitiative,
  taskId,
  verifyEvaluationLog,
  type CriterionVerdict,
} from '../../src/index.js';
import {
  circleIdAt,
  DECISION_ID,
  eventIdAt,
  FC,
  hex32,
  memberIdAt,
  PROPOSAL_ID,
  runs,
  T0,
} from '../arbitraries.js';

const CREATED_AT = instant(T0 + 10_000);
const REVIEW_AT = instant(CREATED_AT + 1_000_000);
const OPENED_AT = instant(REVIEW_AT + 1_000);
const CIRCLE = circleIdAt(1);
const RESPONSIBLE = memberIdAt(101);
const AUDITOR = memberIdAt(103);
const EVIDENCE = eventIdAt(777);

const auditor: Actor = { memberId: AUDITOR, roles: ['member'], circles: [CIRCLE] };
const facilitator: Actor = { memberId: AUDITOR, roles: ['facilitator'], circles: [CIRCLE] };

const VERDICTS: readonly CriterionVerdict[] = [
  'cumplido',
  'incumplido',
  'sin-evidencia',
  'no-aplica',
];

const arbVerdict: fc.Arbitrary<CriterionVerdict> = fc.constantFrom(...VERDICTS);

const arbVerdicts: fc.Arbitrary<readonly CriterionVerdict[]> = fc.array(arbVerdict, {
  minLength: 1,
  maxLength: MAX_SUCCESS_CRITERIA,
});

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

interface Opened {
  readonly plan: ExecutionPlan;
  readonly frozen: FrozenCriteria;
  readonly log: EvaluationLog;
}

/**
 * Abrir una evaluación cuesta cuatro hashes. Se memoiza por número de criterios porque el escenario
 * no depende de los veredictos y así las propiedades caras siguen cabiendo en la ejecución diaria.
 */
const cache = new Map<number, Promise<Opened>>();

function opened(criteria: number): Promise<Opened> {
  const hit = cache.get(criteria);
  if (hit !== undefined) return hit;
  const built = (async (): Promise<Opened> => {
    const plan = planWith(criteria);
    let initiative = await createInitiative(
      { eventId: eventIdAt(criteria), at: CREATED_AT, actor: 'system' },
      {
        initiativeId: initiativeId(hex32(0xe0_000 + criteria)),
        outcomeKind: 'approved',
        decisionId: DECISION_ID,
        proposalId: PROPOSAL_ID,
        proposalVersionHash: hash('a'.repeat(64)),
        decisionResultHash: hash('b'.repeat(64)),
        circleId: CIRCLE,
        executionPlan: plan,
      },
    );
    initiative = await activateInitiative(
      initiative,
      { eventId: eventIdAt(100 + criteria), at: instant(CREATED_AT + 1), actor: 'system' },
      {
        ratificationEventId: eventIdAt(200 + criteria),
        ratificationEventHash: hash('c'.repeat(64)),
      },
    );
    const frozen = await freezeSuccessCriteria(plan);
    const log = await openEvaluationBy(
      { eventId: eventIdAt(300 + criteria), at: OPENED_AT, by: auditor },
      {
        evaluationId: evaluationId(hex32(0xf0_000 + criteria)),
        initiative: replayInitiative(initiative),
      },
      frozen,
    );
    return { plan, frozen, log };
  })();
  cache.set(criteria, built);
  return built;
}

async function assessed(
  verdicts: readonly CriterionVerdict[],
): Promise<Opened & { readonly assessedLog: EvaluationLog }> {
  const scenario = await opened(verdicts.length);
  let log = scenario.log;
  for (let index = 0; index < verdicts.length; index++) {
    const verdict = verdicts[index]!;
    log = await assessCriterionBy(
      log,
      { eventId: eventIdAt(1_000 + index), at: instant(OPENED_AT + 1 + index), by: auditor },
      verdict === 'cumplido'
        ? { criterionIndex: index, verdict, evidence: 'verificada', evidenceRef: EVIDENCE }
        : verdict === 'no-aplica'
          ? { criterionIndex: index, verdict, evidence: 'no-aplica' }
          : { criterionIndex: index, verdict, evidence: 'sin-verificar' },
      scenario.frozen,
    );
  }
  return { ...scenario, assessedLog: log };
}

/** Rehace la cadena entera desde los payloads: el log resultante verifica sin una sola rotura. */
async function reforge(
  log: EvaluationLog,
  edit: (payload: EvaluationPayload) => EvaluationPayload,
): Promise<EvaluationLog> {
  let forged: EvaluationLog = [];
  for (const source of log) {
    const event = await appendChained<EvaluationPayload>(forged, {
      eventId: source.eventId,
      aggregateId: source.aggregateId,
      occurredAt: source.occurredAt,
      actor: source.actor,
      payload: edit({ ...source.payload }),
    });
    forged = [...forged, event];
  }
  return forged;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    const code: unknown = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : `SIN_CODIGO(${String(error)})`;
  }
  return 'NO_LANZO';
}

const serialize = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );

// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-E1 · los criterios congelados no se mueven', () => {
  it('la huella y el texto son idénticos antes y después de plegar cualquier evaluación', async () => {
    await fc.assert(
      fc.asyncProperty(arbVerdicts, async (verdicts) => {
        const scenario = await assessed(verdicts);
        const antes = {
          planHash: scenario.frozen.planHash,
          criteria: scenario.frozen.criteria.map((criterion) => ({ ...criterion })),
        };
        const state = replayEvaluation(scenario.assessedLog, scenario.frozen);
        expect(scenario.frozen.planHash).toBe(antes.planHash);
        expect(scenario.frozen.criteria).toEqual(antes.criteria);
        expect(state.planHash).toBe(antes.planHash);
        expect(state.criteriaCount).toBe(antes.criteria.length);
        // Y no sólo por tipo: el objeto está congelado de verdad.
        expect(Object.isFrozen(scenario.frozen)).toBe(true);
        expect(Object.isFrozen(scenario.frozen.criteria)).toBe(true);
        expect(await executionPlanHash(scenario.plan)).toBe(antes.planHash);
      }),
      runs(60),
    );
  });
});

describe('INV-E2 · un log forjado que altere los criterios lo rechaza el pliegue', () => {
  it('cambiar el texto de cualquier criterio deja el log sin plegar', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: MAX_SUCCESS_CRITERIA }),
        fc.nat(),
        async (criteria, pick) => {
          const scenario = await opened(criteria);
          const index = pick % criteria;
          const retocado: ExecutionPlan = {
            ...scenario.plan,
            successCriteria: scenario.plan.successCriteria.map((criterion, i) =>
              i === index
                ? {
                    description: `Basta con que la sala abra algún día suelto del semestre ${String(i)}.`,
                    evidenceSource: criterion.evidenceSource,
                  }
                : criterion,
            ),
          };
          const otros = await freezeSuccessCriteria(retocado);
          expect(codeOf(() => replayEvaluation(scenario.log, otros))).toBe(
            'EVALUATION_CRITERIA_TAMPERED',
          );
        },
      ),
      runs(40),
    );
  });

  it('cambiar la huella o la cardinalidad selladas, con la cadena rehecha, tampoco pliega', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: MAX_SUCCESS_CRITERIA }),
        fc.integer({ min: 0, max: 15 }),
        async (criteria, nibble) => {
          const scenario = await opened(criteria);
          const otroHash = hash(nibble.toString(16).repeat(64));
          const conHuella = await reforge(scenario.log, (payload) =>
            payload.type === 'EvaluationOpened' ? { ...payload, planHash: otroHash } : payload,
          );
          // La cadena está intacta: el forjador rehízo todos los eslabones.
          expect(codeOf(() => replayEvaluation(conHuella, scenario.frozen))).toBe(
            'EVALUATION_CRITERIA_TAMPERED',
          );
          await expect(verifyEvaluationLog(conHuella, scenario.frozen)).rejects.toBeDefined();

          const otraCardinalidad = criteria === MAX_SUCCESS_CRITERIA ? criteria - 1 : criteria + 1;
          const conNumero = await reforge(scenario.log, (payload) =>
            payload.type === 'EvaluationOpened'
              ? { ...payload, criteriaCount: otraCardinalidad }
              : payload,
          );
          expect(codeOf(() => replayEvaluation(conNumero, scenario.frozen))).toBe(
            'EVALUATION_CRITERIA_TAMPERED',
          );
        },
      ),
      runs(25),
    );
  });
});

describe('INV-E3 · el desenlace se recomputa y la discrepancia se declara', () => {
  it('lo publicado por la orden coincide siempre con lo recomputado', async () => {
    await fc.assert(
      fc.asyncProperty(arbVerdicts, async (verdicts) => {
        const scenario = await assessed(verdicts);
        const published = await publishEvaluationResultBy(
          scenario.assessedLog,
          { eventId: eventIdAt(2_000), at: instant(OPENED_AT + 500), by: auditor },
          scenario.frozen,
        );
        const state = await verifyEvaluationLog(published, scenario.frozen);
        expect(state.discrepancy).toBeUndefined();
        expect(state.published?.outcome).toBe(outcomeFromVerdicts(verdicts));
        expect(evaluationPublicStatus(state)).toBe('publicada');
      }),
      runs(40),
    );
  });

  it('sustituir el desenlace guardado por cualquier otro se declara y anula lo publicado', async () => {
    const arbOtherOutcome: fc.Arbitrary<EvaluationOutcome> = fc.constantFrom(
      'logrado',
      'parcial',
      'fallido',
      'inconcluso',
    );
    await fc.assert(
      fc.asyncProperty(arbVerdicts, arbOtherOutcome, async (verdicts, sustituto) => {
        const real = outcomeFromVerdicts(verdicts);
        fc.pre(sustituto !== real);
        const scenario = await assessed(verdicts);
        const published = await publishEvaluationResultBy(
          scenario.assessedLog,
          { eventId: eventIdAt(2_100), at: instant(OPENED_AT + 500), by: auditor },
          scenario.frozen,
        );
        const forged = await reforge(published, (payload) =>
          payload.type === 'EvaluationResultPublished'
            ? { ...payload, outcome: sustituto }
            : payload,
        );
        const state = await verifyEvaluationLog(forged, scenario.frozen);
        expect(state.discrepancy).toEqual({
          reason: 'outcome-mismatch',
          published: sustituto,
          recomputed: real,
        });
        expect(evaluationPublicStatus(state)).toBe('anulada-por-inconsistencia');
        // Y lo que enseña el informe sigue siendo lo recomputado, no lo guardado.
        expect(evaluationReport(state, scenario.frozen).outcome).toBe(real);
        // Sobre un resultado que no cuadra no se cierra ningún acuerdo.
        await expect(
          closeEvaluationBy(
            forged,
            { eventId: eventIdAt(2_150), at: instant(OPENED_AT + 600), by: facilitator },
            { disposition: 'derogar' },
            scenario.frozen,
          ),
        ).rejects.toBeDefined();
      }),
      runs(25),
    );
  });
});

describe('INV-E4 · completar el trabajo no declara éxito', () => {
  it('`logrado` sale si y sólo si todos los criterios aplicables están cumplidos, y hay alguno', () => {
    fc.assert(
      fc.property(arbVerdicts, (verdicts) => {
        const aplicables = verdicts.filter((verdict) => verdict !== 'no-aplica');
        const cumplidos = verdicts.filter((verdict) => verdict === 'cumplido');
        const esperado =
          aplicables.length > 0 && cumplidos.length === aplicables.length ? 'logrado' : 'distinto';
        const obtenido = outcomeFromVerdicts(verdicts) === 'logrado' ? 'logrado' : 'distinto';
        expect(obtenido).toBe(esperado);
      }),
      { ...FC, numRuns: Math.min(FC.numRuns, 2_000) },
    );
  });

  it('un solo criterio sin evidencia deja todo inconcluso, y el silencio también', () => {
    fc.assert(
      fc.property(arbVerdicts, (verdicts) => {
        if (verdicts.includes('sin-evidencia')) {
          expect(outcomeFromVerdicts(verdicts)).toBe('inconcluso');
        }
        // Los criterios sin valorar entran como `undefined` y se leen «sin evidencia».
        const conHueco = [...verdicts, undefined];
        expect(outcomeFromVerdicts(conHueco)).toBe('inconcluso');
      }),
      { ...FC, numRuns: Math.min(FC.numRuns, 2_000) },
    );
  });

  it('el umbral de `parcial` es exacto: se compara por multiplicación cruzada, sin decimales', () => {
    fc.assert(
      fc.property(arbVerdicts, (verdicts) => {
        const aplicables = verdicts.filter((verdict) => verdict !== 'no-aplica').length;
        const cumplidos = verdicts.filter((verdict) => verdict === 'cumplido').length;
        const outcome = outcomeFromVerdicts(verdicts);
        if (verdicts.includes('sin-evidencia') || aplicables === 0) {
          expect(outcome).toBe('inconcluso');
          return;
        }
        const share = ratio(cumplidos, aplicables);
        if (cmpFraction(share, ONE) === 0) expect(outcome).toBe('logrado');
        else if (cmpFraction(share, { num: 1n, den: 2n }) >= 0) expect(outcome).toBe('parcial');
        else expect(outcome).toBe('fallido');
      }),
      { ...FC, numRuns: Math.min(FC.numRuns, 2_000) },
    );
  });
});

describe('INV-E5 · se puede cerrar en fracaso o inconcluso, con trabajo abierto', () => {
  it('cualquier desenlace adverso se publica y se cierra sin que nadie lo admita', async () => {
    const arbAdverse = arbVerdicts.filter(
      (verdicts) => outcomeFromVerdicts(verdicts) !== 'logrado',
    );
    await fc.assert(
      fc.asyncProperty(
        arbAdverse,
        fc.constantFrom('derogar' as const, 'enmendar' as const, 'escalar' as const),
        async (verdicts, disposition) => {
          const scenario = await assessed(verdicts);
          let log = await recordLearningBy(
            scenario.assessedLog,
            { eventId: eventIdAt(3_000), at: instant(OPENED_AT + 400), by: auditor },
            {
              learningId: learningId(hex32(0xb0_001)),
              kind: 'lo-que-no-funciono',
              statement:
                'Comprometer una apertura que depende de un tercero sin confirmarlo antes deja la tarea muerta desde el día uno.',
              tags: [learningTag('horarios')],
            },
            scenario.frozen,
          );
          log = await publishEvaluationResultBy(
            log,
            { eventId: eventIdAt(3_001), at: instant(OPENED_AT + 500), by: auditor },
            scenario.frozen,
          );
          log = await closeEvaluationBy(
            log,
            { eventId: eventIdAt(3_002), at: instant(OPENED_AT + 600), by: facilitator },
            { disposition },
            scenario.frozen,
          );
          const state = await verifyEvaluationLog(log, scenario.frozen);
          expect(state.status).toBe('cerrada');
          expect(state.closure?.disposition).toBe(disposition);
          expect(['parcial', 'fallido', 'inconcluso']).toContain(recomputeEvaluationOutcome(state));
          // Y la memoria conserva el aprendizaje del intento fallido.
          expect(learningsOf(state)).toHaveLength(1);
        },
      ),
      runs(20),
    );
  });

  it('mantener un acuerdo fallido no se puede; enmendarlo o derogarlo sí', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constant<CriterionVerdict>('incumplido'), { minLength: 1, maxLength: 4 }),
        async (verdicts) => {
          const scenario = await assessed(verdicts);
          let log = await recordLearningBy(
            scenario.assessedLog,
            { eventId: eventIdAt(3_100), at: instant(OPENED_AT + 400), by: auditor },
            {
              learningId: learningId(hex32(0xb0_002)),
              kind: 'lo-que-no-hay-que-repetir',
              statement:
                'Prometer una ampliación de horario sin autorización previa es el mismo error que ya se cometió el semestre pasado.',
              tags: [],
            },
            scenario.frozen,
          );
          log = await publishEvaluationResultBy(
            log,
            { eventId: eventIdAt(3_101), at: instant(OPENED_AT + 500), by: auditor },
            scenario.frozen,
          );
          await expect(
            closeEvaluationBy(
              log,
              { eventId: eventIdAt(3_102), at: instant(OPENED_AT + 600), by: facilitator },
              { disposition: 'mantener', nextReviewAt: instant(OPENED_AT + 9_000_000) },
              scenario.frozen,
            ),
          ).rejects.toBeDefined();
          await expect(
            closeEvaluationBy(
              log,
              { eventId: eventIdAt(3_103), at: instant(OPENED_AT + 600), by: facilitator },
              { disposition: 'enmendar' },
              scenario.frozen,
            ),
          ).resolves.toBeDefined();
        },
      ),
      runs(15),
    );
  });
});

describe('INV-E6 · ninguna salida lleva una métrica de actividad por persona', () => {
  it('estado, informe y memoria pasan el guardián y no contienen a nadie', async () => {
    await fc.assert(
      fc.asyncProperty(arbVerdicts, fc.boolean(), async (verdicts, conEscalada) => {
        const scenario = await assessed(verdicts);
        let log = scenario.assessedLog;
        const index = verdicts.findIndex(
          (verdict) => verdict === 'incumplido' || verdict === 'sin-evidencia',
        );
        if (conEscalada && index !== -1) {
          log = await escalateEvaluationBy(
            log,
            { eventId: eventIdAt(4_000), at: instant(OPENED_AT + 300), by: auditor },
            {
              criterionIndex: index,
              rung: 'consultada',
              targetKind: 'tarea',
              taskId: taskId(hex32(0xd9_001)),
            },
            scenario.frozen,
          );
        }
        log = await recordLearningBy(
          log,
          { eventId: eventIdAt(4_001), at: instant(OPENED_AT + 400), by: auditor },
          {
            learningId: learningId(hex32(0xb9_001)),
            kind: 'lo-que-faltaba-saber',
            statement:
              'La apertura nocturna necesita una autorización aparte que nadie había pedido cuando se acordó el horario.',
            tags: [learningTag('permisos')],
          },
          scenario.frozen,
        );
        const state = replayEvaluation(log, scenario.frozen);
        const report = evaluationReport(state, scenario.frozen);
        expect(() => {
          assertNoIndividualActivityMetric(state);
        }).not.toThrow();
        expect(() => {
          assertNoIndividualActivityMetric(report);
        }).not.toThrow();
        expect(() => {
          assertNoIndividualActivityMetric(learningsOf(state));
        }).not.toThrow();
        for (const salida of [state, report, learningsOf(state)]) {
          const texto = serialize(salida);
          expect(texto).not.toContain(RESPONSIBLE);
          expect(texto).not.toContain(AUDITOR);
        }
      }),
      runs(25),
    );
  });
});

describe('INV-E7 · ninguna transición ilegal se acepta', () => {
  function wellFormed(type: EvaluationEventType, state: EvaluationState): EvaluationPayload {
    switch (type) {
      case 'EvaluationOpened':
        return {
          type,
          initiativeId: state.initiativeId,
          decisionId: state.decisionId,
          proposalId: state.proposalId,
          circleId: state.circleId,
          planHash: state.planHash,
          criteriaCount: state.criteriaCount,
          reviewAt: state.reviewAt,
        };
      case 'CriterionAssessed':
        return { type, criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' };
      case 'EvaluationEscalated':
        return { type, criterionIndex: 0, rung: 'consultada', targetKind: 'acuerdo' };
      case 'LearningRecorded':
        return {
          type,
          learningId: learningId(hex32(0xbb_001)),
          kind: 'lo-que-funciono',
          statement:
            'Confirmar con la portería antes de comprometer el horario permitió que la tarea empezara el primer día.',
          tags: [],
        };
      case 'EvaluationResultPublished':
        return { type, outcome: 'fallido', outcomeHash: hash('4'.repeat(64)) };
      case 'EvaluationClosed':
        return { type, disposition: 'derogar' };
    }
  }

  async function logInStatus(
    status: 'en-curso' | 'publicada' | 'cerrada',
  ): Promise<{ readonly log: EvaluationLog; readonly frozen: FrozenCriteria }> {
    const scenario = await assessed(['incumplido']);
    if (status === 'en-curso') return { log: scenario.assessedLog, frozen: scenario.frozen };
    let log = await recordLearningBy(
      scenario.assessedLog,
      { eventId: eventIdAt(5_000), at: instant(OPENED_AT + 400), by: auditor },
      {
        learningId: learningId(hex32(0xbc_001)),
        kind: 'lo-que-no-funciono',
        statement:
          'Comprometer una apertura que depende de un tercero sin confirmarlo antes deja la tarea muerta desde el día uno.',
        tags: [],
      },
      scenario.frozen,
    );
    log = await publishEvaluationResultBy(
      log,
      { eventId: eventIdAt(5_001), at: instant(OPENED_AT + 500), by: auditor },
      scenario.frozen,
    );
    if (status === 'publicada') return { log, frozen: scenario.frozen };
    log = await closeEvaluationBy(
      log,
      { eventId: eventIdAt(5_002), at: instant(OPENED_AT + 600), by: facilitator },
      { disposition: 'derogar' },
      scenario.frozen,
    );
    return { log, frozen: scenario.frozen };
  }

  it('el producto cartesiano estado × evento: lo que no está en la tabla lanza', async () => {
    const estados = ['en-curso', 'publicada', 'cerrada'] as const;
    let ilegalesProbadas = 0;
    for (const status of estados) {
      const { log, frozen } = await logInStatus(status);
      const state = replayEvaluation(log, frozen);
      expect(state.status).toBe(status);
      for (const type of EVALUATION_EVENT_TYPES) {
        if (isLegalEvaluationTransition(status, type)) continue;
        ilegalesProbadas += 1;
        const prospective = {
          eventId: eventIdAt(6_000),
          aggregateId: state.evaluationId,
          seq: state.lastSeq + 1,
          occurredAt: instant(OPENED_AT + 900),
          actor: AUDITOR,
          payload: wellFormed(type, state),
          prevHash: log.at(-1)!.hash,
          hash: log.at(-1)!.hash,
        } as EvaluationEvent;
        expect(codeOf(() => replayEvaluation([...log, prospective], frozen))).toBe(
          'ILLEGAL_TRANSITION',
        );
      }
    }
    // 3 estados × 6 eventos = 18 parejas; 7 son legales desde un estado existente.
    expect(ilegalesProbadas).toBe(11);
  });

  it('un evento fuera de secuencia o de otro agregado tampoco entra', async () => {
    const { log, frozen } = await logInStatus('en-curso');
    const state = replayEvaluation(log, frozen);
    const base = {
      eventId: eventIdAt(6_100),
      occurredAt: instant(OPENED_AT + 900),
      actor: AUDITOR,
      payload: wellFormed('LearningRecorded', state),
      prevHash: log.at(-1)!.hash,
      hash: log.at(-1)!.hash,
    };
    expect(
      codeOf(() =>
        replayEvaluation(
          [...log, { ...base, aggregateId: state.evaluationId, seq: state.lastSeq + 5 }],
          frozen,
        ),
      ),
    ).toBe('NON_CONSECUTIVE_EVALUATION_EVENT');
    expect(
      codeOf(() =>
        replayEvaluation(
          [
            ...log,
            {
              ...base,
              aggregateId: evaluationId(hex32(0xdead)),
              seq: state.lastSeq + 1,
            },
          ],
          frozen,
        ),
      ),
    ).toBe('WRONG_AGGREGATE');
  });
});
