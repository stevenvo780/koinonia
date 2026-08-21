/**
 * El **formato de export**: un contrato público, congelado y en texto plano.
 *
 * Todo lo que este verificador necesita tiene que caber aquí dentro. Si hiciera falta preguntarle
 * algo a nuestro servidor, el verificador dejaría de ser independiente y volveríamos al punto de
 * partida: pedirle al acusado que redacte el peritaje.
 *
 *     koinonia-export-2026-08-21/
 *       manifest.json              versión, rango, algoritmos y sha256 de cada fichero
 *       events.ndjson              1 evento canónico JCS por línea, orden leaf_index ASC
 *       events.hashes.ndjson       {leafIndex, eventHash, prevHash, spineHash?} — redundante a propósito
 *       heads.json                 censo de agregados con su cabeza
 *       checkpoints.ndjson         todos los checkpoints con su encadenamiento
 *       proofs/consistency/M-N.json  pruebas RFC 6962 entre checkpoints consecutivos
 *       anchors/<treeSize>/<id>.json recibos de anclaje, en forma canónica
 *       anchors/bitcoin-headers.json cabeceras de bloque que cierran los sellos OTS
 *       confianza.json             padrón de firmantes y testigos SEGÚN EL SERVIDOR (ver aviso)
 *       README-VERIFICACION.txt    el algoritmo completo, en prosa, para reimplementarlo
 *
 * ⚠ **`manifest.json` no protege contra el administrador.** Los `sha256` que lleva los calcula quien
 * produce el export; quien altera un fichero recalcula el suyo. Sirven para detectar una descarga
 * corrupta, y nada más. Lo que sí protege es la cadena checkpoint → raíz Merkle → anclaje externo, y
 * por eso el informe lo dice con todas las letras en vez de dejar que el verde del manifiesto
 * parezca una garantía.
 *
 * DECISIÓN (discrepancia con la spec §9.3): allí los anclajes se guardan con un árbol por proveedor
 * (`anchors/12480/ots/checkpoint.ots`, `anchors/12480/git/commit.json`, `.../email/receipts.json`),
 * cada uno con su forma. Aquí hay **un recibo canónico por proveedor**, con la misma estructura para
 * los tres y con los bytes opacos dentro (`proof`, en base64url). Motivo: un formato distinto por
 * proveedor obliga al verificador a saber de antemano qué proveedores existen y cómo se llaman sus
 * ficheros, con lo que añadir un cuarto anclaje exigiría cambiar el verificador —que es justo el
 * programa que no debería cambiar—. Con un recibo uniforme, un anclaje nuevo es un fichero más. El
 * `.ots` crudo se escribe **además**, para quien quiera pasárselo al cliente oficial.
 */

import {
  type CanonicalEvent,
  type JsonObject,
  type JsonValue,
  parseCanonical,
  toHex,
} from '@koinonia/crypto';

export const EXPORT_FORMAT_VERSION = 1;

export const MANIFEST_FILE = 'manifest.json';
export const EVENTS_FILE = 'events.ndjson';
export const EVENT_HASHES_FILE = 'events.hashes.ndjson';
export const HEADS_FILE = 'heads.json';
export const CHECKPOINTS_FILE = 'checkpoints.ndjson';
export const TRUST_FILE = 'confianza.json';
export const BITCOIN_HEADERS_FILE = 'anchors/bitcoin-headers.json';
export const README_FILE = 'README-VERIFICACION.txt';

export function consistencyProofPath(from: bigint | number, to: bigint | number): string {
  return `proofs/consistency/${String(from)}-${String(to)}.json`;
}

export function anchorReceiptPath(treeSize: bigint | number, providerId: string): string {
  return `anchors/${String(treeSize)}/${providerId}.json`;
}

export function anchorProofPath(treeSize: bigint | number, providerId: string): string {
  return `anchors/${String(treeSize)}/${providerId}.ots`;
}

/** Fuente de bytes del export. Un puerto: el núcleo no sabe si hay disco, red o memoria detrás. */
export interface ExportSource {
  readonly name: string;
  read(relativePath: string): Promise<Uint8Array | undefined>;
  list(): Promise<readonly string[]>;
}

export function memorySource(
  name: string,
  files: ReadonlyMap<string, Uint8Array | string>,
): ExportSource {
  const encoder = new TextEncoder();
  const bytes = new Map<string, Uint8Array>();
  for (const [path, content] of files) {
    bytes.set(path, typeof content === 'string' ? encoder.encode(content) : content);
  }
  return {
    name,
    read: (path) => Promise.resolve(bytes.get(path)),
    list: () => Promise.resolve([...bytes.keys()].sort()),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Estructuras
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ManifestFileEntry {
  readonly path: string;
  readonly sha256: string;
}

export interface ExportManifest {
  readonly formatVersion: number;
  readonly generatedAt: string;
  readonly eventCount: number;
  /** Ausente si el log está vacío. */
  readonly lastLeafIndex?: number;
  /**
   * `next_leaf_index` del cursor del ledger. **Es lo único que delata un truncamiento de la cola**:
   * al borrar los últimos k eventos, `count(*)` y `max(leaf_index)` bajan a la vez y la igualdad
   * `count = max + 1` sigue dando verde (§5.4.3 sólo ve los borrados interiores).
   */
  readonly cursorNextLeafIndex: number;
  readonly spineAggregateId: string;
  readonly algorithms: JsonObject;
  readonly files: readonly ManifestFileEntry[];
}

export interface ExportedEventHashes {
  readonly leafIndex: number;
  readonly eventHash: string;
  readonly prevHash: string;
  readonly spineHash?: string;
}

export interface ExportedEvent {
  readonly leafIndex: number;
  readonly event: CanonicalEvent;
  /** El texto canónico EXACTO de la línea. Es lo que se hasheó. */
  readonly line: string;
  readonly hashes: ExportedEventHashes;
}

export interface ExportedHead {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly seq: number;
  readonly headHash: string;
}

export interface ExportedCheckpoint {
  readonly treeSize: number;
  readonly rootHash: string;
  readonly headsRoot: string;
  readonly prevCheckpoint?: string;
  readonly issuedAt: string;
  readonly checkpointHash: string;
}

export interface ExportedConsistencyProof {
  readonly from: number;
  readonly to: number;
  readonly proof: readonly string[];
}

/** Padrón de firmantes y testigos. Ver `confianza.ts` para por qué el del export no basta. */
export interface TrustRoster {
  readonly gitSigners: readonly { readonly identity: string; readonly publicKey: string }[];
  readonly witnesses: readonly {
    readonly id: string;
    readonly address: string;
    readonly publicKey: string;
  }[];
  readonly minDistinctDomains: number;
  readonly forges: readonly string[];
  /** Declaración del despliegue: ¿la clave de git vive fuera del servidor auditado? */
  readonly gitSigningKeyOffHost: boolean;
}

export class ExportFormatError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'ExportFormatError';
    this.path = path;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura
// ═════════════════════════════════════════════════════════════════════════════════════════════

const DECODER = new TextDecoder('utf-8', { fatal: true });

export function decodeText(path: string, bytes: Uint8Array): string {
  try {
    return DECODER.decode(bytes);
  } catch {
    throw new ExportFormatError(path, 'no es texto UTF-8 válido');
  }
}

/**
 * Quita **un solo** salto de línea final.
 *
 * Los ficheros de texto terminan en salto —lo exige POSIX y lo espera cualquier herramienta— pero
 * la forma canónica JCS de un objeto no lo lleva. Sin este recorte, el manifiesto de un paquete
 * legítimo se rechazaría por «no canónico», que es el peor fallo posible en un verificador: acusa
 * a los honestos y entrena a la asamblea a ignorarlo. Se quita UNO, no todos: dos saltos finales sí
 * son una diferencia real en los bytes.
 */
export function sinSaltoFinal(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** Parte un NDJSON en líneas, tolerando (sólo) el salto final. */
export function ndjsonLines(path: string, text: string): readonly string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  const last = lines.pop();
  if (last !== '') {
    throw new ExportFormatError(path, 'un fichero NDJSON tiene que terminar en un salto de línea');
  }
  for (const [index, line] of lines.entries()) {
    if (line === '') {
      throw new ExportFormatError(path, `línea ${String(index + 1)} vacía`);
    }
  }
  return lines;
}

/**
 * `Array.isArray` sobre un `JsonValue` degrada el tipo a `any[]`: la unión incluye
 * `readonly JsonValue[]` y el estrechamiento pierde el elemento. Se centraliza aquí para que el
 * `any` no se propague por todo el módulo de lectura de un fichero HOSTIL, que es el peor sitio
 * posible para perder los tipos.
 */
function lista(path: string, value: JsonValue | undefined, key: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new ExportFormatError(path, `falta la lista '${key}'`);
  return value as readonly JsonValue[];
}

function record(path: string, value: JsonValue): Record<string, JsonValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExportFormatError(path, 'se esperaba un objeto JSON');
  }
  return value as Record<string, JsonValue>;
}

function str(path: string, source: Record<string, JsonValue>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw new ExportFormatError(path, `falta la cadena '${key}'`);
  return value;
}

function num(path: string, source: Record<string, JsonValue>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ExportFormatError(path, `falta el entero '${key}'`);
  }
  return value;
}

function hex64(path: string, source: Record<string, JsonValue>, key: string): string {
  const value = str(path, source, key);
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new ExportFormatError(path, `'${key}' debe ser 64 hex minúsculas`);
  }
  return value;
}

/**
 * Parsea exigiendo la forma **canónica exacta**. No basta con que sea JSON equivalente: tiene que
 * ser el mismo byte a byte, porque es lo que se hasheó. Aquí mueren de golpe las claves duplicadas,
 * los espacios de más y los reordenamientos silenciosos de un `pg_dump` que pasó por `jsonb`.
 */
export function parseCanonicalOrThrow(path: string, text: string): JsonValue {
  try {
    return parseCanonical(text);
  } catch (error) {
    throw new ExportFormatError(
      path,
      `el texto no está en forma canónica JCS (${error instanceof Error ? error.message : 'ilegible'})`,
    );
  }
}

export function parseManifest(texto: string): ExportManifest {
  const text = sinSaltoFinal(texto);
  const parsed = record(MANIFEST_FILE, parseCanonicalOrThrow(MANIFEST_FILE, text));
  const files = lista(MANIFEST_FILE, parsed['files'], 'files');
  const algorithms = parsed['algorithms'];
  if (typeof algorithms !== 'object' || algorithms === null || Array.isArray(algorithms)) {
    throw new ExportFormatError(MANIFEST_FILE, "falta el objeto 'algorithms'");
  }

  const lastLeafIndex = parsed['lastLeafIndex'];
  if (lastLeafIndex !== undefined && !Number.isSafeInteger(lastLeafIndex)) {
    throw new ExportFormatError(MANIFEST_FILE, "'lastLeafIndex' debe ser un entero");
  }

  return {
    formatVersion: num(MANIFEST_FILE, parsed, 'formatVersion'),
    generatedAt: str(MANIFEST_FILE, parsed, 'generatedAt'),
    eventCount: num(MANIFEST_FILE, parsed, 'eventCount'),
    ...(lastLeafIndex === undefined ? {} : { lastLeafIndex: lastLeafIndex as number }),
    cursorNextLeafIndex: num(MANIFEST_FILE, parsed, 'cursorNextLeafIndex'),
    spineAggregateId: str(MANIFEST_FILE, parsed, 'spineAggregateId'),
    algorithms: algorithms as JsonObject,
    files: files.map((entry) => {
      const item = record(MANIFEST_FILE, entry);
      return {
        path: str(MANIFEST_FILE, item, 'path'),
        sha256: hex64(MANIFEST_FILE, item, 'sha256'),
      };
    }),
  };
}

export function parseEventHashes(line: string, index: number): ExportedEventHashes {
  const path = `${EVENT_HASHES_FILE}:${String(index + 1)}`;
  const parsed = record(path, parseCanonicalOrThrow(path, line));
  const spineHash = parsed['spineHash'];
  if (spineHash !== undefined && typeof spineHash !== 'string') {
    throw new ExportFormatError(path, "'spineHash' debe ser una cadena si está presente");
  }
  return {
    leafIndex: num(path, parsed, 'leafIndex'),
    eventHash: hex64(path, parsed, 'eventHash'),
    prevHash: hex64(path, parsed, 'prevHash'),
    ...(spineHash === undefined ? {} : { spineHash }),
  };
}

export function parseHeads(texto: string): readonly ExportedHead[] {
  const parsed = record(HEADS_FILE, parseCanonicalOrThrow(HEADS_FILE, sinSaltoFinal(texto)));
  return lista(HEADS_FILE, parsed['heads'], 'heads').map((entry) => {
    const item = record(HEADS_FILE, entry);
    return {
      aggregateId: str(HEADS_FILE, item, 'aggregateId'),
      aggregateType: str(HEADS_FILE, item, 'aggregateType'),
      seq: num(HEADS_FILE, item, 'seq'),
      headHash: hex64(HEADS_FILE, item, 'headHash'),
    };
  });
}

export function parseCheckpoint(line: string, index: number): ExportedCheckpoint {
  const path = `${CHECKPOINTS_FILE}:${String(index + 1)}`;
  const parsed = record(path, parseCanonicalOrThrow(path, line));
  const prev = parsed['prevCheckpoint'];
  if (prev !== undefined && (typeof prev !== 'string' || !/^[0-9a-f]{64}$/u.test(prev))) {
    throw new ExportFormatError(path, "'prevCheckpoint' debe ser 64 hex si está presente");
  }
  return {
    treeSize: num(path, parsed, 'treeSize'),
    rootHash: hex64(path, parsed, 'rootHash'),
    headsRoot: hex64(path, parsed, 'headsRoot'),
    ...(prev === undefined ? {} : { prevCheckpoint: prev }),
    issuedAt: str(path, parsed, 'issuedAt'),
    checkpointHash: hex64(path, parsed, 'checkpointHash'),
  };
}

export function parseConsistencyProof(path: string, texto: string): ExportedConsistencyProof {
  const parsed = record(path, parseCanonicalOrThrow(path, sinSaltoFinal(texto)));
  return {
    from: num(path, parsed, 'from'),
    to: num(path, parsed, 'to'),
    proof: lista(path, parsed['proof'], 'proof').map((node) => {
      if (typeof node !== 'string' || !/^[0-9a-f]{64}$/u.test(node)) {
        throw new ExportFormatError(path, 'cada nodo de la prueba debe ser 64 hex');
      }
      return node;
    }),
  };
}

export function parseTrustRoster(path: string, texto: string): TrustRoster {
  const parsed = record(path, parseCanonicalOrThrow(path, sinSaltoFinal(texto)));
  const gitSigners = lista(path, parsed['gitSigners'], 'gitSigners');
  const witnesses = lista(path, parsed['witnesses'], 'witnesses');
  const forges = lista(path, parsed['forges'], 'forges');
  const offHost = parsed['gitSigningKeyOffHost'];
  if (typeof offHost !== 'boolean') {
    throw new ExportFormatError(path, "'gitSigningKeyOffHost' debe ser booleano");
  }
  return {
    gitSigners: gitSigners.map((entry) => {
      const item = record(path, entry);
      return { identity: str(path, item, 'identity'), publicKey: str(path, item, 'publicKey') };
    }),
    witnesses: witnesses.map((entry) => {
      const item = record(path, entry);
      return {
        id: str(path, item, 'id'),
        address: str(path, item, 'address'),
        publicKey: str(path, item, 'publicKey'),
      };
    }),
    minDistinctDomains: num(path, parsed, 'minDistinctDomains'),
    forges: forges.map((forge) => {
      if (typeof forge !== 'string') throw new ExportFormatError(path, 'forja no textual');
      return forge;
    }),
    gitSigningKeyOffHost: offHost,
  };
}

export function parseBitcoinHeaders(path: string, texto: string): ReadonlyMap<number, string> {
  const parsed = record(path, parseCanonicalOrThrow(path, sinSaltoFinal(texto)));
  const out = new Map<number, string>();
  for (const entry of lista(path, parsed['headers'], 'headers')) {
    const item = record(path, entry);
    const header = str(path, item, 'header');
    if (!/^[0-9a-f]{160}$/u.test(header)) {
      throw new ExportFormatError(path, 'una cabecera de bloque son 80 bytes = 160 hex');
    }
    out.set(num(path, item, 'height'), header);
  }
  return out;
}

/** Serializa un hash como los espera el formato. */
export function hex(bytes: Uint8Array): string {
  return toHex(bytes);
}
