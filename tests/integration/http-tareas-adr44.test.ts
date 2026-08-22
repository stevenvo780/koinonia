/** ADR-0044: hitos, ofertas y respuestas reales contra Fastify + PostgreSQL. */

import {
  appendWithin,
  executeAuthorizedErasure,
  loadInitiativeState,
  PII_ERASURE_AGGREGATE_TYPE,
  PII_ERASURE_EXECUTED_EVENT,
  PII_ERASURE_REQUESTED_EVENT,
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

import {
  apiEnv,
  type ApiListo,
  como,
  declararCapacidad,
  entrar,
  listo,
  skipNote,
} from './helpers/api-env.js';

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
    readonly estado:
      | 'ofrecida'
      | 'aceptada'
      | 'en-curso'
      | 'bloqueada'
      | 'en-apoyo'
      | 'entregada'
      | 'completada'
      | 'rechazada'
      | 'reasignacion-solicitada';
    readonly pausaActual?: { readonly id: string; readonly tipo: 'bloqueo' | 'apoyo' };
    readonly evidencias: readonly { readonly id: string; readonly puedeAbrirse: boolean }[];
    readonly entregas: readonly {
      readonly id: string;
      readonly revision?: { readonly tipo: 'cambios-solicitados' | 'aceptada' };
    }[];
    readonly entregaActualId?: string;
    readonly completadaEn?: number;
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

  async function privateEvidenceFixture(seed: string): Promise<{
    readonly recipient: Session;
    readonly evidenceId: string;
    readonly content: string;
  }> {
    const responsible = await entrar(e, `responsable.${seed}@udea.edu.co`);
    const recipient = await entrar(e, `destinataria.${seed}@udea.edu.co`);
    await declararCapacidad(e, recipient.testigo, 180);
    const id = await activeInitiative(responsible.miembroId);
    const milestone = (await planMilestone(id, responsible)).response.hitos[0]!.id;
    const offered = await offerTask({ initiative: id, milestone, responsible, recipient });
    let task = offered.response.tareas[0]!;
    const accepted = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        tipo: 'aceptar',
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    task = accepted.json<InitiativeView>().tareas[0]!;
    const started = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/iniciar`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId: task.ofertaId, revision: task.revision },
    });
    expect(started.statusCode, started.body).toBe(200);
    task = started.json<InitiativeView>().tareas[0]!;
    const content = `Apertura privada para probar supresión verificable ${seed}.`;
    const evidenced = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/evidencias`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        contenido: content,
        visibilidad: 'restricted',
      },
    });
    expect(evidenced.statusCode, evidenced.body).toBe(201);
    const evidenceId = evidenced.json<InitiativeView>().tareas[0]?.evidencias[0]?.id;
    if (evidenceId === undefined) throw new Error('la prueba exige una evidencia privada');
    return { recipient, evidenceId, content };
  }

  async function requestErasure(
    session: Session,
    idempotencyKey = requestId(),
  ): Promise<{
    readonly solicitudId: string;
    readonly radicado: string;
    readonly solicitadaEn: number;
    readonly estado: 'pendiente';
  }> {
    const response = await e.app.inject({
      method: 'POST',
      url: '/mi/supresion',
      headers: como(session.testigo),
      payload: {
        requestId: idempotencyKey,
        baseLegal: 'revocatoria-consentimiento',
        confirmacionIrreversible: true,
      },
    });
    expect(response.statusCode, response.body).toBe(202);
    return response.json();
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
    await declararCapacidad(e, recipient.testigo);
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
    await declararCapacidad(e, recipient.testigo);
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

  it('la solicitud no admite selector de sujeto y una autorización inexistente no borra', async () => {
    const alice = await entrar(e, 'alice.supresion.autorizacion@udea.edu.co');
    const bob = await entrar(e, 'bob.supresion.autorizacion@udea.edu.co');
    const selectedOther = await e.app.inject({
      method: 'POST',
      url: '/mi/supresion',
      headers: como(alice.testigo),
      payload: {
        requestId: requestId(),
        baseLegal: 'ley-1581-art-8e',
        confirmacionIrreversible: true,
        subjectId: bob.miembroId,
      },
    });
    expect(selectedOther.statusCode).toBe(400);
    expect(selectedOther.json<{ codigo: string }>().codigo).toBe('DATOS_INVALIDOS');
    await expect(
      executeAuthorizedErasure(e.pool, e.azar.opaqueId(), {
        clock: e.reloj,
        random: e.azar,
        vault: e.vault,
      }),
    ).rejects.toThrow(/solicitud propia vigente/u);
    const survivors = await e.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM identity.member WHERE member_id = ANY($1::char(32)[])',
      [[alice.miembroId, bob.miembroId]],
    );
    expect(survivors.rows[0]?.count).toBe('2');
  });

  it('una sesión de más de diez minutos debe volver a autenticarse para solicitar', async () => {
    const stale = await entrar(e, 'sesion.vieja.supresion@udea.edu.co');
    e.reloj.avanzar(10 * 60 * 1000 + 1);
    const response = await e.app.inject({
      method: 'POST',
      url: '/mi/supresion',
      headers: como(stale.testigo),
      payload: {
        requestId: requestId(),
        baseLegal: 'ley-1581-art-8e',
        confirmacionIrreversible: true,
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ codigo: string }>().codigo).toBe('ERASURE_REAUTHENTICATION_REQUIRED');
  });

  it('sella la solicitud propia y sólo entonces suprime PII sin volver rojo /integridad', async () => {
    const fixture = await privateEvidenceFixture('supresion.legal');
    const before = await e.app.inject({ method: 'GET', url: '/integridad' });
    const beforePrivate = before
      .json<{ comprobaciones: { id: string; bien: boolean }[] }>()
      .comprobaciones.find((check) => check.id === 'material-privado');
    expect(beforePrivate).toEqual(expect.objectContaining({ bien: true }));

    const publicRequestId = requestId();
    const request = await requestErasure(fixture.recipient, publicRequestId);
    expect(await requestErasure(fixture.recipient, publicRequestId)).toStrictEqual(request);
    const divergentReplay = await e.app.inject({
      method: 'POST',
      url: '/mi/supresion',
      headers: como(fixture.recipient.testigo),
      payload: {
        requestId: publicRequestId,
        baseLegal: 'ley-1581-art-8e',
        confirmacionIrreversible: true,
      },
    });
    expect(divergentReplay.statusCode).toBe(409);
    expect(divergentReplay.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');
    const pending = await e.app.inject({ method: 'GET', url: '/integridad' });
    const pendingPrivate = pending
      .json<{ comprobaciones: { id: string; bien: boolean }[] }>()
      .comprobaciones.find((check) => check.id === 'material-privado');
    expect(pendingPrivate).toEqual(expect.objectContaining({ bien: true }));
    const requestRow = await e.pool.query<{
      actor: string;
      event_type: string;
      subject_id: string;
    }>(
      `SELECT actor, event_type, payload_idx ->> 'subjectId' AS subject_id
         FROM governance.event WHERE aggregate_id = $1 AND seq = 0`,
      [request.solicitudId],
    );
    expect(requestRow.rows[0]).toStrictEqual({
      actor: fixture.recipient.miembroId,
      event_type: PII_ERASURE_REQUESTED_EVENT,
      subject_id: fixture.recipient.miembroId,
    });

    const execution = await executeAuthorizedErasure(e.pool, request.solicitudId, {
      clock: e.reloj,
      random: e.azar,
      vault: e.vault,
    });
    expect(execution).toMatchObject({
      erasureId: request.solicitudId,
      erasedPrivateMaterialCount: 1,
      idempotentReplay: false,
    });
    const residue = await e.pool.query<{ members: string; materials: string; keys: string }>(
      `SELECT
         (SELECT count(*)::text FROM identity.member WHERE member_id = $1) AS members,
         (SELECT count(*)::text FROM identity.private_material WHERE owner_id = $1) AS materials,
         (SELECT count(*)::text FROM identity.subject_data_key WHERE member_id = $1) AS keys`,
      [fixture.recipient.miembroId],
    );
    expect(residue.rows[0]).toStrictEqual({ members: '0', materials: '0', keys: '0' });

    const after = await e.app.inject({ method: 'GET', url: '/integridad' });
    const afterPrivate = after
      .json<{
        comprobaciones: { id: string; bien: boolean; queSignifica: string; detalle?: string }[];
        comoComprobarloVosMismo: { explicacion: string };
      }>()
      .comprobaciones.find((check) => check.id === 'material-privado');
    expect(afterPrivate).toEqual(expect.objectContaining({ bien: true }));
    expect(afterPrivate?.queSignifica).toMatch(/1 supresiones append-only/u);
    expect(after.body).not.toContain(fixture.content);
    expect(after.body).not.toContain(fixture.evidenceId);
    expect(
      after.json<{ comoComprobarloVosMismo: { explicacion: string } }>().comoComprobarloVosMismo
        .explicacion,
    ).toMatch(/material privado no sale.*auditoría local/iu);

    await expect(
      executeAuthorizedErasure(e.pool, request.solicitudId, {
        clock: e.reloj,
        random: e.azar,
        vault: e.vault,
      }),
    ).resolves.toMatchObject({ idempotentReplay: true });
    const tombstones = await e.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM governance.event
        WHERE aggregate_id = $1 AND event_type = $2`,
      [request.solicitudId, PII_ERASURE_EXECUTED_EVENT],
    );
    expect(tombstones.rows[0]?.count).toBe('1');
    const authorizationLink = await e.pool.query<{
      actor: string | null;
      event_hash: string;
      event_id: string;
      request_event_hash: string | null;
      request_event_id: string | null;
      seq: number;
    }>(
      `SELECT seq, actor, encode(event_hash, 'hex') AS event_hash,
              payload_idx ->> 'eventId' AS event_id,
              payload_idx ->> 'requestEventId' AS request_event_id,
              payload_idx ->> 'requestEventHash' AS request_event_hash
         FROM governance.event WHERE aggregate_id = $1 ORDER BY seq`,
      [request.solicitudId],
    );
    expect(authorizationLink.rows).toHaveLength(2);
    expect(authorizationLink.rows[0]?.actor).toBe(fixture.recipient.miembroId);
    expect(authorizationLink.rows[1]?.actor).toBeNull();
    expect(authorizationLink.rows[1]?.request_event_id).toBe(authorizationLink.rows[0]?.event_id);
    expect(authorizationLink.rows[1]?.request_event_hash).toBe(
      authorizationLink.rows[0]?.event_hash,
    );
    expect(JSON.stringify(authorizationLink.rows)).not.toContain(fixture.content);
    expect(JSON.stringify(authorizationLink.rows)).not.toContain(fixture.recipient.testigo);
  });

  it('revierte también el DELETE si no puede construir el tombstone', async () => {
    const fixture = await privateEvidenceFixture('supresion.rollback');
    const request = await requestErasure(fixture.recipient);

    await expect(
      executeAuthorizedErasure(e.pool, request.solicitudId, {
        clock: e.reloj,
        random: {
          bytes: (length) => e.azar.bytes(length),
          opaqueId: () => 'identidad-invalida',
          uuid: () => e.azar.uuid(),
        },
        vault: e.vault,
      }),
    ).rejects.toThrow(/supresión verificable/u);

    const residue = await e.pool.query<{ members: string; materials: string; keys: string }>(
      `SELECT
         (SELECT count(*)::text FROM identity.member WHERE member_id = $1) AS members,
         (SELECT count(*)::text FROM identity.private_material WHERE owner_id = $1) AS materials,
         (SELECT count(*)::text FROM identity.subject_data_key WHERE member_id = $1) AS keys`,
      [fixture.recipient.miembroId],
    );
    expect(residue.rows[0]).toStrictEqual({ members: '1', materials: '1', keys: '1' });
    const pending = await e.app.inject({ method: 'GET', url: '/integridad' });
    const privateCheck = pending
      .json<{ comprobaciones: { id: string; bien: boolean }[] }>()
      .comprobaciones.find((check) => check.id === 'material-privado');
    expect(privateCheck).toEqual(expect.objectContaining({ bien: true }));
  });

  it('serializa dos supresiones concurrentes y publica exactamente un tombstone', async () => {
    const fixture = await privateEvidenceFixture('supresion.concurrente');
    const request = await requestErasure(fixture.recipient);
    const erase = async () =>
      await executeAuthorizedErasure(e.pool, request.solicitudId, {
        clock: e.reloj,
        random: e.azar,
        vault: e.vault,
      });

    const results = await Promise.all([erase(), erase()]);
    expect(results.map((result) => result.idempotentReplay).sort()).toStrictEqual([false, true]);
    const tombstones = await e.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM governance.event
        WHERE aggregate_id = $1 AND event_type = $2`,
      [request.solicitudId, PII_ERASURE_EXECUTED_EVENT],
    );
    expect(tombstones.rows[0]?.count).toBe('1');
  });

  it('dos solicitudes propias distintas compiten y sólo una queda pendiente', async () => {
    const member = await entrar(e, 'supresion.solicitudes.concurrentes@udea.edu.co');
    const attempt = async (idempotencyKey: string) =>
      await e.app.inject({
        method: 'POST',
        url: '/mi/supresion',
        headers: como(member.testigo),
        payload: {
          requestId: idempotencyKey,
          baseLegal: 'ley-1581-art-8e',
          confirmacionIrreversible: true,
        },
      });
    const attempts = await Promise.all([attempt(requestId()), attempt(requestId())]);
    expect(attempts.map((response) => response.statusCode).sort()).toStrictEqual([202, 409]);
    expect(
      attempts.find((response) => response.statusCode === 409)?.json<{ codigo: string }>().codigo,
    ).toBe('ERASURE_ALREADY_REQUESTED');
    const requests = await e.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM governance.event
        WHERE aggregate_type = $1 AND event_type = $2 AND actor = $3`,
      [PII_ERASURE_AGGREGATE_TYPE, PII_ERASURE_REQUESTED_EVENT, member.miembroId],
    );
    expect(requests.rows[0]?.count).toBe('1');
  });

  it('borrar una apertura sin tombstone sigue siendo una alarma material-missing', async () => {
    const fixture = await privateEvidenceFixture('supresion.silenciosa');
    await e.superPool.query('DELETE FROM identity.private_material WHERE material_id = $1', [
      fixture.evidenceId,
    ]);

    const integrity = await e.app.inject({ method: 'GET', url: '/integridad' });
    const privateCheck = integrity
      .json<{ comprobaciones: { id: string; bien: boolean; detalle?: string }[] }>()
      .comprobaciones.find((check) => check.id === 'material-privado');
    expect(privateCheck).toEqual(expect.objectContaining({ bien: false }));
    expect(privateCheck?.detalle).toMatch(/material-missing/u);
    expect(integrity.body).not.toContain(fixture.content);
    expect(integrity.body).not.toContain(fixture.evidenceId);
  });

  it('recorre seguimiento, material restringido, entrega y revisión sin perder historia', async () => {
    const responsible = await entrar(e, 'responsable.seguimiento@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.seguimiento@udea.edu.co');
    const outsider = await entrar(e, 'ajena.seguimiento@udea.edu.co');
    const tech = await entrar(e, 'tech.seguimiento@udea.edu.co');
    await e.superPool.query(
      `UPDATE identity.member SET roles = ARRAY['tech-admin'] WHERE member_id = $1`,
      [tech.miembroId],
    );
    const id = await activeInitiative(responsible.miembroId);
    const milestone = (await planMilestone(id, responsible)).response.hitos[0]!.id;
    const offered = await offerTask({ initiative: id, milestone, responsible, recipient });
    let task = offered.response.tareas[0]!;

    const withoutCapacity = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        tipo: 'aceptar',
      },
    });
    expect(withoutCapacity.statusCode).toBe(422);
    expect(withoutCapacity.json<{ codigo: string }>().codigo).toBe(
      'TASK_CAPACITY_CONFIRMATION_BLOCKED',
    );
    expect(
      (await readStream(e.pool, id)).some((row) => row.event.eventType === 'TaskAccepted'),
    ).toBe(false);

    await declararCapacidad(e, recipient.testigo, 180);
    const accepted = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        tipo: 'aceptar',
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    task = accepted.json<InitiativeView>().tareas[0]!;

    const outsiderStart = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/iniciar`,
      headers: como(outsider.testigo),
      payload: { requestId: requestId(), offerId: task.ofertaId, revision: task.revision },
    });
    expect(outsiderStart.statusCode).toBe(403);

    const started = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/iniciar`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId: task.ofertaId, revision: task.revision },
    });
    expect(started.statusCode, started.body).toBe(200);
    task = started.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('en-curso');

    const blocked = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/bloquear`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        categoria: 'respuesta-externa',
      },
    });
    expect(blocked.statusCode, blocked.body).toBe(200);
    task = blocked.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('bloqueada');
    const pauseId = task.pausaActual?.id;
    expect(pauseId).toBeDefined();

    const staleResume = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/reanudar`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        pauseId: e.azar.opaqueId(),
      },
    });
    expect(staleResume.statusCode).toBe(409);
    expect(staleResume.json<{ codigo: string }>().codigo).toBe('STALE_TASK_PAUSE');

    const privateEvidence =
      'La respuesta institucional recibida confirma el horario piloto sin publicar datos personales.';
    const evidenceRequest = requestId();
    const evidenceBody = {
      requestId: evidenceRequest,
      offerId: task.ofertaId,
      revision: task.revision,
      contenido: privateEvidence,
      visibilidad: 'restricted',
    } as const;
    const evidenced = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/evidencias`,
      headers: como(recipient.testigo),
      payload: evidenceBody,
    });
    expect(evidenced.statusCode, evidenced.body).toBe(201);
    task = evidenced.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('bloqueada');
    const evidenceId = task.evidencias[0]?.id;
    if (evidenceId === undefined) throw new Error('la evidencia debe quedar proyectada');

    for (const reader of [recipient, responsible]) {
      const opened = await e.app.inject({
        method: 'GET',
        url: `/iniciativas/${id}/tareas/${task.id}/evidencias/${evidenceId}`,
        headers: como(reader.testigo),
      });
      expect(opened.statusCode, opened.body).toBe(200);
      expect(opened.json<{ contenido: string }>()).toEqual({ contenido: privateEvidence });
    }
    const outsiderEvidence = await e.app.inject({
      method: 'GET',
      url: `/iniciativas/${id}/tareas/${task.id}/evidencias/${evidenceId}`,
      headers: como(outsider.testigo),
    });
    const outsiderUnknownEvidence = await e.app.inject({
      method: 'GET',
      url: `/iniciativas/${id}/tareas/${task.id}/evidencias/${e.azar.opaqueId()}`,
      headers: como(outsider.testigo),
    });
    expect(outsiderEvidence.statusCode).toBe(403);
    expect(outsiderUnknownEvidence.statusCode).toBe(403);
    expect(outsiderUnknownEvidence.json()).toEqual(outsiderEvidence.json());
    const techEvidence = await e.app.inject({
      method: 'GET',
      url: `/iniciativas/${id}/tareas/${task.id}/evidencias/${evidenceId}`,
      headers: como(tech.testigo),
    });
    expect(techEvidence.statusCode).toBe(403);
    expect(techEvidence.body).not.toContain(privateEvidence);

    const beforeEvidenceReplay = await readStream(e.pool, id);
    const evidenceReplay = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/evidencias`,
      headers: como(recipient.testigo),
      payload: evidenceBody,
    });
    expect(evidenceReplay.statusCode, evidenceReplay.body).toBe(201);
    expect(await readStream(e.pool, id)).toEqual(beforeEvidenceReplay);
    const divergentEvidence = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/evidencias`,
      headers: como(recipient.testigo),
      payload: { ...evidenceBody, contenido: `${privateEvidence} Cambiado.` },
    });
    expect(divergentEvidence.statusCode).toBe(409);
    expect(divergentEvidence.json<{ codigo: string }>().codigo).toBe('IDEMPOTENCY_KEY_REUSED');

    const help = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/ayuda`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        categoria: 'desbloqueo',
      },
    });
    expect(help.statusCode, help.body).toBe(200);
    task = help.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('en-apoyo');
    expect(task.pausaActual?.id).toBe(pauseId);

    const resumed = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/reanudar`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        pauseId,
      },
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    task = resumed.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('en-curso');

    const firstSummary =
      'Se entrega la nota verificable que documenta el resultado observable del encargo.';
    const delivered = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/entregas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        evidenciaIds: [evidenceId],
        resumen: firstSummary,
      },
    });
    expect(delivered.statusCode, delivered.body).toBe(201);
    task = delivered.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('entregada');
    const firstDeliveryId = task.entregaActualId;
    if (firstDeliveryId === undefined) throw new Error('la entrega debe quedar proyectada');

    for (const reader of [recipient, responsible]) {
      const opened = await e.app.inject({
        method: 'GET',
        url: `/iniciativas/${id}/tareas/${task.id}/entregas/${firstDeliveryId}/resumen`,
        headers: como(reader.testigo),
      });
      expect(opened.statusCode, opened.body).toBe(200);
      expect(opened.json<{ contenido: string }>()).toEqual({ contenido: firstSummary });
    }
    const outsiderDelivery = await e.app.inject({
      method: 'GET',
      url: `/iniciativas/${id}/tareas/${task.id}/entregas/${firstDeliveryId}/resumen`,
      headers: como(outsider.testigo),
    });
    const outsiderUnknownDelivery = await e.app.inject({
      method: 'GET',
      url: `/iniciativas/${id}/tareas/${task.id}/entregas/${e.azar.opaqueId()}/resumen`,
      headers: como(outsider.testigo),
    });
    expect(outsiderDelivery.statusCode).toBe(403);
    expect(outsiderUnknownDelivery.statusCode).toBe(403);
    expect(outsiderUnknownDelivery.json()).toEqual(outsiderDelivery.json());
    const techDelivery = await e.app.inject({
      method: 'GET',
      url: `/iniciativas/${id}/tareas/${task.id}/entregas/${firstDeliveryId}/resumen`,
      headers: como(tech.testigo),
    });
    expect(techDelivery.statusCode).toBe(403);
    expect(techDelivery.body).not.toContain(firstSummary);

    const assigneeCannotReview = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/revisiones/cambios`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        deliveryId: firstDeliveryId,
        revision: task.revision,
        motivo: 'evidencia-insuficiente',
      },
    });
    expect(assigneeCannotReview.statusCode).toBe(403);

    const changes = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/revisiones/cambios`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        deliveryId: firstDeliveryId,
        revision: task.revision,
        motivo: 'evidencia-insuficiente',
      },
    });
    expect(changes.statusCode, changes.body).toBe(200);
    task = changes.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('en-curso');
    expect(task.entregas[0]?.revision?.tipo).toBe('cambios-solicitados');

    const secondDelivery = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/entregas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: task.ofertaId,
        revision: task.revision,
        evidenciaIds: [evidenceId],
        resumen: 'La segunda entrega explica cómo la misma evidencia responde al criterio pedido.',
      },
    });
    expect(secondDelivery.statusCode, secondDelivery.body).toBe(201);
    task = secondDelivery.json<InitiativeView>().tareas[0]!;
    const secondDeliveryId = task.entregaActualId;
    if (secondDeliveryId === undefined)
      throw new Error('la segunda entrega debe quedar proyectada');

    const completed = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${task.id}/revisiones/aceptar`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        deliveryId: secondDeliveryId,
        revision: task.revision,
        evidenciaCriterio: 'verificada',
      },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    task = completed.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('completada');
    expect(task.completadaEn).toBe(e.reloj.now());

    const rows = await readStream(e.pool, id);
    expect(rows.map((row) => row.event.eventType)).toEqual([
      'InitiativeCreated',
      'InitiativeActivated',
      'MilestonePlanned',
      'TaskOffered',
      'TaskAccepted',
      'TaskStarted',
      'TaskBlocked',
      'TaskEvidenceAdded',
      'TaskHelpRequested',
      'TaskResumed',
      'TaskDelivered',
      'TaskChangesRequested',
      'TaskDelivered',
      'TaskReviewAccepted',
    ]);
    expect(rows.some((row) => row.payloadText.includes(privateEvidence))).toBe(false);
    expect(rows.some((row) => row.payloadText.includes(firstSummary))).toBe(false);
    const privateRows = await e.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM identity.private_material WHERE owner_id = $1',
      [recipient.miembroId],
    );
    expect(privateRows.rows[0]?.count).toBe('3');

    await e.superPool.query(
      `UPDATE identity.private_material
          SET ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 1)
        WHERE material_id = $1`,
      [secondDeliveryId],
    );
    const tampered = await e.app.inject({
      method: 'GET',
      url: `/iniciativas/${id}/tareas/${task.id}/entregas/${secondDeliveryId}/resumen`,
      headers: como(responsible.testigo),
    });
    expect(tampered.statusCode).toBe(503);
    expect(tampered.json<{ codigo: string }>().codigo).toBe('PRIVATE_MATERIAL_UNAVAILABLE');

    const integrity = await e.app.inject({ method: 'GET', url: '/integridad' });
    expect(integrity.statusCode, integrity.body).toBe(200);
    const integrityReport = integrity.json<{
      todoBien: boolean;
      comprobaciones: { id: string; bien: boolean; detalle?: string }[];
    }>();
    expect(integrityReport.todoBien).toBe(false);
    const privateCheck = integrityReport.comprobaciones.find(
      (check) => check.id === 'material-privado',
    );
    expect(privateCheck).toEqual(expect.objectContaining({ bien: false }));
    expect(privateCheck?.detalle).toMatch(/material-opening-invalid/u);
    expect(integrity.body).not.toContain(privateEvidence);
    expect(integrity.body).not.toContain(firstSummary);

    await e.superPool.query(
      `UPDATE identity.member SET circles = ARRAY[$2::char(32)] WHERE member_id = $1`,
      [recipient.miembroId, OTHER_CIRCLE],
    );
    for (const [kind, knownId, suffix] of [
      ['evidence', evidenceId, `evidencias/${evidenceId}`],
      ['delivery', firstDeliveryId, `entregas/${firstDeliveryId}/resumen`],
    ] as const) {
      const known = await e.app.inject({
        method: 'GET',
        url: `/iniciativas/${id}/tareas/${task.id}/${suffix}`,
        headers: como(recipient.testigo),
      });
      const unknownSuffix =
        kind === 'evidence'
          ? `evidencias/${e.azar.opaqueId()}`
          : `entregas/${e.azar.opaqueId()}/resumen`;
      const unknown = await e.app.inject({
        method: 'GET',
        url: `/iniciativas/${id}/tareas/${task.id}/${unknownSuffix}`,
        headers: como(recipient.testigo),
      });
      expect(knownId).toBeDefined();
      expect(known.statusCode).toBe(403);
      expect(unknown.statusCode).toBe(403);
      expect(unknown.json()).toEqual(known.json());
    }
  });

  it('serializa dos aceptaciones que juntas excederían el último cupo semanal', async () => {
    const responsible = await entrar(e, 'responsable.cupo.concurrente@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.cupo.concurrente@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 180);

    const initiatives = await Promise.all([
      activeInitiative(responsible.miembroId),
      activeInitiative(responsible.miembroId),
    ]);
    const offers = [];
    for (const initiative of initiatives) {
      const milestone = (await planMilestone(initiative, responsible)).response.hitos[0]!.id;
      offers.push(
        await offerTask({
          initiative,
          milestone,
          responsible,
          recipient,
          title: 'Consumir el cupo',
        }),
      );
    }

    const attempts = await Promise.all(
      offers.map((offer, index) => {
        const initiative = initiatives[index];
        const task = offer.response.tareas[0];
        if (initiative === undefined || task === undefined) {
          throw new Error('cada iniciativa debe conservar su oferta');
        }
        return e.app.inject({
          method: 'POST',
          url: `/iniciativas/${initiative}/tareas/${task.id}/respuestas`,
          headers: como(recipient.testigo),
          payload: {
            requestId: requestId(),
            offerId: task.ofertaId,
            revision: task.revision,
            tipo: 'aceptar',
          },
        });
      }),
    );
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([200, 422]);
    expect(
      attempts.find((response) => response.statusCode === 422)?.json<{ codigo: string }>().codigo,
    ).toBe('TASK_CAPACITY_CONFIRMATION_BLOCKED');

    const acceptedEvents = (
      await Promise.all(initiatives.map(async (initiative) => await readStream(e.pool, initiative)))
    )
      .flat()
      .filter((row) => row.event.eventType === 'TaskAccepted');
    expect(acceptedEvents).toHaveLength(1);
  });

  it('ordena aceptar contra bajar capacidad sin deadlock ni una aceptación posterior', async () => {
    const responsible = await entrar(e, 'responsable.cupo.descenso@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.cupo.descenso@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 360);
    const capacity = await e.app.inject({
      method: 'GET',
      url: '/mi/capacidad',
      headers: como(recipient.testigo),
    });
    const capacityRevision = capacity.json<{ declarada: true; revision: number }>().revision;

    const firstInitiative = await activeInitiative(responsible.miembroId);
    const firstMilestone = (await planMilestone(firstInitiative, responsible)).response.hitos[0]!
      .id;
    const firstOffer = await offerTask({
      initiative: firstInitiative,
      milestone: firstMilestone,
      responsible,
      recipient,
    });
    const firstTask = firstOffer.response.tareas[0]!;

    const [acceptance, lowering] = await Promise.all([
      e.app.inject({
        method: 'POST',
        url: `/iniciativas/${firstInitiative}/tareas/${firstTask.id}/respuestas`,
        headers: como(recipient.testigo),
        payload: {
          requestId: requestId(),
          offerId: firstTask.ofertaId,
          revision: firstTask.revision,
          tipo: 'aceptar',
        },
      }),
      e.app.inject({
        method: 'PUT',
        url: '/mi/capacidad',
        headers: como(recipient.testigo),
        payload: { revision: capacityRevision, minutosPorSemana: 0 },
      }),
    ]);
    expect(lowering.statusCode, lowering.body).toBe(200);
    expect([200, 422]).toContain(acceptance.statusCode);
    expect(
      (await readStream(e.pool, firstInitiative)).filter(
        (row) => row.event.eventType === 'TaskAccepted',
      ),
    ).toHaveLength(acceptance.statusCode === 200 ? 1 : 0);

    const currentCapacity = await e.app.inject({
      method: 'GET',
      url: '/mi/capacidad',
      headers: como(recipient.testigo),
    });
    expect(currentCapacity.json<{ minutosPorSemana: number }>().minutosPorSemana).toBe(0);

    const secondInitiative = await activeInitiative(responsible.miembroId);
    const secondMilestone = (await planMilestone(secondInitiative, responsible)).response.hitos[0]!
      .id;
    const secondOffer = await offerTask({
      initiative: secondInitiative,
      milestone: secondMilestone,
      responsible,
      recipient,
    });
    const secondTask = secondOffer.response.tareas[0]!;
    const blocked = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${secondInitiative}/tareas/${secondTask.id}/respuestas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId: secondTask.ofertaId,
        revision: secondTask.revision,
        tipo: 'aceptar',
      },
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json<{ codigo: string }>().codigo).toBe('TASK_CAPACITY_CONFIRMATION_BLOCKED');
    expect(
      (await readStream(e.pool, secondInitiative)).some(
        (row) => row.event.eventType === 'TaskAccepted',
      ),
    ).toBe(false);
  });

  it('una solicitud pendiente no legitima un DELETE ejecutado por fuera del flujo', async () => {
    const fixture = await privateEvidenceFixture('supresion.pendiente.borrada.directo');
    await requestErasure(fixture.recipient);
    await e.superPool.query('DELETE FROM identity.member WHERE member_id = $1', [
      fixture.recipient.miembroId,
    ]);

    const integrity = await e.app.inject({ method: 'GET', url: '/integridad' });
    const privateCheck = integrity
      .json<{ comprobaciones: { id: string; bien: boolean; detalle?: string }[] }>()
      .comprobaciones.find((check) => check.id === 'material-privado');
    expect(privateCheck).toEqual(expect.objectContaining({ bien: false }));
    expect(privateCheck?.detalle).toMatch(/requested-subject-missing/u);
    expect(privateCheck?.detalle).toMatch(/material-missing/u);
    expect(integrity.body).not.toContain(fixture.content);
    expect(integrity.body).not.toContain(fixture.evidenceId);
  });

  it('DELETE más tombstone exacto sin solicitud propia sigue siendo una alarma', async () => {
    const fixture = await privateEvidenceFixture('supresion.tombstone.sin.autorizacion');
    const forgedErasureId = e.azar.opaqueId();
    const executedAt = e.reloj.now();
    await withTransaction(e.pool, async (client) => {
      await appendWithin(client, {
        aggregateId: forgedErasureId,
        aggregateType: PII_ERASURE_AGGREGATE_TYPE,
        expectedHead: { kind: 'new' },
        requestId: requestId(),
        requestScope: 'test:forged-private-erasure',
        events: [
          {
            eventType: PII_ERASURE_EXECUTED_EVENT,
            eventVersion: 1,
            occurredAt: new Date(executedAt).toISOString(),
            payload: {
              eventId: e.azar.opaqueId(),
              executedAt,
              materialIds: [fixture.evidenceId],
              requestEventHash: 'a'.repeat(64),
              requestEventId: e.azar.opaqueId(),
              subjectId: fixture.recipient.miembroId,
            },
          },
        ],
      });
    });
    await e.superPool.query('DELETE FROM identity.member WHERE member_id = $1', [
      fixture.recipient.miembroId,
    ]);

    const integrity = await e.app.inject({ method: 'GET', url: '/integridad' });
    const privateCheck = integrity
      .json<{ comprobaciones: { id: string; bien: boolean; detalle?: string }[] }>()
      .comprobaciones.find((check) => check.id === 'material-privado');
    expect(privateCheck).toEqual(expect.objectContaining({ bien: false }));
    expect(privateCheck?.detalle).toMatch(/unauthorized-suppression/u);
    expect(privateCheck?.detalle).toMatch(/material-missing/u);
    expect(integrity.body).not.toContain(fixture.content);
    expect(integrity.body).not.toContain(fixture.evidenceId);
  });
});
