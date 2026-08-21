/**
 * Un recorrido de decisión REAL, producido por `@koinonia/domain`.
 *
 * No se fabrican eventos a mano: se ejecutan las órdenes del motor —`draftDecision`, `openDecision`,
 * `castBallot`, `closeDecision`, `recordResult`— y lo que sale es un `DecisionLog` con su cadena de
 * hashes propia. Es la única forma de que la prueba de persistencia demuestre algo: si el log fuera
 * inventado, comprobar que se guarda y se lee bien no diría nada sobre el sistema de verdad.
 *
 * Se reutiliza el catálogo de generadores de `packages/domain/test/arbitraries.ts` en lugar de
 * duplicarlo: construir a mano una `DecisionConfig` válida exige acertar con una docena de
 * validaciones cruzadas, y una configuración inválida convertiría el test en un test del test.
 */

import {
  castBallot,
  closeDecision,
  computeResult,
  type DecisionConfig,
  type DecisionLog,
  type DecisionResult,
  draftDecision,
  instant,
  openDecision,
  recordResult,
} from '@koinonia/domain';

import {
  ballotIdAt,
  buildConfig,
  buildElectorate,
  CLOSES_AT,
  DECISION_ID,
  eventIdAt,
  memberIdAt,
  planToMethod,
  PROPOSAL_ID,
  PROPOSAL_V1,
  T0,
  voteToPayload,
  type Vote,
} from '../../../packages/domain/test/arbitraries.js';

export { CLOSES_AT, DECISION_ID, memberIdAt, PROPOSAL_V1, T0 };

export interface DecisionFixture {
  readonly log: DecisionLog;
  readonly config: DecisionConfig;
  readonly result: DecisionResult;
  readonly votes: readonly Vote[];
}

/** Recorrido completo: borrador → apertura → papeletas → cierre → escrutinio → resultado anclado. */
export async function buildFullDecision(
  votes: readonly Vote[] = ['yes', 'yes', 'yes', 'no', 'abstain'],
): Promise<DecisionFixture> {
  const config = await buildConfig({
    electorate: await buildElectorate(votes.length),
    method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
  });

  let log = await draftDecision([], {
    eventId: eventIdAt(1),
    at: instant(T0 - 1000),
    actor: 'system',
    decisionId: DECISION_ID,
    draft: {
      proposalId: PROPOSAL_ID,
      proposalVersionHash: PROPOSAL_V1,
      summary: 'Aprobar el acta de la asamblea anterior',
    },
  });

  log = await openDecision(log, { eventId: eventIdAt(2), at: T0, actor: 'system', config });

  for (const [i, vote] of votes.entries()) {
    log = await castBallot(log, {
      eventId: eventIdAt(100 + i),
      at: instant(T0 + 1000 + i),
      actor: memberIdAt(i),
      ballot: {
        ballotId: ballotIdAt(i + 1),
        decisionId: DECISION_ID,
        voter: memberIdAt(i),
        round: 1,
        payload: voteToPayload(vote, i, 1),
        proposalVersionHash: PROPOSAL_V1,
      },
    });
  }

  log = await closeDecision(log, {
    eventId: eventIdAt(200),
    at: CLOSES_AT,
    actor: 'system',
    cause: 'window',
  });

  const result = await computeResult(log);

  log = await recordResult(log, {
    eventId: eventIdAt(201),
    at: instant(CLOSES_AT + 1000),
    actor: 'system',
    result,
  });

  return { log, config, result, votes };
}
