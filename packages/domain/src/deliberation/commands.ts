/**
 * Órdenes de la deliberación, y el plegado del historial.
 *
 * ═══ La ventana es real, no una etiqueta ═══
 *
 * `submitContribution` recibe el instante como dato (`meta.at`) y rechaza con `WRITE_WINDOW_CLOSED`
 * si `now >= closesAt`, **aunque el evento de avance de etapa todavía no se haya escrito**. Es la
 * diferencia entre una fase y un rótulo: si el cierre dependiera de que alguien pulse un botón, la
 * ventana duraría hasta que alguien se acordara. Un aporte tardío **falla**: no se encola, no se
 * reubica en la etapa siguiente y no se guarda «para después». Reubicarlo sería peor que perderlo,
 * porque una perspectiva escrita a ciegas que reaparece en la etapa de objeciones ya se escribió
 * sabiendo cosas que sus vecinas no sabían.
 *
 * ═══ Dónde está la autorización ═══
 *
 * Toda orden llama a `authorize` **antes** de construir el evento, igual que en `workspace/`. No hay
 * ninguna variante «sin comprobar»: la orden es la puerta.
 *
 * ═══ Acciones propias en la matriz ═══
 *
 * Cada orden usa su propia `Action` de `access.ts`: abrir y avanzar son de facilitación o garantías
 * dentro del círculo; aportar exige membresía del círculo; revelar es sólo de garantías. Así ninguna
 * regla de deliberación vive como excepción local y `tech-admin` no obtiene escritura alguna.
 *
 * ═══ Consecuencia declarada: `perspectivas_revelando` puede atascarse ═══
 *
 * No se sale de esa etapa mientras quede un aporte sellado sin revelar, y la apertura vive fuera del
 * dominio. Si la apertura se pierde, la deliberación se queda ahí. Es el precio de que la autoría no
 * se pueda falsificar: cualquier «salida de emergencia» sería una vía para cerrar la etapa dejando
 * perspectivas cuya autoría nadie tendrá que asumir nunca. Se reporta como consecuencia conocida, no
 * se tapa con una válvula.
 */

import { type Actor, authorize } from '../access.js';
import { InvalidIdError, PreconditionError } from '../errors.js';
import { type CircleId, type EventId, ID_PATTERN, type Instant, type MemberId } from '../ids.js';
import { appendChained, verifyChain } from '../workspace/chain.js';
import {
  assertAuthorCommitment,
  assertAuthorPseudonym,
  authorCommitment,
  authorPseudonym,
} from './authorship.js';
import { assertReferences } from './graph.js';
import {
  assertBodyAllowedInStage,
  assertStageTransition,
  stageSealsAuthorship,
} from './state-machine.js';
import {
  assertContributionBody,
  type AuthorNonce,
  type ContributionBody,
  type ContributionId,
  type ContributionRecord,
  type DeliberationEvent,
  deliberationId as toDeliberationId,
  type DeliberationId,
  type DeliberationLog,
  type DeliberationNonce,
  type DeliberationPayload,
  type DeliberationStage,
  type DeliberationState,
  findContribution,
  initialDeliberationState,
  type PresentationSeed,
  type StageAdvanceCause,
  unrevealedContributions,
} from './types.js';

/**
 * Diez aportes permiten un hilo corto de postura, razón y evidencia sin que una etapa anónima
 * quede ilimitada. Cada apertura puede fijar un límite menor o mayor, que queda en el ledger.
 */
export const DEFAULT_MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE = 10;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Plegado
// ═════════════════════════════════════════════════════════════════════════════════════════════

function requireExists(state: DeliberationState): void {
  if (!state.exists) {
    throw new PreconditionError('DELIBERATION_NOT_OPEN', 'esa deliberación todavía no existe');
  }
}

function assertOpaqueProblemId(value: string): void {
  if (!ID_PATTERN.test(value)) {
    throw new InvalidIdError('ProblemId', value, '32 caracteres hexadecimales en minúscula');
  }
}

/**
 * Una ventana de escritura tiene que estar por delante del acto que la abre y durar algo.
 *
 * Sin la primera condición se podría abrir una etapa ya vencida, que es una forma silenciosa de
 * saltársela: nadie llegaría nunca a escribir en ella y el avance por plazo sería inmediato.
 */
function assertWindow(opensAt: Instant, closesAt: Instant, occurredAt: Instant): void {
  if (opensAt < occurredAt) {
    throw new PreconditionError(
      'WINDOW_OPENS_IN_THE_PAST',
      'una etapa no se abre en el pasado: sería abrirla y cerrarla en el mismo acto',
    );
  }
  if (closesAt <= opensAt) {
    throw new PreconditionError(
      'WINDOW_INVERTED',
      'la ventana de escritura de una etapa tiene que cerrar después de abrir',
    );
  }
}

function assertWriteWindow(state: DeliberationState, at: Instant): void {
  if (state.opensAt === undefined || state.closesAt === undefined) {
    throw new PreconditionError(
      'DELIBERATION_NOT_OPEN',
      'la deliberación no tiene ventana vigente',
    );
  }
  if (at < state.opensAt) {
    throw new PreconditionError(
      'WRITE_WINDOW_NOT_OPEN',
      'la ventana de escritura de esta etapa todavía no abrió',
    );
  }
  if (at >= state.closesAt) {
    throw new PreconditionError(
      'WRITE_WINDOW_CLOSED',
      'la ventana de escritura de esta etapa ya cerró. Un aporte tardío no se encola ni se ' +
        'reubica en la etapa siguiente: se rechaza',
    );
  }
}

function assertContributionLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PreconditionError(
      'INVALID_MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE',
      'maxContributionsPerAuthorPerStage tiene que ser un entero seguro mayor que cero',
    );
  }
}

/**
 * Pliega un evento. Rechaza y deja el estado del llamante intacto si algo no cuadra.
 *
 * Es `async` porque revelar autoría exige **recomputar el compromiso**, y hashear es asíncrono. Que
 * la comprobación viva aquí y no sólo en la orden es lo que impide que un historial fabricado a mano
 * cuele una autoría falsa: el replay lo rechaza igual.
 */
export async function applyDeliberation(
  state: DeliberationState,
  event: DeliberationEvent,
): Promise<DeliberationState> {
  if (event.aggregateId !== state.deliberationId) {
    throw new PreconditionError(
      'WRONG_AGGREGATE',
      `el evento pertenece a ${event.aggregateId} y el agregado es ${state.deliberationId}`,
    );
  }
  const base: DeliberationState = { ...state, lastSeq: event.seq };
  const payload = event.payload;

  switch (payload.type) {
    case 'DeliberationOpened': {
      if (state.exists) {
        throw new PreconditionError(
          'DELIBERATION_ALREADY_OPEN',
          'una deliberación se abre una sola vez',
        );
      }
      if (event.actor === 'system') {
        throw new PreconditionError(
          'SYSTEM_CANNOT_OPEN',
          'abrir una deliberación es un acto de procedimiento con responsable, no un automatismo',
        );
      }
      assertOpaqueProblemId(payload.problemId);
      assertContributionLimit(payload.maxContributionsPerAuthorPerStage);
      assertWindow(payload.opensAt, payload.closesAt, event.occurredAt);
      return {
        ...base,
        exists: true,
        problemId: payload.problemId,
        circleId: payload.circleId,
        stage: payload.stage,
        opensAt: payload.opensAt,
        closesAt: payload.closesAt,
        presentationSeed: payload.presentationSeed,
        maxContributionsPerAuthorPerStage: payload.maxContributionsPerAuthorPerStage,
      };
    }

    case 'ContributionSubmitted': {
      requireExists(state);
      if (payload.stage !== state.stage) {
        throw new PreconditionError(
          'STAGE_MISMATCH',
          `el aporte dice pertenecer a la etapa ${payload.stage} y la vigente es ${state.stage}`,
        );
      }
      if (findContribution(state, payload.contributionId) !== undefined) {
        throw new PreconditionError(
          'DUPLICATE_CONTRIBUTION',
          'ese identificador de aporte ya está en el historial',
        );
      }
      // La ventana se comprueba ANTES que la forma: un aporte fuera de plazo se rechaza por estar
      // fuera de plazo, no por un detalle de su cuerpo que ya no viene al caso.
      assertWriteWindow(state, event.occurredAt);
      assertContributionBody(payload.body);
      assertBodyAllowedInStage(state.stage, payload.body, payload.supersedesContributionId);
      assertReferences(state, event.seq, payload.body, payload.supersedesContributionId);

      const mustSeal = stageSealsAuthorship(state.stage);
      if (payload.authorship.mode === 'sealed') {
        if (!mustSeal) {
          throw new PreconditionError(
            'AUTHORSHIP_MODE_MISMATCH',
            `la etapa ${state.stage} no sella la autoría: fuera de perspectivas el autor es público`,
          );
        }
        if (event.actor !== 'system') {
          // El sobre encadenado lleva `actor`. Si ahí fuera el autor, el compromiso sería un adorno
          // sobre un dato que ya está en claro dos líneas más arriba.
          throw new PreconditionError(
            'SEALED_AUTHOR_LEAKED',
            'un aporte sellado se escribe con actor `system`: el autor sólo existe en el compromiso',
          );
        }
        const limit = state.maxContributionsPerAuthorPerStage;
        if (limit === undefined) {
          throw new PreconditionError(
            'DELIBERATION_NOT_OPEN',
            'la deliberación no declara un límite de aportes por seudónimo',
          );
        }
        const pseudonym = payload.authorship.authorPseudonym;
        const submittedByPseudonym = state.contributions.filter(
          (contribution) =>
            contribution.stage === state.stage &&
            contribution.authorship.mode === 'sealed' &&
            contribution.authorship.authorPseudonym === pseudonym,
        ).length;
        if (submittedByPseudonym >= limit) {
          throw new PreconditionError(
            'MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE_REACHED',
            `el seudónimo ya alcanzó el máximo de ${String(limit)} aportes en ${state.stage}`,
          );
        }
      } else {
        if (mustSeal) {
          throw new PreconditionError(
            'AUTHORSHIP_MODE_MISMATCH',
            'en perspectivas la autoría se sella: un aporte con autor en claro rompe la etapa a ciegas',
          );
        }
        if (event.actor !== payload.authorship.authorId) {
          throw new PreconditionError(
            'NOT_THE_AUTHOR',
            'el aporte se atribuye a alguien que no es quien lo escribió',
          );
        }
      }

      const record: ContributionRecord = {
        contributionId: payload.contributionId,
        stage: payload.stage,
        body: payload.body,
        authorship: payload.authorship,
        supersedesContributionId: payload.supersedesContributionId,
        submittedAt: event.occurredAt,
        seq: event.seq,
        revealedAuthorId: undefined,
        revealedNonce: undefined,
      };
      return { ...base, contributions: [...state.contributions, record] };
    }

    case 'ContributionAuthorRevealed': {
      requireExists(state);
      if (state.stage !== 'perspectivas_revelando') {
        throw new PreconditionError(
          'REVEAL_OUT_OF_STAGE',
          'la autoría se destapa en perspectivas_revelando, después de cerrar la escritura a ciegas',
        );
      }
      const record = findContribution(state, payload.contributionId);
      if (record === undefined) {
        throw new PreconditionError(
          'UNKNOWN_CONTRIBUTION',
          'ese aporte no existe en esta deliberación',
        );
      }
      if (record.authorship.mode !== 'sealed') {
        throw new PreconditionError(
          'CONTRIBUTION_NOT_SEALED',
          'ese aporte ya tenía autoría pública: no hay nada que destapar',
        );
      }
      if (record.revealedAuthorId !== undefined) {
        throw new PreconditionError(
          'ALREADY_REVEALED',
          'la autoría de un aporte se destapa exactamente una vez',
        );
      }
      await assertAuthorCommitment(record.authorship.authorCommitment, {
        deliberationId: state.deliberationId,
        contributionId: payload.contributionId,
        authorId: payload.authorId,
        nonce: payload.nonce,
      });
      await assertAuthorPseudonym(record.authorship.authorPseudonym, {
        deliberationId: state.deliberationId,
        authorId: payload.authorId,
        deliberationNonce: payload.deliberationNonce,
      });
      return {
        ...base,
        contributions: state.contributions.map((c) =>
          c.contributionId === payload.contributionId
            ? { ...c, revealedAuthorId: payload.authorId, revealedNonce: payload.nonce }
            : c,
        ),
      };
    }

    case 'StageAdvanced': {
      requireExists(state);
      if (payload.from !== state.stage) {
        throw new PreconditionError(
          'STAGE_MISMATCH',
          `el avance dice salir de ${payload.from} y la etapa vigente es ${state.stage}`,
        );
      }
      assertStageTransition(payload.from, payload.to);
      if (payload.from === 'perspectivas_revelando') {
        const pending = unrevealedContributions(state);
        if (pending.length > 0) {
          throw new PreconditionError(
            'UNREVEALED_AUTHORSHIP',
            `quedan ${String(pending.length)} perspectivas sin autoría destapada: salir de la ` +
              'etapa de revelación dejaría aportes que nadie tendría que asumir nunca',
          );
        }
      }
      if (payload.cause === 'deadline') {
        if (state.closesAt === undefined || event.occurredAt < state.closesAt) {
          throw new PreconditionError(
            'DEADLINE_NOT_REACHED',
            'el avance por plazo exige que la ventana haya vencido; antes de eso el avance es ' +
              'manual y tiene responsable',
          );
        }
      }
      assertWindow(payload.opensAt, payload.closesAt, event.occurredAt);
      return {
        ...base,
        stage: payload.to,
        opensAt: payload.opensAt,
        closesAt: payload.closesAt,
        presentationSeed: payload.presentationSeed,
      };
    }
  }
}

/** Pliega el historial completo. El orden canónico es por `seq`. */
export async function replayDeliberation(log: DeliberationLog): Promise<DeliberationState> {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError(
      'EMPTY_LOG',
      'un historial vacío no identifica ninguna deliberación',
    );
  }
  let state = initialDeliberationState(toDeliberationId(first.aggregateId));
  for (const event of log) state = await applyDeliberation(state, event);
  return state;
}

/** Cadena intacta **y** historial plegable. Es lo que mira la pantalla «Verificar integridad». */
export async function verifyDeliberationLog(log: DeliberationLog): Promise<DeliberationState> {
  await verifyChain(log);
  return replayDeliberation(log);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes. Todas autorizan ANTES de construir el evento.
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface DeliberationCommandMeta {
  readonly eventId: EventId;
  /** El instante del servidor. Es el `now` de la ventana: entra como dato, no se lee de un reloj. */
  readonly at: Instant;
  readonly actor: Actor;
}

function requireIdentity(meta: DeliberationCommandMeta): MemberId {
  const memberId = meta.actor.memberId;
  if (memberId === undefined) {
    throw new PreconditionError('NOT_AUTHENTICATED', 'este acto exige una cuenta verificada');
  }
  return memberId;
}

async function emit(
  log: DeliberationLog,
  state: DeliberationState,
  aggregateId: DeliberationId,
  meta: DeliberationCommandMeta,
  actor: MemberId | 'system',
  payload: DeliberationPayload,
): Promise<DeliberationLog> {
  const event = await appendChained<DeliberationPayload>(log, {
    eventId: meta.eventId,
    aggregateId,
    occurredAt: meta.at,
    actor,
    payload,
  });
  // Se pliega antes de devolver: una orden que produce un historial que `replayDeliberation`
  // rechazaría es un historial ya roto en el momento de escribirse, y el error aparecería en la
  // siguiente lectura —quizá en la auditoría— con el evento ya encadenado e imposible de retirar.
  await applyDeliberation(state, event);
  return [...log, event];
}

export interface OpenDeliberationInput {
  readonly deliberationId: DeliberationId;
  readonly problemId: string;
  readonly circleId: CircleId;
  readonly opensAt: Instant;
  readonly closesAt: Instant;
  /** Entra como dato: el dominio no genera aleatoriedad. Fija el orden de la primera etapa. */
  readonly presentationSeed: PresentationSeed;
  readonly maxContributionsPerAuthorPerStage?: number | undefined;
}

/** Abre la deliberación en `preguntas_aclaratorias`. Acto de procedimiento, con responsable. */
export async function openDeliberation(
  meta: DeliberationCommandMeta,
  input: OpenDeliberationInput,
): Promise<DeliberationLog> {
  authorize(meta.actor, 'deliberation:open', { kind: 'decision', circleId: input.circleId });
  const author = requireIdentity(meta);
  return emit(
    [],
    initialDeliberationState(input.deliberationId),
    input.deliberationId,
    meta,
    author,
    {
      type: 'DeliberationOpened',
      problemId: input.problemId,
      circleId: input.circleId,
      stage: 'preguntas_aclaratorias',
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      presentationSeed: input.presentationSeed,
      maxContributionsPerAuthorPerStage:
        input.maxContributionsPerAuthorPerStage ?? DEFAULT_MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE,
    },
  );
}

export interface SubmitContributionInput {
  readonly contributionId: ContributionId;
  readonly body: ContributionBody;
  readonly supersedesContributionId?: ContributionId | undefined;
  /**
   * 128 bits de apertura. **Obligatorio** en `perspectivas` y prohibido fuera de ella.
   *
   * Nunca entra al evento: sólo se usa para construir el compromiso. Quien lo guarde es la capa de
   * aplicación (ADR-0045); este paquete lo recibe, lo usa y lo olvida.
   */
  readonly nonce?: AuthorNonce | undefined;
  /** Secreto por deliberación desde la bóveda; nunca entra al evento sellado. */
  readonly deliberationNonce?: DeliberationNonce | undefined;
}

/**
 * Escribe un aporte en la ventana vigente.
 *
 * En `perspectivas` el evento se firma con actor `system` y la autoría viaja sellada; en el resto de
 * las etapas el autor es público y el actor del sobre es esa misma persona.
 */
export async function submitContribution(
  log: DeliberationLog,
  meta: DeliberationCommandMeta,
  input: SubmitContributionInput,
): Promise<DeliberationLog> {
  const state = await replayDeliberation(log);
  authorize(meta.actor, 'deliberation:contribute', {
    kind: 'evidence',
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  const author = requireIdentity(meta);

  const sealed = stageSealsAuthorship(state.stage);
  if (sealed && input.nonce === undefined) {
    throw new PreconditionError(
      'SEALED_NONCE_REQUIRED',
      'en perspectivas la autoría se sella y el compromiso exige un nonce de 128 bits, que entra ' +
        'como dato',
    );
  }
  if (sealed && input.deliberationNonce === undefined) {
    throw new PreconditionError(
      'SEALED_DELIBERATION_NONCE_REQUIRED',
      'en perspectivas el seudónimo exige el nonce secreto de la deliberación, que entra como dato',
    );
  }
  if (!sealed && input.nonce !== undefined) {
    throw new PreconditionError(
      'NONCE_NOT_APPLICABLE',
      'fuera de perspectivas la autoría es pública: un nonce ahí sugiere una protección que no hay',
    );
  }
  if (!sealed && input.deliberationNonce !== undefined) {
    throw new PreconditionError(
      'DELIBERATION_NONCE_NOT_APPLICABLE',
      'fuera de perspectivas no se deriva seudónimo: el nonce de deliberación no corresponde',
    );
  }

  const payload: DeliberationPayload = {
    type: 'ContributionSubmitted',
    contributionId: input.contributionId,
    stage: state.stage,
    body: input.body,
    authorship:
      sealed && input.nonce !== undefined && input.deliberationNonce !== undefined
        ? {
            mode: 'sealed',
            authorCommitment: await authorCommitment({
              deliberationId: state.deliberationId,
              contributionId: input.contributionId,
              authorId: author,
              nonce: input.nonce,
            }),
            authorPseudonym: await authorPseudonym({
              deliberationId: state.deliberationId,
              authorId: author,
              deliberationNonce: input.deliberationNonce,
            }),
          }
        : { mode: 'public', authorId: author },
    ...(input.supersedesContributionId === undefined
      ? {}
      : { supersedesContributionId: input.supersedesContributionId }),
  };

  return emit(log, state, state.deliberationId, meta, sealed ? 'system' : author, payload);
}

export interface RevealContributionAuthorInput {
  readonly contributionId: ContributionId;
  readonly authorId: MemberId;
  readonly nonce: AuthorNonce;
  readonly deliberationNonce: DeliberationNonce;
}

/**
 * Destapa la autoría de un aporte sellado.
 *
 * **Sólo `guarantees`.** No hay ninguna `Action` existente cuya regla sea exactamente esa, así que se
 * usa la más próxima y se cierra la diferencia con una denegación explícita. Aflojar la regla habría
 * concedido a la facilitación la capacidad de destapar autorías, que es la que el §7 le niega.
 *
 * No se comprueba la ventana de `perspectivas_revelando`: si se comprobara, un plazo vencido con
 * aportes sin destapar dejaría la deliberación atascada sin salida posible, porque tampoco se puede
 * avanzar con aportes sin revelar.
 */
export async function revealContributionAuthor(
  log: DeliberationLog,
  meta: DeliberationCommandMeta,
  input: RevealContributionAuthorInput,
): Promise<DeliberationLog> {
  const state = await replayDeliberation(log);
  authorize(meta.actor, 'deliberation:reveal-authorship', {
    kind: 'decision',
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  const author = requireIdentity(meta);
  return emit(log, state, state.deliberationId, meta, author, {
    type: 'ContributionAuthorRevealed',
    contributionId: input.contributionId,
    authorId: input.authorId,
    nonce: input.nonce,
    deliberationNonce: input.deliberationNonce,
  });
}

export interface AdvanceStageInput {
  readonly to: DeliberationStage;
  readonly cause: StageAdvanceCause;
  readonly opensAt: Instant;
  readonly closesAt: Instant;
  /** Entra como dato. Fija el orden de presentación de la etapa que se abre. */
  readonly presentationSeed: PresentationSeed;
}

/**
 * Avanza a la etapa siguiente. Avance **dual**: `manual` lo decide quien facilita; `deadline` exige
 * que la ventana haya vencido (`now >= closesAt`).
 *
 * Las dos causas escriben el mismo evento y las dos exigen un responsable: lo que cambia es la
 * discrecionalidad. `manual` la tiene y por eso queda registrada como tal; `deadline` no la tiene y
 * el dominio comprueba el plazo. Que el avance por plazo tenga que escribirlo alguien no debilita la
 * ventana: la ventana ya cerró sola en `submitContribution`, este evento sólo lo hace constar.
 */
export async function advanceStage(
  log: DeliberationLog,
  meta: DeliberationCommandMeta,
  input: AdvanceStageInput,
): Promise<DeliberationLog> {
  const state = await replayDeliberation(log);
  authorize(meta.actor, 'deliberation:advance-stage', {
    kind: 'decision',
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  const author = requireIdentity(meta);
  return emit(log, state, state.deliberationId, meta, author, {
    type: 'StageAdvanced',
    from: state.stage,
    to: input.to,
    cause: input.cause,
    opensAt: input.opensAt,
    closesAt: input.closesAt,
    presentationSeed: input.presentationSeed,
  });
}
