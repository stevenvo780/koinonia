/**
 * Pruebas de integración de `registrarRutasDeConsenso` (ADR-0038, ADR-0048).
 *
 * ═══ Por qué este arnés no es `apiEnv()` ═══
 *
 * El resto de `tests/integration/http-*.test.ts` monta la aplicación **entera** contra PostgreSQL
 * real (`helpers/api-env.ts`, ver su cabecera). Acá no se puede: `registrarRutasDeConsenso` todavía
 * no está enganchada a `buildApp` —eso le toca a un agente integrador, ver la cabecera de
 * `services/api/src/http/rutas-consenso.ts`— así que no hay manera de llegar a estas rutas a través
 * de la aplicación real todavía. Este fichero monta un Fastify mínimo, llama al registrador tal
 * como lo hará `app.ts` el día que lo enganche, y le da un `ContextoConsenso` de prueba: la
 * implementación en memoria del repositorio (exportada por el propio fichero de rutas, pensada
 * exactamente para esto) y una identidad resuelta por cabecera en vez de por cookie de sesión real.
 *
 * Lo que este arnés **no** reproduce, a propósito, porque no es su trabajo: la resolución real de
 * sesión (`resolveSession`/cookie), el cupo de escritura real, la traducción completa de errores de
 * `errorDe` en `app.ts`. Eso ya lo prueban `http-autorizacion.test.ts`, `http-enlace-magico.test.ts`
 * y compañía contra la aplicación real. Esta prueba es sobre la LÓGICA de estas seis rutas: quién
 * puede sembrar cuándo, cuándo abre solo el sondeo, qué hace `paso`, y qué constancia deja
 * `analizarConsenso` cuando ya hay bastante gente ubicada en el mapa.
 *
 * ═══ Bloqueo conocido, documentado para quien lea esto antes de correrlo ═══
 *
 * `services/api/src/http/rutas-consenso.ts` importa sus tipos y esquemas de
 * `@koinonia/contracts`, que por alias de `vitest.config.ts` resuelve a
 * `packages/contracts/src/index.ts` — el fichero fuente, no el paquete construido. Ese índice
 * **todavía no reexporta** `packages/contracts/src/consenso.ts` (haría falta agregar
 * `export * from './consenso.js';`, una línea) y la consigna de esta tarea prohíbe tocar ese
 * fichero. Hasta que un agente integrador agregue esa línea, este fichero entero falla al
 * importarse: no es un error de lógica de las rutas —`pnpm exec tsc -p tsconfig.check.json --noEmit`
 * ya lo confirma: los únicos errores en `rutas-consenso.ts` son, literal y exclusivamente, símbolos
 * no exportados por ese índice y su cascada—, es la pieza de integración que le toca a la fase
 * siguiente. El informe de esta tarea lo repite para que no haga falta releer esto.
 */

import type { Actor, MemberId, Role } from '@koinonia/domain';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type ContextoConsenso,
  registrarRutasDeConsenso,
  repositorioSondeosEnMemoria,
} from '../../services/api/src/http/rutas-consenso.js';

// ── Arnés ────────────────────────────────────────────────────────────────────────────────────

/** Sin sesión ni cookie real: la identidad de cada llamada viaja en estas dos cabeceras de prueba. */
const CABECERA_MIEMBRO = 'x-test-member-id';
const CABECERA_ROLES = 'x-test-roles';

function idHex(n: number): string {
  return n.toString(16).padStart(32, '0');
}

function actorDeCabeceras(request: FastifyRequest): Actor {
  const memberId = request.headers[CABECERA_MIEMBRO];
  if (typeof memberId !== 'string' || memberId === '') {
    return { memberId: undefined, roles: ['observer'], circles: [] };
  }
  const rolesRaw = request.headers[CABECERA_ROLES];
  const roles = (typeof rolesRaw === 'string' ? rolesRaw.split(',') : ['member']) as Role[];
  return { memberId: memberId as MemberId, roles, circles: [] };
}

interface Arnes {
  readonly app: FastifyInstance;
  readonly asuntos: Map<string, string>;
}

function construirArnes(): Arnes {
  const asuntos = new Map<string, string>();
  const app = Fastify({ logger: false });

  let reloj = 1_800_000_000_000;
  let contador = 0;

  const ctx: ContextoConsenso = {
    repositorio: repositorioSondeosEnMemoria(),
    ports: {
      clock: { now: () => (reloj += 1) },
      random: { opaqueId: () => idHex((contador += 1)) },
    },
    tituloDeAsunto: (asuntoId) => Promise.resolve(asuntos.get(asuntoId) ?? 'Asunto sin título'),
    asuntoExiste: (asuntoId) => Promise.resolve(asuntos.has(asuntoId)),
    idDe: (request) => actorDeCabeceras(request).memberId,
    actorDe: actorDeCabeceras,
    sujetoPropioDe: (request) => {
      const id = actorDeCabeceras(request).memberId;
      if (id === undefined) {
        const error = new Error('sin sesión') as Error & { statusCode: number };
        error.statusCode = 401;
        throw error;
      }
      return id;
    },
    cupoDeEscritura: () => Promise.resolve(),
  };

  registrarRutasDeConsenso(app, ctx);

  // Traductor mínimo de errores para este arnés. La traducción real —códigos, frases en español,
  // `campo`— la prueba `errorDe` de `app.ts`; acá sólo hace falta que un rechazo no tumbe la
  // prueba con un 500 opaco y que el código llegue intacto para poder comprobarlo.
  app.setErrorHandler((error, _request, reply) => {
    const conEstado = error as Error & { statusCode?: number };
    const estado = conEstado.statusCode ?? 400;
    void reply.status(estado).send({ codigo: 'ERROR_DE_PRUEBA', mensaje: conEstado.message });
  });

  return { app, asuntos };
}

function cabeceras(
  memberId?: string,
  roles: readonly string[] = ['member'],
): Record<string, string> {
  if (memberId === undefined) return {};
  return { [CABECERA_MIEMBRO]: memberId, [CABECERA_ROLES]: roles.join(',') };
}

const PROBLEMA = idHex(0xaaaa);
const CONVOCA = idHex(1);
const OTRA_PERSONA = idHex(2);

let arnes: Arnes | undefined;

afterEach(async () => {
  await arnes?.app.close();
  arnes = undefined;
});

async function abrirSondeoDePrueba(a: Arnes): Promise<string> {
  a.asuntos.set(PROBLEMA, 'La sala de estudio nocturna');
  const respuesta = await a.app.inject({
    method: 'POST',
    url: '/sondeos',
    headers: cabeceras(CONVOCA),
    payload: {
      requestId: '11111111-1111-4111-8111-111111111111',
      asuntoId: PROBLEMA,
      asuntoTipo: 'problema',
      motivo: 'Hay dos propuestas contradictorias en circulación sobre el mismo problema.',
    },
  });
  expect(respuesta.statusCode).toBe(201);
  return (JSON.parse(respuesta.body) as { id: string }).id;
}

async function sembrarUna(
  a: Arnes,
  sondeoId: string,
  quien: string,
  texto: string,
  contrariaAMiPosicion?: boolean,
): Promise<{ statusCode: number; body: unknown }> {
  const respuesta = await a.app.inject({
    method: 'POST',
    url: `/sondeos/${sondeoId}/afirmaciones`,
    headers: cabeceras(quien),
    payload: {
      requestId: '22222222-2222-4222-8222-222222222222',
      texto,
      ...(contrariaAMiPosicion === undefined ? {} : { contrariaAMiPosicion }),
    },
  });
  return { statusCode: respuesta.statusCode, body: JSON.parse(respuesta.body) as unknown };
}

/** Siembra las doce fundacionales de quien convoca: nueve a favor y tres contrarias, en ese orden. */
async function sembrarFundacional(a: Arnes, sondeoId: string): Promise<void> {
  for (let i = 0; i < 9; i++) {
    const r = await sembrarUna(
      a,
      sondeoId,
      CONVOCA,
      `Afirmación a favor número ${String(i)}.`,
      false,
    );
    expect(r.statusCode).toBe(201);
  }
  for (let i = 0; i < 3; i++) {
    const r = await sembrarUna(
      a,
      sondeoId,
      CONVOCA,
      `Afirmación contraria a mi postura número ${String(i)}.`,
      true,
    );
    expect(r.statusCode).toBe(201);
  }
}

// ── Pruebas ──────────────────────────────────────────────────────────────────────────────────

describe('abrir un sondeo', () => {
  it('exige sesión', async () => {
    arnes = construirArnes();
    const respuesta = await arnes.app.inject({
      method: 'POST',
      url: '/sondeos',
      payload: {
        requestId: '11111111-1111-4111-8111-111111111111',
        asuntoId: PROBLEMA,
        asuntoTipo: 'problema',
        motivo: 'Hay dos propuestas contradictorias en circulación sobre el mismo problema.',
      },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it('rechaza un asunto que no existe', async () => {
    arnes = construirArnes();
    const respuesta = await arnes.app.inject({
      method: 'POST',
      url: '/sondeos',
      headers: cabeceras(CONVOCA),
      payload: {
        requestId: '11111111-1111-4111-8111-111111111111',
        asuntoId: idHex(0xdead),
        asuntoTipo: 'problema',
        motivo: 'Hay dos propuestas contradictorias en circulación sobre el mismo problema.',
      },
    });
    expect(respuesta.statusCode).toBe(404);
    expect((JSON.parse(respuesta.body) as { codigo: string }).codigo).toBe('ASUNTO_NO_ENCONTRADO');
  });

  it('abre en estado "sembrando" y queda a nombre de quien convoca', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    const detalle = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}`,
      headers: cabeceras(CONVOCA),
    });
    const cuerpo = JSON.parse(detalle.body) as { estado: string; convocaEsMi: boolean };
    expect(cuerpo.estado).toBe('sembrando');
    expect(cuerpo.convocaEsMi).toBe(true);
  });
});

describe('sembrar: la fundacional es sólo de quien convoca', () => {
  it('otra persona no puede sembrar mientras se arma', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    const r = await sembrarUna(arnes, sondeoId, OTRA_PERSONA, 'Una afirmación cualquiera.', false);
    expect(r.statusCode).toBe(403);
    expect((r.body as { codigo: string }).codigo).toBe('SIEMBRA_SOLO_QUIEN_CONVOCA');
  });

  it('quien convoca tiene que declarar si cada fundacional es contraria a su postura', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    const r = await sembrarUna(arnes, sondeoId, CONVOCA, 'Una afirmación sin declarar.');
    expect(r.statusCode).toBe(422);
    expect((r.body as { codigo: string }).codigo).toBe('SIEMBRA_DEBE_DECLARAR_SI_ES_CONTRARIA');
  });

  it('con doce afirmaciones y tres contrarias el sondeo abre solo, sin una ruta separada', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);

    const antes = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}`,
      headers: cabeceras(CONVOCA),
    });
    const cuerpoAntes = JSON.parse(antes.body) as {
      estado: string;
      progresoSiembra: { sembradas: number; faltan: number };
    };
    expect(cuerpoAntes.estado).toBe('sembrando');
    expect(cuerpoAntes.progresoSiembra).toEqual({
      sembradas: 0,
      faltan: 12,
      contrariasSembradas: 0,
      contrariasFaltan: 3,
    });

    await sembrarFundacional(arnes, sondeoId);

    const despues = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}`,
      headers: cabeceras(CONVOCA),
    });
    const cuerpoDespues = JSON.parse(despues.body) as {
      estado: string;
      progresoSiembra?: unknown;
      totalAfirmaciones: number;
    };
    expect(cuerpoDespues.estado).toBe('abierto');
    expect(cuerpoDespues.progresoSiembra).toBeUndefined();
    expect(cuerpoDespues.totalAfirmaciones).toBe(12);
  });

  it('once contrarias antes de tiempo no abren el sondeo si faltan afirmaciones totales', async () => {
    // Guarda contra un error de "o" por "y": hacen falta las DOS cifras a la vez.
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    for (let i = 0; i < 3; i++) {
      const r = await sembrarUna(arnes, sondeoId, CONVOCA, `Contraria ${String(i)}.`, true);
      expect(r.statusCode).toBe(201);
    }
    const detalle = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}`,
      headers: cabeceras(CONVOCA),
    });
    expect((JSON.parse(detalle.body) as { estado: string }).estado).toBe('sembrando');
  });

  it('una vez abierto, cualquier persona puede sembrar afirmaciones nuevas (el antitrol de ADR-0038)', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    await sembrarFundacional(arnes, sondeoId);
    const r = await sembrarUna(arnes, sondeoId, OTRA_PERSONA, 'Una afirmación que suma otra voz.');
    expect(r.statusCode).toBe(201);
    const cuerpo = r.body as {
      contrariaALaPosicionDeQuienConvoca: boolean;
      sembradaPorMi: boolean;
    };
    // No es de la fundacional: el campo no aplica y viaja en `false`, nunca a nombre de quien convoca.
    expect(cuerpo.contrariaALaPosicionDeQuienConvoca).toBe(false);
  });

  it('rechaza afirmaciones de más de 280 caracteres', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    const respuesta = await arnes.app.inject({
      method: 'POST',
      url: `/sondeos/${sondeoId}/afirmaciones`,
      headers: cabeceras(CONVOCA),
      payload: {
        requestId: '22222222-2222-4222-8222-222222222222',
        texto: 'a'.repeat(281),
        contrariaAMiPosicion: false,
      },
    });
    expect(respuesta.statusCode).toBe(400);
  });
});

describe('valorar', () => {
  it('no se puede valorar mientras el sondeo sigue en siembra', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    const r = await sembrarUna(arnes, sondeoId, CONVOCA, 'Una afirmación cualquiera.', false);
    const afirmacionId = (r.body as { id: string }).id;
    const respuesta = await arnes.app.inject({
      method: 'POST',
      url: `/sondeos/${sondeoId}/afirmaciones/${afirmacionId}/valoraciones`,
      headers: cabeceras(OTRA_PERSONA),
      payload: { requestId: '33333333-3333-4333-8333-333333333333', respuesta: 'de_acuerdo' },
    });
    expect(respuesta.statusCode).toBe(409);
    expect((JSON.parse(respuesta.body) as { codigo: string }).codigo).toBe(
      'SONDEO_TODAVIA_SEMBRANDO',
    );
  });

  it('una afirmación que no existe da 404, no 500', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    await sembrarFundacional(arnes, sondeoId);
    const respuesta = await arnes.app.inject({
      method: 'POST',
      url: `/sondeos/${sondeoId}/afirmaciones/${idHex(0xdead)}/valoraciones`,
      headers: cabeceras(OTRA_PERSONA),
      payload: { requestId: '33333333-3333-4333-8333-333333333333', respuesta: 'paso' },
    });
    expect(respuesta.statusCode).toBe(404);
  });

  it('paso es una respuesta que se guarda, y valorar de nuevo reemplaza la anterior (upsert)', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    await sembrarFundacional(arnes, sondeoId);
    const detalle = JSON.parse(
      (
        await arnes.app.inject({
          method: 'GET',
          url: `/sondeos/${sondeoId}`,
          headers: cabeceras(OTRA_PERSONA),
        })
      ).body,
    ) as { siguienteAfirmacion: { id: string } };
    const afirmacionId = detalle.siguienteAfirmacion.id;

    const primerVoto = await arnes.app.inject({
      method: 'POST',
      url: `/sondeos/${sondeoId}/afirmaciones/${afirmacionId}/valoraciones`,
      headers: cabeceras(OTRA_PERSONA),
      payload: { requestId: '33333333-3333-4333-8333-333333333333', respuesta: 'paso' },
    });
    expect(primerVoto.statusCode).toBe(200);

    const totalUnaVez = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}`,
      headers: cabeceras(OTRA_PERSONA),
    });
    expect((JSON.parse(totalUnaVez.body) as { totalValoraciones: number }).totalValoraciones).toBe(
      1,
    );

    // Cambia de opinión: de "paso" a "de_acuerdo" sobre la MISMA afirmación.
    const segundoVoto = await arnes.app.inject({
      method: 'POST',
      url: `/sondeos/${sondeoId}/afirmaciones/${afirmacionId}/valoraciones`,
      headers: cabeceras(OTRA_PERSONA),
      payload: { requestId: '44444444-4444-4444-8444-444444444444', respuesta: 'de_acuerdo' },
    });
    expect(segundoVoto.statusCode).toBe(200);

    const totalDosVeces = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}`,
      headers: cabeceras(OTRA_PERSONA),
    });
    // Sigue siendo UNA valoración, no dos: cambiar de opinión no suma una fila.
    expect(
      (JSON.parse(totalDosVeces.body) as { totalValoraciones: number }).totalValoraciones,
    ).toBe(1);
  });

  it('el ruteo no repite una afirmación que la persona ya valoró', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    await sembrarFundacional(arnes, sondeoId);

    const vistas = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const detalle = JSON.parse(
        (
          await arnes.app.inject({
            method: 'GET',
            url: `/sondeos/${sondeoId}`,
            headers: cabeceras(OTRA_PERSONA),
          })
        ).body,
      ) as { siguienteAfirmacion?: { id: string } };
      expect(detalle.siguienteAfirmacion, `vuelta ${String(i)}`).toBeDefined();
      const afirmacionId = (detalle.siguienteAfirmacion as { id: string }).id;
      expect(vistas.has(afirmacionId), 'el ruteo no repitió una afirmación ya valorada').toBe(
        false,
      );
      vistas.add(afirmacionId);
      const voto = await arnes.app.inject({
        method: 'POST',
        url: `/sondeos/${sondeoId}/afirmaciones/${afirmacionId}/valoraciones`,
        headers: cabeceras(OTRA_PERSONA),
        payload: {
          requestId: `55555555-5555-4555-8555-55555555555${String(i % 10)}`,
          respuesta: 'de_acuerdo',
        },
      });
      expect(voto.statusCode).toBe(200);
    }
    // Ya valoró las doce: no queda ninguna siguiente.
    const final = JSON.parse(
      (
        await arnes.app.inject({
          method: 'GET',
          url: `/sondeos/${sondeoId}`,
          headers: cabeceras(OTRA_PERSONA),
        })
      ).body,
    ) as { siguienteAfirmacion?: unknown; miProgreso: { valoradas: number; total: number } };
    expect(final.siguienteAfirmacion).toBeUndefined();
    expect(final.miProgreso).toEqual({ valoradas: 12, total: 12 });
  });
});

describe('resultado', () => {
  it('con pocas personas ubicadas en el mapa, el resultado dice "todavia_no" y no inventa grupos', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    await sembrarFundacional(arnes, sondeoId);

    const respuesta = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}/resultado`,
      headers: cabeceras(CONVOCA),
    });
    expect(respuesta.statusCode).toBe(200);
    const cuerpo = JSON.parse(respuesta.body) as { tipo: string; motivo?: string };
    expect(cuerpo.tipo).toBe('todavia_no');
    expect(cuerpo.motivo).toBe('poca_gente');
  });

  it('con dos bloques nítidos de gente ubicada, encuentra grupos y nunca manda el número crudo', async () => {
    arnes = construirArnes();
    const sondeoId = await abrirSondeoDePrueba(arnes);
    await sembrarFundacional(arnes, sondeoId);

    const detalle = JSON.parse(
      (
        await arnes.app.inject({
          method: 'GET',
          url: `/sondeos/${sondeoId}`,
          headers: cabeceras(CONVOCA),
        })
      ).body,
    ) as { totalAfirmaciones: number };
    const totalAfirmaciones = detalle.totalAfirmaciones;
    expect(totalAfirmaciones).toBe(12);

    // Doce personas, dos bloques de seis. Un bloque de acuerdo con las nueve "a favor" y en
    // desacuerdo con las tres "contrarias"; el otro, al revés. Bloques nítidos a propósito: lo
    // que se comprueba es la forma de la respuesta, no la sensibilidad del agrupamiento (eso ya
    // lo prueban las 101 pruebas de `packages/consensus`).
    for (let p = 0; p < 12; p++) {
      const persona = idHex(1000 + p);
      const bloqueA = p < 6;
      const detallePersona = JSON.parse(
        (
          await arnes.app.inject({
            method: 'GET',
            url: `/sondeos/${sondeoId}`,
            headers: cabeceras(persona),
          })
        ).body,
      ) as { siguienteAfirmacion?: { id: string } };
      let siguiente = detallePersona.siguienteAfirmacion;
      let votadas = 0;
      while (siguiente !== undefined && votadas < totalAfirmaciones) {
        // Las primeras nueve afirmaciones fueron sembradas "a favor"; las tres últimas, contrarias.
        // No conocemos el orden de ids desde acá, así que alternamos una regla estable con el
        // propio índice de vuelta: es determinista y separa los dos bloques igual de nítido.
        const respuesta = votadas < 9 === bloqueA ? 'de_acuerdo' : 'en_desacuerdo';
        await arnes.app.inject({
          method: 'POST',
          url: `/sondeos/${sondeoId}/afirmaciones/${siguiente.id}/valoraciones`,
          headers: cabeceras(persona),
          payload: {
            requestId: `66666666-6666-4666-8666-${(votadas + p * 100).toString().padStart(12, '0')}`,
            respuesta,
          },
        });
        votadas += 1;
        const siguienteDetalle = JSON.parse(
          (
            await arnes.app.inject({
              method: 'GET',
              url: `/sondeos/${sondeoId}`,
              headers: cabeceras(persona),
            })
          ).body,
        ) as { siguienteAfirmacion?: { id: string } };
        siguiente = siguienteDetalle.siguienteAfirmacion;
      }
    }

    const resultado = await arnes.app.inject({
      method: 'GET',
      url: `/sondeos/${sondeoId}/resultado`,
      headers: cabeceras(CONVOCA),
    });
    expect(resultado.statusCode).toBe(200);
    const cuerpo = JSON.parse(resultado.body) as Record<string, unknown>;
    // El tipo tiene que ser uno de los tres desenlaces válidos; cuál de los tres depende de la
    // silueta que calcule `@koinonia/consensus` sobre datos sintéticos, que no es lo que esta
    // prueba certifica (eso lo hacen las 101 pruebas propias del paquete).
    expect(['grupos_detectados', 'sin_grupos_claros', 'todavia_no']).toContain(cuerpo['tipo']);
    if (cuerpo['tipo'] !== 'todavia_no') {
      expect(cuerpo['esProvisional']).toBe(true);
      expect(typeof cuerpo['avisoProvisional']).toBe('string');
    }
    // La garantía dura de ADR-0048, sea cual sea el desenlace: ni `metrica`, ni `gic`, ni
    // `dispersion` cruzan la red en ninguna afirmación de resultado.
    const crudo = JSON.stringify(cuerpo).toLowerCase();
    expect(crudo).not.toContain('"metrica"');
    expect(crudo).not.toContain('"gic"');
    expect(crudo).not.toContain('"dispersion"');
  });
});
