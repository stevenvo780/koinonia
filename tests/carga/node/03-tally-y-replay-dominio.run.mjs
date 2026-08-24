#!/usr/bin/env node
/**
 * Bancos de pruebas PUROS del motor (`packages/domain`): sin red, sin PostgreSQL, sin Fastify.
 *
 * Complementa a `02-pico-cierre-y-escrutinio.run.mjs`: aquel mide qué le pasa a la API cuando
 * N personas votan a la vez por HTTP — y, al medirlo, encontró que casi ninguna papeleta sobrevive
 * a la carrera (ver docs/TESTING.md §11), así que un `DecisionLog` con N=300 papeletas REALES nunca
 * llega a existir por ese camino. Este guion sí necesita ese log para medir el presupuesto de
 * `docs/TESTING.md §11` («tally con N=300», «replay de 1 000 eventos»), así que lo construye
 * llamando a las MISMAS funciones de producción que usa la API (`draftDecision`, `openDecision`,
 * `castBallot`, `closeDecision`, `computeResult`) pero en un bucle secuencial dentro del propio
 * proceso — sin la carrera de red, que es justo lo que el otro guion ya midió por separado.
 *
 * CÓMO CORRER (no necesita Docker ni Testcontainers — es dominio puro):
 *   node tests/carga/node/03-tally-y-replay-dominio.run.mjs
 *
 * Variables opcionales:
 *   CARGA_N_TALLY   tamaño del padrón para «tally sin delegación» (por defecto 300)
 *   CARGA_N_REPLAY  tamaño del log para «replay» (por defecto 1000; puede ser mayor que el padrón:
 *                   cada persona puede cambiar de voto, y la última papeleta manda — INV-07)
 *   CARGA_REPS      repeticiones por medición para el percentil (por defecto 300)
 */

import {
  ballotId,
  buildDecisionConfig,
  castBallot,
  circleId,
  closeDecision,
  computeResult,
  decisionId,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DEFAULT_EARLY_CLOSE,
  DEFAULT_TIE_BREAK,
  DELEGATION_DISABLED,
  draftDecision,
  ENGINE_VERSION,
  eventId,
  freezeElectorate,
  hash,
  instant,
  memberId,
  openDecision,
  optionId,
  proposalId,
  ratio,
  replay,
  verifyLog,
} from '@koinonia/domain';
import { performance } from 'node:perf_hooks';
import { resumenDeMuestras, imprimirTabla, ms } from './lib/metricas.mjs';

const N_TALLY = Number.parseInt(process.env.CARGA_N_TALLY ?? '300', 10);
const N_REPLAY = Number.parseInt(process.env.CARGA_N_REPLAY ?? '1000', 10);
const REPS = Number.parseInt(process.env.CARGA_REPS ?? '300', 10);

const T0 = instant(Date.UTC(2026, 7, 21, 8, 0, 0, 0));
const HORA = 3_600_000;
const hex32 = (n) => n.toString(16).padStart(32, '0');
const hex64 = (n) => n.toString(16).padStart(64, '0');
const idDe = (i) => memberId(hex32(i + 1));

async function construirDecisionAbierta({ padron, decisionSeed, circulo }) {
  const registry = Array.from({ length: padron }, (_, i) => ({
    memberId: idDe(i),
    enrolledAt: instant(T0 - 1_000_000),
    circles: [circulo],
  }));
  const electorate = await freezeElectorate({
    at: T0,
    registryVersion: 1,
    criterion: 'banco de pruebas de carga — padrón sintético',
    registry,
  });

  const draft = {
    proposalId: proposalId(hex32(decisionSeed)),
    proposalVersionHash: hash(hex64(decisionSeed)),
    summary: 'Banco de pruebas de carga: no es una decisión real.',
  };

  const config = await buildDecisionConfig({
    decisionId: decisionId(hex32(decisionSeed + 1)),
    proposalId: draft.proposalId,
    proposalVersionHash: draft.proposalVersionHash,
    circleId: circulo,
    topics: [],
    options: [optionId(hex32(0xa))],
    electorate,
    method: {
      kind: 'simple-majority',
      abstentionPolicy: 'exclude',
      base: 'cast',
      tieBreak: DEFAULT_TIE_BREAK,
    },
    quorum: {
      participation: ratio(0, 1),
      onFailure: 'reject',
      maxExtensions: 0,
      extensionDuration: 0,
    },
    window: {
      opensAt: T0,
      closesAt: instant(T0 + 72 * HORA),
      timezone: 'America/Bogota',
      earlyClose: DEFAULT_EARLY_CLOSE,
      challengeWindow: DEFAULT_CHALLENGE_WINDOW_MS,
    },
    privacy: 'public-roll-call',
    delegation: DELEGATION_DISABLED,
    seedCommitment: hash(hex64(decisionSeed + 2)),
    engineVersion: ENGINE_VERSION,
  });

  let log = await draftDecision([], {
    eventId: eventId(hex32(1)),
    at: instant(T0 - 1000),
    actor: 'system',
    decisionId: config.decisionId,
    draft,
  });
  log = await openDecision(log, { eventId: eventId(hex32(2)), at: T0, actor: 'system', config });
  return { log, config, electorate };
}

async function main() {
  console.log(
    '═══ Motor de decisión puro (sin red, sin base) — números reales de esta máquina ═══\n',
  );

  // ── 1 · Tally con N = CARGA_N_TALLY, sin delegación ────────────────────────────────────────────
  console.log(
    `Armando un padrón real de N=${String(N_TALLY)} y una papeleta por persona (100% participación)...`,
  );
  let { log: logTally, config: configTally } = await construirDecisionAbierta({
    padron: N_TALLY,
    decisionSeed: 0x10,
    circulo: circleId(hex32(1)),
  });
  const construccionMs = [];
  for (let i = 0; i < N_TALLY; i++) {
    const t0 = performance.now();
    logTally = await castBallot(logTally, {
      eventId: eventId(hex32(100 + i)),
      at: instant(T0 + 1000 + i),
      actor: idDe(i),
      ballot: {
        ballotId: ballotId(hex32(200 + i)),
        decisionId: configTally.decisionId,
        voter: idDe(i),
        round: 1,
        payload: { kind: 'binary', approve: i % 3 !== 0 },
        proposalVersionHash: configTally.proposalVersionHash,
      },
    });
    construccionMs.push(performance.now() - t0);
  }
  logTally = await closeDecision(logTally, {
    eventId: eventId(hex32(900)),
    at: instant(T0 + 72 * HORA + 1000),
    actor: 'system',
    cause: 'window',
  });
  console.log(
    `Padrón construido: ${String(logTally.length)} eventos, ${String(N_TALLY)} papeletas. ` +
      `p95 por castBallot: ${ms(resumenDeMuestras(construccionMs).p95)} (esto no es el presupuesto medido, ` +
      'es sólo el costo de fabricar el escenario).',
  );

  const tallyMs = [];
  const replayEnTallyMs = [];
  const verifyMs = [];
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now();
    await computeResult(logTally);
    tallyMs.push(performance.now() - t0);
    const t1 = performance.now();
    replay(logTally);
    replayEnTallyMs.push(performance.now() - t1);
    const t2 = performance.now();
    await verifyLog(logTally);
    verifyMs.push(performance.now() - t2);
  }
  const rTally = resumenDeMuestras(tallyMs);
  const rReplayTally = resumenDeMuestras(replayEnTallyMs);
  const rVerify = resumenDeMuestras(verifyMs);

  console.log(
    `\n── Presupuesto §11: "tally con N=${String(N_TALLY)} sin delegación" (${String(REPS)} repeticiones) ──`,
  );
  imprimirTabla(
    ['operación', 'p50', 'p95', 'p99', 'máximo', 'presupuesto p95'],
    [
      [
        'computeResult(log)  ← "tally"',
        ms(rTally.p50),
        ms(rTally.p95),
        ms(rTally.p99),
        ms(rTally.max),
        '< 50 ms',
      ],
      [
        'replay(log)',
        ms(rReplayTally.p50),
        ms(rReplayTally.p95),
        ms(rReplayTally.p99),
        ms(rReplayTally.max),
        '—',
      ],
      [
        'verifyLog(log)  ← recomputa TODA la cadena de hashes',
        ms(rVerify.p50),
        ms(rVerify.p95),
        ms(rVerify.p99),
        ms(rVerify.max),
        '—',
      ],
    ],
  );
  console.log(
    rTally.p95 < 50
      ? `✓ computeResult con N=${String(N_TALLY)} cumple el presupuesto de < 50 ms (p95).`
      : `✗ computeResult con N=${String(N_TALLY)} INCUMPLE el presupuesto de < 50 ms (p95).`,
  );

  // ── 2 · Replay de un log con CARGA_N_REPLAY eventos ─────────────────────────────────────────────
  // Un padrón de 300 no da 1000 papeletas DISTINTAS válidas (cada persona vota una vez; cambiar de
  // voto reemplaza la última, no agrega N nuevas — INV-07). Para medir «replay de 1000 eventos» de
  // verdad se agranda el padrón a CARGA_N_REPLAY: es un padrón sintético mayor que las ~300 personas
  // reales de Koinonía, a propósito — un banco de rendimiento existe para encontrar el techo, no
  // para quedarse cómodo debajo del tamaño de hoy.
  console.log(
    `\nArmando un segundo escenario con N=${String(N_REPLAY)} para medir "replay de un log grande"...`,
  );
  let { log: logReplay, config: configReplay } = await construirDecisionAbierta({
    padron: N_REPLAY,
    decisionSeed: 0x20,
    circulo: circleId(hex32(2)),
  });
  for (let i = 0; i < N_REPLAY; i++) {
    logReplay = await castBallot(logReplay, {
      eventId: eventId(hex32(100 + i)),
      at: instant(T0 + 1000 + i),
      actor: idDe(i),
      ballot: {
        ballotId: ballotId(hex32(200 + i)),
        decisionId: configReplay.decisionId,
        voter: idDe(i),
        round: 1,
        payload: { kind: 'binary', approve: i % 2 === 0 },
        proposalVersionHash: configReplay.proposalVersionHash,
      },
    });
  }
  console.log(
    `Log construido: ${String(logReplay.length)} eventos (draft+open+${String(N_REPLAY)} papeletas).`,
  );

  const replayGrandeMs = [];
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now();
    replay(logReplay);
    replayGrandeMs.push(performance.now() - t0);
  }
  const rReplayGrande = resumenDeMuestras(replayGrandeMs);
  console.log(
    `\n── Presupuesto §11: "replay de un log de ${String(N_REPLAY)} eventos" (${String(REPS)} repeticiones) ──`,
  );
  imprimirTabla(
    ['operación', 'p50', 'p95', 'p99', 'máximo', 'presupuesto p95'],
    [
      [
        `replay(log de ${String(logReplay.length)} eventos)`,
        ms(rReplayGrande.p50),
        ms(rReplayGrande.p95),
        ms(rReplayGrande.p99),
        ms(rReplayGrande.max),
        '< 150 ms',
      ],
    ],
  );
  console.log(
    rReplayGrande.p95 < 150
      ? `✓ replay con ${String(logReplay.length)} eventos cumple el presupuesto de < 150 ms (p95).`
      : `✗ replay con ${String(logReplay.length)} eventos INCUMPLE el presupuesto de < 150 ms (p95).`,
  );

  console.log('\n═══ Resumen para pegar en docs/TESTING.md §11 ═══');
  console.log(
    JSON.stringify(
      {
        maquina: {
          nodeVersion: process.version,
          arch: process.arch,
          cpus: (await import('node:os')).cpus().length,
        },
        fecha: new Date().toISOString(),
        tallyNTally: N_TALLY,
        computeResultP95Ms: Number(rTally.p95.toFixed(3)),
        computeResultP99Ms: Number(rTally.p99.toFixed(3)),
        verifyLogP95Ms: Number(rVerify.p95.toFixed(3)),
        replayNReplay: N_REPLAY,
        replayLogEventos: logReplay.length,
        replayP95Ms: Number(rReplayGrande.p95.toFixed(3)),
        replayP99Ms: Number(rReplayGrande.p99.toFixed(3)),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('\nFALLÓ el guion de carga:', error);
  process.exitCode = 1;
});
