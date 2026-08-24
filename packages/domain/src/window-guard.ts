/**
 * Dos guardias contra la captura por el grupo mejor organizado (T-19, `docs/THREAT_MODEL.md`):
 * la ventana mínima al abrir una decisión, y la alerta de concentración temporal al cerrarla.
 *
 * ═══ Por qué el piso de la ventana entra como parámetro y no como constante impuesta ═══
 *
 * `docs/THREAT_MODEL.md` (T-19, T-13) promete una ventana mínima de 72 horas, imposible de acortar
 * una vez abierta: «anula la ventaja de la coordinación instantánea». Pero el dominio no lee
 * configuración de entorno (ADR-0001: sin I/O), así que no puede saber por sí mismo si está
 * corriendo en producción o sirviendo una siembra de desarrollo que necesita decisiones de una hora
 * para no perder tres días en cada corrida. `respetaVentanaMinima` no decide eso: sólo compara una
 * duración contra un piso que le dan, y `VENTANA_MINIMA_PRODUCCION_MS` es la referencia normativa
 * para cuando la capa de aplicación decide que corresponde el piso de producción.
 *
 * ═══ La alerta de concentración temporal ═══
 *
 * §3.1 de T-19, variante (a) — «copar la ventana»: esperar a las últimas horas, cuando la posición
 * contraria se relajó, y volcar votos coordinados. La huella que deja es estadística: una
 * desproporción entre cuánto dura el último tramo de la ventana y cuánta emisión cae ahí.
 * `alertaConcentracionTemporal` mide exactamente eso — nada más —, con aritmética de fracción
 * exacta (`fraction.ts`) para que el umbral del 40 % nunca dependa de un redondeo de coma flotante.
 * Es una alerta, no un rechazo: T-19 la pone en la categoría de «detectabilidad alta, nuestra mejor
 * arma», no en la de invalidar votos legítimos emitidos tarde por razones legítimas.
 */

import type { Instant } from './ids.js';
import { cmpFraction, type Fraction, ratio } from './fraction.js';
import type { EffectiveWindow } from './window.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Ventana mínima
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** El piso normativo de producción (T-19, T-13; `docs/THREAT_MODEL.md` §3.6 fila 1): 72 horas. */
export const VENTANA_MINIMA_PRODUCCION_MS = 72 * 60 * 60 * 1000;

/**
 * ¿Esta duración respeta un piso mínimo?
 *
 * Pura y ciega al motivo del piso: no sabe si `pisoMs` es el de producción, el de una prueba o el
 * de una siembra de desarrollo — eso lo decide quien llama. `pisoMs === 0` desactiva la comprobación
 * sin necesitar una rama especial: cualquier duración positiva la cumple.
 */
export function respetaVentanaMinima(duracionMs: number, pisoMs: number): boolean {
  if (!Number.isSafeInteger(duracionMs) || duracionMs <= 0) {
    throw new RangeError('la duración de la ventana debe ser un entero positivo de milisegundos');
  }
  if (!Number.isSafeInteger(pisoMs) || pisoMs < 0) {
    throw new RangeError(
      'el piso de la ventana mínima debe ser un entero no negativo de milisegundos',
    );
  }
  return duracionMs >= pisoMs;
}

/** Duración de una ventana efectiva, en milisegundos. Atajo sobre `closesAt - opensAt`. */
export function duracionDeVentana(ventana: EffectiveWindow): number {
  return ventana.closesAt - ventana.opensAt;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Alerta de concentración temporal
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Más del 40 % de las emisiones en el último tramo dispara la alerta (T-19). */
export const UMBRAL_CONCENTRACION_TEMPORAL: Fraction = ratio(2, 5);

/** El «último tramo» es el 10 % final de la ventana (T-19). */
export const TRAMO_FINAL_DE_VENTANA: Fraction = ratio(1, 10);

export interface AlertaConcentracionTemporal {
  readonly total: number;
  readonly enElUltimoTramo: number;
  /** Fracción exacta `enElUltimoTramo / total`. `undefined` si `total === 0`: nada que concentrar. */
  readonly proporcion: Fraction | undefined;
  /** `true` ⟺ `proporcion > 40 %`. Estrictamente mayor: el 40 % exacto no dispara. */
  readonly dispara: boolean;
}

/**
 * ¿Más del 40 % de las emisiones cayó en el último 10 % de la ventana?
 *
 * `emisiones` es la lista de instantes de emisión (`Ballot.castAt`, o el equivalente de cualquier
 * otro proceso con ventana temporal): esta función no conoce actores ni pesos, sólo cuándo pasó
 * cada cosa, así que agrega sin exponer nunca una cifra por persona (ADR-0040).
 *
 * El tramo final usa el mismo criterio semiabierto que toda ventana en este dominio (D.3.b,
 * `window.ts`): su inicio es inclusivo, `closesAt` sigue siendo exclusivo.
 */
export function alertaConcentracionTemporal(
  emisiones: readonly Instant[],
  ventana: EffectiveWindow,
): AlertaConcentracionTemporal {
  if (ventana.opensAt >= ventana.closesAt) {
    throw new RangeError('la ventana debe ser un intervalo no vacío [opensAt, closesAt)');
  }
  const duracion = ventana.closesAt - ventana.opensAt;
  const inicioTramoFinal = ventana.closesAt - Math.floor(duracion / 10);
  let enElUltimoTramo = 0;
  for (const at of emisiones) {
    if (at < ventana.opensAt || at >= ventana.closesAt) {
      throw new RangeError('una emisión fuera de la ventana no se puede clasificar');
    }
    if (at >= inicioTramoFinal) enElUltimoTramo += 1;
  }
  const total = emisiones.length;
  if (total === 0) {
    return { total: 0, enElUltimoTramo: 0, proporcion: undefined, dispara: false };
  }
  const proporcion = ratio(enElUltimoTramo, total);
  return {
    total,
    enElUltimoTramo,
    proporcion,
    dispara: cmpFraction(proporcion, UMBRAL_CONCENTRACION_TEMPORAL) > 0,
  };
}
