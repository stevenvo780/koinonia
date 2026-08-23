/**
 * `@koinonia/domain` — el `DecisionEngine`: el motor de decisiones de Koinonía.
 *
 * Contrato: `docs/research/30-decision-engine-spec.md`. Esta entrega implementa la PARTE A (modelo de
 * dominio), los métodos B.1–B.4 (mayoría simple, mayoría reforzada, consentimiento sociocrático y
 * unanimidad), la PARTE D completa (quórum, umbral, ventanas y cierre anticipado) y los invariantes
 * de la PARTE E que aplican a lo anterior. Quedan para la entrega siguiente los métodos B.5–B.9
 * (puntuación, rondas con eliminación, valoración por menciones, comparación una contra una y
 * sorteo) y la PARTE C (democracia líquida), cuyo punto de extensión es `WeightResolver`.
 *
 * Reglas de este paquete (ADR-0001), verificadas por `scripts/check-domain-purity.mjs`:
 *  - cero dependencias de tiempo de ejecución salvo `@koinonia/crypto`;
 *  - nada de red, disco, `Date.now()`, `new Date()`, `Math.random()`, `Intl` ni `localeCompare`;
 *  - el instante y la semilla entran como **datos**, nunca como efectos.
 *
 * Y una regla que no es técnica: **en este paquete no hay ni un campo de datos personales.** El
 * dominio conoce identificadores opacos de 128 bits y nada más (resolución R1).
 */

// ── Identificadores y tipos base ────────────────────────────────────────────────────────────────
export {
  type BallotId,
  type Brand,
  ballotId,
  type CircleId,
  circleId,
  compareIds,
  type DecisionId,
  decisionId,
  type DelegationId,
  delegationId,
  type EventId,
  eventId,
  HASH_PATTERN,
  hash,
  ID_LENGTH,
  ID_PATTERN,
  type Hash,
  type Instant,
  instant,
  type InitiativeId,
  initiativeId,
  type MilestoneId,
  milestoneId,
  isHash,
  isMemberId,
  isStrictlySorted,
  LABEL_PATTERN,
  type MemberId,
  memberId,
  type ObjectionId,
  objectionId,
  type OptionId,
  optionId,
  type ProposalId,
  proposalId,
  sortIds,
  type StratumKey,
  stratumKey,
  type StratumValue,
  stratumValue,
  type TaskId,
  taskId,
  type TopicId,
  topicId,
  ZERO_HASH,
} from './ids.js';

export {
  cmpFraction,
  type Fraction,
  fraction,
  fractionEquals,
  HALF,
  isProperFraction,
  normalize,
  ONE,
  ratio,
  THREE_QUARTERS,
  toFractionString,
  toPercentString,
  TWO_THIRDS,
  ZERO,
} from './fraction.js';

// ── Errores ─────────────────────────────────────────────────────────────────────────────────────
export {
  type BallotRejection,
  BrokenLogError,
  type ConfigRejection,
  DomainError,
  HardSecrecyUnsupported,
  IllegalTransitionError,
  InvalidBallotError,
  InvalidBallotForMethod,
  InvalidConfigError,
  InvalidElectorateError,
  InvalidFractionError,
  InvalidIdError,
  PreconditionError,
  SeedCommitmentMismatch,
} from './errors.js';

// ── Canonicalización ────────────────────────────────────────────────────────────────────────────
export {
  canonicalBytes,
  deepFreeze,
  hashCanonical,
  hashText,
  NotCanonicalizableError,
  toCanonicalJson,
} from './canonical.js';

// ── Padrón congelado ────────────────────────────────────────────────────────────────────────────
export {
  assertWellFormedElectorate,
  circleSize,
  computeRollHash,
  type EligibleMember,
  type Electorate,
  freezeElectorate,
  indexOfMember,
  isEligible,
  isEnrolledAt,
  memberAt,
  membersOfCircle,
  type RegistryEntry,
  verifyRollHash,
} from './electorate.js';

// ── Configuración ───────────────────────────────────────────────────────────────────────────────
export {
  type AbstentionPolicy,
  assertHardSecrecySupported,
  buildDecisionConfig,
  computeConfigHash,
  configHashPreimage,
  type ConstituentAct,
  DEFAULT_BROKEN_CHAIN_NOTICE_MS,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DEFAULT_EARLY_CLOSE,
  DEFAULT_TIE_BREAK,
  DELEGATION_DISABLED,
  DELEGATION_ENABLED,
  MAX_DELEGATION_VALIDITY_MS,
  type DecisionConfig,
  type DecisionConfigDraft,
  type DecisionMethod,
  type DecisionMethodKind,
  decisionCircleMembers,
  type Delegation,
  type DelegationConfig,
  type DelegationScope,
  type DraftConfig,
  type EarlyCloseConfig,
  ENGINE_VERSION,
  type GradeId,
  type GradeScale,
  isThresholdMethod,
  MAX_EXTENSIONS_HARD_CAP,
  MAX_ROUNDS_HARD_CAP,
  NO_QUORUM_REQUIRED,
  type ObjectionAdmissibilityConfig,
  type PrivacyMode,
  type QuorumConfig,
  type ThresholdBase,
  type ThresholdMethod,
  type TieBreakPolicy,
  type TieBreakRule,
  validateDecisionConfig,
  type WindowConfig,
} from './config.js';

// ── Papeletas ───────────────────────────────────────────────────────────────────────────────────
export {
  acceptedPayloadKinds,
  type Ballot,
  type BallotContext,
  type BallotDraft,
  type BallotPayload,
  type BallotPayloadKind,
  ballotRejection,
  type ConsentStance,
  isBallotValid,
  isVoterEligible,
  MIN_OBJECTION_ARGUMENT_LENGTH,
  type Objection,
  type Score,
  validateBallot,
  validateObjection,
} from './ballot.js';

// ── Democracia líquida (PARTE C) ────────────────────────────────────────────────────────────────
export {
  compareDelegationPriority,
  type ChainOutcome,
  findSupersededDelegation,
  isDelegationActive,
  isVigent,
  matchesScope,
  projectedRepresented,
  reachesInUnion,
  type ScopeSubject,
  scopeKey,
  scopeSpecificity,
  type UnassignedReason,
  unionEdges,
  walkChain,
  wouldCreateCycle,
} from './delegation-graph.js';

export {
  assertDelegationGrantable,
  assertDelegationRevocable,
  assertNoDelegationInSecretBallot,
  capWeight,
  type ChainBrokenNotice,
  chainBrokenNotices,
  type DelegationAssignment,
  type DelegationResolution,
  delegationSlot,
  delegationWeightResolver,
  hasActiveDelegationsFor,
  resolveDelegation,
  revokeIn,
  supersededByGrant,
  type UnassignedMember,
  vigentDelegations,
} from './delegation.js';

// ── Máquina de estados ──────────────────────────────────────────────────────────────────────────
export {
  DECISION_EVENT_TYPES,
  DECISION_STATUSES,
  type DecisionEventType,
  type DecisionStatus,
  isLegalTransition,
  isTerminal,
  legalEventsFrom,
  LIFECYCLE_STATUSES,
  type LifecycleStatus,
  nextStatus,
  peekTransition,
  TERMINAL_STATUSES,
  type Transition,
  TRANSITIONS,
} from './state-machine.js';

// ── Eventos ─────────────────────────────────────────────────────────────────────────────────────
export {
  append,
  appendEvent,
  type CloseCause,
  type DecisionEvent,
  type DecisionEventPayload,
  type DecisionLog,
  eventBody,
  eventType,
  type EventInput,
  isLogChainIntact,
  type OutcomeKind,
  verifyLogChain,
} from './events.js';

// ── Ventanas temporales ─────────────────────────────────────────────────────────────────────────
export {
  BOGOTA_OFFSET_MS,
  bogotaCivilToInstant,
  type CivilDateTime,
  civilFromDays,
  daysFromCivil,
  DELIBERATION_FLOOR_MS,
  type EffectiveWindow,
  extendWindow,
  formatBogota,
  instantToBogotaCivil,
  isClosedAt,
  isWithinWindow,
  respectsDeliberationFloor,
  windowStatus,
} from './window.js';

// ── Quórum ──────────────────────────────────────────────────────────────────────────────────────
export {
  checkQuorum,
  circleParticipation,
  type QuorumCheck,
  type QuorumCriterion,
  type QuorumFailureAction,
  quorumFailureAction,
  quorumNarrative,
  type QuorumSubject,
  usesApprovalWeight,
} from './quorum.js';

// ── Escrutinio ──────────────────────────────────────────────────────────────────────────────────
export {
  abstentionNarrative,
  binaryTable,
  blockingObjections,
  computeResultHash,
  consentEngagement,
  type ConsentContext,
  countBinary,
  type DecisionResult,
  directWeightResolver,
  type EffectiveBallot,
  effectiveBallots,
  fractionEvidence,
  gini,
  herfindahl,
  hmacOrder,
  hmacSha256Hex,
  lastBallotPerVoter,
  lexicographicHashOrder,
  type MethodTally,
  type ObjectionRecord,
  type ObjectionStatus,
  mergeObjections,
  type Outcome,
  passesThreshold,
  precheck,
  type Proof,
  type ProofStep,
  type ProofTable,
  representedMembers,
  resultHashPreimage,
  step,
  condorcetWinner,
  hamiltonQuotas,
  majorityGrade,
  majorityJudgmentProfiles,
  type MajorityJudgmentProfile,
  mjCompare,
  pairwiseMatrix,
  schulze,
  scoreProfiles,
  type ScoreProfile,
  type SchulzeResult,
  type SortitionSelection,
  type StratumQuota,
  stratifiedSortition,
  tallyCondorcetSchulze,
  tallyConsent,
  tallyIrv,
  type IrvRound,
  tallyMajorityJudgment,
  tallyScore,
  tallySimpleMajority,
  tallySortition,
  tallySupermajority,
  tallyUnanimity,
  type TallyContext,
  type ThresholdInput,
  thresholdDenominator,
  totalWeight,
  usableGradeBallots,
  weightedMedian,
  type WeightResolver,
} from './tally/index.js';

// Índices de concentración de C.6. Se exportan desde `tally/common.js` porque son parte del marco
// común del escrutinio, no de ningún método concreto.
export {
  type ConcentrationReport,
  concentrationRatio,
  concentrationReport,
  concentrationStep,
  concentrationTable,
  HIGH_CONCENTRATION_CR1,
  HIGH_CONCENTRATION_HHI,
  normalizedHerfindahl,
} from './tally/common.js';

// ── Autorización (en el DOMINIO, no en la ruta) ─────────────────────────────────────────────────
export {
  ACTIONS,
  type Action,
  type Actor,
  ANONYMOUS,
  authorize,
  can,
  type DenialReason,
  denialReason,
  isRole,
  type ResourceKind,
  type ResourceRef,
  type Role,
  ROLES,
  ruleFor,
  UnauthorizedError,
} from './access.js';

// ── Agregados de trabajo: problemas y propuestas ────────────────────────────────────────────────
export * from './workspace/index.js';

// ── Deliberación estructurada por etapas ────────────────────────────────────────────────────────
export * from './deliberation/index.js';

// ── Constitución digital: las reglas como datos versionados (§6) ─────────────────────────────────
export * from './constitution/index.js';

// ── Asistente de acción sistémica: las 27 preguntas y el puerto que no puede decidir ─────────────
export * from './assistant/index.js';

// ── Evaluación, resultado y aprendizajes: el cierre del ciclo (ADR-0053) ─────────────────────────
export * from './evaluation/index.js';

// ── Motor ───────────────────────────────────────────────────────────────────────────────────────
export {
  apply,
  brokenChainNoticesFor,
  castBallot,
  castBallotBy,
  closeDecision,
  closeDecisionBy,
  type CommandMeta,
  computeResult,
  currentWindow,
  type DecisionState,
  delegationAt,
  draftDecision,
  grantDelegation,
  grantDelegationBy,
  initialState,
  irreversibility,
  type LiveTally,
  liveTally,
  liveTallyFrom,
  openDecision,
  ratifyDecision,
  ratifyDecisionBy,
  recordResult,
  replay,
  resolverFor,
  revealSeed,
  revokeDelegation,
  revokeDelegationBy,
  tallyDecision,
  type TallyInput,
  verifyLog,
  verifySeedReveal,
} from './engine.js';
