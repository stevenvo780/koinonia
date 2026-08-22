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
  type OtsTimestamp,
  parseBareTimestamp,
  parseDetachedTimestamp,
  serializeDetachedTimestamp,
  walk,
} from './format.js';
import { BITCOIN_HEADER_BYTES, type BitcoinHeaderSource } from './bitcoin.js';
import { mergeTimestampAt } from './pool.js';

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
 * `GET {uri}/timestamp/{compromiso}` madura. El **compromiso no es el digest del fichero**: es el
 * mensaje del nodo donde cuelga cada atestación pendiente, después de aplicar el nonce y el resumen
 * que el propio calendario añadió. Pedir el digest del fichero —que es lo que hacía este cliente
 * antes— devuelve `404` contra un calendario real y deja el sello pendiente para siempre sin decir
 * por qué. Aquí se recorre el árbol, se pide **cada** compromiso pendiente y la respuesta se injerta
 * en el nodo que le corresponde, que es lo que permite que un `.ots` con ramas de varios calendarios
 * madure rama a rama.
 *
 * Los reintentos y el envío a varios calendarios **no** están aquí a propósito: son política, no
 * protocolo, y viven en `retryingCalendar()` y `calendarPool()` (`ots/pool.ts`) para que se puedan
 * probar sin red y componer con cualquier cliente.
 *
 * VERIFICAR: el diálogo HTTP no se ejercita en la suite —los tests no salen a la red a propósito—.
 * Lo que hay que correr a mano una vez está en `services/api/src/anchor/verificacion-manual.ts`.
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
      let timestamp: OtsTimestamp = detached.timestamp;
      let injertado = false;

      for (const commitment of pendingCommitments(detached.timestamp)) {
        const response = await fetchImpl(`${uri}/timestamp/${toHex(commitment)}`, { headers });
        // Un `404` es la respuesta normal: o este calendario no conoce ese compromiso —porque lo
        // agregó otro—, o todavía no entró en ningún bloque. No es un fallo del envío.
        if (!response.ok) continue;
        const body = new Uint8Array(await response.arrayBuffer());
        const injerto = await parseBareTimestamp(commitment, body);
        timestamp = mergeTimestampAt(timestamp, commitment, injerto);
        injertado = true;
      }

      if (!injertado) return undefined;
      return serializeDetachedTimestamp({ ...detached, timestamp });
    },
  };
}

/** Compromisos con atestación pendiente, sin repetir. Son los que hay que pedir para madurar. */
export function pendingCommitments(timestamp: OtsTimestamp): readonly Uint8Array[] {
  const vistos = new Set<string>();
  const out: Uint8Array[] = [];
  for (const leaf of walk(timestamp)) {
    if (leaf.attestation.kind !== 'pending') continue;
    const hex = toHex(leaf.digest);
    if (vistos.has(hex)) continue;
    vistos.add(hex);
    out.push(leaf.digest);
  }
  return out;
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
  /**
   * Etiqueta con la que se deriva el nonce.
   *
   * Existe para poder simular **calendarios que agregan distinto**: dos calendarios reales nunca
   * producen la misma rama, y con la etiqueta por defecto dos `FakeOtsCalendar` sí la producirían,
   * de modo que una prueba del conjunto no distinguiría «se fusionaron dos ramas» de «se envió a
   * uno». Cambiarla da árboles distintos, que es el caso que hay que probar.
   */
  readonly nonceLabel?: string;
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
  readonly #nonceLabel: string;
  #nextHeight: number;
  #nextBlockTime: number;

  constructor(options: FakeCalendarOptions = {}) {
    this.uri = options.uri ?? 'https://calendario.ejemplo.invalid';
    this.#nextHeight = options.firstHeight ?? 921_447;
    this.#nextBlockTime = options.firstBlockTime ?? 1_787_000_000;
    this.#nonceLabel = options.nonceLabel ?? 'nonce';
  }

  /** Sello pendiente: nonce + sha256 + atestación `pending`, como hace un calendario real. */
  async stamp(fileDigest: Uint8Array): Promise<Uint8Array> {
    const nonce = await derive(fileDigest, this.#nonceLabel);
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
    const nonce = await derive(detached.fileDigest, this.#nonceLabel);
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
