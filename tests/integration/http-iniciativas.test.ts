/**
 * `GET /iniciativas/tablero` contra Fastify + PostgreSQL reales.
 *
 * La ruta bajo prueba vive en un `FastifyInstance` propio, separado del `env.app` real: es
 * exactamente la situación en la que va a estar hasta que un agente integrador llame a
 * `registrarRutasDeIniciativas` desde `services/api/src/http/app.ts` (fuera de mi ámbito en este
 * encargo). Las mutaciones de preparación —planificar el hito, ofrecer, aceptar, bloquear, entregar—
 * sí van contra `env.app`, que ya tiene esas rutas reales: lo único nuevo aquí es la lectura del
 * tablero, y por eso es lo único que se prueba contra la app nueva.
 *
 * Lo que estas pruebas demuestran con datos reales, no con un objeto construido a mano:
 *  - una iniciativa recién resultada y sin ratificar aparece `por-empezar` (ADR-0043);
 *  - una vez ratificada y sin nada pendiente, aparece `en-curso`;
 *  - una tarea bloqueada o en apoyo pinta la iniciativa entera `bloqueada` (ADR-0044: ambas
 *    «detienen el reloj»);
 *  - una entrega sin revisar pinta `en-revision`;
 *  - `estadoEnPalabras` nunca usa la jerga que ADR-0041 prohíbe en pantalla;
 *  - la ruta no exige sesión, igual que `GET /iniciativas` hoy.
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
import { forbiddenTermsIn } from '@koinonia/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
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
import {
  registrarRutasDeIniciativas,
  type TableroIniciativas,
  type TarjetaTableroIniciativa,
} from '../../services/api/src/http/rutas-iniciativas.js';

const env = await apiEnv();
const CIRCLE = 'e5bac105b1e00000000000000000000b';
const DAY = 24 * 60 * 60 * 1000;
let n = 0x7700;

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
  readonly hitos: readonly { readonly id: string }[];
  readonly tareas: readonly {
    readonly id: string;
    readonly ofertaId: string;
    readonly revision: number;
    readonly estado: string;
    readonly pausaActual?: { readonly id: string };
    readonly evidencias: readonly { readonly id: string }[];
  }[];
}

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`GET /iniciativas/tablero${skipNote(env)}`, () => {
  let e: ApiListo;
  let tablero: FastifyInstance;

  beforeAll(async () => {
    e = listo(env);
    // Los mismos puertos que arma `apiEnv` para `env.app`, reconstruidos con las piezas que
    // `ApiListo` ya expone. La ruta bajo prueba no los usa (`listarIniciativas` sólo toca el pool),
    // pero `ServicioDeps` los exige por tipo y este es el mismo patrón, no uno inventado.
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
    tablero = Fastify();
    registrarRutasDeIniciativas(tablero, { deps: { pool: e.pool, ports } });
    await tablero.ready();
  });

  afterAll(async () => {
    await tablero?.close().catch(() => undefined);
  });

  async function provisionalInitiative(responsibleId: string): Promise<string> {
    const id = initiativeId(e.azar.opaqueId());
    const log = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at: instant(e.reloj.now()), actor: 'system' },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash('1'.repeat(64)),
        decisionResultHash: hash('2'.repeat(64)),
        circleId: CIRCLE as never,
        executionPlan: {
          objective: 'Probar que el tablero deriva por-empezar de una iniciativa sin ratificar.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 30 * DAY),
          successCriteria: [
            {
              description: 'El tablero muestra por-empezar mientras no exista InitiativeActivated.',
              evidenceSource: 'Respuesta de GET /iniciativas/tablero',
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
        proposalVersionHash: hash('3'.repeat(64)),
        decisionResultHash: hash('4'.repeat(64)),
        circleId: CIRCLE as never,
        executionPlan: {
          objective:
            'Probar que el tablero deriva en-curso, bloqueada y en-revision de una iniciativa real.',
          responsibleId: responsibleId as never,
          reviewAt: instant(e.reloj.now() + 30 * DAY),
          successCriteria: [
            {
              description: 'El tablero refleja el estado real de hitos y tareas, no un valor fijo.',
              evidenceSource: 'Respuesta de GET /iniciativas/tablero',
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
        ratificationEventHash: hash('5'.repeat(64)),
      },
    );
    await withTransaction(e.pool, (client) =>
      persistInitiativeLogWithin(client, log, { requestId: requestId() }),
    );
    return id;
  }

  async function planMilestone(initiative: string, responsible: Session): Promise<string> {
    const response = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/hitos`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        titulo: 'Preparar y ejecutar el primer piloto colectivo',
        criterioDeTerminacion: 'El piloto termina con evidencia pública de haberse hecho.',
        venceEn: e.reloj.now() + 20 * DAY,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const milestone = response.json<InitiativeView>().hitos[0]?.id;
    if (milestone === undefined) throw new Error('la prueba exige un hito recién creado');
    return milestone;
  }

  /** Ofrece, acepta y comienza una tarea. Deja la tarea `en-curso` y la iniciativa lista para bloquear o entregar. */
  async function taskInProgress(
    initiative: string,
    milestone: string,
    responsible: Session,
    recipient: Session,
  ): Promise<{ taskId: string; offerId: string; revision: number }> {
    const offered = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas`,
      headers: como(responsible.testigo),
      payload: {
        requestId: requestId(),
        hitoId: milestone,
        destinatarioId: recipient.miembroId,
        titulo: 'Documentar las condiciones iniciales del piloto',
        descripcion: 'Registrar el punto de partida y la evidencia que permitirá evaluarlo.',
        venceEn: e.reloj.now() + 10 * DAY,
        esfuerzoMinutos: 120,
        dependeDe: [],
      },
    });
    expect(offered.statusCode, offered.body).toBe(201);
    let task = offered.json<InitiativeView>().tareas[0];
    if (task === undefined) throw new Error('la prueba exige una tarea recién ofrecida');

    const accepted = await e.app.inject({
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
    expect(accepted.statusCode, accepted.body).toBe(200);
    task = accepted.json<InitiativeView>().tareas[0]!;

    const started = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${initiative}/tareas/${task.id}/iniciar`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId: task.ofertaId, revision: task.revision },
    });
    expect(started.statusCode, started.body).toBe(200);
    task = started.json<InitiativeView>().tareas[0]!;
    expect(task.estado).toBe('en-curso');
    return { taskId: task.id, offerId: task.ofertaId, revision: task.revision };
  }

  async function tarjetaDe(id: string): Promise<TarjetaTableroIniciativa> {
    const response = await tablero.inject({ method: 'GET', url: '/iniciativas/tablero' });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<TableroIniciativas>();
    const found = body.tarjetas.find((tarjeta) => tarjeta.id === id);
    if (found === undefined) throw new Error(`la iniciativa ${id} no aparece en el tablero`);
    return found;
  }

  it('una iniciativa recién resultada y sin ratificar aparece por-empezar', async () => {
    const responsible = await entrar(e, 'responsable.por-empezar@udea.edu.co');
    const id = await provisionalInitiative(responsible.miembroId);
    const tarjeta = await tarjetaDe(id);
    expect(tarjeta.activa).toBe(false);
    expect(tarjeta.estado).toBe('por-empezar');
    expect(tarjeta.estadoEnPalabras).toBe('Por empezar');
  });

  it('ratificada y sin tareas pendientes aparece en-curso', async () => {
    const responsible = await entrar(e, 'responsable.en-curso@udea.edu.co');
    const id = await activeInitiative(responsible.miembroId);
    const tarjeta = await tarjetaDe(id);
    expect(tarjeta.activa).toBe(true);
    expect(tarjeta.estado).toBe('en-curso');
    expect(tarjeta.avance).toEqual({ hitos: 0, tareasTotales: 0, tareasCompletas: 0 });
  });

  it('una tarea bloqueada pinta la iniciativa entera bloqueada, y reanudar la devuelve a en-curso', async () => {
    const responsible = await entrar(e, 'responsable.bloqueada@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.bloqueada@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 300);
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);
    const { taskId, offerId, revision } = await taskInProgress(
      id,
      milestone,
      responsible,
      recipient,
    );

    const blocked = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/bloquear`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId, revision, categoria: 'dependencia' },
    });
    expect(blocked.statusCode, blocked.body).toBe(200);
    const blockedTask = blocked.json<InitiativeView>().tareas[0]!;
    expect(blockedTask.estado).toBe('bloqueada');

    let tarjeta = await tarjetaDe(id);
    expect(tarjeta.estado).toBe('bloqueada');
    expect(tarjeta.estadoEnPalabras).toBe('Bloqueada');
    expect(tarjeta.avance).toEqual({ hitos: 1, tareasTotales: 1, tareasCompletas: 0 });

    const pauseId = blockedTask.pausaActual?.id;
    if (pauseId === undefined) throw new Error('la prueba exige una pausa vigente');
    const resumed = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/reanudar`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision: blockedTask.revision,
        pauseId,
      },
    });
    expect(resumed.statusCode, resumed.body).toBe(200);

    tarjeta = await tarjetaDe(id);
    expect(tarjeta.estado).toBe('en-curso');
  });

  it('pedir ayuda (en-apoyo) también pinta la iniciativa bloqueada', async () => {
    const responsible = await entrar(e, 'responsable.en-apoyo@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.en-apoyo@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 300);
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);
    const { taskId, offerId, revision } = await taskInProgress(
      id,
      milestone,
      responsible,
      recipient,
    );

    const helped = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/ayuda`,
      headers: como(recipient.testigo),
      payload: { requestId: requestId(), offerId, revision, categoria: 'orientacion' },
    });
    expect(helped.statusCode, helped.body).toBe(200);
    expect(helped.json<InitiativeView>().tareas[0]?.estado).toBe('en-apoyo');

    const tarjeta = await tarjetaDe(id);
    expect(tarjeta.estado).toBe('bloqueada');
  });

  it('una entrega sin revisar pinta en-revision', async () => {
    const responsible = await entrar(e, 'responsable.en-revision@udea.edu.co');
    const recipient = await entrar(e, 'destinataria.en-revision@udea.edu.co');
    await declararCapacidad(e, recipient.testigo, 300);
    const id = await activeInitiative(responsible.miembroId);
    const milestone = await planMilestone(id, responsible);
    const { taskId, offerId, revision } = await taskInProgress(
      id,
      milestone,
      responsible,
      recipient,
    );

    const evidenced = await e.app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/tareas/${taskId}/evidencias`,
      headers: como(recipient.testigo),
      payload: {
        requestId: requestId(),
        offerId,
        revision,
        contenido: 'La evidencia que respalda el cierre de esta tarea, sin datos personales.',
        visibilidad: 'restricted',
      },
    });
    expect(evidenced.statusCode, evidenced.body).toBe(201);
    const evidencedTask = evidenced.json<InitiativeView>().tareas[0]!;
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
    expect(delivered.json<InitiativeView>().tareas[0]?.estado).toBe('entregada');

    const tarjeta = await tarjetaDe(id);
    expect(tarjeta.estado).toBe('en-revision');
    expect(tarjeta.estadoEnPalabras).toBe('En revisión');
  });

  it('el tablero no exige sesión: GET /iniciativas/tablero es pública, igual que GET /iniciativas', async () => {
    const response = await tablero.inject({ method: 'GET', url: '/iniciativas/tablero' });
    expect(response.statusCode).toBe(200);
    const body = response.json<TableroIniciativas>();
    expect(body.tarjetas.length).toBeGreaterThan(0);
    const suma = Object.values(body.totalesPorEstado).reduce((a, b) => a + b, 0);
    expect(suma).toBe(body.tarjetas.length);
    expect(Object.keys(body.totalesPorEstado).sort()).toEqual(
      ['bloqueada', 'en-curso', 'en-revision', 'por-empezar'].sort(),
    );
  });

  it('ninguna palabra de pantalla del tablero usa la jerga que ADR-0041 prohíbe', async () => {
    const response = await tablero.inject({ method: 'GET', url: '/iniciativas/tablero' });
    const body = response.json<TableroIniciativas>();
    for (const tarjeta of body.tarjetas) {
      expect(forbiddenTermsIn(tarjeta.estadoEnPalabras)).toEqual([]);
    }
  });
});
