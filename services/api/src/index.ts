/**
 * `@koinonia/api` — adaptadores. Lo único del repositorio que hace I/O (ADR-0001).
 *
 * Cuatro capas, en orden de dependencia:
 *
 *  1. `db`         — conexión, transacciones, runner de migraciones, roles.
 *  2. `ledger`     — `EventStore` append-only, espina dorsal, verificación, checkpoints Merkle.
 *  3. `projection` — vistas de lectura desechables con offset transaccional.
 *  4. `decision`   — el puente con `@koinonia/domain`: persistir y rehidratar un `DecisionLog`.
 *
 * La regla que gobierna todo el paquete está en `migrations/0001_governance_ledger.sql`: ningún
 * valor que forme parte de la preimagen de un hash puede vivir en una columna cuyo tipo normalice su
 * representación. Si se viola, el sistema se acusa a sí mismo de haber sido manipulado sin que nadie
 * lo tocara.
 */

export {
  backoff,
  createPool,
  hasPgCode,
  isRetryable,
  PG_ERROR,
  pgError,
  toBigInt,
  toBytes,
  toBytesOrUndefined,
  toFixedChar,
  toHash32,
  toInt,
  toText,
  withTransaction,
  type PgClient,
  type PgErrorShape,
  type PgPool,
  type PgPoolClient,
  type PoolOptions,
} from './db/client.js';

export {
  defaultMigrationsDir,
  loadMigrations,
  migrate,
  pendingMigrations,
  type Migration,
  type MigrationOutcome,
} from './db/migrate.js';

export {
  APP_ROLE,
  auditAppGrants,
  connectionIdentity,
  DDL_ROLE,
  HISTORY_REWRITING_PRIVILEGES,
  inspectLedgerPrivileges,
  setAppRolePassword,
  type ConnectionIdentity,
  type GrantAudit,
  type LedgerPrivilegeVerdict,
} from './db/roles.js';

export {
  append,
  appendWithin,
  ensureSpine,
  LEDGER_WRITE_LOCK,
  lockLedgerWithin,
  readAppendRequestWithin,
  readAll,
  readAllHeads,
  readHead,
  readStream,
  rowToStoredEvent,
  type ReadAllOptions,
} from './ledger/event-store.js';

export {
  AGGREGATE_OPENED,
  CHECKPOINT_EMITTED,
  HeadConflictError,
  IdempotencyConflictError,
  LEDGER_OPENED,
  LedgerAppendError,
  SPINE_AGGREGATE_ID,
  SPINE_AGGREGATE_TYPE,
  SpineMissingError,
  type AggregateHead,
  type AppendCommand,
  type AppendedEvent,
  type AppendResult,
  type ExpectedHead,
  type LedgerEventDraft,
  type StoredEvent,
} from './ledger/types.js';

export {
  isPayloadCanonical,
  verifyAggregate,
  verifyLedger,
  type LedgerFinding,
  type LedgerFindingCode,
  type LedgerVerification,
} from './ledger/verify.js';

export {
  buildExport,
  currentRoot,
  type ExportBundle,
  type ExportOptions,
} from './ledger/export.js';

export {
  ANCHOR_AGGREGATE_ID,
  ANCHOR_AGGREGATE_TYPE,
  anchorLedgerPort,
  countAnchorAttempts,
  readAnchorReceipts,
  requestIdFromHash,
  saveAnchorAttempt,
  saveBitcoinHeader,
  type AnchorAttemptInput,
  type AnchorState,
} from './ledger/anchor-store.js';

export {
  checkpointPreimage,
  computeCheckpointHash,
  computeHeadsRoot,
  emitCheckpoint,
  latestCheckpoint,
  type Checkpoint,
  type EmitCheckpointInput,
} from './ledger/checkpoint.js';

export {
  catchUp,
  foldRunningHash,
  projectionStatus,
  ProjectionConflictError,
  rebuild,
  type CatchUpResult,
  type ProjectionHandler,
  type ProjectionStatus,
} from './projection/tracker.js';

export {
  DECISION_BOARD,
  DECISION_BOARD_COLUMNS,
  decisionBoardHandler,
  dumpDecisionBoard,
  type DecisionBoardRow,
} from './projection/decision-board.js';

export {
  DECISION_AGGREGATE_TYPE,
  DECISION_EVENT_VERSION,
  DecisionCodecError,
  decodeConfig,
  decodeDecisionEvent,
  encodeConfig,
  encodeDecisionEvent,
  instantToIso,
  isoToInstant,
} from './decision/codec.js';

export {
  DecisionPersistenceError,
  loadDecisionLog,
  loadDecisionState,
  persistDecisionLog,
  persistDecisionLogWithin,
  replayDecision,
  type PersistResult,
} from './decision/repository.js';

// ── Agregados de trabajo ────────────────────────────────────────────────────────────────────────
export {
  decodeProblemEvent,
  decodeProposalEvent,
  decodeInitiativeEvent,
  encodeProblemEvent,
  encodeProposalEvent,
  encodeInitiativeEvent,
  INITIATIVE_AGGREGATE_TYPE,
  PROBLEM_AGGREGATE_TYPE,
  PROPOSAL_AGGREGATE_TYPE,
  WORKSPACE_EVENT_VERSION,
  WorkspaceCodecError,
} from './workspace/codec.js';

export {
  listAggregateIds,
  loadProblemLog,
  loadProblemState,
  loadInitiativeLog,
  loadInitiativeState,
  loadProposalLog,
  loadProposalState,
  persistProblemLog,
  persistInitiativeLogWithin,
  persistProposalLog,
  persistProposalLogWithin,
  WorkspacePersistenceError,
  type WorkspacePersistResult,
} from './workspace/repository.js';

// ── Capa HTTP ───────────────────────────────────────────────────────────────────────────────────
export { buildApp, COOKIE_SESION, type AppOptions } from './http/app.js';

export {
  consoleMailer,
  cryptoRandom,
  DOMINIO_INSTITUCIONAL,
  MemoryMailer,
  NodeAes256GcmVaultCrypto,
  systemClock,
  udeaIdentityAdapter,
  unavailableVaultCrypto,
  VaultCryptoError,
  VaultUnavailableError,
} from './http/adapters.js';

export {
  CapacityServiceUnavailableError,
  ensureSubjectDataKeyWithin,
  lockVaultSubjectForReadWithin,
  lockVaultSubjectWithin,
  readOwnCapacity,
  readOwnCapacityWithin,
  readSubjectDataKeyWithin,
  StaleCapacityRevisionError,
  updateOwnCapacity,
  updateOwnCapacityWithin,
} from './http/capacity.js';

export {
  createRestrictedTextMaterialWithin,
  InvalidPrivateMaterialInputError,
  openRestrictedTextMaterialWithin,
  PII_ERASURE_AGGREGATE_TYPE,
  PII_ERASURE_AUTHORIZATION_KIND,
  PII_ERASURE_EXECUTED_EVENT,
  PII_ERASURE_LEGAL_BASES,
  PII_ERASURE_REQUESTED_EVENT,
  privateMaterialsForSuppressionWithin,
  PrivateMaterialSuppressionUnavailableError,
  PrivateMaterialUnavailableError,
  unavailablePrivateMaterialVerification,
  verifyRestrictedPrivateMaterialsWithin,
  type CreatedRestrictedTextMaterial,
  type CreateRestrictedTextMaterialInput,
  type OpenRestrictedTextMaterialInput,
  type PrivateMaterialFinding,
  type PrivateMaterialFindingCode,
  type PrivateMaterialVerification,
} from './http/private-material-store.js';

export {
  executeAuthorizedErasure,
  PrivateErasureAuthorizationUnavailableError,
  type ErasureRequestReceipt,
  type ExecuteErasureOptions,
  type ExecuteErasureResult,
  type PiiErasureLegalBasis,
} from './http/private-material-erasure.js';

export {
  CIRCULOS,
  CIRCULOS_LISTA,
  existeCirculo,
  nombreDeCirculo,
  type CirculoFijo,
} from './http/circles.js';

export {
  allMembers,
  ENLACE_VIGENCIA_MS,
  ERASURE_FRESH_SESSION_MS,
  ErasureAlreadyRequestedError,
  ErasureReauthenticationRequiredError,
  findMember,
  huellasIguales,
  issueMagicLink,
  type MemberRecord,
  openSession,
  purgeExpiredLinks,
  redeemMagicLink,
  resolveSession,
  revokeSession,
  SESION_VIGENCIA_MS,
  sha256Hex,
  upsertMember,
} from './http/identity.js';

export {
  bucketKey,
  consume,
  CupoAgotadoError,
  pepperOfDay,
  pepperOfWindow,
  purgeOldBuckets,
  type RateRule,
  type RateVerdict,
  REGLA_COMENTARIO,
  REGLA_ENLACE,
  REGLA_ESCRITURA,
  REGLA_PROPUESTA,
} from './http/rate-limit.js';

export type {
  AuthenticatedMember,
  CapacityCiphertext,
  ClockPort,
  IdentityClaim,
  IdentityProviderAdapter,
  IdentityResult,
  MailerPort,
  OutgoingMail,
  Ports,
  PrivateMaterialCiphertext,
  PrivateMaterialPurpose,
  RandomPort,
  RestrictedTextMaterialOpening,
  SubjectDataKeyEnvelope,
  VaultCryptoPort,
} from './http/ports.js';

export { MAX_RESTRICTED_PRIVATE_TEXT_BYTES } from './http/ports.js';

export {
  ACTOR_ANONIMO,
  queHaceFaltaParaQuePase,
  ServicioError,
  type MetodoSoportado,
  type ServicioDeps,
} from './http/service.js';

// `server.ts` NO se reexporta desde aquí: contiene el arranque y leer variables de entorno no es
// asunto de la librería. El ejecutable es `dist/bin.js`.

export { crearTareaDeRetencion, type TareaDeRetencion } from './jobs/retencion.js';
