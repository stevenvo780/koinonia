import {
  buildDecisionConfig,
  type DecisionConfig,
  type DecisionMethod,
  type EffectiveBallot,
  type GradeId,
  type OptionId,
} from '../src/index.js';
import { buildConfig, buildElectorate, memberIdAt, optionIdAt } from './arbitraries.js';

export const A = optionIdAt(0);
export const B = optionIdAt(1);
export const C = optionIdAt(2);
export const D = optionIdAt(3);

export const EXCELLENT = 'excellent' as GradeId;
export const GOOD = 'good' as GradeId;
export const ACCEPTABLE = 'acceptable' as GradeId;
export const INSUFFICIENT = 'insufficient' as GradeId;
export const REJECT = 'reject' as GradeId;

export const FIVE_GRADE_SCALE = {
  grades: [
    { id: EXCELLENT, label: 'Excelente' },
    { id: GOOD, label: 'Bueno' },
    { id: ACCEPTABLE, label: 'Aceptable' },
    { id: INSUFFICIENT, label: 'Insuficiente' },
    { id: REJECT, label: 'Rechazar' },
  ],
} as const;

export async function multiConfig(
  method: DecisionMethod,
  options: readonly OptionId[],
  memberCount: number,
): Promise<DecisionConfig> {
  const base = await buildConfig({ electorate: await buildElectorate(memberCount), method });
  const { configHash: _oldHash, ...draft } = base;
  return buildDecisionConfig({ ...draft, options });
}

export function effective(
  payloads: readonly EffectiveBallot['payload'][],
): readonly EffectiveBallot[] {
  return payloads.map((payload, index) => ({
    voter: memberIdAt(index),
    payload,
    weight: 1,
    seq: index + 1,
    onBehalfOf: [],
  }));
}

export function repeatedEffective(
  groups: readonly { readonly count: number; readonly payload: EffectiveBallot['payload'] }[],
): readonly EffectiveBallot[] {
  const out: EffectiveBallot[] = [];
  let voter = 0;
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) {
      out.push({
        voter: memberIdAt(voter),
        payload: group.payload,
        weight: 1,
        seq: voter + 1,
        onBehalfOf: [],
      });
      voter += 1;
    }
  }
  return out;
}
