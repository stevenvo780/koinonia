/**
 * Identificadores: forma, orden y ausencia de datos personales.
 *
 * La regla de forma —32 hex en minúscula, no UUID— existe porque el `MemberId` entra en la preimagen
 * del `rollHash`. Un tipo que normalice su representación (la columna `uuid` de PostgreSQL devuelve
 * la forma con guiones) rompería el hash y haría que el sistema se acusara a sí mismo de
 * manipulación. Estos tests fijan esa forma.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  compareIds,
  decisionId,
  hash,
  ID_LENGTH,
  instant,
  InvalidIdError,
  isHash,
  isMemberId,
  isStrictlySorted,
  memberId,
  proposalId,
  sortIds,
  stratumKey,
  ZERO_HASH,
} from '../src/index.js';
import { FC, hex32 } from './arbitraries.js';

const VALID = 'a3f1'.repeat(8);

describe('ids — forma', () => {
  it('acepta 32 caracteres hexadecimales en minúscula', () => {
    expect(memberId(VALID)).toBe(VALID);
    expect(decisionId(VALID)).toBe(VALID);
    expect(proposalId(VALID)).toBe(VALID);
    expect(VALID).toHaveLength(ID_LENGTH);
  });

  it('rechaza el UUID con guiones: normalizar la representación rompería el hash', () => {
    expect(() => memberId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toThrow(InvalidIdError);
  });

  it.each([
    ['mayúsculas', 'A3F1'.repeat(8)],
    ['demasiado corto', 'a3f1'.repeat(7)],
    ['demasiado largo', `${'a3f1'.repeat(8)}0`],
    ['no hexadecimal', `${'a3f1'.repeat(7)}zzzz`],
    ['vacío', ''],
    ['con espacio', `${'a3f1'.repeat(7)}a3f `],
  ])('rechaza %s', (_caso, valor) => {
    expect(() => memberId(valor)).toThrow(InvalidIdError);
    expect(isMemberId(valor)).toBe(false);
  });

  it('un hash mide 64 caracteres y el hash cero es su elemento neutro', () => {
    expect(() => hash(VALID)).toThrow(InvalidIdError);
    expect(hash('0'.repeat(64))).toBe(ZERO_HASH);
    expect(isHash(ZERO_HASH)).toBe(true);
    expect(ZERO_HASH).toHaveLength(64);
  });

  it('una etiqueta de estrato no admite guiones: acabaría siendo clave de una preimagen', () => {
    expect(stratumKey('semestre')).toBe('semestre');
    expect(stratumKey('jornada_nocturna')).toBe('jornada_nocturna');
    expect(() => stratumKey('jornada-nocturna')).toThrow(InvalidIdError);
    expect(() => stratumKey('Semestre')).toThrow(InvalidIdError);
  });

  it('un instante es un entero seguro no negativo', () => {
    expect(instant(0)).toBe(0);
    expect(() => instant(-1)).toThrow(InvalidIdError);
    expect(() => instant(1.5)).toThrow(InvalidIdError);
    expect(() => instant(Number.NaN)).toThrow(InvalidIdError);
    expect(() => instant(2 ** 53)).toThrow(InvalidIdError);
  });
});

describe('ids — orden byte a byte (A.0.b: prohibido localeCompare)', () => {
  it('compara por unidades de código, que en ASCII son los bytes del UTF-8', () => {
    expect(compareIds('a', 'b')).toBe(-1);
    expect(compareIds('b', 'a')).toBe(1);
    expect(compareIds('a', 'a')).toBe(0);
    // Con `localeCompare` en es-CO, '0' y '9' podrían agruparse distinto; aquí nunca.
    expect(compareIds('0'.repeat(32), '1'.repeat(32))).toBe(-1);
  });

  it('ordena y detecta el orden estricto', () => {
    const ids = [hex32(3), hex32(1), hex32(2)];
    expect(sortIds(ids)).toEqual([hex32(1), hex32(2), hex32(3)]);
    expect(isStrictlySorted(sortIds(ids))).toBe(true);
    expect(isStrictlySorted([hex32(1), hex32(1)])).toBe(false);
    expect(isStrictlySorted([])).toBe(true);
  });

  it('`compareIds` es un orden total estricto', () => {
    const arb = fc.integer({ min: 0, max: 500 }).map(hex32);
    fc.assert(
      fc.property(arb, arb, arb, (a, b, c) => {
        // `===` y no `toBe`: `toBe` usa `Object.is`, que distingue `0` de `-0`, y `-0` es lo que
        // produce negar un `0`. La antisimetría se sigue exigiendo exacta.
        expect(compareIds(a, b) === -compareIds(b, a)).toBe(true);
        if (compareIds(a, b) < 0 && compareIds(b, c) < 0) expect(compareIds(a, c)).toBe(-1);
        expect(compareIds(a, a)).toBe(0);
      }),
      FC,
    );
  });

  it('ordenar es idempotente e independiente del orden de entrada', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 200 }), { maxLength: 30 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 200 }), { maxLength: 30 }),
        (a, b) => {
          const ids = [...new Set([...a, ...b])].map(hex32);
          const forward = sortIds(ids);
          const backward = sortIds([...ids].reverse());
          expect(backward).toEqual(forward);
          expect(sortIds(forward)).toEqual(forward);
        },
      ),
      FC,
    );
  });
});
