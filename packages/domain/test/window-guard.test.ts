/**
 * T-19 / T-13 (`docs/THREAT_MODEL.md`): ventana mínima y alerta de concentración temporal.
 *
 * Importa directamente de `../src/window-guard.js` y no de `../src/index.js` (la convención del
 * resto de este directorio): el barrel `index.ts` es un fichero compartido fuera del alcance de
 * escritura de este encargo (T-25/T-19, ver el informe de la tarea), así que este módulo todavía no
 * está reexportado ahí. La nota de la tarea deja escrita la línea exacta que falta añadir.
 */

import { describe, expect, it } from 'vitest';

import { type Instant, instant } from '../src/ids.js';
import type { EffectiveWindow } from '../src/window.js';
import {
  alertaConcentracionTemporal,
  duracionDeVentana,
  respetaVentanaMinima,
  UMBRAL_CONCENTRACION_TEMPORAL,
  VENTANA_MINIMA_PRODUCCION_MS,
} from '../src/window-guard.js';

const HOUR = 3_600_000;
const T0: Instant = instant(1_755_000_000_000);

describe('respetaVentanaMinima — T-19/T-13', () => {
  it('72 horas es el piso normativo de producción', () => {
    expect(VENTANA_MINIMA_PRODUCCION_MS).toBe(72 * HOUR);
  });

  it('una ventana de exactamente 72h respeta el piso de 72h', () => {
    expect(respetaVentanaMinima(72 * HOUR, VENTANA_MINIMA_PRODUCCION_MS)).toBe(true);
  });

  it('un milisegundo menos de 72h NO respeta el piso de 72h', () => {
    expect(respetaVentanaMinima(72 * HOUR - 1, VENTANA_MINIMA_PRODUCCION_MS)).toBe(false);
  });

  it('la ventana de 1h que hoy acepta `duracionHoras` en http.ts no pasaría el piso de producción', () => {
    // Documenta el hueco que describe el informe de la tarea: `packages/contracts/src/http.ts`
    // valida `duracionHoras: z.number().int().min(1).max(720)`, así que hoy nada impide abrir una
    // decisión de 1h. Esta prueba fija, del lado del dominio, cuál sería el resultado correcto si
    // ese piso se aplicara: **no**. Que hoy no se aplique es el hueco pendiente, no un error de
    // esta función.
    expect(respetaVentanaMinima(1 * HOUR, VENTANA_MINIMA_PRODUCCION_MS)).toBe(false);
  });

  it('un piso de 0 no rechaza ninguna duración positiva (desarrollo, explícito)', () => {
    expect(respetaVentanaMinima(1 * HOUR, 0)).toBe(true);
    expect(respetaVentanaMinima(1, 0)).toBe(true);
  });

  it('rechaza una duración no positiva', () => {
    expect(() => respetaVentanaMinima(0, VENTANA_MINIMA_PRODUCCION_MS)).toThrow(RangeError);
    expect(() => respetaVentanaMinima(-1, VENTANA_MINIMA_PRODUCCION_MS)).toThrow(RangeError);
  });

  it('rechaza un piso negativo', () => {
    expect(() => respetaVentanaMinima(1 * HOUR, -1)).toThrow(RangeError);
  });

  it('rechaza duraciones o pisos no enteros', () => {
    expect(() => respetaVentanaMinima(1.5, VENTANA_MINIMA_PRODUCCION_MS)).toThrow(RangeError);
    expect(() => respetaVentanaMinima(1 * HOUR, 1.5)).toThrow(RangeError);
  });
});

describe('duracionDeVentana', () => {
  it('es closesAt - opensAt', () => {
    const ventana: EffectiveWindow = { opensAt: T0, closesAt: instant(T0 + 48 * HOUR) };
    expect(duracionDeVentana(ventana)).toBe(48 * HOUR);
  });
});

describe('alertaConcentracionTemporal — T-19', () => {
  // Ventana de 100.000 ms parejos: el último 10 % son los últimos 10.000 ms, [90.000, 100.000).
  const ventana: EffectiveWindow = { opensAt: T0, closesAt: instant(T0 + 100_000) };

  function emisionesEn(offsets: readonly number[]): readonly Instant[] {
    return offsets.map((ms) => instant(T0 + ms));
  }

  it('el umbral declarado es 40%', () => {
    expect(UMBRAL_CONCENTRACION_TEMPORAL).toEqual({ num: 2n, den: 5n });
  });

  it('sin emisiones, no dispara y la proporción es indefinida', () => {
    const resultado = alertaConcentracionTemporal([], ventana);
    expect(resultado).toEqual({
      total: 0,
      enElUltimoTramo: 0,
      proporcion: undefined,
      dispara: false,
    });
  });

  it('reparto uniforme (10% en cada décimo) no dispara: 10% ≤ 40%', () => {
    // Diez emisiones, una en cada décimo de la ventana. Sólo la última cae en el último tramo.
    const emisiones = emisionesEn([
      5_000, 15_000, 25_000, 35_000, 45_000, 55_000, 65_000, 75_000, 85_000, 95_000,
    ]);
    const resultado = alertaConcentracionTemporal(emisiones, ventana);
    expect(resultado.total).toBe(10);
    expect(resultado.enElUltimoTramo).toBe(1);
    expect(resultado.dispara).toBe(false);
  });

  it('exactamente 40% en el último tramo NO dispara: el umbral es estrictamente mayor', () => {
    // 5 emisiones: 2 en el último tramo (>=90_000), 3 antes. 2/5 = 40%.
    const emisiones = emisionesEn([0, 10_000, 20_000, 90_000, 95_000]);
    const resultado = alertaConcentracionTemporal(emisiones, ventana);
    expect(resultado.enElUltimoTramo).toBe(2);
    expect(resultado.total).toBe(5);
    expect(resultado.proporcion).toEqual({ num: 2n, den: 5n });
    expect(resultado.dispara).toBe(false);
  });

  it('más de 40% en el último tramo dispara: el caso de "copar la ventana"', () => {
    // 5 emisiones: 3 en el último tramo. 3/5 = 60% > 40%.
    const emisiones = emisionesEn([0, 10_000, 91_000, 92_000, 99_999]);
    const resultado = alertaConcentracionTemporal(emisiones, ventana);
    expect(resultado.enElUltimoTramo).toBe(3);
    expect(resultado.dispara).toBe(true);
  });

  it('el inicio del tramo final es inclusivo, closesAt sigue siendo exclusivo', () => {
    // El instante exacto en que empieza el último 10% (90_000) cuenta como "último tramo".
    const enElBorde = alertaConcentracionTemporal(emisionesEn([90_000]), ventana);
    expect(enElBorde.enElUltimoTramo).toBe(1);
    // Un milisegundo antes no cuenta.
    const justoAntes = alertaConcentracionTemporal(emisionesEn([89_999]), ventana);
    expect(justoAntes.enElUltimoTramo).toBe(0);
  });

  it('todas las emisiones concentradas en el último instante disparan la alerta al máximo', () => {
    const emisiones = emisionesEn([99_999, 99_999, 99_999]);
    const resultado = alertaConcentracionTemporal(emisiones, ventana);
    expect(resultado.enElUltimoTramo).toBe(3);
    expect(resultado.proporcion).toEqual({ num: 3n, den: 3n });
    expect(resultado.dispara).toBe(true);
  });

  it('rechaza una ventana invertida o vacía', () => {
    expect(() => alertaConcentracionTemporal([], { opensAt: T0, closesAt: T0 })).toThrow(
      RangeError,
    );
  });

  it('rechaza una emisión fuera de la ventana', () => {
    expect(() => alertaConcentracionTemporal(emisionesEn([-1]), ventana)).toThrow(RangeError);
    expect(() => alertaConcentracionTemporal(emisionesEn([100_000]), ventana)).toThrow(RangeError);
  });

  it('es pura: no depende del orden de las emisiones', () => {
    const enOrden = alertaConcentracionTemporal(emisionesEn([0, 91_000, 92_000]), ventana);
    const desordenado = alertaConcentracionTemporal(emisionesEn([92_000, 0, 91_000]), ventana);
    expect(desordenado).toEqual(enOrden);
  });
});
