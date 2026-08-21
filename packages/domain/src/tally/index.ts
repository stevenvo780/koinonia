/**
 * Escrutadores. Un archivo por método (A.7: los escrutadores históricos se conservan; cuando
 * `engineVersion` suba, este directorio se versiona y el anterior se mantiene intacto para poder
 * recomputar decisiones ya cerradas con exactamente las reglas bajo las que se abrieron).
 */

export {
  abstentionNarrative,
  binaryTable,
  computeResultHash,
  countBinary,
  type DecisionResult,
  directWeightResolver,
  effectiveBallots,
  type EffectiveBallot,
  fractionEvidence,
  gini,
  herfindahl,
  lastBallotPerVoter,
  lexicographicHashOrder,
  type MethodTally,
  type Outcome,
  passesThreshold,
  precheck,
  type Proof,
  type ProofStep,
  type ProofTable,
  representedMembers,
  resultHashPreimage,
  step,
  type TallyContext,
  type ThresholdInput,
  thresholdDenominator,
  totalWeight,
  type WeightResolver,
} from './common.js';

export {
  blockingObjections,
  consentEngagement,
  type ConsentContext,
  type ObjectionRecord,
  type ObjectionStatus,
  mergeObjections,
  tallyConsent,
} from './consent.js';
export { tallySimpleMajority } from './simple-majority.js';
export { tallySupermajority } from './supermajority.js';
export { tallyUnanimity } from './unanimity.js';
