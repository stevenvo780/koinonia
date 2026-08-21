/**
 * Entorno de pruebas de integración: PostgreSQL **real** vía Testcontainers.
 *
 * ═══ Por qué no hay ni un mock de la base ═══
 *
 * Todo lo que estas pruebas comprueban es **comportamiento de PostgreSQL**: que `uuid` devuelve la
 * forma con guiones, que `jsonb` reordena las claves, que `timestamptz` trunca los milisegundos, que
 * un trigger `ENABLE ALWAYS` sobrevive a `session_replication_role`, que `pg_advisory_xact_lock`
 * serializa de verdad, que un `UPDATE … WHERE head_hash = $esperado` devuelve `rowCount = 0` cuando
 * pierde la carrera. Un doble de la base reproduce exactamente aquello en lo que ya creíamos, que es
 * justo lo que ocultaría estos errores. Un mock aquí no sería una simplificación: sería el error.
 *
 * ═══ Si Docker no está disponible ═══
 *
 * No se simula nada. La suite se **salta** con el motivo escrito en el nombre del bloque, para que
 * quede en la salida de `pnpm test` y nadie confunda «no corrió» con «pasó». Para levantar la base a
 * mano está `infra/docker/docker-compose.yml`.
 */

import { createPool, ensureSpine, migrate, setAppRolePassword, type PgPool } from '@koinonia/api';
import pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const IMAGE = 'postgres:16-alpine';
const SUPERUSER = 'postgres';
const SUPERPASS = 'koinonia-test';
const APP_PASSWORD = 'koinonia-app-test';
const START_TIMEOUT_MS = 180_000;

export interface LedgerReady {
  readonly ok: true;
  /** Pool del superusuario. Es «el administrador con root»: se usa para simular los ataques. */
  readonly superPool: PgPool;
  /** Pool del rol de la aplicación: sólo `SELECT`/`INSERT` sobre `governance.event`. */
  readonly appPool: PgPool;
  readonly superUrl: string;
  readonly appUrl: string;
  readonly stop: () => Promise<void>;
}

export interface LedgerUnavailable {
  readonly ok: false;
  readonly reason: string;
}

export type LedgerEnv = LedgerReady | LedgerUnavailable;

let cached: Promise<LedgerEnv> | undefined;

/**
 * Arranca (una vez por fichero de pruebas) un PostgreSQL real, aplica las migraciones y deja la
 * espina `#ledger` creada.
 */
export function ledgerEnv(): Promise<LedgerEnv> {
  cached ??= start();
  return cached;
}

async function start(): Promise<LedgerEnv> {
  let container: StartedTestContainer;
  try {
    container = await new GenericContainer(IMAGE)
      .withEnvironment({
        POSTGRES_USER: SUPERUSER,
        POSTGRES_PASSWORD: SUPERPASS,
        POSTGRES_DB: 'koinonia',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
      .withStartupTimeout(START_TIMEOUT_MS)
      .start();
  } catch (error) {
    const reason =
      'Testcontainers no pudo levantar Docker: ' +
      (error instanceof Error
        ? (error.message.split('\n')[0] ?? error.message)
        : 'motivo desconocido');
    // En CI saltarse la suite entera en silencio sería peor que fallar: dejaría un build verde que
    // no probó NADA de lo que este subsistema promete. Con `KOINONIA_REQUIRE_DOCKER=1` la ausencia
    // de Docker es un fallo, no una excusa.
    if (process.env['KOINONIA_REQUIRE_DOCKER'] === '1') {
      throw new Error(
        `${reason}. KOINONIA_REQUIRE_DOCKER=1 exige que las pruebas de integración corran de verdad.`,
        { cause: error },
      );
    }
    return { ok: false, reason };
  }

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const superUrl = `postgresql://${SUPERUSER}:${SUPERPASS}@${host}:${String(port)}/koinonia`;
  const appUrl = `postgresql://koinonia_app:${APP_PASSWORD}@${host}:${String(port)}/koinonia`;

  const superPool = createPool({
    connectionString: superUrl,
    max: 40,
    applicationName: 'test-root',
  });
  await migrate(superPool);

  const client = await superPool.connect();
  try {
    await setAppRolePassword(client, APP_PASSWORD);
  } finally {
    client.release();
  }

  const appPool = createPool({ connectionString: appUrl, max: 40, applicationName: 'test-app' });

  // El único evento del sistema con `prevHash = 0x00…00`. Se ancla externamente el día de la puesta
  // en marcha y es la raíz de confianza de todo lo demás.
  await ensureSpine(appPool, {
    occurredAt: '2026-08-21T12:00:00.000Z',
    payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-000000000001',
  });

  return {
    ok: true,
    superPool,
    appPool,
    superUrl,
    appUrl,
    stop: async () => {
      await appPool.end().catch(() => undefined);
      await superPool.end().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}

/** Estrecha el tipo en los tests, que ya corren dentro de un `describe.skipIf(!env.ok)`. */
export function ready(env: LedgerEnv): LedgerReady {
  if (!env.ok) throw new Error(`el entorno del ledger no está disponible: ${env.reason}`);
  return env;
}

/** Sufijo para el nombre del bloque cuando la suite se salta. Se ve en la salida de `pnpm test`. */
export function skipNote(env: LedgerEnv): string {
  return env.ok ? '' : `  ⟨SALTADO — ${env.reason}⟩`;
}

/**
 * Cliente crudo con el rol y la base que se le pidan.
 *
 * Existe para los ataques: `koinonia_app` no puede hacer `UPDATE` ni `DELETE`, así que simular al
 * administrador exige conectarse como superusuario y desactivar explícitamente el trigger. Que haya
 * que hacer eso —y que quede escrito— es precisamente la nota honesta del §4.3.
 */
export async function rawClient(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Identificador opaco de 32 hex, determinista, para no depender de aleatoriedad en los tests. */
export function id32(seed: string): string {
  let out = '';
  let acc = 0;
  for (let i = 0; i < 32; i++) {
    acc = (acc * 31 + seed.charCodeAt(i % seed.length) + i) >>> 0;
    out += '0123456789abcdef'[acc % 16] ?? '0';
  }
  return out;
}

/** UUID v4 sintético y determinista, para los `requestId`. */
export function requestId(seed: string): string {
  const hex = id32(seed);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/** Instante ISO-8601 UTC de 24 caracteres, exactamente el formato que exige `char(24)`. */
export function iso(msFromBase: number): string {
  return new Date(Date.UTC(2026, 7, 21, 14, 0, 0, 0) + msFromBase).toISOString();
}
