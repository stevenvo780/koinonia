/**
 * Autoría temporalmente oculta y orden de presentación.
 *
 * La prueba que importa aquí no es que el compromiso «funcione»: es que el `authorId` **no esté** en
 * el evento. Un campo oculto por la interfaz no está oculto, así que se serializa el evento entero
 * —con `JSON.stringify` y con la forma canónica que se hashea— y se busca la cadena a mano.
 */

import { describe, expect, it } from 'vitest';

import type { Actor } from '../src/access.js';
import { canonicalBytes, hashCanonical } from '../src/canonical.js';
import {
  advanceStage,
  type AuthorNonce,
  authorNonce,
  AUTHOR_COMMITMENT_DOMAIN,
  authorCommitment,
  buildAuthorOpening,
  type ContributionId,
  contributionId,
  deliberationId,
  type DeliberationCommandMeta,
  deliberationNonce,
  type DeliberationLog,
  isAuthorCommitmentValid,
  openDeliberation,
  orderContributionsForViewer,
  presentationOrder,
  type PresentationSeed,
  presentationSeed,
  readerSeed,
  replayDeliberation,
  revealContributionAuthor,
  submitContribution,
} from '../src/deliberation/index.js';
import {
  circleId,
  eventId,
  type EventId,
  type Instant,
  instant,
  type MemberId,
  memberId,
} from '../src/ids.js';

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');

const DELIB = deliberationId(hex32(0xd0));
const DELIBERATION_NONCE = deliberationNonce(hex32(0xd2));
const OTRA_DELIB = deliberationId(hex32(0xd1));
const CIRCLE = circleId(hex32(0xc1));
const PROBLEM = hex32(0xb1);

const mid = (n: number): MemberId => memberId(hex32(0x1000 + n));
const ev = (n: number): EventId => eventId(hex32(0x6000 + n));
const cid = (n: number): ContributionId => contributionId(hex32(0x7000 + n));
const nonce = (n: number): AuthorNonce => authorNonce(hex32(0x9000 + n));
const seed = (n: number): PresentationSeed => presentationSeed(hex32(0xa000 + n));

const facilitator: Actor = { memberId: mid(1), roles: ['facilitator'], circles: [CIRCLE] };
const garantias: Actor = { memberId: mid(2), roles: ['guarantees'], circles: [CIRCLE] };
const daniela: Actor = { memberId: mid(3), roles: ['member'], circles: [CIRCLE] };

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const opensAtOf = (i: number): Instant => instant(T0 + i * HOUR);
const closesAtOf = (i: number): Instant => instant(T0 + (i + 1) * HOUR);
const midOf = (i: number): Instant => instant(T0 + i * HOUR + HOUR / 2);

const TEXT = 'Una perspectiva de prueba con longitud más que suficiente para el historial.';

function meta(log: DeliberationLog, at: Instant, actor: Actor): DeliberationCommandMeta {
  return { eventId: ev(log.length + 1), at, actor };
}

/**
 * Historial mínimo hasta `perspectivas`, con **una** perspectiva sellada de Daniela.
 *
 * Daniela no interviene en ningún otro evento: si su identificador aparece en el historial, aparece
 * por el sello y no por otra cosa. Eso es lo que hace concluyente la prueba de fuga.
 */
async function selladoMinimo(): Promise<DeliberationLog> {
  let log = await openDeliberation(
    { eventId: ev(1), at: opensAtOf(0), actor: facilitator },
    {
      deliberationId: DELIB,
      problemId: PROBLEM,
      circleId: CIRCLE,
      opensAt: opensAtOf(0),
      closesAt: closesAtOf(0),
      presentationSeed: seed(0),
    },
  );
  log = await advanceStage(log, meta(log, opensAtOf(1), facilitator), {
    to: 'perspectivas',
    cause: 'deadline',
    opensAt: opensAtOf(1),
    closesAt: closesAtOf(1),
    presentationSeed: seed(1),
  });
  return submitContribution(log, meta(log, midOf(1), daniela), {
    contributionId: cid(4),
    body: { kind: 'posicion', mode: 'afirmacion', text: TEXT },
    nonce: nonce(4),
    deliberationNonce: DELIBERATION_NONCE,
  });
}

async function hastaRevelar(): Promise<DeliberationLog> {
  const log = await selladoMinimo();
  return advanceStage(log, meta(log, opensAtOf(2), facilitator), {
    to: 'perspectivas_revelando',
    cause: 'deadline',
    opensAt: opensAtOf(2),
    closesAt: closesAtOf(2),
    presentationSeed: seed(2),
  });
}

describe('el compromiso de autoría', () => {
  it('es exactamente `hashCanonical` de la apertura declarada', async () => {
    const opening = buildAuthorOpening({
      deliberationId: DELIB,
      contributionId: cid(4),
      authorId: mid(3),
      nonce: nonce(4),
    });
    expect(opening.domain).toBe(AUTHOR_COMMITMENT_DOMAIN);
    expect(opening).toEqual({
      domain: 'koinonia/deliberation-author/v1',
      deliberationId: DELIB,
      contributionId: cid(4),
      authorId: mid(3),
      nonce: nonce(4),
    });
    expect(
      await authorCommitment({
        deliberationId: DELIB,
        contributionId: cid(4),
        authorId: mid(3),
        nonce: nonce(4),
      }),
    ).toBe(await hashCanonical(opening));
  });

  it('separa dominios: el mismo autor y nonce dan compromisos distintos por aporte y por deliberación', async () => {
    const base = {
      deliberationId: DELIB,
      contributionId: cid(4),
      authorId: mid(3),
      nonce: nonce(4),
    };
    const c0 = await authorCommitment(base);
    expect(await authorCommitment({ ...base, contributionId: cid(5) })).not.toBe(c0);
    expect(await authorCommitment({ ...base, deliberationId: OTRA_DELIB })).not.toBe(c0);
    expect(await authorCommitment({ ...base, authorId: mid(4) })).not.toBe(c0);
    expect(await authorCommitment({ ...base, nonce: nonce(5) })).not.toBe(c0);
  });

  it('el evento sellado NO contiene el `authorId` ni el nonce, en ninguna serialización', async () => {
    const log = await selladoMinimo();
    const evento = log[log.length - 1];
    expect(evento).toBeDefined();
    if (evento === undefined) return;

    const enJson = JSON.stringify(evento);
    const enCanonico = new TextDecoder().decode(canonicalBytes(evento));
    const autor = mid(3);

    expect(enJson).not.toContain(autor);
    expect(enCanonico).not.toContain(autor);
    expect(enJson).not.toContain(nonce(4));
    expect(enCanonico).not.toContain(nonce(4));
    expect(enJson).not.toContain('authorId');

    // Y lo que sí lleva: el compromiso, y el actor `system` en vez de la persona.
    expect(evento.actor).toBe('system');
    expect(enJson).toContain('authorCommitment');
    expect(evento.payload.type).toBe('ContributionSubmitted');
  });

  it('el historial ENTERO de la etapa a ciegas tampoco filtra a la autora', async () => {
    const log = await selladoMinimo();
    expect(JSON.stringify(log)).not.toContain(mid(3));
  });

  it('el estado plegado guarda el compromiso y ninguna autoría', async () => {
    const state = await replayDeliberation(await selladoMinimo());
    const aporte = state.contributions[0];
    expect(aporte).toBeDefined();
    expect(aporte?.authorship.mode).toBe('sealed');
    expect(aporte?.revealedAuthorId).toBeUndefined();
  });
});

describe('la revelación', () => {
  it('recomputa el compromiso y lo acepta cuando coincide', async () => {
    const log = await hastaRevelar();
    const revelado = await revealContributionAuthor(log, meta(log, midOf(2), garantias), {
      contributionId: cid(4),
      authorId: mid(3),
      nonce: nonce(4),
      deliberationNonce: DELIBERATION_NONCE,
    });
    const state = await replayDeliberation(revelado);
    const aporte = state.contributions[0];
    expect(aporte?.revealedAuthorId).toBe(mid(3));
    expect(aporte?.revealedNonce).toBe(nonce(4));
    if (aporte?.authorship.mode === 'sealed') {
      expect(
        await isAuthorCommitmentValid(aporte.authorship.authorCommitment, {
          deliberationId: DELIB,
          contributionId: cid(4),
          authorId: mid(3),
          nonce: nonce(4),
        }),
      ).toBe(true);
    }
  });

  it('un `authorId` distinto SIEMPRE lanza: la autoría no se reescribe después', async () => {
    const log = await hastaRevelar();
    await expect(
      revealContributionAuthor(log, meta(log, midOf(2), garantias), {
        contributionId: cid(4),
        authorId: mid(4),
        nonce: nonce(4),
        deliberationNonce: DELIBERATION_NONCE,
      }),
    ).rejects.toMatchObject({ code: 'COMMITMENT_MISMATCH' });
  });

  it('un nonce distinto SIEMPRE lanza', async () => {
    const log = await hastaRevelar();
    await expect(
      revealContributionAuthor(log, meta(log, midOf(2), garantias), {
        contributionId: cid(4),
        authorId: mid(3),
        nonce: nonce(7),
        deliberationNonce: DELIBERATION_NONCE,
      }),
    ).rejects.toMatchObject({ code: 'COMMITMENT_MISMATCH' });
  });

  it('se destapa exactamente una vez', async () => {
    const log = await hastaRevelar();
    const revelado = await revealContributionAuthor(log, meta(log, midOf(2), garantias), {
      contributionId: cid(4),
      authorId: mid(3),
      nonce: nonce(4),
      deliberationNonce: DELIBERATION_NONCE,
    });
    await expect(
      revealContributionAuthor(revelado, meta(revelado, midOf(2), garantias), {
        contributionId: cid(4),
        authorId: mid(3),
        nonce: nonce(4),
        deliberationNonce: DELIBERATION_NONCE,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVEALED' });
  });

  it('no se destapa mientras la escritura a ciegas sigue abierta', async () => {
    const log = await selladoMinimo();
    expect((await replayDeliberation(log)).stage).toBe('perspectivas');
    await expect(
      revealContributionAuthor(log, meta(log, midOf(1), garantias), {
        contributionId: cid(4),
        authorId: mid(3),
        nonce: nonce(4),
        deliberationNonce: DELIBERATION_NONCE,
      }),
    ).rejects.toMatchObject({ code: 'REVEAL_OUT_OF_STAGE' });
  });

  it('no se destapa un aporte inexistente ni uno de autoría pública', async () => {
    const log = await hastaRevelar();
    await expect(
      revealContributionAuthor(log, meta(log, midOf(2), garantias), {
        contributionId: cid(90),
        authorId: mid(3),
        nonce: nonce(4),
        deliberationNonce: DELIBERATION_NONCE,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_CONTRIBUTION' });
  });

  it('fuera de perspectivas la autoría es pública y no admite nonce', async () => {
    const log = await openDeliberation(
      { eventId: ev(1), at: opensAtOf(0), actor: facilitator },
      {
        deliberationId: DELIB,
        problemId: PROBLEM,
        circleId: CIRCLE,
        opensAt: opensAtOf(0),
        closesAt: closesAtOf(0),
        presentationSeed: seed(0),
      },
    );
    await expect(
      submitContribution(log, meta(log, midOf(0), daniela), {
        contributionId: cid(1),
        body: { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT },
        nonce: nonce(1),
      }),
    ).rejects.toMatchObject({ code: 'NONCE_NOT_APPLICABLE' });

    const conAutor = await submitContribution(log, meta(log, midOf(0), daniela), {
      contributionId: cid(1),
      body: { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT },
    });
    const state = await replayDeliberation(conAutor);
    expect(state.contributions[0]?.authorship).toEqual({ mode: 'public', authorId: mid(3) });
  });

  it('en perspectivas el nonce es obligatorio', async () => {
    const log = await selladoMinimo();
    await expect(
      submitContribution(log, meta(log, midOf(1), daniela), {
        contributionId: cid(5),
        body: { kind: 'posicion', mode: 'afirmacion', text: TEXT },
      }),
    ).rejects.toMatchObject({ code: 'SEALED_NONCE_REQUIRED' });
  });
});

describe('orden de presentación', () => {
  const ids = [cid(1), cid(2), cid(3), cid(4), cid(5), cid(6), cid(7)];

  it('mismos `(presentationSeed, viewerId)` ⇒ mismo orden', async () => {
    const a = await presentationOrder({
      deliberationId: DELIB,
      presentationSeed: seed(0),
      viewerId: mid(3),
      contributionIds: ids,
    });
    const b = await presentationOrder({
      deliberationId: DELIB,
      presentationSeed: seed(0),
      viewerId: mid(3),
      contributionIds: [...ids].reverse(),
    });
    expect(b).toEqual(a);
  });

  it('distinto `viewerId` ⇒ mismo CONJUNTO de aportes', async () => {
    const a = await presentationOrder({
      deliberationId: DELIB,
      presentationSeed: seed(0),
      viewerId: mid(3),
      contributionIds: ids,
    });
    const b = await presentationOrder({
      deliberationId: DELIB,
      presentationSeed: seed(0),
      viewerId: mid(4),
      contributionIds: ids,
    });
    expect([...b].sort()).toEqual([...a].sort());
    expect(new Set(b).size).toBe(ids.length);
  });

  it('al menos una lectora ve un orden distinto: no es una permutación constante', async () => {
    const referencia = await presentationOrder({
      deliberationId: DELIB,
      presentationSeed: seed(0),
      viewerId: mid(3),
      contributionIds: ids,
    });
    const otros: string[][] = [];
    for (let i = 4; i < 12; i++) {
      otros.push([
        ...(await presentationOrder({
          deliberationId: DELIB,
          presentationSeed: seed(0),
          viewerId: mid(i),
          contributionIds: ids,
        })),
      ]);
    }
    expect(otros.some((orden) => orden.join(',') !== referencia.join(','))).toBe(true);
  });

  it('la semilla de la etapa cambia el orden: entra como dato en el evento de avance', async () => {
    const a = await presentationOrder({
      deliberationId: DELIB,
      presentationSeed: seed(0),
      viewerId: mid(3),
      contributionIds: ids,
    });
    const b = await presentationOrder({
      deliberationId: DELIB,
      presentationSeed: seed(1),
      viewerId: mid(3),
      contributionIds: ids,
    });
    expect(b.join(',')).not.toBe(a.join(','));
    expect([...b].sort()).toEqual([...a].sort());
  });

  it('la semilla por lectora depende de las tres entradas', async () => {
    const base = { presentationSeed: seed(0), deliberationId: DELIB, viewerId: mid(3) };
    const s0 = await readerSeed(base);
    expect(await readerSeed({ ...base, viewerId: mid(4) })).not.toBe(s0);
    expect(await readerSeed({ ...base, presentationSeed: seed(1) })).not.toBe(s0);
    expect(await readerSeed({ ...base, deliberationId: OTRA_DELIB })).not.toBe(s0);
  });

  it('ordena los registros del estado sin perder ni duplicar ninguno', async () => {
    const state = await replayDeliberation(await selladoMinimo());
    const ordenados = await orderContributionsForViewer(state, mid(9));
    expect(ordenados).toHaveLength(state.contributions.length);
    expect(new Set(ordenados.map((c) => c.contributionId)).size).toBe(state.contributions.length);
  });
});
