/** Seudónimo sellado: estabilidad local, no enlace entre deliberaciones y límite anti-inundación. */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Actor } from '../src/access.js';
import { canonicalBytes } from '../src/canonical.js';
import {
  advanceStage,
  authorNonce,
  authorPseudonym,
  contributionId,
  deliberationId,
  deliberationNonce,
  type DeliberationCommandMeta,
  type DeliberationLog,
  openDeliberation,
  presentationSeed,
  revealContributionAuthor,
  replayDeliberation,
  submitContribution,
} from '../src/deliberation/index.js';
import { circleId, eventId, instant, memberId } from '../src/ids.js';

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');
const DELIB = deliberationId(hex32(0xd0));
const OTHER_DELIB = deliberationId(hex32(0xd1));
const CIRCLE = circleId(hex32(0xc1));
const AUTHOR = memberId(hex32(0x1003));
const GUARANTEES = memberId(hex32(0x1002));
const NONCE = deliberationNonce(hex32(0xd2));
const OTHER_NONCE = deliberationNonce(hex32(0xd3));
const TEXT = 'Una perspectiva de prueba con longitud más que suficiente para el historial.';
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const author: Actor = { memberId: AUTHOR, roles: ['member'], circles: [CIRCLE] };
const facilitator: Actor = {
  memberId: memberId(hex32(0x1001)),
  roles: ['facilitator'],
  circles: [CIRCLE],
};
const guarantees: Actor = { memberId: GUARANTEES, roles: ['guarantees'], circles: [CIRCLE] };
const meta = (log: DeliberationLog, at: number, actor: Actor): DeliberationCommandMeta => ({
  eventId: eventId(hex32(0x6000 + log.length + 1)),
  at: instant(at),
  actor,
});

async function perspectives(
  id: ReturnType<typeof deliberationId> = DELIB,
  maxContributionsPerAuthorPerStage?: number,
): Promise<DeliberationLog> {
  let log = await openDeliberation(meta([], T0, facilitator), {
    deliberationId: id,
    problemId: hex32(0xb1),
    circleId: CIRCLE,
    opensAt: instant(T0),
    closesAt: instant(T0 + HOUR),
    presentationSeed: presentationSeed(hex32(0xa0)),
    ...(maxContributionsPerAuthorPerStage === undefined
      ? {}
      : { maxContributionsPerAuthorPerStage }),
  });
  log = await advanceStage(log, meta(log, T0 + HOUR, facilitator), {
    to: 'perspectivas',
    cause: 'deadline',
    opensAt: instant(T0 + HOUR),
    closesAt: instant(T0 + HOUR * 2),
    presentationSeed: presentationSeed(hex32(0xa1)),
  });
  return log;
}

async function sealed(
  log: DeliberationLog,
  contribution: number,
  nonce: number,
): Promise<DeliberationLog> {
  return submitContribution(log, meta(log, T0 + HOUR + 1, author), {
    contributionId: contributionId(hex32(0x7000 + contribution)),
    body: { kind: 'posicion', mode: 'afirmacion', text: TEXT },
    nonce: authorNonce(hex32(0x9000 + nonce)),
    deliberationNonce: NONCE,
  });
}

const FC = { numRuns: 50, seed: 30_000_821 } as const;

describe('seudónimo de deliberación', () => {
  it('el mismo autor en la misma deliberación siempre obtiene el mismo seudónimo', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10_000 }), async () => {
        const input = { deliberationId: DELIB, authorId: AUTHOR, deliberationNonce: NONCE };
        expect(await authorPseudonym(input)).toBe(await authorPseudonym(input));
      }),
      FC,
    );
  });

  it('el mismo autor en deliberaciones distintas no queda enlazado', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10_000 }), async () => {
        const local = await authorPseudonym({
          deliberationId: DELIB,
          authorId: AUTHOR,
          deliberationNonce: NONCE,
        });
        const elsewhere = await authorPseudonym({
          deliberationId: OTHER_DELIB,
          authorId: AUTHOR,
          deliberationNonce: OTHER_NONCE,
        });
        expect(elsewhere).not.toBe(local);
      }),
      FC,
    );
  });

  it('el evento sellado serializado no filtra ni autora ni nonce de deliberación', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 500 }), async (n) => {
        const log = await sealed(await perspectives(), n, n);
        const event = log[log.length - 1];
        expect(event).toBeDefined();
        if (event === undefined) return;
        const json = JSON.stringify(event);
        const canonical = new TextDecoder().decode(canonicalBytes(event));
        for (const serialized of [json, canonical]) {
          expect(serialized).not.toContain(AUTHOR);
          expect(serialized).not.toContain(NONCE);
          expect(serialized).not.toContain('authorId');
          expect(serialized).not.toContain('deliberationNonce');
        }
      }),
      FC,
    );
  });

  it('el límite por seudónimo rechaza el siguiente aporte y no escribe nada', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 500 }), async (n) => {
        const first = await sealed(await perspectives(DELIB, 1), n, n);
        const before = first.length;
        await expect(sealed(first, n + 1_000, n + 1_000)).rejects.toMatchObject({
          code: 'MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE_REACHED',
        });
        expect(first).toHaveLength(before);
        expect((await replayDeliberation(first)).contributions).toHaveLength(1);
      }),
      FC,
    );
  });

  it('alterar authorId, nonce o nonce de deliberación durante la revelación siempre falla', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 500 }), async (n) => {
        let log = await sealed(await perspectives(), n, n);
        log = await advanceStage(log, meta(log, T0 + HOUR * 2, facilitator), {
          to: 'perspectivas_revelando',
          cause: 'deadline',
          opensAt: instant(T0 + HOUR * 2),
          closesAt: instant(T0 + HOUR * 3),
          presentationSeed: presentationSeed(hex32(0xa2)),
        });
        const input = {
          contributionId: contributionId(hex32(0x7000 + n)),
          authorId: AUTHOR,
          nonce: authorNonce(hex32(0x9000 + n)),
          deliberationNonce: NONCE,
        };
        await expect(
          revealContributionAuthor(log, meta(log, T0 + HOUR * 2 + 1, guarantees), {
            ...input,
            authorId: memberId(hex32(0x2000 + n)),
          }),
        ).rejects.toBeDefined();
        await expect(
          revealContributionAuthor(log, meta(log, T0 + HOUR * 2 + 1, guarantees), {
            ...input,
            nonce: authorNonce(hex32(0xa000 + n)),
          }),
        ).rejects.toBeDefined();
        await expect(
          revealContributionAuthor(log, meta(log, T0 + HOUR * 2 + 1, guarantees), {
            ...input,
            deliberationNonce: OTHER_NONCE,
          }),
        ).rejects.toMatchObject({ code: 'PSEUDONYM_MISMATCH' });
      }),
      FC,
    );
  });
});
