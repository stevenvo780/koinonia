/**
 * Escrutinio: B.1 (mayoría simple), B.2 (mayoría reforzada), B.3 (consentimiento) y B.4
 * (unanimidad), más el marco común B.0.
 *
 * El caso más importante del archivo es «las cuatro respuestas para la misma urna»: `A = 100`,
 * `R = 60`, `Ab = 40`, `S = 100` sobre `N = 300` da cuatro resultados distintos según el
 * denominador. La disputa post-electoral en una asamblea es casi siempre sobre eso.
 */

import { describe, expect, it } from 'vitest';

import {
  type Ballot,
  countBinary,
  type DecisionConfig,
  type EffectiveBallot,
  effectiveBallots,
  gini,
  herfindahl,
  instant,
  InvalidBallotForMethod,
  lastBallotPerVoter,
  lexicographicHashOrder,
  type ObjectionRecord,
  passesThreshold,
  precheck,
  PreconditionError,
  ratio,
  representedMembers,
  tallyConsent,
  tallySimpleMajority,
  tallySupermajority,
  tallyUnanimity,
  type TallyContext,
  type ThresholdInput,
  thresholdDenominator,
  totalWeight,
} from '../src/index.js';
import {
  ballotIdAt,
  buildConfig,
  buildElectorate,
  CLOSES_AT,
  DECISION_ID,
  makeBallots,
  memberIdAt,
  objectionIdAt,
  optionIdAt,
  OPTION_MAIN,
  planToMethod,
  PROPOSAL_V1,
  T0,
  type Vote,
} from './arbitraries.js';

function ctx(config: DecisionConfig, round = 1): TallyContext {
  return {
    window: { opensAt: config.window.opensAt, closesAt: config.window.closesAt },
    round,
    proposalVersionHash: config.proposalVersionHash,
    closedAt: config.window.closesAt,
    voided: [],
  };
}

/** Papeletas efectivas a partir de una lista de votos, una por votante. */
function effective(config: DecisionConfig, votes: readonly Vote[]): readonly EffectiveBallot[] {
  const ballots = makeBallots(votes.map((vote, i) => ({ voterIndex: i, vote })));
  return effectiveBallots(config, ballots, ctx(config));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.0 — marco común
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.0.4 — el denominador del umbral', () => {
  const input: ThresholdInput = { approve: 100, reject: 60, abstain: 40, census: 300 };

  it('produce cuatro respuestas distintas para la misma urna', () => {
    expect(thresholdDenominator(input, 'exclude', 'cast')).toBe(160n);
    expect(thresholdDenominator(input, 'include', 'cast')).toBe(200n);
    expect(thresholdDenominator(input, 'as-no', 'cast')).toBe(200n);
    expect(thresholdDenominator(input, 'exclude', 'census')).toBe(300n);

    const mitad = ratio(1, 2);
    expect(passesThreshold(input, mitad, true, 'exclude', 'cast')).toBe(true); // 62.5 %
    expect(passesThreshold(input, mitad, true, 'include', 'cast')).toBe(false); // 50 % exacto
    expect(passesThreshold(input, mitad, true, 'as-no', 'cast')).toBe(false);
    expect(passesThreshold(input, mitad, true, 'exclude', 'census')).toBe(false); // 33.3 %
  });

  it('INV-52 — `0/0` nunca aprueba, con ninguna política ni base', () => {
    const vacio: ThresholdInput = { approve: 0, reject: 0, abstain: 0, census: 0 };
    for (const policy of ['exclude', 'include', 'as-no'] as const) {
      for (const base of ['cast', 'census'] as const) {
        expect(passesThreshold(vacio, ratio(0, 1), false, policy, base)).toBe(false);
        expect(passesThreshold(vacio, ratio(2, 3), false, policy, base)).toBe(false);
      }
    }
  });

  it('el `≥` exacto se cumple sin error de redondeo (INV-18)', () => {
    const dosTercios: ThresholdInput = { approve: 200, reject: 100, abstain: 0, census: 300 };
    expect(passesThreshold(dosTercios, ratio(2, 3), false, 'exclude', 'cast')).toBe(true);
    expect(passesThreshold(dosTercios, ratio(2, 3), true, 'exclude', 'cast')).toBe(false);
  });
});

describe('B.0.1 — papeletas efectivas', () => {
  it('INV-07/INV-08 — una por votante, la de mayor `seq`, en orden de padrón', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    const ballots = makeBallots([
      { voterIndex: 2, vote: 'yes' },
      { voterIndex: 0, vote: 'yes' },
      { voterIndex: 0, vote: 'no' },
      { voterIndex: 1, vote: 'abstain' },
    ]);
    const efectivas = effectiveBallots(config, ballots, ctx(config));
    expect(efectivas).toHaveLength(3);
    expect(efectivas.map((b) => b.voter)).toEqual([memberIdAt(0), memberIdAt(1), memberIdAt(2)]);
    expect(efectivas[0]?.payload).toEqual({ kind: 'binary', approve: false });
    expect(totalWeight(efectivas)).toBe(3);
    expect(representedMembers(efectivas)).toEqual([memberIdAt(0), memberIdAt(1), memberIdAt(2)]);
  });

  it('`lastBallotPerVoter` no depende del orden de llegada', () => {
    const ballots = makeBallots([
      { voterIndex: 0, vote: 'yes' },
      { voterIndex: 0, vote: 'no' },
    ]);
    const [primera, segunda] = ballots;
    if (primera === undefined || segunda === undefined) throw new Error('faltan papeletas');
    expect(lastBallotPerVoter([primera, segunda])).toEqual([segunda]);
    expect(lastBallotPerVoter([segunda, primera])).toEqual([segunda]);
  });

  it('descarta las anuladas por `BallotVoided`', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    const ballots = makeBallots([
      { voterIndex: 0, vote: 'yes' },
      { voterIndex: 1, vote: 'yes' },
    ]);
    const anulada = ballots[0]?.ballotId;
    if (anulada === undefined) throw new Error('sin papeleta');
    const efectivas = effectiveBallots(config, ballots, { ...ctx(config), voided: [anulada] });
    expect(efectivas).toHaveLength(1);
    expect(efectivas[0]?.voter).toBe(memberIdAt(1));
  });

  it('INV-21/INV-22 — `precheck` rechaza pesos imposibles y miembros contados dos veces', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(2),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    const base: EffectiveBallot = {
      voter: memberIdAt(0),
      payload: { kind: 'binary', approve: true },
      weight: 1,
      seq: 1,
      onBehalfOf: [],
    };
    expect(() => {
      precheck(config, [{ ...base, weight: 5 }]);
    }).toThrow(PreconditionError);
    expect(() => {
      precheck(config, [{ ...base, weight: 0 }]);
    }).toThrow(PreconditionError);
    expect(() => {
      precheck(config, [base, { ...base, seq: 2 }]);
    }).toThrow(PreconditionError);
    expect(() => {
      precheck(config, [
        base,
        { ...base, voter: memberIdAt(1), seq: 2, onBehalfOf: [memberIdAt(0)] },
      ]);
    }).toThrow(PreconditionError);
  });

  it('INV-11 — la abstención explícita nunca suma al numerador', () => {
    const conAbstenciones = countBinary(
      [
        {
          voter: memberIdAt(0),
          payload: { kind: 'binary', approve: true },
          weight: 1,
          seq: 1,
          onBehalfOf: [],
        },
        { voter: memberIdAt(1), payload: { kind: 'abstain' }, weight: 1, seq: 2, onBehalfOf: [] },
      ],
      'simple-majority',
    );
    expect(conAbstenciones).toEqual({ approve: 1, reject: 0, abstain: 1 });
  });

  it('INV-12 — `countBinary` lanza ante una papeleta de otra clase', () => {
    expect(() =>
      countBinary(
        [
          {
            voter: memberIdAt(0),
            payload: { kind: 'consent', stance: 'consent' },
            weight: 1,
            seq: 1,
            onBehalfOf: [],
          },
        ],
        'simple-majority',
      ),
    ).toThrow(InvalidBallotForMethod);
  });
});

describe('B.0.2 — desempate por hash', () => {
  it('es un orden total y depende de la decisión, no del alfabeto', async () => {
    const opciones = [optionIdAt(0), optionIdAt(1), optionIdAt(2)];
    const orden = await lexicographicHashOrder(DECISION_ID, opciones);
    expect(orden).toHaveLength(3);
    expect([...orden].sort()).toEqual([...opciones].sort());
    // Determinista: dos llamadas dan lo mismo.
    expect(await lexicographicHashOrder(DECISION_ID, opciones)).toEqual(orden);
    // No depende del orden de entrada.
    expect(await lexicographicHashOrder(DECISION_ID, [...opciones].reverse())).toEqual(orden);
  });
});

describe('B.0 — índices de concentración (INV-31)', () => {
  it('con reparto uniforme, HHI = 1/n y Gini = 0', () => {
    expect(herfindahl([1, 1, 1, 1])).toEqual({ num: 1n, den: 4n });
    expect(gini([1, 1, 1, 1])).toEqual({ num: 0n, den: 1n });
  });

  it('con todo el peso en una sola papeleta, HHI = 1', () => {
    expect(herfindahl([7])).toEqual({ num: 1n, den: 1n });
    expect(gini([7])).toEqual({ num: 0n, den: 1n });
  });

  it('sin papeletas no hay concentración que medir', () => {
    expect(herfindahl([])).toEqual({ num: 0n, den: 1n });
    expect(gini([])).toEqual({ num: 0n, den: 1n });
  });

  it('un reparto desigual da un Gini positivo y menor que 1', () => {
    const g = gini([1, 1, 6]);
    expect(g.num > 0n).toBe(true);
    expect(g.num < g.den).toBe(true);
    const h = herfindahl([1, 1, 6]);
    expect(h.num * 4n > h.den).toBe(true); // > 1/4 = 1/n
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.1 — mayoría simple
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.1 — mayoría simple', () => {
  async function config(abstentionPolicy: 'exclude' | 'include' | 'as-no' = 'exclude') {
    return buildConfig({
      electorate: await buildElectorate(10),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy }),
    });
  }

  it('aprueba con más síes que noes', async () => {
    const cfg = await config();
    const tally = tallySimpleMajority(cfg, effective(cfg, ['yes', 'yes', 'no']));
    expect(tally.outcome).toEqual({ kind: 'approved', option: OPTION_MAIN });
    expect(tally.narrative).toContain('aprobada');
  });

  it('el empate rechaza: el statu quo gana los empates', async () => {
    const cfg = await config();
    const tally = tallySimpleMajority(cfg, effective(cfg, ['yes', 'no']));
    expect(tally.outcome).toEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps.map((s) => s.claim).join(' ')).toContain('empate');
  });

  it('con `exclude`, las abstenciones no cambian el resultado', async () => {
    const cfg = await config('exclude');
    const sinAbstenciones = tallySimpleMajority(cfg, effective(cfg, ['yes', 'yes', 'no']));
    const conAbstenciones = tallySimpleMajority(
      cfg,
      effective(cfg, ['yes', 'yes', 'no', 'abstain', 'abstain', 'abstain']),
    );
    expect(conAbstenciones.outcome).toEqual(sinAbstenciones.outcome);
  });

  it('con `include`, abstenerse equivale a votar «no»', async () => {
    const cfg = await config('include');
    expect(tallySimpleMajority(cfg, effective(cfg, ['yes', 'yes', 'no'])).outcome.kind).toBe(
      'approved',
    );
    expect(
      tallySimpleMajority(cfg, effective(cfg, ['yes', 'yes', 'no', 'abstain', 'abstain'])).outcome
        .kind,
    ).toBe('rejected');
  });

  it('con `as-no`, el número es el mismo que con `include` pero la narrativa cambia', async () => {
    const incluye = await config('include');
    const comoNo = await config('as-no');
    const votos: readonly Vote[] = ['yes', 'yes', 'no', 'abstain'];
    expect(tallySimpleMajority(comoNo, effective(comoNo, votos)).outcome).toEqual(
      tallySimpleMajority(incluye, effective(incluye, votos)).outcome,
    );
    expect(tallySimpleMajority(comoNo, effective(comoNo, votos)).narrative).toContain(
      'votos en contra',
    );
  });

  it('sin ninguna papeleta no se aprueba nada', async () => {
    const cfg = await config();
    const tally = tallySimpleMajority(cfg, effective(cfg, []));
    expect(tally.outcome.kind).toBe('rejected');
    expect(tally.steps.map((s) => s.claim).join(' ')).toContain('ni un solo voto');
  });

  it('la demostración es legible y cita los eventos que la sustentan', async () => {
    const cfg = await config();
    const tally = tallySimpleMajority(cfg, effective(cfg, ['yes', 'yes', 'no']));
    expect(tally.steps.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(tally.steps[0]?.supportingSeqs).toEqual([1, 2, 3]);
    expect(tally.tables[0]?.rows).toEqual([
      ['A favor', 2],
      ['En contra', 1],
      ['Abstención explícita', 0],
      ['No votó', 7],
    ]);
    for (const paso of tally.steps) expect(paso.claim).not.toMatch(/threshold|tally|quorum/iu);
  });

  it('rechaza que se le pase un método que no es el suyo', async () => {
    const otro = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'unanimity', base: 'cast', abstentionBlocks: false }),
    });
    expect(() => tallySimpleMajority(otro, [])).toThrow(InvalidBallotForMethod);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.2 — supermayoría
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.2 — mayoría reforzada', () => {
  async function config(base: 'cast' | 'census', strict = false, num = 2, den = 3) {
    return buildConfig({
      electorate: await buildElectorate(300),
      method: planToMethod({
        kind: 'supermajority',
        num,
        den,
        strict,
        base,
        abstentionPolicy: 'exclude',
      }),
    });
  }

  function votos(si: number, no: number): readonly Vote[] {
    return [
      ...Array.from({ length: si }, () => 'yes' as const),
      ...Array.from({ length: no }, () => 'no' as const),
    ];
  }

  it('la diferencia entre `cast` y `census` es enorme: 140/200 aprueba, 140/300 no', async () => {
    const porVotos = await config('cast');
    const porCenso = await config('census');
    expect(tallySupermajority(porVotos, effective(porVotos, votos(140, 60))).outcome.kind).toBe(
      'approved',
    );
    expect(tallySupermajority(porCenso, effective(porCenso, votos(140, 60))).outcome.kind).toBe(
      'rejected',
    );
  });

  it('B.2.c — con `≥`, «200 de 300» cumple exactamente dos tercios', async () => {
    const cfg = await config('census', false);
    expect(tallySupermajority(cfg, effective(cfg, votos(200, 100))).outcome.kind).toBe('approved');
    const estricto = await config('census', true);
    expect(tallySupermajority(estricto, effective(estricto, votos(200, 100))).outcome.kind).toBe(
      'rejected',
    );
  });

  it("con `base:'census'` la narrativa avisa de que no votar pesa como votar en contra", async () => {
    const cfg = await config('census');
    const tally = tallySupermajority(cfg, effective(cfg, votos(10, 0)));
    expect(tally.steps.map((s) => s.claim).join(' ')).toContain('voto en contra');
  });

  it('B.1.c — «mayoría absoluta» es esta misma máquina con 1/2 sobre censo', async () => {
    const cfg = await config('census', true, 1, 2);
    expect(tallySupermajority(cfg, effective(cfg, votos(150, 0))).outcome.kind).toBe('rejected');
    expect(tallySupermajority(cfg, effective(cfg, votos(151, 0))).outcome.kind).toBe('approved');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.4 — unanimidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.4 — unanimidad', () => {
  async function config(base: 'cast' | 'census', abstentionBlocks: boolean, members = 5) {
    return buildConfig({
      electorate: await buildElectorate(members),
      method: planToMethod({ kind: 'unanimity', base, abstentionBlocks }),
    });
  }

  it('basta una oposición para romperla', async () => {
    const cfg = await config('cast', false);
    expect(tallyUnanimity(cfg, effective(cfg, ['yes', 'yes', 'yes'])).outcome.kind).toBe(
      'approved',
    );
    expect(tallyUnanimity(cfg, effective(cfg, ['yes', 'yes', 'no'])).outcome.kind).toBe('rejected');
  });

  it('`abstentionBlocks` tiene efecto real: con `false` la abstención se aparta', async () => {
    // Ésta es la corrección a la fórmula de B.4: con D = A+R+Ab, `abstentionBlocks:false` sería
    // inerte porque `A = D` ya obligaría a Ab = 0.
    const bloquea = await config('cast', true);
    const noBloquea = await config('cast', false);
    const votos: readonly Vote[] = ['yes', 'yes', 'abstain'];
    expect(tallyUnanimity(bloquea, effective(bloquea, votos)).outcome.kind).toBe('rejected');
    expect(tallyUnanimity(noBloquea, effective(noBloquea, votos)).outcome.kind).toBe('approved');
  });

  it("con `base:'census'` hace falta el apoyo del padrón entero", async () => {
    const cfg = await config('census', false, 3);
    expect(tallyUnanimity(cfg, effective(cfg, ['yes', 'yes'])).outcome.kind).toBe('rejected');
    expect(tallyUnanimity(cfg, effective(cfg, ['yes', 'yes', 'yes'])).outcome.kind).toBe(
      'approved',
    );
  });

  it('INV-52 — la unanimidad vacía no existe: cero de cero es ausencia de decisión', async () => {
    for (const base of ['cast', 'census'] as const) {
      for (const bloquea of [true, false]) {
        const cfg = await config(base, bloquea);
        const tally = tallyUnanimity(cfg, effective(cfg, []));
        expect(tally.outcome.kind).toBe('rejected');
      }
    }
    const cfg = await config('cast', false);
    expect(
      tallyUnanimity(cfg, effective(cfg, []))
        .steps.map((s) => s.claim)
        .join(' '),
    ).toContain('ausencia de decisión');
  });

  it('la traza explica exactamente qué faltó', async () => {
    const cfg = await config('cast', true);
    const claims = tallyUnanimity(cfg, effective(cfg, ['yes', 'abstain']))
      .steps.map((s) => s.claim)
      .join(' ');
    expect(claims).toContain('nadie se abstenga');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.3 — consentimiento sociocrático
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.3 — consentimiento sociocrático', () => {
  async function config(maxRounds = 3, minEngagementNum = 1, minEngagementDen = 2, members = 4) {
    return buildConfig({
      electorate: await buildElectorate(members),
      method: planToMethod({
        kind: 'sociocratic-consent',
        maxRounds,
        minEngagementNum,
        minEngagementDen,
      }),
    });
  }

  function objection(index: number, overrides: Partial<ObjectionRecord> = {}): ObjectionRecord {
    return {
      objectionId: objectionIdAt(index),
      by: memberIdAt(index),
      raisedAtRound: 1,
      status: 'admitted',
      integrated: false,
      seq: 10 + index,
      ...overrides,
    };
  }

  it('INV-53 — pasa ⟺ cero objeciones admitidas no integradas ∧ engagement suficiente', async () => {
    const cfg = await config();
    const ballots = effective(cfg, ['consent', 'consent', 'concern']);

    expect(tallyConsent(cfg, ballots, { round: 1, objections: [] }).outcome.kind).toBe('approved');
    expect(
      tallyConsent(cfg, ballots, { round: 1, objections: [objection(0, { status: 'dismissed' })] })
        .outcome.kind,
    ).toBe('approved');
    expect(
      tallyConsent(cfg, ballots, { round: 1, objections: [objection(0, { status: 'withdrawn' })] })
        .outcome.kind,
    ).toBe('approved');
    expect(
      tallyConsent(cfg, ballots, { round: 1, objections: [objection(0, { integrated: true })] })
        .outcome.kind,
    ).toBe('approved');
    expect(tallyConsent(cfg, ballots, { round: 1, objections: [objection(0)] }).outcome).toEqual({
      kind: 'needs-new-round',
      nextRound: 2,
    });
  });

  it('B.3.c — agotadas las rondas con objeciones en pie, la propuesta vuelve al círculo', async () => {
    const cfg = await config(2);
    const ballots = effective(cfg, ['consent', 'consent', 'object']);
    expect(tallyConsent(cfg, ballots, { round: 2, objections: [objection(2)] }).outcome).toEqual({
      kind: 'rejected',
      reason: 'objections-pending',
    });
  });

  it('B.3.e — el silencio no consiente: sin manifestación mínima no hay consentimiento', async () => {
    const cfg = await config(3, 3, 4, 4); // exige 3/4 del círculo
    expect(
      tallyConsent(cfg, effective(cfg, ['consent', 'consent']), { round: 1, objections: [] })
        .outcome,
    ).toEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(
      tallyConsent(cfg, effective(cfg, ['consent', 'consent', 'concern']), {
        round: 1,
        objections: [],
      }).outcome.kind,
    ).toBe('approved');
  });

  it('no cuenta votos a favor: `concern` no bloquea y `consent` no suma un umbral', async () => {
    const cfg = await config(3, 1, 4, 4);
    const soloReservas = effective(cfg, ['concern', 'concern', 'concern', 'concern']);
    expect(tallyConsent(cfg, soloReservas, { round: 1, objections: [] }).outcome.kind).toBe(
      'approved',
    );
    expect(tallyConsent(cfg, soloReservas, { round: 1, objections: [] }).narrative).toContain(
      'no se cuentan votos a favor',
    );
  });

  it('la traza publica las objeciones con su estado', async () => {
    const cfg = await config();
    const tally = tallyConsent(cfg, effective(cfg, ['consent', 'consent']), {
      round: 1,
      objections: [objection(0), objection(1, { status: 'dismissed' })],
    });
    const tabla = tally.tables.find((t) => t.title === 'Objeciones');
    expect(tabla?.rows).toEqual([
      [objectionIdAt(0), 1, 'admitida', 'no'],
      [objectionIdAt(1), 1, 'desestimada', 'no'],
    ]);
  });

  it('rechaza una papeleta que no es de consentimiento', async () => {
    const cfg = await config();
    expect(() =>
      tallyConsent(
        cfg,
        [
          {
            voter: memberIdAt(0),
            payload: { kind: 'binary', approve: true },
            weight: 1,
            seq: 1,
            onBehalfOf: [],
          },
        ],
        { round: 1, objections: [] },
      ),
    ).toThrow(InvalidBallotForMethod);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Filtros del escrutinio
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el escrutinio vuelve a filtrar lo que ya se rechazó al emitir', () => {
  it('una papeleta fuera de ventana o de un inelegible no llega a las efectivas', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    const validas = makeBallots([
      { voterIndex: 0, vote: 'yes' },
      { voterIndex: 1, vote: 'no' },
    ]);
    const sucias: readonly Ballot[] = [
      ...validas,
      {
        ...validas[0]!,
        ballotId: ballotIdAt(50),
        seq: 50,
        castAt: CLOSES_AT,
        voter: memberIdAt(2),
      },
      { ...validas[0]!, ballotId: ballotIdAt(51), seq: 51, voter: memberIdAt(9) },
      {
        ...validas[0]!,
        ballotId: ballotIdAt(52),
        seq: 52,
        castAt: instant(T0 - 1),
        voter: memberIdAt(2),
      },
    ];
    const efectivas = effectiveBallots(config, sucias, ctx(config));
    expect(efectivas).toHaveLength(2);
    expect(efectivas.map((b) => b.voter)).toEqual([memberIdAt(0), memberIdAt(1)]);
    expect(PROPOSAL_V1).toBeDefined();
  });
});
