/**
 * Con qué privilegios habla la API con la base, medido contra PostgreSQL real.
 *
 * ═══ El hueco que este fichero existe para que no vuelva ═══
 *
 * La migración 0003 parte los privilegios en dos: `koinonia_ddl` es dueño del esquema y
 * `koinonia_app` tiene sobre `governance.event` **sólo `SELECT, INSERT`**. Esa asimetría es una de
 * las capas que sostienen la tesis del proyecto —que el administrador no puede alterar la historia
 * sin que se detecte—, y en el despliegue **no estaba en vigor**: `server.ts` corría `migrate()` con
 * el mismo pool que después servía las peticiones, y como la 0003 necesita crear roles, ese pool era
 * `postgres`. La separación existía en el esquema y no protegía nada en ejecución.
 *
 * ═══ Por qué medir esto es más difícil de lo que parece ═══
 *
 * `UPDATE governance.event …` falla siempre, con el arreglo y sin él, porque el trigger append-only
 * de la 0002 rechaza `UPDATE` y `DELETE` para **cualquiera**. Una prueba que se limitara a
 * comprobar que la sentencia falla pasaría idéntica sobre el código roto: no mediría nada.
 *
 * Así que hay que separar las dos capas, y este fichero lo hace por tres vías independientes:
 *
 *  1. **El código de error.** PostgreSQL comprueba los permisos al arrancar el ejecutor, antes de
 *     evaluar ninguna fila y por tanto antes de disparar ningún trigger `BEFORE ROW`. La misma
 *     sentencia, sobre la misma fila, en el mismo instante, da `42501 insufficient_privilege` con el
 *     rol de la aplicación y `23514 check_violation` con el superusuario. Si al rol de la aplicación
 *     lo parara el trigger, vería `23514` como lo ve el superusuario.
 *  2. **De dónde sale el error.** El campo `routine` del protocolo dice qué rutina de PostgreSQL lo
 *     lanzó: `aclcheck_error` (comprobación de ACL en C) frente a `exec_stmt_raise` (el `RAISE` del
 *     PL/pgSQL del trigger). Son dos sitios distintos del motor.
 *  3. **Quitando el trigger de en medio.** Se desactiva `trg_event_append_only`, se comprueba en
 *     `pg_trigger` que está realmente desactivado, y en esa ventana el superusuario **sí** consigue
 *     modificar la fila —control: sin trigger no hay barrera para él— mientras el rol de la
 *     aplicación sigue recibiendo `42501`. Es la prueba de que la capa de privilegios se sostiene
 *     sola. Es también, exactamente, lo que ocurriría en producción con el código anterior.
 */

import {
  append,
  inspectLedgerPrivileges,
  pgError,
  readStream,
  type LedgerPrivilegeVerdict,
  type PgPool,
} from '@koinonia/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  APP_NAME_API,
  APP_NAME_MIGRACION,
  conexionesDeEntorno,
  prepararBaseDeDatos,
} from '../../services/api/src/server.js';
import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const AGREGADO = id32('privilegios-conexion');
const TRIGGER = 'trg_event_append_only';

interface FalloDePostgres {
  readonly code: string | undefined;
  readonly message: string;
  /** Rutina del motor que lanzó el error. Distingue la comprobación de ACL del `RAISE` del trigger. */
  readonly routine: string | undefined;
}

/** Captura el error de una sentencia que DEBE fallar, y falla ruidosamente si pasa. */
async function capturarFallo(promesa: Promise<unknown>): Promise<FalloDePostgres> {
  try {
    await promesa;
  } catch (error) {
    const info = pgError(error);
    if (info === undefined) throw error;
    const routine = (error as Record<string, unknown>)['routine'];
    return {
      code: info.code,
      message: info.message,
      routine: typeof routine === 'string' ? routine : undefined,
    };
  }
  throw new Error('se esperaba que PostgreSQL rechazara la sentencia, y la dejó pasar');
}

/** Foto exacta del agregado: si algo se coló, esto cambia. */
async function foto(pool: PgPool): Promise<readonly { hash: string; payload: string }[]> {
  const { rows } = await pool.query<{ hash: string; payload: string }>(
    `SELECT encode(event_hash, 'hex') AS hash, payload
       FROM governance.event WHERE aggregate_id = $1 ORDER BY seq`,
    [AGREGADO],
  );
  return rows;
}

async function estadoDelTrigger(pool: PgPool): Promise<string | undefined> {
  const { rows } = await pool.query<{ tgenabled: string }>(
    `SELECT tgenabled FROM pg_trigger
      WHERE tgrelid = 'governance.event'::regclass AND tgname = $1`,
    [TRIGGER],
  );
  return rows[0]?.tgenabled;
}

/** Espera a que no quede ningún backend con ese `application_name`. */
async function esperarSinConexiones(pool: PgPool, nombre: string): Promise<number> {
  let quedan = -1;
  for (let intento = 0; intento < 50; intento++) {
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1',
      [nombre],
    );
    quedan = rows[0]?.n ?? -1;
    if (quedan === 0) return 0;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return quedan;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La elección de conexiones. No necesita base: es una función pura del entorno.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('qué credenciales elige el arranque', () => {
  const CON_APP = {
    DATABASE_URL: 'postgresql://postgres:secreto-ddl@db:5432/koinonia',
    KOINONIA_DATABASE_URL_APP: 'postgresql://koinonia_app:secreto-app@db:5432/koinonia',
  } as const;

  it('en PRODUCCIÓN sin KOINONIA_DATABASE_URL_APP el arranque se cae, y dice qué falta', () => {
    // La decisión y su motivo están en el docstring de `conexionesDeEntorno`: el hueco que esto
    // cierra fue precisamente un despliegue que nadie miró, así que una defensa que dependa de que
    // alguien lea una línea de `stderr` ya falló una vez por ese camino.
    expect(() =>
      conexionesDeEntorno({ DATABASE_URL: CON_APP.DATABASE_URL }, { modoDesarrollo: false }),
    ).toThrow(/KOINONIA_DATABASE_URL_APP/u);
  });

  it('fuera de producción sigue con la de DDL, y lo grita por stderr', () => {
    const elegido = conexionesDeEntorno(
      { DATABASE_URL: CON_APP.DATABASE_URL },
      { modoDesarrollo: true },
    );
    expect(elegido.separadas).toBe(false);
    expect(elegido.appUrl).toBe(elegido.migracionUrl);
    // `grave` es lo que manda la línea a `stderr` en vez de a `stdout`.
    expect(elegido.grave).toBe(true);
    expect(elegido.anuncio).toContain('SIN SEPARAR');
    expect(elegido.anuncio).toContain('KOINONIA_DATABASE_URL_APP');
  });

  it('con las dos, las separa y lo dice sin dramatismo', () => {
    const elegido = conexionesDeEntorno(CON_APP, { modoDesarrollo: false });
    expect(elegido.separadas).toBe(true);
    expect(elegido.grave).toBe(false);
    expect(elegido.migracionUrl).toBe(CON_APP.DATABASE_URL);
    expect(elegido.appUrl).toBe(CON_APP.KOINONIA_DATABASE_URL_APP);
    expect(elegido.anuncio).toContain('SEPARADA');
    expect(elegido.anuncio).toContain('koinonia_app@db:5432/koinonia');
  });

  it('el anuncio NUNCA lleva las contraseñas: el registro lo lee más gente de la que uno cree', () => {
    const elegido = conexionesDeEntorno(CON_APP, { modoDesarrollo: false });
    expect(elegido.anuncio).not.toContain('secreto-app');
    expect(elegido.anuncio).not.toContain('secreto-ddl');

    // Y si la cadena no se puede analizar tampoco se imprime a pelo, que es como se filtraría.
    const raro = conexionesDeEntorno(
      { ...CON_APP, KOINONIA_DATABASE_URL_APP: 'esto no es una URL con secreto-app dentro' },
      { modoDesarrollo: false },
    );
    expect(raro.anuncio).not.toContain('secreto-app');
  });

  it('KOINONIA_DATABASE_URL_MIGRACION manda sobre DATABASE_URL', () => {
    const elegido = conexionesDeEntorno(
      { ...CON_APP, KOINONIA_DATABASE_URL_MIGRACION: 'postgresql://ddl:x@otro:5432/koinonia' },
      { modoDesarrollo: false },
    );
    expect(elegido.migracionUrl).toBe('postgresql://ddl:x@otro:5432/koinonia');
  });

  it('una contraseña que no coincide con la de la URL se caza al arrancar, no al conectar', () => {
    // Si no, el arranque le fija una contraseña al rol y entra con otra, y el diagnóstico que llega
    // es «autenticación fallida», que apunta a cualquier sitio menos al de verdad.
    expect(() =>
      conexionesDeEntorno(
        { ...CON_APP, KOINONIA_DB_APP_PASSWORD: 'otra-distinta' },
        { modoDesarrollo: false },
      ),
    ).toThrow(/KOINONIA_DB_APP_PASSWORD/u);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El corazón: el rechazo es POR PRIVILEGIOS y no por el trigger.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe.skipIf(!env.ok)(`privilegios de la conexión de la API${skipNote(env)}`, () => {
  let appPool: PgPool;
  let superPool: PgPool;

  beforeAll(async () => {
    appPool = ready(env).appPool;
    superPool = ready(env).superPool;
    await append(appPool, {
      aggregateId: AGREGADO,
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('privilegios-conexion'),
      events: [
        { eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { titulo: 'horario' } },
        { eventType: 'VotoEmitido', occurredAt: iso(1), payload: { voto: 'si' } },
      ],
    });
  });

  // ── Vía 1 y 2: dos roles, misma sentencia, dos capas distintas ────────────────────────────────

  it('la MISMA sentencia da 42501 con la aplicación y 23514 con el superusuario', async () => {
    const sentencia = "UPDATE governance.event SET payload = '{}' WHERE aggregate_id = $1";

    const conApp = await capturarFallo(appPool.query(sentencia, [AGREGADO]));
    const conSuper = await capturarFallo(superPool.query(sentencia, [AGREGADO]));

    // 42501 `insufficient_privilege`: los permisos se comprueban al arrancar el ejecutor, antes de
    // evaluar ninguna fila, así que el trigger `BEFORE ROW` ni siquiera llegó a dispararse.
    expect(conApp.code).toBe('42501');
    // 23514 `check_violation`: el ERRCODE que el `RAISE` de `fn_append_only()` fija a mano.
    expect(conSuper.code).toBe('23514');

    // Y aquí está la comparación que hace de esto una prueba: si al rol de la aplicación lo parara
    // el trigger, habría visto 23514, que es lo que ve el superusuario con la misma sentencia.
    expect(conApp.code).not.toBe(conSuper.code);

    // El mensaje del trigger es un literal nuestro y no se traduce por `lc_messages`; el de
    // permisos sí. Por eso sólo se comprueba que el de la aplicación NO es el del trigger.
    expect(conSuper.message).toContain('append-only');
    expect(conApp.message).not.toContain('append-only');
  });

  it('y salen de dos rutinas distintas del motor: ACL frente al RAISE del PL/pgSQL', async () => {
    const sentencia = 'DELETE FROM governance.event WHERE aggregate_id = $1';

    const conApp = await capturarFallo(appPool.query(sentencia, [AGREGADO]));
    const conSuper = await capturarFallo(superPool.query(sentencia, [AGREGADO]));

    // `exec_stmt_raise` es el ejecutor del `RAISE EXCEPTION` de PL/pgSQL: es la firma del trigger.
    // Que el error de la aplicación NO venga de ahí es la afirmación estable, y la que importa.
    expect(conSuper.routine).toBe('exec_stmt_raise');
    expect(conApp.routine).not.toBe('exec_stmt_raise');
    // La imagen está fijada a `postgres:16-alpine`, así que el nombre concreto también es medible.
    expect(conApp.routine).toBe('aclcheck_error');
  });

  // ── Vía 3: quitando el trigger de en medio ────────────────────────────────────────────────────

  it('SIN EL TRIGGER: el superusuario sí modifica la fila, y la aplicación sigue sin poder', async () => {
    const antes = await foto(superPool);
    expect(antes).toHaveLength(2);

    const cliente = await superPool.connect();
    try {
      // La ventana tiene que estar CONFIRMADA: un `ALTER TABLE` dentro de una transacción abierta
      // toma un ACCESS EXCLUSIVE y dejaría al pool de la aplicación esperando el candado en vez de
      // recibiendo su error. Se restaura en el `finally`.
      await cliente.query(`ALTER TABLE governance.event DISABLE TRIGGER ${TRIGGER}`);

      // Que la ventana es real y no un `ALTER` que no hizo nada: `D` = deshabilitado. Sin esta
      // comprobación, todo lo que sigue podría estar midiendo el trigger otra vez.
      expect(await estadoDelTrigger(superPool)).toBe('D');

      // (a) El rol de la aplicación, con el trigger fuera de juego. Si el arreglo no existiera y la
      //     API siguiera conectada como `postgres`, esto sería el `UPDATE` que pasa.
      const update = await capturarFallo(
        appPool.query("UPDATE governance.event SET payload = '{}' WHERE aggregate_id = $1", [
          AGREGADO,
        ]),
      );
      expect(update.code).toBe('42501');
      expect(update.message).not.toContain('append-only');

      const del = await capturarFallo(
        appPool.query('DELETE FROM governance.event WHERE aggregate_id = $1', [AGREGADO]),
      );
      expect(del.code).toBe('42501');

      // (b) CONTROL. El mismo `UPDATE`, la misma fila, la misma ventana, otro rol: pasa. Sin este
      //     control, un `42501` en (a) podría venir de que la fila fuera intocable por cualquier
      //     motivo. No lo es: lo único que separa a (a) de (b) son los privilegios.
      await cliente.query('BEGIN');
      const control = await cliente.query(
        "UPDATE governance.event SET payload = '{}' WHERE aggregate_id = $1",
        [AGREGADO],
      );
      expect(control.rowCount).toBe(2);
      await cliente.query('ROLLBACK');
    } finally {
      await cliente
        .query(`ALTER TABLE governance.event ENABLE ALWAYS TRIGGER ${TRIGGER}`)
        .catch(() => undefined);
      cliente.release();
    }

    // El trigger vuelve a `A` (ENABLE ALWAYS) y no se movió ni un byte del agregado.
    expect(await estadoDelTrigger(superPool)).toBe('A');
    expect(await foto(superPool)).toStrictEqual(antes);
  });

  it('la aplicación tampoco puede apagar el trigger: no es dueña de la tabla', async () => {
    // Si pudiera, las dos capas serían una sola y la de arriba no probaría nada.
    const fallo = await capturarFallo(
      appPool.query(`ALTER TABLE governance.event DISABLE TRIGGER ${TRIGGER}`),
    );
    expect(fallo.code).toBe('42501');
    expect(await estadoDelTrigger(superPool)).toBe('A');
  });

  it('TRUNCATE con el rol de la aplicación lo para el privilegio, no el trigger de sentencia', async () => {
    const fallo = await capturarFallo(appPool.query('TRUNCATE governance.event'));
    expect(fallo.code).toBe('42501');
    expect(fallo.routine).not.toBe('exec_stmt_raise');
  });

  // ── Y la otra mitad: con el arreglo, escribir sigue funcionando ───────────────────────────────

  it('el INSERT normal del ledger sigue pasando con el rol de la aplicación', async () => {
    // Un arreglo de privilegios que además rompiera la escritura sería un fallo peor que el hueco.
    const otro = id32('privilegios-insert');
    await append(appPool, {
      aggregateId: otro,
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('privilegios-insert'),
      events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(2), payload: { titulo: 'sala' } }],
    });
    expect(await readStream(appPool, otro)).toHaveLength(1);
    // Y leer, que es el otro privilegio que sí tiene.
    expect(await readStream(appPool, AGREGADO)).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El arranque de verdad: `prepararBaseDeDatos` es el código que corre en el VPS.
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe.skipIf(!env.ok)(`arranque con las dos conexiones${skipNote(env)}`, () => {
  it('migra con la de DDL, la cierra, y devuelve una que NO es superusuario', async () => {
    const listo = ready(env);
    const lineas: { linea: string; grave: boolean }[] = [];

    const conexiones = conexionesDeEntorno(
      {
        DATABASE_URL: listo.superUrl,
        KOINONIA_DATABASE_URL_APP: listo.appUrl,
        KOINONIA_DB_APP_PASSWORD: 'koinonia-app-test',
      },
      // En producción: si la variable faltara, esta llamada ya habría lanzado.
      { modoDesarrollo: false },
    );
    expect(conexiones.separadas).toBe(true);

    const pool = await prepararBaseDeDatos(conexiones, (linea, grave) => {
      lineas.push({ linea, grave });
    });
    try {
      // 1. El pool de migración no sigue abierto. Un pool con permiso de `ALTER TABLE` vivo
      //    mientras el servicio atiende es una conexión esperando a que un bug la use.
      expect(await esperarSinConexiones(listo.superPool, APP_NAME_MIGRACION)).toBe(0);

      // 2. Quien sirve las peticiones es `koinonia_app`, y no es superusuario. Preguntado a la
      //    base por el pool que devuelve el arranque, no deducido de la cadena de conexión.
      const { rows } = await pool.query<{ usuario: string; sup: boolean }>(
        'SELECT current_user::text AS usuario, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS sup',
      );
      expect(rows[0]?.usuario).toBe('koinonia_app');
      expect(rows[0]?.sup).toBe(false);

      // 3. Y ese pool, el mismo que recibiría `buildApp`, no puede reescribir la historia.
      const fallo = await capturarFallo(
        pool.query("UPDATE governance.event SET payload = '{}' WHERE aggregate_id = $1", [
          AGREGADO,
        ]),
      );
      expect(fallo.code).toBe('42501');

      // 4. Pero sí puede añadir, que es para lo que existe.
      const nuevo = id32('privilegios-arranque');
      await append(pool, {
        aggregateId: nuevo,
        aggregateType: 'propuesta',
        expectedHead: { kind: 'new' },
        requestId: requestId('privilegios-arranque'),
        events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(3), payload: { t: 'x' } }],
      });
      expect(await readStream(pool, nuevo)).toHaveLength(1);

      // 5. El arranque lo DICE, como ya hace con el correo: nada de esto es silencioso.
      const dicho = lineas.map((l) => l.linea).join('\n');
      expect(dicho).toContain('koinonia_app');
      expect(dicho).toContain('SELECT, INSERT');
      expect(lineas.every((l) => !l.grave)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('si la URL de aplicación apunta al superusuario, el arranque se niega', async () => {
    // Ésta es, exactamente, la configuración que tenía el despliegue: la API conectada como
    // `postgres`. Con la variable puesta y apuntando ahí, el registro diría «SEPARADA» y sería
    // mentira, que es peor que no haberla puesto. Así que no arranca.
    const listo = ready(env);
    const conexiones = conexionesDeEntorno(
      { DATABASE_URL: listo.superUrl, KOINONIA_DATABASE_URL_APP: listo.superUrl },
      { modoDesarrollo: false },
    );

    await expect(prepararBaseDeDatos(conexiones, () => undefined)).rejects.toThrow(/SUPERUSUARIO/u);

    // Y no deja el pool colgando al negarse.
    expect(await esperarSinConexiones(listo.superPool, APP_NAME_API)).toBe(0);
  });

  it('el veredicto de privilegios se le pregunta al catálogo, no a la migración', async () => {
    const listo = ready(env);

    const comoApp = await listo.appPool.connect();
    let veredictoApp: LedgerPrivilegeVerdict;
    try {
      veredictoApp = await inspectLedgerPrivileges(comoApp);
    } finally {
      comoApp.release();
    }
    expect(veredictoApp.identity.user).toBe('koinonia_app');
    expect(veredictoApp.identity.superuser).toBe(false);
    expect(new Set(veredictoApp.eventPrivileges)).toStrictEqual(new Set(['SELECT', 'INSERT']));
    expect(veredictoApp.canRewriteHistory).toBe(false);
    expect(veredictoApp.reason).toBeUndefined();

    const comoRoot = await listo.superPool.connect();
    let veredictoRoot: LedgerPrivilegeVerdict;
    try {
      veredictoRoot = await inspectLedgerPrivileges(comoRoot);
    } finally {
      comoRoot.release();
    }
    // Para un superusuario `has_table_privilege` dice que sí a todo sin que exista ni un GRANT: el
    // privilegio no está en el catálogo de permisos, está en el rol. Por eso mirar sólo los GRANT
    // de `koinonia_app` no habría detectado nunca el hueco.
    expect(veredictoRoot.identity.superuser).toBe(true);
    expect(veredictoRoot.canRewriteHistory).toBe(true);
    expect(veredictoRoot.reason).toContain('SUPERUSUARIO');
  });
});
