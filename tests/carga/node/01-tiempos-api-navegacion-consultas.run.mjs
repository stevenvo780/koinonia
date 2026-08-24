#!/usr/bin/env node
/**
 * Tiempos de API, carga inicial, navegación y consultas — contra la API REAL (socket TCP) y
 * PostgreSQL REAL (Testcontainers). Cuatro mediciones, cada una con su propio nivel de concurrencia
 * porque cada una representa un patrón de tráfico distinto:
 *
 *   1. TIEMPOS DE API: una petición a la vez, en serie, a las rutas de lectura más comunes — la
 *      línea base sin ruido de concurrencia.
 *   2. CARGA INICIAL: `CARGA_INICIAL_N` personas abriendo `/portada` TODAS A LA VEZ — el primer
 *      `GET` que hace cualquier pantalla, y el que más gente comparte en el mismo instante (una
 *      notificación, un enlace compartido en el grupo).
 *   3. NAVEGACIÓN: `CARGA_NAV_USUARIOS` sesiones que recorren varias pantallas EN SECUENCIA
 *      (portada → decisiones → detalle → iniciativas), con concurrencia acotada entre sesiones —
 *      así navega gente de verdad, una pantalla detrás de otra, no todas a la vez.
 *   4. CONSULTAS: lectura sostenida sobre listados y métricas con concurrencia constante.
 *
 * CÓMO CORRER:
 *   KOINONIA_REQUIRE_DOCKER=1 node tests/carga/node/01-tiempos-api-navegacion-consultas.run.mjs
 *
 * Variables opcionales: CARGA_INICIAL_N (300), CARGA_NAV_USUARIOS (60), CARGA_NAV_CONC (15),
 * CARGA_CONSULTAS_TOTAL (600), CARGA_CONSULTAS_CONC (20).
 */

import { CIRCULOS } from '@koinonia/api';
import { performance } from 'node:perf_hooks';
import {
  crearEntornoHttp,
  entrarHttp,
  comoHttp,
  requestId,
  ejecutarConCola,
  dispararTodosALaVez,
  resumenDeMuestras,
  imprimirTabla,
  ms,
  cronometro,
} from './lib/index.mjs';

const INICIAL_N = Number.parseInt(process.env.CARGA_INICIAL_N ?? '300', 10);
const NAV_USUARIOS = Number.parseInt(process.env.CARGA_NAV_USUARIOS ?? '60', 10);
const NAV_CONC = Number.parseInt(process.env.CARGA_NAV_CONC ?? '15', 10);
const CONSULTAS_TOTAL = Number.parseInt(process.env.CARGA_CONSULTAS_TOTAL ?? '600', 10);
const CONSULTAS_CONC = Number.parseInt(process.env.CARGA_CONSULTAS_CONC ?? '20', 10);

function filaDe(nombre, resumen, presupuestoP95) {
  return [
    nombre,
    String(resumen.n),
    ms(resumen.p50),
    ms(resumen.p95),
    ms(resumen.p99),
    ms(resumen.max),
    presupuestoP95 ?? '—',
  ];
}

async function main() {
  console.log('═══ Tiempos de API, carga inicial, navegación y consultas ═══');
  const e = await crearEntornoHttp({ facilitadores: ['facilita.tiempos@udea.edu.co'] });
  console.log(`Entorno listo. baseUrl=${e.baseUrl}`);
  const filas = [];
  try {
    const alguien = await entrarHttp(e.baseUrl, 'lector.principal@udea.edu.co');

    // ── Datos de referencia: un puñado de problemas/propuestas/decisiones para tener algo que leer ─
    console.log(
      '\nSembrando un puñado de problemas/propuestas/decisiones de referencia (no se mide)...',
    );
    const decisionesRef = [];
    for (let i = 0; i < 5; i++) {
      const problema = await fetch(`${e.baseUrl}/problemas`, {
        method: 'POST',
        headers: comoHttp(alguien.testigo),
        body: JSON.stringify({
          requestId: requestId(),
          titulo: `Prueba de carga: referencia de lectura ${String(i)}`,
          cuerpo:
            'Cuerpo de prueba de carga con longitud suficiente para pasar la validación mínima exigida.',
          circuloId: CIRCULOS.espacios.id,
        }),
      }).then((r) => r.json());
      const propuesta = await fetch(`${e.baseUrl}/propuestas`, {
        method: 'POST',
        headers: comoHttp(alguien.testigo),
        body: JSON.stringify({
          requestId: requestId(),
          problemaId: problema.id,
          titulo: `Prueba de carga: propuesta de referencia ${String(i)}`,
          cuerpo:
            'Cuerpo de la propuesta de prueba de carga con longitud suficiente para pasar la ' +
            'validación mínima de cincuenta caracteres que exige el contrato.',
          plan: {
            objetivo:
              'Objetivo de prueba de carga, sin efecto real, sólo para pasar la validación.',
            responsableId: alguien.miembroId,
            revisarEn: Date.UTC(2027, 0, 1),
            criteriosDeExito: [
              {
                descripcion: 'Descripción de prueba de carga.',
                fuenteDeVerificacion: 'Fuente de prueba de carga.',
              },
            ],
          },
        }),
      }).then((r) => r.json());
      decisionesRef.push(propuesta.id);
    }
    console.log(`Sembrados ${String(decisionesRef.length)} problemas/propuestas de referencia.`);

    // ── 1 · Tiempos de API en serie ─────────────────────────────────────────────────────────────
    console.log('\n[1/4] Tiempos de API — 50 peticiones en serie por ruta...');
    const rutas = [
      ['GET /portada', () => fetch(`${e.baseUrl}/portada`, { headers: comoHttp(alguien.testigo) })],
      [
        'GET /decisiones',
        () => fetch(`${e.baseUrl}/decisiones`, { headers: comoHttp(alguien.testigo) }),
      ],
      [
        'GET /problemas',
        () => fetch(`${e.baseUrl}/problemas`, { headers: comoHttp(alguien.testigo) }),
      ],
      [
        'GET /circulos',
        () => fetch(`${e.baseUrl}/circulos`, { headers: comoHttp(alguien.testigo) }),
      ],
    ];
    for (const [nombre, hacer] of rutas) {
      const muestras = [];
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        const r = await hacer();
        await r.arrayBuffer();
        muestras.push(performance.now() - t0);
        if (r.status >= 400) console.warn(`  ⚠ ${nombre} devolvió ${String(r.status)}`);
      }
      filas.push(filaDe(nombre, resumenDeMuestras(muestras)));
    }

    // ── 2 · Carga inicial: /portada TODA A LA VEZ ───────────────────────────────────────────────
    console.log(
      `\n[2/4] Carga inicial — ${String(INICIAL_N)} peticiones a /portada TODAS A LA VEZ...`,
    );
    const cronoInicial = cronometro();
    const resInicial = await dispararTodosALaVez(
      Array.from({ length: INICIAL_N }, () => async () => {
        const r = await fetch(`${e.baseUrl}/portada`, { headers: comoHttp(alguien.testigo) });
        await r.arrayBuffer();
        if (r.status !== 200) throw new Error(`status ${String(r.status)}`);
      }),
    );
    const duracionInicialMs = cronoInicial();
    const erroresInicial = resInicial.filter((r) => !r.ok).length;
    const resumenInicial = resumenDeMuestras(resInicial.map((r) => r.ms));
    filas.push(filaDe(`/portada × ${String(INICIAL_N)} a la vez`, resumenInicial));
    console.log(
      `  duración total: ${ms(duracionInicialMs)} · errores: ${String(erroresInicial)}/${String(INICIAL_N)} · ` +
        `throughput: ${(INICIAL_N / (duracionInicialMs / 1000)).toFixed(1)} req/s`,
    );

    // ── 3 · Navegación: sesiones secuenciales, concurrencia acotada entre sesiones ─────────────
    console.log(
      `\n[3/4] Navegación — ${String(NAV_USUARIOS)} sesiones (portada→decisiones→detalle→iniciativas), ` +
        `concurrencia ${String(NAV_CONC)}...`,
    );
    const pasoMs = { portada: [], decisiones: [], detalle: [], iniciativas: [] };
    await ejecutarConCola({
      total: NAV_USUARIOS,
      concurrencia: NAV_CONC,
      tarea: async () => {
        let t0 = performance.now();
        await fetch(`${e.baseUrl}/portada`, { headers: comoHttp(alguien.testigo) }).then((r) =>
          r.arrayBuffer(),
        );
        pasoMs.portada.push(performance.now() - t0);

        t0 = performance.now();
        await fetch(`${e.baseUrl}/decisiones`, { headers: comoHttp(alguien.testigo) }).then((r) =>
          r.arrayBuffer(),
        );
        pasoMs.decisiones.push(performance.now() - t0);

        const propuestaId = decisionesRef[Math.floor(Math.random() * decisionesRef.length)];
        t0 = performance.now();
        await fetch(`${e.baseUrl}/propuestas/${propuestaId}`, {
          headers: comoHttp(alguien.testigo),
        }).then((r) => r.arrayBuffer());
        pasoMs.detalle.push(performance.now() - t0);

        t0 = performance.now();
        await fetch(`${e.baseUrl}/iniciativas`, { headers: comoHttp(alguien.testigo) }).then((r) =>
          r.arrayBuffer(),
        );
        pasoMs.iniciativas.push(performance.now() - t0);
      },
    });
    filas.push(filaDe('navegación: GET /portada', resumenDeMuestras(pasoMs.portada)));
    filas.push(filaDe('navegación: GET /decisiones', resumenDeMuestras(pasoMs.decisiones)));
    filas.push(
      filaDe('navegación: GET /propuestas/:id (detalle)', resumenDeMuestras(pasoMs.detalle)),
    );
    filas.push(filaDe('navegación: GET /iniciativas', resumenDeMuestras(pasoMs.iniciativas)));

    // ── 4 · Consultas sostenidas ─────────────────────────────────────────────────────────────────
    console.log(
      `\n[4/4] Consultas — ${String(CONSULTAS_TOTAL)} peticiones mezcladas, concurrencia ${String(CONSULTAS_CONC)}...`,
    );
    const consultasRutas = ['/decisiones', '/problemas', '/iniciativas', '/circulos'];
    const resConsultas = await ejecutarConCola({
      total: CONSULTAS_TOTAL,
      concurrencia: CONSULTAS_CONC,
      tarea: async (i) => {
        const ruta = consultasRutas[i % consultasRutas.length];
        const r = await fetch(`${e.baseUrl}${ruta}`, { headers: comoHttp(alguien.testigo) });
        await r.arrayBuffer();
        if (r.status !== 200) throw new Error(`${ruta} → status ${String(r.status)}`);
      },
    });
    const erroresConsultas = resConsultas.filter((r) => !r.ok).length;
    filas.push(
      filaDe(
        `consultas mezcladas × ${String(CONSULTAS_TOTAL)}`,
        resumenDeMuestras(resConsultas.map((r) => r.ms)),
      ),
    );
    console.log(`  errores: ${String(erroresConsultas)}/${String(CONSULTAS_TOTAL)}`);

    console.log('\n── Resumen ──');
    imprimirTabla(['medición', 'n', 'p50', 'p95', 'p99', 'máximo', 'presupuesto p95'], filas);

    console.log('\n═══ Resumen para pegar en docs/TESTING.md §11 (JSON) ═══');
    console.log(JSON.stringify({ fecha: new Date().toISOString(), filas }, null, 2));
  } finally {
    await e.stop();
  }
}

main().catch((error) => {
  console.error('\nFALLÓ el guion de carga:', error);
  process.exitCode = 1;
});
