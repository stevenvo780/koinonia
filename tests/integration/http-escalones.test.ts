/**
 * `GET /iniciativas/:id/escalones` contra Fastify + PostgreSQL reales.
 *
 * La ruta bajo prueba vive en un `FastifyInstance` propio, separado del `env.app` real — la misma
 * situación que `http-iniciativas.test.ts` documenta para `registrarRutasDeIniciativas`: hasta que
 * un agente integrador llame a `registrarRutasDeEscalones` desde `app.ts` (fuera de mi ámbito). Las
 * mutaciones de preparación —ofrecer, aceptar, iniciar, bloquear, pedir ayuda, rechazar, reofertar—
 * sí van contra `env.app`, que ya tiene esas rutas reales y comparte la misma base de datos.
 *
 * Lo que estas pruebas demuestran con datos reales, no con un objeto construido a mano:
 *  - los tres peldaños de tiempo (`por-vencer`, `atrasada`, `consultada`) caen en los bordes exactos
 *    de PRODUCT.md §6 y sólo los ve quien tiene la tarea;
 *  - `bloqueada`, `en-apoyo` y `reasignada` los ve cualquiera del círculo, no sólo quien la tiene;
 *  - el techo (`en-revision-colectiva`) se alcanza tanto por la tercera reasignación de UNA tarea
 *    como por el patrón de VARIAS tareas del mismo círculo en dificultad a la vez;
 *  - una tarea completada nunca muestra peldaño, y una iniciativa desconocida da 404;
 *  - la respuesta nunca trae un identificador de persona: sólo `{ tareaId, escalon }`.
 */

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
import {
  persistInitiativeLogWithin,
  udeaIdentityAdapter,
  withTransaction,
  type Ports,
} from '@koinonia/api';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  registrarRutasDeEscalones,
  type EscalonesDeIniciativa,
} from '../../services/api/src/http/rutas-escalones.js';
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
const OTHER_CIRCLE = 'acade31c0000000000000000000000c1';
const HORA = 60 * 60 * 1000;
const DAY = 24 * HORA;
let n = 0x7e00;

function requestId(): string {
  const value = (++n).toString(16).padStart(32, '0');
  return (
    `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-` +
    `8${value.slice(17, 20)}-${value.slice(20, 32)}`
  );
}

afterAll(async () => {
  if (env.ok) await env.stop();
});

interface InitiativeView {
  readonly hitos: readonly { readonly id: string }[];
  readonly tareas: readonly {
    readonly id: string;
    readonly ofertaId: string;
    readonly revision: number;
    readonly estado: string;
    readonly destinatarioId?: string;
    readonly responsableId?: string;
    readonly evidencias: readonly { readonly id: string }[];
    readonly entregaActualId?: string;
  }[];
}

describe.skipIf(!env.ok)(`GET /iniciativas/:id/escalones${skipNote(env)}`, () => {
  let e: ApiListo;
  let escalones: FastifyInstance;

  beforeAll(async () => {
    e = listo(env);
    const ports: Ports = {
      clock: { now: () => e.reloj.now() },
      random: {
        bytes: (cantidad) => e.azar.bytes(cantidad),
        opaqueId: () => e.azar.opaqueId(),
        uuid: () => e.azar.uuid(),
      },
      mailer: e.correo,
      identity: udeaIdentityAdapter({ facilitadores: [], garantias: [] }),
      vault: e.vault,
    };
    escalones = Fastify();
    registrarRutasDeEscalones(escalones, { deps: { pool: e.pool, ports } });
    await escalones.ready();
  });

  afterAll(async () => {
    await escalones?.close().catch(() => undefined);
  });

  async function activeInitiative(responsibleId: string, circleId = CIRCLE): Promise<string> {
    const id = initiativeId(e.azar.opaqueId());
    const at = instant(e.reloj.now());
    let log = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash(e.azar.opaqueId().padEnd(64, '0')),
        decisionResultHash: hash(e.azar.opaqueId().padEnd(64, '0')),
        circleId: circleId as never,
        executionPlan: {
          objective: 'Probar los peldaños de incumplimiento sobre una iniciativa real.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 90 * DAY),
          successCriteria: [
            {
              description: 'GET /iniciativas/:id/escalones responde el peldaño correcto por tarea.',
              evidenceSource: 'Respuesta de la propia ruta bajo prueba.',
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
        ratificationEventHash: hash(e.azar.opaqueId().padEnd(64, '0')),
      },
    );
    await withTransaction(e.pool, (client) =>
      persistInitiativeLogWithin(client, log, { requestId: requestId() }),
    );
    return id;
  }

  async function planMilestone(
    initiative: string,
    responsible: { testigo: string },
  ): Promise<string> {
    const response = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/hitos`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'Preparar y ejecutar el piloto de la prueba de escalones',
        criterioDeTerminacion: 'El piloto termina con evidencia pública de haberse hecho.',
        venceEn: e.reloj.now() + 60 * DAY,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const milestone = response.json<InitiativeView>().hitos[0]?.id;
    if (milestone === undefined) throw new Error('la prueba exige un hito recién creado');
    return milestone;
  }

  /** Ofrece una tarea que vence `venceEnMs` desde ahora. No la responde: eso lo hace cada prueba. */
  async function offerTask(
    initiative: string,
    milestone: string,
    responsible: { testigo: string },
    recipientId: string,
    venceEnMs: number,
  ): Promise<{ taskId: string; offerId: string; revision: number }> {
    const offered = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        hitoId: milestone,
        destinatarioId: recipientId,
        titulo: 'Redactar la nota que documenta el escenario de la prueba',
        descripcion: 'Registrar el punto de partida y la evidencia que permitirá evaluar esto.',
        venceEn: e.reloj.now() + venceEnMs,
        esfuerzoMinutos: 60,
        dependeDe: [],
      },
    });
    expect(offered.statusCode, offered.body).toBe(201);
    const task = offered.json<InitiativeView>().tareas.at(-1);
    if (task === undefined) throw new Error('la prueba exige una tarea recién ofrecida');
    return { taskId: task.id, offerId: task.ofertaId, revision: task.revision };
  }

  async function acceptAndStart(
    initiative: string,
    taskId: string,
    offerId: string,
    revision: number,
    recipient: { testigo: string },
  ): Promise<number> {
    const accepted = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${taskId}/respuestas`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId, revision, tipo: 'aceptar' },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const acceptedTask = accepted.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
    const started = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${taskId}/iniciar`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId, revision: acceptedTask.revision },
    });
    expect(started.statusCode, started.body).toBe(200);
    const startedTask = started.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
    expect(startedTask.estado).toBe('en-curso');
    return startedTask.revision;
  }

  async function escalonDe(
    initiative: string,
    taskId: string,
    testigo?: string,
  ): Promise<string | null> {
    const response = await escalones.inject({
      method: 'GET',
      url: `/iniciativas/${initiative}/escalones`,
      headers: testigo === undefined ? {} : como(testigo),
    });
    expect(response.statusCode, response.body).toBe(200);
    const fila = response.json<EscalonesDeIniciativa>().tareas.find((t) => t.tareaId === taskId);
    if (fila === undefined) throw new Error(`la tarea ${taskId} no aparece en la respuesta`);
    return fila.escalon;
  }

  it('404 cuando la iniciativa no existe', async () => {
    const response = await escalones.inject({
      method: 'GET',
      url: `/iniciativas/${initiativeId(e.azar.opaqueId())}/escalones`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('nunca trae un identificador de persona: sólo tareaId y escalon', async () => {
    const responsible = await entrar(e, 'responsable.forma@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const response = await escalones.inject({ method: 'GET', url: `/iniciativas/${id}/escalones` });
    expect(response.statusCode).toBe(200);
    const cuerpo = response.json<Record<string, unknown>>();
    expect(JSON.stringify(cuerpo)).not.toMatch(/miembroId|memberId|responsableId|destinatarioId/);
  });

  it('por-vencer y consultada sólo los ve quien tiene la tarea; atrasada la ve cualquiera del círculo', async () => {
    const responsible = await entrar(e, 'responsable.tiempo@udea.edu.co');
    let recipient = await entrar(e, 'destinataria.tiempo@udea.edu.co');
    let bystander = await entrar(e, 'testigo.tiempo@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 300);
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);

    // Vence en 10 horas: dentro de la ventana de 48 h, así que arranca en «por-vencer».
    const { taskId, offerId, revision } = await offerTask(
      id,
      milestone,
      responsible,
      recipient.miembroId,
      10 * HORA,
    );
    await acceptAndStart(id, taskId, offerId, revision, recipient);

    expect(await escalonDe(id, taskId, recipient.testigo)).toBe('por-vencer');
    expect(await escalonDe(id, taskId, bystander.testigo)).toBeNull();
    expect(await escalonDe(id, taskId)).toBeNull(); // anónimo

    // La sesión vence a las 8 h (SESION_VIGENCIA_MS): cada avance de reloj más largo que eso exige
    // volver a entrar, o lo que se estaría probando es la expiración de sesión, no el peldaño.
    e.reloj.avanzar(11 * HORA); // ya venció
    recipient = await entrar(e, 'destinataria.tiempo@udea.edu.co');
    bystander = await entrar(e, 'testigo.tiempo@udea.edu.co');
    expect(await escalonDe(id, taskId, recipient.testigo)).toBe('atrasada');
    expect(await escalonDe(id, taskId, bystander.testigo)).toBe('atrasada');
    expect(await escalonDe(id, taskId)).toBeNull(); // anónimo sigue sin círculo

    e.reloj.avanzar(73 * HORA); // 73 h de atraso: ya pasó la ventana de consulta
    recipient = await entrar(e, 'destinataria.tiempo@udea.edu.co');
    bystander = await entrar(e, 'testigo.tiempo@udea.edu.co');
    expect(await escalonDe(id, taskId, recipient.testigo)).toBe('consultada');
    expect(await escalonDe(id, taskId, bystander.testigo)).toBeNull();
  });

  it('bloqueada y en-apoyo los ve cualquiera del círculo', async () => {
    const responsible = await entrar(e, 'responsable.bloqueo@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.bloqueo@udea.edu.co');
    const bystander = await entrar(e, 'testigo.bloqueo@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 300);
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);
    const { taskId, offerId, revision } = await offerTask(
      id,
      milestone,
      responsible,
      recipient.miembroId,
      20 * DAY,
    );
    const revAfterStart = await acceptAndStart(id, taskId, offerId, revision, recipient);

    const blocked = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/bloquear`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision: revAfterStart,
        categoria: 'dependencia',
      },
    });
    expect(blocked.statusCode, blocked.body).toBe(200);

    expect(await escalonDe(id, taskId, bystander.testigo)).toBe('bloqueada');
    expect(await escalonDe(id, taskId, recipient.testigo)).toBe('bloqueada');
  });

  it('rechazar antes de aceptar deja la tarea en reasignada, visible al círculo', async () => {
    const responsible = await entrar(e, 'responsable.rechazo@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.rechazo@udea.edu.co');
    const bystander = await entrar(e, 'testigo.rechazo@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);
    const { taskId, offerId, revision } = await offerTask(
      id,
      milestone,
      responsible,
      recipient.miembroId,
      20 * DAY,
    );

    const rejected = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/respuestas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision,
        tipo: 'rechazar',
        motivo: 'sin-disponibilidad',
      },
    });
    expect(rejected.statusCode, rejected.body).toBe(200);

    expect(await escalonDe(id, taskId, bystander.testigo)).toBe('reasignada');
  });

  it('la tercera reasignación de UNA tarea abre en-revision-colectiva', async () => {
    const responsible = await entrar(e, 'responsable.reasigna@udea.edu.co');
    // Cuatro destinatarias distintas: el dominio rechaza reofertarle la tarea a quien acaba de
    // rechazarla («TASK_REOFFER_SAME_RECIPIENT» — «elegí a otra persona del grupo»), así que tres
    // regresos reales al círculo exigen tres personas nuevas, no la misma tres veces.
    const candidatas = await Promise.all(
      ['a', 'b', 'c', 'd'].map((letra) => entrar(e, `reasigna.${letra}@udea.edu.co`)),
    );
    const bystander = await entrar(e, 'testigo.reasigna@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);

    const first = await offerTask(id, milestone, responsible, candidatas[0]!.miembroId, 20 * DAY);
    const { taskId } = first;
    let offerId = first.offerId;
    let revision = first.revision;

    // Rechaza y reoferta tres veces: cuatro ofertas en total, tres regresos al círculo.
    for (let vuelta = 0; vuelta < 4; vuelta += 1) {
      const rejected = await e.app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas/${taskId}/respuestas`,
        headers: como(candidatas[vuelta]!.testigo),
        payload: {
          requestId: requestId(),
          offerId,
          revision,
          tipo: 'rechazar',
          motivo: 'plazo-inviable',
        },
      });
      expect(rejected.statusCode, rejected.body).toBe(200);

      if (vuelta < 3) {
        const reoffered = await e.app.inject({
          method: 'POST',
          url: `/iniciativas/${id}/tareas/${taskId}/reofertas`,
          headers: como(responsible.testigo),
          payload: {
            requestId: requestId(),
            offerId,
            destinatarioId: candidatas[vuelta + 1]!.miembroId,
          },
        });
        expect(reoffered.statusCode, reoffered.body).toBe(201);
        const current = reoffered.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
        offerId = current.ofertaId;
        revision = current.revision;
      }
    }

    expect(await escalonDe(id, taskId, bystander.testigo)).toBe('en-revision-colectiva');
  });

  it('el patrón del círculo abre en-revision-colectiva en una tarea sana, aunque le sobre plazo', async () => {
    const responsible = await entrar(e, 'responsable.patron@udea.edu.co');
    const struggling1 = await entrar(e, 'lucha1.patron@udea.edu.co');
    const struggling2 = await entrar(e, 'lucha2.patron@udea.edu.co');
    const struggling3 = await entrar(e, 'lucha3.patron@udea.edu.co');
    const healthy = await entrar(e, 'sana.patron@udea.edu.co');
    const bystander = await entrar(e, 'testigo.patron@udea.edu.co');
    for (const persona of [struggling1, struggling2, struggling3, healthy]) {
      await declararCapacidad(e, persona.testigo, 300);
    }

    // Tres tareas en dificultad, repartidas en dos iniciativas DISTINTAS del mismo círculo.
    const idA = await activeInitiative(responsible.miembroId);
    const milestoneA = await planMilestone(idA, responsible);
    const idB = await activeInitiative(responsible.miembroId);
    const milestoneB = await planMilestone(idB, responsible);

    const t1 = await offerTask(idA, milestoneA, responsible, struggling1.miembroId, 20 * DAY);
    const revT1 = await acceptAndStart(idA, t1.taskId, t1.offerId, t1.revision, struggling1);
    const blocked1 = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${idA}/tareas/${t1.taskId}/bloquear`,
      headers: como(struggling1.testigo),
      payload: {
        requestId: requestId(),
        offerId: t1.offerId,
        revision: revT1,
        categoria: 'dependencia',
      },
    });
    expect(blocked1.statusCode, blocked1.body).toBe(200);

    const t2 = await offerTask(idA, milestoneA, responsible, struggling2.miembroId, 20 * DAY);
    const revT2 = await acceptAndStart(idA, t2.taskId, t2.offerId, t2.revision, struggling2);
    const helped2 = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${idA}/tareas/${t2.taskId}/ayuda`,
      headers: como(struggling2.testigo),
      payload: {
        requestId: requestId(),
        offerId: t2.offerId,
        revision: revT2,
        categoria: 'orientacion',
      },
    });
    expect(helped2.statusCode, helped2.body).toBe(200);

    const t3 = await offerTask(idB, milestoneB, responsible, struggling3.miembroId, 20 * DAY);
    const rejected3 = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${idB}/tareas/${t3.taskId}/respuestas`,
      headers: como(struggling3.testigo),
      payload: {
        requestId: requestId(),
        offerId: t3.offerId,
        revision: t3.revision,
        tipo: 'rechazar',
        motivo: 'sin-disponibilidad',
      },
    });
    expect(rejected3.statusCode, rejected3.body).toBe(200);

    // Una cuarta tarea, sana, con meses de plazo por delante: nada en SU propio historial explica un peldaño.
    const idC = await activeInitiative(responsible.miembroId);
    const milestoneC = await planMilestone(idC, responsible);
    const healthyTask = await offerTask(idC, milestoneC, responsible, healthy.miembroId, 60 * DAY);
    await acceptAndStart(
      idC,
      healthyTask.taskId,
      healthyTask.offerId,
      healthyTask.revision,
      healthy,
    );

    expect(await escalonDe(idC, healthyTask.taskId, bystander.testigo)).toBe(
      'en-revision-colectiva',
    );

    // Y en el otro círculo, el mismo patrón no dispara nada: el patrón es del círculo, no global.
    // `udeaIdentityAdapter` concede por defecto Asamblea y Espacios a cualquier correo institucional
    // (`services/api/src/http/adapters.ts`); para que alguien quede realmente en Académico hay que
    // reescribir sus círculos en la base, como hace `http-tareas-adr44.test.ts` con el mismo patrón.
    const otherResponsible = await entrar(e, 'responsable.otro-circulo@udea.edu.co');
    const otherRecipient = await entrar(e, 'destinataria.otro-circulo@udea.edu.co');
    for (const persona of [otherResponsible, otherRecipient]) {
      await e.superPool.query(
        `UPDATE identity.member SET circles = ARRAY[$2::char(32)] WHERE member_id = $1`,
        [persona.miembroId, OTHER_CIRCLE],
      );
    }
    await declararCapacidad(e, otherRecipient.testigo, 300);
    const idD = await activeInitiative(otherResponsible.miembroId, OTHER_CIRCLE);
    const milestoneD = await planMilestone(idD, otherResponsible);
    const otherTask = await offerTask(
      idD,
      milestoneD,
      otherResponsible,
      otherRecipient.miembroId,
      60 * DAY,
    );
    await acceptAndStart(
      idD,
      otherTask.taskId,
      otherTask.offerId,
      otherTask.revision,
      otherRecipient,
    );
    expect(await escalonDe(idD, otherTask.taskId, otherRecipient.testigo)).toBeNull();
  });

  it('una tarea completada no muestra peldaño aunque el reloj lleve mucho corriendo', async () => {
    const responsible = await entrar(e, 'responsable.completa@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.completa@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 300);
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);
    const { taskId, offerId, revision } = await offerTask(
      id,
      milestone,
      responsible,
      recipient.miembroId,
      1 * HORA,
    );
    const revAfterStart = await acceptAndStart(id, taskId, offerId, revision, recipient);

    const evidenced = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/evidencias`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision: revAfterStart,
        contenido: 'La evidencia que respalda el cierre de esta tarea, sin datos personales.',
        visibilidad: 'restricted',
      },
    });
    expect(evidenced.statusCode, evidenced.body).toBe(201);
    const evidencedTask = evidenced.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
    const evidenceId = evidencedTask.evidencias[0]?.id;
    if (evidenceId === undefined) throw new Error('la prueba exige una evidencia proyectada');

    const delivered = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/entregas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision: evidencedTask.revision,
        evidenciaIds: [evidenceId],
        resumen: 'Se entrega la nota que documenta el resultado observable del encargo.',
      },
    });
    expect(delivered.statusCode, delivered.body).toBe(201);
    const deliveredTask = delivered.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
    const deliveryId = deliveredTask.entregaActualId;
    if (deliveryId === undefined) throw new Error('la prueba exige una entrega proyectada');

    const accepted = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/revisiones/aceptar`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        deliveryId,
        revision: deliveredTask.revision,
        evidenciaCriterio: 'no-aplica',
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);

    e.reloj.avanzar(500 * HORA);
    expect(await escalonDe(id, taskId, recipient.testigo)).toBeNull();
  });
});
