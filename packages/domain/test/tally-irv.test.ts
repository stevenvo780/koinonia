import { describe, expect, it } from 'vitest';

import { tallyIrv } from '../src/index.js';
import { A, B, C, effective, multiConfig, repeatedEffective } from './tally-helpers.js';

const METHOD = {
  kind: 'irv',
  exhaustedPolicy: 'reduce-quota',
  eliminationTieBreak: {
    cascade: [
      'fewer-first-preferences-in-previous-rounds',
      'pairwise-head-to-head',
      'lexicographic-hash',
    ],
  },
  allowTruncation: true,
  tieBreak: { cascade: ['lexicographic-hash'] },
} as const;

/** Cascada que se agota sin decidir: obliga a llegar a la última red del desempate. */
const UNRESOLVABLE = {
  ...METHOD,
  eliminationTieBreak: {
    cascade: ['fewer-first-preferences-in-previous-rounds', 'pairwise-head-to-head'],
  },
} as const;

describe('B.6 — IRV', () => {
  it('INV-42 — documenta positivamente la no-monotonía de IRV sin empates', async () => {
    const config = await multiConfig(METHOD, [A, B, C], 17);
    const original = await tallyIrv(
      config,
      repeatedEffective([
        { count: 6, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 5, payload: { kind: 'ranking', order: [C, A, B] } },
        { count: 4, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 2, payload: { kind: 'ranking', order: [B, A, C] } },
      ]),
    );
    expect(original.outcome).toEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(original.tables[0]?.rows[0]).toEqual([1, 6, 6, 5, 17, 0, 17, C]);
    expect(original.tables[0]?.rows[1]).toEqual([2, 11, 6, 0, 17, 0, 17, '']);

    // Dos papeletas B>A>C suben A al primer lugar. A mejora de 6 a 8 primeras preferencias,
    // cambia quién cae primero y pierde frente a C. Es una propiedad conocida de IRV, no un bug.
    const raisedA = await tallyIrv(
      config,
      repeatedEffective([
        { count: 8, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 5, payload: { kind: 'ranking', order: [C, A, B] } },
        { count: 4, payload: { kind: 'ranking', order: [B, C, A] } },
      ]),
    );
    expect(raisedA.outcome).toEqual({ kind: 'winner', option: C, tieBroken: false });
    expect(raisedA.tables[0]?.rows[0]).toEqual([1, 8, 4, 5, 17, 0, 17, B]);
    expect(raisedA.tables[0]?.rows[1]).toEqual([2, 8, 0, 9, 17, 0, 17, '']);
  });

  it('declara las papeletas agotadas y reduce la base de cuota cuando así se configuró', async () => {
    const config = await multiConfig(METHOD, [A, B, C], 5);
    const result = await tallyIrv(
      config,
      repeatedEffective([
        { count: 2, payload: { kind: 'ranking', order: [A] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C] } },
        { count: 1, payload: { kind: 'ranking', order: [C, B] } },
      ]),
    );
    expect(result.outcome.kind).toBe('winner');
    expect(result.narrative).toContain('apoyar más a una opción puede perjudicarla');
  });

  it('con la cascada agotada elimina el OptionId lexicográficamente MAYOR', async () => {
    const config = await multiConfig(UNRESOLVABLE, [A, B, C], 4);
    // Primeras preferencias C=2, A=1, B=1. A y B empatan en el mínimo; el enfrentamiento directo
    // A-B queda 2 a 2, así que ningún criterio de la cascada los separa. Se elimina B, la mayor.
    const result = await tallyIrv(
      config,
      effective([
        { kind: 'ranking', order: [C, A, B] },
        { kind: 'ranking', order: [C, B, A] },
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, A, C] },
      ]),
    );
    expect(result.tables[0]?.rows[0]).toEqual([1, 1, 1, 2, 4, 0, 4, B]);
    expect(result.outcome).toMatchObject({ kind: 'winner', tieBroken: true });
  });

  it('en toda ronda los votos activos más las agotadas suman el peso inicial', async () => {
    const config = await multiConfig(METHOD, [A, B, C], 6);
    const result = await tallyIrv(
      config,
      repeatedEffective([
        { count: 2, payload: { kind: 'ranking', order: [A] } },
        { count: 2, payload: { kind: 'ranking', order: [B] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, B] } },
      ]),
    );
    for (const row of result.tables[0]?.rows ?? []) {
      const [, , , , live, exhausted] = row as readonly number[];
      expect((live ?? 0) + (exhausted ?? 0)).toBe(6);
    }
  });
});
