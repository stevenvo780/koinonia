/**
 * Agregado **problema**: lo que está mal y todavía no tiene solución propuesta.
 *
 * «No se propone sin problema» (PRODUCT §4) es una regla del motor, no una validación de formulario:
 * la propuesta exige un `problemId` que exista, y esa exigencia se comprueba aquí y no en la ruta.
 *
 * ═══ Dónde está la autorización ═══
 *
 * Cada orden llama a `authorize` **antes** de construir el evento. No hay ninguna forma de añadir
 * evidencia sin pasar por `attachEvidence`, y `attachEvidence` no tiene una variante «sin
 * comprobar». Ésa es la diferencia entre una regla del sistema y una comprobación de una ruta.
 *
 * ═══ Retirar evidencia es horizontal ═══
 *
 * Retirar un aporte lo puede hacer **quien lo escribió y nadie más**, aunque el resto tenga
 * exactamente el mismo rol. Y retirar **no borra**: deja el hueco declarado que exige PRODUCT §4
 * («se retiró un contenido el [fecha] por [motivo]», nunca una ausencia silenciosa).
 */

import { type Actor, authorize } from '../access.js';
import { PreconditionError } from '../errors.js';
import type { CircleId, EventId, Instant, MemberId } from '../ids.js';
import { appendChained, type ChainedEvent, type ChainedLog } from './chain.js';
import { assertLedgerText, MAX_BODY_LENGTH, MAX_TITLE_LENGTH, meaningfulLength } from './text.js';

/** Estados del §4 de PRODUCT, con esas mismas palabras. */
export type ProblemStatus = 'recogiendo-evidencia' | 'con-propuesta' | 'resuelto' | 'archivado';

/**
 * Grado de certeza de un aporte (§3 de PRODUCT: *visto*, *me lo contaron*, *lo estoy suponiendo*).
 *
 * Es obligatorio y no tiene valor por defecto: obligar a declarar de dónde sale un dato es lo que
 * convierte «todo el mundo sabe que…» en un aporte discutible.
 */
export type EvidenceCertainty = 'visto' | 'me-lo-contaron' | 'lo-supongo';

export const EVIDENCE_CERTAINTIES: readonly EvidenceCertainty[] = [
  'visto',
  'me-lo-contaron',
  'lo-supongo',
];

/** Mínimo de caracteres de un aporte de evidencia. Menos que eso es una reacción, no un aporte. */
export const MIN_EVIDENCE_LENGTH = 20;
/** Mínimo del cuerpo de un problema. */
export const MIN_PROBLEM_BODY_LENGTH = 30;
/** Mínimo del título de un problema. */
export const MIN_PROBLEM_TITLE_LENGTH = 10;

export type ProblemPayload =
  | {
      readonly type: 'ProblemOpened';
      readonly title: string;
      readonly body: string;
      readonly circleId: CircleId;
    }
  | {
      readonly type: 'EvidenceAttached';
      readonly evidenceId: string;
      readonly certainty: EvidenceCertainty;
      readonly body: string;
      readonly source?: string | undefined;
    }
  | {
      readonly type: 'EvidenceRetracted';
      readonly evidenceId: string;
      readonly motivation: string;
    }
  | { readonly type: 'MeTooRecorded' }
  | { readonly type: 'ProblemStatusChanged'; readonly status: ProblemStatus };

export type ProblemEvent = ChainedEvent<ProblemPayload>;
export type ProblemLog = ChainedLog<ProblemPayload>;

export interface EvidenceRecord {
  readonly evidenceId: string;
  readonly by: MemberId;
  readonly certainty: EvidenceCertainty;
  readonly body: string;
  readonly source: string | undefined;
  readonly at: Instant;
  /** Retirada: el aporte deja un hueco DECLARADO, con su motivo. Nunca desaparece. */
  readonly retracted: { readonly at: Instant; readonly motivation: string } | undefined;
  readonly seq: number;
}

export interface ProblemState {
  readonly problemId: string;
  readonly exists: boolean;
  readonly title: string;
  readonly body: string;
  readonly circleId: CircleId | undefined;
  readonly author: MemberId | undefined;
  readonly status: ProblemStatus;
  readonly openedAt: Instant | undefined;
  readonly evidence: readonly EvidenceRecord[];
  /**
   * Quiénes marcaron «a mí también me pasa».
   *
   * DECISIÓN: el conjunto se guarda para poder **deduplicar** (sin él, una persona sola produce un
   * colectivo de doce recargando la página), pero la interfaz sólo muestra el número: PRODUCT §4
   * exige «agregado, sin nombres», y ADR-0040 prohíbe las métricas de actividad individual. El
   * historial sí conserva el acto con su actor, como todos los demás: un registro que oculta quién
   * hizo qué no es auditable. La regla es «no se muestra», no «no se registra».
   */
  readonly meTooBy: readonly MemberId[];
  readonly lastSeq: number;
}

export function initialProblemState(problemId: string): ProblemState {
  return {
    problemId,
    exists: false,
    title: '',
    body: '',
    circleId: undefined,
    author: undefined,
    status: 'recogiendo-evidencia',
    openedAt: undefined,
    evidence: [],
    meTooBy: [],
    lastSeq: 0,
  };
}

function requireExists(state: ProblemState): void {
  if (!state.exists) {
    throw new PreconditionError('PROBLEM_NOT_OPEN', 'ese problema todavía no existe');
  }
}

function actorMember(event: ProblemEvent): MemberId {
  if (event.actor === 'system') {
    throw new PreconditionError(
      'SYSTEM_CANNOT_AUTHOR',
      'el sistema no escribe problemas ni evidencia en nombre de nadie',
    );
  }
  return event.actor;
}

/** Pliega un evento. Rechaza y deja el estado del llamante intacto si algo no cuadra. */
export function applyProblem(state: ProblemState, event: ProblemEvent): ProblemState {
  if (event.aggregateId !== state.problemId) {
    throw new PreconditionError(
      'WRONG_AGGREGATE',
      `el evento pertenece a ${event.aggregateId} y el agregado es ${state.problemId}`,
    );
  }
  const base: ProblemState = { ...state, lastSeq: event.seq };
  const payload = event.payload;

  switch (payload.type) {
    case 'ProblemOpened': {
      if (state.exists) {
        throw new PreconditionError('PROBLEM_ALREADY_OPEN', 'un problema se abre una sola vez');
      }
      assertLedgerText(payload.title, {
        field: 'el título del problema',
        min: MIN_PROBLEM_TITLE_LENGTH,
        max: MAX_TITLE_LENGTH,
      });
      assertLedgerText(payload.body, {
        field: 'el cuerpo del problema',
        min: MIN_PROBLEM_BODY_LENGTH,
        max: MAX_BODY_LENGTH,
      });
      return {
        ...base,
        exists: true,
        title: payload.title,
        body: payload.body,
        circleId: payload.circleId,
        author: actorMember(event),
        openedAt: event.occurredAt,
      };
    }

    case 'EvidenceAttached': {
      requireExists(state);
      if (state.evidence.some((e) => e.evidenceId === payload.evidenceId)) {
        throw new PreconditionError('DUPLICATE_EVIDENCE', 'ese aporte ya está en el historial');
      }
      assertLedgerText(payload.body, {
        field: 'el aporte de evidencia',
        min: MIN_EVIDENCE_LENGTH,
        max: MAX_BODY_LENGTH,
      });
      if (payload.source !== undefined) {
        assertLedgerText(payload.source, { field: 'la fuente', min: 1, max: MAX_TITLE_LENGTH });
      }
      return {
        ...base,
        evidence: [
          ...state.evidence,
          {
            evidenceId: payload.evidenceId,
            by: actorMember(event),
            certainty: payload.certainty,
            body: payload.body,
            source: payload.source,
            at: event.occurredAt,
            retracted: undefined,
            seq: event.seq,
          },
        ],
      };
    }

    case 'EvidenceRetracted': {
      requireExists(state);
      const index = state.evidence.findIndex((e) => e.evidenceId === payload.evidenceId);
      const record = state.evidence[index];
      if (index < 0 || record === undefined) {
        throw new PreconditionError('UNKNOWN_EVIDENCE', 'ese aporte no existe en este problema');
      }
      if (record.retracted !== undefined) {
        throw new PreconditionError('ALREADY_RETRACTED', 'ese aporte ya estaba retirado');
      }
      // Autorización horizontal, comprobada TAMBIÉN en el replay: un log fabricado a mano en el que
      // alguien retira el aporte de otra persona no se pliega, se rechaza.
      if (record.by !== event.actor) {
        throw new PreconditionError(
          'NOT_THE_OWNER',
          'un aporte lo retira quien lo escribió; tener el mismo rol no da acceso a lo ajeno',
        );
      }
      if (meaningfulLength(payload.motivation) < 10) {
        throw new PreconditionError(
          'NO_MOTIVATION',
          'retirar un aporte deja un hueco declarado en el historial y exige decir por qué',
        );
      }
      return {
        ...base,
        evidence: state.evidence.map((e, i) =>
          i === index
            ? { ...e, retracted: { at: event.occurredAt, motivation: payload.motivation } }
            : e,
        ),
      };
    }

    case 'MeTooRecorded': {
      requireExists(state);
      const member = actorMember(event);
      if (state.meTooBy.includes(member)) {
        throw new PreconditionError(
          'ALREADY_ME_TOO',
          'ya habías dicho que te pasa lo mismo: no se cuenta dos veces',
        );
      }
      return { ...base, meTooBy: [...state.meTooBy, member] };
    }

    case 'ProblemStatusChanged': {
      requireExists(state);
      if (payload.status === state.status) {
        throw new PreconditionError('STATUS_UNCHANGED', 'el problema ya está en ese estado');
      }
      return { ...base, status: payload.status };
    }
  }
}

/** Pliega el log completo. El orden canónico es por `seq`. */
export function replayProblem(log: ProblemLog): ProblemState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacío no identifica ningún problema');
  }
  let state = initialProblemState(first.aggregateId);
  for (const event of log) state = applyProblem(state, event);
  return state;
}

/** Cuántas personas dijeron «a mí también me pasa». Es lo único que la interfaz puede mostrar. */
export function meTooCount(state: ProblemState): number {
  return state.meTooBy.length;
}

/** Aportes vivos, en orden de llegada. Los retirados siguen en `state.evidence`, marcados. */
export function liveEvidence(state: ProblemState): readonly EvidenceRecord[] {
  return state.evidence.filter((e) => e.retracted === undefined);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes. Todas autorizan ANTES de construir el evento.
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ProblemCommandMeta {
  readonly eventId: EventId;
  readonly at: Instant;
  readonly actor: Actor;
}

async function emit(
  log: ProblemLog,
  state: ProblemState,
  meta: ProblemCommandMeta,
  aggregateId: string,
  payload: ProblemPayload,
): Promise<ProblemLog> {
  if (meta.actor.memberId === undefined) {
    throw new PreconditionError('NOT_AUTHENTICATED', 'este acto exige una cuenta verificada');
  }
  const event = await appendChained<ProblemPayload>(log, {
    eventId: meta.eventId,
    aggregateId,
    occurredAt: meta.at,
    actor: meta.actor.memberId,
    payload,
  });
  // Se pliega antes de devolver: una orden que produce un log que `replayProblem` rechazaría es un
  // log ya roto en el momento de escribirse, y el error aparecería en la siguiente lectura —quizá
  // en la auditoría— con el evento ya encadenado e imposible de retirar.
  applyProblem(state, event);
  return [...log, event];
}

export async function openProblem(
  meta: ProblemCommandMeta,
  input: {
    readonly problemId: string;
    readonly title: string;
    readonly body: string;
    readonly circleId: CircleId;
  },
): Promise<ProblemLog> {
  authorize(meta.actor, 'problem:create', { kind: 'problem', circleId: input.circleId });
  return emit([], initialProblemState(input.problemId), meta, input.problemId, {
    type: 'ProblemOpened',
    title: input.title,
    body: input.body,
    circleId: input.circleId,
  });
}

export async function attachEvidence(
  log: ProblemLog,
  meta: ProblemCommandMeta,
  input: {
    readonly evidenceId: string;
    readonly certainty: EvidenceCertainty;
    readonly body: string;
    readonly source?: string | undefined;
  },
): Promise<ProblemLog> {
  const state = replayProblem(log);
  authorize(meta.actor, 'evidence:attach', {
    kind: 'evidence',
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  return emit(log, state, meta, state.problemId, {
    type: 'EvidenceAttached',
    evidenceId: input.evidenceId,
    certainty: input.certainty,
    body: input.body,
    ...(input.source === undefined ? {} : { source: input.source }),
  });
}

/**
 * Retira un aporte. **Autorización horizontal**: la referencia del recurso lleva el autor real del
 * aporte, leído del log, no el que diga el cliente.
 */
export async function retractEvidence(
  log: ProblemLog,
  meta: ProblemCommandMeta,
  input: { readonly evidenceId: string; readonly motivation: string },
): Promise<ProblemLog> {
  const state = replayProblem(log);
  const record = state.evidence.find((e) => e.evidenceId === input.evidenceId);
  authorize(meta.actor, 'evidence:retract', {
    kind: 'evidence',
    // Si el aporte no existe, `owner` es `undefined` y `authorize` deniega por `OWNER_UNKNOWN`: no
    // se filtra si el identificador existe o no antes de comprobar el permiso.
    ...(record === undefined ? {} : { owner: record.by }),
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  return emit(log, state, meta, state.problemId, {
    type: 'EvidenceRetracted',
    evidenceId: input.evidenceId,
    motivation: input.motivation,
  });
}

/** «A mí también me pasa». Se atribuye a quien lo dice y a nadie más (autorización horizontal). */
export async function recordMeToo(log: ProblemLog, meta: ProblemCommandMeta): Promise<ProblemLog> {
  const state = replayProblem(log);
  authorize(meta.actor, 'problem:me-too', {
    kind: 'problem',
    subject: meta.actor.memberId,
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  return emit(log, state, meta, state.problemId, { type: 'MeTooRecorded' });
}

export async function changeProblemStatus(
  log: ProblemLog,
  meta: ProblemCommandMeta,
  status: ProblemStatus,
): Promise<ProblemLog> {
  const state = replayProblem(log);
  authorize(meta.actor, 'problem:create', {
    kind: 'problem',
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  return emit(log, state, meta, state.problemId, { type: 'ProblemStatusChanged', status });
}
