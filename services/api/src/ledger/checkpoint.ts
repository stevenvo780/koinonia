/**
 * Checkpoints Merkle (§6).
 *
 * La **ventana de anclaje es la ventana de alterabilidad**: todo lo ocurrido desde la última raíz
 * anclada puede reescribirse sin contradecir nada externo. Por eso la cadencia no es un parámetro de
 * rendimiento, es la definición de la garantía.
 *
 * Dos detalles que no son detalles:
 *
 *  - El checkpointer toma **el mismo advisory lock** que el append durante los milisegundos que
 *    tarda en fijar el corte. Sin eso, un lector puede ver el `leaf_index` 4712 confirmado mientras
 *    el 4711 sigue en vuelo —reservado pero no *commiteado*— y creer que hay un hueco. Con el
 *    cerrojo tomado no hay appends en vuelo y todo lo que ve es denso y definitivo.
 *  - Cada checkpoint se escribe también como evento `CheckpointEmitido` en la espina, y ese evento
 *    cae en `leaf_index = treeSize`, es decir, **dentro del siguiente checkpoint**. El log se
 *    compromete recursivamente con su propia historia de publicaciones: retirar un checkpoint del
 *    sitio web deja de ser suficiente, hay que sacarlo también del log, y eso rompe la espina.
 */

import {
  canonicalizeToBytes,
  concatBytes,
  DOMAIN,
  fromHex,
  type JsonObject,
  merkleRoot,
  sha256,
  SPINE_AGGREGATE_ID,
  SPINE_AGGREGATE_TYPE,
  toHex,
} from '@koinonia/crypto';

import {
  toBigInt,
  toBytesOrUndefined,
  toHash32,
  withTransaction,
  type PgClient,
  type PgPool,
} from '../db/client.js';
import { appendWithin, LEDGER_WRITE_LOCK, readAllHeads } from './event-store.js';
import { CHECKPOINT_EMITTED } from './types.js';

export interface Checkpoint {
  readonly treeSize: bigint;
  readonly rootHash: Uint8Array;
  readonly headsRoot: Uint8Array;
  readonly prevCheckpoint: Uint8Array | undefined;
  readonly issuedAt: string;
  readonly checkpointHash: Uint8Array;
  readonly firm: boolean;
}

/**
 * Objeto canónico del checkpoint.
 *
 * ═══ Regla del primer checkpoint ═══
 *
 * Si no hay checkpoint previo, la clave `prevCheckpoint` se **OMITE**. No se emite `null`, no se
 * emite cadena vacía, no se emite un centinela de 64 ceros. El objeto del primer checkpoint tiene
 * **cuatro** claves; el de todos los demás, cinco.
 *
 * La spec dejaba esto indefinido, y dos implementaciones honestas producían dos hashes distintos
 * para el mismo checkpoint —justamente para el que ancla el origen de la vigencia—. La regla ya
 * existía en §1.3.d («la ausencia se expresa omitiendo la clave»); sólo faltaba aplicarla aquí.
 */
export function checkpointPreimage(input: {
  readonly treeSize: bigint;
  readonly rootHash: Uint8Array;
  readonly headsRoot: Uint8Array;
  readonly prevCheckpoint: Uint8Array | undefined;
  readonly issuedAt: string;
}): JsonObject {
  const treeSize = Number(input.treeSize);
  if (!Number.isSafeInteger(treeSize)) {
    throw new RangeError(
      'treeSize fuera del rango entero seguro: el perfil canónico lo rechazaría',
    );
  }
  return {
    treeSize,
    rootHash: toHex(input.rootHash),
    headsRoot: toHex(input.headsRoot),
    ...(input.prevCheckpoint === undefined ? {} : { prevCheckpoint: toHex(input.prevCheckpoint) }),
    issuedAt: input.issuedAt,
  };
}

/** `checkpoint_hash = SHA256( 0x04 ‖ JCS_utf8({treeSize, rootHash, headsRoot, prevCheckpoint?, issuedAt}) )`. */
export async function computeCheckpointHash(preimage: JsonObject): Promise<Uint8Array> {
  return sha256(concatBytes(Uint8Array.of(DOMAIN.checkpoint), canonicalizeToBytes(preimage)));
}

/**
 * `headsRoot`: segundo árbol de Merkle sobre las **entradas**
 * `aggregate_id(16B) ‖ seq(int64 BE) ‖ head_hash(32B)`, ordenadas por `aggregate_id`.
 *
 * Ordenar la cadena de 32 hex y ordenar los 16 bytes dan el mismo orden —`0`–`9` y `a`–`f` son
 * crecientes en ASCII y no se solapan—, así que el `ORDER BY aggregate_id` de SQL y el ordenamiento
 * binario del verificador no pueden divergir. Aquí el orden por identificador sí corresponde: es un
 * conjunto, no una historia.
 */
export async function computeHeadsRoot(client: PgClient): Promise<Uint8Array> {
  const heads = await readAllHeads(client);
  const entries = heads.map((head) => {
    const seq = new Uint8Array(8);
    new DataView(seq.buffer).setBigInt64(0, BigInt(head.seq), false); // big endian
    return concatBytes(fromHex(head.aggregateId), seq, head.hash);
  });
  return merkleRoot(entries);
}

interface CheckpointRow {
  readonly tree_size: string;
  readonly root_hash: Uint8Array;
  readonly heads_root: Uint8Array;
  readonly prev_checkpoint: Uint8Array | null;
  readonly issued_at: string;
  readonly checkpoint_hash: Uint8Array;
  readonly firm: boolean;
}

function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    treeSize: toBigInt(row.tree_size, 'checkpoint.tree_size'),
    rootHash: toHash32(row.root_hash, 'checkpoint.root_hash'),
    headsRoot: toHash32(row.heads_root, 'checkpoint.heads_root'),
    prevCheckpoint: toBytesOrUndefined(row.prev_checkpoint, 'checkpoint.prev_checkpoint'),
    issuedAt: row.issued_at,
    checkpointHash: toHash32(row.checkpoint_hash, 'checkpoint.checkpoint_hash'),
    firm: row.firm,
  };
}

export async function latestCheckpoint(client: PgClient): Promise<Checkpoint | undefined> {
  const { rows } = await client.query<CheckpointRow>(
    `SELECT tree_size::text AS tree_size, root_hash, heads_root, prev_checkpoint,
            issued_at, checkpoint_hash, firm
       FROM governance.checkpoint ORDER BY tree_size DESC LIMIT 1`,
  );
  const row = rows[0];
  return row === undefined ? undefined : rowToCheckpoint(row);
}

export interface EmitCheckpointInput {
  readonly issuedAt: string;
  readonly requestId: string;
  readonly firm?: boolean;
}

/**
 * Fija el corte, calcula las dos raíces, escribe el checkpoint y lo registra en la espina.
 * Todo bajo el cerrojo de escritura y en una sola transacción.
 */
export async function emitCheckpoint(
  pool: PgPool,
  input: EmitCheckpointInput,
): Promise<Checkpoint> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [LEDGER_WRITE_LOCK]);

    const cut = await client.query<{ total: string; max_leaf: string | null }>(
      'SELECT count(*)::text AS total, max(leaf_index)::text AS max_leaf FROM governance.event',
    );
    const row = cut.rows[0];
    const treeSize = toBigInt(row?.total ?? '0', 'count(event)');
    const maxLeaf = row?.max_leaf ?? null;
    if (maxLeaf !== null && toBigInt(maxLeaf, 'max(leaf_index)') !== treeSize - 1n) {
      throw new Error(
        'el log no es denso en el momento del corte: hay huecos en leaf_index. No se emite un ' +
          'checkpoint sobre una historia que ya está denunciada (§5.4.3).',
      );
    }

    const entries = await client.query<{ event_hash: Uint8Array }>(
      'SELECT event_hash FROM governance.event ORDER BY leaf_index ASC',
    );
    const rootHash = await merkleRoot(
      entries.rows.map((e) => toHash32(e.event_hash, 'event.event_hash')),
    );
    const headsRoot = await computeHeadsRoot(client);

    const previous = await latestCheckpoint(client);
    const preimage = checkpointPreimage({
      treeSize,
      rootHash,
      headsRoot,
      prevCheckpoint: previous?.checkpointHash,
      issuedAt: input.issuedAt,
    });
    const checkpointHash = await computeCheckpointHash(preimage);

    await client.query(
      `INSERT INTO governance.checkpoint
         (tree_size, root_hash, heads_root, prev_checkpoint, issued_at, checkpoint_hash, firm)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7)`,
      [
        treeSize.toString(),
        Buffer.from(rootHash),
        Buffer.from(headsRoot),
        previous === undefined ? null : Buffer.from(previous.checkpointHash),
        input.issuedAt,
        Buffer.from(checkpointHash),
        input.firm ?? false,
      ],
    );

    // Auto-registro: cae en `leaf_index = treeSize` y por tanto dentro del siguiente checkpoint.
    await appendWithin(client, {
      aggregateId: SPINE_AGGREGATE_ID,
      aggregateType: SPINE_AGGREGATE_TYPE,
      expectedHead: { kind: 'any' },
      requestId: input.requestId,
      events: [
        {
          eventType: CHECKPOINT_EMITTED,
          occurredAt: input.issuedAt,
          payload: {
            treeSize: Number(treeSize),
            rootHash: toHex(rootHash),
            checkpointHash: toHex(checkpointHash),
          },
        },
      ],
    });

    return {
      treeSize,
      rootHash,
      headsRoot,
      prevCheckpoint: previous?.checkpointHash,
      issuedAt: input.issuedAt,
      checkpointHash,
      firm: input.firm ?? false,
    };
  });
}
