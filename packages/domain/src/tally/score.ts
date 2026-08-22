/** Puntuación 0–5 (B.5): ausencia ignorada, cobertura mínima y mediana ponderada baja. */

import type { DecisionConfig, TieBreakRule } from '../config.js';
import { InvalidBallotForMethod, PreconditionError } from '../errors.js';
import { cmpFraction, normalize, type Fraction } from '../fraction.js';
import { compareIds, type OptionId } from '../ids.js';
import {
  type EffectiveBallot,
  lexicographicHashOrder,
  type MethodTally,
  step,
  totalWeight,
} from './common.js';

export interface ScoreProfile {
  readonly option: OptionId;
  readonly histogram: readonly number[];
  readonly coverage: number;
  readonly sum: number;
  readonly median: number | undefined;
  readonly eligible: boolean;
}

/**
 * Mediana ponderada **baja**: con `W` par se toma la **peor** de las dos puntuaciones centrales, la
 * misma convención pesimista que la mención mayoritaria de B.7.
 *
 * La FÓRMULA, en cambio, no puede ser la misma: aquí `histogram` está indexado de peor a mejor
 * (`0` … `5`, orientación ascendente), así que la peor de las dos centrales es la de índice MENOR y
 * la posición buscada es `floor((W-1)/2)`. En B.7 el vector va de mejor a peor y la posición es
 * `floor(W/2)`. Copiar `floor(W/2)` aquí —como sugiere la línea 1370 de la spec— devolvería la
 * MEJOR de las dos centrales: es la errata E25, y por eso «misma convención que B.7» sólo vale para
 * la semántica, nunca para el índice.
 */
export function weightedMedian(histogram: readonly number[]): number | undefined {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return undefined;
  const target = Math.floor((total - 1) / 2);
  let accumulated = 0;
  for (let value = 0; value < histogram.length; value++) {
    accumulated += histogram[value] ?? 0;
    if (accumulated > target) return value;
  }
  return undefined;
}

export function scoreProfiles(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): readonly ScoreProfile[] {
  if (config.method.kind !== 'score') throw new Error('scoreProfiles exige método score');
  const method = config.method;
  const total = totalWeight(ballots);
  return config.options.map((option) => {
    const histogram = [0, 0, 0, 0, 0, 0];
    let coverage = 0;
    let sum = 0;
    for (const ballot of ballots) {
      if (ballot.payload.kind !== 'score') {
        throw new InvalidBallotForMethod(ballot.payload.kind, config.method.kind);
      }
      const value = ballot.payload.scores[option];
      if (value === null || value === undefined) continue;
      histogram[value] = (histogram[value] ?? 0) + ballot.weight;
      coverage += ballot.weight;
      sum += value * ballot.weight;
    }
    const eligible =
      total > 0 &&
      cmpFraction(normalize({ num: BigInt(coverage), den: BigInt(total) }), method.minCoverage) >=
        0;
    return { option, histogram, coverage, sum, median: weightedMedian(histogram), eligible };
  });
}

function exactMean(profile: ScoreProfile): Fraction {
  return profile.coverage === 0
    ? { num: 0n, den: 1n }
    : normalize({ num: BigInt(profile.sum), den: BigInt(profile.coverage) });
}

function numericMetric(profile: ScoreProfile, rule: TieBreakRule): number | undefined {
  switch (rule) {
    case 'higher-median':
      return profile.median;
    case 'fewer-zeros':
      return -(profile.histogram[0] ?? 0);
    case 'more-fives':
      return profile.histogram[5] ?? 0;
    default:
      return undefined;
  }
}

async function chooseScoreWinner(
  config: DecisionConfig,
  profiles: readonly ScoreProfile[],
): Promise<{ readonly winner: ScoreProfile; readonly tieBroken: boolean }> {
  if (config.method.kind !== 'score') throw new Error('método incorrecto');
  let contenders = [...profiles];
  const bestMedian = Math.max(...contenders.map((profile) => profile.median ?? -1));
  contenders = contenders.filter((profile) => profile.median === bestMedian);
  const tiedOnMedian = contenders.length > 1;

  for (const rule of config.method.tieBreak.cascade) {
    if (contenders.length <= 1) break;
    if (rule === 'higher-mean') {
      const first = contenders[0];
      if (first === undefined) throw new PreconditionError('NO_SCORE_WINNER', 'sin contendientes');
      let best = exactMean(first);
      for (const contender of contenders.slice(1)) {
        const mean = exactMean(contender);
        if (cmpFraction(mean, best) > 0) best = mean;
      }
      contenders = contenders.filter((contender) => cmpFraction(exactMean(contender), best) === 0);
      continue;
    }
    if (rule === 'lexicographic-hash') {
      const ordered = await lexicographicHashOrder(
        config.decisionId,
        contenders.map((profile) => profile.option),
      );
      contenders = contenders.filter((profile) => profile.option === ordered[0]);
      continue;
    }
    const metrics = contenders.map((profile) => numericMetric(profile, rule));
    if (metrics.every((metric) => metric !== undefined)) {
      const best = Math.max(...metrics);
      contenders = contenders.filter((_, index) => metrics[index] === best);
    }
  }

  if (contenders.length > 1) {
    const ordered = await lexicographicHashOrder(
      config.decisionId,
      contenders.map((profile) => profile.option),
    );
    contenders.sort((a, b) => compareIds(a.option, b.option));
    const selected = contenders.find((profile) => profile.option === ordered[0]);
    if (selected !== undefined) contenders = [selected];
  }
  const winner = contenders[0];
  if (winner === undefined) throw new PreconditionError('NO_SCORE_WINNER', 'sin contendientes');
  return { winner, tieBroken: tiedOnMedian };
}

export async function tallyScore(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): Promise<MethodTally> {
  if (config.method.kind !== 'score') throw new Error('tallyScore exige método score');
  const profiles = scoreProfiles(config, ballots);
  const eligible = profiles.filter((profile) => profile.eligible && profile.median !== undefined);
  const rows = profiles.map((profile) => [
    profile.option,
    profile.coverage,
    profile.median ?? 'sin datos',
    `${exactMean(profile).num.toString()}/${exactMean(profile).den.toString()}`,
    profile.eligible ? 'sí' : 'no',
    ...profile.histogram,
  ]);
  if (eligible.length === 0) {
    return {
      outcome: { kind: 'rejected', reason: 'threshold-not-met' },
      steps: [
        step('S1', 'Ninguna opción alcanzó la cobertura mínima para poder ganar.', {
          coberturaMinima: `${config.method.minCoverage.num.toString()}/${config.method.minCoverage.den.toString()}`,
        }),
      ],
      tables: [
        {
          title: 'Puntuaciones por opción',
          columns: [
            'Opción',
            'Cobertura',
            'Mediana',
            'Media exacta',
            'Elegible',
            '0',
            '1',
            '2',
            '3',
            '4',
            '5',
          ],
          rows,
        },
      ],
      narrative:
        'Las opiniones ausentes se ignoraron. Ninguna opción reunió la cobertura mínima declarada, así que ninguna podía ganar.',
    };
  }
  const selected = await chooseScoreWinner(config, eligible);
  return {
    outcome: {
      kind: 'winner',
      option: selected.winner.option,
      tieBroken: selected.tieBroken,
    },
    steps: [
      step(
        'S1',
        'Las ausencias de opinión quedaron fuera del cálculo y se verificó la cobertura.',
        {
          opcionesElegibles: eligible.length,
          pesoTotal: totalWeight(ballots),
        },
      ),
      step('S2', `Ganó la opción ${selected.winner.option} por su mediana ponderada.`, {
        mediana: selected.winner.median ?? 'sin datos',
        desempate: selected.tieBroken ? 'sí' : 'no',
      }),
    ],
    tables: [
      {
        title: 'Puntuaciones por opción',
        columns: [
          'Opción',
          'Cobertura',
          'Mediana',
          'Media exacta',
          'Elegible',
          '0',
          '1',
          '2',
          '3',
          '4',
          '5',
        ],
        rows,
      },
    ],
    narrative:
      `La puntuación ausente no contó como cero. Entre las opciones con cobertura suficiente, ` +
      `${selected.winner.option} obtuvo la mejor mediana ponderada; los empates siguieron la cascada publicada.`,
  };
}
