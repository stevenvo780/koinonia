/**
 * PARTE C en el MOTOR: `DelegationGranted` / `DelegationRevoked`, comprobaciones EX ANTE y
 * escrutinio con pesos delegados de extremo a extremo.
 *
 * Lo que se prueba aquí y no en `delegation.test.ts` es la mitad que la especificación considera la
 * verdadera solución: **C.4.a** («los ciclos se PREVIENEN al conceder») y **C.5.b.1** («el tope se
 * verifica al conceder […]; el recorte en el escrutinio es sólo una red de seguridad»). Un rechazo
 * al conceder es un mensaje que la persona lee y puede accionar; el mismo hecho descubierto en el
 * escrutinio es silencio irreversible.
 */

import { describe, expect, it } from 'vitest';

import {
  apply,
  appendEvent,
  assertNoDelegationInSecretBallot,
  brokenChainNoticesFor,
  buildDecisionConfig,
  castBallot,
  closeDecision,
  computeResult,
  type DecisionConfig,
  type DecisionLog,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DEFAULT_EARLY_CLOSE,
  DELEGATION_ENABLED,
  type DelegationScope,
  delegationId,
  DomainError,
  draftDecision,
  ENGINE_VERSION,
  grantDelegation,
  IllegalTransitionError,
  instant,
  irreversibility,
  liveTally,
  openDecision,
  ratio,
  replay,
  revokeDelegation,
  toFractionString,
  topicId,
  type TopicId,
  validateDecisionConfig,
  verifyLogChain,
} from '../src/index.js';
import {
  ballotIdAt,
  buildElectorate,
  CIRCLE_MAIN,
  CLOSES_AT,
  DECISION_ID,
  DEFAULT_WINDOW,
  eventIdAt,
  hex32,
  memberIdAt,
  NO_QUORUM,
  OPTION_MAIN,
  PROPOSAL_ID,
  PROPOSAL_V1,
  SEED_COMMITMENT,
  T0,
} from './arbitraries.js';

const HOUR = 3_600_000;
const SEMESTER = 180 * 24 * HOUR;

const TOPIC_A: TopicId = topicId(hex32(0x8000));
const TOPIC_B: TopicId = topicId(hex32(0x8001));
const GLOBAL: DelegationScope = { kind: 'global' };
const ON_A: DelegationScope = { kind: 'topic', topicId: TOPIC_A };
const ON_B: DelegationScope = { kind: 'topic', topicId: TOPIC_B };

const M = memberIdAt;
const D = (i: number) => delegationId(hex32(0x7000 + i));

/**
 * El `code` estable del rechazo. Se compara el código y no el mensaje: el mensaje está escrito para
 * que una persona lo entienda y va a cambiar; el código es el contrato con la capa de aplicación.
 */
async function rejectionCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof DomainError ? error.code : `NOT_A_DOMAIN_ERROR:${String(error)}`;
  }
  return 'NO_REJECTION';
}

async function delegatedConfig(
  members: number,
  overrides: Partial<DecisionConfig> = {},
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
    delegation: DELEGATION_ENABLED,
    seedCommitment: SEED_COMMITMENT,
    engineVersion: ENGINE_VERSION,
    ...overrides,
  });
}

async function openLog(config: DecisionConfig): Promise<DecisionLog> {
  const drafted = await draftDecision([], {
    eventId: eventIdAt(1),
    at: instant(T0 - 1000),
    actor: 'system',
    decisionId: DECISION_ID,
    draft: {
      proposalId: PROPOSAL_ID,
      proposalVersionHash: PROPOSAL_V1,
      summary: 'Renovar el convenio de la biblioteca',
    },
  });
  return openDecision(drafted, { eventId: eventIdAt(2), at: T0, actor: 'system', config });
}

let clock = 0;
function tick(): ReturnType<typeof instant> {
  clock += 1;
  return instant(T0 + 1000 + clock);
}

async function delegate(
  log: DecisionLog,
  from: number,
  to: number,
  scope: DelegationScope = GLOBAL,
  index = from,
): Promise<DecisionLog> {
  return grantDelegation(log, {
    eventId: eventIdAt(200 + log.length),
    at: tick(),
    delegation: {
      delegationId: D(index),
      delegator: M(from),
      delegate: M(to),
      scope,
      expiresAt: instant(T0 + SEMESTER),
    },
  });
}

async function vote(log: DecisionLog, voterIndex: number, approve = true): Promise<DecisionLog> {
  return castBallot(log, {
    eventId: eventIdAt(400 + log.length),
    at: tick(),
    actor: M(voterIndex),
    ballot: {
      ballotId: ballotIdAt(voterIndex + 1),
      decisionId: DECISION_ID,
      voter: M(voterIndex),
      round: 1,
      payload: { kind: 'binary', approve },
      proposalVersionHash: PROPOSAL_V1,
    },
  });
}

async function closeAndTally(log: DecisionLog) {
  const closed = await closeDecision(log, {
    eventId: eventIdAt(900),
    at: CLOSES_AT,
    actor: 'system',
    cause: 'window',
  });
  return computeResult(closed);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El evento entra en el log
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('DelegationGranted / DelegationRevoked ya no son inalcanzables', () => {
  it('la delegación entra en el log, se pliega y la cadena de hashes queda intacta', async () => {
    const log = await delegate(await openLog(await delegatedConfig(40)), 0, 1);
    await verifyLogChain(log);
    const state = replay(log);
    expect(state.status).toBe('Open');
    expect(state.delegations).toHaveLength(1);
    expect(state.delegations[0]?.delegator).toBe(M(0));
    expect(state.delegations[0]?.grantedSeq).toBe(3); // draft, open, grant
  });

  it('la revocación marca `revokedAt` con el instante exacto del evento', async () => {
    const granted = await delegate(await openLog(await delegatedConfig(40)), 0, 1);
    const at = tick();
    const revoked = await revokeDelegation(granted, {
      eventId: eventIdAt(300),
      at,
      delegationId: D(0),
    });
    expect(replay(revoked).delegations[0]?.revokedAt).toBe(at);
  });

  it('delegar en uno mismo no es delegar', async () => {
    const log = await openLog(await delegatedConfig(40));
    expect(
      await rejectionCode(async () =>
        grantDelegation(log, {
          eventId: eventIdAt(210),
          at: tick(),
          delegation: {
            delegationId: D(0),
            delegator: M(0),
            delegate: M(0),
            scope: GLOBAL,
            expiresAt: instant(T0 + SEMESTER),
          },
        }),
      ),
    ).toBe('SELF_DELEGATION');
  });

  it('nadie delega por otro, y quien lo cierra es el PLEGADO, no la orden', async () => {
    // El canal de coacción de la democracia líquida no es «votá esto» sino «delegá en mí» (C.7.2),
    // así que la comprobación va donde pasa TODO log: `apply`. Se fabrica el evento a mano —con
    // otro firmante— para probar que un log traído de fuera tampoco se pliega.
    const log = await openLog(await delegatedConfig(40));
    const state = replay(log);
    const at = tick();
    const event = await appendEvent(log, {
      eventId: eventIdAt(211),
      decisionId: DECISION_ID,
      occurredAt: at,
      actor: M(9), // firma otra persona
      payload: {
        type: 'DelegationGranted',
        delegation: {
          delegationId: D(0),
          delegator: M(0),
          delegate: M(1),
          scope: GLOBAL,
          grantedAt: at,
          expiresAt: instant(T0 + SEMESTER),
          grantedSeq: log.length + 1,
        },
      },
    });
    expect(await rejectionCode(() => Promise.resolve(apply(state, event)))).toBe(
      'DELEGATION_NOT_SELF_GRANTED',
    );
  });

  it('no se revoca una delegación que no existe', async () => {
    const granted = await delegate(await openLog(await delegatedConfig(40)), 0, 1);
    expect(
      await rejectionCode(async () =>
        revokeDelegation(granted, {
          eventId: eventIdAt(300),
          at: tick(),
          delegationId: delegationId(hex32(0x7999)),
        }),
      ),
    ).toBe('UNKNOWN_DELEGATION');
  });

  it('no se revoca dos veces', async () => {
    const granted = await delegate(await openLog(await delegatedConfig(40)), 0, 1);
    const revoked = await revokeDelegation(granted, {
      eventId: eventIdAt(300),
      at: tick(),
      delegationId: D(0),
    });
    expect(
      await rejectionCode(async () =>
        revokeDelegation(revoked, {
          eventId: eventIdAt(301),
          at: tick(),
          delegationId: D(0),
        }),
      ),
    ).toBe('DELEGATION_ALREADY_REVOKED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.1.b — una sola delegación activa por (delegante, ámbito)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.1.b — una sola delegación activa por `(delegante, ámbito)`', () => {
  it('conceder una nueva para el mismo ámbito revoca la anterior en el instante de la nueva', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 0, 1, GLOBAL, 0);
    log = await delegate(log, 0, 2, GLOBAL, 1);
    const state = replay(log);
    const [primera, segunda] = state.delegations;
    expect(primera?.revokedAt).toBe(segunda?.grantedAt);
    expect(segunda?.revokedAt).toBeUndefined();
    // Y en el escrutinio sólo pesa la nueva.
    log = await vote(log, 1);
    log = await vote(log, 2);
    const result = await closeAndTally(log);
    const pesos = new Map(result.proof.steps.map((s) => [s.id, s.evidence]));
    expect(pesos.size).toBeGreaterThan(0);
    expect(result.turnout.represented).toBe(3);
  });

  it('dos ámbitos distintos conviven: no se desplazan entre sí', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 0, 1, ON_A, 0);
    log = await delegate(log, 0, 2, ON_B, 1);
    const state = replay(log);
    expect(state.delegations.every((d) => d.revokedAt === undefined)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.4.a — prevención de ciclos AL CONCEDER
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.4.a — los ciclos se previenen al conceder', () => {
  it('rechaza la arista que cerraría un ciclo directo', async () => {
    const log = await delegate(await openLog(await delegatedConfig(40)), 0, 1);
    expect(await rejectionCode(async () => delegate(log, 1, 0, GLOBAL, 1))).toBe(
      'DELEGATION_WOULD_CREATE_CYCLE',
    );
  });

  it('rechaza la arista que cerraría un ciclo transitivo', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 0, 1, GLOBAL, 0);
    log = await delegate(log, 1, 2, GLOBAL, 1);
    expect(await rejectionCode(async () => delegate(log, 2, 0, GLOBAL, 2))).toBe(
      'DELEGATION_WOULD_CREATE_CYCLE',
    );
  });

  it('rechaza el ciclo que ATRAVIESA ÁMBITOS, que es el que la spec deja pasar', async () => {
    // Ana delega en Beto en global; Beto delega en Ana en el tema A. Ningún ámbito por separado
    // tiene ciclo, pero en una decisión cuyos `topics` contienen A el grafo efectivo es
    // `Ana → Beto → Ana`. Errata E-37.
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 0, 1, GLOBAL, 0);
    expect(await rejectionCode(async () => delegate(log, 1, 0, ON_A, 1))).toBe(
      'DELEGATION_WOULD_CREATE_CYCLE',
    );
  });

  it('el mensaje explica que ninguno de los dos votaría', async () => {
    const log = await delegate(await openLog(await delegatedConfig(40)), 0, 1);
    await expect(delegate(log, 1, 0, GLOBAL, 1)).rejects.toThrow(/ninguno de los dos votaría/u);
  });

  it('una revocación libera la arista y la concesión inversa vuelve a ser posible', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 0, 1, GLOBAL, 0);
    log = await revokeDelegation(log, { eventId: eventIdAt(300), at: tick(), delegationId: D(0) });
    await expect(delegate(log, 1, 0, GLOBAL, 1)).resolves.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.5.b.1 — tope EX ANTE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.5.b.1 — el tope se verifica AL CONCEDER', () => {
  it('rechaza la delegación que llevaría al delegado por encima del tope', async () => {
    // Censo 20 ⇒ tope 2: el delegado admite una sola delegación (1 propio + 1).
    let log = await openLog(await delegatedConfig(20));
    log = await delegate(log, 1, 0, GLOBAL, 1);
    expect(await rejectionCode(async () => delegate(log, 2, 0, GLOBAL, 2))).toBe(
      'DELEGATION_CAP_REACHED',
    );
  });

  it('cuenta las cadenas transitivas proyectadas, no sólo las delegaciones directas', async () => {
    // Censo 30 ⇒ tope 3. 3→2 y 2→1: al llegar 4→1 el proyectado de 1 sería 1+3 = 4 > 3.
    let log = await openLog(await delegatedConfig(30));
    log = await delegate(log, 3, 2, GLOBAL, 3);
    log = await delegate(log, 2, 1, GLOBAL, 2);
    expect(await rejectionCode(async () => delegate(log, 4, 1, GLOBAL, 4))).toBe(
      'DELEGATION_CAP_REACHED',
    );
  });

  it('el mensaje dice cuántos representa ya y cuál es el tope', async () => {
    let log = await openLog(await delegatedConfig(20));
    log = await delegate(log, 1, 0, GLOBAL, 1);
    await expect(delegate(log, 2, 0, GLOBAL, 2)).rejects.toThrow(/tope de concentración es 2/u);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.1.a — caducidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.1.a — caducidad obligatoria y acotada', () => {
  it('rechaza una vigencia mayor que un semestre', async () => {
    const log = await openLog(await delegatedConfig(40));
    expect(
      await rejectionCode(async () =>
        grantDelegation(log, {
          eventId: eventIdAt(220),
          at: tick(),
          delegation: {
            delegationId: D(0),
            delegator: M(0),
            delegate: M(1),
            scope: GLOBAL,
            expiresAt: instant(T0 + SEMESTER + 10 * HOUR),
          },
        }),
      ),
    ).toBe('DELEGATION_VALIDITY_EXCEEDED');
  });

  it('rechaza una vigencia vacía o invertida', async () => {
    const log = await openLog(await delegatedConfig(40));
    expect(
      await rejectionCode(async () =>
        grantDelegation(log, {
          eventId: eventIdAt(221),
          at: tick(),
          delegation: {
            delegationId: D(0),
            delegator: M(0),
            delegate: M(1),
            scope: GLOBAL,
            expiresAt: instant(T0 - HOUR),
          },
        }),
      ),
    ).toBe('DELEGATION_EXPIRY_INVALID');
  });

  it('rechaza delegar en alguien que no está en el padrón congelado', async () => {
    const log = await openLog(await delegatedConfig(40));
    expect(await rejectionCode(async () => delegate(log, 0, 100))).toBe('DELEGATE_NOT_IN_CENSUS');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ADR-0030 — compuerta dura del voto secreto
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('ADR-0030 / C.7.a — la delegación está PROHIBIDA en voto secreto', () => {
  it('la configuración con `secret-ballot` y delegación NO se valida', async () => {
    const config = await delegatedConfig(40);
    expect(() => {
      validateDecisionConfig({ ...config, privacy: 'secret-ballot' });
    }).toThrow(/SECRET_BALLOT_WITH_DELEGATION/u);
  });

  it('`openDecision` rechaza abrir la decisión, no la abre con la delegación inerte', async () => {
    const config = await delegatedConfig(40);
    const drafted = await draftDecision([], {
      eventId: eventIdAt(1),
      at: instant(T0 - 1000),
      actor: 'system',
      decisionId: DECISION_ID,
      draft: {
        proposalId: PROPOSAL_ID,
        proposalVersionHash: PROPOSAL_V1,
        summary: 'Elegir a la persona que representa al Instituto',
      },
    });
    await expect(
      openDecision(drafted, {
        eventId: eventIdAt(2),
        at: T0,
        actor: 'system',
        config: { ...config, privacy: 'secret-ballot' },
      }),
    ).rejects.toThrow();
    // Y el log no crece: la decisión no queda medio abierta.
    expect(drafted).toHaveLength(1);
  });

  it('en `sealed-tally` la delegación es legal: el delegado vota en acta (C.7.b)', async () => {
    const config = await delegatedConfig(40, { privacy: 'sealed-tally' });
    expect(() => {
      validateDecisionConfig(config);
    }).not.toThrow();
  });

  it('la forma FUERTE del ADR: con delegaciones vigentes en el ámbito tampoco se abre', async () => {
    // ADR-0030 §Decisión: «rechaza abrir la decisión si hay delegaciones vigentes en su ámbito».
    // Es más estricto que C.7.a —que sólo mira `enabled`— y por precedencia manda el ADR: abrir
    // con `enabled: false` mientras alguien tiene delegación vigente sobre ese tema es
    // exactamente la delegación «inerte» que el ADR llama «la peor opción». Errata E-43.
    const config = await delegatedConfig(40, {
      privacy: 'secret-ballot',
      delegation: { ...DELEGATION_ENABLED, enabled: false },
    });
    const vigente = {
      delegationId: D(0),
      delegator: M(0),
      delegate: M(1),
      scope: ON_A,
      grantedAt: instant(T0 - 1000),
      expiresAt: instant(T0 + SEMESTER),
      grantedSeq: 1,
    };
    const guard = (
      target: DecisionConfig,
      registro: readonly (typeof vigente)[],
    ): (() => Promise<unknown>) => {
      return () => {
        assertNoDelegationInSecretBallot(target, registro, T0);
        return Promise.resolve('sin rechazo');
      };
    };

    expect(await rejectionCode(guard(config, [vigente]))).toBe(
      'SECRET_BALLOT_WITH_ACTIVE_DELEGATIONS',
    );
    // Sin delegaciones vigentes en el ámbito, la comprobación no dice nada.
    expect(await rejectionCode(guard(config, []))).toBe('NO_REJECTION');
    // Y una delegación de OTRO tema no bloquea esta decisión.
    expect(
      await rejectionCode(
        guard({ ...config, topics: [TOPIC_B] }, [
          { ...vigente, scope: { kind: 'topic', topicId: TOPIC_A } },
        ]),
      ),
    ).toBe('NO_REJECTION');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escrutinio de extremo a extremo
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('escrutinio con pesos delegados, de extremo a extremo', () => {
  it('`computeResult` usa el resolutor de la PARTE C sin que nadie se lo pase', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 1, 0, GLOBAL, 1);
    log = await delegate(log, 2, 0, GLOBAL, 2);
    log = await vote(log, 0, true);
    log = await vote(log, 5, false);
    const result = await closeAndTally(log);
    expect(result.turnout.cast).toBe(2); // dos papeletas
    expect(result.turnout.represented).toBe(4); // cuatro personas
    expect(result.weights.totalWeight).toBe(4);
    expect(result.outcome.kind).toBe('approved');
  });

  it('el HHI va en la PRUEBA y es recomputable', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 1, 0, GLOBAL, 1);
    log = await delegate(log, 2, 0, GLOBAL, 2);
    log = await vote(log, 0, true);
    log = await vote(log, 5, true);
    const result = await closeAndTally(log);
    const paso = result.proof.steps.find((s) => s.id === 'C1');
    expect(paso).toBeDefined();
    // pesos 3 y 1 ⇒ HHI = (9+1)/16 = 5/8; HHI* = (2·10 − 16)/(16·1) = 1/4.
    expect(paso?.evidence['hhi']).toBe('5/8');
    expect(paso?.evidence['hhiNormalizado']).toBe('1/4');
    expect(paso?.evidence['cr1']).toBe('3/40');
    expect(toFractionString(result.weights.hhi)).toBe('5/8');
    expect(paso?.evidence['concentracionAlta']).toBe('sí');
    expect(result.proof.tables.some((t) => t.title.includes('Concentración alta'))).toBe(true);
  });

  it('sin delegación habilitada la prueba NO lleva el paso de concentración', async () => {
    const config = await delegatedConfig(40, {
      delegation: { ...DELEGATION_ENABLED, enabled: false },
    });
    let log = await openLog(config);
    log = await vote(log, 0, true);
    const result = await closeAndTally(log);
    expect(result.proof.steps.find((s) => s.id === 'C1')).toBeUndefined();
  });

  it('votar directo con la delegación puesta le quita el peso al delegado, sin revocar', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 1, 0, GLOBAL, 1);
    log = await vote(log, 0, true); // el delegado vota primero
    log = await vote(log, 1, false); // la delegante vota después
    const result = await closeAndTally(log);
    expect(result.turnout.represented).toBe(2);
    expect(result.weights.totalWeight).toBe(2);
    // 1 a favor, 1 en contra ⇒ no supera la mayoría simple estricta.
    expect(result.outcome.kind).toBe('rejected');
    // Y la delegación sigue VIGENTE para las decisiones siguientes.
    expect(replay(log).delegations[0]?.revokedAt).toBeUndefined();
  });

  it('revocar antes del cierre saca el peso del escrutinio, aunque el delegado ya votara', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 1, 0, GLOBAL, 1);
    log = await vote(log, 0, true);
    const conDelegacion = await closeAndTally(log);
    expect(conDelegacion.weights.totalWeight).toBe(2);

    const revocado = await revokeDelegation(log, {
      eventId: eventIdAt(310),
      at: tick(),
      delegationId: D(1),
    });
    const sinDelegacion = await closeAndTally(revocado);
    expect(sinDelegacion.weights.totalWeight).toBe(1);
    expect(sinDelegacion.turnout.represented).toBe(1);
  });

  it('INV-21 — la suma de pesos nunca excede el censo, tampoco de extremo a extremo', async () => {
    let log = await openLog(await delegatedConfig(40));
    for (const [from, to] of [
      [1, 0],
      [2, 0],
      [3, 1],
      [5, 4],
    ] as const) {
      log = await delegate(log, from, to, GLOBAL, from);
    }
    log = await vote(log, 0, true);
    log = await vote(log, 4, true);
    const result = await closeAndTally(log);
    expect(result.weights.totalWeight).toBeLessThanOrEqual(40);
    expect(result.turnout.represented).toBe(result.weights.totalWeight);
  });

  it('la participación cuenta a quien delegó, si su delegado votó (D.1.a)', async () => {
    let log = await openLog(
      await delegatedConfig(40, {
        quorum: { ...NO_QUORUM, participation: ratio(3, 40) },
      }),
    );
    log = await delegate(log, 1, 0, GLOBAL, 1);
    log = await delegate(log, 2, 0, GLOBAL, 2);
    log = await vote(log, 0, true);
    const result = await closeAndTally(log);
    expect(result.quorumCheck.passed).toBe(true);
    expect(toFractionString(result.turnout.fraction)).toBe('3/40');
  });

  it('si el delegado NO vota, la delegación no infla el quórum', async () => {
    let log = await openLog(
      await delegatedConfig(40, {
        quorum: { ...NO_QUORUM, participation: ratio(3, 40) },
      }),
    );
    log = await delegate(log, 1, 0, GLOBAL, 1);
    log = await delegate(log, 2, 0, GLOBAL, 2);
    log = await vote(log, 7, true); // vota alguien ajeno a la cadena
    const result = await closeAndTally(log);
    expect(result.quorumCheck.passed).toBe(false);
    expect(result.outcome.kind).toBe('no-quorum');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Avisos e irreversibilidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('avisos de cadena rota y cierre anticipado', () => {
  it('el motor produce los avisos como DATO, con el instante en que corresponde emitirlos', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await delegate(log, 0, 1, GLOBAL, 0); // 1 no votará
    log = await vote(log, 5, true);
    const notices = brokenChainNoticesFor(replay(log));
    const de0 = notices.find((n) => n.member === M(0));
    expect(de0?.reason).toBe('chain-dead-end');
    expect(de0?.noticeAt).toBe(instant(CLOSES_AT - 24 * HOUR));
    expect(notices.find((n) => n.member === M(5))).toBeUndefined();
  });

  it('con delegación, el cierre anticipado por irreversibilidad queda cerrado', async () => {
    const config = await delegatedConfig(40);
    let log = await openLog(config);
    log = await vote(log, 0, true);
    const live = liveTally(log, instant(T0 + 5 * HOUR));
    expect(irreversibility(config, live)).toBe('open');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La objeción no se delega
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('`GOVERNANCE.md` §5 — la objeción no se delega', () => {
  it('el peso delegado no amplifica ni crea una objeción: bloquear es un acto personal', async () => {
    // La objeción vive en `ObjectionRaised { by }` y en la papeleta propia del objetante, y
    // `blockingObjections` bloquea por EXISTENCIA, no por peso: una objeción con peso 1 y una con
    // peso 30 bloquean igual. La delegación mueve pesos, y por tanto no puede tocar la objeción.
    const config = await delegatedConfig(40);
    expect(config.method.kind).toBe('simple-majority');
    // La comprobación estructural: el resolutor sólo produce `weight` y `onBehalfOf`; ningún
    // camino permite que una delegación inyecte una `Objection` en la papeleta de otra persona.
    let log = await openLog(config);
    log = await delegate(log, 1, 0, GLOBAL, 1);
    const state = replay(log);
    expect(state.objections).toEqual([]);
    expect(state.delegations[0]?.delegate).toBe(M(0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El evento sigue siendo ilegal donde debe serlo
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('la delegación sigue acotada por la máquina de estados', () => {
  it('no se delega en `Draft`: el padrón todavía no está congelado', async () => {
    const drafted = await draftDecision([], {
      eventId: eventIdAt(1),
      at: instant(T0 - 1000),
      actor: 'system',
      decisionId: DECISION_ID,
      draft: {
        proposalId: PROPOSAL_ID,
        proposalVersionHash: PROPOSAL_V1,
        summary: 'Renovar el convenio de la biblioteca',
      },
    });
    await expect(delegate(drafted, 0, 1)).rejects.toThrow();
  });

  it('no se delega en una decisión abierta SIN delegación', async () => {
    const config = await delegatedConfig(40, {
      delegation: { ...DELEGATION_ENABLED, enabled: false },
    });
    const log = await openLog(config);
    expect(await rejectionCode(async () => delegate(log, 0, 1))).toBe('DELEGATION_DISABLED');
  });

  it('no se delega tras el cierre', async () => {
    let log = await openLog(await delegatedConfig(40));
    log = await vote(log, 0, true);
    const closed = await closeDecision(log, {
      eventId: eventIdAt(900),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    await expect(delegate(closed, 1, 0)).rejects.toThrow(IllegalTransitionError);
  });
});
