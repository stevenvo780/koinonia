/**
 * Las órdenes de la deliberación: ventanas reales, grafo tipado y autorización.
 *
 * Lo que se fuerza aquí es lo que un sistema de fases decorativo pasaría sin enterarse: un aporte
 * escrito un milisegundo después del cierre, una evidencia colgada de una posición en vez de una
 * razón, un `tech-admin` escribiendo, y una etapa que avanza dejando perspectivas sin dueño.
 */

import { describe, expect, it } from 'vitest';

import type { Actor } from '../src/access.js';
import {
  advanceStage,
  type AuthorNonce,
  authorNonce,
  type ContributionBody,
  type ContributionId,
  contributionId,
  currentContributions,
  DELIBERATION_STAGES,
  type DeliberationCommandMeta,
  type DeliberationEvent,
  deliberationNonce,
  deliberationId,
  type DeliberationLog,
  type DeliberationStage,
  applyDeliberation,
  isAcyclic,
  openDeliberation,
  type PresentationSeed,
  presentationSeed,
  replayDeliberation,
  revealContributionAuthor,
  submitContribution,
  verifyDeliberationLog,
} from '../src/deliberation/index.js';
import {
  circleId,
  eventId,
  type EventId,
  hash,
  type Instant,
  instant,
  type MemberId,
  memberId,
} from '../src/ids.js';

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');

const DELIB = deliberationId(hex32(0xd0));
const DELIBERATION_NONCE = deliberationNonce(hex32(0xd2));
const CIRCLE = circleId(hex32(0xc1));
const OTHER_CIRCLE = circleId(hex32(0xc2));
const PROBLEM = hex32(0xb1);

const mid = (n: number): MemberId => memberId(hex32(0x1000 + n));
const ev = (n: number): EventId => eventId(hex32(0x6000 + n));
const cid = (n: number): ContributionId => contributionId(hex32(0x7000 + n));
const nonce = (n: number): AuthorNonce => authorNonce(hex32(0x9000 + n));
const seed = (n: number): PresentationSeed => presentationSeed(hex32(0xa000 + n));

const facilitator: Actor = { memberId: mid(1), roles: ['facilitator'], circles: [CIRCLE] };
const garantias: Actor = { memberId: mid(2), roles: ['guarantees'], circles: [CIRCLE] };
const daniela: Actor = { memberId: mid(3), roles: ['member'], circles: [CIRCLE] };
const julian: Actor = { memberId: mid(4), roles: ['member'], circles: [CIRCLE] };
const admin: Actor = { memberId: mid(5), roles: ['tech-admin'], circles: [CIRCLE] };
const observador: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const indexOfStage = (stage: DeliberationStage): number => DELIBERATION_STAGES.indexOf(stage);
const opensAtOf = (i: number): Instant => instant(T0 + i * HOUR);
const closesAtOf = (i: number): Instant => instant(T0 + (i + 1) * HOUR);
const midOf = (i: number): Instant => instant(T0 + i * HOUR + HOUR / 2);

function meta(log: DeliberationLog, at: Instant, actor: Actor): DeliberationCommandMeta {
  return { eventId: ev(log.length + 1), at, actor };
}

const TEXT = 'Un aporte de prueba con longitud más que suficiente para el mínimo del historial.';

async function abrir(actor: Actor = facilitator): Promise<DeliberationLog> {
  return openDeliberation(
    { eventId: ev(1), at: opensAtOf(0), actor },
    {
      deliberationId: DELIB,
      problemId: PROBLEM,
      circleId: CIRCLE,
      opensAt: opensAtOf(0),
      closesAt: closesAtOf(0),
      presentationSeed: seed(0),
    },
  );
}

/** Avanza una etapa por plazo vencido, abriendo la ventana siguiente justo al cerrar la anterior. */
async function avanzar(log: DeliberationLog, actor: Actor = facilitator): Promise<DeliberationLog> {
  const state = await replayDeliberation(log);
  const i = indexOfStage(state.stage) + 1;
  const to = DELIBERATION_STAGES[i];
  if (to === undefined) throw new Error('no hay etapa siguiente');
  return advanceStage(log, meta(log, opensAtOf(i), actor), {
    to,
    cause: 'deadline',
    opensAt: opensAtOf(i),
    closesAt: closesAtOf(i),
    presentationSeed: seed(i),
  });
}

async function aportar(
  log: DeliberationLog,
  actor: Actor,
  id: ContributionId,
  body: ContributionBody,
  extra: { readonly nonce?: AuthorNonce; readonly supersedes?: ContributionId } = {},
): Promise<DeliberationLog> {
  const state = await replayDeliberation(log);
  const at = midOf(indexOfStage(state.stage));
  return submitContribution(log, meta(log, at, actor), {
    contributionId: id,
    body,
    ...(extra.nonce === undefined ? {} : { nonce: extra.nonce }),
    ...(extra.nonce === undefined ? {} : { deliberationNonce: DELIBERATION_NONCE }),
    ...(extra.supersedes === undefined ? {} : { supersedesContributionId: extra.supersedes }),
  });
}

/** Guion completo: una deliberación llevada hasta `objetivo` con aportes de cada tipo. */
async function guion(objetivo: DeliberationStage): Promise<DeliberationLog> {
  let log = await abrir();
  if (objetivo === 'preguntas_aclaratorias') {
    log = await aportar(log, daniela, cid(1), {
      kind: 'posicion',
      mode: 'pregunta_aclaratoria',
      text: TEXT,
    });
    return log;
  }

  log = await aportar(log, daniela, cid(1), {
    kind: 'posicion',
    mode: 'pregunta_aclaratoria',
    text: TEXT,
  });
  log = await aportar(log, julian, cid(2), {
    kind: 'razon',
    relation: 'responde',
    positionId: cid(1),
    text: TEXT,
  });
  log = await aportar(log, daniela, cid(3), {
    kind: 'evidencia',
    supportsReasonId: cid(2),
    text: TEXT,
  });
  log = await avanzar(log);
  if (objetivo === 'perspectivas') return log;

  log = await aportar(
    log,
    daniela,
    cid(4),
    { kind: 'posicion', mode: 'afirmacion', text: TEXT },
    { nonce: nonce(4) },
  );
  log = await aportar(
    log,
    julian,
    cid(5),
    { kind: 'razon', relation: 'sostiene', positionId: cid(4), text: TEXT },
    { nonce: nonce(5) },
  );
  log = await avanzar(log);
  if (objetivo === 'perspectivas_revelando') return log;

  log = await revealContributionAuthor(log, meta(log, midOf(2), garantias), {
    contributionId: cid(4),
    authorId: mid(3),
    nonce: nonce(4),
    deliberationNonce: DELIBERATION_NONCE,
  });
  log = await revealContributionAuthor(log, meta(log, midOf(2), garantias), {
    contributionId: cid(5),
    authorId: mid(4),
    nonce: nonce(5),
    deliberationNonce: DELIBERATION_NONCE,
  });
  log = await avanzar(log);
  if (objetivo === 'construccion_alternativas') return log;

  log = await aportar(log, daniela, cid(6), {
    kind: 'alternativa',
    problemId: PROBLEM,
    sourcePositionIds: [cid(4)],
    text: TEXT,
  });
  log = await avanzar(log);
  if (objetivo === 'objeciones') return log;

  log = await aportar(log, julian, cid(7), {
    kind: 'riesgo',
    alternativeId: cid(6),
    severity: 4,
    impact: TEXT,
    mitigation: TEXT,
  });
  log = await avanzar(log);
  if (objetivo === 'enmiendas') return log;

  log = await aportar(
    log,
    daniela,
    cid(8),
    { kind: 'alternativa', problemId: PROBLEM, sourcePositionIds: [cid(4)], text: TEXT },
    { supersedes: cid(6) },
  );
  return avanzar(log);
}

describe('apertura', () => {
  it('abre en `preguntas_aclaratorias` con su ventana y su semilla', async () => {
    const state = await replayDeliberation(await abrir());
    expect(state.exists).toBe(true);
    expect(state.stage).toBe('preguntas_aclaratorias');
    expect(state.opensAt).toBe(opensAtOf(0));
    expect(state.closesAt).toBe(closesAtOf(0));
    expect(state.presentationSeed).toBe(seed(0));
    expect(state.problemId).toBe(PROBLEM);
  });

  it('un miembro raso no abre una deliberación', async () => {
    await expect(abrir(daniela)).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
  });

  it('`tech-admin` no abre nada: no tiene ninguna capacidad de escritura', async () => {
    await expect(abrir(admin)).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
  });

  it('quien facilita otro círculo no abre aquí', async () => {
    const forastero: Actor = { memberId: mid(9), roles: ['facilitator'], circles: [OTHER_CIRCLE] };
    await expect(abrir(forastero)).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_IN_CIRCLE' });
  });

  it('el observador anónimo no abre nada', async () => {
    await expect(abrir(observador)).rejects.toMatchObject({
      code: 'UNAUTHORIZED_NOT_AUTHENTICATED',
    });
  });

  it('una ventana invertida se rechaza', async () => {
    await expect(
      openDeliberation(
        { eventId: ev(1), at: opensAtOf(0), actor: facilitator },
        {
          deliberationId: DELIB,
          problemId: PROBLEM,
          circleId: CIRCLE,
          opensAt: closesAtOf(0),
          closesAt: opensAtOf(0),
          presentationSeed: seed(0),
        },
      ),
    ).rejects.toMatchObject({ code: 'WINDOW_INVERTED' });
  });

  it('una etapa no se abre en el pasado', async () => {
    await expect(
      openDeliberation(
        { eventId: ev(1), at: closesAtOf(0), actor: facilitator },
        {
          deliberationId: DELIB,
          problemId: PROBLEM,
          circleId: CIRCLE,
          opensAt: opensAtOf(0),
          closesAt: closesAtOf(0),
          presentationSeed: seed(0),
        },
      ),
    ).rejects.toMatchObject({ code: 'WINDOW_OPENS_IN_THE_PAST' });
  });
});

describe('la ventana de escritura es real', () => {
  it('un aporte dentro de la ventana entra', async () => {
    const state = await replayDeliberation(await guion('preguntas_aclaratorias'));
    expect(state.contributions).toHaveLength(1);
    expect(state.contributions[0]?.submittedAt).toBe(midOf(0));
  });

  it('un aporte en el instante exacto del cierre se rechaza: el intervalo es [opensAt, closesAt)', async () => {
    const log = await abrir();
    await expect(
      submitContribution(log, meta(log, closesAtOf(0), daniela), {
        contributionId: cid(1),
        body: { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT },
      }),
    ).rejects.toMatchObject({ code: 'WRITE_WINDOW_CLOSED' });
  });

  it('la ventana cierra sola: el aporte tardío falla aunque el avance NO se haya escrito', async () => {
    const log = await abrir();
    const state = await replayDeliberation(log);
    // La etapa vigente sigue siendo la primera: nadie escribió `StageAdvanced`.
    expect(state.stage).toBe('preguntas_aclaratorias');
    await expect(
      submitContribution(log, meta(log, instant(T0 + HOUR + 1), daniela), {
        contributionId: cid(1),
        body: { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT },
      }),
    ).rejects.toMatchObject({ code: 'WRITE_WINDOW_CLOSED' });
  });

  it('un aporte anterior a la apertura tampoco entra', async () => {
    const log = await abrir();
    await expect(
      submitContribution(log, meta(log, instant(T0 - 1), daniela), {
        contributionId: cid(1),
        body: { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT },
      }),
    ).rejects.toMatchObject({ code: 'WRITE_WINDOW_NOT_OPEN' });
  });

  it('un aporte tardío no se reubica en la etapa siguiente: simplemente no está', async () => {
    const log = await guion('perspectivas');
    const state = await replayDeliberation(log);
    expect(state.stage).toBe('perspectivas');
    // Nada de la etapa anterior quedó pendiente ni se arrastró.
    expect(state.contributions.map((c) => c.stage)).toEqual([
      'preguntas_aclaratorias',
      'preguntas_aclaratorias',
      'preguntas_aclaratorias',
    ]);
  });
});

describe('grafo tipado', () => {
  it('una razón exige una posición existente', async () => {
    const log = await abrir();
    await expect(
      aportar(log, daniela, cid(2), {
        kind: 'razon',
        relation: 'responde',
        positionId: cid(1),
        text: TEXT,
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_CONTRIBUTION_REFERENCE' });
  });

  it('una evidencia colgada de una posición en vez de una razón se rechaza', async () => {
    const log = await guion('preguntas_aclaratorias');
    await expect(
      aportar(log, daniela, cid(3), { kind: 'evidencia', supportsReasonId: cid(1), text: TEXT }),
    ).rejects.toMatchObject({ code: 'WRONG_REFERENCE_KIND' });
  });

  it('un riesgo exige una alternativa, no una posición', async () => {
    const log = await guion('objeciones');
    await expect(
      aportar(log, julian, cid(7), {
        kind: 'riesgo',
        alternativeId: cid(4),
        severity: 2,
        impact: TEXT,
        mitigation: TEXT,
      }),
    ).rejects.toMatchObject({ code: 'WRONG_REFERENCE_KIND' });
  });

  it('un supuesto sin destinos no es un supuesto', async () => {
    const log = await guion('perspectivas');
    await expect(
      aportar(
        log,
        daniela,
        cid(9),
        { kind: 'supuesto', appliesToContributionIds: [], text: TEXT },
        { nonce: nonce(9) },
      ),
    ).rejects.toMatchObject({ code: 'ASSUMPTION_WITHOUT_TARGET' });
  });

  it('los conjuntos de aristas llegan ordenados: entran en la preimagen de hash', async () => {
    const log = await guion('construccion_alternativas');
    await expect(
      aportar(log, daniela, cid(6), {
        kind: 'alternativa',
        problemId: PROBLEM,
        sourcePositionIds: [cid(4), cid(1)],
        text: TEXT,
      }),
    ).rejects.toMatchObject({ code: 'REFERENCES_NOT_SORTED' });

    await expect(
      aportar(log, daniela, cid(6), {
        kind: 'alternativa',
        problemId: PROBLEM,
        sourcePositionIds: [cid(1), cid(1)],
        text: TEXT,
      }),
    ).rejects.toMatchObject({ code: 'REFERENCES_NOT_SORTED' });
  });

  it('una alternativa exige un problema: no se propone sin problema', async () => {
    const log = await guion('construccion_alternativas');
    await expect(
      aportar(log, daniela, cid(6), {
        kind: 'alternativa',
        problemId: 'no-es-un-identificador',
        sourcePositionIds: [cid(4)],
        text: TEXT,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ID' });
  });

  it('una corrección supersede a un aporte del MISMO tipo', async () => {
    const log = await guion('enmiendas');
    await expect(
      aportar(
        log,
        daniela,
        cid(8),
        { kind: 'alternativa', problemId: PROBLEM, sourcePositionIds: [cid(4)], text: TEXT },
        { supersedes: cid(7) },
      ),
    ).rejects.toMatchObject({ code: 'WRONG_REFERENCE_KIND' });
  });

  it('el original permanece cuando otro aporte lo supersede', async () => {
    const state = await replayDeliberation(await guion('listo_para_decidir'));
    expect(state.contributions.map((c) => c.contributionId)).toContain(cid(6));
    expect(currentContributions(state).map((c) => c.contributionId)).not.toContain(cid(6));
    expect(currentContributions(state).map((c) => c.contributionId)).toContain(cid(8));
  });

  it('el grafo resultante es acíclico', async () => {
    const state = await replayDeliberation(await guion('listo_para_decidir'));
    expect(state.contributions.length).toBeGreaterThan(0);
    expect(isAcyclic(state)).toBe(true);
  });

  it('un historial con `seq` manipulado hacia atrás se rechaza por referencia hacia adelante', async () => {
    // En una cadena bien formada esto es inalcanzable: `seq` es denso y creciente, y el destino de
    // una arista siempre se escribió antes. La comprobación existe como segunda línea de defensa,
    // para que un historial fabricado a mano no cuele un ciclo aunque `verifyChain` no se llame.
    const state = await replayDeliberation(await guion('preguntas_aclaratorias'));
    const forjado: DeliberationEvent = {
      eventId: ev(90),
      aggregateId: DELIB,
      // La posición de destino está en `seq` 2; este aporte dice ser el 2 también.
      seq: 2,
      occurredAt: midOf(0),
      actor: mid(4),
      payload: {
        type: 'ContributionSubmitted',
        contributionId: cid(50),
        stage: 'preguntas_aclaratorias',
        body: { kind: 'razon', relation: 'responde', positionId: cid(1), text: TEXT },
        authorship: { mode: 'public', authorId: mid(4) },
      },
      prevHash: hash('0'.repeat(64)),
      hash: hash('1'.repeat(64)),
    };
    await expect(applyDeliberation(state, forjado)).rejects.toMatchObject({
      code: 'FORWARD_REFERENCE',
    });
  });
});

describe('autorización', () => {
  it('`tech-admin` no aporta, no avanza y no revela', async () => {
    const log = await guion('preguntas_aclaratorias');
    await expect(
      aportar(log, admin, cid(20), { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
    await expect(avanzar(log, admin)).rejects.toMatchObject({
      code: 'UNAUTHORIZED_ROLE_NOT_GRANTED',
    });
    const revelando = await guion('perspectivas_revelando');
    await expect(
      revealContributionAuthor(revelando, meta(revelando, midOf(2), admin), {
        contributionId: cid(4),
        authorId: mid(3),
        nonce: nonce(4),
        deliberationNonce: DELIBERATION_NONCE,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
  });

  it('el observador anónimo no aporta', async () => {
    const log = await guion('preguntas_aclaratorias');
    await expect(
      aportar(log, observador, cid(20), {
        kind: 'posicion',
        mode: 'pregunta_aclaratoria',
        text: TEXT,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_AUTHENTICATED' });
  });

  it('un miembro de otro círculo no puede aportar', async () => {
    const forastera: Actor = { memberId: mid(8), roles: ['member'], circles: [OTHER_CIRCLE] };
    const log = await guion('preguntas_aclaratorias');
    await expect(
      aportar(log, forastera, cid(21), {
        kind: 'posicion',
        mode: 'pregunta_aclaratoria',
        text: TEXT,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_NOT_IN_CIRCLE' });
  });

  it('un miembro raso no avanza de etapa', async () => {
    const log = await guion('preguntas_aclaratorias');
    await expect(avanzar(log, daniela)).rejects.toMatchObject({
      code: 'UNAUTHORIZED_ROLE_NOT_GRANTED',
    });
  });

  it('quien facilita NO destapa autorías: sólo garantías', async () => {
    const log = await guion('perspectivas_revelando');
    await expect(
      revealContributionAuthor(log, meta(log, midOf(2), facilitator), {
        contributionId: cid(4),
        authorId: mid(3),
        nonce: nonce(4),
        deliberationNonce: DELIBERATION_NONCE,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
  });

  it('garantías sí destapa', async () => {
    const log = await guion('perspectivas_revelando');
    const revelado = await revealContributionAuthor(log, meta(log, midOf(2), garantias), {
      contributionId: cid(4),
      authorId: mid(3),
      nonce: nonce(4),
      deliberationNonce: DELIBERATION_NONCE,
    });
    const state = await replayDeliberation(revelado);
    expect(state.contributions.find((c) => c.contributionId === cid(4))?.revealedAuthorId).toBe(
      mid(3),
    );
  });
});

describe('avance de etapa', () => {
  it('el avance manual no exige plazo vencido', async () => {
    const log = await guion('preguntas_aclaratorias');
    const avanzado = await advanceStage(log, meta(log, midOf(0), facilitator), {
      to: 'perspectivas',
      cause: 'manual',
      opensAt: midOf(0),
      closesAt: closesAtOf(1),
      presentationSeed: seed(1),
    });
    expect((await replayDeliberation(avanzado)).stage).toBe('perspectivas');
  });

  it('el avance por plazo exige que la ventana haya vencido', async () => {
    const log = await guion('preguntas_aclaratorias');
    await expect(
      advanceStage(log, meta(log, midOf(0), facilitator), {
        to: 'perspectivas',
        cause: 'deadline',
        opensAt: midOf(0),
        closesAt: closesAtOf(1),
        presentationSeed: seed(1),
      }),
    ).rejects.toMatchObject({ code: 'DEADLINE_NOT_REACHED' });
  });

  it('no se salta ninguna etapa', async () => {
    const log = await guion('preguntas_aclaratorias');
    await expect(
      advanceStage(log, meta(log, opensAtOf(2), facilitator), {
        to: 'perspectivas_revelando',
        cause: 'deadline',
        opensAt: opensAtOf(2),
        closesAt: closesAtOf(2),
        presentationSeed: seed(2),
      }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });

  it('no se sale de `perspectivas_revelando` con perspectivas sin destapar', async () => {
    const log = await guion('perspectivas_revelando');
    await expect(avanzar(log)).rejects.toMatchObject({ code: 'UNREVEALED_AUTHORSHIP' });
  });

  it('destapadas todas, ya se puede avanzar', async () => {
    const state = await replayDeliberation(await guion('construccion_alternativas'));
    expect(state.stage).toBe('construccion_alternativas');
    expect(state.contributions.filter((c) => c.authorship.mode === 'sealed')).toHaveLength(2);
    for (const c of state.contributions.filter((x) => x.authorship.mode === 'sealed')) {
      expect(c.revealedAuthorId).toBeDefined();
    }
  });

  it('`listo_para_decidir` es terminal y no admite nada', async () => {
    const log = await guion('listo_para_decidir');
    const state = await replayDeliberation(log);
    expect(state.stage).toBe('listo_para_decidir');
    await expect(
      aportar(log, daniela, cid(30), { kind: 'posicion', mode: 'afirmacion', text: TEXT }),
    ).rejects.toMatchObject({ code: 'CONTRIBUTION_KIND_NOT_ALLOWED' });
    await expect(
      advanceStage(log, meta(log, opensAtOf(7), facilitator), {
        to: 'preguntas_aclaratorias',
        cause: 'manual',
        opensAt: opensAtOf(7),
        closesAt: closesAtOf(7),
        presentationSeed: seed(7),
      }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });
});

describe('integridad del historial', () => {
  it('un identificador de aporte no se repite', async () => {
    const log = await guion('preguntas_aclaratorias');
    await expect(
      aportar(log, julian, cid(1), { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_CONTRIBUTION' });
  });

  it('el guion completo verifica cadena y plegado', async () => {
    const log = await guion('listo_para_decidir');
    const state = await verifyDeliberationLog(log);
    expect(state.stage).toBe('listo_para_decidir');
    expect(state.lastSeq).toBe(log.length);
  });

  it('alterar un aporte rompe la cadena', async () => {
    const log = await guion('objeciones');
    const primero = log[1];
    expect(primero).toBeDefined();
    if (primero === undefined) return;
    const manipulado = [
      log[0],
      {
        ...primero,
        payload: {
          ...primero.payload,
          type: 'ContributionSubmitted' as const,
          contributionId: cid(99),
          stage: 'preguntas_aclaratorias' as const,
          body: { kind: 'posicion' as const, mode: 'pregunta_aclaratoria' as const, text: TEXT },
          authorship: { mode: 'public' as const, authorId: mid(3) },
        },
      },
      ...log.slice(2),
    ].filter((e): e is DeliberationEvent => e !== undefined);
    await expect(verifyDeliberationLog(manipulado)).rejects.toMatchObject({ code: 'BROKEN_LOG' });
  });

  it('un historial vacío no identifica ninguna deliberación', async () => {
    await expect(replayDeliberation([])).rejects.toMatchObject({ code: 'EMPTY_LOG' });
  });
});
