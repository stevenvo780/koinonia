/**
 * `rutas-seguimiento.ts` contra Fastify + PostgreSQL reales: los tres huecos de seguimiento que
 * exigen leer el agregado real (ver la cabecera de `services/api/src/http/rutas-seguimiento.ts`
 * para el cuarto, ya verificado sin cambios en `escalones.ts`).
 *
 * La ruta bajo prueba vive en un `FastifyInstance` propio, separado del `env.app` real — la misma
 * situación que `http-escalones.test.ts` documenta: hasta que un agente integrador llame a
 * `registrarRutasDeSeguimiento` desde `app.ts` (fuera de mi ámbito). Las mutaciones de preparación
 * —ofrecer, aceptar, iniciar, entregar, revisar— sí van contra `env.app`, que ya tiene esas rutas
 * reales y comparte la misma base de datos.
 *
 * Lo que estas pruebas demuestran con datos reales, no con un objeto construido a mano:
 *  - `GET .../seguimiento/destrabes` reporta el hecho «B se destrabó» sólo después de que la
 *    dependencia real llega a `completada` por el camino entero (aceptar → iniciar → evidenciar →
 *    entregar → aceptar la revisión), nunca antes;
 *  - `GET .../seguimiento/informe` distingue una iniciativa provisional (el reloj de informes no
 *    corre) de una activada, vence exactamente a los 15 días desde la activación, y un
 *    `ultimoInformeEn` reinicia ese reloj;
 *  - `POST .../retiro-de-encargo` exige las tres condiciones del pliego a la vez —techo de la
 *    escalera, consentimiento, motivo real— contra una tarea que de verdad existe en esa
 *    iniciativa, y estampa `decididoEn` con el reloj del servidor, nunca con lo que mande el cliente.
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
  registrarRutasDeSeguimiento,
  type DestrabeDto,
  type InformeSeguimientoDto,
  type RetiroDeEncargoDto,
} from '../../services/api/src/http/rutas-seguimiento.js';
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
// El mismo círculo real que usa `http-escalones.test.ts`: los miembros de prueba entran con los
// círculos por defecto de `udeaIdentityAdapter` (Asamblea + Espacios y Bienestar), y planificar
// exige que quien responde por la iniciativa sea miembro del círculo que la iniciativa declara
// (`initiative:plan` → `OWNER_IN_CIRCLE`, `packages/domain/src/access.ts`).
const CIRCLE = 'e5bac105b1e00000000000000000000b';
const HORA = 60 * 60 * 1000;
const DAY = 24 * HORA;
let n = 0x9e00;

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
    readonly evidencias: readonly { readonly id: string }[];
    readonly entregaActualId?: string;
  }[];
}

describe.skipIf(!env.ok)(`rutas-seguimiento${skipNote(env)}`, () => {
  let e: ApiListo;
  let seguimiento: FastifyInstance;

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
    seguimiento = Fastify();
    // `rutas-seguimiento.ts` no añade su propio error handler (hereda el de `buildApp` una vez
    // integrado — ver su cabecera, igual que `rutas-escalones.ts`); aquí se replica sólo la
    // traducción de `ZodError` que ese error handler real ya hace, para que esta prueba refleje el
    // código de estado que la ruta tendrá en producción.
    seguimiento.setErrorHandler((error: Error, _request, reply) => {
      if (error.name === 'ZodError') {
        void reply.status(400).send({ codigo: 'DATOS_INVALIDOS', mensaje: error.message });
        return;
      }
      void reply.status(500).send({ codigo: 'ERROR_INTERNO', mensaje: error.message });
    });
    registrarRutasDeSeguimiento(seguimiento, { deps: { pool: e.pool, ports } });
    await seguimiento.ready();
  });

  afterAll(async () => {
    await seguimiento?.close().catch(() => undefined);
  });

  /** Crea la iniciativa cruda, sin activar — para probar el estado `por-empezar` de verdad. */
  async function provisionalInitiative(responsibleId: string): Promise<string> {
    const id = initiativeId(e.azar.opaqueId());
    const at = instant(e.reloj.now());
    const log = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash(e.azar.opaqueId().padEnd(64, '0')),
        decisionResultHash: hash(e.azar.opaqueId().padEnd(64, '0')),
        circleId: CIRCLE as never,
        executionPlan: {
          objective: 'Probar la ruta de seguimiento sobre una iniciativa real.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 90 * DAY),
          successCriteria: [
            {
              description: 'GET /iniciativas/:id/seguimiento/* responde con datos reales.',
              evidenceSource: 'Respuesta de la propia ruta bajo prueba.',
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

  /** La misma iniciativa, ya ratificada — la mayoría de las pruebas la necesitan activa. */
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
        proposalVersionHash: hash(e.azar.opaqueId().padEnd(64, '0')),
        decisionResultHash: hash(e.azar.opaqueId().padEnd(64, '0')),
        circleId: CIRCLE as never,
        executionPlan: {
          objective: 'Probar la ruta de seguimiento sobre una iniciativa real.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 90 * DAY),
          successCriteria: [
            {
              description: 'GET /iniciativas/:id/seguimiento/* responde con datos reales.',
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
        titulo: 'Preparar y ejecutar el piloto de la prueba de seguimiento',
        criterioDeTerminacion: 'El piloto termina con evidencia pública de haberse hecho.',
        venceEn: e.reloj.now() + 60 * DAY,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const milestone = response.json<InitiativeView>().hitos[0]?.id;
    if (milestone === undefined) throw new Error('la prueba exige un hito recién creado');
    return milestone;
  }

  async function offerTask(
    initiative: string,
    milestone: string,
    responsible: { testigo: string },
    recipientId: string,
    venceEnMs: number,
    dependeDe: readonly string[] = [],
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
        dependeDe,
      },
    });
    expect(offered.statusCode, offered.body).toBe(201);
    const task = offered.json<InitiativeView>().tareas.at(-1);
    if (task === undefined) throw new Error('la prueba exige una tarea recién ofrecida');
    return { taskId: task.id, offerId: task.ofertaId, revision: task.revision };
  }

  /** Acepta, inicia, entrega y hace aceptar la revisión: la tarea termina `completada` de verdad. */
  async function completeTask(
    initiative: string,
    taskId: string,
    offerId: string,
    revision: number,
    recipient: { testigo: string },
    responsible: { testigo: string },
  ): Promise<void> {
    const accepted = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${taskId}/respuestas`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId, revision, tipo: 'aceptar' },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    let task = accepted.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;

    const started = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${taskId}/iniciar`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId, revision: task.revision },
    });
    expect(started.statusCode, started.body).toBe(200);
    task = started.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;

    const evidenced = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${taskId}/evidencias`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision: task.revision,
        contenido: 'Evidencia suficiente para dar por completado el escenario de la prueba.',
        visibilidad: 'restricted',
      },
    });
    expect(evidenced.statusCode, evidenced.body).toBe(201);
    task = evidenced.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
    const evidenceId = task.evidencias.at(-1)?.id;
    if (evidenceId === undefined) throw new Error('la prueba exige una evidencia agregada');

    const delivered = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${taskId}/entregas`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision: task.revision,
        evidenciaIds: [evidenceId],
        resumen: 'Se completó el trabajo descrito y queda evidencia adjunta para revisión.',
      },
    });
    expect(delivered.statusCode, delivered.body).toBe(201);
    task = delivered.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
    const deliveryId = task.entregaActualId;
    if (deliveryId === undefined) throw new Error('la prueba exige una entrega registrada');

    const reviewed = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${taskId}/revisiones/aceptar`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        deliveryId,
        revision: task.revision,
        evidenciaCriterio: 'verificada',
      },
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    const reviewedTask = reviewed.json<InitiativeView>().tareas.find((t) => t.id === taskId)!;
    expect(reviewedTask.estado).toBe('completada');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // GET /iniciativas/:id/seguimiento/destrabes
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('GET /iniciativas/:id/seguimiento/destrabes', () => {
    it('404 cuando la iniciativa no existe', async () => {
      const response = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${initiativeId(e.azar.opaqueId())}/seguimiento/destrabes`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('B no aparece mientras A sigue sin completar, y aparece con el hecho exacto en cuanto completa', async () => {
      const responsible = await entrar(e, 'responsable.destrabe@udea.edu.co');
      const recipientA = await entrar(e, 'destinataria.a.destrabe@udea.edu.co');
      const recipientB = await entrar(e, 'destinataria.b.destrabe@udea.edu.co');
      await declararCapacidad(e, recipientA.testigo, 300);
      await declararCapacidad(e, recipientB.testigo, 300);

      const id = await activeInitiative(responsible.miembroId);
      const milestone = await planMilestone(id, responsible);

      const a = await offerTask(id, milestone, responsible, recipientA.miembroId, 20 * DAY);
      const b = await offerTask(id, milestone, responsible, recipientB.miembroId, 20 * DAY, [
        a.taskId,
      ]);

      // Todavía nada: A no completó.
      const antes = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${id}/seguimiento/destrabes`,
      });
      expect(antes.statusCode, antes.body).toBe(200);
      expect(antes.json<{ destrabes: readonly DestrabeDto[] }>().destrabes).toEqual([]);

      // El reloj de prueba no avanza solo: el instante de `TaskReviewAccepted` —y por tanto de
      // `completedAt`— es exactamente este, así que el hecho se puede comparar por igualdad exacta
      // en vez de con un comodín.
      const instanteDeCompletar = e.reloj.now();
      await completeTask(id, a.taskId, a.offerId, a.revision, recipientA, responsible);

      const despues = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${id}/seguimiento/destrabes`,
      });
      expect(despues.statusCode, despues.body).toBe(200);
      const destrabes = despues.json<{ destrabes: readonly DestrabeDto[] }>().destrabes;
      expect(destrabes).toEqual([
        {
          tareaId: b.taskId,
          dependenciaCompletadaId: a.taskId,
          destrabadaEn: instanteDeCompletar,
        },
      ]);
    });

    it('una tarea sin dependencias nunca aparece, complete o no', async () => {
      const responsible = await entrar(e, 'responsable.sindep@udea.edu.co');
      const recipient = await entrar(e, 'destinataria.sindep@udea.edu.co');
      await declararCapacidad(e, recipient.testigo, 300);
      const id = await activeInitiative(responsible.miembroId);
      const milestone = await planMilestone(id, responsible);
      const sola = await offerTask(id, milestone, responsible, recipient.miembroId, 20 * DAY);
      await completeTask(id, sola.taskId, sola.offerId, sola.revision, recipient, responsible);

      const response = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${id}/seguimiento/destrabes`,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<{ destrabes: readonly DestrabeDto[] }>().destrabes).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // GET /iniciativas/:id/seguimiento/informe
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('GET /iniciativas/:id/seguimiento/informe', () => {
    it('404 cuando la iniciativa no existe', async () => {
      const response = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${initiativeId(e.azar.opaqueId())}/seguimiento/informe`,
      });
      expect(response.statusCode).toBe(404);
    });

    it('una iniciativa provisional (sin ratificar) no tiene reloj de informes corriendo', async () => {
      const responsible = await entrar(e, 'responsable.provisional@udea.edu.co');
      const id = await provisionalInitiative(responsible.miembroId);
      const response = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${id}/seguimiento/informe`,
      });
      expect(response.statusCode, response.body).toBe(200);
      const cuerpo = response.json<InformeSeguimientoDto>();
      expect(cuerpo).toEqual({
        aplica: false,
        activadaEn: null,
        proximoVenceEn: null,
        vencido: false,
        edadVencidoMs: null,
      });
    });

    it('recién ratificada, no está vencido; a los 15 días exactos, sí — y ultimoInformeEn reinicia el reloj', async () => {
      const responsible = await entrar(e, 'responsable.informe@udea.edu.co');
      const id = await activeInitiative(responsible.miembroId);
      const activadaEn = e.reloj.now();

      const reciente = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${id}/seguimiento/informe`,
      });
      expect(reciente.statusCode, reciente.body).toBe(200);
      let cuerpo = reciente.json<InformeSeguimientoDto>();
      expect(cuerpo.aplica).toBe(true);
      expect(cuerpo.activadaEn).toBe(activadaEn);
      expect(cuerpo.vencido).toBe(false);
      expect(cuerpo.proximoVenceEn).toBe(activadaEn + 15 * DAY);

      e.reloj.avanzar(15 * DAY);
      const vencido = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${id}/seguimiento/informe`,
      });
      expect(vencido.statusCode, vencido.body).toBe(200);
      cuerpo = vencido.json<InformeSeguimientoDto>();
      expect(cuerpo.vencido).toBe(true);
      expect(cuerpo.edadVencidoMs).toBe(0);

      // Un informe rendido 5 días atrás reinicia el reloj: todavía no debería estar vencido.
      const conInforme = await seguimiento.inject({
        method: 'GET',
        url: `/iniciativas/${id}/seguimiento/informe?ultimoInformeEn=${String(e.reloj.now() - 5 * DAY)}`,
      });
      expect(conInforme.statusCode, conInforme.body).toBe(200);
      cuerpo = conInforme.json<InformeSeguimientoDto>();
      expect(cuerpo.vencido).toBe(false);
      expect(cuerpo.proximoVenceEn).toBe(e.reloj.now() - 5 * DAY + 15 * DAY);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // POST /iniciativas/:id/tareas/:tareaId/retiro-de-encargo
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('POST /iniciativas/:id/tareas/:tareaId/retiro-de-encargo', () => {
    const MOTIVO =
      'El círculo revisó la carga de esta tarea en sesión y decidió, con consenso explícito, retirar el encargo.';

    async function iniciativaConTarea(): Promise<{
      readonly id: string;
      readonly taskId: string;
      readonly responsible: { testigo: string; miembroId: string };
    }> {
      const responsible = await entrar(e, `responsable.retiro.${String(++n)}@udea.edu.co`);
      const recipient = await entrar(e, `destinataria.retiro.${String(n)}@udea.edu.co`);
      await declararCapacidad(e, recipient.testigo, 300);
      const id = await activeInitiative(responsible.miembroId);
      const milestone = await planMilestone(id, responsible);
      const { taskId } = await offerTask(id, milestone, responsible, recipient.miembroId, 20 * DAY);
      return { id, taskId, responsible };
    }

    it('404 cuando la tarea no existe en esa iniciativa', async () => {
      const { id } = await iniciativaConTarea();
      const response = await seguimiento.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas/${e.azar.opaqueId()}/retiro-de-encargo`,
        payload: {
          escalonActual: 'en-revision-colectiva',
          consentimientoDelCirculo: true,
          motivo: MOTIVO,
        },
      });
      expect(response.statusCode).toBe(404);
    });

    it('422 sin el techo de la escalera, aunque haya consentimiento y motivo', async () => {
      const { id, taskId } = await iniciativaConTarea();
      const response = await seguimiento.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas/${taskId}/retiro-de-encargo`,
        payload: { escalonActual: 'bloqueada', consentimientoDelCirculo: true, motivo: MOTIVO },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json<{ codigo: string }>().codigo).toBe(
        'RETIRO_ENCARGO_SIN_TECHO_DE_ESCALERA',
      );
    });

    it('422 sin consentimiento explícito del círculo — nunca automático', async () => {
      const { id, taskId } = await iniciativaConTarea();
      const response = await seguimiento.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas/${taskId}/retiro-de-encargo`,
        payload: {
          escalonActual: 'en-revision-colectiva',
          consentimientoDelCirculo: false,
          motivo: MOTIVO,
        },
      });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json<{ codigo: string }>().codigo).toBe(
        'RETIRO_ENCARGO_SIN_CONSENTIMIENTO_DEL_CIRCULO',
      );
    });

    it('400 con un motivo demasiado corto: el borde ya lo rechaza el esquema HTTP', async () => {
      const { id, taskId } = await iniciativaConTarea();
      const response = await seguimiento.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas/${taskId}/retiro-de-encargo`,
        payload: {
          escalonActual: 'en-revision-colectiva',
          consentimientoDelCirculo: true,
          motivo: 'muy corto',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('201 con las tres condiciones: devuelve el registro con decididoEn del reloj del servidor', async () => {
      const { id, taskId } = await iniciativaConTarea();
      const ahoraDelServidor = e.reloj.now();
      const response = await seguimiento.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas/${taskId}/retiro-de-encargo`,
        payload: {
          escalonActual: 'en-revision-colectiva',
          consentimientoDelCirculo: true,
          motivo: `  ${MOTIVO}  `,
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      const cuerpo = response.json<RetiroDeEncargoDto>();
      expect(cuerpo).toEqual({
        tareaId: taskId,
        peldano: 'dominio-suspendido',
        motivo: MOTIVO,
        decididoEn: ahoraDelServidor,
      });
    });

    it('no aplica nada al ledger: la tarea sigue igual después de evaluar el retiro', async () => {
      const { id, taskId } = await iniciativaConTarea();
      await seguimiento.inject({
        method: 'POST',
        url: `/iniciativas/${id}/tareas/${taskId}/retiro-de-encargo`,
        payload: {
          escalonActual: 'en-revision-colectiva',
          consentimientoDelCirculo: true,
          motivo: MOTIVO,
        },
      });
      const detalle = await e.app.inject({ method: 'GET', url: `/iniciativas/${id}` });
      expect(detalle.statusCode, detalle.body).toBe(200);
      const tarea = detalle.json<InitiativeView>().tareas.find((t) => t.id === taskId);
      expect(tarea?.estado).toBe('ofrecida');
    });
  });
});
