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
  DDL_ROLE,
  setAppRolePassword,
  type GrantAudit,
} from './db/roles.js';

export {
  append,
  appendWithin,
  ensureSpine,
  LEDGER_WRITE_LOCK,
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
  replayDecision,
  type PersistResult,
} from './decision/repository.js';
