/**
 * Agregado **deliberación estructurada**.
 *
 * Una deliberación es una secuencia de ventanas de escritura reales sobre un grafo tipado de
 * aportes. Durante `perspectivas` la autoría **no se puede leer**; la escritura, en cambio, es
 * normal y el autor viaja en el evento como en cualquier otro agregado (ADR-0049).
 *
 *  - `types.ts`         — identificadores, aportes tipados, eventos y estado.
 *  - `state-machine.ts` — las dos tablas: qué etapa sigue a cuál, y qué admite cada una.
 *  - `graph.ts`         — las aristas, sus tipos de destino y la aciclicidad.
 *  - `presentation.ts`  — orden de presentación aleatorio por lectora y recomputable.
 *  - `commands.ts`      — las órdenes, el plegado del historial y la lectura de autoría.
 *
 * La regla que oculta la autoría **no vive aquí**: vive en `../access.ts`, con la acción
 * `deliberation:read-authorship`, junto a todas las demás reglas del sistema.
 */

export {
  type AdvanceStageInput,
  advanceStage,
  applyDeliberation,
  authorizeAuthorshipRead,
  type DeliberationCommandMeta,
  DEFAULT_MAX_CONTRIBUTIONS_PER_AUTHOR_PER_STAGE,
  type OpenDeliberationInput,
  openDeliberation,
  readContributionAuthor,
  replayDeliberation,
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
  contributionScore,
  orderContributionsForViewer,
  PRESENTATION_ORDER_DOMAIN,
  PRESENTATION_SCORE_DOMAIN,
  presentationOrder,
  type PresentationOrderInput,
  readerSeed,
  type ReaderSeedInput,
} from './presentation.js';

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
  stagesWithoutWriting,
  TERMINAL_STAGE,
} from './state-machine.js';

export {
  type AlternativeBody,
  type AlternativeCost,
  type AlternativeCostKind,
  ALTERNATIVE_COST_KINDS,
  assertContributionBody,
  type AssumptionBody,
  CONTRIBUTION_KINDS,
  type ContributionBody,
  type ContributionId,
  contributionId,
  type ContributionKind,
  type ContributionRecord,
  contributionsOfAuthorInStage,
  DELIBERATION_STAGES,
  type DeliberationEvent,
  type DeliberationId,
  deliberationId,
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
  REASON_RELATIONS,
  type ReasonBody,
  type ReasonRelation,
  RISK_SEVERITIES,
  type RiskBody,
  type RiskSeverity,
  STAGE_ADVANCE_CAUSES,
  type StageAdvanceCause,
} from './types.js';
