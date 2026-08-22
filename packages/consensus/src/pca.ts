/**
 * PCA (2 componentes) determinista por power iteration con deflación de Hotelling.
 *
 * El PCA trabaja sobre la matriz centrada `Xc` (filas = participantes, columnas = afirmaciones).
 * El cálculo se hace en el espacio de columnas usando la matriz de Gram `A = Xcᵀ · Xc` (m × m,
 * con m ≤ 200 es barato). Cada componente es un autovector de `A` y cada autovalor es su valor
 * propio asociado.
 *
 * Determinismo:
 *
 *  - Vector inicial fijo: `v0[i] = 1/sqrt(m)` para todo i. Sin PRNG.
 *  - Power iteration con norma-2 de la diferencia como criterio de parada (`‖v_t − v_{t−1}‖ < ε`).
 *  - Si no converge: error tipado, **no** valor aproximado. Aproximar rompería el determinismo
 *    bit a bit y haría que dos corridas puedan divergir.
 *  - **Canonicalización de signo**: el signo de un autovector es arbitrario. Sin canonización,
 *    dos corridas perfectamente iguales en coma flotante podrían dar componentes invertidas y,
 *    con ello, grupos y rankings distintos. La regla: si la suma de las componentes tiene
 *    magnitud significativa, `v *= sign(s)`; si no, tomamos `i* = argmax |v_i|` con desempate
 *    por índice menor y forzamos `sign(v[i*])`. Empate determinista.
 */

import type { Matrix } from './matrix.js';
import { vectorInicialPca } from './matrix.js';
import { PcaNoConvergente, SinVariacion } from './types.js';

const CONVERGENCIA = 1e-12;
const ITERACIONES_MAX = 1000;
/**
 * Variación residual mínima, en proporción de la total, para molestarse en buscar un segundo
 * eje. No es un umbral de decisión de los que ADR-0027 prohíbe: no aprueba ni rechaza nada,
 * sólo distingue «queda variación» de «lo que queda es el residuo de redondeo del propio
 * cálculo». Por debajo de esta proporción lo que se estaría midiendo es el error de la resta.
 */
const RESIDUO_MINIMO = 1e-12;

export interface PcaResultado {
  readonly primeraComponente: ReadonlyArray<number>;
  readonly segundaComponente: ReadonlyArray<number>;
  readonly autovalor1: number;
  readonly autovalor2: number;
}

/** Calcula las dos primeras componentes principales de la matriz centrada. */
export function pca2(Xc: Matrix): PcaResultado {
  const n = Xc.length;
  const m = Xc[0]?.length ?? 0;
  if (n < 2 || m < 2) {
    throw new Error(
      `PCA requiere al menos 2 participantes y 2 afirmaciones (recibido n=${n.toString()}, m=${m.toString()})`,
    );
  }
  const A = gram(Xc, m, n);

  // Sin variación no hay ejes que calcular. Se comprueba ANTES de iterar porque el síntoma
  // (‖A·v‖ = 0 en el primer paso) no es una falta de convergencia sino la ausencia de datos
  // sobre los que converger, y confundirlos manda a depurar el sitio equivocado.
  if (esNula(A)) {
    throw new SinVariacion(n, m);
  }

  const pc1 = potenciaConDeflacion(A, vectorArranque(A, m), 1);
  const Adeflada = deflacionar(A, pc1.vector, pc1.autovalor, m);

  // ¿Queda algo que medir en un segundo eje?
  //
  // La traza de una matriz de Gram es la suma de sus valores propios, es decir toda la
  // variación que contiene. Si tras quitar el primer eje no queda prácticamente nada, es que
  // TODA la discrepancia entre las personas ocurre a lo largo de una sola dirección: el caso
  // de dos bloques enfrentados que responden lo mismo dentro de cada bloque, que es
  // precisamente el más nítido y el más frecuente.
  //
  // En ese caso el segundo eje no existe. Antes se iteraba igual sobre una matriz nula, se
  // obtenía ‖A·v‖ = 0 en el primer paso y se abortaba el análisis entero con «no convergió»,
  // que además de falso dejaba sin resultado justo a la entrada más clara posible.
  //
  // Se devuelve el vector nulo: es la forma honesta de decir «no hay segundo eje». Todas las
  // personas proyectan en 0 sobre él, la segunda coordenada es constante y los grupos se
  // forman sobre el único eje real. Inventar una dirección cualquiera del espacio nulo sería
  // dar por hallada una discrepancia que en los datos no está.
  const trazaTotal = traza(A, m);
  const trazaResidual = traza(Adeflada, m);
  if (!(trazaResidual > trazaTotal * RESIDUO_MINIMO)) {
    return {
      primeraComponente: Array.from(pc1.vector),
      segundaComponente: new Array<number>(m).fill(0),
      autovalor1: pc1.autovalor,
      autovalor2: 0,
    };
  }

  const pc2 = potenciaConDeflacion(Adeflada, vectorArranque(Adeflada, m), 2);

  return {
    primeraComponente: Array.from(pc1.vector),
    segundaComponente: Array.from(pc2.vector),
    autovalor1: pc1.autovalor,
    autovalor2: pc2.autovalor,
  };
}

/** Matriz de Gram `A = Xᵀ · X` (m × m). */
function gram(X: Matrix, m: number, n: number): Float64Array {
  const A = new Float64Array(m * m);
  for (let i = 0; i < n; i++) {
    const fila = X[i];
    if (fila === undefined) continue;
    for (let a = 0; a < m; a++) {
      const xia = fila[a];
      if (xia === undefined) continue;
      for (let b = 0; b < m; b++) {
        const xib = fila[b];
        if (xib === undefined) continue;
        const idx = a * m + b;
        const previo = A[idx];
        A[idx] = (previo === undefined ? 0 : previo) + xia * xib;
      }
    }
  }
  return A;
}

/**
 * Vector de arranque de la iteración.
 *
 * Lo normal es el vector fijo `1/√m` en cada posición, que es el que manda la especificación
 * (fijo y sin azar: dos ejecuciones tienen que arrancar igual para terminar igual).
 *
 * Pero ese vector tiene un punto ciego: si resulta ser perpendicular al eje de variación de los
 * datos, la primera multiplicación da exactamente cero y la iteración no tiene por dónde
 * empezar. No es rebuscado: pasa siempre que dos bloques del mismo tamaño se enfrentan y las
 * afirmaciones se reparten a favor y en contra, porque entonces el eje tiene tantas
 * componentes positivas como negativas y su suma se anula. Es decir, pasa en el caso más
 * limpio y más frecuente de todos. Antes esto abortaba el análisis informando de que «no
 * convergió», cuando en realidad no había llegado a dar un solo paso.
 *
 * El respaldo es la columna con más variación propia (mayor valor en la diagonal), desempatando
 * por índice menor. Sigue sin haber azar: es una función de la matriz y nada más, así que dos
 * ejecuciones eligen el mismo respaldo. Y no puede volver a fallar, porque una columna con
 * diagonal positiva tiene garantizado un producto no nulo consigo misma.
 */
function vectorArranque(A: Float64Array, m: number): Float64Array {
  const v0 = vectorInicialPca(m);
  let sumaCuadrados = 0;
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) {
      s += (A[i * m + j] ?? 0) * (v0[j] ?? 0);
    }
    sumaCuadrados += s * s;
  }
  if (sumaCuadrados > 0) return v0;

  let iEstrella = 0;
  let mejor = A[0] ?? 0;
  for (let i = 1; i < m; i++) {
    const d = A[i * m + i] ?? 0;
    if (d > mejor) {
      mejor = d;
      iEstrella = i;
    }
  }
  const respaldo = new Float64Array(m);
  respaldo[iEstrella] = 1;
  return respaldo;
}

/** Traza: la suma de la diagonal. En una matriz de Gram es toda la variación que contiene. */
function traza(A: Float64Array, m: number): number {
  let s = 0;
  for (let i = 0; i < m; i++) {
    s += A[i * m + i] ?? 0;
  }
  return s;
}

/** ¿La matriz de Gram es idénticamente cero? Entonces los datos no tienen variación alguna. */
function esNula(A: Float64Array): boolean {
  for (let i = 0; i < A.length; i++) {
    if ((A[i] ?? 0) !== 0) return false;
  }
  return true;
}

/** Deflación de Hotelling: `A' = A − λ · v · vᵀ`. */
function deflacionar(A: Float64Array, v: Float64Array, lambda: number, m: number): Float64Array {
  const Ad = new Float64Array(m * m);
  for (let i = 0; i < m; i++) {
    const vi = v[i];
    if (vi === undefined) continue;
    for (let j = 0; j < m; j++) {
      const vj = v[j];
      if (vj === undefined) continue;
      const idx = i * m + j;
      const previo = A[idx];
      Ad[idx] = (previo === undefined ? 0 : previo) - lambda * vi * vj;
    }
  }
  return Ad;
}

interface ResultadoIteracion {
  readonly vector: Float64Array;
  readonly autovalor: number;
}

function potenciaConDeflacion(
  A: Float64Array,
  v0: Float64Array,
  numeroComponente: number,
): ResultadoIteracion {
  const m = v0.length;
  const v = new Float64Array(v0);
  let ultimoDelta = Number.POSITIVE_INFINITY;
  let iter = 0;

  while (iter < ITERACIONES_MAX) {
    // Multiplicar A por v: w = A·v.
    const w = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) {
        const aij = A[i * m + j];
        const vj = v[j];
        s += (aij === undefined ? 0 : aij) * (vj === undefined ? 0 : vj);
      }
      w[i] = s;
    }
    // Norma-2 de w (suma explícita de cuadrados; ver nota sobre determinismo en matrix.ts).
    let sumaCuadrados = 0;
    for (let i = 0; i < m; i++) {
      const x = w[i] ?? 0;
      sumaCuadrados += x * x;
    }
    const normaW = Math.sqrt(sumaCuadrados);
    if (normaW === 0) {
      throw new PcaNoConvergente(numeroComponente, iter, Number.POSITIVE_INFINITY, ITERACIONES_MAX);
    }
    // v_nuevo = w / ‖w‖.
    const vNuevo = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      vNuevo[i] = (w[i] ?? 0) / normaW;
    }

    // Criterio de parada: ‖v_t − v_{t−1}‖, iteraciones CONSECUTIVAS.
    //
    // La versión anterior guardaba el vector con un paso de retraso y acababa comparando
    // v_{t−1} contra v_{t+1}, es decir un salto de dos, contradiciendo su propio comentario.
    // Con una matriz semidefinida positiva el error decae de forma monótona, así que aquello
    // no daba resultados falsos: daba un criterio ~2× más estricto de lo escrito, y por tanto
    // más ejecuciones abortadas por «no convergió» de las necesarias.
    ultimoDelta = normaDiferencia(v, vNuevo);
    if (ultimoDelta < CONVERGENCIA) {
      return { vector: canonicalizarSigno(vNuevo), autovalor: normaW };
    }
    for (let i = 0; i < m; i++) {
      v[i] = vNuevo[i] ?? 0;
    }
    iter++;
  }

  // Si llegamos aquí, no convergió. Reportamos el último delta con honestidad.
  throw new PcaNoConvergente(numeroComponente, iter, ultimoDelta, ITERACIONES_MAX);
}

/** Norma-2 de la diferencia. */
function normaDiferencia(a: Float64Array, b: Float64Array): number {
  const m = a.length;
  let suma = 0;
  for (let i = 0; i < m; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    suma += d * d;
  }
  return Math.sqrt(suma);
}

/**
 * Canonicalización de signo (v. spec §4.3):
 *  - `s = Σ v_i`; si `|s| > 1e-12`, `v *= sign(s)`.
 *  - Si no, `i* = argmax |v_i|` con desempate por índice menor; `v *= sign(v[i*])`.
 *
 * El umbral `1e-12` está pensado para que cualquier autovector "razonable" con componentes de
 * magnitud normal tenga `|s| ≫ 1e-12`. Sólo caen por debajo los autovectores aproximadamente
 * simétricos que tienen casi la mitad de las componentes positivas y la otra mitad negativas;
 * para esos usamos el respaldo del `argmax`.
 */
function canonicalizarSigno(v: Float64Array): Float64Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i] ?? 0;
  }
  if (Math.abs(s) > 1e-12) {
    const factor = s > 0 ? 1 : -1;
    for (let i = 0; i < v.length; i++) {
      v[i] = (v[i] ?? 0) * factor;
    }
    return v;
  }
  // Fallback: argmax |v_i| con desempate por índice menor.
  let iEstrella = 0;
  let mejorAbs = Math.abs(v[0] ?? 0);
  for (let i = 1; i < v.length; i++) {
    const a = Math.abs(v[i] ?? 0);
    if (a > mejorAbs) {
      mejorAbs = a;
      iEstrella = i;
    }
  }
  const factor = (v[iEstrella] ?? 0) >= 0 ? 1 : -1;
  for (let i = 0; i < v.length; i++) {
    v[i] = (v[i] ?? 0) * factor;
  }
  return v;
}
