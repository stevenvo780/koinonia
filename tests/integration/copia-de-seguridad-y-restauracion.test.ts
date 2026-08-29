/**
 * El ciclo completo de `infra/produccion/copia-de-seguridad.sh` + `restaurar-copia.sh`, contra
 * PostgreSQL real — no contra una descripción de lo que deberían hacer.
 *
 * ═══ El hueco que este fichero existe para que no vuelva ═══
 *
 * `restaurar-copia.sh` restauraba con `pg_restore --no-owner --no-privileges`. Esas dos banderas
 * descartan las sentencias `ALTER … OWNER TO koinonia_ddl` y `GRANT … TO koinonia_app` que el
 * volcado de `copia-de-seguridad.sh` sí trae (ese script no pasa `--no-owner` ni `--no-acl` al hacer
 * el `pg_dump`). El resultado: una base restaurada donde `koinonia_app` no tiene NINGÚN privilegio
 * sobre `governance.event` — ni siquiera para leer. La comprobación de arranque de la API
 * (`inspectLedgerPrivileges`, `services/api/src/db/roles.ts`) hace exactamente lo que tiene que
 * hacer ahí: se niega a servir. El síntoma en producción sería «restauré la copia y la API no
 * arranca», y el arreglo real vive en `restaurar-copia.sh` (ver `asegurar_roles_de_aplicacion` y el
 * comentario junto a cada `pg_restore`), no en este fichero — este fichero es la prueba de que sigue
 * arreglado.
 *
 * ═══ Por qué el ciclo completo y no un test de la función de privilegios sola ═══
 *
 * `append-only.test.ts` y `privilegios-conexion.test.ts` ya comprueban `auditAppGrants` contra una
 * base migrada normalmente. Ninguno de los dos pasa por `pg_dump`/`pg_restore`: el hueco de arriba
 * es enteramente del CAMINO de restauración, y sólo se ve corriéndolo de verdad. Por eso este
 * fichero puebla una base, la respalda con el script real, DESTRUYE el contenedor de origen entero
 * (no sólo la base: el contenedor completo, para que lo que sigue sólo pueda salir del fichero
 * `.dump`) y restaura con el script real — sin acortar ninguno de los dos scripts ni imitarlos con
 * SQL de prueba.
 *
 * ═══ Por qué el modo AISLADO (por defecto) y no `--produccion` ═══
 *
 * `--produccion` exige a propósito una terminal interactiva delante (`[ -t 0 ] || [ -t 1 ]`) y una
 * frase de confirmación escrita a mano — es la barrera que impide que un cron, un script o (aquí)
 * una prueba automatizada la dispare por accidente, y no es una barrera que este fichero deba sortear
 * con una pseudo-terminal fingida: eso pondría a prueba una pseudo-terminal, no el script. El modo
 * AISLADO (el que documenta el simulacro mensual de `COPIAS.md` §6, que es justo la «restauración
 * probada» que exige el pliego) no la necesita, y desde la 0003-en-el-script comparte con
 * `--produccion` exactamente las mismas dos líneas arregladas: `asegurar_roles_de_aplicacion` y el
 * `pg_restore` sin `--no-owner`/`--no-privileges`. Probar el modo aislado a fondo prueba ese
 * mecanismo compartido.
 *
 * ═══ Por qué se reconecta por la IP del puente de Docker ═══
 *
 * El contenedor descartable que crea el modo aislado nace a propósito sin publicar puertos y sin
 * unirse a ninguna red de producción (`COPIAS.md` §5) — es lo que lo hace seguro de correr contra
 * cualquier volcado sin arriesgar nada. Pero por eso mismo no es alcanzable en `127.0.0.1` desde este
 * proceso. Sí es alcanzable por la IP que Docker le asigna en la red `bridge` por defecto —a la que
 * se une igual, por no llevar `--network`— porque este proceso corre en el mismo host que el
 * demonio de Docker. Ir por ahí (`docker inspect`) en vez de tocar el script para que publique un
 * puerto es la decisión correcta: publicar un puerto sólo para que una prueba se conecte debilitaría
 * justo la propiedad que el diseño del modo aislado documenta como su ventaja.
 *
 * Con esa conexión se comprueban las dos cosas que pide el pliego con el MISMO camino que usaría la
 * aplicación real —`readAll`, `auditAppGrants`, `inspectLedgerPrivileges` de `@koinonia/api`— y no
 * con una consulta SQL ad-hoc escrita para esta prueba.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  append,
  auditAppGrants,
  createPool,
  ensureSpine,
  inspectLedgerPrivileges,
  migrate,
  readAll,
  readStream,
  setAppRolePassword,
  type PgPool,
  type StoredEvent,
} from '@koinonia/api';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { id32, iso, requestId } from './helpers/ledger-env.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT_COPIA = join(RAIZ, 'infra', 'produccion', 'copia-de-seguridad.sh');
const SCRIPT_RESTAURAR = join(RAIZ, 'infra', 'produccion', 'restaurar-copia.sh');

const IMAGEN = 'postgres:16-alpine';
const ORIGEN_SUPERPASS = 'koinonia-origen-test';
const ORIGEN_APP_PASSWORD = 'koinonia-app-origen-test';
/**
 * Constante impuesta por el propio `restaurar-copia.sh`: el contenedor descartable del modo aislado
 * SIEMPRE nace con esta contraseña de superusuario (ver `docker run` dentro de `restaurar_aislado`).
 * No es un secreto real — ese contenedor nunca sale de este host y se borra al terminar la prueba—;
 * está acá literal porque hace falta para reconectarse y comprobar qué quedó tras restaurar. Si
 * algún día cambia en el script, esta prueba deja de poder conectarse y lo dice con claridad — no se
 * queda pasando en silencio contra el contenedor equivocado.
 */
const VERIFICACION_SUPERPASS = 'verificacion-temporal-no-usar';
const VERIFICACION_APP_PASSWORD = 'koinonia-app-verificacion-test';

const AGREGADOS = [id32('copia-a'), id32('copia-b'), id32('copia-c')] as const;

/** Corre un binario y, si falla, adjunta su salida completa al error — para que un fallo en CI diga qué pasó, no sólo que pasó. */
function ejecutar(
  cmd: string,
  args: readonly string[],
  envExtra: Record<string, string> = {},
): string {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      env: { ...process.env, ...envExtra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const fallo = error as { stdout?: string; stderr?: string };
    throw new Error(`${cmd} ${args.join(' ')} falló:\n${fallo.stdout ?? ''}${fallo.stderr ?? ''}`, {
      cause: error,
    });
  }
}

interface OrigenListo {
  readonly ok: true;
  readonly container: StartedTestContainer;
  readonly superPool: PgPool;
  readonly appPool: PgPool;
}
interface OrigenNoDisponible {
  readonly ok: false;
  readonly reason: string;
}
type Origen = OrigenListo | OrigenNoDisponible;

/** El contenedor de "producción" de esta prueba: el que se puebla, se respalda y después se destruye. */
async function iniciarOrigen(): Promise<Origen> {
  let container: StartedTestContainer;
  try {
    container = await new GenericContainer(IMAGEN)
      .withEnvironment({
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: ORIGEN_SUPERPASS,
        POSTGRES_DB: 'koinonia',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
      .withStartupTimeout(180_000)
      .start();
  } catch (error) {
    // Mismo criterio que `helpers/ledger-env.ts`: sin Docker esta suite se SALTA con el motivo a la
    // vista, salvo que `KOINONIA_REQUIRE_DOCKER=1` la vuelva obligatoria (CI).
    const reason =
      'Testcontainers no pudo levantar Docker: ' +
      (error instanceof Error
        ? (error.message.split('\n')[0] ?? error.message)
        : 'motivo desconocido');
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
  const superPool = createPool({
    connectionString: `postgresql://postgres:${ORIGEN_SUPERPASS}@${host}:${String(port)}/koinonia`,
    max: 10,
    applicationName: 'test-copia-origen-root',
  });
  await migrate(superPool);
  const cliente = await superPool.connect();
  try {
    await setAppRolePassword(cliente, ORIGEN_APP_PASSWORD);
  } finally {
    cliente.release();
  }
  const appPool = createPool({
    connectionString: `postgresql://koinonia_app:${ORIGEN_APP_PASSWORD}@${host}:${String(port)}/koinonia`,
    max: 10,
    applicationName: 'test-copia-origen-app',
  });
  await ensureSpine(appPool, {
    occurredAt: iso(-1_000),
    payload: { vigencia: 'test-copia', instituto: 'filosofia_udea' },
    requestId: requestId('copia-espina'),
  });

  return { ok: true, container, superPool, appPool };
}

function listo(origen: Origen): OrigenListo {
  if (!origen.ok) throw new Error(`el origen de esta prueba no está disponible: ${origen.reason}`);
  return origen;
}

const origen = await iniciarOrigen();

afterAll(async () => {
  if (!origen.ok) return;
  // Red de seguridad: si la prueba se cortó ANTES de llegar al paso "destruir" (falló poblando, por
  // ejemplo), el contenedor y sus pools quedarían vivos. `stop()`/`end()` sobre algo que ya se
  // cerró más abajo no es un error acá — se ignora.
  await origen.appPool.end().catch(() => undefined);
  await origen.superPool.end().catch(() => undefined);
  await origen.container.stop({ remove: true }).catch(() => undefined);
});

describe.skipIf(!origen.ok)(
  `ciclo completo: poblar → copiar → destruir → restaurar${origen.ok ? '' : `  ⟨SALTADO — ${origen.reason}⟩`}`,
  () => {
    interface VerificacionLista {
      readonly superPool: PgPool;
      readonly appPool: PgPool;
    }
    /**
     * `carpetaCopias`, `nombreVerificacion` y `verif` son los únicos datos que hacen falta en
     * `afterAll` para limpiar — y `afterAll` corre AUNQUE `beforeAll` haya fallado a mitad de
     * camino, así que van tipados como lo que de verdad son en ese caso: puede que no estén. Lo
     * que sólo se lee dentro de un `it()` (`salidaRestaurar`, `antes`, `despues`) no necesita el
     * mismo cuidado: si `beforeAll` falla, vitest ya marca esos `it()` como fallidos sin
     * ejecutarlos.
     */
    let carpetaCopias: string | undefined;
    let nombreVerificacion: string | undefined;
    let verif: VerificacionLista | undefined;
    let salidaRestaurar: string;
    let antes: readonly StoredEvent[];
    let despues: readonly StoredEvent[];

    function verificacionLista(): VerificacionLista {
      if (verif === undefined) throw new Error('el entorno de verificación no está listo');
      return verif;
    }

    beforeAll(async () => {
      const { container, superPool, appPool } = listo(origen);

      // 1. POBLAR — varios agregados con varios eventos cada uno, para que la comparación de más
      //    abajo distinga "restauró algo" de "restauró TODO, en el mismo orden".
      for (const [indice, aggregateId] of AGREGADOS.entries()) {
        await append(appPool, {
          aggregateId,
          aggregateType: 'propuesta',
          expectedHead: { kind: 'new' },
          requestId: requestId(`copia-poblar-${String(indice)}`),
          events: [
            {
              eventType: 'PropuestaAbierta',
              occurredAt: iso(indice * 10),
              payload: { titulo: `propuesta ${String(indice)}` },
            },
            {
              eventType: 'VotoEmitido',
              occurredAt: iso(indice * 10 + 1),
              payload: { voto: indice % 2 === 0 ? 'si' : 'no' },
            },
          ],
        });
      }
      antes = await readAll(appPool);

      // 2. COPIAR — el script real, sin modificar, apuntado al contenedor de origen por las mismas
      //    variables de entorno que usa `koinonia-copia.timer` en producción.
      carpetaCopias = mkdtempSync(join(tmpdir(), 'koinonia-copia-test-'));
      ejecutar('bash', [SCRIPT_COPIA], {
        KOINONIA_PG_CONTENEDOR: container.getId(),
        KOINONIA_PG_BASE: 'koinonia',
        KOINONIA_PG_USUARIO: 'postgres',
        KOINONIA_COPIA_DESTINO: carpetaCopias,
      });
      const nombreDump = readdirSync(carpetaCopias).find((f) => f.endsWith('.dump'));
      if (nombreDump === undefined) {
        throw new Error(`copia-de-seguridad.sh no dejó ningún .dump en ${carpetaCopias}`);
      }
      const rutaDump = join(carpetaCopias, nombreDump);

      // 3. DESTRUIR — el contenedor de origen ENTERO, no sólo la base: lo que sigue sólo puede
      //    salir del fichero .dump. Si dependiera de algo que quedó vivo en el origen, esto lo
      //    taparía en vez de probarlo.
      await appPool.end().catch(() => undefined);
      await superPool.end().catch(() => undefined);
      await container.stop({ remove: true });

      // 4. RESTAURAR — modo aislado (por defecto) con --conservar, para poder conectarnos después.
      //    `verificar_huella` no pide confirmación por terminal porque `copia-de-seguridad.sh` ya
      //    dejó el `.sha256` junto al `.dump`: corre sin TTY, como cualquier prueba automatizada.
      salidaRestaurar = ejecutar('bash', [SCRIPT_RESTAURAR, rutaDump, '--conservar']);

      const nombreEncontrado = /levantando contenedor descartable '([^']+)'/u.exec(
        salidaRestaurar,
      )?.[1];
      if (nombreEncontrado === undefined) {
        throw new Error(
          `no pude leer el nombre del contenedor de verificación en la salida de restaurar-copia.sh:\n${salidaRestaurar}`,
        );
      }
      nombreVerificacion = nombreEncontrado;

      // 5. RECONECTAR — por la IP de la red bridge por defecto (ver el docstring del fichero: el
      //    contenedor no publica puertos a propósito).
      const ip = ejecutar('docker', [
        'inspect',
        '-f',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        nombreVerificacion,
      ]).trim();

      const verifSuperPool = createPool({
        connectionString: `postgresql://postgres:${VERIFICACION_SUPERPASS}@${ip}:5432/koinonia`,
        max: 10,
        applicationName: 'test-copia-verificacion-root',
      });
      const clienteVerif = await verifSuperPool.connect();
      try {
        await setAppRolePassword(clienteVerif, VERIFICACION_APP_PASSWORD);
      } finally {
        clienteVerif.release();
      }
      const verifAppPool = createPool({
        connectionString: `postgresql://koinonia_app:${VERIFICACION_APP_PASSWORD}@${ip}:5432/koinonia`,
        max: 10,
        applicationName: 'test-copia-verificacion-app',
      });
      verif = { superPool: verifSuperPool, appPool: verifAppPool };

      // 6. COMPROBAR "de verdad" — con el pool de `koinonia_app`, el mismo con el que serviría la
      //    aplicación real, no con el superusuario.
      despues = await readAll(verifAppPool);
    }, 240_000);

    afterAll(async () => {
      await verif?.appPool.end().catch(() => undefined);
      await verif?.superPool.end().catch(() => undefined);
      if (nombreVerificacion !== undefined) {
        try {
          ejecutar('docker', ['rm', '-f', nombreVerificacion]);
        } catch {
          // Ya no estaba — nada que limpiar.
        }
      }
      if (carpetaCopias !== undefined) rmSync(carpetaCopias, { recursive: true, force: true });
    });

    it('el script lo dice: "verificación OK" y "privilegios OK" quedan en su propia salida', () => {
      expect(salidaRestaurar).toContain('verificación OK');
      expect(salidaRestaurar).toContain('privilegios OK');
      expect(salidaRestaurar).toContain('koinonia_app tiene exactamente SELECT, INSERT');
    });

    it('la restauración deja EXACTAMENTE la misma historia, evento por evento, hash por hash', () => {
      expect(despues.length).toBeGreaterThanOrEqual(AGREGADOS.length * 2 + 1); // +1: la espina
      expect(despues).toEqual(antes);
      for (const aggregateId of AGREGADOS) {
        expect(despues.filter((e) => e.event.aggregateId === aggregateId)).toHaveLength(2);
      }
    });

    it('koinonia_app queda con EXACTAMENTE SELECT e INSERT sobre governance.event — ni uno más', async () => {
      const { superPool } = verificacionLista();
      const grants = await auditAppGrants(superPool);
      const evento = grants.find((g) => g.table === 'event');
      expect(evento).toBeDefined();
      expect(new Set(evento?.privileges)).toStrictEqual(new Set(['SELECT', 'INSERT']));
    });

    it('y lo mismo visto desde la propia conexión de koinonia_app, contra el catálogo — no contra la migración', async () => {
      const { appPool } = verificacionLista();
      const cliente = await appPool.connect();
      try {
        const veredicto = await inspectLedgerPrivileges(cliente);
        expect(veredicto.identity.user).toBe('koinonia_app');
        expect(veredicto.identity.superuser).toBe(false);
        expect(new Set(veredicto.eventPrivileges)).toStrictEqual(new Set(['SELECT', 'INSERT']));
        expect(veredicto.canRewriteHistory).toBe(false);
        expect(veredicto.reason).toBeUndefined();
      } finally {
        cliente.release();
      }
    });

    it('tras restaurar la aplicación sigue pudiendo añadir al historial', async () => {
      const { appPool } = verificacionLista();
      const nuevo = id32('copia-tras-restaurar');
      await append(appPool, {
        aggregateId: nuevo,
        aggregateType: 'propuesta',
        expectedHead: { kind: 'new' },
        requestId: requestId('copia-tras-restaurar'),
        events: [
          {
            eventType: 'PropuestaAbierta',
            occurredAt: iso(9_999),
            payload: { titulo: 'tras restaurar' },
          },
        ],
      });
      expect(await readStream(appPool, nuevo)).toHaveLength(1);
    });

    it('y sigue sin poder reescribirlo: UPDATE falla por privilegios (42501), igual que antes de destruir nada', async () => {
      const { appPool } = verificacionLista();
      const objetivo = AGREGADOS[0];
      await expect(
        appPool.query("UPDATE governance.event SET payload = '{}' WHERE aggregate_id = $1", [
          objetivo,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  },
);
