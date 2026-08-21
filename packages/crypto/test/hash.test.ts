import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { canonicalizeToBytes } from '../src/canonical.js';
import {
  assertHash,
  bytesEqual,
  concatBytes,
  DOMAIN,
  fromBase64Url,
  fromHex,
  HASH_BYTES,
  hashEvent,
  sha256,
  toBase64Url,
  toHex,
  zeroHash,
} from '../src/hash.js';
import type { CanonicalEvent } from '../src/chain.js';

const UTF8 = new TextEncoder();

/**
 * `node:crypto` es una implementación **independiente** de SHA-256 (OpenSSL) frente a la que usa
 * WebCrypto en este proceso. Cruzar las dos es la mejor verificación disponible sin salir de la
 * máquina: si ambas coinciden sobre entradas aleatorias, el error tendría que estar en las dos.
 */
function sha256Referencia(...partes: readonly Uint8Array[]): Uint8Array {
  const hash = createHash('sha256');
  for (const parte of partes) hash.update(parte);
  return new Uint8Array(hash.digest());
}

describe('sha256: vectores conocidos', () => {
  it('la cadena vacía', async () => {
    expect(toHex(await sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('"abc" (FIPS 180-4)', async () => {
    expect(toHex(await sha256(UTF8.encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('coincide con node:crypto sobre entradas arbitrarias', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (bytes) => {
        expect(toHex(await sha256(bytes))).toBe(toHex(sha256Referencia(bytes)));
      }),
      { numRuns: 200 },
    );
  });
});

describe('codificación', () => {
  it('hex ida y vuelta', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 128 }), (bytes) => {
        expect(fromHex(toHex(bytes))).toStrictEqual(bytes);
      }),
    );
  });

  it('hex en minúscula y rechazo de mayúsculas (§2.1: el hex nunca es la preimagen)', () => {
    expect(toHex(Uint8Array.of(0x0a, 0xff, 0x00))).toBe('0aff00');
    expect(() => fromHex('0AFF00')).toThrow(/hexadecimal inválido/u);
    expect(() => fromHex('abc')).toThrow(/longitud impar/u);
  });

  it('base64url ida y vuelta, y coincide con la implementación de Node', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 128 }), (bytes) => {
        const texto = toBase64Url(bytes);
        expect(texto).toBe(Buffer.from(bytes).toString('base64url'));
        expect(fromBase64Url(texto)).toStrictEqual(bytes);
      }),
    );
  });
});

describe('utilidades de bytes', () => {
  it('zeroHash son 32 ceros y cada llamada devuelve una copia nueva', () => {
    const a = zeroHash();
    const b = zeroHash();
    expect(a).toStrictEqual(new Uint8Array(HASH_BYTES));
    a[0] = 0xff;
    expect(b[0]).toBe(0); // sin estado compartido: mutar una copia no contamina la siguiente
  });

  it('bytesEqual distingue longitud y contenido', () => {
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 3))).toBe(false);
  });

  it('assertHash exige exactamente 32 bytes', () => {
    expect(() => {
      assertHash(new Uint8Array(31), 'prevHash');
    }).toThrow(/32 bytes/u);
    expect(() => {
      assertHash(new Uint8Array(32));
    }).not.toThrow();
  });

  it('concatBytes conserva el orden', () => {
    expect(concatBytes(Uint8Array.of(1), Uint8Array.of(2, 3))).toStrictEqual(
      Uint8Array.of(1, 2, 3),
    );
  });
});

describe('hashEvent', () => {
  const evento: CanonicalEvent = {
    aggregateId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    aggregateType: 'propuesta',
    seq: 0,
    eventType: 'PropuestaAbierta',
    eventVersion: 1,
    occurredAt: '2026-08-21T14:03:07.123Z',
    payload: { titulo: 'Reforma del reglamento' },
  };

  it('es SHA256(0x02 ‖ prevHash ‖ JCS_utf8(evento)) — §2.1', async () => {
    const prev = zeroHash();
    const esperado = sha256Referencia(
      Uint8Array.of(DOMAIN.chainLink),
      prev,
      canonicalizeToBytes(evento),
    );
    expect(toHex(await hashEvent(prev, evento))).toBe(toHex(esperado));
  });

  it('exige un prevHash de 32 bytes', async () => {
    await expect(hashEvent(new Uint8Array(31), evento)).rejects.toThrow(/prevHash debe medir/u);
    await expect(hashEvent(new Uint8Array(33), evento)).rejects.toThrow(/prevHash debe medir/u);
  });

  it('el octeto de dominio 0x02 separa el eslabón de la hoja y del nodo', async () => {
    // Sin el prefijo, SHA256(prev ‖ cuerpo) podría coincidir con un nodo del árbol. Con él, la
    // preimagen del eslabón no es preimagen válida de ninguna otra estructura.
    const prev = zeroHash();
    const cuerpo = canonicalizeToBytes(evento);
    const sinPrefijo = toHex(sha256Referencia(prev, cuerpo));
    expect(toHex(await hashEvent(prev, evento))).not.toBe(sinPrefijo);
  });

  it('rechaza eventos con payload no canonicalizable', async () => {
    await expect(hashEvent(zeroHash(), { ...evento, payload: { importe: 0.5 } })).rejects.toThrow(
      /FRACTIONAL_NUMBER/u,
    );
  });
});
