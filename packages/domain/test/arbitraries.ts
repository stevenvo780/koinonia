/**
 * Generadores reutilizables (catálogo E.0 de la especificación).
 *
 * Los generadores producen **planes** —datos planos— y los constructores los convierten en padrones,
 * configuraciones y papeletas reales. La separación existe porque congelar un padrón exige hashear, y
 * hashear es asíncrono: `fc.asyncProperty` recibe el plan y construye el escenario dentro de la
 * propiedad.
 *
 * Todos los identificadores se derivan de un índice, de modo que el orden por índice **coincide** con
 * el orden byte a byte del padrón. Eso hace que los contraejemplos minimizados sean legibles.
 */

import fc from 'fast-check';

import {
  type AbstentionPolicy,
  type Ballot,
  type BallotId,
  type BallotPayload,
  bogotaCivilToInstant,
  buildDecisionConfig,
  type CircleId,
  circleId,
  type ConstituentAct,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DEFAULT_EARLY_CLOSE,
  DEFAULT_TIE_BREAK,
  DELEGATION_DISABLED,
  type DecisionConfig,
  type DecisionId,
  decisionId,
  type DecisionMethod,
  type Electorate,
  ENGINE_VERSION,
  type EventId,
  eventId,
  type Fraction,
  freezeElectorate,
  type Hash,
  hash,
  type Instant,
  instant,
  type MemberId,
  memberId,
  type ObjectionId,
  objectionId,
  type OptionId,
  optionId,
  type PrivacyMode,
  type ProposalId,
  proposalId,
  type QuorumConfig,
  ratio,
  type StratumKey,
  stratumKey,
  type StratumValue,
  stratumValue,
  type WindowConfig,
} from '../src/index.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Identificadores deterministas
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** 32 hex en minúscula derivados de un índice. `hex(3)` < `hex(4)` byte a byte. */
export function hex32(index: number): string {
  return index.toString(16).padStart(32, '0');
}

/** Espacio de identificadores separado por familia, para que no colisionen entre sí. */
const SPACE = {
  member: 0x1000,
  option: 0x2000,
  circle: 0x3000,
  objection: 0x4000,
  ballot: 0x5000,
  event: 0x6000,
} as const;

export const memberIdAt = (i: number): MemberId => memberId(hex32(SPACE.member + i));
export const optionIdAt = (i: number): OptionId => optionId(hex32(SPACE.option + i));
export const circleIdAt = (i: number): CircleId => circleId(hex32(SPACE.circle + i));
export const objectionIdAt = (i: number): ObjectionId => objectionId(hex32(SPACE.objection + i));
export const ballotIdAt = (i: number): BallotId => hex32(SPACE.ballot + i) as BallotId;
export const eventIdAt = (i: number): EventId => eventId(hex32(SPACE.event + i));

export const DECISION_ID: DecisionId = decisionId(hex32(0x0d));
export const PROPOSAL_ID: ProposalId = proposalId(hex32(0x0b));
export const CIRCLE_MAIN: CircleId = circleIdAt(0);
export const CIRCLE_OTHER: CircleId = circleIdAt(1);
export const OPTION_MAIN: OptionId = optionIdAt(0);

export const PROPOSAL_V1: Hash = hash('11'.repeat(32));
export const PROPOSAL_V2: Hash = hash('22'.repeat(32));
export const SEED_COMMITMENT: Hash = hash('33'.repeat(32));

export const STRATUM_SEMESTER: StratumKey = stratumKey('semestre');
export const SEMESTER_VALUES: readonly StratumValue[] = [
  stratumValue('s1'),
  stratumValue('s2'),
  stratumValue('s3'),
];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Tiempo
// ═════════════════════════════════════════════════════════════════════════════════════════════

const HOUR = 3_600_000;

/** Viernes 21 de agosto de 2026, 08:00:00 en hora de Bogotá. */
export const T0: Instant = bogotaCivilToInstant({
  year: 2026,
  month: 8,
  day: 21,
  hour: 8,
  minute: 0,
  second: 0,
  millisecond: 0,
});

/** Ventana por defecto: 72 horas. */
export const CLOSES_AT: Instant = instant(T0 + 72 * HOUR);

export const DEFAULT_WINDOW: WindowConfig = {
  opensAt: T0,
  closesAt: CLOSES_AT,
  timezone: 'America/Bogota',
  earlyClose: DEFAULT_EARLY_CLOSE,
  challengeWindow: DEFAULT_CHALLENGE_WINDOW_MS,
};

export const NO_QUORUM: QuorumConfig = {
  participation: ratio(0, 1),
  onFailure: 'reject',
  maxExtensions: 0,
  extensionDuration: 0,
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Padrón
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ElectorateOptions {
  /** Miembros que además pertenecen a `CIRCLE_OTHER`. */
  readonly alsoInOtherCircle?: readonly number[];
  /** Miembros que NO pertenecen a `CIRCLE_MAIN`. */
  readonly outsideMainCircle?: readonly number[];
  readonly frozenAt?: Instant;
}

/** `arbElectorate` del catálogo E.0, en su forma constructiva. */
export async function buildElectorate(
  count: number,
  options: ElectorateOptions = {},
): Promise<Electorate> {
  const other = new Set(options.alsoInOtherCircle ?? []);
  const outside = new Set(options.outsideMainCircle ?? []);
  const frozenAt = options.frozenAt ?? T0;
  return freezeElectorate({
    at: frozenAt,
    registryVersion: 1,
    criterion: 'matriculados activos del Instituto de Filosofía',
    registry: Array.from({ length: count }, (_, i) => ({
      memberId: memberIdAt(i),
      enrolledAt: instant(T0 - 1_000_000),
      circles: [...(outside.has(i) ? [] : [CIRCLE_MAIN]), ...(other.has(i) ? [CIRCLE_OTHER] : [])],
      strata: {
        [STRATUM_SEMESTER]: SEMESTER_VALUES[i % SEMESTER_VALUES.length] ?? SEMESTER_VALUES[0]!,
      } as Readonly<Record<StratumKey, StratumValue>>,
    })),
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Métodos
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type MethodPlan =
  | { readonly kind: 'simple-majority'; readonly abstentionPolicy: AbstentionPolicy }
  | {
      readonly kind: 'supermajority';
      readonly num: number;
      readonly den: number;
      readonly strict: boolean;
      readonly base: 'cast' | 'census';
      readonly abstentionPolicy: AbstentionPolicy;
    }
  | {
      readonly kind: 'unanimity';
      readonly base: 'cast' | 'census';
      readonly abstentionBlocks: boolean;
    }
  | {
      readonly kind: 'sociocratic-consent';
      readonly maxRounds: number;
      readonly minEngagementNum: number;
      readonly minEngagementDen: number;
    };

export function planToMethod(plan: MethodPlan): DecisionMethod {
  switch (plan.kind) {
    case 'simple-majority':
      return {
        kind: 'simple-majority',
        abstentionPolicy: plan.abstentionPolicy,
        base: 'cast',
        tieBreak: DEFAULT_TIE_BREAK,
      };
    case 'supermajority':
      return {
        kind: 'supermajority',
        fraction: ratio(plan.num, plan.den),
        strict: plan.strict,
        base: plan.base,
        abstentionPolicy: plan.abstentionPolicy,
        tieBreak: DEFAULT_TIE_BREAK,
      };
    case 'unanimity':
      return { kind: 'unanimity', base: plan.base, abstentionBlocks: plan.abstentionBlocks };
    case 'sociocratic-consent':
      return {
        kind: 'sociocratic-consent',
        maxRounds: plan.maxRounds,
        silenceMeans: 'not-participating',
        minEngagement: ratio(plan.minEngagementNum, plan.minEngagementDen),
        admissibility: {
          panelSize: 3,
          dismissThreshold: ratio(2, 3),
          panelSelection: 'sortition',
          panelDeadline: 48 * HOUR,
        },
      };
  }
}

export const arbAbstentionPolicy: fc.Arbitrary<AbstentionPolicy> = fc.constantFrom(
  'exclude',
  'include',
  'as-no',
);

export const arbPrivacy: fc.Arbitrary<PrivacyMode> = fc.constantFrom(
  'public-roll-call',
  'sealed-tally',
  'secret-ballot',
);

/** `arbThresholdMethod`: sólo `simple-majority | supermajority | unanimity`. */
export const arbThresholdMethodPlan: fc.Arbitrary<MethodPlan> = fc.oneof(
  fc.record({
    kind: fc.constant('simple-majority' as const),
    abstentionPolicy: arbAbstentionPolicy,
  }),
  fc
    .record({
      kind: fc.constant('supermajority' as const),
      num: fc.integer({ min: 1, max: 9 }),
      den: fc.integer({ min: 1, max: 10 }),
      strict: fc.boolean(),
      base: fc.constantFrom('cast' as const, 'census' as const),
      abstentionPolicy: arbAbstentionPolicy,
    })
    .filter((r) => r.num <= r.den),
  fc.record({
    kind: fc.constant('unanimity' as const),
    base: fc.constantFrom('cast' as const, 'census' as const),
    abstentionBlocks: fc.boolean(),
  }),
);

export const arbConsentMethodPlan: fc.Arbitrary<MethodPlan> = fc.record({
  kind: fc.constant('sociocratic-consent' as const),
  maxRounds: fc.integer({ min: 1, max: 5 }),
  minEngagementNum: fc.integer({ min: 0, max: 4 }),
  minEngagementDen: fc.constant(4),
});

export const arbMethodPlan: fc.Arbitrary<MethodPlan> = fc.oneof(
  arbThresholdMethodPlan,
  arbConsentMethodPlan,
);

/** Métodos monótonos de esta entrega (INV-40 / INV-41). */
export const arbMonotoneMethodPlan: fc.Arbitrary<MethodPlan> = arbThresholdMethodPlan;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Configuración
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ConfigOptions {
  readonly electorate: Electorate;
  readonly method: DecisionMethod;
  readonly quorum?: QuorumConfig;
  readonly window?: WindowConfig;
  readonly privacy?: PrivacyMode;
  readonly delegationEnabled?: boolean;
  readonly proposalVersionHash?: Hash;
  readonly constituentAct?: ConstituentAct;
  readonly circleId?: CircleId;
  /**
   * Las opciones sobre las que se decide. Por omisión, la única propuesta.
   *
   * Se pasa acá y no se sustituye después de construir, porque `buildDecisionConfig` valida: los
   * métodos que comparan opciones entre sí no se dejan abrir con una sola (ver
   * `MULTI_METHOD_NEEDS_TWO_OPTIONS`), así que una config «base» con la opción por omisión y las
   * opciones de verdad puestas encima ni siquiera llega a construirse.
   */
  readonly options?: readonly OptionId[];
}

/** `arbConfig(electorate, method)` del catálogo E.0, en su forma constructiva. */
export async function buildConfig(options: ConfigOptions): Promise<DecisionConfig> {
  const method = options.method;
  const needsConstituent =
    (method.kind === 'supermajority' || method.kind === 'unanimity') && method.base === 'census';
  return buildDecisionConfig({
    decisionId: DECISION_ID,
    proposalId: PROPOSAL_ID,
    proposalVersionHash: options.proposalVersionHash ?? PROPOSAL_V1,
    circleId: options.circleId ?? CIRCLE_MAIN,
    topics: [],
    options: options.options ?? [OPTION_MAIN],
    electorate: options.electorate,
    method,
    quorum: options.quorum ?? NO_QUORUM,
    window: options.window ?? DEFAULT_WINDOW,
    privacy: options.privacy ?? 'public-roll-call',
    delegation:
      options.delegationEnabled === true
        ? { ...DELEGATION_DISABLED, enabled: true }
        : DELEGATION_DISABLED,
    seedCommitment: SEED_COMMITMENT,
    engineVersion: ENGINE_VERSION,
    ...(needsConstituent || options.constituentAct !== undefined
      ? { constituentAct: options.constituentAct ?? 'reform-student-statute' }
      : {}),
    ...(method.kind === 'unanimity' ? { unanimityAuthorizedBy: decisionId(hex32(0x0e)) } : {}),
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Papeletas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type Vote = 'yes' | 'no' | 'abstain' | 'consent' | 'concern' | 'object';

export interface BallotPlan {
  readonly voterIndex: number;
  readonly vote: Vote;
}

export const ARGUMENT =
  'Esta propuesta deja al seminario permanente sin sala durante todo el semestre siguiente.';

export function objectionFor(
  index: number,
  round: number,
): NonNullable<Extract<BallotPayload, { kind: 'consent' }>['objection']> {
  return {
    objectionId: objectionIdAt(index),
    argument: ARGUMENT,
    harmedAim: 'sostener el seminario permanente',
    raisedAtRound: round,
  };
}

/** Convierte un voto del plan al `BallotPayload` que corresponde al método. */
export function voteToPayload(vote: Vote, index: number, round: number): BallotPayload {
  switch (vote) {
    case 'yes':
      return { kind: 'binary', approve: true };
    case 'no':
      return { kind: 'binary', approve: false };
    case 'abstain':
      return { kind: 'abstain' };
    case 'consent':
      return { kind: 'consent', stance: 'consent' };
    case 'concern':
      return { kind: 'consent', stance: 'concern' };
    case 'object':
      return { kind: 'consent', stance: 'object', objection: objectionFor(index, round) };
  }
}

export const arbThresholdVote: fc.Arbitrary<Vote> = fc.constantFrom('yes', 'no', 'abstain');
export const arbConsentVote: fc.Arbitrary<Vote> = fc.constantFrom('consent', 'concern', 'object');

export function arbVoteFor(kind: DecisionMethod['kind']): fc.Arbitrary<Vote> {
  return kind === 'sociocratic-consent' ? arbConsentVote : arbThresholdVote;
}

export interface MakeBallotOptions {
  readonly round?: number;
  readonly proposalVersionHash?: Hash;
  readonly baseAt?: Instant;
  readonly startSeq?: number;
  readonly decision?: DecisionId;
}

/** Construye papeletas válidas: `seq` denso desde `startSeq` y `castAt` dentro de la ventana. */
export function makeBallots(
  plans: readonly BallotPlan[],
  options: MakeBallotOptions = {},
): readonly Ballot[] {
  const round = options.round ?? 1;
  const startSeq = options.startSeq ?? 1;
  const baseAt = options.baseAt ?? instant(T0 + 1000);
  return plans.map((plan, i) => ({
    ballotId: ballotIdAt(startSeq + i),
    decisionId: options.decision ?? DECISION_ID,
    voter: memberIdAt(plan.voterIndex),
    round,
    payload: voteToPayload(plan.vote, startSeq + i, round),
    castAt: instant(baseAt + i),
    seq: startSeq + i,
    proposalVersionHash: options.proposalVersionHash ?? PROPOSAL_V1,
  }));
}

/** Planes con **un solo voto por persona**: el caso en el que permutar es siempre seguro. */
export function arbDistinctBallotPlans(
  memberCount: number,
  kind: DecisionMethod['kind'],
): fc.Arbitrary<readonly BallotPlan[]> {
  return fc
    .uniqueArray(fc.integer({ min: 0, max: memberCount - 1 }), { maxLength: memberCount })
    .chain((indices) =>
      fc
        .array(arbVoteFor(kind), { minLength: indices.length, maxLength: indices.length })
        .map((votes) =>
          indices.map((voterIndex, i) => ({ voterIndex, vote: votes[i] ?? 'abstain' })),
        ),
    );
}

/** Planes con repeticiones: sirven para probar «la última manda» (INV-07). */
export function arbBallotPlans(
  memberCount: number,
  kind: DecisionMethod['kind'],
  maxLength = 3 * memberCount,
): fc.Arbitrary<readonly BallotPlan[]> {
  return fc.array(
    fc.record({
      voterIndex: fc.integer({ min: 0, max: memberCount - 1 }),
      vote: arbVoteFor(kind),
    }),
    { maxLength },
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Papeletas INVÁLIDAS (`arbInvalidBallot` del catálogo E.0)
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type InvalidKind =
  | 'ineligible-voter'
  | 'cast-at-closes-at'
  | 'cast-before-opens'
  | 'stale-proposal-version'
  | 'wrong-round'
  | 'wrong-decision'
  | 'payload-kind-not-accepted'
  | 'object-without-objection'
  | 'objection-too-short';

export const arbInvalidKind: fc.Arbitrary<InvalidKind> = fc.constantFrom(
  'ineligible-voter',
  'cast-at-closes-at',
  'cast-before-opens',
  'stale-proposal-version',
  'wrong-round',
  'wrong-decision',
  'payload-kind-not-accepted',
  'object-without-objection',
  'objection-too-short',
);

/**
 * Papeleta malformada de la clase pedida. Nunca «casi válida por accidente»: cada una infringe
 * exactamente una regla, para que el contraejemplo minimizado señale la regla infringida.
 */
export function makeInvalidBallot(
  config: DecisionConfig,
  kind: InvalidKind,
  seq: number,
  voterIndex: number,
): Ballot {
  const consentMethod = config.method.kind === 'sociocratic-consent';
  const base: Ballot = {
    ballotId: ballotIdAt(seq),
    decisionId: config.decisionId,
    voter: memberIdAt(voterIndex),
    round: 1,
    payload: consentMethod
      ? { kind: 'consent', stance: 'consent' }
      : { kind: 'binary', approve: true },
    castAt: instant(config.window.opensAt + 1),
    seq,
    proposalVersionHash: config.proposalVersionHash,
  };

  switch (kind) {
    case 'ineligible-voter':
      // Fuera del espacio de miembros del padrón: no está en el snapshot congelado.
      return { ...base, voter: memberId(hex32(0xffff + voterIndex)) };
    case 'cast-at-closes-at':
      // El milisegundo exacto del cierre. D.3.b: `closesAt` es EXCLUSIVO.
      return { ...base, castAt: config.window.closesAt };
    case 'cast-before-opens':
      return { ...base, castAt: instant(config.window.opensAt - 1) };
    case 'stale-proposal-version':
      return { ...base, proposalVersionHash: PROPOSAL_V2 };
    case 'wrong-round':
      return { ...base, round: 2 };
    case 'wrong-decision':
      return { ...base, decisionId: decisionId(hex32(0xabcd)) };
    case 'payload-kind-not-accepted':
      return {
        ...base,
        payload: consentMethod ? { kind: 'abstain' } : { kind: 'consent', stance: 'consent' },
      };
    case 'object-without-objection':
      return { ...base, payload: { kind: 'consent', stance: 'object' } };
    case 'objection-too-short':
      return {
        ...base,
        payload: {
          kind: 'consent',
          stance: 'object',
          objection: {
            objectionId: objectionIdAt(seq),
            argument: 'no me gusta',
            harmedAim: 'ninguno',
            raisedAtRound: 1,
          },
        },
      };
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Permutaciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** `arbPermutation(k)`: una permutación de `0…k−1`, generada por Fisher–Yates con índices dados. */
export function arbPermutation(k: number): fc.Arbitrary<readonly number[]> {
  if (k <= 1) return fc.constant(Array.from({ length: k }, (_, i) => i));
  return fc
    .tuple(...Array.from({ length: k - 1 }, (_, i) => fc.integer({ min: 0, max: k - 1 - i })))
    .map((picks) => {
      const pool = Array.from({ length: k }, (_, i) => i);
      const out: number[] = [];
      for (const pick of picks) out.push(...pool.splice(pick, 1));
      out.push(...pool);
      return out;
    });
}

/**
 * `reseq` de INV-16: reordena la llegada de las papeletas y reasigna `seq` de forma densa,
 * **conservando la relación «última papeleta por votante»**.
 *
 * Se logra permutando las **posiciones** y repartiendo después las papeletas de cada votante entre
 * sus nuevas posiciones en orden ascendente: el orden relativo dentro de cada votante no cambia, así
 * que la última sigue siendo la misma, pero el orden global de llegada sí cambia por completo.
 */
export function resequence(
  ballots: readonly Ballot[],
  permutation: readonly number[],
): readonly Ballot[] {
  const positionsByVoter = new Map<string, number[]>();
  permutation.forEach((originalIndex, newIndex) => {
    const voter = ballots[originalIndex]?.voter;
    if (voter === undefined) return;
    const list = positionsByVoter.get(voter) ?? [];
    list.push(newIndex);
    positionsByVoter.set(voter, list);
  });
  for (const list of positionsByVoter.values()) list.sort((a, b) => a - b);

  const cursor = new Map<string, number>();
  const out: Ballot[] = new Array<Ballot>(ballots.length);
  for (const ballot of ballots) {
    const positions = positionsByVoter.get(ballot.voter) ?? [];
    const index = cursor.get(ballot.voter) ?? 0;
    cursor.set(ballot.voter, index + 1);
    const newIndex = positions[index] ?? 0;
    out[newIndex] = ballot;
  }
  return out.map((ballot, i) => ({
    ...ballot,
    seq: i + 1,
    castAt: instant(T0 + 1000 + i),
    ballotId: ballotIdAt(i + 1),
  }));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Fracciones e instantes
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const arbProperFraction: fc.Arbitrary<Fraction> = fc
  .tuple(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 1, max: 12 }))
  .filter(([n, d]) => n <= d)
  .map(([n, d]) => ratio(n, d));

/** `arbClockNow`: instante arbitrario, usado SÓLO para probar que el escrutinio no lo lee (INV-15). */
export const arbClockNow: fc.Arbitrary<Instant> = fc
  .integer({ min: 0, max: 2 ** 42 })
  .map((n) => instant(n));

/** Número de corridas por propiedad. La especificación exige ≥ 1 000 en CI (E.0). */
export const RUNS = Number(process.env['FC_RUNS'] ?? '1000');

/** Semilla fija: los contraejemplos son reproducibles entre ejecuciones (E.0). */
export const FC = { numRuns: RUNS, seed: 30_000_821, verbose: 0 } as const;

/**
 * Corridas de una propiedad cara, **escaladas** con `FC_RUNS`.
 *
 * `runs(40)` corre 40 veces con el ajuste por defecto (1 000) y 400 en la ejecución nocturna
 * (`FC_RUNS=10000`). Se hace así y no con un tope fijo porque un tope fijo convierte la ejecución
 * nocturna en una copia de la diaria justo en las propiedades que más falta hace machacar: las que
 * enumeran continuaciones o construyen logs encadenados.
 */
export function runs(atDefault: number): { numRuns: number; seed: number } {
  return { seed: FC.seed, numRuns: Math.max(5, Math.round((RUNS * atDefault) / 1000)) };
}
