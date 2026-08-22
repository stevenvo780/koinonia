import { describe, expect, it } from 'vitest';

import {
  hamiltonQuotas,
  hmacSha256Hex,
  stratifiedSortition,
  tallySortition,
} from '../src/index.js';
import { SEED_COMMITMENT, STRATUM_SEMESTER } from './arbitraries.js';
import { A, multiConfig } from './tally-helpers.js';

const SEED = 'semilla-administrativa|faro-posterior-al-cierre';

function method(sampleSize: number) {
  return {
    kind: 'deliberative-sortition',
    sampleSize,
    strata: [STRATUM_SEMESTER],
    allocation: 'proportional',
    seedCommitment: SEED_COMMITMENT,
  } as const;
}

describe('B.9 — sorteo deliberativo estratificado', () => {
  it('el ticket implementa HMAC-SHA-256, anclado a un vector conocido', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });

  it('ADR-0027 — Hamilton calcula cuotas y restos únicamente con enteros', async () => {
    const quotas = await hamiltonQuotas(
      new Map([
        ['a', 5],
        ['b', 3],
        ['c', 2],
      ]),
      4,
      SEED,
    );
    expect(quotas.map(({ stratum, quota, remainder }) => [stratum, quota, remainder])).toEqual([
      ['a', 2, 0n],
      ['b', 1, 2n],
      ['c', 1, 8n],
    ]);
    expect(quotas.reduce((sum, quota) => sum + quota.quota, 0)).toBe(4);
  });

  it('INV-55 corregido — acota sampleSize a N ANTES de repartir cuotas', async () => {
    const config = await multiConfig(method(99), [A], 5);
    if (config.method.kind !== 'deliberative-sortition') throw new Error('método inesperado');
    const result = await stratifiedSortition(config.electorate, config.method, SEED);
    expect(result.selected).toHaveLength(5);
    expect(result.quotas.reduce((sum, quota) => sum + quota.quota, 0)).toBe(5);
    expect(new Set(result.selected).size).toBe(5);
  });

  it('INV-56/B.9.c — es determinista y publica ceil(n/3) suplentes por estrato', async () => {
    const config = await multiConfig(method(6), [A], 15);
    if (config.method.kind !== 'deliberative-sortition') throw new Error('método inesperado');
    const first = await stratifiedSortition(config.electorate, config.method, SEED);
    const second = await stratifiedSortition(config.electorate, config.method, SEED);
    expect(second).toEqual(first);
    expect(first.selected).toHaveLength(6);
    for (const substitutes of first.substitutes.values()) expect(substitutes).toHaveLength(2);
    expect((await tallySortition(config, SEED)).outcome).toEqual({
      kind: 'sample',
      selected: first.selected,
    });
  });
});
