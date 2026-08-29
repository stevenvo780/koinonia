/** Comparación por pares y caminos más fuertes de Schulze (B.8). */

import type { DecisionConfig, TieBreakRule } from '../config.js';
import { InvalidBallotForMethod, PreconditionError } from '../errors.js';
import { compareIds, type OptionId } from '../ids.js';
import {
  type EffectiveBallot,
  hmacOrder,
  lexicographicHashOrder,
  type MethodTally,
  step,
} from './common.js';

export function pairwiseMatrix(
  options: readonly OptionId[],
  ballots: readonly EffectiveBallot[],
): readonly (readonly number[])[] {
  const matrix = Array.from({ length: options.length }, () =>
    Array.from({ length: options.length }, () => 0),
  );
  const optionIndex = new Map(options.map((option, index) => [option, index]));
  for (const ballot of ballots) {
    if (ballot.payload.kind !== 'ranking') {
      throw new InvalidBallotForMethod(ballot.payload.kind, 'condorcet-schulze');
    }
    const rank = new Map(ballot.payload.order.map((option, index) => [option, index]));
    for (let i = 0; i < options.length; i++) {
      for (let j = 0; j < options.length; j++) {
        if (i === j) continue;
        const optionA = options[i];
        const optionB = options[j];
        const row = matrix[i];
        if (optionA === undefined || optionB === undefined || row === undefined) {
          throw new PreconditionError(
            'BROKEN_PAIRWISE_MATRIX',
            'índice fuera de la matriz por pares',
          );
        }
        const rankA = rank.get(optionA);
        const rankB = rank.get(optionB);
        const prefersA = rankA !== undefined && (rankB === undefined || rankA < rankB);
        if (prefersA) row[j] = (row[j] ?? 0) + ballot.weight;
      }
    }
  }
  // Ancla que todas las opciones de una papeleta pasaron por la validación del dominio.
  for (const ballot of ballots) {
    if (ballot.payload.kind === 'ranking') {
      for (const option of ballot.payload.order) {
        if (!optionIndex.has(option)) {
          throw new PreconditionError('UNKNOWN_OPTION', 'ranking con opción ajena a la decisión');
        }
      }
    }
  }
  return matrix;
}

/**
 * Ganador de Condorcet puro: `X` tal que `d[X][Y] > d[Y][X]` para toda `Y ≠ X` (B.8). Puede no
 * existir (paradoja del ciclo), y por eso se devuelve `undefined` en vez de lanzar.
 *
 * Se calcula aparte de Schulze **a propósito**. Schulze garantiza que, si existe, el conjunto de
 * caminos más fuertes se reduce a él (INV-43), así que el dato sería redundante para elegir. No lo es
 * para la `Proof`: «ganó porque le gana a todas las demás una contra una» es una frase que cualquiera
 * verifica con la tabla de pares, mientras que «ganó por camino más fuerte 143 contra 128» no lo es.
 * Cuando el ganador existe, la demostración debe decirlo; cuando no existe, debe decir eso también.
 */
export function condorcetWinner(
  options: readonly OptionId[],
  d: readonly (readonly number[])[],
): OptionId | undefined {
  return options.find((_, i) =>
    options.every((_, j) => i === j || (d[i]?.[j] ?? 0) > (d[j]?.[i] ?? 0)),
  );
}

export interface SchulzeResult {
  readonly p: readonly (readonly number[])[];
  readonly winners: readonly OptionId[];
  /** Preorden de Schulze, linealizado sólo por `OptionId` dentro de cada clase de empate. */
  readonly ranking: readonly OptionId[];
}

export function schulze(
  options: readonly OptionId[],
  d: readonly (readonly number[])[],
): SchulzeResult {
  const n = options.length;
  const p = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const row = p[i];
      if (row === undefined) throw new PreconditionError('BROKEN_SCHULZE_MATRIX', 'fila ausente');
      if (i !== j && (d[i]?.[j] ?? 0) > (d[j]?.[i] ?? 0)) row[j] = d[i]?.[j] ?? 0;
    }
  }
  // Floyd–Warshall max-min: el pivote es el bucle exterior (B.8.a / INV-45).
  for (let pivot = 0; pivot < n; pivot++) {
    for (let from = 0; from < n; from++) {
      if (from === pivot) continue;
      for (let to = 0; to < n; to++) {
        if (to === pivot || to === from) continue;
        const via = Math.min(p[from]?.[pivot] ?? 0, p[pivot]?.[to] ?? 0);
        const row = p[from];
        if (row === undefined) throw new PreconditionError('BROKEN_SCHULZE_MATRIX', 'fila ausente');
        if (via > (row[to] ?? 0)) row[to] = via;
      }
    }
  }
  const winners = options.filter((_, i) =>
    options.every((_, j) => i === j || (p[i]?.[j] ?? 0) >= (p[j]?.[i] ?? 0)),
  );
  const ranking = [...options].sort((a, b) => {
    const i = options.indexOf(a);
    const j = options.indexOf(b);
    const ab = p[i]?.[j] ?? 0;
    const ba = p[j]?.[i] ?? 0;
    return ab === ba ? compareIds(a, b) : ab > ba ? -1 : 1;
  });
  return { p, winners, ranking };
}

function metric(
  option: OptionId,
  rule: TieBreakRule,
  options: readonly OptionId[],
  d: readonly (readonly number[])[],
): number | undefined {
  const i = options.indexOf(option);
  switch (rule) {
    case 'more-pairwise-wins':
      return options.filter((_, j) => i !== j && (d[i]?.[j] ?? 0) > (d[j]?.[i] ?? 0)).length;
    case 'higher-min-margin': {
      const margins = options
        .map((_, j) => (d[i]?.[j] ?? 0) - (d[j]?.[i] ?? 0))
        .filter((_, j) => j !== i);
      // `margins` queda vacío sólo con UNA opción, y eso hoy es INALCANZABLE: `validateDecisionConfig`
      // se niega a construir una decisión de condorcet-schulze con menos de dos
      // (`MULTI_METHOD_NEEDS_TWO_OPTIONS`), porque con una sola gana esa aunque todos la rechacen.
      // El `=== 0` queda escrito y no se borra porque documenta la invariante que lo vuelve
      // inalcanzable, y porque `Math.min()` sin argumentos devuelve `Infinity`: el día que la
      // guarda de la configuración se afloje, esta rama es lo único entre eso y un desempate
      // envenenado (§10, mutante demostrado equivalente, no deuda de prueba).
      return margins.length === 0 ? 0 : Math.min(...margins);
    }
    default:
      return undefined;
  }
}

async function chooseWinner(
  config: DecisionConfig,
  winners: readonly OptionId[],
  d: readonly (readonly number[])[],
  seed: string | undefined,
): Promise<OptionId> {
  if (config.method.kind !== 'condorcet-schulze') throw new Error('método incorrecto');
  let contenders = [...winners];
  for (const rule of config.method.tieBreak.cascade) {
    if (contenders.length <= 1) break;
    if (rule === 'pairwise-head-to-head' && contenders.length === 2) {
      const [a, b] = contenders;
      if (a === undefined || b === undefined) {
        throw new PreconditionError('NO_SCHULZE_WINNER', 'faltan contendientes');
      }
      const i = config.options.indexOf(a);
      const j = config.options.indexOf(b);
      const ab = d[i]?.[j] ?? 0;
      const ba = d[j]?.[i] ?? 0;
      if (ab !== ba) contenders = [ab > ba ? a : b];
      continue;
    }
    if (rule === 'public-seed-lot') {
      if (seed === undefined) {
        throw new PreconditionError(
          'SEED_NOT_REVEALED',
          'el desempate público de Schulze exige la semilla comprometida ya revelada',
        );
      }
      const order = await hmacOrder(seed, 'schulze-winner', contenders);
      const first = order[0];
      if (first === undefined) throw new PreconditionError('NO_SCHULZE_WINNER', 'sin ganador');
      contenders = [first.value];
      continue;
    }
    if (rule === 'lexicographic-hash') {
      const order = await lexicographicHashOrder(config.decisionId, contenders);
      const first = order[0];
      if (first === undefined) throw new PreconditionError('NO_SCHULZE_WINNER', 'sin ganador');
      contenders = [first];
      continue;
    }
    const metrics = contenders.map((option) => metric(option, rule, config.options, d));
    if (metrics.every((value) => value !== undefined)) {
      const best = Math.max(...metrics);
      contenders = contenders.filter((_, index) => metrics[index] === best);
    }
  }
  // Última red: `p[i][j] === p[j][i]` para todas las parejas que quedan. La cascada configurada ya
  // no distingue, y el código no puede tener ramas indefinidas. Gana el `OptionId` lexicográficamente
  // MENOR, que es la misma regla con la que `schulze()` linealiza su preorden: así el ganador es
  // siempre `ranking[0]` y la demostración no puede contradecirse a sí misma.
  const first = [...contenders].sort(compareIds)[0];
  if (first === undefined) throw new PreconditionError('NO_SCHULZE_WINNER', 'sin ganador');
  return first;
}

export async function tallyCondorcetSchulze(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
  seed?: string,
): Promise<MethodTally> {
  if (config.method.kind !== 'condorcet-schulze') {
    throw new Error('tallyCondorcetSchulze exige condorcet-schulze');
  }
  const d = pairwiseMatrix(config.options, ballots);
  const condorcet = condorcetWinner(config.options, d);
  const result = schulze(config.options, d);
  if (result.winners.length === 0) {
    throw new PreconditionError('EMPTY_SCHULZE_SET', 'Schulze debe producir al menos un ganador');
  }
  const winner = await chooseWinner(config, result.winners, d, seed);
  if (condorcet !== undefined && winner !== condorcet) {
    // INV-43: si el ganador de Condorcet existe, Schulze lo deja solo en el conjunto. Que la cascada
    // haya elegido a otro sólo puede significar que `p` está mal calculada (el fallo de B.8.a).
    throw new PreconditionError(
      'CONDORCET_WINNER_LOST',
      `INV-43: ${condorcet} gana todos sus enfrentamientos pero el escrutinio proclamó ${winner}`,
    );
  }
  return {
    outcome: { kind: 'winner', option: winner, tieBroken: result.winners.length > 1 },
    steps: [
      step('CS1', 'Se construyó la matriz de preferencias por pares.', {
        opciones: config.options.length,
        papeletas: ballots.length,
      }),
      step(
        'CS2',
        condorcet === undefined
          ? 'Ninguna opción gana todos sus enfrentamientos: no hay ganador de Condorcet y las ' +
              'preferencias colectivas forman un ciclo.'
          : `${condorcet} gana uno contra uno a todas las demás: es ganadora de Condorcet.`,
        {
          ganadorDeCondorcet: condorcet ?? 'no existe',
        },
      ),
      step('CS3', `El conjunto de Schulze produjo ${String(result.winners.length)} opción(es).`, {
        ganador: winner,
        desempate: result.winners.length > 1 ? 'sí' : 'no',
      }),
    ],
    tables: [
      {
        title: 'Preferencias por pares d[X][Y]',
        columns: ['X \\ Y', ...config.options],
        rows: config.options.map((option, i) => [option, ...(d[i] ?? [])]),
      },
      {
        title: 'Caminos más fuertes p[X][Y]',
        columns: ['X \\ Y', ...config.options],
        rows: config.options.map((option, i) => [option, ...(result.p[i] ?? [])]),
      },
    ],
    narrative:
      `Se comparó cada opción contra cada otra y se calcularon los caminos de victoria más fuertes. ` +
      (condorcet === undefined
        ? 'Ninguna opción le gana a todas las demás una contra una, así que no hay ganadora de ' +
          'Condorcet y hubo que recurrir a los caminos más fuertes. '
        : `${condorcet} le gana a todas las demás una contra una. `) +
      `El conjunto de Schulze fue ${result.winners.join(', ')} y la cascada publicada eligió ${winner}.`,
  };
}
