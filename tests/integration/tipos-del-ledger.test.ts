/**
 * LA REGLA DE TIPOS DEL LEDGER, medida contra PostgreSQL real (§1.1-bis).
 *
 *   ⛔ Ningún valor que forme parte de la preimagen de un hash puede almacenarse en una columna
 *      cuyo tipo NORMALICE su representación.
 *
 * Este fichero tiene dos mitades y las dos son necesarias:
 *
 *  1. **La ida y vuelta** sobre el esquema real: se escribe un evento, se relee de la base, se
 *     recomputa el hash desde lo releído y tiene que coincidir. Es la afirmación positiva.
 *  2. **El contraste** sobre una tabla con `uuid`, `jsonb` y `timestamptz`: la misma operación, con
 *     los tipos que la spec traía, falla. Es documentación ejecutable de por qué la regla existe, y
 *     está aquí para que nadie tenga que fiarse de la prosa.
 *
 * Si la mitad 2 dejara de fallar algún día, no habría que borrarla: habría que averiguar por qué.
 */

import {
  append,
  loadDecisionLog,
  migrate,
  pendingMigrations,
  readStream,
  verifyLedger,
  type PgPool,
} from '@koinonia/api';
import {
  assertCanonicalEvent,
  canonicalize,
  type CanonicalEvent,
  hashEvent,
  InvalidEventError,
  parseCanonical,
  toHex,
} from '@koinonia/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { id32, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

// El contenedor lo comparten los dos bloques de este fichero: se para una sola vez, al final.
afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`regla de tipos del ledger${skipNote(env)}`, () => {
  let appPool: PgPool;
  let superPool: PgPool;

  beforeAll(() => {
    const e = ready(env);
    appPool = e.appPool;
    superPool = e.superPool;
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // 1. La ida y vuelta
  // ═══════════════════════════════════════════════════════════════════════════════════════════

  /**
   * El payload se elige a propósito para que TODAS las normalizaciones de PostgreSQL sean visibles:
   *
   *  - claves `alfa` (4), `b` (1) y `zeta` (4): JCS ordena por unidades de código UTF-16
   *    (`alfa` < `b` < `zeta`); `jsonb` ordena por longitud y luego bytes (`b` < `alfa` < `zeta`).
   *    Los dos órdenes discrepan a propósito.
   *  - texto con acento precompuesto, para que se vea que sobrevive intacto.
   */
  const PAYLOAD = {
    alfa: 'moción de reforma',
    b: 1,
    zeta: ['sí', 'no'],
  } as const;

  const AGREGADO = id32('roundtrip-aggregate');
  const ACTOR = id32('roundtrip-actor');
  const OCURRIDO = '2026-08-21T14:03:07.100Z'; // con un CERO FINAL en los milisegundos, a propósito

  it('un evento releído de la base produce EXACTAMENTE el mismo hash (§1.1-bis)', async () => {
    const escrito = await append(appPool, {
      aggregateId: AGREGADO,
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('roundtrip'),
      events: [
        { eventType: 'PropuestaAbierta', occurredAt: OCURRIDO, actor: ACTOR, payload: PAYLOAD },
      ],
    });

    const original = escrito.events[0];
    expect(original).toBeDefined();
    if (original === undefined) return;

    // — La vuelta: se relee de la base y se recomputa desde lo releído, sin usar nada de memoria.
    const releido = await readStream(appPool, AGREGADO);
    expect(releido).toHaveLength(1);
    const fila = releido[0];
    expect(fila).toBeDefined();
    if (fila === undefined) return;

    const rehidratado = await hashEvent(fila.prevHash, fila.event);

    expect(toHex(rehidratado)).toBe(toHex(fila.eventHash));
    expect(toHex(rehidratado)).toBe(toHex(original.eventHash));
  });

  it('cada campo de la preimagen vuelve byte a byte como se escribió', async () => {
    const fila = (await readStream(appPool, AGREGADO))[0];
    expect(fila).toBeDefined();
    if (fila === undefined) return;

    // El identificador NO vuelve con guiones: la columna es char(32), no uuid.
    expect(fila.event.aggregateId).toBe(AGREGADO);
    expect(fila.event.aggregateId).not.toContain('-');
    expect(fila.event.actor).toBe(ACTOR);

    // El instante conserva el separador `T`, la `Z` y —lo más fácil de perder— el cero final de
    // los milisegundos. `timestamptz` habría devuelto `2026-08-21 14:03:07.1+00`.
    expect(fila.event.occurredAt).toBe(OCURRIDO);
    expect(fila.event.occurredAt).toHaveLength(24);
    expect(fila.event.occurredAt.endsWith('.100Z')).toBe(true);

    // El payload vuelve como el texto canónico exacto, con las claves en orden JCS.
    expect(fila.payloadText).toBe(canonicalize(PAYLOAD));
    expect(fila.payloadText).toBe('{"alfa":"moción de reforma","b":1,"zeta":["sí","no"]}');
  });

  it('la columna `payload` sigue siendo su propia forma canónica JCS', async () => {
    const { rows } = await appPool.query<{ payload: string }>(
      'SELECT payload FROM governance.event WHERE aggregate_id = $1 AND seq = 0',
      [AGREGADO],
    );
    const texto = rows[0]?.payload;
    expect(texto).toBeDefined();
    // `parseCanonical` no se limita a parsear: EXIGE que el texto sea byte a byte su forma canónica.
    expect(() => parseCanonical(texto ?? '')).not.toThrow();
  });

  it('la columna derivada `payload_idx` NO es autoritativa: ya reordenó las claves', async () => {
    const { rows } = await appPool.query<{ payload: string; idx: string }>(
      `SELECT payload, payload_idx::text AS idx
         FROM governance.event WHERE aggregate_id = $1 AND seq = 0`,
      [AGREGADO],
    );
    const fila = rows[0];
    expect(fila).toBeDefined();
    if (fila === undefined) return;

    // Existe, es útil para consultar… y ya no es lo que se hasheó. Por eso el verificador no la lee
    // jamás y por eso lleva el sufijo `_idx`.
    expect(fila.idx).not.toBe(fila.payload);
    expect(fila.idx.indexOf('"b"')).toBeLessThan(fila.idx.indexOf('"alfa"'));
    expect(fila.payload.indexOf('"alfa"')).toBeLessThan(fila.payload.indexOf('"b"'));
  });

  it('el DDL no admite ningún tipo prohibido en las columnas de la preimagen', async () => {
    const { rows } = await superPool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'governance' AND table_name = 'event'
          AND column_name IN ('aggregate_id','aggregate_type','seq','event_type','event_version',
                              'occurred_at','actor','payload')
        ORDER BY column_name`,
    );
    const tipos = new Map(rows.map((row) => [row.column_name, row.data_type]));

    expect(tipos.get('aggregate_id')).toBe('character');
    expect(tipos.get('actor')).toBe('character');
    expect(tipos.get('occurred_at')).toBe('character');
    expect(tipos.get('payload')).toBe('text');

    // La lista blanca del §1.1-bis corolario 4, comprobada en CI y no en revisión de código.
    const PERMITIDOS = new Set(['character', 'text', 'bytea', 'bigint', 'integer', 'boolean']);
    for (const [columna, tipo] of tipos) {
      expect(PERMITIDOS.has(tipo), `${columna} usa ${tipo}, que normaliza la representación`).toBe(
        true,
      );
    }
  });

  it('el runner de migraciones es idempotente y denuncia una migración editada', async () => {
    const segunda = await migrate(superPool);
    expect(segunda.applied).toStrictEqual([]);
    expect(segunda.alreadyApplied.length).toBeGreaterThanOrEqual(4);
    await expect(pendingMigrations(superPool)).resolves.toStrictEqual([]);

    // Una migración aplicada es historia: se corrige con una migración nueva, no editándola. Se
    // falsea el hash registrado para simular que alguien tocó el fichero después de aplicarlo.
    const { rows } = await superPool.query<{ sha256: string }>(
      "SELECT sha256 FROM koinonia_meta.migration WHERE id = '0001'",
    );
    const original = rows[0]?.sha256;
    expect(original).toBeDefined();
    await superPool.query("UPDATE koinonia_meta.migration SET sha256 = $1 WHERE id = '0001'", [
      '0'.repeat(64),
    ]);
    await expect(migrate(superPool)).rejects.toThrow(/cambió después de aplicarse/u);
    await superPool.query("UPDATE koinonia_meta.migration SET sha256 = $1 WHERE id = '0001'", [
      original,
    ]);
    await expect(migrate(superPool)).resolves.toMatchObject({ applied: [] });
  });

  it('`char(n)` sin CHECK anclado TAMBIÉN normalizaría: rellena con espacios', async () => {
    // El `char(n)` que la spec prescribe es admisible SÓLO junto al CHECK anclado que fija la
    // longitud exacta. Sin él, `bpchar` rellena y la preimagen cambia sin que nadie lo note.
    await superPool.query('CREATE TABLE IF NOT EXISTS probe_bpchar (id char(32))');
    await superPool.query('TRUNCATE probe_bpchar');
    await superPool.query("INSERT INTO probe_bpchar VALUES ('abc')");
    const { rows } = await superPool.query<{ id: string }>('SELECT id FROM probe_bpchar');
    expect(rows[0]?.id).toBe(`abc${' '.repeat(29)}`);
    expect(rows[0]?.id).toHaveLength(32);

    // Y con el CHECK del DDL real, ese valor ni entra.
    await expect(
      superPool.query(
        `INSERT INTO governance.event
           (leaf_index, aggregate_id, aggregate_type, seq, event_type, event_version,
            occurred_at, payload, prev_hash, event_hash, spine_hash, request_id)
         VALUES (999999, 'abc', 'propuesta', 5, 'X', 1, '2026-08-21T14:00:00.000Z', '{}',
                 decode(repeat('11',32),'hex'), decode(repeat('22',32),'hex'), NULL,
                 '00000000-0000-4000-8000-0000000000ff')`,
      ),
    ).rejects.toThrow(/check|restricción|constraint/iu);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. EL CONTRASTE — documentación ejecutable de por qué la regla existe
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe.skipIf(!env.ok)(
  `CONTRASTE · los tipos prohibidos rompen la verificación y el sistema se acusa a sí mismo${skipNote(env)}`,
  () => {
    let superPool: PgPool;

    beforeAll(async () => {
      superPool = ready(env).superPool;
      // La tabla que la spec traía en §3.1 antes de la corrección: `uuid`, `jsonb`, `timestamptz`.
      // Vive fuera de `governance` porque no es historia: es una demostración.
      await superPool.query(`
        CREATE SCHEMA IF NOT EXISTS contraste;
        CREATE TABLE IF NOT EXISTS contraste.evento_con_tipos_prohibidos (
          aggregate_id   uuid        NOT NULL,      -- prohibido: reescribe la forma
          aggregate_type text        NOT NULL,
          seq            integer     NOT NULL,
          event_type     text        NOT NULL,
          event_version  integer     NOT NULL,
          occurred_at    timestamptz NOT NULL,      -- prohibido: normaliza zona y trunca ms
          actor          uuid,                      -- prohibido: reescribe la forma
          payload        jsonb       NOT NULL,      -- prohibido: reordena claves; no guarda el texto
          prev_hash      bytea       NOT NULL,
          event_hash     bytea       NOT NULL,
          PRIMARY KEY (aggregate_id, seq)
        );
        TRUNCATE contraste.evento_con_tipos_prohibidos;
      `);
    });

    const AGREGADO = id32('contraste-aggregate');
    const ACTOR = id32('contraste-actor');
    const OCURRIDO = '2026-08-21T14:03:07.100Z';
    const PAYLOAD = { alfa: 'moción', b: 1, zeta: 'sí' } as const;

    const EVENTO: CanonicalEvent = {
      aggregateId: AGREGADO,
      aggregateType: 'propuesta',
      seq: 0,
      eventType: 'PropuestaAbierta',
      eventVersion: 1,
      occurredAt: OCURRIDO,
      actor: ACTOR,
      payload: PAYLOAD,
    };

    it('uuid devuelve la forma con guiones: el identificador ya no es el que se hasheó', async () => {
      const { rows } = await superPool.query<{ salida: string }>(
        'SELECT $1::uuid::text AS salida',
        [AGREGADO],
      );
      expect(rows[0]?.salida).toHaveLength(36);
      expect(rows[0]?.salida).toContain('-');
      expect(rows[0]?.salida).not.toBe(AGREGADO);

      // Y el validador del evento canónico lo rechaza, que es exactamente lo que debe hacer.
      expect(() => {
        assertCanonicalEvent({ ...EVENTO, aggregateId: rows[0]?.salida ?? '' });
      }).toThrow(InvalidEventError);
    });

    it('timestamptz cambia el separador, la zona y trunca el cero final de los milisegundos', async () => {
      const { rows } = await superPool.query<{ salida: string }>(
        'SELECT $1::timestamptz::text AS salida',
        [OCURRIDO],
      );
      expect(rows[0]?.salida).toBe('2026-08-21 14:03:07.1+00');
      expect(rows[0]?.salida).not.toBe(OCURRIDO);
      expect(() => {
        assertCanonicalEvent({ ...EVENTO, occurredAt: rows[0]?.salida ?? '' });
      }).toThrow(InvalidEventError);
    });

    it('jsonb NO guarda el texto: lo reemite reordenado, y dos textos distintos colapsan en uno', async () => {
      const canonico = canonicalize(PAYLOAD);
      expect(canonico).toBe('{"alfa":"moción","b":1,"zeta":"sí"}');

      const { rows } = await superPool.query<{ salida: string }>(
        'SELECT $1::jsonb::text AS salida',
        [canonico],
      );
      // Orden por (longitud, bytes) —el de `jsonb`— en vez de por unidades de código UTF-16 —el de
      // JCS—, más un espacio tras cada dos puntos. Ya no es la preimagen.
      expect(rows[0]?.salida).toBe('{"b": 1, "alfa": "moción", "zeta": "sí"}');
      expect(rows[0]?.salida).not.toBe(canonico);

      // Y la pérdida de información: dos preimágenes DISTINTAS producen el mismo jsonb. Una columna
      // que no es inyectiva no puede ser la fuente de verdad de «los bytes que se hashearon».
      const dupes = await superPool.query<{ a: string; b: string }>(
        `SELECT '{"voto":"si","voto":"no"}'::jsonb::text AS a,
                '{"voto":"no"}'::jsonb::text            AS b`,
      );
      expect(dupes.rows[0]?.a).toBe(dupes.rows[0]?.b);
    });

    it('EL FALLO COMPLETO: el mismo evento escrito con tipos prohibidos ya no verifica', async () => {
      // Se calcula el hash del evento correcto y se guarda junto a la fila mal tipada, igual que
      // haría una implementación que siguiera el DDL original de la spec.
      const prevHash = new Uint8Array(32).fill(0x11);
      const hashOriginal = await hashEvent(prevHash, EVENTO);

      await superPool.query(
        `INSERT INTO contraste.evento_con_tipos_prohibidos
           (aggregate_id, aggregate_type, seq, event_type, event_version,
            occurred_at, actor, payload, prev_hash, event_hash)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7::uuid, $8::jsonb, $9, $10)`,
        [
          AGREGADO,
          EVENTO.aggregateType,
          EVENTO.seq,
          EVENTO.eventType,
          EVENTO.eventVersion,
          OCURRIDO,
          ACTOR,
          canonicalize(PAYLOAD),
          Buffer.from(prevHash),
          Buffer.from(hashOriginal),
        ],
      );

      // Se relee tal cual, como haría la capa de acceso a datos de esa implementación.
      const { rows } = await superPool.query<{
        aggregate_id: string;
        aggregate_type: string;
        seq: number;
        event_type: string;
        event_version: number;
        occurred_at: string;
        actor: string;
        payload: Record<string, unknown>;
        prev_hash: Uint8Array;
        event_hash: Uint8Array;
      }>(
        `SELECT aggregate_id::text AS aggregate_id, aggregate_type, seq, event_type, event_version,
                occurred_at::text  AS occurred_at, actor::text AS actor,
                payload, prev_hash, event_hash
           FROM contraste.evento_con_tipos_prohibidos WHERE seq = 0`,
      );
      const fila = rows[0];
      expect(fila).toBeDefined();
      if (fila === undefined) return;

      const rehidratado = {
        aggregateId: fila.aggregate_id,
        aggregateType: fila.aggregate_type,
        seq: fila.seq,
        eventType: fila.event_type,
        eventVersion: fila.event_version,
        occurredAt: fila.occurred_at,
        actor: fila.actor,
        payload: fila.payload,
      };

      // (a) Ni siquiera pasa la validación: la base devolvió cosas que el ledger no admite.
      expect(() => {
        assertCanonicalEvent(rehidratado);
      }).toThrow(InvalidEventError);

      // (b) Y si alguien «arreglara» el validador para tragárselo, el hash no coincidiría, que es
      //     el fallo grave: el sistema declararía HISTORIA ALTERADA sin que nadie la haya alterado.
      // `hashEvent` acepta `unknown` a propósito: los datos llegan de la red y de la base, y tipar
      // la entrada daría una falsa garantía. Aquí eso permite hashear justo lo que la base devolvió.
      const rehidratadoHash = await hashEvent(Uint8Array.from(fila.prev_hash), rehidratado);
      expect(toHex(rehidratadoHash)).not.toBe(toHex(hashOriginal));
      expect(toHex(Uint8Array.from(fila.event_hash))).toBe(toHex(hashOriginal));
    });

    it('el MISMO evento sobre el esquema correcto sí cierra la ida y vuelta', async () => {
      // Control positivo. Sin él, el test anterior sólo demostraría que algo falla, no que la regla
      // sea la que lo arregla.
      const e = ready(env);
      const aggregateId = id32('contraste-control');
      const escrito = await append(e.appPool, {
        aggregateId,
        aggregateType: 'propuesta',
        expectedHead: { kind: 'new' },
        requestId: requestId('contraste-control'),
        events: [
          {
            eventType: EVENTO.eventType,
            occurredAt: OCURRIDO,
            actor: ACTOR,
            payload: PAYLOAD,
          },
        ],
      });
      const fila = (await readStream(e.appPool, aggregateId))[0];
      expect(fila).toBeDefined();
      if (fila === undefined) return;

      expect(toHex(await hashEvent(fila.prevHash, fila.event))).toBe(toHex(fila.eventHash));
      expect(toHex(fila.eventHash)).toBe(toHex(escrito.events[0]?.eventHash ?? new Uint8Array()));
    });

    it('el ledger real sigue íntegro tras todo lo anterior', async () => {
      const informe = await verifyLedger(ready(env).appPool);
      expect(informe.findings).toStrictEqual([]);
      expect(informe.ok).toBe(true);
      // `loadDecisionLog` sobre un agregado que no es una decisión no debe inventarse nada.
      await expect(loadDecisionLog(ready(env).appPool, id32('inexistente'))).resolves.toStrictEqual(
        [],
      );
    });
  },
);
