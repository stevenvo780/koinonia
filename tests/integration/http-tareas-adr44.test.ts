/** ADR-0044: hitos, ofertas y respuestas reales contra Fastify + PostgreSQL. */

import {
  loadInitiativeState,
  persistInitiativeLogWithin,
  readStream,
  withTransaction,
} from '@koinonia/api';
import {
  activateInitiative,
  createInitiative,
  decisionId,
  eventId,
  hash,
  initiativeId,
  instant,
  proposalId,
} from '@koinonia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiEnv, type ApiListo, como, entrar, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();
const CIRCLE = 'e5bac105b1e00000000000000000000b';
const OTHER_CIRCLE = 'a55a11b1ea00000000000000000000a1';
const DAY = 24 * 60 * 60 * 1_000;
let n = 0x4400;

function requestId(): string {
  const value = (++n).toString(16).padStart(32, '0');
  return (
    `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-` +
    `8${value.slice(17, 20)}-${value.slice(20, 32)}`
  );
}

interface Session {
  readonly testigo: string;
  readonly miembroId: string;
}

interface InitiativeView {
  readonly id: string;
  readonly activa: boolean;
  readonly esResponsableInicial: boolean;
  readonly hitos: readonly {
    readonly id: string;
    readonly titulo: string;
  }[];
  readonly tareas: readonly {
    readonly id: string;
    readonly hitoId: string;
    readonly destinatarioId: string;
    readonly responsableId?: string;
    readonly ofertaId: string;
    readonly revision: number;
    readonly titulo: string;
    readonly estado: 'ofrecida' | 'aceptada' | 'rechazada' | 'reasignacion-solicitada';
    readonly esMia: boolean;
  }[];
}

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`API de tareas ADR-0044${skipNote(env)}`, () => {
  let e: ApiListo;

  beforeAll(() => {
    e = listo(env);
  });

  async function activeInitiative(responsibleId: string): Promise<string> {
    const id = initiativeId(e.azar.opaqueId());
    const at = instant(e.reloj.now());
    let log = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash('1'.repeat(64)),
        decisionResultHash: hash('2'.repeat(64)),
        circleId: CIRCLE as never,
        executionPlan: {
          objective:
            'Convertir el acuerdo colectivo en un piloto documentado que pueda revisarse públicamente.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 30 * DAY),
          successCriteria: [
            {
              description: 'El piloto conserva evidencia suficiente para una revisión colectiva.',
              evidenceSource: 'Acta y registro público de la iniciativa',
            },
          ],
        },
      },
    );
    log = await activateInitiative(
      log,
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        ratificationEventId: eventId(e.azar.opaqueId()),
        ratificationEventHash: hash('3'.repeat(64)),
      },
    );
    await withTransaction(e.pool, (client) =>
      persistInitiativeLogWithin(client, log, { requestId: requestId() }),
    );
    return id;
  }

  async function provisionalInitiative(responsibleId: string): Promise<string> {
    const id = initiativeId(e.azar.opaqueId());
    const log = await createInitiative(
      {
        eventId: eventId(e.azar.opaqueId()),
        at: instant(e.reloj.now()),
        actor: 'system',
      },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash('4'.repeat(64)),
        decisionResultHash: hash('5'.repeat(64)),
        circleId: CIRCLE as never,
        executionPlan: {
          objective:
            'Conservar una iniciativa histórica provisional sin inventar trabajo que nunca ocurrió.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 30 * DAY),
          successCriteria: [
            {
              description:
                'La lectura histórica conserva listas vacías y ninguna activación falsa.',
              evidenceSource: 'Reconstrucción directa del ledger',
            },
          ],
        },
      },
    );
    await withTransaction(e.pool, (client) =>
      persistInitiativeLogWithin(client, log, { requestId: requestId() }),
    );
    return id;
  }

  async function planMilestone(
    initiative: string,
    responsible: Session,
    idempotencyKey = requestId(),
  ): Promise<{ readonly response: InitiativeView; readonly requestId: string }> {
    const response = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/hitos`,
      headers: como(responsible.testigo),
      payload: {
        requestId: idempotencyKey,
        titulo: 'Preparar y ejecutar el primer piloto colectivo',
        criterioDeTerminacion:
          'El piloto termina con un acta, evidencias y una fecha de revisión publicadas.',
        venceEn: e.reloj.now() + 20 * DAY,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return { response: response.json<InitiativeView>(), requestId: idempotencyKey };
  }

  async function offerTask(input: {
    initiative: string;
    milestone: string;
    responsible: Session;
    recipient: Session;
    request?: string;
    title?: string;
  }): Promise<{ readonly response: InitiativeView; readonly requestId: string }> {
    const idempotencyKey = input.request ?? requestId();
    const response = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${input.initiative}/tareas`,
      headers: como(input.responsible.testigo),
      payload: {
        requestId: idempotencyKey,
        hitoId: input.milestone,
        destinatarioId: input.recipient.miembroId,
        titulo: input.title ?? 'Documentar las condiciones iniciales del piloto',
        descripcion:
          'Registrar el punto de partida, las restricciones conocidas y la evidencia que permitirá evaluar el piloto.',
        venceEn: e.reloj.now() + 10 * DAY,
        esfuerzoMinutos: 180,
        dependeDe: [],
      },
    });
    expect(response.statusCode).toBe(201);
    return { response: response.json<InitiativeView>(), requestId: idempotencyKey };
  }

  it('rehidrata logs históricos sin activación, hitos ni tareas inventadas', async () => {
    const responsible = await entrar(e, 'historica.tareas@udea.edu.co');
    const id = await provisionalInitiative(responsible.miembroId);

    const response = await e.app.inject({ method: 'GET', url: `/iniciativas/${id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json<InitiativeView>()).toMatchObject({
      id,
      activa: false,
      hitos: [],
      tareas: [],
    });

    const cannotPlan = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/hitos`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'Este hito todavía no puede comenzar a ejecutarse',
        criterioDeTerminacion:
          'La iniciativa debe permanecer sin trabajo hasta que exista una ratificación verificable.',
        venceEn: e.reloj.now() + 20 * DAY,
      },
    });
    expect(cannotPlan.statusCode).toBe(422);
    expect(cannotPlan.json<{ codigo: string }>().codigo).toBe('INITIATIVE_NOT_ACTIVE');
    expect(await readStream(e.pool, id)).toHaveLength(1);

    const client = await e.pool.connect();
    try {
      const state = await loadInitiativeState(client, id);
      expect(state.activatedAt).toBeUndefined();
      expect(state.milestones).toEqual([]);
      expect(state.tasks).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('reintenta un hito sin regenerar ID o instante y rechaza cambios de cuerpo o actor', async () => {
    const responsible = await entrar(e, 'responsable.hito@udea.edu.co');
    const other = await entrar(e, 'otra.hito@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const raw = requestId();
    const first = await planMilestone(id, responsible, raw);
    const original = first.response.hitos[0];
    expect(original).toBeDefined();
    const before = await readStream(e.pool, id);

    const replay = await planMilestone(id, responsible, raw);
    expect(replay.response.hitos).toEqual(first.response.hitos);
    expect(await readStream(e.pool, id)).toEqual(before);

    const changed = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/hitos`,
      headers: como(responsible.testigo),
      payload: {
        requestId: raw,
        titulo: 'Preparar un hito distinto usando la misma clave',
        criterioDeTerminacion:
          'El segundo cuerpo no puede sustituir silenciosamente el primer hito ya sellado.',
        venceEn: e.reloj.now() + 20 * DAY,
      },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');

    const otherActor = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/hitos`,
      headers: como(other.testigo),
      payload: {
        requestId: raw,
        titulo: 'Preparar y ejecutar el primer piloto colectivo',
        criterioDeTerminacion:
          'El piloto termina con un acta, evidencias y una fecha de revisión publicadas.',
        venceEn: e.reloj.now() + 20 * DAY,
      },
    });
    expect(otherActor.statusCode).toBe(409);
    expect(otherActor.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');

    const otherInitiative = await activeInitiative(responsible.miembroId);
    const crossAggregate = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${otherInitiative}/hitos`,
      headers: como(responsible.testigo),
      payload: {
        requestId: raw,
        titulo: 'Preparar y ejecutar el primer piloto colectivo',
        criterioDeTerminacion:
          'El piloto termina con un acta, evidencias y una fecha de revisión publicadas.',
        venceEn: e.reloj.now() + 20 * DAY,
      },
    });
    expect(crossAggregate.statusCode).toBe(409);
    expect(crossAggregate.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await readStream(e.pool, id)).toEqual(before);
  });

  it('un replay exacto revalida el rol vigente del actor antes de devolver éxito', async () => {
    const responsible = await entrar(e, 'responsable.replay.rol@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const command = {
      requestId: requestId(),
      titulo: 'Preparar un hito cuyo replay conserve autorización viva',
      criterioDeTerminacion:
        'El replay sólo se entrega cuando la persona conserva hoy la capacidad política requerida.',
      venceEn: e.reloj.now() + 20 * DAY,
    };
    const first = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/hitos`,
      headers: como(responsible.testigo),
      payload: command,
    });
    expect(first.statusCode).toBe(201);
    const beforeReplay = await readStream(e.pool, id);

    try {
      for (const role of ['tech-admin', 'observer']) {
        await e.superPool.query(
          `UPDATE identity.member SET roles = ARRAY[$2]::text[] WHERE member_id = $1`,
          [responsible.miembroId, role],
        );
        const denied = await e.app.inject({
          method: 'POST',
          url: `/iniciativas/${id}/hitos`,
          headers: como(responsible.testigo),
          payload: command,
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_ROLE_NOT_GRANTED');
        expect(await readStream(e.pool, id)).toEqual(beforeReplay);
      }
    } finally {
      await e.superPool.query(
        `UPDATE identity.member SET roles = ARRAY['member'] WHERE member_id = $1`,
        [responsible.miembroId],
      );
    }
  });

  it('la oferta exacta conserva taskId/offerId y una variante no se vuelve no-op', async () => {
    const responsible = await entrar(e, 'responsable.oferta@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.oferta@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const milestone = (await planMilestone(id, responsible)).response.hitos[0]!.id;
    const raw = requestId();
    const first = await offerTask({
      initiative: id,
      milestone,
      responsible,
      recipient,
      request: raw,
    });
    const original = first.response.tareas[0];
    expect(original).toMatchObject({
      destinatarioId: recipient.miembroId,
      estado: 'ofrecida',
      esMia: false,
    });
    expect(original?.responsableId).toBeUndefined();
    const before = await readStream(e.pool, id);

    const replay = await offerTask({
      initiative: id,
      milestone,
      responsible,
      recipient,
      request: raw,
    });
    expect(replay.response.tareas[0]?.id).toBe(original?.id);
    expect(replay.response.tareas[0]?.ofertaId).toBe(original?.ofertaId);
    expect(await readStream(e.pool, id)).toEqual(before);

    const changed = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas`,
      headers: como(responsible.testigo),
      payload: {
        requestId: raw,
        hitoId: milestone,
        destinatarioId: recipient.miembroId,
        titulo: 'Documentar un alcance distinto con la misma clave',
        descripcion:
          'Este cuerpo divergente demuestra que la misma clave no convierte una segunda tarea en un replay exitoso.',
        venceEn: e.reloj.now() + 10 * DAY,
        esfuerzoMinutos: 180,
        dependeDe: [],
      },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await readStream(e.pool, id)).toEqual(before);
  });

  it('falla cerrado para otra persona, administrador técnico, otro círculo y matrícula retirada', async () => {
    const responsible = await entrar(e, 'responsable.permisos.tareas@udea.edu.co');
    const other = await entrar(e, 'otra.permisos.tareas@udea.edu.co');
    const tech = await entrar(e, 'tech.permisos.tareas@udea.edu.co');
    const outside = await entrar(e, 'afuera.permisos.tareas@udea.edu.co');
    const withdrawn = await entrar(e, 'retirada.permisos.tareas@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);

    await e.superPool.query(
      `UPDATE identity.member SET roles = ARRAY['tech-admin'] WHERE member_id = $1`,
      [tech.miembroId],
    );
    await e.superPool.query(
      `UPDATE identity.member SET circles = ARRAY[$2::char(32)] WHERE member_id = $1`,
      [outside.miembroId, OTHER_CIRCLE],
    );
    await e.superPool.query(
      `UPDATE identity.member
          SET withdrawn_at = to_timestamp($2::double precision / 1000)
        WHERE member_id = $1`,
      [withdrawn.miembroId, e.reloj.now()],
    );

    for (const actor of [other, tech]) {
      const denied = await e.app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/hitos`,
        headers: como(actor.testigo),
        payload: {
          requestId: requestId(),
          titulo: 'Un hito que este actor no puede planificar',
          criterioDeTerminacion:
            'El historial debe permanecer intacto aunque se llame la API sin permiso suficiente.',
          venceEn: e.reloj.now() + 20 * DAY,
        },
      });
      expect(denied.statusCode).toBe(403);
    }

    const milestone = (await planMilestone(id, responsible)).response.hitos[0]!.id;
    for (const recipient of [outside, withdrawn]) {
      const denied = await e.app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas`,
        headers: como(responsible.testigo),
        payload: {
          requestId: requestId(),
          hitoId: milestone,
          destinatarioId: recipient.miembroId,
          titulo: 'Una oferta que no puede atribuirse a esta persona',
          descripcion:
            'La persona no es integrante vigente del círculo y por eso la oferta no debe entrar al historial.',
          venceEn: e.reloj.now() + 10 * DAY,
          esfuerzoMinutos: 60,
          dependeDe: [],
        },
      });
      expect(denied.statusCode).toBe(403);
    }

    expect(
      (await readStream(e.pool, id)).filter((row) => row.event.eventType === 'TaskOffered'),
    ).toHaveLength(0);
  });

  it('aceptar, rechazar y pedir reasignación concurrentemente tienen un único ganador', async () => {
    const responsible = await entrar(e, 'responsable.carrera@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.carrera@udea.edu.co');
    const other = await entrar(e, 'otra.carrera@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const milestone = (await planMilestone(id, responsible)).response.hitos[0]!.id;
    const offered = await offerTask({ initiative: id, milestone, responsible, recipient });
    const task = offered.response.tareas[0]!;
    const contenders = [
      {
        requestId: requestId(),
        payload: {
          offerId: task.ofertaId,
          revision: task.revision,
          tipo: 'aceptar' as const,
        },
      },
      {
        requestId: requestId(),
        payload: {
          offerId: task.ofertaId,
          revision: task.revision,
          tipo: 'rechazar' as const,
          motivo: 'sin-disponibilidad' as const,
        },
      },
      {
        requestId: requestId(),
        payload: {
          offerId: task.ofertaId,
          revision: task.revision,
          tipo: 'pedir-reasignacion' as const,
          motivo: 'razon-privada' as const,
        },
      },
    ] as const;

    const impersonation = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
      headers: como(other.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        tipo: 'aceptar',
      },
    });
    expect(impersonation.statusCode).toBe(403);
    expect(impersonation.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_NOT_THE_SUBJECT');

    const results = await Promise.all(
      contenders.map((contender) =>
        e.app.inject({
          method: 'POST',
          url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
          headers: como(recipient.testigo),
          payload: {
            requestId: contender.requestId,
            ...contender.payload,
          },
        }),
      ),
    );
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409, 409]);
    for (const conflict of results.filter((response) => response.statusCode === 409)) {
      expect(conflict.json<{ codigo: string }>().codigo).toBe('STALE_TASK_REVISION');
    }
    const winnerIndex = results.findIndex((response) => response.statusCode === 200);
    const winner = results[winnerIndex];
    const winningContender = contenders[winnerIndex];
    if (winner === undefined || winningContender === undefined) {
      throw new Error('la carrera exige exactamente un ganador');
    }
    const winnerPayload = {
      requestId: winningContender.requestId,
      ...winningContender.payload,
    };
    const resulting = winner.json<InitiativeView>().tareas[0]!;
    expect(['aceptada', 'rechazada', 'reasignacion-solicitada']).toContain(resulting.estado);
    expect(
      (await readStream(e.pool, id)).filter((row) =>
        ['TaskAccepted', 'TaskRejected', 'TaskReassignmentRequested'].includes(row.event.eventType),
      ),
    ).toHaveLength(1);

    const beforeReplay = await readStream(e.pool, id);
    const replay = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: winnerPayload,
    });
    expect(replay.statusCode).toBe(200);
    expect(await readStream(e.pool, id)).toEqual(beforeReplay);

    const divergentRevision = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: { ...winnerPayload, revision: task.revision + 1 },
    });
    expect(divergentRevision.statusCode).toBe(409);
    expect(divergentRevision.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await readStream(e.pool, id)).toEqual(beforeReplay);

    const foreignReplay = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
      headers: como(other.testigo),
      payload: winnerPayload,
    });
    expect(foreignReplay.statusCode).toBe(409);
    expect(foreignReplay.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('permite pedir relevo después de aceptar sólo con la revisión nueva', async () => {
    const responsible = await entrar(e, 'responsable.relevo@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.relevo@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const milestone = (await planMilestone(id, responsible)).response.hitos[0]!.id;
    const offered = await offerTask({ initiative: id, milestone, responsible, recipient });
    const original = offered.response.tareas[0]!;

    const accepted = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: original.ofertaId,
        revision: original.revision,
        tipo: 'aceptar',
      },
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedTask = accepted.json<InitiativeView>().tareas[0]!;
    expect(acceptedTask).toMatchObject({
      estado: 'aceptada',
      responsableId: recipient.miembroId,
    });
    expect(acceptedTask.revision).toBeGreaterThan(original.revision);

    const reassigned = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: original.ofertaId,
        revision: acceptedTask.revision,
        tipo: 'pedir-reasignacion',
        motivo: 'razon-privada',
      },
    });
    expect(reassigned.statusCode).toBe(200);
    const current = reassigned.json<InitiativeView>().tareas[0]!;
    expect(current.estado).toBe('reasignacion-solicitada');
    expect(current.responsableId).toBeUndefined();
    expect(current.revision).toBeGreaterThan(acceptedTask.revision);

    const client = await e.pool.connect();
    try {
      const roundtrip = await loadInitiativeState(client, id);
      expect(roundtrip.tasks[0]?.lastSeq).toBe(current.revision);
      expect(roundtrip.tasks[0]?.responses.map((response) => response.type)).toEqual([
        'accepted',
        'reassignment-requested',
      ]);
    } finally {
      client.release();
    }
  });

  it('una reoferta usa un offerId nuevo, reintenta igual y cierra la carrera ABA', async () => {
    const responsible = await entrar(e, 'responsable.reoferta@udea.edu.co');
    const firstRecipient = await entrar(e, 'primera.reoferta@udea.edu.co');
    const secondRecipient = await entrar(e, 'segunda.reoferta@udea.edu.co');
    const thirdRecipient = await entrar(e, 'tercera.reoferta@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const milestone = (await planMilestone(id, responsible)).response.hitos[0]!.id;
    const offered = await offerTask({
      initiative: id,
      milestone,
      responsible,
      recipient: firstRecipient,
    });
    const original = offered.response.tareas[0]!;

    const beforeInvalidReason = await readStream(e.pool, id);
    const invalidReason = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/respuestas`,
      headers: como(firstRecipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: original.ofertaId,
        revision: original.revision,
        tipo: 'rechazar',
        motivo: 'texto libre con información personal',
      },
    });
    expect(invalidReason.statusCode).toBe(400);
    expect(await readStream(e.pool, id)).toEqual(beforeInvalidReason);

    const forbiddenFreeText = 'PII_SINTETICA_QUE_NUNCA_DEBE_ENTRAR_AL_LEDGER';
    const rejectionRequest = requestId();
    const rejection = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/respuestas`,
      headers: como(firstRecipient.testigo),
      payload: {
        requestId: rejectionRequest,
        offerId: original.ofertaId,
        revision: original.revision,
        tipo: 'rechazar',
        motivo: 'plazo-inviable',
        // Un cliente hostil puede conservar el campo viejo: la frontera HTTP debe descartarlo.
        justificacion: forbiddenFreeText,
      },
    });
    expect(rejection.statusCode).toBe(200);
    const rejectionEvent = (await readStream(e.pool, id)).find(
      (row) => row.event.eventType === 'TaskRejected',
    );
    expect(rejectionEvent?.event.payload).toMatchObject({
      body: { reason: 'plazo-inviable' },
    });
    expect(rejectionEvent?.payloadText).not.toContain('justification');
    expect(rejectionEvent?.payloadText).not.toContain('justificacion');
    expect(rejectionEvent?.payloadText).not.toContain(forbiddenFreeText);

    const afterRejection = await readStream(e.pool, id);
    const rejectionReplay = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/respuestas`,
      headers: como(firstRecipient.testigo),
      payload: {
        requestId: rejectionRequest,
        offerId: original.ofertaId,
        revision: original.revision,
        tipo: 'rechazar',
        motivo: 'plazo-inviable',
      },
    });
    expect(rejectionReplay.statusCode).toBe(200);
    expect(await readStream(e.pool, id)).toEqual(afterRejection);

    const divergentReason = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/respuestas`,
      headers: como(firstRecipient.testigo),
      payload: {
        requestId: rejectionRequest,
        offerId: original.ofertaId,
        revision: original.revision,
        tipo: 'rechazar',
        motivo: 'sin-disponibilidad',
      },
    });
    expect(divergentReason.statusCode).toBe(409);
    expect(divergentReason.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await readStream(e.pool, id)).toEqual(afterRejection);

    const reofferRequest = requestId();
    const reoffered = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/reofertas`,
      headers: como(responsible.testigo),
      payload: {
        requestId: reofferRequest,
        offerId: original.ofertaId,
        destinatarioId: secondRecipient.miembroId,
      },
    });
    expect(reoffered.statusCode).toBe(201);
    const current = reoffered.json<InitiativeView>().tareas[0]!;
    expect(current.ofertaId).not.toBe(original.ofertaId);
    expect(current.destinatarioId).toBe(secondRecipient.miembroId);

    const beforeReplay = await readStream(e.pool, id);
    const replay = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/reofertas`,
      headers: como(responsible.testigo),
      payload: {
        requestId: reofferRequest,
        offerId: original.ofertaId,
        destinatarioId: secondRecipient.miembroId,
      },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json<InitiativeView>().tareas[0]?.ofertaId).toBe(current.ofertaId);
    expect(await readStream(e.pool, id)).toEqual(beforeReplay);

    const stale = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${original.id}/reofertas`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        offerId: original.ofertaId,
        destinatarioId: thirdRecipient.miembroId,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ codigo: string }>().codigo).toBe('STALE_TASK_OFFER');

    const client = await e.pool.connect();
    try {
      const state = await loadInitiativeState(client, id);
      expect(state.tasks[0]?.offers).toHaveLength(2);
      expect(state.tasks[0]?.currentOfferId).toBe(current.ofertaId);
      expect(state.tasks[0]?.status).toBe('ofrecida');
    } finally {
      client.release();
    }
  });
});
