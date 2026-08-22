/**
 * `EventStore` — el append seguro del ledger (§3).
 *
 * ═══ Las tres piezas y por qué las tres ═══
 *
 *  1. **Advisory lock** (`pg_advisory_xact_lock`): orden total de escrituras, sin tormenta de
 *     reintentos. Se libera solo al terminar la transacción, así que no hay fugas si el proceso
 *     muere. Los lectores no lo toman: no bloquea la web.
 *  2. **CAS optimista** sobre `aggregate_head`: red de seguridad **independiente** del lock. No
 *     cuesta nada y protege si alguien introduce una ruta de escritura que se olvida del cerrojo.
 *  3. **Reserva densa** del `leaf_index` con `UPDATE … RETURNING` dentro de la transacción, para que
 *     un `ROLLBACK` la revierta y no queden huecos (§3.2).
 *
 * ═══ El doble vínculo con la espina ═══
 *
 * Una cadena por agregado detecta la modificación y el borrado parcial, y es **completamente inútil**
 * contra `DELETE FROM event WHERE aggregate_id = '…'`: los 40 eventos de la propuesta incómoda se van
 * juntos con la cadena que los unía, ninguna otra cadena se rompe, y un verificador ingenuo da verde.
 *
 * Por eso el nacimiento de un agregado son **dos escrituras en una sola transacción**: el génesis del
 * agregado cuelga hacia atrás de la cabeza de la espina, y la espina registra hacia adelante un
 * `AgregadoAbierto` con el `genesisHash` del recién nacido. Borrar el agregado deja ese puntero
 * colgando; borrar también el puntero rompe la cadena lineal de la espina; rehacer la espina cambia
 * el `prevHash` génesis de todos los agregados nacidos después, en cascada, y contradice cada raíz
 * ya anclada. La espina no impide el borrado: impide que sea silencioso.
 */

import {
  assertCanonicalEvent,
  type CanonicalEvent,
  canonicalize,
  hashEvent,
  type JsonObject,
  LEDGER_PROFILE,
  parseCanonical,
  SPINE_AGGREGATE_ID,
  SPINE_AGGREGATE_TYPE,
  toHex,
  zeroHash,
} from '@koinonia/crypto';
import type pg from 'pg';

import {
  backoff,
  isRetryable,
  type PgClient,
  type PgPool,
  pgError,
  toBigInt,
  toBytesOrUndefined,
  toFixedChar,
  toHash32,
  toInt,
  toText,
  withTransaction,
} from '../db/client.js';
import {
  AGGREGATE_OPENED,
  type AggregateHead,
  type AppendCommand,
  type AppendedEvent,
  type AppendResult,
  HeadConflictError,
  IdempotencyConflictError,
  LEDGER_OPENED,
  LedgerAppendError,
  type LedgerEventDraft,
  SpineMissingError,
  type StoredEvent,
} from './types.js';

/**
 * Clave del cerrojo de escritura del ledger (§3.3). Es una constante compartida por TODA ruta que
 * escriba en `governance.event`, incluido el checkpointer: si dos rutas usaran claves distintas, el
 * orden total dejaría de serlo y la densidad del `leaf_index` sería una coincidencia.
 */
export const LEDGER_WRITE_LOCK = '7311064281559162001';

/**
 * Toma el cerrojo global del ledger dentro de una transaccion ya abierta.
 *
 * Es deliberadamente publica: las operaciones que coordinan mas de un agregado deben inmovilizar
 * el corte antes de leer cualquiera de ellos. PostgreSQL hace este cerrojo reentrante dentro de la
 * misma transaccion, por lo que los `appendWithin` posteriores conservan el mismo orden total.
 */
export async function lockLedgerWithin(client: pg.PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [LEDGER_WRITE_LOCK]);
}

const MAX_ATTEMPTS = 5;
const REQUEST_SCOPE = /^[a-z0-9:._-]{1,80}$/u;

function normalizedRequestScope(scope: string | undefined): string {
  const value = scope ?? 'public';
  if (!REQUEST_SCOPE.test(value)) {
    throw new LedgerAppendError('requestScope debe tener entre 1 y 80 caracteres [a-z0-9:._-]');
  }
  return value;
}

interface EventRow {
  readonly leaf_index: string;
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly seq: number;
  readonly event_type: string;
  readonly event_version: number;
  readonly occurred_at: string;
  readonly actor: string | null;
  readonly payload: string;
  readonly prev_hash: Uint8Array;
  readonly event_hash: Uint8Array;
  readonly spine_hash: Uint8Array | null;
  readonly request_id: string;
}

interface HeadRow {
  readonly aggregate_id: string;
  readonly aggregate_type: string;
  readonly seq: number;
  readonly head_hash: Uint8Array;
}

const SELECT_EVENT_COLUMNS = `leaf_index, aggregate_id, aggregate_type, seq, event_type,
  event_version, occurred_at, actor, payload, prev_hash, event_hash, spine_hash, request_id`;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Reconstruye el objeto canónico desde las columnas.
 *
 * Aquí es donde la regla de tipos del §1.1-bis se paga o se cobra. Cada campo se lee de una columna
 * cuyo tipo **no normaliza** su representación, así que lo que sale es byte a byte lo que entró:
 *
 *  - `aggregate_id`/`actor` de `char(32)`, no de `uuid` (que devolvería la forma con guiones);
 *  - `occurred_at` de `char(24)`, no de `timestamptz` (que devolvería `2026-08-21 14:03:07.1+00`);
 *  - `payload` de `text` con la forma canónica exacta, no de `jsonb` (que reordena las claves).
 *
 * `parseCanonical` no se limita a parsear: **exige** que el texto sea exactamente su propia forma
 * canónica JCS. Si la base hubiera reordenado una clave, metido un espacio o colapsado un duplicado,
 * falla aquí y no dentro de un hash que ya no cuadra.
 */
export function rowToStoredEvent(row: EventRow): StoredEvent {
  const payloadText = toText(row.payload, 'event.payload');
  const payload = parseCanonical(payloadText, LEDGER_PROFILE);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new LedgerAppendError(`event.payload no es un objeto JSON: leaf_index=${row.leaf_index}`);
  }

  const actor = row.actor === null ? undefined : toFixedChar(row.actor, 32, 'event.actor');
  const event: CanonicalEvent = {
    aggregateId: toFixedChar(row.aggregate_id, 32, 'event.aggregate_id'),
    aggregateType: toText(row.aggregate_type, 'event.aggregate_type'),
    seq: toInt(row.seq, 'event.seq'),
    eventType: toText(row.event_type, 'event.event_type'),
    eventVersion: toInt(row.event_version, 'event.event_version'),
    occurredAt: toFixedChar(row.occurred_at, 24, 'event.occurred_at'),
    // `actor` se OMITE cuando es NULL. El NULL de SQL y el null de JSON no son el mismo valor, y
    // `{"actor":null}` y `{}` producen hashes distintos (§1.3.d).
    ...(actor === undefined ? {} : { actor }),
    payload: payload as JsonObject,
  };
  assertCanonicalEvent(event);

  return {
    leafIndex: toBigInt(row.leaf_index, 'event.leaf_index'),
    event,
    payloadText,
    prevHash: toHash32(row.prev_hash, 'event.prev_hash'),
    eventHash: toHash32(row.event_hash, 'event.event_hash'),
    spineHash: toBytesOrUndefined(row.spine_hash, 'event.spine_hash'),
    requestId: toText(row.request_id, 'event.request_id'),
  };
}

/** Todos los eventos de un agregado, en orden de `seq`. */
export async function readStream(
  client: PgClient,
  aggregateId: string,
): Promise<readonly StoredEvent[]> {
  const { rows } = await client.query<EventRow>(
    `SELECT ${SELECT_EVENT_COLUMNS} FROM governance.event
      WHERE aggregate_id = $1 ORDER BY seq ASC`,
    [aggregateId],
  );
  return rows.map(rowToStoredEvent);
}

export interface ReadAllOptions {
  readonly fromLeafIndex?: bigint;
  readonly toLeafIndex?: bigint;
  readonly limit?: number;
}

/**
 * El log global en orden de `leaf_index`. Es el orden del árbol de Merkle: el orden **es** la
 * afirmación histórica (§6.2), así que aquí no hay ninguna otra ordenación admisible.
 */
export async function readAll(
  client: PgClient,
  options: ReadAllOptions = {},
): Promise<readonly StoredEvent[]> {
  const from = options.fromLeafIndex ?? 0n;
  const to = options.toLeafIndex;
  const { rows } = await client.query<EventRow>(
    `SELECT ${SELECT_EVENT_COLUMNS} FROM governance.event
      WHERE leaf_index >= $1 AND ($2::bigint IS NULL OR leaf_index <= $2::bigint)
      ORDER BY leaf_index ASC
      LIMIT $3::bigint`,
    [from.toString(), to === undefined ? null : to.toString(), options.limit ?? null],
  );
  return rows.map(rowToStoredEvent);
}

export async function readHead(
  client: PgClient,
  aggregateId: string,
): Promise<AggregateHead | undefined> {
  const { rows } = await client.query<HeadRow>(
    `SELECT aggregate_id, aggregate_type, seq, head_hash
       FROM governance.aggregate_head WHERE aggregate_id = $1`,
    [aggregateId],
  );
  const row = rows[0];
  return row === undefined ? undefined : headFromRow(row);
}

/** Todas las cabezas, ordenadas por `aggregate_id`: el orden del `headsRoot` del checkpoint (§6.4). */
export async function readAllHeads(client: PgClient): Promise<readonly AggregateHead[]> {
  const { rows } = await client.query<HeadRow>(
    `SELECT aggregate_id, aggregate_type, seq, head_hash
       FROM governance.aggregate_head ORDER BY aggregate_id ASC`,
  );
  return rows.map(headFromRow);
}

function headFromRow(row: HeadRow): AggregateHead {
  return {
    aggregateId: toFixedChar(row.aggregate_id, 32, 'aggregate_head.aggregate_id'),
    aggregateType: toText(row.aggregate_type, 'aggregate_head.aggregate_type'),
    seq: toInt(row.seq, 'aggregate_head.seq'),
    hash: toHash32(row.head_hash, 'aggregate_head.head_hash'),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escritura
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Crea el génesis de la espina si no existe. Idempotente.
 *
 * Es el único evento del sistema con `prevHash = 0x00…00`. Su hash se publica y se ancla
 * externamente el día de la puesta en marcha: es la raíz de confianza, y cabe en un tuit.
 */
export async function ensureSpine(
  pool: PgPool,
  input: { readonly occurredAt: string; readonly payload: JsonObject; readonly requestId: string },
): Promise<AppendedEvent> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [LEDGER_WRITE_LOCK]);

    const existing = await client.query<EventRow>(
      `SELECT ${SELECT_EVENT_COLUMNS} FROM governance.event
        WHERE aggregate_id = $1 AND seq = 0`,
      [SPINE_AGGREGATE_ID],
    );
    const found = existing.rows[0];
    if (found !== undefined) {
      const stored = rowToStoredEvent(found);
      return {
        leafIndex: stored.leafIndex,
        event: stored.event,
        payloadText: stored.payloadText,
        prevHash: stored.prevHash,
        eventHash: stored.eventHash,
      };
    }

    const event: CanonicalEvent = {
      aggregateId: SPINE_AGGREGATE_ID,
      aggregateType: SPINE_AGGREGATE_TYPE,
      seq: 0,
      eventType: LEDGER_OPENED,
      eventVersion: 1,
      occurredAt: input.occurredAt,
      payload: input.payload,
    };
    assertCanonicalEvent(event);

    const prevHash = zeroHash();
    const eventHash = await hashEvent(prevHash, event);
    const leafIndex = await reserveLeafIndices(client, 1);

    await insertEvents(client, [
      {
        leafIndex,
        event,
        payloadText: canonicalize(event.payload, LEDGER_PROFILE),
        prevHash,
        eventHash,
        spineHash: undefined,
        requestId: input.requestId,
      },
    ]);

    await client.query(
      `INSERT INTO governance.aggregate_head (aggregate_id, aggregate_type, seq, head_hash)
       VALUES ($1, $2, 0, $3)`,
      [SPINE_AGGREGATE_ID, SPINE_AGGREGATE_TYPE, Buffer.from(eventHash)],
    );

    return {
      leafIndex,
      event,
      payloadText: canonicalize(event.payload, LEDGER_PROFILE),
      prevHash,
      eventHash,
    };
  });
}

/**
 * Añade un lote de eventos a un agregado, con CAS optimista y reintentos acotados.
 *
 * Un lote es atómico: se escriben todos o ninguno. Y si el agregado nace, en el mismo commit se
 * escribe el `AgregadoAbierto` de la espina.
 */
export async function append(
  pool: PgPool,
  command: AppendCommand,
  options: { readonly maxAttempts?: number; readonly random?: () => number } = {},
): Promise<AppendResult> {
  if (command.events.length === 0) {
    throw new LedgerAppendError('un append sin eventos no es un append');
  }
  normalizedRequestScope(command.requestScope);
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  // No es `Math.random` por capricho: el jitter debe ser inyectable para que la prueba de
  // concurrencia sea determinista cuando quiera serlo.
  const random = options.random ?? (() => 0.5);

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await withTransaction(pool, (client) => attemptAppend(client, command));
    } catch (error) {
      lastError = error;
      // Un conflicto de cabeza con expectativa EXPLÍCITA es una respuesta del dominio, no un
      // problema de infraestructura: reintentarlo escribiría sobre un estado que el llamante nunca
      // vio. Sólo `'any'` —que no afirma nada del estado previo— se reintenta.
      const retryableConflict =
        error instanceof HeadConflictError && command.expectedHead.kind === 'any';
      if ((retryableConflict || isRetryable(error)) && attempt < maxAttempts - 1) {
        await backoff(attempt, random);
        continue;
      }
      if (hasIdempotencyCollision(error)) {
        const replay = await readIdempotentResult(pool, command.requestId, command.requestScope);
        if (replay !== undefined) {
          assertIdempotentCommand(command, replay);
          return replay;
        }
      }
      throw error;
    }
  }
  throw new LedgerAppendError(
    `append agotó ${String(maxAttempts)} intentos sobre ${command.aggregateId}`,
    { cause: lastError },
  );
}

function hasIdempotencyCollision(error: unknown): boolean {
  const info = pgError(error);
  return info?.code === '23505' && info.constraint === 'append_request_pkey';
}

/**
 * Append dentro de una transacción **ya abierta** por el llamante.
 *
 * Existe para el checkpointer (§6.4): el evento `CheckpointEmitido` tiene que caer exactamente en
 * `leaf_index = treeSize`, y eso sólo se garantiza escribiéndolo sin soltar el cerrojo con el que se
 * fijó el corte. `pg_advisory_xact_lock` es reentrante dentro de la misma transacción, así que
 * volver a tomarlo aquí no bloquea.
 */
export async function appendWithin(
  client: pg.PoolClient,
  command: AppendCommand,
): Promise<AppendResult> {
  if (command.events.length === 0) {
    throw new LedgerAppendError('un append sin eventos no es un append');
  }
  normalizedRequestScope(command.requestScope);
  return attemptAppend(client, command);
}

async function attemptAppend(client: pg.PoolClient, command: AppendCommand): Promise<AppendResult> {
  const requestScope = normalizedRequestScope(command.requestScope);
  // (1) Cerrojo de escritura del ledger. Orden total; se libera al terminar la transacción.
  await lockLedgerWithin(client);

  // (2) Idempotencia (§3.5). Bajo el cerrojo no hay carrera entre esta lectura y la escritura final.
  const replay = await readAppendRequestWithin(client, command.requestId, requestScope);
  if (replay !== undefined) {
    assertIdempotentCommand(command, replay);
    return replay;
  }

  // (3) Cabeza del agregado y cabeza de la espina, en una sola consulta.
  const { rows } = await client.query<HeadRow>(
    `SELECT aggregate_id, aggregate_type, seq, head_hash
       FROM governance.aggregate_head WHERE aggregate_id = $1 OR aggregate_id = $2`,
    [command.aggregateId, SPINE_AGGREGATE_ID],
  );
  const heads = new Map(rows.map((row) => [row.aggregate_id.trimEnd(), headFromRow(row)]));
  const spineHead = heads.get(SPINE_AGGREGATE_ID);
  if (spineHead === undefined) throw new SpineMissingError();

  const isSpineItself = command.aggregateId === SPINE_AGGREGATE_ID;
  const current = heads.get(command.aggregateId);
  const isGenesis = current === undefined;

  assertExpectation(command, current);

  // (4) Reserva densa: N del agregado, más 1 para el `AgregadoAbierto` de la espina si nace.
  const needsSpineEvent = isGenesis && !isSpineItself;
  const reserved = command.events.length + (needsSpineEvent ? 1 : 0);
  const firstLeafIndex = await reserveLeafIndices(client, reserved);

  // (5) Hashes, en memoria. El `prevHash` del génesis es la cabeza de la espina: NINGÚN agregado
  //     nace con ceros salvo la propia espina (§2.3).
  const spineAnchor = spineHead.hash;
  let prevHash = isGenesis ? spineAnchor : current.hash;
  const baseSeq = isGenesis ? 0 : current.seq + 1;

  const pending: PendingRow[] = [];
  for (let i = 0; i < command.events.length; i++) {
    const draft = command.events[i];
    if (draft === undefined) continue;
    const seq = baseSeq + i;
    const event = buildCanonicalEvent(command.aggregateId, command.aggregateType, seq, draft);
    const eventHash = await hashEvent(prevHash, event);
    pending.push({
      leafIndex: firstLeafIndex + BigInt(i),
      event,
      payloadText: canonicalize(event.payload, LEDGER_PROFILE),
      prevHash,
      eventHash,
      // El `spine_hash` sólo lo lleva el génesis, y su valor ES su `prev_hash`: el DDL lo exige con
      // `event_genesis_link_ck` y la clave foránea `event_spine_fk` garantiza que apunta a un
      // evento que existe de verdad.
      spineHash: seq === 0 && !isSpineItself ? spineAnchor : undefined,
      requestId: command.requestId,
    });
    prevHash = eventHash;
  }

  const genesisHash = pending[0]?.eventHash;
  let spineEvent: PendingRow | undefined;
  if (needsSpineEvent) {
    if (genesisHash === undefined) throw new LedgerAppendError('lote sin génesis: imposible');
    // Vínculo hacia adelante. Comparte padre con el génesis del agregado: los dos cuelgan de
    // `H_espina`, y sólo el de la espina menciona al otro. No hay circularidad.
    const event = buildCanonicalEvent(SPINE_AGGREGATE_ID, SPINE_AGGREGATE_TYPE, spineHead.seq + 1, {
      eventType: AGGREGATE_OPENED,
      occurredAt: command.events[0]?.occurredAt ?? '',
      payload: {
        aggregateId: command.aggregateId,
        aggregateType: command.aggregateType,
        genesisHash: toHex(genesisHash),
      },
    });
    spineEvent = {
      leafIndex: firstLeafIndex + BigInt(command.events.length),
      event,
      payloadText: canonicalize(event.payload, LEDGER_PROFILE),
      prevHash: spineAnchor,
      eventHash: await hashEvent(spineAnchor, event),
      spineHash: undefined,
      requestId: command.requestId,
    };
    pending.push(spineEvent);
  }

  // (6) Inserción del lote.
  await insertEvents(client, pending);

  // (7) CAS sobre la cabeza. Es la red independiente del cerrojo: si alguien añadiera una ruta de
  //     escritura que se olvida del advisory lock, esto sigue impidiendo la bifurcación.
  const newHead: AggregateHead = {
    aggregateId: command.aggregateId,
    aggregateType: command.aggregateType,
    seq: baseSeq + command.events.length - 1,
    hash: prevHash,
  };
  if (isGenesis) {
    const inserted = await client.query(
      `INSERT INTO governance.aggregate_head (aggregate_id, aggregate_type, seq, head_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (aggregate_id) DO NOTHING`,
      [newHead.aggregateId, newHead.aggregateType, newHead.seq, Buffer.from(newHead.hash)],
    );
    if (inserted.rowCount === 0) {
      throw new HeadConflictError(command.aggregateId, 'agregado inexistente', 'ya existía');
    }
  } else {
    const updated = await client.query(
      `UPDATE governance.aggregate_head
          SET seq = $1, head_hash = $2, updated_at = clock_timestamp()
        WHERE aggregate_id = $3 AND seq = $4 AND head_hash = $5`,
      [
        newHead.seq,
        Buffer.from(newHead.hash),
        command.aggregateId,
        current.seq,
        Buffer.from(current.hash),
      ],
    );
    if (updated.rowCount === 0) {
      throw new HeadConflictError(
        command.aggregateId,
        `seq=${String(current.seq)} hash=${toHex(current.hash)}`,
        'otro escritor la movió',
      );
    }
  }

  if (spineEvent !== undefined) {
    const movedSpine = await client.query(
      `UPDATE governance.aggregate_head
          SET seq = $1, head_hash = $2, updated_at = clock_timestamp()
        WHERE aggregate_id = $3 AND seq = $4 AND head_hash = $5`,
      [
        spineEvent.event.seq,
        Buffer.from(spineEvent.eventHash),
        SPINE_AGGREGATE_ID,
        spineHead.seq,
        Buffer.from(spineHead.hash),
      ],
    );
    if (movedSpine.rowCount === 0) {
      throw new HeadConflictError(SPINE_AGGREGATE_ID, `seq=${String(spineHead.seq)}`, 'movida');
    }
  }

  // (8) Sello de idempotencia. Va al final: sólo se declara ejecutado lo que de verdad se escribió,
  //     y como comparte transacción con el lote, «pasó» y «consta que pasó» no pueden divergir.
  await client.query(
    `INSERT INTO governance.append_request
       (request_scope, request_id, aggregate_id, first_leaf_index, event_count, head_seq, head_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      requestScope,
      command.requestId,
      command.aggregateId,
      firstLeafIndex.toString(),
      command.events.length,
      newHead.seq,
      Buffer.from(newHead.hash),
    ],
  );

  return {
    aggregateId: command.aggregateId,
    firstLeafIndex,
    events: pending
      .filter((row) => row !== spineEvent)
      .map(({ leafIndex, event, payloadText, prevHash: p, eventHash }) => ({
        leafIndex,
        event,
        payloadText,
        prevHash: p,
        eventHash,
      })),
    head: newHead,
    spineEvent:
      spineEvent === undefined
        ? undefined
        : {
            leafIndex: spineEvent.leafIndex,
            event: spineEvent.event,
            payloadText: spineEvent.payloadText,
            prevHash: spineEvent.prevHash,
            eventHash: spineEvent.eventHash,
          },
    idempotentReplay: false,
  };
}

/**
 * Una clave no identifica una intención por sí sola: es sólo la etiqueta que el cliente vuelve a
 * mandar si perdió la respuesta. Por eso un replay es seguro únicamente si vuelve a describir el
 * MISMO lote ya sellado. Comparar sólo el agregado convertía cualquier segunda orden con la misma
 * clave (por ejemplo una papeleta usada como el cierre) en un no-op silencioso.
 *
 * `expectedHead` se deja fuera de la comparación deliberadamente. Un reintento legítimo conserva
 * la intención aunque su expectativa ya haya quedado obsoleta por el primer commit; la identidad
 * del comando es su agregado, tipo y preimagen efectiva de cada evento.
 */
function assertIdempotentCommand(command: AppendCommand, replay: AppendResult): void {
  if (replay.aggregateId !== command.aggregateId) {
    throw new IdempotencyConflictError(
      command.requestId,
      `ya pertenece al agregado ${replay.aggregateId}, no a ${command.aggregateId}`,
    );
  }
  if (replay.head.aggregateType !== command.aggregateType) {
    throw new IdempotencyConflictError(
      command.requestId,
      `ya selló tipo ${replay.head.aggregateType}, no ${command.aggregateType}`,
    );
  }
  if (replay.events.length !== command.events.length) {
    throw new IdempotencyConflictError(
      command.requestId,
      `ya selló ${String(replay.events.length)} eventos, no los ${String(command.events.length)} solicitados`,
    );
  }

  for (const [index, draft] of command.events.entries()) {
    const stored = replay.events[index];
    if (stored === undefined) {
      throw new IdempotencyConflictError(
        command.requestId,
        `no conserva el evento ${String(index)}`,
      );
    }
    const event = stored.event;
    const effectiveVersion = draft.eventVersion ?? 1;
    const requestedPayload = canonicalize(draft.payload, LEDGER_PROFILE);
    const mismatch =
      event.aggregateId !== command.aggregateId
        ? 'aggregateId'
        : event.aggregateType !== command.aggregateType
          ? 'aggregateType'
          : event.eventType !== draft.eventType
            ? 'eventType'
            : event.eventVersion !== effectiveVersion
              ? 'eventVersion'
              : event.occurredAt !== draft.occurredAt
                ? 'occurredAt'
                : event.actor !== draft.actor
                  ? 'actor'
                  : stored.payloadText !== requestedPayload
                    ? 'payload canónico'
                    : undefined;
    if (mismatch !== undefined) {
      throw new IdempotencyConflictError(
        command.requestId,
        `no es replay del mismo comando: difiere ${mismatch} en el evento ${String(index)}`,
      );
    }
  }
}

function assertExpectation(command: AppendCommand, current: AggregateHead | undefined): void {
  const expected = command.expectedHead;
  if (expected.kind === 'any') return;
  if (expected.kind === 'new') {
    if (current !== undefined) {
      throw new HeadConflictError(
        command.aggregateId,
        'un agregado nuevo',
        `seq=${String(current.seq)}`,
      );
    }
    return;
  }
  if (current === undefined) {
    throw new HeadConflictError(command.aggregateId, `seq=${String(expected.seq)}`, 'no existe');
  }
  if (current.seq !== expected.seq || toHex(current.hash) !== toHex(expected.hash)) {
    throw new HeadConflictError(
      command.aggregateId,
      `seq=${String(expected.seq)} hash=${toHex(expected.hash)}`,
      `seq=${String(current.seq)} hash=${toHex(current.hash)}`,
    );
  }
}

function buildCanonicalEvent(
  aggregateId: string,
  aggregateType: string,
  seq: number,
  draft: LedgerEventDraft,
): CanonicalEvent {
  const event: CanonicalEvent = {
    aggregateId,
    aggregateType,
    seq,
    eventType: draft.eventType,
    eventVersion: draft.eventVersion ?? 1,
    occurredAt: draft.occurredAt,
    ...(draft.actor === undefined ? {} : { actor: draft.actor }),
    payload: draft.payload,
  };
  assertCanonicalEvent(event);
  return event;
}

interface PendingRow {
  readonly leafIndex: bigint;
  readonly event: CanonicalEvent;
  readonly payloadText: string;
  readonly prevHash: Uint8Array;
  readonly eventHash: Uint8Array;
  readonly spineHash: Uint8Array | undefined;
  readonly requestId: string;
}

/**
 * Reserva `n` índices globales contiguos.
 *
 * `RETURNING next_leaf_index - $n` devuelve el valor **anterior** al incremento, porque `RETURNING`
 * ve la fila nueva. Y como es un `UPDATE` transaccional y no una secuencia, un `ROLLBACK` lo
 * revierte: por eso no hay huecos, y por eso «falta el 4711» significa siempre «alguien borró» y
 * nunca «fue un rollback» (§3.2).
 */
async function reserveLeafIndices(client: PgClient, n: number): Promise<bigint> {
  const { rows } = await client.query<{ first_leaf_index: string }>(
    `UPDATE governance.ledger_cursor
        SET next_leaf_index = next_leaf_index + $1::bigint
      WHERE id = TRUE
      RETURNING (next_leaf_index - $1::bigint)::text AS first_leaf_index`,
    [n],
  );
  const value = rows[0]?.first_leaf_index;
  if (value === undefined) throw new LedgerAppendError('governance.ledger_cursor está vacío');
  return BigInt(value);
}

async function insertEvents(client: PgClient, rows: readonly PendingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const row of rows) {
    const base = values.length;
    tuples.push(
      `($${String(base + 1)}::bigint, $${String(base + 2)}, $${String(base + 3)}, $${String(base + 4)}, ` +
        `$${String(base + 5)}, $${String(base + 6)}, $${String(base + 7)}, $${String(base + 8)}, ` +
        `$${String(base + 9)}, $${String(base + 10)}, $${String(base + 11)}, $${String(base + 12)}, ` +
        `$${String(base + 13)}::uuid)`,
    );
    values.push(
      row.leafIndex.toString(),
      row.event.aggregateId,
      row.event.aggregateType,
      row.event.seq,
      row.event.eventType,
      row.event.eventVersion,
      row.event.occurredAt,
      row.event.actor ?? null,
      row.payloadText,
      Buffer.from(row.prevHash),
      Buffer.from(row.eventHash),
      row.spineHash === undefined ? null : Buffer.from(row.spineHash),
      row.requestId,
    );
  }
  await client.query(
    `INSERT INTO governance.event
       (leaf_index, aggregate_id, aggregate_type, seq, event_type, event_version,
        occurred_at, actor, payload, prev_hash, event_hash, spine_hash, request_id)
     VALUES ${tuples.join(', ')}`,
    values,
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Idempotencia
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface RequestRow {
  readonly request_scope: string;
  readonly request_id: string;
  readonly aggregate_id: string;
  readonly first_leaf_index: string;
  readonly event_count: number;
  readonly head_seq: number;
  readonly head_hash: Uint8Array;
}

/**
 * Recupera el append que una clave de idempotencia ya sello, usando la misma conexion/corte del
 * llamante. Las operaciones compuestas lo consultan bajo el cerrojo antes de generar identificadores
 * nuevos: asi un reintento puede devolver el agregado original sin derivarlo de datos personales.
 */
export async function readAppendRequestWithin(
  client: PgClient,
  requestId: string,
  requestScope = 'public',
): Promise<AppendResult | undefined> {
  const scope = normalizedRequestScope(requestScope);
  const { rows } = await client.query<RequestRow>(
    `SELECT request_scope, request_id, aggregate_id, first_leaf_index::text AS first_leaf_index,
            event_count, head_seq, head_hash
       FROM governance.append_request WHERE request_scope = $1 AND request_id = $2`,
    [scope, requestId],
  );
  const row = rows[0];
  if (row === undefined) return undefined;

  const aggregateId = toFixedChar(row.aggregate_id, 32, 'append_request.aggregate_id');
  const first = toBigInt(row.first_leaf_index, 'append_request.first_leaf_index');
  const stored = await client.query<EventRow>(
    `SELECT ${SELECT_EVENT_COLUMNS} FROM governance.event
      WHERE aggregate_id = $1 AND leaf_index >= $2::bigint AND leaf_index < $3::bigint
      ORDER BY leaf_index ASC`,
    [aggregateId, first.toString(), (first + BigInt(row.event_count)).toString()],
  );
  const events = stored.rows.map(rowToStoredEvent);

  const headRow = await client.query<HeadRow>(
    `SELECT aggregate_id, aggregate_type, seq, head_hash
       FROM governance.aggregate_head WHERE aggregate_id = $1`,
    [aggregateId],
  );
  const head = headRow.rows[0];
  if (head === undefined) {
    throw new LedgerAppendError(
      `${aggregateId} tiene un append_request registrado pero no tiene cabeza: la caché de cabezas ` +
        'y el ledger han divergido',
    );
  }

  return {
    aggregateId,
    firstLeafIndex: first,
    events: events.map((event) => ({
      leafIndex: event.leafIndex,
      event: event.event,
      payloadText: event.payloadText,
      prevHash: event.prevHash,
      eventHash: event.eventHash,
    })),
    head: headFromRow(head),
    spineEvent: undefined,
    idempotentReplay: true,
  };
}

async function readIdempotentResult(
  pool: PgPool,
  requestId: string,
  requestScope: string | undefined,
): Promise<AppendResult | undefined> {
  const client = await pool.connect();
  try {
    return await readAppendRequestWithin(client, requestId, requestScope);
  } finally {
    client.release();
  }
}
