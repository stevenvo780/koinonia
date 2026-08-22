/**
 * Propiedades de los cinco métodos de la PARTE B que faltaban: puntuación, IRV, menciones,
 * Condorcet/Schulze y sorteo estratificado.
 *
 * ═══ Cómo se leen las exclusiones ═══
 *
 * Ninguna propiedad general se aplica a un método que no la cumple. Cuando un método queda fuera,
 * queda fuera **con nombre y razón en el título del test**, con el filtro visible en el código, y con
 * una prueba POSITIVA en otro fichero que demuestra el fallo con números concretos. Nunca con `skip`,
 * nunca borrando el caso incómodo (docs/TESTING.md §«El caso de IRV»).
 *
 * Las tres exclusiones vigentes:
 *
 * | propiedad | método excluido | prueba positiva del fallo |
 * |---|---|---|
 * | monotonía (INV-40 / A-01) | `irv` | `tally-irv.test.ts` › «INV-42 — documenta positivamente la no-monotonía…» |
 * | *later-no-harm* | `majority-judgment` | `tally-majority-judgment.test.ts` › «documenta que MJ NO satisface later-no-harm…» |
 * | perdedor de Condorcet nunca gana | `majority-judgment` | aquí abajo, «MJ elige al perdedor de Condorcet» + `tally-majority-judgment.test.ts` › «…mayoría fuerte» |
 */

import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  condorcetWinner,
  type DecisionConfig,
  type EffectiveBallot,
  type Electorate,
  hamiltonQuotas,
  hmacSha256Hex,
  majorityGrade,
  majorityJudgmentProfiles,
  type MethodTally,
  mjCompare,
  type OptionId,
  pairwiseMatrix,
  ratio,
  schulze,
  stratifiedSortition,
  tallyCondorcetSchulze,
  tallyIrv,
  tallyMajorityJudgment,
  tallyScore,
  weightedMedian,
} from '../../src/index.js';
import { buildElectorate, optionIdAt, SEED_COMMITMENT, STRATUM_SEMESTER } from '../arbitraries.js';
import {
  A,
  ACCEPTABLE,
  B,
  C,
  D,
  EXCELLENT,
  FIVE_GRADE_SCALE,
  GOOD,
  INSUFFICIENT,
  multiConfig,
  REJECT,
  repeatedEffective,
} from '../tally-helpers.js';

/** Corridas por propiedad, escalables con `FC_RUNS`. Semilla fija del repo (docs/TESTING.md). */
const RUNS = Number(process.env['FC_RUNS'] ?? '1000');
const FC = { numRuns: RUNS, seed: 30_000_821, verbose: 0 } as const;
const runs = (atDefault: number): { numRuns: number; seed: number } => ({
  seed: FC.seed,
  numRuns: Math.max(5, Math.round((RUNS * atDefault) / 1000)),
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Métodos y configuraciones, construidos una sola vez
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Puntuación y menciones se generan sobre tres opciones; los métodos ordinales, sobre cuatro. */
const OPTIONS = [A, B, C] as const;
const RANKED_OPTIONS = [A, B, C, D] as const;

const SCORE_METHOD = {
  kind: 'score',
  min: 0,
  max: 5,
  aggregator: 'median',
  noOpinionPolicy: 'ignore',
  minCoverage: ratio(1, 2),
  tieBreak: { cascade: ['higher-mean', 'fewer-zeros', 'more-fives', 'lexicographic-hash'] },
} as const;

const MJ_METHOD = {
  kind: 'majority-judgment',
  scale: FIVE_GRADE_SCALE,
  missingGradePolicy: 'reject-ballot',
  tieBreak: { cascade: ['more-excellent', 'fewer-reject', 'lexicographic-hash'] },
} as const;

const IRV_METHOD = {
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

const CS_METHOD = {
  kind: 'condorcet-schulze',
  allowTruncation: true,
  truncatedMeans: 'tied-last',
  tieBreak: { cascade: ['more-pairwise-wins', 'higher-min-margin', 'lexicographic-hash'] },
} as const;

const SORTITION_METHOD = (sampleSize: number) =>
  ({
    kind: 'deliberative-sortition',
    sampleSize,
    strata: [STRATUM_SEMESTER],
    allocation: 'proportional',
    seedCommitment: SEED_COMMITMENT,
  }) as const;

let scoreConfig: DecisionConfig;
let mjConfig: DecisionConfig;
let mjLenientConfig: DecisionConfig;
let irvConfig: DecisionConfig;
let csConfig: DecisionConfig;
let electorates: readonly Electorate[];

beforeAll(async () => {
  scoreConfig = await multiConfig(SCORE_METHOD, [...OPTIONS], 16);
  mjConfig = await multiConfig(MJ_METHOD, [...OPTIONS], 16);
  mjLenientConfig = await multiConfig(
    { ...MJ_METHOD, missingGradePolicy: 'worst' },
    [...OPTIONS],
    16,
  );
  irvConfig = await multiConfig(IRV_METHOD, [...RANKED_OPTIONS], 16);
  csConfig = await multiConfig(CS_METHOD, [...RANKED_OPTIONS], 16);
  electorates = await Promise.all([4, 7, 11, 16].map((size) => buildElectorate(size)));
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Generadores de perfiles
// ═════════════════════════════════════════════════════════════════════════════════════════════

type ScoreCell = 0 | 1 | 2 | 3 | 4 | 5 | null;
type ScoreRow = readonly [ScoreCell, ScoreCell, ScoreCell];
type GradeRow = readonly [number, number, number];

/**
 * Las 24 permutaciones de `[A,B,C,D]`, en orden fijo para que la semilla reproduzca.
 *
 * Los perfiles ordinales usan CUATRO opciones y no tres a propósito. Con tres, y forzando `A` por
 * encima de `B` en todas las papeletas (la prueba de Pareto), las cuentas de primeras preferencias
 * quedan atrapadas: `B` vale siempre 0 y `A` y `C` sólo pueden evitar la mayoría empatando, con lo
 * que el enfrentamiento directo `A`–`C` también empata siempre. El espacio alcanzable es tan pobre
 * que una implementación que eliminara la opción MÁS votada en vez de la menos votada pasaba la
 * prueba. Con cuatro opciones el contraejemplo aparece, y se comprobó que aparece.
 */
const RANKINGS: readonly (readonly OptionId[])[] = (() => {
  const permute = (items: readonly OptionId[]): readonly (readonly OptionId[])[] =>
    items.length <= 1
      ? [items]
      : items.flatMap((head, index) =>
          permute([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
            head,
            ...rest,
          ]),
        );
  return permute([A, B, C, D]);
})();

const GRADE_IDS = [EXCELLENT, GOOD, ACCEPTABLE, INSUFFICIENT, REJECT] as const;

const arbCell = fc.option(fc.integer({ min: 0, max: 5 }), { nil: null, freq: 5 }) as fc.Arbitrary<
  Exclude<ScoreCell, undefined>
>;
const arbScoreProfile = fc.array(fc.tuple(arbCell, arbCell, arbCell), {
  minLength: 1,
  maxLength: 9,
});
const arbGradeProfile = fc.array(
  fc.tuple(
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: 0, max: 4 }),
  ),
  { minLength: 1, maxLength: 9 },
);
/** Rankings completos: la unanimidad y el criterio de Condorcet exigen preferencias expresadas. */
const arbFullRankingProfile = fc.array(fc.constantFrom(...RANKINGS), {
  minLength: 1,
  maxLength: 9,
});
/** Rankings posiblemente truncados, para ejercitar las papeletas agotadas de IRV. */
const arbTruncatedRankingProfile = fc.array(
  fc
    .tuple(fc.constantFrom(...RANKINGS), fc.integer({ min: 1, max: 4 }))
    .map(([order, length]) => order.slice(0, length)),
  { minLength: 1, maxLength: 9 },
);

function scoreBallots(profile: readonly ScoreRow[]): readonly EffectiveBallot[] {
  return repeatedEffective(
    profile.map((row) => ({
      count: 1,
      payload: { kind: 'score', scores: { [A]: row[0], [B]: row[1], [C]: row[2] } } as const,
    })),
  );
}

function gradeBallots(profile: readonly GradeRow[]): readonly EffectiveBallot[] {
  return repeatedEffective(
    profile.map((row) => ({
      count: 1,
      payload: {
        kind: 'grades',
        grades: {
          [A]: GRADE_IDS[row[0]] ?? EXCELLENT,
          [B]: GRADE_IDS[row[1]] ?? EXCELLENT,
          [C]: GRADE_IDS[row[2]] ?? EXCELLENT,
        },
      } as const,
    })),
  );
}

function rankingBallots(profile: readonly (readonly OptionId[])[]): readonly EffectiveBallot[] {
  return repeatedEffective(
    profile.map((order) => ({ count: 1, payload: { kind: 'ranking', order } as const })),
  );
}

function winnerOf(tally: MethodTally): OptionId | undefined {
  return tally.outcome.kind === 'winner' ? tally.outcome.option : undefined;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Determinismo y orden de llegada
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('determinismo e independencia del orden (los cinco métodos)', () => {
  it('el mismo perfil produce exactamente el mismo escrutinio — score, IRV, MJ, Schulze', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbScoreProfile,
        arbGradeProfile,
        arbTruncatedRankingProfile,
        async (scores, grades, rankings) => {
          expect(await tallyScore(scoreConfig, scoreBallots(scores))).toEqual(
            await tallyScore(scoreConfig, scoreBallots(scores)),
          );
          expect(await tallyMajorityJudgment(mjConfig, gradeBallots(grades))).toEqual(
            await tallyMajorityJudgment(mjConfig, gradeBallots(grades)),
          );
          expect(await tallyIrv(irvConfig, rankingBallots(rankings))).toEqual(
            await tallyIrv(irvConfig, rankingBallots(rankings)),
          );
          expect(await tallyCondorcetSchulze(csConfig, rankingBallots(rankings))).toEqual(
            await tallyCondorcetSchulze(csConfig, rankingBallots(rankings)),
          );
        },
      ),
      runs(300),
    );
  });

  it('el sorteo es determinista por semilla y cambia con ella (INV-56)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 20 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (index, sampleSize, seed) => {
          const electorate = electorates[index];
          if (electorate === undefined) throw new Error('padrón no construido');
          const method = SORTITION_METHOD(sampleSize);
          expect(await stratifiedSortition(electorate, method, seed)).toEqual(
            await stratifiedSortition(electorate, method, seed),
          );
        },
      ),
      runs(200),
    );
  });

  it('permutar el orden de llegada de las papeletas no cambia nada — score, IRV, MJ, Schulze', async () => {
    // El sorteo queda fuera por escrito: no consume papeletas, así que la propiedad no se enuncia
    // sobre él. Los métodos de umbral ya la cumplen en `props/invariants.test.ts` (INV-16/INV-17).
    await fc.assert(
      fc.asyncProperty(
        arbScoreProfile,
        arbGradeProfile,
        arbTruncatedRankingProfile,
        fc.integer({ min: 1, max: 8 }),
        async (scores, grades, rankings, rotation) => {
          const rotate = <T>(items: readonly T[]): readonly T[] => {
            const shift = rotation % Math.max(1, items.length);
            return [...items.slice(shift), ...items.slice(0, shift)];
          };
          expect(await tallyScore(scoreConfig, scoreBallots(rotate(scores)))).toEqual(
            await tallyScore(scoreConfig, scoreBallots(scores)),
          );
          expect(await tallyMajorityJudgment(mjConfig, gradeBallots(rotate(grades)))).toEqual(
            await tallyMajorityJudgment(mjConfig, gradeBallots(grades)),
          );
          expect(await tallyIrv(irvConfig, rankingBallots(rotate(rankings)))).toEqual(
            await tallyIrv(irvConfig, rankingBallots(rankings)),
          );
          expect(await tallyCondorcetSchulze(csConfig, rankingBallots(rotate(rankings)))).toEqual(
            await tallyCondorcetSchulze(csConfig, rankingBallots(rankings)),
          );
        },
      ),
      runs(300),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-40 — Monotonía: score, majority-judgment, condorcet-schulze. NUNCA irv (A-01).
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-40 — monotonía en score, MJ y Condorcet/Schulze; IRV EXCLUIDO (A-01)', () => {
  it('score: subir la puntuación de la ganadora en una papeleta no le quita la victoria', async () => {
    await fc.assert(
      fc.asyncProperty(arbScoreProfile, fc.nat(), async (profile, pick) => {
        const before = await tallyScore(scoreConfig, scoreBallots(profile));
        const winner = winnerOf(before);
        fc.pre(winner !== undefined);
        const column = OPTIONS.indexOf(winner);
        const raisable = profile
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => {
            const value = row[column];
            return value !== null && value !== undefined && value < 5;
          });
        fc.pre(raisable.length > 0);
        const target = raisable[pick % raisable.length];
        if (target === undefined) throw new Error('papeleta inalcanzable');
        // Se sube dentro de la misma papeleta y sin tocar `null`: la cobertura no cambia, así que la
        // elegibilidad de B.5.a es idéntica antes y después y lo único que se mueve es la ganadora.
        const raised = profile.map((row, index): ScoreRow => {
          if (index !== target.index) return row;
          const copy: ScoreCell[] = [...row];
          copy[column] = 5;
          return copy as unknown as ScoreRow;
        });
        expect(winnerOf(await tallyScore(scoreConfig, scoreBallots(raised)))).toBe(winner);
      }),
      runs(400),
    );
  });

  it('majority-judgment: mejorar la mención de la ganadora en una papeleta no le quita la victoria', async () => {
    await fc.assert(
      fc.asyncProperty(arbGradeProfile, fc.nat(), async (profile, pick) => {
        const before = await tallyMajorityJudgment(mjConfig, gradeBallots(profile));
        const winner = winnerOf(before);
        fc.pre(winner !== undefined);
        const column = OPTIONS.indexOf(winner);
        const raisable = profile
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => (row[column] ?? 0) > 0);
        fc.pre(raisable.length > 0);
        const target = raisable[pick % raisable.length];
        if (target === undefined) throw new Error('papeleta inalcanzable');
        const raised = profile.map((row, index): GradeRow => {
          if (index !== target.index) return row;
          const copy = [...row];
          copy[column] = (copy[column] ?? 1) - 1; // un escalón mejor: 0 es la mejor mención
          return copy as unknown as GradeRow;
        });
        expect(winnerOf(await tallyMajorityJudgment(mjConfig, gradeBallots(raised)))).toBe(winner);
      }),
      runs(400),
    );
  });

  it('condorcet-schulze: subir a la ganadora un puesto en una papeleta la mantiene en el conjunto', async () => {
    await fc.assert(
      fc.asyncProperty(arbFullRankingProfile, fc.nat(), async (profile, pick) => {
        const before = await tallyCondorcetSchulze(csConfig, rankingBallots(profile));
        const winner = winnerOf(before);
        fc.pre(winner !== undefined);
        const raisable = profile
          .map((order, index) => ({ order, index }))
          .filter(({ order }) => order.indexOf(winner) > 0);
        fc.pre(raisable.length > 0);
        const target = raisable[pick % raisable.length];
        if (target === undefined) throw new Error('papeleta inalcanzable');
        const raised = profile.map((order, index) => {
          if (index !== target.index) return order;
          const position = order.indexOf(winner);
          const copy = [...order];
          const above = copy[position - 1];
          const self = copy[position];
          if (above === undefined || self === undefined) throw new Error('intercambio imposible');
          copy[position - 1] = self;
          copy[position] = above;
          return copy;
        });
        const beforeSet = schulze(
          csConfig.options,
          pairwiseMatrix(csConfig.options, rankingBallots(profile)),
        );
        const afterSet = schulze(
          csConfig.options,
          pairwiseMatrix(csConfig.options, rankingBallots(raised)),
        );
        // La monotonía del método se enuncia sobre el CONJUNTO de Schulze, que es lo que el método
        // determina. Cuando el conjunto tiene más de un elemento, quién gana lo decide la cascada
        // publicada y no el método, así que la victoria concreta sólo se exige con conjunto unitario.
        expect(afterSet.winners).toContain(winner);
        if (beforeSet.winners.length === 1 && afterSet.winners.length === 1) {
          expect(winnerOf(await tallyCondorcetSchulze(csConfig, rankingBallots(raised)))).toBe(
            winner,
          );
        }
      }),
      runs(400),
    );
  });

  /**
   * EXCLUSIÓN DECLARADA — `irv` no está en esta familia.
   *
   * Razón: la no monotonía es estructural de la eliminación secuencial (B.6, A-01), no un defecto de
   * la implementación. Subir a la ganadora le quita primeras preferencias a su rival débil, esa rival
   * cae antes y libera su caudal hacia la rival fuerte.
   *
   * Prueba POSITIVA del fallo: `tally-irv.test.ts` › «INV-42 — documenta positivamente la
   * no-monotonía de IRV sin empates», con el perfil de 17 papeletas sin un solo empate.
   */
  it('el filtro que deja a irv fuera de la monotonía es explícito y comprobable', () => {
    const MONOTONE_METHODS = ['score', 'majority-judgment', 'condorcet-schulze'] as const;
    const FILTER = (kind: string): boolean => kind !== 'irv';
    expect(MONOTONE_METHODS.every(FILTER)).toBe(true);
    expect(FILTER('irv')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Criterio de Condorcet y perdedor de Condorcet
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('criterio de Condorcet — SÓLO condorcet-schulze', () => {
  it('INV-43 — si existe ganador de Condorcet, Schulze lo deja solo y lo proclama', async () => {
    await fc.assert(
      fc.asyncProperty(arbFullRankingProfile, async (profile) => {
        const ballots = rankingBallots(profile);
        const d = pairwiseMatrix(csConfig.options, ballots);
        const condorcet = condorcetWinner(csConfig.options, d);
        fc.pre(condorcet !== undefined);
        expect(schulze(csConfig.options, d).winners).toEqual([condorcet]);
        expect(winnerOf(await tallyCondorcetSchulze(csConfig, ballots))).toBe(condorcet);
      }),
      runs(400),
    );
  });

  it('score, MJ e IRV quedan fuera del criterio de Condorcet: ninguno lo satisface', () => {
    // No es una omisión. IRV falla el criterio de Condorcet (B.6, «patologías»), MJ también —el
    // contraejemplo con números está en `tally-majority-judgment.test.ts` › «…mayoría fuerte»— y
    // score ni siquiera recibe preferencias ordinales con las que definirlo.
    const CONDORCET_METHODS = ['condorcet-schulze'] as const;
    expect(CONDORCET_METHODS).not.toContain('irv');
    expect(CONDORCET_METHODS).not.toContain('majority-judgment');
    expect(CONDORCET_METHODS).not.toContain('score');
  });
});

describe('el perdedor de Condorcet nunca gana — condorcet-schulze e irv; MJ EXCLUIDO', () => {
  it('condorcet-schulze e irv jamás proclaman a la opción que pierde todos sus enfrentamientos', async () => {
    await fc.assert(
      fc.asyncProperty(arbFullRankingProfile, async (profile) => {
        const ballots = rankingBallots(profile);
        const d = pairwiseMatrix(csConfig.options, ballots);
        const loserIndex = csConfig.options.findIndex((_, i) =>
          csConfig.options.every((_, j) => i === j || (d[i]?.[j] ?? 0) < (d[j]?.[i] ?? 0)),
        );
        fc.pre(loserIndex >= 0);
        const loser = csConfig.options[loserIndex];
        expect(winnerOf(await tallyCondorcetSchulze(csConfig, ballots))).not.toBe(loser);
        expect(winnerOf(await tallyIrv(irvConfig, ballots))).not.toBe(loser);
      }),
      runs(400),
    );
  });

  /**
   * EXCLUSIÓN DECLARADA — `majority-judgment` no está en esta familia.
   *
   * Razón: MJ juzga cada opción en términos absolutos, no la compara contra las demás; su mención
   * mayoritaria no mira los enfrentamientos uno contra uno. La consecuencia es que puede proclamar a
   * la opción que pierde todos ellos. Como el perfil de abajo tiene sólo dos opciones, la perdedora
   * de Condorcet coincide con la opción a la que una mayoría estricta prefiere la otra: es el mismo
   * hecho que la violación del criterio de mayoría fuerte.
   *
   * Prueba POSITIVA del fallo, aquí mismo y con números.
   */
  it('MJ elige al perdedor de Condorcet: 3 de 5 prefieren A, y gana B', async () => {
    const config = await multiConfig(MJ_METHOD, [A, B], 5);
    // (A Excelente, B Bueno), 2×(A Insuficiente, B Rechazar), 2×(A Rechazar, B Excelente).
    const profile: readonly (readonly [number, number])[] = [
      [0, 1],
      [3, 4],
      [3, 4],
      [4, 0],
      [4, 0],
    ];
    const prefersA = profile.filter(([a, b]) => a < b).length;
    const prefersB = profile.filter(([a, b]) => b < a).length;
    expect([prefersA, prefersB]).toEqual([3, 2]); // A es la ganadora de Condorcet; B, la perdedora.

    const ballots = repeatedEffective(
      profile.map(([a, b]) => ({
        count: 1,
        payload: {
          kind: 'grades',
          grades: { [A]: GRADE_IDS[a] ?? EXCELLENT, [B]: GRADE_IDS[b] ?? EXCELLENT },
        } as const,
      })),
    );
    const profiles = majorityJudgmentProfiles(config, ballots);
    expect(profiles.map((p) => p.majorityGrade)).toEqual([3, 1]); // mediana baja: A=3, B=1
    expect(winnerOf(await tallyMajorityJudgment(config, ballots))).toBe(B);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Pareto / unanimidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('Pareto — si TODAS las papeletas ponen A por encima de B, B no gana', () => {
  // El sorteo queda fuera por escrito: no agrega preferencias, reparte asientos; «A por encima de B»
  // no significa nada en él. Los cuatro métodos de opciones sí están todos dentro.
  it('score: una opción dominada en cada papeleta nunca gana', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }), arbCell),
          { minLength: 1, maxLength: 9 },
        ),
        async (raw) => {
          const profile = raw.map(([x, y, free]): ScoreRow => {
            const high = Math.max(x, y);
            const low = Math.min(x, y);
            // Se separan sin empatar: A siempre estrictamente por encima de B, y las dos con opinión
            // (nunca `null`), para que la cobertura de B.5.a sea idéntica en las dos.
            const [top, bottom] =
              high === low ? (high < 5 ? [high + 1, low] : [high, low - 1]) : [high, low];
            return [top as ScoreCell, bottom as ScoreCell, free];
          });
          expect(winnerOf(await tallyScore(scoreConfig, scoreBallots(profile)))).not.toBe(B);
        },
      ),
      runs(300),
    );
  });

  it('majority-judgment: una opción dominada en cada papeleta nunca gana', async () => {
    await fc.assert(
      fc.asyncProperty(arbGradeProfile, async (raw) => {
        const profile = raw.map(([x, y, z]): GradeRow => {
          const best = Math.min(x, y);
          const worst = Math.max(x, y);
          const [top, bottom] =
            best === worst ? (best > 0 ? [best - 1, worst] : [best, worst + 1]) : [best, worst];
          return [top, bottom, z];
        });
        expect(winnerOf(await tallyMajorityJudgment(mjConfig, gradeBallots(profile)))).not.toBe(B);
      }),
      runs(300),
    );
  });

  it('irv y condorcet-schulze: una opción dominada en cada papeleta nunca gana', async () => {
    await fc.assert(
      fc.asyncProperty(arbFullRankingProfile, async (raw) => {
        const profile = raw.map((order) => {
          const copy = [...order];
          const iA = copy.indexOf(A);
          const iB = copy.indexOf(B);
          if (iA > iB) {
            copy[iA] = B;
            copy[iB] = A;
          }
          return copy;
        });
        const ballots = rankingBallots(profile);
        expect(winnerOf(await tallyIrv(irvConfig, ballots))).not.toBe(B);
        expect(winnerOf(await tallyCondorcetSchulze(csConfig, ballots))).not.toBe(B);
      }),
      runs(300),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Invariantes propios de cada método
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('IRV — conservación del peso en cada ronda', () => {
  it('votos activos + papeletas agotadas = peso inicial, en TODAS las rondas', async () => {
    await fc.assert(
      fc.asyncProperty(arbTruncatedRankingProfile, async (profile) => {
        const ballots = rankingBallots(profile);
        const total = ballots.reduce((sum, ballot) => sum + ballot.weight, 0);
        const table = (await tallyIrv(irvConfig, ballots)).tables[0];
        if (table === undefined) throw new Error('IRV no publicó su tabla de rondas');
        expect(table.rows.length).toBeGreaterThan(0);
        for (const row of table.rows) {
          const live = row[1 + RANKED_OPTIONS.length];
          const exhausted = row[2 + RANKED_OPTIONS.length];
          expect(typeof live === 'number' && typeof exhausted === 'number').toBe(true);
          expect(Number(live) + Number(exhausted)).toBe(total);
          // Y las cuentas por opción de la ronda suman exactamente los votos activos.
          const counted = row
            .slice(1, 1 + RANKED_OPTIONS.length)
            .reduce<number>((sum, cell) => sum + Number(cell), 0);
          expect(counted).toBe(Number(live));
        }
      }),
      runs(400),
    );
  });
});

describe('MJ — `reject-ballot` garantiza el mismo W para todas las opciones (B.7.b)', () => {
  it('los histogramas de todas las opciones suman el mismo peso, y es el de las papeletas completas', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 4 }),
            fc.option(fc.integer({ min: 0, max: 4 }), { nil: null, freq: 3 }),
            fc.option(fc.integer({ min: 0, max: 4 }), { nil: null, freq: 3 }),
          ),
          { minLength: 1, maxLength: 9 },
        ),
        (raw) => {
          const ballots = repeatedEffective(
            raw.map(([a, b, c]) => ({
              count: 1,
              payload: {
                kind: 'grades',
                grades: {
                  [A]: GRADE_IDS[a] ?? EXCELLENT,
                  ...(b === null ? {} : { [B]: GRADE_IDS[b] ?? EXCELLENT }),
                  ...(c === null ? {} : { [C]: GRADE_IDS[c] ?? EXCELLENT }),
                },
              } as const,
            })),
          );
          const complete = raw.filter(([, b, c]) => b !== null && c !== null).length;
          fc.pre(complete > 0);
          const totals = majorityJudgmentProfiles(mjConfig, ballots).map((profile) =>
            profile.histogram.reduce((sum, count) => sum + count, 0),
          );
          expect(totals).toEqual([complete, complete, complete]);

          // Con la política `worst` el peso también es idéntico, pero vale el total de papeletas: la
          // diferencia entre las dos políticas es a quién se le imputa el silencio, no si W cuadra.
          const lenient = majorityJudgmentProfiles(mjLenientConfig, ballots).map((profile) =>
            profile.histogram.reduce((sum, count) => sum + count, 0),
          );
          expect(lenient).toEqual([raw.length, raw.length, raw.length]);
        },
      ),
      runs(400),
    );
  });
});

describe('INV-45 — `p[][]` coincide con la fuerza de camino por fuerza bruta', () => {
  function bruteStrength(
    d: readonly (readonly number[])[],
    source: number,
    target: number,
  ): number {
    let best = 0;
    const visit = (current: number, seen: ReadonlySet<number>, strength: number): void => {
      if (current === target) {
        best = Math.max(best, strength);
        return;
      }
      for (let next = 0; next < d.length; next++) {
        if (seen.has(next) || next === current) continue;
        const direct =
          (d[current]?.[next] ?? 0) > (d[next]?.[current] ?? 0) ? (d[current]?.[next] ?? 0) : 0;
        if (direct === 0) continue;
        visit(next, new Set([...seen, next]), Math.min(strength, direct));
      }
    };
    visit(source, new Set([source]), Number.MAX_SAFE_INTEGER);
    return best;
  }

  it('para m ≤ 5, cada p[x][y] es el máximo de los mínimos sobre todos los caminos simples', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }).chain((size) =>
          fc
            .array(fc.integer({ min: 0, max: 12 }), {
              minLength: size * size,
              maxLength: size * size,
            })
            .map((flat) => ({ size, flat })),
        ),
        ({ size, flat }) => {
          const d = Array.from({ length: size }, (_, i) =>
            Array.from({ length: size }, (_, j) => (i === j ? 0 : (flat[i * size + j] ?? 0))),
          );
          const options = Array.from({ length: size }, (_, index) => optionIdAt(index));
          const result = schulze(options, d);
          expect(result.winners.length).toBeGreaterThan(0); // INV-44
          for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
              if (i !== j) expect(result.p[i]?.[j]).toBe(bruteStrength(d, i, j));
            }
          }
        },
      ),
      runs(300),
    );
  });
});

describe('INV-46 / INV-47 / INV-51 — mediana de menciones y de puntuaciones', () => {
  function histogram(values: readonly number[], size = 5): readonly number[] {
    const counts = Array.from({ length: size }, () => 0);
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }

  it('la mención mayoritaria es invariante a permutar, y mjCompare es antisimétrico y transitivo', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 20 })
          .chain((weight) =>
            fc.tuple(
              fc.array(fc.integer({ min: 0, max: 4 }), { minLength: weight, maxLength: weight }),
              fc.array(fc.integer({ min: 0, max: 4 }), { minLength: weight, maxLength: weight }),
              fc.array(fc.integer({ min: 0, max: 4 }), { minLength: weight, maxLength: weight }),
            ),
          ),
        ([rawA, rawB, rawC]) => {
          const a = histogram(rawA);
          const b = histogram(rawB);
          const c = histogram(rawC);
          const reverse = mjCompare(b, a);
          expect(mjCompare(a, b)).toBe(reverse === 0 ? 0 : -reverse);
          expect(mjCompare(a, a)).toBe(0);
          expect(majorityGrade(histogram([...rawA].reverse()))).toBe(majorityGrade(a));
          if (mjCompare(a, b) < 0 && mjCompare(b, c) < 0) expect(mjCompare(a, c)).toBeLessThan(0);
        },
      ),
      runs(400),
    );
  });

  it('INV-51 — cambiar una puntuación mantiene la mediana entre la vieja y la nueva', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 5 }),
        (values, replacement) => {
          const before = weightedMedian(histogram(values, 6));
          if (before === undefined) throw new Error('mediana indefinida con papeletas');
          const after = weightedMedian(histogram([replacement, ...values.slice(1)], 6));
          if (after === undefined) throw new Error('mediana indefinida con papeletas');
          expect(after).toBeGreaterThanOrEqual(Math.min(before, replacement));
          expect(after).toBeLessThanOrEqual(Math.max(before, replacement));
        },
      ),
      runs(400),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-55 / INV-56 — sorteo
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-55 — cuotas del sorteo con aritmética exacta (ADR-0027)', () => {
  it('Σ asientos = min(sampleSize, N) y cada estrato recibe el piso o el techo de su cuota', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 40 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (sizes, requested, seed) => {
          const strata = new Map(sizes.map((size, index) => [`e${String(index)}`, size]));
          const quotas = await hamiltonQuotas(strata, requested, seed);
          const population = sizes.reduce((sum, size) => sum + size, 0);
          const sample = Math.min(requested, population);
          expect(quotas.reduce((sum, quota) => sum + quota.quota, 0)).toBe(sample);
          for (const quota of quotas) {
            expect(quota.quota).toBeLessThanOrEqual(quota.size);
            // Piso y techo se calculan con enteros, jamás con división flotante (ADR-0027).
            const product = BigInt(sample) * BigInt(quota.size);
            const den = BigInt(population);
            const floor = Number(product / den);
            const ceil = product % den === 0n ? floor : floor + 1;
            expect(quota.quota).toBeGreaterThanOrEqual(floor);
            expect(quota.quota).toBeLessThanOrEqual(ceil);
            expect(quota.remainder).toBe(product % den);
          }
        },
      ),
      runs(400),
    );
  });

  it('la muestra tiene min(sampleSize, N) personas distintas y respeta la cuota de cada estrato', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 24 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (index, sampleSize, seed) => {
          const electorate = electorates[index];
          if (electorate === undefined) throw new Error('padrón no construido');
          const result = await stratifiedSortition(electorate, SORTITION_METHOD(sampleSize), seed);
          const expected = Math.min(sampleSize, electorate.censusSize);
          expect(result.selected).toHaveLength(expected);
          expect(new Set(result.selected).size).toBe(expected);
          expect(result.quotas.reduce((sum, quota) => sum + quota.quota, 0)).toBe(expected);
          for (const quota of result.quotas) {
            const inStratum = result.selected.filter(
              (member) =>
                (electorate.members.find((m) => m.memberId === member)?.strata[STRATUM_SEMESTER] ??
                  '') === quota.stratum.split('=')[1],
            ).length;
            expect(inStratum).toBe(quota.quota);
          }
        },
      ),
      runs(200),
    );
  });
});

describe('INV-56 — el ticket del sorteo es recomputable por cualquiera', () => {
  it('cada ticket es HMAC(semilla, "estrato|miembro") y los elegidos son los tickets menores', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 16 }),
        fc.string({ minLength: 1, maxLength: 12 }),
        async (index, sampleSize, seed) => {
          const electorate = electorates[index];
          if (electorate === undefined) throw new Error('padrón no construido');
          const result = await stratifiedSortition(electorate, SORTITION_METHOD(sampleSize), seed);
          const chosen = new Set<string>(result.selected);

          for (const quota of result.quotas) {
            const members = electorate.members.filter(
              (m) => `${STRATUM_SEMESTER}=${m.strata[STRATUM_SEMESTER] ?? '∅'}` === quota.stratum,
            );
            const dentro: string[] = [];
            const fuera: string[] = [];
            for (const member of members) {
              // Recómputo INDEPENDIENTE: sólo la semilla, el nombre del estrato y el identificador.
              // Es la comprobación de una línea que promete B.9.a.
              const ticket = await hmacSha256Hex(seed, `${quota.stratum}|${member.memberId}`);
              expect(result.tickets.get(member.memberId)).toBe(ticket);
              (chosen.has(member.memberId) ? dentro : fuera).push(ticket);
            }
            expect(dentro).toHaveLength(quota.quota);
            const peorDentro = dentro.sort().at(-1);
            const mejorFuera = fuera.sort()[0];
            if (peorDentro !== undefined && mejorFuera !== undefined) {
              expect(peorDentro < mejorFuera).toBe(true);
            }
          }
        },
      ),
      runs(120),
    );
  });
});
