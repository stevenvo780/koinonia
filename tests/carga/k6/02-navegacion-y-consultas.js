/**
 * k6 — navegación (una sesión recorre varias pantallas en orden) y consultas sostenidas (lectura
 * mezclada bajo concurrencia constante).
 *
 * NO CORRIDO EN ESTE ENTORNO. Equivalente real medido con Node en
 * `tests/carga/node/01-tiempos-api-navegacion-consultas.run.mjs` — números en docs/TESTING.md §11.
 *
 * CÓMO CORRER:
 *   BASE_URL=http://localhost:3001 k6 run tests/carga/k6/02-navegacion-y-consultas.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { BASE_URL, entrar, como } from './_lib.js';

export const options = {
  scenarios: {
    navegacion: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: Number(__ENV.VUS_NAV || 60) },
        { duration: '40s', target: Number(__ENV.VUS_NAV || 60) },
        { duration: '10s', target: 0 },
      ],
      exec: 'navegar',
    },
    consultas: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS_CONSULTAS || 20),
      duration: '60s',
      exec: 'consultar',
      startTime: '5s',
    },
  },
  thresholds: {
    'http_req_duration{paso:portada}': ['p(95)<500'],
    'http_req_duration{paso:decisiones}': ['p(95)<500'],
    'http_req_duration{paso:detalle}': ['p(95)<500'],
    'http_req_duration{paso:consulta}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const sesion = entrar('navegante.k6@udea.edu.co');
  const listado = http.get(`${BASE_URL}/decisiones`, como(sesion.testigo));
  const decisiones = (listado.json() || []).map((d) => d.id).filter(Boolean);
  return { testigo: sesion.testigo, decisiones };
}

export function navegar(data) {
  group('sesión de navegación', () => {
    let r = http.get(`${BASE_URL}/portada`, { ...como(data.testigo), tags: { paso: 'portada' } });
    check(r, { 'portada → 200': (res) => res.status === 200 });
    sleep(Math.random() * 1.5 + 0.5); // alguien LEE la portada, no la pasa de largo

    r = http.get(`${BASE_URL}/decisiones`, { ...como(data.testigo), tags: { paso: 'decisiones' } });
    check(r, { 'decisiones → 200': (res) => res.status === 200 });
    sleep(Math.random() * 1.5 + 0.5);

    if (data.decisiones.length > 0) {
      const id = data.decisiones[Math.floor(Math.random() * data.decisiones.length)];
      r = http.get(`${BASE_URL}/decisiones/${id}`, {
        ...como(data.testigo),
        tags: { paso: 'detalle' },
      });
      check(r, { 'detalle → 200': (res) => res.status === 200 });
    }
    sleep(Math.random() * 2 + 0.5);
  });
}

export function consultar(data) {
  const rutas = ['/decisiones', '/problemas', '/iniciativas', '/circulos'];
  const ruta = rutas[Math.floor(Math.random() * rutas.length)];
  const r = http.get(`${BASE_URL}${ruta}`, { ...como(data.testigo), tags: { paso: 'consulta' } });
  check(r, { [`${ruta} → 200`]: (res) => res.status === 200 });
  sleep(0.2);
}
