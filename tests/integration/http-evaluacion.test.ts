/**
 * ADR-0053 por HTTP: evaluación contra criterios congelados, resultado derivado y aprendizajes,
 * contra Fastify + PostgreSQL real.
 *
 * ═══ Por qué este archivo levanta un `FastifyInstance` propio ═══
 *
 * `registrarRutasDeEvaluacion` es un incremento nuevo que todavía no está integrado en
 * `services/api/src/http/app.ts` (lo hace un agente integrador en una fase posterior, ver la
 * cabecera de `rutas-evaluacion.ts`). Así que este archivo reutiliza `apiEnv()` únicamente por su
 * PostgreSQL real, su reloj y su azar controlables, y por `entrar()` para obtener sesiones reales —
 * pero las peticiones a `/iniciativas/:id/evaluacion...` y `/aprendizajes` van contra un `app`
 * propio, mínimo, que sólo registra estas rutas. Las dos aplicaciones comparten la misma base de
 * datos, así que lo que una escribe la otra lo lee.
 *
 * ═══ Por qué la iniciativa nace por dominio y no por HTTP ═══
 *
 * Igual que `http-tareas-adr44.test.ts`: construir el camino completo problema → propuesta →
 * decisión → ratificación por HTTP no prueba nada de este incremento y hace la prueba frágil ante
 * cualquier cambio en esas pantallas. La iniciativa activa se escribe directamente con
 * `createInitiative` + `activateInitiative` y se persiste con `persistInitiativeLogWithin`, que es
 * exactamente lo que hace el resto de la suite para fijar el punto de partida.
 */

import {
  activateInitiative,
  circleId,
  createInitiative,
  decisionId,
  DomainError,
  eventId,
  hash,
  initiativeId,
  instant,
  type MemberId,
  proposalId,
} from '@koinonia/domain';
import { persistInitiativeLogWithin, withTransaction } from '@koinonia/api';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type ContextoEvaluacion,
  registrarRutasDeEvaluacion,
} from '../../services/api/src/http/rutas-evaluacion.js';
import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  FACILITADORA,
  listo,
  skipNote,
} from './helpers/api-env.js';

const env = await apiEnv();
// = CIRCULOS.espacios.id (services/api/src/http/circles.ts): el círculo por defecto que
// `udeaIdentityAdapter` concede a cualquier correo institucional en `apiEnv()`.
const CIRCLE = 'e5bac105b1e00000000000000000000b';
const OTHER_CIRCLE = 'acade31c0000000000000000000000c1';
const DAY = 24 * 60 * 60 * 1_000;
let n = 0x7000;

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

interface Informe {
  readonly evaluacionId: string;
  readonly iniciativaId: string;
  readonly estado: string;
  readonly desenlace: string;
  readonly desenlacePublicado?: string;
  readonly discrepancia?: { readonly motivo: string; readonly explicacion: string };
  readonly criterios: readonly {
    readonly indice: number;
    readonly veredicto?: string;
    readonly hechoQueLoSostieneId?: string;
  }[];
  readonly aprendizajes: readonly { readonly id: string; readonly tipo: string }[];
  readonly escaladas: readonly unknown[];
  readonly disposicion?: string;
  readonly narrativa: string;
}

describe.skipIf(!env.ok)(`API de evaluación ADR-0053${skipNote(env)}`, () => {
  let e: ApiListo;
  let app: FastifyInstance;

  beforeAll(async () => {
    e = listo(env);
    const ctx: ContextoEvaluacion = {
      pool: e.pool,
      ports: {
        clock: { now: () => e.reloj.now() },
        random: {
          bytes: (n2) => e.azar.bytes(n2),
          opaqueId: () => e.azar.opaqueId(),
          uuid: () => e.azar.uuid(),
        },
      },
      ratePepper: 'pimienta-de-prueba-suficientemente-larga',
    };
    app = Fastify();
    registrarRutasDeEvaluacion(app, ctx);
    // El manejador que le falta a un `app` desnudo: `conTraduccion` ya resuelve los errores propios
    // de esta capa (404, 409, 401/403); lo que queda es lo que en el `app` real resuelve `errorDe`
    // de `app.ts` — un rechazo del dominio (cuerpo mal formado no se ejercita en esta suite).
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof DomainError) {
        return reply.status(422).send({ codigo: error.code, mensaje: error.message });
      }
      throw error;
    });
    await app.ready();
  });

  /**
   * Iniciativa activa con un único criterio de éxito, lista para evaluarse. `reviewAt` queda
   * `plazoDias` por delante del reloj de la prueba: cada escenario avanza el reloj lo que necesite
   * antes de abrir la evaluación.
   */
  async function iniciativaActiva(
    responsableId: string,
    plazoDias = 10,
    circulo = CIRCLE,
  ): Promise<{ readonly id: string; readonly reviewAt: number }> {
    const id = initiativeId(e.azar.opaqueId());
    const at = instant(e.reloj.now());
    const reviewAt = e.reloj.now() + plazoDias * DAY;
    let log = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash(e.azar.opaqueId() + e.azar.opaqueId()),
        decisionResultHash: hash(e.azar.opaqueId() + e.azar.opaqueId()),
        circleId: circleId(circulo),
        executionPlan: {
          objective:
            'Conseguir que la sala de estudio tenga un horario útil para la jornada nocturna.',
          responsibleId: responsableId as MemberId,
          reviewAt: instant(reviewAt),
          successCriteria: [
            {
              description:
                'La sala abre hasta las nueve de la noche al menos tres días por semana.',
              evidenceSource: 'Horario oficial publicado por el Instituto',
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
        ratificationEventHash: hash(e.azar.opaqueId() + e.azar.opaqueId()),
      },
    );
    await withTransaction(e.pool, (client) =>
      persistInitiativeLogWithin(client, log, { requestId: requestId() }),
    );
    return { id, reviewAt };
  }

  async function abrir(
    id: string,
    testigo: string,
  ): Promise<{ readonly status: number; readonly json: Informe }> {
    const res = await app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/evaluacion`,
      headers: como(testigo),
      payload: { requestId: requestId() },
    });
    return { status: res.statusCode, json: res.json<Informe>() };
  }

  describe('camino con éxito: se abre, se valora, se publica y se cierra manteniendo', () => {
    it('recorre el ciclo entero y no deja a nadie en la salida', async () => {
      const correoResponsable = `responsable.exito.${String(n)}@udea.edu.co`;
      const correoOtro = `otro.exito.${String(n)}@udea.edu.co`;
      const responsable = await entrar(e, correoResponsable);
      let otroDelCirculo = await entrar(e, correoOtro);
      const { id, reviewAt } = await iniciativaActiva(responsable.miembroId);

      // Antes de la fecha comprometida: el motor rechaza la emboscada.
      const temprano = await abrir(id, otroDelCirculo.testigo);
      expect(temprano.status).toBe(422);

      // La sesión dura 12 horas (`SESION_VIGENCIA_MS`) y la fecha de revisión queda días por
      // delante: se vuelve a entrar sobre el reloj ya avanzado para no operar con una sesión vencida.
      e.reloj.avanzar(reviewAt - e.reloj.now() + DAY);
      otroDelCirculo = await entrar(e, correoOtro);

      // Cualquier miembro del círculo convoca: no hace falta ser quien asumió el plan.
      const abierta = await abrir(id, otroDelCirculo.testigo);
      expect(abierta.status, JSON.stringify(abierta.json)).toBe(201);
      expect(abierta.json.estado).toBe('en-curso');
      expect(abierta.json.desenlace).toBe('inconcluso');
      expect(abierta.json.criterios).toHaveLength(1);
      expect(abierta.json.criterios[0]?.veredicto).toBeUndefined();

      // Abrir dos veces la misma iniciativa no es una segunda evaluación: es un conflicto.
      const reabierta = await abrir(id, otroDelCirculo.testigo);
      expect(reabierta.status).toBe(409);

      const leida = await app.inject({ method: 'GET', url: `/iniciativas/${id}/evaluacion` });
      expect(leida.statusCode).toBe(200);
      expect(leida.json<Informe>().estado).toBe('en-curso');

      const hecho = e.azar.opaqueId();
      const valorado = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/criterios/0/valoracion`,
        headers: como(otroDelCirculo.testigo),
        payload: {
          requestId: requestId(),
          veredicto: 'cumplido',
          evidencia: 'verificada',
          hechoQueLoSostieneId: hecho,
        },
      });
      expect(valorado.statusCode, valorado.body).toBe(201);
      const informeValorado = valorado.json<Informe>();
      expect(informeValorado.desenlace).toBe('logrado');
      expect(informeValorado.criterios[0]?.veredicto).toBe('cumplido');
      expect(informeValorado.criterios[0]?.hechoQueLoSostieneId).toBe(hecho);

      const publicado = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/publicacion`,
        headers: como(otroDelCirculo.testigo),
        payload: { requestId: requestId() },
      });
      expect(publicado.statusCode, publicado.body).toBe(201);
      const informePublicado = publicado.json<Informe>();
      expect(informePublicado.estado).toBe('publicada');
      expect(informePublicado.desenlacePublicado).toBe('logrado');
      expect(informePublicado.discrepancia).toBeUndefined();

      // Cerrar sí es procedimiento (§7 de GOVERNANCE): la única de las siete acciones que no es de
      // miembro raso. `otroDelCirculo` (`member`) lo tiene prohibido; hace falta facilitación.
      const facilitador = await entrar(e, FACILITADORA);
      const cierreDeMiembroRaso = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/cierre`,
        headers: como(otroDelCirculo.testigo),
        payload: {
          requestId: requestId(),
          disposicion: 'mantener',
          proximaRevisionEn: e.reloj.now() + 200 * DAY,
        },
      });
      expect(cierreDeMiembroRaso.statusCode).toBe(403);

      const cerrado = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/cierre`,
        headers: como(facilitador.testigo),
        payload: {
          requestId: requestId(),
          disposicion: 'mantener',
          proximaRevisionEn: e.reloj.now() + 200 * DAY,
        },
      });
      expect(cerrado.statusCode, cerrado.body).toBe(200);
      const informeCerrado = cerrado.json<Informe>();
      expect(informeCerrado.estado).toBe('cerrada');
      expect(informeCerrado.disposicion).toBe('mantener');

      // ADR-0040: nadie aparece en ninguna respuesta de este ciclo, ni siquiera como sustring.
      // `.body` es el texto crudo que salió por la red: no hay tipo que pueda ocultar una fuga ahí.
      for (const texto of [leida.body, valorado.body, publicado.body, cerrado.body]) {
        expect(texto).not.toContain(responsable.miembroId);
        expect(texto).not.toContain(otroDelCirculo.miembroId);
        expect(texto).not.toContain(facilitador.miembroId);
      }
      expect(JSON.stringify(abierta.json)).not.toContain(responsable.miembroId);
      expect(JSON.stringify(abierta.json)).not.toContain(otroDelCirculo.miembroId);
    });
  });

  describe('camino con fracaso: exige aprendizaje, prohíbe mantener, deja memoria', () => {
    it('no se cierra en mantener sobre un desenlace fallido, y la memoria recuerda por qué', async () => {
      const correo = `responsable.fallo.${String(n)}@udea.edu.co`;
      let responsable = await entrar(e, correo);
      const { id, reviewAt } = await iniciativaActiva(responsable.miembroId);
      e.reloj.avanzar(reviewAt - e.reloj.now() + DAY);
      responsable = await entrar(e, correo);
      const facilitador = await entrar(e, FACILITADORA);
      await abrir(id, responsable.testigo);

      const valorado = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/criterios/0/valoracion`,
        headers: como(responsable.testigo),
        payload: { requestId: requestId(), veredicto: 'incumplido', evidencia: 'sin-verificar' },
      });
      expect(valorado.statusCode, valorado.body).toBe(201);

      const publicado = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/publicacion`,
        headers: como(responsable.testigo),
        payload: { requestId: requestId() },
      });
      expect(publicado.json<Informe>().desenlace).toBe('fallido');

      // Sin aprendizaje anotado, el cierre se rechaza: el fracaso no se pierde en silencio.
      const cierreSinAprendizaje = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/cierre`,
        headers: como(facilitador.testigo),
        payload: { requestId: requestId(), disposicion: 'derogar' },
      });
      expect(cierreSinAprendizaje.statusCode).toBe(422);

      const etiqueta = `prueba${String(n)}`;
      const aprendizaje = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/aprendizajes`,
        headers: como(responsable.testigo),
        payload: {
          requestId: requestId(),
          tipo: 'lo-que-no-funciono',
          enunciado:
            'Convocar la revisión justo al vencer la fecha no dejó margen para reunir evidencia.',
          etiquetas: [etiqueta],
        },
      });
      expect(aprendizaje.statusCode, aprendizaje.body).toBe(201);

      // El desenlace fallido no se puede mantener tal cual: ADR-0033.
      const mantenerSobreFallo = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/cierre`,
        headers: como(facilitador.testigo),
        payload: {
          requestId: requestId(),
          disposicion: 'mantener',
          proximaRevisionEn: e.reloj.now() + 100 * DAY,
        },
      });
      expect(mantenerSobreFallo.statusCode).toBe(422);

      const derogado = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion/cierre`,
        headers: como(facilitador.testigo),
        payload: { requestId: requestId(), disposicion: 'derogar' },
      });
      expect(derogado.statusCode, derogado.body).toBe(200);
      expect(derogado.json<Informe>().disposicion).toBe('derogar');

      const memoria = await app.inject({
        method: 'GET',
        url: `/aprendizajes?etiqueta=${etiqueta}`,
      });
      expect(memoria.statusCode, memoria.body).toBe(200);
      const entradas = memoria.json<
        readonly {
          readonly desenlace: string;
          readonly aprendizaje: { readonly etiquetas: readonly string[] };
        }[]
      >();
      expect(entradas.length).toBeGreaterThanOrEqual(1);
      expect(entradas.every((entrada) => entrada.desenlace === 'fallido')).toBe(true);
      expect(entradas.every((entrada) => entrada.aprendizaje.etiquetas.includes(etiqueta))).toBe(
        true,
      );
      expect(JSON.stringify(entradas)).not.toContain(responsable.miembroId);
    });
  });

  describe('quién puede qué: la autorización se traduce a estado HTTP', () => {
    it('abrir sin identidad da 401, y sin pertenecer al círculo da 403', async () => {
      const responsable = await entrar(e, `responsable.auth.${String(n)}@udea.edu.co`);
      const { id, reviewAt } = await iniciativaActiva(responsable.miembroId);
      e.reloj.avanzar(reviewAt - e.reloj.now() + DAY);

      const sinIdentidad = await app.inject({
        method: 'POST',
        url: `/iniciativas/${id}/evaluacion`,
        payload: { requestId: requestId() },
      });
      expect(sinIdentidad.statusCode).toBe(401);

      const anonimoLee = await app.inject({ method: 'GET', url: `/iniciativas/${id}/evaluacion` });
      // Todavía no se abrió: 404, pero es un 404 público, no un 401 ni un 403.
      expect(anonimoLee.statusCode).toBe(404);

      // Ningún adaptador de identidad de esta prueba concede el círculo académico (`OTHER_CIRCLE`):
      // cualquier sesión real sirve para demostrar que pertenecer a otro círculo no alcanza.
      const { id: idAcademico, reviewAt: revisionAcademico } = await iniciativaActiva(
        responsable.miembroId,
        10,
        OTHER_CIRCLE,
      );
      e.reloj.avanzar(revisionAcademico - e.reloj.now() + DAY);
      const otroCirculo = await entrar(e, `otro.circulo.auth.${String(n)}@udea.edu.co`);
      const denegado = await app.inject({
        method: 'POST',
        url: `/iniciativas/${idAcademico}/evaluacion`,
        headers: como(otroCirculo.testigo),
        payload: { requestId: requestId() },
      });
      expect(denegado.statusCode, denegado.body).toBe(403);
      // La lectura, en cambio, es pública también para esta iniciativa: `evaluation:read` no
      // exige círculo. Como todavía no se abrió, el 404 es el mismo que para cualquier otra.
      const lecturaPublica = await app.inject({
        method: 'GET',
        url: `/iniciativas/${idAcademico}/evaluacion`,
      });
      expect(lecturaPublica.statusCode).toBe(404);
    });
  });

  describe('lo que no existe', () => {
    it('una iniciativa que nunca se creó da 404, no una excepción sin traducir', async () => {
      const responsable = await entrar(e, `responsable.404.${String(n)}@udea.edu.co`);
      const fantasma = e.azar.opaqueId();
      const res = await app.inject({
        method: 'POST',
        url: `/iniciativas/${fantasma}/evaluacion`,
        headers: como(responsable.testigo),
        payload: { requestId: requestId() },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json<{ codigo: string }>().codigo).toBe('NO_ENCONTRADO');
    });
  });
});
