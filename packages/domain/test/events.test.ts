/**
 * Sellado y encadenado de eventos (A.7, A.9, INV-19).
 */

import { describe, expect, it } from 'vitest';

import {
  appendEvent,
  apply,
  BrokenLogError,
  type DecisionEvent,
  eventBody,
  eventType,
  initialState,
  instant,
  isLogChainIntact,
  PreconditionError,
  verifyLogChain,
  ZERO_HASH,
} from '../src/index.js';
import { DECISION_ID, eventIdAt, hex32, PROPOSAL_ID, PROPOSAL_V1, T0 } from './arbitraries.js';

const draftInput = {
  eventId: eventIdAt(1),
  decisionId: DECISION_ID,
  occurredAt: T0,
  actor: 'system' as const,
  payload: {
    type: 'DecisionDrafted' as const,
    draft: {
      proposalId: PROPOSAL_ID,
      proposalVersionHash: PROPOSAL_V1,
      summary: 'Aprobar el acta',
    },
  },
};

describe('appendEvent', () => {
  it('asigna `seq` denso desde 1 y encadena `prevHash`', async () => {
    const first = await appendEvent([], draftInput);
    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe(ZERO_HASH);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/u);

    const second = await appendEvent([first], {
      ...draftInput,
      eventId: eventIdAt(2),
      occurredAt: instant(T0 + 1),
    });
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });

  it('el mismo contenido en la misma posición produce el mismo hash', async () => {
    const a = await appendEvent([], draftInput);
    const b = await appendEvent([], draftInput);
    expect(b.hash).toBe(a.hash);
  });

  it('el cuerpo hasheado no incluye `prevHash` ni `hash`: van fuera de la preimagen JSON', async () => {
    const event = await appendEvent([], draftInput);
    expect(Object.keys(eventBody(event) as object).sort()).toEqual([
      'actor',
      'decisionId',
      'eventId',
      'occurredAt',
      'payload',
      'seq',
    ]);
    expect(eventType(event)).toBe('DecisionDrafted');
  });
});

describe('verifyLogChain', () => {
  it('detecta un `seq` que no es denso', async () => {
    const event = await appendEvent([], draftInput);
    const roto: DecisionEvent[] = [{ ...event, seq: 7 }];
    await expect(verifyLogChain(roto)).rejects.toBeInstanceOf(BrokenLogError);
    expect(await isLogChainIntact(roto)).toBe(false);
  });

  it('detecta un `prevHash` que no corresponde', async () => {
    const first = await appendEvent([], draftInput);
    const second = await appendEvent([first], { ...draftInput, eventId: eventIdAt(2) });
    const roto = [first, { ...second, prevHash: ZERO_HASH }];
    await expect(verifyLogChain(roto)).rejects.toThrow(/prevHash/u);
  });

  it('detecta un contenido alterado aunque la cadena parezca coherente', async () => {
    const event = await appendEvent([], draftInput);
    const roto = [{ ...event, occurredAt: instant(T0 + 1) }];
    await expect(verifyLogChain(roto)).rejects.toThrow(/no corresponde al contenido/u);
  });

  it('un log vacío es trivialmente consistente', async () => {
    await expect(verifyLogChain([])).resolves.toBeUndefined();
  });
});

describe('apply — el evento debe pertenecer al agregado', () => {
  it('rechaza un evento de otra decisión', async () => {
    const event = await appendEvent([], { ...draftInput, decisionId: DECISION_ID });
    const otro = initialState(hex32(0x99) as typeof DECISION_ID);
    expect(() => apply(otro, event)).toThrow(PreconditionError);
  });
});
