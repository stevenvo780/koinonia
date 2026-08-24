/**
 * Utilidades de medición para las pruebas de carga ejecutables con Node puro.
 *
 * Nada de esto depende de k6: son las mismas cuentas (percentiles, no promedios) aplicadas a
 * muestras de `performance.now()` tomadas alrededor de una petición real. El promedio esconde
 * exactamente lo que el pliego pide medir — la cola, no el centro — así que esta librería nunca
 * expone una media sin exponer también p95 y p99 al lado.
 */

import { performance } from 'node:perf_hooks';

/**
 * Percentil por interpolación lineal sobre una muestra YA ORDENADA ascendente.
 * `p` en [0, 100]. Con una sola muestra devuelve esa muestra para cualquier `p`.
 */
export function percentil(ordenada, p) {
  const n = ordenada.length;
  if (n === 0) return NaN;
  if (n === 1) return ordenada[0];
  const rango = (p / 100) * (n - 1);
  const bajo = Math.floor(rango);
  const alto = Math.ceil(rango);
  if (bajo === alto) return ordenada[bajo];
  const peso = rango - bajo;
  return ordenada[bajo] * (1 - peso) + ordenada[alto] * peso;
}

/** Resume una lista de duraciones en milisegundos. No muta el arreglo de entrada. */
export function resumenDeMuestras(muestrasMs) {
  const n = muestrasMs.length;
  if (n === 0) {
    return { n: 0, min: NaN, p50: NaN, p90: NaN, p95: NaN, p99: NaN, max: NaN, media: NaN };
  }
  const ordenada = [...muestrasMs].sort((a, b) => a - b);
  const media = ordenada.reduce((acc, x) => acc + x, 0) / n;
  return {
    n,
    min: ordenada[0],
    p50: percentil(ordenada, 50),
    p90: percentil(ordenada, 90),
    p95: percentil(ordenada, 95),
    p99: percentil(ordenada, 99),
    max: ordenada[n - 1],
    media,
  };
}

export function ms(x) {
  if (!Number.isFinite(x)) return '—';
  return `${x.toFixed(1)} ms`;
}

/**
 * Dispara TODAS las tareas a la vez (`Promise.allSettled`, sin cola ni límite): es la forma
 * correcta de simular «300 personas votando en el mismo minuto», donde nadie espera turno detrás
 * de un semáforo del propio script de carga — el único límite real es el servidor y la base.
 *
 * Cada tarea recibe su índice y debe devolver `{ ok: boolean, detalle?: unknown }`; el tiempo se
 * mide alrededor de la promesa completa, incluida la espera de red.
 */
export async function dispararTodosALaVez(tareas) {
  const resultados = await Promise.allSettled(
    tareas.map(async (tarea, i) => {
      const t0 = performance.now();
      try {
        const detalle = await tarea(i);
        return { ok: true, ms: performance.now() - t0, detalle };
      } catch (error) {
        return { ok: false, ms: performance.now() - t0, error };
      }
    }),
  );
  return resultados.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          ok: false,
          ms: NaN,
          error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)),
        },
  );
}

/**
 * Ejecuta `total` repeticiones de `tarea` con un techo de concurrencia `concurrencia` (una cola de
 * trabajadores, no una ráfaga). Sirve para «carga sostenida» — navegación, consultas — donde lo que
 * se quiere medir es el servicio bajo un nivel constante de tráfico, no un pico instantáneo.
 */
export async function ejecutarConCola({ total, concurrencia, tarea }) {
  const resultados = new Array(total);
  let siguiente = 0;
  async function trabajador() {
    for (;;) {
      const i = siguiente++;
      if (i >= total) return;
      const t0 = performance.now();
      try {
        const detalle = await tarea(i);
        resultados[i] = { ok: true, ms: performance.now() - t0, detalle };
      } catch (error) {
        resultados[i] = { ok: false, ms: performance.now() - t0, error };
      }
    }
  }
  const trabajadores = Array.from({ length: Math.min(concurrencia, total) }, () => trabajador());
  await Promise.all(trabajadores);
  return resultados;
}

export function contarErrores(resultados) {
  return resultados.filter((r) => !r.ok).length;
}

/** Imprime una tabla alineada en consola. `filas` es un arreglo de arreglos de texto ya formateado. */
export function imprimirTabla(encabezados, filas) {
  const anchos = encabezados.map((h, col) =>
    Math.max(h.length, ...filas.map((f) => String(f[col] ?? '').length)),
  );
  const linea = (celdas) => celdas.map((c, i) => String(c).padEnd(anchos[i])).join('  ');
  console.log(linea(encabezados));
  console.log(anchos.map((a) => '-'.repeat(a)).join('  '));
  for (const fila of filas) console.log(linea(fila));
}

/** Cronómetro simple para medir una operación única (no una muestra repetida). */
export function cronometro() {
  const t0 = performance.now();
  return () => performance.now() - t0;
}
