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
}

/** Resultado completo del análisis. */
export interface ResultadoConsenso {
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
  /** Afirmaciones puente en orden descendente por `GIC`. */
  readonly afirmacionesPuente: ReadonlyArray<AfirmacionPuntuada>;
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
  /** `k` máximo considerado en la búsqueda por silhouette. */
  readonly kMaximo: number;
  /** Número de participantes efectivamente considerados. */
  readonly participantesConsiderados: number;
  /** Texto de cada afirmación, indexado por `indiceOriginal`. */
  readonly textos: ReadonlyArray<string>;
}

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
