/**
 * `ObjectionDismissed` compuesto con `sortObjectionPanel` (B.3.a, ADR-0031, ADR-0032).
 *
 * `packages/domain/src/engine.ts` (caso `ObjectionDismissed`) ya valida panel exacto, exclusión de
 * quien objeta, dos tercios y motivación no vacía; lo nuevo es `sortObjectionPanel`
 * (`packages/domain/src/sortition-panel.ts`), que es de donde sale el panel que se le pasa. Este
 * fichero comprueba que las dos piezas encajan: que un panel real, sorteado con la semilla revelada,
 * es justo lo que el motor acepta, y que el motor sigue rechazando lo que ya rechazaba cuando el
 * panel no viene de un sorteo limpio.
 */

import { describe, expect, it } from 'vitest';

import {
  append,
  type BallotDraft,
  blockingObjections,
  castBallot,
  type DecisionLog,
  draftDecision,
  instant,
  openDecision,
  PreconditionError,
  replay,
  sortObjectionPanel,
} from '../src/index.js';
import {
  ARGUMENT,
  ballotIdAt,
  buildConfig,
  buildElectorate,
  CIRCLE_MAIN,
  DECISION_ID,
  eventIdAt,
  memberIdAt,
  objectionIdAt,
  planToMethod,
  PROPOSAL_ID,
  PROPOSAL_V1,
  T0,
} from './arbitraries.js';

const SEED = 'semilla-administrativa-de-prueba|faro-posterior-al-cierre';
const OBJECTOR = memberIdAt(2);
const OBJECTION = objectionIdAt(2);

async function config() {
  // Cuatro miembros del círculo: quien objeta y exactamente los tres que puede sortear el panel
  // (panelSize = 3, fijo en `planToMethod`), para que la exclusión del objetante sea observable:
  // si excluyera mal, la bolsa tendría 4 y el panel podría completar sin necesitar a los tres.
  return buildConfig({
    electorate: await buildElectorate(4),
    method: planToMethod({
      kind: 'sociocratic-consent',
      maxRounds: 3,
      minEngagementNum: 1,
      minEngagementDen: 2,
    }),
  });
}

async function openedWithObjection(): Promise<DecisionLog> {
  const cfg = await config();
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
  let log = await openDecision(drafted, {
    eventId: eventIdAt(2),
    at: T0,
    actor: 'system',
    config: cfg,
  });

  const ballot: BallotDraft = {
    ballotId: ballotIdAt(1),
    decisionId: DECISION_ID,
    voter: OBJECTOR,
    round: 1,
    payload: {
      kind: 'consent',
      stance: 'object',
      objection: {
        objectionId: OBJECTION,
        argument: ARGUMENT,
        harmedAim: 'sostener el seminario permanente',
        raisedAtRound: 1,
      },
    },
    proposalVersionHash: PROPOSAL_V1,
  };
  log = await castBallot(log, {
    eventId: eventIdAt(3),
    at: instant(T0 + 1000),
    actor: OBJECTOR,
    ballot,
  });

  // B.3.a: además del voto, la objeción se registra con su propio evento y nace admitida.
  log = await append(log, {
    eventId: eventIdAt(4),
    decisionId: DECISION_ID,
    occurredAt: instant(T0 + 1000),
    actor: OBJECTOR,
    payload: {
      type: 'ObjectionRaised',
      by: OBJECTOR,
      objection: {
        objectionId: OBJECTION,
        argument: ARGUMENT,
        harmedAim: 'sostener el seminario permanente',
        raisedAtRound: 1,
      },
    },
  });
  return log;
}

const MOTIVACION =
  'El panel considera que el objetivo dañado ya está cubierto por el plan aprobado del círculo.';

describe('ObjectionDismissed con un panel sorteado de verdad', () => {
  it('un panel sorteado, con 2/3, desestima la objeción y deja de bloquear', async () => {
    const log = await openedWithObjection();
    const cfg = await config();
    const { panel } = await sortObjectionPanel({
      electorate: cfg.electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED,
    });
    expect(panel).toHaveLength(3);
    expect(panel).not.toContain(OBJECTOR);

    const dismissed = await append(log, {
      eventId: eventIdAt(5),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 2000),
      actor: panel[0] ?? OBJECTOR,
      payload: {
        type: 'ObjectionDismissed',
        objectionId: OBJECTION,
        panel,
        votes: 2, // 2 de 3 ⟹ exactamente 2/3.
        motivation: MOTIVACION,
      },
    });
    const state = replay(dismissed);
    expect(state.objections[0]?.status).toBe('dismissed');
    expect(blockingObjections(state.objections)).toHaveLength(0);
  });

  it('un panel de tamaño equivocado se rechaza, aunque venga de un sorteo real', async () => {
    const log = await openedWithObjection();
    const cfg = await config();
    const { panel } = await sortObjectionPanel({
      electorate: cfg.electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED,
    });
    const panelCorto = panel.slice(0, 2); // Dos en vez de tres.
    await expect(
      append(log, {
        eventId: eventIdAt(5),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 2000),
        actor: panel[0] ?? OBJECTOR,
        payload: {
          type: 'ObjectionDismissed',
          objectionId: OBJECTION,
          panel: panelCorto,
          votes: 2,
          motivation: MOTIVACION,
        },
      }).then(replay),
    ).rejects.toThrow(PreconditionError);
  });

  it('B.3.a — quien objeta no puede estar en su propio panel, ni siquiera fabricado a mano', async () => {
    const log = await openedWithObjection();
    // Bolsa completa del círculo (4), de la que se toma un panel de 3 CON el objetante incluido a
    // mano: es exactamente lo que el sorteo real nunca produciría (ver `sortition-panel.test.ts`),
    // pero el motor tiene que rechazarlo igual, porque no confía en que el llamador sorteó bien.
    const panelConObjetante = [memberIdAt(0), memberIdAt(1), OBJECTOR].sort();
    await expect(
      append(log, {
        eventId: eventIdAt(5),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 2000),
        actor: memberIdAt(0),
        payload: {
          type: 'ObjectionDismissed',
          objectionId: OBJECTION,
          panel: panelConObjetante,
          votes: 2,
          motivation: MOTIVACION,
        },
      }).then(replay),
    ).rejects.toThrow(PreconditionError);
  });

  it('sin dos tercios del panel, la objeción sigue en pie y bloqueando', async () => {
    const log = await openedWithObjection();
    const cfg = await config();
    const { panel } = await sortObjectionPanel({
      electorate: cfg.electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED,
    });
    await expect(
      append(log, {
        eventId: eventIdAt(5),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 2000),
        actor: panel[0] ?? OBJECTOR,
        payload: {
          type: 'ObjectionDismissed',
          objectionId: OBJECTION,
          panel,
          votes: 1, // 1 de 3: no alcanza 2/3.
          motivation: MOTIVACION,
        },
      }).then(replay),
    ).rejects.toThrow(PreconditionError);

    // El log SIN el intento fallido (que nunca llegó a persistirse) sigue admitida y bloqueante.
    const state = replay(log);
    expect(state.objections[0]?.status).toBe('admitted');
    expect(blockingObjections(state.objections)).toHaveLength(1);
  });

  it('motivación vacía no desestima, aunque el panel y los votos alcancen', async () => {
    const log = await openedWithObjection();
    const cfg = await config();
    const { panel } = await sortObjectionPanel({
      electorate: cfg.electorate,
      circleId: CIRCLE_MAIN,
      objectionId: OBJECTION,
      objector: OBJECTOR,
      panelSize: 3,
      seed: SEED,
    });
    await expect(
      append(log, {
        eventId: eventIdAt(5),
        decisionId: DECISION_ID,
        occurredAt: instant(T0 + 2000),
        actor: panel[0] ?? OBJECTOR,
        payload: {
          type: 'ObjectionDismissed',
          objectionId: OBJECTION,
          panel,
          votes: 3,
          motivation: '   ',
        },
      }).then(replay),
    ).rejects.toThrow(PreconditionError);
  });
});
