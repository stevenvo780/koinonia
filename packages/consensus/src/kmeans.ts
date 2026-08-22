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
 * Selección de `k`: por silueta promedio sobre `k ∈ [2, min(5, floor(sqrt(n/2)))]`. Empate ⇒ el
 * k menor (parsimonia). El tope de 5 lo fija ADR-0038 («`k` por silueta en 2..5»), y no es un
 * detalle numérico: por encima de cinco, un mapa de facciones deja de ser legible para quien lo
 * mira, y este análisis existe para que alguien lo lea.
 *
 * **Histéresis (ADR-0038).** Con una instantánea anterior, dos cosas se conservan salvo motivo:
 *
 *  1. el **número de grupos**: se mantiene el `k` anterior salvo mejora clara de la separación;
 *  2. la **numeración**: los grupos se emparejan con los de la instantánea anterior por cercanía
 *     de sus centros, de modo que «Grupo 2» siga nombrando al mismo grupo entre dos corridas.
 *
 * Sin lo segundo, lo primero no basta: la numeración por defecto ordena los grupos por su primera
 * coordenada, así que un desplazamiento mínimo que cruce dos centros los intercambia de nombre y
 * el mapa parece haber cambiado cuando no ha cambiado nada.
 *
 * ADR-0038 pide además «semilla fija por snapshot». Aquí **no hay semilla en absoluto**: ni la
 * inicialización (Gonzalez) ni la asignación ni el desempate usan azar. Fijar una semilla sería
 * una garantía más débil que no tener ninguna.
 */

import type { Matrix } from './matrix.js';

const FROBENIUS_EPSILON = 1e-10;
const LLOYD_MAX = 100;

/**
 * Cuánto tiene que mejorar la separación para cambiar el número de grupos respecto de la
 * instantánea anterior: la «mejora clara» de ADR-0038.
 *
 * El ADR exige la histéresis pero no fija el margen, así que el valor se declara aquí. `0,05`
 * sobre una escala de −1 a 1 descarta el vaivén de un `k` que gana por un pelo —el problema que
 * la histéresis viene a resolver: «un `k` que oscila entre corridas destruye la confianza en el
 * mapa»— y deja pasar un cambio de estructura de verdad. No es un umbral de decisión de los que
 * prohíbe ADR-0027: no aprueba ni rechaza nada, elige entre dos formas de dibujar el mismo mapa.
 */
const MEJORA_CLARA = 0.05;

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
 * `min(5, floor(sqrt(n/2)))`, nunca menor que 2.
 *
 * El 5 lo manda ADR-0038 («`k` por silueta en 2..5»). El `floor(sqrt(n/2))` es un tope adicional
 * por tamaño: con doce personas no se pueden distinguir cinco corrientes de opinión.
 *
 * Vive aquí, en un solo sitio, porque el resultado publica este valor y el buscador de `k` lo
 * usa como tope: si cada uno lo calculara por su cuenta podrían separarse sin que nada fallara.
 */
export function kMaximoPara(n: number): number {
  return Math.min(5, Math.max(2, Math.floor(Math.sqrt(n / 2))));
}

export interface OpcionesAgrupamiento {
  /** Fuerza el número de grupos (se recorta al rango permitido). Para pruebas y casos dirigidos. */
  readonly kPreferido?: number;
  /** Número de grupos de la instantánea anterior: se conserva salvo mejora clara. */
  readonly kAnterior?: number;
  /** Centros de la instantánea anterior, en el orden de sus identificadores. */
  readonly centrosAnteriores?: ReadonlyArray<ReadonlyArray<number>>;
}

export interface KMeansResultado {
  readonly k: number;
  readonly asignaciones: ReadonlyArray<number>;
  readonly centroides: ReadonlyArray<ReadonlyArray<number>>;
  readonly inercia: number;
  readonly silhouettePromedio: number;
  /** Mejor separación alcanzada sobre TODOS los `k` examinados; decide el umbral de no-facción. */
  readonly separacionMaxima: number;
  /** Valores de `k` examinados, en orden creciente. */
  readonly kExaminados: ReadonlyArray<number>;
  /** ¿Se conservó el `k` anterior pese a que otro `k` daba algo más de separación? */
  readonly kConservadoPorHisteresis: boolean;
}

/** Ejecuta k-means determinista sobre una matriz de participantes. */
export function kmeansDeterminista(
  X: Matrix,
  opciones: OpcionesAgrupamiento = {},
): KMeansResultado {
  const n = X.length;
  if (n === 0) {
    throw new Error('sin participantes');
  }
  const m = X[0]?.length ?? 0;
  if (m === 0) {
    throw new Error('sin dimensiones');
  }
  const kMax = kMaximoPara(n);
  const centros = opciones.centrosAnteriores;

  // Si se pasó kPreferido, lo usamos directamente (recortado al rango). Si no, buscamos.
  if (opciones.kPreferido !== undefined) {
    const k = clamp(opciones.kPreferido, 2, kMax);
    const r = lloyd(X, k, centros);
    return {
      ...r,
      separacionMaxima: r.silhouettePromedio,
      kExaminados: [k],
      kConservadoPorHisteresis: false,
    };
  }
  return seleccionarK(X, kMax, opciones.kAnterior, centros);
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

interface Candidato {
  readonly k: number;
  readonly resultado: ResultadoLloyd;
}

/**
 * Recorre todos los `k` del rango, se queda con el de mejor separación (empate ⇒ `k` menor,
 * parsimonia) y luego aplica la histéresis: si venimos de una instantánea con `k` anterior dentro
 * del rango, se conserva **salvo mejora clara**.
 *
 * La separación máxima se calcula siempre sobre TODOS los `k` examinados, conserve o no la
 * histéresis el `k` anterior: el umbral de no-facción de ADR-0038 pregunta si existe **algún**
 * agrupamiento con separación suficiente, no si lo tiene el que acabamos de elegir.
 */
function seleccionarK(
  X: Matrix,
  kMax: number,
  kAnterior: number | undefined,
  centrosAnteriores: ReadonlyArray<ReadonlyArray<number>> | undefined,
): KMeansResultado {
  const candidatos: Candidato[] = [];
  for (let k = 2; k <= kMax; k++) {
    candidatos.push({ k, resultado: lloyd(X, k, centrosAnteriores) });
  }
  const primero = candidatos[0];
  if (primero === undefined) {
    throw new Error('rango de número de grupos vacío');
  }

  let mejor = primero;
  for (const c of candidatos) {
    if (c.resultado.silhouettePromedio > mejor.resultado.silhouettePromedio) {
      mejor = c;
    }
  }
  const separacionMaxima = mejor.resultado.silhouettePromedio;

  let elegido = mejor;
  let conservado = false;
  if (kAnterior !== undefined && kAnterior !== mejor.k) {
    const previo = candidatos.find((c) => c.k === kAnterior);
    if (previo !== undefined) {
      const mejora = separacionMaxima - previo.resultado.silhouettePromedio;
      if (!(mejora > MEJORA_CLARA)) {
        elegido = previo;
        conservado = true;
      }
    }
  }

  return {
    ...elegido.resultado,
    separacionMaxima,
    kExaminados: candidatos.map((c) => c.k),
    kConservadoPorHisteresis: conservado,
  };
}

interface ResultadoLloyd {
  readonly k: number;
  readonly asignaciones: ReadonlyArray<number>;
  readonly centroides: ReadonlyArray<ReadonlyArray<number>>;
  readonly inercia: number;
  readonly silhouettePromedio: number;
}

/** Lloyd completo: inicialización Gonzalez + asignación + actualización + relabeling estable. */
function lloyd(
  X: Matrix,
  k: number,
  centrosAnteriores?: ReadonlyArray<ReadonlyArray<number>>,
): ResultadoLloyd {
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

  const { asignaciones: reasignadas, centroides: reordenados } = etiquetar(
    asignaciones,
    centroides,
    centrosAnteriores,
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
 * Numera los grupos.
 *
 * Sin instantánea anterior: por la primera coordenada del centro, ascendente. Es la regla que
 * hace que «Grupo 1» signifique lo mismo en dos ejecuciones de la misma entrada.
 *
 * Con instantánea anterior **y el mismo número de grupos**: por emparejamiento con los centros
 * anteriores, que es la histéresis de numeración de ADR-0038. Si el número de grupos cambió no se
 * empareja nada y se vuelve a la primera coordenada: emparejar tres grupos con dos obligaría a
 * decidir cuál de los nuevos «hereda» un nombre y cuál lo estrena, y ninguna regla automática
 * puede hacer eso sin inventarse una continuidad que los datos no respaldan.
 */
function etiquetar(
  asignaciones: ReadonlyArray<number>,
  centroides: ReadonlyArray<Float64Array>,
  centrosAnteriores: ReadonlyArray<ReadonlyArray<number>> | undefined,
): { asignaciones: number[]; centroides: Float64Array[] } {
  const k = centroides.length;
  const orden =
    centrosAnteriores !== undefined && centrosAnteriores.length === k
      ? ordenPorHerencia(centroides, centrosAnteriores)
      : ordenPorPrimeraCoordenada(centroides);
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

/** Orden por la primera coordenada del centro, ascendente; empate por índice menor. */
function ordenPorPrimeraCoordenada(centroides: ReadonlyArray<Float64Array>): number[] {
  const orden = Array.from({ length: centroides.length }, (_, i) => i);
  orden.sort((a, b) => {
    const ca = at(at(centroides, a, 'centroide'), 0, 'primera coordenada');
    const cb = at(at(centroides, b, 'centroide'), 0, 'primera coordenada');
    if (ca !== cb) return ca - cb;
    return a - b;
  });
  return orden;
}

/**
 * Orden que hereda la numeración anterior: la asignación que minimiza la suma de distancias entre
 * cada centro nuevo y el centro anterior del mismo nombre.
 *
 * Se resuelve por fuerza bruta sobre todas las asignaciones posibles. Con `k ≤ 5` son a lo sumo
 * 120, así que el óptimo exacto es más barato que razonar sobre una heurística voraz —que además
 * podría emparejar mal y renombrar grupos justamente en el caso que la histéresis viene a evitar.
 * El desempate es la primera asignación en orden lexicográfico, que es una función de los datos y
 * no del orden de recorrido.
 */
function ordenPorHerencia(
  centroides: ReadonlyArray<Float64Array>,
  centrosAnteriores: ReadonlyArray<ReadonlyArray<number>>,
): number[] {
  const k = centroides.length;
  const dims = at(centroides, 0, 'centroide').length;
  let mejorOrden: number[] | undefined;
  let mejorCoste = Number.POSITIVE_INFINITY;
  for (const perm of permutaciones(k)) {
    let coste = 0;
    for (let nuevo = 0; nuevo < k; nuevo++) {
      const centro = at(centroides, at(perm, nuevo, 'permutación'), 'centroide');
      const anterior = at(centrosAnteriores, nuevo, 'centro anterior');
      for (let d = 0; d < dims; d++) {
        const delta = (centro[d] ?? 0) - (anterior[d] ?? 0);
        coste += delta * delta;
      }
    }
    // `<` estricto recorriendo en orden lexicográfico: ante un empate gana la primera, que ya
    // está guardada. Es el mismo desempate que se usa en `gonzalez`.
    if (coste < mejorCoste) {
      mejorCoste = coste;
      mejorOrden = perm;
    }
  }
  return mejorOrden ?? ordenPorPrimeraCoordenada(centroides);
}

/** Todas las permutaciones de `0..k-1`, en orden lexicográfico. Sin azar y sin recursión oculta. */
function permutaciones(k: number): number[][] {
  if (k <= 0) return [[]];
  const salida: number[][] = [];
  const actual: number[] = [];
  const usado = new Array<boolean>(k).fill(false);
  const recorrer = (): void => {
    if (actual.length === k) {
      salida.push([...actual]);
      return;
    }
    for (let i = 0; i < k; i++) {
      if (usado[i] === true) continue;
      usado[i] = true;
      actual.push(i);
      recorrer();
      actual.pop();
      usado[i] = false;
    }
  };
  recorrer();
  return salida;
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
