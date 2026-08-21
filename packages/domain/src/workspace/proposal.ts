/**
 * Agregado **propuesta**: un texto concreto que responde a un problema, con sus versiones.
 *
 * ═══ Una enmienda NO edita: añade ═══
 *
 * `ProposalAmended` **no reemplaza** nada. La versión 1 queda exactamente donde estaba, con su
 * texto, su autoría, su instante y su hash, y sigue verificando después de que exista la versión 2.
 * Es la única forma de que «consentir un texto es consentir *ese* texto» (A.6 / INV-09) signifique
 * algo: si la V1 pudiera editarse, una papeleta emitida sobre ella no tendría referente.
 *
 * El `versionHash` de cada versión es **el mismo valor** que la `DecisionConfig` congela como
 * `proposalVersionHash`. No es una copia ni una correspondencia por convenio: es el mismo hash,
 * calculado por la misma función. Por eso una papeleta emitida sobre la V1 se invalida sola cuando
 * la decisión pasa a la V2, sin que nadie tenga que acordarse de invalidarla.
 *
 * ═══ Enmendar es horizontal ═══
 *
 * Una propuesta la enmienda **quien la escribió**. El resto del Instituto tiene el mismo rol y no
 * puede tocarla: para eso existe «proponer una enmienda» como objeto con ciclo propio (PRODUCT §4),
 * que es una propuesta nueva, con su autoría y su historia.
 */

import { type Actor, authorize } from '../access.js';
import { hashCanonical } from '../canonical.js';
import { PreconditionError } from '../errors.js';
import type { CircleId, DecisionId, EventId, Hash, Instant, MemberId } from '../ids.js';
import { appendChained, type ChainedEvent, type ChainedLog, verifyChain } from './chain.js';
import { assertLedgerText, MAX_BODY_LENGTH, MAX_TITLE_LENGTH, meaningfulLength } from './text.js';

export const MIN_PROPOSAL_TITLE_LENGTH = 10;
export const MIN_PROPOSAL_BODY_LENGTH = 50;
/** Enmendar exige decir qué cambia y por qué. Sin eso, «V2» es un número sin información. */
export const MIN_RATIONALE_LENGTH = 20;

export type ProposalPayload =
  | {
      readonly type: 'ProposalDrafted';
      readonly problemId: string;
      readonly circleId: CircleId;
      readonly title: string;
      readonly body: string;
      readonly versionHash: Hash;
    }
  | {
      readonly type: 'ProposalAmended';
      readonly version: number;
      readonly title: string;
      readonly body: string;
      readonly versionHash: Hash;
      readonly rationale: string;
    }
  | {
      readonly type: 'DecisionLinked';
      readonly decisionId: DecisionId;
      readonly versionHash: Hash;
    };

export type ProposalEvent = ChainedEvent<ProposalPayload>;
export type ProposalLog = ChainedLog<ProposalPayload>;

export interface ProposalVersion {
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly versionHash: Hash;
  readonly by: MemberId;
  readonly at: Instant;
  /** Por qué se enmendó. Ausente sólo en la versión 1, que no enmienda nada. */
  readonly rationale: string | undefined;
  readonly seq: number;
}

export interface ProposalState {
  readonly proposalId: string;
  readonly exists: boolean;
  readonly problemId: string | undefined;
  readonly circleId: CircleId | undefined;
  readonly author: MemberId | undefined;
  /** Todas las versiones, en orden. **Nunca se sobrescribe ninguna.** */
  readonly versions: readonly ProposalVersion[];
  /** Decisiones abiertas sobre esta propuesta, con la versión exacta que se sometió. */
  readonly decisions: readonly { readonly decisionId: DecisionId; readonly versionHash: Hash }[];
  readonly lastSeq: number;
}

export function initialProposalState(proposalId: string): ProposalState {
  return {
    proposalId,
    exists: false,
    problemId: undefined,
    circleId: undefined,
    author: undefined,
    versions: [],
    decisions: [],
    lastSeq: 0,
  };
}

/**
 * `versionHash = sha256Hex(jcs({ proposalId, version, title, body }))`.
 *
 * Es el identificador criptográfico de **este** texto. Cambiar una coma cambia el hash, y con él la
 * versión que una papeleta declara haber visto.
 */
export async function proposalVersionHash(input: {
  readonly proposalId: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
}): Promise<Hash> {
  return hashCanonical({
    proposalId: input.proposalId,
    version: input.version,
    title: input.title,
    body: input.body,
  });
}

function actorMember(event: ProposalEvent): MemberId {
  if (event.actor === 'system') {
    throw new PreconditionError(
      'SYSTEM_CANNOT_AUTHOR',
      'el sistema no redacta propuestas en nombre de nadie',
    );
  }
  return event.actor;
}

/** Pliega un evento. Síncrono: lo criptográfico se comprueba en `verifyProposalLog`. */
export function applyProposal(state: ProposalState, event: ProposalEvent): ProposalState {
  if (event.aggregateId !== state.proposalId) {
    throw new PreconditionError(
      'WRONG_AGGREGATE',
      `el evento pertenece a ${event.aggregateId} y el agregado es ${state.proposalId}`,
    );
  }
  const base: ProposalState = { ...state, lastSeq: event.seq };
  const payload = event.payload;

  switch (payload.type) {
    case 'ProposalDrafted': {
      if (state.exists) {
        throw new PreconditionError('PROPOSAL_ALREADY_DRAFTED', 'una propuesta se redacta una vez');
      }
      assertLedgerText(payload.title, {
        field: 'el título de la propuesta',
        min: MIN_PROPOSAL_TITLE_LENGTH,
        max: MAX_TITLE_LENGTH,
      });
      assertLedgerText(payload.body, {
        field: 'el texto de la propuesta',
        min: MIN_PROPOSAL_BODY_LENGTH,
        max: MAX_BODY_LENGTH,
      });
      return {
        ...base,
        exists: true,
        problemId: payload.problemId,
        circleId: payload.circleId,
        author: actorMember(event),
        versions: [
          {
            version: 1,
            title: payload.title,
            body: payload.body,
            versionHash: payload.versionHash,
            by: actorMember(event),
            at: event.occurredAt,
            rationale: undefined,
            seq: event.seq,
          },
        ],
      };
    }

    case 'ProposalAmended': {
      if (!state.exists) {
        throw new PreconditionError('PROPOSAL_NOT_DRAFTED', 'no se enmienda lo que no existe');
      }
      if (payload.version !== state.versions.length + 1) {
        throw new PreconditionError(
          'NON_CONSECUTIVE_VERSION',
          `las versiones son consecutivas: tocaba la ${String(state.versions.length + 1)} y llegó ` +
            `la ${String(payload.version)}`,
        );
      }
      // Autorización horizontal comprobada TAMBIÉN en el replay: un log fabricado en el que alguien
      // enmienda la propuesta de otra persona no se pliega.
      if (state.author !== event.actor) {
        throw new PreconditionError(
          'NOT_THE_OWNER',
          'una propuesta la enmienda quien la escribió; para el resto existe proponer una enmienda ' +
            'como objeto propio',
        );
      }
      assertLedgerText(payload.title, {
        field: 'el título de la propuesta',
        min: MIN_PROPOSAL_TITLE_LENGTH,
        max: MAX_TITLE_LENGTH,
      });
      assertLedgerText(payload.body, {
        field: 'el texto de la propuesta',
        min: MIN_PROPOSAL_BODY_LENGTH,
        max: MAX_BODY_LENGTH,
      });
      if (meaningfulLength(payload.rationale) < MIN_RATIONALE_LENGTH) {
        throw new PreconditionError(
          'NO_RATIONALE',
          `enmendar exige al menos ${String(MIN_RATIONALE_LENGTH)} caracteres explicando qué ` +
            'cambia y por qué: sin eso, «versión 2» es un número sin información',
        );
      }
      // DECISIÓN: la comparación es sobre el TEXTO, no sobre el comprobante. El comprobante incluye
      // el número de versión en su preimagen —a propósito, para que una papeleta señale una versión
      // sin ambigüedad—, así que dos versiones con el mismo texto tienen comprobantes distintos y
      // compararlos no detectaría nunca una enmienda vacía. La primera versión de este control
      // comparaba comprobantes y era decorativo: pasaba siempre.
      const previous = state.versions.at(-1);
      if (
        previous !== undefined &&
        previous.title === payload.title &&
        previous.body === payload.body
      ) {
        throw new PreconditionError(
          'VERSION_UNCHANGED',
          'la enmienda produce exactamente el mismo texto: no hay nada que versionar',
        );
      }
      return {
        ...base,
        // Se AÑADE. La versión anterior queda intacta, byte a byte, con su hash.
        versions: [
          ...state.versions,
          {
            version: payload.version,
            title: payload.title,
            body: payload.body,
            versionHash: payload.versionHash,
            by: actorMember(event),
            at: event.occurredAt,
            rationale: payload.rationale,
            seq: event.seq,
          },
        ],
      };
    }

    case 'DecisionLinked': {
      if (!state.exists) {
        throw new PreconditionError('PROPOSAL_NOT_DRAFTED', 'no se decide sobre lo que no existe');
      }
      if (!state.versions.some((v) => v.versionHash === payload.versionHash)) {
        throw new PreconditionError(
          'UNKNOWN_VERSION',
          'la decisión dice someter una versión que esta propuesta no tiene',
        );
      }
      if (state.decisions.some((d) => d.decisionId === payload.decisionId)) {
        throw new PreconditionError('DUPLICATE_DECISION', 'esa decisión ya está enlazada');
      }
      return {
        ...base,
        decisions: [
          ...state.decisions,
          { decisionId: payload.decisionId, versionHash: payload.versionHash },
        ],
      };
    }
  }
}

export function replayProposal(log: ProposalLog): ProposalState {
  const first = log[0];
  if (first === undefined) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacío no identifica ninguna propuesta');
  }
  let state = initialProposalState(first.aggregateId);
  for (const event of log) state = applyProposal(state, event);
  return state;
}

/**
 * Verificación completa: cadena de hashes **y** que el `versionHash` de cada versión corresponde de
 * verdad a su texto.
 *
 * Lo segundo es lo que impide el ataque interesante: alterar el cuerpo de la V1 después de que se
 * votó sobre ella. Rompe la cadena (porque el evento cambia) y, aunque alguien recalculara la
 * cadena entera, el `versionHash` almacenado dejaría de corresponder al texto, y ese hash está
 * congelado dentro de la `DecisionConfig`, que a su vez está dentro del `configHash` publicado.
 */
export async function verifyProposalLog(log: ProposalLog): Promise<ProposalState> {
  await verifyChain(log);
  const state = replayProposal(log);
  for (const version of state.versions) {
    const recomputed = await proposalVersionHash({
      proposalId: state.proposalId,
      version: version.version,
      title: version.title,
      body: version.body,
    });
    if (recomputed !== version.versionHash) {
      throw new PreconditionError(
        'VERSION_HASH_MISMATCH',
        `la versión ${String(version.version)} dice tener el hash ${version.versionHash} y su ` +
          `texto produce ${recomputed}`,
      );
    }
  }
  return state;
}

/** La versión vigente: la última. Las anteriores siguen ahí y siguen siendo válidas. */
export function currentVersion(state: ProposalState): ProposalVersion | undefined {
  return state.versions.at(-1);
}

export function versionAt(state: ProposalState, version: number): ProposalVersion | undefined {
  return state.versions.find((v) => v.version === version);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ProposalCommandMeta {
  readonly eventId: EventId;
  readonly at: Instant;
  readonly actor: Actor;
}

async function emit(
  log: ProposalLog,
  state: ProposalState,
  meta: ProposalCommandMeta,
  aggregateId: string,
  payload: ProposalPayload,
): Promise<ProposalLog> {
  if (meta.actor.memberId === undefined) {
    throw new PreconditionError('NOT_AUTHENTICATED', 'este acto exige una cuenta verificada');
  }
  const event = await appendChained<ProposalPayload>(log, {
    eventId: meta.eventId,
    aggregateId,
    occurredAt: meta.at,
    actor: meta.actor.memberId,
    payload,
  });
  applyProposal(state, event);
  return [...log, event];
}

export async function draftProposal(
  meta: ProposalCommandMeta,
  input: {
    readonly proposalId: string;
    readonly problemId: string;
    readonly circleId: CircleId;
    readonly title: string;
    readonly body: string;
  },
): Promise<ProposalLog> {
  authorize(meta.actor, 'proposal:create', { kind: 'proposal', circleId: input.circleId });
  const versionHash = await proposalVersionHash({
    proposalId: input.proposalId,
    version: 1,
    title: input.title,
    body: input.body,
  });
  return emit([], initialProposalState(input.proposalId), meta, input.proposalId, {
    type: 'ProposalDrafted',
    problemId: input.problemId,
    circleId: input.circleId,
    title: input.title,
    body: input.body,
    versionHash,
  });
}

/** Enmienda: crea una versión nueva y **conserva la anterior intacta**. Sólo el autor. */
export async function amendProposal(
  log: ProposalLog,
  meta: ProposalCommandMeta,
  input: {
    readonly title: string;
    readonly body: string;
    readonly rationale: string;
  },
): Promise<ProposalLog> {
  const state = replayProposal(log);
  authorize(meta.actor, 'proposal:amend', {
    kind: 'proposal',
    ...(state.author === undefined ? {} : { owner: state.author }),
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  const version = state.versions.length + 1;
  const versionHash = await proposalVersionHash({
    proposalId: state.proposalId,
    version,
    title: input.title,
    body: input.body,
  });
  return emit(log, state, meta, state.proposalId, {
    type: 'ProposalAmended',
    version,
    title: input.title,
    body: input.body,
    versionHash,
    rationale: input.rationale,
  });
}

/** Deja constancia de que se abrió una decisión sobre una versión concreta. */
export async function linkDecision(
  log: ProposalLog,
  meta: ProposalCommandMeta,
  input: { readonly decisionId: DecisionId; readonly versionHash: Hash },
): Promise<ProposalLog> {
  const state = replayProposal(log);
  authorize(meta.actor, 'decision:open', {
    kind: 'proposal',
    ...(state.circleId === undefined ? {} : { circleId: state.circleId }),
  });
  return emit(log, state, meta, state.proposalId, {
    type: 'DecisionLinked',
    decisionId: input.decisionId,
    versionHash: input.versionHash,
  });
}
