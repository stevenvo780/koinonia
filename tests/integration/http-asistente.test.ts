/**
 * El asistente de acción sistémica (ADR-0052), de punta a punta contra Fastify real.
 *
 * ═══ Por qué esta prueba no usa `apiEnv()` ═══
 *
 * `helpers/api-env.ts` levanta `buildApp` completo contra PostgreSQL real, y es lo correcto para
 * las rutas que ya viven en `services/api/src/http/app.ts`. Las de este fichero **todavía no están
 * ahí** —la integración es la fase siguiente, según el propio encargo—, así que esta prueba monta su
 * propia instancia de Fastify, registra sólo `registrarRutasDeAsistente` y le da un
 * `ContextoAsistente` en memoria. Es una prueba de integración igual: pasa por HTTP de verdad
 * (`app.inject`), por Zod de verdad y por el dominio de verdad —nada de esto se simula—; lo único que
 * se sustituye es la persistencia, que en producción sería PostgreSQL y aquí es un `Map`.
 *
 * El `ContextoAsistente` de prueba hace las veces del `agente integrador`: así queda demostrado que
 * la interfaz que declara `rutas-asistente.ts` es implementable con datos simples, sin nada del
 * `app.ts` real.
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type AIAssistantPort,
  type AssistantEvent,
  type AssistantLog,
  type BorradorId,
  borradorId,
  type DestinoIA,
  type MemberId,
  memberId,
  textoSugerido,
} from '@koinonia/domain';

import {
  type ContextoAsistente,
  registrarRutasDeAsistente,
} from '../../services/api/src/http/rutas-asistente.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El doble en memoria de lo que en producción sería PostgreSQL + sesión + cupo de escritura
// ═════════════════════════════════════════════════════════════════════════════════════════════

const DANIELA = memberId('d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0');
const JULIAN = memberId('1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a');

interface Entorno {
  readonly app: FastifyInstance;
  readonly ctx: ContextoAsistente;
  readonly historiales: Map<string, AssistantLog>;
}

function crearContexto(
  opciones: {
    readonly puertoIA?: AIAssistantPort;
    readonly destinoIA?: DestinoIA;
  } = {},
): Entorno {
  const historiales = new Map<string, AssistantLog>();
  const sesiones = new Map<string, MemberId>([
    ['daniela', DANIELA],
    ['julian', JULIAN],
  ]);
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
    // Sin `async`: no hay ningún `await` real en estos tres (el `Map` es síncrono), y
    // `@typescript-eslint/require-await` lo señala. `Promise.resolve` conserva el tipo `Promise<T>`
    // que exige `ContextoAsistente` sin fingir una asincronía que no existe.
    cargarBorrador: (id: BorradorId) => Promise.resolve(historiales.get(id) ?? []),
    guardarEvento: (id: BorradorId, evento: AssistantEvent) => {
      const actual = historiales.get(id) ?? [];
      historiales.set(id, [...actual, evento]);
      return Promise.resolve();
    },
    listarPropios: (actor: MemberId) => {
      const propios: BorradorId[] = [];
      for (const [id, log] of historiales) {
        const primero = log[0];
        if (primero !== undefined && primero.actor === actor) propios.push(borradorId(id));
      }
      return Promise.resolve(propios);
    },
  };

  const app = Fastify();
  registrarRutasDeAsistente(app, ctx);
  return { app, ctx, historiales };
}

/** Un puerto de IA de prueba: cada operación devuelve texto trazable a la operación pedida. */
function puertoDePrueba(): AIAssistantPort {
  return {
    estructurar: (p) =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'estructurar',
        contenido: {
          tramos: [{ pregunta: 2, texto: textoSugerido(`${p.fragmento} — estructurado`) }],
        },
      }),
    resumir: (p) =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'resumir',
        contenido: { resumen: textoSugerido(`resumen: ${p.fragmento}`) },
      }),
    buscarParecidos: () =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'buscar_parecidos',
        contenido: { parecidos: [] },
      }),
    senalarContradicciones: () =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'senalar_contradicciones',
        contenido: { tensiones: [] },
      }),
    proponerAlternativas: (p) =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'proponer_alternativas',
        contenido: { alternativas: [textoSugerido(`otra forma: ${p.fragmento}`)] },
      }),
    partirEnTareas: () =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'partir_en_tareas',
        contenido: { tareas: [textoSugerido('convocar una reunión')] },
      }),
    explicarUnaRegla: () =>
      Promise.resolve({
        clase: 'sugerencia',
        operacion: 'explicar_una_regla',
        contenido: { explicacion: textoSugerido('esto es lo que hace la regla') },
      }),
  };
}

const DESTINO_DE_PRUEBA: DestinoIA = {
  aDondeVa: 'Un ayudante automático externo',
  queSeManda: 'El fragmento que estás editando',
  queNoSeManda: 'Tu nombre y el resto del borrador',
  enLaMismaMaquina: false,
};

// ═════════════════════════════════════════════════════════════════════════════════════════════

let entorno: Entorno;

afterEach(async () => {
  await entorno.app.close();
});

describe('catálogo de preguntas', () => {
  beforeEach(() => {
    entorno = crearContexto();
  });

  it('GET /asistente/preguntas no exige sesión y da las 27, con la 1 y la 27 literales', async () => {
    const res = await entorno.app.inject({ method: 'GET', url: '/asistente/preguntas' });
    expect(res.statusCode).toBe(200);
    const preguntas =
      res.json<readonly { numero: number; texto: string; obligatoria: boolean }[]>();
    expect(preguntas).toHaveLength(27);
    expect(preguntas[0]).toMatchObject({
      numero: 1,
      obligatoria: true,
      texto: 'En una frase: ¿qué está pasando que no debería estar pasando?',
    });
    expect(preguntas[26]).toMatchObject({
      numero: 27,
      texto: '¿Alguien ya intentó algo parecido acá? ¿Sabés qué pasó?',
    });
    // Sólo la 1 y la 11 son obligatorias.
    expect(preguntas.filter((p) => p.obligatoria).map((p) => p.numero)).toEqual([1, 11]);
  });
});

describe('empezar, contestar y cerrar (modo sin IA, el que funciona sin ningún proveedor)', () => {
  beforeEach(() => {
    entorno = crearContexto();
  });

  it('sin sesión, abrir un borrador da 401 y no escribe nada', async () => {
    const res = await entorno.app.inject({ method: 'POST', url: '/asistente/borradores' });
    expect(res.statusCode).toBe(401);
    expect(entorno.historiales.size).toBe(0);
  });

  it('abre, muestra modo estructural, contesta la 1 y la 11 y cierra', async () => {
    const abierto = await entorno.app.inject({
      method: 'POST',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    expect(abierto.statusCode).toBe(201);
    const detalle = abierto.json<{
      id: string;
      estado: string;
      modo: string;
      puedeCerrarse: boolean;
    }>();
    expect(detalle.estado).toBe('redactando');
    expect(detalle.modo).toBe('estructural');
    expect(detalle.puedeCerrarse).toBe(false);
    const id = detalle.id;

    // Retomar: la ayuda de la pregunta 1 antes de contestar nada.
    const ayuda1 = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${id}/preguntas/1`,
      headers: { authorization: 'daniela' },
    });
    expect(ayuda1.statusCode).toBe(200);
    const cuerpoAyuda1 = ayuda1.json<{
      loQueYaEscribiste?: unknown;
      porQueNoHaySugerencias?: string;
    }>();
    expect(cuerpoAyuda1.loQueYaEscribiste).toBeUndefined();
    expect(cuerpoAyuda1.porQueNoHaySugerencias).toContain('ayudante automático');

    // Cerrar sin las obligatorias se rechaza, y dice cuáles faltan.
    const cierreTemprano = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/cerrar`,
      headers: { authorization: 'daniela' },
    });
    expect(cierreTemprano.statusCode).toBe(422);
    expect(cierreTemprano.json<{ codigo: string }>().codigo).toBe('MANDATORY_ANSWERS_MISSING');

    // Contestar la 1.
    const r1 = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/respuestas`,
      headers: { authorization: 'daniela' },
      payload: {
        pregunta: 1,
        respuesta: {
          forma: 'frase',
          texto: 'La sala de estudio cierra a las cinco y no alcanzamos.',
        },
      },
    });
    expect(r1.statusCode).toBe(201);

    // Contestar la 11 (lista).
    const r11 = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/respuestas`,
      headers: { authorization: 'daniela' },
      payload: {
        pregunta: 11,
        respuesta: { forma: 'lineas', lineas: ['convocar una reunión', 'redactar una nota'] },
      },
    });
    expect(r11.statusCode).toBe(201);

    // El detalle ya puede cerrarse y la frase ya no tiene esos dos huecos.
    const detalleListo = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${id}`,
      headers: { authorization: 'daniela' },
    });
    const cuerpoListo = detalleListo.json<{
      puedeCerrarse: boolean;
      frase: { huecos: readonly number[] };
      procedencia: readonly { pregunta: number; origen: string }[];
    }>();
    expect(cuerpoListo.puedeCerrarse).toBe(true);
    expect(cuerpoListo.frase.huecos).not.toContain(1);
    expect(cuerpoListo.frase.huecos).not.toContain(11);
    expect(cuerpoListo.procedencia).toContainEqual(
      expect.objectContaining({ pregunta: 1, origen: 'mano' }),
    );

    // «Todavía no sé» en una pregunta no obligatoria: se acepta y no cuenta como respondida.
    const noSe = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/respuestas`,
      headers: { authorization: 'daniela' },
      payload: { pregunta: 3, respuesta: { forma: 'todavia_no_se' } },
    });
    expect(noSe.statusCode).toBe(201);

    // Cerrar.
    const cierre = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/cerrar`,
      headers: { authorization: 'daniela' },
    });
    expect(cierre.statusCode).toBe(200);
    const cuerpoCierre = cierre.json<{ estado: string; cerradoEn?: number }>();
    expect(cuerpoCierre.estado).toBe('cerrado');
    expect(cuerpoCierre.cerradoEn).toBeDefined();

    // Retomar la lista propia: aparece, con el resumen correcto.
    const propios = await entorno.app.inject({
      method: 'GET',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    const listaPropios = propios.json<readonly { id: string; estado: string }[]>();
    expect(listaPropios.map((b) => b.id)).toContain(id);
    expect(listaPropios.find((b) => b.id === id)?.estado).toBe('cerrado');

    // Julián no tiene ninguno.
    const propiosDeJulian = await entorno.app.inject({
      method: 'GET',
      url: '/asistente/borradores',
      headers: { authorization: 'julian' },
    });
    expect(propiosDeJulian.json()).toEqual([]);
  });

  it('el borrador de otra persona da 403 al verlo y al escribir en él', async () => {
    const abierto = await entorno.app.inject({
      method: 'POST',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    const { id } = abierto.json<{ id: string }>();

    const verAjeno = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${id}`,
      headers: { authorization: 'julian' },
    });
    expect(verAjeno.statusCode).toBe(403);

    const escribirAjeno = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/respuestas`,
      headers: { authorization: 'julian' },
      payload: { pregunta: 1, respuesta: { forma: 'frase', texto: 'algo' } },
    });
    expect(escribirAjeno.statusCode).toBe(403);
  });

  it('un borrador que no existe da 404, no 500 ni un error crudo del dominio', async () => {
    const res = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${'a'.repeat(32)}`,
      headers: { authorization: 'daniela' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ codigo: string }>().codigo).toBe('NO_ENCONTRADO');
  });

  it('la 7 exige tantas casillas como líneas tenga la 6 (por_linea)', async () => {
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
      payload: { pregunta: 6, respuesta: { forma: 'lineas', lineas: ['nadie avisa con tiempo'] } },
    });

    const desalineada = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/respuestas`,
      headers: { authorization: 'daniela' },
      payload: {
        pregunta: 7,
        respuesta: { forma: 'por_linea', porLinea: ['lo vi', 'me lo contaron'] },
      },
    });
    expect(desalineada.statusCode).toBe(409);
    expect(desalineada.json<{ codigo: string }>().codigo).toBe('LINE_COUNT_MISMATCH');

    const alineada = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/respuestas`,
      headers: { authorization: 'daniela' },
      payload: { pregunta: 7, respuesta: { forma: 'por_linea', porLinea: ['lo vi'] } },
    });
    expect(alineada.statusCode).toBe(201);
  });
});

describe('con un proveedor de IA configurado: consentimiento, sugerencias y procedencia', () => {
  beforeEach(() => {
    entorno = crearContexto({ puertoIA: puertoDePrueba(), destinoIA: DESTINO_DE_PRUEBA });
  });

  it('sin consentimiento, pedir una sugerencia se rechaza con AI_NOT_AVAILABLE', async () => {
    const abierto = await entorno.app.inject({
      method: 'POST',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    const { id, modo } = abierto.json<{ id: string; modo: string }>();
    expect(modo).toBe('estructural');

    const res = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias`,
      headers: { authorization: 'daniela' },
      payload: { operacion: 'resumir', fragmento: 'un fragmento cualquiera' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ codigo: string }>().codigo).toBe('AI_NOT_AVAILABLE');
  });

  it('con consentimiento: pedir, aplicar y que la procedencia diga "sugerencia"', async () => {
    const abierto = await entorno.app.inject({
      method: 'POST',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    const { id } = abierto.json<{ id: string }>();

    const consentido = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/consentimiento`,
      headers: { authorization: 'daniela' },
      payload: { concedido: true },
    });
    expect(consentido.statusCode).toBe(200);
    expect(consentido.json<{ modo: string }>().modo).toBe('generativo');

    const sugerida = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias`,
      headers: { authorization: 'daniela' },
      payload: {
        operacion: 'partir_en_tareas',
        pregunta: 11,
        fragmento: 'necesitamos organizar esto',
      },
    });
    expect(sugerida.statusCode).toBe(201);
    const cuerpoSugerida = sugerida.json<{
      sugerenciaId: string;
      operacion: string;
      contenido: { tareas: readonly string[] };
    }>();
    expect(cuerpoSugerida.operacion).toBe('partir_en_tareas');
    expect(cuerpoSugerida.contenido.tareas).toEqual(['convocar una reunión']);

    // Aplicar un texto que NO estaba en la sugerencia se rechaza.
    const aplicarFalso = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias/${cuerpoSugerida.sugerenciaId}/aplicar`,
      headers: { authorization: 'daniela' },
      payload: {
        pregunta: 11,
        respuesta: { forma: 'lineas', lineas: ['esto no lo propuso nadie'] },
      },
    });
    expect(aplicarFalso.statusCode).toBe(422);
    expect(aplicarFalso.json<{ codigo: string }>().codigo).toBe('TEXT_NOT_IN_SUGGESTION');

    // Aplicar el texto que sí propuso queda con procedencia "sugerencia".
    const aplicada = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias/${cuerpoSugerida.sugerenciaId}/aplicar`,
      headers: { authorization: 'daniela' },
      payload: { pregunta: 11, respuesta: { forma: 'lineas', lineas: ['convocar una reunión'] } },
    });
    expect(aplicada.statusCode).toBe(200);
    expect(
      aplicada.json<{ loQueYaEscribiste?: { origen: string } }>().loQueYaEscribiste?.origen,
    ).toBe('sugerencia');

    const detalle = await entorno.app.inject({
      method: 'GET',
      url: `/asistente/borradores/${id}`,
      headers: { authorization: 'daniela' },
    });
    const cuerpoDetalle = detalle.json<{
      sugerencias: readonly { sugerenciaId: string }[];
      aplicadas: readonly string[];
    }>();
    expect(cuerpoDetalle.sugerencias).toHaveLength(1);
    expect(cuerpoDetalle.aplicadas).toEqual([cuerpoSugerida.sugerenciaId]);

    // Aplicar la misma sugerencia una segunda vez se rechaza.
    const segundaVez = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias/${cuerpoSugerida.sugerenciaId}/aplicar`,
      headers: { authorization: 'daniela' },
      payload: { pregunta: 11, respuesta: { forma: 'lineas', lineas: ['convocar una reunión'] } },
    });
    expect(segundaVez.statusCode).toBe(409);
    expect(segundaVez.json<{ codigo: string }>().codigo).toBe('SUGGESTION_ALREADY_APPLIED');
  });

  it('negar el consentimiento degrada a estructural sin penalización y no se vuelve a insistir', async () => {
    const abierto = await entorno.app.inject({
      method: 'POST',
      url: '/asistente/borradores',
      headers: { authorization: 'daniela' },
    });
    const { id } = abierto.json<{ id: string }>();

    const negado = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/consentimiento`,
      headers: { authorization: 'daniela' },
      payload: { concedido: false },
    });
    expect(negado.statusCode).toBe(200);
    const cuerpoNegado = negado.json<{
      modo: string;
      sePuedePedirConsentimiento: boolean;
      motivoEstructural?: string;
    }>();
    expect(cuerpoNegado.modo).toBe('estructural');
    expect(cuerpoNegado.sePuedePedirConsentimiento).toBe(false);
    expect(cuerpoNegado.motivoEstructural).toBe('consentimiento_negado');

    const sinIgual = await entorno.app.inject({
      method: 'POST',
      url: `/asistente/borradores/${id}/sugerencias`,
      headers: { authorization: 'daniela' },
      payload: { operacion: 'resumir', fragmento: 'x' },
    });
    expect(sinIgual.statusCode).toBe(409);
  });
});
