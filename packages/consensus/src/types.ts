/**
 * Tipos del análisis de consenso.
 *
 * Tres principios:
 *
 *  1. **Sin enums, sin jerga**. `Voto` es un literal numérico, no un enum, y los textos visibles al
 *     usuario viven en `index.ts` (ADR-0041).
 *  2. **Inmutabilidad total**. Las estructuras se construyen y se devuelven; no se mutan. El orden
 *     canónico se aplica antes del cálculo y los índices originales siempre van en el resultado.
 *  3. **El silencio es información**. `paso` y `ausente` se representan con valores distintos y no
 *     se colapsan: tienen semántica observacional diferente para el PCA y los grupos, y la salida del
 *     paquete debe poder distinguir quién pasó de quién no respondió.
 */

/** Voto observado: `+1` acuerdo, `-1` desacuerdo, `0` pasó. */
export type VotoObservado = -1 | 0 | 1;

/** Celda de la matriz dispersa: un voto o un hueco. `null` significa ausencia (no vista). */
export type Celda = VotoObservado | null;

/** Matriz de votos. Una fila por participante, una columna por afirmación. */
export type MatrizVotos = ReadonlyArray<ReadonlyArray<Celda>>;

/** Grupo de opinión: índice estable y tamaño. */
export interface Grupo {
  /** Identificador estable del grupo, 1-indexado para presentación. */
  readonly id: number;
  /** Número de participantes asignados. */
  readonly tamano: number;
}

/** Afirmación puente o divisiva con su métrica y estadísticos por grupo. */
export interface AfirmacionPuntuada {
  /** Índice original de la afirmación en la matriz de entrada. */
  readonly indiceOriginal: number;
  /** Métrica que define el orden: `GIC` para puente, dispersión para divisiva. */
  readonly metrica: number;
  /** Suma de `p̂(g,c)` sobre todos los grupos con observaciones. */
  readonly sumaProbabilidades: number;
  /** Observaciones válidas (sólo `+1` y `-1`). */
  readonly observaciones: number;
  /** `p̂(g,c)` por grupo, sólo para los grupos con observaciones. */
  readonly probabilidadesPorGrupo: ReadonlyArray<number>;
  /** Grupo con probabilidad mínima (en caso de empate dentro de los grupos con observaciones). */
  readonly grupoMinimo: number;
  /**
   * `z₁` mínimo entre los grupos con observaciones (ADR-0038).
   *
   * `z₁(g,c) = 2·√n_v · (p̂(g,c) − 0,5)`: cuánto se aleja el acuerdo de un grupo del puro azar
   * (`H₀: p = ½`), en desviaciones típicas. Se guarda el **mínimo** porque el filtro del ADR
   * exige que lo cumplan **todos** los grupos, así que el mínimo decide. Si ningún grupo
   * observó la afirmación vale `-Infinity`, que nunca pasa el filtro.
   */
  readonly zMinimo: number;
  /**
   * ¿Supera el filtro de significación `z₁ > 1,2816` en TODOS los grupos con observaciones?
   *
   * Es lo que separa «acuerdo transversal» de «coincidencia de cuatro respuestas». Sin él, el
   * suavizado de Laplace deja que una afirmación con tres votos encabece el ranking de puentes.
   */
  readonly cumpleFiltroZ: boolean;
}

/**
 * Instantánea del cálculo anterior, para la histéresis (ADR-0038).
 *
 * Es lo único que el paquete necesita recordar entre dos corridas sucesivas. Se devuelve en el
 * resultado y se vuelve a entrar como opción; el paquete no guarda estado por su cuenta.
 */
export interface Instantanea {
  /** Número de grupos que se publicó la vez anterior. */
  readonly k: number;
  /** Centros de los grupos anteriores, en el orden de sus identificadores (grupo 1 primero). */
  readonly centros: ReadonlyArray<ReadonlyArray<number>>;
}

/** Opciones del análisis. Sin opciones, el análisis no tiene memoria: cada corrida es la primera. */
export interface OpcionesAnalisis {
  /** Instantánea de la corrida anterior. Si se pasa, se aplica la histéresis de ADR-0038. */
  readonly anterior?: Instantanea;
}

/** Resultado completo del análisis cuando SÍ se distinguen grupos. */
export interface ResultadoConsenso {
  /** Discriminante: hay grupos que publicar. */
  readonly tipo: 'GruposDetectados';
  readonly grupos: ReadonlyArray<Grupo>;
  /**
   * `asignaciones[p]` es el `id` del grupo (desde 1, como lo ve la persona) del participante
   * `p` **en el orden de entrada de la matriz**.
   *
   * Ojo: el cálculo interno reordena las filas a un orden canónico. Esta lista ya está
   * traducida de vuelta al orden de entrada; quien la consuma no necesita saber nada del
   * orden canónico. `ordenCanonicoFilas` se expone sólo para poder auditar esa traducción.
   */
  readonly asignaciones: ReadonlyArray<number>;
  /**
   * `ordenCanonicoFilas[i]` es el índice de entrada de la i-ésima fila en el orden canónico.
   * Es la permutación que el cálculo aplica antes de operar. Se publica para que un tercero
   * pueda reproducir el cálculo paso a paso y comprobarlo.
   */
  readonly ordenCanonicoFilas: ReadonlyArray<number>;
  readonly k: number;
  /**
   * Afirmaciones puente **publicables**: las que superan el filtro `z₁ > 1,2816` en todos los
   * grupos con observaciones, en orden descendente por `GIC` (ADR-0038).
   *
   * Ésta es la lista que va a pantalla. Puede quedar vacía, y quedarse vacía es un resultado:
   * significa que ninguna afirmación reúne acuerdo transversal distinguible del azar.
   */
  readonly afirmacionesPuente: ReadonlyArray<AfirmacionPuntuada>;
  /**
   * **Todas** las afirmaciones con su `GIC`, su `z₁` mínimo y si cumplen el filtro, en orden
   * descendente por `GIC`. Es la tabla completa para auditar: quien recompute el análisis puede
   * ver también lo que el filtro descartó y por qué. No es la lista de pantalla.
   */
  readonly afirmacionesPuntuadas: ReadonlyArray<AfirmacionPuntuada>;
  /** Afirmaciones divisivas en orden descendente por dispersión. */
  readonly afirmacionesDivisivas: ReadonlyArray<AfirmacionPuntuada>;
  /**
   * Primer eje de variación, en el orden CANÓNICO de columnas. Dato de auditoría, no de
   * pantalla: sirve para que un tercero reproduzca el cálculo, no para mostrarlo.
   */
  readonly primeraComponente: ReadonlyArray<number>;
  /** Segundo eje de variación, en el orden CANÓNICO de columnas. Dato de auditoría. */
  readonly segundaComponente: ReadonlyArray<number>;
  /** `ordenCanonicoColumnas[j]` es el índice de entrada de la j-ésima columna canónica. */
  readonly ordenCanonicoColumnas: ReadonlyArray<number>;
  /** `k` máximo considerado en la búsqueda del número de grupos (ADR-0038: nunca más de 5). */
  readonly kMaximo: number;
  /** Número de participantes efectivamente considerados. */
  readonly participantesConsiderados: number;
  /**
   * Mejor separación alcanzada entre grupos, sobre todos los `k` examinados. Va de −1 a 1.
   * Por debajo del umbral de no-facción de ADR-0038 el análisis NO devuelve grupos: devuelve
   * `FaccionesNoDetectadas`. Dato de auditoría, no de pantalla.
   */
  readonly separacionMaxima: number;
  /** ¿Se conservó el número de grupos de la instantánea anterior por histéresis (ADR-0038)? */
  readonly kConservadoPorHisteresis: boolean;
  /** Lo que hay que devolver como `opciones.anterior` en la corrida siguiente. */
  readonly instantanea: Instantanea;
  /** Texto de cada afirmación, indexado por `indiceOriginal`. */
  readonly textos: ReadonlyArray<string>;
}

/**
 * Resultado del análisis cuando **no hay grupos claros** (ADR-0038, umbral de no-facción).
 *
 * ADR-0038 lo exige como «caso explícito y nunca ausencia de evento»: cuando la mejor separación
 * alcanzable no llega al umbral, publicar dos grupos igualmente sería **fabricar facciones que
 * los datos no muestran**, y ésa es precisamente la lectura que el ADR prohíbe («el riesgo, y por
 * eso este ADR existe, es tratar el mapa resultante como un veredicto»).
 *
 * No es un error y por eso no es una excepción: es una de las dos formas normales de terminar, y
 * `PRODUCT.md` §4 la promete literalmente en la pantalla «Consenso» —«no hay grupos claros», que
 * es un resultado—. Se modela como variante de una unión discriminada para que el compilador
 * obligue a quien consuma la salida a contemplarla: con un campo opcional se podría ignorar.
 *
 * Sigue publicándose el consenso: sin facciones, la población entera es el único grupo y el
 * `GIC` sobre ese grupo único es exactamente el acuerdo general, con el mismo filtro `z₁`.
 */
export interface FaccionesNoDetectadas {
  /** Discriminante: no hay grupos que publicar. */
  readonly tipo: 'FaccionesNoDetectadas';
  /** Mejor separación alcanzada, sobre todos los `k` examinados. Quedó por debajo del umbral. */
  readonly separacionMaxima: number;
  /** Umbral por debajo del cual no se publican grupos (ADR-0038). */
  readonly umbral: number;
  /** Valores de `k` que se examinaron antes de concluir que no hay facciones. */
  readonly kExaminados: ReadonlyArray<number>;
  /** Número de participantes efectivamente considerados. */
  readonly participantesConsiderados: number;
  /** Afirmaciones de acuerdo general que superan el filtro `z₁`, sobre la población entera. */
  readonly afirmacionesPuente: ReadonlyArray<AfirmacionPuntuada>;
  /** Todas las afirmaciones puntuadas sobre la población entera, para auditar. */
  readonly afirmacionesPuntuadas: ReadonlyArray<AfirmacionPuntuada>;
  /** Texto de cada afirmación, indexado por `indiceOriginal`. */
  readonly textos: ReadonlyArray<string>;
}

/**
 * Los dos desenlaces normales del análisis.
 *
 * Quien consuma esto **debe** discriminar por `tipo`. Los desenlaces anómalos (`SinVariacion`,
 * `PcaNoConvergente`) siguen siendo excepciones, porque ahí no hay nada que publicar.
 */
export type ResultadoAnalisis = ResultadoConsenso | FaccionesNoDetectadas;

/**
 * Error tipado: el cálculo de un eje de variación no se estabilizó.
 *
 * Se lanza en vez de devolver un valor aproximado. Un valor aproximado dependería de cuántas
 * vueltas se le dieran al cálculo y dos ejecuciones de la misma entrada podrían diferir: el
 * análisis dejaría de ser verificable, que es justo lo único que este paquete promete.
 *
 * El detalle técnico va en los campos (`componente`, `iteracion`, `delta`), no en el mensaje:
 * el mensaje puede acabar en pantalla y ADR-0041 prohíbe la jerga ahí.
 */
export class PcaNoConvergente extends Error {
  readonly iteracion: number;
  readonly delta: number;
  readonly iteracionesMax: number;
  readonly componente: number;

  constructor(componente: number, iteracion: number, delta: number, iteracionesMax: number) {
    super(
      `No se pudieron formar los grupos de opinión: el cálculo del eje ` +
        `${componente.toString()} no se estabilizó tras ${iteracionesMax.toString()} pasos ` +
        `(última variación=${delta.toExponential(3)} en el paso ${iteracion.toString()}). ` +
        `Dar un resultado aproximado haría que dos ejecuciones no coincidieran.`,
    );
    this.name = 'PcaNoConvergente';
    this.iteracion = iteracion;
    this.delta = delta;
    this.iteracionesMax = iteracionesMax;
    this.componente = componente;
  }
}

/**
 * Error tipado: las respuestas no varían entre sí, así que no hay grupos que encontrar.
 *
 * Ocurre cuando, tras centrar, la matriz es idénticamente cero: todas las personas
 * respondieron igual a todas las afirmaciones (o nadie respondió nada). No es un fallo
 * numérico —el cálculo no llegó siquiera a iterar—, es que la pregunta no tiene respuesta:
 * no existe ninguna dirección en la que las personas se separen.
 *
 * Se distingue de `PcaNoConvergente` a propósito. Antes este caso se reportaba como «no
 * convergió», lo cual era falso y mandaba a buscar el problema donde no estaba.
 *
 * Tampoco se devuelve un resultado con dos grupos inventados: partir en dos a un conjunto de
 * personas que respondieron exactamente igual sería fabricar un desacuerdo que no existe, y
 * este paquete produce agenda para deliberar, no divisiones de oficio.
 */
export class SinVariacion extends Error {
  readonly participantes: number;
  readonly afirmaciones: number;

  constructor(participantes: number, afirmaciones: number) {
    super(
      `No hay grupos de opinión que distinguir: las ${participantes.toString()} personas ` +
        `respondieron igual a las ${afirmaciones.toString()} afirmaciones, así que no hay ` +
        `ninguna diferencia sobre la que agruparlas.`,
    );
    this.name = 'SinVariacion';
    this.participantes = participantes;
    this.afirmaciones = afirmaciones;
  }
}
