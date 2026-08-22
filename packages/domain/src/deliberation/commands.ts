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
 * porque una perspectiva escrita sin ver las demás que reaparece en la etapa de objeciones ya se
 * escribió sabiendo cosas que sus vecinas no sabían.
 *
 * ═══ Dónde está la autorización ═══
 *
 * Toda orden llama a `authorize` **antes** de construir el evento, igual que en `workspace/`. No hay
 * ninguna variante «sin comprobar»: la orden es la puerta. Y la lectura de la autoría tiene su
 * propia puerta, `readContributionAuthor`, porque leer quién escribió una perspectiva es un acto
 * autorizado mientras `perspectivas` siga vigente (ADR-0049).
 *
 * ═══ El autor va en el evento, y por eso el replay puede revalidar ═══
 *
 * `ContributionSubmitted` lleva `authorId` y el `actor` del sobre es esa misma persona. El plegado
 * comprueba que coincidan (`NOT_THE_AUTHOR`), así que un historial fabricado a mano que atribuya un
 * aporte a otra persona no se pliega. El esquema sellado que ADR-0049 retira **no podía hacer esto**:
 * escribía `actor: 'system'` y el replay se quedaba sin `Actor` que reautorizar.
 *
 * ═══ El tope por persona y etapa ═══
 *
 * Se cuenta sobre el `authorId`, en el dominio y en toda etapa. Es la detección de inundación que el
 * sellado había perdido: allí sólo se podía contar por un seudónimo derivado de un secreto sin dueño.
 */

import { type Actor, authorize } from '../access.js';
import { InvalidIdError, PreconditionError } from '../errors.js';
import { type CircleId, type EventId, ID_PATTERN, type Instant, type MemberId } from '../ids.js';
import { appendChained, verifyChain } from '../workspace/chain.js';
import { assertReferences } from './graph.js';
import { assertBodyAllowedInStage, assertStageTransition } from './state-machine.js';
import {
  assertContributionBody,
  type ContributionBody,
  type ContributionId,
  type ContributionRecord,
  contributionsOfAuthorInStage,
  type DeliberationEvent,
  deliberationId as toDeliberationId,
  type DeliberationId,
  type DeliberationLog,
  type DeliberationPayload,
  type DeliberationStage,
  type DeliberationState,
  findContribution,
  initialDeliberationState,
  type PresentationSeed,
  type StageAdvanceCause,
} from './types.js';

/**
 * Diez aportes permiten un hilo corto de postura, razón y evidencia sin que una etapa quede
 * ilimitada. Cada apertura puede fijar un límite menor o mayor, que queda en el ledger.
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
 * Es **síncrono**, como `applyProblem`, `applyProposal` y `applyInitiative`: plegar un historial de
 * deliberación no exige hashear nada. Lo exigía mientras hubo que recomputar el compromiso de
 * autoría en cada revelación; retirado el sellado (ADR-0049), la asincronía sobraba.
 */
export function applyDeliberation(
  state: DeliberationState,
  event: DeliberationEvent,
): DeliberationState {
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

      // Reautorización en el replay: el sobre y el aporte tienen que nombrar a la misma persona.
      if (event.actor !== payload.authorId) {
        throw new PreconditionError(
          'NOT_THE_AUTHOR',
          'el aporte se atribuye a alguien que no es quien lo escribió',
        );
      }

      const limit = state.maxContributionsPerAuthorPerStage;
      if (limit === undefined) {
        throw new PreconditionError(
          'DELIBERATION_NOT_OPEN',
          'la deliberación no declara un límite de aportes por persona y etapa',
        );
      }
      if (contributionsOfAuthorInStage(state, payload.authorId, state.stage).length >= limit) {
        throw new PreconditionError(
          'MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE_REACHED',
          `esa persona ya alcanzó el máximo de ${String(limit)} aportes en ${state.stage}`,
        );
      }

      const record: ContributionRecord = {
        contributionId: payload.contributionId,
        stage: payload.stage,
        body: payload.body,
        authorId: payload.authorId,
        supersedesContributionId: payload.supersedesContributionId,
        submittedAt: event.occurredAt,
        seq: event.seq,
      };
      return { ...base, contributions: [...state.contributions, record] };
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
export function replayDeliberation(log: DeliberationLog): DeliberationState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError(
      'EMPTY_LOG',
      'un historial vacío no identifica ninguna deliberación',
    );
  }
  let state = initialDeliberationState(toDeliberationId(first.aggregateId));
  for (const event of log) state = applyDeliberation(state, event);
  return state;
}

/** Cadena intacta **y** historial plegable. Es lo que mira la pantalla «Verificar integridad». */
export async function verifyDeliberationLog(log: DeliberationLog): Promise<DeliberationState> {
  await verifyChain(log);
  return replayDeliberation(log);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura de la autoría. Tiene puerta propia porque su permiso depende de la etapa.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Autoriza leer la autoría de esta deliberación, o lanza `UnauthorizedError`.
 *
 * La etapa **se deriva del estado plegado**, nunca la aporta quien llama. Si el llamante pudiera
 * declararla, la regla se saltaría escribiendo otro nombre de etapa en el cuerpo de la petición, que
 * es exactamente la forma en que se cuela la escalada horizontal en `access.ts`.
 */
export function authorizeAuthorshipRead(state: DeliberationState, actor: Actor): void {
  authorize(actor, 'deliberation:read-authorship', {
    kind: 'deliberation',
    stage: state.stage,
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
}

/**
 * Quién escribió ese aporte. **Única** lectura de autoría del dominio.
 *
 * Mientras `perspectivas` sea la etapa vigente lanza `UNAUTHORIZED_STAGE_STILL_OPEN` para cualquier
 * actor, incluida la facilitación. Cerrada la etapa, la lee cualquier miembro del círculo.
 */
export function readContributionAuthor(
  state: DeliberationState,
  actor: Actor,
  id: ContributionId,
): MemberId {
  authorizeAuthorshipRead(state, actor);
  const record = findContribution(state, id);
  if (record === undefined) {
    throw new PreconditionError(
      'UNKNOWN_CONTRIBUTION',
      'ese aporte no existe en esta deliberación',
    );
  }
  return record.authorId;
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
  actor: MemberId,
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
  applyDeliberation(state, event);
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
  authorize(meta.actor, 'deliberation:open', { kind: 'deliberation', circleId: input.circleId });
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
}

/**
 * Escribe un aporte en la ventana vigente, con su autor en claro y en todas las etapas.
 *
 * Que en `perspectivas` la autoría no se muestre no cambia nada de aquí: lo que cambia es que
 * `deliberation:read-authorship` esté denegada mientras esa etapa siga vigente.
 */
export async function submitContribution(
  log: DeliberationLog,
  meta: DeliberationCommandMeta,
  input: SubmitContributionInput,
): Promise<DeliberationLog> {
  const state = replayDeliberation(log);
  authorize(meta.actor, 'deliberation:contribute', {
    kind: 'deliberation',
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  const author = requireIdentity(meta);

  return emit(log, state, state.deliberationId, meta, author, {
    type: 'ContributionSubmitted',
    contributionId: input.contributionId,
    stage: state.stage,
    body: input.body,
    authorId: author,
    ...(input.supersedesContributionId === undefined
      ? {}
      : { supersedesContributionId: input.supersedesContributionId }),
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
 *
 * Salir de `perspectivas` es además lo que **concede** la lectura de la autoría. No hay ninguna
 * condición que pueda dejar el avance bloqueado para siempre: es la diferencia con el esquema
 * retirado, donde una sola apertura perdida congelaba la deliberación (ADR-0049).
 */
export async function advanceStage(
  log: DeliberationLog,
  meta: DeliberationCommandMeta,
  input: AdvanceStageInput,
): Promise<DeliberationLog> {
  const state = replayDeliberation(log);
  authorize(meta.actor, 'deliberation:advance-stage', {
    kind: 'deliberation',
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
