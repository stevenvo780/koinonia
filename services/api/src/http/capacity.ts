/** Persistencia privada de capacidad (ADR-0045). No toca el ledger ni expone sujetos ajenos. */

import type { ActualizarCapacidad, CapacidadPropia } from '@koinonia/contracts';
import type { MemberId } from '@koinonia/domain';

import {
  toBytes,
  toInt,
  toText,
  withTransaction,
  type PgClient,
  type PgPool,
  type PgPoolClient,
} from '../db/client.js';
import { lockLedgerWithin } from '../ledger/event-store.js';
import type { SubjectDataKeyEnvelope, VaultCryptoPort } from './ports.js';

export class StaleCapacityRevisionError extends Error {
  readonly code = 'STALE_CAPACITY_REVISION' as const;

  constructor() {
    super('la revisión de capacidad ya no es la vigente');
    this.name = 'StaleCapacityRevisionError';
  }
}

export class CapacityServiceUnavailableError extends Error {
  readonly code = 'CAPACITY_SERVICE_UNAVAILABLE' as const;

  constructor() {
    super('la bóveda de capacidad no está disponible');
    this.name = 'CapacityServiceUnavailableError';
  }
}

interface SubjectKeyRow {
  readonly key_ref: unknown;
  readonly wrap_nonce: unknown;
  readonly wrapped_dek: unknown;
  readonly crypto_version: unknown;
}

interface CapacityRow {
  readonly revision: unknown;
  readonly key_ref: unknown;
  readonly nonce: unknown;
  readonly ciphertext: unknown;
  readonly updated_at: unknown;
}

function keyEnvelope(row: SubjectKeyRow): SubjectDataKeyEnvelope {
  const keyRef = toText(row.key_ref, 'identity.subject_data_key.key_ref').trimEnd();
  if (!/^[0-9a-f]{32}$/u.test(keyRef)) throw new CapacityServiceUnavailableError();
  return {
    keyRef,
    wrapNonce: toBytes(row.wrap_nonce, 'identity.subject_data_key.wrap_nonce'),
    wrappedDek: toBytes(row.wrapped_dek, 'identity.subject_data_key.wrapped_dek'),
    cryptoVersion: toInt(row.crypto_version, 'identity.subject_data_key.crypto_version'),
  };
}

function instant(value: unknown): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new CapacityServiceUnavailableError();
  }
  return value.getTime();
}

/**
 * Cerrojo de lectura de la bóveda.
 *
 * Una ruta que ya validó la matrícula con `FOR SHARE` debe conservar ese modo. Intentar ascender
 * luego a `FOR UPDATE` permite el ciclo A(SHARE A) → B y B(SHARE B) → A. Dos aperturas privadas
 * son lecturas y no necesitan serializarse entre sí.
 */
export async function lockVaultSubjectForReadWithin(
  client: PgPoolClient,
  subjectId: MemberId,
): Promise<void> {
  const locked = await client.query(
    'SELECT member_id FROM identity.member WHERE member_id = $1 FOR SHARE',
    [subjectId],
  );
  if (locked.rows[0] === undefined) throw new CapacityServiceUnavailableError();
}

/** Cerrojo común de toda escritura en la bóveda; el caller toma antes el del ledger si lo usará. */
export async function lockVaultSubjectWithin(
  client: PgPoolClient,
  subjectId: MemberId,
): Promise<void> {
  const locked = await client.query(
    'SELECT member_id FROM identity.member WHERE member_id = $1 FOR UPDATE',
    [subjectId],
  );
  // La sesión ya había resuelto a esta persona. Que desaparezca entre ambas lecturas es un estado
  // transitorio/corrupto, no una oportunidad para revelar si un identificador arbitrario existe.
  if (locked.rows[0] === undefined) throw new CapacityServiceUnavailableError();
}

/** Lee el sobre de la única DSK del sujeto, nunca la DSK en claro. */
export async function readSubjectDataKeyWithin(
  client: PgClient,
  subjectId: MemberId,
): Promise<SubjectDataKeyEnvelope | undefined> {
  const { rows } = await client.query<SubjectKeyRow>(
    `SELECT key_ref, wrap_nonce, wrapped_dek, crypto_version
       FROM identity.subject_data_key
      WHERE member_id = $1`,
    [subjectId],
  );
  const row = rows[0];
  return row === undefined ? undefined : keyEnvelope(row);
}

async function readCapacityRow(
  client: PgPoolClient,
  subjectId: MemberId,
): Promise<CapacityRow | undefined> {
  const { rows } = await client.query<CapacityRow>(
    `SELECT revision, key_ref, nonce, ciphertext, updated_at
       FROM identity.contribution_capacity
      WHERE member_id = $1`,
    [subjectId],
  );
  return rows[0];
}

async function decrypt(
  vault: VaultCryptoPort,
  subjectId: MemberId,
  row: CapacityRow,
  subjectKey: SubjectDataKeyEnvelope,
): Promise<number> {
  const keyRef = toText(row.key_ref, 'identity.contribution_capacity.key_ref').trimEnd();
  if (keyRef !== subjectKey.keyRef) throw new CapacityServiceUnavailableError();
  try {
    return await vault.decryptCapacity({
      subjectId,
      revision: toInt(row.revision, 'identity.contribution_capacity.revision'),
      nonce: toBytes(row.nonce, 'identity.contribution_capacity.nonce'),
      ciphertext: toBytes(row.ciphertext, 'identity.contribution_capacity.ciphertext'),
      subjectKey,
    });
  } catch {
    // Fallo cerrado: tag, AAD, clave o versión inválidos producen el mismo error sin causa interna.
    throw new CapacityServiceUnavailableError();
  }
}

/**
 * Variante reutilizable por una operación que ya posee la transacción y el cerrojo del ledger.
 * Bloquea `identity.member`, autentica el ciphertext y conserva la transacción en manos del caller.
 */
export async function readOwnCapacityWithin(
  client: PgPoolClient,
  vault: VaultCryptoPort,
  subjectId: MemberId,
): Promise<CapacidadPropia> {
  await lockVaultSubjectForReadWithin(client, subjectId);
  if (!vault.available) throw new CapacityServiceUnavailableError();
  const row = await readCapacityRow(client, subjectId);
  if (row === undefined) return { declarada: false };
  const subjectKey = await readSubjectDataKeyWithin(client, subjectId);
  if (subjectKey === undefined) throw new CapacityServiceUnavailableError();
  return {
    declarada: true,
    revision: toInt(row.revision, 'identity.contribution_capacity.revision'),
    minutosPorSemana: await decrypt(vault, subjectId, row, subjectKey),
    updatedAt: instant(row.updated_at),
  };
}

/** Lee exclusivamente la capacidad del sujeto que ya salió de la sesión. */
export async function readOwnCapacity(
  pool: PgPool,
  vault: VaultCryptoPort,
  subjectId: MemberId,
): Promise<CapacidadPropia> {
  return await withTransaction(pool, (client) => readOwnCapacityWithin(client, vault, subjectId));
}

async function encrypt(
  vault: VaultCryptoPort,
  subjectId: MemberId,
  revision: number,
  minutosPorSemana: number,
  subjectKey: SubjectDataKeyEnvelope,
) {
  try {
    return await vault.encryptCapacity({
      subjectId,
      revision,
      minutosPorSemana,
      subjectKey,
    });
  } catch {
    throw new CapacityServiceUnavailableError();
  }
}

/** Crea la DSK sólo si el sujeto bloqueado todavía no tiene una. */
export async function ensureSubjectDataKeyWithin(
  client: PgPoolClient,
  vault: VaultCryptoPort,
  subjectId: MemberId,
): Promise<SubjectDataKeyEnvelope> {
  const existing = await readSubjectDataKeyWithin(client, subjectId);
  if (existing !== undefined) return existing;

  let created: SubjectDataKeyEnvelope;
  try {
    created = await vault.createSubjectDataKey(subjectId);
  } catch {
    throw new CapacityServiceUnavailableError();
  }
  await client.query(
    `INSERT INTO identity.subject_data_key
       (member_id, key_ref, wrap_nonce, wrapped_dek, crypto_version)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      subjectId,
      created.keyRef,
      Buffer.from(created.wrapNonce),
      Buffer.from(created.wrappedDek),
      created.cryptoVersion,
    ],
  );
  return created;
}

/**
 * CAS reutilizable dentro de la transaccion coordinada por quien llama. El caller debe tomar antes
 * el cerrojo del ledger: aceptar y bajar capacidad comparten asi un unico orden `ledger -> member`.
 */
export async function updateOwnCapacityWithin(
  client: PgPoolClient,
  vault: VaultCryptoPort,
  subjectId: MemberId,
  input: ActualizarCapacidad,
  now: number,
): Promise<CapacidadPropia> {
  await lockVaultSubjectWithin(client, subjectId);
  if (!vault.available) throw new CapacityServiceUnavailableError();
  const current = await readCapacityRow(client, subjectId);

  if (current === undefined) {
    if (input.revision !== 0) throw new StaleCapacityRevisionError();
    const subjectKey = await ensureSubjectDataKeyWithin(client, vault, subjectId);
    const revision = 1;
    const sealed = await encrypt(vault, subjectId, revision, input.minutosPorSemana, subjectKey);
    const { rows } = await client.query<{ revision: unknown; updated_at: unknown }>(
      `INSERT INTO identity.contribution_capacity
           (member_id, revision, key_ref, nonce, ciphertext, updated_at)
         VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000))
         RETURNING revision, updated_at`,
      [
        subjectId,
        revision,
        subjectKey.keyRef,
        Buffer.from(sealed.nonce),
        Buffer.from(sealed.ciphertext),
        now,
      ],
    );
    const stored = rows[0];
    if (stored === undefined) throw new CapacityServiceUnavailableError();
    return {
      declarada: true,
      revision: toInt(stored.revision, 'identity.contribution_capacity.revision'),
      minutosPorSemana: input.minutosPorSemana,
      updatedAt: instant(stored.updated_at),
    };
  }

  const currentRevision = toInt(current.revision, 'identity.contribution_capacity.revision');
  if (input.revision !== currentRevision) throw new StaleCapacityRevisionError();
  const subjectKey = await readSubjectDataKeyWithin(client, subjectId);
  if (subjectKey === undefined) throw new CapacityServiceUnavailableError();
  // Autenticar el valor anterior antes de sustituirlo detecta corrupción en vez de enterrarla.
  await decrypt(vault, subjectId, current, subjectKey);
  const revision = currentRevision + 1;
  const sealed = await encrypt(vault, subjectId, revision, input.minutosPorSemana, subjectKey);
  const { rows } = await client.query<{ revision: unknown; updated_at: unknown }>(
    `UPDATE identity.contribution_capacity
          SET revision = $2,
              nonce = $3,
              ciphertext = $4,
              updated_at = to_timestamp($5::double precision / 1000)
        WHERE member_id = $1 AND revision = $6
        RETURNING revision, updated_at`,
    [
      subjectId,
      revision,
      Buffer.from(sealed.nonce),
      Buffer.from(sealed.ciphertext),
      now,
      currentRevision,
    ],
  );
  const stored = rows[0];
  if (stored === undefined) throw new StaleCapacityRevisionError();
  return {
    declarada: true,
    revision: toInt(stored.revision, 'identity.contribution_capacity.revision'),
    minutosPorSemana: input.minutosPorSemana,
    updatedAt: instant(stored.updated_at),
  };
}

/** CAS de capacidad propia: revision cero crea; una revision positiva exacta modifica. */
export async function updateOwnCapacity(
  pool: PgPool,
  vault: VaultCryptoPort,
  subjectId: MemberId,
  input: ActualizarCapacidad,
  now: number,
): Promise<CapacidadPropia> {
  return await withTransaction(pool, async (client) => {
    await lockLedgerWithin(client);
    return await updateOwnCapacityWithin(client, vault, subjectId, input, now);
  });
}
