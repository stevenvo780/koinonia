/**
 * Ayudantes compartidos por los guiones de k6 (tests/carga/k6/*.js).
 *
 * NO INSTALADO EN ESTE ENTORNO — `which k6` no encontró el binario aquí, y la instrucción del
 * encargo es explícita: no instalarlo. Estos guiones están escritos para correr el día que k6 esté
 * disponible (`k6 run tests/carga/k6/<archivo>.js`), contra una API real — de desarrollo o de
 * verdad — no contra `app.inject()`, que sólo existe dentro del proceso de Node de las pruebas de
 * integración. Los NÚMEROS REALES de esta sesión están en `tests/carga/node/*.run.mjs`, que sí se
 * corrieron (ver docs/TESTING.md §11).
 *
 * Variables de entorno que todos los guiones de esta carpeta aceptan:
 *   BASE_URL   raíz de la API, p. ej. http://localhost:3001 (por defecto)
 *   VUS        usuarios virtuales (por escenario; ver cada guion)
 *
 * AUTENTICACIÓN: sólo funciona contra una API en modo desarrollo (`NODE_ENV !== 'production'`,
 * `scripts/dev.mjs`), donde `POST /auth/enlace` devuelve `enlaceDeDesarrollo` con el token adentro
 * (services/api/src/http/app.ts, `modoDesarrollo`) — así se evita depender de leer un correo real.
 * Contra producción, esto NO funciona (a propósito: ahí no hay atajo de desarrollo) y hace falta
 * adaptar `entrar()` para usar sesiones ya provisionadas.
 */

import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

/** Entra con un correo `@udea.edu.co` y devuelve el testigo Bearer. Sólo sirve en modoDesarrollo. */
export function entrar(correo) {
  const pedido = http.post(`${BASE_URL}/auth/enlace`, JSON.stringify({ correo }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(pedido, { 'auth/enlace → 202': (r) => r.status === 202 });
  const cuerpo = pedido.json();
  if (!cuerpo || !cuerpo.enlaceDeDesarrollo) {
    throw new Error(
      'la API no devolvió enlaceDeDesarrollo: esto sólo funciona contra un servidor en modo ' +
        'desarrollo (NODE_ENV !== "production"). Contra producción hace falta otra vía de sesión.',
    );
  }
  const url = new URL(cuerpo.enlaceDeDesarrollo);
  const token = url.searchParams.get('token');
  const sesion = http.post(`${BASE_URL}/auth/sesion`, JSON.stringify({ token }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(sesion, { 'auth/sesion → 200': (r) => r.status === 200 });
  return sesion.json();
}

export function como(testigo) {
  return { headers: { Authorization: `Bearer ${testigo}`, 'Content-Type': 'application/json' } };
}

let contador = 0;
/** `requestId` único por VU y por iteración — formato UUID-v4-con-forma, igual que en el resto del repo. */
export function requestId() {
  const vu = typeof __VU === 'number' ? __VU : 0;
  const hex = (vu * 1_000_000 + ++contador).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}
