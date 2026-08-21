/**
 * Validación de papeletas (A.4, INV-02, INV-09, INV-10, INV-12).
 *
 * El principio que se prueba en todo el archivo es uno solo: **fallar cerrado**. Una papeleta que no
 * encaja se rechaza; jamás se normaliza, se trunca ni se «interpreta caritativamente». Toda
 * normalización silenciosa convierte basura en voto.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  acceptedPayloadKinds,
  type Ballot,
  type BallotContext,
  ballotRejection,
  type DecisionConfig,
  instant,
  InvalidBallotError,
  isBallotValid,
  MIN_OBJECTION_ARGUMENT_LENGTH,
  validateBallot,
  validateObjection,
} from '../src/index.js';
import {
  arbInvalidKind,
  ARGUMENT,
  ballotIdAt,
  buildConfig,
  buildElectorate,
  CLOSES_AT,
  FC,
  makeBallots,
  makeInvalidBallot,
  memberIdAt,
  objectionIdAt,
  planToMethod,
  PROPOSAL_V1,
  PROPOSAL_V2,
  T0,
} from './arbitraries.js';

async function majorityConfig(members = 5): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(members),
    method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
  });
}

async function consentConfig(members = 5): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(members),
    method: planToMethod({
      kind: 'sociocratic-consent',
      maxRounds: 3,
      minEngagementNum: 1,
      minEngagementDen: 2,
    }),
  });
}

function ctx(config: DecisionConfig, round = 1): BallotContext {
  return {
    window: { opensAt: config.window.opensAt, closesAt: config.window.closesAt },
    round,
    proposalVersionHash: config.proposalVersionHash,
  };
}

function ballotOf(config: DecisionConfig, overrides: Partial<Ballot> = {}): Ballot {
  const [base] = makeBallots([{ voterIndex: 0, vote: 'yes' }]);
  if (base === undefined) throw new Error('sin papeleta');
  return { ...base, decisionId: config.decisionId, ...overrides };
}

describe('ballot — qué admite cada método', () => {
  it('los métodos de umbral admiten `binary` y `abstain`; el consentimiento sólo `consent`', async () => {
    const mayoria = await majorityConfig();
    const consentimiento = await consentConfig();
    expect(acceptedPayloadKinds(mayoria.method)).toEqual(['binary', 'abstain']);
    expect(acceptedPayloadKinds(consentimiento.method)).toEqual(['consent']);
  });

  it('INV-12 — una papeleta incompatible se rechaza, no se convierte', async () => {
    const mayoria = await majorityConfig();
    const consentimiento = await consentConfig();

    // Un `consent` no se lee como «sí» en una mayoría simple.
    expect(() => {
      validateBallot(
        mayoria,
        ballotOf(mayoria, { payload: { kind: 'consent', stance: 'consent' } }),
        ctx(mayoria),
      );
    }).toThrow(/PAYLOAD_KIND_NOT_ACCEPTED/u);

    // Y un `abstain` no se cuela como postura sociocrática.
    expect(() => {
      validateBallot(
        consentimiento,
        ballotOf(consentimiento, { payload: { kind: 'abstain' } }),
        ctx(consentimiento),
      );
    }).toThrow(/PAYLOAD_KIND_NOT_ACCEPTED/u);
  });
});

describe('ballot — elegibilidad y ventana', () => {
  it('INV-02 — quien no está en el padrón congelado no vota', async () => {
    const config = await majorityConfig(3);
    expect(() => {
      validateBallot(config, ballotOf(config, { voter: memberIdAt(9) }), ctx(config));
    }).toThrow(/INELIGIBLE_VOTER/u);
  });

  it('INV-10 — la frontera del cierre es exclusiva, sin gracia', async () => {
    const config = await majorityConfig(3);
    const enElCierre = ballotOf(config, { castAt: CLOSES_AT });
    const unMsAntes = ballotOf(config, { castAt: instant(CLOSES_AT - 1) });
    const enLaApertura = ballotOf(config, { castAt: T0 });
    const unMsAntesDeAbrir = ballotOf(config, { castAt: instant(T0 - 1) });

    expect(isBallotValid(config, enElCierre, ctx(config))).toBe(false);
    expect(isBallotValid(config, unMsAntes, ctx(config))).toBe(true);
    expect(isBallotValid(config, enLaApertura, ctx(config))).toBe(true);
    expect(isBallotValid(config, unMsAntesDeAbrir, ctx(config))).toBe(false);
    expect(ballotRejection(config, enElCierre, ctx(config))).toBe('OUT_OF_WINDOW');
  });

  it('INV-09 — una papeleta sobre una versión obsoleta de la propuesta no cuenta', async () => {
    const config = await majorityConfig(3);
    expect(
      ballotRejection(config, ballotOf(config, { proposalVersionHash: PROPOSAL_V2 }), ctx(config)),
    ).toBe('STALE_PROPOSAL_VERSION');
    expect(
      isBallotValid(config, ballotOf(config, { proposalVersionHash: PROPOSAL_V1 }), ctx(config)),
    ).toBe(true);
  });

  it('rechaza la papeleta de otra decisión y el `seq` inválido', async () => {
    const config = await majorityConfig(3);
    expect(
      ballotRejection(
        config,
        ballotOf(config, {
          decisionId: config.decisionId.replace(/.$/u, 'f') as typeof config.decisionId,
        }),
        ctx(config),
      ),
    ).toBe('WRONG_DECISION');
    expect(ballotRejection(config, ballotOf(config, { seq: 0 }), ctx(config))).toBe('INVALID_SEQ');
    expect(ballotRejection(config, ballotOf(config, { seq: 1.5 }), ctx(config))).toBe(
      'INVALID_SEQ',
    );
  });

  it('rechaza una papeleta de una ronda que no es la vigente', async () => {
    const config = await consentConfig(3);
    const papeleta = ballotOf(config, {
      round: 1,
      payload: { kind: 'consent', stance: 'consent' },
    });
    expect(ballotRejection(config, papeleta, ctx(config, 2))).toBe('WRONG_ROUND');
  });
});

describe('ballot — objeciones (B.3)', () => {
  it('objetar exige la objeción, y no objetar prohíbe adjuntarla', async () => {
    const config = await consentConfig(3);
    expect(
      ballotRejection(
        config,
        ballotOf(config, { payload: { kind: 'consent', stance: 'object' } }),
        ctx(config),
      ),
    ).toBe('OBJECTION_REQUIRED');

    expect(
      ballotRejection(
        config,
        ballotOf(config, {
          payload: {
            kind: 'consent',
            stance: 'consent',
            objection: {
              objectionId: objectionIdAt(1),
              argument: ARGUMENT,
              harmedAim: 'x',
              raisedAtRound: 1,
            },
          },
        }),
        ctx(config),
      ),
    ).toBe('OBJECTION_NOT_ALLOWED');
  });

  it('el argumento tiene un mínimo: bloquear cuesta, al menos, explicarse', () => {
    expect(MIN_OBJECTION_ARGUMENT_LENGTH).toBe(40);
    expect(() => {
      validateObjection(
        {
          objectionId: objectionIdAt(1),
          argument: 'no me gusta',
          harmedAim: 'ninguno',
          raisedAtRound: 1,
        },
        1,
      );
    }).toThrow(/OBJECTION_ARGUMENT_TOO_SHORT/u);

    // Rellenar con espacios no sirve: se normalizan antes de medir.
    expect(() => {
      validateObjection(
        {
          objectionId: objectionIdAt(1),
          argument: `no  ${' '.repeat(80)}  me gusta`,
          harmedAim: 'ninguno',
          raisedAtRound: 1,
        },
        1,
      );
    }).toThrow(/OBJECTION_ARGUMENT_TOO_SHORT/u);
  });

  it('el objetivo dañado es obligatorio: sin él la objeción es una preferencia', () => {
    expect(() => {
      validateObjection(
        { objectionId: objectionIdAt(1), argument: ARGUMENT, harmedAim: '  ', raisedAtRound: 1 },
        1,
      );
    }).toThrow(/OBJECTION_AIM_MISSING/u);
  });

  it('el texto debe venir en NFC y sin CR: dos textos que se ven igual no pueden hashear distinto', () => {
    expect(() => {
      validateObjection(
        {
          objectionId: objectionIdAt(1),
          argument: `${ARGUMENT} filosofi\u0301a`,
          harmedAim: 'x',
          raisedAtRound: 1,
        },
        1,
      );
    }).toThrow(/TEXT_NOT_CANONICAL/u);
    expect(() => {
      validateObjection(
        {
          objectionId: objectionIdAt(1),
          argument: `${ARGUMENT}\r\nsegunda línea`,
          harmedAim: 'x',
          raisedAtRound: 1,
        },
        1,
      );
    }).toThrow(/TEXT_NOT_CANONICAL/u);
  });

  it('la objeción debe pertenecer a la ronda de la papeleta', () => {
    expect(() => {
      validateObjection(
        { objectionId: objectionIdAt(1), argument: ARGUMENT, harmedAim: 'x', raisedAtRound: 2 },
        1,
      );
    }).toThrow(/OBJECTION_ROUND_MISMATCH/u);
  });
});

describe('ballot — el generador de papeletas inválidas produce papeletas realmente inválidas', () => {
  it('las nueve clases de `arbInvalidBallot` se rechazan siempre', async () => {
    const mayoria = await majorityConfig(6);
    const consentimiento = await consentConfig(6);
    fc.assert(
      fc.property(arbInvalidKind, fc.integer({ min: 0, max: 5 }), (kind, voterIndex) => {
        for (const config of [mayoria, consentimiento]) {
          const invalid = makeInvalidBallot(config, kind, 1, voterIndex);
          expect(isBallotValid(config, invalid, ctx(config))).toBe(false);
          expect(() => {
            validateBallot(config, invalid, ctx(config));
          }).toThrow(InvalidBallotError);
        }
      }),
      FC,
    );
  });

  it('y la papeleta de la que derivan, sin la mutación, sí es válida', async () => {
    const config = await majorityConfig(3);
    expect(isBallotValid(config, ballotOf(config, { ballotId: ballotIdAt(1) }), ctx(config))).toBe(
      true,
    );
  });
});
