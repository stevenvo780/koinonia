/**
 * Agregado **constitución digital**.
 *
 * Las reglas de gobernanza como datos versionados dentro de la plataforma, que el administrador
 * técnico no puede escribir (`GOVERNANCE.md` §6 y §7). Cada versión tiene su decisión, su fecha, su
 * diferencia con la anterior y su caducidad; ninguna se borra jamás.
 *
 *  - `types.ts`         — identificadores, texto versionado, eventos y estado.
 *  - `core.ts`          — el núcleo intangible, la aritmética exacta de los umbrales y el calendario.
 *  - `state-machine.ts` — las dos máquinas: la del agregado (con la caducidad perezosa) y la de cada
 *                         reforma.
 *  - `commands.ts`      — las órdenes y **el pliegue**, que es donde está la protección de verdad.
 *
 * Las tres cláusulas de atrincheramiento del §6, y dónde vive cada una:
 *
 *  1. **Doble llave temporal** — `ReformRequirements.votesRequired` y `separationMonths`, aplicados
 *     en `applyVoteRecorded` y otra vez en `applyRatified`.
 *  2. **Núcleo intangible** — `core.ts`, y sobre todo el guardián del final de `applyConstitution`,
 *     que lo recomputa desde el texto vigente **en cada evento**. No se protege con tipos: los tipos
 *     no sobreviven a un historial traído de fuera.
 *  3. **Prohibición de reforma en ventana propia** — dos mecanismos, no uno: la copia congelada de
 *     `FrozenReformRules` —una reforma nunca se juzga con las reglas que ella misma cambia— y la
 *     veda de `assertOutsideOwnWindow`, que es la regla literal del §6.c.
 */

export {
  approveReform,
  type ApproveReformInput,
  applyConstitution,
  assertConstitutionVigent,
  constitutionNotice,
  type ConstitutionCommandMeta,
  foundConstitution,
  type FoundConstitutionInput,
  openReform,
  type OpenReformInput,
  ratifyReform,
  type RatifyReformInput,
  recordReformVote,
  type RecordReformVoteInput,
  reformVotesPass,
  rejectReform,
  type RejectReformInput,
  replayConstitution,
  verifyConstitutionLog,
  type VerifyConstitutionOptions,
} from './commands.js';

export {
  addDays,
  addMonths,
  assertCoreIntact,
  assertCount,
  assertEntrenchedNotWeaker,
  assertOutsideOwnWindow,
  assertSameCore,
  assertWellFormedCore,
  assertWellFormedRequirements,
  assertWellFormedText,
  type Blackout,
  blackoutsFor,
  canonicalEquals,
  changedClauseIds,
  constitutionCoreHash,
  convenedDecision,
  CORE_CLAUSE_IDS,
  CoreAlteredError,
  type CoreViolation,
  coreProjection,
  DAY_MS,
  daysInMonth,
  diffTexts,
  ENTRENCHED_REFORM_V1,
  FOUNDATIONAL_VALIDITY_MONTHS,
  FOUNDING_APPROVAL_OF_BALLOTS,
  FOUNDING_MIN_PARTICIPATION,
  isNoOpReform,
  MAX_VALIDITY_MONTHS,
  meetsShareOf,
  MIN_VALIDITY_MONTHS,
  ORDINARY_REFORM_V1,
  OWN_WINDOW_DAYS,
  requiredCount,
  SEMESTER_TAIL_DAYS,
  type TextDiff,
} from './core.js';

export {
  assertAcceptedAt,
  EVENTS_ACCEPTED_WHILE_EXPIRED,
  expiresAt,
  isAcceptedWhileExpired,
  isLegalReformTransition,
  isTerminalReformStatus,
  legalReformEventsFrom,
  nextReformStatus,
  peekReformTransition,
  REFORM_EVENT_TYPES,
  REFORM_LIFECYCLE,
  REFORM_TRANSITIONS,
  type ReformLifecycle,
  type ReformTransition,
  statusAt,
  TERMINAL_REFORM_STATUSES,
} from './state-machine.js';

export {
  type Clause,
  type ClauseId,
  clauseId,
  CONSTITUTION_EVENT_TYPES,
  CONSTITUTION_STATUSES,
  type ConstitutionEvent,
  type ConstitutionEventType,
  type ConstitutionId,
  constitutionId,
  type ConstitutionLog,
  type ConstitutionPayload,
  type ConstitutionState,
  type ConstitutionStatus,
  type ConstitutionText,
  type ConstitutionVersion,
  type ConvenedDecision,
  currentText,
  currentVersionOf,
  findReform,
  type FrozenReformRules,
  initialConstitutionState,
  isWellFormedClause,
  openReforms,
  REFORM_KINDS,
  REFORM_REJECTION_REASONS,
  REFORM_STATUSES,
  type ReformCalendar,
  type ReformId,
  reformId,
  type ReformKind,
  type ReformRecord,
  type ReformRejectionReason,
  type ReformRequirements,
  type ReformStatus,
  type ReformVote,
  requirementsFor,
  // `versionAt` ya es el nombre de la función homóloga de las propuestas (`workspace/proposal.ts`).
  // Se reexporta con prefijo para que el paquete siga teniendo un solo símbolo por nombre: dos
  // `versionAt` en el mismo espacio serían una ambigüedad que TypeScript resuelve borrando ambos.
  versionAt as constitutionVersionAt,
} from './types.js';
