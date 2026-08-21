/**
 * Proyección canónica y hashing del dominio (A.1.1).
 *
 * Las tres reglas previas a JCS son las que hacen que dos verificadores honestos no discrepen:
 * conjuntos ordenados, sin `undefined`, sin números fraccionarios. Este módulo **rechaza** en vez de
 * acomodar, que es lo contrario de lo que hace `JSON.stringify`.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalBytes,
  deepFreeze,
  hashCanonical,
  hashText,
  NotCanonicalizableError,
  ratio,
  toCanonicalJson,
  ZERO_HASH,
} from '../src/index.js';

describe('toCanonicalJson', () => {
  it('convierte `bigint` a cadena decimal: una fracción se hashea como `{den, num}`', () => {
    expect(toCanonicalJson(ratio(2, 3))).toEqual({ num: '2', den: '3' });
    expect(toCanonicalJson(10n ** 30n)).toBe('1000000000000000000000000000000');
  });

  it('omite las claves ausentes en vez de escribir `null` o `undefined`', () => {
    expect(toCanonicalJson({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
    expect(toCanonicalJson({})).toEqual({});
  });

  it('rechaza `null`, `undefined` suelto, números fraccionarios y tipos no serializables', () => {
    expect(() => toCanonicalJson(null)).toThrow(NotCanonicalizableError);
    expect(() => toCanonicalJson(undefined)).toThrow(NotCanonicalizableError);
    expect(() => toCanonicalJson(1.5)).toThrow(NotCanonicalizableError);
    expect(() => toCanonicalJson(Number.NaN)).toThrow(NotCanonicalizableError);
    expect(() => toCanonicalJson(2 ** 53)).toThrow(NotCanonicalizableError);
    expect(() => toCanonicalJson(() => 1)).toThrow(NotCanonicalizableError);
    expect(() => toCanonicalJson(new Map())).toThrow(NotCanonicalizableError);
    expect(() => toCanonicalJson([undefined])).toThrow(NotCanonicalizableError);
  });

  it('el error señala la ruta exacta dentro del valor', () => {
    try {
      toCanonicalJson({ a: { b: [1, 2.5] } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NotCanonicalizableError);
      expect((error as NotCanonicalizableError).path).toBe('a.b[1]');
    }
  });

  it('el orden de las claves del objeto de entrada no cambia los bytes', () => {
    const a = canonicalBytes({ zeta: 1, alfa: 2, media: 3 });
    const b = canonicalBytes({ media: 3, alfa: 2, zeta: 1 });
    expect(new TextDecoder().decode(b)).toBe(new TextDecoder().decode(a));
    expect(new TextDecoder().decode(a)).toBe('{"alfa":2,"media":3,"zeta":1}');
  });

  it('el orden de un ARREGLO sí importa: un arreglo es una secuencia, no un conjunto', () => {
    expect(new TextDecoder().decode(canonicalBytes(['b', 'a']))).toBe('["b","a"]');
    expect(new TextDecoder().decode(canonicalBytes(['a', 'b']))).toBe('["a","b"]');
  });
});

describe('hashCanonical', () => {
  it('es determinista e independiente del orden de construcción del objeto', async () => {
    const a = await hashCanonical({ x: 1, y: [1, 2, 3] });
    const b = await hashCanonical({ y: [1, 2, 3], x: 1 });
    expect(b).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(a).not.toBe(ZERO_HASH);
  });

  it('un cambio mínimo cambia el hash', async () => {
    const a = await hashCanonical({ x: 1 });
    const b = await hashCanonical({ x: 2 });
    expect(b).not.toBe(a);
  });

  it('`hashText` coincide con el `sha256` del texto plano (verificable con `sha256sum`)', async () => {
    // Vector estándar: sha256("abc").
    expect(await hashText('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await hashText('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('deepFreeze', () => {
  it('congela en profundidad y es idempotente', () => {
    const value = deepFreeze({ a: { b: [1, 2] }, c: 'x' });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(() => {
      (value as { c: string }).c = 'y';
    }).toThrow(TypeError);
    expect(deepFreeze(value)).toBe(value);
  });

  it('no se atraganta con ciclos', () => {
    const ciclico: Record<string, unknown> = { a: 1 };
    ciclico['self'] = ciclico;
    expect(Object.isFrozen(deepFreeze(ciclico))).toBe(true);
  });

  it('deja pasar los primitivos', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze('x')).toBe('x');
    expect(deepFreeze(null)).toBe(null);
  });
});
