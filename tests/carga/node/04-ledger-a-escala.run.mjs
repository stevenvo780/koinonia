#!/usr/bin/env node
/**
 * El ledger con MILES de eventos: `append` en volumen, `readStream` (reconstrucción de una
 * proyección) y `verifyLedger` (la verificación completa que recorre TODA la tabla) contra
 * PostgreSQL real. Nada de dominio aquí — es la capa de abajo, la que todo lo demás asume rápida.
 *
 * Los eventos se reparten en `CARGA_AGREGADOS` agregados distintos, cada uno con `CARGA_POR_AGREGADO`
 * eventos encadenados SECUENCIALMENTE (sin carrera: cada `append` de un agregado espera al
 * anterior del MISMO agregado). Entre agregados sí hay concurrencia — son aggregate_id distintos,
 * así que no compiten por la misma cabeza. Esto evita a propósito el defecto de concurrencia que
 * `02-pico-cierre-y-escrutinio.run.mjs` encontró en la escritura CONCURRENTE al MISMO agregado
 * (docs/TESTING.md §11): aquí el objetivo es medir el volumen, no repetir ese hallazgo.
 *
 * CÓMO CORRER:
 *   KOINONIA_REQUIRE_DOCKER=1 node tests/carga/node/04-ledger-a-escala.run.mjs
 *
 * Variables opcionales:
 *   CARGA_AGREGADOS      cuántos agregados distintos (por defecto 500)
 *   CARGA_POR_AGREGADO   eventos por agregado (por defecto 10 → 5 000 eventos en total)
 *   CARGA_ESCRITURA_CONC concurrencia entre agregados al escribir (por defecto 20, el tamaño del pool)
 */

import { append, readStream, verifyAggregate, verifyLedger } from '@koinonia/api';
import { performance } from 'node:perf_hooks';
import { crearEntornoLedger, requestId as siguienteRequestId } from './lib/entorno.mjs';
import {
  ejecutarConCola,
  resumenDeMuestras,
  imprimirTabla,
  ms,
  cronometro,
} from './lib/metricas.mjs';

const AGREGADOS = Number.parseInt(process.env.CARGA_AGREGADOS ?? '500', 10);
const POR_AGREGADO = Number.parseInt(process.env.CARGA_POR_AGREGADO ?? '10', 10);
const CONCURRENCIA = Number.parseInt(process.env.CARGA_ESCRITURA_CONC ?? '20', 10);
const TOTAL = AGREGADOS * POR_AGREGADO;

// +0x10000: evita por completo el rango bajo, donde vive `SPINE_AGGREGATE_ID` ('00…001',
// packages/crypto/src/chain.ts) — la espina se mueve sola cada vez que nace un agregado nuevo, así
// que reutilizar su propio id como "un agregado sintético más" produce un conflicto de cabeza que
// no tiene nada que ver con lo que este guion mide.
function agregadoId(i) {
  return (i + 0x10000).toString(16).padStart(32, '0');
}

async function main() {
  console.log(
    `═══ Ledger a escala — ${String(AGREGADOS)} agregados × ${String(POR_AGREGADO)} eventos = ${String(TOTAL)} eventos ═══`,
  );
  const e = await crearEntornoLedger({ poolMax: 25 });
  try {
    console.log(
      `Escribiendo ${String(TOTAL)} eventos (concurrencia entre agregados: ${String(CONCURRENCIA)})...`,
    );
    const cronoEscritura = cronometro();
    const resultados = await ejecutarConCola({
      total: AGREGADOS,
      concurrencia: CONCURRENCIA,
      tarea: async (i) => {
        const id = agregadoId(i);
        for (let k = 0; k < POR_AGREGADO; k++) {
          await append(e.appPool, {
            aggregateId: id,
            aggregateType: 'carga_sintetica',
            expectedHead: k === 0 ? { kind: 'new' } : { kind: 'any' },
            requestId: siguienteRequestId(),
            events: [
              {
                eventType: 'EventoDeCarga',
                occurredAt: new Date(Date.now() + k).toISOString(),
                payload: { i, k },
              },
            ],
          });
        }
      },
    });
    const duracionEscrituraMs = cronoEscritura();
    const fallos = resultados.filter((r) => !r.ok);
    console.log(
      `Escritura terminada en ${ms(duracionEscrituraMs)} ` +
        `(${(TOTAL / (duracionEscrituraMs / 1000)).toFixed(0)} eventos/s). Fallos: ${String(fallos.length)}.`,
    );
    if (fallos.length > 0) console.error('Ejemplo de fallo:', fallos[0].error);

    // ── reconstrucción de UNA proyección (readStream de un solo agregado) ────────────────────────
    const clienteLectura = await e.appPool.connect();
    let readStreamMs = [];
    let verifyAggregateMs = [];
    try {
      for (let rep = 0; rep < 30; rep++) {
        const id = agregadoId(rep % AGREGADOS);
        const t0 = performance.now();
        await readStream(clienteLectura, id);
        readStreamMs.push(performance.now() - t0);
        const t1 = performance.now();
        await verifyAggregate(clienteLectura, id);
        verifyAggregateMs.push(performance.now() - t1);
      }
    } finally {
      clienteLectura.release();
    }
    const rReadStream = resumenDeMuestras(readStreamMs);
    const rVerifyAgg = resumenDeMuestras(verifyAggregateMs);

    console.log(
      `\n── Reconstrucción de UNA proyección (agregado de ${String(POR_AGREGADO)} eventos, 30 repeticiones) ──`,
    );
    imprimirTabla(
      ['operación', 'p50', 'p95', 'p99', 'máximo'],
      [
        [
          'readStream(unAgregado)',
          ms(rReadStream.p50),
          ms(rReadStream.p95),
          ms(rReadStream.p99),
          ms(rReadStream.max),
        ],
        [
          'verifyAggregate(unAgregado)',
          ms(rVerifyAgg.p50),
          ms(rVerifyAgg.p95),
          ms(rVerifyAgg.p99),
          ms(rVerifyAgg.max),
        ],
      ],
    );

    // ── verificación COMPLETA del ledger (toda la tabla, TOTAL eventos) ───────────────────────────
    console.log(`\nVerificando el ledger COMPLETO (${String(TOTAL)} eventos, una sola pasada)...`);
    const clienteVerify = await e.appPool.connect();
    let veredicto;
    let duracionVerifyMs;
    try {
      const t0 = performance.now();
      veredicto = await verifyLedger(clienteVerify);
      duracionVerifyMs = performance.now() - t0;
    } finally {
      clienteVerify.release();
    }
    console.log(
      `verifyLedger(): ok=${String(veredicto.ok)}, hallazgos=${String(veredicto.findings?.length ?? 0)}, ` +
        `duración=${ms(duracionVerifyMs)} (presupuesto: < 60 000 ms para 100 000 eventos).`,
    );
    const eventosPorMs = TOTAL / duracionVerifyMs;
    const estimado100k = 100_000 / eventosPorMs;
    console.log(
      `Extrapolación LINEAL a 100 000 eventos (NO medida — estimación honesta a partir de estos ` +
        `${String(TOTAL)}): ≈ ${ms(estimado100k)}. verifyLedger no es necesariamente lineal (hay una ` +
        'consulta de contigüidad de índice y una de Merkle que pueden escalar distinto); tratar esto ' +
        'como una cota de referencia, no como el número real a 100k — ese sólo lo da correr 100k.',
    );

    console.log('\n═══ Resumen para pegar en docs/TESTING.md §11 ═══');
    console.log(
      JSON.stringify(
        {
          fecha: new Date().toISOString(),
          totalEventos: TOTAL,
          agregados: AGREGADOS,
          porAgregado: POR_AGREGADO,
          escrituraMs: Number(duracionEscrituraMs.toFixed(0)),
          escrituraEventosPorSegundo: Number((TOTAL / (duracionEscrituraMs / 1000)).toFixed(0)),
          readStreamP95Ms: Number(rReadStream.p95.toFixed(2)),
          verifyAggregateP95Ms: Number(rVerifyAgg.p95.toFixed(2)),
          verifyLedgerOk: veredicto.ok,
          verifyLedgerMs: Number(duracionVerifyMs.toFixed(1)),
          verifyLedgerEstimado100kMs: Number(estimado100k.toFixed(0)),
        },
        null,
        2,
      ),
    );
  } finally {
    await e.stop();
  }
}

main().catch((error) => {
  console.error('\nFALLÓ el guion de carga:', error);
  process.exitCode = 1;
});
