/**
 * Agregados de trabajo: el camino que va de «tengo un problema o una idea» a una propuesta con
 * versiones. Todo lo de aquí es puro y encadenado, igual que el motor de decisiones.
 */

export {
  appendChained,
  chainedBody,
  type ChainedEvent,
  type ChainedInput,
  type ChainedLog,
  isChainIntact,
  verifyChain,
} from './chain.js';

export {
  applyProblem,
  attachEvidence,
  changeProblemStatus,
  EVIDENCE_CERTAINTIES,
  type EvidenceCertainty,
  type EvidenceRecord,
  initialProblemState,
  liveEvidence,
  MIN_EVIDENCE_LENGTH,
  MIN_PROBLEM_BODY_LENGTH,
  MIN_PROBLEM_TITLE_LENGTH,
  meTooCount,
  openProblem,
  type ProblemCommandMeta,
  type ProblemEvent,
  type ProblemLog,
  type ProblemPayload,
  type ProblemState,
  type ProblemStatus,
  recordMeToo,
  replayProblem,
  retractEvidence,
} from './problem.js';

export {
  amendProposal,
  applyProposal,
  currentVersion,
  draftProposal,
  initialProposalState,
  linkDecision,
  MIN_PROPOSAL_BODY_LENGTH,
  MIN_PROPOSAL_TITLE_LENGTH,
  MIN_RATIONALE_LENGTH,
  type ProposalCommandMeta,
  type ProposalEvent,
  type ProposalLog,
  type ProposalPayload,
  type ProposalState,
  type ProposalVersion,
  proposalVersionHash,
  replayProposal,
  verifyProposalLog,
  versionAt,
} from './proposal.js';

export {
  assertLedgerText,
  InvalidTextError,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  meaningfulLength,
  normalizeLedgerText,
  type TextRules,
} from './text.js';
