/**
 * El catálogo de los once métodos, expuesto por HTTP, contra PostgreSQL real.
 *
 * El motor (`@koinonia/domain`) ya implementa los once; este incremento cierra la frontera para
 * que la pantalla los pueda elegir desde un único `GET /metodos` y armar la papeleta correcta
 * según la forma declarada por el catálogo.
 *
 * Usa `app.inject` (como el resto de `tests/integration`), no `fetch` contra un puerto real: este
 * entorno de prueba no levanta un servidor HTTP escuchando, sólo la instancia de Fastify.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  apiEnv,
  type ApiListo,
  como,
  entrar,
  FACILITADORA,
  listo,
  planDe,
  skipNote,
} from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`catálogo de métodos por HTTP${skipNote(env)}`, () => {
  it('sirve los once métodos con nombre, descripción, papeleta y delegación', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'GET',
      url: '/metodos',
      headers: como(sesion.testigo),
    });
    expect(res.statusCode).toBe(200);
    const cuerpo = res.json<
      Array<{
        id: string;
        nombre: string;
        descripcion: string;
        formasPapeleta: string[];
        delegacionPermitida: boolean;
      }>
    >();
    expect(cuerpo).toHaveLength(11);

    const ids = cuerpo.map((m) => m.id);
    expect(ids).toEqual([
      'simple-majority',
      'supermajority',
      'unanimity',
      'sociocratic-consent',
      'score',
      'irv',
      'majority-judgment',
      'condorcet-schulze',
      'deliberative-sortition',
      'advice-process',
      'consensus',
    ]);
  });

  it('GET /metodos no requiere sesión y devuelve no-store', async () => {
    const e = listo(env);
    const res = await e.app.inject({ method: 'GET', url: '/metodos' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('consentimiento, sorteo, proceso de consejo y consenso declaran delegación prohibida', async () => {
    const e = listo(env);
    const res = await e.app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<Array<{ id: string; delegacionPermitida: boolean }>>();
    const sinDelegacion = cuerpo.filter((m) => !m.delegacionPermitida).map((m) => m.id);
    // El proceso de consejo tampoco la admite: un consejo se da o no se da, no se presta; y quien
    // decide, menos todavía — delegar la decisión sería otro método, no éste.
    expect(sinDelegacion.sort()).toEqual(
      ['advice-process', 'consensus', 'deliberative-sortition', 'sociocratic-consent'].sort(),
    );
  });

  it('la papeleta coincide con la forma declarada en el catálogo', async () => {
    const e = listo(env);
    const res = await e.app.inject({ method: 'GET', url: '/metodos' });
    const cuerpo = res.json<Array<{ id: string; formasPapeleta: string[] }>>();
    const esperado: Readonly<Record<string, string>> = {
      'simple-majority': 'binaria',
      supermajority: 'binaria',
      unanimity: 'binaria',
      'sociocratic-consent': 'consentimiento',
      score: 'puntuacion',
      irv: 'ordenamiento',
      'majority-judgment': 'menciones',
      'condorcet-schulze': 'ordenamiento',
      'deliberative-sortition': 'sorteo',
      'advice-process': 'consejo',
      consensus: 'consenso',
    };
    for (const m of cuerpo) {
      expect(m.formasPapeleta[0]).toBe(esperado[m.id]);
    }
  });

  it('rechaza POST /decisiones con método desconocido (validación de frontera)', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '11111111-2222-4333-8444-555555555555',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'no-existe',
        duracionHoras: 24,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza POST /decisiones con configuración incompatible con el método', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '22222222-3333-4444-8555-666666666666',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'simple-majority',
        configuracion: {
          metodo: 'supermajority',
          fraccion: { numerador: 3, denominador: 4 },
        },
        duracionHoras: 24,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza delegación habilitada en métodos que no la admiten', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '33333333-4444-4555-8666-777777777777',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'sociocratic-consent',
        delegacion: true,
        duracionHoras: 24,
      },
    });
    expect(res.statusCode).toBe(409);
    const cuerpo = res.json<{ codigo: string }>();
    expect(cuerpo.codigo).toBe('DELEGACION_NO_ADMITIDA');
  });

  it('acepta POST /decisiones con método y configuración válidos', async () => {
    const e = listo(env);
    const sesion = await entrar(e, FACILITADORA);
    const res = await e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(sesion.testigo),
      payload: {
        requestId: '44444444-5555-4666-8777-888888888888',
        propuestaId: '00000000000000000000000000000000',
        metodo: 'supermajority',
        configuracion: {
          metodo: 'supermajority',
          fraccion: { numerador: 3, denominador: 4 },
        },
        duracionHoras: 24,
      },
    });
    // 404 porque la propuesta no existe; lo importante es que NO dio 400 (validó el método).
    expect(res.statusCode).not.toBe(400);
  });
});
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Los cuatro que comparan opciones: el servidor se niega a abrirlos, no sólo la pantalla.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Puntuación, voto por rondas, valoración por menciones y comparación por pares están implementados
 * y probados en el motor (`packages/domain/src/tally/`), y su papeleta ya cruza la red. Lo que no se
 * puede es ABRIR una votación con ellos, y este bloque prueba que el servidor lo impide.
 *
 * ═══ Por qué existe este bloque, y qué probaba antes ═══
 *
 * Antes probaba lo contrario: abría las cuatro por HTTP, votaba, cerraba, y comprobaba que el
 * desenlace saliera `approved`. Estaba escrito a sabiendas —su cabecera decía «el SERVIDOR nunca
 * tuvo ese candado: siempre aceptó abrir con cualquiera de los que hubiera»— y fijaba como conducta
 * esperada un defecto de verdad, que un revisor reprodujo de punta a punta contra PostgreSQL real:
 * abrió una decisión de valoración por menciones saltándose la pantalla, los CUATRO votantes
 * mandaron la mención más baja —«rechazar»—, y el cierre devolvió `"desenlace":"approved"`.
 *
 * El escrutinio no estaba mal. `abrirDecision` congela `options: [optionId(propuestaId)]` — SIEMPRE
 * una sola opción, la propuesta misma. Con una sola opción, «cuál gana» deja de ser una pregunta:
 * los cuatro contestan que gana la única que hay, y de ahí sale `approved`. Lo que no significaba
 * nada era la comparación, no el conteo.
 *
 * La regla vivía sólo en `apps/web/app/decisiones/metodos-en-palabras.ts` (`sePuedeAbrirHoy`), o
 * sea sólo en el navegador. Una regla que sólo aplica el navegador no es una regla: es una
 * sugerencia, y quien llame a la API se la salta — que es exactamente cómo se reprodujo. Ahora la
 * guarda está en `validateDecisionConfig` (`MULTI_METHOD_NEEDS_TWO_OPTIONS`), que es por donde pasa
 * todo el que abra, venga de donde venga.
 *
 * ═══ Lo que se dejó de cubrir, dicho en voz alta ═══
 *
 * Con esto ya no hay forma de ejercitar por HTTP la papeleta de estos cuatro —no hay decisión
 * abierta contra la cual emitirla—, y esa cobertura se perdió a propósito: sólo se podía comprar
 * abriendo votaciones que mienten al cerrar. La forma de la papeleta se sigue cubriendo donde no
 * hace falta abrir nada: `services/api/test/payload-de-papeleta.test.ts`,
 * `services/api/test/decision-codec-papeletas.test.ts`,
 * `services/api/test/escala-de-menciones.test.ts` y, en el motor, `packages/domain/test/tally-*`.
 * El día que una decisión se pueda abrir con más de una opción, este bloque vuelve a ser el de
 * antes y esa cobertura se recupera de verdad.
 */
const CIRCULO_METODOS = 'e5bac105b1e00000000000000000000b';
const HORA_METODOS = 3_600_000;

let contadorMetodos = 0;
function reqMetodos(): string {
  const hex = (++contadorMetodos + 0x9000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/** Los cuatro que comparan opciones entre sí, en el orden del catálogo. */
const COMPARAN_OPCIONES = ['score', 'irv', 'majority-judgment', 'condorcet-schulze'] as const;

describe.skipIf(!env.ok)(`abrir con un método que compara opciones${skipNote(env)}`, () => {
  let e: ApiListo;
  let facilitadora: { testigo: string; miembroId: string };
  let autores: readonly { testigo: string; miembroId: string }[];

  beforeAll(async () => {
    e = listo(env);
    // El describe de arriba ya gastó las 5 peticiones por hora que `REGLA_ENLACE` permite para
    // FACILITADORA (`services/api/src/http/rate-limit.ts`). Pedir un sexto enlace en la misma
    // hora del reloj de prueba da 429 `DEMASIADOS_INTENTOS` — el límite haciendo bien su trabajo,
    // no un fallo. Se avanza el reloj para que la ventana deslizante quede vacía otra vez.
    e.reloj.avanzar(2 * HORA_METODOS);
    facilitadora = await entrar(e, FACILITADORA);
    autores = await Promise.all(
      [
        'metodos.punt.uno@udea.edu.co',
        'metodos.punt.dos@udea.edu.co',
        'metodos.punt.tres@udea.edu.co',
        'metodos.punt.cuatro@udea.edu.co',
      ].map((correo) => entrar(e, correo)),
    );
  });

  /**
   * Problema → propuesta, con `e.app` de punta a punta. Devuelve la propuesta lista para abrir.
   *
   * `autorIndex` rota entre los cuatro: el cupo es de 3 propuestas por persona y semana
   * (THREAT_MODEL.md T-12) y acá hacen falta cinco. Se reparte entre autores en vez de avanzar el
   * reloj entre una y otra, porque avanzarlo vence las sesiones: `INACTIVIDAD_VIGENCIA_MS` son 60
   * minutos (`services/api/src/http/identity.ts`) y el salto de un día deja a todo el mundo fuera
   * con un 401 que no tiene nada que ver con lo que se está probando. Este bloque no salta el
   * reloj en ningún momento después de `beforeAll`.
   */
  async function propuestaLista(nota: string, autorIndex: number): Promise<string> {
    const autor = autores[autorIndex];
    if (autor === undefined) throw new Error('no hay autor disponible para esta propuesta');
    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(autor.testigo),
      payload: {
        requestId: reqMetodos(),
        titulo: `Un asunto para decidir por ${nota}`,
        cuerpo: 'Un asunto cualquiera del círculo, para ejercitar este método de punta a punta.',
        circuloId: CIRCULO_METODOS,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);

    const propuesta = await e.app.inject({
      method: 'POST',
      url: '/propuestas',
      headers: como(autor.testigo),
      payload: {
        requestId: reqMetodos(),
        problemaId: problema.json<{ id: string }>().id,
        titulo: `Propuesta a decidir por ${nota}`,
        cuerpo: 'La propuesta concreta que se somete a esta votación de prueba.',
        plan: planDe(autor.miembroId),
      },
    });
    expect(propuesta.statusCode, propuesta.body).toBe(201);
    return propuesta.json<{ id: string }>().id;
  }

  async function abrir(
    propuestaId: string,
    metodo: string,
  ): Promise<Awaited<ReturnType<typeof e.app.inject>>> {
    return e.app.inject({
      method: 'POST',
      url: '/decisiones',
      headers: como(facilitadora.testigo),
      payload: { requestId: reqMetodos(), propuestaId, metodo, duracionHoras: 1 },
    });
  }

  it('el servidor rechaza los cuatro, aunque la petición no pase por la pantalla', async () => {
    for (const [indice, metodo] of COMPARAN_OPCIONES.entries()) {
      const respuesta = await abrir(await propuestaLista(metodo, indice), metodo);

      expect(respuesta.statusCode, `${metodo}: ${respuesta.body}`).toBe(422);
      expect(respuesta.json<{ codigo: string }>().codigo, metodo).toBe(
        'CONFIG_MULTI_METHOD_NEEDS_TWO_OPTIONS',
      );
      // Y lo dice en castellano, no con el nombre técnico del método: quien abre una votación no
      // tiene por qué saber qué es «condorcet-schulze» para entender por qué no puede. El error
      // del dominio SÍ lleva el nombre técnico (`${method.kind} compara opciones entre sí…`), y
      // lo que se comprueba acá es que `MENSAJES` lo tape antes de llegar a la pantalla.
      //
      // La lista es explícita en vez de `not.toContain(metodo)` porque «irv» es subcadena de
      // «sirve», y esa aserción fallaba sobre un mensaje perfectamente bueno.
      const mensaje = respuesta.json<{ mensaje: string }>().mensaje;
      expect(mensaje, metodo).toContain('una sola');
      expect(mensaje, metodo).not.toMatch(/condorcet|schulze|judgment|score|majority/iu);
    }
  });

  it('lo rechaza sin escribir nada: la misma propuesta se abre después con otro método', async () => {
    // Que dé 422 no bastaría si por el camino hubiera dejado la propuesta a medio decidir. Se
    // intenta con el método prohibido y, sobre LA MISMA propuesta, se abre con uno permitido: si
    // el intento fallido hubiera escrito algo, este segundo paso chocaría con ello.
    // Autor 0 otra vez: van dos propuestas suyas en todo el bloque, bajo el cupo de 3.
    const propuestaId = await propuestaLista('reintento', 0);

    const negado = await abrir(propuestaId, 'majority-judgment');
    expect(negado.statusCode, negado.body).toBe(422);

    const abierta = await abrir(propuestaId, 'simple-majority');
    expect(abierta.statusCode, abierta.body).toBe(201);
    expect(abierta.json<{ metodo: string }>().metodo).toBe('simple-majority');
  });
});
