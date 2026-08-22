import { describe, expect, it } from 'vitest';

import { ratio, tallyScore, weightedMedian } from '../src/index.js';
import { A, B, effective, multiConfig } from './tally-helpers.js';

const METHOD = {
  kind: 'score',
  min: 0,
  max: 5,
  aggregator: 'median',
  noOpinionPolicy: 'ignore',
  minCoverage: ratio(3, 4),
  tieBreak: { cascade: ['higher-mean', 'fewer-zeros', 'more-fives', 'lexicographic-hash'] },
} as const;

describe('B.5 — score voting 0–5', () => {
  it('usa la mediana baja: floor((W-1)/2), también con peso par', () => {
    expect(weightedMedian([1, 0, 0, 0, 0, 1])).toBe(0);
    expect(weightedMedian([0, 1, 0, 1, 0, 0])).toBe(1);
  });

  it('INV-50 — `null` se ignora y una opción sin cobertura no puede ganar', async () => {
    const config = await multiConfig(METHOD, [A, B], 4);
    const result = await tallyScore(
      config,
      effective([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
      ]),
    );
    expect(result.outcome).toEqual({ kind: 'winner', option: B, tieBroken: false });
    expect(result.tables[0]?.rows).toEqual([
      [A, 2, 5, '5/1', 'no', 0, 0, 0, 0, 0, 2],
      [B, 4, 3, '3/1', 'sí', 0, 0, 0, 4, 0, 0],
    ]);
  });

  it('desempata medianas con la media exacta, nunca con float', async () => {
    const config = await multiConfig({ ...METHOD, minCoverage: ratio(1, 1) }, [A, B], 2);
    const result = await tallyScore(
      config,
      effective([
        { kind: 'score', scores: { [A]: 3, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
      ]),
    );
    expect(result.outcome).toEqual({ kind: 'winner', option: A, tieBroken: true });
  });
});
