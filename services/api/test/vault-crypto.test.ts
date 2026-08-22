import { NodeAes256GcmVaultCrypto, VaultCryptoError } from '@koinonia/api';
import { eventId, initiativeId, memberId, taskId } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

const ALICE = memberId('a'.repeat(32));
const BOB = memberId('b'.repeat(32));

function vault(): NodeAes256GcmVaultCrypto {
  // Material fijo de prueba, inyectado y nunca impreso.
  return new NodeAes256GcmVaultCrypto(Uint8Array.from({ length: 32 }, (_, i) => i + 17));
}

describe('bóveda AES-256-GCM de capacidad', () => {
  it('envuelve una DSK por sujeto y hace roundtrip del entero sin JSON', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const sealed = await crypto.encryptCapacity({
      subjectId: ALICE,
      revision: 1,
      minutosPorSemana: 420,
      subjectKey,
    });

    expect(subjectKey.wrapNonce).toHaveLength(12);
    expect(subjectKey.wrappedDek.length).toBeGreaterThanOrEqual(48);
    expect(sealed.nonce).toHaveLength(12);
    expect(sealed.ciphertext.length).toBeGreaterThanOrEqual(20);
    expect(Buffer.from(sealed.ciphertext).equals(Buffer.from('420', 'utf8'))).toBe(false);
    await expect(
      crypto.decryptCapacity({
        subjectId: ALICE,
        revision: 1,
        ...sealed,
        subjectKey,
      }),
    ).resolves.toBe(420);
  });

  it('usa nonce fresco: el mismo valor y revisión producen ciphertexts distintos', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const input = { subjectId: ALICE, revision: 3, minutosPorSemana: 600, subjectKey } as const;
    const first = await crypto.encryptCapacity(input);
    const second = await crypto.encryptCapacity(input);

    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
  });

  it('falla cerrado al cruzar sujeto, revisión o AAD de envoltura', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const sealed = await crypto.encryptCapacity({
      subjectId: ALICE,
      revision: 7,
      minutosPorSemana: 90,
      subjectKey,
    });

    await expect(
      crypto.decryptCapacity({
        subjectId: BOB,
        revision: 7,
        ...sealed,
        subjectKey,
      }),
    ).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(
      crypto.decryptCapacity({
        subjectId: ALICE,
        revision: 8,
        ...sealed,
        subjectKey,
      }),
    ).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(
      crypto.decryptCapacity({
        subjectId: ALICE,
        revision: 7,
        ...sealed,
        subjectKey: { ...subjectKey, keyRef: 'c'.repeat(32) },
      }),
    ).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it('rechaza nonce, ciphertext o tag alterados sin devolver contenido parcial', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const sealed = await crypto.encryptCapacity({
      subjectId: ALICE,
      revision: 2,
      minutosPorSemana: 10_080,
      subjectKey,
    });
    const tamperedCiphertext = Uint8Array.from(sealed.ciphertext);
    tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
    const tamperedNonce = Uint8Array.from(sealed.nonce);
    tamperedNonce[0] = (tamperedNonce[0] ?? 0) ^ 1;

    await expect(
      crypto.decryptCapacity({
        subjectId: ALICE,
        revision: 2,
        nonce: sealed.nonce,
        ciphertext: tamperedCiphertext,
        subjectKey,
      }),
    ).rejects.toBeInstanceOf(VaultCryptoError);
    await expect(
      crypto.decryptCapacity({
        subjectId: ALICE,
        revision: 2,
        nonce: tamperedNonce,
        ciphertext: sealed.ciphertext,
        subjectKey,
      }),
    ).rejects.toBeInstanceOf(VaultCryptoError);
  });
});

describe('bóveda AES-256-GCM de material textual restringido', () => {
  const MATERIAL = '4'.repeat(32);
  const OTHER_MATERIAL = '5'.repeat(32);
  const opening = {
    nonce128: '9'.repeat(32),
    context: {
      purpose: 'task-block-detail' as const,
      initiativeId: initiativeId('1'.repeat(32)),
      taskId: taskId('2'.repeat(32)),
      offerId: eventId('3'.repeat(32)),
      visibility: 'restricted' as const,
    },
    content: 'Falta una respuesta externa que contiene información privada.',
  };

  it('cifra y abre la estructura canónica con nonce fresco', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const input = {
      subjectId: ALICE,
      materialId: MATERIAL,
      purpose: opening.context.purpose,
      opening,
      subjectKey,
    } as const;
    const first = await crypto.encryptRestrictedTextMaterial(input);
    const second = await crypto.encryptRestrictedTextMaterial(input);

    expect(first.nonce).toHaveLength(12);
    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
    await expect(
      crypto.decryptRestrictedTextMaterial({
        subjectId: ALICE,
        materialId: MATERIAL,
        purpose: opening.context.purpose,
        ...first,
        subjectKey,
      }),
    ).resolves.toStrictEqual(opening);
  });

  it('oculta el tamaño exacto: textos corto y máximo producen ciphertexts de igual longitud', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const short = await crypto.encryptRestrictedTextMaterial({
      subjectId: ALICE,
      materialId: MATERIAL,
      purpose: opening.context.purpose,
      opening: { ...opening, content: 'x' },
      subjectKey,
    });
    const maximumOpening = { ...opening, content: 'x'.repeat(16 * 1024) };
    const maximum = await crypto.encryptRestrictedTextMaterial({
      subjectId: ALICE,
      materialId: OTHER_MATERIAL,
      purpose: opening.context.purpose,
      opening: maximumOpening,
      subjectKey,
    });

    // 128 KiB de frame autenticado + el tag GCM. La base no aprende la longitud del texto.
    expect(short.ciphertext).toHaveLength(128 * 1024 + 16);
    expect(maximum.ciphertext).toHaveLength(short.ciphertext.length);
    await expect(
      crypto.decryptRestrictedTextMaterial({
        subjectId: ALICE,
        materialId: OTHER_MATERIAL,
        purpose: opening.context.purpose,
        ...maximum,
        subjectKey,
      }),
    ).resolves.toStrictEqual(maximumOpening);
  });

  it('liga AAD a sujeto, materialId y purpose', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const sealed = await crypto.encryptRestrictedTextMaterial({
      subjectId: ALICE,
      materialId: MATERIAL,
      purpose: opening.context.purpose,
      opening,
      subjectKey,
    });

    for (const coordinates of [
      { subjectId: BOB, materialId: MATERIAL, purpose: 'task-block-detail' as const },
      { subjectId: ALICE, materialId: OTHER_MATERIAL, purpose: 'task-block-detail' as const },
      { subjectId: ALICE, materialId: MATERIAL, purpose: 'task-help-detail' as const },
    ]) {
      await expect(
        crypto.decryptRestrictedTextMaterial({ ...coordinates, ...sealed, subjectKey }),
      ).rejects.toBeInstanceOf(VaultCryptoError);
    }
  });

  it('falla opaco ante tamper y no admite visibilidad public en este corte', async () => {
    const crypto = vault();
    const subjectKey = await crypto.createSubjectDataKey(ALICE);
    const sealed = await crypto.encryptRestrictedTextMaterial({
      subjectId: ALICE,
      materialId: MATERIAL,
      purpose: opening.context.purpose,
      opening,
      subjectKey,
    });
    const tampered = Uint8Array.from(sealed.ciphertext);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    await expect(
      crypto.decryptRestrictedTextMaterial({
        subjectId: ALICE,
        materialId: MATERIAL,
        purpose: opening.context.purpose,
        nonce: sealed.nonce,
        ciphertext: tampered,
        subjectKey,
      }),
    ).rejects.toBeInstanceOf(VaultCryptoError);

    await expect(
      crypto.encryptRestrictedTextMaterial({
        subjectId: ALICE,
        materialId: MATERIAL,
        purpose: 'task-evidence-object',
        opening: {
          ...opening,
          context: {
            ...opening.context,
            purpose: 'task-evidence-object',
            visibility: 'public',
          },
        },
        subjectKey,
      }),
    ).rejects.toBeInstanceOf(VaultCryptoError);
  });
});
