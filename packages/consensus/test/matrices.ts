/**
 * Generadores de matrices de votos para las pruebas.
 *
 * No es un fichero de pruebas (no acaba en `.test.ts`): vitest no lo recoge, sólo se importa.
 *
 * Todo lo aleatorio de aquí es **pseudoaleatorio con semilla explícita**. Una prueba de
 * determinismo que dependiera de `Math.random()` no podría reproducir su propio contraejemplo,
 * que es justo lo único que necesitarías el día que falle.
 */

import fc from 'fast-check';

import type { Celda, MatrizVotos } from '../src/types.js';

/** Congruencial lineal (Numerical Recipes). Basta para generar datos; no se usa en producción. */
export function lcg(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Matriz sin estructura: ruido puro. Es el caso más hostil para el cálculo de ejes. */
export function matrizAleatoria(n: number, m: number, semilla: number): MatrizVotos {
  const r = lcg(semilla);
  const filas: Celda[][] = [];
  for (let i = 0; i < n; i++) {
    const fila: Celda[] = [];
    for (let j = 0; j < m; j++) {
      const u = r();
      fila.push(u < 0.15 ? null : u < 0.3 ? 0 : u < 0.65 ? 1 : -1);
    }
    filas.push(fila);
  }
  return filas;
}

/**
 * Matriz con estructura real: `bloques` facciones con opiniones propias y algo de ruido.
 * Se parece a lo que produce una deliberación de verdad, donde la gente se agrupa.
 */
export function matrizConFacciones(
  n: number,
  m: number,
  bloques: number,
  semilla: number,
): MatrizVotos {
  const r = lcg(semilla);
  const perfiles: number[][] = [];
  for (let g = 0; g < bloques; g++) {
    perfiles.push(Array.from({ length: m }, () => (r() < 0.5 ? 1 : -1)));
  }
  const filas: Celda[][] = [];
  for (let i = 0; i < n; i++) {
    const perfil = perfiles[i % bloques] ?? [];
    const fila: Celda[] = [];
    for (let j = 0; j < m; j++) {
      const u = r();
      const base = (perfil[j] ?? 1) as 1 | -1;
      if (u < 0.08) fila.push(null);
      else if (u < 0.16) fila.push(0);
      else if (u < 0.28) fila.push(base === 1 ? -1 : 1);
      else fila.push(base);
    }
    filas.push(fila);
  }
  return filas;
}

/** Aplica una permutación: `permutar(xs, p)[i] === xs[p[i]]`. */
export function permutar<T>(xs: ReadonlyArray<T>, p: ReadonlyArray<number>): T[] {
  return p.map((i) => xs[i] as T);
}

/** Permuta las columnas de todas las filas. */
export function permutarColumnas(M: MatrizVotos, p: ReadonlyArray<number>): MatrizVotos {
  return M.map((fila) => permutar(fila, p));
}

/** Textos de relleno, uno por afirmación. */
export function textosDe(m: number): string[] {
  return Array.from({ length: m }, (_, j) => `Afirmación número ${(j + 1).toString()}`);
}

/**
 * Ejecuta algo que puede lanzar y devuelve el desenlace como dato.
 *
 * Hace falta porque abortar con un error tipado es un desenlace **legítimo** de este paquete:
 * cuando los dos primeros ejes de variación son casi iguales, la dirección de máxima
 * discrepancia no está determinada por los datos y devolver una cualquiera sería inventarla.
 * Para el determinismo lo que importa no es que siempre haya resultado, sino que la misma
 * entrada produzca siempre el mismo desenlace, sea un valor o sea el mismo fallo.
 */
export type Desenlace<T> =
  { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly error: string };

export function desenlace<T>(f: () => T): Desenlace<T> {
  try {
    return { ok: true, valor: f() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.name : 'desconocido' };
  }
}

/** Celda arbitraria: acuerdo, desacuerdo, paso o ausencia. */
export const arbCelda: fc.Arbitrary<Celda> = fc.constantFrom<Celda>(1, -1, 0, null);

/** Matriz arbitraria rectangular con al menos 2 participantes y 2 afirmaciones. */
export function arbMatriz(
  opciones: { minFilas?: number; maxFilas?: number; minCols?: number; maxCols?: number } = {},
): fc.Arbitrary<MatrizVotos> {
  const minFilas = opciones.minFilas ?? 4;
  const maxFilas = opciones.maxFilas ?? 18;
  const minCols = opciones.minCols ?? 2;
  const maxCols = opciones.maxCols ?? 10;
  return fc.integer({ min: minCols, max: maxCols }).chain((m) =>
    fc.array(fc.array(arbCelda, { minLength: m, maxLength: m }), {
      minLength: minFilas,
      maxLength: maxFilas,
    }),
  );
}

/** Permutación arbitraria de `0..n-1`. */
export function arbPermutacion(n: number): fc.Arbitrary<number[]> {
  return fc.shuffledSubarray(
    Array.from({ length: n }, (_, i) => i),
    { minLength: n, maxLength: n },
  );
}
