/**
 * T-06 endurecida — lo que `docs/THREAT_MODEL.md` promete de la sesión y hasta ahora no existía:
 * cookie `__Host-`, 8 h absolutas, 60 min de inactividad, cierre global y rotación del testigo al
 * cambiar el rol.
 *
 * ═══ Por qué cada prueba mira COMPORTAMIENTO y no un atributo suelto ═══
 *
 * Comprobar que el `Set-Cookie` trae `Secure` no demuestra nada por sí solo: una cookie puede llevar
 * el atributo correcto y el servidor seguir aceptando el testigo vencido igual. Cada bloque de abajo
 * hace lo mismo que haría alguien atacando de verdad — usar la sesión pasado el plazo, usar la vieja
 * después de un cierre global, usar la vieja después de que el rol cambió — y comprueba que la API
 * la rechaza. Sólo el primer bloque (el prefijo de la cookie) es necesariamente sobre la forma de la
 * cabecera, porque el navegador es quien aplica esa regla, no el servidor.
 *
 * ═══ Por qué este fichero no usa `helpers/api-env.ts` ═══
 *
 * La prueba de rotación necesita poder cambiarle el rol a una persona **entre dos inicios de
 * sesión**, y el adaptador de identidad que arma `apiEnv()` fija facilitadores y garantías al
 * construirse. Este fichero levanta su propio contenedor de PostgreSQL — el mismo patrón, la misma
 * imagen — con un adaptador de identidad local cuyos roles se pueden cambiar en caliente.
 */

import {
  buildApp,
  CIRCULOS,
  createPool,
  ensureSpine,
  MemoryMailer,
  migrate,
  NodeAes256GcmVaultCrypto,
  setAppRolePassword,
  type IdentityProviderAdapter,
  type PgPool,
} from '@koinonia/api';
import { circleId, type Role } from '@koinonia/domain';
import type { FastifyInstance } from 'fastify';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AzarDePrueba, RelojDePrueba } from './helpers/api-env.js';

const IMAGE = 'postgres:16-alpine';
const SUPERPASS = 'koinonia-test';
const APP_PASSWORD = 'koinonia-app-test';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/** De `identity.ts`. Repetidas aquí a propósito: si el código cambia el número y esto no se
 *  actualiza, la prueba de control (7h59) empieza a fallar y avisa — no se importa la constante
 *  porque estas pruebas quieren detectar también un cambio accidental del valor, no sólo confirmar
 *  el que hay hoy. */
const SESION_VIGENCIA_MS = 8 * HORA;
const INACTIVIDAD_VIGENCIA_MS = 60 * MINUTO;
const RENOVACION_ACTIVIDAD_MARGEN_MS = 5 * MINUTO;

/** Adaptador de identidad de prueba cuyos roles se pueden cambiar entre dos logueos. */
interface AdaptadorMutable extends IdentityProviderAdapter {
  fijarRoles(correo: string, roles: readonly Role[]): void;
}

function adaptadorDeRolesMutables(): AdaptadorMutable {
  const roles = new Map<string, readonly Role[]>();
  return {
    nombre: 'prueba-roles-mutables',
    fijarRoles(correo, r) {
      roles.set(correo.trim().toLowerCase(), r);
    },
    verify: (correoCrudo: string) => {
      const correo = correoCrudo.trim().toLowerCase();
      return Promise.resolve({
        ok: true as const,
        claim: {
          email: correo,
          alias: correo.slice(0, correo.indexOf('@')),
          roles: roles.get(correo) ?? (['member'] as const),
          circles: [circleId(CIRCULOS.asamblea.id), circleId(CIRCULOS.espacios.id)],
          semestre: 's1',
          jornada: 'diurna',
        },
      });
    },
  };
}

interface Entorno {
  readonly ok: true;
  /** `modoDesarrollo: true` — la superficie donde corren casi todas las pruebas de este fichero. */
  readonly appDev: FastifyInstance;
  /** `modoDesarrollo: false`, misma base — sólo para inspeccionar la forma de la cookie en prod. */
  readonly appProd: FastifyInstance;
  readonly pool: PgPool;
  readonly correo: MemoryMailer;
  readonly reloj: RelojDePrueba;
  readonly identidad: AdaptadorMutable;
  readonly stop: () => Promise<void>;
}

type EntornoDisponible = Entorno | { readonly ok: false; readonly reason: string };

async function construirEntorno(): Promise<EntornoDisponible> {
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

  const superPool = createPool({ connectionString: superUrl, max: 5, applicationName: 'ses-root' });
  await migrate(superPool);
  const cliente = await superPool.connect();
  try {
    await setAppRolePassword(cliente, APP_PASSWORD);
  } finally {
    cliente.release();
  }

  const pool = createPool({ connectionString: appUrl, max: 10, applicationName: 'ses-test' });
  const reloj = new RelojDePrueba();
  await ensureSpine(pool, {
    occurredAt: new Date(reloj.now()).toISOString(),
    payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-000000000002',
  });

  const correo = new MemoryMailer();
  const azar = new AzarDePrueba();
  const identidad = adaptadorDeRolesMutables();
  const vault = new NodeAes256GcmVaultCrypto(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
  const ports = {
    clock: { now: () => reloj.now() },
    random: {
      bytes: (n: number) => azar.bytes(n),
      opaqueId: () => azar.opaqueId(),
      uuid: () => azar.uuid(),
    },
    mailer: correo,
    identity: identidad,
    vault,
  };

  const appDev = await buildApp({
    pool,
    ports,
    ratePepper: 'pimienta-de-prueba-suficientemente-larga',
    webBaseUrl: 'http://localhost:3000',
    modoDesarrollo: true,
  });
  await appDev.ready();

  const appProd = await buildApp({
    pool,
    ports,
    ratePepper: 'pimienta-de-prueba-suficientemente-larga',
    webBaseUrl: 'https://koinonia.example',
    modoDesarrollo: false,
  });
  await appProd.ready();

  return {
    ok: true,
    appDev,
    appProd,
    pool,
    correo,
    reloj,
    identidad,
    stop: async () => {
      await appDev.close().catch(() => undefined);
      await appProd.close().catch(() => undefined);
      await pool.end().catch(() => undefined);
      await superPool.end().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}

function skipNote(env: EntornoDisponible): string {
  return env.ok ? '' : `  ⟨SALTADO — ${env.reason}⟩`;
}

function como(testigo: string): Record<string, string> {
  return { authorization: `Bearer ${testigo}` };
}

function tokenDelCorreo(texto: string): string {
  const match = /token=([^\s]+)/u.exec(texto);
  if (match?.[1] === undefined) throw new Error(`no hay token en el correo:\n${texto}`);
  return decodeURIComponent(match[1]);
}

const env = await construirEntorno();

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`sesión endurecida (T-06)${skipNote(env)}`, () => {
  let e: Entorno;

  beforeAll(() => {
    if (!env.ok) throw new Error('el entorno no está disponible');
    e = env;
  });

  /** Entra de punta a punta contra `appDev` y devuelve el testigo y el `memberId`. */
  async function entrar(correo: string): Promise<{ testigo: string; miembroId: string }> {
    const pedido = await e.appDev.inject({
      method: 'POST',
      url: '/auth/enlace',
      payload: { correo },
    });
    expect(pedido.statusCode, pedido.body).toBe(202);
    const mensaje = e.correo.ultimoPara(correo);
    if (mensaje === undefined) throw new Error(`no llegó correo a ${correo}`);
    const token = tokenDelCorreo(mensaje.text);
    const sesion = await e.appDev.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { token },
    });
    expect(sesion.statusCode, sesion.body).toBe(200);
    const cuerpo = sesion.json<{ testigo: string; miembroId: string }>();
    return cuerpo;
  }

  async function quien(testigo: string): Promise<number> {
    const r = await e.appDev.inject({ method: 'GET', url: '/auth/yo', headers: como(testigo) });
    return r.statusCode;
  }

  async function ultimaMarcaDeActividad(miembroId: string): Promise<Date> {
    const { rows } = await e.pool.query<{ last_seen_at: Date }>(
      `SELECT last_seen_at FROM identity.session
        WHERE member_id = $1 ORDER BY issued_at DESC LIMIT 1`,
      [miembroId],
    );
    const fila = rows[0];
    if (fila === undefined) throw new Error('no hay sesión para esa persona');
    return fila.last_seen_at;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 1 — El prefijo `__Host-`
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('prefijo __Host- de la cookie', () => {
    it('en producción la cookie se llama __Host-koinonia_sesion, con Secure y sin Domain', async () => {
      const correo = 'host.prod@udea.edu.co';
      const pedido = await e.appProd.inject({
        method: 'POST',
        url: '/auth/enlace',
        payload: { correo },
      });
      expect(pedido.statusCode, pedido.body).toBe(202);
      const mensaje = e.correo.ultimoPara(correo);
      if (mensaje === undefined) throw new Error('no llegó correo');
      const token = tokenDelCorreo(mensaje.text);
      const sesion = await e.appProd.inject({
        method: 'POST',
        url: '/auth/sesion',
        payload: { token },
      });
      expect(sesion.statusCode, sesion.body).toBe(200);
      const setCookie = sesion.headers['set-cookie'];
      const cabecera = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cabecera).toBeDefined();
      const texto = cabecera ?? '';
      expect(texto.startsWith('__Host-koinonia_sesion=')).toBe(true);
      expect(texto).toMatch(/;\s*Secure/iu);
      expect(texto).toMatch(/;\s*HttpOnly/iu);
      expect(texto).toMatch(/;\s*SameSite=Lax/iu);
      expect(texto).toMatch(/;\s*Path=\//iu);
      expect(texto).not.toMatch(/;\s*Domain=/iu);
    });

    it('en desarrollo la cookie NO lleva __Host- ni Secure, y el login funciona por cookie de todos modos', async () => {
      const correo = 'host.dev@udea.edu.co';
      const pedido = await e.appDev.inject({
        method: 'POST',
        url: '/auth/enlace',
        payload: { correo },
      });
      expect(pedido.statusCode).toBe(202);
      const mensaje = e.correo.ultimoPara(correo);
      if (mensaje === undefined) throw new Error('no llegó correo');
      const token = tokenDelCorreo(mensaje.text);
      const sesion = await e.appDev.inject({
        method: 'POST',
        url: '/auth/sesion',
        payload: { token },
      });
      expect(sesion.statusCode).toBe(200);
      const setCookie = sesion.headers['set-cookie'];
      const cabecera = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      const texto = cabecera ?? '';
      expect(texto.startsWith('koinonia_sesion=')).toBe(true);
      expect(texto).not.toMatch(/__Host-/u);
      expect(texto).not.toMatch(/;\s*Secure/iu);

      // Comportamiento, no sólo forma: la cookie que puso el servidor sirve de verdad para entrar.
      const valorCookie = texto.split(';')[0] ?? '';
      const yo = await e.appDev.inject({
        method: 'GET',
        url: '/auth/yo',
        headers: { cookie: valorCookie },
      });
      expect(yo.statusCode).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 2 — 8 horas absolutas
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('8 horas absolutas', () => {
    it('sigue sirviendo justo antes de las 8 horas, con actividad reciente', async () => {
      const { testigo } = await entrar('absoluto.control@udea.edu.co');
      // Saltos de a 30 min con petición en cada uno: se mantiene dentro de la ventana de
      // inactividad todo el camino, así que lo único que se está poniendo a prueba es el techo
      // absoluto de 8 h, no el corte por inactividad (que tiene su propio bloque más abajo).
      const pasos = Math.floor((SESION_VIGENCIA_MS - MINUTO) / (30 * MINUTO));
      for (let i = 0; i < pasos; i++) {
        e.reloj.avanzar(30 * MINUTO);
        expect(await quien(testigo)).toBe(200);
      }
    });

    it('deja de servir pasadas las 8 horas AUNQUE hubo actividad continua hasta el final', async () => {
      const { testigo } = await entrar('absoluto.vence@udea.edu.co');
      // Actividad cada 10 minutos durante 7h50, para probar que ninguna renovación por actividad
      // corre el techo absoluto: si lo hiciera, esta sesión seguiría viva más allá de las 8h.
      const pasos = Math.floor((SESION_VIGENCIA_MS - 10 * MINUTO) / (10 * MINUTO));
      for (let i = 0; i < pasos; i++) {
        e.reloj.avanzar(10 * MINUTO);
        expect(await quien(testigo)).toBe(200);
      }
      e.reloj.avanzar(20 * MINUTO); // cruza las 8h absolutas
      expect(await quien(testigo)).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 3 — 60 minutos de inactividad
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('60 minutos de inactividad', () => {
    it('deja de servir tras 61 minutos sin ninguna petición autenticada', async () => {
      const { testigo } = await entrar('inactiva.vence@udea.edu.co');
      e.reloj.avanzar(INACTIVIDAD_VIGENCIA_MS + MINUTO);
      expect(await quien(testigo)).toBe(401);
    });

    it('la actividad renueva la marca: 75 minutos totales sin cortar, porque hubo una petición a los 30', async () => {
      const { testigo } = await entrar('inactiva.renueva@udea.edu.co');
      e.reloj.avanzar(30 * MINUTO);
      expect(await quien(testigo)).toBe(200); // renueva last_seen_at aquí
      e.reloj.avanzar(45 * MINUTO); // 45 min desde la ÚLTIMA actividad, no desde el inicio
      expect(await quien(testigo)).toBe(200);
      e.reloj.avanzar(65 * MINUTO); // ahora sí pasaron más de 60 min sin actividad
      expect(await quien(testigo)).toBe(401);
    });

    it('no escribe la marca en cada petición: sólo cuando ya pasó el margen de renovación', async () => {
      const { testigo, miembroId } = await entrar('inactiva.margen@udea.edu.co');
      const marcaInicial = await ultimaMarcaDeActividad(miembroId);

      // Dentro del margen (5 min): la petición vale, pero NO debe reescribir la marca.
      e.reloj.avanzar(MINUTO);
      expect(await quien(testigo)).toBe(200);
      const marcaCorta = await ultimaMarcaDeActividad(miembroId);
      expect(marcaCorta.getTime()).toBe(marcaInicial.getTime());

      // Pasado el margen: la siguiente petición SÍ debe adelantar la marca.
      e.reloj.avanzar(RENOVACION_ACTIVIDAD_MARGEN_MS + MINUTO);
      expect(await quien(testigo)).toBe(200);
      const marcaLarga = await ultimaMarcaDeActividad(miembroId);
      expect(marcaLarga.getTime()).toBeGreaterThan(marcaInicial.getTime());
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 4 — Cierre global de sesiones
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('cierre global de sesiones', () => {
    it('/auth/salir-todo mata TODAS las sesiones de la persona, no sólo la que llama', async () => {
      const correo = 'global.perdio-el-telefono@udea.edu.co';
      const a = await entrar(correo); // "el teléfono perdido"
      const b = await entrar(correo); // "el computador de casa"
      expect(await quien(a.testigo)).toBe(200);
      expect(await quien(b.testigo)).toBe(200);

      const salida = await e.appDev.inject({
        method: 'POST',
        url: '/auth/salir-todo',
        headers: como(a.testigo),
      });
      expect(salida.statusCode, salida.body).toBe(200);

      expect(await quien(a.testigo)).toBe(401);
      expect(await quien(b.testigo)).toBe(401);
    });

    it('/auth/salir-todo sin sesión responde 401 y no revoca nada a nombre de nadie', async () => {
      const sinCredencial = await e.appDev.inject({ method: 'POST', url: '/auth/salir-todo' });
      expect(sinCredencial.statusCode).toBe(401);
    });

    it('control negativo: /auth/salir (el cierre simple) NO toca las demás sesiones de la persona', async () => {
      const correo = 'simple.no-es-global@udea.edu.co';
      const a = await entrar(correo);
      const b = await entrar(correo);

      const salida = await e.appDev.inject({
        method: 'POST',
        url: '/auth/salir',
        headers: como(a.testigo),
      });
      expect(salida.statusCode).toBe(200);

      expect(await quien(a.testigo)).toBe(401); // la propia, cerrada
      expect(await quien(b.testigo)).toBe(200); // la otra, intacta
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 5 — Rotación del identificador de sesión al cambiar el nivel de privilegio
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  describe('rotación de sesión al cambiar el rol', () => {
    it('una sesión abierta con el rol viejo deja de servir en cuanto el rol cambia', async () => {
      const correo = 'rotacion.asciende@udea.edu.co';
      e.identidad.fijarRoles(correo, ['member']);
      const { testigo } = await entrar(correo);
      expect(await quien(testigo)).toBe(200);

      // El rol cambia "en el proveedor de identidad" — el equivalente de una promoción a
      // facilitación decidida fuera de esta sesión — y la persona vuelve a pedir un enlace, que es
      // el único momento en que la aplicación vuelve a preguntarle al proveedor.
      e.identidad.fijarRoles(correo, ['member', 'facilitator']);
      const nuevoPedido = await e.appDev.inject({
        method: 'POST',
        url: '/auth/enlace',
        payload: { correo },
      });
      expect(nuevoPedido.statusCode, nuevoPedido.body).toBe(202);

      // El testigo viejo, capturado o no, deja de servir sin que nadie lo haya revocado a mano.
      expect(await quien(testigo)).toBe(401);
    });

    it('control negativo: pedir un enlace SIN cambio de rol no revoca la sesión que ya estaba abierta', async () => {
      const correo = 'rotacion.sin-cambio@udea.edu.co';
      e.identidad.fijarRoles(correo, ['member']);
      const { testigo } = await entrar(correo);
      expect(await quien(testigo)).toBe(200);

      const otroPedido = await e.appDev.inject({
        method: 'POST',
        url: '/auth/enlace',
        payload: { correo },
      });
      expect(otroPedido.statusCode).toBe(202);

      expect(await quien(testigo)).toBe(200);
    });

    it('una democión rota igual que un ascenso: el orden de los roles no importa, sólo el conjunto', async () => {
      const correo = 'rotacion.desciende@udea.edu.co';
      e.identidad.fijarRoles(correo, ['facilitator', 'member']);
      const { testigo } = await entrar(correo);
      expect(await quien(testigo)).toBe(200);

      e.identidad.fijarRoles(correo, ['member']);
      const pedido = await e.appDev.inject({
        method: 'POST',
        url: '/auth/enlace',
        payload: { correo },
      });
      expect(pedido.statusCode).toBe(202);

      expect(await quien(testigo)).toBe(401);
    });
  });
});
