/** Sorteo deliberativo estratificado con cuotas exactas y tickets HMAC (B.9 / ADR-0031). */

import type { DecisionConfig } from '../config.js';
import type { EligibleMember, Electorate } from '../electorate.js';
import { PreconditionError } from '../errors.js';
import { compareIds, type MemberId, type StratumKey } from '../ids.js';
import { hmacOrder, hmacSha256Hex, type MethodTally, step } from './common.js';

export interface StratumQuota {
  readonly stratum: string;
  readonly size: number;
  readonly quota: number;
  readonly remainder: bigint;
  readonly remainderTicket: string;
}

function stratumOf(member: EligibleMember, axes: readonly StratumKey[]): string {
  if (axes.length === 0) return 'todos';
  return axes.map((axis) => `${axis}=${member.strata[axis] ?? '∅'}`).join('|');
}

function groupsOf(
  electorate: Electorate,
  axes: readonly StratumKey[],
): ReadonlyMap<string, readonly EligibleMember[]> {
  const groups = new Map<string, EligibleMember[]>();
  for (const member of electorate.members) {
    const stratum = stratumOf(member, axes);
    const group = groups.get(stratum) ?? [];
    group.push(member);
    groups.set(stratum, group);
  }
  return new Map([...groups].sort(([a], [b]) => compareIds(a, b)));
}

/** Hamilton con productos, cocientes y restos enteros; jamás divide en punto flotante. */
export async function hamiltonQuotas(
  strataSizes: ReadonlyMap<string, number>,
  requestedSampleSize: number,
  seed: string,
  allocation: 'proportional' | 'equal' = 'proportional',
): Promise<readonly StratumQuota[]> {
  const entries = [...strataSizes].sort(([a], [b]) => compareIds(a, b));
  const population = entries.reduce((sum, [, size]) => sum + size, 0);
  const sampleSize = Math.min(requestedSampleSize, population);
  if (sampleSize === 0 || entries.length === 0) return [];
  const denominator = allocation === 'proportional' ? population : entries.length;
  const base = await Promise.all(
    entries.map(async ([stratum, size]) => {
      const weight = allocation === 'proportional' ? size : 1;
      const product = BigInt(sampleSize) * BigInt(weight);
      const floor = Number(product / BigInt(denominator));
      const remainder = product % BigInt(denominator);
      return {
        stratum,
        size,
        quota: Math.min(floor, size),
        remainder,
        remainderTicket: await hmacSha256Hex(seed, `rem|${stratum}`),
      };
    }),
  );
  const order = [...base].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return compareIds(a.remainderTicket, b.remainderTicket);
  });
  let assigned = base.reduce((sum, entry) => sum + entry.quota, 0);
  while (assigned < sampleSize) {
    let progressed = false;
    for (const entry of order) {
      if (assigned >= sampleSize) break;
      if (entry.quota >= entry.size) continue;
      entry.quota += 1;
      assigned += 1;
      progressed = true;
    }
    if (!progressed) {
      throw new PreconditionError(
        'QUOTA_ALLOCATION_STUCK',
        'no fue posible redistribuir las cuotas hasta completar la muestra',
      );
    }
  }
  return base.sort((a, b) => compareIds(a.stratum, b.stratum));
}

export interface SortitionSelection {
  readonly selected: readonly MemberId[];
  readonly substitutes: ReadonlyMap<string, readonly MemberId[]>;
  readonly quotas: readonly StratumQuota[];
  readonly tickets: ReadonlyMap<MemberId, string>;
}

export async function stratifiedSortition(
  electorate: Electorate,
  config: Extract<DecisionConfig['method'], { kind: 'deliberative-sortition' }>,
  seed: string,
): Promise<SortitionSelection> {
  // Erratum INV-55: se acota antes de repartir para que Σ quota y |muestra| coincidan si n > N.
  const sampleSize = Math.min(config.sampleSize, electorate.censusSize);
  const groups = groupsOf(electorate, config.strata);
  const sizes = new Map([...groups].map(([stratum, members]) => [stratum, members.length]));
  const quotas = await hamiltonQuotas(sizes, sampleSize, seed, config.allocation);
  const substituteCount = Math.ceil(sampleSize / 3);
  const selected: MemberId[] = [];
  const substitutes = new Map<string, readonly MemberId[]>();
  const tickets = new Map<MemberId, string>();
  for (const quota of quotas) {
    const members = groups.get(quota.stratum) ?? [];
    const ordered = await hmacOrder(
      seed,
      quota.stratum,
      members.map((member) => member.memberId),
    );
    for (const entry of ordered) tickets.set(entry.value, entry.ticket);
    selected.push(...ordered.slice(0, quota.quota).map((entry) => entry.value));
    substitutes.set(
      quota.stratum,
      ordered.slice(quota.quota, quota.quota + substituteCount).map((entry) => entry.value),
    );
  }
  return {
    selected: selected.sort(compareIds),
    substitutes,
    quotas,
    tickets,
  };
}

export async function tallySortition(
  config: DecisionConfig,
  seed: string | undefined,
): Promise<MethodTally> {
  if (config.method.kind !== 'deliberative-sortition') {
    throw new Error('tallySortition exige deliberative-sortition');
  }
  if (seed === undefined) {
    throw new PreconditionError(
      'SEED_NOT_REVEALED',
      'el sorteo sólo se ejecuta con la semilla comprometida ya revelada',
    );
  }
  const result = await stratifiedSortition(config.electorate, config.method, seed);
  const substituteRows = [...result.substitutes].flatMap(([stratum, members]) =>
    members.map((member, index) => [stratum, index + 1, member, result.tickets.get(member) ?? '']),
  );
  return {
    outcome: { kind: 'sample', selected: result.selected },
    steps: [
      step('SO1', 'El tamaño se acotó al padrón antes de repartir las cuotas.', {
        solicitado: config.method.sampleSize,
        efectivo: result.selected.length,
        censo: config.electorate.censusSize,
      }),
      step('SO2', 'Las cuotas se asignaron por Hamilton con cocientes y restos enteros.', {
        estratos: result.quotas.length,
        sumaCuotas: result.quotas.reduce((sum, quota) => sum + quota.quota, 0),
      }),
      step('SO3', 'Cada selección y suplencia quedó determinada por su ticket HMAC.', {
        seleccionados: result.selected.length,
        suplentes: substituteRows.length,
      }),
    ],
    tables: [
      {
        title: 'Cuotas por estrato',
        columns: ['Estrato', 'Tamaño', 'Cuota', 'Resto', 'Ticket de desempate'],
        rows: result.quotas.map((quota) => [
          quota.stratum,
          quota.size,
          quota.quota,
          quota.remainder.toString(),
          quota.remainderTicket,
        ]),
      },
      {
        title: 'Personas seleccionadas',
        columns: ['Miembro', 'Ticket'],
        rows: result.selected.map((member) => [member, result.tickets.get(member) ?? '']),
      },
      {
        title: 'Suplentes por estrato',
        columns: ['Estrato', 'Orden', 'Miembro', 'Ticket'],
        rows: substituteRows,
      },
    ],
    narrative:
      'La muestra se repartió por cuotas exactas y cada estrato se ordenó por un ticket HMAC verificable. Los suplentes son los siguientes tickets, sin un nuevo sorteo.',
  };
}
