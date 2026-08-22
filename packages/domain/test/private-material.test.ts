import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createPrivateMaterialCommitment,
  eventId,
  hash,
  type Hash,
  initiativeId,
  type PrivateMaterialCommitment,
  taskId,
  toPrivateMaterialCommitment,
} from '../src/index.js';

const INITIATIVE = initiativeId('1'.repeat(32));
const TASK = taskId('2'.repeat(32));
const OFFER = eventId('3'.repeat(32));
const DELIVERY = eventId('4'.repeat(32));
const NONCE = Uint8Array.from({ length: 16 }, (_, index) => index);
const CONTENT = { texto: 'evidencia privada', version: 1 } as const;

const evidenceContext = {
  purpose: 'task-evidence-object',
  initiativeId: INITIATIVE,
  taskId: TASK,
  offerId: OFFER,
  visibility: 'restricted',
} as const;

describe('commitment de material privado', () => {
  it('cumple el vector fijo prefix-NUL + nonce128 + JCS(context, content)', async () => {
    await expect(
      createPrivateMaterialCommitment({ nonce: NONCE, context: evidenceContext, content: CONTENT }),
    ).resolves.toBe('6f029a0f0347e149c5f293ab9eb1e0a2ae93e1e4070dd91d6f85cb4a81c0f494');
  });

  it('el mismo contenido y nonce cambia al cambiar contexto o visibilidad', async () => {
    const contexts = [
      evidenceContext,
      { ...evidenceContext, initiativeId: initiativeId('5'.repeat(32)) },
      { ...evidenceContext, taskId: taskId('6'.repeat(32)) },
      { ...evidenceContext, offerId: eventId('7'.repeat(32)) },
      { ...evidenceContext, visibility: 'public' as const },
      {
        purpose: 'task-delivery-summary' as const,
        initiativeId: INITIATIVE,
        taskId: TASK,
        offerId: OFFER,
        deliveryId: DELIVERY,
        visibility: 'restricted' as const,
      },
    ];
    const commitments = await Promise.all(
      contexts.map((context) =>
        createPrivateMaterialCommitment({ nonce: NONCE, context, content: CONTENT }),
      ),
    );
    expect(new Set(commitments).size).toBe(commitments.length);
  });

  it('dos nonces distintos producen commitments distintos y nunca se conservan en el resultado', async () => {
    const first = await createPrivateMaterialCommitment({
      nonce: new Uint8Array(16).fill(1),
      context: evidenceContext,
      content: CONTENT,
    });
    const second = await createPrivateMaterialCommitment({
      nonce: new Uint8Array(16).fill(2),
      context: evidenceContext,
      content: CONTENT,
    });
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(first)).not.toContain('evidencia privada');
  });

  it('rechaza nonce distinto de 16 bytes, contenido undefined y contexto no canónico', async () => {
    for (const nonce of [new Uint8Array(15), new Uint8Array(17)]) {
      await expect(
        createPrivateMaterialCommitment({ nonce, context: evidenceContext, content: CONTENT }),
      ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_NONCE' });
    }
    await expect(
      createPrivateMaterialCommitment({
        nonce: NONCE,
        context: evidenceContext,
        content: undefined,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_CONTENT' });
    await expect(
      createPrivateMaterialCommitment({
        nonce: NONCE,
        context: { ...evidenceContext, filename: 'privado.pdf' } as never,
        content: CONTENT,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_CONTEXT' });
    await expect(
      createPrivateMaterialCommitment({
        nonce: NONCE,
        context: { ...evidenceContext, offerId: 3333 } as never,
        content: CONTENT,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_CONTEXT' });
    await expect(
      createPrivateMaterialCommitment({
        nonce: NONCE,
        context: {
          purpose: 'task-change-detail',
          initiativeId: INITIATIVE,
          taskId: TASK,
          deliveryId: DELIVERY,
          visibility: 'restricted',
        } as never,
        content: CONTENT,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_CONTEXT' });
  });

  it('no ejecuta getters ni acepta campos ocultos en el contexto', async () => {
    let getterCalls = 0;
    const getterContext = {
      initiativeId: INITIATIVE,
      taskId: TASK,
      offerId: OFFER,
      visibility: 'restricted',
    };
    Object.defineProperty(getterContext, 'purpose', {
      enumerable: true,
      get: () => {
        getterCalls++;
        return 'task-evidence-object';
      },
    });
    await expect(
      createPrivateMaterialCommitment({
        nonce: NONCE,
        context: getterContext as never,
        content: CONTENT,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_CONTEXT' });
    expect(getterCalls).toBe(0);

    const hiddenContext = { ...evidenceContext };
    Object.defineProperty(hiddenContext, 'url', {
      enumerable: false,
      value: 'https://privado.invalid',
    });
    await expect(
      createPrivateMaterialCommitment({
        nonce: NONCE,
        context: hiddenContext,
        content: CONTENT,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_CONTEXT' });

    let contentGetterCalls = 0;
    const getterContent = {};
    Object.defineProperty(getterContent, 'secreto', {
      enumerable: true,
      get: () => {
        contentGetterCalls++;
        return 'no debe leerse';
      },
    });
    await expect(
      createPrivateMaterialCommitment({
        nonce: NONCE,
        context: evidenceContext,
        content: getterContent,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PRIVATE_MATERIAL_CONTENT' });
    expect(contentGetterCalls).toBe(0);
  });

  it('Hash y PrivateMaterialCommitment no son intercambiables; rehidratar es explícito', () => {
    expectTypeOf<Hash>().not.toExtend<PrivateMaterialCommitment>();
    const rawHash = hash('a'.repeat(64));
    expectTypeOf(rawHash).not.toExtend<PrivateMaterialCommitment>();
    expect(toPrivateMaterialCommitment(rawHash)).toBe(rawHash);
    expect(() => toPrivateMaterialCommitment('no-es-un-hash')).toThrow();
  });
});
