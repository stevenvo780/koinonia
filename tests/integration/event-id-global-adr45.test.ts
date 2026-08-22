/** ADR-0045: una referencia causal de dominio no puede significar dos hechos globales. */

import {
  append,
  pgError,
  readAll,
  readHead,
  readStream,
  verifyLedger,
  type PgPool,
} from '@koinonia/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { id32, iso, ledgerEnv, ready, requestId, skipNote } from './helpers/ledger-env.js';

const env = await ledgerEnv();

afterAll(async () => {
  if (env.ok) await env.stop();
});

describe.skipIf(!env.ok)(`eventId global ADR-0045${skipNote(env)}`, () => {
  let pool: PgPool;
  let superPool: PgPool;

  beforeAll(() => {
    pool = ready(env).appPool;
    superPool = ready(env).superPool;
  });

  it('revierte todo el segundo nacimiento si reutiliza un eventId de otro agregado', async () => {
    const firstAggregate = id32('event-id-global-first');
    const secondAggregate = id32('event-id-global-second');
    const sharedEventId = id32('event-id-global-shared');

    await append(pool, {
      aggregateId: firstAggregate,
      aggregateType: 'iniciativa',
      expectedHead: { kind: 'new' },
      requestId: requestId('event-id-global-first'),
      events: [
        {
          eventType: 'InitiativeCreated',
          occurredAt: iso(1),
          payload: { eventId: sharedEventId, marker: 'first' },
        },
      ],
    });
    const before = await readAll(pool);

    let rejected: unknown;
    try {
      await append(pool, {
        aggregateId: secondAggregate,
        aggregateType: 'iniciativa',
        expectedHead: { kind: 'new' },
        requestId: requestId('event-id-global-second'),
        events: [
          {
            eventType: 'InitiativeCreated',
            occurredAt: iso(2),
            payload: { eventId: sharedEventId, marker: 'second' },
          },
        ],
      });
    } catch (error) {
      rejected = error;
    }

    expect(pgError(rejected)).toMatchObject({
      code: '23505',
      constraint: 'governance_event_payload_event_id_uk',
    });
    expect(await readAll(pool)).toEqual(before);
    expect(await readStream(pool, secondAggregate)).toEqual([]);
    expect(await readHead(pool, secondAggregate)).toBeUndefined();
    await expect(verifyLedger(pool)).resolves.toMatchObject({ ok: true });
  });

  it('el verificador se pone rojo ante duplicados aunque un administrador quite el índice', async () => {
    const firstAggregate = id32('event-id-index-removed-first');
    const secondAggregate = id32('event-id-index-removed-second');
    const sharedEventId = id32('event-id-index-removed-shared');

    await superPool.query('DROP INDEX governance.governance_event_payload_event_id_uk');
    for (const [aggregateId, suffix] of [
      [firstAggregate, 'first'],
      [secondAggregate, 'second'],
    ] as const) {
      await append(pool, {
        aggregateId,
        aggregateType: 'iniciativa',
        expectedHead: { kind: 'new' },
        requestId: requestId(`event-id-index-removed-${suffix}`),
        events: [
          {
            eventType: 'InitiativeCreated',
            occurredAt: iso(suffix === 'first' ? 3 : 4),
            payload: { eventId: sharedEventId, marker: suffix },
          },
        ],
      });
    }

    const verification = await verifyLedger(pool);
    expect(verification.ok).toBe(false);
    expect(verification.findings).toContainEqual(
      expect.objectContaining({
        code: 'duplicate-domain-event-id',
        actual: '2',
      }),
    );
  });
});
