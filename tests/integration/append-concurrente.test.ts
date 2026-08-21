/**
 * Append bajo concurrencia real (§3.2, §3.3, §3.5).
 *
 * «De verdad concurrente, no en serie»: los N escritores se lanzan con `Promise.allSettled` sobre
 * conexiones **distintas** del pool, de modo que sus transacciones se solapan en el servidor y quien
 * las ordena es `pg_advisory_xact_lock`, no el bucle del test. Un test que llamara a `append` N veces
 * con `await` no probaría nada: comprobaría que un bucle secuencial es secuencial.
 *
 * Lo que hay que sostener:
 *
 *  - con la MISMA cabeza esperada, **exactamente uno** gana cada ronda;
 *  - la cadena queda sin huecos ni bifurcaciones;
 *  - el `leaf_index` global sigue siendo **denso** aunque haya transacciones abortadas —que es
 *    justo lo que `BIGSERIAL` no puede prometer, y por lo que está prohibido (§3.2)—;
 *  - reenviar el mismo `request_id` no duplica el evento.
 */

import {
  append,
  appendWithin,
  HeadConflictError,
  readHead,
  readStream,
  verifyAggregate,
  verifyLedger,
  type PgPool,
} from '@koinonia/api';
import { toHex } from '@koinonia/crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

interface Densidad {
  readonly total: bigint;
  readonly max: bigint | undefined;
  readonly cursor: bigint;
}

async function densidad(pool: PgPool): Promise<Densidad> {
  const { rows } = await pool.query<{ total: string; max_leaf: string | null; cursor: string }>(
    `SELECT (SELECT count(*) FROM governance.event)::text          AS total,
            (SELECT max(leaf_index) FROM governance.event)::text   AS max_leaf,
            (SELECT next_leaf_index FROM governance.ledger_cursor)::text AS cursor`,
  );
  const row = rows[0];
  return {
    total: BigInt(row?.total ?? '0'),
    max: row?.max_leaf == null ? undefined : BigInt(row.max_leaf),
    cursor: BigInt(row?.cursor ?? '0'),
  };
}

describe.skipIf(!env.ok)(`append concurrente${skipNote(env)}`, () => {
  let pool: PgPool;
  let superPool: PgPool;

  beforeAll(() => {
    pool = ready(env).appPool;
    superPool = ready(env).superPool;
  });

  it('N escritores compiten por crear el MISMO agregado: gana exactamente uno', async () => {
    const aggregateId = id32('carrera-genesis');
    const N = 12;

    const intentos = Array.from({ length: N }, (_, i) =>
      append(pool, {
        aggregateId,
        aggregateType: 'propuesta',
        expectedHead: { kind: 'new' },
        requestId: requestId(`genesis-${String(i)}`),
        events: [
          {
            eventType: 'PropuestaAbierta',
            occurredAt: iso(i),
            payload: { escritor: i },
          },
        ],
      }),
    );

    const resultados = await Promise.allSettled(intentos);
    const ganadores = resultados.filter((r) => r.status === 'fulfilled');
    const perdedores = resultados.filter((r) => r.status === 'rejected');

    expect(ganadores).toHaveLength(1);
    expect(perdedores).toHaveLength(N - 1);
    for (const perdedor of perdedores) {
      expect(perdedor.reason).toBeInstanceOf(HeadConflictError);
    }

    // Un solo génesis, un solo `AgregadoAbierto` en la espina.
    const stream = await readStream(pool, aggregateId);
    expect(stream).toHaveLength(1);
    expect(stream[0]?.event.seq).toBe(0);
    await expect(verifyAggregate(pool, aggregateId)).resolves.toMatchObject({ ok: true });
  });

  it('N escritores por ronda sobre la misma cabeza: uno gana, la cadena no se bifurca', async () => {
    const aggregateId = id32('carrera-rondas');
    const N = 10;
    const RONDAS = 6;

    await append(pool, {
      aggregateId,
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('rondas-genesis'),
      events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { r: 0 } }],
    });

    for (let ronda = 1; ronda <= RONDAS; ronda++) {
      const cabeza = await readHead(pool, aggregateId);
      expect(cabeza).toBeDefined();
      if (cabeza === undefined) return;

      // Todos afirman la MISMA cabeza y salen a la vez. Esto es lo que pasa cuando diez personas
      // votan en el mismo segundo desde la red del campus.
      const resultados = await Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          append(pool, {
            aggregateId,
            aggregateType: 'propuesta',
            expectedHead: { kind: 'at', seq: cabeza.seq, hash: cabeza.hash },
            requestId: requestId(`ronda-${String(ronda)}-${String(i)}`),
            events: [
              {
                eventType: 'VotoEmitido',
                occurredAt: iso(ronda * 1000 + i),
                payload: { ronda, escritor: i },
              },
            ],
          }),
        ),
      );

      const ganadores = resultados.filter((r) => r.status === 'fulfilled');
      expect(ganadores, `ronda ${String(ronda)}`).toHaveLength(1);
      for (const r of resultados.filter((x) => x.status === 'rejected')) {
        expect(r.reason).toBeInstanceOf(HeadConflictError);
      }
    }

    // Sin huecos y sin bifurcaciones: `seq` denso 0..RONDAS y cada eslabón colgando del anterior.
    const stream = await readStream(pool, aggregateId);
    expect(stream).toHaveLength(RONDAS + 1);
    expect(stream.map((s) => s.event.seq)).toStrictEqual(
      Array.from({ length: RONDAS + 1 }, (_, i) => i),
    );
    for (let i = 1; i < stream.length; i++) {
      expect(toHex(stream[i]?.prevHash ?? new Uint8Array())).toBe(
        toHex(stream[i - 1]?.eventHash ?? new Uint8Array()),
      );
    }
    await expect(verifyAggregate(pool, aggregateId)).resolves.toMatchObject({ ok: true });
  });

  it('N escritores sin expectativa (`any`) escriben todos, en un orden total y sin huecos', async () => {
    const aggregateId = id32('carrera-any');
    const N = 16;

    await append(pool, {
      aggregateId,
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('any-genesis'),
      events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { r: 0 } }],
    });

    const resultados = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        append(pool, {
          aggregateId,
          aggregateType: 'propuesta',
          expectedHead: { kind: 'any' },
          requestId: requestId(`any-${String(i)}`),
          events: [{ eventType: 'VotoEmitido', occurredAt: iso(i), payload: { escritor: i } }],
        }),
      ),
    );
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(N);

    const stream = await readStream(pool, aggregateId);
    expect(stream).toHaveLength(N + 1);
    expect(stream.map((s) => s.event.seq)).toStrictEqual(
      Array.from({ length: N + 1 }, (_, i) => i),
    );
    // Cada escritor aparece exactamente una vez: nadie se perdió y nadie se duplicó.
    const escritores = stream
      .slice(1)
      .map((s) => s.event.payload['escritor'])
      .sort((a, b) => Number(a) - Number(b));
    expect(escritores).toStrictEqual(Array.from({ length: N }, (_, i) => i));

    await expect(verifyAggregate(pool, aggregateId)).resolves.toMatchObject({ ok: true });
  });

  it('el índice global sigue DENSO tras todas las transacciones abortadas (§3.2)', async () => {
    const d = await densidad(pool);
    expect(d.max).toBeDefined();
    if (d.max === undefined) return;
    expect(d.total).toBe(d.max + 1n);
    expect(d.cursor).toBe(d.total);
  });

  it('un ROLLBACK devuelve el `leaf_index` reservado: por eso no vale una secuencia', async () => {
    // Ésta es la diferencia exacta entre `UPDATE … RETURNING` sobre una fila y `BIGSERIAL`:
    // `nextval()` NO se revierte, y el hueco que dejaría le daría al administrador la coartada
    // «fue un rollback» para justificar un evento borrado.
    const antes = await densidad(superPool);
    const aggregateId = id32('rollback-prueba');

    const client = await superPool.connect();
    try {
      await client.query('BEGIN');
      const dentro = await appendWithin(client, {
        aggregateId,
        aggregateType: 'propuesta',
        expectedHead: { kind: 'new' },
        requestId: requestId('rollback-prueba'),
        events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(1), payload: { x: 1 } }],
      });
      // Dentro de la transacción, el índice ya está consumido.
      expect(dentro.firstLeafIndex).toBe(antes.cursor);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const despues = await densidad(superPool);
    expect(despues.cursor).toBe(antes.cursor);
    expect(despues.total).toBe(antes.total);
    await expect(readStream(superPool, aggregateId)).resolves.toStrictEqual([]);

    // Y el siguiente append de verdad ocupa EXACTAMENTE el índice que el abortado había reservado.
    const real = await append(superPool, {
      aggregateId,
      aggregateType: 'propuesta',
      expectedHead: { kind: 'new' },
      requestId: requestId('rollback-prueba-2'),
      events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(2), payload: { x: 2 } }],
    });
    expect(real.firstLeafIndex).toBe(antes.cursor);
  });

  it('todo agregado nacido en las carreras quedó registrado en la espina', async () => {
    const informe = await verifyLedger(pool);
    expect(informe.findings).toStrictEqual([]);
    expect(informe.ok).toBe(true);
  });
});

describe.skipIf(!env.ok)(`idempotencia por request_id${skipNote(env)}`, () => {
  let pool: PgPool;

  beforeAll(() => {
    pool = ready(env).appPool;
  });

  it('reenviar el MISMO request_id no duplica el evento', async () => {
    const aggregateId = id32('idempotencia');
    const rid = requestId('idempotencia-unica');
    const orden = {
      aggregateId,
      aggregateType: 'propuesta' as const,
      expectedHead: { kind: 'new' } as const,
      requestId: rid,
      events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { voto: 'si' } }],
    };

    const primera = await append(pool, orden);
    expect(primera.idempotentReplay).toBe(false);

    // El timeout de la red móvil del campus: el cliente reintenta el MISMO comando.
    const segunda = await append(pool, orden);
    expect(segunda.idempotentReplay).toBe(true);
    expect(segunda.firstLeafIndex).toBe(primera.firstLeafIndex);
    expect(toHex(segunda.head.hash)).toBe(toHex(primera.head.hash));

    const stream = await readStream(pool, aggregateId);
    expect(stream).toHaveLength(1);
  });

  it('el reintento devuelve el resultado ya registrado, no un error', async () => {
    const aggregateId = id32('idempotencia-lote');
    const rid = requestId('idempotencia-lote');
    const orden = {
      aggregateId,
      aggregateType: 'propuesta' as const,
      expectedHead: { kind: 'new' } as const,
      requestId: rid,
      events: [
        { eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { n: 1 } },
        { eventType: 'VotoEmitido', occurredAt: iso(1), payload: { n: 2 } },
        { eventType: 'VotoEmitido', occurredAt: iso(2), payload: { n: 3 } },
      ],
    };

    const primera = await append(pool, orden);
    expect(primera.events).toHaveLength(3);

    const repetida = await append(pool, orden);
    expect(repetida.idempotentReplay).toBe(true);
    expect(repetida.events).toHaveLength(3);
    expect(repetida.events.map((e) => toHex(e.eventHash))).toStrictEqual(
      primera.events.map((e) => toHex(e.eventHash)),
    );

    // Un lote de 3 con un solo `requestId` es exactamente lo que la UNIQUE(request_id) del §3.1
    // hacía imposible. La clave de idempotencia vive en `governance.append_request`.
    expect(await readStream(pool, aggregateId)).toHaveLength(3);
  });

  it('dos envíos SIMULTÁNEOS del mismo request_id escriben una sola vez', async () => {
    const aggregateId = id32('idempotencia-carrera');
    const rid = requestId('idempotencia-carrera');
    const orden = {
      aggregateId,
      aggregateType: 'propuesta' as const,
      expectedHead: { kind: 'new' } as const,
      requestId: rid,
      events: [{ eventType: 'PropuestaAbierta', occurredAt: iso(0), payload: { voto: 'si' } }],
    };

    const resultados = await Promise.allSettled([
      append(pool, orden),
      append(pool, orden),
      append(pool, orden),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await readStream(pool, aggregateId)).toHaveLength(1);
  });

  it('el ledger sigue íntegro y denso tras la idempotencia', async () => {
    const informe = await verifyLedger(pool);
    expect(informe.findings).toStrictEqual([]);
    const d = await densidad(pool);
    expect(d.max).toBeDefined();
    if (d.max !== undefined) expect(d.total).toBe(d.max + 1n);
  });
});
