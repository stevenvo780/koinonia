import { describe, expect, it } from 'vitest';

import {
  appendChained,
  createInitiative,
  currentInitiative,
  hash,
  initiativeId,
  type InitiativePayload,
  replayInitiative,
  verifyInitiativeLog,
} from '../src/index.js';
import { circleIdAt, DECISION_ID, eventIdAt, memberIdAt, PROPOSAL_ID, T0 } from './arbitraries.js';
import { instant } from '../src/ids.js';

const INITIATIVE = initiativeId('9'.repeat(32));
const CREATED_AT = instant(T0 + 1_000);
const PLAN = {
  objective: 'Conseguir que la sala de estudio extienda su horario nocturno entre semana.',
  responsibleId: memberIdAt(1),
  reviewAt: instant(T0 + 30 * 24 * 60 * 60 * 1000),
  successCriteria: [
    {
      description: 'La sala publica y cumple un horario de apertura hasta las nueve de la noche.',
      evidenceSource: 'Horario oficial publicado por la biblioteca',
    },
  ],
} as const;

const input = {
  initiativeId: INITIATIVE,
  outcomeKind: 'approved' as const,
  decisionId: DECISION_ID,
  proposalId: PROPOSAL_ID,
  proposalVersionHash: hash('a'.repeat(64)),
  decisionResultHash: hash('b'.repeat(64)),
  circleId: circleIdAt(1),
  executionPlan: PLAN,
};

const systemMeta = {
  eventId: eventIdAt(1),
  at: CREATED_AT,
  actor: 'system' as const,
};

describe('iniciativa nacida de un resultado', () => {
  it('un resultado approved crea exactamente un genesis enlazado y por empezar', async () => {
    const log = await createInitiative(systemMeta, input);
    expect(log).toHaveLength(1);
    expect(log[0]?.payload.type).toBe('InitiativeCreated');

    const state = await verifyInitiativeLog(log);
    expect(state).toMatchObject({
      initiativeId: INITIATIVE,
      decisionId: input.decisionId,
      proposalId: input.proposalId,
      proposalVersionHash: input.proposalVersionHash,
      decisionResultHash: input.decisionResultHash,
      circleId: input.circleId,
      executionPlan: PLAN,
      status: 'por-empezar',
      createdAt: CREATED_AT,
      lastSeq: 1,
    });
    expect(currentInitiative(log)).toEqual(state);
  });

  it.each(['rejected', 'no-quorum', 'needs-new-round'] as const)(
    'el desenlace %s no crea iniciativa',
    async (outcomeKind) => {
      await expect(createInitiative(systemMeta, { ...input, outcomeKind })).rejects.toMatchObject({
        code: 'INITIATIVE_REQUIRES_APPROVED',
      });
    },
  );

  it('solo system puede crearla, tanto por orden como al replegar genesis', async () => {
    const human = memberIdAt(2);
    await expect(createInitiative({ ...systemMeta, actor: human }, input)).rejects.toMatchObject({
      code: 'INITIATIVE_SYSTEM_ONLY',
    });

    const valid = await createInitiative(systemMeta, input);
    const forged = await appendChained<InitiativePayload>([], {
      eventId: eventIdAt(2),
      aggregateId: INITIATIVE,
      occurredAt: CREATED_AT,
      actor: human,
      payload: valid[0]!.payload,
    });
    expect(() => replayInitiative([forged])).toThrow(
      expect.objectContaining({ code: 'INITIATIVE_SYSTEM_ONLY' }),
    );
  });

  it('rechaza un segundo InitiativeCreated aunque su cadena sea criptograficamente valida', async () => {
    const first = await createInitiative(systemMeta, input);
    const duplicate = await appendChained<InitiativePayload>(first, {
      eventId: eventIdAt(3),
      aggregateId: INITIATIVE,
      occurredAt: instant(CREATED_AT + 1_000),
      actor: 'system',
      payload: first[0]!.payload,
    });
    await expect(verifyInitiativeLog([...first, duplicate])).rejects.toMatchObject({
      code: 'INITIATIVE_ALREADY_CREATED',
    });
  });

  it('un cierre tardío crea la iniciativa vencida en vez de volver imposible cerrar', async () => {
    const tardia = await createInitiative({ ...systemMeta, at: instant(PLAN.reviewAt + 1) }, input);
    expect(replayInitiative(tardia).executionPlan.reviewAt).toBe(PLAN.reviewAt);
  });

  it('detecta manipulacion de la cadena', async () => {
    const log = await createInitiative(systemMeta, input);
    const tampered = [
      {
        ...log[0]!,
        payload: { ...log[0]!.payload, decisionResultHash: hash('c'.repeat(64)) },
      },
    ];
    await expect(verifyInitiativeLog(tampered)).rejects.toMatchObject({ code: 'BROKEN_LOG' });
  });
});
