/**
 * base64 estándar (RFC 4648 §4, con relleno).
 *
 * `@koinonia/crypto` sólo expone base64**url**, que es lo correcto para URLs y recibos propios.
 * Pero las claves y las firmas de OpenSSH usan base64 estándar, y aquí hay que leer los bytes
 * **exactos** que produce `ssh-keygen`: reinterpretarlos con otro alfabeto daría una clave distinta
 * y una firma que no verifica. Se implementa aparte, sin `atob`/`Buffer`, para que el paquete corra
 * igual en Node y en el navegador de quien audita.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export class Base64Error extends Error {
  constructor(detail: string) {
    super(`base64 inválido: ${detail}`);
    this.name = 'Base64Error';
  }
}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const remaining = bytes.length - i;
    out += ALPHABET[b0 >> 2] ?? '';
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] ?? '';
    out += remaining > 1 ? (ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] ?? '') : '=';
    out += remaining > 2 ? (ALPHABET[b2 & 0x3f] ?? '') : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[\s]/gu, '');
  const body = clean.replace(/=+$/u, '');
  if (!/^[A-Za-z0-9+/]*$/u.test(body)) throw new Base64Error('carácter fuera del alfabeto');
  if (body.length % 4 === 1) throw new Base64Error('longitud imposible');

  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let index = 0;
  for (const char of body) {
    acc = (acc << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
