/**
 * Verificación del ledger completo.
 *
 * Un verificador que sólo dice «rojo» no permite ni reparar ni acusar. Todo lo de aquí devuelve
 * **hallazgos** con el agregado, el `leaf_index` y el `seq` exactos, para que el informe se pueda
 * pegar en un acta.
 *
 * ═══ Las tres capas de detección (§2.3), y qué cubre cada una ═══
 *
 *  1. **Doble vínculo con la espina** — estructural. Borrar los 40 eventos de una propuesta deja en
 *     la espina un `AgregadoAbierto` que apunta a un `genesisHash` inexistente: `dangling-genesis`.
 *     Reescribir la propuesta entera «de cero» —que es internamente perfecto (§7.1)— cambia su
 *     `genesisHash` y produce exactamente el mismo hallazgo.
 *  2. **Índice global contiguo** — aritmética. `count(*) = max(leaf_index) + 1`. Borrar 40 eventos
 *     deja 40 agujeros en una secuencia que se declaró densa, y se detecta con un `SELECT`.
 *  3. **Checkpoint anclado con `headsRoot`** — contra un testigo externo. Vive en `checkpoint.ts`,
 *     y es la única capa que sobrevive a un atacante que recomponga todo lo demás.
 *
 * Ninguna de las tres impide el borrado. Las tres impiden que sea silencioso.
 */

import {
  bytesEqual,
  type ChainLink,
  parseCanonical,
  SPINE_AGGREGATE_ID,
  toHex,
  verifyChain,
  zeroHash,
} from '@koinonia/crypto';

import { toBigInt, toFixedChar, toHash32, type PgClient } from '../db/client.js';
import { rowToStoredEvent } from './event-store.js';
import { AGGREGATE_OPENED, type StoredEvent } from './types.js';

export type LedgerFindingCode =
  /** Faltan `leaf_index`: la secuencia se declaró densa y tiene agujeros. Alguien borró. */
  | 'gap-in-global-index'
  /** La COLA del log fue cortada: el cursor reserva más índices de los que quedan eventos. */
  | 'tail-truncated'
  /** No existe el génesis de la espina: el ledger no tiene raíz de confianza. */
  | 'spine-missing'
  /** La espina registra un agregado cuyo evento génesis ya no existe con ese hash. */
  | 'dangling-genesis-pointer'
  /** Hay eventos de un agregado que la espina nunca registró: nació sin dejar rastro. */
  | 'unregistered-aggregate'
  /** La cadena de hashes del agregado está rota. Trae el eslabón exacto y por qué. */
  | 'broken-chain'
  /** El texto de `payload` dejó de ser su propia forma canónica JCS. */
  | 'payload-not-canonical'
  /** La caché `aggregate_head` no coincide con la cadena recomputada. */
  | 'head-mismatch'
  /** Una cabeza declarada en `aggregate_head` sin ningún evento detrás. */
  | 'head-without-events'
  /** Dos hechos de dominio usan la misma identidad global, aunque se haya quitado el índice SQL. */
  | 'duplicate-domain-event-id';

export interface LedgerFinding {
  readonly code: LedgerFindingCode;
  readonly aggregateId: string | undefined;
  readonly leafIndex: bigint | undefined;
  readonly seq: number | undefined;
  readonly detail: string;
  readonly expected: string | undefined;
  readonly actual: string | undefined;
}

export interface LedgerVerification {
  readonly ok: boolean;
  readonly eventCount: bigint;
  readonly maxLeafIndex: bigint | undefined;
  readonly aggregatesChecked: number;
  readonly findings: readonly LedgerFinding[];
}

function finding(
  code: LedgerFindingCode,
  detail: string,
  extra: Partial<Omit<LedgerFinding, 'code' | 'detail'>> = {},
): LedgerFinding {
  return {
    code,
    detail,
    aggregateId: extra.aggregateId,
    leafIndex: extra.leafIndex,
    seq: extra.seq,
    expected: extra.expected,
    actual: extra.actual,
  };
}

const SELECT_EVENT_COLUMNS = `leaf_index, aggregate_id, aggregate_type, seq, event_type,
  event_version, occurred_at, actor, payload, prev_hash, event_hash, spine_hash, request_id`;

interface RawEventRow {
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

/** Verificación completa. `O(n)` en hashes: para el volumen del instituto, se corre entera. */
export async function verifyLedger(client: PgClient): Promise<LedgerVerification> {
  const findings: LedgerFinding[] = [];

  // ── Capa 2: contigüidad del índice global ───────────────────────────────────────────────────
  //
  // Las tres magnitudes se leen en UNA sola consulta a propósito. Bajo `READ COMMITTED` eso da una
  // foto consistente: un append en vuelo tiene sin confirmar tanto su fila como el incremento del
  // cursor, así que no puede producir un falso positivo. Leerlas en tres consultas sí podría.
  const counts = await client.query<{
    total: string;
    max_leaf: string | null;
    next_leaf: string;
  }>(
    `SELECT (SELECT count(*)      FROM governance.event)::text        AS total,
            (SELECT max(leaf_index) FROM governance.event)::text      AS max_leaf,
            (SELECT next_leaf_index FROM governance.ledger_cursor)::text AS next_leaf`,
  );
  const totalRow = counts.rows[0];
  const eventCount = toBigInt(totalRow?.total ?? '0', 'count(event)');
  const nextLeaf = toBigInt(totalRow?.next_leaf ?? '0', 'ledger_cursor.next_leaf_index');
  const maxLeaf =
    totalRow?.max_leaf === null || totalRow?.max_leaf === undefined
      ? undefined
      : toBigInt(totalRow.max_leaf, 'max(leaf_index)');

  // Cortar la COLA del log no deja ningún hueco: al borrar los últimos k eventos, `count(*)` y
  // `max(leaf_index)` bajan a la vez y la comprobación `count = max + 1` sigue dando verde. La spec
  // presenta esa igualdad como *la* prueba de contigüidad (§5.4.3), y sólo detecta los borrados
  // INTERIORES. Lo que delata el truncamiento es el cursor: `ledger_cursor` es monótono y
  // transaccional, así que sigue afirmando cuántos índices se llegaron a repartir.
  const esperados = maxLeaf === undefined ? 0n : maxLeaf + 1n;
  if (nextLeaf !== esperados) {
    findings.push(
      finding(
        'tail-truncated',
        `el cursor del ledger repartió ${String(nextLeaf)} índices y sólo llegan hasta ` +
          `${String(esperados)}: faltan ${String(nextLeaf - esperados)} eventos del FINAL del log. ` +
          'Cortar la cola no deja huecos, así que `count(*) = max(leaf_index) + 1` no lo ve.',
        { expected: String(nextLeaf), actual: String(esperados) },
      ),
    );
  }

  if (maxLeaf !== undefined && eventCount !== maxLeaf + 1n) {
    const gaps = await client.query<{ missing: string }>(
      `SELECT s::text AS missing
         FROM generate_series(0::bigint, $1::bigint) s
         LEFT JOIN governance.event e ON e.leaf_index = s
        WHERE e.leaf_index IS NULL
        ORDER BY s LIMIT 25`,
      [maxLeaf.toString()],
    );
    const missing = gaps.rows.map((row) => row.missing);
    findings.push(
      finding(
        'gap-in-global-index',
        `el índice global se declaró denso y le faltan ${String(maxLeaf + 1n - eventCount)} entradas ` +
          `(primeras ausentes: ${missing.join(', ')}${missing.length === 25 ? '…' : ''}). ` +
          'No es un rollback: la reserva del leaf_index es transaccional y se revierte con él (§3.2).',
        {
          leafIndex: missing[0] === undefined ? undefined : BigInt(missing[0]),
          expected: String(maxLeaf + 1n),
          actual: String(eventCount),
        },
      ),
    );
  }

  // ── Capa 1: la espina y su doble vínculo ────────────────────────────────────────────────────
  // El índice único es una barrera de escritura, no una prueba de integridad: un administrador de
  // base puede quitarlo antes de insertar dos hechos con la misma identidad. Esta comprobación
  // semántica se deriva de los payloads y sigue funcionando aunque el índice 0009 no exista. Los
  // eventos técnicos históricos no llevan `eventId` y quedan deliberadamente fuera.
  const duplicateEventIds = await client.query<{
    event_id: string;
    copies: string;
    first_leaf: string;
  }>(
    `SELECT payload_idx ->> 'eventId' AS event_id,
            count(*)::text AS copies,
            min(leaf_index)::text AS first_leaf
       FROM governance.event
      WHERE jsonb_typeof(payload_idx -> 'eventId') = 'string'
        AND (payload_idx ->> 'eventId') ~ '^[0-9a-f]{32}$'
      GROUP BY payload_idx ->> 'eventId'
     HAVING count(*) > 1
      ORDER BY min(leaf_index)`,
  );
  for (const row of duplicateEventIds.rows) {
    findings.push(
      finding(
        'duplicate-domain-event-id',
        `la identidad global ${row.event_id} aparece en ${row.copies} hechos de dominio; ` +
          'las referencias a ese hecho son ambiguas aunque cada cadena siga cuadrando',
        { leafIndex: BigInt(row.first_leaf), expected: '1', actual: row.copies },
      ),
    );
  }

  const spine = await readAggregateSafely(client, SPINE_AGGREGATE_ID, findings);
  if (spine.length === 0) {
    findings.push(
      finding(
        'spine-missing',
        'no hay ningún evento de la espina #ledger: el ledger no tiene raíz',
      ),
    );
  }

  /** `genesisHash` (hex) -> `aggregateId` declarado por la espina. */
  const declared = new Map<string, { aggregateId: string; leafIndex: bigint }>();
  for (const stored of spine) {
    if (stored.event.eventType !== AGGREGATE_OPENED) continue;
    const payload = stored.event.payload;
    const aggregateId = payload['aggregateId'];
    const genesisHash = payload['genesisHash'];
    if (typeof aggregateId !== 'string' || typeof genesisHash !== 'string') {
      findings.push(
        finding('dangling-genesis-pointer', 'AgregadoAbierto con payload ilegible', {
          leafIndex: stored.leafIndex,
          seq: stored.event.seq,
        }),
      );
      continue;
    }
    declared.set(genesisHash, { aggregateId, leafIndex: stored.leafIndex });
  }

  // Todos los génesis que existen de verdad hoy.
  const genesisRows = await client.query<{ aggregate_id: string; event_hash: Uint8Array }>(
    'SELECT aggregate_id, event_hash FROM governance.event WHERE seq = 0',
  );
  const actualGenesis = new Map<string, string>();
  for (const row of genesisRows.rows) {
    actualGenesis.set(
      toHex(toHash32(row.event_hash, 'event.event_hash')),
      toFixedChar(row.aggregate_id, 32, 'event.aggregate_id'),
    );
  }

  // Puntero colgante: la espina afirma que un agregado nació y su génesis ya no está con ese hash.
  // Es lo que delata tanto `DELETE FROM event WHERE aggregate_id = '…'` como una reescritura
  // completa del agregado, que es internamente perfecta y por tanto invisible a su propia cadena.
  for (const [genesisHash, entry] of declared) {
    const owner = actualGenesis.get(genesisHash);
    if (owner === undefined) {
      findings.push(
        finding(
          'dangling-genesis-pointer',
          `la espina registra el nacimiento de ${entry.aggregateId} con génesis ${genesisHash.slice(0, 16)}…, ` +
            'y no existe ningún evento con ese hash: el agregado fue borrado o reescrito entero',
          {
            aggregateId: entry.aggregateId,
            leafIndex: entry.leafIndex,
            expected: genesisHash,
            actual: 'ausente',
          },
        ),
      );
      continue;
    }
    if (owner !== entry.aggregateId) {
      findings.push(
        finding(
          'dangling-genesis-pointer',
          `la espina atribuye el génesis ${genesisHash.slice(0, 16)}… a ${entry.aggregateId} y pertenece a ${owner}`,
          { aggregateId: entry.aggregateId, expected: entry.aggregateId, actual: owner },
        ),
      );
    }
  }

  // Censo completo: ningún agregado puede existir sin que la espina lo haya registrado.
  const declaredIds = new Set([...declared.values()].map((entry) => entry.aggregateId));
  const aggregates = await client.query<{ aggregate_id: string; n: string }>(
    `SELECT aggregate_id, count(*)::text AS n FROM governance.event
      GROUP BY aggregate_id ORDER BY aggregate_id`,
  );
  const aggregateIds = aggregates.rows.map((row) =>
    toFixedChar(row.aggregate_id, 32, 'event.aggregate_id'),
  );
  for (const aggregateId of aggregateIds) {
    if (aggregateId === SPINE_AGGREGATE_ID) continue;
    if (!declaredIds.has(aggregateId)) {
      findings.push(
        finding(
          'unregistered-aggregate',
          `${aggregateId} tiene eventos y la espina nunca registró su nacimiento: entró por una vía ` +
            'que no pasó por el append',
          { aggregateId },
        ),
      );
    }
  }

  // ── Cadenas por agregado y coherencia de las cabezas ────────────────────────────────────────
  const headRows = await client.query<{ aggregate_id: string; seq: number; head_hash: Uint8Array }>(
    'SELECT aggregate_id, seq, head_hash FROM governance.aggregate_head',
  );
  const heads = new Map(
    headRows.rows.map((row) => [
      toFixedChar(row.aggregate_id, 32, 'aggregate_head.aggregate_id'),
      { seq: row.seq, hash: toHash32(row.head_hash, 'aggregate_head.head_hash') },
    ]),
  );

  for (const aggregateId of aggregateIds) {
    const stream =
      aggregateId === SPINE_AGGREGATE_ID
        ? spine
        : await readAggregateSafely(client, aggregateId, findings);
    if (stream.length === 0) continue;

    const genesis = stream[0];
    const expectedGenesisPrev =
      aggregateId === SPINE_AGGREGATE_ID ? zeroHash() : (genesis?.spineHash ?? zeroHash());

    const links: ChainLink[] = stream.map((stored) => ({
      event: stored.event,
      prevHash: stored.prevHash,
      eventHash: stored.eventHash,
    }));
    const result = await verifyChain(links, {
      aggregateId,
      genesisPrevHash: expectedGenesisPrev,
    });

    if (!result.ok) {
      const culprit = stream[result.brokenAt];
      findings.push(
        finding('broken-chain', `${result.reason}: ${result.detail}`, {
          aggregateId,
          leafIndex: culprit?.leafIndex,
          seq: result.brokenAtSeq ?? undefined,
          expected: result.expected ?? undefined,
          actual: result.actual ?? undefined,
        }),
      );
      continue;
    }

    const head = heads.get(aggregateId);
    const lastSeq = stream[stream.length - 1]?.event.seq;
    if (head === undefined) {
      findings.push(
        finding('head-mismatch', `${aggregateId} tiene eventos y no tiene fila en aggregate_head`, {
          aggregateId,
        }),
      );
    } else if (!bytesEqual(head.hash, result.head) || head.seq !== lastSeq) {
      findings.push(
        finding(
          'head-mismatch',
          `la caché de cabezas no coincide con la cadena recomputada de ${aggregateId}`,
          {
            aggregateId,
            expected: `seq=${String(lastSeq)} hash=${toHex(result.head)}`,
            actual: `seq=${String(head.seq)} hash=${toHex(head.hash)}`,
          },
        ),
      );
    }
  }

  for (const [aggregateId] of heads) {
    if (!aggregateIds.includes(aggregateId)) {
      findings.push(
        finding(
          'head-without-events',
          `aggregate_head declara ${aggregateId} y no queda ni un evento suyo en el ledger`,
          { aggregateId },
        ),
      );
    }
  }

  return {
    ok: findings.length === 0,
    eventCount,
    maxLeafIndex: maxLeaf,
    aggregatesChecked: aggregateIds.length,
    findings,
  };
}

/**
 * Lee un agregado tolerando filas ilegibles.
 *
 * Si alguien alteró el `payload` hasta dejarlo fuera de la forma canónica —reordenó una clave, metió
 * un espacio, duplicó una clave—, `parseCanonical` lanza. Eso **también es una detección**, y sería
 * absurdo que hiciera caer la verificación entera en vez de aparecer como el hallazgo que es.
 */
async function readAggregateSafely(
  client: PgClient,
  aggregateId: string,
  findings: LedgerFinding[],
): Promise<readonly StoredEvent[]> {
  const { rows } = await client.query<RawEventRow>(
    `SELECT ${SELECT_EVENT_COLUMNS} FROM governance.event
      WHERE aggregate_id = $1 ORDER BY seq ASC`,
    [aggregateId],
  );
  const out: StoredEvent[] = [];
  for (const row of rows) {
    try {
      out.push(rowToStoredEvent(row));
    } catch (error) {
      findings.push(
        finding(
          'payload-not-canonical',
          `leaf_index=${row.leaf_index}: la fila no se puede rehidratar sin cambiar la preimagen ` +
            `(${error instanceof Error ? error.message : String(error)})`,
          { aggregateId, leafIndex: BigInt(row.leaf_index), seq: row.seq },
        ),
      );
    }
  }
  return out;
}

/** Verificación de un solo agregado. Es lo que corre el móvil de quien audita una propuesta. */
export async function verifyAggregate(
  client: PgClient,
  aggregateId: string,
): Promise<LedgerVerification> {
  const findings: LedgerFinding[] = [];
  const stream = await readAggregateSafely(client, aggregateId, findings);
  if (stream.length === 0) {
    return {
      ok: false,
      eventCount: 0n,
      maxLeafIndex: undefined,
      aggregatesChecked: 0,
      findings: [
        ...findings,
        finding('unregistered-aggregate', `${aggregateId} no tiene eventos`, { aggregateId }),
      ],
    };
  }
  const genesisPrev =
    aggregateId === SPINE_AGGREGATE_ID ? zeroHash() : (stream[0]?.spineHash ?? zeroHash());
  const result = await verifyChain(
    stream.map((stored) => ({
      event: stored.event,
      prevHash: stored.prevHash,
      eventHash: stored.eventHash,
    })),
    { aggregateId, genesisPrevHash: genesisPrev },
  );
  if (!result.ok) {
    findings.push(
      finding('broken-chain', `${result.reason}: ${result.detail}`, {
        aggregateId,
        leafIndex: stream[result.brokenAt]?.leafIndex,
        seq: result.brokenAtSeq ?? undefined,
        expected: result.expected ?? undefined,
        actual: result.actual ?? undefined,
      }),
    );
  }
  return {
    ok: findings.length === 0,
    eventCount: BigInt(stream.length),
    maxLeafIndex: stream[stream.length - 1]?.leafIndex,
    aggregatesChecked: 1,
    findings,
  };
}

/**
 * Comprueba que el texto de `payload` almacenado sigue siendo su propia forma canónica JCS.
 *
 * Es la mitad barata de la ida y vuelta del §1.1-bis corolario 1 (`render(parse(t)) === t`), y la
 * que caza en el acto una restauración de `pg_dump` que hubiera pasado por `jsonb`.
 */
export function isPayloadCanonical(payloadText: string): boolean {
  try {
    parseCanonical(payloadText);
    return true;
  } catch {
    return false;
  }
}
