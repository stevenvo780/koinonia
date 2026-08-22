/**
 * PARTE E, sección E.4 — los invariantes de la democracia líquida como property-based tests.
 *
 * Cubre INV-21 a INV-33, que la suite de `invariants.test.ts` declaraba ausentes «porque su código
 * no existe todavía». Ahora existe.
 *
 * La semilla está fijada en `30_000_821`, como el resto del repositorio: un contraejemplo se
 * reproduce entre ejecuciones y entre máquinas. El número de corridas escala con `FC_RUNS`.
 *
 * ═══ Por qué los generadores construyen grafos ACÍCLICOS por defecto ═══
 *
 * `arbAcyclicGraph` sólo emite aristas `i → j` con `j < i`, que es exactamente el orden topológico
 * del padrón: por construcción no puede haber ciclos. Es el grafo que el motor produce, porque
 * `wouldCreateCycle` los previene al conceder. Los ciclos se inyectan **aparte** y a propósito
 * (`arbGraphWithCycle`), para probar la red de seguridad del escrutinio, que es la única defensa
 * frente a un log fabricado a mano.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  type Ballot,
  type BallotId,
  buildDecisionConfig,
  capWeight,
  concentrationReport,
  type DecisionConfig,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DEFAULT_EARLY_CLOSE,
  DELEGATION_ENABLED,
  type Delegation,
  type DelegationScope,
  delegationId,
  delegationWeightResolver,
  type EffectiveBallot,
  ENGINE_VERSION,
  instant,
  type MemberId,
  normalizedHerfindahl,
  ratio,
  resolveDelegation,
  tallyDecision,
  toFractionString,
  topicId,
  type TopicId,
  validateDecisionConfig,
} from '../../src/index.js';
import {
  buildElectorate,
  CIRCLE_MAIN,
  CIRCLE_OTHER,
  CLOSES_AT,
  DECISION_ID,
  DEFAULT_WINDOW,
  FC,
  hex32,
  memberIdAt,
  NO_QUORUM,
  OPTION_MAIN,
  PROPOSAL_ID,
  PROPOSAL_V1,
  runs,
  SEED_COMMITMENT,
  T0,
} from '../arbitraries.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escenario
// ═════════════════════════════════════════════════════════════════════════════════════════════

const SEMESTER = 180 * 24 * 60 * 60 * 1000;
const TOPIC_A: TopicId = topicId(hex32(0x8000));
const TOPIC_B: TopicId = topicId(hex32(0x8001));

const M = memberIdAt;

/** Censo mínimo para que `⌊1/10 · N⌋ ≥ 2`, que es lo que la configuración exige (C.5). */
const MIN_MEMBERS = 20;
const MAX_MEMBERS = 60;

const SCOPES: readonly DelegationScope[] = [
  { kind: 'global' },
  { kind: 'circle', circleId: CIRCLE_MAIN },
  { kind: 'circle', circleId: CIRCLE_OTHER },
  { kind: 'topic', topicId: TOPIC_A },
  { kind: 'topic', topicId: TOPIC_B },
];

async function scenarioConfig(
  members: number,
  options: { readonly maxDepth?: number; readonly cap?: { num: bigint; den: bigint } } = {},
): Promise<DecisionConfig> {
  return buildDecisionConfig({
    decisionId: DECISION_ID,
    proposalId: PROPOSAL_ID,
    proposalVersionHash: PROPOSAL_V1,
    circleId: CIRCLE_MAIN,
    topics: [TOPIC_A, TOPIC_B],
    options: [OPTION_MAIN],
    electorate: await buildElectorate(members),
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
      ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
      ...(options.cap === undefined ? {} : { cap: options.cap }),
    },
    seedCommitment: SEED_COMMITMENT,
    engineVersion: ENGINE_VERSION,
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Generadores
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface EdgePlan {
  readonly from: number;
  readonly to: number;
  readonly scope: number;
  readonly revoked: boolean;
  readonly expired: boolean;
}

/** Aristas `i → j` con `j < i`: orden topológico del padrón ⇒ imposible que haya ciclo. */
function arbAcyclicGraph(members: number): fc.Arbitrary<readonly EdgePlan[]> {
  return fc
    .uniqueArray(fc.integer({ min: 1, max: members - 1 }), { maxLength: members - 1 })
    .chain((froms) =>
      fc
        .tuple(
          fc.array(fc.integer({ min: 0, max: members - 2 }), {
            minLength: froms.length,
            maxLength: froms.length,
          }),
          fc.array(fc.integer({ min: 0, max: SCOPES.length - 1 }), {
            minLength: froms.length,
            maxLength: froms.length,
          }),
          fc.array(fc.boolean(), { minLength: froms.length, maxLength: froms.length }),
          fc.array(fc.boolean(), { minLength: froms.length, maxLength: froms.length }),
        )
        .map(([tos, scopes, revoked, expired]) =>
          froms.map((from, i) => ({
            from,
            to: (tos[i] ?? 0) % from, // estrictamente menor que `from`
            scope: scopes[i] ?? 0,
            revoked: revoked[i] ?? false,
            expired: expired[i] ?? false,
          })),
        ),
    );
}

/** Un grafo con al menos un ciclo inyectado a mano. Sólo alcanzable por un log manipulado. */
function arbGraphWithCycle(members: number): fc.Arbitrary<readonly EdgePlan[]> {
  return fc
    .tuple(
      arbAcyclicGraph(members),
      fc.integer({ min: 2, max: Math.min(6, members - 1) }),
      fc.integer({ min: 0, max: SCOPES.length - 1 }),
    )
    .map(([base, size, scope]) => {
      // Ciclo `0 → 1 → … → size-1 → 0`, que pisa (y reemplaza) las aristas de esos nodos.
      const cycle: EdgePlan[] = Array.from({ length: size }, (_, i) => ({
        from: i,
        to: (i + 1) % size,
        scope,
        revoked: false,
        expired: false,
      }));
      return [...base.filter((e) => e.from >= size), ...cycle];
    });
}

function toDelegations(plans: readonly EdgePlan[]): readonly Delegation[] {
  return plans.map((plan, i) => {
    const grantedAt = instant(T0 - 500_000 + i);
    return {
      delegationId: delegationId(hex32(0x7000 + i)),
      delegator: M(plan.from),
      delegate: M(plan.to),
      scope: SCOPES[plan.scope % SCOPES.length] ?? { kind: 'global' },
      grantedAt,
      expiresAt: plan.expired ? instant(T0 + 1000) : instant(grantedAt + SEMESTER),
      ...(plan.revoked ? { revokedAt: instant(T0 + 2000) } : {}),
      grantedSeq: i + 1,
    };
  });
}

function toBallots(voters: readonly number[], approvals: readonly boolean[]): readonly Ballot[] {
  return voters.map((voterIndex, i) => ({
    ballotId: hex32(0x5000 + i) as BallotId,
    decisionId: DECISION_ID,
    voter: M(voterIndex),
    round: 1,
    payload: { kind: 'binary' as const, approve: approvals[i] ?? true },
    castAt: instant(T0 + 10_000 + i),
    seq: 100 + i,
    proposalVersionHash: PROPOSAL_V1,
  }));
}

function arbVoters(members: number): fc.Arbitrary<readonly number[]> {
  return fc.uniqueArray(fc.integer({ min: 0, max: members - 1 }), { maxLength: members });
}

const arbMembers = fc.integer({ min: MIN_MEMBERS, max: MAX_MEMBERS });

/** Escenario completo: censo, grafo y votantes. */
function arbScenario(
  graphOf: (members: number) => fc.Arbitrary<readonly EdgePlan[]> = arbAcyclicGraph,
): fc.Arbitrary<{
  readonly members: number;
  readonly plans: readonly EdgePlan[];
  readonly voters: readonly number[];
  readonly approvals: readonly boolean[];
}> {
  return arbMembers.chain((members) =>
    fc
      .tuple(
        graphOf(members),
        arbVoters(members),
        fc.array(fc.boolean(), { minLength: members, maxLength: members }),
      )
      .map(([plans, voters, approvals]) => ({ members, plans, voters, approvals })),
  );
}

async function resolveScenario(scenario: {
  readonly members: number;
  readonly plans: readonly EdgePlan[];
  readonly voters: readonly number[];
  readonly approvals: readonly boolean[];
}) {
  const config = await scenarioConfig(scenario.members);
  const ballots = toBallots(scenario.voters, scenario.approvals);
  const delegations = toDelegations(scenario.plans);
  return {
    config,
    ballots,
    delegations,
    resolution: resolveDelegation(config, ballots, delegations, CLOSES_AT),
    effective: delegationWeightResolver(delegations)(config, ballots, CLOSES_AT),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-21 / INV-22 — el peso total y la disyunción
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E.4 — pesos y delegación', () => {
  it('INV-21 — la suma de pesos nunca excede el padrón congelado', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(), async (scenario) => {
        const { config, effective } = await resolveScenario(scenario);
        const total = effective.reduce((sum, b) => sum + b.weight, 0);
        expect(total).toBeLessThanOrEqual(config.electorate.censusSize);
      }),
      runs(300),
    );
  });

  it('INV-22 — cada miembro contribuye a lo sumo a UNA papeleta, y siempre está en el padrón', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(), async (scenario) => {
        const { config, effective } = await resolveScenario(scenario);
        const census = new Set<MemberId>(config.electorate.members.map((m) => m.memberId));
        const seen = new Set<MemberId>();
        for (const ballot of effective) {
          for (const member of [ballot.voter, ...ballot.onBehalfOf]) {
            expect(census.has(member)).toBe(true);
            expect(seen.has(member)).toBe(false);
            seen.add(member);
          }
        }
        // Y el peso es exactamente el tamaño del conjunto que representa.
        for (const ballot of effective) {
          expect(ballot.weight).toBe(1 + ballot.onBehalfOf.length);
        }
      }),
      runs(300),
    );
  });

  it('INV-21/22 — los pesos son enteros ≥ 1 y las papeletas salen en orden de padrón', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(), async (scenario) => {
        const { effective } = await resolveScenario(scenario);
        for (const ballot of effective) {
          expect(Number.isSafeInteger(ballot.weight)).toBe(true);
          expect(ballot.weight).toBeGreaterThanOrEqual(1);
        }
        const voters = effective.map((b) => b.voter);
        expect([...voters].sort()).toEqual(voters);
      }),
      runs(200),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-23 — el voto directo anula la delegación
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-23 — el voto directo anula la delegación, sin importar el orden temporal', () => {
  it('quien vota directo pesa ≥ 1 y no aparece en `onBehalfOf` de nadie', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(), async (scenario) => {
        const { effective } = await resolveScenario(scenario);
        const directos = new Set<MemberId>(scenario.voters.map(M));
        for (const ballot of effective) {
          expect(ballot.weight).toBeGreaterThanOrEqual(1);
          for (const representado of ballot.onBehalfOf) {
            expect(directos.has(representado)).toBe(false);
          }
        }
      }),
      runs(300),
    );
  });

  it('las 3! intercalaciones de (delegar, votar delegado, votar delegante) dan el MISMO peso', async () => {
    // El fallo ingenuo del invariante es «congelar» el peso del delegado al emitir: entonces el
    // voto directo posterior duplicaría el peso del delegante, contándolo en las dos papeletas.
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: MIN_MEMBERS, max: MAX_MEMBERS }),
        fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 3, maxLength: 3 }),
        async (members, tiempos) => {
          const config = await scenarioConfig(members);
          const [tDeleg = 0, tDelegado = 1, tDelegante = 2] = tiempos;
          const delegations: readonly Delegation[] = [
            {
              delegationId: delegationId(hex32(0x7000)),
              delegator: M(0),
              delegate: M(1),
              scope: { kind: 'global' },
              grantedAt: instant(T0 + 1000 + tDeleg),
              expiresAt: instant(T0 + SEMESTER),
              grantedSeq: 1,
            },
          ];
          const ballots: readonly Ballot[] = [
            {
              ballotId: hex32(0x5001) as BallotId,
              decisionId: DECISION_ID,
              voter: M(1),
              round: 1,
              payload: { kind: 'binary', approve: true },
              castAt: instant(T0 + 1000 + tDelegado),
              seq: 10,
              proposalVersionHash: PROPOSAL_V1,
            },
            {
              ballotId: hex32(0x5002) as BallotId,
              decisionId: DECISION_ID,
              voter: M(0),
              round: 1,
              payload: { kind: 'binary', approve: false },
              castAt: instant(T0 + 1000 + tDelegante),
              seq: 11,
              proposalVersionHash: PROPOSAL_V1,
            },
          ];
          const effective = delegationWeightResolver(delegations)(config, ballots, CLOSES_AT);
          // Sea cual sea el orden: dos papeletas de peso 1 cada una.
          expect(effective.map((b) => b.weight)).toEqual([1, 1]);
          expect(effective.every((b) => b.onBehalfOf.length === 0)).toBe(true);
        },
      ),
      runs(200),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-24 / INV-29 — revocación y caducidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-24 / INV-29 — una delegación revocada o caducada deja de aplicar, siempre', () => {
  it('la frontera de la revocación es `closedAt`: en él ya no aplica; un ms después, sí', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, fc.integer({ min: -1, max: 1 }), async (members, delta) => {
        const config = await scenarioConfig(members);
        const revokedAt = instant(CLOSES_AT + delta);
        const delegations: readonly Delegation[] = [
          {
            delegationId: delegationId(hex32(0x7000)),
            delegator: M(0),
            delegate: M(1),
            scope: { kind: 'global' },
            grantedAt: instant(T0 + 1),
            expiresAt: instant(T0 + SEMESTER),
            revokedAt,
            grantedSeq: 1,
          },
        ];
        const effective = delegationWeightResolver(delegations)(
          config,
          toBallots([1], [true]),
          CLOSES_AT,
        );
        expect(effective[0]?.weight).toBe(delta > 0 ? 2 : 1);
      }),
      runs(150),
    );
  });

  it('la frontera de la caducidad es `closedAt`, con el mismo signo', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, fc.integer({ min: -1, max: 1 }), async (members, delta) => {
        const config = await scenarioConfig(members);
        const delegations: readonly Delegation[] = [
          {
            delegationId: delegationId(hex32(0x7000)),
            delegator: M(0),
            delegate: M(1),
            scope: { kind: 'global' },
            grantedAt: instant(T0 + 1),
            expiresAt: instant(CLOSES_AT + delta),
            grantedSeq: 1,
          },
        ];
        const effective = delegationWeightResolver(delegations)(
          config,
          toBallots([1], [true]),
          CLOSES_AT,
        );
        expect(effective[0]?.weight).toBe(delta > 0 ? 2 : 1);
      }),
      runs(150),
    );
  });

  it('una delegación revocada NUNCA aporta peso, en ningún grafo', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(), async (scenario) => {
        const { resolution, delegations } = await resolveScenario(scenario);
        const muertas = new Set(
          delegations
            .filter(
              (d) =>
                (d.revokedAt !== undefined && d.revokedAt <= CLOSES_AT) || d.expiresAt <= CLOSES_AT,
            )
            .map((d) => d.delegationId),
        );
        for (const assignment of resolution.assignments) {
          expect(muertas.has(assignment.via)).toBe(false);
        }
      }),
      runs(300),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-25 / INV-26 — ciclos y profundidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-25 — ningún ciclo produce un voto contado dos veces ni una cadena infinita', () => {
  it('con ciclos inyectados el escrutinio termina y el peso total sigue acotado', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const { config, effective, resolution } = await resolveScenario(scenario);
        const total = effective.reduce((sum, b) => sum + b.weight, 0);
        expect(total).toBeLessThanOrEqual(config.electorate.censusSize);
        // Nadie del ciclo aporta peso a ninguna papeleta.
        const enCiclo = new Set(resolution.cycleMembers);
        for (const ballot of effective) {
          for (const representado of ballot.onBehalfOf) {
            expect(enCiclo.has(representado)).toBe(false);
          }
        }
      }),
      runs(300),
    );
  });

  it('el grafo RESUELTO no contiene ciclos: toda cadena asignada termina en su votante', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const { resolution } = await resolveScenario(scenario);
        const directos = new Set<MemberId>(scenario.voters.map(M));
        for (const assignment of resolution.assignments) {
          expect(directos.has(assignment.terminal)).toBe(true);
          // Se vuelve a recorrer la cadena a mano: no puede repetir nodo.
          const visitados = new Set<MemberId>([assignment.delegator]);
          let cursor: MemberId | undefined = resolution.edges.get(assignment.delegator);
          let pasos = 0;
          while (cursor !== undefined && !directos.has(cursor)) {
            expect(visitados.has(cursor)).toBe(false);
            visitados.add(cursor);
            cursor = resolution.edges.get(cursor);
            pasos += 1;
            expect(pasos).toBeLessThanOrEqual(assignment.hops);
          }
          expect(cursor).toBe(assignment.terminal);
        }
      }),
      runs(250),
    );
  });
});

describe('INV-26 — ninguna cadena efectiva excede `maxDepth`', () => {
  it('ninguna asignación supera la profundidad, y la excedida NO deposita el peso', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbScenario(arbGraphWithCycle),
        fc.integer({ min: 1, max: 6 }),
        async (scenario, maxDepth) => {
          const config = await scenarioConfig(scenario.members, { maxDepth });
          const delegations = toDelegations(scenario.plans);
          const ballots = toBallots(scenario.voters, scenario.approvals);
          const resolution = resolveDelegation(config, ballots, delegations, CLOSES_AT);
          for (const assignment of resolution.assignments) {
            expect(assignment.hops).toBeGreaterThanOrEqual(1);
            expect(assignment.hops).toBeLessThanOrEqual(maxDepth);
          }
          const truncados = resolution.unassigned
            .filter((u) => u.reason === 'depth-exceeded')
            .map((u) => u.member);
          const depositados = new Set(
            [...resolution.onBehalfOf.values()].flatMap((list) => [...list]),
          );
          for (const truncado of truncados) expect(depositados.has(truncado)).toBe(false);
        },
      ),
      runs(250),
    );
  });

  it('la cadena de longitud `maxDepth` pasa y la de `maxDepth + 1` no, para todo `maxDepth`', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (maxDepth) => {
        const config = await scenarioConfig(MAX_MEMBERS, { maxDepth });
        const cadena = (length: number): readonly Delegation[] =>
          Array.from({ length }, (_, i) => ({
            delegationId: delegationId(hex32(0x7000 + i)),
            delegator: M(i),
            delegate: M(i + 1),
            scope: { kind: 'global' },
            grantedAt: instant(T0 + 1 + i),
            expiresAt: instant(T0 + SEMESTER),
            grantedSeq: i + 1,
          }));

        const justa = resolveDelegation(
          config,
          toBallots([maxDepth], [true]),
          cadena(maxDepth),
          CLOSES_AT,
        );
        expect(justa.assignments.find((a) => a.delegator === M(0))?.hops).toBe(maxDepth);

        const larga = resolveDelegation(
          config,
          toBallots([maxDepth + 1], [true]),
          cadena(maxDepth + 1),
          CLOSES_AT,
        );
        expect(larga.unassigned.find((u) => u.member === M(0))?.reason).toBe('depth-exceeded');
      }),
      runs(120),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-27 / INV-28 — tope de concentración
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-27 — nadie supera el tope de votos delegados', () => {
  it('ninguna papeleta pesa más que ⌊cap·N⌋, en ningún grafo', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const { config, effective } = await resolveScenario(scenario);
        const cap = capWeight(config);
        for (const ballot of effective) expect(ballot.weight).toBeLessThanOrEqual(cap);
      }),
      runs(300),
    );
  });

  it('tampoco con una estrella entera delegando en la misma persona', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, async (members) => {
        const config = await scenarioConfig(members);
        const delegations: readonly Delegation[] = Array.from({ length: members - 1 }, (_, i) => ({
          delegationId: delegationId(hex32(0x7000 + i)),
          delegator: M(i + 1),
          delegate: M(0),
          scope: { kind: 'global' },
          grantedAt: instant(T0 + 1 + i),
          expiresAt: instant(T0 + SEMESTER),
          grantedSeq: i + 1,
        }));
        const effective = delegationWeightResolver(delegations)(
          config,
          toBallots([0], [true]),
          CLOSES_AT,
        );
        expect(effective[0]?.weight).toBe(capWeight(config));
      }),
      runs(150),
    );
  });
});

describe('INV-28 — la devolución por tope es determinista y LIFO', () => {
  it('no depende del orden en que llegan delegaciones NO relacionadas', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbScenario(),
        fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 60 }),
        async (scenario, claves) => {
          const { config, ballots, delegations, resolution } = await resolveScenario(scenario);
          // Se baraja el ARREGLO sin tocar `grantedSeq`: sólo cambia el orden de llegada.
          const barajadas = delegations
            .map((d, i) => ({ d, k: claves[i] ?? i }))
            .sort((a, b) => a.k - b.k)
            .map((entry) => entry.d);
          const otra = resolveDelegation(config, ballots, barajadas, CLOSES_AT);
          expect(otra.returnedByCap).toEqual(resolution.returnedByCap);
          expect([...otra.weightOf.entries()].sort()).toEqual(
            [...resolution.weightOf.entries()].sort(),
          );
        },
      ),
      runs(250),
    );
  });

  it('se devuelven exactamente las de MAYOR `grantedSeq` hacia ese delegado', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, async (members) => {
        const config = await scenarioConfig(members);
        const cap = capWeight(config);
        const cuantos = Math.min(members - 1, cap + 3);
        const delegations: readonly Delegation[] = Array.from({ length: cuantos }, (_, i) => ({
          delegationId: delegationId(hex32(0x7000 + i)),
          delegator: M(i + 1),
          delegate: M(0),
          scope: { kind: 'global' },
          grantedAt: instant(T0 + 1 + i),
          expiresAt: instant(T0 + SEMESTER),
          grantedSeq: i + 1,
        }));
        const resolution = resolveDelegation(
          config,
          toBallots([0], [true]),
          delegations,
          CLOSES_AT,
        );
        const sobreviven = cap - 1; // el peso propio ocupa un puesto
        const devueltos = new Set(resolution.returnedByCap);
        for (let i = 0; i < cuantos; i++) {
          // Los primeros `sobreviven` (menor `grantedSeq`) se quedan; el resto se devuelve.
          expect(devueltos.has(M(i + 1))).toBe(i >= sobreviven);
        }
      }),
      runs(150),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-30 — ámbito
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-30 — la delegación fuera de ámbito no aplica; la más específica gana', () => {
  it('con las tres especificidades activas, manda la de tema', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMembers,
        fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 3, maxLength: 3 }),
        async (members, seqs) => {
          const config = await scenarioConfig(members);
          const scopes: readonly DelegationScope[] = [
            { kind: 'topic', topicId: TOPIC_A },
            { kind: 'circle', circleId: CIRCLE_MAIN },
            { kind: 'global' },
          ];
          const delegations: readonly Delegation[] = scopes.map((scope, i) => ({
            delegationId: delegationId(hex32(0x7000 + i)),
            delegator: M(0),
            delegate: M(i + 1),
            scope,
            grantedAt: instant(T0 + 1 + i),
            expiresAt: instant(T0 + SEMESTER),
            grantedSeq: seqs[i] ?? i + 1,
          }));
          const resolution = resolveDelegation(
            config,
            toBallots([1, 2, 3], [true, true, true]),
            delegations,
            CLOSES_AT,
          );
          // Especificidad primero, recencia después: gana el tema aunque su `seq` sea el menor.
          expect(resolution.edges.get(M(0))).toBe(M(1));
        },
      ),
      runs(150),
    );
  });

  it('un ámbito que no casa con la decisión nunca produce arista', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(), async (scenario) => {
        const { config, resolution, delegations } = await resolveScenario(scenario);
        const topics = new Set(config.topics);
        for (const [delegator] of resolution.edges) {
          const usada = delegations.find(
            (d) =>
              d.delegator === delegator &&
              d.expiresAt > CLOSES_AT &&
              (d.revokedAt === undefined || d.revokedAt > CLOSES_AT),
          );
          expect(usada).toBeDefined();
        }
        // Ninguna arista puede venir de un ámbito ajeno.
        for (const [delegator, delegate] of resolution.edges) {
          const candidatas = delegations.filter(
            (d) =>
              d.delegator === delegator &&
              d.delegate === delegate &&
              (d.scope.kind === 'global' ||
                (d.scope.kind === 'circle' && d.scope.circleId === config.circleId) ||
                (d.scope.kind === 'topic' && topics.has(d.scope.topicId))),
          );
          expect(candidatas.length).toBeGreaterThan(0);
        }
      }),
      runs(250),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-31 — índices de concentración
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-31 — los índices de concentración están en rango y son EXACTOS', () => {
  it('`1/n ≤ HHI ≤ 1`, `0 ≤ HHI* ≤ 1`, `0 ≤ Gini < 1`', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const { config, effective } = await resolveScenario(scenario);
        fc.pre(effective.length > 0);
        const report = concentrationReport(effective, config.electorate.censusSize);
        const n = BigInt(effective.length);
        // 1/n ≤ HHI ≤ 1
        expect(report.hhi.num * n).toBeGreaterThanOrEqual(report.hhi.den);
        expect(report.hhi.num).toBeLessThanOrEqual(report.hhi.den);
        // 0 ≤ HHI* ≤ 1
        expect(report.normalizedHhi.num).toBeGreaterThanOrEqual(0n);
        expect(report.normalizedHhi.num).toBeLessThanOrEqual(report.normalizedHhi.den);
        // 0 ≤ Gini < 1
        expect(report.gini.num).toBeGreaterThanOrEqual(0n);
        expect(report.gini.num).toBeLessThan(report.gini.den);
      }),
      runs(300),
    );
  });

  it('el HHI de la `Proof` es RECOMPUTABLE desde las delegaciones vigentes', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(), async (scenario) => {
        const config = await scenarioConfig(scenario.members);
        const delegations = toDelegations(scenario.plans);
        const ballots = toBallots(scenario.voters, scenario.approvals);
        const result = await tallyDecision({
          config,
          ballots,
          closedAt: CLOSES_AT,
          computedFromSeq: 42,
          resolver: delegationWeightResolver(delegations),
        });
        const paso = result.proof.steps.find((s) => s.id === 'C1');
        expect(paso).toBeDefined();

        // Un auditor recomputa desde cero: resuelve el grafo y vuelve a calcular los índices.
        const recomputado = concentrationReport(
          delegationWeightResolver(delegations)(config, ballots, CLOSES_AT),
          config.electorate.censusSize,
        );
        expect(paso?.evidence['hhi']).toBe(toFractionString(recomputado.hhi));
        expect(paso?.evidence['hhiNormalizado']).toBe(toFractionString(recomputado.normalizedHhi));
        expect(paso?.evidence['cr1']).toBe(toFractionString(recomputado.cr1));
        expect(toFractionString(result.weights.hhi)).toBe(toFractionString(recomputado.hhi));
      }),
      runs(200),
    );
  });

  it('reparto uniforme ⇒ HHI* = 0 exacto, para todo `n`', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 30 }), (n, peso) => {
        const pesos = Array.from({ length: n }, () => peso);
        expect(toFractionString(normalizedHerfindahl(pesos))).toBe('0/1');
      }),
      FC,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-32 — voto secreto
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-32 / ADR-0030 — voto secreto y delegación son incompatibles por configuración', () => {
  it('abrir con `secret-ballot` y delegación SIEMPRE se rechaza', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, fc.integer({ min: 1, max: 6 }), async (members, maxDepth) => {
        const config = await scenarioConfig(members, { maxDepth });
        expect(() => {
          validateDecisionConfig({ ...config, privacy: 'secret-ballot' });
        }).toThrow(/SECRET_BALLOT_WITH_DELEGATION/u);
      }),
      runs(150),
    );
  });

  it('no se «desactiva en silencio»: con delegación apagada, la misma configuración se acepta', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, async (members) => {
        const config = await scenarioConfig(members);
        expect(() => {
          validateDecisionConfig({
            ...config,
            privacy: 'secret-ballot',
            delegation: { ...config.delegation, enabled: false },
          });
        }).not.toThrow();
      }),
      runs(120),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-33 — participación = personas representadas
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-33 — participación = personas representadas', () => {
  it('`|E| = Σ pesos = directos + delegantes con cadena terminada`', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const config = await scenarioConfig(scenario.members);
        const delegations = toDelegations(scenario.plans);
        const ballots = toBallots(scenario.voters, scenario.approvals);
        const result = await tallyDecision({
          config,
          ballots,
          closedAt: CLOSES_AT,
          computedFromSeq: 7,
          resolver: delegationWeightResolver(delegations),
        });
        const resolution = resolveDelegation(config, ballots, delegations, CLOSES_AT);
        const directos = resolution.weightOf.size;
        const delegantes = resolution.assignments.length;
        expect(result.turnout.represented).toBe(directos + delegantes);
        expect(result.weights.totalWeight).toBe(directos + delegantes);
        expect(result.turnout.represented).toBeLessThanOrEqual(config.electorate.censusSize);
      }),
      runs(250),
    );
  });

  it('quien queda sin asignar NO cuenta como participante', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const { config, effective, resolution } = await resolveScenario(scenario);
        const representados = new Set<MemberId>(
          effective.flatMap((b: EffectiveBallot) => [b.voter, ...b.onBehalfOf]),
        );
        for (const { member } of resolution.unassigned) {
          expect(representados.has(member)).toBe(false);
        }
        expect(representados.size + resolution.unassigned.length).toBe(
          config.electorate.censusSize,
        );
      }),
      runs(250),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Determinismo global
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el escrutinio delegado es una FUNCIÓN de (configuración, papeletas, delegaciones)', () => {
  it('dos resoluciones del mismo escenario producen el mismo `resultHash`', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const config = await scenarioConfig(scenario.members);
        const delegations = toDelegations(scenario.plans);
        const ballots = toBallots(scenario.voters, scenario.approvals);
        const input = {
          config,
          ballots,
          closedAt: CLOSES_AT,
          computedFromSeq: 3,
          resolver: delegationWeightResolver(delegations),
        };
        const uno = await tallyDecision(input);
        const dos = await tallyDecision({
          ...input,
          resolver: delegationWeightResolver([...delegations].reverse()),
        });
        expect(dos.resultHash).toBe(uno.resultHash);
      }),
      runs(150),
    );
  });

  it('el peso total contado nunca excede el padrón CONGELADO, ni con ciclos ni con topes', async () => {
    await fc.assert(
      fc.asyncProperty(arbScenario(arbGraphWithCycle), async (scenario) => {
        const { config, effective } = await resolveScenario(scenario);
        const total = effective.reduce((sum, b) => sum + b.weight, 0);
        expect(ratio(total, config.electorate.censusSize).num).toBeLessThanOrEqual(
          BigInt(config.electorate.censusSize),
        );
      }),
      runs(200),
    );
  });
});
