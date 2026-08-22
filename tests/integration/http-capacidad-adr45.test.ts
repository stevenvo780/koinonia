/** ADR-0045: capacidad self-only, CAS y cifrado real contra Fastify + PostgreSQL. */

import {
  buildApp,
  unavailableVaultCrypto,
  udeaIdentityAdapter,
  type PgClient,
} from '@koinonia/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiEnv, type ApiListo, como, entrar, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

interface CapacityDeclared {
  readonly declarada: true;
  readonly revision: number;
  readonly minutosPorSemana: number;
  readonly updatedAt: number;
}

interface StoredCapacity {
  readonly revision: number;
  readonly key_ref: string;
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly updated_at: Date;
  readonly wrap_nonce: Buffer;
  readonly wrapped_dek: Buffer;
  readonly crypto_version: number;
}

async function stored(client: PgClient, memberId: string): Promise<StoredCapacity> {
  const { rows } = await client.query<StoredCapacity>(
    `SELECT c.revision, c.key_ref, c.nonce, c.ciphertext, c.updated_at,
            k.wrap_nonce, k.wrapped_dek, k.crypto_version
       FROM identity.contribution_capacity c
       JOIN identity.subject_data_key k
         ON k.member_id = c.member_id AND k.key_ref = c.key_ref
      WHERE c.member_id = $1`,
    [memberId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('faltó la fila cifrada de capacidad');
  return row;
}

describe.skipIf(!env.ok)(`capacidad privada ADR-0045${skipNote(env)}`, () => {
  let e: ApiListo;

  beforeAll(() => {
    e = listo(env);
  });

  it('exige sesión y representa la ausencia sin inventar cero ni revisión', async () => {
    const unauthenticated = await e.app.inject({ method: 'GET', url: '/mi/capacidad' });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json<{ codigo: string }>().codigo).toBe(
      'UNAUTHORIZED_NOT_AUTHENTICATED',
    );

    const own = await entrar(e, 'capacidad.ausente@udea.edu.co');
    const absent = await e.app.inject({
      method: 'GET',
      url: '/mi/capacidad',
      headers: como(own.testigo),
    });
    expect(absent.statusCode, absent.body).toBe(200);
    expect(absent.json()).toStrictEqual({ declarada: false });
  });

  it('crea, actualiza y serializa carreras con CAS sobre la fila de la propia persona', async () => {
    const own = await entrar(e, 'capacidad.cas@udea.edu.co');
    const created = await e.app.inject({
      method: 'PUT',
      url: '/mi/capacidad',
      headers: como(own.testigo),
      payload: { revision: 0, minutosPorSemana: 420 },
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<CapacityDeclared>()).toMatchObject({
      declarada: true,
      revision: 1,
      minutosPorSemana: 420,
    });
    expect(created.json<CapacityDeclared>().updatedAt).toBe(e.reloj.now());

    const firstStored = await stored(e.pool, own.miembroId);
    expect(firstStored.revision).toBe(1);
    expect(firstStored.wrap_nonce).toHaveLength(12);
    expect(firstStored.wrapped_dek.length).toBeGreaterThanOrEqual(48);
    expect(firstStored.nonce).toHaveLength(12);
    expect(firstStored.ciphertext.length).toBeGreaterThanOrEqual(20);
    expect(firstStored.ciphertext.equals(Buffer.from('420', 'utf8'))).toBe(false);
    const binaryPlaintext = Buffer.alloc(4);
    binaryPlaintext.writeUInt32BE(420);
    expect(firstStored.ciphertext.equals(binaryPlaintext)).toBe(false);

    const columns = await e.pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'identity'
          AND table_name = 'contribution_capacity'
        ORDER BY ordinal_position`,
    );
    expect(columns.rows).toStrictEqual([
      { column_name: 'member_id', data_type: 'character' },
      { column_name: 'revision', data_type: 'integer' },
      { column_name: 'key_ref', data_type: 'character' },
      { column_name: 'nonce', data_type: 'bytea' },
      { column_name: 'ciphertext', data_type: 'bytea' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone' },
    ]);

    const updated = await e.app.inject({
      method: 'PUT',
      url: '/mi/capacidad',
      headers: como(own.testigo),
      payload: { revision: 1, minutosPorSemana: 600 },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json<CapacityDeclared>()).toMatchObject({ revision: 2, minutosPorSemana: 600 });
    const secondStored = await stored(e.pool, own.miembroId);
    expect(secondStored.key_ref.trimEnd()).toBe(firstStored.key_ref.trimEnd());
    expect(secondStored.nonce.equals(firstStored.nonce)).toBe(false);
    expect(secondStored.ciphertext.equals(firstStored.ciphertext)).toBe(false);

    const attempts = await Promise.all([
      e.app.inject({
        method: 'PUT',
        url: '/mi/capacidad',
        headers: como(own.testigo),
        payload: { revision: 2, minutosPorSemana: 700 },
      }),
      e.app.inject({
        method: 'PUT',
        url: '/mi/capacidad',
        headers: como(own.testigo),
        payload: { revision: 2, minutosPorSemana: 800 },
      }),
    ]);
    expect(attempts.map((response) => response.statusCode).sort()).toStrictEqual([200, 409]);
    expect(
      attempts.find((response) => response.statusCode === 409)?.json<{ codigo: string }>().codigo,
    ).toBe('STALE_CAPACITY_REVISION');

    const current = await e.app.inject({
      method: 'GET',
      url: '/mi/capacidad',
      headers: como(own.testigo),
    });
    expect(current.statusCode, current.body).toBe(200);
    expect(current.json<CapacityDeclared>().revision).toBe(3);
    expect([700, 800]).toContain(current.json<CapacityDeclared>().minutosPorSemana);
  });

  it('rechaza memberId en cuerpo o query y nunca permite direccionar al otro sujeto', async () => {
    const alice = await entrar(e, 'capacidad.alice@udea.edu.co');
    const bob = await entrar(e, 'capacidad.bob@udea.edu.co');
    for (const [session, minutes] of [
      [alice, 111],
      [bob, 999],
    ] as const) {
      const response = await e.app.inject({
        method: 'PUT',
        url: '/mi/capacidad',
        headers: como(session.testigo),
        payload: { revision: 0, minutosPorSemana: minutes },
      });
      expect(response.statusCode, response.body).toBe(200);
    }

    const bodySelector = await e.app.inject({
      method: 'PUT',
      url: '/mi/capacidad',
      headers: como(alice.testigo),
      payload: { revision: 1, minutosPorSemana: 222, memberId: bob.miembroId },
    });
    expect(bodySelector.statusCode).toBe(400);
    expect(bodySelector.json<{ codigo: string }>().codigo).toBe('DATOS_INVALIDOS');

    const querySelector = await e.app.inject({
      method: 'GET',
      url: `/mi/capacidad?memberId=${bob.miembroId}`,
      headers: como(alice.testigo),
    });
    expect(querySelector.statusCode).toBe(400);

    const aliceOwn = await e.app.inject({
      method: 'GET',
      url: '/mi/capacidad',
      headers: como(alice.testigo),
    });
    const bobOwn = await e.app.inject({
      method: 'GET',
      url: '/mi/capacidad',
      headers: como(bob.testigo),
    });
    expect(aliceOwn.json<CapacityDeclared>().minutosPorSemana).toBe(111);
    expect(bobOwn.json<CapacityDeclared>().minutosPorSemana).toBe(999);
  });

  it('acepta los límites y rechaza enteros fuera de 0..10080 antes de tocar la bóveda', async () => {
    const own = await entrar(e, 'capacidad.limites@udea.edu.co');
    for (const invalid of [-1, 10_081, 1.5]) {
      const response = await e.app.inject({
        method: 'PUT',
        url: '/mi/capacidad',
        headers: como(own.testigo),
        payload: { revision: 0, minutosPorSemana: invalid },
      });
      expect(response.statusCode).toBe(400);
    }
    const maximum = await e.app.inject({
      method: 'PUT',
      url: '/mi/capacidad',
      headers: como(own.testigo),
      payload: { revision: 0, minutosPorSemana: 10_080 },
    });
    expect(maximum.statusCode, maximum.body).toBe(200);
  });

  it('un ciphertext alterado devuelve 503 opaco y no se entierra con una actualización', async () => {
    const own = await entrar(e, 'capacidad.tamper@udea.edu.co');
    const created = await e.app.inject({
      method: 'PUT',
      url: '/mi/capacidad',
      headers: como(own.testigo),
      payload: { revision: 0, minutosPorSemana: 777 },
    });
    expect(created.statusCode).toBe(200);

    await e.superPool.query(
      `UPDATE identity.contribution_capacity
          SET ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 1)
        WHERE member_id = $1`,
      [own.miembroId],
    );
    const read = await e.app.inject({
      method: 'GET',
      url: '/mi/capacidad',
      headers: como(own.testigo),
    });
    expect(read.statusCode).toBe(503);
    expect(read.json<{ codigo: string }>().codigo).toBe('CAPACITY_SERVICE_UNAVAILABLE');
    expect(read.body).not.toMatch(/777|ciphertext|nonce|key_ref/u);

    const overwrite = await e.app.inject({
      method: 'PUT',
      url: '/mi/capacidad',
      headers: como(own.testigo),
      payload: { revision: 1, minutosPorSemana: 60 },
    });
    expect(overwrite.statusCode).toBe(503);
    expect((await stored(e.pool, own.miembroId)).revision).toBe(1);
  });

  it('una bóveda explícitamente indisponible en desarrollo devuelve 503, nunca plaintext', async () => {
    const own = await entrar(e, 'capacidad.sin-vault@udea.edu.co');
    const closedApp = await buildApp({
      pool: e.pool,
      ports: {
        clock: { now: () => e.reloj.now() },
        random: {
          bytes: (n) => e.azar.bytes(n),
          opaqueId: () => e.azar.opaqueId(),
          uuid: () => e.azar.uuid(),
        },
        mailer: e.correo,
        identity: udeaIdentityAdapter(),
        vault: unavailableVaultCrypto,
      },
      ratePepper: 'otra-pimienta-de-prueba-suficientemente-larga',
      webBaseUrl: 'http://localhost:3000',
      modoDesarrollo: true,
    });
    await closedApp.ready();
    try {
      const get = await closedApp.inject({
        method: 'GET',
        url: '/mi/capacidad',
        headers: como(own.testigo),
      });
      expect(get.statusCode).toBe(503);
      expect(get.json<{ codigo: string }>().codigo).toBe('CAPACITY_SERVICE_UNAVAILABLE');

      const response = await closedApp.inject({
        method: 'PUT',
        url: '/mi/capacidad',
        headers: como(own.testigo),
        payload: { revision: 0, minutosPorSemana: 300 },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json<{ codigo: string }>().codigo).toBe('CAPACITY_SERVICE_UNAVAILABLE');
      const count = await e.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM identity.contribution_capacity WHERE member_id = $1',
        [own.miembroId],
      );
      expect(count.rows[0]?.count).toBe('0');
    } finally {
      await closedApp.close();
    }
  });
});
