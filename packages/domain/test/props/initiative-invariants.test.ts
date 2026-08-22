/**
 * Propiedades del puente propuesta -> iniciativa. Estas pruebas atacan las promesas que quedan
 * congeladas antes de decidir: un plan válido es estable al hashearse, una alteración no puede
 * conservar el mismo compromiso y una iniciativa sólo nace del desenlace aprobado del sistema.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  circleId,
  createInitiative,
  decisionId,
  executionPlanHash,
  hash,
  initiativeId,
  instant,
  proposalId,
  proposalVersionHash,
  type ExecutionPlan,
  validateExecutionPlan,
  verifyInitiativeLog,
} from '../../src/index.js';
import {
  circleIdAt,
  DECISION_ID,
  eventIdAt,
  memberIdAt,
  PROPOSAL_ID,
  runs,
  T0,
} from '../arbitraries.js';

const CREATED_AT = instant(T0 + 10_000);

function planFor(seed: number, criteria = 1): ExecutionPlan {
  return {
    objective: `Extender el horario de estudio para que la comunidad pueda trabajar con seguridad ${String(seed)}.`,
    responsibleId: memberIdAt(seed + 1),
    reviewAt: instant(CREATED_AT + (seed + 1) * 1_000),
    successCriteria: Array.from({ length: criteria }, (_, index) => ({
      description: `La comunidad confirma el cumplimiento observable del horario ampliado ${String(seed)}-${String(index)}.`,
      evidenceSource: `Registro institucional verificable ${String(seed)}-${String(index)}`,
    })),
  };
}

const arbValidPlan = fc
  .tuple(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 1, max: 10 }))
  .map(([seed, criteria]) => planFor(seed, criteria));

describe('invariantes del plan de ejecución y la iniciativa', () => {
  it('un plan válido generado se valida y su compromiso es determinista', async () => {
    await fc.assert(
      fc.asyncProperty(arbValidPlan, async (plan) => {
        expect(() => {
          validateExecutionPlan(plan, CREATED_AT);
        }).not.toThrow();
        expect(await executionPlanHash(plan)).toBe(await executionPlanHash(plan));
      }),
      runs(150),
    );
  });

  it('cada vínculo material del plan altera su compromiso', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 9_000 }), async (seed) => {
        const plan = planFor(seed, 1);
        const original = await executionPlanHash(plan);
        const criterion = plan.successCriteria[0]!;
        const changed = [
          { ...plan, objective: `${plan.objective} Cambio` },
          { ...plan, responsibleId: memberIdAt(seed + 20_000) },
          { ...plan, reviewAt: instant(plan.reviewAt + 1) },
          {
            ...plan,
            successCriteria: [{ ...criterion, description: `${criterion.description} Cambio` }],
          },
          {
            ...plan,
            successCriteria: [
              { ...criterion, evidenceSource: `${criterion.evidenceSource} Cambio` },
            ],
          },
        ] as const;

        for (const mutation of changed) {
          expect(await executionPlanHash(mutation)).not.toBe(original);
        }
      }),
      runs(80),
    );
  });

  it('los límites estructurales y textuales del plan siempre se rechazan', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (seed) => {
        const valid = planFor(seed, 1);
        const criterion = valid.successCriteria[0]!;
        const invalidPlans: readonly unknown[] = [
          { ...valid, successCriteria: [] },
          { ...valid, successCriteria: Array.from({ length: 11 }, () => criterion) },
          { ...valid, reviewAt: CREATED_AT },
          { ...valid, reviewAt: instant(CREATED_AT - seed) },
          { ...valid, objective: 'a'.repeat(19) },
          { ...valid, objective: 'a'.repeat(1_001) },
          { ...valid, successCriteria: [{ ...criterion, description: 'a'.repeat(19) }] },
          { ...valid, successCriteria: [{ ...criterion, description: 'a'.repeat(501) }] },
          { ...valid, successCriteria: [{ ...criterion, evidenceSource: 'a'.repeat(4) }] },
          { ...valid, successCriteria: [{ ...criterion, evidenceSource: 'a'.repeat(501) }] },
        ];

        for (const candidate of invalidPlans) {
          expect(() => {
            validateExecutionPlan(candidate, CREATED_AT);
          }).toThrow();
        }
      }),
      runs(100),
    );
  });

  it('el plan comprometido forma parte de la versión, mientras la preimagen histórica sigue estable', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8_000 }), async (seed) => {
        const firstPlanHash = await executionPlanHash(planFor(seed, 1));
        const secondPlanHash = await executionPlanHash(planFor(seed + 1, 1));
        const shared = {
          proposalId: 'a'.repeat(32),
          version: 1,
          title: 'Ampliar el horario de la sala de estudio para el estudiantado',
          body: 'La propuesta garantiza que estudiantes con jornadas diversas puedan acceder a un espacio seguro de estudio durante la noche.',
        } as const;

        expect(await proposalVersionHash({ ...shared, executionPlanHash: firstPlanHash })).not.toBe(
          await proposalVersionHash({ ...shared, executionPlanHash: secondPlanHash }),
        );
        expect(await proposalVersionHash(shared)).toBe(await proposalVersionHash(shared));
      }),
      runs(100),
    );
  });

  it('sólo approved del sistema crea un único genesis para muchos desenlaces y actores', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4_000 }),
        fc.constantFrom('approved', 'rejected', 'no-quorum', 'needs-new-round'),
        async (seed, outcomeKind) => {
          const meta = {
            eventId: eventIdAt(50_000 + seed),
            at: CREATED_AT,
            actor: 'system' as const,
          };
          const input = {
            initiativeId: initiativeId((10_000 + seed).toString(16).padStart(32, '0')),
            outcomeKind,
            decisionId: DECISION_ID,
            proposalId: PROPOSAL_ID,
            proposalVersionHash: hash('a'.repeat(64)),
            decisionResultHash: hash('b'.repeat(64)),
            circleId: circleIdAt(1),
            executionPlan: planFor(seed, 1),
          } as const;

          if (outcomeKind === 'approved') {
            await expect(createInitiative(meta, input)).resolves.toHaveLength(1);
          } else {
            await expect(createInitiative(meta, input)).rejects.toMatchObject({
              code: 'INITIATIVE_REQUIRES_APPROVED',
            });
          }
          await expect(
            createInitiative(
              { ...meta, actor: memberIdAt(seed + 50_000) },
              { ...input, outcomeKind: 'approved' },
            ),
          ).rejects.toMatchObject({ code: 'INITIATIVE_SYSTEM_ONLY' });
        },
      ),
      runs(100),
    );
  });

  it('alterar cualquier vínculo de un genesis sellado rompe su verificación', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3_000 }), async (seed) => {
        const log = await createInitiative(
          { eventId: eventIdAt(70_000 + seed), at: CREATED_AT, actor: 'system' },
          {
            initiativeId: initiativeId((20_000 + seed).toString(16).padStart(32, '0')),
            outcomeKind: 'approved',
            decisionId: DECISION_ID,
            proposalId: PROPOSAL_ID,
            proposalVersionHash: hash('a'.repeat(64)),
            decisionResultHash: hash('b'.repeat(64)),
            circleId: circleIdAt(1),
            executionPlan: planFor(seed, 1),
          },
        );
        const payload = log[0]!.payload;
        const tamperedPayloads = [
          { ...payload, decisionId: decisionId('f'.repeat(32)) },
          { ...payload, proposalId: proposalId('e'.repeat(32)) },
          { ...payload, proposalVersionHash: hash('c'.repeat(64)) },
          { ...payload, decisionResultHash: hash('d'.repeat(64)) },
          { ...payload, circleId: circleId('c'.repeat(32)) },
          {
            ...payload,
            executionPlan: {
              ...payload.executionPlan,
              objective: `${payload.executionPlan.objective} alterado`,
            },
          },
        ] as const;

        for (const altered of tamperedPayloads) {
          await expect(
            verifyInitiativeLog([{ ...log[0]!, payload: altered }]),
          ).rejects.toMatchObject({
            code: 'BROKEN_LOG',
          });
        }
      }),
      runs(60),
    );
  });
});
