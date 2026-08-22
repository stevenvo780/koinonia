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
 * 3. **¿Qué pasa con la autoría en el historial exportable?** Sale, y está decidido que salga.
 *    `ledger:export` es `OPEN` —cualquiera, sin cuenta— y el autor está dentro del hecho, así que un
 *    export completo entrega la autoría de «perspectivas» sin llegar a rozar la acción denegada. Acá
 *    se comprueba que el paquete es **completo** y que el verificador independiente lo da por bueno
 *    con la etapa abierta y con la etapa cerrada, igual que antes de que la conversación existiera.
 *
 * ═══ PRUEBAS RETIRADAS: la retención del export (2026-08-22) ═══
 *
 * Este fichero probaba lo contrario del punto 3: que los hechos de una deliberación en
 * «perspectivas» **no** salían del historial público, que lo retenido se declaraba y que el hueco
 * resultante producía exactamente cuatro hallazgos y ni uno más. Se retiran dos pruebas, con nombre:
 *
 *  | Prueba retirada | Qué probaba |
 *  |---|---|
 *  | `RETENCIÓN (a): el historial público no entrega la autoría, y declara lo que retiene` | que `/integridad/exportar` omitía los hechos de la conversación y los declaraba en `retenidos` |
 *  | `RETENCIÓN (a): el paquete del verificador retiene los mismos hechos y los declara` | que `events.ndjson` no traía ni un hecho `deliberation`, que `retenidos.json` listaba 5 hojas, que el manifiesto declaraba `retainedLeafCount: 5`, y que el verificador emitía `HUECO_EN_EL_INDICE`, `CABEZA_INCOHERENTE`, `PUNTERO_COLGANTE` y `COLA_TRUNCADA` |
 *
 * No se retiran porque molestaran: se retiran porque **el mecanismo que sostenían ya no existe**. La
 * segunda es además la que midió el precio y por la que se retira la retención: cuatro rojos en el
 * verificador independiente, uno de ellos con el nombre de un ataque, a cambio de tapar una autoría
 * que la API y la pantalla ya no muestran. En su lugar entra una prueba que exige lo contrario —el
 * paquete completo y el verificador en verde **con la etapa abierta**— y la prueba que ya existía
 * para después del cierre se conserva, porque ahora dice lo mismo en los dos momentos.
 */

import { buildExport } from '@koinonia/api';
// Deep import a propósito: `services/api/src/index.ts` es el escaparate público del paquete y no se
// toca por un símbolo que sólo necesita esta prueba. Es el mismo camino que usan las pruebas de
// `services/api/test`.
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
  async function exportPublico(): Promise<string> {
    const respuesta = await e.app.inject({ method: 'GET', url: '/integridad/exportar' });
    expect(respuesta.statusCode, respuesta.body).toBe(200);
    return respuesta.body;
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

  it('EL HUECO DECLARADO: con la etapa abierta el historial trae la autoría, y verifica en verde', async () => {
    // Lo que sustituye a la retención. Son dos afirmaciones y las dos importan:
    //
    //  (1) la autoría de «perspectivas» SÍ viaja en el historial descargable. Es un hueco frente a
    //      quien se baje el fichero entero, está decidido, y la pantalla lo dice con todas las
    //      letras —`AVISO_AUTORIA_OCULTA`—. Comprobarlo acá es lo que impide que la promesa de la
    //      pantalla y lo que el servidor entrega se separen sin que nadie se entere;
    //  (2) el paquete del verificador independiente sale COMPLETO y sus hallazgos son exactamente
    //      los de antes de que la conversación existiera. Ni un hallazgo nuevo. Esto es lo que la
    //      retención costaba: cuatro rojos, uno de ellos `COLA_TRUNCADA`.
    const texto = await exportPublico();
    expect(texto).toContain('"tipoDeAgregado":"deliberation"');
    expect(texto).toContain('La jornada nocturna entra a las seis');
    expect(texto).toContain(julian.miembroId);
    expect(texto).toContain(problemaId);
    expect(texto).toContain(sara.miembroId);

    const { codigos, paquete } = await hallazgosDelPaquete();
    const eventos = String(paquete.get('events.ndjson'));
    const lineas = eventos
      .split('\n')
      .filter((linea) => linea !== '')
      .map((linea) => JSON.parse(linea) as { aggregateType: string; aggregateId: string });
    expect(lineas.filter((l) => l.aggregateType === 'deliberation').length).toBe(5);
    expect(eventos).toContain('La jornada nocturna entra a las seis');

    // El paquete ya no declara nada retenido, porque no retiene nada: el fichero se retiró con el
    // mecanismo. Dejarlo vacío habría sido dejar en el paquete la sombra de una decisión revertida.
    expect(paquete.has('retenidos.json')).toBe(false);
    const manifiesto = JSON.parse(String(paquete.get('manifest.json'))) as Record<string, unknown>;
    expect(manifiesto['retainedLeafCount']).toBeUndefined();
    expect(manifiesto['eventCount']).toBe(lineas.length);

    // El veredicto, con la etapa TODAVÍA ABIERTA, es el mismo que antes de que la conversación
    // existiera. Ni un hallazgo nuevo.
    expect(codigos).toEqual([...hallazgosBase]);
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

  it('cerrada la etapa aparece la autoría en la API', async () => {
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
  });

  it('cerrada la etapa, el historial sigue completo y el paquete verifica igual que antes', async () => {
    const texto = await exportPublico();
    expect(texto).toContain(sara.miembroId);
    expect(texto).toContain(julian.miembroId);

    const { codigos, paquete } = await hallazgosDelPaquete();
    expect(String(paquete.get('events.ndjson'))).toContain(deliberacionId);
    // El mismo veredicto que con la etapa abierta y que antes de que la conversación existiera. Que
    // el resultado NO dependa de la etapa es justo lo que se ganó: el historial es verificable
    // siempre, no a ratos.
    expect(codigos).toEqual([...hallazgosBase]);
  });

  it('«Verificar integridad» vuelve a armar la conversación entera y lo dice', async () => {
    // La fila existía para que una conversación que no se pudiera volver a armar no quedara
    // retenida del historial público para siempre y sin alarma. Retirada la retención ya no hay
    // nada que se caiga en silencio, pero la fila se queda: que el servidor sepa releer y plegar
    // cada conversación es lo que sostiene la pantalla, y una conversación ilegible tiene que
    // aparecer en «Verificar integridad» aunque su historial salga entero en el paquete.
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
