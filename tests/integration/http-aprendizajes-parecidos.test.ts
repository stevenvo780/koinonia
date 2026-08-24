/**
 * `GET /aprendizajes/parecidos` por HTTP: la búsqueda por parecido léxico contra Fastify +
 * PostgreSQL real. Ver la cabecera de `services/api/src/http/rutas-aprendizajes.ts` para el diseño
 * completo (por qué llama a `GET /aprendizajes` por dentro con `app.inject`, y por qué eso exige
 * que `registrarRutasDeEvaluacion` esté en la misma instancia).
 *
 * Mismo motivo que `http-evaluacion.test.ts` para levantar un `FastifyInstance` propio: este
 * incremento tampoco está integrado en `services/api/src/http/app.ts` todavía. Y por eso mismo esta
 * suite registra **las dos** rutas —`registrarRutasDeEvaluacion` y `registrarRutasDeAprendizajes`—
 * sobre el mismo `app`: es exactamente la dependencia que la ruta bajo prueba necesita en
 * producción, y que el integrador cablea después.
 */

import {
  activateInitiative,
  circleId,
  createInitiative,
  decisionId,
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
  registrarRutasDeAprendizajes,
  type ContextoAprendizajes,
} from '../../services/api/src/http/rutas-aprendizajes.js';
import {
  registrarRutasDeEvaluacion,
  type ContextoEvaluacion,
} from '../../services/api/src/http/rutas-evaluacion.js';
import { apiEnv, type ApiListo, como, entrar, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();
const CIRCLE = 'e5bac105b1e00000000000000000000b';
const DAY = 24 * 60 * 60 * 1_000;
let n = 0x9000;

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

/**
 * Reconoce un error de Zod por forma (`.issues`), no con `instanceof z.ZodError`, para no meter
 * `zod` como dependencia nueva de `tests/` (regla de la casa nº 4): `packages/contracts` y
 * `services/api` ya lo traen, `tests/` no lo necesita.
 */
function errorDeZod(error: unknown): readonly { readonly message: string }[] | undefined {
  if (!(error instanceof Error) || error.name !== 'ZodError') return undefined;
  const issues = (error as { readonly issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as readonly { readonly message: string }[]) : undefined;
}

interface Coincidencia {
  readonly similitud: number;
  readonly palabrasCoincidentes: readonly string[];
  readonly aprendizaje: { readonly enunciado: string; readonly etiquetas: readonly string[] };
}

describe.skipIf(!env.ok)(`GET /aprendizajes/parecidos${skipNote(env)}`, () => {
  let e: ApiListo;
  let app: FastifyInstance;

  beforeAll(async () => {
    e = listo(env);
    const ctxEvaluacion: ContextoEvaluacion = {
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
    const ctxAprendizajes: ContextoAprendizajes = {};
    app = Fastify();
    registrarRutasDeEvaluacion(app, ctxEvaluacion);
    registrarRutasDeAprendizajes(app, ctxAprendizajes);
    // Mismo shim que `http-evaluacion.test.ts`: en producción, `app.ts` ya traduce un error de Zod
    // a 400 (`errorDe`); un `app` desnudo no lo hace solo. Se reconoce por forma (`.issues`), no
    // por `instanceof z.ZodError`, para no meter `zod` como dependencia nueva de `tests/` (regla de
    // la casa nº 4): `packages/contracts` y `services/api` ya lo traen, `tests/` no lo necesita.
    app.setErrorHandler((error, _request, reply) => {
      const issues = errorDeZod(error);
      if (issues !== undefined) {
        return reply
          .status(400)
          .send({ codigo: 'DATOS_INVALIDOS', mensaje: issues[0]?.message ?? 'inválido' });
      }
      throw error;
    });
    await app.ready();
  });

  /** Iniciativa activa con evaluación ya abierta, lista para anotarle aprendizajes. */
  async function iniciativaConEvaluacionAbierta(
    responsableId: string,
  ): Promise<{ readonly id: string }> {
    const id = initiativeId(e.azar.opaqueId());
    const at = instant(e.reloj.now());
    const reviewAt = e.reloj.now() + DAY;
    let log = await createInitiative(
      { eventId: eventId(e.azar.opaqueId()), at, actor: 'system' },
      {
        initiativeId: id,
        outcomeKind: 'approved',
        decisionId: decisionId(e.azar.opaqueId()),
        proposalId: proposalId(e.azar.opaqueId()),
        proposalVersionHash: hash(e.azar.opaqueId() + e.azar.opaqueId()),
        decisionResultHash: hash(e.azar.opaqueId() + e.azar.opaqueId()),
        circleId: circleId(CIRCLE),
        executionPlan: {
          objective: 'Conseguir que la sala de estudio tenga un horario útil de noche.',
          responsibleId: responsableId as MemberId,
          reviewAt: instant(reviewAt),
          successCriteria: [
            { description: 'La sala abre hasta las nueve.', evidenceSource: 'Horario publicado' },
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
    e.reloj.avanzar(reviewAt - e.reloj.now() + DAY);
    const testigo = (await entrar(e, `resp.parecidos.${String(n)}@udea.edu.co`)).testigo;
    const abierta = await app.inject({
      method: 'POST',
      url: `/iniciativas/${id}/evaluacion`,
      headers: como(testigo),
      payload: { requestId: requestId() },
    });
    expect(abierta.statusCode, abierta.body).toBe(201);
    return { id };
  }

  async function anotar(
    iniciativaId2: string,
    enunciado: string,
    etiquetas: readonly string[],
  ): Promise<void> {
    const testigo = (await entrar(e, `anota.parecidos.${String(n)}@udea.edu.co`)).testigo;
    const res = await app.inject({
      method: 'POST',
      url: `/iniciativas/${iniciativaId2}/evaluacion/aprendizajes`,
      headers: como(testigo),
      payload: { requestId: requestId(), tipo: 'lo-que-no-funciono', enunciado, etiquetas },
    });
    expect(res.statusCode, res.body).toBe(201);
  }

  describe('parecido léxico: ordena por cuántas palabras del problema comparte', () => {
    it('el más parecido va primero, lo irrelevante no aparece, y nadie queda identificado', async () => {
      const { id } = await iniciativaConEvaluacionAbierta(
        (await entrar(e, `resp.base.${String(n)}@udea.edu.co`)).miembroId,
      );

      // Muy parecido al problema nuevo: comparte casi todo el vocabulario significativo.
      await anotar(
        id,
        'El horario nocturno de la sala de estudio cierra demasiado temprano y eso urge resolver.',
        ['urgente'],
      );
      // Parecido, pero comparte menos palabras.
      await anotar(
        id,
        'El horario nocturno de la sala de estudio quedó mal definido desde el principio.',
        ['horarios', 'sala'],
      );
      // Nada que ver: no debe aparecer con un puntaje de «tal vez».
      await anotar(
        id,
        'Las sillas nuevas de la biblioteca llegaron con retraso por un problema de presupuesto.',
        ['presupuesto'],
      );

      const busqueda = await app.inject({
        method: 'GET',
        url:
          '/aprendizajes/parecidos?' +
          new URLSearchParams({
            titulo: 'Horario nocturno de la sala de estudio',
            cuerpo: 'La sala cierra demasiado temprano para quienes estudian de noche.',
          }).toString(),
      });
      expect(busqueda.statusCode, busqueda.body).toBe(200);
      const resultado = busqueda.json<readonly Coincidencia[]>();

      expect(resultado).toHaveLength(2);
      expect(resultado[0]?.aprendizaje.enunciado).toContain('urge resolver');
      expect(resultado[1]?.aprendizaje.enunciado).toContain('quedó mal definido');
      // Sillas/biblioteca/presupuesto no comparte ni una palabra significativa: no aparece.
      expect(JSON.stringify(resultado)).not.toContain('sillas');

      // Orden estrictamente descendente por similitud.
      expect(resultado[0]!.similitud).toBeGreaterThan(resultado[1]!.similitud);
      // El primero comparte 7 de las 9 palabras significativas del problema (ver el cálculo en la
      // cabecera de esta prueba); léxico y auditable, no un número mágico.
      expect(resultado[0]!.similitud).toBeCloseTo(7 / 9, 9);
      expect(resultado[1]!.similitud).toBeCloseTo(4 / 9, 9);
      expect([...resultado[1]!.palabrasCoincidentes].sort()).toEqual([
        'estudio',
        'horario',
        'nocturno',
        'sala',
      ]);

      // ADR-0040: ninguna fila lleva quién escribió el aprendizaje.
      expect(JSON.stringify(resultado)).not.toMatch(/[0-9a-f]{32}.*miembro/iu);
    });

    it('limite recorta el resultado sin cambiar el orden', async () => {
      const { id } = await iniciativaConEvaluacionAbierta(
        (await entrar(e, `resp.limite.${String(n)}@udea.edu.co`)).miembroId,
      );
      await anotar(id, 'El horario nocturno de la sala de estudio cierra muy temprano.', []);
      await anotar(id, 'El horario nocturno de la sala de estudio no quedó bien definido.', []);

      const conLimite = await app.inject({
        method: 'GET',
        url:
          '/aprendizajes/parecidos?' +
          new URLSearchParams({
            titulo: 'Horario nocturno de la sala de estudio',
            limite: '1',
          }).toString(),
      });
      expect(conLimite.statusCode).toBe(200);
      expect(conLimite.json<readonly Coincidencia[]>()).toHaveLength(1);
    });

    it('la etiqueta se pasa a GET /aprendizajes: acota antes de puntuar', async () => {
      const { id } = await iniciativaConEvaluacionAbierta(
        (await entrar(e, `resp.etiqueta.${String(n)}@udea.edu.co`)).miembroId,
      );
      const marca = `marcaunica${String(n)}`;
      await anotar(id, 'El horario nocturno de la sala de estudio cierra muy temprano.', [marca]);
      await anotar(
        id,
        'El horario nocturno de la sala de estudio también afecta a quienes trabajan.',
        [],
      );

      const filtrada = await app.inject({
        method: 'GET',
        url:
          '/aprendizajes/parecidos?' +
          new URLSearchParams({
            titulo: 'Horario nocturno de la sala de estudio',
            etiqueta: marca,
          }).toString(),
      });
      expect(filtrada.statusCode, filtrada.body).toBe(200);
      const resultado = filtrada.json<readonly Coincidencia[]>();
      expect(resultado).toHaveLength(1);
      expect(resultado[0]?.aprendizaje.etiquetas).toContain(marca);
    });

    it('un problema sin nada parecido en la memoria devuelve una lista vacía, no un error', async () => {
      const sinParecido = await app.inject({
        method: 'GET',
        url:
          '/aprendizajes/parecidos?' +
          new URLSearchParams({
            titulo: 'xilofono ornitorrinco kriptonita',
            cuerpo: 'vocabulario que no aparece en ningún aprendizaje de esta suite',
          }).toString(),
      });
      expect(sinParecido.statusCode).toBe(200);
      // Ninguno de los aprendizajes anotados en esta suite comparte una sola palabra con este
      // vocabulario inventado: la lista viene vacía, no con puntajes de «tal vez».
      expect(sinParecido.json<readonly Coincidencia[]>()).toEqual([]);
    });
  });

  describe('validación', () => {
    it('un título de menos de tres caracteres es 400, no 500', async () => {
      const res = await app.inject({ method: 'GET', url: '/aprendizajes/parecidos?titulo=ss' });
      expect(res.statusCode).toBe(400);
    });

    it('sin título es 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/aprendizajes/parecidos' });
      expect(res.statusCode).toBe(400);
    });
  });
});

describe('registrarRutasDeAprendizajes sin registrarRutasDeEvaluacion: falla claro, no en silencio', () => {
  it('devuelve un error, no una lista vacía que finja que la memoria no tiene nada', async () => {
    const appAislada = Fastify();
    registrarRutasDeAprendizajes(appAislada, {});
    await appAislada.ready();
    const res = await appAislada.inject({
      method: 'GET',
      url: '/aprendizajes/parecidos?titulo=cualquier+cosa',
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('registrarRutasDeEvaluacion');
    await appAislada.close();
  });
});
