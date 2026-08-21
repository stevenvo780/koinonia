/**
 * `@koinonia/anchor` — el anclaje externo, que es la única garantía real contra el administrador.
 *
 * Sin este paquete, Koinonía detecta la manipulación **sólo si alguien conservó una raíz anterior**.
 * Con él, la historia queda comprometida en sitios que el administrador no controla, y reescribirla
 * pasa de ser silencioso a ser una contradicción visible contra Bitcoin, contra dos forjas y contra
 * los buzones de varias personas.
 *
 * Piezas, en orden de dependencia:
 *
 *  1. `types`     — `AnchorProvider`, recibos, resultados de verificación y clases de independencia.
 *  2. `receipt`   — serialización canónica de los recibos y su hash.
 *  3. `providers` — tres implementaciones de tres clases distintas.
 *  4. `quorum`    — la política 2-de-3 por clase, como código y con pruebas de propiedad.
 *  5. `events`    — el agregado `#anclaje`: toda falla queda dentro de la estructura protegida.
 *  6. `cycle`     — el ciclo completo, que no se traga ninguna falla.
 */

export {
  ANCHOR_DOMAIN,
  assertAnchorReceipt,
  check,
  INDEPENDENCE_CLASSES,
  invalidOutcome,
  InvalidReceiptError,
  isIndependenceClass,
  type AnchorProvider,
  type AnchorReceipt,
  type CheckOutcome,
  type CheckpointRef,
  type IndependenceClass,
  type ProviderMetadata,
  type ResidualClaim,
  type VerificationOutcome,
  type VerificationStatus,
} from './types.js';

export { canonicalReceipt, parseReceipt, receiptHash, receiptToJson } from './receipt.js';

export {
  ALERT_HOURS,
  CRITICAL_HOURS,
  evaluateQuorum,
  evidenceOf,
  MIN_INDEPENDENCE_CLASSES,
  type AnchorEvidence,
  type PublicAnchorState,
  type QuorumOptions,
  type QuorumVerdict,
  type RejectedAnchor,
  type RejectionReason,
} from './quorum.js';

export {
  ANCHOR_AGGREGATE_ID,
  ANCHOR_AGGREGATE_TYPE,
  ANCHOR_ATTEMPTED,
  ANCHOR_CONFIRMED,
  ANCHOR_FAILED,
  ANCHOR_STATE_PUBLISHED,
  anchorAttempted,
  anchorConfirmed,
  anchorFailed,
  anchorStatePublished,
  eventsForSubmission,
  type AnchorEventDraft,
} from './events.js';

export {
  checkpointRefFromHex,
  NULL_LEDGER,
  runAnchorCycle,
  type AnchorAttemptResult,
  type AnchorCycleInput,
  type AnchorCycleResult,
  type AnchorLedgerPort,
} from './cycle.js';

export {
  OPENTIMESTAMPS_ID,
  OpenTimestampsProvider,
  type OpenTimestampsOptions,
} from './providers/opentimestamps.js';

export {
  checkpointBindingLine,
  GIT_SIGNATURE_NAMESPACE,
  SIGNED_GIT_ID,
  SignedGitProvider,
  type AllowedSigner,
  type GitForgeClient,
  type SignedGitOptions,
} from './providers/signed-git.js';

export {
  ackPreimage,
  ackSignedBytes,
  domainOf,
  withAcks,
  WITNESS_EMAIL_ID,
  WITNESS_SIGNATURE_NAMESPACE,
  WitnessEmailProvider,
  type AckCollector,
  type EmailTransport,
  type Witness,
  type WitnessAck,
  type WitnessEmailOptions,
} from './providers/witness-email.js';

export {
  BITCOIN_HEADER_BYTES,
  BitcoinHeaderError,
  blockHashHex,
  blockInstant,
  blockTimeSeconds,
  merkleRootOf,
  NO_HEADERS,
  staticHeaders,
  type BitcoinHeaderSource,
} from './ots/bitcoin.js';

export {
  FakeOtsCalendar,
  headerFromHex,
  httpCalendar,
  wrapCalendarTimestamp,
  type FakeCalendarOptions,
  type FetchLike,
  type OtsCalendarClient,
} from './ots/calendar.js';

export {
  applyOp,
  OTS_ATTESTATION_TAG,
  OTS_HEADER_MAGIC,
  OTS_MAJOR_VERSION,
  OTS_OP_TAG,
  OtsFormatError,
  parseBareTimestamp,
  parseDetachedTimestamp,
  serializeDetachedTimestamp,
  walk,
  type DetachedTimestamp,
  type OtsAttestation,
  type OtsBranch,
  type OtsLeaf,
  type OtsOp,
  type OtsTimestamp,
} from './ots/format.js';

export {
  armorSshSignature,
  buildCommitBytes,
  buildSshSignatureBlob,
  commitOid,
  dearmorSshSignature,
  GitFormatError,
  parseCommit,
  parseSshSignature,
  sshPublicKeyBlob,
  sshSignedBlob,
  SshSigError,
  verifySshEd25519,
  type GitCommit,
  type SshSignature,
} from './git/objects.js';

export { fromBase64, toBase64, Base64Error } from './base64.js';
