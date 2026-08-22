/**
 * Agregado **deliberación estructurada**.
 *
 * Una deliberación es una secuencia de ventanas de escritura reales sobre un grafo tipado de
 * aportes, con la autoría de las perspectivas sellada hasta que se cierra su etapa.
 *
 *  - `types.ts`         — identificadores, aportes tipados, eventos y estado.
 *  - `state-machine.ts` — las dos tablas: qué etapa sigue a cuál, y qué admite cada una.
 *  - `graph.ts`         — las aristas, sus tipos de destino y la aciclicidad.
 *  - `authorship.ts`    — compromiso de autoría (con su hueco declarado) y orden de presentación.
 *  - `commands.ts`      — las órdenes y el plegado del historial.
 *
 * Este barril **no** se reexporta desde `src/index.ts`: esa integración la hace quien coordina el
 * paquete. Los consumidores internos y los tests importan por ruta relativa.
 */

export {
  assertAuthorCommitment,
  assertAuthorPseudonym,
  AUTHOR_COMMITMENT_DOMAIN,
  AUTHOR_PSEUDONYM_DOMAIN,
  authorCommitment,
  authorPseudonym,
  type AuthorOpening,
  type AuthorOpeningInput,
  type AuthorPseudonymInput,
  buildAuthorOpening,
  contributionScore,
  isAuthorCommitmentValid,
  orderContributionsForViewer,
  PRESENTATION_ORDER_DOMAIN,
  PRESENTATION_SCORE_DOMAIN,
  presentationOrder,
  type PresentationOrderInput,
  readerSeed,
  type ReaderSeedInput,
} from './authorship.js';

export {
  type AdvanceStageInput,
  advanceStage,
  applyDeliberation,
  type DeliberationCommandMeta,
  DEFAULT_MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE,
  type OpenDeliberationInput,
  openDeliberation,
  replayDeliberation,
  type RevealContributionAuthorInput,
  revealContributionAuthor,
  type SubmitContributionInput,
  submitContribution,
  verifyDeliberationLog,
} from './commands.js';

export {
  assertReferences,
  type ContributionEdge,
  type ContributionReference,
  currentContributions,
  isAcyclic,
  referenceEdges,
  referencesOf,
  supersededContributions,
} from './graph.js';

export {
  assertBodyAllowedInStage,
  assertStageTransition,
  isLegalStageTransition,
  isTerminalStage,
  nextStage,
  STAGE_RULES,
  STAGE_TRANSITIONS,
  type StageRule,
  type StageTransition,
  stageAdmits,
  stageRule,
  stageSealsAuthorship,
  stagesWithoutWriting,
  TERMINAL_STAGE,
} from './state-machine.js';

export {
  type AlternativeBody,
  assertContributionBody,
  type AssumptionBody,
  type AuthorNonce,
  authorNonce,
  type Authorship,
  CONTRIBUTION_KINDS,
  type ContributionBody,
  type ContributionId,
  contributionId,
  type ContributionKind,
  type ContributionRecord,
  DELIBERATION_STAGES,
  type DeliberationEvent,
  type DeliberationId,
  deliberationId,
  type DeliberationNonce,
  deliberationNonce,
  type DeliberationLog,
  type DeliberationPayload,
  type DeliberationStage,
  type DeliberationState,
  type EvidenceBody,
  findContribution,
  initialDeliberationState,
  MIN_CONTRIBUTION_LENGTH,
  POSITION_MODES,
  type PositionBody,
  type PositionMode,
  type PresentationSeed,
  presentationSeed,
  type PublicAuthorship,
  REASON_RELATIONS,
  type ReasonBody,
  type ReasonRelation,
  RISK_SEVERITIES,
  type RiskBody,
  type RiskSeverity,
  type SealedAuthorship,
  STAGE_ADVANCE_CAUSES,
  type StageAdvanceCause,
  unrevealedContributions,
} from './types.js';
