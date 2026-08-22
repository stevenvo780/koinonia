/**
 * El agregado de constitución tiene que ser alcanzable desde `@koinonia/domain`.
 *
 * La lección es de ADR-0049: la deliberación estuvo terminada y probada durante una entrega entera
 * sin que `src/index.ts` la reexportara, así que para cualquier consumidor del paquete no existía.
 * Un agregado que no se puede importar desde el punto de entrada es un agregado que no está.
 *
 * Este fichero importa **exclusivamente** desde `@koinonia/domain` —el especificador público, no la
 * ruta interna— y ejecuta el ciclo entero: fundar, reformar, firmar, ratificar y recuperar la
 * versión histórica. Si alguien quita el reexport, esto deja de compilar con `TS2305`.
 *
 * De paso fija el nombre público de una función: `versionAt` ya existía para las propuestas, así que
 * la de la constitución se exporta como `constitutionVersionAt`. Si el alias desaparece, aquí se
 * nota antes que en el consumidor.
 */

import { describe, expect, it } from 'vitest';

import {
  type Actor,
  approveReform,
  type Clause,
  type ConstitutionLog,
  type ConstitutionText,
  circleId,
  constitutionCoreHash,
  constitutionId,
  constitutionVersionAt,
  CORE_CLAUSE_IDS,
  currentText,
  decisionId,
  denialReason,
  ENTRENCHED_REFORM_V1,
  eventId,
  foundConstitution,
  hash,
  instant,
  memberId,
  openReform,
  ORDINARY_REFORM_V1,
  ratifyReform,
  recordReformVote,
  reformId,
  replayConstitution,
  statusAt,
  verifyConstitutionLog,
} from '@koinonia/domain';

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');
const hex64 = (n: number): string => n.toString(16).padStart(64, '0');

const DIA = 86_400_000;
const T0 = instant(1_700_000_000_000);
const en = (dias: number): number => T0 + dias * DIA;

describe('el agregado se alcanza desde `@koinonia/domain`', () => {
  it('ciclo completo por el especificador público, y el núcleo intacto al final', async () => {
    const consti = constitutionId(hex32(0xc0));
    const circulo = circleId(hex32(0xc1));
    const facilitadora: Actor = {
      memberId: memberId(hex32(0x1001)),
      roles: ['facilitator'],
      circles: [circulo],
    };
    const miembro: Actor = {
      memberId: memberId(hex32(0x1030)),
      roles: ['member'],
      circles: [circulo],
    };
    const garantes = [0, 1, 2, 3, 4].map((i) => memberId(hex32(0x1020 + i)));
    const nucleo: readonly Clause[] = CORE_CLAUSE_IDS.map((id, i) => ({
      clauseId: id,
      textHash: hash(hex64(0x100 + i)),
    }));
    const texto: ConstitutionText = {
      clauses: [
        ...nucleo,
        { clauseId: 'zona_horaria' as Clause['clauseId'], textHash: hash(hex64(0x200)) },
      ].sort((a, b) => (a.clauseId < b.clauseId ? -1 : 1)),
      ordinary: ORDINARY_REFORM_V1,
      entrenched: ENTRENCHED_REFORM_V1,
      validityMonths: 12,
    };
    const ev = (log: ConstitutionLog): ReturnType<typeof eventId> =>
      eventId(hex32(0x6000 + log.length + 1));

    let log = await foundConstitution(
      [],
      { eventId: ev([]), at: T0, actor: facilitadora },
      {
        constitutionId: consti,
        text: texto,
        core: nucleo,
        foundingDecisionId: decisionId(hex32(0xd1)),
        censusSize: 300,
        castBallots: 150,
        votesInFavor: 100,
        directParticipation: 100,
        effectiveAt: T0,
      },
    );

    const reforma = reformId(hex32(0xf1));
    log = await openReform(
      log,
      { eventId: ev(log), at: instant(en(1)), actor: miembro },
      {
        reformId: reforma,
        kind: 'ordinaria',
        targetVersion: 1,
        proposedText: {
          ...texto,
          clauses: texto.clauses.map((c) =>
            c.clauseId === 'zona_horaria' ? { ...c, textHash: hash(hex64(0x2000)) } : c,
          ),
        },
        censusSize: 300,
        guarantors: garantes,
        calendar: { semesterEndsAt: instant(en(900)), convened: [] },
        sponsorCount: 30,
        deliberationOpensAt: instant(en(1)),
        deliberationClosesAt: instant(en(22)),
      },
    );
    log = await recordReformVote(
      log,
      { eventId: ev(log), at: instant(en(29)), actor: facilitadora },
      {
        reformId: reforma,
        vote: {
          round: 1,
          decisionId: decisionId(hex32(0xd2)),
          votesInFavor: 200,
          directParticipation: 100,
          opensAt: instant(en(22)),
          closesAt: instant(en(29)),
        },
      },
    );
    for (const g of [0, 1, 2]) {
      log = await approveReform(
        log,
        {
          eventId: ev(log),
          at: instant(en(30)),
          actor: { memberId: garantes[g], roles: ['guarantees'], circles: [circulo] },
        },
        { reformId: reforma },
      );
    }
    log = await ratifyReform(
      log,
      { eventId: ev(log), at: instant(en(43)), actor: facilitadora },
      { reformId: reforma, effectiveAt: instant(en(43)) },
    );

    const publicado = await constitutionCoreHash(nucleo);
    const estado = await verifyConstitutionLog(log, { expectedCoreHash: publicado });
    expect(estado.currentVersion).toBe(2);
    expect(statusAt(estado, T0)).toBe('vigente');
    expect(currentText(estado)!.clauses).toHaveLength(7);
    expect(constitutionVersionAt(estado, 1)!.text.clauses).toEqual(texto.clauses);
    expect(replayConstitution(log).core).toEqual(nucleo);
  });

  it('y el administrador técnico sigue sin poder tocar nada, también desde fuera', () => {
    const admin: Actor = {
      memberId: memberId(hex32(0x1040)),
      roles: ['tech-admin'],
      circles: [],
    };
    for (const accion of [
      'constitution:found',
      'constitution:propose-reform',
      'constitution:record-vote',
      'constitution:approve',
      'constitution:ratify',
    ] as const) {
      expect(denialReason(admin, accion, { kind: 'constitution' })).toBe('ROLE_NOT_GRANTED');
    }
  });
});
