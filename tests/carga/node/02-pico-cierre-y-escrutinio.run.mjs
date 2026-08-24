#!/usr/bin/env node
/**
 * EL ESCENARIO QUE MÁS IMPORTA (docs/TESTING.md §11): el pico de cierre de una votación.
 *
 * El uso de una asamblea no es uniforme — casi nadie vota el primer día y mucha gente vota en el
 * último minuto, porque la ventana es dura y no hay gracia. Este guion reproduce justo eso contra
 * la API REAL (HTTP de verdad por un socket TCP, no `app.inject()`) y PostgreSQL REAL
 * (Testcontainers, igual que `tests/integration/`):
 *
 *   1. Se matriculan `CARGA_N` personas (por defecto 300, el número que nombra el pliego).
 *   2. Alguien abre una decisión con ventana de 1 hora.
 *   3. El reloj de la API se adelanta hasta el último minuto de la ventana — el reloj es un
 *      PUERTO controlable (ADR-0001: el instante entra como parámetro), así que esto no es hacer
 *      dormir al proceso: la ventana de la decisión de verdad está a punto de cerrar.
 *   4. Las `CARGA_N` personas votan TODAS A LA VEZ (`Promise.allSettled`, sin cola propia): es la
 *      única forma honesta de medir qué le pasa al servidor bajo un pico real, no una cola
 *      artificial del propio script de carga.
 *   5. Se cierra la votación y se pide el resultado.
 *   6. Se carga el `DecisionLog` persistido (el mismo camino que usa la API al escrutar) y se
 *      cronometra `computeResult`/`replay` en memoria, ya sin red ni base — el tally puro con
 *      N = `CARGA_N`.
 *
 * CÓMO CORRER:
 *   KOINONIA_REQUIRE_DOCKER=1 node tests/carga/node/02-pico-cierre-y-escrutinio.run.mjs
 *
 * Variables opcionales:
 *   CARGA_N              cuántas personas votan (por defecto 300)
 *   CARGA_MATRICULA_CONC concurrencia al matricular (por defecto 25; el pool de conexiones es 20)
 *   CARGA_VENTANA_S       segundos antes del cierre en que se dispara el pico (por defecto 45)
 *   CARGA_TALLY_REPS      repeticiones del tally puro para el percentil (por defecto 200)
 *
 * Sin `KOINONIA_REQUIRE_DOCKER=1` el guion igual intenta correr; si Docker no está disponible
 * termina con un mensaje explícito en vez de fingir un resultado.
 */

import { loadDecisionLog, CIRCULOS } from '@koinonia/api';
import { replay, computeResult } from '@koinonia/domain';
import {
  crearEntornoHttp,
  entrarHttp,
  comoHttp,
  requestId,
  dispararTodosALaVez,
  ejecutarConCola,
  resumenDeMuestras,
  imprimirTabla,
  ms,
  cronometro,
} from './lib/index.mjs';
import { performance } from 'node:perf_hooks';

const N = Number.parseInt(process.env.CARGA_N ?? '300', 10);
const CONCURRENCIA_MATRICULA = Number.parseInt(process.env.CARGA_MATRICULA_CONC ?? '25', 10);
const VENTANA_S = Number.parseInt(process.env.CARGA_VENTANA_S ?? '45', 10);
const TALLY_REPS = Number.parseInt(process.env.CARGA_TALLY_REPS ?? '200', 10);
const FACILITADORA = 'facilita.carga@udea.edu.co';

function fmtFecha(t) {
  return new Date(t).toISOString();
}

async function main() {
  console.log(`═══ Pico de cierre de votación — N=${String(N)} ═══`);
  console.log('Levantando PostgreSQL efímero (Testcontainers) y la API completa...');
  const arranqueEntorno = cronometro();
  const e = await crearEntornoHttp({ facilitadores: [FACILITADORA] });
  console.log(`Entorno listo en ${ms(arranqueEntorno())}. baseUrl=${e.baseUrl}`);

  try {
    // ── 1 · Matrícula de N + 1 personas (facilitadora incluida) — NO se mide como carga ────────
    console.log(
      `Matriculando ${String(N)} personas (concurrencia ${String(CONCURRENCIA_MATRICULA)})...`,
    );
    const cronoMatricula = cronometro();
    const lucia = await entrarHttp(e.baseUrl, FACILITADORA);
    const correos = Array.from(
      { length: N },
      (_, i) => `votante${String(i).padStart(5, '0')}.carga@udea.edu.co`,
    );
    const matriculas = await ejecutarConCola({
      total: N,
      concurrencia: CONCURRENCIA_MATRICULA,
      tarea: (i) => entrarHttp(e.baseUrl, correos[i]),
    });
    const fallosMatricula = matriculas.filter((r) => !r.ok);
    if (fallosMatricula.length > 0) {
      console.error(
        `${String(fallosMatricula.length)} matrículas fallaron. Ejemplo:`,
        fallosMatricula[0].error,
      );
      throw new Error('la matrícula no se completó para todas las personas');
    }
    const votantes = matriculas.map((r) => r.detalle);
    console.log(`${String(N)} personas matriculadas en ${ms(cronoMatricula())}.`);

    // ── 2 · Problema → propuesta → decisión abierta con ventana de 1 hora ───────────────────────
    const primerVotante = votantes[0];
    const problema = await fetch(`${e.baseUrl}/problemas`, {
      method: 'POST',
      headers: comoHttp(primerVotante.testigo),
      body: JSON.stringify({
        requestId: requestId(),
        titulo: 'Prueba de carga: pico de cierre de una votación',
        cuerpo:
          'Escenario de prueba de carga (tests/carga). No es un problema real del Instituto: sirve ' +
          'para medir el sistema bajo el pico de tráfico del último minuto de una votación.',
        circuloId: CIRCULOS.espacios.id,
      }),
    }).then((r) => r.json());

    const propuesta = await fetch(`${e.baseUrl}/propuestas`, {
      method: 'POST',
      headers: comoHttp(primerVotante.testigo),
      body: JSON.stringify({
        requestId: requestId(),
        problemaId: problema.id,
        titulo: 'Prueba de carga: propuesta de referencia para el pico de cierre',
        cuerpo:
          'Propuesta de prueba de carga con el único propósito de tener un texto congelado sobre ' +
          'el que abrir una votación y medir la concurrencia real en el cierre.',
        plan: {
          objetivo: 'Objetivo de prueba de carga, sin efecto real, sólo para pasar la validación.',
          responsableId: primerVotante.miembroId,
          revisarEn: Date.UTC(2027, 0, 1),
          criteriosDeExito: [
            {
              descripcion: 'Descripción de prueba de carga, sin efecto real.',
              fuenteDeVerificacion: 'Fuente de prueba de carga, sin efecto real.',
            },
          ],
        },
      }),
    }).then((r) => r.json());

    const decision = await fetch(`${e.baseUrl}/decisiones`, {
      method: 'POST',
      headers: comoHttp(lucia.testigo),
      body: JSON.stringify({
        requestId: requestId(),
        propuestaId: propuesta.id,
        metodo: 'simple-majority',
        duracionHoras: 1,
      }),
    }).then((r) => r.json());

    console.log(
      `Decisión ${decision.id} abierta. podianDecidir=${String(decision.podianDecidir)} ` +
        `abreEn=${fmtFecha(decision.abreEn)} cierraEn=${fmtFecha(decision.cierraEn)}`,
    );
    if (decision.podianDecidir !== N + 1) {
      console.warn(
        `⚠ podianDecidir (${String(decision.podianDecidir)}) no coincide con N+1 (${String(N + 1)}): ` +
          'revisar si alguna matrícula quedó fuera del padrón congelado.',
      );
    }

    // ── 3 · Adelantar el reloj hasta el último minuto de la ventana ─────────────────────────────
    const objetivo = decision.cierraEn - VENTANA_S * 1000;
    const delta = objetivo - e.reloj.now();
    if (delta > 0) e.reloj.avanzar(delta);
    console.log(
      `Reloj adelantado a ${fmtFecha(e.reloj.now())} — quedan ${String(VENTANA_S)} s de ventana.`,
    );

    // ── 4 · TODAS las papeletas a la vez ─────────────────────────────────────────────────────────
    // No se descarta como error una respuesta que no sea 201: es exactamente el dato que este
    // guion existe para medir. Cada tarea devuelve `{ok, status, codigo}` y NUNCA lanza, así que
    // una tanda con muchos rechazos no aborta el guion — lo REPORTA, que es lo que importa.
    console.log(`Disparando ${String(N)} papeletas TODAS A LA VEZ (Promise.allSettled)...`);
    const tareas = votantes.map((votante) => async () => {
      const aprueba = Math.random() < 0.6;
      const respuesta = await fetch(`${e.baseUrl}/decisiones/${decision.id}/papeletas`, {
        method: 'POST',
        headers: comoHttp(votante.testigo),
        body: JSON.stringify({
          requestId: requestId(),
          huellaVersion: decision.huellaVersion,
          respuesta: { tipo: 'binary', aprueba },
        }),
      });
      const cuerpo = await respuesta.json().catch(() => undefined);
      return { status: respuesta.status, codigo: cuerpo?.codigo };
    });
    const cronoPico = cronometro();
    const resultadosPapeletas = await dispararTodosALaVez(tareas);
    const duracionPicoMs = cronoPico();

    const exitosas = resultadosPapeletas.filter((r) => r.ok && r.detalle?.status === 201);
    const fallidas = resultadosPapeletas.filter((r) => !(r.ok && r.detalle?.status === 201));
    const resumenLatencia = resumenDeMuestras(resultadosPapeletas.map((r) => r.ms));
    const motivos = new Map();
    for (const f of fallidas) {
      const clave = f.ok
        ? `HTTP ${String(f.detalle.status)} (${String(f.detalle.codigo)})`
        : `excepción: ${String(f.error?.message ?? f.error)}`;
      motivos.set(clave, (motivos.get(clave) ?? 0) + 1);
    }

    console.log(`\n── Resultado del pico (N=${String(N)}, ráfaga real, sin cola propia) ──`);
    imprimirTabla(
      ['métrica', 'valor'],
      [
        ['papeletas aceptadas', `${String(exitosas.length)} / ${String(N)}`],
        ['papeletas rechazadas', `${String(fallidas.length)} / ${String(N)}`],
        ['duración total de la ráfaga', ms(duracionPicoMs)],
        [
          'throughput efectivo (aceptadas)',
          `${(exitosas.length / (duracionPicoMs / 1000)).toFixed(1)} papeletas/s`,
        ],
        ['p50 (toda respuesta, éxito o error)', ms(resumenLatencia.p50)],
        ['p90', ms(resumenLatencia.p90)],
        ['p95', ms(resumenLatencia.p95)],
        ['p99', ms(resumenLatencia.p99)],
        ['máximo', ms(resumenLatencia.max)],
        ['mínimo', ms(resumenLatencia.min)],
      ],
    );
    if (fallidas.length > 0) {
      console.log(
        `\n⚠⚠⚠ ${String(fallidas.length)} de ${String(N)} papeletas NO se registraron bajo concurrencia real. ` +
          'Desglose de motivos:',
      );
      for (const [motivo, cuenta] of motivos)
        console.log(`  ${String(cuenta).padStart(5)}  ${motivo}`);
      console.log(
        '\nEsto NO es lentitud (ver p95/p99 arriba: las respuestas vuelven rápido) — es una respuesta\n' +
          'definitiva de error. Ver docs/TESTING.md §11 para el diagnóstico completo con fichero:línea.',
      );
    } else {
      console.log('\n✓ CERO rechazos: las N papeletas concurrentes se aceptaron todas.');
    }

    // ── 5 · Cerrar y pedir el resultado ─────────────────────────────────────────────────────────
    // Reentrar: la sesión de quien facilita vence por INACTIVIDAD a la hora (identity.ts,
    // INACTIVIDAD_VIGENCIA_MS) y no hizo ninguna petición desde que abrió la decisión — igual que
    // pasaría en la vida real si vuelve justo para cerrar después de dejar la ventana correr.
    e.reloj.avanzar(VENTANA_S * 1000 + 1000);
    const lucia2 = await entrarHttp(e.baseUrl, FACILITADORA);
    const cronoCierre = cronometro();
    const cierre = await fetch(`${e.baseUrl}/decisiones/${decision.id}/cerrar`, {
      method: 'POST',
      headers: comoHttp(lucia2.testigo),
      body: JSON.stringify({ requestId: requestId() }),
    }).then((r) => r.json());
    const duracionCierreMs = cronoCierre();
    console.log(`\nCierre en ${ms(duracionCierreMs)}. participación:`, cierre.participacion);

    const emitidasEsperadas = exitosas.length;
    const emitidasReales = cierre.participacion?.emitidas ?? 0;
    const fantasmas = emitidasEsperadas - emitidasReales;
    if (fantasmas > 0) {
      console.log(
        `\n🔴🔴🔴 HALLAZGO CRÍTICO: ${String(fantasmas)} de ${String(emitidasEsperadas)} papeletas que la API ` +
          `respondió con 201 («tu voto se registró») NO están en la votación cerrada.\n` +
          `    HTTP 201 aceptadas ......... ${String(emitidasEsperadas)}\n` +
          `    participacion.emitidas ..... ${String(emitidasReales)}\n` +
          `    papeletas FANTASMA ......... ${String(fantasmas)} (confirmación positiva de un voto que nunca se contó)\n` +
          '    Ver docs/TESTING.md §11 para la causa exacta (fichero:línea) — es un defecto de\n' +
          '    persistencia bajo carrera, no del guion de carga: emitirPapeleta() nunca inspecciona\n' +
          '    el campo `appended` que devuelve persistDecisionLog().',
      );
    } else if (emitidasReales === emitidasEsperadas) {
      console.log('✓ participacion.emitidas coincide EXACTO con las papeletas aceptadas por HTTP.');
    } else {
      console.warn(
        `⚠ participacion.emitidas (${String(emitidasReales)}) es MAYOR que las papeletas aceptadas por ` +
          `HTTP (${String(emitidasEsperadas)}): revisar el guion, esto no debería pasar.`,
      );
    }

    // ── 6 · Integridad del log + tally puro, ya sin red ─────────────────────────────────────────
    const cliente = await e.pool.connect();
    let log;
    try {
      log = await loadDecisionLog(cliente, decision.id);
    } finally {
      cliente.release();
    }
    console.log(
      `✓ loadDecisionLog no encontró huecos de seq: ${String(log.length)} eventos en el agregado.`,
    );

    const tallyMs = [];
    const replayMs = [];
    for (let i = 0; i < TALLY_REPS; i++) {
      const t0r = performance.now();
      replay(log);
      replayMs.push(performance.now() - t0r);
      const t0t = performance.now();
      await computeResult(log);
      tallyMs.push(performance.now() - t0t);
    }
    const resumenReplay = resumenDeMuestras(replayMs);
    const resumenTally = resumenDeMuestras(tallyMs);

    console.log(
      `\n── Tally puro, en memoria (N=${String(N)}, ${String(TALLY_REPS)} repeticiones) ──`,
    );
    imprimirTabla(
      ['operación', 'p50', 'p95', 'p99', 'máximo'],
      [
        [
          'replay(log)',
          ms(resumenReplay.p50),
          ms(resumenReplay.p95),
          ms(resumenReplay.p99),
          ms(resumenReplay.max),
        ],
        [
          'computeResult(log)',
          ms(resumenTally.p50),
          ms(resumenTally.p95),
          ms(resumenTally.p99),
          ms(resumenTally.max),
        ],
      ],
    );

    console.log('\n═══ Resumen para pegar en docs/TESTING.md §11 ═══');
    console.log(
      JSON.stringify(
        {
          n: N,
          fecha: new Date().toISOString(),
          pico: {
            aceptadas: exitosas.length,
            rechazadas: fallidas.length,
            emitidasSegunResultado: emitidasReales,
            papeletasFantasma: fantasmas,
            motivosDeRechazo: Object.fromEntries(motivos),
            duracionTotalMs: Number(duracionPicoMs.toFixed(1)),
            ...Object.fromEntries(
              Object.entries(resumenLatencia).map(([k, v]) => [k, Number(v?.toFixed?.(2) ?? v)]),
            ),
          },
          tallyPuro: {
            replayP95Ms: Number(resumenReplay.p95.toFixed(3)),
            replayP99Ms: Number(resumenReplay.p99.toFixed(3)),
            computeResultP95Ms: Number(resumenTally.p95.toFixed(3)),
            computeResultP99Ms: Number(resumenTally.p99.toFixed(3)),
          },
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
