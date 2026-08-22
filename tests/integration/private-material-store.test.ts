/** ADR-0045: aperturas textuales privadas dentro de la misma transacción que el evento. */

import {
  createRestrictedTextMaterialWithin,
  InvalidPrivateMaterialInputError,
  lockLedgerWithin,
  lockVaultSubjectForReadWithin,
  NodeAes256GcmVaultCrypto,
  openRestrictedTextMaterialWithin,
  PrivateMaterialUnavailableError,
  verifyRestrictedPrivateMaterialsWithin,
  withTransaction,
} from '@koinonia/api';
import {
  createPrivateMaterialCommitment,
  eventId,
  initiativeId,
  memberId,
  type PrivateMaterialContext,
  taskId,
  toPrivateMaterialCommitment,
} from '@koinonia/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { apiEnv, type ApiListo, como, entrar, listo, skipNote } from './helpers/api-env.js';

const env = await apiEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

interface BlockContext {
  readonly purpose: 'task-block-detail';
  readonly initiativeId: ReturnType<typeof initiativeId>;
  readonly taskId: ReturnType<typeof taskId>;
  readonly offerId: ReturnType<typeof eventId>;
  readonly visibility: 'restricted';
}

interface Fixture {
  readonly owner: { readonly testigo: string; readonly miembroId: string };
  readonly materialId: string;
  readonly context: BlockContext;
  readonly content: string;
  readonly commitment: Awaited<ReturnType<typeof createPrivateMaterialCommitment>>;
}

describe.skipIf(!env.ok)(`material privado ADR-0045${skipNote(env)}`, () => {
  let e: ApiListo;
  const vault = new NodeAes256GcmVaultCrypto(
    Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  );

  beforeAll(() => {
    e = listo(env);
  });

  function blockContext(): BlockContext {
    return {
      purpose: 'task-block-detail',
      initiativeId: initiativeId(e.azar.opaqueId()),
      taskId: taskId(e.azar.opaqueId()),
      offerId: eventId(e.azar.opaqueId()),
      visibility: 'restricted',
    };
  }

  async function createFixture(
    email: string,
    content = 'La respuesta externa contiene un dato personal que no debe entrar al ledger.',
  ): Promise<Fixture> {
    const owner = await entrar(e, email);
    const materialId = e.azar.opaqueId();
    const context = blockContext();
    const created = await withTransaction(e.pool, async (client) => {
      await lockLedgerWithin(client);
      return await createRestrictedTextMaterialWithin(client, vault, e.azar, {
        materialId,
        ownerId: memberId(owner.miembroId),
        context,
        content,
        createdAt: e.reloj.now(),
      });
    });
    return { owner, materialId, context, content, commitment: created.commitment };
  }

  async function open(fixture: Fixture) {
    return await withTransaction(e.pool, (client) =>
      openRestrictedTextMaterialWithin(client, vault, {
        materialId: fixture.materialId,
        ownerId: memberId(fixture.owner.miembroId),
        expectedContext: fixture.context,
        expectedCommitment: fixture.commitment,
      }),
    );
  }

  it('reutiliza la DSK de capacidad, persiste sólo ciphertext y verifica la apertura', async () => {
    const owner = await entrar(e, 'material.reusa-dsk@udea.edu.co');
    const capacity = await e.app.inject({
      method: 'PUT',
      url: '/mi/capacidad',
      headers: como(owner.testigo),
      payload: { revision: 0, minutosPorSemana: 360 },
    });
    expect(capacity.statusCode, capacity.body).toBe(200);
    const before = await e.pool.query<{ key_ref: string }>(
      'SELECT key_ref FROM identity.subject_data_key WHERE member_id = $1',
      [owner.miembroId],
    );
    const keyRef = before.rows[0]?.key_ref.trimEnd();
    expect(keyRef).toMatch(/^[0-9a-f]{32}$/u);

    const materialId = e.azar.opaqueId();
    const context = blockContext();
    const content = 'El proveedor nombró a una persona; el detalle permanece restringido.';
    const created = await withTransaction(e.pool, async (client) => {
      await lockLedgerWithin(client);
      return await createRestrictedTextMaterialWithin(client, vault, e.azar, {
        materialId,
        ownerId: memberId(owner.miembroId),
        context,
        content,
        createdAt: e.reloj.now(),
      });
    });
    expect(created.materialId).toBe(materialId);
    expect(created.commitment).toMatch(/^[0-9a-f]{64}$/u);

    const stored = await e.pool.query<{
      key_ref: string;
      nonce: Buffer;
      ciphertext: Buffer;
      purpose: string;
    }>(
      'SELECT key_ref, nonce, ciphertext, purpose FROM identity.private_material WHERE material_id = $1',
      [materialId],
    );
    const row = stored.rows[0];
    expect(row).toBeDefined();
    expect(row?.key_ref.trimEnd()).toBe(keyRef);
    expect(row?.nonce).toHaveLength(12);
    expect(row?.purpose).toBe(context.purpose);
    expect(row?.ciphertext).toHaveLength(128 * 1024 + 16);
    expect(row?.ciphertext.indexOf(Buffer.from(content, 'utf8'))).toBe(-1);

    const columns = await e.pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'identity' AND table_name = 'private_material'
        ORDER BY ordinal_position`,
    );
    expect(columns.rows).toStrictEqual([
      { column_name: 'material_id', data_type: 'character' },
      { column_name: 'owner_id', data_type: 'character' },
      { column_name: 'key_ref', data_type: 'character' },
      { column_name: 'purpose', data_type: 'text' },
      { column_name: 'nonce', data_type: 'bytea' },
      { column_name: 'ciphertext', data_type: 'bytea' },
      { column_name: 'created_at', data_type: 'timestamp with time zone' },
    ]);

    const opening = await withTransaction(e.pool, (client) =>
      openRestrictedTextMaterialWithin(client, vault, {
        materialId,
        ownerId: memberId(owner.miembroId),
        expectedContext: context,
        expectedCommitment: created.commitment,
      }),
    );
    expect(opening).toMatchObject({ context, content });
    expect(opening.nonce128).toMatch(/^[0-9a-f]{32}$/u);
    await expect(
      createPrivateMaterialCommitment({
        nonce: Buffer.from(opening.nonce128, 'hex'),
        context: opening.context,
        content: opening.content,
      }),
    ).resolves.toBe(created.commitment);

    const keys = await e.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM identity.subject_data_key WHERE member_id = $1',
      [owner.miembroId],
    );
    expect(keys.rows[0]?.count).toBe('1');
  });

  it('persiste longitud fija aunque el texto restringido tenga tamaños muy distintos', async () => {
    const short = await createFixture('material.longitud-corta@udea.edu.co', 'x');
    const maximum = await createFixture(
      'material.longitud-maxima@udea.edu.co',
      'x'.repeat(16 * 1024),
    );
    const { rows } = await e.pool.query<{ material_id: string; bytes: number }>(
      `SELECT material_id, octet_length(ciphertext)::integer AS bytes
         FROM identity.private_material
        WHERE material_id = ANY($1::char(32)[])
        ORDER BY material_id`,
      [[short.materialId, maximum.materialId]],
    );

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.bytes))).toStrictEqual(new Set([128 * 1024 + 16]));
    await expect(open(short)).resolves.toMatchObject({ content: 'x' });
    await expect(open(maximum)).resolves.toMatchObject({ content: 'x'.repeat(16 * 1024) });
  });

  it('dos lecturas privadas concurrentes del mismo dueño no ascienden locks ni se bloquean', async () => {
    const fixture = await createFixture('material.concurrente@udea.edu.co');
    let arrivals = 0;
    let release: (() => void) | undefined;
    const together = new Promise<void>((resolve) => {
      release = resolve;
    });
    const meet = async (): Promise<void> => {
      arrivals++;
      if (arrivals === 2) release?.();
      await together;
    };
    const read = async () =>
      await withTransaction(e.pool, async (client) => {
        // Fuerza que ambas transacciones conserven FOR SHARE antes de que la apertura tome su lock.
        // La implementación anterior intentaba ascender aquí a FOR UPDATE y PostgreSQL detectaba
        // un deadlock reproducible entre las dos.
        await lockVaultSubjectForReadWithin(client, memberId(fixture.owner.miembroId));
        await meet();
        return await openRestrictedTextMaterialWithin(client, vault, {
          materialId: fixture.materialId,
          ownerId: memberId(fixture.owner.miembroId),
          expectedContext: fixture.context,
          expectedCommitment: fixture.commitment,
        });
      });

    const openings = await Promise.all([read(), read()]);
    expect(openings.map((opening) => opening.content)).toStrictEqual([
      fixture.content,
      fixture.content,
    ]);
  });

  it('otro sujeto, purpose/contexto cruzado y commitment distinto fallan igual', async () => {
    const fixture = await createFixture('material.opaco@udea.edu.co');
    const other = await entrar(e, 'material.otro@udea.edu.co');
    const helpContext: PrivateMaterialContext = {
      purpose: 'task-help-detail',
      initiativeId: fixture.context.initiativeId,
      taskId: fixture.context.taskId,
      offerId: fixture.context.offerId,
      visibility: 'restricted',
    };
    const attempts = [
      () =>
        withTransaction(e.pool, (client) =>
          openRestrictedTextMaterialWithin(client, vault, {
            materialId: fixture.materialId,
            ownerId: memberId(other.miembroId),
            expectedContext: fixture.context,
            expectedCommitment: fixture.commitment,
          }),
        ),
      () =>
        withTransaction(e.pool, (client) =>
          openRestrictedTextMaterialWithin(client, vault, {
            materialId: fixture.materialId,
            ownerId: memberId(fixture.owner.miembroId),
            expectedContext: helpContext,
            expectedCommitment: fixture.commitment,
          }),
        ),
      () =>
        withTransaction(e.pool, (client) =>
          openRestrictedTextMaterialWithin(client, vault, {
            materialId: fixture.materialId,
            ownerId: memberId(fixture.owner.miembroId),
            expectedContext: fixture.context,
            expectedCommitment: toPrivateMaterialCommitment('f'.repeat(64)),
          }),
        ),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toStrictEqual(new PrivateMaterialUnavailableError());
    }
    await expect(open(fixture)).resolves.toMatchObject({ content: fixture.content });
  });

  it('detecta ciphertext alterado o movido entre materialIds sin revelar cuál falló', async () => {
    const first = await createFixture('material.tamper@udea.edu.co');
    const secondId = e.azar.opaqueId();
    const second = await withTransaction(e.pool, async (client) => {
      await lockLedgerWithin(client);
      return await createRestrictedTextMaterialWithin(client, vault, e.azar, {
        materialId: secondId,
        ownerId: memberId(first.owner.miembroId),
        context: first.context,
        content: 'Otro texto restringido con el mismo propósito y sujeto.',
        createdAt: e.reloj.now(),
      });
    });
    await e.superPool.query(
      `UPDATE identity.private_material target
          SET nonce = source.nonce, ciphertext = source.ciphertext
         FROM identity.private_material source
        WHERE target.material_id = $1 AND source.material_id = $2`,
      [first.materialId, secondId],
    );
    await expect(open(first)).rejects.toBeInstanceOf(PrivateMaterialUnavailableError);

    await e.superPool.query(
      `UPDATE identity.private_material
          SET ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext, 0) # 1)
        WHERE material_id = $1`,
      [secondId],
    );
    await expect(
      withTransaction(e.pool, (client) =>
        openRestrictedTextMaterialWithin(client, vault, {
          materialId: secondId,
          ownerId: memberId(first.owner.miembroId),
          expectedContext: first.context,
          expectedCommitment: second.commitment,
        }),
      ),
    ).rejects.toBeInstanceOf(PrivateMaterialUnavailableError);
  });

  it('rechaza publicación y texto fuera del límite antes de insertar', async () => {
    const owner = await entrar(e, 'material.restricciones@udea.edu.co');
    const publicContext: PrivateMaterialContext = {
      purpose: 'task-evidence-object',
      initiativeId: initiativeId(e.azar.opaqueId()),
      taskId: taskId(e.azar.opaqueId()),
      offerId: eventId(e.azar.opaqueId()),
      visibility: 'public',
    };
    await expect(
      withTransaction(e.pool, async (client) => {
        await lockLedgerWithin(client);
        return await createRestrictedTextMaterialWithin(client, vault, e.azar, {
          materialId: e.azar.opaqueId(),
          ownerId: memberId(owner.miembroId),
          context: publicContext,
          content: 'No se publica por esta API.',
          createdAt: e.reloj.now(),
        });
      }),
    ).rejects.toBeInstanceOf(InvalidPrivateMaterialInputError);
    await expect(
      withTransaction(e.pool, async (client) => {
        await lockLedgerWithin(client);
        return await createRestrictedTextMaterialWithin(client, vault, e.azar, {
          materialId: e.azar.opaqueId(),
          ownerId: memberId(owner.miembroId),
          context: blockContext(),
          content: 'x'.repeat(16 * 1024 + 1),
          createdAt: e.reloj.now(),
        });
      }),
    ).rejects.toBeInstanceOf(InvalidPrivateMaterialInputError);

    const count = await e.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM identity.private_material WHERE owner_id = $1',
      [owner.miembroId],
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('la auditoría y /integridad ponen en rojo material sin compromiso en el ledger', async () => {
    const orphan = await createFixture('material.huerfano@udea.edu.co', 'texto sólo en la bóveda');
    const direct = await withTransaction(e.pool, (client) =>
      verifyRestrictedPrivateMaterialsWithin(client, vault, []),
    );
    expect(direct.ok).toBe(false);
    expect(direct.findings).toContainEqual(expect.objectContaining({ code: 'orphan-material' }));
    expect(JSON.stringify(direct)).not.toContain(orphan.content);
    expect(JSON.stringify(direct)).not.toContain(orphan.materialId);

    const response = await e.app.inject({ method: 'GET', url: '/integridad' });
    expect(response.statusCode, response.body).toBe(200);
    const report = response.json<{
      todoBien: boolean;
      comprobaciones: { id: string; bien: boolean; detalle?: string }[];
    }>();
    expect(report.todoBien).toBe(false);
    const privateCheck = report.comprobaciones.find((check) => check.id === 'material-privado');
    expect(privateCheck).toEqual(expect.objectContaining({ bien: false }));
    expect(privateCheck?.detalle).toMatch(/orphan-material/u);
    expect(response.body).not.toContain(orphan.content);
    expect(response.body).not.toContain(orphan.materialId);
  });
});
