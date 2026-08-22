/**
 * El **export autocontenido**: el fichero público sobre el que trabaja el verificador independiente.
 *
 * Regla que gobierna este módulo: todo lo que el verificador necesite tiene que caber dentro. Si
 * hiciera falta preguntarle algo a esta API, el verificador dejaría de ser independiente y
 * volveríamos a pedirle al acusado que redacte el peritaje.
 *
 * Tres detalles que no son de conveniencia:
 *
 *  - Se exporta `next_leaf_index` del cursor. Sin él, **el truncamiento de la cola es indetectable**:
 *    al borrar los últimos k eventos, `count(*)` y `max(leaf_index)` bajan a la vez y la igualdad
 *    que la spec presenta como prueba de contigüidad sigue dando verde.
 *  - Se exporta el texto canónico EXACTO de cada evento, no un JSON reconstruido a gusto del
 *    serializador de turno. Es lo que se hasheó; cualquier otra cosa es otro dato.
 *  - Se exportan las cabeceras de bloque de Bitcoin que cierran los sellos OpenTimestamps, para que
 *    la verificación del anclaje se pueda completar sin red. Publicarlas nosotros no las hace
 *    confiables: el verificador imprime el identificador del bloque precisamente para que alguien lo
 *    contraste con el mundo.
 */

import {
  canonicalize,
  type JsonValue,
  merkleRoot,
  MerkleTree,
  sha256,
  toHex,
} from '@koinonia/crypto';
import { type DeliberationStage, ruleFor } from '@koinonia/domain';
import {
  BITCOIN_HEADERS_FILE,
  CHECKPOINTS_FILE,
  consistencyProofPath,
  EVENT_HASHES_FILE,
  EVENTS_FILE,
  EXPORT_FORMAT_VERSION,
  HEADS_FILE,
  MANIFEST_FILE,
  README_FILE,
  README_VERIFICACION,
  TRUST_FILE,
  anchorProofPath,
  anchorReceiptPath,
  type TrustRoster,
} from '@koinonia/verificar';

import { toBigInt, toHash32, type PgClient } from '../db/client.js';
import {
  DELIBERATION_AGGREGATE_TYPE,
  listAggregateIds,
  loadDeliberationState,
} from '../workspace/repository.js';
import { readAllHeads } from './event-store.js';
import { SPINE_AGGREGATE_ID } from './types.js';

/** El paquete: rutas relativas → contenido. Escribirlo a disco es trivial y va aparte. */
export type ExportBundle = ReadonlyMap<string, string | Uint8Array>;

export interface ExportOptions {
  /** Instante de generación, RFC 3339 UTC. Entra como dato: aquí no se lee el reloj. */
  readonly generatedAt: string;
  /**
   * Padrón de firmantes y testigos que se publica dentro del paquete.
   *
   * Se incluye **sabiendo que prueba menos** que uno obtenido por otro canal: el verificador levanta
   * el aviso `RAIZ_DE_CONFIANZA_DEL_EXPORT` cuando lo usa. Va igualmente, porque sin él quien
   * ejecute el verificador por primera vez no podría comprobar ninguna firma, y una comprobación
   * parcial con su advertencia vale más que ninguna.
   */
  readonly trust: TrustRoster;
}

/**
 * ⚠ TRAMPA DE SQL, encontrada al implementar y confirmada contra PostgreSQL real.
 *
 * En `SELECT leaf_index::text AS leaf_index … ORDER BY leaf_index`, el `ORDER BY` se resuelve contra
 * la **columna de salida** —que aquí es `text`— y no contra la columna de la tabla. El resultado se
 * ordena lexicográficamente: 0, 1, 10, 11, 12, 13, 2, 3… El export salía con los eventos
 * desordenados, y como el orden ES la afirmación histórica (§6.2), todas las raíces de Merkle
 * dejaban de cuadrar. El verificador lo cazó a la primera; leyendo el SQL no lo vio nadie.
 *
 * Por eso todos los `ORDER BY` de este fichero van **cualificados con la tabla**. La misma trampa
 * estaba en `latestCheckpoint()` desde antes, donde era peor: con diez checkpoints devolvía el 9 en
 * vez del 10, y el siguiente `prevCheckpoint` habría encadenado con el sello equivocado.
 */
interface FilaEvento {
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
}

interface FilaCheckpoint {
  readonly tree_size: string;
  readonly root_hash: Uint8Array;
  readonly heads_root: Uint8Array;
  readonly prev_checkpoint: Uint8Array | null;
  readonly issued_at: string;
  readonly checkpoint_hash: Uint8Array;
}

interface FilaAnclaje {
  readonly tree_size: string;
  readonly provider: string;
  readonly receipt: string | null;
}

interface FilaCabecera {
  readonly height: string;
  readonly header: Uint8Array;
}

const UTF8 = new TextEncoder();

/** Fichero que declara lo que este paquete **no** trae, y por qué. */
export const RETAINED_FILE = 'retenidos.json';

/**
 * ¿Esta etapa oculta todavía quién escribió cada aporte?
 *
 * Se **deriva de la matriz** (`ruleFor('deliberation:read-authorship').deniedDuringStage`), nunca de
 * una copia de la palabra `perspectivas`. Si mañana la regla cambiara de etapa —o dejara de tener
 * alcance temporal— la retención cambia con ella. Una constante repetida aquí sería la segunda
 * fuente de verdad que ADR-0049 evitó a propósito al meter la regla en la tabla de acceso.
 */
export function ocultaLaAutoria(stage: DeliberationStage): boolean {
  return ruleFor('deliberation:read-authorship').deniedDuringStage === stage;
}

/** Una deliberación cuyos hechos se retienen, con el motivo dicho para quien lo lea. */
export interface DeliberacionRetenida {
  readonly aggregateId: string;
  readonly stage: DeliberationStage;
  readonly motivo: string;
}

export const MOTIVO_RETENCION =
  'La etapa Perspectivas de esta conversación sigue abierta. Sus hechos llevan dentro quién ' +
  'escribió cada aporte, y ese dato no se lee hasta que la etapa cierre. No se puede publicar el ' +
  'hecho sin el autor —el autor forma parte de lo que se firmó, así que un hecho sin él no ' +
  'comprobaría—, de modo que se retiene entero. Mientras tanto ESTA conversación no la puede ' +
  'comprobar un tercero; todo lo demás del historial sí. Al cerrar la etapa aparece completa.';

/**
 * Qué hay que retener del historial público, y por qué.
 *
 * ═══ La deuda que cierra ═══
 *
 * `ledger:read` y `ledger:export` son `OPEN` en la matriz de acceso: cualquiera, sin cuenta. Como
 * ADR-0049 dejó el `authorId` dentro del evento —para que el replay pueda reejecutar la
 * autorización—, exportar el historial mientras `perspectivas` sigue abierta entregaría la autoría
 * **sin llegar a rozar** la acción denegada. La regla de etapa cierra la API; no cierra el export.
 *
 * ═══ Por qué se retiene el hecho entero y no se le borra el autor ═══
 *
 * El `actor` del sobre y el `authorId` del cuerpo entran los dos en la preimagen del hash
 * (`packages/domain/src/workspace/chain.ts`, `chainedBody`). Un hecho publicado sin su autor **no
 * verifica**: el verificador independiente lo denunciaría como registro alterado, que es lo mismo
 * que denunciaría si alguien lo hubiera manipulado de verdad. Un sistema que enseña a su auditoría a
 * ignorar un rojo deja de tener auditoría. Así que el hecho no se recorta: se retiene, y se dice.
 *
 * ═══ Lo que esto cuesta, dicho aquí y no escondido ═══
 *
 * Un paquete con hechos retenidos **no es completo**, y el verificador independiente lo nota: le
 * faltan hojas en la numeración. Es el precio declarado —«durante `perspectivas` esa deliberación no
 * es verificable por terceros»— y por eso el paquete trae `retenidos.json`, que dice exactamente qué
 * falta, de qué conversación y hasta cuándo. Un hueco explicado es una decisión; un hueco callado
 * sería la manipulación que este proyecto existe para hacer imposible.
 */
export async function deliberacionesRetenidas(
  client: PgClient,
): Promise<readonly DeliberacionRetenida[]> {
  const retenidas: DeliberacionRetenida[] = [];
  for (const id of await listAggregateIds(client, DELIBERATION_AGGREGATE_TYPE)) {
    let stage: DeliberationStage;
    try {
      stage = (await loadDeliberationState(client, id)).stage;
    } catch {
      // Un historial que no se puede plegar tampoco se puede clasificar. Se retiene: fallar cerrado
      // es la misma regla que aplica `authorize` cuando le falta un dato. Su rotura la denuncia por
      // su cuenta la pantalla de integridad, que es donde tiene que verse.
      retenidas.push({
        aggregateId: id,
        stage: 'perspectivas',
        motivo:
          'El historial de esta conversación no se pudo leer completo, así que no se puede saber ' +
          'si su etapa todavía oculta quién escribió cada aporte. Se retiene por precaución.',
      });
      continue;
    }
    if (ocultaLaAutoria(stage)) {
      retenidas.push({ aggregateId: id, stage, motivo: MOTIVO_RETENCION });
    }
  }
  return retenidas;
}

export async function buildExport(client: PgClient, options: ExportOptions): Promise<ExportBundle> {
  const ficheros = new Map<string, string | Uint8Array>();

  // ── Eventos ────────────────────────────────────────────────────────────────────────────────
  const { rows: eventos } = await client.query<FilaEvento>(
    `SELECT leaf_index::text AS leaf_index, aggregate_id, aggregate_type, seq, event_type,
            event_version, occurred_at, actor, payload, prev_hash, event_hash, spine_hash
       FROM governance.event ORDER BY governance.event.leaf_index ASC`,
  );

  const retenidas = await deliberacionesRetenidas(client);
  const idsRetenidos = new Set(retenidas.map((r) => r.aggregateId));

  const lineasEventos: string[] = [];
  const lineasHashes: string[] = [];
  const hashesDeEventos: Uint8Array[] = [];
  const hojasRetenidas: number[] = [];

  for (const fila of eventos) {
    const leafIndex = toBigInt(fila.leaf_index, 'event.leaf_index');
    const actor = fila.actor === null ? undefined : fila.actor.trimEnd();
    const aggregateId = fila.aggregate_id.trimEnd();

    // El resumen del hecho retenido SÍ entra al árbol: los sellos periódicos y las pruebas de
    // continuidad se calculan sobre el historial completo, que es lo que hay en la base. Recortarlo
    // aquí produciría raíces que no cuadran con ningún sello y convertiría una retención declarada
    // en una manipulación indistinguible de la de verdad.
    hashesDeEventos.push(toHash32(fila.event_hash, 'event.event_hash'));

    if (idsRetenidos.has(aggregateId)) {
      hojasRetenidas.push(Number(leafIndex));
      continue;
    }

    // El payload va como TEXTO canónico exacto: es lo que se hasheó. Reserializarlo desde un objeto
    // parseado daría el mismo resultado sólo si el canonicalizador es correcto, y precisamente eso
    // es lo que el verificador tiene que poder comprobar por su cuenta.
    const evento = {
      aggregateId,
      aggregateType: fila.aggregate_type,
      seq: fila.seq,
      eventType: fila.event_type,
      eventVersion: fila.event_version,
      occurredAt: fila.occurred_at.trimEnd(),
      ...(actor === undefined ? {} : { actor }),
      payload: JSON.parse(fila.payload) as JsonValue,
    };
    lineasEventos.push(canonicalize(evento));

    const spineHash = fila.spine_hash;
    lineasHashes.push(
      canonicalize({
        leafIndex: Number(leafIndex),
        eventHash: toHex(toHash32(fila.event_hash, 'event.event_hash')),
        prevHash: toHex(toHash32(fila.prev_hash, 'event.prev_hash')),
        ...(spineHash === null
          ? {}
          : { spineHash: toHex(toHash32(spineHash, 'event.spine_hash')) }),
      }),
    );
  }

  ficheros.set(EVENTS_FILE, terminar(lineasEventos));
  ficheros.set(EVENT_HASHES_FILE, terminar(lineasHashes));

  // El paquete dice lo que NO trae. Va siempre, aunque esté vacío: un fichero que sólo aparece
  // cuando hay algo que ocultar enseña a quien audita que su ausencia es buena señal, y entonces
  // borrarlo se convierte en una forma de esconder.
  ficheros.set(
    RETAINED_FILE,
    `${canonicalize({
      retainedLeafIndices: hojasRetenidas,
      retained: retenidas.map((r) => ({
        aggregateId: r.aggregateId,
        aggregateType: DELIBERATION_AGGREGATE_TYPE,
        stage: r.stage,
        motivo: r.motivo,
      })),
    })}\n`,
  );

  // ── Censo de cabezas ───────────────────────────────────────────────────────────────────────
  const cabezas = await readAllHeads(client);
  ficheros.set(
    HEADS_FILE,
    `${canonicalize({
      heads: cabezas.map((cabeza) => ({
        aggregateId: cabeza.aggregateId,
        aggregateType: cabeza.aggregateType,
        seq: cabeza.seq,
        headHash: toHex(cabeza.hash),
      })),
    })}\n`,
  );

  // ── Sellos y pruebas de continuidad ────────────────────────────────────────────────────────
  const { rows: filasCheckpoint } = await client.query<FilaCheckpoint>(
    `SELECT tree_size::text AS tree_size, root_hash, heads_root, prev_checkpoint,
            issued_at, checkpoint_hash
       FROM governance.checkpoint ORDER BY governance.checkpoint.tree_size ASC`,
  );

  const checkpoints = filasCheckpoint.map((fila) => ({
    treeSize: Number(toBigInt(fila.tree_size, 'checkpoint.tree_size')),
    rootHash: toHex(toHash32(fila.root_hash, 'checkpoint.root_hash')),
    headsRoot: toHex(toHash32(fila.heads_root, 'checkpoint.heads_root')),
    prevCheckpoint:
      fila.prev_checkpoint === null
        ? undefined
        : toHex(toHash32(fila.prev_checkpoint, 'checkpoint.prev_checkpoint')),
    issuedAt: fila.issued_at.trimEnd(),
    checkpointHash: toHex(toHash32(fila.checkpoint_hash, 'checkpoint.checkpoint_hash')),
  }));

  ficheros.set(
    CHECKPOINTS_FILE,
    terminar(
      checkpoints.map((checkpoint) =>
        canonicalize({
          treeSize: checkpoint.treeSize,
          rootHash: checkpoint.rootHash,
          headsRoot: checkpoint.headsRoot,
          ...(checkpoint.prevCheckpoint === undefined
            ? {}
            : { prevCheckpoint: checkpoint.prevCheckpoint }),
          issuedAt: checkpoint.issuedAt,
          checkpointHash: checkpoint.checkpointHash,
        }),
      ),
    ),
  );

  for (let i = 1; i < checkpoints.length; i++) {
    const anterior = checkpoints[i - 1];
    const actual = checkpoints[i];
    if (anterior === undefined || actual === undefined) continue;
    if (actual.treeSize > hashesDeEventos.length) continue;
    const arbol = await MerkleTree.build(hashesDeEventos.slice(0, actual.treeSize));
    const prueba = arbol.consistencyProof(anterior.treeSize);
    ficheros.set(
      consistencyProofPath(anterior.treeSize, actual.treeSize),
      `${canonicalize({
        from: anterior.treeSize,
        to: actual.treeSize,
        proof: prueba.map(toHex),
      })}\n`,
    );
  }

  // ── Anclajes ───────────────────────────────────────────────────────────────────────────────
  const { rows: anclajes } = await client.query<FilaAnclaje>(
    `SELECT tree_size::text AS tree_size, provider, receipt
       FROM governance.anchor_attempt
      WHERE receipt IS NOT NULL
      ORDER BY governance.anchor_attempt.tree_size ASC, provider ASC`,
  );
  for (const fila of anclajes) {
    const treeSize = toBigInt(fila.tree_size, 'anchor_attempt.tree_size');
    const receipt = fila.receipt;
    if (receipt === null) continue;
    ficheros.set(anchorReceiptPath(treeSize, fila.provider), `${receipt}\n`);

    // El `.ots` crudo, además del recibo, para quien quiera pasárselo al cliente oficial de
    // OpenTimestamps. Es la diferencia entre «confiá en mi verificador» y «comprobalo con el suyo».
    const proof = extraerProof(receipt);
    if (proof !== undefined) ficheros.set(anchorProofPath(treeSize, fila.provider), proof);
  }

  const { rows: cabeceras } = await client.query<FilaCabecera>(
    `SELECT height::text AS height, header FROM governance.bitcoin_header
      ORDER BY governance.bitcoin_header.height ASC`,
  );
  if (cabeceras.length > 0) {
    ficheros.set(
      BITCOIN_HEADERS_FILE,
      `${canonicalize({
        headers: cabeceras.map((fila) => ({
          height: Number(toBigInt(fila.height, 'bitcoin_header.height')),
          header: toHex(new Uint8Array(fila.header)),
        })),
      })}\n`,
    );
  }

  // ── Padrón y prosa ─────────────────────────────────────────────────────────────────────────
  ficheros.set(TRUST_FILE, `${canonicalize(rosterAJson(options.trust))}\n`);
  ficheros.set(README_FILE, README_VERIFICACION);

  // ── Índice ─────────────────────────────────────────────────────────────────────────────────
  const { rows: cursor } = await client.query<{ next_leaf_index: string }>(
    'SELECT next_leaf_index::text AS next_leaf_index FROM governance.ledger_cursor',
  );
  const nextLeafIndex = toBigInt(
    cursor[0]?.next_leaf_index ?? '0',
    'ledger_cursor.next_leaf_index',
  );
  const ultimo = eventos.at(-1);

  const entradas: { path: string; sha256: string }[] = [];
  for (const [ruta, contenido] of [...ficheros].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const bytes = typeof contenido === 'string' ? UTF8.encode(contenido) : contenido;
    entradas.push({ path: ruta, sha256: toHex(await sha256(bytes)) });
  }

  ficheros.set(
    MANIFEST_FILE,
    `${canonicalize({
      formatVersion: EXPORT_FORMAT_VERSION,
      generatedAt: options.generatedAt,
      // Los hechos que EXISTEN, no los que este paquete trae. La diferencia con `retainedLeafCount`
      // es la retención, y se declara para que nadie tenga que restar líneas para darse cuenta.
      eventCount: eventos.length,
      retainedLeafCount: hojasRetenidas.length,
      ...(ultimo === undefined
        ? {}
        : { lastLeafIndex: Number(toBigInt(ultimo.leaf_index, 'event.leaf_index')) }),
      cursorNextLeafIndex: Number(nextLeafIndex),
      spineAggregateId: SPINE_AGGREGATE_ID,
      algorithms: {
        hash: 'SHA-256',
        canonicalization: 'RFC 8785 (JCS)',
        merkle: 'RFC 6962',
        signature: 'Ed25519 (SSHSIG)',
      },
      files: entradas,
    })}\n`,
  );

  return ficheros;
}

/** Raíz de Merkle del log completo. Se expone para la comprobación de humo del `/salud`. */
export async function currentRoot(client: PgClient): Promise<Uint8Array> {
  const { rows } = await client.query<{ event_hash: Uint8Array }>(
    'SELECT event_hash FROM governance.event ORDER BY leaf_index ASC',
  );
  return merkleRoot(rows.map((fila) => toHash32(fila.event_hash, 'event.event_hash')));
}

function rosterAJson(trust: TrustRoster): Record<string, JsonValue> {
  return {
    forges: [...trust.forges],
    gitSigners: trust.gitSigners.map((firmante) => ({
      identity: firmante.identity,
      publicKey: firmante.publicKey,
    })),
    gitSigningKeyOffHost: trust.gitSigningKeyOffHost,
    minDistinctDomains: trust.minDistinctDomains,
    witnesses: trust.witnesses.map((testigo) => ({
      id: testigo.id,
      address: testigo.address,
      publicKey: testigo.publicKey,
    })),
  };
}

function terminar(lineas: readonly string[]): string {
  return lineas.length === 0 ? '' : `${lineas.join('\n')}\n`;
}

/** Saca los bytes opacos del recibo, si los lleva, para escribirlos como fichero suelto. */
function extraerProof(receipt: string): Uint8Array | undefined {
  const parsed: unknown = JSON.parse(receipt);
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const proof = (parsed as Record<string, unknown>)['proof'];
  if (typeof proof !== 'string' || proof === '') return undefined;
  const bytes = new Uint8Array(Math.floor((proof.length * 3) / 4));
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let bits = 0;
  let acumulador = 0;
  let indice = 0;
  for (const caracter of proof) {
    const valor = alfabeto.indexOf(caracter);
    if (valor === -1) return undefined;
    acumulador = (acumulador << 6) | valor;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[indice++] = (acumulador >> bits) & 0xff;
    }
  }
  return bytes.slice(0, indice);
}
