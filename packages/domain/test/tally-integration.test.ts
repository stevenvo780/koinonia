import { describe, expect, it } from 'vitest';

import { type Ballot, instant, ratio, tallyDecision } from '../src/index.js';
import { ballotIdAt, memberIdAt, SEED_COMMITMENT, STRATUM_SEMESTER } from './arbitraries.js';
import {
  A,
  B,
  C,
  EXCELLENT,
  FIVE_GRADE_SCALE,
  GOOD,
  INSUFFICIENT,
  multiConfig,
  REJECT,
} from './tally-helpers.js';

describe('integración de los nuevos métodos con DecisionResult', () => {
  it('valida papeletas score, escruta y hashea un outcome winner', async () => {
    const config = await multiConfig(
      {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage: ratio(1, 2),
        tieBreak: { cascade: ['higher-mean', 'lexicographic-hash'] },
      },
      [A, B],
      3,
    );
    const ballots = [
      {
        voter: memberIdAt(0),
        scores: [
          { option: A, value: 5 as const },
          { option: B, value: 2 as const },
        ],
      },
      {
        voter: memberIdAt(1),
        scores: [
          { option: A, value: 4 as const },
          { option: B, value: 3 as const },
        ],
      },
      // A queda sin puntuar: es «sin opinión», no un cero (B.5.a).
      { voter: memberIdAt(2), scores: [{ option: B, value: 3 as const }] },
    ].map(({ voter, scores }, index) => ({
      ballotId: ballotIdAt(index + 1),
      decisionId: config.decisionId,
      voter,
      round: 1,
      payload: { kind: 'score' as const, scores },
      castAt: instant(config.window.opensAt + index + 1),
      seq: index + 1,
      proposalVersionHash: config.proposalVersionHash,
    }));
    const result = await tallyDecision({
      config,
      ballots,
      closedAt: config.window.closesAt,
      computedFromSeq: ballots.length,
    });
    expect(result.outcome).toEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(result.resultHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('enruta irv, majority-judgment y condorcet-schulze desde el motor', async () => {
    const cast = (
      config: Awaited<ReturnType<typeof multiConfig>>,
      payloads: readonly Ballot['payload'][],
    ): readonly Ballot[] =>
      payloads.map((payload, index) => ({
        ballotId: ballotIdAt(index + 1),
        decisionId: config.decisionId,
        voter: memberIdAt(index),
        round: 1,
        payload,
        castAt: instant(config.window.opensAt + index + 1),
        seq: index + 1,
        proposalVersionHash: config.proposalVersionHash,
      }));

    const irvConfig = await multiConfig(
      {
        kind: 'irv',
        exhaustedPolicy: 'reduce-quota',
        eliminationTieBreak: { cascade: ['pairwise-head-to-head', 'lexicographic-hash'] },
        allowTruncation: true,
        tieBreak: { cascade: ['lexicographic-hash'] },
      },
      [A, B, C],
      3,
    );
    const irv = await tallyDecision({
      config: irvConfig,
      ballots: cast(irvConfig, [
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [A, C, B] },
        { kind: 'ranking', order: [B, C, A] },
      ]),
      closedAt: irvConfig.window.closesAt,
      computedFromSeq: 3,
    });
    expect(irv.outcome).toEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(irv.proof.narrative).toContain('apoyar más a una opción puede perjudicarla');

    const mjConfig = await multiConfig(
      {
        kind: 'majority-judgment',
        scale: FIVE_GRADE_SCALE,
        missingGradePolicy: 'reject-ballot',
        tieBreak: { cascade: ['more-excellent', 'fewer-reject', 'lexicographic-hash'] },
      },
      [A, B],
      3,
    );
    const mj = await tallyDecision({
      config: mjConfig,
      ballots: cast(mjConfig, [
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: REJECT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: GOOD },
            { option: B, grade: INSUFFICIENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: REJECT },
            { option: B, grade: EXCELLENT },
          ],
        },
      ]),
      closedAt: mjConfig.window.closesAt,
      computedFromSeq: 3,
    });
    expect(mj.outcome).toEqual({ kind: 'winner', option: A, tieBroken: false });

    const csConfig = await multiConfig(
      {
        kind: 'condorcet-schulze',
        allowTruncation: false,
        truncatedMeans: 'tied-last',
        tieBreak: { cascade: ['more-pairwise-wins', 'lexicographic-hash'] },
      },
      [A, B, C],
      3,
    );
    const cs = await tallyDecision({
      config: csConfig,
      ballots: cast(csConfig, [
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [A, C, B] },
        { kind: 'ranking', order: [B, C, A] },
      ]),
      closedAt: csConfig.window.closesAt,
      computedFromSeq: 3,
    });
    expect(cs.outcome).toEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(cs.proof.steps.map((s) => s.id)).toContain('CS2');
    expect(cs.proof.steps[2]?.evidence['ganadorDeCondorcet']).toBe(A);
  });

  it('deriva la semilla compuesta y produce un outcome sample sin papeletas', async () => {
    const config = await multiConfig(
      {
        kind: 'deliberative-sortition',
        sampleSize: 2,
        strata: [STRATUM_SEMESTER],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      [A],
      6,
    );
    const result = await tallyDecision({
      config,
      ballots: [],
      closedAt: config.window.closesAt,
      computedFromSeq: 0,
      seed: 'semilla-administrativa|faro-posterior',
    });
    expect(result.outcome.kind).toBe('sample');
    if (result.outcome.kind === 'sample') expect(result.outcome.selected).toHaveLength(2);
  });
});
