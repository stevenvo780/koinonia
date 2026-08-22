/**
 * Preparación de la matriz de votos.
 *
 * Tres responsabilidades:
 *
 *  1. **Residuos y máscara, sin imputar nada** (ADR-0038: «factorización enmascarada de 2
 *     factores, **no imputación por la media**»). Se calcula la media de cada columna sobre los
 *     votos con postura y se devuelven dos cosas: el residuo `voto − media` de cada celda
 *     **observada**, y una `mascara` que dice qué celdas lo están. La celda no observada no
 *     recibe ningún valor: queda fuera de la máscara y, por tanto, fuera de la función de
 *     pérdida que ajusta los factores (ver `factorizacion.ts`).
 *
 *     Aquí está la diferencia con la versión anterior, que sí imputaba. El residuo de una celda
 *     ausente se guarda como `0` —hay que guardar algo en un hueco de un `Float64Array`—, pero
 *     eso **no** es «imputar la media»: el `0` nunca se usa como dato. Sólo aparece dentro de
 *     sumas de la forma `Σᵢ y_ia·y_ib` donde el término correspondiente vale cero de todas
 *     formas porque el factor está ausente, es decir, en el segundo momento **por pares
 *     completos** `G_ab = Σ_{i: a y b observadas} y_ia·y_ib`. Es una propiedad de esa suma, no un
 *     valor atribuido a nadie. Todo lo que sí depende del valor de la celda —el ajuste de los
 *     factores de cada persona y de cada afirmación— consulta la máscara y salta las ausentes.
 *
 *     `paso` (0) **no** es una ausencia: entra en la máscara como observación de pleno derecho,
 *     porque la persona vio la afirmación y eligió no pronunciarse.
 *  2. **Cálculo de estadísticos por grupo**: cuenta de acuerdos y observaciones por par
 *     (grupo, afirmación), sin tocar `paso` ni ausentes.
 *  3. **Orden canónico** de filas y columnas ANTES del cálculo, con un mapa inverso para
 *     restaurar los índices originales. El orden canónico es una permutación estable: aunque la
 *     entrada esté desordenada, la factorización y el agrupamiento reciben exactamente la misma
 *     secuencia de filas y columnas. Esto, sumado a la canonicalización de signo, es lo que hace
 *     bit-bit determinista la ejecución.
 */

import type { Celda, MatrizVotos } from './types.js';

/**
 * Acceso defensivo a un índice: lanza si es `undefined`. La regla `noUncheckedIndexedAccess`
 * hace que `xs[i]` sea `T | undefined`; cuando **sabemos** que el índice está dentro de los
 * límites (porque acabamos de construir el array con esa longitud), este helper evita la
 * aserción no-nula (`!`) que el linter prohíbe en código de producción.
 */
function at<T>(xs: ArrayLike<T>, i: number, contexto: string): T {
  const x = xs[i];
  if (x === undefined) {
    throw new Error(`índice ${i.toString()} fuera de rango (${contexto})`);
  }
  return x;
}

export interface MatrizPreparada {
  /**
   * Residuos `voto − media_columna` en orden canónico de filas y columnas. En las celdas **no
   * observadas** vale `0` y ese `0` no es un dato: hay que consultar `mascara` antes de usarlo.
   */
  readonly Y: Matrix;
  /** `mascara[i][j]` es `true` si la celda (i,j) canónica se observó (incluye `paso`). */
  readonly mascara: ReadonlyArray<ReadonlyArray<boolean>>;
  /** Permutación de filas en orden canónico: `filas[i]` es el índice de la i-ésima fila canónica en la entrada. */
  readonly filas: ReadonlyArray<number>;
  /** Permutación de columnas en orden canónico. */
  readonly columnas: ReadonlyArray<number>;
  /** Media de cada columna sobre los votos con postura, en orden canónico de columnas. */
  readonly medias: ReadonlyArray<number>;
}

/** Matriz densa mutable internamente. */
export type Matrix = ReadonlyArray<ReadonlyArray<number>>;

/** Construye los residuos enmascarados y los órdenes canónicos. */
export function prepararMatriz(matriz: MatrizVotos): MatrizPreparada {
  if (matriz.length === 0) {
    throw new Error('matriz vacía: al menos un participante');
  }
  const mCols = matriz[0]?.length ?? 0;
  if (mCols === 0) {
    throw new Error('matriz sin columnas: al menos una afirmación');
  }
  for (const fila of matriz) {
    if (fila.length !== mCols) {
      throw new Error('filas con longitudes distintas');
    }
  }

  // 1. Medias por columna sobre votos con postura (+1, -1). `paso` y ausente NO cuentan.
  //
  //    Por qué `paso` no entra en la media: si entrara, la media se acercaría a 0 y el valor
  //    imputado para un hueco se volvería indistinguible del `paso`, que es exactamente lo que
  //    el diseño prohíbe (`paso` y ausente no pueden colapsarse). Excluyéndolo, el hueco se
  //    rellena con «la postura media de quienes sí se pronunciaron», y tras centrar queda en 0
  //    (no aporta covarianza), mientras que el `paso` queda en `-media` (sí aporta). Son cosas
  //    distintas y el cálculo las mantiene distintas.
  //
  //    La suma es de enteros ±1: en coma flotante es exacta, así que la media NO depende del
  //    orden de acumulación. Esto es lo que permite que el orden canónico de columnas (que se
  //    apoya en estos conteos) sea invariante a permutar las filas.
  const medias: number[] = new Array<number>(mCols).fill(0);
  const conteo: number[] = new Array<number>(mCols).fill(0);
  const acuerdosCol: number[] = new Array<number>(mCols).fill(0);
  const desacuerdosCol: number[] = new Array<number>(mCols).fill(0);
  const pasosCol: number[] = new Array<number>(mCols).fill(0);
  for (const fila of matriz) {
    for (let j = 0; j < mCols; j++) {
      const c: Celda = at(fila, j, 'celda de la matriz');
      if (c === null) continue;
      if (c === 0) {
        pasosCol[j] = at(pasosCol, j, 'pasosCol') + 1;
        continue;
      }
      if (c === 1) acuerdosCol[j] = at(acuerdosCol, j, 'acuerdosCol') + 1;
      else desacuerdosCol[j] = at(desacuerdosCol, j, 'desacuerdosCol') + 1;
      medias[j] = at(medias, j, 'medias') + c;
      conteo[j] = at(conteo, j, 'conteo') + 1;
    }
  }
  for (let j = 0; j < mCols; j++) {
    const n = at(conteo, j, 'conteo');
    medias[j] = n > 0 ? at(medias, j, 'medias') / n : 0;
  }

  // 2. Residuos y máscara. Sin imputar: la celda ausente no recibe valor, se marca como ausente.
  const Ycruda: number[][] = [];
  const mascaraCruda: boolean[][] = [];
  for (let i = 0; i < matriz.length; i++) {
    const filaOriginal = at(matriz, i, 'fila');
    const filaRes: number[] = new Array<number>(mCols);
    const filaMasc: boolean[] = new Array<boolean>(mCols);
    for (let j = 0; j < mCols; j++) {
      const c = at(filaOriginal, j, 'celda original');
      if (c === null) {
        filaRes[j] = 0;
        filaMasc[j] = false;
      } else {
        filaRes[j] = c - at(medias, j, 'medias');
        filaMasc[j] = true;
      }
    }
    Ycruda.push(filaRes);
    mascaraCruda.push(filaMasc);
  }

  // 3. Orden canónico. El orden importa y va en este orden, no al revés:
  //
  //    3a. COLUMNAS primero, con una clave que NO mira el orden de las filas: sólo los
  //        recuentos de la columna (posturas, acuerdos, desacuerdos, pasos), que son
  //        multiconjuntos y por tanto invariantes a permutar participantes. Desempate final
  //        por índice de entrada.
  //    3b. FILAS después, comparando su contenido YA en el orden canónico de columnas.
  //
  //    Esta secuencia es la que hace que permutar participantes no cambie NADA: el orden de
  //    columnas no depende de las filas (3a), y el orden de filas depende sólo del contenido
  //    de cada fila (3b), no de su posición de entrada. La matriz canónica resultante es
  //    idéntica bit a bit. Si se hiciera al revés —filas primero, comparando en el orden de
  //    entrada de las columnas— el orden de filas dependería del orden de columnas y la
  //    garantía se perdería.
  //
  //    Límite conocido y declarado: para permutaciones de COLUMNAS la garantía no es exacta.
  //    Dos columnas que empatan en los cuatro recuentos se desempatan por índice de entrada,
  //    así que permutarlas puede intercambiarlas en el orden canónico. La matriz canónica pasa
  //    a ser una permutación simétrica de la anterior; el producto matriz-vector del cálculo de
  //    componentes acumula entonces en otro orden y aparecen diferencias del orden de 1e-16.
  //    En aritmética exacta el resultado es el mismo. Ver `test/props/determinismo.test.ts`.
  const indicesColumnas = Array.from({ length: mCols }, (_, j) => j);
  indicesColumnas.sort((a, b) => {
    const posturas = at(conteo, b, 'conteo') - at(conteo, a, 'conteo');
    if (posturas !== 0) return posturas;
    const ac = at(acuerdosCol, b, 'acuerdosCol') - at(acuerdosCol, a, 'acuerdosCol');
    if (ac !== 0) return ac;
    const des = at(desacuerdosCol, b, 'desacuerdosCol') - at(desacuerdosCol, a, 'desacuerdosCol');
    if (des !== 0) return des;
    const pas = at(pasosCol, b, 'pasosCol') - at(pasosCol, a, 'pasosCol');
    if (pas !== 0) return pas;
    return a - b;
  });

  const indicesFilas = Array.from({ length: matriz.length }, (_, i) => i);
  indicesFilas.sort((a, b) => compararFilas(matriz, indicesColumnas, a, b));

  // 4. Reordenar residuos y máscara al orden canónico.
  const Ycanon: number[][] = [];
  const mascaraCanon: boolean[][] = [];
  for (const i of indicesFilas) {
    const filaY = at(Ycruda, i, 'Ycruda');
    const filaM = at(mascaraCruda, i, 'mascaraCruda');
    const reordenadaY: number[] = new Array<number>(mCols);
    const reordenadaM: boolean[] = new Array<boolean>(mCols);
    for (let k = 0; k < mCols; k++) {
      const j = at(indicesColumnas, k, 'indicesColumnas');
      reordenadaY[k] = at(filaY, j, 'residuo');
      reordenadaM[k] = at(filaM, j, 'máscara');
    }
    Ycanon.push(reordenadaY);
    mascaraCanon.push(reordenadaM);
  }

  // 5. Medias también en el orden canónico (no es estrictamente necesario, pero deja
  //    `medias` coherente con `columnas`).
  const mediasCanon = indicesColumnas.map((j) => at(medias, j, 'medias'));

  return {
    Y: Ycanon,
    mascara: mascaraCanon,
    filas: indicesFilas,
    columnas: indicesColumnas,
    medias: mediasCanon,
  };
}

/**
 * Compara dos filas por su contenido, recorriendo las columnas en el ORDEN CANÓNICO de
 * columnas (no en el de entrada). Sólo si dos filas son idénticas celda a celda se desempata
 * por índice de entrada — y en ese caso da igual cuál vaya primero, porque producen la misma
 * fila en la matriz canónica.
 */
function compararFilas(
  m: MatrizVotos,
  ordenColumnas: ReadonlyArray<number>,
  a: number,
  b: number,
): number {
  const fa = at(m, a, 'fila a');
  const fb = at(m, b, 'fila b');
  const n = ordenColumnas.length;
  for (let k = 0; k < n; k++) {
    const j = at(ordenColumnas, k, 'ordenColumnas');
    const ca = at(fa, j, 'celda a');
    const cb = at(fb, j, 'celda b');
    // Celdas nulas van al final. `paso` (0) entre ausentes y observaciones.
    const oa = ordenCelda(ca);
    const ob = ordenCelda(cb);
    if (oa !== ob) return oa - ob;
    // Mismo tipo de celda: comparar valor con signo.
    const sa = ca === null ? 0 : ca;
    const sb = cb === null ? 0 : cb;
    if (sa !== sb) return sb - sa;
  }
  return a - b;
}

/** Mapea una celda a un número ordinal (orden estable para sort). */
function ordenCelda(c: Celda): number {
  if (c === -1) return 0;
  if (c === 1) return 2;
  if (c === 0) return 1;
  return 3;
}

/**
 * Cuenta acuerdos y observaciones por par (grupo, afirmación).
 *
 * Considera **sólo** los votos observados distintos de `paso` (es decir, `+1` y `-1`). `paso`
 * no es ni acuerdo ni desacuerdo: la persona no se pronunció y no debe contarse como
 * observación.
 */
export interface ConteosGrupo {
  /** Acuerdos por grupo (matriz k × m). */
  readonly acuerdos: number[][];
  /** Observaciones por grupo (matriz k × m). */
  readonly observaciones: number[][];
  /** Tamaño efectivo de cada grupo. */
  readonly tamanoGrupo: number[];
}

export function contarPorGrupo(
  matriz: MatrizVotos,
  asignaciones: ReadonlyArray<number>,
  permutacionFilas: ReadonlyArray<number>,
): ConteosGrupo {
  const n = matriz.length;
  const mCols = matriz[0]?.length ?? 0;
  if (asignaciones.length !== n) {
    throw new Error('asignaciones.length !== filas.length');
  }
  const kMax = asignaciones.length === 0 ? 0 : Math.max(...asignaciones) + 1;
  const acuerdos: number[][] = Array.from({ length: kMax }, () => new Array<number>(mCols).fill(0));
  const observaciones: number[][] = Array.from({ length: kMax }, () =>
    new Array<number>(mCols).fill(0),
  );
  const tamanoGrupo: number[] = new Array<number>(kMax).fill(0);

  for (let i = 0; i < n; i++) {
    const g = at(asignaciones, i, 'asignación');
    tamanoGrupo[g] = (tamanoGrupo[g] ?? 0) + 1;
    const fila = at(matriz, at(permutacionFilas, i, 'permutacionFilas'), 'matriz');
    const acuerdosG = at(acuerdos, g, 'acuerdos');
    const observacionesG = at(observaciones, g, 'observaciones');
    for (let j = 0; j < mCols; j++) {
      const c = at(fila, j, 'celda');
      if (c === null || c === 0) continue;
      observacionesG[j] = (observacionesG[j] ?? 0) + 1;
      if (c === 1) acuerdosG[j] = (acuerdosG[j] ?? 0) + 1;
    }
  }

  return { acuerdos, observaciones, tamanoGrupo };
}

/** Cota inferior para el vector inicial del PCA: `1/sqrt(m)` para cada componente. */
export function vectorInicialPca(m: number): Float64Array {
  if (m <= 0) {
    throw new Error('m debe ser positivo');
  }
  const v = new Float64Array(m);
  const s = 1 / Math.sqrt(m);
  v.fill(s);
  return v;
}
