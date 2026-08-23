/**
 * Las 27 preguntas del asistente de acción sistémica, **literales**.
 *
 * ═══ De dónde salen y por qué no se reescriben ═══
 *
 * `docs/research/03-deliberativa-sistemas-antipatrones.md` §3.1 las redactó una por una y explicó el
 * problema que resuelven: la cadena canónica de la gestión de proyectos —problema, supuestos,
 * actividades, productos, resultados, impacto— es correcta e **inusable** tal cual, porque su léxico
 * le comunica a un estudiante de filosofía que este no es su terreno y que va a ser evaluado. Las 27
 * preguntas son esa misma cadena dicha en castellano de Colombia, y su valor está justamente en las
 * palabras exactas. Por eso aquí están **copiadas tal cual**, y hay una prueba que las compara con el
 * documento: reescribirlas «para que queden más claras» es deshacer el trabajo que ya se hizo.
 *
 * Lo único que se les quitó son las comillas angulares « » con las que el documento cita cada
 * pregunta —son el modo de citar de esa prosa, no parte del texto de pantalla— y las anotaciones que
 * el documento pone **fuera** de la cita: «(por cada causa)» en la 7 y «(el sistema sugiere
 * coincidencias de la memoria)» en la 27. Ninguna de las dos es una pregunta; las dos son
 * información sobre **cómo** se hace la pregunta, y aquí viven como campos (`forma`, `muestraMemoria`)
 * en vez de como prosa dentro del texto. Todo lo demás está byte a byte: las comillas rectas de la 2,
 * la 8, la 12, la 20 y la 25 —que en pantalla se verán rectas—, la raya de la 20 y los signos de
 * apertura.
 *
 * ═══ Sólo dos son obligatorias ═══
 *
 * La 1 y la 11. Ninguna otra. Es una regla de diseño, no una omisión: un formulario de 27 campos
 * obligatorios no se llena, se abandona, y lo que queda entonces no es un plan a medias sino nada. Y
 * «todavía no sé» es una respuesta válida **en las 27**, que se guarda como hueco (§3.1) para que más
 * tarde alguien lo convierta en tarea. La diferencia entre las dos obligatorias y el resto es que un
 * hueco en la 1 o en la 11 impide cerrar el borrador; en las otras 25 no impide nada.
 *
 * ═══ Nada de jerga (ADR-0041) ═══
 *
 * En este fichero no aparece «teoría del cambio», ni «producto», ni «resultado», ni «indicador», ni
 * «línea base», ni «impacto». Los ocho rótulos de sección son los del documento —«Arranque», «El
 * problema», «Por qué pasa», «Qué van a hacer», «Qué va a quedar hecho», «Qué cambia en la gente»,
 * «Para qué, al final» y «Riesgo y salida»—, que son ocho frases de conversación y no ocho casillas
 * de un informe.
 */

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Numeración
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El número de una pregunta. Unión cerrada de 27 literales, no `number`.
 *
 * Que sea una unión y no un entero cualquiera tiene dos consecuencias que valen el ruido: un `switch`
 * sobre ella es exhaustivo y el compilador avisa si alguien añade una pregunta 28 sin tratarla; y un
 * número fuera de rango no llega nunca al pliegue, porque no se puede escribir.
 */
export type NumeroPregunta =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27;

/** Cuántas preguntas hay. Si este número cambia, cambió el formulario y eso es una decisión. */
export const CUANTAS_PREGUNTAS = 27;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Agrupación y forma
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Los ocho tramos en que el documento agrupa las preguntas. Son rótulos de pantalla, no etapas. */
export type GrupoPregunta =
  | 'arranque'
  | 'problema'
  | 'causas'
  | 'acciones'
  | 'resultado_visible'
  | 'cambio_en_la_gente'
  | 'proposito'
  | 'riesgo';

export const GRUPOS: readonly GrupoPregunta[] = [
  'arranque',
  'problema',
  'causas',
  'acciones',
  'resultado_visible',
  'cambio_en_la_gente',
  'proposito',
  'riesgo',
];

/** El rótulo visible de cada tramo, tal como lo escribe §3.1. Sin una palabra de gestión. */
export const TITULO_DE_GRUPO: Readonly<Record<GrupoPregunta, string>> = {
  arranque: 'Arranque',
  problema: 'El problema',
  causas: 'Por qué pasa',
  acciones: 'Qué van a hacer',
  resultado_visible: 'Qué va a quedar hecho',
  cambio_en_la_gente: 'Qué cambia en la gente',
  proposito: 'Para qué, al final',
  riesgo: 'Riesgo y salida',
};

/**
 * Cómo se responde una pregunta.
 *
 *  - `frase`     — un texto seguido. Son 24 de las 27.
 *  - `lineas`    — una cosa por línea. Sólo la 6 («escribí una causa por línea») y la 11 («escribí
 *                  acciones que empiecen con un verbo»), que son las dos que el propio texto pide en
 *                  lista.
 *  - `por_linea` — una respuesta **por cada línea** de otra pregunta. Sólo la 7, que el documento
 *                  encabeza con «(por cada causa)» y que por tanto no es una pregunta: son tantas
 *                  como causas escribió quien responde.
 */
export type FormaDeRespuesta = 'frase' | 'lineas' | 'por_linea';

export const FORMAS: readonly FormaDeRespuesta[] = ['frase', 'lineas', 'por_linea'];

export interface Pregunta {
  readonly numero: NumeroPregunta;
  readonly grupo: GrupoPregunta;
  /** El texto literal de §3.1, sin las comillas angulares con que el documento lo cita. */
  readonly texto: string;
  readonly forma: FormaDeRespuesta;
  /** Sólo la 1 y la 11. Ver la cabecera de este fichero. */
  readonly obligatoria: boolean;
  /**
   * Si `forma` es `por_linea`, de qué pregunta enumera las líneas. `undefined` en las otras 26.
   *
   * Es un campo y no un comentario porque la validación de la respuesta lo necesita: la 7 tiene
   * tantas casillas como líneas tenga la 6, ni una más.
   */
  readonly porCadaLineaDe: NumeroPregunta | undefined;
  /**
   * Si al lado del campo se muestran cosas parecidas ya ocurridas.
   *
   * §3.4.4 lo pide para la 2, la 6 y la 11 —«al responder … el sistema busca por categoría y
   * similitud léxica y los muestra **al lado del campo**, no en "documentación"»— y §3.1 lo pide
   * explícitamente para la 27. Marcarlo aquí es lo que permite que **el modo sin proveedor de IA
   * siga sirviendo**: mostrar lo que ya pasó es una búsqueda, no un modelo de lenguaje.
   */
  readonly muestraMemoria: boolean;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las 27
// ═════════════════════════════════════════════════════════════════════════════════════════════

function p(
  numero: NumeroPregunta,
  grupo: GrupoPregunta,
  texto: string,
  forma: FormaDeRespuesta = 'frase',
  extra: {
    readonly obligatoria?: boolean;
    readonly porCadaLineaDe?: NumeroPregunta;
    readonly muestraMemoria?: boolean;
  } = {},
): Pregunta {
  return {
    numero,
    grupo,
    texto,
    forma,
    obligatoria: extra.obligatoria ?? false,
    porCadaLineaDe: extra.porCadaLineaDe,
    muestraMemoria: extra.muestraMemoria ?? false,
  };
}

/**
 * Las 27 preguntas, en orden y literales.
 *
 * El orden **es** el del documento y no se altera: una pregunta por pantalla, y la secuencia lleva de
 * lo que se ve —qué pasa, a quién— a lo que se supone y de ahí a lo que se va a hacer. Cambiar el
 * orden cambia lo que la gente escribe.
 */
export const PREGUNTAS: readonly Pregunta[] = [
  // Arranque
  p(1, 'arranque', 'En una frase: ¿qué está pasando que no debería estar pasando?', 'frase', {
    obligatoria: true,
  }),

  // El problema
  p(
    2,
    'problema',
    '¿A quiénes les pasa esto? Nombralos lo más concreto que puedas: no "los estudiantes", sino "quienes tienen clase después de las 6 p.m.".',
    'frase',
    { muestraMemoria: true },
  ),
  p(3, 'problema', '¿Cómo te diste cuenta? Contá el hecho concreto que te lo hizo ver.'),
  p(4, 'problema', '¿Desde cuándo pasa? ¿Hubo algo que lo empeorara o lo mejorara en ese tiempo?'),
  p(5, 'problema', 'Si nadie hace nada, ¿qué va a pasar de aquí a un año?'),

  // Por qué pasa (causas y supuestos)
  p(
    6,
    'causas',
    '¿Por qué creés que pasa? Escribí una causa por línea, las que se te ocurran.',
    'lineas',
    { muestraMemoria: true },
  ),
  p(
    7,
    'causas',
    'Esto que escribiste, ¿lo viste, te lo contaron, o lo estás suponiendo?',
    'por_linea',
    { porCadaLineaDe: 6 },
  ),
  p(
    8,
    'causas',
    '¿Qué tendría que ser cierto para que tu explicación funcione? Por ejemplo: "que la gente sí quiere venir si le avisan con tiempo".',
  ),
  p(9, 'causas', 'Si eso que estás suponiendo resultara falso, ¿qué parte de tu plan se cae?'),
  p(10, 'causas', '¿Quién podría no estar de acuerdo con esta explicación? ¿Qué diría?'),

  // Qué van a hacer
  p(
    11,
    'acciones',
    '¿Qué van a hacer, concretamente? Escribí acciones que empiecen con un verbo: convocar, redactar, montar, conseguir.',
    'lineas',
    { obligatoria: true, muestraMemoria: true },
  ),
  p(
    12,
    'acciones',
    '¿Quién hace cada una? Poné un nombre, no un cargo. Si todavía no se sabe, escribí "falta".',
  ),
  p(13, 'acciones', '¿Para cuándo estaría hecha cada una?'),
  p(
    14,
    'acciones',
    '¿Qué necesitan que hoy no tienen? (un salón, plata, un permiso, un dato, alguien que sepa de algo)',
  ),
  p(15, 'acciones', '¿Quién tiene que decir que sí para que esto pueda pasar?'),

  // Qué va a quedar hecho
  p(
    16,
    'resultado_visible',
    'Cuando terminen, ¿qué va a existir que hoy no existe? Algo que se pueda señalar: un documento, un horario nuevo, tres talleres dictados, una lista publicada.',
  ),
  p(
    17,
    'resultado_visible',
    '¿Cómo se cuenta eso? (cuántos talleres, cuántas personas, cuántas páginas)',
  ),

  // Qué cambia en la gente
  p(
    18,
    'cambio_en_la_gente',
    '¿Qué van a hacer distinto las personas que nombraste arriba, que hoy no hacen?',
  ),
  p(
    19,
    'cambio_en_la_gente',
    '¿Cómo nos daríamos cuenta de que eso cambió, sin preguntarle a nadie del equipo que lo hizo?',
  ),
  p(
    20,
    'cambio_en_la_gente',
    '¿Cuánto sería "suficiente"? Poné un número aunque sea a ojo — y marcá que es a ojo.',
  ),
  p(21, 'cambio_en_la_gente', '¿En cuánto tiempo esperás verlo: un mes, un semestre, dos años?'),

  // Para qué, al final
  p(
    22,
    'proposito',
    'Si esto sale bien y se sostiene tres años, ¿qué sería distinto en el Instituto?',
  ),
  p(23, 'proposito', 'Eso que sería distinto, ¿depende sólo de ustedes? ¿Qué parte no controlan?'),

  // Riesgo y salida
  p(24, 'riesgo', '¿Qué es lo más probable que salga mal?'),
  p(25, 'riesgo', '¿Qué señal te haría decir "esto no está funcionando, hay que cambiarlo"?'),
  p(26, 'riesgo', '¿Cuándo volvemos a mirar esto para ver cómo va?'),
  p(27, 'riesgo', '¿Alguien ya intentó algo parecido acá? ¿Sabés qué pasó?', 'frase', {
    muestraMemoria: true,
  }),
];

/**
 * Las dos obligatorias: la 1 y la 11.
 *
 * Se declara aparte y **se comprueba** contra `PREGUNTAS` en una prueba, en vez de derivarse de ella:
 * si alguien marca `obligatoria: true` en una tercera pregunta, esta constante y aquel campo
 * discrepan y la prueba falla. Derivarla habría hecho que el cambio pasara sin que nadie se enterara,
 * y ese cambio es exactamente el que no debe pasar en silencio.
 */
export const PREGUNTAS_OBLIGATORIAS: readonly NumeroPregunta[] = [1, 11];

const POR_NUMERO: ReadonlyMap<number, Pregunta> = new Map(PREGUNTAS.map((q) => [q.numero, q]));

/** ¿Es un número de pregunta del formulario? */
export function esNumeroDePregunta(valor: number): valor is NumeroPregunta {
  return POR_NUMERO.has(valor);
}

/**
 * La pregunta con ese número. Total sobre `NumeroPregunta`: no puede fallar.
 *
 * El `throw` es inalcanzable con la unión cerrada y está ahí para el caso en que alguien saque este
 * módulo de su tipado —un `JSON.parse`, un límite de proceso— y pase un 28.
 */
export function pregunta(numero: NumeroPregunta): Pregunta {
  const encontrada = POR_NUMERO.get(numero);
  if (encontrada === undefined) {
    throw new RangeError(`no existe la pregunta ${String(numero)}: el formulario tiene 27`);
  }
  return encontrada;
}

/** Las preguntas de un tramo, en orden. */
export function preguntasDe(grupo: GrupoPregunta): readonly Pregunta[] {
  return PREGUNTAS.filter((q) => q.grupo === grupo);
}

/** ¿Esta pregunta hay que responderla para poder cerrar el borrador? */
export function esObligatoria(numero: NumeroPregunta): boolean {
  return pregunta(numero).obligatoria;
}
