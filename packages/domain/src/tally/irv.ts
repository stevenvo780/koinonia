/** Rondas con eliminación (IRV, B.6). */

import type { DecisionConfig, TieBreakPolicy } from '../config.js';
import { InvalidBallotForMethod, PreconditionError } from '../errors.js';
import { compareIds, type OptionId } from '../ids.js';
import {
  type EffectiveBallot,
  hmacOrder,
  lexicographicHashOrder,
  type MethodTally,
  step,
  totalWeight,
} from './common.js';

export interface IrvRound {
  readonly round: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly live: number;
  readonly exhausted: number;
  readonly quotaBase: number;
  readonly eliminated?: OptionId;
}

function rankingOf(ballot: EffectiveBallot, method: string): readonly OptionId[] {
  if (ballot.payload.kind !== 'ranking') {
    throw new InvalidBallotForMethod(ballot.payload.kind, method);
  }
  return ballot.payload.order;
}

function headToHead(
  a: OptionId,
  b: OptionId,
  ballots: readonly EffectiveBallot[],
  method: string,
): number {
  let margin = 0;
  for (const ballot of ballots) {
    const order = rankingOf(ballot, method);
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    if (indexA < 0 && indexB < 0) continue;
    if (indexB < 0 || (indexA >= 0 && indexA < indexB)) margin += ballot.weight;
    else margin -= ballot.weight;
  }
  return margin;
}

async function eliminationTie(
  config: DecisionConfig,
  candidates: readonly OptionId[],
  history: readonly IrvRound[],
  ballots: readonly EffectiveBallot[],
  policy: TieBreakPolicy,
  seed: string | undefined,
): Promise<OptionId> {
  let contenders = [...candidates].sort(compareIds);
  for (const rule of policy.cascade) {
    if (contenders.length <= 1) break;
    switch (rule) {
      case 'fewer-first-preferences-in-previous-rounds': {
        for (let index = history.length - 2; index >= 0 && contenders.length > 1; index--) {
          const counts = history[index]?.counts ?? {};
          const minimum = Math.min(...contenders.map((option) => counts[option] ?? 0));
          contenders = contenders.filter((option) => (counts[option] ?? 0) === minimum);
        }
        break;
      }
      case 'pairwise-head-to-head': {
        const losses = new Map<OptionId, number>();
        for (const option of contenders) {
          losses.set(
            option,
            contenders.filter(
              (other) =>
                other !== option && headToHead(option, other, ballots, config.method.kind) < 0,
            ).length,
          );
        }
        const worst = Math.max(...losses.values());
        contenders = contenders.filter((option) => losses.get(option) === worst);
        break;
      }
      case 'public-seed-lot': {
        if (seed === undefined) {
          throw new PreconditionError(
            'SEED_NOT_REVEALED',
            'el desempate público de IRV exige la semilla comprometida ya revelada',
          );
        }
        const ordered = await hmacOrder(
          seed,
          `irv-elimination-${String(history.length)}`,
          contenders,
        );
        const first = ordered[0];
        if (first === undefined)
          throw new PreconditionError('NO_IRV_LOSER', 'sin opción a eliminar');
        contenders = [first.value];
        break;
      }
      case 'lexicographic-hash': {
        const ordered = await lexicographicHashOrder(config.decisionId, contenders);
        const first = ordered[0];
        if (first === undefined)
          throw new PreconditionError('NO_IRV_LOSER', 'sin opción a eliminar');
        contenders = [first];
        break;
      }
      default:
        break;
    }
  }
  // Última red, cuando la cascada configurada agotó sus criterios y las opciones siguen
  // indistinguibles. Se elimina el `OptionId` lexicográficamente MAYOR.
  //
  // El sentido está invertido respecto de Schulze (donde el empate lo gana el menor) y es
  // deliberado: aquí no se elige a la ganadora sino a la víctima, y B.6.b advierte que usar el mismo
  // criterio invertido produce comportamientos raros. Con la regla fijada al extremo opuesto, la
  // opción favorecida por el desempate es la misma en los dos métodos —la menor—, que es lo que un
  // auditor espera al leer las dos demostraciones seguidas.
  const last = [...contenders].sort(compareIds).at(-1);
  if (last === undefined) throw new PreconditionError('NO_IRV_LOSER', 'sin opción a eliminar');
  return last;
}

export async function tallyIrv(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
  seed?: string,
): Promise<MethodTally> {
  if (config.method.kind !== 'irv') throw new Error('tallyIrv exige método irv');
  for (const ballot of ballots) rankingOf(ballot, config.method.kind);
  let alive = [...config.options];
  const rounds: IrvRound[] = [];
  const initialTotal = totalWeight(ballots);
  let usedEliminationTie = false;

  while (alive.length > 1) {
    const aliveSet = new Set(alive);
    const counts: Record<string, number> = Object.fromEntries(alive.map((option) => [option, 0]));
    let live = 0;
    let exhausted = 0;
    for (const ballot of ballots) {
      const top = rankingOf(ballot, config.method.kind).find((option) => aliveSet.has(option));
      if (top === undefined) exhausted += ballot.weight;
      else {
        counts[top] = (counts[top] ?? 0) + ballot.weight;
        live += ballot.weight;
      }
    }
    const quotaBase = config.method.exhaustedPolicy === 'reduce-quota' ? live : initialTotal;
    const round: IrvRound = {
      round: rounds.length + 1,
      counts: Object.fromEntries(alive.map((option) => [option, counts[option] ?? 0])),
      live,
      exhausted,
      quotaBase,
    };
    rounds.push(round);
    const majority = alive.find((option) => 2 * (counts[option] ?? 0) > quotaBase);
    if (majority !== undefined) {
      return irvResult(majority, rounds, usedEliminationTie);
    }
    const minimum = Math.min(...alive.map((option) => counts[option] ?? 0));
    const tied = alive.filter((option) => (counts[option] ?? 0) === minimum);
    if (tied.length > 1) usedEliminationTie = true;
    const soleLoser = tied[0];
    const eliminated =
      tied.length === 1 && soleLoser !== undefined
        ? soleLoser
        : await eliminationTie(
            config,
            tied,
            rounds,
            ballots,
            config.method.eliminationTieBreak,
            seed,
          );
    rounds[rounds.length - 1] = { ...round, eliminated };
    alive = alive.filter((option) => option !== eliminated);
  }
  const winner = alive[0];
  if (winner === undefined) throw new PreconditionError('NO_IRV_WINNER', 'IRV quedó sin opciones');
  return irvResult(winner, rounds, usedEliminationTie);
}

function irvResult(winner: OptionId, rounds: readonly IrvRound[], tieBroken: boolean): MethodTally {
  const options = [...new Set(rounds.flatMap((round) => Object.keys(round.counts)))].sort(
    compareIds,
  );
  return {
    outcome: { kind: 'winner', option: winner, tieBroken },
    steps: [
      step('IRV1', 'En cada ronda se contó la primera preferencia que seguía viva.', {
        rondas: rounds.length,
      }),
      step('IRV2', `Ganó ${winner}.`, { desempateEliminacion: tieBroken ? 'sí' : 'no' }),
    ],
    tables: [
      {
        title: 'Rondas de IRV',
        columns: ['Ronda', ...options, 'Vivas', 'Agotadas', 'Base de cuota', 'Eliminada'],
        rows: rounds.map((round) => [
          round.round,
          ...options.map((option) => round.counts[option] ?? 0),
          round.live,
          round.exhausted,
          round.quotaBase,
          round.eliminated ?? '',
        ]),
      },
    ],
    narrative:
      `Ganó ${winner} después de transferir las papeletas de cada opción eliminada. ` +
      'En este método, en casos poco frecuentes, apoyar más a una opción puede perjudicarla. Por eso no se usa para decisiones importantes.',
  };
}
