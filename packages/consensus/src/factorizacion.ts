/**
 * Factorización enmascarada de 2 factores (ADR-0038).
 *
 * ADR-0038 dice, literalmente: «**Factorización enmascarada de 2 factores**, no imputación por la
 * media: con `n≈300` y `m≈60–150` la matriz tiene ≤45k celdas y la vía enmascarada es trivialmente
 * costeable y **no introduce sesgo contra quien votó poco**».
 *
 * # Qué se ajusta
 *
 * Sobre los residuos `y_ij = voto_ij − media_j`, el modelo es `y_ij ≈ u_i · v_j` con `u_i, v_j ∈ ℝ²`,
 * y la pérdida se evalúa **sólo sobre las celdas observadas**:
 *
 * ```
 * mín  Σ_{(i,j) observada}  ( y_ij − u_i · v_j )²
 * ```
 *
 * Ésa es la diferencia entera con lo anterior. Antes se rellenaba cada hueco con la media de la
 * columna y se proyectaba la fila completa; como el residuo de un hueco imputado es exactamente
 * cero, **quien votó poco salía casi en el origen del mapa**, no por lo que opina sino por lo poco
 * que votó, y acababa absorbido por el grupo central. El sesgo no era un detalle numérico: era una
 * penalización silenciosa a quien menos participa. Con la máscara, las coordenadas de una persona
 * salen del ajuste sobre **las afirmaciones que esa persona votó de verdad**, y votar poco se
 * traduce en una estimación con menos información —no en una opinión desplazada hacia el centro.
 *
 * # Cómo se ajusta, sin perder el determinismo
 *
 * Mínimos cuadrados alternados (ALS): con `v` fijo, cada `u_i` es un sistema 2×2; con `u` fijo,
 * cada `v_j` es otro. Ninguno de los dos pasos necesita azar, y ninguno mira más allá de la
 * máscara. El arranque son los dos ejes de `pca.ts`, que son función de la matriz y de nada más.
 *
 * Que el ALS se detenga por presupuesto de pasos y no por convergencia **no rompe el
 * determinismo**, y conviene separarlo del caso de `PcaNoConvergente`: aquí el número de pasos es
 * fijo y conocido, así que dos ejecuciones de la misma entrada recorren exactamente los mismos
 * pasos y devuelven el mismo número. Lo que `pca.ts` rechaza es otra cosa —una **dirección que los
 * datos no determinan**, donde el resultado dependería de dónde se corte—, y por eso allí sí se
 * aborta.
 *
 * # Por qué hace falta canonicalizar el resultado
 *
 * Un producto `U·Vᵀ` no cambia si se hace `U·A` y `V·A⁻ᵀ`: el par de factores está determinado sólo
 * salvo una transformación 2×2. Sin fijar una, dos matrices con el mismo ajuste darían mapas
 * distintos —girados o estirados—, y con ellos grupos distintos. La parametrización canónica que
 * se elige es la única que ya usaba el paquete y que ADR-0048 describe:
 *
 *  1. `V` ortonormal (los dos ejes, unitarios y perpendiculares);
 *  2. rotados de modo que el primero sea el de mayor dispersión de las coordenadas;
 *  3. con el signo fijado por la regla de ADR-0048 (`Σvᵢ > 0`; si la suma se anula, manda la
 *     componente de mayor magnitud, con desempate por índice menor).
 *
 * Las tres son funciones de la matriz, sin grados de libertad sueltos.
 */

import type { Matrix } from './matrix.js';
import { pca2 } from './pca.js';

/**
 * Pasos de mínimos cuadrados alternados. Cada paso es un barrido completo (todas las filas y
 * todas las columnas). Con `n≈300` y `m≈200` cada barrido cuesta del orden de las celdas
 * observadas, así que el presupuesto es holgado y el coste sigue siendo irrelevante.
 */
const BARRIDOS_MAX = 60;

/** Cambio en los ejes por debajo del cual el barrido siguiente ya no aportaría nada. */
const CONVERGENCIA_ALS = 1e-13;

/**
 * Regularización de Tikhonov **relativa a la traza** de cada sistema 2×2.
 *
 * No es un umbral de decisión de los que prohíbe ADR-0027: no aprueba ni rechaza nada. Es la
 * garantía de que el sistema tiene solución única incluso cuando una persona votó una sola
 * afirmación (el sistema queda de rango 1). Relativa a la traza y no absoluta para que no dependa
 * de la escala de los datos. Como el lado derecho de cada sistema vive siempre en el subespacio
 * generado por los mismos vectores que forman la matriz, la solución regularizada está acotada:
 * el término nunca infla el resultado, sólo lo hace único.
 */
const REGULARIZACION_RELATIVA = 1e-9;

export interface FactorizacionEnmascarada {
  /** Coordenadas de cada participante (n × 2), en el orden canónico de filas. */
  readonly coordenadas: Matrix;
  /** Primer eje de variación (longitud m), en el orden canónico de columnas. Unitario. */
  readonly primerEje: ReadonlyArray<number>;
  /** Segundo eje. Es el vector nulo cuando toda la discrepancia cabe en un solo eje. */
  readonly segundoEje: ReadonlyArray<number>;
  /** Número de factores realmente ajustados: 2, o 1 si no hay segundo eje. */
  readonly factores: number;
}

/**
 * Acceso defensivo a un índice: lanza si es `undefined`. Igual que en `matrix.ts`, evita la
 * aserción no-nula que el linter prohíbe en producción bajo `noUncheckedIndexedAccess`.
 */
function at<T>(xs: ArrayLike<T>, i: number, contexto: string): T {
  const x = xs[i];
  if (x === undefined) {
    throw new Error(`índice ${i.toString()} fuera de rango (${contexto})`);
  }
  return x;
}

/**
 * Ajusta la factorización enmascarada de 2 factores.
 *
 * Propaga `SinVariacion` y `PcaNoConvergente` desde el arranque: si los datos no determinan un
 * primer eje, tampoco determinan la factorización que arrancaría de él.
 */
export function factorizarEnmascarada(
  Y: Matrix,
  mascara: ReadonlyArray<ReadonlyArray<boolean>>,
): FactorizacionEnmascarada {
  const n = Y.length;
  const m = at(Y, 0, 'primera fila de residuos').length;

  // 1. Arranque: los ejes de la iteración de potencia sobre el segundo momento por pares
  //    completos. Función de la matriz, sin azar (ver `pca.ts`).
  const arranque = pca2(Y);
  const rango = esNulo(arranque.segundaComponente) ? 1 : 2;

  // `V` se guarda por ejes: `V[f][j]` es la coordenada `j` del eje `f`.
  let V: Float64Array[] = [Float64Array.from(arranque.primeraComponente)];
  if (rango === 2) V.push(Float64Array.from(arranque.segundaComponente));

  let U: Float64Array[] = [];

  for (let barrido = 0; barrido < BARRIDOS_MAX; barrido++) {
    // 2a. Con los ejes fijos, cada persona: mínimos cuadrados sobre SUS votos observados.
    U = ajustarFilas(Y, mascara, V, n, m, rango);
    // 2b. Con las personas fijas, cada afirmación: sobre quienes SÍ la votaron.
    const Vnuevo = ajustarColumnas(Y, mascara, U, n, m, rango);
    // 2c. Reortonormalizar los ejes y pasar la escala a las coordenadas. El producto `U·Vᵀ` no
    //     cambia; lo que se evita es que una parte crezca mientras la otra se encoge, que dejaría
    //     la regularización de arriba pesando de forma distinta en cada barrido.
    const equilibrado = reortonormalizar(U, Vnuevo, rango, m);
    const delta = distanciaEjes(V, equilibrado.V, rango, m);
    U = equilibrado.U;
    V = equilibrado.V;
    if (delta < CONVERGENCIA_ALS) break;
  }

  // 3. Parametrización canónica: girar a los ejes de mayor dispersión y fijar el signo.
  const canonico = canonicalizar(U, V, rango, n, m);

  const segundoEje =
    rango === 2 ? Array.from(at(canonico.V, 1, 'segundo eje')) : new Array<number>(m).fill(0);

  const coordenadas: number[][] = [];
  for (let i = 0; i < n; i++) {
    const ui = at(canonico.U, i, 'coordenadas');
    coordenadas.push([ui[0] ?? 0, rango === 2 ? (ui[1] ?? 0) : 0]);
  }

  return {
    coordenadas,
    primerEje: Array.from(at(canonico.V, 0, 'primer eje')),
    segundoEje,
    factores: rango,
  };
}

function esNulo(v: ReadonlyArray<number>): boolean {
  for (const x of v) {
    if (x !== 0) return false;
  }
  return true;
}

/** Ajusta las coordenadas de cada participante sobre las afirmaciones que votó. */
function ajustarFilas(
  Y: Matrix,
  mascara: ReadonlyArray<ReadonlyArray<boolean>>,
  V: ReadonlyArray<Float64Array>,
  n: number,
  m: number,
  rango: number,
): Float64Array[] {
  const U: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const filaY = at(Y, i, 'residuos');
    const filaM = at(mascara, i, 'máscara');
    let a00 = 0;
    let a01 = 0;
    let a11 = 0;
    let b0 = 0;
    let b1 = 0;
    for (let j = 0; j < m; j++) {
      if (!at(filaM, j, 'celda enmascarada')) continue; // la celda no votada no entra en la pérdida
      const y = at(filaY, j, 'residuo');
      const v0 = at(at(V, 0, 'eje 0'), j, 'eje 0 componente');
      a00 += v0 * v0;
      b0 += v0 * y;
      if (rango === 2) {
        const v1 = at(at(V, 1, 'eje 1'), j, 'eje 1 componente');
        a01 += v0 * v1;
        a11 += v1 * v1;
        b1 += v1 * y;
      }
    }
    U.push(resolver2x2(a00, a01, a11, b0, b1, rango));
  }
  return U;
}

/** Ajusta cada eje sobre las personas que sí votaron esa afirmación. */
function ajustarColumnas(
  Y: Matrix,
  mascara: ReadonlyArray<ReadonlyArray<boolean>>,
  U: ReadonlyArray<Float64Array>,
  n: number,
  m: number,
  rango: number,
): Float64Array[] {
  const columnas: Float64Array[] = [];
  for (let j = 0; j < m; j++) {
    let a00 = 0;
    let a01 = 0;
    let a11 = 0;
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < n; i++) {
      if (!at(at(mascara, i, 'máscara'), j, 'celda enmascarada')) continue;
      const y = at(at(Y, i, 'residuos'), j, 'residuo');
      const ui = at(U, i, 'coordenadas');
      const u0 = ui[0] ?? 0;
      a00 += u0 * u0;
      b0 += u0 * y;
      if (rango === 2) {
        const u1 = ui[1] ?? 0;
        a01 += u0 * u1;
        a11 += u1 * u1;
        b1 += u1 * y;
      }
    }
    columnas.push(resolver2x2(a00, a01, a11, b0, b1, rango));
  }
  // Se devuelve por ejes (`V[f][j]`), que es como lo consume el resto del módulo.
  const V: Float64Array[] = [];
  for (let f = 0; f < rango; f++) {
    const eje = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      eje[j] = at(columnas, j, 'columna')[f] ?? 0;
    }
    V.push(eje);
  }
  return V;
}

/**
 * Resuelve `(A + λI)x = b` con `A = [[a00,a01],[a01,a11]]` semidefinida positiva.
 *
 * Con `λ` proporcional a la traza el determinante es estrictamente positivo siempre que la traza
 * lo sea: `(a00+λ)(a11+λ) − a01² = (a00·a11 − a01²) + λ(a00+a11) + λ² > 0`, porque el primer
 * paréntesis es ≥ 0 por ser semidefinida positiva. Traza nula significa que no hay ni una
 * observación con la que estimar: la respuesta honesta es el vector nulo, no un número inventado.
 */
function resolver2x2(
  a00: number,
  a01: number,
  a11: number,
  b0: number,
  b1: number,
  rango: number,
): Float64Array {
  const x = new Float64Array(2);
  if (rango === 1) {
    const lambda = a00 * REGULARIZACION_RELATIVA;
    const denom = a00 + lambda;
    x[0] = denom > 0 ? b0 / denom : 0;
    return x;
  }
  const traza = a00 + a11;
  if (!(traza > 0)) return x;
  const lambda = traza * REGULARIZACION_RELATIVA;
  const c00 = a00 + lambda;
  const c11 = a11 + lambda;
  const det = c00 * c11 - a01 * a01;
  if (!(det > 0)) return x;
  x[0] = (c11 * b0 - a01 * b1) / det;
  x[1] = (c00 * b1 - a01 * b0) / det;
  return x;
}

/**
 * Reortonormaliza los ejes (Gram-Schmidt modificado sobre dos vectores) y traslada el factor de
 * escala a las coordenadas, de forma que el producto `U·Vᵀ` no cambia.
 */
function reortonormalizar(
  U: ReadonlyArray<Float64Array>,
  V: ReadonlyArray<Float64Array>,
  rango: number,
  m: number,
): { U: Float64Array[]; V: Float64Array[] } {
  const v0 = Float64Array.from(at(V, 0, 'eje 0'));
  const r00 = norma(v0, m);
  if (r00 === 0) {
    // Un eje que se ha anulado no tiene dirección: se deja como está y las coordenadas también.
    return { U: U.map((u) => Float64Array.from(u)), V: V.map((v) => Float64Array.from(v)) };
  }
  escalar(v0, 1 / r00, m);

  if (rango === 1) {
    const Unuevo = U.map((u) => Float64Array.from([(u[0] ?? 0) * r00, 0]));
    return { U: Unuevo, V: [v0] };
  }

  const v1 = Float64Array.from(at(V, 1, 'eje 1'));
  const r01 = producto(v0, v1, m);
  for (let j = 0; j < m; j++) {
    v1[j] = (v1[j] ?? 0) - r01 * (v0[j] ?? 0);
  }
  const r11 = norma(v1, m);
  if (r11 === 0) {
    return { U: U.map((u) => Float64Array.from(u)), V: V.map((v) => Float64Array.from(v)) };
  }
  escalar(v1, 1 / r11, m);

  // `V_viejo = Q·R` con `R = [[r00, r01],[0, r11]]`, así que
  // `U_viejo·V_viejoᵀ = U_viejo·Rᵀ·Qᵀ` y por tanto `U_nuevo = U_viejo·Rᵀ`.
  //
  // Ojo con la traspuesta: aplicar `R` en vez de `Rᵀ` deja el producto `U·Vᵀ` distinto del que
  // se acababa de ajustar —cuela una parte del primer eje dentro del segundo— y el mapa sale
  // girado sin que nada falle. Se comprueba en `test/factorizacion.test.ts`.
  const Unuevo = U.map((u) => {
    const u0 = u[0] ?? 0;
    const u1 = u[1] ?? 0;
    return Float64Array.from([u0 * r00 + u1 * r01, u1 * r11]);
  });
  return { U: Unuevo, V: [v0, v1] };
}

/**
 * Gira el par (coordenadas, ejes) a la parametrización canónica y fija el signo.
 *
 * El giro es el que diagonaliza la dispersión de las coordenadas: el primer eje pasa a ser el de
 * mayor dispersión. Se resuelve en forma cerrada porque la matriz es 2×2 simétrica; no hay
 * iteración y por tanto no hay nada que pueda cortarse en distinto sitio.
 */
function canonicalizar(
  U: ReadonlyArray<Float64Array>,
  V: ReadonlyArray<Float64Array>,
  rango: number,
  n: number,
  m: number,
): { U: Float64Array[]; V: Float64Array[] } {
  let Ufin = U.map((u) => Float64Array.from(u));
  let Vfin = V.map((v) => Float64Array.from(v));

  if (rango === 2) {
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    for (let i = 0; i < n; i++) {
      const u = at(Ufin, i, 'coordenadas');
      const u0 = u[0] ?? 0;
      const u1 = u[1] ?? 0;
      c00 += u0 * u0;
      c01 += u0 * u1;
      c11 += u1 * u1;
    }
    const rot = rotacionPrincipal(c00, c01, c11);
    Ufin = Ufin.map((u) => {
      const u0 = u[0] ?? 0;
      const u1 = u[1] ?? 0;
      return Float64Array.from([u0 * rot.w00 + u1 * rot.w10, u0 * rot.w01 + u1 * rot.w11]);
    });
    const e0 = at(Vfin, 0, 'eje 0');
    const e1 = at(Vfin, 1, 'eje 1');
    const n0 = new Float64Array(m);
    const n1 = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const a = e0[j] ?? 0;
      const b = e1[j] ?? 0;
      n0[j] = a * rot.w00 + b * rot.w10;
      n1[j] = a * rot.w01 + b * rot.w11;
    }
    Vfin = [n0, n1];
  }

  for (let f = 0; f < rango; f++) {
    const signo = signoCanonico(at(Vfin, f, 'eje'), m);
    if (signo < 0) {
      escalar(at(Vfin, f, 'eje'), -1, m);
      for (const u of Ufin) {
        u[f] = -(u[f] ?? 0);
      }
    }
  }

  return { U: Ufin, V: Vfin };
}

/**
 * Autovectores de `[[c00,c01],[c01,c11]]`, ordenados por dispersión decreciente. Forma cerrada.
 *
 * Empate perfecto (`c01 = 0` y `c00 = c11`, o dispersión nula): la dispersión es la misma en toda
 * dirección y ningún dato distingue un giro de otro, así que se deja la identidad. Es la única
 * elección que no inventa una orientación.
 */
function rotacionPrincipal(
  c00: number,
  c01: number,
  c11: number,
): { w00: number; w01: number; w10: number; w11: number } {
  if (c01 === 0) {
    if (c00 >= c11) return { w00: 1, w01: 0, w10: 0, w11: 1 };
    return { w00: 0, w01: 1, w10: 1, w11: 0 };
  }
  const traza = c00 + c11;
  const disc = Math.sqrt((c00 - c11) * (c00 - c11) + 4 * c01 * c01);
  const lambda1 = (traza + disc) / 2;
  // Autovector de λ₁: (c01, λ₁ − c00). Con `c01 ≠ 0` su norma es ≥ |c01| > 0, así que nunca
  // degenera.
  const x = c01;
  const y = lambda1 - c00;
  const norm = Math.sqrt(x * x + y * y);
  const w00 = x / norm;
  const w10 = y / norm;
  // El segundo es el perpendicular; la orientación la fija después la regla de signo.
  return { w00, w01: -w10, w10, w11: w00 };
}

/**
 * Regla de signo de ADR-0048: `s = Σ vᵢ`; si `|s| > 1e-12`, manda `sign(s)`; si no, manda la
 * componente de mayor magnitud, con desempate por índice menor. Devuelve `+1` o `-1`.
 */
function signoCanonico(v: Float64Array, m: number): number {
  let s = 0;
  for (let j = 0; j < m; j++) s += v[j] ?? 0;
  if (Math.abs(s) > 1e-12) return s > 0 ? 1 : -1;
  let iEstrella = 0;
  let mejor = Math.abs(v[0] ?? 0);
  for (let j = 1; j < m; j++) {
    const a = Math.abs(v[j] ?? 0);
    if (a > mejor) {
      mejor = a;
      iEstrella = j;
    }
  }
  return (v[iEstrella] ?? 0) >= 0 ? 1 : -1;
}

function norma(v: Float64Array, m: number): number {
  let s = 0;
  for (let j = 0; j < m; j++) {
    const x = v[j] ?? 0;
    s += x * x;
  }
  return Math.sqrt(s);
}

function producto(a: Float64Array, b: Float64Array, m: number): number {
  let s = 0;
  for (let j = 0; j < m; j++) s += (a[j] ?? 0) * (b[j] ?? 0);
  return s;
}

function escalar(v: Float64Array, f: number, m: number): void {
  for (let j = 0; j < m; j++) v[j] = (v[j] ?? 0) * f;
}

function distanciaEjes(
  a: ReadonlyArray<Float64Array>,
  b: ReadonlyArray<Float64Array>,
  rango: number,
  m: number,
): number {
  let s = 0;
  for (let f = 0; f < rango; f++) {
    const af = a[f];
    const bf = b[f];
    if (af === undefined || bf === undefined) return Number.POSITIVE_INFINITY;
    for (let j = 0; j < m; j++) {
      const d = (af[j] ?? 0) - (bf[j] ?? 0);
      s += d * d;
    }
  }
  return Math.sqrt(s);
}
