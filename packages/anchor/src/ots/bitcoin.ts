/**
 * Lo mínimo de Bitcoin que hace falta para cerrar un sello OpenTimestamps **sin red**.
 *
 * Una cabecera de bloque son 80 bytes con una estructura fija:
 *
 *     0..4    versión            (uint32 LE)
 *     4..36   hash del bloque anterior
 *     36..68  raíz de Merkle     ← lo único que nos importa
 *     68..72  instante           (uint32 LE, segundos desde epoch)
 *     72..76  bits (dificultad)
 *     76..80  nonce
 *
 * El sello dice «el resultado de este camino es la raíz de Merkle del bloque N». Con la cabecera
 * del bloque N delante, comprobar eso es comparar 32 bytes. **Sin** la cabecera es imposible, y por
 * eso el verificador la trata como un dato de entrada: puede venir del export, de un fichero local
 * o de un nodo propio, y quien desconfíe compara el hash del bloque contra cualquier explorador.
 *
 * Que la cabecera venga del export **no debilita nada**: si el administrador fabrica una cabecera a
 * medida, su `blockHash` no será el del bloque N real de Bitcoin, y esa comparación —la única que
 * exige salir— es de 64 caracteres contra un dato público que él no controla. El verificador la
 * imprime siempre, precisamente para que se pueda hacer.
 */

import { sha256, toHex } from '@koinonia/crypto';

export const BITCOIN_HEADER_BYTES = 80;

export class BitcoinHeaderError extends Error {
  constructor(detail: string) {
    super(`cabecera de bloque inválida: ${detail}`);
    this.name = 'BitcoinHeaderError';
  }
}

/**
 * Fuente de cabeceras. **Síncrona a propósito**: si pudiera hacer I/O, `verify` dejaría de poder
 * prometer que funciona sin red. Quien tenga un nodo, precarga; quien no, usa las del export.
 */
export interface BitcoinHeaderSource {
  get(height: number): Uint8Array | undefined;
}

/** Fuente construida sobre un mapa en memoria. */
export function staticHeaders(
  entries: Iterable<readonly [number, Uint8Array]>,
): BitcoinHeaderSource {
  const map = new Map<number, Uint8Array>();
  for (const [height, header] of entries) {
    if (header.length !== BITCOIN_HEADER_BYTES) {
      throw new BitcoinHeaderError(
        `el bloque ${String(height)} trae ${String(header.length)} B y una cabecera mide 80`,
      );
    }
    map.set(height, header);
  }
  return { get: (height) => map.get(height) };
}

/** Fuente vacía: siempre `undefined`. El verificador dirá `incompleto` y nombrará lo que falta. */
export const NO_HEADERS: BitcoinHeaderSource = { get: () => undefined };

export function merkleRootOf(header: Uint8Array): Uint8Array {
  if (header.length !== BITCOIN_HEADER_BYTES) {
    throw new BitcoinHeaderError(`mide ${String(header.length)} B en vez de 80`);
  }
  return header.slice(36, 68);
}

/** Instante del bloque, en segundos desde epoch. */
export function blockTimeSeconds(header: Uint8Array): number {
  if (header.length !== BITCOIN_HEADER_BYTES) {
    throw new BitcoinHeaderError(`mide ${String(header.length)} B en vez de 80`);
  }
  return new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(68, true);
}

/**
 * `blockHash` en la forma en que lo muestran los exploradores: `SHA256(SHA256(cabecera))` con los
 * bytes al revés. Es el dato de 64 caracteres que alguien puede contrastar contra el mundo.
 */
export async function blockHashHex(header: Uint8Array): Promise<string> {
  if (header.length !== BITCOIN_HEADER_BYTES) {
    throw new BitcoinHeaderError(`mide ${String(header.length)} B en vez de 80`);
  }
  const once = await sha256(header);
  const twice = await sha256(once);
  return toHex(Uint8Array.from([...twice].reverse()));
}

/** Instante del bloque en RFC 3339 UTC con milisegundos, el formato del ledger. */
export function blockInstant(header: Uint8Array): string {
  return new Date(blockTimeSeconds(header) * 1000).toISOString();
}
