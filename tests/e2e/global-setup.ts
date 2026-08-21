/**
 * Arranque del entorno de extremo a extremo.
 *
 * Levanta **lo real**: PostgreSQL en un contenedor, las migraciones, la espina del historial y el
 * servicio de gobernanza escuchando en un puerto. La interfaz la arranca Playwright con `webServer`.
 * No hay ni un doble: si algo de esto no funciona, los E2E no pasan, que es exactamente para lo que
 * están.
 *
 * El estado del entorno se escribe en `.entorno.json` porque los tests corren en otros procesos y
 * necesitan dos cosas de aquí: la URL de la API (para llamarla **saltándose la interfaz**) y la
 * cadena de conexión de superusuario (para manipular el historial por debajo y comprobar que la
 * pantalla de verificación lo denuncia).
 */

import { createServer, type Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildApp,
  createPool,
  cryptoRandom,
  ensureSpine,
  migrate,
  setAppRolePassword,
  systemClock,
  udeaIdentityAdapter,
} from '@koinonia/api';
import type { FastifyInstance } from 'fastify';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

export const PUERTO_API = 3101;
/**
 * Puerto del **control del reloj**.
 *
 * Una votación dura horas y un test dura segundos. Sin poder mover el reloj, el escenario de
 * gobernanza no podría llegar nunca al resultado y quedaría cortado justo antes de lo que importa.
 *
 * La alternativa fea sería una puerta trasera en el servicio —«si viene esta cabecera, cerrá
 * igual»—, que es exactamente la clase de excepción que después alguien usa en producción. Aquí no
 * hay nada de eso: el servicio recibe su reloj **por el puerto que ya tenía**, y quien lo mueve es
 * un servidor de tres líneas que vive en `tests/` y no se despliega jamás. El código de producción
 * no sabe que esto existe.
 */
export const PUERTO_RELOJ = 3102;
export const RUTA_ENTORNO = fileURLToPath(new URL('./.entorno.json', import.meta.url));

/** Quien cuida el procedimiento en los escenarios. El rol se fija en el despliegue, no en la app. */
export const CORREO_FACILITADORA = 'lucia.facilita@udea.edu.co';

export interface EntornoE2E {
  readonly apiUrl: string;
  readonly webUrl: string;
  readonly superUrl: string;
  readonly relojUrl: string;
}

let contenedor: StartedTestContainer | undefined;
let servidor: FastifyInstance | undefined;
let reloj: Server | undefined;

/** Desfase acumulado del reloj del servicio, en milisegundos. */
let desfase = 0;

export default async function globalSetup(): Promise<void> {
  const imagen = 'postgres:16-alpine';
  const clave = 'koinonia-e2e';
  const claveApp = 'koinonia-app-e2e';

  contenedor = await new GenericContainer(imagen)
    .withEnvironment({
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: clave,
      POSTGRES_DB: 'koinonia',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .withStartupTimeout(180_000)
    .start();

  const host = contenedor.getHost();
  const puerto = contenedor.getMappedPort(5432);
  const superUrl = `postgresql://postgres:${clave}@${host}:${String(puerto)}/koinonia`;
  const appUrl = `postgresql://koinonia_app:${claveApp}@${host}:${String(puerto)}/koinonia`;

  const superPool = createPool({ connectionString: superUrl, applicationName: 'e2e-root' });
  await migrate(superPool);
  const client = await superPool.connect();
  try {
    await setAppRolePassword(client, claveApp);
  } finally {
    client.release();
  }
  await superPool.end();

  const pool = createPool({ connectionString: appUrl, max: 20, applicationName: 'e2e-api' });
  await ensureSpine(pool, {
    occurredAt: new Date(systemClock.now()).toISOString(),
    payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
    requestId: '00000000-0000-4000-8000-000000000001',
  });

  servidor = await buildApp({
    pool,
    ports: {
      // El reloj del servicio: el del sistema más el desfase que los tests hayan pedido.
      clock: { now: () => systemClock.now() + desfase },
      random: cryptoRandom,
      // Adaptador de consola: en modo de desarrollo el enlace viaja también en la respuesta, que es
      // lo que permite que un test entre sin leer una bandeja de correo.
      mailer: { send: async () => Promise.resolve() },
      identity: udeaIdentityAdapter({ facilitadores: [CORREO_FACILITADORA] }),
    },
    // Los escenarios entran decenas de veces con el mismo correo de facilitación, y en la matriz
    // completa eso se multiplica por cinco navegadores. El límite real —5 enlaces por hora— ya está
    // probado a fondo en `tests/integration/http-enlace-magico.test.ts`; acá estorbaría sin probar
    // nada nuevo. Se sube por configuración, que es lo que la configuración existe para permitir.
    reglas: {
      enlace: { ambito: 'enlace', maximo: 10_000, ventanaMs: 60 * 60 * 1000 },
      escritura: { ambito: 'escritura', maximo: 100_000, ventanaMs: 60 * 60 * 1000 },
    },
    ratePepper: 'pimienta-de-extremo-a-extremo-suficientemente-larga',
    webBaseUrl: 'http://127.0.0.1:3100',
    modoDesarrollo: true,
  });
  await servidor.listen({ port: PUERTO_API, host: '127.0.0.1' });

  /**
   * Deja el historial como el primer día.
   *
   * Hace falta porque los cinco navegadores de la matriz comparten una sola base y el padrón
   * **crece con cada cuenta que entra**: al tercer navegador, dos respuestas ya no alcanzan la
   * participación mínima y el escenario fallaría por una razón que no tiene nada que ver con lo que
   * prueba. Que crezca es correcto —así funciona el padrón—; lo que hay que aislar es cada
   * ejecución.
   *
   * Se hace con el superusuario y desde `tests/`, nunca desde el servicio: en `governance` no hay
   * ninguna ruta que borre nada, y no la va a haber.
   */
  async function reiniciar(): Promise<void> {
    const raiz = createPool({ connectionString: superUrl, applicationName: 'e2e-reset' });
    try {
      const cliente = await raiz.connect();
      try {
        // El blindaje rechaza el `TRUNCATE` —tiene un trigger dedicado para eso— y hay que apagarlo
        // a mano, con el superusuario, para poder borrar. Que haya que hacer esto explícitamente es
        // la demostración de que funciona: la aplicación no puede hacerlo ni queriendo, y este
        // rodeo vive en `tests/`, escrito y a la vista.
        await cliente.query(
          'ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only, ' +
            'DISABLE TRIGGER trg_event_no_truncate',
        );
        await cliente.query(
          `TRUNCATE governance.event, governance.aggregate_head, governance.append_request,
                    governance.checkpoint, identity.member, identity.magic_link,
                    identity.session, identity.rate_bucket, identity.decision_seed
             RESTART IDENTITY CASCADE`,
        );
        await cliente.query(
          'UPDATE governance.ledger_cursor SET next_leaf_index = 0 WHERE id = TRUE',
        );
      } finally {
        for (const trigger of ['trg_event_append_only', 'trg_event_no_truncate']) {
          // `ENABLE ALWAYS` y no `ENABLE`: `ENABLE` los deja en modo `ORIGIN`, que
          // `session_replication_role = 'replica'` desactiva. Restaurar mal degrada la defensa sin
          // que se note.
          await cliente
            .query(`ALTER TABLE governance.event ENABLE ALWAYS TRIGGER ${trigger}`)
            .catch(() => undefined);
        }
        cliente.release();
      }
    } finally {
      await raiz.end();
    }
    desfase = 0;
    await ensureSpine(pool, {
      occurredAt: new Date(systemClock.now()).toISOString(),
      payload: { vigencia: '2026_2', instituto: 'filosofia_udea' },
      requestId: '00000000-0000-4000-8000-000000000001',
    });
  }

  reloj = createServer((peticion, respuesta) => {
    if (peticion.method !== 'POST') {
      respuesta.writeHead(404).end();
      return;
    }
    if (peticion.url === '/reiniciar') {
      reiniciar()
        .then(() => {
          respuesta.writeHead(200, { 'content-type': 'application/json' });
          respuesta.end(JSON.stringify({ reiniciado: true }));
        })
        .catch((error: unknown) => {
          respuesta.writeHead(500, { 'content-type': 'application/json' });
          respuesta.end(JSON.stringify({ error: String(error) }));
        });
      return;
    }
    if (peticion.url !== '/avanzar') {
      respuesta.writeHead(404).end();
      return;
    }
    let cuerpo = '';
    peticion.on('data', (trozo: Buffer) => {
      cuerpo += trozo.toString('utf8');
    });
    peticion.on('end', () => {
      const { ms } = JSON.parse(cuerpo) as { ms: number };
      desfase += ms;
      respuesta.writeHead(200, { 'content-type': 'application/json' });
      respuesta.end(JSON.stringify({ desfase }));
    });
  });
  await new Promise<void>((listo) => reloj?.listen(PUERTO_RELOJ, '127.0.0.1', listo));

  const entorno: EntornoE2E = {
    apiUrl: `http://127.0.0.1:${String(PUERTO_API)}`,
    webUrl: 'http://127.0.0.1:3100',
    superUrl,
    relojUrl: `http://127.0.0.1:${String(PUERTO_RELOJ)}`,
  };
  writeFileSync(RUTA_ENTORNO, JSON.stringify(entorno, null, 2), 'utf8');

  // Se guardan en el propio módulo: `globalTeardown` corre en el mismo proceso.
  globalThis.__koinoniaE2E = { contenedor, servidor, pool, reloj };
}

declare global {
  var __koinoniaE2E:
    | {
        contenedor: StartedTestContainer;
        servidor: FastifyInstance;
        pool: ReturnType<typeof createPool>;
        reloj: Server;
      }
    | undefined;
}
