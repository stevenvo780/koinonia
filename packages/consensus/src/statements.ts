/**
 * Estadísticos por grupo, afirmaciones puente y afirmaciones divisivas.
 *
 * Tres métricas, una por propósito:
 *
 *  - **`p̂(g,c)` con suavizado de Laplace α=1**: probabilidad estimada de acuerdo en la
 *     afirmación `c` para el grupo `g`. Se cuentan SÓLO votos observados `+1` o `-1` (nunca
 *     `paso` ni ausente). La cota `0 < p̂ < 1` está garantizada por construcción.
 *  - **`GIC(c) = Π_g p̂(g,c)`**: productorio sobre los grupos **con observaciones**. Un
 *     grupo sin observaciones se excluye del producto, no puede vetar (no tendría
 *     información para hacerlo). El producto —no la media— penaliza a cualquier grupo
 *     disidente porque un `p̂` cercano a 0 arrastra todo el GIC hacia 0.
 *  - **Dispersión de `p̂(g,c)` entre grupos**: varianza muestral sobre los grupos con
 *     observaciones. Una afirmación es "divisiva" que generan más desacuerdo entre grupos.
 *
 * Determinismo del ranking: comparamos por `(metrica, suma, observaciones, indice)`
 * descendente y ascendente en el último. Sin `localeCompare`, sin `Math.random()`.
 */

import type { AfirmacionPuntuada } from './types.js';

export interface StatsGrupos {
  /** `p̂(g,c)` por grupo. `p[g][c]` ∈ (0, 1). */
  readonly p: ReadonlyArray<ReadonlyArray<number>>;
  /** Observaciones por grupo. `n[g][c]` es el conteo de votos `+1` o `-1`. */
  readonly n: ReadonlyArray<ReadonlyArray<number>>;
}

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

export function probabilidadesConLaplace(
  acuerdos: ReadonlyArray<ReadonlyArray<number>>,
  observaciones: ReadonlyArray<ReadonlyArray<number>>,
): StatsGrupos {
  if (acuerdos.length !== observaciones.length) {
    throw new Error('dimensión de grupos inconsistente');
  }
  const k = acuerdos.length;
  if (k === 0) {
    return { p: [], n: [] };
  }
  const m = at(acuerdos, 0, 'acuerdos[0]').length;
  const p: number[][] = Array.from({ length: k }, () => new Array<number>(m));
  const n: number[][] = Array.from({ length: k }, () => new Array<number>(m));
  for (let g = 0; g < k; g++) {
    const ag = at(acuerdos, g, 'acuerdos');
    const og = at(observaciones, g, 'observaciones');
    const pg = at(p, g, 'p');
    const ng = at(n, g, 'n');
    if (ag.length !== m || og.length !== m) {
      throw new Error('dimensión de columnas inconsistente');
    }
    for (let c = 0; c < m; c++) {
      const a = at(ag, c, 'acuerdos columna');
      const o = at(og, c, 'observaciones columna');
      // p̂ = (a + 1) / (o + 2). Laplace α=1.
      pg[c] = (a + 1) / (o + 2);
      ng[c] = o;
    }
  }
  return { p, n };
}

/** Afirmaciones puente ordenadas por GIC descendente. */
export function afirmacionesPuente(
  stats: StatsGrupos,
  indiceColumnaOriginal: ReadonlyArray<number>,
): ReadonlyArray<AfirmacionPuntuada> {
  const k = stats.p.length;
  if (k === 0) return [];
  const m = at(stats.p, 0, 'p[0]').length;
  const items: AfirmacionPuntuada[] = [];
  for (let c = 0; c < m; c++) {
    let gic = 1;
    let suma = 0;
    let obsTotales = 0;
    let grupoMin = 0;
    let pMin = Number.POSITIVE_INFINITY;
    for (let g = 0; g < k; g++) {
      const obs = at(at(stats.n, g, 'n'), c, 'observaciones');
      if (obs === 0) continue; // grupo sin observaciones: excluido del producto (no veta)
      const pg = at(at(stats.p, g, 'p'), c, 'probabilidad');
      gic *= pg;
      suma += pg;
      obsTotales += obs;
      if (pg < pMin) {
        pMin = pg;
        grupoMin = g;
      }
    }
    items.push({
      indiceOriginal: at(indiceColumnaOriginal, c, 'indiceColumnaOriginal'),
      metrica: gic,
      sumaProbabilidades: suma,
      observaciones: obsTotales,
      probabilidadesPorGrupo: probabilidadesPorGrupo(stats, c),
      grupoMinimo: grupoMin + 1, // 1-indexado para presentación
    });
  }
  items.sort(ordenarAfirmacionPuente);
  return items;
}

function probabilidadesPorGrupo(stats: StatsGrupos, c: number): ReadonlyArray<number> {
  const out: number[] = [];
  for (let g = 0; g < stats.p.length; g++) {
    if (at(at(stats.n, g, 'n'), c, 'observaciones') > 0) {
      out.push(at(at(stats.p, g, 'p'), c, 'probabilidad'));
    }
  }
  return out;
}

/**
 * Afirmaciones divisivas ordenadas por dispersión descendente.
 * Dispersión = varianza muestral sobre los grupos con observaciones.
 */
export function afirmacionesDivisivas(
  stats: StatsGrupos,
  indiceColumnaOriginal: ReadonlyArray<number>,
): ReadonlyArray<AfirmacionPuntuada> {
  const k = stats.p.length;
  if (k === 0) return [];
  const m = at(stats.p, 0, 'p[0]').length;
  const items: AfirmacionPuntuada[] = [];
  for (let c = 0; c < m; c++) {
    const ps: number[] = [];
    let obsTotales = 0;
    let suma = 0;
    for (let g = 0; g < k; g++) {
      const obs = at(at(stats.n, g, 'n'), c, 'observaciones');
      if (obs > 0) {
        const p = at(at(stats.p, g, 'p'), c, 'probabilidad');
        ps.push(p);
        suma += p;
        obsTotales += obs;
      }
    }
    const grupoMin = ps.length > 0 ? argmin(ps) + 1 : 0;
    const disp = varianza(ps);
    items.push({
      indiceOriginal: at(indiceColumnaOriginal, c, 'indiceColumnaOriginal'),
      metrica: disp,
      sumaProbabilidades: suma,
      observaciones: obsTotales,
      probabilidadesPorGrupo: ps,
      grupoMinimo: grupoMin,
    });
  }
  items.sort(ordenarAfirmacionDivisiva);
  return items;
}

function varianza(xs: ReadonlyArray<number>): number {
  const n = xs.length;
  if (n < 2) return 0;
  let media = 0;
  for (let i = 0; i < xs.length; i++) {
    media += at(xs, i, 'valor');
  }
  media /= n;
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = at(xs, i, 'valor') - media;
    s += d * d;
  }
  return s / (n - 1);
}

function argmin(xs: ReadonlyArray<number>): number {
  let imin = 0;
  let xmin = at(xs, 0, 'xs[0]');
  for (let i = 1; i < xs.length; i++) {
    const x = at(xs, i, 'xs');
    if (x < xmin) {
      xmin = x;
      imin = i;
    }
  }
  return imin;
}

/**
 * Orden para puente:
 *   1. `metrica` (GIC) descendente.
 *   2. `sumaProbabilidades` descendente (desempate).
 *   3. `observaciones` descendente.
 *   4. `indiceOriginal` ascendente (estabilidad bit-bit).
 */
export function ordenarAfirmacionPuente(a: AfirmacionPuntuada, b: AfirmacionPuntuada): number {
  if (a.metrica !== b.metrica) return b.metrica - a.metrica;
  if (a.sumaProbabilidades !== b.sumaProbabilidades) {
    return b.sumaProbabilidades - a.sumaProbabilidades;
  }
  if (a.observaciones !== b.observaciones) return b.observaciones - a.observaciones;
  return a.indiceOriginal - b.indiceOriginal;
}

/**
 * Orden para divisiva:
 *   1. `metrica` (dispersión) descendente.
 *   2. `sumaProbabilidades` ascendente (desempate: a menor suma, mayor conflicto).
 *   3. `observaciones` descendente.
 *   4. `indiceOriginal` ascendente.
 */
export function ordenarAfirmacionDivisiva(a: AfirmacionPuntuada, b: AfirmacionPuntuada): number {
  if (a.metrica !== b.metrica) return b.metrica - a.metrica;
  if (a.sumaProbabilidades !== b.sumaProbabilidades) {
    return a.sumaProbabilidades - b.sumaProbabilidades;
  }
  if (a.observaciones !== b.observaciones) return b.observaciones - a.observaciones;
  return a.indiceOriginal - b.indiceOriginal;
}
