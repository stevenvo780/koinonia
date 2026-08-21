/**
 * El ciclo completo del consentimiento sociocrático: objeción → enmienda → ronda nueva (B.3).
 *
 * Es el flujo con más reglas contraintuitivas del motor:
 *  - toda objeción **nace admitida** (B.3.a), y sólo un panel sorteado puede desestimarla por 2/3;
 *  - «integrar» exige la **firma de quien objetó** (B.3.b); sin ella hay modificación unilateral;
 *  - las papeletas de la ronda anterior **no se arrastran** (A.6 / INV-09);
 *  - las rondas terminan (B.3.c / INV-54).
 */

import { describe, expect, it } from 'vitest';

import {
  append,
  type BallotDraft,
  blockingObjections,
  castBallot,
  closeDecision,
  computeResult,
  consentEngagement,
  type DecisionConfig,
  type DecisionLog,
  draftDecision,
  type Hash,
  hash,
  instant,
  memberAt,
  mergeObjections,
  type ObjectionRecord,
  openDecision,
  replay,
  verifyLog,
} from '../src/index.js';
import {
  ARGUMENT,
  ballotIdAt,
  buildConfig,
  buildElectorate,
  CIRCLE_MAIN,
  CLOSES_AT,
  DECISION_ID,
  eventIdAt,
  memberIdAt,
  objectionIdAt,
  planToMethod,
  PROPOSAL_ID,
  PROPOSAL_V1,
  PROPOSAL_V2,
  T0,
} from './arbitraries.js';

const PROPOSAL_V3: Hash = hash('44'.repeat(32));

async function consentConfig(members = 4, maxRounds = 3): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(members),
    method: planToMethod({
      kind: 'sociocratic-consent',
      maxRounds,
      minEngagementNum: 1,
      minEngagementDen: 2,
    }),
  });
}

async function opened(config: DecisionConfig): Promise<DecisionLog> {
  const drafted = await draftDecision([], {
    eventId: eventIdAt(1),
    at: instant(T0 - 1000),
    actor: 'system',
    decisionId: DECISION_ID,
    draft: {
      proposalId: PROPOSAL_ID,
      proposalVersionHash: PROPOSAL_V1,
      summary: 'Definir el temario del seminario permanente',
    },
  });
  return openDecision(drafted, { eventId: eventIdAt(2), at: T0, actor: 'system', config });
}

function consentBallot(
  voterIndex: number,
  stance: 'consent' | 'concern' | 'object',
  round: number,
  versionHash: Hash,
): BallotDraft {
  return {
    ballotId: ballotIdAt(round * 100 + voterIndex),
    decisionId: DECISION_ID,
    voter: memberIdAt(voterIndex),
    round,
    payload:
      stance === 'object'
        ? {
            kind: 'consent',
            stance,
            objection: {
              objectionId: objectionIdAt(voterIndex),
              argument: ARGUMENT,
              harmedAim: 'sostener el seminario permanente',
              proposedAmendment: 'reservar la sala 4-108 los martes',
              raisedAtRound: round,
            },
          }
        : { kind: 'consent', stance },
    proposalVersionHash: versionHash,
  };
}

describe('B.3 — ciclo objeción → enmienda → ronda nueva', () => {
  it('recorre las dos rondas y termina aprobando el texto enmendado', async () => {
    const config = await consentConfig(4);
    let log = await opened(config);

    // Ronda 1: dos consienten, uno objeta.
    for (const [i, stance] of [
      [0, 'consent'],
      [1, 'consent'],
      [2, 'object'],
    ] as const) {
      log = await castBallot(log, {
        eventId: eventIdAt(100 + log.length),
        at: instant(T0 + 1000 + i),
        actor: memberIdAt(i),
        ballot: consentBallot(i, stance, 1, PROPOSAL_V1),
      });
    }

    // La objeción, además, se registra como evento propio y nace ADMITIDA (B.3.a).
    log = await append(log, {
      eventId: eventIdAt(300),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 2000),
      actor: memberIdAt(2),
      payload: {
        type: 'ObjectionRaised',
        by: memberIdAt(2),
        objection: {
          objectionId: objectionIdAt(2),
          argument: ARGUMENT,
          harmedAim: 'sostener el seminario permanente',
          raisedAtRound: 1,
        },
      },
    });
    expect(replay(log).objections[0]?.status).toBe('admitted');

    // Integrar exige la firma de quien objetó.
    await expect(
      append(log, {
        eventId: eventIdAt(301),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 3000),
        actor: memberIdAt(0),
        payload: {
          type: 'ObjectionIntegrated',
          objectionId: objectionIdAt(2),
          newProposalVersionHash: PROPOSAL_V2,
          signedBy: memberIdAt(0),
        },
      }).then(replay),
    ).rejects.toThrow(/firmada por quien objetó/u);

    log = await append(log, {
      eventId: eventIdAt(302),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 3000),
      actor: memberIdAt(0),
      payload: {
        type: 'ObjectionIntegrated',
        objectionId: objectionIdAt(2),
        newProposalVersionHash: PROPOSAL_V2,
        signedBy: memberIdAt(2),
      },
    });
    expect(replay(log).objections[0]?.integrated).toBe(true);

    log = await append(log, {
      eventId: eventIdAt(303),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 4000),
      actor: 'system',
      payload: { type: 'RoundOpened', round: 2, proposalVersionHash: PROPOSAL_V2 },
    });
    expect(replay(log).round).toBe(2);
    expect(replay(log).proposalVersionHash).toBe(PROPOSAL_V2);

    // INV-09: una papeleta sobre el texto anterior ya no se acepta.
    await expect(
      castBallot(log, {
        eventId: eventIdAt(304),
        at: instant(T0 + 5000),
        actor: memberIdAt(3),
        ballot: consentBallot(3, 'consent', 1, PROPOSAL_V1),
      }),
    ).rejects.toThrow(/WRONG_ROUND|STALE_PROPOSAL_VERSION/u);

    // Ronda 2 sobre el texto enmendado.
    for (const i of [0, 1, 2]) {
      log = await castBallot(log, {
        eventId: eventIdAt(400 + log.length),
        at: instant(T0 + 6000 + i),
        actor: memberIdAt(i),
        ballot: consentBallot(i, 'consent', 2, PROPOSAL_V2),
      });
    }

    log = await closeDecision(log, {
      eventId: eventIdAt(500),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const result = await computeResult(log);
    expect(result.outcome.kind).toBe('approved');
    // Las papeletas de la ronda 1 no se arrastraron: sólo cuentan las 3 de la ronda 2.
    expect(result.turnout.cast).toBe(3);
    await expect(verifyLog(log)).resolves.toBeDefined();
  });

  it('con una objeción en pie y rondas disponibles, el desenlace es «hace falta otra ronda»', async () => {
    const config = await consentConfig(4);
    let log = await opened(config);
    for (const [i, stance] of [
      [0, 'consent'],
      [1, 'consent'],
      [2, 'object'],
    ] as const) {
      log = await castBallot(log, {
        eventId: eventIdAt(100 + log.length),
        at: instant(T0 + 1000 + i),
        actor: memberIdAt(i),
        ballot: consentBallot(i, stance, 1, PROPOSAL_V1),
      });
    }
    log = await closeDecision(log, {
      eventId: eventIdAt(600),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    expect((await computeResult(log)).outcome).toEqual({ kind: 'needs-new-round', nextRound: 2 });
  });

  it('B.3.c / INV-54 — con `maxRounds = 1`, la objeción devuelve la propuesta al círculo', async () => {
    const config = await consentConfig(4, 1);
    let log = await opened(config);
    for (const [i, stance] of [
      [0, 'consent'],
      [1, 'consent'],
      [2, 'object'],
    ] as const) {
      log = await castBallot(log, {
        eventId: eventIdAt(100 + log.length),
        at: instant(T0 + 1000 + i),
        actor: memberIdAt(i),
        ballot: consentBallot(i, stance, 1, PROPOSAL_V1),
      });
    }
    log = await closeDecision(log, {
      eventId: eventIdAt(610),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    expect((await computeResult(log)).outcome).toEqual({
      kind: 'rejected',
      reason: 'objections-pending',
    });
  });

  it('INV-54 — no se abre una ronda por encima de `maxRounds`', async () => {
    const config = await consentConfig(4, 2);
    let log = await opened(config);
    log = await castBallot(log, {
      eventId: eventIdAt(101),
      at: instant(T0 + 1000),
      actor: memberIdAt(2),
      ballot: consentBallot(2, 'object', 1, PROPOSAL_V1),
    });
    log = await append(log, {
      eventId: eventIdAt(700),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 2000),
      actor: memberIdAt(2),
      payload: {
        type: 'ObjectionRaised',
        by: memberIdAt(2),
        objection: {
          objectionId: objectionIdAt(2),
          argument: ARGUMENT,
          harmedAim: 'sostener el seminario',
          raisedAtRound: 1,
        },
      },
    });
    log = await append(log, {
      eventId: eventIdAt(701),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 3000),
      actor: memberIdAt(0),
      payload: {
        type: 'ObjectionIntegrated',
        objectionId: objectionIdAt(2),
        newProposalVersionHash: PROPOSAL_V2,
        signedBy: memberIdAt(2),
      },
    });
    log = await append(log, {
      eventId: eventIdAt(702),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 4000),
      actor: 'system',
      payload: { type: 'RoundOpened', round: 2, proposalVersionHash: PROPOSAL_V2 },
    });
    // La tercera ronda excede `maxRounds = 2`.
    await expect(
      append(log, {
        eventId: eventIdAt(703),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 5000),
        actor: 'system',
        payload: { type: 'RoundOpened', round: 3, proposalVersionHash: PROPOSAL_V3 },
      }).then(replay),
    ).rejects.toThrow(/maxRounds/u);
  });

  it('B.3.a — desestimar exige 2/3 del panel y que el panel no incluya a quien objeta', async () => {
    const config = await consentConfig(6);
    let log = await opened(config);
    log = await castBallot(log, {
      eventId: eventIdAt(101),
      at: instant(T0 + 1000),
      actor: memberIdAt(2),
      ballot: consentBallot(2, 'object', 1, PROPOSAL_V1),
    });
    log = await append(log, {
      eventId: eventIdAt(800),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 2000),
      actor: memberIdAt(2),
      payload: {
        type: 'ObjectionRaised',
        by: memberIdAt(2),
        objection: {
          objectionId: objectionIdAt(2),
          argument: ARGUMENT,
          harmedAim: 'sostener el seminario',
          raisedAtRound: 1,
        },
      },
    });

    const panel = [memberIdAt(3), memberIdAt(4), memberIdAt(5)];
    // 1 de 3 no llega a 2/3.
    await expect(
      append(log, {
        eventId: eventIdAt(801),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 3000),
        actor: 'system',
        payload: {
          type: 'ObjectionDismissed',
          objectionId: objectionIdAt(2),
          panel,
          votes: 1,
          motivation: 'la objeción expresa una preferencia, no un daño al círculo',
        },
      }).then(replay),
    ).rejects.toThrow(/desestimar exige/u);

    // El panel no puede incluir a quien objeta.
    await expect(
      append(log, {
        eventId: eventIdAt(802),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 3000),
        actor: 'system',
        payload: {
          type: 'ObjectionDismissed',
          objectionId: objectionIdAt(2),
          panel: [memberIdAt(2), memberIdAt(4), memberIdAt(5)],
          votes: 3,
          motivation: 'motivación suficiente',
        },
      }).then(replay),
    ).rejects.toThrow(/excluyendo a quien objeta/u);

    // Y desestimar sin motivación escrita tampoco vale.
    await expect(
      append(log, {
        eventId: eventIdAt(803),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 3000),
        actor: 'system',
        payload: {
          type: 'ObjectionDismissed',
          objectionId: objectionIdAt(2),
          panel,
          votes: 2,
          motivation: '   ',
        },
      }).then(replay),
    ).rejects.toThrow(/motivación escrita/u);

    const desestimada = await append(log, {
      eventId: eventIdAt(804),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 3000),
      actor: 'system',
      payload: {
        type: 'ObjectionDismissed',
        objectionId: objectionIdAt(2),
        panel,
        votes: 2,
        motivation: 'la objeción expresa una preferencia, no un daño al fin común del círculo',
      },
    });
    expect(replay(desestimada).objections[0]?.status).toBe('dismissed');
  });
});

describe('B.3 — objeciones adjuntas a la papeleta', () => {
  it('una objeción que viaja en la papeleta bloquea aunque falte su evento de registro', () => {
    const registradas: readonly ObjectionRecord[] = [];
    const merged = mergeObjections(registradas, [
      {
        voter: memberIdAt(1),
        payload: {
          kind: 'consent',
          stance: 'object',
          objection: {
            objectionId: objectionIdAt(1),
            argument: ARGUMENT,
            harmedAim: 'x',
            raisedAtRound: 1,
          },
        },
        weight: 1,
        seq: 7,
        onBehalfOf: [],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe('admitted');
    expect(merged[0]?.by).toBe(memberIdAt(1));
    expect(blockingObjections(merged)).toHaveLength(1);
  });

  it('si la objeción ya está desestimada en el log, la papeleta no la resucita', () => {
    const registradas: readonly ObjectionRecord[] = [
      {
        objectionId: objectionIdAt(1),
        by: memberIdAt(1),
        raisedAtRound: 1,
        status: 'dismissed',
        integrated: false,
        seq: 5,
      },
    ];
    const merged = mergeObjections(registradas, [
      {
        voter: memberIdAt(1),
        payload: {
          kind: 'consent',
          stance: 'object',
          objection: {
            objectionId: objectionIdAt(1),
            argument: ARGUMENT,
            harmedAim: 'x',
            raisedAtRound: 1,
          },
        },
        weight: 1,
        seq: 7,
        onBehalfOf: [],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(blockingObjections(merged)).toHaveLength(0);
  });
});

describe('B.3 — engagement', () => {
  it('se mide contra el círculo de la decisión y atribuye al representado', async () => {
    const electorate = await buildElectorate(5, { outsideMainCircle: [4] });
    expect(memberAt(electorate, memberIdAt(4))?.circles).toEqual([]);
    const { manifested, circleSize } = consentEngagement(electorate, CIRCLE_MAIN, [
      {
        voter: memberIdAt(0),
        payload: { kind: 'consent', stance: 'consent' },
        weight: 1,
        seq: 1,
        onBehalfOf: [],
      },
      {
        voter: memberIdAt(4),
        payload: { kind: 'consent', stance: 'consent' },
        weight: 1,
        seq: 2,
        onBehalfOf: [],
      },
    ]);
    // Quien no pertenece al círculo no cuenta en su manifestación.
    expect(manifested).toBe(1);
    expect(circleSize).toBe(4);
  });
});
