import { afterAll, describe, expect, it } from 'vitest';

import { crearTareaDeRetencion } from '@koinonia/api';

import { apiEnv, entrar, listo, skipNote, type ApiListo } from './helpers/api-env.js';

/**
 * La retención BORRA de verdad, y no toca el historial.
 *
 * ═══ Qué se rompió ═══
 *
 * `purgeExpiredLinks`, `purgeOldBuckets` y `purgeOldConsumptions` estaban escritas, probadas y
 * desplegadas desde hacía semanas, y **nadie las llamaba**. Ni al arrancar, ni por temporizador, ni
 * desde ninguna ruta: buscadas con `git grep`, sólo aparecían en su propia declaración y en el
 * reexport del barril — `purgeOldConsumptions` ni eso.
 *
 * O sea que la retención del ADR-0055 existía como código y no como conducta. Cada una tenía su
 * prueba unitaria comprobando que el `DELETE` borra lo que debe, y todas pasaban; lo que no probaba
 * nadie es que ese `DELETE` llegara a ejecutarse alguna vez. Es el mismo hueco que ya mordió con el
 * paquete verificable que ninguna ruta servía: la pieza correcta, desconectada.
 *
 * Hoy son catorce filas porque no hay gente. Con personas de verdad, esas dos tablas crecen sin tope
 * y guardan el rastro de quién pidió qué y cuándo mucho más allá de la ventana declarada — «una
 * fuente de identidad débil», dice el propio comentario de `rate-limit.ts`.
 *
 * ═══ El segundo caso es el que más importa ═══
 *
 * Una tarea que borra, en un sistema cuyo valor entero es que nada se borra, es exactamente la clase
 * de cosa que hay que sujetar con una prueba y no con un comentario. El historial es de sólo-anexar;
 * si esta tarea lo tocara, el verificador independiente encontraría el hueco y toda la promesa se
 * cae. Por eso se cuenta el historial antes y después y se exige que no se mueva ni una fila.
 */

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`la retención barre lo vencido${skipNote(env)}`, () => {
  let e: ApiListo;

  it('borra enlaces vencidos, ventanas de cupo y consumos viejos, y deja lo vigente', async () => {
    e = listo(env);
    // Un miembro de verdad: `identity.magic_link` tiene clave ajena contra `identity.member`, y un
    // identificador inventado la viola. Entrar por la puerta normal es lo más corto y lo más fiel.
    const quien = await entrar(e, 'retencion.prueba@udea.edu.co');
    const ahora = e.reloj.now();
    const client = await e.pool.connect();

    try {
      /*
       * Se escriben pares: uno vencido y uno vigente en cada tabla. Sin el vigente, un `DELETE`
       * sin `WHERE` —o con la comparación al revés— pasaría esta prueba con las tres tablas vacías,
       * que es justo el fallo que más caro sale.
       */
      const hace = (dias: number): string => new Date(ahora - dias * 86_400_000).toISOString();
      const dentroDe = (min: number): string => new Date(ahora + min * 60_000).toISOString();

      await client.query(
        `INSERT INTO identity.magic_link (token_hash, member_id, issued_at, expires_at)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [
          'a'.repeat(64),
          quien.miembroId,
          hace(2),
          hace(1), // vencido
          'b'.repeat(64),
          quien.miembroId,
          hace(0),
          dentroDe(30), // vigente
        ],
      );
      await client.query(
        `INSERT INTO identity.rate_bucket (bucket_key, window_start, hits)
         VALUES ($1, $2, 1), ($3, $4, 1)`,
        ['1'.repeat(64), hace(40), '2'.repeat(64), new Date(ahora).toISOString()],
      );
      await client.query(
        `INSERT INTO identity.rate_consumption (request_id, ambito, sujeto, window_start, consumed_at)
         VALUES ($1, 'escritura', $2, $3, $3), ($4, 'escritura', $5, $6, $6)`,
        [
          '00000000-0000-4000-8000-00000000cafe',
          '3'.repeat(32),
          hace(40),
          '00000000-0000-4000-8000-00000000babe',
          '4'.repeat(32),
          new Date(ahora).toISOString(),
        ],
      );

      const hechosAntes = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM governance.event',
      );

      const tarea = crearTareaDeRetencion({
        pool: e.pool,
        clock: e.reloj,
        diario: () => undefined,
      });
      const barrido = await tarea.barrer();

      // Se borró algo de cada sitio…
      expect(barrido.enlaces).toBeGreaterThanOrEqual(1);
      expect(barrido.cupos).toBeGreaterThanOrEqual(1);
      expect(barrido.consumos).toBeGreaterThanOrEqual(1);

      // …y lo vigente sigue en pie: no es un `DELETE` sin condición.
      const enlaceVivo = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM identity.magic_link WHERE token_hash = $1`,
        ['b'.repeat(64)],
      );
      expect(enlaceVivo.rows[0]?.n).toBe('1');
      const cupoVivo = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM identity.rate_bucket WHERE bucket_key = $1`,
        ['2'.repeat(64)],
      );
      expect(cupoVivo.rows[0]?.n).toBe('1');
      const consumoVivo = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM identity.rate_consumption WHERE sujeto = $1`,
        ['4'.repeat(32)],
      );
      expect(consumoVivo.rows[0]?.n).toBe('1');

      /*
       * Y EL HISTORIAL NO SE TOCA. Ésta es la aserción que justifica que exista una tarea que borra
       * dentro de un sistema cuyo valor entero es que nada se borra: si algún día alguien añade una
       * cuarta purga y se le va la mano, esta línea se pone roja antes de que llegue a producción.
       */
      const hechosDespues = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM governance.event',
      );
      expect(hechosDespues.rows[0]?.n).toBe(hechosAntes.rows[0]?.n);
    } finally {
      client.release();
    }
  });

  it('barrer dos veces seguidas no borra nada la segunda: es idempotente', async () => {
    // Importa porque la tarea barre AL ARRANCAR además de por temporizador, y un despliegue seguido
    // de otro la ejecuta varias veces en minutos. Si la segunda pasada borrara algo, sería que la
    // condición de vencimiento depende de cuándo se corre y no de la fecha del dato.
    const tarea = crearTareaDeRetencion({ pool: e.pool, clock: e.reloj, diario: () => undefined });
    await tarea.barrer();
    const segunda = await tarea.barrer();
    expect(segunda).toEqual({ enlaces: 0, cupos: 0, consumos: 0 });
  });
});
