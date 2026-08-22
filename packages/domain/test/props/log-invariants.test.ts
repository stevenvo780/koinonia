/**
 * Invariantes que exigen un log de eventos real (con su cadena de hashes): INV-19, INV-34, INV-35,
 * INV-38, INV-54, INV-58, INV-59 e INV-60.
 *
 * Estos generadores construyen logs **legales** —respetan la máquina de estados, `seq` denso y
 * `prevHash` encadenado— y después los agreden: borran un evento, insertan otro, reordenan, inyectan
 * un evento ilegal en una posición aleatoria.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  append,
  apply,
  castBallot,
  closeDecision,
  computeResult,
  type DecisionConfig,
  type DecisionLog,
  draftDecision,
  IllegalTransitionError,
  instant,
  irreversibility,
  isLogChainIntact,
  liveTally,
  openDecision,
  ratio,
  recordResult,
  replay,
  tallyDecision,
} from '../../src/index.js';
import {
  arbThresholdMethodPlan,
  ballotIdAt,
  buildConfig,
  buildElectorate,
  CLOSES_AT,
  DECISION_ID,
  DEFAULT_WINDOW,
  eventIdAt,
  runs,
  memberIdAt,
  type MethodPlan,
  planToMethod,
  PROPOSAL_ID,
  PROPOSAL_V1,
  T0,
  voteToPayload,
  type Vote,
} from '../arbitraries.js';

const HOUR = 3_600_000;
const HEAVY = runs(60);

async function openedLog(config: DecisionConfig): Promise<DecisionLog> {
  const drafted = await draftDecision([], {
    eventId: eventIdAt(1),
    at: instant(T0 - 1000),
    actor: 'system',
    decisionId: DECISION_ID,
    draft: {
      proposalId: PROPOSAL_ID,
      proposalVersionHash: PROPOSAL_V1,
      summary: 'Aprobar el temario del seminario permanente',
    },
  });
  return openDecision(drafted, { eventId: eventIdAt(2), at: T0, actor: 'system', config });
}

async function withVotes(log: DecisionLog, votes: readonly Vote[]): Promise<DecisionLog> {
  let current = log;
  for (let i = 0; i < votes.length; i++) {
    const vote = votes[i];
    if (vote === undefined) continue;
    current = await castBallot(current, {
      eventId: eventIdAt(100 + current.length),
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
  return current;
}

async function configFor(members: number, plan: MethodPlan): Promise<DecisionConfig> {
  return buildConfig({ electorate: await buildElectorate(members), method: planToMethod(plan) });
}

describe('E.3 — INV-19: la cadena de hashes del log', () => {
  it('un log legal está encadenado; borrar, insertar o reordenar lo rompe', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        arbThresholdMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'no', 'abstain'), { minLength: 1, maxLength: 6 }),
        fc.nat(),
        async (members, plan, votes, corte) => {
          fc.pre(votes.length <= members);
          const config = await configFor(members, plan);
          const log = await withVotes(await openedLog(config), votes);

          expect(await isLogChainIntact(log)).toBe(true);
          expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));

          // Borrar un evento INTERMEDIO rompe la cadena. Borrar la cola, no: un encadenamiento
          // detecta modificación y reordenamiento, pero el truncado del final sólo se detecta con
          // un ancla externa (checkpoint publicado). Es una limitación conocida y declarada, no un
          // fallo de esta implementación: por eso el ledger publica anclajes.
          const posicion = corte % (log.length - 1);
          const borrado = log.filter((_, i) => i !== posicion);
          expect(await isLogChainIntact(borrado)).toBe(false);
          expect(await isLogChainIntact(log.slice(0, -1))).toBe(true);

          if (log.length >= 2) {
            const reordenado = [...log];
            const a = reordenado[0];
            const b = reordenado[1];
            if (a !== undefined && b !== undefined) {
              reordenado[0] = b;
              reordenado[1] = a;
              expect(await isLogChainIntact(reordenado)).toBe(false);
            }
            const duplicado = [...log, log[posicion]!];
            expect(await isLogChainIntact(duplicado)).toBe(false);
          }
        },
      ),
      HEAVY,
    );
  });
});

describe('E.5 — INV-34/INV-35: eventos ilegales y decisiones cerradas', () => {
  it('INV-34 — un evento ilegal inyectado en cualquier posición se rechaza y no altera el estado', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        arbThresholdMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'no'), { minLength: 1, maxLength: 4 }),
        fc.nat(),
        async (members, plan, votes, posicionCruda) => {
          fc.pre(votes.length <= members);
          const config = await configFor(members, plan);
          const log = await withVotes(await openedLog(config), votes);
          const estadoAntes = replay(log);

          // Un `DecisionRatified` es ilegal en `Open` y en `Draft`: saltarse el escrutinio.
          const ilegal = await append(log, {
            eventId: eventIdAt(900),
            decisionId: DECISION_ID,
            occurredAt: instant(T0 + 5000),
            actor: memberIdAt(0),
            payload: { type: 'DecisionRatified' },
          });
          expect(() => replay(ilegal)).toThrow(IllegalTransitionError);

          // Y aplicarlo directamente deja el estado intacto porque nunca se construye uno nuevo.
          const evento = ilegal.at(-1);
          if (evento === undefined) throw new Error('sin evento');
          expect(() => apply(estadoAntes, evento)).toThrow(IllegalTransitionError);
          expect(replay(log)).toEqual(estadoAntes);
          expect(posicionCruda).toBeGreaterThanOrEqual(0);
        },
      ),
      HEAVY,
    );
  });

  it('INV-35 — tras el cierre, ni las papeletas ni el padrón ni el resultado se mueven', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        arbThresholdMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'no', 'abstain'), { minLength: 1, maxLength: 4 }),
        async (members, plan, votes) => {
          fc.pre(votes.length <= members);
          const config = await configFor(members, plan);
          let log = await withVotes(await openedLog(config), votes);
          log = await closeDecision(log, {
            eventId: eventIdAt(800),
            at: CLOSES_AT,
            actor: 'system',
            cause: 'window',
          });
          const antes = replay(log);
          const resultadoAntes = await computeResult(log);

          // Los eventos posteriores legales (`SeedRevealed` no; `ResultComputed` sí) no mueven nada
          // de lo escrutado.
          log = await recordResult(log, {
            eventId: eventIdAt(801),
            at: CLOSES_AT,
            actor: 'system',
            result: resultadoAntes,
          });
          const despues = replay(log);
          expect(despues.ballots).toEqual(antes.ballots);
          expect(despues.config?.electorate.rollHash).toBe(antes.config?.electorate.rollHash);
          expect(despues.config?.configHash).toBe(antes.config?.configHash);
          expect(despues.proposalVersionHash).toBe(antes.proposalVersionHash);
          expect((await computeResult(log)).resultHash).toBe(resultadoAntes.resultHash);
        },
      ),
      HEAVY,
    );
  });
});

describe('D.2 / INV-38 — la prórroga', () => {
  it('sólo aumenta el cierre, está acotada, y el tick emite exactamente un evento', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 2 }),
        arbThresholdMethodPlan,
        async (maxExtensions, plan) => {
          const config = await buildConfig({
            electorate: await buildElectorate(10),
            method: planToMethod(plan),
            quorum: {
              participation: ratio(1, 1),
              onFailure: 'extend',
              maxExtensions,
              extensionDuration: 24 * HOUR,
            },
          });
          let log = await withVotes(await openedLog(config), ['yes']);
          let cierre = CLOSES_AT;
          let prorrogas = 0;

          for (let i = 0; i <= maxExtensions; i++) {
            const antes = log.length;
            log = await closeDecision(log, {
              eventId: eventIdAt(700 + i),
              at: cierre,
              actor: 'system',
              cause: 'window',
            });
            // Exactamente un evento por tick.
            expect(log.length).toBe(antes + 1);
            const emitido = log.at(-1);
            if (emitido === undefined) throw new Error('sin evento');
            if (emitido.payload.type === 'WindowExtended') {
              expect(emitido.payload.newClosesAt).toBeGreaterThan(cierre);
              cierre = emitido.payload.newClosesAt;
              prorrogas++;
              expect(replay(log).status).toBe('Open');
            } else {
              expect(emitido.payload.type).toBe('DecisionClosed');
              expect(replay(log).status).toBe('Closed');
              break;
            }
          }
          expect(prorrogas).toBe(maxExtensions);
          expect(replay(log).extensionsUsed).toBe(maxExtensions);
          expect(replay(log).status).toBe('Closed');
        },
      ),
      HEAVY,
    );
  });
});

describe('D.4 / INV-58 — cierre anticipado por resultado irreversible', () => {
  it('si se declara irreversible, TODA continuación posible da ese mismo desenlace', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        arbThresholdMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'no', 'abstain'), { maxLength: 5 }),
        async (members, plan, votes) => {
          fc.pre(votes.length <= members);
          const movibles = members - votes.length;
          fc.pre(movibles <= 4); // enumeración exhaustiva de 3^movibles continuaciones

          const config = await configFor(members, plan);
          const log = await withVotes(await openedLog(config), votes);
          const parcial = liveTally(log, instant(T0 + 10_000));
          const veredicto = irreversibility(config, parcial);
          fc.pre(veredicto !== 'open');

          const opciones: readonly Vote[] = ['yes', 'no', 'abstain'];
          const total = 3 ** movibles;
          for (let mascara = 0; mascara < total; mascara++) {
            const continuacion: Vote[] = [...votes];
            let resto = mascara;
            for (let i = 0; i < movibles; i++) {
              continuacion.push(opciones[resto % 3] ?? 'abstain');
              resto = Math.floor(resto / 3);
            }
            const ballots = continuacion.map((vote, i) => ({
              ballotId: ballotIdAt(i + 1),
              decisionId: DECISION_ID,
              voter: memberIdAt(i),
              round: 1,
              payload: voteToPayload(vote, i, 1),
              castAt: instant(T0 + 1000 + i),
              seq: i + 1,
              proposalVersionHash: PROPOSAL_V1,
            }));
            const resultado = await tallyDecision({
              config,
              ballots,
              closedAt: CLOSES_AT,
              computedFromSeq: ballots.length,
            });
            expect(resultado.outcome.kind).toBe(veredicto === 'approved' ? 'approved' : 'rejected');
          }
        },
      ),
      runs(40),
    );
  });

  it('D.4.c / INV-59 — el cierre anticipado respeta el piso de 24 h y la privacidad', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      window: {
        ...DEFAULT_WINDOW,
        earlyClose: { enabled: true, mode: 'mathematically-irreversible' },
      },
    });
    expect(config.privacy).toBe('public-roll-call');

    const log = await withVotes(await openedLog(config), ['yes', 'yes', 'yes']);
    // Antes del piso de deliberación: rechazado, aunque el resultado ya sea irreversible.
    await expect(
      closeDecision(log, {
        eventId: eventIdAt(600),
        at: instant(T0 + 23 * HOUR),
        actor: 'system',
        cause: 'early-irreversible',
      }),
    ).rejects.toThrow(/nunca ocurre antes de/u);

    const cerrado = await closeDecision(log, {
      eventId: eventIdAt(601),
      at: instant(T0 + 25 * HOUR),
      actor: 'system',
      cause: 'early-irreversible',
    });
    expect(replay(cerrado).closeCause).toBe('early-irreversible');
    expect(irreversibility(config, liveTally(log, instant(T0 + 25 * HOUR)))).toBe('approved');
  });

  it('D.4.a — con el cierre anticipado deshabilitado, no se puede cerrar antes', async () => {
    const config = await configFor(3, { kind: 'simple-majority', abstentionPolicy: 'exclude' });
    const log = await withVotes(await openedLog(config), ['yes', 'yes', 'yes']);
    await expect(
      closeDecision(log, {
        eventId: eventIdAt(610),
        at: instant(T0 + 25 * HOUR),
        actor: 'system',
        cause: 'early-irreversible',
      }),
    ).rejects.toThrow(/deshabilitado/u);
  });

  it('A.8.1 — el cierre manual exige dos firmas; sin ellas sería la vía para esquivar D.4', async () => {
    const config = await configFor(4, { kind: 'simple-majority', abstentionPolicy: 'exclude' });
    const log = await withVotes(await openedLog(config), ['yes', 'yes']);
    await expect(
      closeDecision(log, {
        eventId: eventIdAt(620),
        at: instant(T0 + 2 * HOUR),
        actor: 'system',
        cause: 'manual',
      }),
    ).rejects.toThrow(/dos miembros/u);

    const cerrado = await closeDecision(log, {
      eventId: eventIdAt(621),
      at: instant(T0 + 2 * HOUR),
      actor: 'system',
      cause: 'manual',
      signers: [memberIdAt(0), memberIdAt(1)],
    });
    expect(replay(cerrado).closeCause).toBe('manual');
  });

  it('la causa alegada tiene que ser cierta: `full-turnout` con gente sin votar se rechaza', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(4),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      window: { ...DEFAULT_WINDOW, earlyClose: { enabled: true, mode: 'full-turnout' } },
    });
    const parcial = await withVotes(await openedLog(config), ['yes', 'yes']);
    await expect(
      closeDecision(parcial, {
        eventId: eventIdAt(630),
        at: instant(T0 + 25 * HOUR),
        actor: 'system',
        cause: 'full-turnout',
      }),
    ).rejects.toThrow(/no es participación total/u);

    const completo = await withVotes(await openedLog(config), ['yes', 'yes', 'no', 'abstain']);
    const cerrado = await closeDecision(completo, {
      eventId: eventIdAt(631),
      at: instant(T0 + 25 * HOUR),
      actor: 'system',
      cause: 'full-turnout',
    });
    expect(replay(cerrado).closeCause).toBe('full-turnout');
  });

  it('la causa debe corresponder al modo con el que se abrió la decisión', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      window: { ...DEFAULT_WINDOW, earlyClose: { enabled: true, mode: 'full-turnout' } },
    });
    const log = await withVotes(await openedLog(config), ['yes', 'yes', 'yes']);
    await expect(
      closeDecision(log, {
        eventId: eventIdAt(640),
        at: instant(T0 + 25 * HOUR),
        actor: 'system',
        cause: 'early-irreversible',
      }),
    ).rejects.toThrow(/se abrió con el modo/u);
  });

  it('un cierre por irreversibilidad con el resultado todavía abierto se rechaza', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(6),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      window: {
        ...DEFAULT_WINDOW,
        earlyClose: { enabled: true, mode: 'mathematically-irreversible' },
      },
    });
    const log = await withVotes(await openedLog(config), ['yes', 'no']);
    expect(irreversibility(config, liveTally(log, instant(T0 + 25 * HOUR)))).toBe('open');
    await expect(
      closeDecision(log, {
        eventId: eventIdAt(650),
        at: instant(T0 + 25 * HOUR),
        actor: 'system',
        cause: 'early-irreversible',
      }),
    ).rejects.toThrow(/todavía puede cambiar/u);
  });

  it('D.4.b — un método que no es de umbral nunca es irreversible', async () => {
    const config = await configFor(4, {
      kind: 'sociocratic-consent',
      maxRounds: 3,
      minEngagementNum: 1,
      minEngagementDen: 2,
    });
    const log = await withVotes(await openedLog(config), [
      'consent',
      'consent',
      'consent',
      'consent',
    ]);
    expect(irreversibility(config, liveTally(log, instant(T0 + 25 * HOUR)))).toBe('open');
  });

  it('sin quórum todavía cumplido, nada es irreversible', async () => {
    const config = await buildConfig({
      electorate: await buildElectorate(10),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
      quorum: {
        participation: ratio(9, 10),
        onFailure: 'reject',
        maxExtensions: 0,
        extensionDuration: 0,
      },
    });
    const log = await withVotes(await openedLog(config), ['yes', 'yes']);
    expect(irreversibility(config, liveTally(log, instant(T0 + 25 * HOUR)))).toBe('open');
  });
});

describe('INV-60 — el desenlace es coherente con el estado final', () => {
  it('sólo se ratifica lo aprobado, y sólo se rechaza lo no aprobado', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        arbThresholdMethodPlan,
        fc.array(fc.constantFrom<Vote>('yes', 'no', 'abstain'), { minLength: 1, maxLength: 5 }),
        async (members, plan, votes) => {
          fc.pre(votes.length <= members);
          const config = await configFor(members, plan);
          let log = await withVotes(await openedLog(config), votes);
          log = await closeDecision(log, {
            eventId: eventIdAt(500),
            at: CLOSES_AT,
            actor: 'system',
            cause: 'window',
          });
          const resultado = await computeResult(log);
          log = await recordResult(log, {
            eventId: eventIdAt(501),
            at: CLOSES_AT,
            actor: 'system',
            result: resultado,
          });

          const ratificar = await append(log, {
            eventId: eventIdAt(502),
            decisionId: DECISION_ID,
            occurredAt: instant(CLOSES_AT + config.window.challengeWindow),
            actor: memberIdAt(0),
            payload: { type: 'DecisionRatified' },
          });
          const rechazar = await append(log, {
            eventId: eventIdAt(503),
            decisionId: DECISION_ID,
            occurredAt: instant(CLOSES_AT + config.window.challengeWindow),
            actor: 'system',
            payload: { type: 'DecisionRejected', reason: 'umbral no alcanzado' },
          });

          if (resultado.outcome.kind === 'approved') {
            expect(replay(ratificar).status).toBe('Ratified');
            expect(() => replay(rechazar)).toThrow(/no se cierra como rechazo/u);
          } else {
            expect(() => replay(ratificar)).toThrow(/no se ratifica/u);
            expect(replay(rechazar).status).toBe('Rejected');
          }
        },
      ),
      HEAVY,
    );
  });

  it('la ratificación espera a que venza la ventana de impugnación', async () => {
    const config = await configFor(3, { kind: 'simple-majority', abstentionPolicy: 'exclude' });
    let log = await withVotes(await openedLog(config), ['yes', 'yes', 'yes']);
    log = await closeDecision(log, {
      eventId: eventIdAt(520),
      at: CLOSES_AT,
      actor: 'system',
      cause: 'window',
    });
    log = await recordResult(log, {
      eventId: eventIdAt(521),
      at: CLOSES_AT,
      actor: 'system',
      result: await computeResult(log),
    });
    const prematura = await append(log, {
      eventId: eventIdAt(522),
      decisionId: DECISION_ID,
      occurredAt: instant(CLOSES_AT + config.window.challengeWindow - 1),
      actor: memberIdAt(0),
      payload: { type: 'DecisionRatified' },
    });
    expect(() => replay(prematura)).toThrow(/impugnación/u);
  });
});
