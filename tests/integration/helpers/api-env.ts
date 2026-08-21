/**
 * Entorno de las pruebas de la capa HTTP: la aplicación **entera** contra PostgreSQL real.
 *
 * No hay ni un doble del servicio, ni de la base, ni del dominio. Lo único sustituido son los tres
 * puertos que representan el mundo: el reloj (para poder hacer vencer un enlace sin esperar quince
 * minutos), el azar (para que los contraejemplos sean legibles) y el correo (para poder leer el
 * enlace que se envió). Todo lo demás —Fastify, Zod, el ledger, el motor— es el de producción.
 *
 * Se usa `app.inject()` en vez de un socket: entra por el mismo enrutador, los mismos `hooks`, la
 * misma validación y el mismo manejador de errores. Lo que no atraviesa es la pila TCP, que no es lo
 * que estas pruebas comprueban.
 */

import { createHash } from 'node:crypto';

import {
  buildApp,
  createPool,
  ensureSpine,
  MemoryMailer,
  migrate,
  setAppRolePassword,
  udeaIdentityAdapter,
  type PgPool,
} from '@koinonia/api';
import type { FastifyInstance } from 'fastify';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const IMAGE = 'postgres:16-alpine';
const SUPERPASS = 'koinonia-test';
const APP_PASSWORD = 'koinonia-app-test';

/** Reloj controlable. El tiempo es un dato, también en las pruebas. */
export class RelojDePrueba {
  private t: number;

  constructor(inicio = Date.UTC(2026, 7, 21, 14, 0, 0, 0)) {
    this.t = inicio;
  }

  now(): number {
    return this.t;
  }

  avanzar(ms: number): void {
    this.t += ms;
  }
}

/**
 * Azar determinista. No es criptografía: es una prueba, y aquí el determinismo vale más.
 *
 * DECISIÓN: se genera con SHA-256 en **modo contador** y no con un generador congruencial lineal.
 * La primera versión de este ayudante usaba un LCG y tomaba el byte bajo (`n & 0xff`), que en un LCG
 * de módulo 2^32 tiene periodo **256**: a los pocos cientos de bytes el flujo se repetía, dos
 * enlaces mágicos salían idénticos y el `INSERT` chocaba contra la clave primaria. El síntoma fue un
 * 500 en una prueba que no tenía nada que ver, y el diagnóstico costó más que escribir esto bien.
 */
export class AzarDePrueba {
  private n = 0;

  bytes(cantidad: number): Uint8Array {
    const salida = new Uint8Array(cantidad);
    let escritos = 0;
    while (escritos < cantidad) {
      const bloque = createHash('sha256')
        .update(`koinonia-prueba|${String(this.n++)}`, 'utf8')
        .digest();
      const trozo = Math.min(bloque.length, cantidad - escritos);
      salida.set(bloque.subarray(0, trozo), escritos);
      escritos += trozo;
    }
    return salida;
  }

  opaqueId(): string {
    return [...this.bytes(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  uuid(): string {
    const hex = [...this.bytes(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return (
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
      `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    );
  }
}

export interface ApiListo {
  readonly ok: true;
  readonly app: FastifyInstance;
  readonly pool: PgPool;
  readonly superPool: PgPool;
  readonly correo: MemoryMailer;
  readonly reloj: RelojDePrueba;
  readonly azar: AzarDePrueba;
  readonly stop: () => Promise<void>;
}

export interface ApiNoDisponible {
  readonly ok: false;
  readonly reason: string;
}

export type ApiEnv = ApiListo | ApiNoDisponible;

/** Correos con rol de facilitación. Abrir una votación es un encargo, no un derecho general. */
export const FACILITADORA = 'lucia.facilita@udea.edu.co';
export const GARANTIAS = 'garantias.uno@udea.edu.co';

export async function apiEnv(): Promise<ApiEnv> {
  let container: StartedTestContainer;
  try {
    container = await new GenericContainer(IMAGE)
      .withEnvironment({
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: SUPERPASS,
        POSTGRES_DB: 'koinonia',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
      .withStartupTimeout(180_000)
      .start();
  } catch (error) {
    const reason =
      'Testcontainers no pudo levantar Docker: ' +
      (error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : 'desconocido');
    if (process.env['KOINONIA_REQUIRE_DOCKER'] === '1') {
      throw new Error(`${reason}. KOINONIA_REQUIRE_DOCKER=1 exige que corran de verdad.`, {
        cause: error,
      });
    }
    return { ok: false, reason };
  }

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const superUrl = `postgresql://postgres:${SUPERPASS}@${host}:${String(port)}/koinonia`;
  const appUrl = `postgresql://koinonia_app:${APP_PASSWORD}@${host}:${String(port)}/koinonia`;

  const superPool = createPool({
    connectionString: superUrl,
    max: 10,
    applicationName: 'api-root',
  });
  await migrate(superPool);
  const client = await superPool.connect();
  try {
    await setAppRolePassword(client, APP_PASSWORD);
  } finally {
    client.release();
  }

  const pool = createPool({ connectionString: appUrl, max: 20, applicationName: 'api-test' });
  const reloj = new RelojDePrueba();
  await ensureSpine(pool, {
    occurredAt: new Date(reloj.now()).toISOString(),
    payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-000000000001',
  });

  const correo = new MemoryMailer();
  const azar = new AzarDePrueba();
  const app = await buildApp({
    pool,
    ports: {
      clock: { now: () => reloj.now() },
      random: {
        bytes: (n) => azar.bytes(n),
        opaqueId: () => azar.opaqueId(),
        uuid: () => azar.uuid(),
      },
      mailer: correo,
      identity: udeaIdentityAdapter({
        facilitadores: [FACILITADORA],
        garantias: [GARANTIAS],
      }),
    },
    ratePepper: 'pimienta-de-prueba-suficientemente-larga',
    webBaseUrl: 'http://localhost:3000',
    modoDesarrollo: true,
  });
  await app.ready();

  return {
    ok: true,
    app,
    pool,
    superPool,
    correo,
    reloj,
    azar,
    stop: async () => {
      await app.close().catch(() => undefined);
      await pool.end().catch(() => undefined);
      await superPool.end().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}

export function listo(env: ApiEnv): ApiListo {
  if (!env.ok) throw new Error(`el entorno de la API no está disponible: ${env.reason}`);
  return env;
}

export function skipNote(env: ApiEnv): string {
  return env.ok ? '' : `  ⟨SALTADO — ${env.reason}⟩`;
}

/** Extrae el testigo del enlace mágico del correo enviado. */
export function tokenDelCorreo(texto: string): string {
  const match = /token=([^\s]+)/u.exec(texto);
  if (match?.[1] === undefined) throw new Error(`no hay token en el correo:\n${texto}`);
  return decodeURIComponent(match[1]);
}

/** Sesión abierta de punta a punta: pide el enlace, lo lee del correo y lo canjea. */
export async function entrar(
  env: ApiListo,
  correo: string,
): Promise<{ readonly testigo: string; readonly miembroId: string; readonly roles: string[] }> {
  const pedido = await env.app.inject({
    method: 'POST',
    url: '/auth/enlace',
    payload: { correo },
  });
  if (pedido.statusCode !== 202) {
    throw new Error(`no se pudo pedir el enlace: ${String(pedido.statusCode)} ${pedido.body}`);
  }
  const mensaje = env.correo.ultimoPara(correo);
  if (mensaje === undefined) throw new Error(`no llegó correo a ${correo}`);
  const token = tokenDelCorreo(mensaje.text);

  const sesion = await env.app.inject({
    method: 'POST',
    url: '/auth/sesion',
    payload: { token },
  });
  if (sesion.statusCode !== 200) {
    throw new Error(`no se pudo canjear: ${String(sesion.statusCode)} ${sesion.body}`);
  }
  const cuerpo = sesion.json<{ testigo: string; miembroId: string; roles: string[] }>();
  return cuerpo;
}

/** Cabeceras de una persona. Es también el camino que usan las pruebas para saltarse la interfaz. */
export function como(testigo: string): Record<string, string> {
  return { authorization: `Bearer ${testigo}` };
}
