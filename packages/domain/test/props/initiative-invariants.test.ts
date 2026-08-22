/**
 * Propiedades del puente propuesta -> iniciativa. Estas pruebas atacan las promesas que quedan
 * congeladas antes de decidir: un plan válido es estable al hashearse, una alteración no puede
 * conservar el mismo compromiso y una iniciativa sólo nace del desenlace aprobado del sistema.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  acceptTaskBy,
  acceptTaskReviewBy,
  addTaskEvidenceBy,
  admitTaskCapacity,
  activateInitiative,
  type Actor,
  blockTaskBy,
  circleId,
  createInitiative,
  decisionId,
  deliverTaskBy,
  executionPlanHash,
  hash,
  initiativeId,
  type InitiativeByCommandMeta,
  type InitiativeLog,
  instant,
  milestoneId,
  offerTaskBy,
  planMilestoneBy,
  prepareTaskAcceptanceBy,
  proposalId,
  proposalVersionHash,
  rejectTaskBy,
  reofferTaskBy,
  replayInitiative,
  requestTaskChangesBy,
  requestTaskHelpBy,
  requestTaskReassignmentBy,
  resumeTaskBy,
  startTaskBy,
  type TaskAccepted,
  taskId,
  type TaskId,
  toPrivateMaterialCommitment,
  type ExecutionPlan,
  validateExecutionPlan,
  verifyInitiativeLog,
} from '../../src/index.js';
import {
  circleIdAt,
  DECISION_ID,
  eventIdAt,
  hex32,
  memberIdAt,
  PROPOSAL_ID,
  runs,
  T0,
} from '../arbitraries.js';

const CREATED_AT = instant(T0 + 10_000);
const commitment = (digit: string) => toPrivateMaterialCommitment(digit.repeat(64));

async function offeredExecution(seed: number) {
  const circle = circleIdAt(1);
  const owner: Actor = {
    memberId: memberIdAt(20_000 + seed),
    roles: ['member'],
    circles: [circle],
  };
  const recipient: Actor = {
    memberId: memberIdAt(30_000 + seed),
    roles: ['member'],
    circles: [circle],
  };
  const replacement: Actor = {
    memberId: memberIdAt(40_000 + seed),
    roles: ['member'],
    circles: [circle],
  };
  const initiative = initiativeId(hex32(0xa0_000 + seed));
  const milestone = milestoneId(hex32(0xb0_000 + seed));
  const task = taskId(hex32(0xc0_000 + seed));
  const reviewAt = instant(CREATED_AT + 100_000);
  const plan: ExecutionPlan = {
    objective: `Completar de manera verificable el plan de ejecución generado ${String(seed)}.`,
    responsibleId: owner.memberId!,
    reviewAt,
    successCriteria: [
      {
        description: `El resultado generado ${String(seed)} se puede comprobar públicamente.`,
        evidenceSource: `Registro institucional generado ${String(seed)}`,
      },
    ],
  };
  const baseEvent = 100_000 + seed * 20;
  let log = await createInitiative(
    { eventId: eventIdAt(baseEvent), at: CREATED_AT, actor: 'system' },
    {
      initiativeId: initiative,
      outcomeKind: 'approved',
      decisionId: DECISION_ID,
      proposalId: PROPOSAL_ID,
      proposalVersionHash: hash('a'.repeat(64)),
      decisionResultHash: hash('b'.repeat(64)),
      circleId: circle,
      executionPlan: plan,
    },
  );
  log = await activateInitiative(
    log,
    { eventId: eventIdAt(baseEvent + 1), at: instant(CREATED_AT + 1), actor: 'system' },
    {
      ratificationEventId: eventIdAt(baseEvent + 10),
      ratificationEventHash: hash('c'.repeat(64)),
    },
  );
  log = await planMilestoneBy(
    log,
    { eventId: eventIdAt(baseEvent + 2), at: instant(CREATED_AT + 2), by: owner },
    {
      milestoneId: milestone,
      title: `Hito verificable ${String(seed)}`,
      completionCriterion: `Hay evidencia verificable del hito generado ${String(seed)}.`,
      dueAt: instant(reviewAt - 1_000),
    },
  );
  log = await offerTaskBy(
    log,
    { eventId: eventIdAt(baseEvent + 3), at: instant(CREATED_AT + 3), by: owner },
    {
      taskId: task,
      milestoneId: milestone,
      offeredTo: recipient.memberId!,
      recipient,
      title: `Tarea verificable ${String(seed)}`,
      description: `Preparar evidencia suficiente para la tarea generada ${String(seed)}.`,
      effortMinutes: 60,
      dueAt: instant(reviewAt - 2_000),
      dependsOn: [],
    },
  );
  return { baseEvent, log, milestone, owner, recipient, replacement, reviewAt, task };
}

function taskRevision(log: InitiativeLog, id: TaskId): number {
  const revision = replayInitiative(log).tasks.find((task) => task.taskId === id)?.lastSeq;
  if (revision === undefined) throw new Error('el escenario generado exige una tarea vigente');
  return revision;
}

async function acceptGenerated(
  log: InitiativeLog,
  meta: InitiativeByCommandMeta,
  input: Omit<TaskAccepted, 'type'>,
) {
  const candidate = prepareTaskAcceptanceBy(log, meta, input);
  return acceptTaskBy(
    log,
    meta,
    input,
    admitTaskCapacity(candidate, {
      currentLoadMinutes: 0,
      weeklyCapacityMinutes: 10_080,
    }),
  );
}

async function startedExecution(seed: number) {
  const scenario = await offeredExecution(seed);
  const offerId = eventIdAt(scenario.baseEvent + 3);
  let log = await acceptGenerated(
    scenario.log,
    {
      eventId: eventIdAt(scenario.baseEvent + 4),
      at: instant(CREATED_AT + 4),
      by: scenario.recipient,
    },
    {
      taskId: scenario.task,
      offerId,
      expectedTaskSeq: taskRevision(scenario.log, scenario.task),
    },
  );
  log = await startTaskBy(
    log,
    {
      eventId: eventIdAt(scenario.baseEvent + 5),
      at: instant(CREATED_AT + 5),
      by: scenario.recipient,
    },
    {
      taskId: scenario.task,
      offerId,
      expectedTaskSeq: taskRevision(log, scenario.task),
    },
  );
  return { ...scenario, log, offerId };
}

async function deliveredExecution(seed: number) {
  const scenario = await startedExecution(seed);
  const evidenceId = eventIdAt(scenario.baseEvent + 6);
  let log = await addTaskEvidenceBy(
    scenario.log,
    {
      eventId: evidenceId,
      at: instant(CREATED_AT + 6),
      by: scenario.recipient,
    },
    {
      taskId: scenario.task,
      offerId: scenario.offerId,
      expectedTaskSeq: taskRevision(scenario.log, scenario.task),
      objectCommitment: commitment('d'),
      kindCode: 'documento',
      sizeClass: 'mediana',
      visibility: 'restricted',
    },
  );
  const deliveryId = eventIdAt(scenario.baseEvent + 7);
  log = await deliverTaskBy(
    log,
    {
      eventId: deliveryId,
      at: instant(CREATED_AT + 7),
      by: scenario.recipient,
    },
    {
      taskId: scenario.task,
      offerId: scenario.offerId,
      expectedTaskSeq: taskRevision(log, scenario.task),
      evidenceIds: [evidenceId],
      summaryCommitment: commitment('e'),
    },
  );
  return { ...scenario, log, evidenceId, deliveryId };
}

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
        if (payload.type !== 'InitiativeCreated') throw new Error('genesis inesperado');
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

  it('cada respuesta inicial generada produce una sola respuesta para la oferta', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2_000 }),
        fc.constantFrom('accept', 'reject', 'reassign'),
        async (seed, choice) => {
          const scenario = await offeredExecution(seed);
          const offerId = eventIdAt(scenario.baseEvent + 3);
          const expectedTaskSeq = replayInitiative(scenario.log).tasks[0]!.lastSeq;
          const meta = {
            eventId: eventIdAt(scenario.baseEvent + 4),
            at: instant(CREATED_AT + 4),
            by: scenario.recipient,
          } as const;
          const next =
            choice === 'accept'
              ? await acceptGenerated(scenario.log, meta, {
                  taskId: scenario.task,
                  offerId,
                  expectedTaskSeq,
                })
              : choice === 'reject'
                ? await rejectTaskBy(scenario.log, meta, {
                    taskId: scenario.task,
                    offerId,
                    expectedTaskSeq,
                    reason: 'plazo-inviable',
                  })
                : await requestTaskReassignmentBy(scenario.log, meta, {
                    taskId: scenario.task,
                    offerId,
                    expectedTaskSeq,
                    reason: 'otra-persona-mas-adecuada',
                  });

          const task = replayInitiative(next).tasks[0];
          expect(task?.responses).toHaveLength(1);
          expect(task?.responses[0]?.offerId).toBe(offerId);
          expect(replayInitiative(scenario.log).tasks[0]?.responses).toHaveLength(0);
        },
      ),
      runs(60),
    );
  });

  it('dos respuestas generadas sobre la misma revisión nunca se aplican ambas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2_000 }), async (seed) => {
        const scenario = await offeredExecution(seed);
        const offerId = eventIdAt(scenario.baseEvent + 3);
        const revision = replayInitiative(scenario.log).tasks[0]!.lastSeq;
        const accepted = await acceptGenerated(
          scenario.log,
          {
            eventId: eventIdAt(scenario.baseEvent + 4),
            at: instant(CREATED_AT + 4),
            by: scenario.recipient,
          },
          { taskId: scenario.task, offerId, expectedTaskSeq: revision },
        );
        const before = replayInitiative(accepted);

        await expect(
          requestTaskReassignmentBy(
            accepted,
            {
              eventId: eventIdAt(scenario.baseEvent + 5),
              at: instant(CREATED_AT + 5),
              by: scenario.recipient,
            },
            {
              taskId: scenario.task,
              offerId,
              expectedTaskSeq: revision,
              reason: 'razon-privada',
            },
          ),
        ).rejects.toMatchObject({ code: 'STALE_TASK_REVISION' });
        expect(replayInitiative(accepted)).toEqual(before);

        await expect(
          requestTaskReassignmentBy(
            accepted,
            {
              eventId: eventIdAt(scenario.baseEvent + 6),
              at: instant(CREATED_AT + 6),
              by: scenario.recipient,
            },
            {
              taskId: scenario.task,
              offerId,
              expectedTaskSeq: before.tasks[0]!.lastSeq,
              reason: 'sin-disponibilidad',
            },
          ),
        ).resolves.toHaveLength(6);
      }),
      runs(60),
    );
  });

  it('un offerId obsoleto generado nunca cambia el estado vigente', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2_000 }), async (seed) => {
        const scenario = await offeredExecution(seed);
        const firstOfferId = eventIdAt(scenario.baseEvent + 3);
        const firstRevision = replayInitiative(scenario.log).tasks[0]!.lastSeq;
        let log = await rejectTaskBy(
          scenario.log,
          {
            eventId: eventIdAt(scenario.baseEvent + 4),
            at: instant(CREATED_AT + 4),
            by: scenario.recipient,
          },
          {
            taskId: scenario.task,
            offerId: firstOfferId,
            expectedTaskSeq: firstRevision,
            reason: 'plazo-inviable',
          },
        );
        log = await reofferTaskBy(
          log,
          {
            eventId: eventIdAt(scenario.baseEvent + 5),
            at: instant(CREATED_AT + 5),
            by: scenario.owner,
          },
          {
            taskId: scenario.task,
            previousOfferId: firstOfferId,
            offeredTo: scenario.replacement.memberId!,
            recipient: scenario.replacement,
          },
        );
        const before = replayInitiative(log);

        await expect(
          acceptGenerated(
            log,
            {
              eventId: eventIdAt(scenario.baseEvent + 6),
              at: instant(CREATED_AT + 6),
              by: scenario.recipient,
            },
            {
              taskId: scenario.task,
              offerId: firstOfferId,
              expectedTaskSeq: replayInitiative(log).tasks[0]!.lastSeq,
            },
          ),
        ).rejects.toMatchObject({ code: 'STALE_TASK_OFFER' });
        expect(replayInitiative(log)).toEqual(before);
      }),
      runs(60),
    );
  });

  it('esfuerzo, dependencias o fecha inválidos generados nunca agregan una tarea', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2_000 }),
        fc.constantFrom('effort', 'dependencies', 'due'),
        fc.integer({ min: 0, max: 1 }),
        async (seed, invalidKind, edge) => {
          const scenario = await offeredExecution(seed);
          // Se parte del estado planificado, antes de la primera oferta.
          const plannedLog = scenario.log.slice(0, 3);
          const before = replayInitiative(plannedLog);
          const base = {
            taskId: scenario.task,
            milestoneId: scenario.milestone,
            offeredTo: scenario.recipient.memberId!,
            recipient: scenario.recipient,
            title: `Tarea inválida ${String(seed)}`,
            description: `Esta tarea generada debe rechazarse sin cambiar el estado ${String(seed)}.`,
            effortMinutes: 60,
            dueAt: instant(scenario.reviewAt - 2_000),
            dependsOn: [] as const,
          };
          const candidate =
            invalidKind === 'effort'
              ? { ...base, effortMinutes: edge === 0 ? 0 : 10_081 }
              : invalidKind === 'dependencies'
                ? {
                    ...base,
                    dependsOn: Array.from({ length: 51 }, (_, index) =>
                      taskId(hex32(0xd0_000 + seed * 100 + index)),
                    ),
                  }
                : { ...base, dueAt: scenario.reviewAt };

          await expect(
            offerTaskBy(
              plannedLog,
              {
                eventId: eventIdAt(scenario.baseEvent + 11),
                at: instant(CREATED_AT + 11),
                by: scenario.owner,
              },
              candidate,
            ),
          ).rejects.toBeDefined();
          expect(replayInitiative(plannedLog)).toEqual(before);
          expect(before.tasks).toHaveLength(0);
        },
      ),
      runs(60),
    );
  });

  it('todo recorrido activo generado conserva un solo trabajo vigente y termina verificable', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2_000 }),
        fc.constantFrom('block', 'help', 'block-help'),
        fc.constantFrom('dependencia', 'recurso', 'respuesta-externa', 'alcance', 'razon-privada'),
        fc.constantFrom(
          'desbloqueo',
          'revision',
          'trabajo-compartido',
          'orientacion',
          'razon-privada',
        ),
        fc.constantFrom('documento', 'imagen', 'tabla', 'texto'),
        fc.constantFrom('pequena', 'mediana', 'grande'),
        fc.constantFrom('public', 'restricted'),
        fc.boolean(),
        fc.constantFrom('verificada', 'sin-verificar', 'no-aplica'),
        async (
          seed,
          pausePath,
          blockCategory,
          helpCategory,
          kindCode,
          sizeClass,
          visibility,
          needsChanges,
          outcomeCriterionEvidence,
        ) => {
          const scenario = await startedExecution(seed);
          let log = scenario.log;
          let nextEvent = scenario.baseEvent + 6;
          const command = () => ({
            taskId: scenario.task,
            offerId: scenario.offerId,
            expectedTaskSeq: taskRevision(log, scenario.task),
          });
          const meta = () => ({
            eventId: eventIdAt(nextEvent++),
            at: instant(CREATED_AT + nextEvent),
            by: scenario.recipient,
          });

          if (pausePath === 'block' || pausePath === 'block-help') {
            log = await blockTaskBy(log, meta(), {
              ...command(),
              category: blockCategory,
              privateDetailCommitment: commitment('1'),
            });
          }
          if (pausePath === 'help' || pausePath === 'block-help') {
            log = await requestTaskHelpBy(log, meta(), {
              ...command(),
              category: helpCategory,
              privateDetailCommitment: commitment('2'),
            });
          }

          const paused = replayInitiative(log).tasks[0]!;
          const pauseId = paused.currentPause?.pauseId;
          expect(pauseId).toBeDefined();
          expect(paused.pauses.filter((pause) => pause.endedAt === undefined)).toHaveLength(1);
          expect(paused.currentDeliveryId).toBeUndefined();
          log = await resumeTaskBy(log, meta(), { ...command(), pauseId: pauseId! });

          const evidenceId = eventIdAt(nextEvent);
          log = await addTaskEvidenceBy(log, meta(), {
            ...command(),
            objectCommitment: commitment('3'),
            kindCode,
            sizeClass,
            visibility,
          });
          const evidencePayload = log.at(-1)!.payload;
          expect(Object.keys(evidencePayload).sort()).toEqual(
            [
              'expectedTaskSeq',
              'kindCode',
              'objectCommitment',
              'offerId',
              'sizeClass',
              'taskId',
              'type',
              'visibility',
            ].sort(),
          );

          let deliveryId = eventIdAt(nextEvent);
          log = await deliverTaskBy(log, meta(), {
            ...command(),
            evidenceIds: [evidenceId],
            summaryCommitment: commitment('4'),
          });
          expect(replayInitiative(log).tasks[0]).toMatchObject({
            status: 'entregada',
            currentDeliveryId: deliveryId,
          });

          if (needsChanges) {
            log = await requestTaskChangesBy(
              log,
              {
                eventId: eventIdAt(nextEvent++),
                at: instant(CREATED_AT + nextEvent),
                by: scenario.owner,
              },
              {
                taskId: scenario.task,
                deliveryId,
                expectedTaskSeq: taskRevision(log, scenario.task),
                reason: 'evidencia-insuficiente',
                privateDetailCommitment: commitment('5'),
              },
            );
            const secondEvidenceId = eventIdAt(nextEvent);
            log = await addTaskEvidenceBy(log, meta(), {
              ...command(),
              objectCommitment: commitment('6'),
              kindCode,
              sizeClass,
              visibility,
            });
            deliveryId = eventIdAt(nextEvent);
            log = await deliverTaskBy(log, meta(), {
              ...command(),
              evidenceIds: [evidenceId, secondEvidenceId],
              summaryCommitment: commitment('7'),
            });
          }

          log = await acceptTaskReviewBy(
            log,
            {
              eventId: eventIdAt(nextEvent++),
              at: instant(CREATED_AT + nextEvent),
              by: scenario.owner,
            },
            {
              taskId: scenario.task,
              deliveryId,
              expectedTaskSeq: taskRevision(log, scenario.task),
              outcomeCriterionEvidence,
            },
          );

          const verified = await verifyInitiativeLog(log);
          const task = verified.tasks[0]!;
          expect(task.status).toBe('completada');
          expect(task.currentPause).toBeUndefined();
          expect(task.currentDeliveryId).toBeUndefined();
          expect(task.pauses.filter((pause) => pause.endedAt === undefined)).toHaveLength(0);
          expect(task.deliveries.filter((delivery) => delivery.review === undefined)).toHaveLength(
            0,
          );
          expect(replayInitiative([...log])).toEqual(verified);
        },
      ),
      runs(50),
    );
  });

  it('una revisión CAS obsoleta generada nunca agrega un acto de trabajo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2_000 }),
        fc.constantFrom('block', 'help', 'evidence', 'deliver'),
        async (seed, action) => {
          const scenario = await startedExecution(seed);
          const before = replayInitiative(scenario.log);
          const staleRevision = taskRevision(scenario.log, scenario.task) - 1;
          const meta = {
            eventId: eventIdAt(scenario.baseEvent + 6),
            at: instant(CREATED_AT + 6),
            by: scenario.recipient,
          } as const;
          const cas = {
            taskId: scenario.task,
            offerId: scenario.offerId,
            expectedTaskSeq: staleRevision,
          } as const;
          const attempt =
            action === 'block'
              ? blockTaskBy(scenario.log, meta, { ...cas, category: 'dependencia' })
              : action === 'help'
                ? requestTaskHelpBy(scenario.log, meta, { ...cas, category: 'orientacion' })
                : action === 'evidence'
                  ? addTaskEvidenceBy(scenario.log, meta, {
                      ...cas,
                      objectCommitment: commitment('8'),
                      kindCode: 'documento',
                      sizeClass: 'pequena',
                      visibility: 'restricted',
                    })
                  : deliverTaskBy(scenario.log, meta, {
                      ...cas,
                      evidenceIds: [eventIdAt(scenario.baseEvent + 10)],
                      summaryCommitment: commitment('9'),
                    });

          await expect(attempt).rejects.toMatchObject({ code: 'STALE_TASK_REVISION' });
          expect(replayInitiative(scenario.log)).toEqual(before);
        },
      ),
      runs(80),
    );
  });

  it('una revisión o entrega obsoleta generada nunca completa ni reabre la tarea', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2_000 }),
        fc.constantFrom('accept', 'changes'),
        async (seed, review) => {
          const scenario = await deliveredExecution(seed);
          const before = replayInitiative(scenario.log);
          const staleRevision = taskRevision(scenario.log, scenario.task) - 1;
          const meta = {
            eventId: eventIdAt(scenario.baseEvent + 8),
            at: instant(CREATED_AT + 8),
            by: scenario.owner,
          } as const;
          const attempt =
            review === 'accept'
              ? acceptTaskReviewBy(scenario.log, meta, {
                  taskId: scenario.task,
                  deliveryId: scenario.deliveryId,
                  expectedTaskSeq: staleRevision,
                  outcomeCriterionEvidence: 'verificada',
                })
              : requestTaskChangesBy(scenario.log, meta, {
                  taskId: scenario.task,
                  deliveryId: scenario.deliveryId,
                  expectedTaskSeq: staleRevision,
                  reason: 'alcance-incompleto',
                });

          await expect(attempt).rejects.toMatchObject({ code: 'STALE_TASK_REVISION' });
          await expect(
            acceptTaskReviewBy(scenario.log, meta, {
              taskId: scenario.task,
              deliveryId: eventIdAt(scenario.baseEvent + 19),
              expectedTaskSeq: taskRevision(scenario.log, scenario.task),
              outcomeCriterionEvidence: 'verificada',
            }),
          ).rejects.toMatchObject({ code: 'STALE_TASK_DELIVERY' });
          expect(replayInitiative(scenario.log)).toEqual(before);
        },
      ),
      runs(60),
    );
  });

  it('block(X) -> resume -> block(X) siempre rechaza el ABA del pauseId/eventId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 2_000 }),
        fc.constantFrom('dependencia', 'recurso', 'respuesta-externa', 'alcance', 'razon-privada'),
        async (seed, category) => {
          const scenario = await startedExecution(seed);
          const pauseId = eventIdAt(scenario.baseEvent + 6);
          let log = await blockTaskBy(
            scenario.log,
            {
              eventId: pauseId,
              at: instant(CREATED_AT + 6),
              by: scenario.recipient,
            },
            {
              taskId: scenario.task,
              offerId: scenario.offerId,
              expectedTaskSeq: taskRevision(scenario.log, scenario.task),
              category,
            },
          );
          log = await resumeTaskBy(
            log,
            {
              eventId: eventIdAt(scenario.baseEvent + 7),
              at: instant(CREATED_AT + 7),
              by: scenario.recipient,
            },
            {
              taskId: scenario.task,
              offerId: scenario.offerId,
              expectedTaskSeq: taskRevision(log, scenario.task),
              pauseId,
            },
          );
          const before = replayInitiative(log);

          await expect(
            blockTaskBy(
              log,
              {
                eventId: pauseId,
                at: instant(CREATED_AT + 8),
                by: scenario.recipient,
              },
              {
                taskId: scenario.task,
                offerId: scenario.offerId,
                expectedTaskSeq: taskRevision(log, scenario.task),
                category,
              },
            ),
          ).rejects.toMatchObject({ code: 'DUPLICATE_INITIATIVE_EVENT_ID' });
          expect(replayInitiative(log)).toEqual(before);
        },
      ),
      runs(80),
    );
  });

  it('la admisión pura existe exactamente cuando carga más esfuerzo cabe en la capacidad', async () => {
    const scenario = await offeredExecution(900);
    const meta = {
      eventId: eventIdAt(scenario.baseEvent + 4),
      at: instant(CREATED_AT + 4),
      by: scenario.recipient,
    } as const;
    const candidate = prepareTaskAcceptanceBy(scenario.log, meta, {
      taskId: scenario.task,
      offerId: eventIdAt(scenario.baseEvent + 3),
      expectedTaskSeq: taskRevision(scenario.log, scenario.task),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 10_080 }),
        (currentLoadMinutes, weeklyCapacityMinutes) => {
          const capacity = { currentLoadMinutes, weeklyCapacityMinutes } as const;
          if (currentLoadMinutes + candidate.effortMinutes <= weeklyCapacityMinutes) {
            expect(admitTaskCapacity(candidate, capacity)).toMatchObject({
              memberId: candidate.memberId,
              taskId: candidate.taskId,
              offerId: candidate.offerId,
              effortMinutes: candidate.effortMinutes,
              checkedAt: candidate.checkedAt,
            });
          } else {
            expect(() => admitTaskCapacity(candidate, capacity)).toThrow(
              expect.objectContaining({ code: 'TASK_CAPACITY_EXCEEDED' }),
            );
          }
        },
      ),
      runs(200),
    );
  });

  it('todo log generado con sólo InitiativeCreated reproduce el mismo estado histórico', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4_000 }), async (seed) => {
        const log = await createInitiative(
          { eventId: eventIdAt(900_000 + seed), at: CREATED_AT, actor: 'system' },
          {
            initiativeId: initiativeId(hex32(0xe0_000 + seed)),
            outcomeKind: 'approved',
            decisionId: DECISION_ID,
            proposalId: PROPOSAL_ID,
            proposalVersionHash: hash('a'.repeat(64)),
            decisionResultHash: hash('b'.repeat(64)),
            circleId: circleIdAt(seed % 5),
            executionPlan: planFor(seed, 1),
          },
        );
        const first = replayInitiative(log);
        const second = replayInitiative([...log]);
        expect(second).toEqual(first);
        expect(first).toMatchObject({
          status: 'por-empezar',
          activatedAt: undefined,
          milestones: [],
          tasks: [],
        });
      }),
      runs(80),
    );
  });
});
