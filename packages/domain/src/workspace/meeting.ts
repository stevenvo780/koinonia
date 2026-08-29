/**
 * Agregado **reunión**: el puente entre lo presencial y el resto del recorrido (PRODUCT §4).
 *
 * ═══ Por qué existe, y por qué no es un calendario ═══
 *
 * El principio del proyecto es «la reunión presencial es una herramienta más, no el sistema de
 * gobierno» (PRODUCT.md, introducción). Una pantalla de reuniones que sólo mostrara hora y lugar
 * sería justo lo contrario: convertiría lo presencial en el centro, porque todo lo demás —el orden
 * del día, lo que se acordó— quedaría fuera del historial verificable, en un acta suelta que nadie
 * más puede comprobar. Este agregado existe para que una reunión deje EXACTAMENTE tres huellas en el
 * mismo historial que todo lo demás: (1) que se convocó, con qué orden del día y enlazando qué
 * problemas o deliberaciones va a tratar; (2) qué pasó, con quién estuvo —o la ausencia declarada de
 * esa lista— y qué se acordó; y (3) qué acuerdo se convirtió en qué propuesta, para que «convertir
 * este acuerdo en propuesta» (PRODUCT §4, columna de acción) no sea un botón que copia texto a mano,
 * sino un enlace verificable entre dos agregados.
 *
 * ═══ Por qué un acuerdo no ES una propuesta ═══
 *
 * «No se propone sin problema» (`workspace/proposal.ts`) es una regla del motor. Un acuerdo de
 * reunión que no nombra el problema que responde **no puede** convertirse en propuesta —lo enforza
 * `AgreementLinkedToProposal` más abajo—, y eso es correcto: no toda constancia de una reunión es una
 * decisión pendiente («quedamos en reservar el salón para la próxima» no responde a ningún problema
 * del sistema y no tiene por qué volverse un texto votable). La conversión real —crear la propuesta—
 * la hace `workspace/proposal.ts` con su propio comando (`draftProposal`), por la única puerta que
 * existe (`apps/web/components/marco.tsx`, comentario de `TRAMOS`: «una propuesta no se empieza desde
 * su índice»). Este agregado sólo dice, después, que ese acuerdo se convirtió en aquella propuesta.
 *
 * ═══ Por qué no hay `MinutesAmended` ═══
 *
 * A propósito, y no por omisión: PRODUCT §4 describe una sola acción de publicación («publicar
 * acta»), nunca una de corrección. Ampliarlo con un evento de enmienda es exactamente la clase de
 * gobernanza nueva que este encargo pide no inventar. Si hace falta corregir un acta publicada, el
 * canal correcto es el mismo que corrige cualquier otro hecho del historial: una constancia nueva
 * enlazada, no una reescritura. Queda para cuando el pliego lo pida con una cita concreta.
 *
 * ═══ Acta sin asistentes ═══
 *
 * PRODUCT §4, columna «Errores»: «Acta sin asistentes: se permite pero se marca, y no sirve para
 * decisiones que dependan de quiénes estaban». No hay un campo booleano aparte para eso —dos formas
 * de decir el mismo hecho es como se cuela una discrepancia—: `attendees` vacío ES la marca, y
 * `hasRecordedAttendance` lee esa única fuente.
 */

import { type Actor, authorize } from '../access.js';
import { PreconditionError } from '../errors.js';
import type { CircleId, EventId, Instant, MemberId } from '../ids.js';
import { appendChained, type ChainedEvent, type ChainedLog } from './chain.js';
import { assertLedgerText, MAX_BODY_LENGTH, meaningfulLength } from './text.js';

/** Mínimo del título de una reunión. */
export const MIN_MEETING_TITLE_LENGTH = 10;
/** Mínimo del resumen del acta: cuenta lo que pasó, no «bien, gracias». */
export const MIN_MINUTES_SUMMARY_LENGTH = 30;
/** Mínimo del texto de un punto del orden del día. */
export const MIN_AGENDA_ITEM_LENGTH = 10;
/** Mínimo del texto de un acuerdo. */
export const MIN_AGREEMENT_LENGTH = 15;
/** Máximo de un lugar físico («Salón 12-104, Bloque 12»). */
export const MAX_LOCATION_LENGTH = 200;
/** Máximo de un enlace remoto. Más generoso que un título: algunos enlaces cargan parámetros largos. */
export const MAX_REMOTE_LINK_LENGTH = 500;
/** Tope de puntos del orden del día. Una reunión con más de esto no tiene un orden del día: es todo. */
export const MAX_AGENDA_ITEMS = 20;
/** Mismo tope y misma razón para los acuerdos de un acta. */
export const MAX_AGREEMENTS = 20;

export interface AgendaItemInput {
  readonly itemId: string;
  readonly text: string;
  /** El problema que este punto va a tratar, si lo hay. */
  readonly problemId?: string | undefined;
  /** La deliberación que este punto va a tratar, si lo hay. */
  readonly deliberationId?: string | undefined;
}

export interface AgreementInput {
  readonly agreementId: string;
  readonly text: string;
  /** El problema que este acuerdo responde. Sin esto, el acuerdo no puede volverse propuesta. */
  readonly problemId?: string | undefined;
}

export type MeetingPayload =
  | {
      readonly type: 'MeetingConvened';
      readonly title: string;
      readonly circleId: CircleId;
      readonly scheduledAt: Instant;
      readonly location?: string | undefined;
      readonly remoteLink?: string | undefined;
      readonly agenda: readonly AgendaItemInput[];
    }
  | {
      readonly type: 'MinutesPublished';
      readonly summary: string;
      readonly attendees: readonly MemberId[];
      readonly agreements: readonly AgreementInput[];
    }
  | {
      readonly type: 'AgreementLinkedToProposal';
      readonly agreementId: string;
      readonly proposalId: string;
    };

export type MeetingEvent = ChainedEvent<MeetingPayload>;
export type MeetingLog = ChainedLog<MeetingPayload>;

export interface AgendaItem {
  readonly itemId: string;
  readonly text: string;
  readonly problemId: string | undefined;
  readonly deliberationId: string | undefined;
}

export interface Agreement {
  readonly agreementId: string;
  readonly text: string;
  readonly problemId: string | undefined;
  /** `undefined` hasta que `AgreementLinkedToProposal` lo fija. Nunca vuelve a `undefined`. */
  readonly proposalId: string | undefined;
}

export interface MeetingState {
  readonly meetingId: string;
  readonly exists: boolean;
  readonly title: string;
  readonly circleId: CircleId | undefined;
  readonly convenedBy: MemberId | undefined;
  readonly scheduledAt: Instant | undefined;
  readonly location: string | undefined;
  readonly remoteLink: string | undefined;
  readonly agenda: readonly AgendaItem[];
  readonly minutesPublished: boolean;
  readonly summary: string | undefined;
  readonly attendees: readonly MemberId[];
  readonly agreements: readonly Agreement[];
  readonly lastSeq: number;
}

export function initialMeetingState(meetingId: string): MeetingState {
  return {
    meetingId,
    exists: false,
    title: '',
    circleId: undefined,
    convenedBy: undefined,
    scheduledAt: undefined,
    location: undefined,
    remoteLink: undefined,
    agenda: [],
    minutesPublished: false,
    summary: undefined,
    attendees: [],
    agreements: [],
    lastSeq: 0,
  };
}

function requireExists(state: MeetingState): void {
  if (!state.exists) {
    throw new PreconditionError('MEETING_NOT_CONVENED', 'esa reunión todavía no existe');
  }
}

function actorMember(event: MeetingEvent): MemberId {
  if (event.actor === 'system') {
    throw new PreconditionError(
      'SYSTEM_CANNOT_AUTHOR',
      'el sistema no convoca reuniones ni publica actas en nombre de nadie',
    );
  }
  return event.actor;
}

function assertUniqueIds(ids: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new PreconditionError('DUPLICATE_ID', `${field} repite el identificador ${id}`);
    }
    seen.add(id);
  }
}

/** Pliega un evento. Rechaza y deja el estado del llamante intacto si algo no cuadra. */
export function applyMeeting(state: MeetingState, event: MeetingEvent): MeetingState {
  if (event.aggregateId !== state.meetingId) {
    throw new PreconditionError(
      'WRONG_AGGREGATE',
      `el evento pertenece a ${event.aggregateId} y el agregado es ${state.meetingId}`,
    );
  }
  const base: MeetingState = { ...state, lastSeq: event.seq };
  const payload = event.payload;

  switch (payload.type) {
    case 'MeetingConvened': {
      if (state.exists) {
        throw new PreconditionError('MEETING_ALREADY_CONVENED', 'una reunión se convoca una vez');
      }
      assertLedgerText(payload.title, {
        field: 'el título de la reunión',
        min: MIN_MEETING_TITLE_LENGTH,
        max: 140,
      });
      if (payload.location === undefined && payload.remoteLink === undefined) {
        throw new PreconditionError(
          'NEEDS_PLACE_OR_LINK',
          'una reunión necesita un lugar físico, un enlace remoto, o los dos: no se convoca sin ' +
            'decir dónde',
        );
      }
      if (payload.location !== undefined) {
        assertLedgerText(payload.location, {
          field: 'el lugar de la reunión',
          min: 3,
          max: MAX_LOCATION_LENGTH,
        });
      }
      if (payload.remoteLink !== undefined) {
        assertLedgerText(payload.remoteLink, {
          field: 'el enlace remoto',
          min: 3,
          max: MAX_REMOTE_LINK_LENGTH,
        });
      }
      if (payload.agenda.length === 0) {
        throw new PreconditionError(
          'AGENDA_REQUIRED',
          'una reunión se convoca con orden del día: sin puntos que tratar no hay qué convocar',
        );
      }
      if (payload.agenda.length > MAX_AGENDA_ITEMS) {
        throw new PreconditionError(
          'TOO_MANY_AGENDA_ITEMS',
          `el orden del día admite hasta ${String(MAX_AGENDA_ITEMS)} puntos y llegaron ` +
            String(payload.agenda.length),
        );
      }
      assertUniqueIds(
        payload.agenda.map((item) => item.itemId),
        'el orden del día',
      );
      for (const item of payload.agenda) {
        assertLedgerText(item.text, {
          field: 'un punto del orden del día',
          min: MIN_AGENDA_ITEM_LENGTH,
          max: MAX_BODY_LENGTH,
        });
      }
      return {
        ...base,
        exists: true,
        title: payload.title,
        circleId: payload.circleId,
        convenedBy: actorMember(event),
        scheduledAt: payload.scheduledAt,
        location: payload.location,
        remoteLink: payload.remoteLink,
        agenda: payload.agenda.map((item) => ({
          itemId: item.itemId,
          text: item.text,
          problemId: item.problemId,
          deliberationId: item.deliberationId,
        })),
      };
    }

    case 'MinutesPublished': {
      requireExists(state);
      // Autorización horizontal, comprobada TAMBIÉN en el replay (mismo motivo que
      // `EvidenceRetracted` en `problem.ts`): un log fabricado a mano en el que alguien publica el
      // acta de la reunión de otra persona no se pliega, se rechaza.
      if (state.convenedBy !== event.actor) {
        throw new PreconditionError(
          'NOT_THE_OWNER',
          'el acta la publica quien convocó la reunión; tener el mismo rol no da acceso a lo ajeno',
        );
      }
      if (state.minutesPublished) {
        throw new PreconditionError(
          'MINUTES_ALREADY_PUBLISHED',
          'esta reunión ya tiene acta publicada: no hay un segundo «publicar acta» para la misma ' +
            'reunión (ver cabecera del fichero, «Por qué no hay MinutesAmended»)',
        );
      }
      assertLedgerText(payload.summary, {
        field: 'el resumen del acta',
        min: MIN_MINUTES_SUMMARY_LENGTH,
        max: MAX_BODY_LENGTH,
      });
      assertUniqueIds(payload.attendees, 'la lista de asistentes');
      if (payload.agreements.length > MAX_AGREEMENTS) {
        throw new PreconditionError(
          'TOO_MANY_AGREEMENTS',
          `un acta admite hasta ${String(MAX_AGREEMENTS)} acuerdos y llegaron ` +
            String(payload.agreements.length),
        );
      }
      assertUniqueIds(
        payload.agreements.map((a) => a.agreementId),
        'los acuerdos del acta',
      );
      for (const agreement of payload.agreements) {
        assertLedgerText(agreement.text, {
          field: 'un acuerdo del acta',
          min: MIN_AGREEMENT_LENGTH,
          max: MAX_BODY_LENGTH,
        });
      }
      return {
        ...base,
        minutesPublished: true,
        summary: payload.summary,
        attendees: payload.attendees,
        agreements: payload.agreements.map((a) => ({
          agreementId: a.agreementId,
          text: a.text,
          problemId: a.problemId,
          proposalId: undefined,
        })),
      };
    }

    case 'AgreementLinkedToProposal': {
      requireExists(state);
      // Autorización horizontal, comprobada TAMBIÉN en el replay. Ver el mismo comentario en
      // `MinutesPublished`, dos casos más arriba.
      if (state.convenedBy !== event.actor) {
        throw new PreconditionError(
          'NOT_THE_OWNER',
          'el enlace con la propuesta lo escribe quien convocó la reunión; tener el mismo rol no ' +
            'da acceso a lo ajeno',
        );
      }
      if (!state.minutesPublished) {
        throw new PreconditionError(
          'MINUTES_NOT_PUBLISHED',
          'no hay acuerdos que convertir en propuesta antes de publicar el acta',
        );
      }
      const index = state.agreements.findIndex((a) => a.agreementId === payload.agreementId);
      const agreement = state.agreements[index];
      if (index < 0 || agreement === undefined) {
        throw new PreconditionError('UNKNOWN_AGREEMENT', 'ese acuerdo no existe en esta acta');
      }
      if (agreement.problemId === undefined) {
        throw new PreconditionError(
          'AGREEMENT_WITHOUT_PROBLEM',
          'este acuerdo no nombra el problema que responde: no se propone sin problema (PRODUCT §4)',
        );
      }
      if (agreement.proposalId !== undefined) {
        throw new PreconditionError(
          'AGREEMENT_ALREADY_LINKED',
          'ese acuerdo ya se convirtió en propuesta',
        );
      }
      if (meaningfulLength(payload.proposalId) === 0) {
        throw new PreconditionError('EMPTY_PROPOSAL_ID', 'falta el identificador de la propuesta');
      }
      return {
        ...base,
        agreements: state.agreements.map((a, i) =>
          i === index ? { ...a, proposalId: payload.proposalId } : a,
        ),
      };
    }
  }
}

/** Pliega el log completo. El orden canónico es por `seq`. */
export function replayMeeting(log: MeetingLog): MeetingState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacío no identifica ninguna reunión');
  }
  let state = initialMeetingState(first.aggregateId);
  for (const event of log) state = applyMeeting(state, event);
  return state;
}

/**
 * PRODUCT §4: un acta sin asistentes «se permite pero se marca, y no sirve para decisiones que
 * dependan de quiénes estaban». Una sola fuente —`attendees` vacío— para ese hecho; ver cabecera.
 */
export function hasRecordedAttendance(state: MeetingState): boolean {
  return state.attendees.length > 0;
}

/** Los acuerdos que todavía no se convirtieron en propuesta y sí pueden: nombran un problema. */
export function convertibleAgreements(state: MeetingState): readonly Agreement[] {
  return state.agreements.filter((a) => a.problemId !== undefined && a.proposalId === undefined);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes. Todas autorizan ANTES de construir el evento.
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface MeetingCommandMeta {
  readonly eventId: EventId;
  readonly at: Instant;
  readonly actor: Actor;
}

async function emit(
  log: MeetingLog,
  state: MeetingState,
  meta: MeetingCommandMeta,
  aggregateId: string,
  payload: MeetingPayload,
): Promise<MeetingLog> {
  if (meta.actor.memberId === undefined) {
    throw new PreconditionError('NOT_AUTHENTICATED', 'este acto exige una cuenta verificada');
  }
  const event = await appendChained<MeetingPayload>(log, {
    eventId: meta.eventId,
    aggregateId,
    occurredAt: meta.at,
    actor: meta.actor.memberId,
    payload,
  });
  // Se pliega antes de devolver: ver el mismo comentario en `problem.ts` — un log que `replayMeeting`
  // rechazaría es un log ya roto en el instante de escribirse, no en la siguiente lectura.
  applyMeeting(state, event);
  return [...log, event];
}

export async function convokeMeeting(
  meta: MeetingCommandMeta,
  input: {
    readonly meetingId: string;
    readonly title: string;
    readonly circleId: CircleId;
    readonly scheduledAt: Instant;
    readonly location?: string | undefined;
    readonly remoteLink?: string | undefined;
    readonly agenda: readonly AgendaItemInput[];
  },
): Promise<MeetingLog> {
  authorize(meta.actor, 'meeting:convene', { kind: 'meeting', circleId: input.circleId });
  return emit([], initialMeetingState(input.meetingId), meta, input.meetingId, {
    type: 'MeetingConvened',
    title: input.title,
    circleId: input.circleId,
    scheduledAt: input.scheduledAt,
    location: input.location,
    remoteLink: input.remoteLink,
    agenda: input.agenda,
  });
}

export async function publishMinutes(
  log: MeetingLog,
  meta: MeetingCommandMeta,
  input: {
    readonly summary: string;
    readonly attendees: readonly MemberId[];
    readonly agreements: readonly AgreementInput[];
  },
): Promise<MeetingLog> {
  const state = replayMeeting(log);
  // Horizontal, como `proposal:amend`: publica el acta quien convocó, no cualquiera con el mismo rol.
  authorize(meta.actor, 'meeting:publish-minutes', {
    kind: 'meeting',
    owner: state.convenedBy,
    circleId: state.circleId,
  });
  return emit(log, state, meta, state.meetingId, {
    type: 'MinutesPublished',
    summary: input.summary,
    attendees: input.attendees,
    agreements: input.agreements,
  });
}

/**
 * Deja constancia de que un acuerdo se convirtió en la propuesta `proposalId`. **No crea la
 * propuesta**: eso ya ocurrió, por la única puerta que existe (ver cabecera del fichero). Esto sólo
 * enlaza, igual que `proposal.ts:linkDecision` enlaza una decisión ya abierta.
 */
export async function linkProposalToAgreement(
  log: MeetingLog,
  meta: MeetingCommandMeta,
  input: { readonly agreementId: string; readonly proposalId: string },
): Promise<MeetingLog> {
  const state = replayMeeting(log);
  authorize(meta.actor, 'meeting:link-agreement', {
    kind: 'meeting',
    owner: state.convenedBy,
    circleId: state.circleId,
  });
  return emit(log, state, meta, state.meetingId, {
    type: 'AgreementLinkedToProposal',
    agreementId: input.agreementId,
    proposalId: input.proposalId,
  });
}
