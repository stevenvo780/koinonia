/**
 * PARTE E — invariantes como property-based tests.
 *
 * Cada bloque lleva el identificador `INV-NN` de la especificación para que sea rastreable. Los que
 * dependen de la delegación (INV-23 a INV-30) y de los métodos de la entrega siguiente (INV-42 a
 * INV-51, INV-55 a INV-57) no están aquí porque su código no existe todavía: un invariante que
 * «pasa» sobre una implementación ausente es peor que uno que falta.
 *
 * La semilla de fast-check está fijada (`FC.seed`): un contraejemplo se reproduce entre ejecuciones.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertHardSecrecySupported,
  type Ballot,
  type BallotContext,
  type DecisionConfig,
  type DecisionResult,
  DECISION_EVENT_TYPES,
  effectiveBallots,
  gini,
  HardSecrecyUnsupported,
  herfindahl,
  instant,
  isBallotValid,
  isEligible,
  isLegalTransition,
  isTerminal,
  LIFECYCLE_STATUSES,
  nextStatus,
  peekTransition,
  ratio,
  representedMembers,
  tallyDecision,
  type TallyContext,
  totalWeight,
  validateDecisionConfig,
} from '../../src/index.js';
import {
  arbInvalidKind,
  arbMethodPlan,
  arbMonotoneMethodPlan,
  arbPermutation,
  arbPrivacy,
  arbThresholdMethodPlan,
  type BallotPlan,
  buildConfig,
  buildElectorate,
  CLOSES_AT,
  FC,
  makeBallots,
  makeInvalidBallot,
  runs,
  memberIdAt,
  type MethodPlan,
  planToMethod,
  resequence,
  T0,
  type Vote,
} from '../arbitraries.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Andamio
// ═════════════════════════════════════════════════════════════════════════════════════════════

const MAX_MEMBERS = 12;

function context(config: DecisionConfig): TallyContext & BallotContext {
  return {
    window: { opensAt: config.window.opensAt, closesAt: config.window.closesAt },
    round: 1,
    proposalVersionHash: config.proposalVersionHash,
    closedAt: config.window.closesAt,
    voided: [],
  };
}

async function scenarioConfig(
  memberCount: number,
  plan: MethodPlan,
  quorum?: DecisionConfig['quorum'],
): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(memberCount),
    method: planToMethod(plan),
    ...(quorum === undefined ? {} : { quorum }),
  });
}

async function tally(
  config: DecisionConfig,
  ballots: readonly Ballot[],
  computedFromSeq = ballots.length,
): Promise<DecisionResult> {
  return tallyDecision({ config, ballots, closedAt: config.window.closesAt, computedFromSeq });
}

/** Igualdad sustantiva: el desenlace y toda la aritmética que lo sostiene. */
function expectSameSubstance(a: DecisionResult, b: DecisionResult): void {
  expect(b.outcome).toEqual(a.outcome);
  expect(b.turnout).toEqual(a.turnout);
  expect(b.weights).toEqual(a.weights);
  expect(b.quorumCheck).toEqual(a.quorumCheck);
}

/** La demostración sin sus referencias al log: lo que una persona lee y verifica a mano. */
function proofSubstance(r: DecisionResult): unknown {
  return {
    narrative: r.proof.narrative,
    tables: r.proof.tables,
    steps: r.proof.steps.map((s) => ({ id: s.id, claim: s.claim, evidence: s.evidence })),
  };
}

function arbVotesFor(kind: MethodPlan['kind'], memberCount: number): fc.Arbitrary<readonly Vote[]> {
  const vote: fc.Arbitrary<Vote> =
    kind === 'sociocratic-consent'
      ? fc.constantFrom('consent', 'consent', 'concern', 'object')
      : fc.constantFrom('yes', 'no', 'abstain');
  return fc.array(vote, { maxLength: memberCount });
}

function plansFrom(votes: readonly Vote[]): readonly BallotPlan[] {
  return votes.map((vote, i) => ({ voterIndex: i, vote }));
}

const arbMembers = fc.integer({ min: 1, max: MAX_MEMBERS });

/* eslint-disable no-restricted-syntax --
 * `Date.now` está prohibido en `packages/domain` y con razón: el motor no puede leer el reloj. La
 * excepción se toma AQUÍ Y SÓLO AQUÍ, en el arnés de pruebas, porque la única forma de *demostrar*
 * que la implementación no lo lee es sustituirlo por un valor absurdo y comprobar que el resultado
 * no se mueve (INV-14, INV-15). La regla sigue vigente sobre `src/`, que es donde importa, y
 * `scripts/check-domain-purity.mjs` la comprueba aparte y sin excepciones. */
/** Sustituye el reloj del proceso y devuelve la función que lo restaura. */
function patchClock(value: number): () => void {
  const original = Date.now;
  Date.now = (): number => value;
  return (): void => {
    Date.now = original;
  };
}
/* eslint-enable no-restricted-syntax */

// ═════════════════════════════════════════════════════════════════════════════════════════════
// E.1 — Elegibilidad y padrón
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E.1 — elegibilidad y padrón', () => {
  it('INV-01 — un voto inválido nunca cambia el resultado', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMembers,
        arbMethodPlan,
        fc.array(arbInvalidKind, { minLength: 1, maxLength: 5 }),
        async (members, plan, invalidKinds) => {
          const config = await scenarioConfig(members, plan);
          const votes = Array.from({ length: members }, (_, i) =>
            plan.kind === 'sociocratic-consent'
              ? ((i % 3 === 0 ? 'consent' : i % 3 === 1 ? 'concern' : 'consent') as Vote)
              : ((i % 3 === 0 ? 'yes' : i % 3 === 1 ? 'no' : 'abstain') as Vote),
          );
          const clean = makeBallots(plansFrom(votes));
          const dirty = invalidKinds.map((kind, i) =>
            makeInvalidBallot(config, kind, 1000 + i, i % members),
          );

          const before = await tally(config, clean);
          const after = await tally(config, [...clean, ...dirty], clean.length + dirty.length);

          expectSameSubstance(before, after);
          // Sólo `computedFromSeq` puede diferir: es procedencia, no conclusión.
          expect(after.resultHash).toBe(before.resultHash);
          expect(after.computedFromSeq).not.toBe(before.computedFromSeq);
        },
      ),
      FC,
    );
  });

  it('INV-02 — un votante inelegible nunca cuenta', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMembers,
        arbMethodPlan,
        fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 6 }),
        async (members, plan, forasteros) => {
          const config = await scenarioConfig(members, plan);
          const validas = makeBallots(
            plansFrom(
              Array.from({ length: members }, () =>
                plan.kind === 'sociocratic-consent' ? 'consent' : 'yes',
              ),
            ),
          );
          const intrusos = forasteros.map((i) =>
            makeInvalidBallot(config, 'ineligible-voter', 2000 + i, i),
          );
          const efectivas = effectiveBallots(config, [...validas, ...intrusos], context(config));

          for (const efectiva of efectivas) {
            expect(isEligible(config.electorate, efectiva.voter)).toBe(true);
          }
          for (const intruso of intrusos) {
            expect(efectivas.some((b) => b.voter === intruso.voter)).toBe(false);
            expect(isBallotValid(config, intruso, context(config))).toBe(false);
          }
          expect(efectivas).toHaveLength(members);
        },
      ),
      FC,
    );
  });

  it('INV-03 — quien se matricula al abrir o después no aparece en el padrón congelado', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, fc.integer({ min: 0, max: 5 }), async (members, tardios) => {
        const electorate = await buildElectorate(members);
        // Los `tardios` se identifican fuera del rango del padrón: representan altas posteriores.
        for (let i = 0; i < tardios; i++) {
          expect(isEligible(electorate, memberIdAt(members + i))).toBe(false);
        }
        expect(electorate.censusSize).toBe(members);
        expect(electorate.frozenAt).toBe(T0);
      }),
      FC,
    );
  });

  it('INV-04 — el voto de quien luego se retira cuenta, y el censo no se mueve', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, arbThresholdMethodPlan, async (members, plan) => {
        const config = await scenarioConfig(members, plan);
        const ballots = makeBallots(plansFrom(Array.from({ length: members }, () => 'yes')));
        const result = await tally(config, ballots);
        // El escrutinio no consulta ningún registro vivo: el padrón congelado es el único hecho.
        expect(result.turnout.census).toBe(members);
        expect(result.turnout.represented).toBe(members);
        expect(result.rollHash).toBe(config.electorate.rollHash);
      }),
      FC,
    );
  });

  it('INV-05 — el conteo siempre corresponde al padrón congelado', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, arbMethodPlan, async (members, plan) => {
        const config = await scenarioConfig(members, plan);
        const votes = fc.sample(arbVotesFor(plan.kind, members), 1)[0];
        const ballots = makeBallots(plansFrom(votes ?? []));
        const result = await tally(config, ballots);
        expect(result.rollHash).toBe(config.electorate.rollHash);
        expect(result.turnout.census).toBe(config.electorate.censusSize);
        for (const b of effectiveBallots(config, ballots, context(config))) {
          expect(isEligible(config.electorate, b.voter)).toBe(true);
        }
      }),
      runs(300),
    );
  });

  it('INV-06 — el padrón está bien formado para cualquier tamaño', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 60 }), async (members) => {
        const electorate = await buildElectorate(members);
        expect(electorate.censusSize).toBe(electorate.members.length);
        const ids = electorate.members.map((m) => m.memberId);
        expect(ids).toEqual([...ids].sort());
        expect(new Set(ids).size).toBe(ids.length);
        expect(electorate.members.every((m) => m.baseWeight === 1)).toBe(true);
      }),
      runs(120),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// E.2 — Papeletas
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E.2 — papeletas', () => {
  it('INV-07 — idempotencia sobre la última papeleta', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        arbMethodPlan,
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 15 }),
        async (members, plan, indices) => {
          const config = await scenarioConfig(members, plan);
          const votos = arbVotesFor(plan.kind, 1);
          const plans: BallotPlan[] = indices.map((raw, i) => ({
            voterIndex: raw % members,
            vote:
              fc.sample(votos, { numRuns: 1, seed: i })[0]?.[0] ??
              (plan.kind === 'sociocratic-consent' ? 'consent' : 'yes'),
          }));
          const ballots = makeBallots(plans);

          // La reducción manual a «la última por votante» debe dar exactamente lo mismo.
          const ultimas = new Map<string, Ballot>();
          for (const b of ballots) {
            const previa = ultimas.get(b.voter);
            if (previa === undefined || b.seq > previa.seq) ultimas.set(b.voter, b);
          }
          const soloUltimas = ballots.filter((b) => ultimas.get(b.voter) === b);

          const conRepetidas = await tally(config, ballots, ballots.length);
          const sinRepetidas = await tally(config, soloUltimas, ballots.length);
          expectSameSubstance(conRepetidas, sinRepetidas);
          expect(sinRepetidas.resultHash).toBe(conRepetidas.resultHash);
        },
      ),
      runs(400),
    );
  });

  it('INV-08 — votar dos veces no produce dos votos válidos', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        arbMethodPlan,
        fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 20 }),
        async (members, plan, indices) => {
          const config = await scenarioConfig(members, plan);
          const vote: Vote = plan.kind === 'sociocratic-consent' ? 'consent' : 'yes';
          const plans = indices.map((raw) => ({ voterIndex: raw % members, vote }));
          const efectivas = effectiveBallots(config, makeBallots(plans), context(config));
          const votantes = efectivas.map((b) => b.voter);
          expect(new Set(votantes).size).toBe(votantes.length);
          expect(votantes).toEqual([...votantes].sort());
        },
      ),
      runs(400),
    );
  });

  it('INV-10 — una papeleta fuera de la ventana no cuenta (fronteras explícitas)', async () => {
    const config = await scenarioConfig(3, {
      kind: 'simple-majority',
      abstentionPolicy: 'exclude',
    });
    for (const [delta, esperado] of [
      [-1, false],
      [0, true],
    ] as const) {
      const [b] = makeBallots([{ voterIndex: 0, vote: 'yes' }]);
      if (b === undefined) throw new Error('sin papeleta');
      expect(isBallotValid(config, { ...b, castAt: instant(T0 + delta) }, context(config))).toBe(
        esperado,
      );
    }
    for (const [delta, esperado] of [
      [-1, true],
      [0, false],
      [1, false],
    ] as const) {
      const [b] = makeBallots([{ voterIndex: 0, vote: 'yes' }]);
      if (b === undefined) throw new Error('sin papeleta');
      expect(
        isBallotValid(config, { ...b, castAt: instant(CLOSES_AT + delta) }, context(config)),
      ).toBe(esperado);
    }
  });

  it('INV-11 — la abstención explícita nunca suma al numerador', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        arbThresholdMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'no'), { maxLength: 8 }),
        fc.integer({ min: 1, max: 4 }),
        async (members, plan, votos, abstenciones) => {
          fc.pre(votos.length + abstenciones <= members);
          const config = await scenarioConfig(members, plan);
          const conAbstenciones: readonly Vote[] = [
            ...votos,
            ...Array.from({ length: abstenciones }, (): Vote => 'abstain'),
          ];
          const sinAbstenciones = await tally(config, makeBallots(plansFrom(votos)));
          const con = await tally(config, makeBallots(plansFrom(conAbstenciones)));

          const aFavorDe = (r: DecisionResult): number =>
            Number(r.proof.steps.find((s) => s.id === 'S2')?.evidence['aFavor'] ?? -1);
          // El numerador no se mueve; el denominador puede hacerlo según la política.
          if (con.quorumCheck.passed && sinAbstenciones.quorumCheck.passed) {
            expect(aFavorDe(con)).toBe(aFavorDe(sinAbstenciones));
          }
        },
      ),
      runs(400),
    );
  });

  it('INV-12 — una papeleta de tipo incompatible se rechaza, no se convierte', async () => {
    await fc.assert(
      fc.asyncProperty(arbMethodPlan, fc.integer({ min: 1, max: 5 }), async (plan, members) => {
        const config = await scenarioConfig(members, plan);
        const incompatible = makeInvalidBallot(config, 'payload-kind-not-accepted', 1, 0);
        expect(isBallotValid(config, incompatible, context(config))).toBe(false);
        const efectivas = effectiveBallots(config, [incompatible], context(config));
        expect(efectivas).toHaveLength(0);
      }),
      runs(300),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// E.3 — Determinismo, orden y reproducibilidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E.3 — determinismo, orden y reproducibilidad', () => {
  it('INV-16 — conmutatividad del escrutinio: permutar la llegada no cambia el desenlace', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        arbMethodPlan,
        fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: 14 }),
        fc.integer({ min: 0, max: 10_000 }),
        async (members, plan, indices, semilla) => {
          const config = await scenarioConfig(members, plan);
          const opciones: readonly Vote[] =
            plan.kind === 'sociocratic-consent'
              ? ['consent', 'concern', 'object']
              : ['yes', 'no', 'abstain'];
          const plans: BallotPlan[] = indices.map((raw, i) => ({
            voterIndex: raw % members,
            vote: opciones[(raw + i + semilla) % opciones.length] ?? opciones[0]!,
          }));
          const ballots = makeBallots(plans);
          const permutacion = fc.sample(arbPermutation(ballots.length), {
            numRuns: 1,
            seed: semilla,
          })[0];
          if (permutacion === undefined) return;

          const original = await tally(config, ballots);
          const permutado = await tally(config, resequence(ballots, permutacion), ballots.length);
          expectSameSubstance(original, permutado);
        },
      ),
      runs(400),
    );
  });

  it('INV-16 (fuerte) — permutar tampoco cambia la demostración; con umbral, ni el `resultHash`', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        arbMethodPlan,
        fc.integer({ min: 0, max: 10_000 }),
        async (members, plan, semilla) => {
          const config = await scenarioConfig(members, plan);
          const opciones: readonly Vote[] =
            plan.kind === 'sociocratic-consent'
              ? ['consent', 'concern', 'object']
              : ['yes', 'no', 'abstain'];
          const ballots = makeBallots(
            Array.from({ length: members }, (_, i) => ({
              voterIndex: i,
              vote: opciones[(i + semilla) % opciones.length] ?? opciones[0]!,
            })),
          );
          const permutacion = fc.sample(arbPermutation(members), { numRuns: 1, seed: semilla })[0];
          if (permutacion === undefined) return;

          const original = await tally(config, ballots);
          const permutado = await tally(config, resequence(ballots, permutacion));
          expectSameSubstance(original, permutado);
          expect(proofSubstance(permutado)).toEqual(proofSubstance(original));

          if (plan.kind !== 'sociocratic-consent') {
            // En los métodos de umbral la demostración cita TODAS las papeletas efectivas, y con un
            // voto por persona ese conjunto de `seq` es {1…n} en cualquier permutación ⇒ el
            // `resultHash` es invariante.
            expect(permutado.resultHash).toBe(original.resultHash);
          }
          // En el consentimiento, el paso de objeciones cita el `seq` de la papeleta que las trajo.
          // Ese `seq` cambia porque el log ES otro: `reseq` reasigna la numeración de los eventos.
          // La *referencia* a la evidencia debe seguir apuntando al evento real, así que aquí el
          // `resultHash` puede diferir sin que nada sustantivo cambie. INV-16 exige exactamente eso:
          // igualdad de `outcome`.
        },
      ),
      runs(400),
    );
  });

  it('INV-17 — el desempate es estable: un empate exacto se resuelve igual en todo orden', async () => {
    // En los métodos de umbral de esta entrega el «desempate» es la regla del statu quo: `A === R`
    // con `>` estricto rechaza. Lo que INV-17 exige es que ese desenlace no dependa del orden.
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 10_000 }),
        async (pares, semilla) => {
          const members = pares * 2;
          const config = await scenarioConfig(members, {
            kind: 'simple-majority',
            abstentionPolicy: 'exclude',
          });
          const ballots = makeBallots(
            Array.from({ length: members }, (_, i) => ({
              voterIndex: i,
              vote: i % 2 === 0 ? 'yes' : 'no',
            })),
          );
          const permutacion = fc.sample(arbPermutation(members), { numRuns: 1, seed: semilla })[0];
          if (permutacion === undefined) return;

          const original = await tally(config, ballots);
          const permutado = await tally(config, resequence(ballots, permutacion));
          expect(original.outcome).toEqual({ kind: 'rejected', reason: 'threshold-not-met' });
          expect(permutado.resultHash).toBe(original.resultHash);
        },
      ),
      runs(300),
    );
  });

  it('INV-14 — reproducible bit a bit: mismo resultado con otra `TZ`, otro `LANG` y otro reloj', async () => {
    const tz = process.env['TZ'];
    const lang = process.env['LANG'];
    let restoreClock = (): void => undefined;
    try {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 8 }),
          arbMethodPlan,
          fc.integer({ min: 0, max: 10_000 }),
          async (members, plan, semilla) => {
            const opciones: readonly Vote[] =
              plan.kind === 'sociocratic-consent'
                ? ['consent', 'concern', 'object']
                : ['yes', 'no', 'abstain'];
            const plans = Array.from({ length: members }, (_, i) => ({
              voterIndex: i,
              vote: opciones[(i + semilla) % opciones.length] ?? opciones[0]!,
            }));

            process.env['TZ'] = 'UTC';
            process.env['LANG'] = 'en-US.UTF-8';
            restoreClock = patchClock(0);
            const a = await tally(await scenarioConfig(members, plan), makeBallots(plans));

            process.env['TZ'] = 'America/Bogota';
            process.env['LANG'] = 'es-CO.UTF-8';
            restoreClock = patchClock(2 ** 42);
            const b = await tally(await scenarioConfig(members, plan), makeBallots(plans));

            expect(b).toEqual(a);
          },
        ),
        runs(250),
      );
    } finally {
      if (tz === undefined) delete process.env['TZ'];
      else process.env['TZ'] = tz;
      if (lang === undefined) delete process.env['LANG'];
      else process.env['LANG'] = lang;
      restoreClock();
    }
  });

  it('INV-15 — el escrutinio no lee el reloj: parchear `Date.now` no mueve el resultado', async () => {
    const config = await scenarioConfig(6, {
      kind: 'simple-majority',
      abstentionPolicy: 'exclude',
    });
    const ballots = makeBallots(
      plansFrom(['yes', 'yes', 'no', 'abstain', 'yes', 'no'] as readonly Vote[]),
    );
    const restore = patchClock(0);
    try {
      const a = await tally(config, ballots);
      patchClock(2 ** 42);
      const b = await tally(config, ballots);
      expect(b).toEqual(a);
    } finally {
      restore();
    }
  });

  it('INV-20 — el resultado es reproducible desde los mismos datos, bit a bit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        arbMethodPlan,
        fc.integer({ min: 0, max: 10_000 }),
        async (members, plan, semilla) => {
          const config = await scenarioConfig(members, plan);
          const opciones: readonly Vote[] =
            plan.kind === 'sociocratic-consent'
              ? ['consent', 'concern', 'object']
              : ['yes', 'no', 'abstain'];
          const ballots = makeBallots(
            Array.from({ length: members }, (_, i) => ({
              voterIndex: i,
              vote: opciones[(i + semilla) % opciones.length] ?? opciones[0]!,
            })),
          );
          const a = await tally(config, ballots);
          const b = await tally(config, [...ballots]);
          expect(b.resultHash).toBe(a.resultHash);
          expect(b).toEqual(a);
        },
      ),
      runs(300),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// E.4 — Pesos
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E.4 — pesos y concentración', () => {
  it('INV-21 — la suma de los pesos nunca excede el censo', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMembers,
        arbMethodPlan,
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 40 }),
        async (members, plan, indices) => {
          const config = await scenarioConfig(members, plan);
          const vote: Vote = plan.kind === 'sociocratic-consent' ? 'consent' : 'yes';
          const plans = indices.map((raw) => ({ voterIndex: raw % Math.max(members, 1), vote }));
          const efectivas = effectiveBallots(config, makeBallots(plans), context(config));
          expect(totalWeight(efectivas)).toBeLessThanOrEqual(config.electorate.censusSize);
          const result = await tally(config, makeBallots(plans));
          expect(result.weights.totalWeight).toBeLessThanOrEqual(result.turnout.census);
        },
      ),
      runs(400),
    );
  });

  it('INV-22 — cada miembro contribuye a lo sumo a una papeleta', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMembers,
        arbMethodPlan,
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 30 }),
        async (members, plan, indices) => {
          const config = await scenarioConfig(members, plan);
          const vote: Vote = plan.kind === 'sociocratic-consent' ? 'consent' : 'yes';
          const plans = indices.map((raw) => ({ voterIndex: raw % Math.max(members, 1), vote }));
          const efectivas = effectiveBallots(config, makeBallots(plans), context(config));
          const todos = efectivas.flatMap((b) => [b.voter, ...b.onBehalfOf]);
          expect(new Set(todos).size).toBe(todos.length);
        },
      ),
      runs(400),
    );
  });

  it('INV-31 — los índices de concentración están en rango y son exactos', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 30 }),
        (pesos) => {
          const h = herfindahl(pesos);
          const g = gini(pesos);
          const n = BigInt(pesos.length);
          // 1/n ≤ HHI ≤ 1
          expect(h.num * n >= h.den).toBe(true);
          expect(h.num <= h.den).toBe(true);
          // 0 ≤ Gini < 1
          expect(g.num >= 0n).toBe(true);
          expect(g.num < g.den).toBe(true);
          const uniforme = pesos.every((p) => p === pesos[0]);
          if (uniforme) {
            expect(g).toEqual(ratio(0, 1).num === 0n ? { num: 0n, den: 1n } : g);
            expect(h.num * n === h.den).toBe(true);
          }
        },
      ),
      FC,
    );
  });

  it('INV-33 — la participación es el número de personas representadas', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMembers,
        arbMethodPlan,
        fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 20 }),
        async (members, plan, indices) => {
          const config = await scenarioConfig(members, plan);
          const vote: Vote = plan.kind === 'sociocratic-consent' ? 'consent' : 'yes';
          const plans = indices.map((raw) => ({ voterIndex: raw % Math.max(members, 1), vote }));
          const ballots = makeBallots(plans);
          const efectivas = effectiveBallots(config, ballots, context(config));
          const result = await tally(config, ballots);
          expect(result.turnout.represented).toBe(representedMembers(efectivas).length);
          expect(result.turnout.represented).toBe(totalWeight(efectivas));
          expect(result.turnout.fraction).toEqual({
            num: BigInt(result.turnout.represented),
            den: BigInt(config.electorate.censusSize),
          });
        },
      ),
      runs(400),
    );
  });

  it('INV-32 / C6 — la compuerta de secreto duro rechaza SIEMPRE, sea cual sea el resto', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMembers,
        arbMethodPlan,
        arbPrivacy,
        fc.boolean(),
        async (members, plan, privacy, delegacion) => {
          const config = await scenarioConfig(members, plan);
          const mutada: DecisionConfig = {
            ...config,
            privacy,
            delegation: { ...config.delegation, enabled: delegacion },
          };
          if (privacy === 'secret-ballot') {
            // Da igual el método, el censo, el quórum o la delegación: la compuerta va primero.
            expect(() => {
              assertHardSecrecySupported(mutada.privacy);
            }).toThrow(HardSecrecyUnsupported);
          } else {
            expect(() => {
              assertHardSecrecySupported(mutada.privacy);
            }).not.toThrow();
            if (!delegacion) {
              expect(() => {
                validateDecisionConfig(mutada);
              }).not.toThrow();
            }
          }
          if (delegacion) {
            expect(() => {
              validateDecisionConfig(mutada);
            }).toThrow();
          }
        },
      ),
      runs(400),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// E.5 — Máquina de estados
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E.5 — máquina de estados e inmutabilidad', () => {
  it('INV-34 — ninguna transición ilegal se acepta, desde ningún estado', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LIFECYCLE_STATUSES),
        fc.constantFrom(...DECISION_EVENT_TYPES),
        (from, event) => {
          const destino = peekTransition(from, event);
          if (destino === undefined) {
            expect(isLegalTransition(from, event)).toBe(false);
            expect(() => nextStatus(from, event)).toThrow();
          } else {
            expect(nextStatus(from, event)).toBe(destino);
          }
        },
      ),
      FC,
    );
  });

  it('INV-36 — los estados terminales son absorbentes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LIFECYCLE_STATUSES),
        fc.constantFrom(...DECISION_EVENT_TYPES),
        (from, event) => {
          if (!isTerminal(from)) return;
          expect(() => nextStatus(from, event)).toThrow();
        },
      ),
      FC,
    );
  });

  it('INV-37 — no hay reapertura: sólo se llega a `Open` desde `Draft` o desde `Open`', () => {
    for (const from of LIFECYCLE_STATUSES) {
      for (const event of DECISION_EVENT_TYPES) {
        const destino = peekTransition(from, event);
        // Ni `Closed` ni ningún terminal tiene camino de vuelta a la urna abierta.
        if (destino === 'Open') expect(['Draft', 'Open']).toContain(from);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// E.6 — Propiedades de los métodos
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('E.6 — propiedades de los métodos', () => {
  it('INV-40 — monotonía: mejorar una papeleta a favor no revierte una aprobación', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        arbMonotoneMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'yes', 'yes', 'no', 'abstain'), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.nat(),
        async (members, plan, votos, cual) => {
          fc.pre(votos.length <= members);
          const config = await scenarioConfig(members, plan);
          const antes = await tally(config, makeBallots(plansFrom(votos)));
          fc.pre(antes.outcome.kind === 'approved');

          const indice = cual % votos.length;
          const mejorados = votos.map((v, i) => (i === indice ? 'yes' : v));
          const despues = await tally(config, makeBallots(plansFrom(mejorados)));
          expect(despues.outcome.kind).toBe('approved');
        },
      ),
      runs(500),
    );
  });

  it('INV-41 — añadir la papeleta a favor de un elegible nuevo no invierte el resultado', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 9 }),
        arbMonotoneMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'yes', 'yes', 'no', 'abstain'), {
          minLength: 1,
          maxLength: 8,
        }),
        async (members, plan, votos) => {
          fc.pre(votos.length < members);
          const config = await scenarioConfig(members, plan);
          const antes = await tally(config, makeBallots(plansFrom(votos)));
          fc.pre(antes.outcome.kind === 'approved');

          const conNuevo: readonly Vote[] = [...votos, 'yes'];
          const despues = await tally(config, makeBallots(plansFrom(conNuevo)));
          expect(despues.outcome.kind).toBe('approved');
        },
      ),
      runs(500),
    );
  });

  it('INV-41 (consentimiento) — sumar una postura de consentimiento tampoco revierte', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 9 }),
        fc.array(fc.constantFrom<Vote>('consent', 'consent', 'concern'), {
          minLength: 1,
          maxLength: 8,
        }),
        async (members, votos) => {
          fc.pre(votos.length < members);
          const config = await scenarioConfig(members, {
            kind: 'sociocratic-consent',
            maxRounds: 3,
            minEngagementNum: 1,
            minEngagementDen: 2,
          });
          const antes = await tally(config, makeBallots(plansFrom(votos)));
          fc.pre(antes.outcome.kind === 'approved');
          const despues = await tally(config, makeBallots(plansFrom([...votos, 'consent'])));
          expect(despues.outcome.kind).toBe('approved');
        },
      ),
      runs(400),
    );
  });

  it('INV-52 — `0/0` nunca aprueba, en ningún método de umbral', async () => {
    await fc.assert(
      fc.asyncProperty(arbMembers, arbThresholdMethodPlan, async (members, plan) => {
        const config = await scenarioConfig(members, plan);
        const result = await tally(config, []);
        expect(result.outcome.kind).not.toBe('approved');
      }),
      runs(400),
    );
  });

  it('INV-53 — consentimiento: pasa ⟺ cero objeciones admitidas no integradas ∧ engagement', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.array(fc.constantFrom<Vote>('consent', 'concern', 'object'), { maxLength: 8 }),
        async (members, votos) => {
          fc.pre(votos.length <= members);
          const config = await scenarioConfig(members, {
            kind: 'sociocratic-consent',
            maxRounds: 3,
            minEngagementNum: 0,
            minEngagementDen: 4,
          });
          const result = await tally(config, makeBallots(plansFrom(votos)));
          const hayObjecion = votos.includes('object');
          expect(result.outcome.kind === 'approved').toBe(!hayObjecion);
        },
      ),
      runs(400),
    );
  });

  it('INV-39 — sin quórum, la demostración no contiene el resultado del método', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 4, max: 10 }),
        arbThresholdMethodPlan,
        fc.integer({ min: 0, max: 1 }),
        async (members, plan, votantes) => {
          const config = await scenarioConfig(members, plan, {
            participation: ratio(3, 4),
            onFailure: 'reject',
            maxExtensions: 0,
            extensionDuration: 0,
          });
          const votos = Array.from({ length: votantes }, (): Vote => 'yes');
          const result = await tally(config, makeBallots(plansFrom(votos)));
          fc.pre(!result.quorumCheck.passed);
          expect(result.outcome.kind).toBe('no-quorum');
          expect(result.proof.tables).toHaveLength(0);
          expect(result.proof.steps.every((s) => s.id.startsWith('Q'))).toBe(true);
        },
      ),
      runs(300),
    );
  });
});
