/**
 * Memoria institucional y la prohibición del ADR-0040.
 *
 * Dos preguntas, y las dos tienen que poder contestarse dentro de cinco años, cuando ya no quede
 * nadie de los que estuvieron:
 *
 *  - «¿esto ya se intentó?» — y la respuesta tiene que decir qué se hizo, cómo salió y qué se
 *    aprendió;
 *  - «¿y quién lo hizo mal?» — y la respuesta tiene que ser que el sistema no lo sabe, porque no lo
 *    proyecta. Lo que sí sabe es qué tarea, qué acuerdo o qué carga quedó en revisión.
 */

import { describe, expect, it } from 'vitest';

import {
  activateInitiative,
  type Actor,
  assessCriterionBy,
  assertNoIndividualActivityMetric,
  closeEvaluationBy,
  createInitiative,
  ESCALATION_PRESCRIPTION_MS,
  escalateEvaluationBy,
  escalationsInForce,
  type EvaluationLog,
  evaluationId,
  evaluationMetShare,
  evaluationReport,
  type ExecutionPlan,
  findLearnings,
  freezeSuccessCriteria,
  type FrozenCriteria,
  hash,
  type InitiativeLog,
  initiativeId,
  instant,
  type LearningIndexEntry,
  learningId,
  learningTag,
  learningsOf,
  publishEvaluationResultBy,
  PROPOSED_EVALUATION_ACCESS_RULES,
  recordLearningBy,
  openEvaluationBy,
  replayEvaluation,
  replayInitiative,
  taskId,
  toFractionString,
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

const CREATED_AT = instant(T0 + 10_000);
const REVIEW_AT = instant(CREATED_AT + 1_000_000);
const OPENED_AT = instant(REVIEW_AT + 1_000);
const CIRCLE = circleIdAt(1);
const RESPONSIBLE = memberIdAt(101);
const AUDITOR = memberIdAt(103);

const auditor: Actor = { memberId: AUDITOR, roles: ['member'], circles: [CIRCLE] };
const facilitator: Actor = { memberId: AUDITOR, roles: ['facilitator'], circles: [CIRCLE] };

/** Las fracciones exactas llevan `bigint`, que `JSON.stringify` no sabe serializar solo. */
const serialize = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );

function planWith(criteria: number): ExecutionPlan {
  return {
    objective: 'Ampliar el horario de la sala de estudio para el semestre entrante.',
    responsibleId: RESPONSIBLE,
    reviewAt: REVIEW_AT,
    successCriteria: Array.from({ length: criteria }, (_, index) => ({
      description: `La sala abre hasta las diez de la noche los días hábiles del semestre ${String(index)}.`,
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
  readonly frozen: FrozenCriteria;
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
  return { frozen, log, base };
}

describe('el informe no contiene a nadie (ADR-0040)', () => {
  it('un informe real pasa el guardián', async () => {
    const { log, frozen, base } = await openedEvaluation(2, 1_000);
    let next = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
      {
        criterionIndex: 0,
        verdict: 'cumplido',
        evidence: 'verificada',
        evidenceRef: eventIdAt(777),
      },
      frozen,
    );
    next = await assessCriterionBy(
      next,
      { eventId: eventIdAt(base + 21), at: instant(OPENED_AT + 2), by: auditor },
      { criterionIndex: 1, verdict: 'incumplido', evidence: 'sin-verificar' },
      frozen,
    );
    const state = replayEvaluation(next, frozen);
    const report = evaluationReport(state, frozen);
    expect(() => {
      assertNoIndividualActivityMetric(report);
    }).not.toThrow();
    expect(serialize(report)).not.toContain(RESPONSIBLE);
    expect(serialize(report)).not.toContain(AUDITOR);
    expect(report.outcome).toBe('parcial');
    expect(toFractionString(evaluationMetShare(state)!)).toBe('1/2');
  });

  it('el guardián rechaza una serie por persona, un ranking y un campo con identidad', () => {
    expect(() => {
      assertNoIndividualActivityMetric({ cumplimiento: { [RESPONSIBLE]: 90 } });
    }).toThrow();
    expect(() => {
      assertNoIndividualActivityMetric({ ranking: [{ memberId: RESPONSIBLE, tareas: 12 }] });
    }).toThrow();
    expect(() => {
      assertNoIndividualActivityMetric({ escalada: { actor: RESPONSIBLE } });
    }).toThrow();
    // Lo que sí se admite: el objeto de la escalada, que es una tarea.
    expect(() => {
      assertNoIndividualActivityMetric({ escalada: { taskId: hex32(7), rung: 'consultada' } });
    }).not.toThrow();
  });

  it('el estado plegado tampoco guarda el actor de ningún evento', async () => {
    const { log, frozen, base } = await openedEvaluation(1, 1_100);
    const next = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
      { criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' },
      frozen,
    );
    const state = replayEvaluation(next, frozen);
    expect(() => {
      assertNoIndividualActivityMetric(state);
    }).not.toThrow();
    // El actor sigue en el log encadenado —como en todo el sistema—, pero no en la proyección.
    expect(next.every((event) => event.actor === AUDITOR)).toBe(true);
  });

  it('la escalada nombra la tarea y no a quien la tiene', async () => {
    const { log, frozen, base } = await openedEvaluation(1, 1_200);
    let next = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
      { criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' },
      frozen,
    );
    const tarea = taskId(hex32(0xd5_001));
    next = await escalateEvaluationBy(
      next,
      { eventId: eventIdAt(base + 21), at: instant(OPENED_AT + 2), by: auditor },
      { criterionIndex: 0, rung: 'consultada', targetKind: 'tarea', taskId: tarea },
      frozen,
    );
    const state = replayEvaluation(next, frozen);
    expect(state.escalations[0]?.taskId).toBe(tarea);
    expect(() => {
      assertNoIndividualActivityMetric(evaluationReport(state, frozen));
    }).not.toThrow();
  });

  it('las escaladas prescriben a los dos semestres; los aprendizajes no', async () => {
    const { log, frozen, base } = await openedEvaluation(1, 1_300);
    let next = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
      { criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' },
      frozen,
    );
    next = await escalateEvaluationBy(
      next,
      { eventId: eventIdAt(base + 21), at: instant(OPENED_AT + 2), by: auditor },
      { criterionIndex: 0, rung: 'consultada', targetKind: 'acuerdo' },
      frozen,
    );
    next = await recordLearningBy(
      next,
      { eventId: eventIdAt(base + 22), at: instant(OPENED_AT + 3), by: auditor },
      {
        learningId: learningId(hex32(0xa5_001)),
        kind: 'lo-que-no-hay-que-repetir',
        statement:
          'Comprometer una apertura que depende de un tercero sin haberlo confirmado antes deja la tarea muerta desde el día uno.',
        tags: [learningTag('horarios')],
      },
      frozen,
    );
    const state = replayEvaluation(next, frozen);
    const justoAntes = instant(OPENED_AT + 2 + ESCALATION_PRESCRIPTION_MS - 1);
    const justoDespues = instant(OPENED_AT + 2 + ESCALATION_PRESCRIPTION_MS);
    expect(escalationsInForce(state, justoAntes)).toHaveLength(1);
    expect(escalationsInForce(state, justoDespues)).toHaveLength(0);
    expect(state.learnings).toHaveLength(1);
    expect(learningsOf(state)).toHaveLength(1);
  });
});

describe('«¿esto ya se intentó?»', () => {
  async function evaluationWithLearnings(base: number): Promise<Scenario> {
    const { log, frozen } = await openedEvaluation(1, base);
    let next = await assessCriterionBy(
      log,
      { eventId: eventIdAt(base + 20), at: instant(OPENED_AT + 1), by: auditor },
      { criterionIndex: 0, verdict: 'incumplido', evidence: 'sin-verificar' },
      frozen,
    );
    next = await recordLearningBy(
      next,
      { eventId: eventIdAt(base + 21), at: instant(OPENED_AT + 10), by: auditor },
      {
        learningId: learningId(hex32(0xb0_000 + base)),
        kind: 'lo-que-no-funciono',
        statement:
          'Ampliar el horario sin acordar antes con la portería quién abre no funcionó, y ya se había intentado.',
        tags: [learningTag('horarios'), learningTag('porteria')],
      },
      frozen,
    );
    next = await recordLearningBy(
      next,
      { eventId: eventIdAt(base + 22), at: instant(OPENED_AT + 20), by: auditor },
      {
        learningId: learningId(hex32(0xb1_000 + base)),
        kind: 'lo-que-faltaba-saber',
        statement:
          'Nadie sabía que la apertura nocturna necesita una autorización aparte de la vicerrectoría.',
        tags: [learningTag('permisos')],
      },
      frozen,
    );
    next = await publishEvaluationResultBy(
      next,
      { eventId: eventIdAt(base + 23), at: instant(OPENED_AT + 30), by: auditor },
      frozen,
    );
    next = await closeEvaluationBy(
      next,
      { eventId: eventIdAt(base + 24), at: instant(OPENED_AT + 40), by: facilitator },
      { disposition: 'enmendar' },
      frozen,
    );
    return { frozen, log: next, base };
  }

  it('una entrada de memoria dice qué se decidió, cómo salió y qué se aprendió — y a nadie', async () => {
    const { log, frozen } = await evaluationWithLearnings(2_000);
    const entries = learningsOf(replayEvaluation(log, frozen));
    expect(entries).toHaveLength(2);
    const first = entries[0]!;
    expect(first.decisionId).toBe(DECISION_ID);
    expect(first.proposalId).toBe(PROPOSAL_ID);
    expect(first.outcome).toBe('fallido');
    expect(first.disposition).toBe('enmendar');
    expect(() => {
      assertNoIndividualActivityMetric(entries);
    }).not.toThrow();
  });

  it('la búsqueda filtra por etiqueta, tipo, desenlace y círculo, y es determinista', async () => {
    const a = await evaluationWithLearnings(2_100);
    const b = await evaluationWithLearnings(2_200);
    const memoria: readonly LearningIndexEntry[] = [
      ...learningsOf(replayEvaluation(a.log, a.frozen)),
      ...learningsOf(replayEvaluation(b.log, b.frozen)),
    ];
    expect(memoria).toHaveLength(4);

    const porEtiqueta = findLearnings(memoria, { tags: [learningTag('porteria')] });
    expect(porEtiqueta).toHaveLength(2);
    expect(
      porEtiqueta.every((entry) => entry.learning.tags.includes(learningTag('porteria'))),
    ).toBe(true);

    expect(findLearnings(memoria, { kinds: ['lo-que-faltaba-saber'] })).toHaveLength(2);
    expect(findLearnings(memoria, { outcomes: ['logrado'] })).toHaveLength(0);
    expect(findLearnings(memoria, { outcomes: ['fallido'] })).toHaveLength(4);
    expect(findLearnings(memoria, { circleId: circleIdAt(9) })).toHaveLength(0);
    expect(findLearnings(memoria)).toHaveLength(4);

    // Orden estable e independiente del orden de entrada: instante descendente, y a igualdad, por
    // identificador byte a byte.
    const directo = findLearnings(memoria).map((entry) => entry.learning.learningId);
    const alReves = findLearnings([...memoria].reverse()).map((entry) => entry.learning.learningId);
    expect(alReves).toEqual(directo);
    expect(directo).toHaveLength(4);
  });

  it('la memoria no depende de que la gente siga: no hay ningún identificador de persona en ella', async () => {
    const { log, frozen } = await evaluationWithLearnings(2_300);
    const entries = learningsOf(replayEvaluation(log, frozen));
    const serializado = serialize(entries);
    expect(serializado).not.toContain(RESPONSIBLE);
    expect(serializado).not.toContain(AUDITOR);
  });
});

describe('las filas que hay que añadir a access.ts', () => {
  it('son siete, ninguna concede nada a tech-admin y ninguna es ownerOnly', () => {
    expect(PROPOSED_EVALUATION_ACCESS_RULES).toHaveLength(7);
    for (const rule of PROPOSED_EVALUATION_ACCESS_RULES) {
      expect(rule.ownerOnly).toBe(false);
      if (rule.action === 'evaluation:read') continue;
      expect(rule.roles).not.toContain('tech-admin');
      expect(rule.roles).not.toContain('observer');
      expect(rule.authenticated).toBe(true);
      expect(rule.circleOnly).toBe(true);
      expect(rule.note.length).toBeGreaterThan(40);
    }
  });

  it('sólo la de cerrar es de procedimiento', () => {
    const deMiembro = PROPOSED_EVALUATION_ACCESS_RULES.filter((rule) =>
      rule.roles.includes('member'),
    ).map((rule) => rule.action);
    expect(deMiembro).toEqual([
      'evaluation:read',
      'evaluation:open',
      'evaluation:assess',
      'evaluation:escalate',
      'evaluation:record-learning',
      'evaluation:publish',
    ]);
  });
});
