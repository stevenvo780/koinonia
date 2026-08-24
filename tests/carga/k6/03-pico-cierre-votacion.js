/**
 * k6 — EL ESCENARIO QUE MÁS IMPORTA (docs/TESTING.md §11): el pico de cierre de una votación.
 * Mucha gente vota en el último minuto porque la ventana es dura y no hay gracia.
 *
 * NO CORRIDO EN ESTE ENTORNO (k6 no está instalado; el encargo pide no instalarlo). El hallazgo
 * REAL y grave de este escenario —una fracción enorme de papeletas concurrentes se pierde bajo
 * carrera, algunas con una respuesta 201 que hace creer que el voto se contó cuando NO se contó—
 * se midió con el guion Node equivalente, que sí corrió de verdad:
 * `tests/carga/node/02-pico-cierre-y-escrutinio.run.mjs` (números y diagnóstico completo en
 * docs/TESTING.md §11). Correlo con k6 contra un entorno real es la forma de confirmar ese mismo
 * hallazgo por un camino independiente, no de descubrirlo por primera vez — eso ya está hecho.
 *
 * ═══ Por qué este guion, tal cual, necesita paciencia o un `DECISION_ID` ya abierto ═══
 * La API pública no admite ventanas de menos de una hora (`duracionHoras` ≥ 1,
 * packages/contracts/src/http.ts). k6 —a diferencia del guion Node, que controla el reloj de la API
 * como un PUERTO (ADR-0001)— no puede adelantar el reloj de un servidor real: para golpear el
 * cierre real hay que O ESPERAR la hora completa, O apuntar el guion a una decisión que YA está a
 * punto de cerrar (pasando `DECISION_ID`, `HUELLA_VERSION` y `CIERRA_EN_MS` por variable de
 * entorno) y dejar que k6 duerma sólo lo que falta. Ambos modos están soportados abajo.
 *
 * CÓMO CORRER:
 *   # Modo A — apuntando a una decisión real que ya existe y está por cerrar:
 *   BASE_URL=https://... DECISION_ID=<id> HUELLA_VERSION=<hash> CIERRA_EN_MS=<epoch> \
 *     VUS=300 k6 run tests/carga/k6/03-pico-cierre-votacion.js
 *
 *   # Modo B — de punta a punta contra un servidor de DESARROLLO con paciencia real (≥ 1 hora):
 *   BASE_URL=http://localhost:3001 VUS=300 k6 run tests/carga/k6/03-pico-cierre-votacion.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, entrar, como, requestId } from './_lib.js';

const VUS = Number(__ENV.VUS || 300);
const VENTANA_S_ANTES_DEL_CIERRE = Number(__ENV.VENTANA_S || 45);

// `papeletas_aceptadas` cuenta 201 HTTP — NO cuántas quedaron realmente persistidas. Comparar este
// número contra `participacion.emitidas` que imprime `teardown()` es cómo se detecta una papeleta
// FANTASMA (201 sin persistir) por este camino — ver docs/TESTING.md §11.
const papeletasAceptadas = new Counter('papeletas_aceptadas');
const papeletasRechazadas = new Counter('papeletas_rechazadas');
const latenciaPapeleta = new Trend('latencia_papeleta_pico', true);

export const options = {
  scenarios: {
    pico_cierre: {
      executor: 'shared-iterations',
      vus: VUS,
      iterations: VUS, // exactamente una papeleta por VU: cada persona vota UNA vez
      maxDuration: '90m', // suficiente para el modo B (esperar la hora completa) + margen
    },
  },
  thresholds: {
    // El presupuesto de docs/TESTING.md §11 es "0 rechazos por timeout" — que NO es lo mismo que
    // "0 rechazos": el hallazgo real es que hay rechazos por CONFLICTO DE ESCRITURA, no por
    // timeout (las respuestas vuelven rápido). Este umbral vigila la LATENCIA, no el éxito — el
    // recuento de fantasmas/rechazos se lee en la consola al final (ver `handleSummary`).
    latencia_papeleta_pico: ['p(95)<1000', 'p(99)<2000'],
  },
};

export function setup() {
  if (__ENV.DECISION_ID) {
    return {
      decisionId: __ENV.DECISION_ID,
      huellaVersion: __ENV.HUELLA_VERSION,
      cierraEn: Number(__ENV.CIERRA_EN_MS),
      testigos: Array.from(
        { length: VUS },
        (_, i) => entrar(`votante-k6-${String(i)}@udea.edu.co`).testigo,
      ),
    };
  }

  // Modo B: abrir una decisión de verdad, con la ventana mínima que admite la API (1 hora).
  const facilitadora = entrar('facilita-k6@udea.edu.co');
  const primero = entrar('votante-k6-0@udea.edu.co');
  const testigos = [primero.testigo];
  for (let i = 1; i < VUS; i++)
    testigos.push(entrar(`votante-k6-${String(i)}@udea.edu.co`).testigo);

  const problema = http
    .post(
      `${BASE_URL}/problemas`,
      JSON.stringify({
        requestId: requestId(),
        titulo: 'Prueba de carga k6: pico de cierre',
        cuerpo:
          'Escenario de prueba de carga (tests/carga/k6). No es un problema real del Instituto.',
        circuloId: __ENV.CIRCULO_ID || 'e5bac105b1e00000000000000000000b', // CIRCULOS.espacios.id
      }),
      como(primero.testigo),
    )
    .json();

  const propuesta = http
    .post(
      `${BASE_URL}/propuestas`,
      JSON.stringify({
        requestId: requestId(),
        problemaId: problema.id,
        titulo: 'Prueba de carga k6: propuesta de referencia',
        cuerpo:
          'Propuesta de prueba de carga (tests/carga/k6), con longitud suficiente para pasar la ' +
          'validación mínima del contrato exigida por el sistema.',
        plan: {
          objetivo: 'Objetivo de prueba de carga k6, sin efecto real.',
          responsableId: primero.miembroId,
          revisarEn: Date.UTC(2027, 0, 1),
          criteriosDeExito: [
            { descripcion: 'Prueba de carga k6.', fuenteDeVerificacion: 'Prueba de carga k6.' },
          ],
        },
      }),
      como(primero.testigo),
    )
    .json();

  const decision = http
    .post(
      `${BASE_URL}/decisiones`,
      JSON.stringify({
        requestId: requestId(),
        propuestaId: propuesta.id,
        metodo: 'simple-majority',
        duracionHoras: 1,
      }),
      como(facilitadora.testigo),
    )
    .json();

  return {
    decisionId: decision.id,
    huellaVersion: decision.huellaVersion,
    cierraEn: decision.cierraEn,
    testigos,
  };
}

export default function (data) {
  // Cada VU duerme hasta VENTANA_S_ANTES_DEL_CIERRE segundos antes del cierre, y entonces vota. Con
  // `shared-iterations` los VUs arrancan casi juntos, así que el resultado es lo que se busca: un
  // pico real concentrado en el último minuto, no una cola repartida a lo largo de toda la hora.
  const faltan = data.cierraEn - Date.now() - VENTANA_S_ANTES_DEL_CIERRE * 1000;
  if (faltan > 0) sleep(faltan / 1000);

  const testigo = data.testigos[(__VU - 1) % data.testigos.length];
  const t0 = Date.now();
  const r = http.post(
    `${BASE_URL}/decisiones/${data.decisionId}/papeletas`,
    JSON.stringify({
      requestId: requestId(),
      huellaVersion: data.huellaVersion,
      respuesta: { tipo: 'binary', aprueba: Math.random() < 0.6 },
    }),
    como(testigo),
  );
  latenciaPapeleta.add(Date.now() - t0);

  const aceptada = check(r, { 'papeleta → 201': (res) => res.status === 201 });
  if (aceptada) papeletasAceptadas.add(1);
  else papeletasRechazadas.add(1);
}

export function teardown(data) {
  // Confirmación final: comparar cuántas 201 hubo (arriba) contra `participacion.emitidas` real.
  // Cualquier diferencia es exactamente el hallazgo de papeletas fantasma de docs/TESTING.md §11.
  const resultado = http.get(`${BASE_URL}/decisiones/${data.decisionId}`, como(data.testigos[0]));
  console.log(`[pico-cierre] estado final de la decisión: ${resultado.body}`);
}
