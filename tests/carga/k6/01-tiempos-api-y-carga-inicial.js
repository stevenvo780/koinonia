/**
 * k6 — tiempos de API (línea base) + carga inicial (`/portada` bajo un pico de tráfico simultáneo).
 *
 * NO CORRIDO EN ESTE ENTORNO (k6 no está instalado y el encargo pide no instalarlo). Los números
 * REALES equivalentes de esta sesión, medidos con el guion Node de `tests/carga/node/`, están en
 * docs/TESTING.md §11.
 *
 * CÓMO CORRER (cuando haya k6):
 *   BASE_URL=http://localhost:3001 k6 run tests/carga/k6/01-tiempos-api-y-carga-inicial.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, entrar, como } from './_lib.js';

export const options = {
  scenarios: {
    // Línea base: una petición detrás de otra, sin concurrencia — lo que hay debajo de todo lo demás.
    tiempos_api: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      exec: 'tiemposApi',
    },
    // Carga inicial: todo el mundo abriendo /portada casi al mismo tiempo (una notificación, un
    // enlace compartido en el grupo). `ramping-vus` con una subida MUY rápida imita esa ráfaga.
    carga_inicial: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: Number(__ENV.VUS || 300) }, // sube casi de golpe
        { duration: '20s', target: Number(__ENV.VUS || 300) }, // se sostiene
        { duration: '5s', target: 0 },
      ],
      exec: 'cargaInicial',
      startTime: '35s', // corre DESPUÉS de tiempos_api, no en paralelo, para no mezclar las métricas
    },
  },
  thresholds: {
    'http_req_duration{escenario:tiempos_api}': ['p(95)<300', 'p(99)<600'],
    'http_req_duration{escenario:carga_inicial}': ['p(95)<800', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const sesion = entrar('lector.k6@udea.edu.co');
  return { testigo: sesion.testigo };
}

export function tiemposApi(data) {
  const rutas = ['/portada', '/decisiones', '/problemas', '/circulos'];
  for (const ruta of rutas) {
    const r = http.get(`${BASE_URL}${ruta}`, {
      ...como(data.testigo),
      tags: { escenario: 'tiempos_api' },
    });
    check(r, { [`${ruta} → 200`]: (res) => res.status === 200 });
  }
  sleep(1);
}

export function cargaInicial(data) {
  const r = http.get(`${BASE_URL}/portada`, {
    ...como(data.testigo),
    tags: { escenario: 'carga_inicial' },
  });
  check(r, { '/portada → 200': (res) => res.status === 200 });
}
