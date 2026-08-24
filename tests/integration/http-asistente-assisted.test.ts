/**
 * T-25 (`docs/THREAT_MODEL.md`): la marca `assisted` de punta a punta contra Fastify real.
 *
 * Fichero nuevo y separado de `http-asistente.test.ts` a propósito: ese fichero es anterior a este
 * encargo (T-25/T-19) y no está en la propiedad de escritura de esta tarea, así que esta prueba no
 * lo toca. Reutiliza el mismo patrón —Fastify real, sólo `registrarRutasDeAsistente`, persistencia
 * en memoria— para no depender de PostgreSQL.
 *
 * Lo que se prueba, y por qué es exactamente lo que promete T-25: que una respuesta escrita a mano
 * lleva `assisted: false` y que una respuesta tomada de una sugerencia de la IA lleva
 * `assisted: true`, en los dos sitios donde el borrador expone procedencia —`loQueYaEscribiste` de
 * una pregunta y `procedencia` del detalle del borrador— sin que el cliente tenga que conocer la
 * regla `origen === 'sugerencia'`.
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type AIAssistantPort,
  type AssistantEvent,
  type AssistantLog,
  type BorradorId,
  type DestinoIA,
  type MemberId,
  memberId,
  textoSugerido,
} from '@koinonia/domain';

import {
  type ContextoAsistente,
  registrarRutasDeAsistente,
} from '../../services/api/src/http/rutas-asistente.js';

const DANIELA = memberId('d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0');

interface Entorno {
  readonly app: FastifyInstance;
  readonly historiales: Map<string, AssistantLog>;
}

function crearContexto(
  opciones: { readonly puertoIA?: AIAssistantPort; readonly destinoIA?: DestinoIA } = {},
): Entorno {
  const historiales = new Map<string, AssistantLog>();
  const sesiones = new Map<string, MemberId>([['daniela', DANIELA]]);
  let reloj = 1_700_000_000_000;
  let contador = 0;

  const ctx: ContextoAsistente = {
    puertoIA: opciones.puertoIA,
    destinoIA: opciones.destinoIA,
    ahora: () => {
      reloj += 1;
      return reloj;
    },
    idOpaco: () => {
      contador += 1;
      return contador.toString(16).padStart(32, '0');
    },
    actorId: (request: FastifyRequest) => {
      const cabecera = request.headers.authorization;
      if (cabecera === undefined) return undefined;
      return sesiones.get(cabecera);
    },
    cupoDeEscritura: async () => {
      /* sin límite en la prueba */
    },
    cargarBorrador: (id: BorradorId) => Promise.resolve(historiales.get(id) ?? []),
    guardarEvento: (id: BorradorId, evento: AssistantEvent) => {
      const actual = historiales.get(id) ?? [];
      historiales.set(id, [...actual, evento]);
      return Promise.resolve();
    },
    listarPropios: () => Promise.resolve([]),
  };

  const app = Fastify();
  registrarRutasDeAsistente(app, ctx);
  return { app, historiales };
}

function puertoDePrueba(): AIAssistantPort {
  return {
    estructurar: () => Promise.reject(new Error('no usado en esta prueba')),
    resumir: () => Promise.reject(new Error('no usado en esta prueba')),
    buscarParecidos: () => Promise.reject(new Error('no usado en esta prueba')),
    senalarContradicciones: () => Promise.reject(new Error('no usado en esta prueba')),
    proponerAlternativas: () => Promise.reject(new Error('no usado en esta prueba')),
    partirEnTareas: (p) =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'partir_en_tareas',
        contenido: { tareas: [textoSugerido(`tarea a partir de: ${p.fragmento}`)] },
      }),
    explicarUnaRegla: () => Promise.reject(new Error('no usado en esta prueba')),
  };
}

const DESTINO_DE_PRUEBA: DestinoIA = {
  aDondeVa: 'Un ayudante automático externo',
  queSeManda: 'El fragmento que estás editando',
  queNoSeManda: 'Tu nombre y el resto del borrador',
  enLaMismaMaquina: false,
};

let entorno: Entorno;

afterEach(async () => {
  await entorno.app.close();
});

describe('T-25 — assisted:false en una respuesta escrita a mano', () => {
  beforeEach(() => {
    entorno = crearContexto();
  });

  it('loQueYaEscribiste y procedencia llevan `assisted: false`', async () => {
    const abierto = await entorno.app.inject({
      method: 'POST',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    const { id } = abierto.json<{ id: string }>();

    await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/respuestas`,
      headers: { authorization: 'daniela' },
      payload: { pregunta: 1, respuesta: { forma: 'frase', texto: 'algo que está pasando' } },
    });

    const ayuda = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${id}/preguntas/1`,
      headers: { authorization: 'daniela' },
    });
    expect(
      ayuda.json<{ loQueYaEscribiste?: { origen: string; assisted: boolean } }>().loQueYaEscribiste,
    ).toMatchObject({ origen: 'mano', assisted: false });

    const detalle = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${id}`,
      headers: { authorization: 'daniela' },
    });
    expect(
      detalle.json<{ procedencia: readonly { pregunta: number; assisted: boolean }[] }>()
        .procedencia,
    ).toContainEqual(expect.objectContaining({ pregunta: 1, origen: 'mano', assisted: false }));
  });
});

describe('T-25 — assisted:true en una respuesta tomada de una sugerencia de la IA', () => {
  beforeEach(() => {
    entorno = crearContexto({ puertoIA: puertoDePrueba(), destinoIA: DESTINO_DE_PRUEBA });
  });

  it('loQueYaEscribiste y procedencia llevan `assisted: true` después de aplicar una sugerencia', async () => {
    const abierto = await entorno.app.inject({
      method: 'POST',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    const { id } = abierto.json<{ id: string }>();

    await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/consentimiento`,
      headers: { authorization: 'daniela' },
      payload: { concedido: true },
    });

    const sugerida = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias`,
      headers: { authorization: 'daniela' },
      payload: { operacion: 'partir_en_tareas', pregunta: 11, fragmento: 'hay que organizarse' },
    });
    const { sugerenciaId, contenido } = sugerida.json<{
      sugerenciaId: string;
      contenido: { tareas: readonly string[] };
    }>();

    const aplicada = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias/${sugerenciaId}/aplicar`,
      headers: { authorization: 'daniela' },
      payload: { pregunta: 11, respuesta: { forma: 'lineas', lineas: [...contenido.tareas] } },
    });
    expect(aplicada.statusCode).toBe(200);
    expect(
      aplicada.json<{ loQueYaEscribiste?: { origen: string; assisted: boolean } }>()
        .loQueYaEscribiste,
    ).toMatchObject({ origen: 'sugerencia', assisted: true });

    const detalle = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${id}`,
      headers: { authorization: 'daniela' },
    });
    expect(
      detalle.json<{ procedencia: readonly { pregunta: number; assisted: boolean }[] }>()
        .procedencia,
    ).toContainEqual(
      expect.objectContaining({ pregunta: 11, origen: 'sugerencia', assisted: true }),
    );
  });
});
