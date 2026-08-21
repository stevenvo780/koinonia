/**
 * SHA-256 sobre WebCrypto, separación de dominios y utilidades de codificación.
 *
 * Se usa `globalThis.crypto.subtle` y no `node:crypto` para que **el mismo código** verifique en el
 * servidor y en el navegador de quien audita (ADR-0003). Un verificador que sólo corre en el
 * servidor no prueba nada: es pedirle al acusado que redacte el peritaje.
 */

import { canonicalizeToBytes, type CanonicalProfile, LEDGER_PROFILE } from './canonical.js';

/** Longitud de un hash SHA-256 en bytes. Toda la estructura depende de que sea fija. */
export const HASH_BYTES = 32;

/**
 * Octetos de separación de dominio. Que los tres —eslabón, hoja, nodo— sean disjuntos es lo que
 * impide confundir un `eventHash` con un nodo del árbol (§2.1) y cierra el ataque de segunda
 * preimagen del §6.3.
 */
export const DOMAIN = {
  /** Hoja del árbol de Merkle (RFC 6962). */
  leaf: 0x00,
  /** Nodo interno del árbol de Merkle (RFC 6962). */
  node: 0x01,
  /** Eslabón de la cadena de eventos por agregado (§2.1). */
  chainLink: 0x02,
  /** Plegado `running_hash` de una proyección (§5.2). */
  projectionFold: 0x03,
  /** Checkpoint publicado (§6.4). */
  checkpoint: 0x04,
} as const;

type Subtle = typeof globalThis.crypto.subtle;

function requireSubtle(): Subtle {
  const webcrypto = globalThis.crypto as Partial<typeof globalThis.crypto> | undefined;
  const subtle = webcrypto?.subtle;
  if (subtle === undefined) {
    throw new Error(
      'WebCrypto no disponible: se requiere globalThis.crypto.subtle (Node >= 22 o navegador en contexto seguro)',
    );
  }
  return subtle;
}

/** Una copia nueva de los 32 ceros. Es el `prevHash` del génesis de la espina `#ledger` (§2.3). */
export function zeroHash(): Uint8Array {
  return new Uint8Array(HASH_BYTES);
}

/** Concatena. Sin sorpresas: las longitudes son fijas y la partición es única. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await requireSubtle().digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

export async function sha256Concat(...parts: readonly Uint8Array[]): Promise<Uint8Array> {
  return sha256(concatBytes(...parts));
}

/**
 * Comparación en tiempo constante respecto de la posición de la diferencia.
 * Aquí sólo se comparan valores públicos, pero un `===` temprano invita a copiar el patrón a un
 * sitio donde sí importe.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Comprueba que un valor es un hash de 32 bytes; lanza si no. */
export function assertHash(value: Uint8Array, what = 'hash'): void {
  if (value.length !== HASH_BYTES) {
    throw new Error(`${what} debe medir ${String(HASH_BYTES)} bytes, mide ${String(value.length)}`);
  }
}

const HEX = '0123456789abcdef';

/** Hexadecimal en minúscula. Es la representación de borde (API, pantalla), **nunca** la preimagen. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += HEX[byte >> 4] ?? '';
    out += HEX[byte & 0x0f] ?? '';
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hexadecimal de longitud impar');
  if (!/^[0-9a-f]*$/u.test(hex)) {
    throw new Error('hexadecimal inválido: sólo se admite [0-9a-f] en minúscula');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url sin relleno (RFC 4648 §5). Para URLs de recibos y pruebas. */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const remaining = bytes.length - i;
    out += B64URL[b0 >> 2] ?? '';
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)] ?? '';
    if (remaining > 1) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)] ?? '';
    if (remaining > 2) out += B64URL[b2 & 0x3f] ?? '';
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9\-_]*$/u.test(text)) throw new Error('base64url inválido');
  if (text.length % 4 === 1) throw new Error('base64url de longitud imposible');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let index = 0;
  for (const char of text) {
    acc = (acc << 6) | B64URL.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/**
 * `eventHash_n = SHA256( 0x02 ‖ prevHash_{n-1}(32B) ‖ JCS_utf8(evento) )` — §2.1.
 *
 * `prevHash` va como prefijo binario de longitud fija, no como campo JSON: evita la circularidad de
 * hashear un objeto que contiene su propio hash, y como el primer operando mide siempre exactamente
 * 32 bytes la partición de la concatenación es única sin prefijos de longitud.
 */
export async function hashEvent(
  prevHash: Uint8Array,
  event: unknown,
  profile: CanonicalProfile = LEDGER_PROFILE,
): Promise<Uint8Array> {
  assertHash(prevHash, 'prevHash');
  const body = canonicalizeToBytes(event, profile);
  return sha256Concat(Uint8Array.of(DOMAIN.chainLink), prevHash, body);
}
