/**
 * Autoría con **alcance de etapa**, y orden de presentación.
 *
 * Lo que se fuerza aquí es la regla entera de ADR-0049: con `perspectivas` vigente, `authorize`
 * deniega leer la autoría **a todo el mundo** —incluida la facilitación, incluida garantías—, y en
 * cuanto la etapa avanza la concede a cualquier miembro del círculo. La denegación no depende del
 * rol: depende de la etapa. Por eso el intento se repite con cinco actores distintos y no con uno.
 *
 * ═══ Pruebas retiradas en ADR-0049, y por qué ═══
 *
 * De este fichero se retiraron **trece** pruebas al retirarse el sellado criptográfico, porque
 * comprobaban un mecanismo que ya no existe y no había forma de reescribirlas sin inventarles otro
 * objeto:
 *
 *  - las cinco de `el compromiso de autoría` (`hashCanonical` de la apertura, separación de
 *    dominios, ausencia del `authorId` en el evento, ausencia en el historial entero y el estado
 *    plegado sin autoría): no hay compromiso ni apertura que comprobar, y el `authorId` **sí** está
 *    en el evento a propósito;
 *  - las ocho de `la revelación` (recomputar el compromiso, `authorId` cambiado, nonce cambiado,
 *    destapar una sola vez, destapar fuera de etapa, destapar un aporte inexistente, nonce prohibido
 *    fuera de `perspectivas` y nonce obligatorio dentro): no hay revelación, porque no hay nada
 *    tapado en el evento.
 *
 * Las seis de `orden de presentación` siguen aquí sin un solo cambio: el orden aleatorio por lectora
 * no dependía del sellado y sigue siendo obligatorio.
 */

import { describe, expect, it } from 'vitest';

import { type Actor, denialReason } from '../src/access.js';
import {
  advanceStage,
  authorizeAuthorshipRead,
  type ContributionId,
  contributionId,
  deliberationId,
  type DeliberationCommandMeta,
  type DeliberationLog,
  openDeliberation,
  orderContributionsForViewer,
  presentationOrder,
  type PresentationSeed,
  presentationSeed,
  readContributionAuthor,
  readerSeed,
  replayDeliberation,
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
const OTRA_DELIB = deliberationId(hex32(0xd1));
const CIRCLE = circleId(hex32(0xc1));
const OTHER_CIRCLE = circleId(hex32(0xc2));
const PROBLEM = hex32(0xb1);

const mid = (n: number): MemberId => memberId(hex32(0x1000 + n));
const ev = (n: number): EventId => eventId(hex32(0x6000 + n));
const cid = (n: number): ContributionId => contributionId(hex32(0x7000 + n));
const seed = (n: number): PresentationSeed => presentationSeed(hex32(0xa000 + n));

const facilitator: Actor = { memberId: mid(1), roles: ['facilitator'], circles: [CIRCLE] };
const garantias: Actor = { memberId: mid(2), roles: ['guarantees'], circles: [CIRCLE] };
const daniela: Actor = { memberId: mid(3), roles: ['member'], circles: [CIRCLE] };
const julian: Actor = { memberId: mid(4), roles: ['member'], circles: [CIRCLE] };
const admin: Actor = { memberId: mid(5), roles: ['tech-admin'], circles: [CIRCLE] };
const forastera: Actor = { memberId: mid(8), roles: ['member'], circles: [OTHER_CIRCLE] };
const observador: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const opensAtOf = (i: number): Instant => instant(T0 + i * HOUR);
const closesAtOf = (i: number): Instant => instant(T0 + (i + 1) * HOUR);
const midOf = (i: number): Instant => instant(T0 + i * HOUR + HOUR / 2);

const TEXT = 'Una perspectiva de prueba con longitud más que suficiente para el historial.';

function meta(log: DeliberationLog, at: Instant, actor: Actor): DeliberationCommandMeta {
  return { eventId: ev(log.length + 1), at, actor };
}

/** Historial hasta `perspectivas`, con **una** perspectiva escrita por Daniela. */
async function enPerspectivas(): Promise<DeliberationLog> {
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
  });
}

/** El mismo historial, con la etapa `perspectivas` ya cerrada. */
async function despuesDePerspectivas(): Promise<DeliberationLog> {
  const log = await enPerspectivas();
  return advanceStage(log, meta(log, opensAtOf(2), facilitator), {
    to: 'construccion_alternativas',
    cause: 'deadline',
    opensAt: opensAtOf(2),
    closesAt: closesAtOf(2),
    presentationSeed: seed(2),
  });
}

describe('leer la autoría tiene alcance de etapa', () => {
  it('con `perspectivas` vigente se deniega, y NO por el rol: también a quien facilita', async () => {
    const state = replayDeliberation(await enPerspectivas());
    expect(state.stage).toBe('perspectivas');

    // Cinco actores, tres roles distintos y una única razón de denegación: la etapa.
    for (const actor of [daniela, julian, facilitator, garantias]) {
      expect(() => {
        authorizeAuthorshipRead(state, actor);
      }).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }));
      expect(() => readContributionAuthor(state, actor, cid(4))).toThrow(
        expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }),
      );
    }
  });

  it('cerrada la etapa, la conceden exactamente los mismos actores', async () => {
    const state = replayDeliberation(await despuesDePerspectivas());
    expect(state.stage).toBe('construccion_alternativas');
    for (const actor of [daniela, julian, facilitator, garantias]) {
      expect(() => {
        authorizeAuthorshipRead(state, actor);
      }).not.toThrow();
      expect(readContributionAuthor(state, actor, cid(4))).toBe(mid(3));
    }
  });

  it('quien escribió la perspectiva tampoco se lee a sí misma antes de tiempo', async () => {
    // Ni una excepción para el autor: el dominio no distingue, y si distinguiera, quien leyera la
    // respuesta sabría que ese aporte es suyo.
    const state = replayDeliberation(await enPerspectivas());
    expect(() => readContributionAuthor(state, daniela, cid(4))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }),
    );
  });

  it('la etapa no es lo único que se comprueba: círculo, identidad y rol siguen vigentes', async () => {
    const state = replayDeliberation(await despuesDePerspectivas());
    expect(() => readContributionAuthor(state, forastera, cid(4))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED_NOT_IN_CIRCLE' }),
    );
    expect(() => readContributionAuthor(state, observador, cid(4))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED_NOT_AUTHENTICATED' }),
    );
    // `tech-admin` no obtiene la lectura por la matriz. Lo que sí puede hacer —leer la base de
    // datos— queda fuera del alcance de esta regla, y ADR-0049 lo declara en vez de disimularlo.
    expect(() => readContributionAuthor(state, admin, cid(4))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' }),
    );
  });

  it('un aporte inexistente sólo se distingue DESPUÉS de autorizar', async () => {
    // El orden importa: si el «no existe» llegara antes que el permiso, una persona podría sondear
    // qué identificadores hay durante la etapa a ciegas.
    const abierta = replayDeliberation(await enPerspectivas());
    expect(() => readContributionAuthor(abierta, daniela, cid(90))).toThrow(
      expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }),
    );
    const cerrada = replayDeliberation(await despuesDePerspectivas());
    expect(() => readContributionAuthor(cerrada, daniela, cid(90))).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_CONTRIBUTION' }),
    );
  });

  it('la etapa la deriva el dominio del historial, no la declara quien llama', async () => {
    const state = replayDeliberation(await enPerspectivas());
    // Por la puerta del dominio no hay forma de mentir sobre la etapa…
    expect(() => {
      authorizeAuthorshipRead(state, daniela);
    }).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }));
    // …y si alguien construye el recurso a mano y omite la etapa, se falla cerrado.
    expect(
      denialReason(daniela, 'deliberation:read-authorship', {
        kind: 'deliberation',
        circleId: CIRCLE,
      }),
    ).toBe('STAGE_UNKNOWN');
  });

  it('el autor SÍ está en el evento: lo que la etapa cambia es quién puede leerlo', async () => {
    const log = await enPerspectivas();
    const evento = log[log.length - 1];
    expect(evento).toBeDefined();
    if (evento === undefined) return;
    // Se afirma sin adornos, porque es lo que ADR-0049 declara: el dato está, y quien lee la base
    // de datos lo ve. La protección es frente a los pares que pasan por el dominio, no frente a
    // quien administra el servidor.
    expect(evento.actor).toBe(mid(3));
    expect(JSON.stringify(evento)).toContain('authorId');
    expect(replayDeliberation(log).contributions[0]?.authorId).toBe(mid(3));
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
    const state = replayDeliberation(await enPerspectivas());
    const ordenados = await orderContributionsForViewer(state, mid(9));
    expect(ordenados).toHaveLength(state.contributions.length);
    expect(new Set(ordenados.map((c) => c.contributionId)).size).toBe(state.contributions.length);
  });
});
