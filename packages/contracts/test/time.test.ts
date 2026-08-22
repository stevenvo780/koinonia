import { describe, expect, it } from 'vitest';

import { instanteColombia } from '../src/time.js';

describe('instantes escritos en hora de Colombia', () => {
  it('convierte UTC-05:00 sin depender de la zona horaria del proceso', () => {
    expect(instanteColombia('2026-08-21T10:30')).toBe(Date.parse('2026-08-21T10:30:00-05:00'));
  });

  it.each(['', '2026-02-30T10:00', '2026-08-21', '2026-08-21T25:00'])(
    'rechaza el valor inválido %j',
    (value) => {
      expect(() => instanteColombia(value)).toThrow(/hora de Colombia/);
    },
  );
});
