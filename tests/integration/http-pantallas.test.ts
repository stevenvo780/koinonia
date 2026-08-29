/**
 * Las rutas que sostienen las pantallas nuevas, contra la aplicación real y PostgreSQL real.
 *
 * ═══ Qué existe para demostrar cada bloque ═══
 *
 *  · **Consenso.** Que los tres desenlaces son alcanzables de verdad y no una unión decorativa: sin
 *    datos, con datos que no separan a nadie —«no hay grupos claros», que es la promesa literal de
 *    `PRODUCT.md` §4— y con datos que sí los separan. El caso del medio es el que importa: es el que
 *    una implementación descuidada convierte en una lista vacía, dando a entender que nadie
 *    participó cuando lo que pasó es que nadie discrepó.
 *  · **Delegaciones.** Que prestar el voto funciona de punta a punta, que revocar tiene efecto
 *    inmediato y que **votar directo anula la delegación** (INV-23). Y que ninguna de las tres cosas
 *    la puede hacer una persona por otra, aunque llame a la API directamente.
 *  · **Círculos.** La autorización horizontal del selector de integrantes: dos personas con
 *    exactamente el mismo rol, y ninguna puede pedir la lista de un grupo al que no pertenece.
 *  · **Historial.** Que cuenta qué pasó y cuándo, y que **no dice quién**: mientras una conversación
 *    tiene la autoría sellada, una lista con nombres la rompería desde fuera.
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

const CIRCULO_ESPACIOS = 'e5bac105b1e00000000000000000000b';
/** Nadie pertenece a este grupo: el adaptador de identidad sólo reparte Asamblea y Espacios. */
const CIRCULO_ACADEMICO = 'acade31c0000000000000000000000c1';

const HORA_MS = 60 * 60 * 1000;

function uuid(semilla: number): string {
  const hex = semilla.toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

let n = 0;
const req = (): string => uuid(++n + 0x9000);

/**
 * Cuánto puede envejecer un testigo antes de que `peticion` lo renueve por las suyas, con margen
 * bajo el corte real de inactividad de T-06 (60 min, `INACTIVIDAD_VIGENCIA_MS` en `identity.ts`).
 * No al filo: unos minutos de sobra para el tiempo real que toma la propia petición.
 */
const MARGEN_RENOVACION_SESION_MS = 45 * 60 * 1000;

interface Persona {
  /** Mutable a propósito: `peticion` la renueva in-situ cuando la sesión caducó por inactividad. */
  testigo: string;
  readonly miembroId: string;
  readonly correo: string;
  /**
   * Reloj de prueba en el que se emitió `testigo` por última vez. Varias rutas de lectura de este
   * fichero (`/consenso`, `/delegaciones`, `/circulos/…`) no exigen sesión: con un testigo vencido
   * simplemente responden en modo anónimo, sin 401 que `peticion` pueda detectar y corregir. Por
   * eso la renovación es PROACTIVA —por edad, antes de cada petición— y el reintento sobre 401 que
   * hace `peticion` queda sólo como red de seguridad para las rutas que sí exigen sesión.
   */
  emitidoEn: number;
}

describe.skipIf(!env.ok)(`las rutas de las pantallas nuevas${skipNote(env)}`, () => {
  let e: ApiListo;
  let lucia: Persona;
  /**
   * Veintidós personas rasas.
   *
   * Ocho bastarían para el análisis de consenso; veinte hacen falta para **poder encender la
   * delegación**, y ése es un hallazgo de esta sesión: el tope de concentración es una décima parte
   * del censo, así que por debajo de veinte personas el tope vale 1 —el voto propio— y la primera
   * concesión ya se pasaría (ver `asertarQueSePuedePrestarElVoto`). Las dos de más son margen para
   * `siguienteAutor()`: cada bloque de este fichero que abre una votación consume una persona de la
   * reserva (`gente[11]` en adelante) y este archivo abre bastantes a lo largo de un solo `describe`.
   */
  let gente: Persona[];

  /**
   * Reparte la autoría de cada propuesta nueva entre gente distinta, gente[11] en adelante: el
   * cupo semanal de T-12 es 3 propuestas por persona (`REGLA_PROPUESTA`, `rate-limit.ts`), y este
   * escenario abre bastantes más de tres a lo largo de un solo `describe` — todas dentro de la
   * misma ventana simulada de una semana, porque el reloj sólo avanza unas horas en total. Repetir
   * autor chocaría con un cupo real y correctamente exigido, no con un error de la prueba.
   */
  let siguienteAutorIndice = 11;
  function siguienteAutor(): Persona {
    const persona = gente[siguienteAutorIndice];
    if (persona === undefined) {
      throw new Error('se agotaron las personas reservadas para autoría de propuestas de prueba');
    }
    siguienteAutorIndice += 1;
    return persona;
  }

  /** Pide un testigo nuevo para `p` y lo dejar anotado con la hora (de prueba) de emisión. */
  async function renovar(p: Persona): Promise<void> {
    const sesion = await entrar(e, p.correo);
    p.testigo = sesion.testigo;
    p.emitidoEn = e.reloj.now();
  }

  /**
   * Como `e.app.inject`, pero autenticada como `p` y resiliente a que la sesión haya caducado por
   * inactividad (T-06, 60 min) — algo que este fichero provoca a propósito cada vez que adelanta el
   * reloj para dejar transcurrir la ventana de una votación (§ `votacionCerrada`). Renueva PROACTIVO
   * por edad (`MARGEN_RENOVACION_SESION_MS`), porque varias rutas de lectura de aquí abajo no
   * exigen sesión y ante un testigo vencido responden en modo anónimo en vez de con un 401 que se
   * pueda detectar después del hecho. El reintento sobre un 401 «no autenticada» que sí llega queda
   * como red de seguridad, no como el mecanismo principal.
   */
  async function peticion(
    p: Persona,
    init: {
      readonly method: 'GET' | 'POST';
      readonly url: string;
      readonly payload?: Record<string, unknown>;
    },
  ): Promise<Awaited<ReturnType<typeof e.app.inject>>> {
    if (e.reloj.now() - p.emitidoEn >= MARGEN_RENOVACION_SESION_MS) {
      await renovar(p);
    }
    const primero = await e.app.inject({ ...init, headers: como(p.testigo) });
    if (primero.statusCode === 401) {
      let codigo: string | undefined;
      try {
        codigo = primero.json<{ codigo?: string }>().codigo;
      } catch {
        codigo = undefined; // cuerpo no-JSON: no es el caso de sesión inactiva, se deja tal cual.
      }
      if (codigo === 'UNAUTHORIZED_NOT_AUTHENTICATED') {
        await renovar(p);
        return e.app.inject({ ...init, headers: como(p.testigo) });
      }
    }
    return primero;
  }

  /** Abre una propuesta nueva y devuelve su identificador. */
  async function nuevaPropuesta(autor: Persona, titulo: string): Promise<string> {
    const problema = await peticion(autor, {
      method: 'POST',
      url: '/problemas',
      payload: {
        requestId: req(),
        titulo: `${titulo} (el problema)`,
        cuerpo:
          'Este problema existe para que haya algo real que votar y que el análisis de consenso ' +
          'tenga sobre qué trabajar, en vez de una matriz inventada.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);

    const propuesta = await peticion(autor, {
      method: 'POST',
      url: '/propuestas',
      payload: {
        requestId: req(),
        problemaId: problema.json<{ id: string }>().id,
        titulo,
        cuerpo:
          'Un texto de propuesta suficientemente largo para que valga como propuesta de verdad y ' +
          'no como relleno de una prueba.',
        plan: planDe(autor.miembroId),
      },
    });
    expect(propuesta.statusCode, propuesta.body).toBe(201);
    return propuesta.json<{ id: string }>().id;
  }

  /**
   * Abre una votación, la vota y la cierra. `respuestas[i]` es lo que responde la persona `i`:
   * `1` a favor, `-1` en contra, `0` abstención explícita.
   *
   * La ventana es de una hora y el reloj avanza sesenta y un minutos por votación. No es un
   * capricho: adelantar dos horas por votación dejaba a todo el mundo fuera a mitad del escenario,
   * con 401 en sitios que no tenían nada que ver. El propio salto de 61 minutos ya excede el corte
   * por inactividad de sesión (T-06, 60 min): por eso todo pasa por `peticion`, que renueva sola la
   * sesión de quien la necesite en vez de que cada punto de este fichero tenga que saberlo.
   */
  async function votacionCerrada(
    titulo: string,
    respuestas: readonly (-1 | 0 | 1)[],
  ): Promise<string> {
    const propuestaId = await nuevaPropuesta(siguienteAutor(), titulo);
    const abierta = await peticion(lucia, {
      method: 'POST',
      url: '/decisiones',
      payload: { requestId: req(), propuestaId, metodo: 'simple-majority', duracionHoras: 1 },
    });
    expect(abierta.statusCode, abierta.body).toBe(201);
    const decision = abierta.json<{ id: string; huellaVersion: string }>();

    for (const [indice, persona] of gente.slice(0, respuestas.length).entries()) {
      const respuesta = respuestas[indice] ?? 0;
      const papeleta = await peticion(persona, {
        method: 'POST',
        url: `/decisiones/${decision.id}/papeletas`,
        payload: {
          requestId: req(),
          huellaVersion: decision.huellaVersion,
          respuesta:
            respuesta === 0 ? { tipo: 'abstain' } : { tipo: 'binary', aprueba: respuesta === 1 },
        },
      });
      expect(papeleta.statusCode, papeleta.body).toBe(201);
    }

    e.reloj.avanzar(HORA_MS + 60_000);
    const cierre = await peticion(lucia, {
      method: 'POST',
      url: `/decisiones/${decision.id}/cerrar`,
      payload: { requestId: req() },
    });
    expect(cierre.statusCode, cierre.body).toBe(200);
    return decision.id;
  }

  /** Ocho personas, en el mismo orden en las tres columnas. Todas a favor: `1`. */
  const AFAVOR: readonly (-1 | 0 | 1)[] = [1, 1, 1, 1, -1, -1, -1, -1];

  beforeAll(async () => {
    e = listo(env);
    const sesionLucia = await entrar(e, FACILITADORA);
    lucia = {
      testigo: sesionLucia.testigo,
      miembroId: sesionLucia.miembroId,
      correo: FACILITADORA,
      emitidoEn: e.reloj.now(),
    };
    gente = [];
    for (let i = 0; i < 22; i++) {
      const correo = `pantallas.${String(i)}@udea.edu.co`;
      const sesion = await entrar(e, correo);
      gente.push({
        testigo: sesion.testigo,
        miembroId: sesion.miembroId,
        correo,
        emitidoEn: e.reloj.now(),
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Consenso
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('sin votaciones cerradas dice «No hay grupos claros» y explica qué falta', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/consenso' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const cuerpo = respuesta.json<{
      tipo: string;
      titulo: string;
      queFalta: string;
      votaciones: number;
    }>();
    expect(cuerpo.tipo).toBe('todavia-no');
    expect(cuerpo.titulo).toBe('No hay grupos claros');
    // Nunca un callejón: el estado vacío dice qué tendría que pasar.
    expect(cuerpo.queFalta).toMatch(/tres votaciones/u);
    expect(cuerpo.votaciones).toBe(0);
  });

  it('cuando las respuestas no dibujan bandos NO los fabrica: dice «No hay grupos claros»', async () => {
    // Tres votaciones en las que cada quien responde a su manera y no se forma ningún bloque: hay
    // desacuerdo de sobra —así que no es el caso de «todos respondieron igual»—, pero no hay
    // ninguna línea por la que partir a la gente en dos. Publicar dos grupos acá sería exactamente
    // lo que ADR-0038 prohíbe: repartir a las personas por dónde cae el redondeo y dejar que
    // alguien lo lea como un veredicto sobre quién es quién.
    await votacionCerrada(
      'Poner un aviso con el horario en la puerta',
      [1, 0, 1, 0, -1, 1, -1, -1],
    );
    await votacionCerrada('Pedir dos enchufes más en la sala', [-1, 1, 1, -1, -1, 1, 1, 1]);
    await votacionCerrada('Publicar el acta de cada reunión', [-1, -1, -1, -1, 0, 1, 1, -1]);

    const respuesta = await e.app.inject({ method: 'GET', url: '/consenso' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const cuerpo = respuesta.json<{
      tipo: string;
      titulo: string;
      descripcion: string;
      deDondeSale?: string;
      personas: number;
      votaciones: number;
      acuerdoGeneral?: { titulo: string; textos: unknown[]; aviso: string };
      grupos?: unknown[];
    }>();

    expect(cuerpo.tipo).toBe('sin-grupos');
    expect(cuerpo.titulo).toBe('No hay grupos claros');
    expect(cuerpo.votaciones).toBe(3);
    expect(cuerpo.personas).toBe(8);

    // Lo que NO puede pasar: que venga con `grupos` vacío. Una lista vacía se lee como «no
    // participó nadie», y lo que pasó es que no hay bandos. Son cosas distintas, y por eso el
    // contrato es una unión discriminada y no un campo opcional.
    expect(cuerpo.grupos).toBeUndefined();
    expect(cuerpo.descripcion).toMatch(/No es un fallo del cálculo/u);
    expect(cuerpo.deDondeSale).toMatch(/votaciones cerradas/u);
    expect(cuerpo.acuerdoGeneral?.titulo).toBe('En lo que coincide la gente');
    // Vacía también se dice: sin acuerdo destacable hay un aviso, nunca un hueco.
    if (cuerpo.acuerdoGeneral?.textos.length === 0) {
      expect(cuerpo.acuerdoGeneral.aviso.length).toBeGreaterThan(0);
    }
  });

  it('cuando la gente sí se separa, publica grupos numerados desde 1 y de dónde salen', async () => {
    // Cuatro votaciones más con la comunidad partida en dos mitades limpias y estables.
    for (const titulo of [
      'Trasladar la asamblea a la jornada nocturna',
      'Reservar la sala los sábados para la nocturna',
      'Mover el seminario de los martes a la noche',
      'Priorizar las electivas nocturnas en el próximo semestre',
    ]) {
      await votacionCerrada(titulo, AFAVOR);
    }

    const respuesta = await e.app.inject({ method: 'GET', url: '/consenso' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const cuerpo = respuesta.json<{
      tipo: string;
      deDondeSale?: string;
      grupos?: { numero: number; personas: number }[];
      enQueCoinciden?: { textos: { acuerdoPorGrupo: { grupo: number }[] }[] };
    }>();

    expect(cuerpo.tipo).toBe('grupos');
    expect(cuerpo.grupos?.length).toBeGreaterThanOrEqual(2);
    // Desde 1, nunca desde 0: un «Grupo 0» es el lenguaje de la máquina asomándose (ADR-0041).
    expect(cuerpo.grupos?.map((g) => g.numero)).toEqual(cuerpo.grupos?.map((_g, i) => i + 1));
    expect(cuerpo.grupos?.every((g) => g.personas > 0)).toBe(true);
    // La suma de los grupos es toda la gente: nadie se pierde por el camino.
    expect(cuerpo.grupos?.reduce((suma, g) => suma + g.personas, 0)).toBe(8);
    expect(cuerpo.deDondeSale).toMatch(/no es una encuesta/u);
    for (const texto of cuerpo.enQueCoinciden?.textos ?? []) {
      expect(texto.acuerdoPorGrupo.every((a) => a.grupo >= 1)).toBe(true);
    }
  });

  it('a cada quien le dice en qué grupo quedó, y sólo a quien votó', async () => {
    const mia = await peticion(gente[0]!, { method: 'GET', url: '/consenso' });
    expect(mia.json<{ miGrupo?: number }>().miGrupo).toBeGreaterThanOrEqual(1);

    // Quien no votó en ninguna no tiene grupo, y no se le inventa uno.
    const deLucia = await peticion(lucia, { method: 'GET', url: '/consenso' });
    expect(deLucia.json<{ miGrupo?: number }>().miGrupo).toBeUndefined();
  });

  it('no acepta selectores por la query: no hay forma de pedir el consenso «de otra persona»', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: `/consenso?miembroId=${gente[1]!.miembroId}`,
    });
    expect(respuesta.statusCode).toBe(400);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Delegaciones
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('prestar el voto', () => {
    let decisionId: string;
    let huellaVersion: string;

    beforeAll(async () => {
      const propuestaId = await nuevaPropuesta(siguienteAutor(), 'Comprar una grecas para la sala');
      const abierta = await peticion(lucia, {
        method: 'POST',
        url: '/decisiones',
        payload: {
          requestId: req(),
          propuestaId,
          metodo: 'simple-majority',
          duracionHoras: 48,
          delegacion: true,
        },
      });
      expect(abierta.statusCode, abierta.body).toBe(201);
      const decision = abierta.json<{ id: string; huellaVersion: string }>();
      decisionId = decision.id;
      huellaVersion = decision.huellaVersion;
    });

    it('una votación abierta sin delegación no la ofrece, y dice por qué', async () => {
      const propuestaId = await nuevaPropuesta(siguienteAutor(), 'Cambiar el bombillo del pasillo');
      const abierta = await peticion(lucia, {
        method: 'POST',
        url: '/decisiones',
        payload: { requestId: req(), propuestaId, metodo: 'simple-majority', duracionHoras: 48 },
      });
      expect(abierta.statusCode, abierta.body).toBe(201);
      const sinDelegacion = abierta.json<{ id: string }>().id;

      const panel = await peticion(gente[1]!, { method: 'GET', url: '/delegaciones' });
      const votacion = panel
        .json<{
          votaciones: { decisionId: string; sePuedeDelegar: boolean; porQueNo?: string }[];
        }>()
        .votaciones.find((v) => v.decisionId === sinDelegacion);
      expect(votacion?.sePuedeDelegar).toBe(false);
      expect(votacion?.porQueNo).toMatch(/sin préstamo de voto/u);
    });

    it('el panel explica qué deshace un préstamo ANTES de que alguien lo haga', async () => {
      const panel = await peticion(gente[1]!, { method: 'GET', url: '/delegaciones' });
      expect(panel.statusCode, panel.body).toBe(200);
      const comoFunciona = panel.json<{ comoFunciona: string[] }>().comoFunciona;
      expect(comoFunciona.some((linea) => /Si votás vos, tu voto manda/u.test(linea))).toBe(true);
      expect(comoFunciona.some((linea) => /tope/u.test(linea))).toBe(true);
    });

    it('el desplegable de en quién delegar nunca se ofrece a uno mismo', async () => {
      const panel = await peticion(gente[1]!, { method: 'GET', url: '/delegaciones' });
      const votacion = panel
        .json<{
          votaciones: {
            decisionId: string;
            podesDelegarEn: { id: string; alias: string }[];
          }[];
        }>()
        .votaciones.find((v) => v.decisionId === decisionId);
      expect(votacion?.podesDelegarEn.length).toBeGreaterThan(0);
      expect(votacion?.podesDelegarEn.some((m) => m.id === gente[1]!.miembroId)).toBe(false);
      // Alias, nunca identificadores: un desplegable de 32 hexadecimales no lo usa nadie.
      expect(votacion?.podesDelegarEn.every((m) => m.alias.length > 0)).toBe(true);
    });

    it('presta el voto, lo cuenta en el reparto y lo devuelve de un toque', async () => {
      const prestado = await peticion(gente[1]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[2]!.miembroId },
      });
      expect(prestado.statusCode, prestado.body).toBe(201);
      const tras = prestado.json<{
        miDelegacion?: { id: string; enQuien: string };
        reparto: { prestaron: number; cargan: number; maximo: number; comoEsta: string };
      }>();
      expect(tras.miDelegacion?.id).toBeDefined();
      expect(tras.reparto.prestaron).toBe(1);
      expect(tras.reparto.cargan).toBe(1);
      expect(tras.reparto.maximo).toBe(2);
      // El nombre del índice no aparece por ninguna parte: se dice en castellano.
      expect(tras.reparto.comoEsta).toMatch(/repartida|concentrada|carga/u);

      // Revocar exige que haya pasado al menos un milisegundo desde la concesión: el dominio
      // rechaza revocar «antes» de conceder y con reloj congelado los dos instantes coinciden.
      e.reloj.avanzar(1000);
      const devuelto = await peticion(gente[1]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones/${tras.miDelegacion!.id}/revocar`,
        payload: { requestId: req() },
      });
      expect(devuelto.statusCode, devuelto.body).toBe(200);
      const despues = devuelto.json<{
        miDelegacion?: unknown;
        reparto: { prestaron: number; maximo: number };
      }>();
      // Efecto inmediato (C.2, INV-24): no queda para el cierre.
      expect(despues.miDelegacion).toBeUndefined();
      expect(despues.reparto.prestaron).toBe(0);
    });

    it('votar directo anula el préstamo, y se dice sin que haya que deducirlo', async () => {
      const prestado = await peticion(gente[3]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[4]!.miembroId },
      });
      expect(prestado.statusCode, prestado.body).toBe(201);

      const papeleta = await peticion(gente[3]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/papeletas`,
        payload: {
          requestId: req(),
          huellaVersion,
          respuesta: { tipo: 'binary', aprueba: true },
        },
      });
      expect(papeleta.statusCode, papeleta.body).toBe(201);

      const panel = await peticion(gente[3]!, { method: 'GET', url: '/delegaciones' });
      const votacion = panel
        .json<{
          votaciones: {
            decisionId: string;
            yaVote: boolean;
            sePuedeDelegar: boolean;
            porQueNo?: string;
          }[];
        }>()
        .votaciones.find((v) => v.decisionId === decisionId);
      expect(votacion?.yaVote).toBe(true);
      expect(votacion?.sePuedeDelegar).toBe(false);
      expect(votacion?.porQueNo).toMatch(/Tu voto manda/u);
    });

    it('HORIZONTAL — nadie presta el voto de otra persona, ni mandando el campo por API', async () => {
      const respuesta = await peticion(gente[5]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: {
          requestId: req(),
          enQuienId: gente[6]!.miembroId,
          // Todos los nombres plausibles para atribuírselo a otra persona. Ninguno sirve: el
          // sujeto lo pone el servidor desde la sesión.
          delegante: gente[7]!.miembroId,
          delegator: gente[7]!.miembroId,
          miembroId: gente[7]!.miembroId,
        },
      });
      // `.strict()` en la frontera: un campo de más no se ignora, se rechaza.
      expect(respuesta.statusCode, respuesta.body).toBe(400);

      const panel = await peticion(gente[7]!, { method: 'GET', url: '/delegaciones' });
      const votacion = panel
        .json<{ votaciones: { decisionId: string; miDelegacion?: unknown }[] }>()
        .votaciones.find((v) => v.decisionId === decisionId);
      expect(votacion?.miDelegacion).toBeUndefined();
    });

    it('HORIZONTAL — nadie revoca el préstamo de otra persona', async () => {
      const prestado = await peticion(gente[5]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[6]!.miembroId },
      });
      expect(prestado.statusCode, prestado.body).toBe(201);
      const delegacionId = prestado.json<{ miDelegacion: { id: string } }>().miDelegacion.id;

      e.reloj.avanzar(1000);
      const ajeno = await peticion(gente[7]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones/${delegacionId}/revocar`,
        payload: { requestId: req() },
      });
      expect(ajeno.statusCode, ajeno.body).toBe(403);

      // Y no se escribió nada: no basta con devolver 403.
      const panel = await peticion(gente[5]!, { method: 'GET', url: '/delegaciones' });
      const votacion = panel
        .json<{ votaciones: { decisionId: string; miDelegacion?: { id: string } }[] }>()
        .votaciones.find((v) => v.decisionId === decisionId);
      expect(votacion?.miDelegacion?.id).toBe(delegacionId);
    });

    it('el tope de concentración se explica en castellano, sin fórmulas ni referencias', async () => {
      // HALLAZGO. El mensaje del dominio para este caso es «esa persona ya representaría a 2
      // miembros y el tope de concentración es 2 votos sobre un censo de 22 (C.5)». Es el mensaje
      // correcto para quien depura y el equivocado para quien está mirando la pantalla: lleva la
      // notación del cálculo y una cita de la especificación. Salía tal cual por la API.
      const primero = await peticion(gente[8]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[9]!.miembroId },
      });
      expect(primero.statusCode, primero.body).toBe(201);

      const segundo = await peticion(gente[10]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[9]!.miembroId },
      });
      expect(segundo.statusCode, segundo.body).toBe(422);
      const mensaje = segundo.json<{ mensaje: string }>().mensaje;

      expect(mensaje).toMatch(/tope de votos que alguien puede juntar/u);
      // Ni referencias a la especificación, ni notación de la aritmética exacta.
      expect(mensaje).not.toMatch(/\(C\.\d/u);
      expect(mensaje).not.toMatch(/[⌊⌋]/u);
      expect(mensaje).not.toMatch(/censo/u);
      // Y dice qué hacer: una negativa sin salida es un callejón con otro nombre.
      expect(mensaje).toMatch(/Elegí a otra persona, o votá vos/u);
    });

    it('sin cuenta no se presta ningún voto', async () => {
      const respuesta = await e.app.inject({
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[2]!.miembroId },
      });
      expect(respuesta.statusCode).toBe(401);
    });

    it('delegar en uno mismo se rechaza con un mensaje que se puede leer', async () => {
      const respuesta = await peticion(gente[6]!, {
        method: 'POST',
        url: `/decisiones/${decisionId}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[6]!.miembroId },
      });
      expect(respuesta.statusCode, respuesta.body).toBe(422);
      expect(respuesta.json<{ mensaje: string }>().mensaje).toMatch(/si querés votar, votá/u);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Concentración de poder por delegación — deja de mentir (fix de esta sesión)
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('/concentracion/delegaciones', () => {
    it('un préstamo real por HTTP se ve en la foto, y deja de contar en cuanto su votación cierra', async () => {
      // HALLAZGO. Antes de este arreglo, `/concentracion` sólo miraba delegaciones de ámbito
      // `global`, un ámbito que ninguna acción de usuario produce jamás —el único punto de concesión
      // real siempre concede `circle`—, así que esta foto mostraba «nadie prestó su voto» siempre,
      // con datos reales o sin ellos. Esta prueba concede un préstamo real, de punta a punta por
      // HTTP, y comprueba que la cifra SÍ se mueve — y que deja de contar en cuanto la votación que
      // lo trae se cierra.
      //
      // Antes de la línea base: si el bloque anterior dejó un préstamo concedido en el mismo
      // milisegundo de reloj en que terminó (sin que nada lo empujara después), ese préstamo
      // todavía no rige (`isVigent` exige `grantedAt < instante` ESTRICTAMENTE) y esta línea lo
      // asienta, para que el delta que se mide más abajo sea sólo el de ESTE préstamo.
      e.reloj.avanzar(1000);
      const antes = await e.app.inject({ method: 'GET', url: '/concentracion/delegaciones' });
      expect(antes.statusCode, antes.body).toBe(200);
      const personasAntes = antes.json<{ personasQueDelegan: number }>().personasQueDelegan;

      const propuestaId = await nuevaPropuesta(siguienteAutor(), 'Arreglar la gotera del salón');
      const abierta = await peticion(lucia, {
        method: 'POST',
        url: '/decisiones',
        payload: {
          requestId: req(),
          propuestaId,
          metodo: 'simple-majority',
          duracionHoras: 1,
          delegacion: true,
        },
      });
      expect(abierta.statusCode, abierta.body).toBe(201);
      const decision = abierta.json<{ id: string; huellaVersion: string }>();

      const prestado = await peticion(gente[19]!, {
        method: 'POST',
        url: `/decisiones/${decision.id}/delegaciones`,
        payload: { requestId: req(), enQuienId: gente[18]!.miembroId },
      });
      expect(prestado.statusCode, prestado.body).toBe(201);

      // C.2 exige `grantedAt < instante` ESTRICTAMENTE (`isVigent`, `packages/domain/src/
      // delegation-graph.ts`): con el reloj de prueba congelado, `instante` sería exactamente
      // `grantedAt` y la delegación todavía no regiría en su propio milisegundo de concesión.
      e.reloj.avanzar(1000);

      const durante = await e.app.inject({ method: 'GET', url: '/concentracion/delegaciones' });
      expect(durante.statusCode, durante.body).toBe(200);
      const personasDurante = durante.json<{ personasQueDelegan: number }>().personasQueDelegan;
      // El único ámbito que concede la aplicación es `circle`: si esta cifra no se movió, es
      // exactamente el fallo que esta sesión arregla.
      expect(personasDurante).toBe(personasAntes + 1);

      // Alguien más vota directo, para que la votación tenga con qué cerrar.
      const papeleta = await peticion(gente[0]!, {
        method: 'POST',
        url: `/decisiones/${decision.id}/papeletas`,
        payload: {
          requestId: req(),
          huellaVersion: decision.huellaVersion,
          respuesta: { tipo: 'binary', aprueba: true },
        },
      });
      expect(papeleta.statusCode, papeleta.body).toBe(201);

      // Se cierra la votación: la ventana venció.
      e.reloj.avanzar(HORA_MS + 60_000);
      const cerrada = await peticion(lucia, {
        method: 'POST',
        url: `/decisiones/${decision.id}/cerrar`,
        payload: { requestId: req() },
      });
      expect(cerrada.statusCode, cerrada.body).toBe(200);

      const despues = await e.app.inject({ method: 'GET', url: '/concentracion/delegaciones' });
      expect(despues.statusCode, despues.body).toBe(200);
      const personasDespues = despues.json<{ personasQueDelegan: number }>().personasQueDelegan;
      expect(personasDespues).toBe(personasAntes);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Círculos
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('la lista de grupos dice qué decide cada uno sin preguntarle a nadie', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/circulos' });
    expect(respuesta.statusCode).toBe(200);
    const circulos = respuesta.json<{ nombre: string; decideSinConsultar: string }[]>();
    expect(circulos.length).toBeGreaterThanOrEqual(3);
    expect(circulos.every((c) => c.decideSinConsultar.length > 0)).toBe(true);
  });

  it('HORIZONTAL — la lista de integrantes de un grupo ajeno no se entrega', async () => {
    const propio = await peticion(gente[0]!, {
      method: 'GET',
      url: `/circulos/${CIRCULO_ESPACIOS}/miembros`,
    });
    expect(propio.statusCode, propio.body).toBe(200);

    const ajeno = await peticion(gente[0]!, {
      method: 'GET',
      url: `/circulos/${CIRCULO_ACADEMICO}/miembros`,
    });
    expect(ajeno.statusCode, ajeno.body).toBe(403);
  });

  it('sin cuenta tampoco se entrega: no es un directorio público', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: `/circulos/${CIRCULO_ESPACIOS}/miembros`,
    });
    expect(respuesta.statusCode).toBe(401);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Normas
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('las normas publican el núcleo intangible como irreformable, y son seis', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/normas' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const cuerpo = respuesta.json<{
      hayNormas: boolean;
      versiones: unknown[];
      nucleo: { reglas: { irreformable: boolean; titulo: string; texto: string }[] };
      vias: { nombre: string; requisitos: string[] }[];
    }>();

    expect(cuerpo.nucleo.reglas).toHaveLength(6);
    expect(cuerpo.nucleo.reglas.every((r) => r.irreformable)).toBe(true);
    expect(cuerpo.nucleo.reglas.every((r) => r.titulo.length > 0 && r.texto.length > 0)).toBe(true);

    // Dos vías y ninguna más: no hay «vía rápida».
    expect(cuerpo.vias).toHaveLength(2);
    expect(cuerpo.vias[1]?.requisitos.some((r) => /votaciones distintas/u.test(r))).toBe(true);

    // Y se dice la verdad sobre el estado del documento: todavía no hay una versión aprobada, así
    // que la lista de versiones está vacía y `hayNormas` no miente diciendo que sí.
    expect(cuerpo.hayNormas).toBe(false);
    expect(cuerpo.versiones).toEqual([]);
  });

  it('los requisitos se dicen como proporciones exactas, no como decimales', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/normas' });
    const requisitos = respuesta.json<{ vias: { requisitos: string[] }[] }>().vias[0]!.requisitos;
    expect(requisitos.some((r) => /2 de cada 3/u.test(r))).toBe(true);
    // «0,667 del censo» sería una supermayoría que no existe: ADR-0027 prohíbe el decimal en un
    // umbral, y también prohíbe enseñarlo como si fuera el umbral.
    expect(requisitos.every((r) => !/0[,.]\d/u.test(r))).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Historial
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  it('el historial cuenta qué pasó y cuándo, en frases y no en nombres internos', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/historial' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const cuerpo = respuesta.json<{
      total: number;
      hechos: { numero: number; cuando: number; que: string; sobre: string; enlace?: string }[];
      hayMas: boolean;
    }>();

    expect(cuerpo.total).toBeGreaterThan(0);
    expect(cuerpo.hechos.length).toBeGreaterThan(0);
    // Del más reciente al más viejo: el número baja.
    expect(cuerpo.hechos[0]!.numero).toBeGreaterThan(
      cuerpo.hechos[cuerpo.hechos.length - 1]!.numero,
    );
    // Cuenta desde 1, como cuenta una persona.
    expect(Math.min(...cuerpo.hechos.map((h) => h.numero))).toBeGreaterThanOrEqual(1);
    expect(cuerpo.hechos.some((h) => h.que === 'Alguien respondió')).toBe(true);
    expect(cuerpo.hechos.some((h) => h.sobre === 'Una votación')).toBe(true);
  });

  it('el historial NO dice quién hizo cada cosa: eso rompería la autoría sellada', async () => {
    const respuesta = await peticion(gente[0]!, { method: 'GET', url: '/historial' });
    const texto = respuesta.body;
    for (const persona of gente) {
      expect(texto).not.toContain(persona.miembroId);
    }
    expect(texto).not.toContain(lucia.miembroId);
  });

  it('el historial tampoco entrega el contenido de nada: es un índice, no un volcado', async () => {
    const respuesta = await e.app.inject({ method: 'GET', url: '/historial' });
    // El título de una propuesta que sí existe en el historial no sale por acá.
    expect(respuesta.body).not.toContain('Comprar una grecas para la sala');
  });
});
