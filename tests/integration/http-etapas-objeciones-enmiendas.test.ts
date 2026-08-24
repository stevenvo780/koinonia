/**
 * Pruebas de integración de `registrarRutasDeEtapas` (`services/api/src/http/rutas-etapas.ts`):
 * las etapas `objeciones` y `enmiendas` de la deliberación, alcanzadas por HTTP.
 *
 * ═══ Qué demuestra esto ═══
 *
 * `construccion_alternativas → objeciones → enmiendas → listo_para_decidir` es una cadena real de
 * `STAGE_TRANSITIONS` (`packages/domain/src/deliberation/state-machine.ts`) y las dos etapas del
 * medio tenían motor —`STAGE_RULES.objeciones` y `STAGE_RULES.enmiendas` ya declaraban qué tipo de
 * aporte cabe en cada una— pero ninguna ruta HTTP las alcanzaba con una prueba que lo demostrara:
 * `tests/integration/http-deliberacion.test.ts` avanza hasta `construccion_alternativas` y ahí se
 * detiene. Esta prueba camina la cadena completa por HTTP, escribe en las dos etapas que faltaban
 * usando las rutas nuevas, y comprueba en vivo la advertencia central del incremento: una alternativa
 * en `enmiendas` tiene DOS aristas de tipo de destino distinto —`saleDe` a POSICIONES, `corrigeA` a
 * la ALTERNATIVA que corrige— y confundirlas se rechaza, no se acomoda.
 *
 * ═══ Por qué un segundo Fastify, y no `e.app` directamente ═══
 *
 * `registrarRutasDeEtapas` todavía no está enganchada a `buildApp` —le toca a un agente integrador,
 * igual que a `registrarRutasDeConsenso` en su momento (ver la cabecera de
 * `services/api/src/http/rutas-etapas.ts`)—, así que no hay manera de llegar a
 * `POST /deliberaciones/:id/objeciones` ni `.../enmiendas` a través de `e.app`. Esta prueba monta un
 * Fastify mínimo aparte que SÍ comparte el mismo `pool` de PostgreSQL real que `e.app` —así que
 * escribe sobre el mismo agregado de deliberación—, y llama al registrador tal como lo hará
 * `app.ts` el día que lo enganche. Todo lo previo al aporte —abrir el problema, abrir la
 * deliberación, avanzar de etapa— pasa por `e.app`, que ya tiene esas rutas cableadas de verdad.
 *
 * La identidad en el Fastify nuevo viaja por dos cabeceras de prueba en vez de por el testigo real
 * (igual que `http-consenso.test.ts`, con la misma nota: la resolución real de sesión no es el
 * trabajo de este arnés, ya la prueban `http-autorizacion.test.ts` y compañía contra la app
 * entera). El `MemberId` que viaja en la cabecera es el real, devuelto por `entrar()`.
 */

import type { Actor, MemberId, Role } from '@koinonia/domain';
import { circleId as toCircleId } from '@koinonia/domain';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type ContextoEtapas,
  registrarRutasDeEtapas,
} from '../../services/api/src/http/rutas-etapas.js';

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

afterAll(async () => {
  if (env.ok) await env.stop();
});

const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';

let n = 0;
function req(): string {
  const hex = (++n + 0x7000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

// ── Arnés del segundo Fastify, para las dos rutas nuevas ──────────────────────────────────────

const CABECERA_MIEMBRO = 'x-test-member-id';

function actorDeCabeceras(request: FastifyRequest): Actor {
  const memberId = request.headers[CABECERA_MIEMBRO];
  if (typeof memberId !== 'string' || memberId === '') {
    return { memberId: undefined, roles: ['observer'], circles: [] };
  }
  return {
    memberId: memberId as MemberId,
    roles: ['member'] as Role[],
    circles: [toCircleId(CIRCULO_ESPACIOS)],
  };
}

/** Cabeceras del arnés de etapas: el `MemberId` real, sin testigo. */
function comoEtapas(miembroId: string): Record<string, string> {
  return { [CABECERA_MIEMBRO]: miembroId };
}

interface CodigoDeError {
  readonly codigo: string;
  readonly mensaje: string;
}

describe.skipIf(!env.ok)(`objeciones y enmiendas por HTTP${skipNote(env)}`, () => {
  let e: ApiListo;
  let etapas: FastifyInstance;

  let daniela: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };
  let sara: { testigo: string; miembroId: string };
  let lucia: { testigo: string; miembroId: string };

  let problemaId: string;
  let deliberacionId: string;
  let cidPostura: string;
  let cidAlt1: string;

  beforeAll(async () => {
    e = listo(env);
    daniela = await entrar(e, 'daniela.ocampo@udea.edu.co');
    julian = await entrar(e, 'julian.restrepo@udea.edu.co');
    sara = await entrar(e, 'sara.gaviria@udea.edu.co');
    lucia = await entrar(e, FACILITADORA);

    etapas = Fastify({ logger: false });
    const ctx: ContextoEtapas = {
      deps: {
        pool: e.pool,
        ports: {
          clock: { now: () => e.reloj.now() },
          random: {
            bytes: (cantidad) => e.azar.bytes(cantidad),
            opaqueId: () => e.azar.opaqueId(),
            uuid: () => e.azar.uuid(),
          },
          mailer: e.correo,
          identity: {
            nombre: 'sin-uso-en-esta-prueba',
            verify: () =>
              Promise.resolve({
                ok: false,
                code: 'CORREO_NO_INSTITUCIONAL',
                detail: 'este arnés no resuelve identidad: las sesiones ya se abrieron por e.app',
              }),
          },
          vault: e.vault,
        },
      },
      actorDe: actorDeCabeceras,
      cupoDeEscritura: () => Promise.resolve(),
      cupoDeComentario: () => Promise.resolve(),
      tituloDelProblema: async (id) => {
        const respuesta = await e.app.inject({ method: 'GET', url: `/problemas/${id}` });
        return respuesta.statusCode === 200
          ? (respuesta.json<{ titulo: string }>().titulo ?? '')
          : '';
      },
    };
    registrarRutasDeEtapas(etapas, ctx);

    // Traductor mínimo: sólo hace falta que un rechazo no tumbe la prueba con un 500 opaco y que
    // el código de dominio llegue intacto. La traducción completa a estado HTTP y frase en
    // castellano es trabajo de `errorDe` en `app.ts`, y eso ya lo prueba el resto de la suite.
    etapas.setErrorHandler((error, _request, reply) => {
      const conCodigo = error as Error & {
        name: string;
        code?: string;
        codigo?: string;
        estado?: number;
      };
      if (conCodigo.name === 'ZodError') {
        void reply.status(400).send({ codigo: 'VALIDATION_ERROR', mensaje: conCodigo.message });
        return;
      }
      const codigo = conCodigo.codigo ?? conCodigo.code ?? 'ERROR_DE_PRUEBA';
      const estado = conCodigo.estado ?? 422;
      void reply.status(estado).send({ codigo, mensaje: conCodigo.message });
    });
    await etapas.ready();

    // ═══ Arma el problema y la deliberación con la app REAL, que ya tiene esas rutas ═══
    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        titulo: 'La cafetería del segundo piso no tiene señal para pagar con tarjeta',
        cuerpo:
          'Desde hace un semestre el datáfono no conecta y sólo se puede pagar en efectivo, lo que ' +
          'deja afuera a quien no carga plata en la billetera.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);
    problemaId = problema.json<{ id: string }>().id;

    const deliberacion = await e.app.inject({
      method: 'POST',
      url: '/deliberaciones',
      headers: como(lucia.testigo),
      payload: { requestId: req(), problemaId, duracionHoras: 48 },
    });
    expect(deliberacion.statusCode, deliberacion.body).toBe(201);
    deliberacionId = deliberacion.json<{ id: string; etapa: string }>().id;
    expect(deliberacion.json<{ etapa: string }>().etapa).toBe('preguntas_aclaratorias');
  });

  afterAll(async () => {
    await etapas.close();
  });

  it('preguntas_aclaratorias → perspectivas → construccion_alternativas, con lo mínimo para poder objetar y enmendar', async () => {
    // Una pregunta aclaratoria.
    const pregunta = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/aportes`,
      headers: como(sara.testigo),
      payload: {
        requestId: req(),
        tipo: 'posicion',
        modo: 'pregunta_aclaratoria',
        texto: '¿Alguien ya reportó el datáfono dañado a la administración del edificio?',
      },
    });
    expect(pregunta.statusCode, pregunta.body).toBe(201);
    const trasPregunta = pregunta.json<{
      aportes: { id: string; comoSeLlama: string; vigente: boolean }[];
    }>();
    expect(trasPregunta.aportes.find((a) => a.comoSeLlama === 'Pregunta')).toBeDefined();

    // Avanza a perspectivas (ruta genérica ya existente).
    const avance1 = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/etapa`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(avance1.statusCode, avance1.body).toBe(200);
    expect(avance1.json<{ etapa: string }>().etapa).toBe('perspectivas');

    // Una postura, que es de la que va a salir la alternativa.
    const postura = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/aportes`,
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        tipo: 'posicion',
        modo: 'afirmacion',
        texto: 'Sin datáfono, la cafetería excluye a quien vive sólo con transferencias.',
      },
    });
    expect(postura.statusCode, postura.body).toBe(201);
    const trasPostura = postura.json<{
      aportes: { id: string; comoSeLlama: string; vigente: boolean }[];
    }>();
    cidPostura = trasPostura.aportes.find((a) => a.comoSeLlama === 'Postura')!.id;

    // Avanza a construcción de alternativas.
    const avance2 = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/etapa`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(avance2.statusCode, avance2.body).toBe(200);
    expect(avance2.json<{ etapa: string }>().etapa).toBe('construccion_alternativas');

    // Una alternativa que sale de la postura de Daniela.
    const alternativa = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/aportes`,
      headers: como(daniela.testigo),
      payload: {
        requestId: req(),
        tipo: 'alternativa',
        problemaId,
        saleDe: [cidPostura],
        texto:
          'Instalar un datáfono nuevo con plan de datos propio, sin depender del wifi del edificio.',
      },
    });
    expect(alternativa.statusCode, alternativa.body).toBe(201);
    const trasAlternativa = alternativa.json<{
      aportes: { id: string; comoSeLlama: string; vigente: boolean }[];
    }>();
    cidAlt1 = trasAlternativa.aportes.find((a) => a.comoSeLlama === 'Salida propuesta')!.id;

    // Avanza a objeciones. Es ACÁ donde la ruta genérica de escritura deja de alcanzar y empiezan
    // las rutas de este incremento.
    const avance3 = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/etapa`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(avance3.statusCode, avance3.body).toBe(200);
    expect(avance3.json<{ etapa: string }>().etapa).toBe('objeciones');
  });

  it('en objeciones, un tipo que no cabe (alternativa) se rechaza en el borde, sin tocar el motor', async () => {
    const respuesta = await etapas.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/objeciones`,
      headers: comoEtapas(julian.miembroId),
      payload: {
        requestId: req(),
        tipo: 'alternativa',
        problemaId,
        saleDe: [cidPostura],
        texto: 'Esto no debería ni compilar contra el contrato de objeciones.',
      },
    });
    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<CodigoDeError>().codigo).toBe('VALIDATION_ERROR');
  });

  it('en objeciones, un riesgo de la alternativa se escribe por la ruta nueva', async () => {
    const respuesta = await etapas.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/objeciones`,
      headers: comoEtapas(julian.miembroId),
      payload: {
        requestId: req(),
        tipo: 'riesgo',
        salidaId: cidAlt1,
        gravedad: 3,
        impacto: 'El plan de datos propio tiene un costo mensual que nadie presupuestó todavía.',
        mitigacion: 'Cotizar tres proveedores antes de instalar nada, y traerlo a la enmienda.',
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);
    const detalle = respuesta.json<{
      etapa: string;
      aportes: { id: string; comoSeLlama: string; vigente: boolean }[];
    }>();
    expect(detalle.etapa).toBe('objeciones');
    const riesgo = detalle.aportes.find((a) => a.comoSeLlama === 'Riesgo');
    expect(riesgo).toBeDefined();
    expect(riesgo?.vigente).toBe(true);
  });

  it('todavía en objeciones, la ruta de enmiendas se rechaza: la etapa vigente no es esa', async () => {
    // Se manda por adelantado, ANTES de avanzar, para comprobar que la ruta nueva no acepta nada
    // que el motor no acepte: la etapa vigente decide, no la URL a la que se llamó.
    const respuesta = await etapas.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/enmiendas`,
      headers: comoEtapas(daniela.miembroId),
      payload: {
        requestId: req(),
        tipo: 'alternativa',
        problemaId,
        saleDe: [cidPostura],
        texto:
          'Instalar un datáfono nuevo con batería propia, para no depender de la toma eléctrica.',
        corrigeA: cidAlt1,
      },
    });
    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json<CodigoDeError>().codigo).toBe('CONTRIBUTION_KIND_NOT_ALLOWED');
  });

  it('avanza a enmiendas (ruta genérica)', async () => {
    const avance = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/etapa`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(avance.statusCode, avance.body).toBe(200);
    expect(avance.json<{ etapa: string }>().etapa).toBe('enmiendas');
  });

  it('LA CONFUSIÓN QUE NO SE PUEDE COLAR: saleDe apuntando a la alternativa que se corrige, en vez de a las posiciones de origen', async () => {
    // Exactamente el error que la cabecera del fichero de rutas describe: `saleDe` con el id de la
    // alternativa que `corrigeA` ya nombra, en vez del id de una posición. El motor lo distingue por
    // el TIPO del destino (`WRONG_REFERENCE_KIND` en `packages/domain/src/deliberation/graph.ts`),
    // no por casualidad.
    const respuesta = await etapas.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/enmiendas`,
      headers: comoEtapas(daniela.miembroId),
      payload: {
        requestId: req(),
        tipo: 'alternativa',
        problemaId,
        saleDe: [cidAlt1], // ✗ la alternativa que se corrige, no una posición
        texto:
          'Instalar un datáfono nuevo con batería propia, para no depender de la toma eléctrica.',
        corrigeA: cidAlt1,
      },
    });
    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json<CodigoDeError>().codigo).toBe('WRONG_REFERENCE_KIND');
  });

  it('en enmiendas, una alternativa sin corrigeA no compila contra el contrato (aristas obligatorias)', async () => {
    const respuesta = await etapas.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/enmiendas`,
      headers: comoEtapas(daniela.miembroId),
      payload: {
        requestId: req(),
        tipo: 'alternativa',
        problemaId,
        saleDe: [cidPostura],
        texto: 'Una alternativa nueva disfrazada de enmienda, sin decir a cuál corrige.',
        // sin `corrigeA`: el tipo de `enmienda` (a diferencia de `aportar` genérico) lo exige.
      },
    });
    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json<CodigoDeError>().codigo).toBe('VALIDATION_ERROR');
  });

  it('en enmiendas, saleDe correcto (a la posición) y corrigeA correcto (a la alternativa) se escriben, y el original sigue en el historial pero deja de ser vigente', async () => {
    const respuesta = await etapas.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/enmiendas`,
      headers: comoEtapas(daniela.miembroId),
      payload: {
        requestId: req(),
        tipo: 'alternativa',
        problemaId,
        saleDe: [cidPostura], // ✓ la posición de la que sale
        texto:
          'Instalar un datáfono nuevo con batería propia, para no depender de la toma eléctrica.',
        corrigeA: cidAlt1, // ✓ la alternativa que corrige
      },
    });
    expect(respuesta.statusCode, respuesta.body).toBe(201);
    const detalle = respuesta.json<{
      etapa: string;
      aportes: { id: string; comoSeLlama: string; vigente: boolean; corrigeA?: string }[];
    }>();
    expect(detalle.etapa).toBe('enmiendas');

    const original = detalle.aportes.find((a) => a.id === cidAlt1);
    expect(original).toBeDefined();
    expect(original?.vigente).toBe(false); // sigue en el historial, pero ya no es la punta

    const enmienda = detalle.aportes.find(
      (a) => a.comoSeLlama === 'Salida propuesta' && a.id !== cidAlt1,
    );
    expect(enmienda).toBeDefined();
    expect(enmienda?.vigente).toBe(true);
    expect(enmienda?.corrigeA).toBe(cidAlt1);
  });

  it('corregir la alternativa de otra persona se rechaza: sólo quien la escribió la corrige', async () => {
    const respuesta = await etapas.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/enmiendas`,
      headers: comoEtapas(julian.miembroId), // la alternativa cidAlt1 es de Daniela
      payload: {
        requestId: req(),
        tipo: 'alternativa',
        problemaId,
        saleDe: [cidPostura],
        texto: 'Julián intenta corregir la alternativa de Daniela.',
        corrigeA: cidAlt1,
      },
    });
    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json<CodigoDeError>().codigo).toBe('SUPERSEDES_ANOTHER_AUTHOR');
  });
});
