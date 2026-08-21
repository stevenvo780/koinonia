/**
 * Proyecciones: offset transaccional, reconstrucción y detección de desincronización (§5).
 *
 * Las proyecciones son **derivadas y desechables**. Si hay que elegir entre el ledger y una vista de
 * lectura, gana el ledger: se borra la proyección y se reconstruye desde `leaf_index = 0`. Por eso
 * su integridad no se protege con privilegios sino con reproducibilidad, y por eso los manejadores
 * tienen que ser deterministas —nada de `now()`, `random()` ni orden de iteración no estable—.
 *
 * ═══ Por qué el offset avanza en la MISMA transacción que la vista ═══
 *
 * Si «aplicar el evento» y «declarar que se aplicó» fueran dos transacciones, un fallo entre medias
 * produciría una de dos cosas: reaplicar (duplicar) o saltarse un evento (perderlo). Las dos son
 * silenciosas. Con el offset dentro de la misma transacción y CAS sobre `last_leaf`, no pueden
 * divergir.
 *
 * ═══ Por qué además hay un `running_hash` ═══
 *
 *     running_0 = 0x00…00
 *     running_i = SHA256( 0x03 ‖ running_{i-1} ‖ eventHash_i )
 *
 * `last_leaf` por sí solo no distingue *«voy atrasado»* (benigno) de *«apliqué una historia distinta
 * de la que el ledger tiene hoy»* (alarma). El plegado sí: si recomputo sobre los eventos
 * `0..last_leaf` del ledger de hoy y no coincide, la proyección se construyó sobre eventos que ya no
 * están, o que cambiaron.
 */

import { concatBytes, DOMAIN, sha256, toHex, zeroHash } from '@koinonia/crypto';

import { toBigInt, toHash32, withTransaction, type PgClient, type PgPool } from '../db/client.js';
import { readAll } from '../ledger/event-store.js';
import type { StoredEvent } from '../ledger/types.js';

/** Un manejador de proyección. Determinista y sin efectos externos irreversibles. */
export interface ProjectionHandler {
  readonly name: string;
  /** Deja la vista vacía. Se llama antes de reconstruir desde cero. */
  reset(client: PgClient): Promise<void>;
  /** Aplica un evento. Debe ser idempotente por su cuenta (`ON CONFLICT DO UPDATE`). */
  apply(client: PgClient, event: StoredEvent): Promise<void>;
}

export interface CatchUpResult {
  readonly projection: string;
  readonly applied: number;
  readonly lastLeaf: bigint;
  readonly runningHash: Uint8Array;
}

export class ProjectionConflictError extends Error {
  constructor(projection: string) {
    super(
      `otra instancia movió el offset de '${projection}' mientras ésta lo aplicaba: se descarta el ` +
        'lote entero. El offset y la vista no pueden divergir.',
    );
    this.name = 'ProjectionConflictError';
  }
}

/** El plegado del §5.2, con octeto de dominio propio para no confundirse con eslabones ni nodos. */
export async function foldRunningHash(
  running: Uint8Array,
  eventHash: Uint8Array,
): Promise<Uint8Array> {
  return sha256(concatBytes(Uint8Array.of(DOMAIN.projectionFold), running, eventHash));
}

interface TrackerRow {
  readonly last_leaf: string;
  readonly running_hash: Uint8Array;
}

async function lockTracker(client: PgClient, name: string): Promise<TrackerRow> {
  await client.query(
    `INSERT INTO projection.offset_tracker (projection) VALUES ($1)
     ON CONFLICT (projection) DO NOTHING`,
    [name],
  );
  const { rows } = await client.query<TrackerRow>(
    `SELECT last_leaf::text AS last_leaf, running_hash FROM projection.offset_tracker
      WHERE projection = $1 FOR UPDATE`,
    [name],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no existe el tracker de la proyección '${name}'`);
  return row;
}

/** Aplica todo lo pendiente. Devuelve cuántos eventos aplicó. */
export async function catchUp(
  pool: PgPool,
  handler: ProjectionHandler,
  options: { readonly batchSize?: number } = {},
): Promise<CatchUpResult> {
  return withTransaction(pool, async (client) => {
    const tracker = await lockTracker(client, handler.name);
    const lastLeaf = toBigInt(tracker.last_leaf, 'offset_tracker.last_leaf');
    let running = toHash32(tracker.running_hash, 'offset_tracker.running_hash');

    const pending = await readAll(client, {
      fromLeafIndex: lastLeaf + 1n,
      ...(options.batchSize === undefined ? {} : { limit: options.batchSize }),
    });

    let cursor = lastLeaf;
    for (const event of pending) {
      await handler.apply(client, event);
      running = await foldRunningHash(running, event.eventHash);
      cursor = event.leafIndex;
    }

    // CAS: si otra instancia movió el offset, este lote entero se descarta con la transacción.
    const updated = await client.query(
      `UPDATE projection.offset_tracker
          SET last_leaf = $1::bigint, running_hash = $2, updated_at = clock_timestamp()
        WHERE projection = $3 AND last_leaf = $4::bigint`,
      [cursor.toString(), Buffer.from(running), handler.name, lastLeaf.toString()],
    );
    if (updated.rowCount === 0) throw new ProjectionConflictError(handler.name);

    return {
      projection: handler.name,
      applied: pending.length,
      lastLeaf: cursor,
      runningHash: running,
    };
  });
}

/**
 * Reconstruye desde `leaf_index = 0`.
 *
 * Es la operación que hace desechables a las proyecciones, y la que se ejecuta cuando cambia un
 * manejador o aparece un bug. El resultado debe ser **idéntico** al de haber aplicado los eventos
 * uno a uno según llegaban: si no lo es, el manejador no es determinista, y eso es un fallo del
 * manejador, no de la reconstrucción.
 */
export async function rebuild(pool: PgPool, handler: ProjectionHandler): Promise<CatchUpResult> {
  await withTransaction(pool, async (client) => {
    await lockTracker(client, handler.name);
    await handler.reset(client);
    await client.query(
      `UPDATE projection.offset_tracker
          SET last_leaf = -1, running_hash = $1, updated_at = clock_timestamp()
        WHERE projection = $2`,
      [Buffer.from(zeroHash()), handler.name],
    );
  });
  return catchUp(pool, handler);
}

export interface ProjectionStatus {
  readonly projection: string;
  readonly lastLeaf: bigint;
  /**
   * `max(leaf_index) - last_leaf`. Señal 1 del §5.4: retraso.
   *
   * **Negativo es alarma, no retraso**: significa que la proyección aplicó eventos que el ledger ya
   * no tiene, es decir, que a la historia le cortaron la cola después de servirla.
   */
  readonly lag: bigint;
  /** Señal 2: ¿el plegado sobre el rango ya aplicado coincide con el ledger de hoy? */
  readonly foldMatches: boolean;
  /**
   * Señal 3: el log es denso Y llega hasta donde el cursor dice que llega. Si falla, **faltan
   * eventos**; no es un problema de la proyección.
   */
  readonly ledgerContiguous: boolean;
  readonly storedRunningHash: string;
  readonly recomputedRunningHash: string;
}

/**
 * Las tres señales baratas del §5.4.
 *
 * Si (1) o (2) fallan, la interfaz muestra la vista como *posiblemente desactualizada* en lugar de
 * mentir con datos viejos presentados como frescos. Si (3) falla, no es un incidente técnico: es la
 * señal que todo este diseño existe para dar, y va a estado de alarma pública.
 */
export async function projectionStatus(client: PgClient, name: string): Promise<ProjectionStatus> {
  const { rows } = await client.query<TrackerRow>(
    `SELECT last_leaf::text AS last_leaf, running_hash FROM projection.offset_tracker
      WHERE projection = $1`,
    [name],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`la proyección '${name}' no tiene tracker`);
  const lastLeaf = toBigInt(row.last_leaf, 'offset_tracker.last_leaf');
  const stored = toHash32(row.running_hash, 'offset_tracker.running_hash');

  // En una sola consulta: bajo READ COMMITTED es una foto consistente y un append en vuelo no
  // puede producir un falso positivo.
  const counts = await client.query<{
    total: string;
    max_leaf: string | null;
    next_leaf: string;
  }>(
    `SELECT (SELECT count(*)        FROM governance.event)::text          AS total,
            (SELECT max(leaf_index) FROM governance.event)::text          AS max_leaf,
            (SELECT next_leaf_index FROM governance.ledger_cursor)::text  AS next_leaf`,
  );
  const total = toBigInt(counts.rows[0]?.total ?? '0', 'count(event)');
  const nextLeaf = toBigInt(counts.rows[0]?.next_leaf ?? '0', 'ledger_cursor.next_leaf_index');
  const maxLeafRaw = counts.rows[0]?.max_leaf ?? null;
  const maxLeaf = maxLeafRaw === null ? -1n : toBigInt(maxLeafRaw, 'max(leaf_index)');

  let recomputed = zeroHash();
  if (lastLeaf >= 0n) {
    const applied = await readAll(client, { fromLeafIndex: 0n, toLeafIndex: lastLeaf });
    for (const event of applied) recomputed = await foldRunningHash(recomputed, event.eventHash);
  }

  return {
    projection: name,
    lastLeaf,
    lag: maxLeaf - lastLeaf,
    foldMatches: toHex(recomputed) === toHex(stored),
    // `total === maxLeaf + 1` sólo caza los borrados INTERIORES: cortar la cola baja las dos cifras
    // a la vez y la igualdad se mantiene. El cursor es lo que no miente sobre cuántos índices se
    // llegaron a repartir.
    ledgerContiguous:
      (maxLeafRaw === null ? total === 0n : total === maxLeaf + 1n) && nextLeaf === maxLeaf + 1n,
    storedRunningHash: toHex(stored),
    recomputedRunningHash: toHex(recomputed),
  };
}
