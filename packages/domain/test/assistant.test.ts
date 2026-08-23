/**
 * El asistente de acción sistémica: las 27 preguntas, el borrador y la frase de cierre.
 *
 * La prueba más importante de este fichero no comprueba código: comprueba que **las 27 preguntas son
 * literalmente las de `docs/research/03-deliberativa-sistemas-antipatrones.md` §3.1**. Se leen del
 * documento en tiempo de ejecución y se comparan una a una. Si alguien las «mejora», falla; si
 * alguien cambia el documento, también. El valor de esas preguntas está en las palabras exactas, y
 * una prueba que se limitara a contar 27 no protegería nada.
 *
 * Lo mismo con la frase de cierre: la plantilla se extrae del documento y se compara con lo que
 * genera `fraseDeCierre` cuando cada pregunta responde con una marca reconocible.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  abrirBorrador,
  aplicarSugerencia,
  applyAssistant,
  type AssistantCommandMeta,
  type AssistantEvent,
  type AssistantLog,
  type AssistantPayload,
  type AssistantState,
  ayudaEstructural,
  type BorradorId,
  borradorId,
  cerrarBorrador,
  conteoDeSugerencias,
  consentimientoCubre,
  construirPeticion,
  CUANTAS_PREGUNTAS,
  cuantasRespondidas,
  decidirConsentimiento,
  desajustes,
  type DestinoIA,
  escribirRespuesta,
  esObligatoria,
  esTransicionLegal,
  eventosLegalesDesde,
  faltanObligatorias,
  fraseDeCierre,
  fueAplicada,
  historialDeRespuesta,
  HUECO,
  huecos,
  initialAssistantState,
  MINIMO_DE_BORRADORES,
  modoDelAsistente,
  motivoEstructural,
  type NumeroPregunta,
  pregunta,
  PREGUNTA_DE_CIERRE,
  PREGUNTAS,
  PREGUNTAS_DE_LA_FRASE,
  PREGUNTAS_OBLIGATORIAS,
  procedencia,
  puedeCerrarse,
  registrarSugerencia,
  replayAssistant,
  type Respuesta,
  respuestaDe,
  type ResumenSugerido,
  sePuedePedirConsentimiento,
  siguientePregunta,
  SIN_IA,
  type Sugerencia,
  type SugerenciaId,
  sugerenciaId,
  tasaDeAceptacionColectiva,
  TEXTO_DEL_MOTIVO,
  textoSugerido,
  UMBRAL_DE_FRICCION,
  verifyAssistantLog,
} from '../src/assistant/index.js';
import { DomainError, PreconditionError } from '../src/errors.js';
import {
  type EventId,
  eventId,
  type Instant,
  instant,
  type MemberId,
  memberId,
} from '../src/ids.js';
import { appendChained } from '../src/workspace/chain.js';
import { InvalidTextError } from '../src/workspace/text.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Utilidades
// ═════════════════════════════════════════════════════════════════════════════════════════════

const hex = (n: number): string => n.toString(16).padStart(32, '0');

const BORRADOR: BorradorId = borradorId(hex(1));
const ANA: MemberId = memberId(hex(0xa11a));
const BETO: MemberId = memberId(hex(0xbe70));

const DESTINO: DestinoIA = {
  aDondeVa: 'Un servicio de redacción que corre fuera de la Universidad',
  queSeManda: 'Sólo el pedazo de texto que estás escribiendo ahora',
  queNoSeManda: 'Tu nombre, tu correo y lo que hayas escrito antes',
  enLaMismaMaquina: false,
};

const OTRO_DESTINO: DestinoIA = { ...DESTINO, aDondeVa: 'Otro servicio distinto' };

let reloj = 1_700_000_000_000;
let contador = 100;

function meta(actor: MemberId): AssistantCommandMeta {
  contador += 1;
  reloj += 1_000;
  return { eventId: eventId(hex(contador)), occurredAt: instant(reloj), actor };
}

function metaSistema(): { readonly eventId: EventId; readonly occurredAt: Instant } {
  contador += 1;
  reloj += 1_000;
  return { eventId: eventId(hex(contador)), occurredAt: instant(reloj) };
}

/**
 * El `code` del rechazo, o una cadena que dice qué pasó en su lugar.
 *
 * Se comprueba el código y no el mensaje: el código es estable y sirve para i18n; el mensaje se
 * reescribe cuando alguien lo mejora, y una prueba atada al mensaje convierte cada mejora de
 * redacción en una prueba roja.
 */
function codigoAlLanzar(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : `no es DomainError: ${String(error)}`;
  }
  return 'no lanzó';
}

const frase = (texto: string): Respuesta => ({ forma: 'frase', texto });
const lineas = (...ls: string[]): Respuesta => ({ forma: 'lineas', lineas: ls });

/** Un borrador en construcción: acumula el historial como lo haría la capa de aplicación. */
class Borrador {
  log: AssistantLog = [];

  async añadir(hacer: (log: AssistantLog) => Promise<AssistantEvent>): Promise<AssistantEvent> {
    const evento = await hacer(this.log);
    this.log = [...this.log, evento];
    return evento;
  }

  estado(): AssistantState {
    return replayAssistant(BORRADOR, this.log);
  }
}

async function borradorAbierto(): Promise<Borrador> {
  const b = new Borrador();
  await b.añadir((log) => abrirBorrador(BORRADOR, log, meta(ANA)));
  return b;
}

async function conConsentimiento(destino: DestinoIA = DESTINO): Promise<Borrador> {
  const b = await borradorAbierto();
  await b.añadir((log) =>
    decidirConsentimiento(BORRADOR, log, { concedido: true, destino }, meta(ANA)),
  );
  return b;
}

const resumen = (texto: string): Sugerencia<ResumenSugerido> => ({
  clase: 'sugerencia',
  operacion: 'resumir',
  contenido: { resumen: textoSugerido(texto) },
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las 27 preguntas, contra el documento
// ═════════════════════════════════════════════════════════════════════════════════════════════

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC = join(RAIZ, 'docs', 'research', '03-deliberativa-sistemas-antipatrones.md');

/** Extrae del documento el bloque de §3.1 que va de las preguntas literales al cierre. */
function bloqueDeLasPreguntas(): readonly string[] {
  const texto = readFileSync(DOC, 'utf8');
  const desde = texto.indexOf('**Preguntas literales de la interfaz:**');
  const hasta = texto.indexOf('*Cierre — la frase armada');
  expect(desde).toBeGreaterThan(-1);
  expect(hasta).toBeGreaterThan(desde);
  return texto.slice(desde, hasta).split('\n');
}

function preguntasDelDocumento(): ReadonlyMap<number, string> {
  const salida = new Map<number, string>();
  for (const linea of bloqueDeLasPreguntas()) {
    const m = /^(\d{1,2})\.\s+(?:\(por cada causa\)\s+)?«([^»]*)»/u.exec(linea);
    if (m === null) continue;
    salida.set(Number(m[1]), m[2] ?? '');
  }
  return salida;
}

function plantillaDelDocumento(): { readonly frase: string; readonly pregunta: string } {
  const texto = readFileSync(DOC, 'utf8');
  const linea = texto.split('\n').find((l) => l.startsWith('> «Como '));
  expect(linea).toBeDefined();
  const m = /^> «(.+)» — «(.+)»$/u.exec(linea ?? '');
  expect(m).not.toBeNull();
  return { frase: m?.[1] ?? '', pregunta: m?.[2] ?? '' };
}

describe('las 27 preguntas son las del documento, literales', () => {
  const delDoc = preguntasDelDocumento();

  it('el documento sigue teniendo 27 preguntas numeradas de 1 a 27', () => {
    expect(delDoc.size).toBe(27);
    for (let n = 1; n <= 27; n++) expect(delDoc.has(n)).toBe(true);
  });

  it('cada pregunta del código coincide carácter a carácter con la del documento', () => {
    expect(PREGUNTAS).toHaveLength(CUANTAS_PREGUNTAS);
    for (const q of PREGUNTAS) {
      expect(q.texto).toBe(delDoc.get(q.numero));
    }
  });

  it('los números son densos, únicos y ordenados', () => {
    expect(PREGUNTAS.map((q) => q.numero)).toEqual(
      Array.from({ length: 27 }, (_, i) => (i + 1) as NumeroPregunta),
    );
  });

  it('todos los textos están normalizados en NFC y ninguno está vacío', () => {
    for (const q of PREGUNTAS) {
      expect(q.texto.normalize('NFC')).toBe(q.texto);
      expect(q.texto.trim()).not.toBe('');
    }
  });

  it('sólo la 1 y la 11 son obligatorias', () => {
    expect(PREGUNTAS.filter((q) => q.obligatoria).map((q) => q.numero)).toEqual([1, 11]);
    expect([...PREGUNTAS_OBLIGATORIAS]).toEqual([1, 11]);
    expect(esObligatoria(1)).toBe(true);
    expect(esObligatoria(11)).toBe(true);
    for (const q of PREGUNTAS) {
      if (q.numero !== 1 && q.numero !== 11) expect(esObligatoria(q.numero)).toBe(false);
    }
  });

  it('la 6 y la 11 se responden en lista, y la 7 enumera las líneas de la 6', () => {
    expect(pregunta(6).forma).toBe('lineas');
    expect(pregunta(11).forma).toBe('lineas');
    expect(pregunta(7).forma).toBe('por_linea');
    expect(pregunta(7).porCadaLineaDe).toBe(6);
    expect(PREGUNTAS.filter((q) => q.forma === 'por_linea')).toHaveLength(1);
  });

  it('la 2, la 6, la 11 y la 27 muestran cosas parecidas ya ocurridas', () => {
    expect(PREGUNTAS.filter((q) => q.muestraMemoria).map((q) => q.numero)).toEqual([2, 6, 11, 27]);
  });

  it('ninguna pregunta usa jerga de gestión de proyectos (ADR-0041)', () => {
    const jerga = [
      'teoría del cambio',
      'indicador',
      'línea base',
      'producto esperado',
      'stakeholder',
      'entregable',
      'KPI',
      'impacto esperado',
      'marco lógico',
    ];
    const todo = PREGUNTAS.map((q) => q.texto.toLowerCase()).join(' ');
    for (const palabra of jerga) expect(todo).not.toContain(palabra.toLowerCase());
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La frase de cierre
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('la frase de cierre', () => {
  it('reproduce la plantilla del documento, hueco por hueco', async () => {
    const plantilla = plantillaDelDocumento();
    const b = await borradorAbierto();
    for (const n of PREGUNTAS_DE_LA_FRASE) {
      const q = pregunta(n);
      if (respuestaDe(b.estado(), n) !== undefined) continue;
      const contenido = `RESPUESTA${String(n)}`;
      await b.añadir((log) =>
        escribirRespuesta(
          BORRADOR,
          log,
          { pregunta: n, respuesta: q.forma === 'lineas' ? lineas(contenido) : frase(contenido) },
          meta(ANA),
        ),
      );
    }
    const esperada = plantilla.frase.replace(
      /\*\*\[(\d{1,2})\]\*\*/gu,
      (_todo, n: string) => `RESPUESTA${n}`,
    );
    const armada = fraseDeCierre(b.estado());
    expect(armada.texto).toBe(esperada);
    expect(armada.pregunta).toBe(plantilla.pregunta);
    expect(PREGUNTA_DE_CIERRE).toBe('¿Suena bien? ¿Falta algo?');
    expect(armada.completa).toBe(true);
    expect(armada.huecos).toEqual([]);
  });

  it('el orden de las preguntas de la plantilla es el declarado, con la 2 dos veces', () => {
    const plantilla = plantillaDelDocumento();
    const orden = [...plantilla.frase.matchAll(/\*\*\[(\d{1,2})\]\*\*/gu)].map((m) => Number(m[1]));
    expect(orden).toEqual([...PREGUNTAS_DE_LA_FRASE]);
    expect(orden.filter((n) => n === 2)).toHaveLength(2);
  });

  it('sobre un borrador vacío no lanza: sale la frase entera con huecos', () => {
    const vacio = initialAssistantState(BORRADOR);
    const armada = fraseDeCierre(vacio);
    expect(armada.texto).toContain(HUECO);
    expect(armada.completa).toBe(false);
    expect([...armada.huecos]).toEqual([1, 2, 6, 11, 16, 18, 22, 8, 25]);
  });

  it('enumera varias líneas en castellano: «a, b y c»', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 11, respuesta: lineas('convocar', 'redactar', 'montar') },
        meta(ANA),
      ),
    );
    expect(fraseDeCierre(b.estado()).texto).toContain('vamos a convocar, redactar y montar,');
  });

  it('«todavía no sé» se lee como hueco, no como respuesta', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 1, respuesta: { forma: 'todavia_no_se' } },
        meta(ANA),
      ),
    );
    expect(fraseDeCierre(b.estado()).huecos).toContain(1);
    expect(huecos(b.estado()).find((h) => h.pregunta === 1)?.motivo).toBe('todavia_no_se');
  });

  it('es función pura: no depende del orden en que se respondió', async () => {
    const a = await borradorAbierto();
    await a.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('falta luz') }, meta(ANA)),
    );
    await a.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 22, respuesta: frase('habría luz') }, meta(ANA)),
    );

    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 22, respuesta: frase('habría luz') }, meta(ANA)),
    );
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('falta luz') }, meta(ANA)),
    );

    expect(fraseDeCierre(a.estado()).texto).toBe(fraseDeCierre(b.estado()).texto);
  });

  it('no se guarda en ningún evento: no puede desincronizarse', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('lo primero') }, meta(ANA)),
    );
    const antes = fraseDeCierre(b.estado()).texto;
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 1, respuesta: frase('lo corregido') },
        meta(ANA),
      ),
    );
    expect(fraseDeCierre(b.estado()).texto).not.toBe(antes);
    expect(fraseDeCierre(b.estado()).texto).toContain('lo corregido');
    const serializado = JSON.stringify(b.log);
    expect(serializado).not.toContain('Como ');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Máquina de estados
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('la máquina de estados del borrador', () => {
  it('sólo se abre desde inexistente', () => {
    expect(eventosLegalesDesde('inexistente')).toEqual(['BorradorAbierto']);
    expect(esTransicionLegal('inexistente', 'RespuestaEscrita')).toBe(false);
  });

  it('cerrado es absorbente', () => {
    expect(eventosLegalesDesde('cerrado')).toEqual([]);
  });

  it('escribir, sugerir, aplicar y consentir dejan el borrador donde estaba', () => {
    for (const evento of [
      'RespuestaEscrita',
      'SugerenciaRecibida',
      'SugerenciaAplicada',
      'ConsentimientoDecidido',
    ] as const) {
      expect(esTransicionLegal('redactando', evento)).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El borrador: abrir, responder, cerrar
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el borrador', () => {
  it('se cierra con la 1 y la 11 respondidas, y con las otras 25 en blanco', async () => {
    const b = await borradorAbierto();
    expect(puedeCerrarse(b.estado())).toBe(false);
    expect([...faltanObligatorias(b.estado())]).toEqual([1, 11]);

    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 1, respuesta: frase('la sala de estudio cierra a las 5') },
        meta(ANA),
      ),
    );
    expect(puedeCerrarse(b.estado())).toBe(false);

    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 11, respuesta: lineas('conseguir la llave', 'redactar la carta') },
        meta(ANA),
      ),
    );
    expect(puedeCerrarse(b.estado())).toBe(true);

    await b.añadir((log) => cerrarBorrador(BORRADOR, log, meta(ANA)));
    expect(b.estado().estado).toBe('cerrado');
    expect(huecos(b.estado())).toHaveLength(25);
    expect(huecos(b.estado()).every((h) => !h.bloquea)).toBe(true);
  });

  it('no se cierra sin la 1', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 11, respuesta: lineas('hacer algo') },
        meta(ANA),
      ),
    );
    await expect(b.añadir((log) => cerrarBorrador(BORRADOR, log, meta(ANA)))).rejects.toMatchObject(
      { code: 'MANDATORY_ANSWERS_MISSING' },
    );
  });

  it('no se cierra sin la 11', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('pasa algo') }, meta(ANA)),
    );
    await expect(b.añadir((log) => cerrarBorrador(BORRADOR, log, meta(ANA)))).rejects.toMatchObject(
      { code: 'MANDATORY_ANSWERS_MISSING' },
    );
  });

  it('«todavía no sé» en la 1 no permite cerrar, pero se guarda como hueco', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 1, respuesta: { forma: 'todavia_no_se' } },
        meta(ANA),
      ),
    );
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 11, respuesta: lineas('hacer algo') },
        meta(ANA),
      ),
    );
    expect(puedeCerrarse(b.estado())).toBe(false);
    expect(respuestaDe(b.estado(), 1)?.respuesta.forma).toBe('todavia_no_se');
  });

  it('no se reabre después de cerrado', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('pasa algo') }, meta(ANA)),
    );
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 11, respuesta: lineas('hacer algo') },
        meta(ANA),
      ),
    );
    await b.añadir((log) => cerrarBorrador(BORRADOR, log, meta(ANA)));
    await expect(
      b.añadir((log) =>
        escribirRespuesta(BORRADOR, log, { pregunta: 3, respuesta: frase('otra cosa') }, meta(ANA)),
      ),
    ).rejects.toThrow(/transición ilegal/u);
  });

  it('nadie escribe en el borrador de otra persona', async () => {
    const b = await borradorAbierto();
    await expect(
      b.añadir((log) =>
        escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('me meto') }, meta(BETO)),
      ),
    ).rejects.toMatchObject({ code: 'NOT_THE_AUTHOR' });
  });

  it('la respuesta tiene que tener la forma que pide la pregunta', async () => {
    const b = await borradorAbierto();
    await expect(
      b.añadir((log) =>
        escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: lineas('a', 'b') }, meta(ANA)),
      ),
    ).rejects.toMatchObject({ code: 'ANSWER_SHAPE_MISMATCH' });
  });

  it('la 7 tiene tantas casillas como causas hay en la 6', async () => {
    const b = await borradorAbierto();
    await expect(
      b.añadir((log) =>
        escribirRespuesta(
          BORRADOR,
          log,
          { pregunta: 7, respuesta: { forma: 'por_linea', porLinea: ['lo vi'] } },
          meta(ANA),
        ),
      ),
    ).rejects.toMatchObject({ code: 'NOTHING_TO_ENUMERATE' });

    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 6, respuesta: lineas('no hay plata', 'nadie avisa') },
        meta(ANA),
      ),
    );
    await expect(
      b.añadir((log) =>
        escribirRespuesta(
          BORRADOR,
          log,
          { pregunta: 7, respuesta: { forma: 'por_linea', porLinea: ['lo vi'] } },
          meta(ANA),
        ),
      ),
    ).rejects.toMatchObject({ code: 'LINE_COUNT_MISMATCH' });

    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 7, respuesta: { forma: 'por_linea', porLinea: ['lo vi', 'me lo contaron'] } },
        meta(ANA),
      ),
    );
    expect(respuestaDe(b.estado(), 7)?.respuesta.forma).toBe('por_linea');
  });

  it('corregir la 6 descuadra la 7, y el sistema lo avisa sin arreglarlo solo', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 6, respuesta: lineas('no hay plata', 'nadie avisa') },
        meta(ANA),
      ),
    );
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 7, respuesta: { forma: 'por_linea', porLinea: ['lo vi', 'me lo contaron'] } },
        meta(ANA),
      ),
    );
    expect(desajustes(b.estado())).toEqual([]);

    // Corregir la 6 nunca se bloquea: quien escribe manda.
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 6, respuesta: lineas('no hay plata', 'nadie avisa', 'el salón está lejos') },
        meta(ANA),
      ),
    );
    expect(desajustes(b.estado())).toEqual([
      { pregunta: 7, deLaPregunta: 6, tiene: 2, deberiaTener: 3 },
    ]);
    // Y no se toca lo que la persona escribió en la 7: se avisa, no se recorta.
    expect(respuestaDe(b.estado(), 7)?.respuesta).toEqual({
      forma: 'por_linea',
      porLinea: ['lo vi', 'me lo contaron'],
    });
    expect(ayudaEstructural(b.estado(), 7, SIN_IA).desajustes).toHaveLength(1);
  });

  it('rechaza texto sin normalizar, y el error que sale es el del dominio', async () => {
    const b = await borradorAbierto();
    const promesa = b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 1, respuesta: frase('sin normalizar: e\u0301') },
        meta(ANA),
      ),
    );
    // No «no está en NFC», que también es cierto y no le sirve a quien está escribiendo: la orden
    // pliega antes de sellar precisamente para que salga este.
    await expect(promesa).rejects.toBeInstanceOf(InvalidTextError);
    await expect(promesa).rejects.toMatchObject({ code: 'INVALID_TEXT' });
  });

  it('la cadena se verifica y el historial se vuelve a plegar igual', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('pasa algo') }, meta(ANA)),
    );
    const estado = await verifyAssistantLog(BORRADOR, b.log);
    expect(estado).toEqual(b.estado());
  });

  it('cuenta cuántas preguntas quedaron respondidas de verdad', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('una') }, meta(ANA)),
    );
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('otra') }, meta(ANA)),
    );
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 3, respuesta: { forma: 'todavia_no_se' } },
        meta(ANA),
      ),
    );
    expect(cuantasRespondidas(b.estado())).toBe(1);
    expect(historialDeRespuesta(b.estado(), 1)).toHaveLength(2);
  });

  it('la siguiente pregunta salta las ya respondidas', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 2, respuesta: frase('a quienes') }, meta(ANA)),
    );
    expect(siguientePregunta(b.estado(), 1)).toBe(3);
    expect(siguientePregunta(b.estado(), 27)).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Consentimiento
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el consentimiento', () => {
  it('sin consentimiento no entra ninguna sugerencia', async () => {
    const b = await borradorAbierto();
    await expect(
      b.añadir((log) =>
        registrarSugerencia(
          BORRADOR,
          log,
          {
            sugerenciaId: sugerenciaId(hex(0x5001)),
            sugerencia: resumen('un resumen'),
            pregunta: 1,
            destino: DESTINO,
          },
          metaSistema(),
        ),
      ),
    ).rejects.toMatchObject({ code: 'NO_CONSENT_FOR_DESTINATION' });
  });

  it('el consentimiento vale para el destino que se describió, no para otro', async () => {
    const b = await conConsentimiento(DESTINO);
    expect(consentimientoCubre(b.estado(), DESTINO)).toBe(true);
    expect(consentimientoCubre(b.estado(), OTRO_DESTINO)).toBe(false);
    await expect(
      b.añadir((log) =>
        registrarSugerencia(
          BORRADOR,
          log,
          {
            sugerenciaId: sugerenciaId(hex(0x5002)),
            sugerencia: resumen('un resumen'),
            pregunta: 1,
            destino: OTRO_DESTINO,
          },
          metaSistema(),
        ),
      ),
    ).rejects.toMatchObject({ code: 'NO_CONSENT_FOR_DESTINATION' });
  });

  it('decir que no degrada al modo sin IA y el sistema no vuelve a preguntar', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      decidirConsentimiento(BORRADOR, log, { concedido: false, destino: DESTINO }, meta(ANA)),
    );
    const estado = b.estado();
    expect(sePuedePedirConsentimiento(estado)).toBe(false);
    expect(modoDelAsistente(estado, { hayProveedor: true, destino: DESTINO })).toBe('estructural');
    expect(motivoEstructural(estado, { hayProveedor: true, destino: DESTINO })).toBe(
      'consentimiento_negado',
    );
    // Sin penalización: el formulario entero sigue en pie.
    const ayuda = ayudaEstructural(estado, 1, { hayProveedor: true, destino: DESTINO });
    expect(ayuda.pregunta.texto).toBe(pregunta(1).texto);
    expect(ayuda.porQueNoHaySugerencias).toBe(TEXTO_DEL_MOTIVO.consentimiento_negado);
    expect(ayuda.porQueNoHaySugerencias).not.toMatch(/[Pp]erdés|[Pp]erderás|mejor|recomend/u);
  });

  it('la persona puede cambiar de idea por su cuenta', async () => {
    const b = await borradorAbierto();
    await b.añadir((log) =>
      decidirConsentimiento(BORRADOR, log, { concedido: false, destino: DESTINO }, meta(ANA)),
    );
    await b.añadir((log) =>
      decidirConsentimiento(BORRADOR, log, { concedido: true, destino: DESTINO }, meta(ANA)),
    );
    expect(consentimientoCubre(b.estado(), DESTINO)).toBe(true);
    expect(sePuedePedirConsentimiento(b.estado())).toBe(true);
  });

  it('sólo el autor decide sobre su propio texto', async () => {
    const b = await borradorAbierto();
    await expect(
      b.añadir((log) =>
        decidirConsentimiento(BORRADOR, log, { concedido: true, destino: DESTINO }, meta(BETO)),
      ),
    ).rejects.toMatchObject({ code: 'NOT_THE_AUTHOR' });
  });

  it('la petición sólo lleva el fragmento, nunca la identidad ni el historial', async () => {
    const b = await conConsentimiento();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('lo de antes') }, meta(ANA)),
    );
    const peticion = construirPeticion(
      b.estado(),
      { hayProveedor: true, destino: DESTINO },
      { operacion: 'resumir', fragmento: 'la sala cierra a las 5' },
    );
    expect(Object.keys(peticion).sort()).toEqual(['conQueComparar', 'fragmento', 'operacion']);
    expect(JSON.stringify(peticion)).not.toContain(ANA);
    expect(JSON.stringify(peticion)).not.toContain(BORRADOR);
    expect(JSON.stringify(peticion)).not.toContain('lo de antes');
  });

  it('la petición se rechaza si el fragmento lleva algo con forma de identificador', async () => {
    const b = await conConsentimiento();
    expect(
      codigoAlLanzar(() =>
        construirPeticion(
          b.estado(),
          { hayProveedor: true, destino: DESTINO },
          { operacion: 'resumir', fragmento: `mirá el caso ${hex(0xabc)}` },
        ),
      ),
    ).toBe('AI_IDENTITY_LEAK');
  });

  it('sin consentimiento no se puede ni construir la petición', async () => {
    const b = await borradorAbierto();
    expect(
      codigoAlLanzar(() =>
        construirPeticion(
          b.estado(),
          { hayProveedor: true, destino: DESTINO },
          { operacion: 'resumir', fragmento: 'algo' },
        ),
      ),
    ).toBe('AI_NOT_AVAILABLE');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Sugerencias: procedencia y límites
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('las sugerencias', () => {
  const SUG: SugerenciaId = sugerenciaId(hex(0x7001));

  async function conSugerencia(texto = 'la sala cierra temprano'): Promise<Borrador> {
    const b = await conConsentimiento();
    await b.añadir((log) =>
      registrarSugerencia(
        BORRADOR,
        log,
        { sugerenciaId: SUG, sugerencia: resumen(texto), pregunta: 1, destino: DESTINO },
        metaSistema(),
      ),
    );
    return b;
  }

  it('recibir una sugerencia no cambia ninguna respuesta', async () => {
    const b = await conSugerencia();
    expect(b.estado().sugerencias).toHaveLength(1);
    expect(respuestaDe(b.estado(), 1)).toBeUndefined();
    expect(puedeCerrarse(b.estado())).toBe(false);
    expect(fraseDeCierre(b.estado()).huecos).toContain(1);
  });

  it('la registra el sistema, jamás una persona', async () => {
    const b = await conSugerencia();
    const forjado = await appendChained<AssistantPayload>(b.log, {
      eventId: eventId(hex(0x9001)),
      aggregateId: BORRADOR,
      occurredAt: instant(reloj + 5_000),
      actor: ANA,
      payload: {
        type: 'SugerenciaRecibida',
        sugerencia: {
          sugerenciaId: sugerenciaId(hex(0x7002)),
          operacion: 'resumir',
          pregunta: 1,
          textos: ['algo'],
          destino: DESTINO,
        },
      },
    });
    expect(codigoAlLanzar(() => applyAssistant(b.estado(), forjado))).toBe(
      'SUGGESTION_MUST_BE_SYSTEM',
    );
  });

  it('aplicarla es un acto de una persona, y queda con su nombre', async () => {
    const b = await conSugerencia();
    await b.añadir((log) =>
      aplicarSugerencia(
        BORRADOR,
        log,
        { sugerenciaId: SUG, pregunta: 1, respuesta: frase('la sala cierra temprano') },
        meta(ANA),
      ),
    );
    const estado = b.estado();
    expect(fueAplicada(estado, SUG)).toBe(true);
    expect(respuestaDe(estado, 1)?.origen).toBe('sugerencia');
    expect(procedencia(estado)).toEqual([
      {
        pregunta: 1,
        origen: 'sugerencia',
        sugerenciaId: SUG,
        escritaEn: b.log.at(-1)?.occurredAt,
        seq: b.log.at(-1)?.seq,
        versiones: 1,
      },
    ]);
    expect(b.log.at(-1)?.actor).toBe(ANA);
  });

  it('no se acepta una sugerencia que nunca se recibió', async () => {
    const b = await conConsentimiento();
    await expect(
      b.añadir((log) =>
        aplicarSugerencia(
          BORRADOR,
          log,
          { sugerenciaId: sugerenciaId(hex(0x7099)), pregunta: 1, respuesta: frase('inventado') },
          meta(ANA),
        ),
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SUGGESTION' });
  });

  it('no se puede colar un texto que la máquina no propuso', async () => {
    const b = await conSugerencia();
    await expect(
      b.añadir((log) =>
        aplicarSugerencia(
          BORRADOR,
          log,
          { sugerenciaId: SUG, pregunta: 1, respuesta: frase('esto lo escribí yo') },
          meta(ANA),
        ),
      ),
    ).rejects.toMatchObject({ code: 'TEXT_NOT_IN_SUGGESTION' });
  });

  it('no se aplica dos veces', async () => {
    const b = await conSugerencia();
    const aplicar = (log: AssistantLog): Promise<AssistantEvent> =>
      aplicarSugerencia(
        BORRADOR,
        log,
        { sugerenciaId: SUG, pregunta: 1, respuesta: frase('la sala cierra temprano') },
        meta(ANA),
      );
    await b.añadir(aplicar);
    await expect(b.añadir(aplicar)).rejects.toMatchObject({ code: 'SUGGESTION_ALREADY_APPLIED' });
  });

  it('no se aplica a una pregunta distinta de la que se pidió', async () => {
    const b = await conSugerencia();
    await expect(
      b.añadir((log) =>
        aplicarSugerencia(
          BORRADOR,
          log,
          { sugerenciaId: SUG, pregunta: 3, respuesta: frase('la sala cierra temprano') },
          meta(ANA),
        ),
      ),
    ).rejects.toMatchObject({ code: 'SUGGESTION_SCOPE_MISMATCH' });
  });

  it('una máquina no puede proponer «todavía no sé»', async () => {
    const b = await conSugerencia();
    await expect(
      b.añadir((log) =>
        aplicarSugerencia(
          BORRADOR,
          log,
          { sugerenciaId: SUG, pregunta: 1, respuesta: { forma: 'todavia_no_se' } },
          meta(ANA),
        ),
      ),
    ).rejects.toMatchObject({ code: 'CANNOT_SUGGEST_IGNORANCE' });
  });

  it('lo escrito a mano después prevalece sobre la sugerencia aceptada antes', async () => {
    const b = await conSugerencia();
    await b.añadir((log) =>
      aplicarSugerencia(
        BORRADOR,
        log,
        { sugerenciaId: SUG, pregunta: 1, respuesta: frase('la sala cierra temprano') },
        meta(ANA),
      ),
    );
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 1, respuesta: frase('en realidad cierra a las 5 y media') },
        meta(ANA),
      ),
    );
    const vigente = respuestaDe(b.estado(), 1);
    expect(vigente?.origen).toBe('mano');
    expect(vigente?.sugerenciaId).toBeUndefined();
    // Y la sugerencia sigue en el historial: la procedencia no se borra, se apila.
    expect(historialDeRespuesta(b.estado(), 1).map((v) => v.origen)).toEqual([
      'sugerencia',
      'mano',
    ]);
    expect(b.estado().aplicadas).toEqual([SUG]);
  });

  it('el conteo del borrador no lleva identidad', async () => {
    const b = await conSugerencia();
    const conteo = conteoDeSugerencias(b.estado());
    expect(conteo).toEqual({ ofrecidas: 1, aplicadas: 0 });
    expect(Object.keys(conteo).sort()).toEqual(['aplicadas', 'ofrecidas']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La tasa colectiva
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('la tasa de aceptación se mide sobre el colectivo', () => {
  const conteo = (ofrecidas: number, aplicadas: number) => ({ ofrecidas, aplicadas });

  it('no se publica con pocos borradores: hablaría de personas concretas', () => {
    const pocos = Array.from({ length: MINIMO_DE_BORRADORES - 1 }, () => conteo(4, 4));
    const tasa = tasaDeAceptacionColectiva(pocos);
    expect(tasa.hayDatos).toBe(false);
  });

  it('suma sobre todos los borradores y da una fracción exacta', () => {
    const conteos = [conteo(4, 1), conteo(4, 1), conteo(4, 1), conteo(4, 1), conteo(4, 0)];
    const tasa = tasaDeAceptacionColectiva(conteos);
    expect(tasa.hayDatos).toBe(true);
    if (!tasa.hayDatos) return;
    expect(tasa.ofrecidas).toBe(20);
    expect(tasa.aplicadas).toBe(4);
    expect(tasa.tasa).toEqual({ num: 4n, den: 20n });
    expect(tasa.enFriccion).toBe(false);
  });

  it('el umbral es exactamente tres cuartos, sin coma flotante', () => {
    expect(UMBRAL_DE_FRICCION).toEqual({ num: 3n, den: 4n });
    const justo = Array.from({ length: 5 }, () => conteo(4, 3));
    const tasaJusta = tasaDeAceptacionColectiva(justo);
    expect(tasaJusta.hayDatos && tasaJusta.enFriccion).toBe(true);

    const apenasDebajo = [conteo(4, 3), conteo(4, 3), conteo(4, 3), conteo(4, 3), conteo(4, 2)];
    const tasaDebajo = tasaDeAceptacionColectiva(apenasDebajo);
    expect(tasaDebajo.hayDatos && tasaDebajo.enFriccion).toBe(false);
  });

  it('sin sugerencias ofrecidas no hay nada que medir', () => {
    const tasa = tasaDeAceptacionColectiva(Array.from({ length: 6 }, () => conteo(0, 0)));
    expect(tasa.hayDatos).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El modo sin IA
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el despliegue sin ningún proveedor de IA', () => {
  it('el modo por defecto es estructural y el motivo se dice sin drama', () => {
    const vacio = initialAssistantState(BORRADOR);
    expect(modoDelAsistente(vacio, SIN_IA)).toBe('estructural');
    expect(motivoEstructural(vacio, SIN_IA)).toBe('sin_proveedor');
    expect(TEXTO_DEL_MOTIVO.sin_proveedor).toContain('funcionan igual');
  });

  it('la ayuda estructural entrega las 27 preguntas y la frase, y no lanza en ningún estado', async () => {
    const estados: AssistantState[] = [initialAssistantState(BORRADOR)];
    const b = await borradorAbierto();
    estados.push(b.estado());
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('pasa algo') }, meta(ANA)),
    );
    estados.push(b.estado());
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 11, respuesta: lineas('hacer algo') },
        meta(ANA),
      ),
    );
    await b.añadir((log) => cerrarBorrador(BORRADOR, log, meta(ANA)));
    estados.push(b.estado());

    for (const estado of estados) {
      for (const q of PREGUNTAS) {
        const ayuda = ayudaEstructural(estado, q.numero, SIN_IA);
        expect(ayuda.modo).toBe('estructural');
        expect(ayuda.pregunta.texto).toBe(q.texto);
        expect(ayuda.rotulo).not.toBe('');
        expect(ayuda.frase.texto).toContain('Como ');
        expect(ayuda.porQueNoHaySugerencias).not.toBe('');
      }
    }
  });

  it('un borrador cerrado no vuelve a modo generativo aunque haya proveedor y consentimiento', async () => {
    const b = await conConsentimiento();
    await b.añadir((log) =>
      escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('pasa algo') }, meta(ANA)),
    );
    await b.añadir((log) =>
      escribirRespuesta(
        BORRADOR,
        log,
        { pregunta: 11, respuesta: lineas('hacer algo') },
        meta(ANA),
      ),
    );
    await b.añadir((log) => cerrarBorrador(BORRADOR, log, meta(ANA)));
    const disponible = { hayProveedor: true, destino: DESTINO };
    expect(modoDelAsistente(b.estado(), disponible)).toBe('estructural');
    expect(motivoEstructural(b.estado(), disponible)).toBe('borrador_cerrado');
  });

  it('el agregado se comporta igual con y sin sugerencias, salvo por su ausencia', async () => {
    const escribir = async (b: Borrador): Promise<void> => {
      await b.añadir((log) =>
        escribirRespuesta(BORRADOR, log, { pregunta: 1, respuesta: frase('pasa esto') }, meta(ANA)),
      );
      await b.añadir((log) =>
        escribirRespuesta(
          BORRADOR,
          log,
          { pregunta: 11, respuesta: lineas('convocar') },
          meta(ANA),
        ),
      );
    };

    const sinIa = await borradorAbierto();
    await escribir(sinIa);

    const conIa = await conConsentimiento();
    await conIa.añadir((log) =>
      registrarSugerencia(
        BORRADOR,
        log,
        {
          sugerenciaId: sugerenciaId(hex(0x8001)),
          sugerencia: resumen('algo que nadie tomó'),
          pregunta: 1,
          destino: DESTINO,
        },
        metaSistema(),
      ),
    );
    await escribir(conIa);

    expect(fraseDeCierre(conIa.estado()).texto).toBe(fraseDeCierre(sinIa.estado()).texto);
    expect(huecos(conIa.estado())).toEqual(huecos(sinIa.estado()));
    expect(puedeCerrarse(conIa.estado())).toBe(puedeCerrarse(sinIa.estado()));
    expect(conIa.estado().sugerencias).toHaveLength(1);
    expect(sinIa.estado().sugerencias).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El pliegue rechaza historiales forjados
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el pliegue, que es por donde pasa todo historial', () => {
  it('rechaza un evento de otro borrador', async () => {
    const b = await borradorAbierto();
    const ajeno = await appendChained<AssistantPayload>(b.log, {
      eventId: eventId(hex(0x9101)),
      aggregateId: borradorId(hex(2)),
      occurredAt: instant(reloj + 9_000),
      actor: ANA,
      payload: { type: 'RespuestaEscrita', pregunta: 1, respuesta: frase('de otro sitio') },
    });
    expect(codigoAlLanzar(() => applyAssistant(b.estado(), ajeno))).toBe('WRONG_AGGREGATE');
  });

  it('rechaza una secuencia con huecos', async () => {
    const b = await borradorAbierto();
    const evento = await appendChained<AssistantPayload>(b.log, {
      eventId: eventId(hex(0x9102)),
      aggregateId: BORRADOR,
      occurredAt: instant(reloj + 9_000),
      actor: ANA,
      payload: { type: 'RespuestaEscrita', pregunta: 1, respuesta: frase('adelantada') },
    });
    expect(codigoAlLanzar(() => applyAssistant(initialAssistantState(BORRADOR), evento))).toBe(
      'NON_DENSE_SEQ',
    );
  });

  it('rechaza un borrador abierto por el sistema', async () => {
    const evento = await appendChained<AssistantPayload>([], {
      eventId: eventId(hex(0x9103)),
      aggregateId: BORRADOR,
      occurredAt: instant(reloj + 9_000),
      actor: 'system',
      payload: { type: 'BorradorAbierto' },
    });
    expect(codigoAlLanzar(() => applyAssistant(initialAssistantState(BORRADOR), evento))).toBe(
      'SYSTEM_CANNOT_OPEN',
    );
  });

  it('rechaza una sugerencia con un número donde debería haber texto', async () => {
    const b = await conConsentimiento();
    const evento = await appendChained<AssistantPayload>(b.log, {
      eventId: eventId(hex(0x9104)),
      aggregateId: BORRADOR,
      occurredAt: instant(reloj + 9_000),
      actor: 'system',
      payload: {
        type: 'SugerenciaRecibida',
        sugerencia: {
          sugerenciaId: sugerenciaId(hex(0x7003)),
          operacion: 'resumir',
          pregunta: 1,
          textos: [42 as unknown as string],
          destino: DESTINO,
        },
      },
    });
    expect(codigoAlLanzar(() => applyAssistant(b.estado(), evento))).toBe('SUGGESTION_NOT_TEXT');
  });

  it('rechaza una operación prohibida aunque venga en el historial', async () => {
    const b = await conConsentimiento();
    // El historial forjado no pasa por los tipos: viene de un fichero. De ahí el `as`.
    const payload = {
      type: 'SugerenciaRecibida',
      sugerencia: {
        sugerenciaId: sugerenciaId(hex(0x7004)),
        operacion: 'puntuar_propuestas',
        pregunta: 1,
        textos: ['la mejor es la B'],
        destino: DESTINO,
      },
    } as unknown as AssistantPayload;
    const evento = await appendChained<AssistantPayload>(b.log, {
      eventId: eventId(hex(0x9105)),
      aggregateId: BORRADOR,
      occurredAt: instant(reloj + 9_000),
      actor: 'system',
      payload,
    });
    expect(codigoAlLanzar(() => applyAssistant(b.estado(), evento))).toBe('FORBIDDEN_AI_OPERATION');
  });

  it('el agregado es alcanzable importando desde `@koinonia/domain`', async () => {
    const paquete = await import('@koinonia/domain');
    // `export *` descarta en silencio los nombres ambiguos: si el asistente chocara con otro
    // agregado, estos símbolos desaparecerían del paquete sin que nada fallara al compilar.
    for (const nombre of [
      'PREGUNTAS',
      'PREGUNTAS_OBLIGATORIAS',
      'fraseDeCierre',
      'ayudaEstructural',
      'abrirBorrador',
      'registrarSugerencia',
      'aplicarSugerencia',
      'assertSugerenciaSinPoder',
      'tasaDeAceptacionColectiva',
      'OPERACIONES_PROHIBIDAS',
      'desajustes',
      'SIN_IA',
    ]) {
      expect(Object.hasOwn(paquete, nombre), `falta ${nombre} en @koinonia/domain`).toBe(true);
    }
    expect(paquete.PREGUNTAS).toHaveLength(27);
  });

  it('los errores del dominio son `PreconditionError`, con código estable', async () => {
    const b = await borradorAbierto();
    await expect(
      b.añadir((log) => cerrarBorrador(BORRADOR, log, meta(ANA))),
    ).rejects.toBeInstanceOf(PreconditionError);
  });
});
