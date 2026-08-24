/**
 * Entorno real para las pruebas de carga ejecutables: PostgreSQL en un contenedor efímero
 * (Testcontainers, igual que `tests/integration/`) y, cuando hace falta, la API completa
 * escuchando en un socket TCP real de verdad — `app.listen()`, no `app.inject()`. La diferencia
 * importa: `inject()` nunca toca la pila de red, y un guion de carga que no la toca no mide nada
 * de lo que un pico de tráfico real le hace al servidor.
 *
 * Está deliberadamente DUPLICADO respecto de `tests/integration/helpers/api-env.ts` en vez de
 * importarlo: ese fichero es de otro dueño (varios agentes escriben pruebas de integración a la
 * vez) y `tests/carga/**` es propiedad exclusiva de este encargo. Duplicar treinta líneas de
 * arranque es más barato que arriesgar un choque de escritura en un fichero ajeno.
 */

import {
  buildApp,
  createPool,
  cryptoRandom,
  ensureSpine,
  MemoryMailer,
  migrate,
  NodeAes256GcmVaultCrypto,
  setAppRolePassword,
  udeaIdentityAdapter,
} from '@koinonia/api';
import { GenericContainer, Wait } from 'testcontainers';

const IMAGEN_POSTGRES = 'postgres:16-alpine';
const SUPERPASS = 'koinonia-carga';
const APP_PASSWORD = 'koinonia-carga-app';

/** Reloj controlable: el tiempo, también aquí, entra como parámetro (ADR-0001). */
export function crearReloj(inicioMs = Date.now()) {
  let t = inicioMs;
  return {
    now: () => t,
    avanzar: (deltaMs) => {
      t += deltaMs;
    },
  };
}

async function levantarPostgres() {
  const container = await new GenericContainer(IMAGEN_POSTGRES)
    .withEnvironment({
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: SUPERPASS,
      POSTGRES_DB: 'koinonia',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .withStartupTimeout(180_000)
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  return {
    container,
    superUrl: `postgresql://postgres:${SUPERPASS}@${host}:${String(port)}/koinonia`,
    appUrl: `postgresql://koinonia_app:${APP_PASSWORD}@${host}:${String(port)}/koinonia`,
  };
}

/**
 * Entorno mínimo: sólo la base con las migraciones aplicadas y el rol de aplicación listo. Sirve
 * para los bancos de pruebas que hablan con el ledger directamente (`append`, `readStream`,
 * `verifyLedger`) sin pasar por HTTP — más rápido de levantar y más fácil de leer.
 */
export async function crearEntornoLedger({ poolMax = 20 } = {}) {
  const { container, superUrl, appUrl } = await levantarPostgres();
  const superPool = createPool({
    connectionString: superUrl,
    max: 10,
    applicationName: 'carga-root',
  });
  await migrate(superPool);
  const cliente = await superPool.connect();
  try {
    await setAppRolePassword(cliente, APP_PASSWORD);
  } finally {
    cliente.release();
  }
  const appPool = createPool({
    connectionString: appUrl,
    max: poolMax,
    applicationName: 'carga-ledger',
  });
  // El único evento con `prevHash = 0x00…00`: sin él ningún agregado puede nacer (`expectedHead:
  // {kind:'new'}` exige colgar de una cabeza existente).
  await ensureSpine(appPool, {
    occurredAt: '2026-08-21T12:00:00.000Z',
    payload: { vigencia: 'carga', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-0000000000f2',
  });
  return {
    superPool,
    appPool,
    stop: async () => {
      await appPool.end().catch(() => undefined);
      await superPool.end().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}

/**
 * Entorno completo: la API entera (`buildApp`) escuchando en un puerto real de `127.0.0.1`
 * asignado por el sistema operativo (`port: 0`). `baseUrl` es lo que hay que usarle a `fetch()`.
 *
 * El correo se intercepta en memoria (`MemoryMailer`) pero NO hace falta leerlo para autenticar:
 * con `modoDesarrollo: true` la propia respuesta de `POST /auth/enlace` trae `enlaceDeDesarrollo`
 * con el token adentro — es el mismo atajo que usa `pnpm dev` en la consola (`scripts/dev.mjs`), y
 * es lo que hace que un guion de carga con `fetch()` a secas pueda entrar sin tocar el correo.
 */
export async function crearEntornoHttp({ poolMax = 20, facilitadores = [], garantias = [] } = {}) {
  const { container, superUrl, appUrl } = await levantarPostgres();
  const superPool = createPool({
    connectionString: superUrl,
    max: 10,
    applicationName: 'carga-root',
  });
  await migrate(superPool);
  const cliente = await superPool.connect();
  try {
    await setAppRolePassword(cliente, APP_PASSWORD);
  } finally {
    cliente.release();
  }
  const pool = createPool({
    connectionString: appUrl,
    max: poolMax,
    applicationName: 'carga-http',
  });

  const reloj = crearReloj();
  await ensureSpine(pool, {
    occurredAt: new Date(reloj.now()).toISOString(),
    payload: { vigencia: 'carga', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-0000000000f1',
  });

  const correo = new MemoryMailer();
  const vault = new NodeAes256GcmVaultCrypto(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  const app = await buildApp({
    pool,
    ports: {
      clock: { now: () => reloj.now() },
      random: cryptoRandom,
      mailer: correo,
      identity: udeaIdentityAdapter({ facilitadores, garantias }),
      vault,
    },
    ratePepper: 'pimienta-de-carga-suficientemente-larga-para-pasar-la-validacion',
    webBaseUrl: 'http://localhost:3000',
    modoDesarrollo: true,
  });
  if (process.env['CARGA_DEBUG_ERRORES'] === '1') {
    // `setErrorHandler` (dentro de `buildApp`) nunca imprime la causa real — a propósito, para que
    // ninguna traza técnica llegue a la pantalla (docs/TESTING.md §1.8). Este `onError` es un hook
    // ADICIONAL, no un reemplazo: corre antes del manejador y sólo sirve para diagnosticar un guion
    // de carga que ve más 500 de los esperados.
    app.addHook('onError', async (request, _reply, error) => {
      console.error(`\n[CARGA_DEBUG_ERRORES] ${request.method} ${request.url} →`, error);
    });
  }

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const direccion = app.server.address();
  if (direccion === null || typeof direccion === 'string') {
    throw new Error('el servidor no devolvió una dirección TCP real');
  }
  const baseUrl = `http://127.0.0.1:${String(direccion.port)}`;

  return {
    app,
    baseUrl,
    pool,
    superPool,
    reloj,
    stop: async () => {
      await app.close().catch(() => undefined);
      await pool.end().catch(() => undefined);
      await superPool.end().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}

/**
 * Entra como `correo` contra un entorno HTTP real y devuelve el testigo de sesión (`Bearer`).
 * Dos peticiones reales de verdad (`/auth/enlace`, `/auth/sesion`); nada de esto se mide como carga
 * — es el costo de preparar el escenario, no lo que el escenario mide.
 */
export async function entrarHttp(baseUrl, correo) {
  const pedido = await fetch(`${baseUrl}/auth/enlace`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ correo }),
  });
  if (pedido.status !== 202) {
    throw new Error(`no se pudo pedir el enlace para ${correo}: ${String(pedido.status)}`);
  }
  const { enlaceDeDesarrollo } = await pedido.json();
  if (typeof enlaceDeDesarrollo !== 'string') {
    throw new Error('la API no devolvió enlaceDeDesarrollo: ¿modoDesarrollo está apagado?');
  }
  const token = new URL(enlaceDeDesarrollo).searchParams.get('token');
  if (token === null) throw new Error('el enlace de desarrollo no trae token');

  const sesion = await fetch(`${baseUrl}/auth/sesion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (sesion.status !== 200) {
    throw new Error(`no se pudo canjear el enlace de ${correo}: ${String(sesion.status)}`);
  }
  const cuerpo = await sesion.json();
  return cuerpo;
}

export function comoHttp(testigo) {
  return { authorization: `Bearer ${testigo}`, 'content-type': 'application/json' };
}

let contador = 0;
/** `requestId` único por llamada — mismo formato UUID-v4-con-forma que usan las pruebas de integración. */
export function requestId() {
  const hex = (++contador + 0x9000).toString(16).padStart(32, '0');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}
