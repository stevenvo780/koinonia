/**
 * Ventanas temporales (D.3): conversión civil de `America/Bogota` y el milisegundo del cierre.
 *
 * Los casos frontera son explícitos, no aleatorios: INV-10 exige probar −1 ms, 0 ms y +1 ms de cada
 * extremo. Es donde vive el único litigio verdaderamente inevitable de una votación con plazo.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BOGOTA_OFFSET_MS,
  bogotaCivilToInstant,
  civilFromDays,
  daysFromCivil,
  DELIBERATION_FLOOR_MS,
  extendWindow,
  formatBogota,
  instant,
  instantToBogotaCivil,
  isClosedAt,
  isWithinWindow,
  respectsDeliberationFloor,
  windowStatus,
} from '../src/index.js';
import { CLOSES_AT, FC, T0 } from './arbitraries.js';

const WINDOW = { opensAt: T0, closesAt: CLOSES_AT };

describe('window — America/Bogota', () => {
  it('el desplazamiento es UTC−05:00 fijo, sin horario de verano', () => {
    expect(BOGOTA_OFFSET_MS).toBe(-5 * 3_600_000);
    // 2026-08-21 08:00 en Bogotá == 2026-08-21 13:00 UTC.
    expect(T0).toBe(Date.UTC(2026, 7, 21, 13, 0, 0, 0));
  });

  it('convierte de ida y vuelta sin `Intl` ni base de husos', () => {
    const civil = instantToBogotaCivil(T0);
    expect(civil).toEqual({
      year: 2026,
      month: 8,
      day: 21,
      hour: 8,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    expect(bogotaCivilToInstant(civil)).toBe(T0);
    expect(formatBogota(T0)).toBe('2026-08-21 08:00:00.000 (America/Bogota, UTC-05:00)');
  });

  it('cruza correctamente la medianoche local (la que está a las 05:00 UTC)', () => {
    const medianoche = bogotaCivilToInstant({
      year: 2026,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    expect(medianoche).toBe(Date.UTC(2026, 0, 1, 5, 0, 0, 0));
    expect(instantToBogotaCivil(instant(medianoche - 1)).year).toBe(2025);
    expect(instantToBogotaCivil(instant(medianoche - 1)).month).toBe(12);
    expect(instantToBogotaCivil(instant(medianoche - 1)).day).toBe(31);
  });

  it('el calendario proléptico gregoriano es correcto en los años bisiestos', () => {
    expect(civilFromDays(daysFromCivil(2024, 2, 29))).toEqual({ year: 2024, month: 2, day: 29 });
    expect(civilFromDays(daysFromCivil(2000, 2, 29))).toEqual({ year: 2000, month: 2, day: 29 });
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2100, 3, 1) - daysFromCivil(2100, 2, 28)).toBe(1); // 2100 no es bisiesto
  });

  it('civil → instante → civil es la identidad', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (ms) => {
        const value = instant(ms);
        expect(bogotaCivilToInstant(instantToBogotaCivil(value))).toBe(value);
      }),
      FC,
    );
  });
});

describe('window — el milisegundo del cierre (D.3.b, INV-10)', () => {
  it('`opensAt` es INCLUSIVO y `closesAt` es EXCLUSIVO', () => {
    expect(isWithinWindow(instant(T0 - 1), WINDOW)).toBe(false);
    expect(isWithinWindow(T0, WINDOW)).toBe(true);
    expect(isWithinWindow(instant(T0 + 1), WINDOW)).toBe(true);
    expect(isWithinWindow(instant(CLOSES_AT - 1), WINDOW)).toBe(true);
    // El caso litigioso: la papeleta del milisegundo exacto se RECHAZA.
    expect(isWithinWindow(CLOSES_AT, WINDOW)).toBe(false);
    expect(isWithinWindow(instant(CLOSES_AT + 1), WINDOW)).toBe(false);
  });

  it('no hay período de gracia (D.3.d)', () => {
    for (const delta of [1, 2, 1000, 60_000]) {
      expect(isWithinWindow(instant(CLOSES_AT + delta), WINDOW)).toBe(false);
    }
  });

  it('los intervalos semiabiertos componen sin solape ni hueco', () => {
    const siguiente = { opensAt: CLOSES_AT, closesAt: instant(CLOSES_AT + 1000) };
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 5 }), (delta) => {
        const t = instant(CLOSES_AT + delta);
        const enPrimera = isWithinWindow(t, WINDOW);
        const enSegunda = isWithinWindow(t, siguiente);
        expect(enPrimera && enSegunda).toBe(false);
        if (delta >= 0 && delta < 1000) expect(enPrimera || enSegunda).toBe(true);
      }),
      FC,
    );
  });

  it('`windowStatus` e `isClosedAt` coinciden con la convención', () => {
    expect(windowStatus(instant(T0 - 1), WINDOW)).toBe('before');
    expect(windowStatus(T0, WINDOW)).toBe('open');
    expect(windowStatus(CLOSES_AT, WINDOW)).toBe('after');
    expect(isClosedAt(instant(CLOSES_AT - 1), WINDOW)).toBe(false);
    expect(isClosedAt(CLOSES_AT, WINDOW)).toBe(true);
  });
});

describe('window — prórroga y piso de deliberación', () => {
  it('la prórroga sólo aumenta el cierre (INV-38)', () => {
    const extended = extendWindow(WINDOW, 24 * 3_600_000);
    expect(extended.closesAt).toBe(CLOSES_AT + 24 * 3_600_000);
    expect(extended.opensAt).toBe(T0);
    expect(() => extendWindow(WINDOW, 0)).toThrow(RangeError);
    expect(() => extendWindow(WINDOW, -1)).toThrow(RangeError);
  });

  it('D.4.c — el cierre anticipado nunca ocurre antes de opensAt + 24 h', () => {
    expect(DELIBERATION_FLOOR_MS).toBe(24 * 3_600_000);
    expect(respectsDeliberationFloor(instant(T0 + DELIBERATION_FLOOR_MS - 1), WINDOW)).toBe(false);
    expect(respectsDeliberationFloor(instant(T0 + DELIBERATION_FLOOR_MS), WINDOW)).toBe(true);
  });
});
