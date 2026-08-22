/**
 * k-means determinista con inicialización furthest-first (Gonzalez, no k-means++).
 *
 * Tres determinismos que garantizan la misma salida byte a byte sobre la misma entrada:
 *
 *  1. **Sin azar.** `k-means++` necesita un PRNG para muestrear semillas proporcionales a D(x)²;
 *     lo reemplazamos por la regla determinista de Gonzalez: la primera semilla es el punto de
 *     mayor sentido (desempate por índice menor); cada siguiente es el punto que maximiza la
 *     distancia mínima a las ya elegidas, **con desempate por índice menor**.
 *  2. **Asignación con desempate.** Cuando un punto equidista de varios centroides, gana el de
 *     índice menor. Sin esto la convergencia puede entrar en ciclos visibles.
 *  3. **Etiquetado estable.** Al terminar Lloyd, los grupos se renumeran ordenando por la primera
 *     componente del centroide, ascendente. Sin esto la salida no es comparable entre corridas
 *     (cluster "1" en una ejecución puede no ser el mismo grupo que cluster "1" en otra).
 *
 * Vacíos: si en una iteración un clúster queda sin puntos, lo **re-sembramos** con el punto
 * más lejano a su centroide más cercano, no reutilizando el centroide muerto.
 *
 * Selección de `k`: por silhouette promedio sobre `k ∈ [2, min(12, floor(sqrt(n/2)))]`. Empate
 * ⇒ el k menor (parsimonia).
 */

import type { Matrix } from './matrix.js';

const FROBENIUS_EPSILON = 1e-10;
const LLOYD_MAX = 100;

/**
 * Acceso defensivo a un índice. Evita el operador `!` (prohibido en producción por el linter):
 * si el índice está fuera de rango lanza. Para `Float64Array` los accesos nunca son `undefined`
 * pero el linter no distingue, así que se usaremos el helper también ahí.
 */
function at<T>(xs: ArrayLike<T>, i: number, contexto: string): T {
  const x = xs[i];
  if (x === undefined) {
    throw new Error(`índice ${i.toString()} fuera de rango (${contexto})`);
  }
  return x;
}

/**
 * Número máximo de grupos que se considera para `n` participantes:
 * `min(12, floor(sqrt(n/2)))`, nunca menor que 2.
 *
 * Vive aquí, en un solo sitio, porque el resultado publica este valor y el buscador de `k` lo
 * usa como tope: si cada uno lo calculara por su cuenta podrían separarse sin que nada fallara.
 */
export function kMaximoPara(n: number): number {
  return Math.min(12, Math.max(2, Math.floor(Math.sqrt(n / 2))));
}

export interface KMeansResultado {
  readonly k: number;
  readonly asignaciones: ReadonlyArray<number>;
  readonly centroides: ReadonlyArray<ReadonlyArray<number>>;
  readonly inercia: number;
  readonly silhouettePromedio: number;
}

/** Ejecuta k-means determinista sobre una matriz de participantes. */
export function kmeansDeterminista(X: Matrix, kPreferido?: number): KMeansResultado {
  const n = X.length;
  if (n === 0) {
    throw new Error('sin participantes');
  }
  const m = X[0]?.length ?? 0;
  if (m === 0) {
    throw new Error('sin dimensiones');
  }
  const kMax = kMaximoPara(n);
  // Si se pasó kPreferido, lo usamos directamente (clampado). Si no, buscamos por silhouette.
  if (kPreferido !== undefined) {
    const k = clamp(kPreferido, 2, kMax);
    return lloyd(X, k);
  }
  return seleccionarK(X, kMax);
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function seleccionarK(X: Matrix, kMax: number): KMeansResultado {
  // Probar k desde 2 hasta kMax (k menor en empate). Guardamos cada resultado.
  let mejor: KMeansResultado = lloyd(X, 2);
  for (let k = 3; k <= kMax; k++) {
    const r = lloyd(X, k);
    if (r.silhouettePromedio > mejor.silhouettePromedio) {
      mejor = r;
    }
    // Empate: k menor gana, no actualizamos.
  }
  return mejor;
}

/** Lloyd completo: inicialización Gonzalez + asignación + actualización + relabeling estable. */
function lloyd(X: Matrix, k: number): KMeansResultado {
  const m = at(X, 0, 'primera fila').length;
  const semillas = gonzalez(X, k);
  let centroides: Float64Array[] = semillas.map((s) => new Float64Array(s));
  let asignaciones = asignarPuntos(X, centroides);

  for (let iter = 0; iter < LLOYD_MAX; iter++) {
    const nuevosCentroides = recalcularCentroides(X, asignaciones, k, m, centroides);
    const delta = frobenius(centroides, nuevosCentroides);
    centroides = nuevosCentroides;
    asignaciones = asignarPuntos(X, centroides);
    if (delta < FROBENIUS_EPSILON) {
      break;
    }
  }

  const { asignaciones: reasignadas, centroides: reordenados } = relabelingEstable(
    asignaciones,
    centroides,
  );
  const inercia = calcularInercia(X, reasignadas, reordenados);
  const sil = silhouettePromedio(X, reasignadas, k);

  return {
    k,
    asignaciones: reasignadas,
    centroides: reordenados.map((c) => Array.from(c)),
    inercia,
    silhouettePromedio: sil,
  };
}

/** Inicialización furthest-first (Gonzalez). Desempate por índice menor. */
function gonzalez(X: Matrix, k: number): Float64Array[] {
  const n = X.length;
  const m = at(X, 0, 'primera fila').length;

  // Primera semilla: mayor norma euclídea; empate por índice menor.
  let iEstrella = 0;
  let mejorNorma = normaCuadrado(at(X, 0, 'fila 0'), m);
  for (let i = 1; i < n; i++) {
    const nrm = normaCuadrado(at(X, i, 'fila'), m);
    if (nrm > mejorNorma) {
      mejorNorma = nrm;
      iEstrella = i;
    }
  }
  const semillas: number[] = [iEstrella];
  const minDistancias = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    minDistancias[i] = distanciaCuadrado(at(X, i, 'fila'), at(X, iEstrella, 'semilla'), m);
  }

  while (semillas.length < k) {
    let iEstrella2 = -1;
    let mejorDist = -1;
    for (let i = 0; i < n; i++) {
      if (semillas.includes(i)) continue;
      const d = minDistancias[i] ?? 0;
      // Comparación estricta recorriendo `i` de menor a mayor: ante un empate el primero ya
      // está guardado y no se sustituye, que es exactamente el desempate por índice menor.
      // (Aquí había además una rama `else if (d === mejorDist && i < iEstrella2)` que no podía
      // ejecutarse nunca, porque en un recorrido ascendente `i` siempre supera al índice ya
      // guardado. Sugería una garantía que en realidad daba el `>` de arriba.)
      if (d > mejorDist) {
        mejorDist = d;
        iEstrella2 = i;
      }
    }
    if (iEstrella2 === -1) break;
    semillas.push(iEstrella2);
    for (let i = 0; i < n; i++) {
      const d = distanciaCuadrado(at(X, i, 'fila'), at(X, iEstrella2, 'semilla'), m);
      const minD = minDistancias[i] ?? 0;
      if (d < minD) {
        minDistancias[i] = d;
      }
    }
  }

  return semillas.map((idx) => new Float64Array(at(X, idx, 'semilla final')));
}

function normaCuadrado(v: ArrayLike<number>, m: number): number {
  let s = 0;
  for (let j = 0; j < m; j++) {
    const x = at(v, j, 'norma');
    s += x * x;
  }
  return s;
}

function distanciaCuadrado(a: ArrayLike<number>, b: ArrayLike<number>, m: number): number {
  let s = 0;
  for (let j = 0; j < m; j++) {
    const d = at(a, j, 'a') - at(b, j, 'b');
    s += d * d;
  }
  return s;
}

/** Asigna cada punto al centroide más cercano. Desempate por índice de clúster menor. */
function asignarPuntos(X: Matrix, centroides: ReadonlyArray<Float64Array>): number[] {
  const n = X.length;
  const m = at(X, 0, 'primera fila').length;
  const k = centroides.length;
  const asignaciones = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let mejor = 0;
    let mejorDist = Number.POSITIVE_INFINITY;
    const fila = at(X, i, 'fila');
    for (let g = 0; g < k; g++) {
      const d = distanciaCuadrado(fila, at(centroides, g, 'centroide'), m);
      if (d < mejorDist) {
        mejorDist = d;
        mejor = g;
      }
      // Empate por índice menor: si d === mejorDist, no actualizamos.
    }
    asignaciones[i] = mejor;
  }
  return asignaciones;
}

/** Recalcula centroides. Si un grupo queda vacío, lo re-siembra con el punto más lejano. */
function recalcularCentroides(
  X: Matrix,
  asignaciones: ReadonlyArray<number>,
  k: number,
  m: number,
  antiguosCentroides: ReadonlyArray<Float64Array>,
): Float64Array[] {
  const suma = Array.from({ length: k }, () => new Float64Array(m));
  const cuenta = new Array<number>(k).fill(0);

  for (let i = 0; i < X.length; i++) {
    const g = at(asignaciones, i, 'asignación');
    const prevC = cuenta[g] ?? 0;
    cuenta[g] = prevC + 1;
    const fila = at(X, i, 'fila');
    const sg = at(suma, g, 'suma');
    for (let j = 0; j < m; j++) {
      const xj = at(fila, j, 'celda');
      const sgj = sg[j] ?? 0;
      sg[j] = sgj + xj;
    }
  }

  const nuevos: Float64Array[] = [];
  for (let g = 0; g < k; g++) {
    const c = cuenta[g] ?? 0;
    if (c > 0) {
      const cG = new Float64Array(m);
      const sg = at(suma, g, 'suma grupo');
      for (let j = 0; j < m; j++) {
        const sgj = sg[j] ?? 0;
        cG[j] = sgj / c;
      }
      nuevos.push(cG);
    } else {
      // Re-sembrar con el punto más lejano a su centroide más cercano. Empezamos desde el
      // antiguo centroide para tener un vector inicial y encontramos el punto más lejano.
      const antiguo = at(antiguosCentroides, g, 'antiguo centroide');
      let iEstrella = 0;
      let mejorDist = -1;
      for (let i = 0; i < X.length; i++) {
        // Igual que en `gonzalez`: `>` estricto en recorrido ascendente = desempate por índice
        // menor. La rama `else if` que había aquí tampoco podía ejecutarse nunca.
        const d = distanciaCuadrado(at(X, i, 'fila'), antiguo, m);
        if (d > mejorDist) {
          mejorDist = d;
          iEstrella = i;
        }
      }
      nuevos.push(new Float64Array(at(X, iEstrella, 'semilla de reavivamiento')));
    }
  }
  return nuevos;
}

function frobenius(a: ReadonlyArray<Float64Array>, b: ReadonlyArray<Float64Array>): number {
  let s = 0;
  for (let g = 0; g < a.length; g++) {
    const ag = at(a, g, 'centroide a');
    const bg = at(b, g, 'centroide b');
    const m = ag.length;
    for (let j = 0; j < m; j++) {
      const d = at(ag, j, 'componente a') - at(bg, j, 'componente b');
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

/**
 * Renumera los grupos para que el ID estable sea la posición ascendente según la primera
 * componente del centroide.
 */
function relabelingEstable(
  asignaciones: ReadonlyArray<number>,
  centroides: ReadonlyArray<Float64Array>,
): { asignaciones: number[]; centroides: Float64Array[] } {
  const k = centroides.length;
  // Índice original de cada grupo: ordenar por centroide[0] ascendente.
  const orden = Array.from({ length: k }, (_, i) => i);
  orden.sort((a, b) => {
    const ca = at(at(centroides, a, 'centroide'), 0, 'primera componente');
    const cb = at(at(centroides, b, 'centroide'), 0, 'primera componente');
    if (ca !== cb) return ca - cb;
    return a - b;
  });
  // Mapa viejo → nuevo.
  const mapa = new Array<number>(k);
  for (let nuevo = 0; nuevo < k; nuevo++) {
    mapa[at(orden, nuevo, 'orden')] = nuevo;
  }
  const nuevasAsig: number[] = [];
  for (let i = 0; i < asignaciones.length; i++) {
    nuevasAsig.push(at(mapa, at(asignaciones, i, 'asignación'), 'mapa'));
  }
  const nuevosCentroides: Float64Array[] = [];
  for (let i = 0; i < orden.length; i++) {
    nuevosCentroides.push(new Float64Array(at(centroides, at(orden, i, 'orden'), 'centroide')));
  }
  return { asignaciones: nuevasAsig, centroides: nuevosCentroides };
}

function calcularInercia(
  X: Matrix,
  asignaciones: ReadonlyArray<number>,
  centroides: ReadonlyArray<Float64Array>,
): number {
  const m = at(X, 0, 'primera fila').length;
  let s = 0;
  for (let i = 0; i < X.length; i++) {
    const g = at(asignaciones, i, 'asignación');
    s += distanciaCuadrado(at(X, i, 'fila'), at(centroides, g, 'centroide'), m);
  }
  return s;
}

/** Silhouette promedio. Para k=1 está indefinido por construcción: se devuelve 0. */
function silhouettePromedio(X: Matrix, asignaciones: ReadonlyArray<number>, k: number): number {
  const n = X.length;
  const m = at(X, 0, 'primera fila').length;
  if (k <= 1) return 0;
  // Distancia EUCLÍDEA, no su cuadrado. El cuadrado no es una distancia (no cumple la
  // desigualdad triangular) y elevar al cuadrado infla las separaciones grandes frente a las
  // pequeñas, con lo que la medida favorecía sistemáticamente valores de `k` distintos de los
  // que da la silueta de verdad. Fuerza bruta O(n²·m); con m ≤ 200 y n ≤ 300 es barato.
  const distCache = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const fi = at(X, i, 'fila');
    for (let j = i + 1; j < n; j++) {
      const d = Math.sqrt(distanciaCuadrado(fi, at(X, j, 'fila'), m));
      distCache[i * n + j] = d;
      distCache[j * n + i] = d;
    }
  }

  const grupos = new Array<number>(n);
  for (let i = 0; i < n; i++) grupos[i] = at(asignaciones, i, 'asignación');

  // Tamaño por grupo.
  const tamPorGrupo = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const g = at(grupos, i, 'grupo');
    const prev = tamPorGrupo[g] ?? 0;
    tamPorGrupo[g] = prev + 1;
  }

  let total = 0;
  for (let i = 0; i < n; i++) {
    const g = at(grupos, i, 'grupo propio');
    const nG = at(tamPorGrupo, g, 'tamaño grupo');
    if (nG <= 1) {
      // Un cluster con un solo miembro: silhouette es 0 por convención.
      continue;
    }
    let aI = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (at(grupos, j, 'grupo') === g) aI += at(distCache, i * n + j, 'distCache');
    }
    aI = aI / (nG - 1);

    let bI = Number.POSITIVE_INFINITY;
    for (let h = 0; h < k; h++) {
      if (h === g) continue;
      const nH = at(tamPorGrupo, h, 'tamaño otro grupo');
      if (nH === 0) continue;
      let dH = 0;
      for (let j = 0; j < n; j++) {
        if (at(grupos, j, 'grupo de j') === h) {
          dH += at(distCache, i * n + j, 'distCache');
        }
      }
      dH = dH / nH;
      if (dH < bI) bI = dH;
    }

    // Si no quedó ningún otro grupo con miembros, `bI` sigue en infinito y `(bI−aI)/bI` daría
    // NaN, que se propaga y contamina la comparación entre valores de `k` (todo comparado con
    // NaN es falso, así que la elección pasaría a depender del orden de recorrido). Sin otro
    // grupo con el que contrastar, la silueta no está definida: aporta 0.
    if (!Number.isFinite(bI)) continue;
    const denom = Math.max(aI, bI);
    if (denom > 0) {
      total += (bI - aI) / denom;
    }
  }

  return total / n;
}
