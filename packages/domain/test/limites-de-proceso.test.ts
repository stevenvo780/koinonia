/**
 * T-19 (`docs/THREAT_MODEL.md`): tope de objeciones por actor y umbral de postulación.
 *
 * Importa directamente de `../src/limites-de-proceso.js`, no de `../src/index.js`: ver la nota
 * equivalente en `window-guard.test.ts` sobre por qué este módulo todavía no está en el barrel.
 */

import { describe, expect, it } from 'vitest';

import {
  cumpleUmbralDePostulacion,
  FACTOR_MINIMO_DE_POSTULACION,
  objecionAdmisiblePorTope,
  TOPE_OBJECIONES_LIBRES_POR_ACTOR,
} from '../src/limites-de-proceso.js';

describe('objecionAdmisiblePorTope — T-19', () => {
  it('el tope libre declarado es 2', () => {
    expect(TOPE_OBJECIONES_LIBRES_POR_ACTOR).toBe(2);
  });

  it('la primera y la segunda objeción son libres, con o sin respaldo', () => {
    expect(objecionAdmisiblePorTope(0, false)).toBe(true);
    expect(objecionAdmisiblePorTope(1, false)).toBe(true);
  });

  it('la tercera objeción sin respaldo se rechaza', () => {
    expect(objecionAdmisiblePorTope(2, false)).toBe(false);
  });

  it('la tercera objeción con respaldo se admite', () => {
    expect(objecionAdmisiblePorTope(2, true)).toBe(true);
  });

  it('la cuarta y siguientes siguen exigiendo respaldo', () => {
    expect(objecionAdmisiblePorTope(3, false)).toBe(false);
    expect(objecionAdmisiblePorTope(10, false)).toBe(false);
    expect(objecionAdmisiblePorTope(10, true)).toBe(true);
  });

  it('rechaza un conteo negativo o no entero', () => {
    expect(() => objecionAdmisiblePorTope(-1, true)).toThrow(RangeError);
    expect(() => objecionAdmisiblePorTope(1.5, true)).toThrow(RangeError);
  });
});

describe('cumpleUmbralDePostulacion — T-19', () => {
  it('el factor declarado es 3×', () => {
    expect(FACTOR_MINIMO_DE_POSTULACION).toBe(3);
  });

  it('exactamente 3× postulantes que plazas alcanza el umbral', () => {
    expect(cumpleUmbralDePostulacion(9, 3)).toBe(true);
  });

  it('un postulante menos de 3× NO alcanza el umbral', () => {
    expect(cumpleUmbralDePostulacion(8, 3)).toBe(false);
  });

  it('con una sola plaza, hacen falta al menos 3 postulantes', () => {
    expect(cumpleUmbralDePostulacion(2, 1)).toBe(false);
    expect(cumpleUmbralDePostulacion(3, 1)).toBe(true);
  });

  it('cero postulantes nunca alcanza el umbral (mientras haya al menos una plaza)', () => {
    expect(cumpleUmbralDePostulacion(0, 1)).toBe(false);
  });

  it('rechaza plazas cero, negativas o no enteras', () => {
    expect(() => cumpleUmbralDePostulacion(9, 0)).toThrow(RangeError);
    expect(() => cumpleUmbralDePostulacion(9, -1)).toThrow(RangeError);
    expect(() => cumpleUmbralDePostulacion(9, 1.5)).toThrow(RangeError);
  });

  it('rechaza postulantes negativos o no enteros', () => {
    expect(() => cumpleUmbralDePostulacion(-1, 3)).toThrow(RangeError);
    expect(() => cumpleUmbralDePostulacion(1.5, 3)).toThrow(RangeError);
  });
});
