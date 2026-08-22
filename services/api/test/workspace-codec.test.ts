import type { CanonicalEvent, JsonObject } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import { decodeInitiativeEvent } from '../src/workspace/codec.js';
import type { StoredEvent } from '../src/ledger/types.js';

const INITIATIVE = '1'.repeat(32);
const ACTOR = '2'.repeat(32);
const EVENT = '3'.repeat(32);
const TASK = '4'.repeat(32);
const OFFER = '5'.repeat(32);
const PAUSE = '6'.repeat(32);
const DELIVERY = '7'.repeat(32);
const HASH = '8'.repeat(64);

function stored(type: string, body: JsonObject, outer: JsonObject = {}): StoredEvent {
  const payload: JsonObject = { eventId: EVENT, body, ...outer };
  const event: CanonicalEvent = {
    aggregateId: INITIATIVE,
    aggregateType: 'initiative',
    seq: 2,
    eventType: type,
    eventVersion: 1,
    occurredAt: '2026-08-21T15:00:00.000Z',
    actor: ACTOR,
    payload,
  };
  return {
    leafIndex: 1n,
    event,
    payloadText: JSON.stringify(payload),
    prevHash: new Uint8Array(32),
    eventHash: new Uint8Array(32),
    spineHash: undefined,
    requestId: '00000000-0000-4000-8000-000000000001',
  };
}

const CAS = { taskId: TASK, offerId: OFFER, expectedTaskSeq: 4 } as const;

describe('codec estricto del seguimiento de tareas ADR-0045', () => {
  it.each([
    ['TaskStarted', CAS],
    ['TaskBlocked', { ...CAS, category: 'dependencia', privateDetailCommitment: HASH }],
    ['TaskHelpRequested', { ...CAS, category: 'orientacion' }],
    ['TaskResumed', { ...CAS, pauseId: PAUSE }],
    [
      'TaskEvidenceAdded',
      {
        ...CAS,
        objectCommitment: HASH,
        kindCode: 'documento',
        sizeClass: 'pequena',
        visibility: 'restricted',
      },
    ],
    ['TaskDelivered', { ...CAS, evidenceIds: [EVENT], summaryCommitment: HASH }],
    [
      'TaskChangesRequested',
      {
        taskId: TASK,
        deliveryId: DELIVERY,
        expectedTaskSeq: 8,
        reason: 'evidencia-insuficiente',
      },
    ],
    [
      'TaskReviewAccepted',
      {
        taskId: TASK,
        deliveryId: DELIVERY,
        expectedTaskSeq: 8,
        outcomeCriterionEvidence: 'verificada',
      },
    ],
  ] as const)('rehidrata %s sin inventar ni perder campos', (type, body) => {
    expect(decodeInitiativeEvent(stored(type, body)).payload).toEqual({ type, ...body });
  });

  it('rechaza campos prohibidos en el sobre y en el cuerpo antes de proyectarlos', () => {
    expect(() =>
      decodeInitiativeEvent(stored('TaskStarted', CAS, { email: 'x@udea.edu.co' })),
    ).toThrow(/payload\.email: campo desconocido/u);
    expect(() =>
      decodeInitiativeEvent(stored('TaskStarted', { ...CAS, filename: 'salud.pdf' })),
    ).toThrow(/TaskStarted\.filename: campo desconocido/u);
    expect(() =>
      decodeInitiativeEvent(stored('TaskBlocked', { ...CAS, category: 'dependencia', nonce: 'x' })),
    ).toThrow(/TaskBlocked\.nonce: campo desconocido/u);
  });

  it('rechaza campos anidados que el proyector podría haber descartado', () => {
    expect(() =>
      decodeInitiativeEvent(
        stored('InitiativeCreated', {
          decisionId: '9'.repeat(32),
          proposalId: 'a'.repeat(32),
          proposalVersionHash: 'b'.repeat(64),
          decisionResultHash: 'c'.repeat(64),
          circleId: 'd'.repeat(32),
          executionPlan: {
            objective: 'Objetivo suficientemente detallado para la prueba.',
            responsibleId: ACTOR,
            reviewAt: 1_800_000_000_000,
            successCriteria: [
              {
                description: 'Un criterio observable suficientemente detallado.',
                evidenceSource: 'Una fuente pública verificable.',
                privateNote: 'no debe sobrevivir',
              },
            ],
          },
        }),
      ),
    ).toThrow(/successCriteria\[0\]\.privateNote: campo desconocido/u);
  });
});
