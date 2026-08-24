/**
 * `jobs/cola.ts` contra PostgreSQL real: lo que ningún doble en memoria puede probar.
 *
 * En concreto, tres cosas que son comportamiento de PostgreSQL y no de la lógica de la aplicación:
 *
 *  1. `SELECT … FOR UPDATE SKIP LOCKED` reparte de verdad entre dos reclamos concurrentes — ningún
 *     trabajo se lo lleva más de un "trabajador" a la vez.
 *  2. Los privilegios de `koinonia_app` (§4.1) alcanzan para operar la cola entera y no un átomo
 *     más: puede `SELECT/INSERT/UPDATE/DELETE` sobre `jobs.job`, y NO puede alterar la tabla ni
 *     tocar el esquema — eso sigue siendo de `koinonia_ddl`.
 *  3. La clave de idempotencia es de verdad `UNIQUE` en la base, no sólo "se comporta como si".
 */

import { afterAll, describe, expect, it } from 'vitest';

import { colaDeTrabajosEnPostgres } from '../../services/api/src/jobs/cola.js';
import {
  asegurarEsquemaDeTrabajos,
  otorgarPrivilegiosDeTrabajos,
} from '../../services/api/src/jobs/esquema.js';
import { ledgerEnv, ready, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

const T0 = '2026-08-23T10:00:00.000Z';
function masTarde(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString();
}

describe.skipIf(!env.ok)(`cola.ts contra PostgreSQL real${skipNote(env)}`, () => {
  const { superPool, appPool } = ready(env);

  it('asegurarEsquemaDeTrabajos crea jobs.job y es idempotente al repetirse', async () => {
    await asegurarEsquemaDeTrabajos(superPool);
    await asegurarEsquemaDeTrabajos(superPool); // segunda vez: no debe fallar
    await otorgarPrivilegiosDeTrabajos(superPool, 'koinonia_app');

    const { rows } = await superPool.query<{ regclass: string }>(
      `SELECT to_regclass('jobs.job')::text AS regclass`,
    );
    expect(rows[0]?.regclass).toBe('jobs.job');
  });

  it('koinonia_app puede operar la cola entera con esos privilegios (least privilege que alcanza)', async () => {
    const cola = colaDeTrabajosEnPostgres(appPool);
    const { id } = await cola.encolar({ tipo: 'privilegios-app', ejecutarEn: T0 });
    const [reclamado] = await cola.reclamar({
      trabajador: 'w',
      ahora: T0,
      tipos: ['privilegios-app'],
    });
    expect(reclamado?.id).toBe(id);
    await cola.completar(id, T0);
    const conteo = await cola.contarPorEstado();
    expect(conteo.hecho).toBeGreaterThanOrEqual(1);
  });

  it('koinonia_app NO puede alterar jobs.job ni el esquema — sigue siendo de koinonia_ddl', async () => {
    await expect(
      appPool.query('ALTER TABLE jobs.job ADD COLUMN intruso int'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(appPool.query('DROP TABLE jobs.job')).rejects.toMatchObject({ code: '42501' });
    await expect(appPool.query('CREATE TABLE jobs.otra (id int)')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('la clave de idempotencia es UNIQUE de verdad: dos encolar() devuelven el mismo id', async () => {
    const cola = colaDeTrabajosEnPostgres(appPool);
    const primero = await cola.encolar({
      tipo: 'idempotente',
      ejecutarEn: T0,
      claveDeIdempotencia: 'clave-de-prueba-unica-1',
    });
    const segundo = await cola.encolar({
      tipo: 'idempotente',
      ejecutarEn: masTarde(60_000), // aunque cambie todo lo demás…
      claveDeIdempotencia: 'clave-de-prueba-unica-1', // …la clave decide
    });
    expect(segundo.id).toBe(primero.id);
    expect(primero.yaExistia).toBe(false);
    expect(segundo.yaExistia).toBe(true);

    const { rows } = await appPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM jobs.job WHERE idempotency_key = 'clave-de-prueba-unica-1'`,
    );
    expect(rows[0]?.total).toBe('1');
  });

  it('SKIP LOCKED reparte entre dos reclamos concurrentes sin duplicar ningún trabajo', async () => {
    const cola = colaDeTrabajosEnPostgres(appPool);
    const tipo = `skip-locked-${String(Date.now())}`;
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const { id } = await cola.encolar({ tipo, ejecutarEn: T0 });
      ids.push(id);
    }

    // Dos "trabajadores" reclamando el mismo lote al mismo tiempo: sin SKIP LOCKED, uno esperaría
    // al otro (o peor, ambos verían la misma fila). Con SKIP LOCKED, cada uno se lleva las suyas.
    const [primerLote, segundoLote] = await Promise.all([
      cola.reclamar({ trabajador: 'w1', ahora: T0, tipos: [tipo], maximo: 15 }),
      cola.reclamar({ trabajador: 'w2', ahora: T0, tipos: [tipo], maximo: 15 }),
    ]);

    const idsPrimero = new Set(primerLote.map((t) => t.id));
    const idsSegundo = new Set(segundoLote.map((t) => t.id));
    const interseccion = [...idsPrimero].filter((id) => idsSegundo.has(id));

    expect(interseccion).toEqual([]); // ninguno se repite entre los dos lotes
    expect(primerLote.length + segundoLote.length).toBe(20); // los 20 se repartieron, ninguno se perdió

    const { rows } = await appPool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM jobs.job WHERE kind = $1 AND status = 'en_curso'`,
      [tipo],
    );
    expect(rows[0]?.total).toBe('20');
  });

  it('fallar(): con intentos restantes vuelve a pendiente y no se reclama antes de tiempo', async () => {
    const cola = colaDeTrabajosEnPostgres(appPool);
    const { id } = await cola.encolar({
      tipo: 'reintento-real',
      ejecutarEn: T0,
      intentosMaximos: 2,
    });
    const [reclamado] = await cola.reclamar({
      trabajador: 'w',
      ahora: T0,
      tipos: ['reintento-real'],
    });
    expect(reclamado?.id).toBe(id);

    await cola.fallar(id, { error: 'fallo de prueba', ahora: T0, reintentarEn: masTarde(60_000) });

    // Todavía no toca: `run_at` quedó 60 s en el futuro.
    const nada = await cola.reclamar({ trabajador: 'w', ahora: T0, tipos: ['reintento-real'] });
    expect(nada.map((t) => t.id)).not.toContain(id);

    // Pasado ese instante, sí.
    const ahoraSi = await cola.reclamar({
      trabajador: 'w',
      ahora: masTarde(60_001),
      tipos: ['reintento-real'],
    });
    expect(ahoraSi.map((t) => t.id)).toContain(id);
    expect(ahoraSi.find((t) => t.id === id)?.intentos).toBe(1);

    // Segundo fallo: ya no quedan intentos (max 2, éste es el 2º) — fallido en firme, sin reintentarEn.
    await cola.fallar(id, { error: 'fallo definitivo', ahora: masTarde(60_001) });
    const { rows } = await appPool.query<{ status: string }>(
      `SELECT status FROM jobs.job WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.status).toBe('fallido');
  });

  it('liberarExpirados devuelve un trabajo en_curso abandonado a pendiente, reclamable de nuevo', async () => {
    const cola = colaDeTrabajosEnPostgres(appPool);
    const { id } = await cola.encolar({ tipo: 'abandono-real', ejecutarEn: T0 });
    await cola.reclamar({ trabajador: 'w-que-murio', ahora: T0, tipos: ['abandono-real'] });

    const nadaTodavia = await cola.liberarExpirados(masTarde(-1), masTarde(60_000)); // límite ANTES de locked_at
    expect(nadaTodavia).not.toContain(id);

    const liberados = await cola.liberarExpirados(masTarde(60_000), masTarde(60_001)); // límite después
    expect(liberados).toContain(id);

    const otraVez = await cola.reclamar({
      trabajador: 'w-nuevo',
      ahora: masTarde(60_001),
      tipos: ['abandono-real'],
    });
    expect(otraVez.map((t) => t.id)).toContain(id);
  });

  it('purgarTerminados borra hecho/fallido viejos y deja lo reciente intacto', async () => {
    const cola = colaDeTrabajosEnPostgres(appPool);
    const { id: viejo } = await cola.encolar({ tipo: 'purga-real', ejecutarEn: T0 });
    await cola.reclamar({ trabajador: 'w', ahora: T0, tipos: ['purga-real'] });
    await cola.completar(viejo, T0);

    const { id: reciente } = await cola.encolar({
      tipo: 'purga-real',
      ejecutarEn: masTarde(90 * 60_000),
    });
    await cola.reclamar({ trabajador: 'w', ahora: masTarde(90 * 60_000), tipos: ['purga-real'] });
    await cola.completar(reciente, masTarde(90 * 60_000));

    const borrados = await cola.purgarTerminados(masTarde(60 * 60_000)); // corta a 1h desde T0
    expect(borrados).toBeGreaterThanOrEqual(1);

    const { rows } = await appPool.query<{ id: string }>(
      `SELECT id::text FROM jobs.job WHERE id = ANY($1::bigint[])`,
      [[viejo, reciente]],
    );
    const idsQueQuedan = rows.map((r) => r.id);
    expect(idsQueQuedan).not.toContain(viejo);
    expect(idsQueQuedan).toContain(reciente);
  });
});
