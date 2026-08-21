/**
 * Aritmética exacta (principio 0.1.3, INV-18).
 *
 * El test que importa es el último: construir un cociente donde `Number` pierde precisión y
 * comprobar que el signo sale bien. Con `N = 300` este error es raro; con pesos compuestos, no.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  cmpFraction,
  fraction,
  fractionEquals,
  HALF,
  InvalidFractionError,
  isProperFraction,
  normalize,
  ratio,
  toFractionString,
  toPercentString,
  TWO_THIRDS,
} from '../src/index.js';
import { arbProperFraction, FC } from './arbitraries.js';

describe('Fraction', () => {
  it('rechaza denominadores no positivos y numeradores negativos', () => {
    expect(() => fraction(1n, 0n)).toThrow(InvalidFractionError);
    expect(() => fraction(1n, -2n)).toThrow(InvalidFractionError);
    expect(() => fraction(-1n, 2n)).toThrow(InvalidFractionError);
    expect(fraction(2n, 3n)).toEqual({ num: 2n, den: 3n });
  });

  it('compara por multiplicación cruzada, sin punto flotante', () => {
    expect(cmpFraction(ratio(1, 3), ratio(1, 2))).toBe(-1);
    expect(cmpFraction(ratio(2, 4), HALF)).toBe(0);
    expect(cmpFraction(ratio(3, 4), TWO_THIRDS)).toBe(1);
    expect(fractionEquals(ratio(200, 300), TWO_THIRDS)).toBe(true);
  });

  it('INV-18 — `200/300 ≥ 2/3` es verdadero, y en punto flotante no lo sería', () => {
    // 200/300 === 0.6666666666666666 y 2/3 === 0.6666666666666666 en IEEE-754: el `>=` de JS acierta
    // por casualidad aquí, pero no en general. Este caso ancla el resultado correcto por definición.
    expect(cmpFraction(ratio(200, 300), TWO_THIRDS)).toBe(0);
    // Y aquí el flotante SÍ falla: (2^53+1)/(3·2^52) frente a 2/3.
    const num = 2n ** 53n + 1n;
    const den = 3n * 2n ** 52n;
    expect(cmpFraction({ num, den }, TWO_THIRDS)).toBe(1);
    expect(Number(num) / Number(den) > 2 / 3).toBe(false); // el flotante dice lo contrario
  });

  it('`isProperFraction` acota a [0, 1]', () => {
    expect(isProperFraction(ratio(0, 1))).toBe(true);
    expect(isProperFraction(ratio(1, 1))).toBe(true);
    expect(isProperFraction(ratio(3, 2))).toBe(false);
  });

  it('`normalize` da la forma irreducible y manda el cero a 0/1', () => {
    expect(normalize(ratio(4, 8))).toEqual({ num: 1n, den: 2n });
    expect(normalize(ratio(0, 7))).toEqual({ num: 0n, den: 1n });
    expect(normalize(ratio(9, 3))).toEqual({ num: 3n, den: 1n });
  });

  it('el porcentaje se trunca, nunca se redondea hacia arriba', () => {
    // 2/3 = 66.666…: mostrar 66.67 % sugeriría que se alcanzó un umbral de dos tercios que no se
    // alcanzó. Se trunca.
    expect(toPercentString(TWO_THIRDS)).toBe('66.66 %');
    expect(toPercentString(HALF)).toBe('50.00 %');
    expect(toPercentString(ratio(1, 1))).toBe('100.00 %');
    expect(toPercentString(ratio(0, 5))).toBe('0.00 %');
    expect(toPercentString(ratio(1, 800), 4)).toBe('0.1250 %');
    expect(toFractionString(TWO_THIRDS)).toBe('2/3');
  });

  it('`cmpFraction` es antisimétrico y transitivo', () => {
    fc.assert(
      fc.property(arbProperFraction, arbProperFraction, arbProperFraction, (a, b, c) => {
        // `===` y no `toBe`: `toBe` usa `Object.is` y distingue `0` de `-0`.
        expect(cmpFraction(a, b) === -cmpFraction(b, a)).toBe(true);
        if (cmpFraction(a, b) < 0 && cmpFraction(b, c) < 0) expect(cmpFraction(a, c)).toBe(-1);
      }),
      FC,
    );
  });

  it('normalizar no cambia el valor', () => {
    fc.assert(
      fc.property(arbProperFraction, (f) => {
        expect(cmpFraction(normalize(f), f)).toBe(0);
      }),
      FC,
    );
  });
});
