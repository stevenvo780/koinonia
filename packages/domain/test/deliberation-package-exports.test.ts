/**
 * El agregado de deliberación tiene que ser alcanzable desde `@koinonia/domain`.
 *
 * Hasta ADR-0049 no lo era: `src/index.ts` no reexportaba `./deliberation/index.js`, así que todo
 * este trabajo sólo existía para quien importara por ruta relativa dentro del propio paquete. Un
 * agregado que no se puede importar desde el punto de entrada del paquete es, a efectos de
 * cualquier consumidor, un agregado que no está.
 *
 * Este fichero importa **exclusivamente** desde `@koinonia/domain` —el especificador público, no la
 * ruta interna— y ejecuta el ciclo entero. Si alguien vuelve a quitar el reexport, esto deja de
 * compilar con `TS2305` y de pasar, que es exactamente lo que se quiere.
 */

import { describe, expect, it } from 'vitest';

import {
  type Actor,
  advanceStage,
  authorizeAuthorshipRead,
  can,
  circleId,
  contributionId,
  currentContributions,
  DELIBERATION_STAGES,
  type DeliberationLog,
  deliberationId,
  eventId,
  instant,
  isAcyclic,
  memberId,
  openDeliberation,
  presentationSeed,
  readContributionAuthor,
  replayDeliberation,
  STAGE_RULES,
  submitContribution,
  verifyDeliberationLog,
} from '@koinonia/domain';

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');

const DELIB = deliberationId(hex32(0xd0));
const CIRCLE = circleId(hex32(0xc1));
const PROBLEM = hex32(0xb1);
const AUTORA = memberId(hex32(0x1003));

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const facilitadora: Actor = {
  memberId: memberId(hex32(0x1001)),
  roles: ['facilitator'],
  circles: [CIRCLE],
};
const daniela: Actor = { memberId: AUTORA, roles: ['member'], circles: [CIRCLE] };

const TEXT = 'Un aporte de prueba con longitud más que suficiente para el mínimo del historial.';

describe('`@koinonia/domain` exporta el agregado de deliberación', () => {
  it('expone los tipos, las tablas y las órdenes por el punto de entrada del paquete', () => {
    expect(DELIBERATION_STAGES).toEqual([
      'preguntas_aclaratorias',
      'perspectivas',
      'construccion_alternativas',
      'objeciones',
      'enmiendas',
      'listo_para_decidir',
    ]);
    expect(STAGE_RULES.listo_para_decidir.kinds).toEqual([]);
    expect(typeof openDeliberation).toBe('function');
    expect(typeof submitContribution).toBe('function');
    expect(typeof advanceStage).toBe('function');
    expect(typeof readContributionAuthor).toBe('function');
  });

  it('deja recorrer una deliberación entera sin tocar una sola ruta interna', async () => {
    let log: DeliberationLog = await openDeliberation(
      { eventId: eventId(hex32(0x6001)), at: instant(T0), actor: facilitadora },
      {
        deliberationId: DELIB,
        problemId: PROBLEM,
        circleId: CIRCLE,
        opensAt: instant(T0),
        closesAt: instant(T0 + HOUR),
        presentationSeed: presentationSeed(hex32(0xa000)),
      },
    );
    log = await advanceStage(
      log,
      { eventId: eventId(hex32(0x6002)), at: instant(T0 + HOUR), actor: facilitadora },
      {
        to: 'perspectivas',
        cause: 'deadline',
        opensAt: instant(T0 + HOUR),
        closesAt: instant(T0 + 2 * HOUR),
        presentationSeed: presentationSeed(hex32(0xa001)),
      },
    );
    log = await submitContribution(
      log,
      { eventId: eventId(hex32(0x6003)), at: instant(T0 + HOUR + 1), actor: daniela },
      {
        contributionId: contributionId(hex32(0x7001)),
        body: { kind: 'posicion', mode: 'afirmacion', text: TEXT },
      },
    );

    const abierta = replayDeliberation(log);
    expect(abierta.stage).toBe('perspectivas');
    expect(currentContributions(abierta)).toHaveLength(1);
    expect(isAcyclic(abierta)).toBe(true);

    // La regla de ADR-0049, comprobada desde fuera del paquete: con la etapa abierta, no se lee.
    expect(
      can(daniela, 'deliberation:read-authorship', {
        kind: 'deliberation',
        stage: abierta.stage,
        circleId: abierta.circleId,
      }),
    ).toBe(false);
    expect(() => {
      authorizeAuthorshipRead(abierta, daniela);
    }).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }));

    log = await advanceStage(
      log,
      { eventId: eventId(hex32(0x6004)), at: instant(T0 + 2 * HOUR), actor: facilitadora },
      {
        to: 'construccion_alternativas',
        cause: 'deadline',
        opensAt: instant(T0 + 2 * HOUR),
        closesAt: instant(T0 + 3 * HOUR),
        presentationSeed: presentationSeed(hex32(0xa002)),
      },
    );

    const cerrada = await verifyDeliberationLog(log);
    expect(cerrada.stage).toBe('construccion_alternativas');
    expect(readContributionAuthor(cerrada, daniela, contributionId(hex32(0x7001)))).toBe(AUTORA);
  });
});
