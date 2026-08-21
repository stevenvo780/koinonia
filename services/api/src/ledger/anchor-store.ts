/**
 * Persistencia del anclaje y el puente con el ledger.
 *
 * Dos responsabilidades y ninguna más:
 *
 *  1. Guardar los recibos **en su forma canónica exacta** (`text`, jamás `jsonb`), porque pueden ser
 *     la preimagen de la firma de un tercero.
 *  2. Escribir cada transición del anclaje como evento del agregado `#anclaje`, dentro del ledger.
 *     Eso es lo que hace que una falla de anclaje no se pueda ocultar sin alterar el ledger, que es
 *     justo lo que el anclaje detecta. Circular a propósito: escala el coste del encubrimiento.
 */

import {
  ANCHOR_AGGREGATE_ID,
  ANCHOR_AGGREGATE_TYPE,
  type AnchorEventDraft,
  type AnchorLedgerPort,
  type AnchorReceipt,
  canonicalReceipt,
  type IndependenceClass,
  parseReceipt,
  receiptHash,
} from '@koinonia/anchor';
import { toHex } from '@koinonia/crypto';

import { toBigInt, type PgClient, type PgPool } from '../db/client.js';
import { append } from './event-store.js';

/** Identificador del agregado del anclaje, para no importar `@koinonia/anchor` en cada módulo. */
export { ANCHOR_AGGREGATE_ID, ANCHOR_AGGREGATE_TYPE } from '@koinonia/anchor';

export type AnchorState = 'PENDIENTE' | 'CONFIRMADO' | 'FALLIDO';

export interface AnchorAttemptInput {
  readonly treeSize: bigint;
  readonly provider: string;
  readonly independenceClass: IndependenceClass;
  readonly state: AnchorState;
  readonly receipt?: AnchorReceipt;
  readonly error?: string;
}

/**
 * Guarda o actualiza el intento. Un `UPSERT` sobre `(tree_size, provider)`: los reintentos pisan la
 * fila, y el rastro de cada transición queda en el ledger, que es donde no se puede borrar.
 */
export async function saveAnchorAttempt(
  client: PgClient,
  input: AnchorAttemptInput,
): Promise<void> {
  const receipt = input.receipt;
  const texto = receipt === undefined ? null : canonicalReceipt(receipt);
  const hash = receipt === undefined ? null : Buffer.from(await receiptHash(receipt));

  await client.query(
    `INSERT INTO governance.anchor_attempt
       (tree_size, provider, independence_class, state, external_ref, receipt, receipt_hash, error)
     VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tree_size, provider) DO UPDATE
        SET independence_class = EXCLUDED.independence_class,
            state              = EXCLUDED.state,
            attempt_no         = governance.anchor_attempt.attempt_no + 1,
            external_ref       = EXCLUDED.external_ref,
            receipt            = EXCLUDED.receipt,
            receipt_hash       = EXCLUDED.receipt_hash,
            error              = EXCLUDED.error,
            updated_at         = clock_timestamp()`,
    [
      input.treeSize.toString(),
      input.provider,
      input.independenceClass,
      input.state,
      receipt?.externalRef ?? null,
      texto,
      hash,
      input.error ?? null,
    ],
  );
}

interface FilaRecibo {
  readonly receipt: string;
}

/** Recibos de un checkpoint, releídos y revalidados. Un recibo ilegible se rechaza, no se ignora. */
export async function readAnchorReceipts(
  client: PgClient,
  treeSize: bigint,
): Promise<readonly AnchorReceipt[]> {
  const { rows } = await client.query<FilaRecibo>(
    `SELECT receipt FROM governance.anchor_attempt
      WHERE tree_size = $1::bigint AND receipt IS NOT NULL
      ORDER BY provider ASC`,
    [treeSize.toString()],
  );
  return rows.map((fila) => parseReceipt(fila.receipt));
}

export async function saveBitcoinHeader(
  client: PgClient,
  height: number,
  header: Uint8Array,
): Promise<void> {
  if (header.length !== 80) {
    throw new RangeError(`una cabecera de bloque mide 80 B, ésta mide ${String(header.length)}`);
  }
  await client.query(
    `INSERT INTO governance.bitcoin_header (height, header) VALUES ($1::bigint, $2)
     ON CONFLICT (height) DO NOTHING`,
    [String(height), Buffer.from(header)],
  );
}

export async function countAnchorAttempts(client: PgClient, treeSize: bigint): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM governance.anchor_attempt WHERE tree_size = $1::bigint',
    [treeSize.toString()],
  );
  return Number(toBigInt(rows[0]?.n ?? '0', 'count(anchor_attempt)'));
}

/**
 * Puerto de escritura del agregado `#anclaje`.
 *
 * `requestId` se deriva del contenido del lote, no del reloj ni del azar: reintentar el mismo ciclo
 * tras un corte de red no debe escribir el mismo hecho dos veces (§3.5), y una clave aleatoria haría
 * exactamente eso.
 */
export function anchorLedgerPort(
  pool: PgPool,
  requestIdFor: (events: readonly AnchorEventDraft[]) => string,
): AnchorLedgerPort {
  return {
    async registrar(events) {
      if (events.length === 0) return;
      await append(pool, {
        aggregateId: ANCHOR_AGGREGATE_ID,
        aggregateType: ANCHOR_AGGREGATE_TYPE,
        expectedHead: { kind: 'any' },
        requestId: requestIdFor(events),
        events: events.map((draft) => ({
          eventType: draft.eventType,
          eventVersion: draft.eventVersion ?? 1,
          occurredAt: draft.occurredAt,
          payload: draft.payload,
        })),
      });
    },
  };
}

/** UUID v4 sintético derivado de un hash. Determinista, para que la idempotencia funcione. */
export function requestIdFromHash(hash: Uint8Array): string {
  const hex = toHex(hash);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}
