/**
 * `@koinonia/crypto` — la base de la garantía de integridad de la plataforma.
 *
 * Cuatro piezas, en orden de dependencia:
 *
 *  1. `canonical` — JCS (RFC 8785): una y sólo una secuencia de bytes por valor lógico.
 *  2. `hash`      — SHA-256 sobre WebCrypto y separación de dominios (`0x00`…`0x04`).
 *  3. `chain`     — cadena de hashes por agregado, con punto exacto de ruptura.
 *  4. `merkle`    — árbol RFC 6962, pruebas de inclusión y de consistencia.
 *
 * Qué garantiza y qué no: `README.md` del paquete. La lectura de esa sección no es opcional.
 */

export {
  canonicalize,
  canonicalizeToBytes,
  CanonicalizationError,
  isCanonical,
  isNfc,
  LEDGER_PROFILE,
  parseCanonical,
  RFC8785_PROFILE,
  toLedgerText,
  toNfc,
  type CanonicalErrorCode,
  type CanonicalProfile,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
} from './canonical.js';

export {
  assertHash,
  bytesEqual,
  concatBytes,
  DOMAIN,
  fromBase64Url,
  fromHex,
  HASH_BYTES,
  hashEvent,
  sha256,
  sha256Concat,
  toBase64Url,
  toHex,
  zeroHash,
} from './hash.js';

export {
  assertCanonicalEvent,
  buildChain,
  InvalidEventError,
  linkEvent,
  SPINE_AGGREGATE_ID,
  SPINE_AGGREGATE_TYPE,
  verifyChain,
  type CanonicalEvent,
  type ChainBreakReason,
  type ChainBroken,
  type ChainIntact,
  type ChainLink,
  type ChainOptions,
  type ChainVerification,
} from './chain.js';

export {
  consistencyProof,
  emptyRoot,
  inclusionProof,
  largestPowerOfTwoLessThan,
  leafHash,
  merkleRoot,
  MerkleTree,
  nodeHash,
  verifyConsistency,
  verifyInclusion,
} from './merkle.js';
