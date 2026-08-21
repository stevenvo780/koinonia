/**
 * Blindaje append-only (§4), medido contra PostgreSQL real.
 *
 * ⚠️ Este fichero comprueba una defensa que **no detiene a un superusuario**, y lo comprueba
 * también: el último bloque ejerce a propósito el camino del administrador con `root` y verifica que
 * pasa. Escribirlo así no es derrotismo, es la única forma honesta de documentar el alcance de una
 * medida de seguridad. Lo que estas defensas cubren es lo otro, que es lo que de verdad ocurre a
 * diario: un `UPDATE` de la aplicación, una migración descuidada, una consola abierta a las 3 a.m.
 * La garantía real contra el administrador está en el anclaje externo (§7, §8) y en el doble vínculo
 * de la espina (`manipulacion.test.ts`).
 */

import {
  append,
  auditAppGrants,
  pgError,
  readStream,
  type PgErrorShape,
  type PgPool,
} from '@koinonia/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const AGREGADO = id32('append-only');

/**
 * Captura el error de PostgreSQL de una sentencia que DEBE fallar.
 *
 * Se comprueba el **código**, no el texto: el mensaje viene traducido según `lc_messages` del
 * servidor, así que una comprobación por cadena funciona en la máquina de quien la escribió y falla
 * en el VPS. El texto sólo se mira para distinguir cuál de los dos triggers saltó.
 */
async function capturarFallo(promesa: Promise<unknown>): Promise<PgErrorShape> {
  try {
    await promesa;
  } catch (error) {
    const info = pgError(error);
    if (info !== undefined) return info;
    throw error;
  }
  throw new Error('se esperaba un error de PostgreSQL y la sentencia pasó');
}

describe.skipIf(!env.ok)(`blindaje append-only${skipNote(env)}`, () => {
  let appPool: PgPool;
  let superPool: PgPool;

  beforeAll(async () => {
    appPool = ready(env).appPool;
    superPool = ready(env).superPool;
    await append(appPool, {
      aggregateId: AGREGADO,
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('append-only'),
      events: [
        { eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { titulo: 'reforma' } },
        { eventType: 'VotoEmitido', occurredAt: iso(1), payload: { voto: 'si' } },
      ],
    });
  });

  // ── Privilegios (§4.1) ──────────────────────────────────────────────────────────────────────

  it('el rol de la aplicación tiene EXACTAMENTE SELECT e INSERT sobre governance.event', async () => {
    const grants = await auditAppGrants(superPool);
    const evento = grants.find((g) => g.table === 'event');
    expect(evento).toBeDefined();
    expect(new Set(evento?.privileges)).toStrictEqual(new Set(['SELECT', 'INSERT']));

    // La caché de cabezas SÍ es mutable: es derivada y reconstruible desde `event`.
    const cabezas = grants.find((g) => g.table === 'aggregate_head');
    expect(new Set(cabezas?.privileges)).toStrictEqual(new Set(['SELECT', 'INSERT', 'UPDATE']));

    // Y `append_request` es la prueba de que un comando ya se ejecutó: tampoco se edita ni se borra.
    const peticiones = grants.find((g) => g.table === 'append_request');
    expect(new Set(peticiones?.privileges)).toStrictEqual(new Set(['SELECT', 'INSERT']));
  });

  it('UPDATE con el rol de la aplicación falla por privilegios (42501)', async () => {
    await expect(
      appPool.query("UPDATE governance.event SET payload = '{}' WHERE aggregate_id = $1", [
        AGREGADO,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('DELETE con el rol de la aplicación falla por privilegios (42501)', async () => {
    await expect(
      appPool.query('DELETE FROM governance.event WHERE aggregate_id = $1', [AGREGADO]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('TRUNCATE con el rol de la aplicación falla', async () => {
    await expect(appPool.query('TRUNCATE governance.event')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('los dos eventos siguen exactamente donde estaban', async () => {
    expect(await readStream(appPool, AGREGADO)).toHaveLength(2);
  });

  // ── Trigger (§4.2) ──────────────────────────────────────────────────────────────────────────
  //
  // Los privilegios protegen contra la aplicación. El trigger protege contra quien SÍ tiene
  // privilegios: el dueño de la tabla y el superusuario. Son dos capas distintas, y hay que probar
  // las dos por separado, porque un `GRANT` mal puesto dejaría al descubierto la primera.

  it('UPDATE con el SUPERUSUARIO lo rechaza el trigger, no los privilegios (23514)', async () => {
    const fallo = await capturarFallo(
      superPool.query("UPDATE governance.event SET payload = '{}' WHERE aggregate_id = $1", [
        AGREGADO,
      ]),
    );
    expect(fallo.code).toBe('23514');
    expect(fallo.message).toContain('append-only');
    expect(fallo.message).toContain('UPDATE');
  });

  it('DELETE con el SUPERUSUARIO lo rechaza el trigger (23514)', async () => {
    const fallo = await capturarFallo(
      superPool.query('DELETE FROM governance.event WHERE aggregate_id = $1', [AGREGADO]),
    );
    expect(fallo.code).toBe('23514');
    expect(fallo.message).toContain('append-only');
    expect(fallo.message).toContain('DELETE');
  });

  it('`session_replication_role = replica` NO desactiva el trigger: está ENABLE ALWAYS', async () => {
    // Es una variable de sesión que cualquier superusuario activa en una línea. Con `ENABLE REPLICA`
    // u `ORIGIN` —el modo por defecto— el trigger no dispararía y el borrado pasaría en silencio.
    const client = await superPool.connect();
    try {
      await client.query("SET session_replication_role = 'replica'");
      await expect(
        client.query('DELETE FROM governance.event WHERE aggregate_id = $1', [AGREGADO]),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query("SET session_replication_role = 'origin'").catch(() => undefined);
      client.release();
    }
    expect(await readStream(superPool, AGREGADO)).toHaveLength(2);
  });

  it('TRUNCATE con el SUPERUSUARIO lo rechaza el trigger de sentencia', async () => {
    // La `CREATE RULE … ON DELETE DO INSTEAD NOTHING` que la spec (§4.2) proponía para esto no
    // sirve —las reglas no interceptan TRUNCATE— y además desactivaba el trigger de DELETE. El test
    // de abajo lo demuestra.
    const fallo = await capturarFallo(superPool.query('TRUNCATE governance.event'));
    expect(fallo.code).toBe('23514');
    expect(fallo.message).toContain('TRUNCATE');
  });

  it('ERROR DE LA SPEC §4.2: la RULE ON DELETE DO INSTEAD NOTHING anula el trigger', async () => {
    // Documentación ejecutable. Se reproduce la tabla y las dos defensas que §4.2 pone juntas, y se
    // mide qué pasa con y sin la regla. Sobre una tabla de laboratorio: la de verdad no se toca.
    const client = await superPool.connect();
    try {
      await client.query(`
        DROP TABLE IF EXISTS contraste_regla;
        CREATE TABLE contraste_regla (id int PRIMARY KEY);
        INSERT INTO contraste_regla VALUES (1), (2);
        CREATE OR REPLACE FUNCTION fn_contraste_append_only() RETURNS trigger
          LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'append-only: % rechazado', TG_OP USING ERRCODE = '23514';
        END $fn$;
        CREATE TRIGGER trg BEFORE UPDATE OR DELETE ON contraste_regla
          FOR EACH ROW EXECUTE FUNCTION fn_contraste_append_only();
        ALTER TABLE contraste_regla ENABLE ALWAYS TRIGGER trg;
      `);

      // Sin la regla: fallo RUIDOSO, que es lo que se quiere.
      await expect(client.query('DELETE FROM contraste_regla WHERE id = 1')).rejects.toMatchObject({
        code: '23514',
      });

      // Con la regla que §4.2 añade a continuación: la consulta se reescribe ANTES de ejecutarse, el
      // DELETE nunca llega a la tabla, ninguna fila se evalúa y **el trigger no dispara**.
      await client.query('CREATE RULE rl AS ON DELETE TO contraste_regla DO INSTEAD NOTHING');
      const silencioso = await client.query('DELETE FROM contraste_regla WHERE id = 1');
      expect(silencioso.rowCount).toBe(0); // éxito mudo: ni excepción, ni rastro

      // Y tampoco cubre lo que su nombre promete.
      await client.query('DROP RULE rl ON contraste_regla');
      await client.query('DROP TRIGGER trg ON contraste_regla');
      await client.query('TRUNCATE contraste_regla');
      const { rows } = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM contraste_regla',
      );
      expect(rows[0]?.n).toBe('0');
    } finally {
      await client.query('DROP TABLE IF EXISTS contraste_regla').catch(() => undefined);
      client.release();
    }
  });

  // ── La nota honesta (§4.3) ──────────────────────────────────────────────────────────────────

  it('NADA DE ESTO DETIENE A UN SUPERUSUARIO, y aquí está la prueba', async () => {
    const client = await superPool.connect();
    try {
      await client.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
      const borrado = await client.query(
        'DELETE FROM governance.event WHERE aggregate_id = $1 AND seq = 1',
        [AGREGADO],
      );
      expect(borrado.rowCount).toBe(1); // pasó
      expect(await readStream(client, AGREGADO)).toHaveLength(1);

      // Se restaura el estado para no contaminar el resto del fichero. El borrado de verdad, y su
      // detección, se ejercen en `manipulacion.test.ts`.
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      await client
        .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
        .catch(() => undefined);
      client.release();
    }
  });

  it('y por eso desactivar el trigger deja rastro consultable en el catálogo', async () => {
    // La defensa que sí queda: `tgenabled` es público. `A` = ENABLE ALWAYS, `D` = deshabilitado.
    // Un panel de salud que vigile esta columna convierte «desactivé el trigger un momento» en un
    // hecho observable, que es todo lo que una medida de defensa en profundidad puede prometer.
    const { rows } = await superPool.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger
        WHERE tgrelid = 'governance.event'::regclass AND NOT tgisinternal
        ORDER BY tgname`,
    );
    expect(rows.map((r) => r.tgname)).toStrictEqual([
      'trg_event_append_only',
      'trg_event_no_truncate',
    ]);
    for (const row of rows) expect(row.tgenabled).toBe('A');
  });

  it('la aplicación NO es dueña de las tablas: si lo fuera podría desactivar el trigger', async () => {
    const { rows } = await superPool.query<{ relname: string; owner: string }>(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'governance' AND c.relkind = 'r' ORDER BY c.relname`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.owner, `${row.relname} es de ${row.owner}`).toBe('koinonia_ddl');
      expect(row.owner).not.toBe('koinonia_app');
    }
  });
});
