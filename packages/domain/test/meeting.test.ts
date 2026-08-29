/**
 * Reuniones: convocatoria, acta y el enlace de un acuerdo con la propuesta que salió de él.
 *
 * Mismo criterio que `workspace.test.ts`: la última sección fabrica un evento a mano, saltándose la
 * orden, y comprueba que el REPLAY lo rechaza. Una autorización que sólo vive en la orden protege el
 * camino que existía el día que se escribió; una que además vive en el plegado protege todos los
 * caminos, incluidos los que todavía no existen.
 */

import { describe, expect, it } from 'vitest';

import {
  type Actor,
  appendChained,
  convertibleAgreements,
  convokeMeeting,
  hasRecordedAttendance,
  isChainIntact,
  linkProposalToAgreement,
  type MeetingLog,
  type MeetingPayload,
  publishMinutes,
  replayMeeting,
  UnauthorizedError,
} from '../src/index.js';
import { circleIdAt, eventIdAt, memberIdAt, T0 } from './arbitraries.js';
import { instant } from '../src/ids.js';

const CIRCULO = circleIdAt(0);
const REUNION = '0'.repeat(31) + '3';
const PROBLEMA = '0'.repeat(31) + '1';

const daniela: Actor = { memberId: memberIdAt(1), roles: ['member'], circles: [CIRCULO] };
const julian: Actor = { memberId: memberIdAt(2), roles: ['member'], circles: [CIRCULO] };
const observador: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

let reloj = 0;
const meta = (actor: Actor) => ({
  eventId: eventIdAt(++reloj),
  at: instant(T0 + reloj * 1000),
  actor,
});

const TITULO = 'Asamblea ordinaria de agosto del Instituto';
const AGENDA = [
  { itemId: 'a'.repeat(32), text: 'Revisar el estado de la sala de estudio nocturna.' },
  {
    itemId: 'b'.repeat(32),
    text: 'Decidir si se pide horario extendido.',
    problemId: PROBLEMA,
  },
];

async function reunionBase(): Promise<MeetingLog> {
  return convokeMeeting(meta(daniela), {
    meetingId: REUNION,
    title: TITULO,
    circleId: CIRCULO,
    scheduledAt: instant(T0 + 7 * 24 * 60 * 60 * 1000),
    location: 'Salón 12-104, Bloque 12',
    agenda: AGENDA,
  });
}

describe('convocar una reunión', () => {
  it('se convoca, se encadena y queda a nombre de quien convoca', async () => {
    const log = await reunionBase();
    expect(await isChainIntact(log)).toBe(true);
    const state = replayMeeting(log);
    expect(state.exists).toBe(true);
    expect(state.convenedBy).toBe(daniela.memberId);
    expect(state.agenda).toHaveLength(2);
    expect(state.minutesPublished).toBe(false);
  });

  it('no se convoca sin lugar físico ni enlace remoto', async () => {
    await expect(
      convokeMeeting(meta(daniela), {
        meetingId: 'z'.repeat(32),
        title: TITULO,
        circleId: CIRCULO,
        scheduledAt: instant(T0 + 1000),
        agenda: AGENDA,
      }),
    ).rejects.toMatchObject({ code: 'NEEDS_PLACE_OR_LINK' });
  });

  it('un enlace remoto solo también convoca', async () => {
    const log = await convokeMeeting(meta(daniela), {
      meetingId: 'y'.repeat(32),
      title: TITULO,
      circleId: CIRCULO,
      scheduledAt: instant(T0 + 1000),
      remoteLink: 'https://meet.example.org/instituto-agosto',
      agenda: AGENDA,
    });
    expect(replayMeeting(log).remoteLink).toMatch(/meet\.example\.org/u);
  });

  it('no se convoca sin orden del día', async () => {
    await expect(
      convokeMeeting(meta(daniela), {
        meetingId: 'x'.repeat(32),
        title: TITULO,
        circleId: CIRCULO,
        scheduledAt: instant(T0 + 1000),
        location: 'Salón 12-104',
        agenda: [],
      }),
    ).rejects.toMatchObject({ code: 'AGENDA_REQUIRED' });
  });

  it('rechaza puntos del orden del día con identificador repetido', async () => {
    await expect(
      convokeMeeting(meta(daniela), {
        meetingId: 'w'.repeat(32),
        title: TITULO,
        circleId: CIRCULO,
        scheduledAt: instant(T0 + 1000),
        location: 'Salón 12-104',
        agenda: [
          { itemId: 'a'.repeat(32), text: 'Primer punto, con texto suficiente para pasar.' },
          {
            itemId: 'a'.repeat(32),
            text: 'Segundo punto con el mismo identificador que el primero.',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ID' });
  });

  it('quien mira sin cuenta no convoca', async () => {
    await expect(
      convokeMeeting(meta(observador), {
        meetingId: 'v'.repeat(32),
        title: TITULO,
        circleId: CIRCULO,
        scheduledAt: instant(T0 + 1000),
        location: 'Salón 12-104',
        agenda: AGENDA,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('publicar el acta', () => {
  it('un acta sin asistentes se permite y queda marcada', async () => {
    let log = await reunionBase();
    log = await publishMinutes(log, meta(daniela), {
      summary: 'Se discutió el horario de la sala de estudio y no se llegó a un acuerdo cerrado.',
      attendees: [],
      agreements: [],
    });
    const state = replayMeeting(log);
    expect(state.minutesPublished).toBe(true);
    expect(hasRecordedAttendance(state)).toBe(false);
  });

  it('con asistentes, la marca lo dice', async () => {
    let log = await reunionBase();
    log = await publishMinutes(log, meta(daniela), {
      summary: 'Se discutió el horario de la sala de estudio y se acordó pedir la extensión.',
      attendees: [daniela.memberId!, julian.memberId!],
      agreements: [
        {
          agreementId: 'c'.repeat(32),
          text: 'Pedir que la sala abra hasta las 9 de la noche.',
          problemId: PROBLEMA,
        },
      ],
    });
    const state = replayMeeting(log);
    expect(hasRecordedAttendance(state)).toBe(true);
    expect(state.attendees).toHaveLength(2);
  });

  it('HORIZONTAL — el acta la publica quien convocó la reunión', async () => {
    const log = await reunionBase();
    await expect(
      publishMinutes(log, meta(julian), {
        summary: 'Julián intenta publicar el acta de una reunión que convocó Daniela.',
        attendees: [],
        agreements: [],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('no hay un segundo «publicar acta» para la misma reunión', async () => {
    let log = await reunionBase();
    log = await publishMinutes(log, meta(daniela), {
      summary: 'Primera publicación del acta, con el resumen suficiente para pasar el mínimo.',
      attendees: [],
      agreements: [],
    });
    await expect(
      publishMinutes(log, meta(daniela), {
        summary: 'Segundo intento de publicar el acta de la misma reunión ya publicada antes.',
        attendees: [],
        agreements: [],
      }),
    ).rejects.toMatchObject({ code: 'MINUTES_ALREADY_PUBLISHED' });
  });

  it('rechaza acuerdos con identificador repetido', async () => {
    const log = await reunionBase();
    await expect(
      publishMinutes(log, meta(daniela), {
        summary: 'Un resumen con longitud suficiente para pasar el mínimo exigido por el acta.',
        attendees: [],
        agreements: [
          { agreementId: 'd'.repeat(32), text: 'Primer acuerdo con texto suficientemente largo.' },
          {
            agreementId: 'd'.repeat(32),
            text: 'Segundo acuerdo con el mismo identificador repetido.',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ID' });
  });
});

describe('convertir un acuerdo en propuesta', () => {
  async function actaConAcuerdo(): Promise<MeetingLog> {
    let log = await reunionBase();
    log = await publishMinutes(log, meta(daniela), {
      summary: 'Se acordó pedir la extensión del horario de la sala de estudio nocturna.',
      attendees: [daniela.memberId!],
      agreements: [
        {
          agreementId: 'c'.repeat(32),
          text: 'Pedir que la sala abra hasta las 9 de la noche entre semana.',
          problemId: PROBLEMA,
        },
        { agreementId: 'e'.repeat(32), text: 'Reservar el salón 12-104 para la próxima reunión.' },
      ],
    });
    return log;
  }

  it('sólo los acuerdos con problema declarado se pueden convertir', async () => {
    const log = await actaConAcuerdo();
    const state = replayMeeting(log);
    const convertibles = convertibleAgreements(state);
    expect(convertibles).toHaveLength(1);
    expect(convertibles[0]?.agreementId).toBe('c'.repeat(32));
  });

  it('enlaza el acuerdo con la propuesta que salió de él', async () => {
    let log = await actaConAcuerdo();
    log = await linkProposalToAgreement(log, meta(daniela), {
      agreementId: 'c'.repeat(32),
      proposalId: 'f'.repeat(32),
    });
    const state = replayMeeting(log);
    const acuerdo = state.agreements.find((a) => a.agreementId === 'c'.repeat(32));
    expect(acuerdo?.proposalId).toBe('f'.repeat(32));
    expect(convertibleAgreements(state)).toHaveLength(0);
  });

  it('un acuerdo sin problema declarado no se puede enlazar', async () => {
    const log = await actaConAcuerdo();
    await expect(
      linkProposalToAgreement(log, meta(daniela), {
        agreementId: 'e'.repeat(32),
        proposalId: 'f'.repeat(32),
      }),
    ).rejects.toMatchObject({ code: 'AGREEMENT_WITHOUT_PROBLEM' });
  });

  it('un acuerdo ya enlazado no se enlaza dos veces', async () => {
    let log = await actaConAcuerdo();
    log = await linkProposalToAgreement(log, meta(daniela), {
      agreementId: 'c'.repeat(32),
      proposalId: 'f'.repeat(32),
    });
    await expect(
      linkProposalToAgreement(log, meta(daniela), {
        agreementId: 'c'.repeat(32),
        proposalId: 'g'.repeat(32),
      }),
    ).rejects.toMatchObject({ code: 'AGREEMENT_ALREADY_LINKED' });
  });

  it('no se enlaza antes de publicar el acta', async () => {
    const log = await reunionBase();
    await expect(
      linkProposalToAgreement(log, meta(daniela), {
        agreementId: 'c'.repeat(32),
        proposalId: 'f'.repeat(32),
      }),
    ).rejects.toMatchObject({ code: 'MINUTES_NOT_PUBLISHED' });
  });

  it('HORIZONTAL — enlaza quien convocó, no cualquiera del círculo', async () => {
    const log = await actaConAcuerdo();
    await expect(
      linkProposalToAgreement(log, meta(julian), {
        agreementId: 'c'.repeat(32),
        proposalId: 'f'.repeat(32),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('la autorización se comprueba en el REPLAY, no sólo en la orden', () => {
  it('un log fabricado en el que otra persona publica el acta ajena NO se pliega', async () => {
    const log = await reunionBase();

    // Se fabrica el evento saltándose `publishMinutes` por completo, igual que el ataque descrito
    // en `workspace.test.ts` para `ProposalAmended`.
    const fabricado = await appendChained<MeetingPayload>(log, {
      eventId: eventIdAt(900),
      aggregateId: REUNION,
      occurredAt: instant(T0 + 900_000),
      // El firmante es Julián y la reunión la convocó Daniela.
      actor: julian.memberId!,
      payload: {
        type: 'MinutesPublished',
        summary: 'Un acta suplantada, publicada por alguien que no convocó esta reunión.',
        attendees: [],
        agreements: [],
      },
    });
    const logFabricado: MeetingLog = [...log, fabricado];

    // La cadena de hashes está PERFECTA: se construyó bien. Lo que falla es la regla de gobierno.
    expect(await isChainIntact(logFabricado)).toBe(true);
    expect(() => replayMeeting(logFabricado)).toThrow(/quien convocó la reunión/u);
  });
});
