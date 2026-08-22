import { describe, expect, it } from 'vitest';

import { condorcetWinner, pairwiseMatrix, schulze, tallyCondorcetSchulze } from '../src/index.js';
import { A, B, C, effective, multiConfig, repeatedEffective } from './tally-helpers.js';

const METHOD = {
  kind: 'condorcet-schulze',
  allowTruncation: true,
  truncatedMeans: 'tied-last',
  tieBreak: {
    cascade: ['more-pairwise-wins', 'higher-min-margin', 'lexicographic-hash'],
  },
} as const;

describe('B.8 — Condorcet + Schulze', () => {
  it('INV-43 — si existe ganador de Condorcet, es el único ganador de Schulze', async () => {
    const config = await multiConfig(METHOD, [A, B, C], 7);
    const ballots = repeatedEffective([
      { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
      { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
      { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
    ]);
    const d = pairwiseMatrix(config.options, ballots);
    expect(d[0]).toEqual([0, 5, 4]);
    expect(schulze(config.options, d).winners).toEqual([A]);
    expect((await tallyCondorcetSchulze(config, ballots)).outcome).toEqual({
      kind: 'winner',
      option: A,
      tieBroken: false,
    });
  });

  it('INV-44 — el ciclo de Condorcet conserva un conjunto de Schulze no vacío', async () => {
    const config = await multiConfig(METHOD, [A, B, C], 3);
    const ballots = effective([
      { kind: 'ranking', order: [A, B, C] },
      { kind: 'ranking', order: [B, C, A] },
      { kind: 'ranking', order: [C, A, B] },
    ]);
    const d = pairwiseMatrix(config.options, ballots);
    expect(d).toEqual([
      [0, 2, 1],
      [1, 0, 2],
      [2, 1, 0],
    ]);
    expect(schulze(config.options, d).winners).toEqual([A, B, C]);
    expect((await tallyCondorcetSchulze(config, ballots)).outcome).toMatchObject({
      kind: 'winner',
      tieBroken: true,
    });
  });

  it('B.8 — la demostración reporta el ganador de Condorcet cuando existe, y su ausencia cuando no', async () => {
    const config = await multiConfig(METHOD, [A, B, C], 7);
    const conGanador = await tallyCondorcetSchulze(
      config,
      repeatedEffective([
        { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
      ]),
    );
    expect(conGanador.steps[1]?.evidence['ganadorDeCondorcet']).toBe(A);
    expect(conGanador.steps[1]?.claim).toContain('ganadora de Condorcet');
    expect(conGanador.narrative).toContain('le gana a todas las demás una contra una');

    const enCiclo = await tallyCondorcetSchulze(
      await multiConfig(METHOD, [A, B, C], 3),
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(enCiclo.steps[1]?.evidence['ganadorDeCondorcet']).toBe('no existe');
    expect(enCiclo.steps[1]?.claim).toContain('ciclo');
  });

  it('condorcetWinner distingue el ganador puro del ciclo', () => {
    const conGanador = pairwiseMatrix(
      [A, B, C],
      repeatedEffective([
        { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
      ]),
    );
    expect(condorcetWinner([A, B, C], conGanador)).toBe(A);
    expect(
      condorcetWinner(
        [A, B, C],
        pairwiseMatrix(
          [A, B, C],
          effective([
            { kind: 'ranking', order: [A, B, C] },
            { kind: 'ranking', order: [B, C, A] },
            { kind: 'ranking', order: [C, A, B] },
          ]),
        ),
      ),
    ).toBeUndefined();
  });

  it('con p[i][j] === p[j][i] y la cascada agotada gana el OptionId lexicográficamente MENOR', async () => {
    // Ciclo perfecto: p es simétrica con 2 en todas las casillas, las tres opciones ganan una vez y
    // el margen mínimo de las tres es −1. Ni `more-pairwise-wins` ni `higher-min-margin` separan.
    const config = await multiConfig(
      { ...METHOD, tieBreak: { cascade: ['more-pairwise-wins', 'higher-min-margin'] } },
      [A, B, C],
      3,
    );
    const result = await tallyCondorcetSchulze(
      config,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(result.outcome).toEqual({ kind: 'winner', option: A, tieBroken: true });
  });

  it('B.8.b — una opción rankeada vence a las omitidas, que empatan entre sí', () => {
    const d = pairwiseMatrix([A, B, C], effective([{ kind: 'ranking', order: [A] }]));
    expect(d).toEqual([
      [0, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });
});
