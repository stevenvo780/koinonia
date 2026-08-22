import { describe, expect, it } from 'vitest';

import {
  acceptTaskBy,
  activateInitiative,
  appendChained,
  type Actor,
  createInitiative,
  currentInitiative,
  hash,
  initiativeId,
  milestoneId,
  offerTaskBy,
  planMilestoneBy,
  rejectTaskBy,
  reofferTaskBy,
  requestTaskReassignmentBy,
  taskId,
  type InitiativePayload,
  replayInitiative,
  verifyInitiativeLog,
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

function by(event: number, actor: Actor, at = instant(CREATED_AT + event * 1_000)) {
  return { eventId: eventIdAt(event), at, by: actor } as const;
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

function revisionOf(log: Awaited<ReturnType<typeof offered>>): number {
  const revision = replayInitiative(log).tasks.find((task) => task.taskId === TASK)?.lastSeq;
  if (revision === undefined) throw new Error('la prueba exige la tarea vigente');
  return revision;
}

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
      acceptTaskBy(base, by(40, replacement), {
        taskId: TASK,
        offerId: eventIdAt(4),
        expectedTaskSeq: revisionOf(base),
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_THE_SUBJECT' });
    const accepted = await acceptTaskBy(base, by(41, recipient), {
      taskId: TASK,
      offerId: eventIdAt(4),
      expectedTaskSeq: revisionOf(base),
    });
    expect(replayInitiative(accepted).tasks[0]).toMatchObject({
      status: 'aceptada',
      assigneeId: recipient.memberId,
    });
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
    log = await acceptTaskBy(log, by(44, recipient), {
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
    const winner = await acceptTaskBy(base, by(46, recipient), {
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
    const accepted = await acceptTaskBy(base, by(470, recipient), {
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
      acceptTaskBy(log, by(50, recipient), {
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
