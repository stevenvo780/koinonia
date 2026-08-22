import { describe, expect, it } from 'vitest';

import {
  acceptTaskBy,
  acceptTaskReviewBy,
  addTaskEvidenceBy,
  admitTaskCapacity,
  activateInitiative,
  applyInitiative,
  appendChained,
  type Actor,
  authorizeTaskDeliveryRead,
  authorizeTaskEvidenceRead,
  blockTaskBy,
  createInitiative,
  currentInitiative,
  deliverTaskBy,
  hash,
  initiativeId,
  type InitiativeLog,
  milestoneId,
  offerTaskBy,
  planMilestoneBy,
  prepareTaskAcceptanceBy,
  rejectTaskBy,
  reofferTaskBy,
  requestTaskReassignmentBy,
  taskId,
  type InitiativePayload,
  replayInitiative,
  requestTaskChangesBy,
  requestTaskHelpBy,
  verifyInitiativeLog,
  resumeTaskBy,
  startTaskBy,
  type TaskAccepted,
  toPrivateMaterialCommitment,
  UnauthorizedError,
} from '../src/index.js';
import { circleIdAt, DECISION_ID, eventIdAt, memberIdAt, PROPOSAL_ID, T0 } from './arbitraries.js';
import { instant } from '../src/ids.js';

const INITIATIVE = initiativeId('9'.repeat(32));
const CREATED_AT = instant(T0 + 1_000);
const MILESTONE = milestoneId('c'.repeat(32));
const TASK = taskId('d'.repeat(32));
const TASK_2 = taskId('e'.repeat(32));
const PLAN = {
  objective: 'Conseguir que la sala de estudio extienda su horario nocturno entre semana.',
  responsibleId: memberIdAt(1),
  reviewAt: instant(T0 + 30 * 24 * 60 * 60 * 1000),
  successCriteria: [
    {
      description: 'La sala publica y cumple un horario de apertura hasta las nueve de la noche.',
      evidenceSource: 'Horario oficial publicado por la biblioteca',
    },
  ],
} as const;

const input = {
  initiativeId: INITIATIVE,
  outcomeKind: 'approved' as const,
  decisionId: DECISION_ID,
  proposalId: PROPOSAL_ID,
  proposalVersionHash: hash('a'.repeat(64)),
  decisionResultHash: hash('b'.repeat(64)),
  circleId: circleIdAt(1),
  executionPlan: PLAN,
};

const systemMeta = {
  eventId: eventIdAt(1),
  at: CREATED_AT,
  actor: 'system' as const,
};

const responsible: Actor = {
  memberId: PLAN.responsibleId,
  roles: ['member'],
  circles: [input.circleId],
};
const recipient: Actor = {
  memberId: memberIdAt(2),
  roles: ['member'],
  circles: [input.circleId],
};
const replacement: Actor = {
  memberId: memberIdAt(3),
  roles: ['member'],
  circles: [input.circleId],
};
const facilitator: Actor = {
  memberId: memberIdAt(4),
  roles: ['facilitator'],
  circles: [input.circleId],
};
const techAdmin: Actor = {
  memberId: memberIdAt(5),
  roles: ['tech-admin'],
  circles: [input.circleId],
};

function by(event: number, actor: Actor, at = instant(CREATED_AT + event * 1_000)) {
  return { eventId: eventIdAt(event), at, by: actor } as const;
}

const commitment = (digit: string) => toPrivateMaterialCommitment(digit.repeat(64));

function unauthorizedSignature(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        code: error.code,
        message: error.message,
        reason: error.reason,
        action: error.action,
      };
    }
    throw error;
  }
  throw new Error('la prueba esperaba una denegación de autorización');
}

async function acceptAt(
  log: InitiativeLog,
  event: number,
  actor: Actor,
  input: Omit<TaskAccepted, 'type'>,
) {
  const meta = by(event, actor);
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

async function created() {
  return createInitiative(systemMeta, input);
}

async function active() {
  return activateInitiative(
    await created(),
    { eventId: eventIdAt(2), at: instant(CREATED_AT + 1), actor: 'system' },
    {
      ratificationEventId: eventIdAt(90),
      ratificationEventHash: hash('f'.repeat(64)),
    },
  );
}

async function planned() {
  return planMilestoneBy(await active(), by(3, responsible), {
    milestoneId: MILESTONE,
    title: 'Primer hito verificable',
    completionCriterion: 'Existe evidencia pública de que el hito terminó.',
    dueAt: instant(PLAN.reviewAt - 1_000),
  });
}

async function offered() {
  return offerTaskBy(await planned(), by(4, responsible), {
    taskId: TASK,
    milestoneId: MILESTONE,
    offeredTo: recipient.memberId!,
    recipient,
    title: 'Preparar evidencia inicial',
    description: 'Reunir y publicar la evidencia verificable del primer hito.',
    effortMinutes: 120,
    dueAt: instant(PLAN.reviewAt - 2_000),
    dependsOn: [],
  });
}

async function accepted() {
  const log = await offered();
  return acceptAt(log, 5, recipient, {
    taskId: TASK,
    offerId: eventIdAt(4),
    expectedTaskSeq: revisionOf(log),
  });
}

async function started() {
  const log = await accepted();
  return startTaskBy(log, by(6, recipient), {
    taskId: TASK,
    offerId: eventIdAt(4),
    expectedTaskSeq: revisionOf(log),
  });
}

async function evidenced() {
  const log = await started();
  return addTaskEvidenceBy(log, by(7, recipient), {
    taskId: TASK,
    offerId: eventIdAt(4),
    expectedTaskSeq: revisionOf(log),
    objectCommitment: commitment('1'),
    kindCode: 'documento',
    sizeClass: 'pequena',
    visibility: 'restricted',
  });
}

async function delivered() {
  const log = await evidenced();
  return deliverTaskBy(log, by(8, recipient), {
    taskId: TASK,
    offerId: eventIdAt(4),
    expectedTaskSeq: revisionOf(log),
    evidenceIds: [eventIdAt(7)],
    summaryCommitment: commitment('2'),
  });
}

function revisionOf(log: Awaited<ReturnType<typeof offered>>): number {
  const revision = replayInitiative(log).tasks.find((task) => task.taskId === TASK)?.lastSeq;
  if (revision === undefined) throw new Error('la prueba exige la tarea vigente');
  return revision;
}

describe('lectura autorizada de material privado de tareas', () => {
  it('entregante y responsable inicial pueden abrir evidencia y resumen sin mutar el estado', async () => {
    const state = replayInitiative(await delivered());
    const before = structuredClone(state);

    for (const actor of [recipient, responsible]) {
      expect(authorizeTaskEvidenceRead(state, actor, TASK, eventIdAt(7))).toMatchObject({
        evidenceId: eventIdAt(7),
        addedBy: recipient.memberId,
        visibility: 'restricted',
      });
      expect(authorizeTaskDeliveryRead(state, actor, TASK, eventIdAt(8))).toMatchObject({
        deliveryId: eventIdAt(8),
        deliveredBy: recipient.memberId,
      });
    }
    expect(state).toEqual(before);
  });

  it('miembro ajeno y facilitador no distinguen IDs existentes, desconocidos o de otra tarea', async () => {
    const state = replayInitiative(await delivered());

    for (const actor of [replacement, facilitator]) {
      for (const [task, evidence] of [
        [TASK, eventIdAt(7)],
        [TASK, eventIdAt(700)],
        [TASK_2, eventIdAt(7)],
      ] as const) {
        expect(() => authorizeTaskEvidenceRead(state, actor, task, evidence)).toThrow(
          expect.objectContaining({ code: 'UNAUTHORIZED_NOT_A_READER' }),
        );
      }
      for (const [task, delivery] of [
        [TASK, eventIdAt(8)],
        [TASK, eventIdAt(800)],
        [TASK_2, eventIdAt(8)],
      ] as const) {
        expect(() => authorizeTaskDeliveryRead(state, actor, task, delivery)).toThrow(
          expect.objectContaining({ code: 'UNAUTHORIZED_NOT_A_READER' }),
        );
      }
    }
  });

  it('tech-admin no hereda lectura y el dueño tampoco obtiene un oráculo sobre IDs ajenos', async () => {
    const state = replayInitiative(await delivered());

    for (const evidenceId of [eventIdAt(7), eventIdAt(700)]) {
      expect(() => authorizeTaskEvidenceRead(state, techAdmin, TASK, evidenceId)).toThrow(
        expect.objectContaining({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' }),
      );
    }
    for (const deliveryId of [eventIdAt(8), eventIdAt(800)]) {
      expect(() => authorizeTaskDeliveryRead(state, techAdmin, TASK, deliveryId)).toThrow(
        expect.objectContaining({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' }),
      );
    }
    expect(() => authorizeTaskEvidenceRead(state, recipient, TASK, eventIdAt(700))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED_NOT_A_READER' }),
    );
    expect(() => authorizeTaskDeliveryRead(state, recipient, TASK, eventIdAt(800))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED_NOT_A_READER' }),
    );
  });

  it('un autor histórico fuera del círculo no distingue un ID real de uno desconocido', async () => {
    const state = replayInitiative(await delivered());
    const formerOwner = { ...recipient, circles: [] };
    const denials = [
      unauthorizedSignature(() =>
        authorizeTaskEvidenceRead(state, formerOwner, TASK, eventIdAt(7)),
      ),
      unauthorizedSignature(() =>
        authorizeTaskEvidenceRead(state, formerOwner, TASK, eventIdAt(700)),
      ),
      unauthorizedSignature(() =>
        authorizeTaskDeliveryRead(state, formerOwner, TASK, eventIdAt(8)),
      ),
      unauthorizedSignature(() =>
        authorizeTaskDeliveryRead(state, formerOwner, TASK, eventIdAt(800)),
      ),
    ];

    expect(denials[0]).toMatchObject({ code: 'UNAUTHORIZED_NOT_IN_CIRCLE' });
    expect(denials).toEqual([denials[0], denials[0], denials[0], denials[0]]);
  });

  it('el responsable autorizado sí recibe errores de existencia precisos', async () => {
    const state = replayInitiative(await delivered());

    expect(() => authorizeTaskEvidenceRead(state, responsible, TASK, eventIdAt(700))).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_TASK_EVIDENCE' }),
    );
    expect(() => authorizeTaskDeliveryRead(state, responsible, TASK, eventIdAt(800))).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_TASK_DELIVERY' }),
    );
    expect(() => authorizeTaskEvidenceRead(state, responsible, TASK_2, eventIdAt(7))).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_TASK' }),
    );
  });
});

describe('iniciativa nacida de un resultado', () => {
  it('un resultado approved crea exactamente un genesis enlazado y por empezar', async () => {
    const log = await createInitiative(systemMeta, input);
    expect(log).toHaveLength(1);
    expect(log[0]?.payload.type).toBe('InitiativeCreated');

    const state = await verifyInitiativeLog(log);
    expect(state).toMatchObject({
      initiativeId: INITIATIVE,
      decisionId: input.decisionId,
      proposalId: input.proposalId,
      proposalVersionHash: input.proposalVersionHash,
      decisionResultHash: input.decisionResultHash,
      circleId: input.circleId,
      executionPlan: PLAN,
      status: 'por-empezar',
      createdAt: CREATED_AT,
      lastSeq: 1,
    });
    expect(currentInitiative(log)).toEqual(state);
  });

  it.each(['rejected', 'no-quorum', 'needs-new-round'] as const)(
    'el desenlace %s no crea iniciativa',
    async (outcomeKind) => {
      await expect(createInitiative(systemMeta, { ...input, outcomeKind })).rejects.toMatchObject({
        code: 'INITIATIVE_REQUIRES_APPROVED',
      });
    },
  );

  it('solo system puede crearla, tanto por orden como al replegar genesis', async () => {
    const human = memberIdAt(2);
    await expect(createInitiative({ ...systemMeta, actor: human }, input)).rejects.toMatchObject({
      code: 'INITIATIVE_SYSTEM_ONLY',
    });

    const valid = await createInitiative(systemMeta, input);
    const forged = await appendChained<InitiativePayload>([], {
      eventId: eventIdAt(2),
      aggregateId: INITIATIVE,
      occurredAt: CREATED_AT,
      actor: human,
      payload: valid[0]!.payload,
    });
    expect(() => replayInitiative([forged])).toThrow(
      expect.objectContaining({ code: 'INITIATIVE_SYSTEM_ONLY' }),
    );
  });

  it('rechaza un segundo InitiativeCreated aunque su cadena sea criptograficamente valida', async () => {
    const first = await createInitiative(systemMeta, input);
    const duplicate = await appendChained<InitiativePayload>(first, {
      eventId: eventIdAt(3),
      aggregateId: INITIATIVE,
      occurredAt: instant(CREATED_AT + 1_000),
      actor: 'system',
      payload: first[0]!.payload,
    });
    await expect(verifyInitiativeLog([...first, duplicate])).rejects.toMatchObject({
      code: 'INITIATIVE_ALREADY_CREATED',
    });
  });

  it('un cierre tardío crea la iniciativa vencida en vez de volver imposible cerrar', async () => {
    const tardia = await createInitiative({ ...systemMeta, at: instant(PLAN.reviewAt + 1) }, input);
    expect(replayInitiative(tardia).executionPlan.reviewAt).toBe(PLAN.reviewAt);
  });

  it('detecta manipulacion de la cadena', async () => {
    const log = await createInitiative(systemMeta, input);
    const tampered = [
      {
        ...log[0]!,
        payload: { ...log[0]!.payload, decisionResultHash: hash('c'.repeat(64)) },
      },
    ];
    await expect(verifyInitiativeLog(tampered)).rejects.toMatchObject({ code: 'BROKEN_LOG' });
  });
});

describe('activación ratificada', () => {
  it('conserva el estado histórico por-empezar pero bloquea ejecución hasta activar', async () => {
    const legacy = await created();
    const historical = await verifyInitiativeLog(legacy);
    expect(historical).toMatchObject({
      status: 'por-empezar',
      activatedAt: undefined,
      ratificationEventId: undefined,
      milestones: [],
      tasks: [],
    });

    await expect(
      planMilestoneBy(legacy, by(10, responsible), {
        milestoneId: MILESTONE,
        title: 'Hito todavía bloqueado',
        completionCriterion: 'Debe existir evidencia observable del trabajo terminado.',
        dueAt: PLAN.reviewAt,
      }),
    ).rejects.toMatchObject({ code: 'INITIATIVE_NOT_ACTIVE' });
  });

  it('sólo system activa una vez y conserva el vínculo exacto a DecisionRatified', async () => {
    const genesis = await created();
    const ratificationEventId = eventIdAt(90);
    const ratificationEventHash = hash('f'.repeat(64));

    await expect(
      activateInitiative(
        genesis,
        { eventId: eventIdAt(11), at: instant(CREATED_AT + 1), actor: PLAN.responsibleId },
        { ratificationEventId, ratificationEventHash },
      ),
    ).rejects.toMatchObject({ code: 'INITIATIVE_SYSTEM_ONLY' });

    const activated = await activateInitiative(
      genesis,
      { eventId: eventIdAt(12), at: instant(CREATED_AT + 1), actor: 'system' },
      { ratificationEventId, ratificationEventHash },
    );
    expect(replayInitiative(activated)).toMatchObject({
      status: 'por-empezar',
      activatedAt: instant(CREATED_AT + 1),
      ratificationEventId,
      ratificationEventHash,
    });
    await expect(
      activateInitiative(
        activated,
        { eventId: eventIdAt(13), at: instant(CREATED_AT + 2), actor: 'system' },
        { ratificationEventId, ratificationEventHash },
      ),
    ).rejects.toMatchObject({ code: 'INITIATIVE_ALREADY_ACTIVATED' });
  });

  it('replay rechaza una activación humana aunque la cadena sea válida', async () => {
    const genesis = await created();
    const forged = await appendChained<InitiativePayload>(genesis, {
      eventId: eventIdAt(14),
      aggregateId: INITIATIVE,
      occurredAt: instant(CREATED_AT + 1),
      actor: PLAN.responsibleId,
      payload: {
        type: 'InitiativeActivated',
        ratificationEventId: eventIdAt(90),
        ratificationEventHash: hash('f'.repeat(64)),
      },
    });
    expect(() => replayInitiative([...genesis, forged])).toThrow(
      expect.objectContaining({ code: 'INITIATIVE_SYSTEM_ONLY' }),
    );
  });
});

describe('hitos', () => {
  it('el responsable planifica un hito, incluso con plazo ya vencido', async () => {
    const dueAt = instant(CREATED_AT - 1);
    const log = await planMilestoneBy(await active(), by(20, responsible), {
      milestoneId: MILESTONE,
      title: 'Hito observable inicial',
      completionCriterion: 'La comunidad puede verificar públicamente el resultado logrado.',
      dueAt,
    });
    expect(replayInitiative(log).milestones[0]).toMatchObject({
      milestoneId: MILESTONE,
      dueAt,
    });
  });

  it('impide planificar a otra persona tanto por orden como en replay', async () => {
    const base = await active();
    await expect(
      planMilestoneBy(base, by(21, recipient), {
        milestoneId: MILESTONE,
        title: 'Hito ajeno imposible',
        completionCriterion: 'Existe evidencia observable suficiente para darlo por terminado.',
        dueAt: PLAN.reviewAt,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_THE_OWNER' });

    const forged = await appendChained<InitiativePayload>(base, {
      eventId: eventIdAt(22),
      aggregateId: INITIATIVE,
      occurredAt: instant(CREATED_AT + 2_000),
      actor: recipient.memberId!,
      payload: {
        type: 'MilestonePlanned',
        milestoneId: MILESTONE,
        title: 'Hito ajeno imposible',
        completionCriterion: 'Existe evidencia observable suficiente para darlo por terminado.',
        dueAt: PLAN.reviewAt,
      },
    });
    expect(() => replayInitiative([...base, forged])).toThrow(
      expect.objectContaining({ code: 'INITIATIVE_RESPONSIBLE_ONLY' }),
    );
  });

  it('aplica los límites exactos y no permite superar reviewAt', async () => {
    const base = await active();
    const valid = {
      milestoneId: MILESTONE,
      title: '1234567890',
      completionCriterion: '12345678901234567890',
      dueAt: PLAN.reviewAt,
    } as const;
    await expect(planMilestoneBy(base, by(23, responsible), valid)).resolves.toHaveLength(3);

    for (const candidate of [
      { ...valid, title: '123456789' },
      { ...valid, title: 'x'.repeat(141) },
      { ...valid, completionCriterion: '1234567890123456789' },
      { ...valid, completionCriterion: 'x'.repeat(501) },
    ]) {
      await expect(planMilestoneBy(base, by(24, responsible), candidate)).rejects.toMatchObject({
        code: 'INVALID_TEXT',
      });
    }
    await expect(
      planMilestoneBy(base, by(25, responsible), {
        ...valid,
        dueAt: instant(PLAN.reviewAt + 1),
      }),
    ).rejects.toMatchObject({ code: 'MILESTONE_AFTER_REVIEW' });
  });
});

describe('ofertas y respuestas de tareas', () => {
  it('la oferta usa su eventId como offerId y no asigna responsable antes de aceptar', async () => {
    const log = await offered();
    const task = replayInitiative(log).tasks[0];
    expect(task).toMatchObject({
      taskId: TASK,
      status: 'ofrecida',
      offeredTo: recipient.memberId,
      currentOfferId: eventIdAt(4),
      assigneeId: undefined,
    });
    expect(task?.offers).toEqual([
      expect.objectContaining({ offerId: eventIdAt(4), offeredTo: recipient.memberId }),
    ]);
  });

  it('valida que el destinatario sea miembro vigente, coincidente y del círculo', async () => {
    const base = await planned();
    const valid = {
      taskId: TASK,
      milestoneId: MILESTONE,
      offeredTo: recipient.memberId!,
      title: 'Preparar evidencia inicial',
      description: 'Reunir y publicar la evidencia verificable del primer hito.',
      effortMinutes: 60,
      dueAt: instant(PLAN.reviewAt - 2_000),
      dependsOn: [],
    } as const;
    await expect(
      offerTaskBy(base, by(30, responsible), {
        ...valid,
        recipient: { ...recipient, circles: [] },
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_IN_CIRCLE' });
    await expect(
      offerTaskBy(base, by(31, responsible), {
        ...valid,
        recipient: replacement,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_THE_SUBJECT' });
  });

  it('aplica límites de texto, esfuerzo, fecha y dependencias también en dominio', async () => {
    const base = await planned();
    const valid = {
      taskId: TASK,
      milestoneId: MILESTONE,
      offeredTo: recipient.memberId!,
      recipient,
      title: '1234567890',
      description: '12345678901234567890',
      effortMinutes: 1,
      dueAt: instant(PLAN.reviewAt - 2_000),
      dependsOn: [],
    } as const;
    await expect(offerTaskBy(base, by(32, responsible), valid)).resolves.toHaveLength(4);

    for (const candidate of [
      { ...valid, title: '123456789' },
      { ...valid, title: 'x'.repeat(141) },
      { ...valid, description: '1234567890123456789' },
      { ...valid, description: 'x'.repeat(4_001) },
    ]) {
      await expect(offerTaskBy(base, by(33, responsible), candidate)).rejects.toMatchObject({
        code: 'INVALID_TEXT',
      });
    }
    for (const effortMinutes of [0, 1.5, 10_081]) {
      await expect(
        offerTaskBy(base, by(34, responsible), { ...valid, effortMinutes }),
      ).rejects.toMatchObject({ code: 'TASK_EFFORT_INVALID' });
    }
    await expect(
      offerTaskBy(base, by(35, responsible), {
        ...valid,
        dueAt: PLAN.reviewAt,
      }),
    ).rejects.toMatchObject({ code: 'TASK_DUE_AFTER_MILESTONE' });
    await expect(
      offerTaskBy(base, by(36, responsible), {
        ...valid,
        dependsOn: Array.from({ length: 51 }, (_, index) =>
          taskId(index.toString(16).padStart(32, '0')),
        ),
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_TASK_DEPENDENCIES' });
  });

  it('rechaza dependencia propia, repetida o inexistente', async () => {
    const base = await planned();
    const valid = {
      taskId: TASK,
      milestoneId: MILESTONE,
      offeredTo: recipient.memberId!,
      recipient,
      title: 'Preparar evidencia inicial',
      description: 'Reunir y publicar la evidencia verificable del primer hito.',
      effortMinutes: 60,
      dueAt: instant(PLAN.reviewAt - 2_000),
    } as const;
    await expect(
      offerTaskBy(base, by(37, responsible), { ...valid, dependsOn: [TASK] }),
    ).rejects.toMatchObject({ code: 'TASK_SELF_DEPENDENCY' });
    await expect(
      offerTaskBy(base, by(38, responsible), { ...valid, dependsOn: [TASK_2, TASK_2] }),
    ).rejects.toMatchObject({ code: 'TASK_DEPENDENCY_DUPLICATE' });
    await expect(
      offerTaskBy(base, by(39, responsible), { ...valid, dependsOn: [TASK_2] }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_TASK_DEPENDENCY' });
  });

  it('sólo el destinatario responde y aceptar crea la asignación', async () => {
    const base = await offered();
    await expect(
      acceptAt(base, 40, replacement, {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(base),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_THE_SUBJECT' });
    const accepted = await acceptAt(base, 41, recipient, {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(base),
    });
    expect(replayInitiative(accepted).tasks[0]).toMatchObject({
      status: 'aceptada',
      assigneeId: recipient.memberId,
    });
    expect(accepted.at(-1)?.payload).toEqual({
      type: 'TaskAccepted',
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(base),
    });
    expect(accepted.at(-1)?.payload).not.toHaveProperty('capacity');
    expect(accepted.at(-1)?.payload).not.toHaveProperty('admission');
  });

  it('prevalida existencia, oferta, revisión, estado y actor en ese orden sin tocar el log', async () => {
    const base = await offered();
    const before = [...base];
    const revision = revisionOf(base);

    expect(() =>
      prepareTaskAcceptanceBy(base, by(400, replacement), {
        taskId: TASK_2,
        offerId: eventIdAt(400),
        expectedTaskSeq: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNKNOWN_TASK' }));
    expect(() =>
      prepareTaskAcceptanceBy(base, by(401, replacement), {
        taskId: TASK,
        offerId: eventIdAt(400),
        expectedTaskSeq: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'STALE_TASK_OFFER' }));
    expect(() =>
      prepareTaskAcceptanceBy(base, by(402, replacement), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revision - 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'STALE_TASK_REVISION' }));

    const answered = await acceptAt(base, 403, recipient, {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revision,
    });
    expect(() =>
      prepareTaskAcceptanceBy(answered, by(404, replacement), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(answered),
      }),
    ).toThrow(expect.objectContaining({ code: 'TASK_OFFER_ALREADY_ANSWERED' }));
    expect(() =>
      prepareTaskAcceptanceBy(base, by(405, replacement), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revision,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_NOT_THE_SUBJECT' }));
    expect(base).toEqual(before);
  });

  it('aceptar exige una admisión privada vigente, exacta y con cupo', async () => {
    const base = await offered();
    const meta = by(410, recipient);
    const command = {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(base),
    } as const;
    const candidate = prepareTaskAcceptanceBy(base, meta, command);

    expect(Object.keys(candidate).sort()).toEqual([
      'checkedAt',
      'effortMinutes',
      'memberId',
      'offerId',
      'taskId',
    ]);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(candidate).toMatchObject({
      memberId: recipient.memberId,
      taskId: TASK,
      offerId: eventIdAt(4),
      effortMinutes: 120,
      checkedAt: meta.at,
    });

    await expect(acceptTaskBy(base, meta, command, undefined as never)).rejects.toMatchObject({
      code: 'TASK_CAPACITY_ADMISSION_REQUIRED',
    });
    expect(() =>
      admitTaskCapacity(candidate, {
        currentLoadMinutes: 9_961,
        weeklyCapacityMinutes: 10_080,
      }),
    ).toThrow(expect.objectContaining({ code: 'TASK_CAPACITY_EXCEEDED' }));
    expect(() =>
      admitTaskCapacity(candidate, {
        currentLoadMinutes: 9_960,
        weeklyCapacityMinutes: 10_080.5,
      }),
    ).toThrow(expect.objectContaining({ code: 'TASK_WEEKLY_CAPACITY_INVALID' }));
    expect(() =>
      admitTaskCapacity(undefined as never, {
        currentLoadMinutes: 0,
        weeklyCapacityMinutes: 10_080,
      }),
    ).toThrow(expect.objectContaining({ code: 'TASK_ACCEPTANCE_CANDIDATE_REQUIRED' }));
    const serializedCandidate = JSON.parse(JSON.stringify(candidate)) as unknown;
    expect(() =>
      admitTaskCapacity(serializedCandidate as never, {
        currentLoadMinutes: 0,
        weeklyCapacityMinutes: 10_080,
      }),
    ).toThrow(expect.objectContaining({ code: 'TASK_ACCEPTANCE_CANDIDATE_REQUIRED' }));

    const checkedLater = prepareTaskAcceptanceBy(
      base,
      { ...meta, at: instant(meta.at + 1) },
      command,
    );
    const mismatches = [
      admitTaskCapacity(checkedLater, {
        currentLoadMinutes: 0,
        weeklyCapacityMinutes: 10_080,
      }),
    ];

    let reoffered = await rejectTaskBy(base, by(411, recipient), {
      ...command,
      reason: 'plazo-inviable',
    });
    reoffered = await reofferTaskBy(reoffered, by(412, responsible), {
      taskId: TASK,
      previousOfferId: eventIdAt(4),
      offeredTo: replacement.memberId!,
      recipient: replacement,
    });
    const replacementCandidate = prepareTaskAcceptanceBy(reoffered, by(413, replacement, meta.at), {
      taskId: TASK,
      offerId: eventIdAt(412),
      expectedTaskSeq: revisionOf(reoffered),
    });
    mismatches.push(
      admitTaskCapacity(replacementCandidate, {
        currentLoadMinutes: 0,
        weeklyCapacityMinutes: 10_080,
      }),
    );
    for (const admission of mismatches) {
      await expect(acceptTaskBy(base, meta, command, admission)).rejects.toMatchObject({
        code: 'TASK_CAPACITY_ADMISSION_MISMATCH',
      });
    }

    const validAdmission = admitTaskCapacity(candidate, {
      currentLoadMinutes: 9_960,
      weeklyCapacityMinutes: 10_080,
    });
    const serializedAdmission = JSON.parse(JSON.stringify(validAdmission)) as unknown;
    await expect(
      acceptTaskBy(base, meta, command, serializedAdmission as never),
    ).rejects.toMatchObject({ code: 'TASK_CAPACITY_ADMISSION_REQUIRED' });
    await expect(acceptTaskBy(base, meta, command, validAdmission)).resolves.toHaveLength(5);
  });

  it('rechazo y solicitud sólo registran motivos públicos no sensibles', async () => {
    const base = await offered();
    for (const reason of ['salud-personal', 'texto libre con datos privados']) {
      await expect(
        rejectTaskBy(base, by(42, recipient), {
          taskId: TASK,
          offerId: eventIdAt(4),
          expectedTaskSeq: revisionOf(base),
          reason: reason as never,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_TASK_RESPONSE_REASON' });
      await expect(
        requestTaskReassignmentBy(base, by(43, recipient), {
          taskId: TASK,
          offerId: eventIdAt(4),
          expectedTaskSeq: revisionOf(base),
          reason: reason as never,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_TASK_RESPONSE_REASON' });
    }
  });

  it('pedir reasignación revoca de inmediato la asignación aceptada', async () => {
    let log = await offered();
    log = await acceptAt(log, 44, recipient, {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
    });
    log = await requestTaskReassignmentBy(log, by(45, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      reason: 'sin-disponibilidad',
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'reasignacion-solicitada',
      assigneeId: undefined,
    });
  });

  it('serializa respuestas concurrentes: una gana y la segunda no se repliega', async () => {
    const base = await offered();
    const winner = await acceptAt(base, 46, recipient, {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(base),
    });
    const losingEvent = await appendChained<InitiativePayload>(winner, {
      eventId: eventIdAt(47),
      aggregateId: INITIATIVE,
      occurredAt: instant(CREATED_AT + 47_000),
      actor: recipient.memberId!,
      payload: {
        type: 'TaskRejected',
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(base),
        reason: 'plazo-inviable',
      },
    });
    expect(() => replayInitiative([...winner, losingEvent])).toThrow(
      expect.objectContaining({ code: 'STALE_TASK_REVISION' }),
    );
    expect(replayInitiative(winner).tasks[0]?.responses).toHaveLength(1);
  });

  it('aceptar y pedir relevo desde la misma revisión no se escriben ambos', async () => {
    const base = await offered();
    const revision = revisionOf(base);
    const accepted = await acceptAt(base, 470, recipient, {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revision,
    });

    await expect(
      requestTaskReassignmentBy(accepted, by(471, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revision,
        reason: 'razon-privada',
      }),
    ).rejects.toMatchObject({ code: 'STALE_TASK_REVISION' });

    await expect(
      requestTaskReassignmentBy(accepted, by(472, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(accepted),
        reason: 'alcance-no-claro',
      }),
    ).resolves.toHaveLength(6);
  });

  it('reoferta con CAS previousOfferId y bloquea respuestas viejas y ABA', async () => {
    let log = await offered();
    log = await rejectTaskBy(log, by(48, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      reason: 'plazo-inviable',
    });
    log = await reofferTaskBy(log, by(49, responsible), {
      taskId: TASK,
      previousOfferId: eventIdAt(4),
      offeredTo: replacement.memberId!,
      recipient: replacement,
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'ofrecida',
      currentOfferId: eventIdAt(49),
      offeredTo: replacement.memberId,
      assigneeId: undefined,
    });

    await expect(
      acceptAt(log, 50, recipient, {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(log),
      }),
    ).rejects.toMatchObject({ code: 'STALE_TASK_OFFER' });

    log = await rejectTaskBy(log, by(51, replacement), {
      taskId: TASK,
      offerId: eventIdAt(49),
      expectedTaskSeq: revisionOf(log),
      reason: 'sin-disponibilidad',
    });
    log = await reofferTaskBy(log, by(52, responsible), {
      taskId: TASK,
      previousOfferId: eventIdAt(49),
      offeredTo: recipient.memberId!,
      recipient,
    });
    expect(replayInitiative(log).tasks[0]?.currentOfferId).toBe(eventIdAt(52));

    await expect(
      reofferTaskBy(log, by(53, responsible), {
        taskId: TASK,
        previousOfferId: eventIdAt(4),
        offeredTo: replacement.memberId!,
        recipient: replacement,
      }),
    ).rejects.toMatchObject({ code: 'STALE_TASK_OFFER' });
  });
});

describe('trabajo activo, evidencia y revisión', () => {
  it('recorre inicio, bloqueo, ayuda, reanudación, entrega, cambios y aceptación final', async () => {
    let log = await accepted();
    log = await startTaskBy(log, by(60, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'en-curso',
      startedAt: by(60, recipient).at,
      starts: [expect.objectContaining({ offerId: eventIdAt(4), by: recipient.memberId })],
    });

    log = await blockTaskBy(log, by(61, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      category: 'respuesta-externa',
      privateDetailCommitment: commitment('3'),
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'bloqueada',
      currentPause: {
        pauseId: eventIdAt(61),
        kind: 'blocked',
        category: 'respuesta-externa',
      },
    });

    log = await requestTaskHelpBy(log, by(62, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      category: 'desbloqueo',
    });
    const inSupport = replayInitiative(log).tasks[0]!;
    expect(inSupport).toMatchObject({
      status: 'en-apoyo',
      currentPause: { pauseId: eventIdAt(61) },
      helpRequests: [
        expect.objectContaining({ helpRequestId: eventIdAt(62), pauseId: eventIdAt(61) }),
      ],
    });
    expect(inSupport.pauses).toHaveLength(1);

    await expect(
      resumeTaskBy(log, by(63, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(log),
        pauseId: eventIdAt(62),
      }),
    ).rejects.toMatchObject({ code: 'STALE_TASK_PAUSE' });

    log = await addTaskEvidenceBy(log, by(64, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      objectCommitment: commitment('4'),
      kindCode: 'imagen',
      sizeClass: 'mediana',
      visibility: 'public',
    });
    expect(log.at(-1)?.payload).toEqual({
      type: 'TaskEvidenceAdded',
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log) - 1,
      objectCommitment: commitment('4'),
      kindCode: 'imagen',
      sizeClass: 'mediana',
      visibility: 'public',
    });
    expect(log.at(-1)?.payload).not.toHaveProperty('mediaType');
    expect(log.at(-1)?.payload).not.toHaveProperty('bytes');
    log = await resumeTaskBy(log, by(65, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      pauseId: eventIdAt(61),
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'en-curso',
      currentPause: undefined,
      pauses: [expect.objectContaining({ endedBy: 'resumed', endedAt: by(65, recipient).at })],
      evidence: [
        expect.objectContaining({ evidenceId: eventIdAt(64), addedBy: recipient.memberId }),
      ],
    });

    log = await deliverTaskBy(log, by(66, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      evidenceIds: [eventIdAt(64)],
      summaryCommitment: commitment('5'),
    });
    const firstDelivery = replayInitiative(log).tasks[0]!;
    expect(firstDelivery).toMatchObject({
      status: 'entregada',
      currentDeliveryId: eventIdAt(66),
      deliveries: [expect.objectContaining({ deliveryId: eventIdAt(66), review: undefined })],
    });

    await expect(
      requestTaskChangesBy(log, by(67, replacement), {
        taskId: TASK,
        deliveryId: eventIdAt(66),
        expectedTaskSeq: revisionOf(log),
        reason: 'evidencia-insuficiente',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_THE_OWNER' });

    log = await requestTaskChangesBy(log, by(68, responsible), {
      taskId: TASK,
      deliveryId: eventIdAt(66),
      expectedTaskSeq: revisionOf(log),
      reason: 'evidencia-insuficiente',
      privateDetailCommitment: commitment('6'),
    });
    const reopened = replayInitiative(log).tasks[0]!;
    expect(reopened).toMatchObject({
      status: 'en-curso',
      currentDeliveryId: undefined,
    });
    expect(reopened.deliveries[0]?.review).toMatchObject({
      type: 'changes-requested',
      by: responsible.memberId,
    });

    log = await deliverTaskBy(log, by(69, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      evidenceIds: [eventIdAt(64)],
      summaryCommitment: commitment('7'),
    });
    log = await acceptTaskReviewBy(log, by(70, responsible), {
      taskId: TASK,
      deliveryId: eventIdAt(69),
      expectedTaskSeq: revisionOf(log),
      outcomeCriterionEvidence: 'verificada',
    });
    const completed = replayInitiative(log).tasks[0]!;
    expect(completed).toMatchObject({
      status: 'completada',
      assigneeId: recipient.memberId,
      currentDeliveryId: undefined,
      completedAt: by(70, responsible).at,
    });
    expect(completed.deliveries[1]?.review).toMatchObject({
      type: 'accepted',
      by: responsible.memberId,
      outcomeCriterionEvidence: 'verificada',
    });

    await expect(
      addTaskEvidenceBy(log, by(71, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(log),
        objectCommitment: commitment('8'),
        kindCode: 'texto',
        sizeClass: 'pequena',
        visibility: 'restricted',
      }),
    ).rejects.toMatchObject({ code: 'TASK_EVIDENCE_NOT_ALLOWED' });
  });

  it('pedir ayuda directamente abre una sola pausa cuyo eventId debe usarse al reanudar', async () => {
    let log = await started();
    log = await requestTaskHelpBy(log, by(72, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      category: 'orientacion',
      privateDetailCommitment: commitment('9'),
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'en-apoyo',
      currentPause: { pauseId: eventIdAt(72), kind: 'support' },
      helpRequests: [
        expect.objectContaining({ helpRequestId: eventIdAt(72), pauseId: eventIdAt(72) }),
      ],
    });
    expect(replayInitiative(log).tasks[0]?.pauses).toHaveLength(1);

    log = await resumeTaskBy(log, by(73, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      pauseId: eventIdAt(72),
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'en-curso',
      currentPause: undefined,
    });
  });

  it('no inicia hasta que todas sus dependencias estén completadas', async () => {
    let log = await offered();
    log = await offerTaskBy(log, by(80, responsible), {
      taskId: TASK_2,
      milestoneId: MILESTONE,
      offeredTo: replacement.memberId!,
      recipient: replacement,
      title: 'Publicar el resultado verificado',
      description: 'Publicar el resultado sólo después de completar la evidencia anterior.',
      effortMinutes: 30,
      dueAt: instant(PLAN.reviewAt - 1_500),
      dependsOn: [TASK],
    });
    log = await acceptAt(log, 81, replacement, {
      taskId: TASK_2,
      offerId: eventIdAt(80),
      expectedTaskSeq: replayInitiative(log).tasks[1]!.lastSeq,
    });
    await expect(
      startTaskBy(log, by(82, replacement), {
        taskId: TASK_2,
        offerId: eventIdAt(80),
        expectedTaskSeq: replayInitiative(log).tasks[1]!.lastSeq,
      }),
    ).rejects.toMatchObject({ code: 'TASK_DEPENDENCY_NOT_COMPLETED' });

    log = await acceptAt(log, 83, recipient, {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: replayInitiative(log).tasks[0]!.lastSeq,
    });
    log = await startTaskBy(log, by(84, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: replayInitiative(log).tasks[0]!.lastSeq,
    });
    log = await addTaskEvidenceBy(log, by(85, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: replayInitiative(log).tasks[0]!.lastSeq,
      objectCommitment: commitment('a'),
      kindCode: 'texto',
      sizeClass: 'pequena',
      visibility: 'public',
    });
    log = await deliverTaskBy(log, by(86, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: replayInitiative(log).tasks[0]!.lastSeq,
      evidenceIds: [eventIdAt(85)],
      summaryCommitment: commitment('b'),
    });
    log = await acceptTaskReviewBy(log, by(87, responsible), {
      taskId: TASK,
      deliveryId: eventIdAt(86),
      expectedTaskSeq: replayInitiative(log).tasks[0]!.lastSeq,
      outcomeCriterionEvidence: 'verificada',
    });
    log = await startTaskBy(log, by(88, replacement), {
      taskId: TASK_2,
      offerId: eventIdAt(80),
      expectedTaskSeq: replayInitiative(log).tasks[1]!.lastSeq,
    });
    expect(replayInitiative(log).tasks[1]?.status).toBe('en-curso');
  });

  it('reasignar desde trabajo activo cierra la pausa, revoca el assignee y permite reoferta', async () => {
    let log = await started();
    log = await blockTaskBy(log, by(90, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      category: 'recurso',
    });
    log = await requestTaskReassignmentBy(log, by(91, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(log),
      reason: 'sin-disponibilidad',
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'reasignacion-solicitada',
      assigneeId: undefined,
      currentPause: undefined,
      pauses: [expect.objectContaining({ endedBy: 'reassignment', endedAt: by(91, recipient).at })],
    });

    log = await reofferTaskBy(log, by(92, responsible), {
      taskId: TASK,
      previousOfferId: eventIdAt(4),
      offeredTo: replacement.memberId!,
      recipient: replacement,
    });
    expect(replayInitiative(log).tasks[0]).toMatchObject({
      status: 'ofrecida',
      currentOfferId: eventIdAt(92),
      assigneeId: undefined,
      startedAt: undefined,
    });
  });

  it('rechaza categorías, commitments, archivos y entregas inválidos sin mutar el log', async () => {
    const base = await started();
    const revision = revisionOf(base);
    await expect(
      blockTaskBy(base, by(100, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revision,
        category: 'salud' as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TASK_BLOCK_CATEGORY' });
    await expect(
      requestTaskHelpBy(base, by(101, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revision,
        category: 'dato-personal' as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TASK_HELP_CATEGORY' });
    await expect(
      addTaskEvidenceBy(base, by(102, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revision,
        objectCommitment: 'no-es-un-hash' as never,
        kindCode: 'texto',
        sizeClass: 'pequena',
        visibility: 'restricted',
      }),
    ).rejects.toBeDefined();
    for (const candidate of [
      { kindCode: 'audio', sizeClass: 'pequena', visibility: 'restricted' },
      { kindCode: 'texto', sizeClass: 'diminuta', visibility: 'restricted' },
      { kindCode: 'texto', sizeClass: 'pequena', visibility: 'secret' },
    ] as const) {
      await expect(
        addTaskEvidenceBy(base, by(103, recipient), {
          taskId: TASK,
          offerId: eventIdAt(4),
          expectedTaskSeq: revision,
          objectCommitment: commitment('c'),
          kindCode: candidate.kindCode as never,
          sizeClass: candidate.sizeClass as never,
          visibility: candidate.visibility as never,
        }),
      ).rejects.toBeDefined();
    }
    await expect(
      deliverTaskBy(base, by(104, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revision,
        evidenceIds: [],
        summaryCommitment: commitment('d'),
      }),
    ).rejects.toMatchObject({ code: 'TASK_DELIVERY_EVIDENCE_COUNT_INVALID' });
    expect(replayInitiative(base).tasks[0]?.lastSeq).toBe(revision);
  });

  it('rechaza revisión obsoleta o vocabulario inventado y deja completada como terminal', async () => {
    let log = await delivered();
    const deliveryRevision = revisionOf(log);
    await expect(
      requestTaskChangesBy(log, by(110, responsible), {
        taskId: TASK,
        deliveryId: eventIdAt(999),
        expectedTaskSeq: deliveryRevision,
        reason: 'criterio-no-cumplido',
      }),
    ).rejects.toMatchObject({ code: 'STALE_TASK_DELIVERY' });
    await expect(
      requestTaskChangesBy(log, by(111, responsible), {
        taskId: TASK,
        deliveryId: eventIdAt(8),
        expectedTaskSeq: deliveryRevision,
        reason: 'porque-si' as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TASK_CHANGE_REASON' });
    await expect(
      acceptTaskReviewBy(log, by(112, responsible), {
        taskId: TASK,
        deliveryId: eventIdAt(8),
        expectedTaskSeq: deliveryRevision,
        outcomeCriterionEvidence: 'excelente' as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_OUTCOME_CRITERION_EVIDENCE' });

    log = await acceptTaskReviewBy(log, by(113, responsible), {
      taskId: TASK,
      deliveryId: eventIdAt(8),
      expectedTaskSeq: deliveryRevision,
      outcomeCriterionEvidence: 'sin-verificar',
    });
    await expect(
      requestTaskReassignmentBy(log, by(114, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(log),
        reason: 'razon-privada',
      }),
    ).rejects.toMatchObject({ code: 'TASK_REASSIGNMENT_NOT_ALLOWED' });
    await expect(
      acceptTaskReviewBy(log, by(115, responsible), {
        taskId: TASK,
        deliveryId: eventIdAt(8),
        expectedTaskSeq: revisionOf(log),
        outcomeCriterionEvidence: 'verificada',
      }),
    ).rejects.toMatchObject({ code: 'STALE_TASK_DELIVERY' });
  });

  it('replay rechaza que otra persona fabrique un inicio aunque la cadena sea válida', async () => {
    const base = await accepted();
    const forged = await appendChained<InitiativePayload>(base, {
      eventId: eventIdAt(120),
      aggregateId: INITIATIVE,
      occurredAt: by(120, replacement).at,
      actor: replacement.memberId!,
      payload: {
        type: 'TaskStarted',
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(base),
      },
    });
    expect(() => replayInitiative([...base, forged])).toThrow(
      expect.objectContaining({ code: 'TASK_ACTOR_MISMATCH' }),
    );
  });
});

describe('fronteras adversariales del historial de iniciativa', () => {
  it('apply, replay y emit rechazan una colisión eventId entre tipos distintos', async () => {
    const base = await started();
    const duplicate = await appendChained<InitiativePayload>(base, {
      eventId: eventIdAt(4),
      aggregateId: INITIATIVE,
      occurredAt: by(130, recipient).at,
      actor: recipient.memberId!,
      payload: {
        type: 'TaskBlocked',
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(base),
        category: 'dependencia',
      },
    });

    expect(() => applyInitiative(replayInitiative(base), duplicate)).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_INITIATIVE_EVENT_ID' }),
    );
    expect(() => replayInitiative([...base, duplicate])).toThrow(
      expect.objectContaining({ code: 'DUPLICATE_INITIATIVE_EVENT_ID' }),
    );
    await expect(
      blockTaskBy(base, by(4, recipient), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(base),
        category: 'dependencia',
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_INITIATIVE_EVENT_ID' });
  });

  it('los comandos proyectan campos explícitos y jamás arrastran metadatos hostiles', async () => {
    const base = await accepted();
    const log = await startTaskBy(base, by(131, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(base),
      privateDetail: 'texto que no debe entrar',
      filename: 'diagnostico.pdf',
      url: 'https://ejemplo.invalid/privado',
      bytes: 99,
      capacity: 120,
    } as never);
    expect(log.at(-1)?.payload).toEqual({
      type: 'TaskStarted',
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(base),
    });
  });

  it('replay rechaza claves desconocidas en cada tipo histórico aunque sean casteadas', async () => {
    const base = await delivered();
    const forbidden = ['privateDetail', 'filename', 'url', 'bytes', 'capacity'] as const;
    for (let index = 0; index < base.length; index++) {
      for (const key of forbidden) {
        const original = base[index]!;
        const forged = {
          ...original,
          payload: { ...original.payload, [key]: 'dato-prohibido' },
        };
        const log = base.map((event, candidate) => (candidate === index ? forged : event));
        expect(() => replayInitiative(log as InitiativeLog)).toThrow(
          expect.objectContaining({ code: 'INITIATIVE_PAYLOAD_UNKNOWN_FIELD' }),
        );
      }
    }
  });

  it('replay rechaza getters, propiedades ocultas y opcionales undefined antes de usarlos', async () => {
    const base = await accepted();
    const original = base.at(-1)!;
    let getterCalls = 0;
    const getterPayload = {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(await offered()),
    };
    Object.defineProperty(getterPayload, 'type', {
      enumerable: true,
      get: () => {
        getterCalls++;
        return 'TaskAccepted';
      },
    });
    expect(() =>
      replayInitiative([...base.slice(0, -1), { ...original, payload: getterPayload as never }]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INITIATIVE_PAYLOAD' }));
    expect(getterCalls).toBe(0);

    const hiddenPayload = { ...original.payload };
    Object.defineProperty(hiddenPayload, 'filename', {
      enumerable: false,
      value: 'oculto.pdf',
    });
    expect(() =>
      replayInitiative([...base.slice(0, -1), { ...original, payload: hiddenPayload }]),
    ).toThrow(expect.objectContaining({ code: 'INITIATIVE_PAYLOAD_UNKNOWN_FIELD' }));

    const blocked = await blockTaskBy(await started(), by(132, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(await started()),
      category: 'dependencia',
    });
    const blockedEvent = blocked.at(-1)!;
    expect(() =>
      replayInitiative([
        ...blocked.slice(0, -1),
        {
          ...blockedEvent,
          payload: { ...blockedEvent.payload, privateDetailCommitment: undefined } as never,
        },
      ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INITIATIVE_PAYLOAD' }));
  });

  it('rechaza campos desconocidos dentro del plan y de sus criterios', async () => {
    await expect(
      createInitiative(systemMeta, {
        ...input,
        executionPlan: { ...PLAN, privateDetail: 'no publicar' } as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INITIATIVE_EXECUTION_PLAN_PAYLOAD' });
    await expect(
      createInitiative(systemMeta, {
        ...input,
        executionPlan: {
          ...PLAN,
          successCriteria: [{ ...PLAN.successCriteria[0], url: 'https://privado.invalid' }],
        } as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INITIATIVE_EXECUTION_PLAN_PAYLOAD' });
  });
});
