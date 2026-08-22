/**
 * `DecisionEngine` — orquestación pura sobre eventos.
 *
 * Todo el motor es
 *
 * ```
 *   replay : DecisionEvent[] → DecisionState
 *   tally  : (config, papeletas, …) → DecisionResult
 * ```
 *
 * Sin entrada/salida, sin reloj, sin aleatoriedad, sin framework. El tiempo y la aleatoriedad entran
 * **como datos** —instantes y semillas—, nunca como efectos. Las órdenes (`draftDecision`,
 * `openDecision`, `castBallot`, `closeDecision`) no mutan nada: reciben un log y devuelven un log
 * nuevo con un evento más, o lanzan.
 *
 * ═══ DECISIÓN A.8 — el resultado es un dato derivado, no una fuente de verdad ═══
 *
 * `ResultComputed` almacena `resultHash`; cualquier auditor recomputa desde los eventos y compara. Si
 * difiere, la decisión entra en `Annulled` por «inconsistencia de escrutinio». Eso separa «lo que
 * pasó» (eventos) de «lo que concluimos» (resultado) y convierte un bug de escrutinio en una alarma
 * en vez de en un fraude silencioso.
 */

import { sha256, toHex } from '@koinonia/crypto';

import { type Actor, authorize } from './access.js';
import type { Ballot, BallotDraft } from './ballot.js';
import { validateBallot } from './ballot.js';
import {
  assertHardSecrecySupported,
  type DecisionConfig,
  type Delegation,
  type DraftConfig,
  type EarlyCloseConfig,
  isThresholdMethod,
  validateDecisionConfig,
} from './config.js';
import {
  assertDelegationGrantable,
  assertDelegationRevocable,
  assertNoDelegationInSecretBallot,
  type ChainBrokenNotice,
  chainBrokenNotices,
  type DelegationResolution,
  delegationWeightResolver,
  resolveDelegation,
  revokeIn,
  supersededByGrant,
} from './delegation.js';
import { PreconditionError, SeedCommitmentMismatch } from './errors.js';
import { cmpFraction, type Fraction, ratio } from './fraction.js';
import {
  type BallotId,
  type DecisionId,
  type DelegationId,
  type EventId,
  type Hash,
  type Instant,
  instant,
  type MemberId,
  type ObjectionId,
} from './ids.js';
import {
  appendEvent,
  type CloseCause,
  type DecisionEvent,
  type DecisionEventPayload,
  type DecisionLog,
  type EventInput,
  type OutcomeKind,
  verifyLogChain,
} from './events.js';
import { checkQuorum, type QuorumCheck, quorumFailureAction, quorumNarrative } from './quorum.js';
import { type DecisionStatus, type LifecycleStatus, nextStatus } from './state-machine.js';
import {
  concentrationReport,
  concentrationStep,
  concentrationTable,
  computeResultHash,
  countBinary,
  type DecisionResult,
  directWeightResolver,
  type EffectiveBallot,
  effectiveBallots,
  gini,
  herfindahl,
  type MethodTally,
  type Outcome,
  type ProofStep,
  type ProofTable,
  representedMembers,
  step,
  type TallyContext,
  totalWeight,
  type WeightResolver,
} from './tally/common.js';
import { type ObjectionRecord, tallyConsent } from './tally/consent.js';
import { tallyCondorcetSchulze } from './tally/condorcet-schulze.js';
import { tallyIrv } from './tally/irv.js';
import { tallyMajorityJudgment } from './tally/majority-judgment.js';
import { tallyScore } from './tally/score.js';
import { tallySimpleMajority } from './tally/simple-majority.js';
import { tallySortition } from './tally/sortition.js';
import { tallySupermajority } from './tally/supermajority.js';
import { tallyUnanimity } from './tally/unanimity.js';
import {
  DELIBERATION_FLOOR_MS,
  type EffectiveWindow,
  isWithinWindow,
  respectsDeliberationFloor,
} from './window.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Estado
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface DecisionState {
  readonly status: LifecycleStatus;
  readonly decisionId: DecisionId;
  readonly draft: DraftConfig | undefined;
  readonly config: DecisionConfig | undefined;
  /** Todas las papeletas aceptadas, en orden de `seq`. El escrutinio decide cuáles son efectivas. */
  readonly ballots: readonly Ballot[];
  readonly voided: readonly BallotId[];
  readonly round: number;
  readonly proposalVersionHash: Hash | undefined;
  /** Cierre vigente: el programado más las prórrogas emitidas. */
  readonly closesAt: Instant | undefined;
  readonly extensionsUsed: number;
  readonly closedAt: Instant | undefined;
  readonly closeCause: CloseCause | undefined;
  readonly objections: readonly ObjectionRecord[];
  /**
   * Registro de delegaciones que este log conoce (PARTE C), en orden de concesión y con su
   * `revokedAt` ya aplicado. Es el grafo que `resolveDelegation` usa en el escrutinio.
   */
  readonly delegations: readonly Delegation[];
  /** Semilla revelada (`seedAdmin` ‖ faro), si la hubo. */
  readonly seed: string | undefined;
  readonly resultHash: Hash | undefined;
  readonly outcomeKind: OutcomeKind | undefined;
  /** Instante en que el resultado se hizo público; desde aquí corre la ventana de impugnación. */
  readonly resultComputedAt: Instant | undefined;
  readonly lastSeq: number;
}

export function initialState(decision: DecisionId): DecisionState {
  return {
    status: 'Inexistent',
    decisionId: decision,
    draft: undefined,
    config: undefined,
    ballots: [],
    voided: [],
    round: 1,
    proposalVersionHash: undefined,
    closesAt: undefined,
    extensionsUsed: 0,
    closedAt: undefined,
    closeCause: undefined,
    objections: [],
    delegations: [],
    seed: undefined,
    resultHash: undefined,
    outcomeKind: undefined,
    resultComputedAt: undefined,
    lastSeq: 0,
  };
}

function requireConfig(state: DecisionState): DecisionConfig {
  if (state.config === undefined) {
    throw new PreconditionError('NO_CONFIG', 'la decisión todavía no se ha abierto');
  }
  return state.config;
}

/**
 * Comprueba que la apertura congela exactamente el asunto descrito por el borrador.
 *
 * Los dos campos de ADR-0043 son opcionales para poder reproducir decisiones anteriores a ese ADR,
 * pero en una decisión nueva forman una sola referencia: reservar una iniciativa sin congelar el plan
 * (o viceversa) dejaría ambiguo qué mandato se ejecutará si la propuesta resulta aprobada.
 */
function assertDraftMatchesOpening(draft: DraftConfig, config: DecisionConfig): void {
  if (draft.proposalId !== config.proposalId) {
    throw new PreconditionError(
      'DRAFT_PROPOSAL_ID_MISMATCH',
      'DecisionOpened debe conservar el proposalId exacto de DecisionDrafted',
    );
  }
  if (draft.proposalVersionHash !== config.proposalVersionHash) {
    throw new PreconditionError(
      'DRAFT_PROPOSAL_VERSION_MISMATCH',
      'DecisionOpened debe conservar el proposalVersionHash exacto de DecisionDrafted',
    );
  }
  if ((draft.plannedInitiativeId === undefined) !== (draft.executionPlanHash === undefined)) {
    throw new PreconditionError(
      'DRAFT_EXECUTION_PLAN_INCOMPLETE',
      'ADR-0043 exige conservar juntos plannedInitiativeId y executionPlanHash',
    );
  }
}

/** Ventana vigente: la de la configuración, con el cierre desplazado por las prórrogas. */
export function currentWindow(state: DecisionState): EffectiveWindow {
  const config = requireConfig(state);
  return { opensAt: config.window.opensAt, closesAt: state.closesAt ?? config.window.closesAt };
}

function findObjection(
  state: DecisionState,
  id: ObjectionId,
): { record: ObjectionRecord; index: number } {
  const index = state.objections.findIndex((o) => o.objectionId === id);
  const record = state.objections[index];
  if (index < 0 || record === undefined) {
    throw new PreconditionError('UNKNOWN_OBJECTION', `la objeción ${id} no existe en este log`);
  }
  return { record, index };
}

function replaceObjection(
  state: DecisionState,
  index: number,
  next: ObjectionRecord,
): readonly ObjectionRecord[] {
  return state.objections.map((o, i) => (i === index ? next : o));
}

/**
 * Aplica un evento. La máquina de estados decide primero si la pareja `(estado, evento)` es legal
 * (INV-34); después se comprueban las precondiciones específicas. Si algo falla, se lanza y el estado
 * del llamante queda **intacto**, porque nunca se construyó uno nuevo.
 *
 * Es síncrono a propósito: todo lo que exige criptografía —la cadena de hashes del log y el
 * compromiso de la semilla— se verifica en `verifyLog`, que sí es asíncrono. Mezclar ambas cosas
 * haría asíncrono el `replay` entero por dos comprobaciones que son de integridad, no de dominio.
 */
export function apply(state: DecisionState, event: DecisionEvent): DecisionState {
  if (event.decisionId !== state.decisionId) {
    throw new PreconditionError(
      'WRONG_AGGREGATE',
      `el evento pertenece a ${event.decisionId} y el agregado es ${state.decisionId}`,
    );
  }
  const status: DecisionStatus = nextStatus(state.status, event.payload.type);
  const base: DecisionState = { ...state, status, lastSeq: event.seq };
  const payload: DecisionEventPayload = event.payload;

  switch (payload.type) {
    case 'DecisionDrafted':
      return {
        ...base,
        draft: payload.draft,
        proposalVersionHash: payload.draft.proposalVersionHash,
      };

    case 'DecisionOpened': {
      const config = payload.config;
      // La compuerta C6 va **antes** que cualquier otra validación, también en el replay: un log
      // fabricado a mano tampoco puede colar una decisión con secreto duro.
      assertHardSecrecySupported(config.privacy);
      validateDecisionConfig(config);
      if (config.decisionId !== state.decisionId) {
        throw new PreconditionError('WRONG_AGGREGATE', 'la configuración es de otra decisión');
      }
      if (state.draft === undefined) {
        throw new PreconditionError('NO_DRAFT', 'no se puede abrir una decisión sin borrador');
      }
      // Esta comprobación vive en el plegado, no sólo en la ruta HTTP: todo replay y toda
      // verificación del log rechazan una apertura que cambie silenciosamente el asunto decidido.
      assertDraftMatchesOpening(state.draft, config);
      // A.2: el instante de congelación del padrón ES el de la apertura.
      if (config.electorate.frozenAt !== event.occurredAt) {
        throw new PreconditionError(
          'ELECTORATE_NOT_FROZEN_AT_OPENING',
          `el padrón dice haberse congelado en ${String(config.electorate.frozenAt)} y la apertura ` +
            `ocurre en ${String(event.occurredAt)}`,
        );
      }
      if (!isWithinWindow(event.occurredAt, config.window)) {
        throw new PreconditionError(
          'OPENED_OUT_OF_WINDOW',
          'A.8.1 exige opensAt ≤ apertura < closesAt',
        );
      }
      return {
        ...base,
        config,
        proposalVersionHash: config.proposalVersionHash,
        closesAt: config.window.closesAt,
        round: 1,
      };
    }

    case 'BallotCast': {
      const config = requireConfig(state);
      const ballot = payload.ballot;
      // ═══ Autorización horizontal, comprobada en el REPLAY ═══
      //
      // Nadie vota por otro. La comprobación no está sólo en la orden ni sólo en la ruta: está en el
      // plegado, que es el único sitio por el que pasa todo log, venga de donde venga. Un log
      // fabricado a mano —o escrito por una ruta futura que se olvide de comprobarlo— con una
      // papeleta cuyo votante no es el actor del evento **no se pliega**: se rechaza, y la decisión
      // entera queda en cuarentena hasta que alguien explique de dónde salió.
      if (ballot.voter !== event.actor) {
        throw new PreconditionError(
          'BALLOT_NOT_SELF_CAST',
          `el evento lo firma ${String(event.actor)} y la papeleta se atribuye a ${ballot.voter}: ` +
            'nadie emite la papeleta de otra persona',
        );
      }
      if (ballot.seq !== event.seq) {
        throw new PreconditionError(
          'BALLOT_SEQ_MISMATCH',
          'la papeleta debe llevar el `seq` del evento que la transporta (A.4)',
        );
      }
      if (ballot.castAt !== event.occurredAt) {
        throw new PreconditionError(
          'BALLOT_TIME_MISMATCH',
          'D.3.c: `castAt` se asigna en el punto de serialización, junto con `seq`',
        );
      }
      validateBallot(config, ballot, {
        window: currentWindow(state),
        round: state.round,
        proposalVersionHash: state.proposalVersionHash ?? config.proposalVersionHash,
      });
      return { ...base, ballots: [...state.ballots, ballot] };
    }

    case 'BallotVoided': {
      if (!state.ballots.some((b) => b.ballotId === payload.ballotId)) {
        throw new PreconditionError('UNKNOWN_BALLOT', `la papeleta ${payload.ballotId} no existe`);
      }
      // A.2: anular un voto es un acto político visible, no un efecto colateral administrativo.
      if (payload.signers.length < 2) {
        throw new PreconditionError(
          'INSUFFICIENT_SIGNERS',
          'anular una papeleta exige la firma de dos miembros del círculo de garantías (A.2)',
        );
      }
      if (payload.motivation.trim() === '') {
        throw new PreconditionError(
          'NO_MOTIVATION',
          'anular una papeleta exige motivación escrita',
        );
      }
      return { ...base, voided: [...state.voided, payload.ballotId] };
    }

    case 'DelegationGranted': {
      const config = requireConfig(state);
      const delegation = payload.delegation;
      // ═══ Nadie delega por otro ═══
      //
      // La misma razón que en `BallotCast`: la comprobación va en el PLEGADO, que es el único sitio
      // por el que pasa todo log, venga de donde venga. Un log fabricado a mano en el que Marta
      // concede la delegación de Ana no se pliega. Y en la delegación importa aún más que en la
      // papeleta: C.7.2 explica que el canal de coacción de la democracia líquida no es «votá esto»
      // sino «delegá en mí».
      if (delegation.delegator !== event.actor) {
        throw new PreconditionError(
          'DELEGATION_NOT_SELF_GRANTED',
          `el evento lo firma ${String(event.actor)} y la delegación se atribuye a ` +
            `${delegation.delegator}: nadie concede el mandato de otra persona`,
        );
      }
      if (delegation.grantedSeq !== event.seq) {
        throw new PreconditionError(
          'DELEGATION_SEQ_MISMATCH',
          'la delegación debe llevar el `seq` del evento que la transporta: es la clave del orden ' +
            'LIFO de devolución por tope (C.5.b.2)',
        );
      }
      if (delegation.grantedAt !== event.occurredAt) {
        throw new PreconditionError(
          'DELEGATION_TIME_MISMATCH',
          'D.3.c: el instante lo asigna el motor en el punto de serialización, no el cliente',
        );
      }
      assertDelegationGrantable(config, state.delegations, delegation);
      // DECISIÓN C.1.b — una sola delegación activa por `(delegante, ámbito)`. La especificación
      // dice que conceder una nueva «emite automáticamente `DelegationRevoked` de la anterior»,
      // pero `apply` es un PLIEGUE PURO sobre el log: no puede emitir eventos. Se resuelve
      // desplazando la anterior aquí, con `revokedAt = grantedAt` de la nueva, exactamente el
      // instante que la spec fija. Así el efecto es el mismo, el log no crece con un evento que
      // nadie firmó, y —lo que importa— un log traído de fuera con dos concesiones al mismo ámbito
      // y sin la revocación intermedia se pliega al MISMO estado. Reportado como errata E-39.
      const superseded = supersededByGrant(state.delegations, delegation);
      const base_ =
        superseded === undefined
          ? state.delegations
          : revokeIn(state.delegations, superseded.delegationId, delegation.grantedAt);
      return { ...base, delegations: [...base_, delegation] };
    }

    case 'DelegationRevoked': {
      requireConfig(state);
      const revoked = assertDelegationRevocable(
        state.delegations,
        payload.delegationId,
        payload.at,
      );
      if (revoked.delegator !== event.actor) {
        throw new PreconditionError(
          'DELEGATION_NOT_SELF_REVOKED',
          `el evento lo firma ${String(event.actor)} y el mandato es de ${revoked.delegator}: ` +
            'sólo quien delegó revoca',
        );
      }
      if (payload.at !== event.occurredAt) {
        throw new PreconditionError(
          'DELEGATION_TIME_MISMATCH',
          'INV-24: la revocación tiene efecto en el instante EXACTO en que se serializa, no en el ' +
            'que declare el cliente',
        );
      }
      return {
        ...base,
        delegations: revokeIn(state.delegations, payload.delegationId, payload.at),
      };
    }

    case 'ObjectionRaised': {
      const config = requireConfig(state);
      if (config.method.kind !== 'sociocratic-consent') {
        throw new PreconditionError(
          'OBJECTIONS_NOT_APPLICABLE',
          'sólo el consentimiento sociocrático admite objeciones (A.8.1)',
        );
      }
      // A.8.2.7.
      if (payload.objection.raisedAtRound > config.method.maxRounds) {
        throw new PreconditionError(
          'ROUND_EXCEEDED',
          `no se puede objetar en la ronda ${String(payload.objection.raisedAtRound)}: el máximo ` +
            `es ${String(config.method.maxRounds)}`,
        );
      }
      if (payload.objection.raisedAtRound !== state.round) {
        throw new PreconditionError('WRONG_ROUND', 'la objeción no pertenece a la ronda vigente');
      }
      if (state.objections.some((o) => o.objectionId === payload.objection.objectionId)) {
        throw new PreconditionError('DUPLICATE_OBJECTION', 'esa objeción ya está en el log');
      }
      return {
        ...base,
        objections: [
          ...state.objections,
          {
            objectionId: payload.objection.objectionId,
            by: payload.by,
            raisedAtRound: payload.objection.raisedAtRound,
            // B.3.a: toda objeción nace ADMITIDA. La carga de la prueba recae en quien quiere
            // silenciar, no en quien disiente.
            status: 'admitted',
            integrated: false,
            seq: event.seq,
          },
        ],
      };
    }

    case 'ObjectionAdmitted': {
      const { record, index } = findObjection(state, payload.objectionId);
      return {
        ...base,
        objections: replaceObjection(state, index, {
          ...record,
          status: 'admitted',
          seq: event.seq,
        }),
      };
    }

    case 'ObjectionDismissed': {
      const config = requireConfig(state);
      const { record, index } = findObjection(state, payload.objectionId);
      if (config.method.kind !== 'sociocratic-consent') {
        throw new PreconditionError('OBJECTIONS_NOT_APPLICABLE', 'método sin objeciones');
      }
      const { dismissThreshold, panelSize } = config.method.admissibility;
      if (payload.panel.length !== panelSize) {
        throw new PreconditionError(
          'PANEL_SIZE_MISMATCH',
          `el panel debe tener ${String(panelSize)} miembros y tiene ${String(payload.panel.length)}`,
        );
      }
      if (payload.panel.includes(record.by)) {
        throw new PreconditionError(
          'PANEL_INCLUDES_OBJECTOR',
          'B.3.a: el panel se sortea excluyendo a quien objeta y a quien propuso',
        );
      }
      // B.3.a: desestimar exige la fracción configurada del panel (2/3 por defecto).
      if (cmpFraction(ratio(payload.votes, panelSize), dismissThreshold) < 0) {
        throw new PreconditionError(
          'DISMISS_THRESHOLD_NOT_MET',
          `desestimar exige ${dismissThreshold.num.toString()}/${dismissThreshold.den.toString()} ` +
            `del panel y hubo ${String(payload.votes)} de ${String(panelSize)}`,
        );
      }
      if (payload.motivation.trim() === '') {
        throw new PreconditionError(
          'NO_MOTIVATION',
          'desestimar una objeción exige motivación escrita publicada (B.3.a)',
        );
      }
      return {
        ...base,
        objections: replaceObjection(state, index, {
          ...record,
          status: 'dismissed',
          seq: event.seq,
        }),
      };
    }

    case 'ObjectionIntegrated': {
      const { record, index } = findObjection(state, payload.objectionId);
      // B.3.b: sin la firma de quien objetó no hay integración, hay modificación unilateral.
      if (payload.signedBy !== record.by) {
        throw new PreconditionError(
          'INTEGRATION_NOT_SIGNED_BY_OBJECTOR',
          'B.3.b: la enmienda debe estar firmada por quien objetó, declarando que la atiende',
        );
      }
      if (payload.newProposalVersionHash === state.proposalVersionHash) {
        throw new PreconditionError(
          'PROPOSAL_VERSION_UNCHANGED',
          'integrar una objeción exige un texto distinto (B.3.b)',
        );
      }
      return {
        ...base,
        objections: replaceObjection(state, index, { ...record, integrated: true, seq: event.seq }),
      };
    }

    case 'ObjectionWithdrawn': {
      const { record, index } = findObjection(state, payload.objectionId);
      return {
        ...base,
        objections: replaceObjection(state, index, {
          ...record,
          status: 'withdrawn',
          seq: event.seq,
        }),
      };
    }

    case 'RoundOpened': {
      const config = requireConfig(state);
      if (config.method.kind !== 'sociocratic-consent') {
        throw new PreconditionError('ROUNDS_NOT_APPLICABLE', 'sólo el consentimiento tiene rondas');
      }
      if (payload.round !== state.round + 1) {
        throw new PreconditionError('NON_CONSECUTIVE_ROUND', 'las rondas son consecutivas');
      }
      // INV-54: las rondas terminan. El tope duro está en la configuración.
      if (payload.round > config.method.maxRounds) {
        throw new PreconditionError(
          'ROUND_EXCEEDED',
          `maxRounds es ${String(config.method.maxRounds)} (B.3.c)`,
        );
      }
      if (!state.objections.some((o) => o.integrated)) {
        throw new PreconditionError(
          'NOTHING_INTEGRATED',
          'A.8.1: una ronda nueva exige que se haya integrado alguna objeción',
        );
      }
      if (payload.proposalVersionHash === state.proposalVersionHash) {
        throw new PreconditionError(
          'PROPOSAL_VERSION_UNCHANGED',
          'una ronda nueva se abre sobre un texto enmendado (A.6)',
        );
      }
      // Las papeletas de la ronda anterior NO se arrastran (B.3, INV-09): consentir un texto es
      // consentir *ese* texto.
      return { ...base, round: payload.round, proposalVersionHash: payload.proposalVersionHash };
    }

    case 'WindowExtended': {
      const config = requireConfig(state);
      const closesAt = state.closesAt ?? config.window.closesAt;
      if (payload.newClosesAt <= closesAt) {
        throw new PreconditionError(
          'WINDOW_NOT_EXTENDED',
          'A.8.2.5: una prórroga sólo puede aumentar el cierre, nunca retrocederlo',
        );
      }
      if (state.extensionsUsed >= config.quorum.maxExtensions) {
        throw new PreconditionError(
          'TOO_MANY_EXTENSIONS',
          `D.2.a: ya se usaron las ${String(config.quorum.maxExtensions)} prórrogas disponibles`,
        );
      }
      if (event.occurredAt > closesAt) {
        throw new PreconditionError(
          'EXTENSION_AFTER_CLOSE',
          'A.8.2.5: la prórroga no puede resucitar una urna ya vencida; el tick de cierre se emite ' +
            'con occurredAt === closesAt (precisión de D.2)',
        );
      }
      // D.2.b: la prórroga NO recongela el padrón ni invalida las papeletas emitidas.
      return {
        ...base,
        closesAt: payload.newClosesAt,
        extensionsUsed: state.extensionsUsed + 1,
      };
    }

    case 'SeedRevealed':
      // `sha256(seedAdmin) === seedCommitment` se comprueba en `revealSeed` y en `verifyLog`
      // (requiere criptografía asíncrona). Aquí sólo se guarda la semilla compuesta de B.0.3.
      return { ...base, seed: `${payload.seedAdmin}|${payload.beaconValue}` };

    case 'DecisionClosed': {
      const config = requireConfig(state);
      if (payload.at !== event.occurredAt) {
        throw new PreconditionError('CLOSE_TIME_MISMATCH', 'el cierre ocurre cuando dice ocurrir');
      }
      const closesAt = state.closesAt ?? config.window.closesAt;
      if (payload.cause === 'window' && payload.at < closesAt) {
        throw new PreconditionError(
          'CLOSED_TOO_EARLY',
          'un cierre por vencimiento exige que la ventana haya vencido',
        );
      }
      if (payload.cause === 'manual') {
        // A.8.1: el cierre manual exige dos firmas. Sin ellas sería la vía para esquivar D.4 entera.
        if ((payload.signers ?? []).length < 2) {
          throw new PreconditionError(
            'INSUFFICIENT_SIGNERS',
            'A.8.1: un cierre manual exige la firma de dos miembros del círculo de garantías',
          );
        }
      }
      if (payload.cause === 'early-irreversible' || payload.cause === 'full-turnout') {
        if (!config.window.earlyClose.enabled) {
          throw new PreconditionError(
            'EARLY_CLOSE_DISABLED',
            'D.4.a: el cierre anticipado está deshabilitado por defecto',
          );
        }
        if (config.window.earlyClose.mode !== causeToMode(payload.cause)) {
          throw new PreconditionError(
            'EARLY_CLOSE_MODE_MISMATCH',
            `la decisión se abrió con el modo ${config.window.earlyClose.mode} y se intenta cerrar ` +
              `por ${payload.cause}`,
          );
        }
        if (!respectsDeliberationFloor(payload.at, currentWindow(state))) {
          throw new PreconditionError(
            'DELIBERATION_FLOOR',
            `D.4.c: el cierre anticipado nunca ocurre antes de opensAt + ` +
              `${String(DELIBERATION_FLOOR_MS)} ms, aunque el resultado sea irreversible desde el ` +
              'minuto tres',
          );
        }
        // Y la causa alegada tiene que ser cierta: si no se comprobara, «cerró antes porque ya no
        // podía cambiar» sería una afirmación que nadie verifica y el cierre anticipado quedaría a
        // discreción de quien opera el servidor.
        const live = liveTallyFrom(state, payload.at);
        if (payload.cause === 'full-turnout' && live.movableUnassigned !== 0) {
          throw new PreconditionError(
            'TURNOUT_NOT_FULL',
            `quedan ${String(live.movableUnassigned)} personas sin votar: no es participación total`,
          );
        }
        if (payload.cause === 'early-irreversible' && irreversibility(config, live) === 'open') {
          throw new PreconditionError(
            'RESULT_STILL_REVERSIBLE',
            'D.4.1: el resultado todavía puede cambiar en alguna continuación posible',
          );
        }
      }
      return { ...base, closedAt: payload.at, closeCause: payload.cause };
    }

    case 'ResultComputed':
      if (state.resultHash !== undefined || state.resultComputedAt !== undefined) {
        throw new PreconditionError(
          'RESULT_ALREADY_COMPUTED',
          'el resultado ya fue publicado: no se sobrescribe ni se reinicia su ventana de impugnación',
        );
      }
      return {
        ...base,
        resultHash: payload.resultHash,
        outcomeKind: payload.outcomeKind,
        resultComputedAt: event.occurredAt,
      };

    case 'DecisionRatified': {
      if (event.actor === 'system') {
        throw new PreconditionError(
          'RATIFICATION_REQUIRES_MEMBER',
          'la ratificación es un acto humano de procedimiento y nunca se atribuye al sistema',
        );
      }
      const config = requireConfig(state);
      if (
        state.closedAt === undefined ||
        state.outcomeKind === undefined ||
        state.resultComputedAt === undefined
      ) {
        throw new PreconditionError('NO_RESULT', 'no se ratifica lo que no se ha escrutado');
      }
      // La ventana corre desde que el resultado es conocible, no desde el cierre nominal de la urna.
      // Un planificador tardío puede publicar ResultComputed horas después de `closedAt`; usar sólo el
      // cierre permitiría ratificar inmediatamente y convertir la impugnación en una ficción.
      const challengeStartsAt = Math.max(state.closedAt, state.resultComputedAt);
      if (event.occurredAt < challengeStartsAt + config.window.challengeWindow) {
        throw new PreconditionError(
          'CHALLENGE_WINDOW_OPEN',
          'A.8.1: la ratificación espera la ventana completa de impugnación desde que se publicó ' +
            'el resultado',
        );
      }
      // INV-60: el desenlace tiene que ser coherente con el estado final.
      if (
        state.outcomeKind !== 'approved' &&
        state.outcomeKind !== 'winner' &&
        state.outcomeKind !== 'sample'
      ) {
        throw new PreconditionError(
          'OUTCOME_NOT_RATIFIABLE',
          `no se ratifica un desenlace ${state.outcomeKind}`,
        );
      }
      return base;
    }

    case 'DecisionRejected': {
      if (state.outcomeKind === undefined) {
        throw new PreconditionError('NO_RESULT', 'no se rechaza lo que no se ha escrutado');
      }
      if (
        state.outcomeKind === 'approved' ||
        state.outcomeKind === 'winner' ||
        state.outcomeKind === 'sample'
      ) {
        throw new PreconditionError(
          'OUTCOME_NOT_REJECTABLE',
          'INV-60: un desenlace aprobado no se cierra como rechazo',
        );
      }
      return base;
    }

    case 'DecisionAnnulled': {
      if (state.status !== 'Draft' && payload.signers.length < 2) {
        throw new PreconditionError(
          'INSUFFICIENT_SIGNERS',
          'A.8.1: anular exige vicio grave motivado y dos firmas del círculo de garantías',
        );
      }
      if (payload.motivation.trim() === '') {
        throw new PreconditionError('NO_MOTIVATION', 'anular exige motivación escrita');
      }
      return base;
    }
  }
}

/**
 * Verificación completa de un log: cadena de hashes (INV-19), máquina de estados y precondiciones
 * (INV-34), y correspondencia de la semilla con su compromiso (INV-57).
 *
 * Es lo que corre quien audita: `replay` sólo comprueba lo que se puede comprobar sin criptografía.
 */
export async function verifyLog(log: DecisionLog): Promise<DecisionState> {
  await verifyLogChain(log);
  const state = replay(log);
  if (state.config !== undefined) {
    for (const event of log) {
      if (event.payload.type === 'SeedRevealed') {
        await verifySeedReveal(state.config, event.payload.seedAdmin);
      }
    }
  }
  return state;
}

/** Pliega el log completo. El orden canónico es por `seq`, jamás por `occurredAt` (A.9). */
export function replay(log: DecisionLog): DecisionState {
  if (log.length === 0) {
    throw new PreconditionError('EMPTY_LOG', 'un log vacío no identifica ninguna decisión');
  }
  const first = log[0];
  if (first === undefined) throw new PreconditionError('EMPTY_LOG', 'log vacío');
  let state = initialState(first.decisionId);
  for (const event of log) state = apply(state, event);
  return state;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Órdenes
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface CommandMeta {
  readonly eventId: EventId;
  readonly at: Instant;
  readonly actor: MemberId | 'system';
}

/**
 * Sella el evento y **lo aplica antes de devolverlo**.
 *
 * Que la orden valide sus propias precondiciones no es una comodidad: sin esto, una orden puede
 * producir un log que `replay` rechaza, es decir, un log que ya está roto en el momento de
 * escribirse. El error se descubriría en la siguiente lectura —posiblemente en la auditoría— y para
 * entonces el evento ya estaría encadenado y sería imposible de retirar. Aquí se falla antes de
 * escribir.
 */
async function emit(
  log: DecisionLog,
  state: DecisionState,
  input: EventInput,
): Promise<DecisionLog> {
  const event = await appendEvent(log, input);
  apply(state, event);
  return [...log, event];
}

export async function draftDecision(
  log: DecisionLog,
  input: CommandMeta & { readonly decisionId: DecisionId; readonly draft: DraftConfig },
): Promise<DecisionLog> {
  const state = log.length === 0 ? initialState(input.decisionId) : replay(log);
  // `nextStatus` lanza si el estado no admite el evento; se llama aquí para fallar antes de hashear.
  nextStatus(state.status, 'DecisionDrafted');
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: input.decisionId,
    occurredAt: input.at,
    actor: input.actor,
    payload: { type: 'DecisionDrafted', draft: input.draft },
  });
}

/**
 * `Draft → Open`. Congela el padrón y publica las reglas del juego.
 *
 * **La compuerta C6 es lo primero que se evalúa**, antes de mirar el estado, la ventana o cualquier
 * otro campo: la resolución del arquitecto exige que ninguna configuración con secreto duro pueda
 * abrirse, sea cual sea el resto de la configuración.
 */
export async function openDecision(
  log: DecisionLog,
  input: CommandMeta & {
    readonly config: DecisionConfig;
    /**
     * Registro de delegaciones de la comunidad, para la compuerta de ADR-0030. Es opcional porque
     * el registro no vive en el log de esta decisión (una delegación por tema vale para todas las
     * decisiones de ese tema, incluidas las que aún no existen); sin él la compuerta se reduce a la
     * de C.7.a, que mira sólo `delegation.enabled`.
     */
    readonly delegations?: readonly Delegation[];
  },
): Promise<DecisionLog> {
  assertHardSecrecySupported(input.config.privacy);
  assertNoDelegationInSecretBallot(input.config, input.delegations ?? [], input.at);
  const state = replay(log);
  nextStatus(state.status, 'DecisionOpened');
  validateDecisionConfig(input.config);
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: input.config.decisionId,
    occurredAt: input.at,
    actor: input.actor,
    payload: { type: 'DecisionOpened', config: input.config },
  });
}

/**
 * Emite una papeleta. `castAt` y `seq` los asigna el motor en el punto de serialización (D.3.c), no
 * el cliente: el reloj del cliente lo controla el atacante (A.10).
 */
export async function castBallot(
  log: DecisionLog,
  input: CommandMeta & { readonly ballot: BallotDraft },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  nextStatus(state.status, 'BallotCast');
  const ballot: Ballot = { ...input.ballot, castAt: input.at, seq: log.length + 1 };
  validateBallot(config, ballot, {
    window: currentWindow(state),
    round: state.round,
    proposalVersionHash: state.proposalVersionHash ?? config.proposalVersionHash,
  });
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: config.decisionId,
    occurredAt: input.at,
    actor: ballot.voter,
    payload: { type: 'BallotCast', ballot },
  });
}

/**
 * `castBallot` con autorización del dominio.
 *
 * Es la puerta que usa la capa de aplicación. `castBallot` sigue existiendo por debajo porque las
 * pruebas de propiedad construyen recorridos sin actor autenticado, pero **saltársela no sirve de
 * nada**: la comprobación que de verdad cierra el paso es la de `apply`, que exige
 * `ballot.voter === event.actor` y corre en todo plegado, incluido el de la auditoría.
 *
 * Aquí se comprueba además el permiso completo —identidad, rol y sujeto— para poder dar un mensaje
 * útil antes de escribir, en vez de un rechazo genérico al plegar.
 */
export async function castBallotBy(
  log: DecisionLog,
  input: CommandMeta & { readonly by: Actor; readonly ballot: BallotDraft },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  authorize(input.by, 'decision:cast-ballot', {
    kind: 'decision',
    subject: input.ballot.voter,
    circleId: config.circleId,
  });
  return castBallot(log, {
    eventId: input.eventId,
    at: input.at,
    actor: input.ballot.voter,
    ballot: input.ballot,
  });
}

/**
 * Concede una delegación (PARTE C). `grantedAt` y `grantedSeq` los asigna el motor en el punto de
 * serialización, igual que en una papeleta y por la misma razón: el reloj del cliente lo controla el
 * atacante, y `grantedSeq` es además la clave del orden LIFO de devolución por tope (C.5.b.2).
 *
 * Todo lo que puede salir mal se comprueba **aquí, al conceder** —ciclo, tope, caducidad, padrón—:
 * un rechazo ahora es un mensaje accionable; el mismo hecho descubierto en el escrutinio es silencio
 * irreversible (C.4.a, C.5.b.1).
 */
export async function grantDelegation(
  log: DecisionLog,
  input: Omit<CommandMeta, 'actor'> & {
    readonly delegation: Omit<Delegation, 'grantedAt' | 'grantedSeq' | 'revokedAt'>;
  },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  nextStatus(state.status, 'DelegationGranted');
  const delegation: Delegation = {
    ...input.delegation,
    grantedAt: input.at,
    grantedSeq: log.length + 1,
  };
  assertDelegationGrantable(config, state.delegations, delegation);
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: config.decisionId,
    occurredAt: input.at,
    actor: delegation.delegator,
    payload: { type: 'DelegationGranted', delegation },
  });
}

/** `grantDelegation` con autorización del dominio: sólo se delega el voto propio. */
export async function grantDelegationBy(
  log: DecisionLog,
  input: Omit<CommandMeta, 'actor'> & {
    readonly by: Actor;
    readonly delegation: Omit<Delegation, 'grantedAt' | 'grantedSeq' | 'revokedAt'>;
  },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  authorize(input.by, 'decision:cast-ballot', {
    kind: 'decision',
    subject: input.delegation.delegator,
    circleId: config.circleId,
  });
  return grantDelegation(log, {
    eventId: input.eventId,
    at: input.at,
    delegation: input.delegation,
  });
}

/**
 * Revoca una delegación, **con efecto inmediato** (C.2, INV-24, `GOVERNANCE.md` §5).
 *
 * «Revocable en cualquier momento, incluso si el delegado ya votó»: como el grafo se resuelve en
 * `closedAt` y no se cachea al abrir, una revocación un milisegundo antes del cierre saca la arista
 * del escrutinio. Revocar sin votar **no es abstenerse**: el peso queda en silencio y no suma a la
 * participación (regla de oro 4 de C.3.1).
 */
export async function revokeDelegation(
  log: DecisionLog,
  input: Omit<CommandMeta, 'actor'> & { readonly delegationId: DelegationId },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  nextStatus(state.status, 'DelegationRevoked');
  const delegation = assertDelegationRevocable(state.delegations, input.delegationId, input.at);
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: config.decisionId,
    occurredAt: input.at,
    actor: delegation.delegator,
    payload: { type: 'DelegationRevoked', delegationId: input.delegationId, at: input.at },
  });
}

/** `revokeDelegation` con autorización del dominio: sólo quien delegó revoca. */
export async function revokeDelegationBy(
  log: DecisionLog,
  input: Omit<CommandMeta, 'actor'> & {
    readonly by: Actor;
    readonly delegationId: DelegationId;
  },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  const delegation = assertDelegationRevocable(state.delegations, input.delegationId, input.at);
  authorize(input.by, 'decision:cast-ballot', {
    kind: 'decision',
    subject: delegation.delegator,
    circleId: config.circleId,
  });
  return revokeDelegation(log, {
    eventId: input.eventId,
    at: input.at,
    delegationId: input.delegationId,
  });
}

/**
 * Cierre con autorización del dominio: cuidar el procedimiento es un encargo, no un derecho general.
 */
export async function closeDecisionBy(
  log: DecisionLog,
  input: CommandMeta & {
    readonly by: Actor;
    readonly cause: CloseCause;
    readonly signers?: readonly MemberId[];
    readonly resolver?: WeightResolver;
  },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  authorize(input.by, 'decision:close', { kind: 'decision', circleId: config.circleId });
  return closeDecision(log, {
    eventId: input.eventId,
    at: input.at,
    actor: input.actor,
    cause: input.cause,
    ...(input.signers === undefined ? {} : { signers: input.signers }),
    ...(input.resolver === undefined ? {} : { resolver: input.resolver }),
  });
}

/**
 * Tick de cierre (D.2). Emite **exactamente uno** de `{WindowExtended, DecisionClosed}` (INV-38).
 *
 * DECISIÓN: cuando la causa es `'window'`, el instante del evento es `closesAt`, no el instante en
 * que el planificador se despertó. El cierre de la ventana es una propiedad de la configuración, no
 * de la infraestructura; si el `occurredAt` del cierre dependiera de cuándo corrió el cron, dos
 * réplicas producirían logs distintos para la misma decisión y la reproducibilidad se rompería
 * (INV-14). Esto realiza literalmente la precisión de D.2: «ambos pueden llevar `occurredAt ===
 * closesAt`», y de paso hace que la prórroga cumpla siempre A.8.2.5 (`≤ closesAt`).
 *
 * `at` sigue siendo obligatorio: es la prueba de que la ventana venció.
 */
export async function closeDecision(
  log: DecisionLog,
  input: CommandMeta & {
    readonly cause: CloseCause;
    /** Obligatorias (dos) si la causa es `'manual'` (A.8.1). */
    readonly signers?: readonly MemberId[];
    readonly resolver?: WeightResolver;
  },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  nextStatus(state.status, 'DecisionClosed');
  const window = currentWindow(state);

  if (input.cause === 'window') {
    if (input.at < window.closesAt) {
      throw new PreconditionError(
        'WINDOW_STILL_OPEN',
        `la ventana cierra en ${String(window.closesAt)} y el tick llegó en ${String(input.at)}`,
      );
    }
  } else if (input.at >= window.closesAt) {
    throw new PreconditionError(
      'NOT_AN_EARLY_CLOSE',
      `un cierre ${input.cause} exige que la ventana siga abierta`,
    );
  }

  const tickAt: Instant = input.cause === 'window' ? window.closesAt : input.at;
  const quorum = quorumAtClose(state, tickAt, input.resolver ?? resolverFor(state));

  if (!quorum.passed) {
    const action = quorumFailureAction(config, state.extensionsUsed, window.closesAt);
    if (action.kind === 'extend') {
      return emit(log, state, {
        eventId: input.eventId,
        decisionId: config.decisionId,
        occurredAt: tickAt,
        actor: 'system',
        payload: { type: 'WindowExtended', newClosesAt: action.newClosesAt, reason: 'quorum' },
      });
    }
    // 'reject' y 'escalate' cierran igual: DECISIÓN D.2.c, escalar crea un borrador en el círculo
    // superior, que no es un estado de ESTA decisión.
  }

  return emit(log, state, {
    eventId: input.eventId,
    decisionId: config.decisionId,
    occurredAt: tickAt,
    actor: input.actor,
    payload: {
      type: 'DecisionClosed',
      at: tickAt,
      cause: input.cause,
      ...(input.signers === undefined ? {} : { signers: input.signers }),
    },
  });
}

/**
 * El resolutor de pesos que corresponde a este estado.
 *
 * Con `delegation.enabled` es el de la PARTE C, cerrado sobre las delegaciones que el log conoce;
 * sin ella, una persona un voto. **Nunca se elige por parámetro por defecto**: si el resolutor
 * directo se aplicara a una decisión abierta con delegación, el voto de cada delegante
 * desaparecería sin traza, que es el fallo ingenuo de INV-32 con otra ropa.
 */
export function resolverFor(state: DecisionState): WeightResolver {
  const config = state.config;
  if (config === undefined || !config.delegation.enabled) return directWeightResolver;
  return delegationWeightResolver(state.delegations);
}

/**
 * Resolución completa de la democracia líquida en un instante dado: pesos, cadenas rotas, ciclos y
 * devoluciones por tope. Es lo que la interfaz necesita para explicar «quién votó por mí».
 */
export function delegationAt(state: DecisionState, at: Instant): DelegationResolution {
  const config = requireConfig(state);
  return resolveDelegation(config, state.ballots, state.delegations, at);
}

/**
 * C.4.3 — los avisos de cadena rota que corresponde emitir para esta decisión, como DATO.
 *
 * El dominio decide a quién y cuándo; enviar es de la capa de aplicación. Se evalúa con el grafo tal
 * como está en el instante de aviso (`closesAt − brokenChainNotice`), que es justo el sentido del
 * aviso: «con lo que hay ahora mismo, tu voto no se está contando; todavía podés votar».
 */
export function brokenChainNoticesFor(state: DecisionState): readonly ChainBrokenNotice[] {
  const config = requireConfig(state);
  if (!config.delegation.enabled) return [];
  const closesAt = state.closesAt ?? config.window.closesAt;
  const noticeAt = instant(
    Math.max(closesAt - config.delegation.brokenChainNotice, config.window.opensAt),
  );
  return chainBrokenNotices(config, delegationAt(state, noticeAt), closesAt);
}

/** Contexto de escrutinio de una decisión ya cerrada. */
function tallyContextOf(state: DecisionState, closedAt: Instant): TallyContext {
  const config = requireConfig(state);
  return {
    window: { opensAt: config.window.opensAt, closesAt: closedAt },
    round: state.round,
    proposalVersionHash: state.proposalVersionHash ?? config.proposalVersionHash,
    closedAt,
    voided: state.voided,
  };
}

function quorumAtClose(
  state: DecisionState,
  closedAt: Instant,
  resolver: WeightResolver,
): QuorumCheck {
  const config = requireConfig(state);
  const clamped = instant(Math.min(closedAt, state.closesAt ?? config.window.closesAt));
  const ballots = effectiveBallots(config, state.ballots, tallyContextOf(state, clamped), resolver);
  return checkQuorum(config, quorumSubject(config, ballots));
}

function quorumSubject(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): Parameters<typeof checkQuorum>[1] {
  const approveWeight = isThresholdMethod(config.method)
    ? countBinary(ballots, config.method.kind).approve
    : 0;
  return {
    represented: representedMembers(ballots),
    directVoters: ballots.map((b) => b.voter),
    approveWeight,
  };
}

async function runMethod(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
  round: number,
  objections: readonly ObjectionRecord[],
  seed: string | undefined,
): Promise<MethodTally> {
  switch (config.method.kind) {
    case 'simple-majority':
      return tallySimpleMajority(config, ballots);
    case 'supermajority':
      return tallySupermajority(config, ballots);
    case 'unanimity':
      return tallyUnanimity(config, ballots);
    case 'sociocratic-consent':
      return tallyConsent(config, ballots, { round, objections });
    case 'score':
      return tallyScore(config, ballots);
    case 'irv':
      return tallyIrv(config, ballots, seed);
    case 'majority-judgment':
      return tallyMajorityJudgment(config, ballots);
    case 'condorcet-schulze':
      return tallyCondorcetSchulze(config, ballots, seed);
    case 'deliberative-sortition':
      return tallySortition(config, seed);
  }
}

/** Entrada del escrutinio, ya proyectada desde el log. */
export interface TallyInput {
  readonly config: DecisionConfig;
  /** Todas las papeletas aceptadas; el escrutinio decide cuáles son efectivas. */
  readonly ballots: readonly Ballot[];
  /** Cierre real (tras prórrogas o cierre anticipado). */
  readonly closedAt: Instant;
  readonly round?: number | undefined;
  readonly proposalVersionHash?: Hash | undefined;
  readonly voided?: readonly BallotId[] | undefined;
  readonly objections?: readonly ObjectionRecord[] | undefined;
  /** Material revelado `seedAdmin|beaconValue`; el motor deriva SHA-256 antes de usarlo. */
  readonly seed?: string | undefined;
  /** Último `seq` leído del log. Es procedencia: queda fuera del `resultHash`. */
  readonly computedFromSeq: number;
  readonly resolver?: WeightResolver | undefined;
}

/**
 * Escruta. Función pura del par (configuración congelada, papeletas): dos procesos, dos locales, dos
 * husos horarios y dos órdenes de `Object.keys` producen el mismo `resultHash` (INV-14).
 *
 * DECISIÓN D.1.e: el quórum se comprueba **antes** del método. Si falla, el desenlace es `no-quorum`
 * y la demostración **no contiene** el resultado del método: publicar «habría ganado X pero no hubo
 * quórum» crea una legitimidad paralela de facto y vacía el quórum de sentido (INV-39).
 */
export async function tallyDecision(input: TallyInput): Promise<DecisionResult> {
  const config = input.config;
  const resolver = input.resolver ?? directWeightResolver;
  const context: TallyContext = {
    window: { opensAt: config.window.opensAt, closesAt: input.closedAt },
    round: input.round ?? 1,
    proposalVersionHash: input.proposalVersionHash ?? config.proposalVersionHash,
    closedAt: input.closedAt,
    voided: input.voided ?? [],
  };

  const ballots = effectiveBallots(config, input.ballots, context, resolver);
  const subject = quorumSubject(config, ballots);
  const quorum = checkQuorum(config, subject);

  const weights = ballots.map((b) => b.weight);
  const turnout = {
    cast: ballots.length,
    represented: subject.represented.length,
    census: config.electorate.censusSize,
    fraction: quorum.participation,
  };

  const quorumSteps: ProofStep[] = quorum.criteria.map((criterion, index) =>
    step(
      `Q${String(index + 1)}`,
      `${criterion.label}: se alcanzó ${criterion.achieved.num.toString()}/` +
        `${criterion.achieved.den.toString()} y se exigía ${criterion.required.num.toString()}/` +
        `${criterion.required.den.toString()}. ${criterion.passed ? 'Cumple.' : 'No cumple.'}`,
      {
        criterio: criterion.id,
        alcanzado: `${criterion.achieved.num.toString()}/${criterion.achieved.den.toString()}`,
        exigido: `${criterion.required.num.toString()}/${criterion.required.den.toString()}`,
        cumple: criterion.passed ? 'sí' : 'no',
      },
    ),
  );

  // ═══ C.6 — la concentración de voz va en la PRUEBA, no en un panel interno ═══
  //
  // ADR-0029 lo exige literalmente: «el `HHI*` va en la `Proof`». Y por eso entra en la preimagen
  // del `resultHash`: quien audita recalcula el índice con la tabla de pesos y, si no coincide, el
  // hash tampoco cuadra. Un indicador de concentración que vive fuera del objeto firmado es un
  // indicador que se puede maquillar.
  //
  // Sólo se publica cuando la delegación está habilitada. Sin ella todos los pesos valen 1 por
  // construcción (B.0.a), `HHI*` es idénticamente 0 y CR1 es `1/N`: un paso que no informa de nada
  // y que además movería el `resultHash` de todas las decisiones ya cerradas sin delegación.
  const concentration = config.delegation.enabled
    ? concentrationReport(ballots, config.electorate.censusSize)
    : undefined;
  const concentrationSteps: ProofStep[] =
    concentration === undefined ? [] : [concentrationStep(concentration)];
  const concentrationTables: ProofTable[] =
    concentration !== undefined && concentration.high ? [concentrationTable(concentration)] : [];

  const publicSeed =
    input.seed === undefined
      ? undefined
      : toHex(await sha256(new TextEncoder().encode(input.seed)));
  const method: MethodTally | undefined = quorum.passed
    ? await runMethod(config, ballots, context.round, input.objections ?? [], publicSeed)
    : undefined;

  const outcome: Outcome =
    method?.outcome ??
    ({
      kind: 'no-quorum',
      achieved: quorum.participation,
      required: config.quorum.participation,
    } satisfies Outcome);

  const partial: Omit<DecisionResult, 'resultHash'> = {
    decisionId: config.decisionId,
    configHash: config.configHash,
    rollHash: config.electorate.rollHash,
    engineVersion: config.engineVersion,
    computedFromSeq: input.computedFromSeq,
    outcome,
    turnout,
    weights: {
      totalWeight: totalWeight(ballots),
      hhi: herfindahl(weights),
      gini: gini(weights),
    },
    quorumCheck: { passed: quorum.passed, detail: quorum.detail },
    proof: {
      steps: [...quorumSteps, ...concentrationSteps, ...(method?.steps ?? [])],
      tables: [...concentrationTables, ...(method?.tables ?? [])],
      narrative:
        method === undefined
          ? `${quorumNarrative(quorum)} Por eso no se publica ningún recuento: sin la participación ` +
            'mínima, la decisión no produce mandato.'
          : `${quorumNarrative(quorum)} ${method.narrative}`,
    },
  };

  return { ...partial, resultHash: await computeResultHash(partial) };
}

/** Escruta una decisión ya cerrada a partir de su log. Envoltura de `tallyDecision`. */
export async function computeResult(
  log: DecisionLog,
  resolver?: WeightResolver,
): Promise<DecisionResult> {
  const state = replay(log);
  const config = requireConfig(state);
  if (state.closedAt === undefined) {
    throw new PreconditionError(
      'NOT_CLOSED',
      'el escrutinio se computa sobre una decisión cerrada (A.8.1)',
    );
  }
  return tallyDecision({
    config,
    ballots: state.ballots,
    closedAt: state.closedAt,
    round: state.round,
    proposalVersionHash: state.proposalVersionHash ?? config.proposalVersionHash,
    voided: state.voided,
    objections: state.objections,
    seed: state.seed,
    computedFromSeq: state.lastSeq,
    resolver: resolver ?? resolverFor(state),
  });
}

/** Ancla el resultado en el log (`ResultComputed`). El resultado sigue siendo un dato derivado. */
export async function recordResult(
  log: DecisionLog,
  input: CommandMeta & { readonly result: DecisionResult },
): Promise<DecisionLog> {
  const state = replay(log);
  nextStatus(state.status, 'ResultComputed');
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: input.result.decisionId,
    occurredAt: input.at,
    actor: input.actor,
    payload: {
      type: 'ResultComputed',
      resultHash: input.result.resultHash,
      outcomeKind: input.result.outcome.kind,
    },
  });
}

/**
 * `Closed → Ratified`: finaliza un desenlace aprobado cuando ya transcurrió completa la ventana de
 * impugnación. `apply` vuelve a comprobar resultado, desenlace e instante durante cualquier replay.
 */
export async function ratifyDecision(
  log: DecisionLog,
  input: Omit<CommandMeta, 'actor'> & { readonly actor: MemberId },
): Promise<DecisionLog> {
  const state = replay(log);
  nextStatus(state.status, 'DecisionRatified');
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: state.decisionId,
    occurredAt: input.at,
    actor: input.actor,
    payload: { type: 'DecisionRatified' },
  });
}

/** Ratificación disparada por quien cuida el procedimiento en el círculo competente. */
export async function ratifyDecisionBy(
  log: DecisionLog,
  input: Omit<CommandMeta, 'actor'> & { readonly by: Actor },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  authorize(input.by, 'decision:ratify', { kind: 'decision', circleId: config.circleId });
  const actor = input.by.memberId;
  if (actor === undefined) {
    // Inalcanzable después de `authorize`, pero mantiene la frontera tipada y falla cerrado si la
    // matriz cambiara por error.
    throw new PreconditionError('NOT_AUTHENTICATED', 'ratificar exige identidad verificada');
  }
  return ratifyDecision(log, { eventId: input.eventId, at: input.at, actor });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Semilla y cierre anticipado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * B.0.3 — commit–reveal con faro externo.
 *
 * DECISIÓN B.0.c: la semilla es SIEMPRE compuesta. El commit–reveal simple no basta: como el padrón
 * y las opciones son públicos, quien genera `seedAdmin` puede **moler** millones de candidatas
 * offline y comprometerse a la que le produce el sorteo que le conviene. Mezclar con un valor
 * imposible de conocer en el instante del commit vuelve inútil el grinding. Sin esa mezcla, «sorteo
 * verificable» es teatro criptográfico.
 */
export async function verifySeedReveal(config: DecisionConfig, seedAdmin: string): Promise<void> {
  const digest = toHex(await sha256(new TextEncoder().encode(seedAdmin)));
  if (digest !== config.seedCommitment) {
    // A.8.2.8: además dispara la anulación automática aguas arriba.
    throw new SeedCommitmentMismatch(config.seedCommitment, digest);
  }
}

export async function revealSeed(
  log: DecisionLog,
  input: CommandMeta & { readonly seedAdmin: string; readonly beaconValue: string },
): Promise<DecisionLog> {
  const state = replay(log);
  const config = requireConfig(state);
  nextStatus(state.status, 'SeedRevealed');
  await verifySeedReveal(config, input.seedAdmin);
  return emit(log, state, {
    eventId: input.eventId,
    decisionId: config.decisionId,
    occurredAt: input.at,
    actor: input.actor,
    payload: {
      type: 'SeedRevealed',
      seedAdmin: input.seedAdmin,
      beaconValue: input.beaconValue,
      commitment: config.seedCommitment,
    },
  });
}

/** Estado parcial de un escrutinio en curso, para D.4.1. */
export interface LiveTally {
  readonly approve: number;
  readonly reject: number;
  readonly abstain: number;
  /** Miembros del padrón que aún no han emitido papeleta directa y cuyo peso está sin asignar. */
  readonly movableUnassigned: number;
  readonly census: number;
  /**
   * ¿El quórum ya se cumple con el estado actual? Sin delegación la participación sólo puede
   * crecer, así que el peor caso de quórum **es** el estado actual (paso 1 de D.4.1). Si todavía no
   * se cumple, el resultado sigue siendo reversible por el lado del quórum.
   */
  readonly quorumMet: boolean;
}

/**
 * D.4.1 — ¿el resultado ya es matemáticamente irreversible?
 *
 * Los **movibles** son los miembros del padrón que no han emitido papeleta directa: cada uno puede
 * mover su peso 1 a cualquier casilla. El mínimo del cociente se alcanza en «todos los movibles votan
 * NO» y el máximo en «todos votan SÍ»; no hay continuaciones intermedias fuera de ese rango, así que
 * la cota es exacta (INV-58).
 *
 * DECISIÓN D.4.a: está deshabilitado por defecto, y D.4.2 explica por qué el cierre anticipado no es
 * gratis: revela el sentido, permite **acotar el marcador por el instante del cierre** (cuanto antes
 * cierre, mayor la goleada) e incluso la *ausencia* de cierre informa («sigue abierta, luego está
 * reñida»). Y hay un costo político: cerrar antes le quita a la minoría la posibilidad de dejar
 * constancia, que en una comunidad filosófica tiene valor propio.
 */
export function irreversibility(
  config: DecisionConfig,
  live: LiveTally,
): 'approved' | 'rejected' | 'open' {
  const method = config.method;
  if (!isThresholdMethod(method)) return 'open'; // D.4.b
  // ═══ Con delegación, la cota deja de ser una cota ═══
  //
  // Los dos supuestos que sostienen el cálculo —«la participación sólo puede crecer» y «cada
  // movible mueve exactamente 1»— son falsos bajo la PARTE C. Revocar sin votar RESTA
  // participación (regla de oro 4 de C.3.1: el peso queda en silencio); una delegación que caduca
  // durante la ventana rompe una cadena y resta tantos como la cadena llevara; y quien vota
  // directo mueve su 1 a su papeleta **y a la vez** se lo quita a la de su delegado, que es un
  // movimiento de 2 en el marcador. Declarar irreversible un resultado que todavía puede darse
  // vuelta es cerrar la urna antes de tiempo con la firma del motor detrás. Se devuelve `open`.
  // Reportado como errata E-42.
  if (config.delegation.enabled) return 'open';
  // (1) el quórum sólo puede crecer ⇒ el peor caso de quórum es el estado actual.
  if (!live.quorumMet) return 'open';
  const movable = live.movableUnassigned;

  const worst = {
    approve: live.approve,
    reject: live.reject + movable,
    abstain: live.abstain,
    census: live.census,
  };
  const best = {
    approve: live.approve + movable,
    reject: live.reject,
    abstain: live.abstain,
    census: live.census,
  };

  if (passesFor(config, worst)) return 'approved';
  if (!passesFor(config, best)) return 'rejected';
  return 'open';
}

function passesFor(
  config: DecisionConfig,
  input: { approve: number; reject: number; abstain: number; census: number },
): boolean {
  const method = config.method;
  switch (method.kind) {
    case 'simple-majority':
      return passesThresholdFor(input, { num: 1n, den: 2n }, true, method);
    case 'supermajority':
      return passesThresholdFor(input, method.fraction, method.strict, method);
    case 'unanimity': {
      if (input.reject > 0) return false;
      if (method.abstentionBlocks && input.abstain > 0) return false;
      const den =
        method.base === 'census'
          ? input.census
          : method.abstentionBlocks
            ? input.approve + input.reject + input.abstain
            : input.approve + input.reject;
      return den > 0 && input.approve === den;
    }
    case 'sociocratic-consent':
    case 'score':
    case 'irv':
    case 'majority-judgment':
    case 'condorcet-schulze':
    case 'deliberative-sortition':
      return false;
  }
}

function passesThresholdFor(
  input: { approve: number; reject: number; abstain: number; census: number },
  required: Fraction,
  strict: boolean,
  method: {
    abstentionPolicy: 'exclude' | 'include' | 'as-no';
    base: 'cast' | 'census' | 'present';
  },
): boolean {
  const den =
    method.base === 'census'
      ? BigInt(input.census)
      : method.abstentionPolicy === 'exclude'
        ? BigInt(input.approve + input.reject)
        : BigInt(input.approve + input.reject + input.abstain);
  if (den === 0n) return false;
  const comparison = cmpFraction({ num: BigInt(input.approve), den }, required);
  return strict ? comparison > 0 : comparison >= 0;
}

/** Modo de cierre anticipado que corresponde a cada causa (D.4.b). */
function causeToMode(cause: 'early-irreversible' | 'full-turnout'): EarlyCloseConfig['mode'] {
  return cause === 'early-irreversible' ? 'mathematically-irreversible' : 'full-turnout';
}

/** Estado en vivo derivado del log, para evaluar la irreversibilidad sin cerrar. */
export function liveTally(log: DecisionLog, at: Instant, resolver?: WeightResolver): LiveTally {
  return liveTallyFrom(replay(log), at, resolver);
}

/** Ídem, a partir de un estado ya plegado. */
export function liveTallyFrom(
  state: DecisionState,
  at: Instant,
  resolver?: WeightResolver,
): LiveTally {
  const config = requireConfig(state);
  const ballots = effectiveBallots(
    config,
    state.ballots,
    tallyContextOf(state, at),
    resolver ?? resolverFor(state),
  );
  const counts = isThresholdMethod(config.method)
    ? countBinary(ballots, config.method.kind)
    : { approve: 0, reject: 0, abstain: 0 };
  return {
    ...counts,
    movableUnassigned: config.electorate.censusSize - representedMembers(ballots).length,
    census: config.electorate.censusSize,
    quorumMet: checkQuorum(config, quorumSubject(config, ballots)).passed,
  };
}
