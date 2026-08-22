/** Valoración por menciones (B.7), con desempate Balinski–Laraki por eliminación sucesiva. */

import type { DecisionConfig, GradeId, TieBreakRule } from '../config.js';
import { InvalidBallotForMethod, PreconditionError } from '../errors.js';
import type { OptionId } from '../ids.js';
import { type EffectiveBallot, lexicographicHashOrder, type MethodTally, step } from './common.js';

/**
 * Mención mayoritaria = **mediano inferior** (*lower middlemost*) de Balinski–Laraki: con `W` par se
 * toma la **peor** de las dos menciones centrales, que es la única lectura que sostiene «al menos la
 * mitad la considera al menos `α`» (B.7, líneas 1508-1513 de la spec).
 *
 * «Inferior» aquí es **peor**, no «de índice menor»: `counts` está indexado de mejor a peor
 * (`0` = Excelente … `k-1` = Rechazar), de modo que la peor de las dos centrales es la de índice
 * MAYOR y la posición buscada es `floor(W/2)`. Con la orientación contraria —`weightedMedian` de
 * B.5, donde el índice `0` es la puntuación peor— la MISMA convención semántica exige
 * `floor((W-1)/2)`. Las dos fórmulas no son intercambiables: dependen de cómo esté ordenado el
 * vector, y aplicar la de B.7 a un vector ascendente da justo la mención contraria.
 *
 * Verificación de la spec, reproducida en el test: `W = 2` con `{Excelente, Rechazar}` ⇒
 * `α = g_1 = Rechazar` (INV-49).
 */
export function majorityGrade(counts: readonly number[]): number {
  const weight = counts.reduce((sum, count) => sum + count, 0);
  if (weight <= 0) throw new PreconditionError('EMPTY_GRADE_PROFILE', 'MJ exige menciones');
  const target = Math.floor(weight / 2);
  let accumulated = 0;
  for (let grade = 0; grade < counts.length; grade++) {
    accumulated += counts[grade] ?? 0;
    if (accumulated > target) return grade;
  }
  throw new PreconditionError('BROKEN_GRADE_PROFILE', 'el histograma de menciones no suma su peso');
}

/** -1: A es mejor; 1: B es mejor; 0: perfiles indistinguibles antes del desempate final. */
export function mjCompare(a: readonly number[], b: readonly number[]): -1 | 0 | 1 {
  const left = [...a];
  const right = [...b];
  let remaining = left.reduce((sum, count) => sum + count, 0);
  const rightWeight = right.reduce((sum, count) => sum + count, 0);
  if (remaining !== rightWeight) {
    throw new PreconditionError('UNEQUAL_GRADE_WEIGHT', 'MJ exige igual peso total por opción');
  }
  while (remaining > 0) {
    const gradeA = majorityGrade(left);
    const gradeB = majorityGrade(right);
    if (gradeA !== gradeB) return gradeA < gradeB ? -1 : 1;
    left[gradeA] = (left[gradeA] ?? 0) - 1;
    right[gradeB] = (right[gradeB] ?? 0) - 1;
    remaining -= 1;
  }
  return 0;
}

export interface MajorityJudgmentProfile {
  readonly option: OptionId;
  readonly histogram: readonly number[];
  readonly majorityGrade: number;
}

/**
 * DECISIÓN B.7.b — `missingGradePolicy: 'reject-ballot'` invalida la papeleta ENTERA, no rellena el
 * hueco con la peor mención.
 *
 * `validateBallot` ya rechaza la papeleta incompleta al emitirla, así que este filtro nunca debería
 * disparar con un log legal. Se aplica igualmente porque la precondición de `mjCompare` es que `W`
 * sea idéntico para todas las opciones: rellenar con `worst` una sola papeleta bajo `reject-ballot`
 * cambiaría el histograma de la opción menos conocida sin que nadie la haya calificado, que es
 * exactamente lo que B.7.b prohíbe. Devolver la papeleta entera al margen preserva `W` y no inventa
 * juicios.
 */
export function usableGradeBallots(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): readonly EffectiveBallot[] {
  if (config.method.kind !== 'majority-judgment') {
    throw new Error('usableGradeBallots exige majority-judgment');
  }
  const rejectIncomplete = config.method.missingGradePolicy === 'reject-ballot';
  return ballots.filter((ballot) => {
    if (ballot.payload.kind !== 'grades') {
      throw new InvalidBallotForMethod(ballot.payload.kind, 'majority-judgment');
    }
    if (!rejectIncomplete) return true;
    const grades = ballot.payload.grades;
    return config.options.every((option) => grades[option] !== undefined);
  });
}

export function majorityJudgmentProfiles(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): readonly MajorityJudgmentProfile[] {
  if (config.method.kind !== 'majority-judgment') {
    throw new Error('majorityJudgmentProfiles exige majority-judgment');
  }
  const method = config.method;
  const gradeIndex = new Map<GradeId, number>(
    method.scale.grades.map((grade, index) => [grade.id, index]),
  );
  const worst = method.scale.grades.length - 1;
  const usable = usableGradeBallots(config, ballots);
  return config.options.map((option) => {
    const histogram = Array.from({ length: method.scale.grades.length }, () => 0);
    for (const ballot of usable) {
      if (ballot.payload.kind !== 'grades') {
        throw new InvalidBallotForMethod(ballot.payload.kind, config.method.kind);
      }
      const grade = ballot.payload.grades[option];
      // Sólo se llega aquí con `grade === undefined` bajo la política `'worst'`: B.7.b ya apartó la
      // papeleta incompleta cuando la política es `'reject-ballot'`.
      const index = grade === undefined ? worst : gradeIndex.get(grade);
      if (index === undefined) {
        throw new PreconditionError(
          'UNKNOWN_GRADE',
          `la mención ${String(grade)} no está en la escala`,
        );
      }
      histogram[index] = (histogram[index] ?? 0) + ballot.weight;
    }
    return { option, histogram, majorityGrade: majorityGrade(histogram) };
  });
}

function gradeMetric(profile: MajorityJudgmentProfile, rule: TieBreakRule): number | undefined {
  switch (rule) {
    case 'more-excellent':
      return profile.histogram[0] ?? 0;
    case 'fewer-reject':
    case 'fewer-rejections':
      return -(profile.histogram.at(-1) ?? 0);
    case 'higher-median':
      return -profile.majorityGrade;
    default:
      return undefined;
  }
}

async function breakIdenticalProfiles(
  config: DecisionConfig,
  profiles: readonly MajorityJudgmentProfile[],
): Promise<MajorityJudgmentProfile> {
  if (config.method.kind !== 'majority-judgment') throw new Error('método incorrecto');
  let contenders = [...profiles];
  for (const rule of config.method.tieBreak.cascade) {
    if (contenders.length <= 1) break;
    if (rule === 'lexicographic-hash') {
      const order = await lexicographicHashOrder(
        config.decisionId,
        contenders.map((profile) => profile.option),
      );
      contenders = contenders.filter((profile) => profile.option === order[0]);
      continue;
    }
    const metrics = contenders.map((profile) => gradeMetric(profile, rule));
    if (metrics.every((metric) => metric !== undefined)) {
      const best = Math.max(...metrics);
      contenders = contenders.filter((_, index) => metrics[index] === best);
    }
  }
  if (contenders.length > 1) {
    const order = await lexicographicHashOrder(
      config.decisionId,
      contenders.map((profile) => profile.option),
    );
    const selected = contenders.find((profile) => profile.option === order[0]);
    if (selected !== undefined) return selected;
  }
  const first = contenders[0];
  if (first === undefined) throw new PreconditionError('NO_MJ_WINNER', 'sin contendientes');
  return first;
}

export async function tallyMajorityJudgment(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): Promise<MethodTally> {
  if (config.method.kind !== 'majority-judgment') {
    throw new Error('tallyMajorityJudgment exige majority-judgment');
  }
  const method = config.method;
  const usable = usableGradeBallots(config, ballots);
  const discarded = ballots.length - usable.length;
  if (usable.length === 0) {
    return {
      outcome: { kind: 'rejected', reason: 'threshold-not-met' },
      steps: [
        step('MJ1', 'No hubo menciones válidas para comparar.', {
          papeletas: ballots.length,
          descartadas: discarded,
        }),
      ],
      tables: [],
      narrative: 'Sin menciones no existe una mención mayoritaria y no se proclama ganadora.',
    };
  }
  const profiles = majorityJudgmentProfiles(config, ballots);
  let best: MajorityJudgmentProfile[] = [];
  for (const profile of profiles) {
    if (best.length === 0) {
      best = [profile];
      continue;
    }
    const incumbent = best[0];
    if (incumbent === undefined) throw new PreconditionError('NO_MJ_WINNER', 'sin contendiente');
    const comparison = mjCompare(profile.histogram, incumbent.histogram);
    if (comparison < 0) best = [profile];
    else if (comparison === 0) best.push(profile);
  }
  const winner = await breakIdenticalProfiles(config, best);
  const tiedAfterBl = best.length > 1;
  return {
    outcome: { kind: 'winner', option: winner.option, tieBroken: tiedAfterBl },
    steps: [
      step('MJ1', 'Se calculó la mención mayoritaria baja de cada opción.', {
        opciones: profiles.length,
        papeletas: usable.length,
        descartadasPorIncompletas: discarded,
        politicaDeMencionAusente: method.missingGradePolicy,
      }),
      step('MJ2', `Ganó ${winner.option} tras la comparación Balinski–Laraki.`, {
        mencion: method.scale.grades[winner.majorityGrade]?.label ?? winner.majorityGrade,
        desempateFinal: tiedAfterBl ? 'sí' : 'no',
      }),
    ],
    tables: [
      {
        title: 'Histogramas de menciones',
        columns: [
          'Opción',
          'Mención mayoritaria',
          ...method.scale.grades.map((grade) => grade.label),
        ],
        rows: profiles.map((profile) => [
          profile.option,
          method.scale.grades[profile.majorityGrade]?.label ?? profile.majorityGrade,
          ...profile.histogram,
        ]),
      },
    ],
    narrative:
      `Se compararon las menciones mayoritarias bajas. En cada empate se retiró una sola ` +
      `ocurrencia de la mediana a cada opción y se volvió a comparar; ganó ${winner.option}.`,
  };
}
