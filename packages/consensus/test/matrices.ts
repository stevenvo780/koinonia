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

import type { Celda, MatrizVotos, ResultadoAnalisis, ResultadoConsenso } from '../src/types.js';

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

/**
 * Opiniones **homogéneas**: casi todo el mundo de acuerdo en casi todo, con ruido independiente
 * celda a celda. No hay bloques: es el caso en el que la pantalla debe decir «no hay grupos
 * claros» y publicar, aun así, el acuerdo general.
 */
export function matrizHomogenea(n: number, m: number, semilla: number): MatrizVotos {
  const r = lcg(semilla);
  const filas: Celda[][] = [];
  for (let i = 0; i < n; i++) {
    const fila: Celda[] = [];
    for (let j = 0; j < m; j++) {
      const u = r();
      fila.push(u < 0.08 ? null : u < 0.16 ? 0 : u < 0.88 ? 1 : -1);
    }
    filas.push(fila);
  }
  return filas;
}

/**
 * Dos bloques nítidos y enfrentados, con una parte de afirmaciones que comparten. Es la entrada
 * que SIEMPRE tiene que producir dos grupos: si el análisis no los ve aquí, no sirve para nada.
 *
 * `votosCambiados` altera unos pocos votos con una semilla propia, para simular la instantánea
 * siguiente de un sondeo que sigue abierto.
 */
export function dosBloques(n: number, m: number, votosCambiados = 0, semilla = 1): MatrizVotos {
  const filas: Celda[][] = [];
  for (let i = 0; i < n; i++) {
    const bloque: 1 | -1 = i < n / 2 ? 1 : -1;
    filas.push(
      Array.from({ length: m }, (_, j): Celda =>
        j % 4 === 3 ? 1 : j % 2 === 0 ? bloque : bloque === 1 ? -1 : 1,
      ),
    );
  }
  const r = lcg(semilla);
  for (let c = 0; c < votosCambiados; c++) {
    const i = Math.floor(r() * n);
    const j = Math.floor(r() * m);
    const fila = filas[i];
    if (fila === undefined) continue;
    fila[j] = fila[j] === 1 ? -1 : 1;
  }
  return filas;
}

/**
 * Estrecha el resultado a la variante con grupos, fallando con un mensaje útil si no la tiene.
 *
 * Existe porque `analizarConsenso` devuelve una unión discriminada: sin esto, cada prueba
 * repetiría el mismo `if` y, peor, la tentación sería escribir `as ResultadoConsenso` y perder
 * justo la comprobación que la unión existe para forzar.
 */
export function conGrupos(r: ResultadoAnalisis): ResultadoConsenso {
  if (r.tipo !== 'GruposDetectados') {
    throw new Error(
      `se esperaban grupos y salió «no hay grupos claros» (separación ${r.separacionMaxima.toString()})`,
    );
  }
  return r;
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
