/**
 * El **envío** a OpenTimestamps, detrás de una interfaz.
 *
 * El envío es lo único de este anclaje que necesita red, y por tanto lo único que no se puede
 * probar de verdad en una suite que no debe depender de internet. Se aísla aquí, en un puerto, con
 * dos implementaciones: la real sobre HTTP y una `fake` determinista para los tests. La verificación
 * —que es lo que sostiene la garantía— vive en `providers/opentimestamps.ts` y no toca este fichero.
 */

import { fromHex, sha256, toHex } from '@koinonia/crypto';

import {
  type DetachedTimestamp,
  OTS_MAJOR_VERSION,
  parseBareTimestamp,
  parseDetachedTimestamp,
  serializeDetachedTimestamp,
} from './format.js';
import { BITCOIN_HEADER_BYTES, type BitcoinHeaderSource } from './bitcoin.js';

export interface OtsCalendarClient {
  /** URI del calendario. Va dentro de la atestación `pending` del sello. */
  readonly uri: string;
  /** Envía el digest y devuelve los bytes del `.ots` detached resultante (normalmente pendiente). */
  stamp(fileDigest: Uint8Array): Promise<Uint8Array>;
  /** Intenta madurar un sello. `undefined` ⇒ todavía no hay bloque. */
  upgrade(otsBytes: Uint8Array): Promise<Uint8Array | undefined>;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Implementación real sobre HTTP
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** `fetch` inyectado: el paquete no depende de ninguna implementación concreta ni de Node. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array },
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * Cliente del protocolo de calendarios de OpenTimestamps.
 *
 * `POST {uri}/digest` con los 32 bytes del digest devuelve un **Timestamp serializado** (no un
 * fichero detached: sin cabecera mágica y sin digest, porque el calendario ya sabe cuál es). Se
 * envuelve aquí para producir el `.ots` que se publica.
 *
 * VERIFICAR: este cliente no se ejercita contra un calendario real en la suite —los tests no salen
 * a la red a propósito—, así que lo que está probado es el envoltorio y el parseo, no el diálogo
 * HTTP. Antes de la puesta en marcha hay que correrlo una vez contra
 * `https://a.pool.opentimestamps.org` y contrastar el `.ots` resultante con el cliente oficial
 * (`ots verify`). Faltan además: reintentos con backoff (§8.4.1), envío a varios calendarios en
 * paralelo —un solo calendario es un punto único de fallo, y el propio §8.1 lo señala como la falla
 * típica de este anclaje— y el `upgrade` periódico hasta que el sello madura.
 */
export function httpCalendar(uri: string, fetchImpl: FetchLike): OtsCalendarClient {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/vnd.opentimestamps.v1',
  };
  return {
    uri,
    async stamp(fileDigest: Uint8Array): Promise<Uint8Array> {
      const response = await fetchImpl(`${uri}/digest`, {
        method: 'POST',
        headers,
        body: fileDigest,
      });
      if (!response.ok) {
        throw new Error(`el calendario ${uri} respondió ${String(response.status)}`);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      return wrapCalendarTimestamp(fileDigest, body);
    },
    async upgrade(otsBytes: Uint8Array): Promise<Uint8Array | undefined> {
      const detached = await parseDetachedTimestamp(otsBytes);
      // VERIFICAR: el `upgrade` real pide `GET {uri}/timestamp/{commitment}` por CADA atestación
      // pendiente del árbol y hay que injertar la respuesta en el nodo correspondiente. Aquí sólo
      // se resuelve el caso de un único compromiso pendiente colgando del digest del fichero.
      const response = await fetchImpl(`${uri}/timestamp/${toHex(detached.fileDigest)}`, {
        headers,
      });
      if (!response.ok) return undefined;
      const body = new Uint8Array(await response.arrayBuffer());
      return wrapCalendarTimestamp(detached.fileDigest, body);
    },
  };
}

/**
 * Envuelve un `Timestamp` serializado del calendario en un fichero `.ots` detached completo.
 * Se reparsea de inmediato: un cuerpo mal formado falla aquí, al enviarlo, y no meses después
 * cuando alguien intente verificar.
 */
export async function wrapCalendarTimestamp(
  fileDigest: Uint8Array,
  serializedTimestamp: Uint8Array,
): Promise<Uint8Array> {
  const detached: DetachedTimestamp = {
    majorVersion: OTS_MAJOR_VERSION,
    fileHashOp: { kind: 'sha256' },
    fileDigest,
    timestamp: await parseBareTimestamp(fileDigest, serializedTimestamp),
  };
  return serializeDetachedTimestamp(detached);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Adaptador `fake` para los tests
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface FakeCalendarOptions {
  readonly uri?: string;
  /** Altura del primer bloque que confirma. Va subiendo. */
  readonly firstHeight?: number;
  /** Instante del primer bloque, en segundos desde epoch. */
  readonly firstBlockTime?: number;
}

/**
 * Calendario de mentira, **determinista**, para los tests y para las demostraciones.
 *
 * Produce ficheros `.ots` con la estructura real —el cliente oficial los parsea— y fabrica además
 * las cabeceras de bloque que cierran el sello. Que las cabeceras sean fabricadas es exactamente el
 * ataque que el verificador NO puede detectar solo: por eso imprime siempre el `blockHash`, para
 * que una persona lo compare contra Bitcoin de verdad. Un `FakeOtsCalendar` en producción sería un
 * anclaje falso perfecto, y esa es la lección.
 */
export class FakeOtsCalendar implements OtsCalendarClient {
  readonly uri: string;
  readonly #headers = new Map<number, Uint8Array>();
  #nextHeight: number;
  #nextBlockTime: number;

  constructor(options: FakeCalendarOptions = {}) {
    this.uri = options.uri ?? 'https://calendario.ejemplo.invalid';
    this.#nextHeight = options.firstHeight ?? 921_447;
    this.#nextBlockTime = options.firstBlockTime ?? 1_787_000_000;
  }

  /** Sello pendiente: nonce + sha256 + atestación `pending`, como hace un calendario real. */
  async stamp(fileDigest: Uint8Array): Promise<Uint8Array> {
    const nonce = await derive(fileDigest, 'nonce');
    const appended = concat(fileDigest, nonce.slice(0, 16));
    const digest = await sha256(appended);
    return serializeDetachedTimestamp({
      majorVersion: OTS_MAJOR_VERSION,
      fileHashOp: { kind: 'sha256' },
      fileDigest,
      timestamp: {
        msg: fileDigest,
        attestations: [],
        ops: [
          {
            op: { kind: 'append', argument: nonce.slice(0, 16) },
            timestamp: {
              msg: appended,
              attestations: [],
              ops: [
                {
                  op: { kind: 'sha256' },
                  timestamp: {
                    msg: digest,
                    attestations: [{ kind: 'pending', uri: this.uri }],
                    ops: [],
                  },
                },
              ],
            },
          },
        ],
      },
    });
  }

  /**
   * Madura el sello: sustituye la atestación pendiente por un camino que termina en un bloque, y
   * registra la cabecera cuya raíz de Merkle es el digest final.
   */
  async upgrade(otsBytes: Uint8Array): Promise<Uint8Array | undefined> {
    const detached = await parseDetachedTimestamp(otsBytes);
    const nonce = await derive(detached.fileDigest, 'nonce');
    const appended = concat(detached.fileDigest, nonce.slice(0, 16));
    const pendingDigest = await sha256(appended);

    const sibling = await derive(pendingDigest, 'hermano');
    const merged = concat(sibling, pendingDigest);
    const root = await sha256(await sha256(merged));

    const height = this.#nextHeight++;
    const blockTime = this.#nextBlockTime;
    this.#nextBlockTime += 600;
    this.#headers.set(height, await this.#buildHeader(root, blockTime, height));

    return serializeDetachedTimestamp({
      majorVersion: OTS_MAJOR_VERSION,
      fileHashOp: { kind: 'sha256' },
      fileDigest: detached.fileDigest,
      timestamp: {
        msg: detached.fileDigest,
        attestations: [],
        ops: [
          {
            op: { kind: 'append', argument: nonce.slice(0, 16) },
            timestamp: {
              msg: appended,
              attestations: [],
              ops: [
                {
                  op: { kind: 'sha256' },
                  timestamp: {
                    msg: pendingDigest,
                    attestations: [],
                    ops: [
                      {
                        op: { kind: 'prepend', argument: sibling },
                        timestamp: {
                          msg: merged,
                          attestations: [],
                          ops: [
                            {
                              op: { kind: 'sha256' },
                              timestamp: {
                                msg: await sha256(merged),
                                attestations: [],
                                ops: [
                                  {
                                    op: { kind: 'sha256' },
                                    timestamp: {
                                      msg: root,
                                      attestations: [{ kind: 'bitcoin', height }],
                                      ops: [],
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    });
  }

  async #buildHeader(root: Uint8Array, blockTime: number, height: number): Promise<Uint8Array> {
    const header = new Uint8Array(BITCOIN_HEADER_BYTES);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x2000_0000, true);
    header.set((await derive(root, `previo${String(height)}`)).slice(0, 32), 4);
    header.set(root, 36);
    view.setUint32(68, blockTime, true);
    view.setUint32(72, 0x1703_1f4c, true);
    view.setUint32(76, height >>> 0, true);
    return header;
  }

  /**
   * Cabeceras fabricadas. Es lo que el export publica junto al `.ots`.
   *
   * Es una vista **viva** sobre el mapa interno, no una foto: un `headerSource()` que congelara el
   * estado en el momento de la llamada haría que un verificador construido antes del `upgrade` no
   * viera nunca la cabecera, y el fallo aparecería como un `incompleto` inexplicable en vez de como
   * lo que es. Lo descubrió una prueba, que es donde hay que descubrirlo.
   */
  headerSource(): BitcoinHeaderSource {
    return { get: (height) => this.#headers.get(height) };
  }

  headers(): ReadonlyMap<number, Uint8Array> {
    return this.#headers;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Derivación determinista: nada de aleatoriedad, para que los tests no dependan de la suerte. */
async function derive(seed: Uint8Array, label: string): Promise<Uint8Array> {
  return sha256(concat(new TextEncoder().encode(label), seed));
}

/** Cabecera de bloque a partir de su hexadecimal, para cargar cabeceras reales desde el export. */
export function headerFromHex(hex: string): Uint8Array {
  const bytes = fromHex(hex);
  if (bytes.length !== BITCOIN_HEADER_BYTES) {
    throw new Error(`una cabecera de bloque mide 80 B, ésta mide ${String(bytes.length)}`);
  }
  return bytes;
}
