/**
 * `@koinonia/consensus` — análisis de opinión tipo Pol.is.
 *
 * Toma una matriz dispersa de votos (participantes × afirmaciones) y devuelve, en forma
 * determinista:
 *
 *  - los **grupos de opinión** y la asignación de cada participante a uno de ellos;
 *  - las **afirmaciones puente**: las que concitan acuerdo transversal entre todos los
 *    grupos;
 *  - las **afirmaciones divisivas**: las que generan más desacuerdo entre grupos.
 *
 * Pipeline:
 *  `imputarYOrdenar` → `pca2` → `kmeansDeterminista` → `probabilidadesConLaplace` →
 *  `afirmacionesPuente` / `afirmacionesDivisivas`.
 *
 * # Frontera con el punto flotante (ADR-0027 y ADR-0038)
 *
 * Este proyecto prohíbe el punto flotante en **umbrales de decisión**: toda comparación de
 * umbral se hace con enteros o fracciones exactas, porque en coma flotante `2/3` no existe
 * y una supermayoría que se cumplía exactamente podría rechazarse por un error de
 * representación.
 *
 * La salida de **este paquete es agenda, no veredicto**: orienta la deliberación humana pero
 * **nunca** debe alimentar una comparación de umbral ni un conteo de votos. Por eso el
 * paquete puede permitirse punto flotante en cálculos intermedios (PCA, k-means, GIC) sin
 * entrar en el sistema de decisión. Quien lo cruce hacia un umbral **debe** convertirlo a
 * fracción exacta primero.
 *
 * En concreto, los consumidores de esta salida **NO deben**:
 *
 *  - comparar ningún valor aquí calculado contra un umbral para "aprobar" o "rechazar";
 *  - contar votos a partir de los grupos aquí producidos;
 *  - tratar `p̂`, `GIC`, las componentes del PCA ni la inercia como magnitudes con valor
 *    normativo. Son insumos descriptivos.
 *
 * # Determinismo
 *
 * La salida es estructuralmente idéntica sobre la misma entrada. Las invariantes que lo
 * garantizan están en `pca.ts`, `kmeans.ts` y `matrix.ts`; los tests de propiedad viven en
 * `test/props/determinismo.test.ts`.
 *
 * # Interfaz sin jerga (ADR-0041)
 *
 * Los textos visibles al usuario están en castellano llano y no mencionan «PCA», «k-means»,
 * «clúster», «silhouette», «autovector» ni «inercia». Ver `TEXTOS` más abajo.
 */

import { imputarYOrdenar, contarPorGrupo, centrar, type Matrix } from './matrix.js';
import { pca2 } from './pca.js';
import { kmeansDeterminista, kMaximoPara } from './kmeans.js';
import {
  afirmacionesPuente,
  afirmacionesDivisivas,
  probabilidadesConLaplace,
} from './statements.js';
import type { AfirmacionPuntuada, Grupo, MatrizVotos, ResultadoConsenso } from './types.js';

export type {
  AfirmacionPuntuada,
  Celda,
  Grupo,
  MatrizVotos,
  ResultadoConsenso,
  VotoObservado,
} from './types.js';

/**
 * Los errores se exportan como VALOR, no como tipo.
 *
 * Estaban en el bloque `export type` de arriba, que el compilador borra al emitir: quien
 * importara `PcaNoConvergente` para hacer `instanceof` se encontraba con que no existe en
 * tiempo de ejecución. La promesa de «error tipado, nunca un valor aproximado» sólo sirve de
 * algo si quien llama puede distinguir ese error de cualquier otro.
 */
export { PcaNoConvergente, SinVariacion } from './types.js';

/**
 * Textos de la interfaz, en castellano llano, separados del cálculo (ADR-0041).
 *
 * Las claves son los nombres que verá la persona en pantalla. Los textos se exportan para
 * que la capa de presentación los pueda probar como cadenas literales, sin reescribirlos.
 */
export const TEXTOS = {
  gruposTitulo: 'Grupos de opinión',
  gruposDescripcion:
    'Las personas quedaron repartidas en grupos según cómo reaccionaron a las afirmaciones.',
  grupoNumero: (n: number): string => `Grupo ${n.toString()}`,
  afirmacionesPuenteTitulo: 'Afirmaciones en las que todos los grupos están de acuerdo',
  afirmacionesPuenteDescripcion:
    'Estas afirmaciones concitan acuerdo en todos los grupos. Pueden ser un buen punto de partida.',
  afirmacionesDivisivasTitulo: 'Afirmaciones que generan más desacuerdo entre grupos',
  afirmacionesDivisivasDescripcion:
    'Estas afirmaciones separan a los grupos: son las que más dan que hablar.',
  pEstimada: (p: number): string => `${(p * 100).toFixed(1)} %`,
} as const;

/**
 * Resultado enriquecido con textos en castellano listos para mostrar.
 *
 * Esto es la salida "para pantalla": incluye los textos del módulo aparte y los datos
 * numéricos que la UI necesita. La capa de presentación no debería añadir jerga.
 */
export interface ResultadoConsensoPantalla {
  readonly grupos: ReadonlyArray<Grupo>;
  readonly asignaciones: ReadonlyArray<number>;
  readonly k: number;
  readonly kMaximo: number;
  readonly participantesConsiderados: number;
  readonly afirmacionesPuente: ReadonlyArray<AfirmacionParaPantalla>;
  readonly afirmacionesDivisivas: ReadonlyArray<AfirmacionParaPantalla>;
  readonly textos: typeof TEXTOS;
}

export interface AfirmacionParaPantalla {
  readonly texto: string;
  readonly metrica: number;
  readonly pPorGrupo: ReadonlyArray<number>;
  readonly observaciones: number;
  /** Identificador textual del grupo con menor probabilidad (o "" si nadie observó). */
  readonly grupoMinimo: string;
}

/**
 * Ejecuta el pipeline completo y devuelve el resultado estructurado.
 */
export function analizarConsenso(
  matriz: MatrizVotos,
  textos: ReadonlyArray<string>,
): ResultadoConsenso {
  if (textos.length !== (matriz[0]?.length ?? 0)) {
    throw new Error('textos debe tener una entrada por columna de la matriz (afirmaciones)');
  }
  // 1. Preparación + orden canónico.
  const preparada = imputarYOrdenar(matriz);
  // 2. Centrado y PCA.
  // Para PCA usamos `medias` y la matriz imputada en orden canónico. Centramos manualmente
  // pasando la matriz y las medias.
  const Xc = centrar(preparada.X, preparada.medias);
  const pca = pca2(Xc);
  // 3. Proyectar las filas canónicas sobre las dos componentes.
  const Z = proyectar(Xc, pca.primeraComponente, pca.segundaComponente);
  // 4. k-means determinista.
  const km = kmeansDeterminista(Z);
  // 5. Conteos por grupo en el orden de la matriz ORIGINAL (usamos la permutación de filas).
  const conteos = contarPorGrupo(matriz, km.asignaciones, preparada.filas);
  // 6. Probabilidades con suavizado de Laplace.
  const stats = probabilidadesConLaplace(conteos.acuerdos, conteos.observaciones);
  // 7. Rankings.
  //
  //    `contarPorGrupo` recorre la matriz de ENTRADA columna a columna, así que la columna `c`
  //    de `stats` YA es la columna `c` de la entrada. Aquí se pasaba `preparada.columnas`, que
  //    va de canónico a original: aplicarla equivalía a permutar por segunda vez unos índices
  //    que nunca se habían permutado. Cada afirmación del ranking salía etiquetada con el
  //    índice de otra —y por tanto con el texto de otra— siempre que el orden canónico de
  //    columnas no fuera la identidad, es decir en cuanto las afirmaciones tuvieran distinto
  //    número de respuestas. El caso más común, y silencioso: los números eran correctos y
  //    estaban bien ordenados, sólo colgaban de la afirmación equivocada.
  const indicesDeEntrada = Array.from({ length: textos.length }, (_, j) => j);
  const puente = afirmacionesPuente(stats, indicesDeEntrada);
  const divisivas = afirmacionesDivisivas(stats, indicesDeEntrada);

  const grupos: Grupo[] = [];
  for (let g = 0; g < km.centroides.length; g++) {
    grupos.push({
      id: g + 1,
      tamano: conteos.tamanoGrupo[g] ?? 0,
    });
  }

  // 8. Traducir las asignaciones del orden canónico al orden de ENTRADA, y a identificadores
  //    de grupo desde 1 (ADR-0041: a las personas se les numeran los grupos desde 1).
  //    `km.asignaciones[i]` es el grupo de la i-ésima fila CANÓNICA; `preparada.filas[i]` dice
  //    de qué participante de entrada venía esa fila. Sin esta vuelta atrás el consumidor no
  //    tiene forma de saber en qué grupo quedó cada persona: el array parecía estar indexado
  //    por participante y no lo estaba.
  const asignacionesPorParticipante = new Array<number>(matriz.length).fill(0);
  for (let i = 0; i < preparada.filas.length; i++) {
    const participante = preparada.filas[i] ?? 0;
    asignacionesPorParticipante[participante] = (km.asignaciones[i] ?? 0) + 1;
  }

  return {
    grupos,
    asignaciones: asignacionesPorParticipante,
    ordenCanonicoFilas: preparada.filas,
    k: km.k,
    kMaximo: kMaximoPara(matriz.length),
    participantesConsiderados: matriz.length,
    afirmacionesPuente: puente,
    afirmacionesDivisivas: divisivas,
    primeraComponente: pca.primeraComponente,
    segundaComponente: pca.segundaComponente,
    ordenCanonicoColumnas: preparada.columnas,
    textos,
  };
}

/** Proyecta filas canónicas sobre las dos componentes del PCA. */
function proyectar(X: Matrix, pc1: ReadonlyArray<number>, pc2: ReadonlyArray<number>): Matrix {
  const n = X.length;
  if (n === 0) return [];
  const m = X[0]?.length ?? 0;
  if (pc1.length !== m || pc2.length !== m) {
    throw new Error('dimensión de las componentes inconsistente');
  }
  const Z: number[][] = [];
  for (let i = 0; i < n; i++) {
    const fila = X[i];
    if (fila === undefined) continue;
    let z1 = 0;
    let z2 = 0;
    for (let j = 0; j < m; j++) {
      const xj = fila[j];
      const p1j = pc1[j];
      const p2j = pc2[j];
      if (xj === undefined || p1j === undefined || p2j === undefined) continue;
      z1 += xj * p1j;
      z2 += xj * p2j;
    }
    Z.push([z1, z2]);
  }
  return Z;
}

/** Convierte el resultado crudo al formato enriquecido para pantalla. */
export function aPantalla(resultado: ResultadoConsenso): ResultadoConsensoPantalla {
  return {
    grupos: resultado.grupos,
    asignaciones: resultado.asignaciones,
    k: resultado.k,
    kMaximo: resultado.kMaximo,
    participantesConsiderados: resultado.participantesConsiderados,
    afirmacionesPuente: resultado.afirmacionesPuente.map((af) =>
      aAfirmacionParaPantalla(af, resultado.textos),
    ),
    afirmacionesDivisivas: resultado.afirmacionesDivisivas.map((af) =>
      aAfirmacionParaPantalla(af, resultado.textos),
    ),
    textos: TEXTOS,
  };
}

function aAfirmacionParaPantalla(
  af: AfirmacionPuntuada,
  textos: ReadonlyArray<string>,
): AfirmacionParaPantalla {
  return {
    texto: textos[af.indiceOriginal] ?? '',
    metrica: af.metrica,
    pPorGrupo: af.probabilidadesPorGrupo,
    observaciones: af.observaciones,
    grupoMinimo: af.grupoMinimo > 0 ? TEXTOS.grupoNumero(af.grupoMinimo) : '',
  };
}
