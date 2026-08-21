/**
 * El motor de extremo a extremo: `draft → open → cast → close → compute → ratify`.
 *
 * Cubre INV-05, INV-19, INV-20, INV-35, INV-37, INV-39 y INV-60, más la compuerta C6 sobre la orden
 * `openDecision`, que es donde la resolución del arquitecto la sitúa.
 */

import { describe, expect, it } from 'vitest';

import {
  type BallotDraft,
  type BallotPayload,
  castBallot,
  closeDecision,
  computeResult,
  type DecisionConfig,
  type DecisionLog,
  draftDecision,
  HardSecrecyUnsupported,
  IllegalTransitionError,
  instant,
  isLogChainIntact,
  openDecision,
  PreconditionError,
  ratio,
  recordResult,
  replay,
  revealSeed,
  verifyLogChain,
  verifySeedReveal,
  ZERO_HASH,
} from '../src/index.js';
import {
  ballotIdAt,
  buildConfig,
  buildElectorate,
  CLOSES_AT,
  DECISION_ID,
  eventIdAt,
  hex32,
  makeBallots,
  memberIdAt,
  PROPOSAL_ID,
  PROPOSAL_V1,
  planToMethod,
  T0,
  voteToPayload,
  type Vote,
} from './arbitraries.js';

const HOUR = 3_600_000;

async function openLog(config: DecisionConfig): Promise<DecisionLog> {
  const drafted = await draftDecision([], {
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
  return openDecision(drafted, {
    eventId: eventIdAt(2),
    at: T0,
    actor: 'system',
    config,
  });
}

function draftBallot(voterIndex: number, vote: Vote): BallotDraft {
  return {
    ballotId: ballotIdAt(voterIndex + 1),
    decisionId: DECISION_ID,
    voter: memberIdAt(voterIndex),
    round: 1,
    payload: voteToPayload(vote, voterIndex, 1),
    proposalVersionHash: PROPOSAL_V1,
  };
}

async function castMany(
  log: DecisionLog,
  votes: readonly Vote[],
  startIndex = 0,
): Promise<DecisionLog> {
  let current = log;
  for (let i = 0; i < votes.length; i++) {
    const vote = votes[i];
    if (vote === undefined) continue;
    current = await castBallot(current, {
      eventId: eventIdAt(100 + current.length),
      at: instant(T0 + 1000 + i),
      actor: memberIdAt(startIndex + i),
      ballot: draftBallot(startIndex + i, vote),
    });
  }
  return current;
}

async function simpleMajorityConfig(members = 5): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(members),
    method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
  });
}

describe('DecisionEngine — recorrido completo', () => {
  it('aprueba una mayoría simple y ratifica tras la ventana de impugnación', async () => {
    const config = await simpleMajorityConfig(5);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes', 'yes', 'no', 'abstain']);
    log = await closeDecision(log, {
      eventId: eventIdAt(200),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });

    const result = await computeResult(log);
    expect(result.outcome).toEqual({ kind: 'approved', option: config.options[0] });
    expect(result.turnout).toMatchObject({ cast: 5, represented: 5, census: 5 });
    // INV-05: el conteo corresponde al padrón congelado.
    expect(result.rollHash).toBe(config.electorate.rollHash);
    expect(result.configHash).toBe(config.configHash);

    log = await recordResult(log, {
      eventId: eventIdAt(201),
      at: CLOSES_AT,
      actor: 'system',
      result,
    });
    expect(replay(log).status).toBe('Closed');

    const ratified = await import('../src/events.js').then(async (m) =>
      m.append(log, {
        eventId: eventIdAt(202),
        decisionId: DECISION_ID,
        occurredAt: instant(CLOSES_AT + config.window.challengeWindow),
        actor: 'system',
        payload: { type: 'DecisionRatified' },
      }),
    );
    expect(replay(ratified).status).toBe('Ratified');
  });

  it('INV-19 — la cadena de hashes del log es consistente y detecta manipulación', async () => {
    const config = await simpleMajorityConfig(3);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'no', 'yes']);
    await expect(verifyLogChain(log)).resolves.toBeUndefined();
    expect(log[0]?.prevHash).toBe(ZERO_HASH);
    expect(log.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);

    // Borrar un evento del medio rompe la cadena.
    const deleted = [...log.slice(0, 2), ...log.slice(3)];
    expect(await isLogChainIntact(deleted)).toBe(false);

    // Alterar el contenido de un evento también.
    const head = log[3];
    if (head === undefined) throw new Error('log incompleto');
    const abstencion: BallotPayload = { kind: 'abstain' };
    const tampered: DecisionLog = log.map((e, i) =>
      i === 3 && e.payload.type === 'BallotCast'
        ? {
            ...e,
            payload: {
              ...e.payload,
              ballot: { ...e.payload.ballot, payload: abstencion },
            },
          }
        : e,
    );
    expect(await isLogChainIntact(tampered)).toBe(false);
  });

  it('INV-20 — el resultHash recomputado coincide con el almacenado', async () => {
    const config = await simpleMajorityConfig(4);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes', 'no', 'abstain']);
    log = await closeDecision(log, {
      eventId: eventIdAt(210),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const first = await computeResult(log);
    log = await recordResult(log, {
      eventId: eventIdAt(211),
      at: CLOSES_AT,
      actor: 'system',
      result: first,
    });
    const recomputed = await computeResult(log);
    const anchored = log.at(-1);
    if (anchored?.payload.type !== 'ResultComputed') throw new Error('falta ResultComputed');
    expect(recomputed.resultHash).toBe(anchored.payload.resultHash);
    // Y el ancla no depende de haber añadido el propio evento de anclaje.
    expect(recomputed.resultHash).toBe(first.resultHash);
  });

  it('INV-35 / INV-37 — una decisión cerrada no muta y no se reabre', async () => {
    const config = await simpleMajorityConfig(3);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes']);
    log = await closeDecision(log, {
      eventId: eventIdAt(220),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const before = await computeResult(log);

    await expect(
      castBallot(log, {
        eventId: eventIdAt(221),
        at: instant(T0 + 2000),
        actor: memberIdAt(2),
        ballot: draftBallot(2, 'no'),
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    await expect(
      openDecision(log, { eventId: eventIdAt(222), at: T0, actor: 'system', config }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    const after = await computeResult(log);
    expect(after.resultHash).toBe(before.resultHash);
  });

  it('INV-39 — sin quórum no se publica el resultado del método', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(10),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      quorum: {
        participation: ratio(1, 2),
        onFailure: 'reject',
        maxExtensions: 0,
        extensionDuration: 0,
      },
    });
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes']); // 2 de 10 = 20 %
    log = await closeDecision(log, {
      eventId: eventIdAt(230),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const result = await computeResult(log);

    expect(result.outcome.kind).toBe('no-quorum');
    expect(result.quorumCheck.passed).toBe(false);
    expect(result.proof.tables).toHaveLength(0);
    const claims = result.proof.steps.map((s) => s.claim).join(' ');
    expect(claims).not.toMatch(/aprueba|rechaza/i);
    expect(result.proof.narrative).toContain('no produce mandato');
  });

  it('D.2 — el tick de cierre emite EXACTAMENTE UNO de {WindowExtended, DecisionClosed}', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(10),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      quorum: {
        participation: ratio(1, 2),
        onFailure: 'extend',
        maxExtensions: 1,
        extensionDuration: 24 * HOUR,
      },
    });
    let log = await openLog(config);
    log = await castMany(log, ['yes']);

    log = await closeDecision(log, {
      eventId: eventIdAt(240),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const extended = log.at(-1);
    expect(extended?.payload.type).toBe('WindowExtended');
    // La precisión de D.2: el tick lleva `occurredAt === closesAt`.
    expect(extended?.occurredAt).toBe(CLOSES_AT);
    const state = replay(log);
    expect(state.status).toBe('Open');
    expect(state.extensionsUsed).toBe(1);
    expect(state.closesAt).toBe(CLOSES_AT + 24 * HOUR);

    // Agotada la prórroga, el tick siguiente cierra.
    log = await closeDecision(log, {
      eventId: eventIdAt(241),
      at: instant(CLOSES_AT + 24 * HOUR),
      actor: 'system',
      cause: 'window',
    });
    expect(log.at(-1)?.payload.type).toBe('DecisionClosed');
    expect(replay(log).status).toBe('Closed');
    expect((await computeResult(log)).outcome.kind).toBe('no-quorum');
  });

  it('D.2.b — la prórroga no invalida las papeletas ya emitidas ni recongela el padrón', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(4),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      quorum: {
        participation: ratio(3, 4),
        onFailure: 'extend',
        maxExtensions: 1,
        extensionDuration: 24 * HOUR,
      },
    });
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes']);
    const rollBefore = replay(log).config?.electorate.rollHash;

    log = await closeDecision(log, {
      eventId: eventIdAt(250),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    expect(replay(log).ballots).toHaveLength(2);
    expect(replay(log).config?.electorate.rollHash).toBe(rollBefore);

    // Vota alguien más durante la prórroga y ahora sí hay quórum.
    log = await castBallot(log, {
      eventId: eventIdAt(251),
      at: instant(CLOSES_AT + 1000),
      actor: memberIdAt(2),
      ballot: draftBallot(2, 'yes'),
    });
    log = await closeDecision(log, {
      eventId: eventIdAt(252),
      at: instant(CLOSES_AT + 24 * HOUR),
      actor: 'system',
      cause: 'window',
    });
    const result = await computeResult(log);
    expect(result.quorumCheck.passed).toBe(true);
    expect(result.outcome.kind).toBe('approved');
    expect(result.turnout.cast).toBe(3);
  });

  it('C6 — openDecision rechaza SIEMPRE el secreto duro', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      privacy: 'sealed-tally',
    });
    // La compuerta mira `privacy`, no cómo se construyó la configuración.
    const secret = { ...config, privacy: 'secret-ballot' as const };
    const drafted = await draftDecision([], {
      eventId: eventIdAt(1),
      at: instant(T0 - 1000),
      actor: 'system',
      decisionId: DECISION_ID,
      draft: {
        proposalId: PROPOSAL_ID,
        proposalVersionHash: PROPOSAL_V1,
        summary: 'Elegir la representación estudiantil',
      },
    });
    await expect(
      openDecision(drafted, { eventId: eventIdAt(2), at: T0, actor: 'system', config: secret }),
    ).rejects.toBeInstanceOf(HardSecrecyUnsupported);
  });

  it('B.0.3 — la semilla revelada debe corresponder al compromiso', async () => {
    const config = await simpleMajorityConfig(3);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes']);
    log = await closeDecision(log, {
      eventId: eventIdAt(260),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    await expect(
      revealSeed(log, {
        eventId: eventIdAt(261),
        at: CLOSES_AT,
        actor: 'system',
        seedAdmin: 'una semilla cualquiera',
        beaconValue: 'bloque 900000',
      }),
    ).rejects.toThrow(/no corresponde al compromiso/u);
    await expect(verifySeedReveal(config, 'otra')).rejects.toThrow(/compromiso/u);
  });

  it('rechaza el escrutinio de una decisión que sigue abierta', async () => {
    const config = await simpleMajorityConfig(3);
    const log = await castMany(await openLog(config), ['yes']);
    await expect(computeResult(log)).rejects.toBeInstanceOf(PreconditionError);
  });

  it('INV-15 — el escrutinio no lee el reloj: el resultado no depende de cuándo se calcule', async () => {
    const config = await simpleMajorityConfig(3);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes', 'no']);
    log = await closeDecision(log, {
      eventId: eventIdAt(270),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const first = await computeResult(log);
    const second = await computeResult(log);
    expect(second).toEqual(first);
  });

  it('A.2 — anular una papeleta exige dos firmas y motivación, y sólo se puede estando Open', async () => {
    const config = await simpleMajorityConfig(3);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'yes', 'no']);
    const events = await import('../src/events.js');

    await expect(
      events
        .append(log, {
          eventId: eventIdAt(280),
          decisionId: DECISION_ID,
          occurredAt: instant(T0 + 5000),
          actor: 'system',
          payload: {
            type: 'BallotVoided',
            ballotId: ballotIdAt(1),
            motivation: 'suplantación acreditada',
            signers: [memberIdAt(1)],
          },
        })
        .then((next) => replay(next)),
    ).rejects.toThrow(/dos miembros/u);

    const voided = await events.append(log, {
      eventId: eventIdAt(281),
      decisionId: DECISION_ID,
      occurredAt: instant(T0 + 5000),
      actor: 'system',
      payload: {
        type: 'BallotVoided',
        ballotId: ballotIdAt(1),
        motivation: 'suplantación acreditada por el círculo de garantías',
        signers: [memberIdAt(1), memberIdAt(2)],
      },
    });
    const closed = await closeDecision(voided, {
      eventId: eventIdAt(282),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const result = await computeResult(closed);
    expect(result.turnout.cast).toBe(2);
  });

  it('las papeletas duplicadas del mismo votante no duplican el peso (INV-07/INV-08)', async () => {
    const config = await simpleMajorityConfig(3);
    let log = await openLog(config);
    // El votante 0 cambia de opinión dos veces; manda la última.
    log = await castBallot(log, {
      eventId: eventIdAt(300),
      at: instant(T0 + 1000),
      actor: memberIdAt(0),
      ballot: { ...draftBallot(0, 'yes'), ballotId: ballotIdAt(90) },
    });
    log = await castBallot(log, {
      eventId: eventIdAt(301),
      at: instant(T0 + 2000),
      actor: memberIdAt(0),
      ballot: { ...draftBallot(0, 'no'), ballotId: ballotIdAt(91) },
    });
    log = await closeDecision(log, {
      eventId: eventIdAt(302),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    const result = await computeResult(log);
    expect(result.turnout.cast).toBe(1);
    expect(result.weights.totalWeight).toBe(1);
    expect(result.outcome).toEqual({ kind: 'rejected', reason: 'threshold-not-met' });
  });

  it('el orden de replay es por seq y produce siempre el mismo estado', async () => {
    const config = await simpleMajorityConfig(3);
    let log = await openLog(config);
    log = await castMany(log, ['yes', 'no', 'abstain']);
    const state = replay(log);
    expect(state.lastSeq).toBe(log.length);
    expect(state.ballots.map((b) => b.seq)).toEqual([3, 4, 5]);
    expect(makeBallots([{ voterIndex: 0, vote: 'yes' }])[0]?.seq).toBe(1);
    expect(hex32(1)).toBe('00000000000000000000000000000001');
  });
});
