/**
 * PARTE C — democracia líquida: resolución de pesos.
 *
 * Cada bloque cita el apartado normativo que prueba. La PARTE C se abre advirtiendo que «una
 * delegación mal modelada no produce un error visible: produce un resultado plausible y falso», así
 * que aquí se prueban sobre todo las **fronteras**: el milisegundo de la revocación, la arista
 * número cuatro y la número cinco, el voto directo emitido antes de delegar.
 */

import { describe, expect, it } from 'vitest';

import {
  assertDelegationGrantable,
  assertDelegationRevocable,
  assertNoDelegationInSecretBallot,
  type Ballot,
  type BallotId,
  buildDecisionConfig,
  capWeight,
  type CircleId,
  chainBrokenNotices,
  concentrationReport,
  type DecisionConfig,
  DEFAULT_EARLY_CLOSE,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DELEGATION_ENABLED,
  type Delegation,
  type DelegationScope,
  delegationId,
  delegationSlot,
  delegationWeightResolver,
  type Electorate,
  ENGINE_VERSION,
  type Fraction,
  hasActiveDelegationsFor,
  type Instant,
  instant,
  normalizedHerfindahl,
  ratio,
  resolveDelegation,
  revokeIn,
  toFractionString,
  topicId,
  type TopicId,
  vigentDelegations,
} from '../src/index.js';
import { PreconditionError } from '../src/errors.js';
import {
  buildElectorate,
  CIRCLE_MAIN,
  CIRCLE_OTHER,
  CLOSES_AT,
  DECISION_ID,
  DEFAULT_WINDOW,
  hex32,
  memberIdAt,
  NO_QUORUM,
  OPTION_MAIN,
  PROPOSAL_ID,
  PROPOSAL_V1,
  SEED_COMMITMENT,
  T0,
} from './arbitraries.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Fixtures
// ═════════════════════════════════════════════════════════════════════════════════════════════

const TOPIC_SPACE = 0x8000;
const DELEGATION_SPACE = 0x7000;

const topicIdAt = (i: number): TopicId => topicId(hex32(TOPIC_SPACE + i));
const delegationIdAt = (i: number): string => hex32(DELEGATION_SPACE + i);

/** Un semestre justo: la vigencia máxima que C.1.a admite. */
const SEMESTER = 180 * 24 * 60 * 60 * 1000;

const TOPIC_A = topicIdAt(0);
const TOPIC_B = topicIdAt(1);

const GLOBAL: DelegationScope = { kind: 'global' };
const IN_CIRCLE: DelegationScope = { kind: 'circle', circleId: CIRCLE_MAIN };
const ON_TOPIC_A: DelegationScope = { kind: 'topic', topicId: TOPIC_A };

interface ConfigOverrides {
  readonly topics?: readonly TopicId[];
  readonly circle?: CircleId;
  readonly maxDepth?: number;
  readonly cap?: Fraction;
  readonly enabled?: boolean;
}

async function configFor(
  electorate: Electorate,
  overrides: ConfigOverrides = {},
): Promise<DecisionConfig> {
  return buildDecisionConfig({
    decisionId: DECISION_ID,
    proposalId: PROPOSAL_ID,
    proposalVersionHash: PROPOSAL_V1,
    circleId: overrides.circle ?? CIRCLE_MAIN,
    topics: overrides.topics ?? [TOPIC_A],
    options: [OPTION_MAIN],
    electorate,
    method: {
      kind: 'simple-majority',
      abstentionPolicy: 'exclude',
      base: 'cast',
      tieBreak: { cascade: ['lexicographic-hash'] },
    },
    quorum: NO_QUORUM,
    window: {
      ...DEFAULT_WINDOW,
      earlyClose: DEFAULT_EARLY_CLOSE,
      challengeWindow: DEFAULT_CHALLENGE_WINDOW_MS,
    },
    privacy: 'public-roll-call',
    delegation: {
      ...DELEGATION_ENABLED,
      enabled: overrides.enabled ?? true,
      ...(overrides.maxDepth === undefined ? {} : { maxDepth: overrides.maxDepth }),
      ...(overrides.cap === undefined ? {} : { cap: overrides.cap }),
    },
    seedCommitment: SEED_COMMITMENT,
    engineVersion: ENGINE_VERSION,
  });
}

interface BallotSpec {
  readonly voter: number;
  readonly approve?: boolean;
  readonly abstain?: boolean;
  readonly at?: Instant;
  readonly seq?: number;
}

function ballot(spec: BallotSpec, index: number): Ballot {
  return {
    ballotId: hex32(0x5000 + index) as BallotId,
    decisionId: DECISION_ID,
    voter: memberIdAt(spec.voter),
    round: 1,
    payload:
      spec.abstain === true
        ? { kind: 'abstain' }
        : { kind: 'binary', approve: spec.approve ?? true },
    castAt: spec.at ?? instant(T0 + 1000 + index),
    seq: 100 + index,
    proposalVersionHash: PROPOSAL_V1,
  };
}

const ballots = (specs: readonly BallotSpec[]): readonly Ballot[] => specs.map(ballot);

interface GrantSpec {
  readonly from: number;
  readonly to: number;
  readonly scope?: DelegationScope;
  readonly at?: Instant;
  readonly expiresAt?: Instant;
  readonly revokedAt?: Instant;
  readonly seq?: number;
}

function grant(spec: GrantSpec, index: number): Delegation {
  const grantedAt = spec.at ?? instant(T0 - 100_000 + index);
  return {
    delegationId: delegationId(delegationIdAt(index)),
    delegator: memberIdAt(spec.from),
    delegate: memberIdAt(spec.to),
    scope: spec.scope ?? GLOBAL,
    grantedAt,
    expiresAt: spec.expiresAt ?? instant(grantedAt + SEMESTER),
    ...(spec.revokedAt === undefined ? {} : { revokedAt: spec.revokedAt }),
    grantedSeq: spec.seq ?? index + 1,
  };
}

const grants = (specs: readonly GrantSpec[]): readonly Delegation[] => specs.map(grant);

/** Cadena `from → from+1 → … → from+length`, una arista por paso. */
function chain(
  from: number,
  length: number,
  scope: DelegationScope = GLOBAL,
): readonly Delegation[] {
  return grants(Array.from({ length }, (_, i) => ({ from: from + i, to: from + i + 1, scope })));
}

function weightsByVoter(
  config: DecisionConfig,
  cast: readonly Ballot[],
  delegations: readonly Delegation[],
  closedAt: Instant = CLOSES_AT,
): Record<string, number> {
  const effective = delegationWeightResolver(delegations)(config, cast, closedAt);
  return Object.fromEntries(effective.map((b) => [b.voter, b.weight]));
}

const M = memberIdAt;

/** Corre `fn`, exige que rechace con `PreconditionError` y devuelve el error para inspeccionarlo. */
function rejects(fn: () => void): PreconditionError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PreconditionError) return error;
    throw error;
  }
  throw new Error('se esperaba que la comprobación rechazara, y no lo hizo');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.2 — vigencia
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.2 — vigencia de la delegación', () => {
  it('una delegación vigente deposita el peso en la papeleta del delegado', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 1 }]),
      grants([{ from: 0, to: 1 }]),
      CLOSES_AT,
    );
    expect(resolution.weightOf.get(M(1))).toBe(2);
    expect(resolution.onBehalfOf.get(M(1))).toEqual([M(0)]);
    // `unassigned` lleva a todo el censo silencioso (C.4.3 lo enumera así), pero no a la delegante.
    expect(resolution.unassigned.map((u) => u.member)).not.toContain(M(0));
    expect(resolution.unassigned.every((u) => u.reason === 'no-delegation')).toBe(true);
  });

  it('INV-24 — la revocación tiene efecto en el instante EXACTO: la frontera es `closedAt`', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = ballots([{ voter: 1 }]);
    const antes = instant(CLOSES_AT - 1);
    const justo = CLOSES_AT;
    const despues = instant(CLOSES_AT + 1);

    // `t < d.revokedAt` con `<` estricto: revocar EN el cierre ya deja fuera la delegación.
    expect(
      resolveDelegation(
        config,
        cast,
        grants([{ from: 0, to: 1, revokedAt: antes }]),
        CLOSES_AT,
      ).weightOf.get(M(1)),
    ).toBe(1);
    expect(
      resolveDelegation(
        config,
        cast,
        grants([{ from: 0, to: 1, revokedAt: justo }]),
        CLOSES_AT,
      ).weightOf.get(M(1)),
    ).toBe(1);
    expect(
      resolveDelegation(
        config,
        cast,
        grants([{ from: 0, to: 1, revokedAt: despues }]),
        CLOSES_AT,
      ).weightOf.get(M(1)),
    ).toBe(2);
  });

  it('INV-29 — una delegación caducada no aplica, y la frontera también es `closedAt`', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = ballots([{ voter: 1 }]);
    for (const [expiresAt, expected] of [
      [instant(CLOSES_AT - 1), 1],
      [CLOSES_AT, 1],
      [instant(CLOSES_AT + 1), 2],
    ] as const) {
      expect(
        resolveDelegation(
          config,
          cast,
          grants([{ from: 0, to: 1, expiresAt }]),
          CLOSES_AT,
        ).weightOf.get(M(1)),
      ).toBe(expected);
    }
  });

  it('la concesión debe ser estrictamente anterior al instante de resolución', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = ballots([{ voter: 1 }]);
    const enElCierre = grants([
      { from: 0, to: 1, at: CLOSES_AT, expiresAt: instant(CLOSES_AT + SEMESTER) },
    ]);
    expect(resolveDelegation(config, cast, enElCierre, CLOSES_AT).weightOf.get(M(1))).toBe(1);
  });

  it('revocar sin votar NO es abstenerse: el peso queda en silencio (regla de oro 4)', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 1 }]),
      grants([{ from: 0, to: 1, revokedAt: instant(T0 + 5000) }]),
      CLOSES_AT,
    );
    expect(resolution.weightOf.get(M(1))).toBe(1);
    expect(resolution.unassigned.find((u) => u.member === M(0))?.reason).toBe('no-delegation');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.2 — ámbito
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.2 / INV-30 — resolución de ámbito', () => {
  it('la más ESPECÍFICA gana, aunque la global sea más reciente', async () => {
    const config = await configFor(await buildElectorate(20));
    // Ana (0) delega el tema A en 1, el círculo en 2 y todo lo demás en 3; las tres casan.
    const delegations = grants([
      { from: 0, to: 1, scope: ON_TOPIC_A, seq: 1 },
      { from: 0, to: 2, scope: IN_CIRCLE, seq: 2 },
      { from: 0, to: 3, scope: GLOBAL, seq: 3 },
    ]);
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 1 }, { voter: 2 }, { voter: 3 }]),
      delegations,
      CLOSES_AT,
    );
    expect(resolution.edges.get(M(0))).toBe(M(1));
    expect(resolution.weightOf.get(M(1))).toBe(2);
    expect(resolution.weightOf.get(M(2))).toBe(1);
    expect(resolution.weightOf.get(M(3))).toBe(1);
  });

  it('el tema casa por PERTENENCIA al conjunto, no por igualdad con `topics[0]`', async () => {
    const electorate = await buildElectorate(20);
    const config = await configFor(electorate, { topics: [TOPIC_A, TOPIC_B] });
    const enB: DelegationScope = { kind: 'topic', topicId: TOPIC_B };
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 1 }]),
      grants([{ from: 0, to: 1, scope: enB }]),
      CLOSES_AT,
    );
    expect(resolution.weightOf.get(M(1))).toBe(2);
  });

  it('una delegación fuera de ámbito no aplica', async () => {
    const config = await configFor(await buildElectorate(20), { topics: [TOPIC_A] });
    const otroTema: DelegationScope = { kind: 'topic', topicId: TOPIC_B };
    const otroCirculo: DelegationScope = { kind: 'circle', circleId: CIRCLE_OTHER };
    for (const scope of [otroTema, otroCirculo]) {
      const resolution = resolveDelegation(
        config,
        ballots([{ voter: 1 }]),
        grants([{ from: 0, to: 1, scope }]),
        CLOSES_AT,
      );
      expect(resolution.weightOf.get(M(1))).toBe(1);
      expect(resolution.unassigned.find((u) => u.member === M(0))?.reason).toBe('no-delegation');
    }
  });

  it('a igual especificidad manda la MÁS RECIENTE (mayor `grantedSeq`)', async () => {
    const config = await configFor(await buildElectorate(20), { topics: [TOPIC_A, TOPIC_B] });
    const enA: DelegationScope = { kind: 'topic', topicId: TOPIC_A };
    const enB: DelegationScope = { kind: 'topic', topicId: TOPIC_B };
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 1 }, { voter: 2 }]),
      grants([
        { from: 0, to: 1, scope: enA, seq: 7 },
        { from: 0, to: 2, scope: enB, seq: 9 },
      ]),
      CLOSES_AT,
    );
    expect(resolution.edges.get(M(0))).toBe(M(2));
  });

  it('un delegado fuera del padrón deja la arista muerta, y se distingue de «no delegó»', async () => {
    const config = await configFor(await buildElectorate(20));
    // El miembro 40 no está en un padrón de 20.
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 1 }]),
      grants([{ from: 0, to: 40 }]),
      CLOSES_AT,
    );
    expect(resolution.edges.has(M(0))).toBe(false);
    expect(resolution.unassigned.find((u) => u.member === M(0))?.reason).toBe(
      'delegate-outside-census',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.3 — el voto directo gana siempre
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.3.1 / INV-23 — el voto directo anula la delegación', () => {
  it('gana aunque sea POSTERIOR al del delegado: el peso del delegado baja en 1', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = ballots([
      { voter: 1, at: instant(T0 + 1000) }, // el delegado vota el lunes
      { voter: 0, at: instant(T0 + 9000) }, // la delegante vota el miércoles
    ]);
    const resolution = resolveDelegation(config, cast, grants([{ from: 0, to: 1 }]), CLOSES_AT);
    expect(resolution.weightOf.get(M(0))).toBe(1);
    expect(resolution.weightOf.get(M(1))).toBe(1);
    expect(resolution.onBehalfOf.get(M(1))).toEqual([]);
    // Y no hace falta revocar: votar es revocar de hecho PARA ESTA DECISIÓN.
    expect(resolution.edges.has(M(0))).toBe(false);
  });

  it('gana aunque sea ANTERIOR a la delegación', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = ballots([
      { voter: 0, at: instant(T0 + 1000) },
      { voter: 1, at: instant(T0 + 2000) },
    ]);
    // La delegación se concede DESPUÉS de que la delegante ya votó.
    const delegations = grants([{ from: 0, to: 1, at: instant(T0 + 5000) }]);
    const resolution = resolveDelegation(config, cast, delegations, CLOSES_AT);
    expect(resolution.weightOf.get(M(0))).toBe(1);
    expect(resolution.weightOf.get(M(1))).toBe(1);
  });

  it('un nodo intermedio que votó directo es TERMINAL y absorbe la cadena', async () => {
    const config = await configFor(await buildElectorate(20));
    // 0 → 1 → 2, y vota 1 (el intermedio) y también 2.
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 1 }, { voter: 2 }]),
      grants([
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ]),
      CLOSES_AT,
    );
    expect(resolution.weightOf.get(M(1))).toBe(2); // absorbe a 0 y no reenvía
    expect(resolution.weightOf.get(M(2))).toBe(1);
    expect(resolution.onBehalfOf.get(M(1))).toEqual([M(0)]);
  });

  it('INV-22 — nadie contribuye a dos papeletas', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = ballots([{ voter: 2 }, { voter: 0 }]);
    const effective = delegationWeightResolver(
      grants([
        { from: 0, to: 2 },
        { from: 1, to: 2 },
      ]),
    )(config, cast, CLOSES_AT);
    const todos = effective.flatMap((b) => [b.voter, ...b.onBehalfOf]);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it('si el delegado terminal se abstiene explícitamente, sus delegantes se abstienen con él', async () => {
    const config = await configFor(await buildElectorate(20));
    const effective = delegationWeightResolver(grants([{ from: 0, to: 1 }]))(
      config,
      ballots([{ voter: 1, abstain: true }]),
      CLOSES_AT,
    );
    expect(effective).toHaveLength(1);
    expect(effective[0]?.payload.kind).toBe('abstain');
    expect(effective[0]?.weight).toBe(2);
  });

  it('un delegado que NO votó deja la cadena sin desembocadura: silencio, no abstención', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 5 }]),
      grants([{ from: 0, to: 1 }]),
      CLOSES_AT,
    );
    expect(resolution.unassigned.find((u) => u.member === M(0))?.reason).toBe('chain-dead-end');
    expect(resolution.weightOf.get(M(5))).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.4 — ciclos y profundidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.4 / INV-25 — ciclos', () => {
  it('un ciclo deja en SILENCIO a todos sus miembros; no se rompe por ninguna heurística', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 9 }]),
      grants([
        { from: 0, to: 1 },
        { from: 1, to: 2 },
        { from: 2, to: 0 },
      ]),
      CLOSES_AT,
    );
    expect(resolution.cycleMembers).toEqual([M(0), M(1), M(2)]);
    for (const i of [0, 1, 2]) {
      expect(resolution.unassigned.find((u) => u.member === M(i))?.reason).toBe('cycle');
    }
    expect([...resolution.weightOf.values()]).toEqual([1]);
  });

  it('quien DESEMBOCA en un ciclo también queda en silencio', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 9 }]),
      grants([
        { from: 3, to: 0 },
        { from: 0, to: 1 },
        { from: 1, to: 0 },
      ]),
      CLOSES_AT,
    );
    expect(resolution.unassigned.find((u) => u.member === M(3))?.reason).toBe('cycle');
    expect(resolution.cycleMembers).toContain(M(3));
  });

  it('un ciclo no cuelga el recorrido ni cuenta un voto dos veces', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 0 }]),
      grants([
        { from: 1, to: 2 },
        { from: 2, to: 1 },
      ]),
      CLOSES_AT,
    );
    const total = [...resolution.weightOf.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });
});

describe('C.4.2 / INV-26 — profundidad', () => {
  it('admite exactamente `maxDepth` ARISTAS y rechaza la siguiente', async () => {
    // Censo 60 ⇒ tope 6: holgado, para que lo que se mide aquí sea la profundidad y no el tope.
    const config = await configFor(await buildElectorate(60)); // maxDepth = 4
    // Cadena 0→1→2→3→4 (4 aristas) y vota 4.
    const cuatro = resolveDelegation(config, ballots([{ voter: 4 }]), chain(0, 4), CLOSES_AT);
    expect(cuatro.weightOf.get(M(4))).toBe(5);
    expect(cuatro.assignments.find((a) => a.delegator === M(0))?.hops).toBe(4);

    // Cadena 0→1→2→3→4→5 (5 aristas) y vota 5: el miembro 0 se cae, los demás no.
    const cinco = resolveDelegation(config, ballots([{ voter: 5 }]), chain(0, 5), CLOSES_AT);
    expect(cinco.unassigned.find((u) => u.member === M(0))?.reason).toBe('depth-exceeded');
    expect(cinco.weightOf.get(M(5))).toBe(5); // 5 = él + los miembros 1,2,3,4
    expect(cinco.onBehalfOf.get(M(5))).toEqual([M(1), M(2), M(3), M(4)]);
  });

  it('al excederse, el peso NO se deposita en el último nodo válido', async () => {
    const config = await configFor(await buildElectorate(40), { maxDepth: 2 });
    const resolution = resolveDelegation(config, ballots([{ voter: 3 }]), chain(0, 3), CLOSES_AT);
    expect(resolution.unassigned.find((u) => u.member === M(0))?.reason).toBe('depth-exceeded');
    // El peso de 0 no aparece en NINGUNA papeleta.
    for (const [, delegantes] of resolution.onBehalfOf) expect(delegantes).not.toContain(M(0));
  });

  it('`maxDepth = 1` es la profundidad mínima legal y admite una sola arista', async () => {
    const config = await configFor(await buildElectorate(40), { maxDepth: 1 });
    const una = resolveDelegation(config, ballots([{ voter: 1 }]), chain(0, 1), CLOSES_AT);
    expect(una.weightOf.get(M(1))).toBe(2);
    const dos = resolveDelegation(config, ballots([{ voter: 2 }]), chain(0, 2), CLOSES_AT);
    expect(dos.unassigned.find((u) => u.member === M(0))?.reason).toBe('depth-exceeded');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.5 — tope de concentración
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.5 / INV-27 / INV-28 — tope de concentración', () => {
  it('`capWeight = ⌊cap·N⌋` sobre el CENSO: 30 de 300', async () => {
    const config = await configFor(await buildElectorate(300));
    expect(capWeight(config)).toBe(30);
  });

  it('ninguna papeleta supera el tope, ni con una estrella entera delegando', async () => {
    const electorate = await buildElectorate(40); // cap 1/10 ⇒ 4
    const config = await configFor(electorate);
    const delegations = grants(
      Array.from({ length: 20 }, (_, i) => ({ from: i + 1, to: 0, seq: i + 1 })),
    );
    const resolution = resolveDelegation(config, ballots([{ voter: 0 }]), delegations, CLOSES_AT);
    expect(resolution.capWeight).toBe(4);
    expect(resolution.weightOf.get(M(0))).toBe(4);
    expect(resolution.returnedByCap).toHaveLength(17);
  });

  it('la devolución es LIFO por `grantedSeq`: se devuelven las MÁS RECIENTES', async () => {
    const electorate = await buildElectorate(20); // cap 1/10 ⇒ 2
    const config = await configFor(electorate);
    const delegations = grants([
      { from: 1, to: 0, seq: 3 },
      { from: 2, to: 0, seq: 7 },
      { from: 3, to: 0, seq: 11 },
    ]);
    const resolution = resolveDelegation(config, ballots([{ voter: 0 }]), delegations, CLOSES_AT);
    expect(resolution.capWeight).toBe(2);
    expect(resolution.weightOf.get(M(0))).toBe(2);
    // Sobreviven las dos más antiguas (seq 3 y 7); se devuelven las de seq 11.
    expect(resolution.onBehalfOf.get(M(0))).toEqual([M(1)]);
    expect(resolution.returnedByCap).toEqual([M(3), M(2)]);
  });

  it('el peso devuelto no cuenta como participación: queda sin asignar', async () => {
    const config = await configFor(await buildElectorate(20));
    const delegations = grants([
      { from: 1, to: 0, seq: 3 },
      { from: 2, to: 0, seq: 7 },
    ]);
    const resolution = resolveDelegation(config, ballots([{ voter: 0 }]), delegations, CLOSES_AT);
    expect(resolution.unassigned.find((u) => u.member === M(2))?.reason).toBe('cap-returned');
    expect(resolution.assignments.map((a) => a.delegator)).not.toContain(M(2));
  });

  it('la unidad devuelta es una PERSONA, no una arista: la cadena de arriba sobrevive', async () => {
    // Cadena 0 → 1 → 2, vota 2. Censo 20 ⇒ tope 2, y el peso de 2 sería 3. Se devuelve la unidad
    // de mayor `grantedSeq`, que es la del miembro 1. El miembro 0 —que delegó antes y no hizo
    // nada— conserva su peso y sigue llegando a 2. Errata E-44: la spec no dice qué se devuelve
    // cuando hacia el delegado hay UNA sola arista pero varios pesos.
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 2 }]),
      grants([
        { from: 0, to: 1, seq: 3 },
        { from: 1, to: 2, seq: 9 },
      ]),
      CLOSES_AT,
    );
    expect(resolution.capWeight).toBe(2);
    expect(resolution.weightOf.get(M(2))).toBe(2);
    expect(resolution.returnedByCap).toEqual([M(1)]);
    expect(resolution.onBehalfOf.get(M(2))).toEqual([M(0)]);
    expect(resolution.unassigned.find((u) => u.member === M(1))?.reason).toBe('cap-returned');
    // Y no se arrasa la rama: el miembro 0 NO queda en silencio.
    expect(resolution.unassigned.map((u) => u.member)).not.toContain(M(0));
  });

  it('la devolución no depende del orden en que llegan delegaciones NO relacionadas', async () => {
    const config = await configFor(await buildElectorate(20));
    const base = grants([
      { from: 1, to: 0, seq: 3 },
      { from: 2, to: 0, seq: 7 },
      { from: 5, to: 4, seq: 5 },
    ]);
    const permutada = [base[2], base[0], base[1]].filter((d): d is Delegation => d !== undefined);
    const cast = ballots([{ voter: 0 }, { voter: 4 }]);
    expect(resolveDelegation(config, cast, base, CLOSES_AT).returnedByCap).toEqual(
      resolveDelegation(config, cast, permutada, CLOSES_AT).returnedByCap,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.6 — índices de concentración
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.6 / INV-31 — índices de concentración', () => {
  it('el HHI publicado es RECOMPUTABLE desde los pesos', async () => {
    const config = await configFor(await buildElectorate(40));
    const effective = delegationWeightResolver(
      grants([
        { from: 1, to: 0 },
        { from: 2, to: 0 },
        { from: 3, to: 4 },
      ]),
    )(config, ballots([{ voter: 0 }, { voter: 4 }]), CLOSES_AT);
    const report = concentrationReport(effective, 40);
    // pesos 3 y 2 ⇒ HHI = (9+4)/25 = 13/25.
    expect(toFractionString(report.hhi)).toBe('13/25');
    // HHI* = (n·S − W²)/(W²(n−1)) = (2·13 − 25)/(25·1) = 1/25.
    expect(toFractionString(report.normalizedHhi)).toBe('1/25');
    expect(toFractionString(report.cr1)).toBe('3/40');
  });

  it('reparto uniforme ⇒ HHI* = 0 exacto, sin residuo de coma flotante', () => {
    expect(toFractionString(normalizedHerfindahl([1, 1, 1, 1, 1]))).toBe('0/1');
    expect(toFractionString(normalizedHerfindahl([7, 7, 7]))).toBe('0/1');
  });

  it('un solo votante que lo concentra todo ⇒ HHI = 1', async () => {
    const config = await configFor(await buildElectorate(40));
    const effective = delegationWeightResolver(grants([{ from: 1, to: 0 }]))(
      config,
      ballots([{ voter: 0 }]),
      CLOSES_AT,
    );
    const report = concentrationReport(effective, 40);
    expect(toFractionString(report.hhi)).toBe('1/1');
    // CR1 se publica SIN reducir: «2 de 40» dice más que «1/20», igual que la participación.
    expect(toFractionString(report.cr1)).toBe('2/40');
    expect(report.high).toBe(true); // 2/40 = 1/20, y la comparación es exacta
  });

  it('la alarma de C.6.a se dispara por HHI* o por CR1, y no invalida nada', async () => {
    const config = await configFor(await buildElectorate(300));
    const effective = delegationWeightResolver(
      grants(Array.from({ length: 20 }, (_, i) => ({ from: i + 1, to: 0, seq: i + 1 }))),
    )(config, ballots([{ voter: 0 }, { voter: 25 }, { voter: 26 }]), CLOSES_AT);
    const report = concentrationReport(effective, 300);
    expect(report.top[0]?.weight).toBe(21);
    expect(report.high).toBe(true);
    expect(report.top).toHaveLength(3);
  });

  it('con reparto plano la concentración no salta la alarma', async () => {
    const config = await configFor(await buildElectorate(300));
    const effective = delegationWeightResolver([])(
      config,
      ballots(Array.from({ length: 30 }, (_, i) => ({ voter: i }))),
      CLOSES_AT,
    );
    const report = concentrationReport(effective, 300);
    expect(toFractionString(report.normalizedHhi)).toBe('0/1');
    expect(report.high).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.4.3 — aviso de cadena rota
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.4.3 — aviso de cadena rota', () => {
  it('avisa a todo el que quedaría sin asignar, con el motivo y 24 h de antelación', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 9 }]),
      grants([
        { from: 0, to: 1 }, // 1 no vota ⇒ chain-dead-end
        { from: 2, to: 3 },
        { from: 3, to: 2 }, // ciclo
      ]),
      CLOSES_AT,
    );
    const notices = chainBrokenNotices(config, resolution, CLOSES_AT);
    const byMember = new Map(notices.map((n) => [n.member, n]));
    expect(byMember.get(M(0))?.reason).toBe('chain-dead-end');
    expect(byMember.get(M(2))?.reason).toBe('cycle');
    expect(byMember.get(M(5))?.reason).toBe('no-delegation');
    expect(byMember.get(M(9))).toBeUndefined(); // votó
    expect(notices[0]?.noticeAt).toBe(instant(CLOSES_AT - 24 * 60 * 60 * 1000));
  });

  it('el aviso nunca se sitúa antes de la apertura', async () => {
    const electorate = await buildElectorate(20);
    const config = await buildDecisionConfig({
      decisionId: DECISION_ID,
      proposalId: PROPOSAL_ID,
      proposalVersionHash: PROPOSAL_V1,
      circleId: CIRCLE_MAIN,
      topics: [TOPIC_A],
      options: [OPTION_MAIN],
      electorate,
      method: {
        kind: 'simple-majority',
        abstentionPolicy: 'exclude',
        base: 'cast',
        tieBreak: { cascade: ['lexicographic-hash'] },
      },
      quorum: NO_QUORUM,
      // Ventana de 2 h: más corta que la antelación del aviso.
      window: { ...DEFAULT_WINDOW, closesAt: instant(T0 + 2 * 3_600_000) },
      privacy: 'public-roll-call',
      delegation: DELEGATION_ENABLED,
      seedCommitment: SEED_COMMITMENT,
      engineVersion: ENGINE_VERSION,
    });
    const closesAt = config.window.closesAt;
    const resolution = resolveDelegation(config, [], [], closesAt);
    const notices = chainBrokenNotices(config, resolution, closesAt);
    expect(notices).toHaveLength(20);
    expect(notices[0]?.noticeAt).toBe(config.window.opensAt);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Delegación apagada
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('con `delegation.enabled === false` el resolutor es el directo', () => {
  it('una persona, un voto, aunque el registro traiga delegaciones', async () => {
    const config = await configFor(await buildElectorate(20), { enabled: false });
    const pesos = weightsByVoter(
      config,
      ballots([{ voter: 1 }]),
      grants([
        { from: 0, to: 1 },
        { from: 2, to: 1 },
      ]),
    );
    expect(pesos[M(1)]).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-21 — el peso total nunca excede el padrón congelado
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-21 — la suma de pesos nunca excede el censo', () => {
  it('ni con estrella, ni con escoba, ni con cadenas que se cruzan', async () => {
    const electorate = await buildElectorate(60);
    const config = await configFor(electorate);
    const delegations = grants([
      ...Array.from({ length: 5 }, (_, i) => ({ from: i + 1, to: 0, seq: i + 1 })),
      { from: 10, to: 11, seq: 10 },
      { from: 11, to: 12, seq: 11 },
      { from: 12, to: 0, seq: 12 },
      { from: 20, to: 21, seq: 20 },
    ]);
    const effective = delegationWeightResolver(delegations)(
      config,
      ballots([{ voter: 0 }, { voter: 21 }, { voter: 30 }]),
      CLOSES_AT,
    );
    const total = effective.reduce((s, b) => s + b.weight, 0);
    expect(total).toBeLessThanOrEqual(electorate.censusSize);
    expect(ratio(total, electorate.censusSize).num).toBeLessThanOrEqual(60n);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `capWeight` — el suelo del suelo
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('`capWeight` — el suelo del suelo es 1 (errata E-40)', () => {
  it('con censo chico, `⌊cap·N⌋` da 0 y el suelo lo sube a 1', async () => {
    // `buildDecisionConfig` ya rechaza al abrir un censo tan chico que el tope dé menos de 2
    // (`DELEGATION_CAP_TOO_SMALL`), así que la única manera legítima de ejercitar este suelo es la
    // que el propio comentario de `capWeight` describe: un `configHash` fabricado a mano. Se
    // construye una config VÁLIDA y se le manipula sólo el campo que hace falta, sin pasar de nuevo
    // por la validación — exactamente la protección que la función dice ofrecer.
    const config = await configFor(await buildElectorate(20));
    const manipulado: DecisionConfig = {
      ...config,
      electorate: { ...config.electorate, censusSize: 5 }, // cap 1/10 ⇒ 0.5, trunca a 0
    };
    expect(capWeight(manipulado)).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// PASO 1 — filtros propios de las papeletas directas (D.3.b, INV-02)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('PASO 1 — filtros propios de las papeletas directas', () => {
  it('una papeleta de quien no está en el padrón congelado nunca cuenta (INV-02)', async () => {
    const config = await configFor(await buildElectorate(20));
    // M(99) no pertenece al padrón de 10 miembros: su papeleta «directa» no debe bloquear nada.
    const cast = ballots([{ voter: 0 }, { voter: 99 }]);
    const pesos = weightsByVoter(config, cast, []);
    expect(pesos[M(99)]).toBeUndefined();
    expect(pesos[M(0)]).toBe(1);
  });

  it('el instante del cierre pertenece al DESPUÉS: emitida justo en `closedAt` no cuenta', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = [ballot({ voter: 0, at: CLOSES_AT }, 0)];
    expect(weightsByVoter(config, cast, [])[M(0)]).toBeUndefined();
  });

  it('un milisegundo antes del cierre, sí cuenta', async () => {
    const config = await configFor(await buildElectorate(20));
    const cast = [ballot({ voter: 0, at: instant(CLOSES_AT - 1) }, 0)];
    expect(weightsByVoter(config, cast, [])[M(0)]).toBe(1);
  });

  it('dos papeletas del mismo votante: gana la de mayor `seq`, sin importar el ORDEN de llegada', async () => {
    const config = await configFor(await buildElectorate(20));
    // `ballot(spec, índice)` deriva `seq = 100 + índice`: la de mayor `seq` (índice 5) llega
    // PRIMERO en el arreglo, y la de menor `seq` (índice 1) llega DESPUÉS. Si el criterio fuera «la
    // última que llega» en vez de «la de mayor `seq`», este caso daría la papeleta equivocada.
    const cast = [ballot({ voter: 0 }, 5), ballot({ voter: 0 }, 1)];
    const [ultima] = delegationWeightResolver([])(config, cast, CLOSES_AT);
    expect(ultima?.seq).toBe(105);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// PASO 3 — `cycleMembers` sólo lleva ciclos, ninguna otra razón de silencio
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('PASO 3 — `cycleMembers` no se confunde con otras razones de silencio', () => {
  it('quien queda sin asignar por PROFUNDIDAD no entra en `cycleMembers`', async () => {
    const config = await configFor(await buildElectorate(20), { maxDepth: 1 });
    // Cadena de 2 aristas con `maxDepth = 1`: profundidad excedida, no hay ciclo.
    const resolution = resolveDelegation(config, ballots([{ voter: 2 }]), chain(0, 2), CLOSES_AT);
    expect(resolution.unassigned.find((u) => u.member === M(0))?.reason).toBe('depth-exceeded');
    expect(resolution.cycleMembers).toEqual([]);
  });

  it('quien queda sin asignar por CADENA MUERTA no entra en `cycleMembers`', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([]),
      grants([{ from: 0, to: 1 }]), // 1 nunca vota ni delega: la cadena muere sin desembocadura
      CLOSES_AT,
    );
    expect(resolution.unassigned.find((u) => u.member === M(0))?.reason).toBe('chain-dead-end');
    expect(resolution.cycleMembers).toEqual([]);
  });

  it('un ciclo real SÍ entra en `cycleMembers`', async () => {
    const config = await configFor(await buildElectorate(20));
    const resolution = resolveDelegation(
      config,
      ballots([]),
      grants([
        { from: 0, to: 1 },
        { from: 1, to: 0 },
      ]),
      CLOSES_AT,
    );
    expect(resolution.cycleMembers).toEqual([M(0), M(1)]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// PASO 5 — desempate por `grantedSeq`, y a igual `seq` por delegador
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('PASO 5 — el desempate mira el `grantedSeq` de verdad, no el orden del delegador', () => {
  it('con `grantedSeq` EMPATADO, se devuelve al delegador de mayor id', async () => {
    const config = await configFor(await buildElectorate(20)); // cap 2
    // M(1) y M(2) delegan con el MISMO `grantedSeq`: 1 (propio) + 2 (carried) = 3 > cap(2), se
    // devuelve exactamente uno. El criterio de C.2/C.5.b.2 para el empate es `delegationId`
    // descendente sobre el delegador, no el orden en que las delegaciones llegaron al arreglo.
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 0 }]),
      grants([
        { from: 1, to: 0, seq: 5 },
        { from: 2, to: 0, seq: 5 },
      ]),
      CLOSES_AT,
    );
    expect(resolution.returnedByCap).toEqual([M(2)]);
  });

  it('con `grantedSeq` DISTINTO, manda el `seq` aunque contradiga el orden por id', async () => {
    const config = await configFor(await buildElectorate(20)); // cap 2
    // M(1) es el de MAYOR `seq` (más reciente) pero MENOR id; M(3) es el de MENOR `seq` pero mayor
    // id. Si el desempate mirara el id en vez del `seq`, devolvería a M(3) primero; C.5.b.2 exige
    // devolver primero al más RECIENTE, que aquí es M(1).
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 0 }]),
      grants([
        { from: 1, to: 0, seq: 11 },
        { from: 2, to: 0, seq: 3 },
        { from: 3, to: 0, seq: 7 },
      ]),
      CLOSES_AT,
    );
    // weightOf(0) sería 4 (1 + 3 carried); cap 2 ⇒ se devuelven 2, en orden de `seq` descendente.
    expect(resolution.returnedByCap).toEqual([M(1), M(3)]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `unassigned` sale ordenado, aunque cada motivo se añada en un PASO distinto
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('`unassigned` — el orden final es por miembro, no por el PASO que lo añadió', () => {
  it('un motivo añadido en el PASO 5 (cap-returned) no queda al final del arreglo', async () => {
    const config = await configFor(await buildElectorate(20)); // cap 2
    // M(1)/M(2) se resuelven y uno se devuelve por tope en el PASO 5 (al final, en inserción); los
    // demás miembros sin delegación se añaden antes, en el PASO 3, en orden de padrón. El resultado
    // final tiene que quedar ORDENADO por id, no en el orden en que cada PASO empujó su motivo.
    const resolution = resolveDelegation(
      config,
      ballots([{ voter: 0 }]),
      grants([
        { from: 1, to: 0, seq: 5 },
        { from: 2, to: 0, seq: 5 },
      ]),
      CLOSES_AT,
    );
    const orden = resolution.unassigned.map((u) => u.member);
    expect(orden).toEqual([...orden].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    // Y de verdad hay una entrada de cap-returned mezclada entre las de no-delegation: si no lo
    // estuviera, la prueba de arriba pasaría trivialmente sin probar nada.
    expect(resolution.unassigned.some((u) => u.reason === 'cap-returned')).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `delegationWeightResolver` — su propio filtro (no sólo el PASO 1 de `resolveDelegation`)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('`delegationWeightResolver` descarta lo que el PASO 1 ya descartó', () => {
  it('una papeleta de quien el PASO 1 excluyó no aparece en las `EffectiveBallot[]`', async () => {
    const config = await configFor(await buildElectorate(20));
    // M(99) no está en el padrón: `resolveDelegation` nunca la pone en `weightOf`, y el resolutor
    // tiene que respetar esa ausencia y no colarla con un peso inventado.
    const cast = ballots([{ voter: 0 }, { voter: 99 }]);
    const effective = delegationWeightResolver([])(config, cast, CLOSES_AT);
    expect(effective.map((b) => b.voter)).toEqual([M(0)]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// EX ANTE — `assertDelegationGrantable`, probado directamente contra el dominio
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('EX ANTE — `assertDelegationGrantable`', () => {
  it('DELEGATION_DISABLED: no se concede sobre una decisión abierta sin delegación (INV-32)', async () => {
    const config = await configFor(await buildElectorate(20), { enabled: false });
    const error = rejects(() => {
      assertDelegationGrantable(config, [], grant({ from: 0, to: 1 }, 0));
    });
    expect(error.code).toBe('DELEGATION_DISABLED');
    expect(error.message).toBe(
      'esta decisión se abrió sin delegación: aceptar la concesión y no resolverla haría que un ' +
        'voto delegado simplemente no existiera (INV-32)',
    );
  });

  it('SELF_DELEGATION: delegar en uno mismo no es delegar', async () => {
    const config = await configFor(await buildElectorate(20));
    const error = rejects(() => {
      assertDelegationGrantable(config, [], grant({ from: 0, to: 0 }, 0));
    });
    expect(error.code).toBe('SELF_DELEGATION');
    expect(error.message).toBe('delegar en uno mismo no es delegar: si querés votar, votá');
  });

  it('DELEGATOR_NOT_IN_CENSUS: quien no está en el padrón no tiene voto que delegar (A.1)', async () => {
    const config = await configFor(await buildElectorate(20));
    const error = rejects(() => {
      assertDelegationGrantable(config, [], grant({ from: 999, to: 0 }, 0));
    });
    expect(error.code).toBe('DELEGATOR_NOT_IN_CENSUS');
    expect(error.message).toBe(
      'quien no está en el padrón congelado no tiene voto que delegar (A.1)',
    );
  });

  it('DELEGATE_NOT_IN_CENSUS: no se delega en quien no está en el padrón', async () => {
    const config = await configFor(await buildElectorate(20));
    const error = rejects(() => {
      assertDelegationGrantable(config, [], grant({ from: 0, to: 999 }, 0));
    });
    expect(error.code).toBe('DELEGATE_NOT_IN_CENSUS');
    expect(error.message).toBe(
      'no se delega en quien no está en el padrón congelado: la arista nacería muerta (C.3 PASO 2)',
    );
  });

  it('DUPLICATE_DELEGATION: el mismo `delegationId` no entra dos veces al log', async () => {
    const config = await configFor(await buildElectorate(20));
    const existente = grant({ from: 0, to: 1 }, 7);
    // Mismo índice ⇒ mismo `delegationId`; otro delegante y delegado por completo.
    const candidata = grant({ from: 2, to: 3 }, 7);
    const error = rejects(() => {
      assertDelegationGrantable(config, [existente], candidata);
    });
    expect(error.code).toBe('DUPLICATE_DELEGATION');
    expect(error.message).toBe(`la delegación ${candidata.delegationId} ya existe en este log`);
  });

  it('DELEGATION_BORN_REVOKED: una concesión no trae ya su propia revocación', async () => {
    const config = await configFor(await buildElectorate(20));
    const candidata = grant({ from: 0, to: 1, revokedAt: instant(T0) }, 0);
    const error = rejects(() => {
      assertDelegationGrantable(config, [], candidata);
    });
    expect(error.code).toBe('DELEGATION_BORN_REVOKED');
    expect(error.message).toBe(
      'una concesión no puede traer ya su propia revocación: revocar es un acto posterior y propio',
    );
  });

  it('DELEGATION_EXPIRY_INVALID: la vigencia tiene que ser un intervalo no vacío (C.1.a)', async () => {
    const config = await configFor(await buildElectorate(20));
    const at = instant(T0);
    const candidata = grant({ from: 0, to: 1, at, expiresAt: at }, 0); // vacío: expiresAt === grantedAt
    const error = rejects(() => {
      assertDelegationGrantable(config, [], candidata);
    });
    expect(error.code).toBe('DELEGATION_EXPIRY_INVALID');
    expect(error.message).toBe(
      'la vigencia debe ser un intervalo no vacío: `grantedAt < expiresAt` (C.1.a)',
    );
  });

  it('DELEGATION_VALIDITY_EXCEEDED: no hay delegación perpetua, el tope es un semestre', async () => {
    const config = await configFor(await buildElectorate(20));
    const at = instant(T0);
    const candidata = grant({ from: 0, to: 1, at, expiresAt: instant(at + SEMESTER + 1) }, 0);
    const error = rejects(() => {
      assertDelegationGrantable(config, [], candidata);
    });
    expect(error.code).toBe('DELEGATION_VALIDITY_EXCEEDED');
    expect(error.message).toBe(
      'no existe la delegación perpetua: la vigencia máxima es un semestre y la renovación es ' +
        'explícita, jamás automática (C.1.a)',
    );
  });

  it('DELEGATION_WOULD_CREATE_CYCLE: nadie de los dos votaría (C.4.a)', async () => {
    const config = await configFor(await buildElectorate(20));
    const existentes = grants([{ from: 1, to: 0, at: instant(T0) }]);
    const candidata = grant({ from: 0, to: 1, at: instant(T0 + 1000) }, 1);
    const error = rejects(() => {
      assertDelegationGrantable(config, existentes, candidata);
    });
    expect(error.code).toBe('DELEGATION_WOULD_CREATE_CYCLE');
    expect(error.message).toBe(
      'esa persona ya te delega a vos (directamente o a través de una cadena): si delegás en ' +
        'ella, ninguno de los dos votaría (C.4.a)',
    );
  });

  it('DELEGATION_CAP_REACHED: dice a cuántos representaría YA, el tope y el censo exactos', async () => {
    const config = await configFor(await buildElectorate(20)); // cap 1/10 ⇒ 2
    const existentes = grants([{ from: 1, to: 0, seq: 1 }]);
    const candidata = grant({ from: 2, to: 0, seq: 2 }, 1);
    const error = rejects(() => {
      assertDelegationGrantable(config, existentes, candidata);
    });
    expect(error.code).toBe('DELEGATION_CAP_REACHED');
    expect(error.message).toBe(
      'esa persona ya representaría a 2 miembros y el tope de concentración es 2 votos sobre un ' +
        'censo de 20 (C.5)',
    );
  });

  it('una concesión que cumple todo no lanza nada', async () => {
    const config = await configFor(await buildElectorate(20));
    expect(() => {
      assertDelegationGrantable(config, [], grant({ from: 0, to: 1 }, 0));
    }).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// EX ANTE — `assertDelegationRevocable` y `revokeIn`
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('EX ANTE — `assertDelegationRevocable`', () => {
  it('UNKNOWN_DELEGATION: no se revoca lo que no existe en el log', () => {
    const idInexistente = delegationId(hex32(0xf000));
    const error = rejects(() => assertDelegationRevocable([], idInexistente, instant(T0)));
    expect(error.code).toBe('UNKNOWN_DELEGATION');
    expect(error.message).toBe(`la delegación ${idInexistente} no existe en este log`);
  });

  it('DELEGATION_ALREADY_REVOKED: no se revoca dos veces', () => {
    const revocada = grant({ from: 0, to: 1, revokedAt: instant(T0 + 500) }, 0);
    const error = rejects(() =>
      assertDelegationRevocable([revocada], revocada.delegationId, instant(T0 + 900)),
    );
    expect(error.code).toBe('DELEGATION_ALREADY_REVOKED');
    expect(error.message).toBe(
      `la delegación ${revocada.delegationId} ya fue revocada en ${String(revocada.revokedAt)}`,
    );
  });

  it('DELEGATION_REVOKED_BEFORE_GRANT: no se revoca un mandato antes de haberlo dado', () => {
    const vigente = grant({ from: 0, to: 1, at: instant(T0) }, 0);
    const error = rejects(() =>
      assertDelegationRevocable([vigente], vigente.delegationId, vigente.grantedAt),
    );
    expect(error.code).toBe('DELEGATION_REVOKED_BEFORE_GRANT');
    expect(error.message).toBe('no se revoca un mandato antes de haberlo dado');
  });

  it('una revocación válida devuelve la delegación encontrada', () => {
    const vigente = grant({ from: 0, to: 1, at: instant(T0) }, 0);
    expect(assertDelegationRevocable([vigente], vigente.delegationId, instant(T0 + 10))).toBe(
      vigente,
    );
  });
});

describe('`revokeIn` — aplica la revocación sin mutar el registro recibido', () => {
  it('marca sólo la delegación indicada; el resto queda intacto, y el arreglo original también', () => {
    const original = grants([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
    const objetivo = original[0]!;
    const otra = original[1]!;
    const at = instant(T0 + 1000);
    const resultado = revokeIn(original, objetivo.delegationId, at);

    expect(resultado.find((d) => d.delegationId === objetivo.delegationId)?.revokedAt).toBe(at);
    expect(resultado.find((d) => d.delegationId === otra.delegationId)?.revokedAt).toBeUndefined();
    // El arreglo ORIGINAL no se tocó: ninguna de sus entradas quedó con `revokedAt`.
    expect(original.every((d) => d.revokedAt === undefined)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `hasActiveDelegationsFor`, `vigentDelegations` y `delegationSlot`
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('`hasActiveDelegationsFor` — ¿hay alguna vigente en el ámbito de ESTA decisión? (ADR-0030)', () => {
  it('sin ninguna delegación, `false`', async () => {
    const config = await configFor(await buildElectorate(20));
    expect(hasActiveDelegationsFor(config, [], instant(T0 + 1))).toBe(false);
  });

  it('con una vigente EN el ámbito, `true`', async () => {
    const config = await configFor(await buildElectorate(20), { topics: [TOPIC_A] });
    const delegaciones = grants([{ from: 0, to: 1, scope: ON_TOPIC_A, at: instant(T0) }]);
    expect(hasActiveDelegationsFor(config, delegaciones, instant(T0 + 1))).toBe(true);
  });

  it('con una vigente pero FUERA del ámbito (otro tema), `false`', async () => {
    const config = await configFor(await buildElectorate(20), { topics: [TOPIC_A] });
    const delegaciones = grants([
      { from: 0, to: 1, scope: { kind: 'topic', topicId: TOPIC_B }, at: instant(T0) },
    ]);
    expect(hasActiveDelegationsFor(config, delegaciones, instant(T0 + 1))).toBe(false);
  });
});

describe('`assertNoDelegationInSecretBallot` — la compuerta dura de ADR-0030 / C.7.a', () => {
  it('fuera del voto secreto, no comprueba nada: nunca lanza', async () => {
    const config = await configFor(await buildElectorate(20));
    expect(config.privacy).not.toBe('secret-ballot');
    expect(() => {
      assertNoDelegationInSecretBallot(config, grants([{ from: 0, to: 1 }]), instant(T0 + 1));
    }).not.toThrow();
  });

  it('SECRET_BALLOT_WITH_DELEGATION: secreto con `delegation.enabled` es la puerta trasera del ADR', async () => {
    const config = {
      ...(await configFor(await buildElectorate(20))),
      privacy: 'secret-ballot' as const,
    };
    const error = rejects(() => {
      assertNoDelegationInSecretBallot(config, [], instant(T0 + 1));
    });
    expect(error.code).toBe('SECRET_BALLOT_WITH_DELEGATION');
    expect(error.message).toBe(
      'un voto secreto con delegación es un voto secreto con una puerta trasera pública y ' +
        'verificable: al coaccionador le basta con exigirte que delegues en él (C.7.a / ADR-0030)',
    );
  });

  it('SECRET_BALLOT_WITH_ACTIVE_DELEGATIONS: la forma FUERTE, con el conteo exacto de vigentes', async () => {
    const base = await configFor(await buildElectorate(20), { enabled: false });
    const config = { ...base, privacy: 'secret-ballot' as const };
    const delegaciones = grants([{ from: 0, to: 1, at: instant(T0) }]);
    const error = rejects(() => {
      assertNoDelegationInSecretBallot(config, delegaciones, instant(T0 + 1));
    });
    expect(error.code).toBe('SECRET_BALLOT_WITH_ACTIVE_DELEGATIONS');
    expect(error.message).toBe(
      'hay 1 delegación(es) vigentes en el ámbito de esta decisión y el voto es secreto: no se ' +
        'abre con la delegación inerte —quien delegó creería haber participado sin haberlo ' +
        'hecho—; hay que avisar a esas personas de que voten en persona (ADR-0030)',
    );
  });

  it('secreto, sin delegación habilitada y sin ninguna vigente: se reduce a C.7.a, no lanza', async () => {
    const base = await configFor(await buildElectorate(20), { enabled: false });
    const config = { ...base, privacy: 'secret-ballot' as const };
    expect(() => {
      assertNoDelegationInSecretBallot(config, [], instant(T0 + 1));
    }).not.toThrow();
  });
});

describe('`vigentDelegations` — para el registro público de C.7.b, sin filtrar por ámbito', () => {
  it('sólo las vigentes en `at`, sean del ámbito que sean', () => {
    const vigente = grant({ from: 0, to: 1, scope: ON_TOPIC_A, at: instant(T0) }, 0);
    const caducada = grant({ from: 2, to: 3, at: instant(T0), expiresAt: instant(T0 + 100) }, 1);
    const resultado = vigentDelegations([vigente, caducada], instant(T0 + 200));
    expect(resultado).toEqual([vigente]);
  });
});

describe('`delegationSlot` — la casilla `(delegante, ámbito)` en forma de texto', () => {
  it('combina el delegante y la clave de ámbito con `|`', () => {
    const global = grant({ from: 0, to: 1, scope: GLOBAL }, 0);
    expect(delegationSlot(global)).toBe(`${M(0)}|global`);
    const enTema = grant({ from: 0, to: 1, scope: ON_TOPIC_A }, 1);
    expect(delegationSlot(enTema)).toBe(`${M(0)}|topic:${TOPIC_A}`);
  });
});
