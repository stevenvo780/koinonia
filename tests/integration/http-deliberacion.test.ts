/**
 * La deliberación de punta a punta contra PostgreSQL de verdad, con tres preguntas.
 *
 * 1. **¿Sobrevive el aporte a la ida y vuelta por el ledger?** El aporte lleva su autor dos veces
 *    —en el sobre y en el cuerpo— y las dos entran en la preimagen del hash. Si el codec perdiera o
 *    reordenara una coma, el historial releído no se plegaría.
 *
 * 2. **¿La autorización se vuelve a comprobar al RELEER el log?** Un permiso que sólo se comprueba
 *    en el momento de escribir es un permiso que se evapora con el reinicio del proceso. Acá se
 *    carga el historial desde la base, se pliega y se le pregunta al dominio por la autoría: tiene
 *    que negarse otra vez.
 *
 * 3. **¿Se puede sacar la autoría por el historial exportable?** Es la deuda que ADR-0049 dejó
 *    declarada: `ledger:export` es `OPEN` —cualquiera, sin cuenta— y el autor está dentro del hecho.
 *    Acá se comprueba que no sale, que lo retenido se declara, y que el paquete del verificador
 *    independiente sigue diciendo exactamente lo mismo que decía antes de que existiera la
 *    conversación en cuanto la etapa cierra.
 */

import { buildExport } from '@koinonia/api';
// Deep imports a propósito: `services/api/src/index.ts` es el escaparate público del paquete y no
// se toca por dos símbolos que sólo necesita esta prueba. Es el mismo camino que usan las pruebas
// de `services/api/test`.
import { deliberacionesRetenidas } from '../../services/api/src/ledger/export.js';
import { loadDeliberationState } from '../../services/api/src/workspace/repository.js';
import { type Actor, memberId, readContributionAuthor, UnauthorizedError } from '@koinonia/domain';
import { memorySource, verificarExport, type TrustRoster } from '@koinonia/verificar';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const AHORA = '2026-08-21T18:00:00.000Z';

const CONFIANZA: TrustRoster = {
  gitSigners: [],
  witnesses: [],
  minDistinctDomains: 2,
  forges: ['codeberg', 'github'],
  gitSigningKeyOffHost: true,
};

function uuid(semilla: number): string {
  const hex = semilla.toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

let n = 0;
const req = (): string => uuid(++n + 0x9000);

interface AporteVisto {
  readonly id: string;
  readonly comoSeLlama: string;
  readonly texto: string;
  readonly autorId?: string;
  readonly esMio?: boolean;
  readonly cuando?: number;
  readonly responde: readonly { readonly aporteId: string; readonly comoSeRelaciona: string }[];
}

interface DetalleVisto {
  readonly id: string;
  readonly etapa: string;
  readonly etapaEnPalabras: string;
  readonly autoriaVisible: boolean;
  readonly avisoDeAutoria: string;
  readonly aportes: readonly AporteVisto[];
  readonly puedoAvanzarEtapa: boolean;
}

describe.skipIf(!env.ok)(`deliberación por HTTP${skipNote(env)}`, () => {
  let e: ApiListo;
  let lucia: { testigo: string; miembroId: string };
  let sara: { testigo: string; miembroId: string };
  let julian: { testigo: string; miembroId: string };
  let problemaId: string;
  let deliberacionId: string;
  let posicionDeSara: string;
  /** Los hallazgos del verificador ANTES de que exista ninguna conversación. Es la línea base. */
  let hallazgosBase: readonly string[];

  async function detalle(testigo?: string): Promise<DetalleVisto> {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: `/deliberaciones/${deliberacionId}`,
      ...(testigo === undefined ? {} : { headers: como(testigo) }),
    });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    return respuesta.json<DetalleVisto>();
  }

  async function hallazgosDelPaquete(): Promise<{
    readonly codigos: readonly string[];
    readonly paquete: ReadonlyMap<string, string | Uint8Array>;
  }> {
    const client = await e.pool.connect();
    try {
      const paquete = await buildExport(client, { generatedAt: AHORA, trust: CONFIANZA });
      const resultado = await verificarExport({
        source: memorySource('koinonia-export', paquete),
        confianza: CONFIANZA,
        ahora: AHORA,
      });
      return { codigos: [...resultado.hallazgos.map((h) => h.codigo)].sort(), paquete };
    } finally {
      client.release();
    }
  }

  /** El historial público tal como lo descarga cualquiera desde «Verificar integridad». */
  async function exportPublico(): Promise<{
    readonly texto: string;
    readonly retenidos: readonly { readonly conversacion: string; readonly motivo: string }[];
  }> {
    const respuesta = await e.app.inject({ method: 'GET', url: '/integridad/exportar' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    return {
      texto: respuesta.body,
      retenidos: respuesta.json<{
        retenidos: { conversacion: string; motivo: string }[];
      }>().retenidos,
    };
  }

  beforeAll(async () => {
    e = listo(env);
    lucia = await entrar(e, FACILITADORA);
    sara = await entrar(e, 'sara.delibera@udea.edu.co');
    julian = await entrar(e, 'julian.delibera@udea.edu.co');

    hallazgosBase = (await hallazgosDelPaquete()).codigos;

    const problema = await e.app.inject({
      method: 'POST',
      url: '/problemas',
      headers: como(sara.testigo),
      payload: {
        requestId: req(),
        titulo: 'La sala de estudio cierra a las 6 de la tarde',
        cuerpo:
          'Los de la nocturna llegamos a las 5:40 y la sala cierra a las 6. No tenemos dónde leer ' +
          'y terminamos parados en el pasillo.',
        circuloId: CIRCULO_ESPACIOS,
      },
    });
    expect(problema.statusCode, problema.body).toBe(201);
    problemaId = problema.json<{ id: string }>().id;
  });

  it('quien cuida el procedimiento abre la conversación, y empieza en Preguntas', async () => {
    const abierta = await e.app.inject({
      method: 'POST',
      url: '/deliberaciones',
      headers: como(lucia.testigo),
      payload: { requestId: req(), problemaId, duracionHoras: 48 },
    });
    expect(abierta.statusCode, abierta.body).toBe(201);
    const cuerpo = abierta.json<DetalleVisto>();
    deliberacionId = cuerpo.id;
    expect(cuerpo.etapa).toBe('preguntas_aclaratorias');
    expect(cuerpo.etapaEnPalabras).toBe('Preguntas');
    expect(cuerpo.autoriaVisible).toBe(true);
  });

  it('un miembro raso no abre una conversación, ni llamando a la API', async () => {
    const respuesta = await e.app.inject({
      method: 'POST',
      url: '/deliberaciones',
      headers: como(julian.testigo),
      payload: { requestId: req(), problemaId, duracionHoras: 48 },
    });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_ROLE_NOT_GRANTED');
  });

  it('en Preguntas cabe una pregunta y NO cabe una postura', async () => {
    const pregunta = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/aportes`,
      headers: como(sara.testigo),
      payload: {
        requestId: req(),
        tipo: 'posicion',
        modo: 'pregunta_aclaratoria',
        texto: '¿La sala cierra a las seis todos los días o sólo los viernes?',
      },
    });
    expect(pregunta.statusCode, pregunta.body).toBe(201);

    const postura = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/aportes`,
      headers: como(julian.testigo),
      payload: {
        requestId: req(),
        tipo: 'posicion',
        modo: 'afirmacion',
        texto: 'La sala tendría que abrir hasta las nueve al menos tres días por semana.',
      },
    });
    expect(postura.statusCode).toBe(422);
    const error = postura.json<{ codigo: string; mensaje: string }>();
    expect(error.codigo).toBe('POSITION_MODE_NOT_ALLOWED');
    // Sin jerga: ni el identificador de la etapa ni el del tipo de aporte.
    expect(error.mensaje).toContain('Preguntas');
    expect(error.mensaje).not.toContain('preguntas_aclaratorias');
    expect(error.mensaje).not.toContain('afirmacion');
  });

  it('avanza a Perspectivas, y ahí se escriben posturas con su razón', async () => {
    const avance = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/etapa`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(avance.statusCode, avance.body).toBe(200);
    expect(avance.json<DetalleVisto>().etapaEnPalabras).toBe('Perspectivas');

    const postura = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/aportes`,
      headers: como(sara.testigo),
      payload: {
        requestId: req(),
        tipo: 'posicion',
        modo: 'afirmacion',
        texto: 'La sala tendría que abrir hasta las nueve al menos tres días por semana.',
      },
    });
    expect(postura.statusCode, postura.body).toBe(201);
    const aportes = postura.json<DetalleVisto>().aportes;
    const suya = aportes.find((a) => a.texto.startsWith('La sala tendría'));
    expect(suya).toBeDefined();
    posicionDeSara = suya!.id;

    const razon = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/aportes`,
      headers: como(julian.testigo),
      payload: {
        requestId: req(),
        tipo: 'razon',
        relacion: 'sostiene',
        posicionId: posicionDeSara,
        texto: 'La jornada nocturna entra a las seis y no tiene dónde leer antes de clase.',
      },
    });
    expect(razon.statusCode, razon.body).toBe(201);
    const conGrafo = razon.json<DetalleVisto>().aportes.find((a) => a.comoSeLlama === 'Razón');
    expect(conGrafo?.responde).toEqual([{ aporteId: posicionDeSara, comoSeRelaciona: 'Sostiene' }]);
  });

  it('IDA Y VUELTA: el historial releído desde la base se pliega y conserva el aporte', async () => {
    const client = await e.pool.connect();
    try {
      // `loadDeliberationState` verifica la cadena Y pliega. El plegado es donde se comprueba que el
      // sobre y el aporte nombran a la misma persona: si el codec hubiera perdido el `authorId`, o
      // hubiera reordenado una clave, esto no llegaría a estado.
      const state = await loadDeliberationState(client, deliberacionId);
      expect(state.stage).toBe('perspectivas');
      expect(state.contributions).toHaveLength(3);
      const razon = state.contributions.find((c) => c.body.kind === 'razon');
      expect(razon?.authorId).toBe(julian.miembroId);
      expect(razon?.body).toStrictEqual({
        kind: 'razon',
        relation: 'sostiene',
        positionId: posicionDeSara,
        text: 'La jornada nocturna entra a las seis y no tiene dónde leer antes de clase.',
      });
    } finally {
      client.release();
    }
  });

  it('AL RELEER, la autorización se vuelve a comprobar: el dominio niega la autoría otra vez', async () => {
    const client = await e.pool.connect();
    try {
      const state = await loadDeliberationState(client, deliberacionId);
      const comoLucia: Actor = {
        memberId: memberId(lucia.miembroId),
        roles: ['member', 'facilitator'],
        circles: [CIRCULO_ESPACIOS as never],
      };
      let lanzo: unknown;
      try {
        readContributionAuthor(state, comoLucia, state.contributions[2]!.contributionId);
      } catch (error) {
        lanzo = error;
      }
      expect(lanzo).toBeInstanceOf(UnauthorizedError);
      expect((lanzo as UnauthorizedError).reason).toBe('STAGE_STILL_OPEN');
    } finally {
      client.release();
    }
  });

  it('mientras Perspectivas siga abierta, la API no entrega la autoría a nadie', async () => {
    for (const [quien, testigo] of [
      ['quien escribió', sara.testigo],
      ['quien facilita', lucia.testigo],
      ['sin cuenta', undefined],
    ] as const) {
      const visto = await detalle(testigo);
      expect(visto.autoriaVisible, quien).toBe(false);
      expect(JSON.stringify(visto), quien).not.toContain(sara.miembroId);
      expect(JSON.stringify(visto), quien).not.toContain(julian.miembroId);
      expect(
        visto.aportes.every((a) => a.autorId === undefined),
        quien,
      ).toBe(true);
      // Ni el instante: al milisegundo, un aporte sin nombre se atribuye con cualquier señal de
      // fuera. Mientras no se pueda saber quién, tampoco se publica cuándo.
      expect(
        visto.aportes.every((a) => a.cuando === undefined),
        quien,
      ).toBe(true);
    }
  });

  it('RETENCIÓN (a): el historial público no entrega la autoría, y declara lo que retiene', async () => {
    const { texto, retenidos } = await exportPublico();

    // Ni un hecho de la conversación, así que tampoco su autoría. Se comprueba por el tipo de
    // agregado y por el texto de un aporte: si saliera el hecho, saldría el autor con él.
    expect(texto).not.toContain('"tipoDeAgregado":"deliberation"');
    expect(texto).not.toContain('La jornada nocturna entra a las seis');

    expect(retenidos).toHaveLength(1);
    expect(retenidos[0]?.conversacion).toBe(deliberacionId);
    expect(retenidos[0]?.motivo).toContain('Perspectivas');

    // Y lo que no tiene nada que ocultar sigue saliendo entero, con su autora: el problema lo
    // escribió Sara y eso siempre fue público. La retención es de una etapa, no de una persona.
    expect(texto).toContain(problemaId);
    expect(texto).toContain(sara.miembroId);
  });

  it('RETENCIÓN (a): el paquete del verificador retiene los mismos hechos y los declara', async () => {
    const { codigos, paquete } = await hallazgosDelPaquete();
    const eventos = String(paquete.get('events.ndjson'));
    const lineas = eventos
      .split('\n')
      .filter((linea) => linea !== '')
      .map((linea) => JSON.parse(linea) as { aggregateType: string; aggregateId: string });
    expect(lineas.filter((l) => l.aggregateType === 'deliberation')).toEqual([]);
    expect(eventos).not.toContain('La jornada nocturna entra a las seis');
    // La espina SÍ conserva la anotación del nacimiento de la conversación, y tiene que conservarla:
    // borrarla escondería que existe. Lo retenido es su contenido, no su existencia.
    expect(eventos).toContain(deliberacionId);

    const retenidos = JSON.parse(String(paquete.get('retenidos.json'))) as {
      retainedLeafIndices: number[];
      retained: { aggregateId: string; stage: string; motivo: string }[];
    };
    expect(retenidos.retained.map((r) => r.aggregateId)).toEqual([deliberacionId]);
    expect(retenidos.retainedLeafIndices.length).toBe(5);
    expect(retenidos.retained[0]?.motivo).toContain('no la puede comprobar un tercero');

    // El manifiesto dice cuántos hechos existen y cuántos NO vienen. La resta no la tiene que hacer
    // quien audita contando líneas.
    const manifiesto = JSON.parse(String(paquete.get('manifest.json'))) as {
      eventCount: number;
      retainedLeafCount: number;
    };
    expect(manifiesto.retainedLeafCount).toBe(5);

    // ⚠ EL PRECIO, MEDIDO Y NO ESCONDIDO.
    //
    // Un paquete con hechos retenidos tiene huecos en la numeración, y el verificador independiente
    // los ve. Es exactamente lo que ADR-0049 aceptó al decir que durante Perspectivas «esa
    // deliberación no es verificable por terceros». Lo que se comprueba acá es que los hallazgos son
    // SÓLO los que explica la retención declarada en `retenidos.json`, y ni uno más: nada se rompe
    // en silencio y nada se rompe de más.
    //
    // `COLA_TRUNCADA` aparece porque los hechos retenidos son, ahora mismo, los últimos del
    // historial: el detector de cola cortada no distingue «me lo callo y lo digo» de «me lo llevé».
    // Enseñarle esa diferencia exige tocar `packages/verifier-cli`, que está fuera de esta tarea, y
    // queda anotado como lo que es: una deuda con dueño, no un rojo aceptado.
    const nuevos = [...new Set(codigos.filter((c) => !hallazgosBase.includes(c)))].sort();
    expect(nuevos).toEqual([
      'CABEZA_INCOHERENTE',
      'COLA_TRUNCADA',
      'HUECO_EN_EL_INDICE',
      'PUNTERO_COLGANTE',
    ]);
  });

  it('quien no facilita no avanza la etapa, ni por API, y no se escribe nada', async () => {
    const antes = await detalle(lucia.testigo);
    const respuesta = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/etapa`,
      headers: como(julian.testigo),
      payload: { requestId: req() },
    });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json<{ codigo: string }>().codigo).toBe('UNAUTHORIZED_ROLE_NOT_GRANTED');
    const despues = await detalle(lucia.testigo);
    expect(despues.etapa).toBe(antes.etapa);
    expect(despues.aportes).toHaveLength(antes.aportes.length);
  });

  it('cerrada la etapa aparece la autoría, y la retención del historial se levanta sola', async () => {
    const avance = await e.app.inject({
      method: 'POST',
      url: `/deliberaciones/${deliberacionId}/etapa`,
      headers: como(lucia.testigo),
      payload: { requestId: req() },
    });
    expect(avance.statusCode, avance.body).toBe(200);
    expect(avance.json<DetalleVisto>().etapaEnPalabras).toBe('Alternativas');

    const visto = await detalle(julian.testigo);
    expect(visto.autoriaVisible).toBe(true);
    const razon = visto.aportes.find((a) => a.comoSeLlama === 'Razón');
    expect(razon?.autorId).toBe(julian.miembroId);
    expect(razon?.esMio).toBe(true);
    // Incluida la pregunta de la etapa anterior, que hasta ahora tampoco tenía nombre.
    expect(visto.aportes.find((a) => a.comoSeLlama === 'Pregunta')?.autorId).toBe(sara.miembroId);

    const client = await e.pool.connect();
    try {
      expect(await deliberacionesRetenidas(client)).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('RETENCIÓN (a): cerrada la etapa, el historial trae la autoría y el paquete verifica igual que antes', async () => {
    const { texto, retenidos } = await exportPublico();
    expect(retenidos).toEqual([]);
    expect(texto).toContain(sara.miembroId);
    expect(texto).toContain(julian.miembroId);

    const { codigos, paquete } = await hallazgosDelPaquete();
    expect(String(paquete.get('events.ndjson'))).toContain(deliberacionId);
    // El veredicto vuelve a ser EXACTAMENTE el que era antes de que la conversación existiera: la
    // retención no dejó ninguna cicatriz en el paquete.
    expect(codigos).toEqual([...hallazgosBase]);
  });

  it('«Verificar integridad» vuelve a armar la conversación entera y lo dice', async () => {
    // Sin esta fila, una conversación que no se pudiera volver a armar quedaría retenida del
    // historial público **para siempre y sin alarma**, que es el fallo silencioso que introduce
    // cualquier retención automática.
    const respuesta = await e.app.inject({ method: 'GET', url: '/integridad' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const informe = respuesta.json<{
      todoBien: boolean;
      comprobaciones: { id: string; bien: boolean; queSignifica: string }[];
    }>();
    const fila = informe.comprobaciones.find((c) => c.id === 'conversaciones');
    expect(fila?.bien).toBe(true);
    expect(fila?.queSignifica).toContain('1 conversaciones');
    expect(informe.todoBien).toBe(true);
  });

  it('la conversación aparece en la lista, filtrable por su problema', async () => {
    const respuesta = await e.app.inject({
      method: 'GET',
      url: `/deliberaciones?problema=${problemaId}`,
    });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    const lista =
      respuesta.json<{ id: string; cuantosAportes: number; etapaEnPalabras: string }[]>();
    expect(lista).toHaveLength(1);
    expect(lista[0]?.id).toBe(deliberacionId);
    expect(lista[0]?.cuantosAportes).toBe(3);
    expect(lista[0]?.etapaEnPalabras).toBe('Alternativas');
  });
});
