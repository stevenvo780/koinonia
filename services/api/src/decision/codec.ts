/**
 * Codec entre el evento de dominio (`DecisionEvent`) y el evento del ledger (`CanonicalEvent`).
 *
 * ═══ Por qué esto es explícito y no genérico ═══
 *
 * Un serializador genérico tendría que representar los `bigint` de las `Fraction` con alguna
 * convención inventada (`{"$bigint":"2"}`, un sufijo `n`, un número), y todas esas convenciones o
 * bien introducen claves fuera del patrón que el perfil canónico admite —`^[A-Za-z][A-Za-z0-9_]*$`—
 * o bien pierden el tipo al volver. Aquí cada campo se escribe y se lee a mano, y **el decodificador
 * valida**: un payload que no encaje no se «acomoda», se rechaza. Acomodar en silencio es lo que
 * produce dos verificadores que discrepan sin que nadie haya hecho nada mal.
 *
 * ═══ Correspondencia de campos ═══
 *
 * | Dominio                | Ledger                                                    |
 * |------------------------|-----------------------------------------------------------|
 * | `decisionId`           | `aggregateId` (los dos son 32 hex: no hay conversión)     |
 * | `seq` (denso desde 1)  | `seq` (denso desde 0) — el ledger exige que el génesis sea 0 |
 * | `occurredAt: Instant`  | `occurredAt`: RFC 3339 UTC de 24 caracteres               |
 * | `actor: MemberId\|'system'` | `actor` presente, o **ausente** si es el sistema     |
 * | `payload.type`         | `eventType`                                               |
 * | `eventId` + resto      | `payload`                                                 |
 *
 * `prevHash` y `hash` del dominio **no se almacenan**: son función del resto y se recomputan al
 * rehidratar con `appendEvent`. Guardarlos permitiría que la copia y el original discreparan, que es
 * exactamente la clase de divergencia que este proyecto existe para hacer imposible.
 */

import type { CanonicalEvent, JsonObject, JsonValue } from '@koinonia/crypto';
import {
  type AbstentionPolicy,
  type Ballot,
  type BallotPayload,
  ballotId,
  circleId,
  type CloseCause,
  type ConsentStance,
  type ConstituentAct,
  type DecisionConfig,
  type DecisionEvent,
  type DecisionEventPayload,
  type DecisionMethod,
  decisionId,
  deepFreeze,
  type Delegation,
  type DelegationConfig,
  type DelegationScope,
  delegationId,
  type DraftConfig,
  type EarlyCloseConfig,
  type EligibleMember,
  type Electorate,
  type EventInput,
  type EventId,
  eventId,
  type Fraction,
  fraction,
  type GradeEntry,
  type GradeId,
  type GradeScale,
  hash as toHash,
  type Instant,
  instant,
  initiativeId,
  type MemberId,
  memberId,
  type Objection,
  type ObjectionAdmissibilityConfig,
  objectionId,
  type OptionId,
  optionId,
  type OutcomeKind,
  type PrivacyMode,
  proposalId,
  type QuorumConfig,
  type Score,
  type ScoreEntry,
  type StratumKey,
  stratumKey,
  type StratumValue,
  stratumValue,
  type ThresholdBase,
  type TieBreakPolicy,
  type TieBreakRule,
  type TopicId,
  topicId,
  type WindowConfig,
} from '@koinonia/domain';

import type { LedgerEventDraft, StoredEvent } from '../ledger/types.js';

/** Tipo de agregado de una decisión en el ledger. Cumple `^#?[a-z][a-z0-9_]*$`. */
export const DECISION_AGGREGATE_TYPE = 'decision';

/** Versión del formato del payload. Subirla obliga a escribir el migrador de lectura. */
export const DECISION_EVENT_VERSION = 1;

export class DecisionCodecError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path === '' ? '<payload>' : path}: ${detail}`);
    this.name = 'DecisionCodecError';
    this.path = path;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Instantes
// ═════════════════════════════════════════════════════════════════════════════════════════════

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** `Instant` (ms desde el epoch) -> `YYYY-MM-DDTHH:MM:SS.sssZ`, exactamente 24 caracteres. */
export function instantToIso(at: Instant): string {
  const iso = new Date(at).toISOString();
  if (!ISO_MS.test(iso)) {
    throw new DecisionCodecError(
      'occurredAt',
      `${String(at)} no cabe en el formato de 24 caracteres`,
    );
  }
  return iso;
}

/** La vuelta. Es exacta: milisegundos enteros en los dos lados. */
export function isoToInstant(iso: string): Instant {
  if (!ISO_MS.test(iso)) throw new DecisionCodecError('occurredAt', `${iso} no es RFC 3339 con ms`);
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new DecisionCodecError('occurredAt', `${iso} no es un instante real`);
  return instant(ms);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectores validadores
// ═════════════════════════════════════════════════════════════════════════════════════════════

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function get(source: JsonObject, key: string, path: string): JsonValue {
  const value = source[key];
  if (value === undefined) throw new DecisionCodecError(`${path}.${key}`, 'clave ausente');
  return value;
}

function str(source: JsonObject, key: string, path: string): string {
  const value = get(source, key, path);
  if (typeof value !== 'string')
    throw new DecisionCodecError(`${path}.${key}`, 'se esperaba texto');
  return value;
}

function optStr(source: JsonObject, key: string, path: string): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string')
    throw new DecisionCodecError(`${path}.${key}`, 'se esperaba texto');
  return value;
}

function int(source: JsonObject, key: string, path: string): number {
  const value = get(source, key, path);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new DecisionCodecError(`${path}.${key}`, 'se esperaba un entero seguro');
  }
  return value;
}

function bool(source: JsonObject, key: string, path: string): boolean {
  const value = get(source, key, path);
  if (typeof value !== 'boolean')
    throw new DecisionCodecError(`${path}.${key}`, 'se esperaba booleano');
  return value;
}

function obj(source: JsonObject, key: string, path: string): JsonObject {
  const value = get(source, key, path);
  if (!isObject(value)) throw new DecisionCodecError(`${path}.${key}`, 'se esperaba un objeto');
  return value;
}

function optObj(source: JsonObject, key: string, path: string): JsonObject | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new DecisionCodecError(`${path}.${key}`, 'se esperaba un objeto');
  return value;
}

function arr(source: JsonObject, key: string, path: string): readonly JsonValue[] {
  const value = get(source, key, path);
  if (!Array.isArray(value))
    throw new DecisionCodecError(`${path}.${key}`, 'se esperaba un arreglo');
  // `Array.isArray` sobre un `JsonValue` estrecha a `any[]`: se reafirma el tipo del dominio en vez
  // de dejar que un `any` se propague por todos los decodificadores.
  return value as readonly JsonValue[];
}

function strArray(source: JsonObject, key: string, path: string): readonly string[] {
  return arr(source, key, path).map((item, i) => {
    if (typeof item !== 'string') {
      throw new DecisionCodecError(`${path}.${key}[${String(i)}]`, 'se esperaba texto');
    }
    return item;
  });
}

function oneOf<T extends string>(value: string, allowed: readonly T[], path: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DecisionCodecError(path, `${value} no está en {${allowed.join(', ')}}`);
  }
  return value as T;
}

const DECIMAL = /^\d+$/u;

function encFraction(value: Fraction): JsonObject {
  return { num: value.num.toString(), den: value.den.toString() };
}

function decFraction(source: JsonObject, key: string, path: string): Fraction {
  const raw = obj(source, key, path);
  const num = str(raw, 'num', `${path}.${key}`);
  const den = str(raw, 'den', `${path}.${key}`);
  if (!DECIMAL.test(num) || !DECIMAL.test(den)) {
    // Los `bigint` viajan como cadena decimal (A.1.1.3). Un número JSON perdería exactitud por
    // encima de 2^53 sin avisar, que es exactamente el fallo que las fracciones exactas evitan.
    throw new DecisionCodecError(`${path}.${key}`, 'num y den son cadenas decimales, no números');
  }
  return fraction(BigInt(num), BigInt(den));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Padrón, método, quórum, ventana, delegación
// ═════════════════════════════════════════════════════════════════════════════════════════════

function encStrata(strata: Readonly<Record<StratumKey, StratumValue>>): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(strata)) out[key] = strata[key as StratumKey] ?? '';
  return out;
}

function decStrata(source: JsonObject, path: string): Readonly<Record<StratumKey, StratumValue>> {
  const out: Record<StratumKey, StratumValue> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value !== 'string') {
      throw new DecisionCodecError(`${path}.${key}`, 'un valor de estrato es una etiqueta');
    }
    out[stratumKey(key)] = stratumValue(value);
  }
  return out;
}

function encElectorate(electorate: Electorate): JsonObject {
  return {
    snapshotId: electorate.snapshotId,
    frozenAt: electorate.frozenAt,
    members: electorate.members.map((member) => ({
      memberId: member.memberId,
      baseWeight: member.baseWeight,
      circles: [...member.circles],
      strata: encStrata(member.strata),
    })),
    censusSize: electorate.censusSize,
    rollHash: electorate.rollHash,
    registryVersion: electorate.registryVersion,
    criterion: electorate.criterion,
  };
}

function decElectorate(source: JsonObject, path: string): Electorate {
  const members: EligibleMember[] = arr(source, 'members', path).map((raw, i) => {
    const where = `${path}.members[${String(i)}]`;
    if (!isObject(raw)) throw new DecisionCodecError(where, 'se esperaba un objeto');
    const weight = int(raw, 'baseWeight', where);
    if (weight !== 1) {
      throw new DecisionCodecError(`${where}.baseWeight`, 'el peso base es SIEMPRE 1 (A.2)');
    }
    return {
      memberId: memberId(str(raw, 'memberId', where)),
      baseWeight: 1,
      circles: strArray(raw, 'circles', where).map(circleId),
      strata: decStrata(obj(raw, 'strata', where), `${where}.strata`),
    };
  });
  return {
    snapshotId: toHash(str(source, 'snapshotId', path)),
    frozenAt: instant(int(source, 'frozenAt', path)),
    members,
    censusSize: int(source, 'censusSize', path),
    rollHash: toHash(str(source, 'rollHash', path)),
    registryVersion: int(source, 'registryVersion', path),
    criterion: str(source, 'criterion', path),
  };
}

const TIE_BREAK_RULES: readonly TieBreakRule[] = [
  'more-first-preferences',
  'more-approvals',
  'higher-median',
  'fewer-rejections',
  'pairwise-head-to-head',
  'higher-mean',
  'fewer-zeros',
  'more-fives',
  'fewer-first-preferences-in-previous-rounds',
  'more-excellent',
  'fewer-reject',
  'more-pairwise-wins',
  'higher-min-margin',
  'earlier-proposal',
  'public-seed-lot',
  'lexicographic-hash',
];
const ABSTENTION: readonly AbstentionPolicy[] = ['exclude', 'include', 'as-no'];
const BASES: readonly ThresholdBase[] = ['cast', 'census', 'present'];

function encTieBreak(policy: TieBreakPolicy): JsonObject {
  return { cascade: [...policy.cascade] };
}

function decTieBreak(source: JsonObject, path: string): TieBreakPolicy {
  return {
    cascade: strArray(source, 'cascade', path).map((rule, i) =>
      oneOf(rule, TIE_BREAK_RULES, `${path}.cascade[${String(i)}]`),
    ),
  };
}

function encAdmissibility(config: ObjectionAdmissibilityConfig): JsonObject {
  return {
    panelSize: config.panelSize,
    dismissThreshold: encFraction(config.dismissThreshold),
    panelSelection: config.panelSelection,
    panelDeadline: config.panelDeadline,
  };
}

function decAdmissibility(source: JsonObject, path: string): ObjectionAdmissibilityConfig {
  return {
    panelSize: int(source, 'panelSize', path),
    dismissThreshold: decFraction(source, 'dismissThreshold', path),
    panelSelection: oneOf(
      str(source, 'panelSelection', path),
      ['sortition'],
      `${path}.panelSelection`,
    ),
    panelDeadline: int(source, 'panelDeadline', path),
  };
}

function encMethod(method: DecisionMethod): JsonObject {
  switch (method.kind) {
    case 'advice-process':
      return { kind: method.kind, decider: method.decider, minAdvisors: method.minAdvisors };
    case 'consensus':
      return {
        kind: method.kind,
        maxStandAside: encFraction(method.maxStandAside),
        minEngagement: encFraction(method.minEngagement),
      };
    case 'simple-majority':
      return {
        kind: method.kind,
        abstentionPolicy: method.abstentionPolicy,
        base: method.base,
        tieBreak: encTieBreak(method.tieBreak),
      };
    case 'supermajority':
      return {
        kind: method.kind,
        fraction: encFraction(method.fraction),
        strict: method.strict,
        base: method.base,
        abstentionPolicy: method.abstentionPolicy,
        tieBreak: encTieBreak(method.tieBreak),
      };
    case 'unanimity':
      return { kind: method.kind, base: method.base, abstentionBlocks: method.abstentionBlocks };
    case 'sociocratic-consent':
      return {
        kind: method.kind,
        maxRounds: method.maxRounds,
        admissibility: encAdmissibility(method.admissibility),
        silenceMeans: method.silenceMeans,
        minEngagement: encFraction(method.minEngagement),
      };
    case 'score':
      return {
        kind: method.kind,
        min: method.min,
        max: method.max,
        aggregator: method.aggregator,
        noOpinionPolicy: method.noOpinionPolicy,
        minCoverage: encFraction(method.minCoverage),
        tieBreak: encTieBreak(method.tieBreak),
      };
    case 'irv':
      return {
        kind: method.kind,
        exhaustedPolicy: method.exhaustedPolicy,
        eliminationTieBreak: encTieBreak(method.eliminationTieBreak),
        allowTruncation: method.allowTruncation,
        tieBreak: encTieBreak(method.tieBreak),
      };
    case 'majority-judgment':
      return {
        kind: method.kind,
        scale: method.scale.grades.map((grade) => ({ id: grade.id, label: grade.label })),
        missingGradePolicy: method.missingGradePolicy,
        tieBreak: encTieBreak(method.tieBreak),
      };
    case 'condorcet-schulze':
      return {
        kind: method.kind,
        allowTruncation: method.allowTruncation,
        truncatedMeans: method.truncatedMeans,
        tieBreak: encTieBreak(method.tieBreak),
      };
    case 'deliberative-sortition':
      return {
        kind: method.kind,
        sampleSize: method.sampleSize,
        strata: [...method.strata],
        allocation: method.allocation,
        seedCommitment: method.seedCommitment,
      };
  }
}

function decGradeScale(source: JsonObject, path: string): GradeScale {
  const grades = arr(source, 'scale', path).map((raw, i) => {
    const where = `${path}.scale[${String(i)}]`;
    if (!isObject(raw)) throw new DecisionCodecError(where, 'se esperaba un objeto');
    return { id: str(raw, 'id', where) as GradeId, label: str(raw, 'label', where) };
  });
  return { grades };
}

function decMethod(source: JsonObject, path: string): DecisionMethod {
  const kind = oneOf(
    str(source, 'kind', path),
    [
      'simple-majority',
      'supermajority',
      'unanimity',
      'sociocratic-consent',
      'score',
      'irv',
      'majority-judgment',
      'condorcet-schulze',
      'deliberative-sortition',
      'advice-process',
      'consensus',
    ] as const,
    `${path}.kind`,
  );
  switch (kind) {
    case 'advice-process':
      return {
        kind,
        decider: memberId(str(source, 'decider', path)),
        minAdvisors: int(source, 'minAdvisors', path),
      };
    case 'consensus':
      return {
        kind,
        maxStandAside: decFraction(source, 'maxStandAside', path),
        minEngagement: decFraction(source, 'minEngagement', path),
      };
    case 'simple-majority':
      return {
        kind,
        abstentionPolicy: oneOf(str(source, 'abstentionPolicy', path), ABSTENTION, path),
        base: oneOf(str(source, 'base', path), BASES, path),
        tieBreak: decTieBreak(obj(source, 'tieBreak', path), `${path}.tieBreak`),
      };
    case 'supermajority':
      return {
        kind,
        fraction: decFraction(source, 'fraction', path),
        strict: bool(source, 'strict', path),
        base: oneOf(str(source, 'base', path), BASES, path),
        abstentionPolicy: oneOf(str(source, 'abstentionPolicy', path), ABSTENTION, path),
        tieBreak: decTieBreak(obj(source, 'tieBreak', path), `${path}.tieBreak`),
      };
    case 'unanimity':
      return {
        kind,
        base: oneOf(str(source, 'base', path), ['cast', 'census'] as const, `${path}.base`),
        abstentionBlocks: bool(source, 'abstentionBlocks', path),
      };
    case 'sociocratic-consent':
      return {
        kind,
        maxRounds: int(source, 'maxRounds', path),
        admissibility: decAdmissibility(
          obj(source, 'admissibility', path),
          `${path}.admissibility`,
        ),
        silenceMeans: oneOf(
          str(source, 'silenceMeans', path),
          ['consent', 'not-participating'] as const,
          `${path}.silenceMeans`,
        ),
        minEngagement: decFraction(source, 'minEngagement', path),
      };
    case 'score': {
      // B.5 fija los cuatro literales; el decodificador los exige en vez de aceptarlos y acomodar.
      const min = int(source, 'min', path);
      const max = int(source, 'max', path);
      if (min !== 0 || max !== 5) {
        throw new DecisionCodecError(path, 'B.5 fija el rango de puntuación en 0–5');
      }
      return {
        kind,
        min: 0,
        max: 5,
        aggregator: oneOf(
          str(source, 'aggregator', path),
          ['median'] as const,
          `${path}.aggregator`,
        ),
        noOpinionPolicy: oneOf(
          str(source, 'noOpinionPolicy', path),
          ['ignore'] as const,
          `${path}.noOpinionPolicy`,
        ),
        minCoverage: decFraction(source, 'minCoverage', path),
        tieBreak: decTieBreak(obj(source, 'tieBreak', path), `${path}.tieBreak`),
      };
    }
    case 'irv':
      return {
        kind,
        exhaustedPolicy: oneOf(
          str(source, 'exhaustedPolicy', path),
          ['reduce-quota', 'fixed-quota'] as const,
          `${path}.exhaustedPolicy`,
        ),
        eliminationTieBreak: decTieBreak(
          obj(source, 'eliminationTieBreak', path),
          `${path}.eliminationTieBreak`,
        ),
        allowTruncation: bool(source, 'allowTruncation', path),
        tieBreak: decTieBreak(obj(source, 'tieBreak', path), `${path}.tieBreak`),
      };
    case 'majority-judgment':
      return {
        kind,
        scale: decGradeScale(source, path),
        missingGradePolicy: oneOf(
          str(source, 'missingGradePolicy', path),
          ['worst', 'reject-ballot'] as const,
          `${path}.missingGradePolicy`,
        ),
        tieBreak: decTieBreak(obj(source, 'tieBreak', path), `${path}.tieBreak`),
      };
    case 'condorcet-schulze':
      return {
        kind,
        allowTruncation: bool(source, 'allowTruncation', path),
        truncatedMeans: oneOf(
          str(source, 'truncatedMeans', path),
          ['tied-last'] as const,
          `${path}.truncatedMeans`,
        ),
        tieBreak: decTieBreak(obj(source, 'tieBreak', path), `${path}.tieBreak`),
      };
    case 'deliberative-sortition':
      return {
        kind,
        sampleSize: int(source, 'sampleSize', path),
        strata: strArray(source, 'strata', path).map(stratumKey),
        allocation: oneOf(
          str(source, 'allocation', path),
          ['proportional', 'equal'] as const,
          `${path}.allocation`,
        ),
        seedCommitment: toHash(str(source, 'seedCommitment', path)),
      };
  }
}

function encQuorum(quorum: QuorumConfig): JsonObject {
  return {
    participation: encFraction(quorum.participation),
    ...(quorum.approvalOfCensus === undefined
      ? {}
      : { approvalOfCensus: encFraction(quorum.approvalOfCensus) }),
    ...(quorum.minDirectParticipation === undefined
      ? {}
      : { minDirectParticipation: encFraction(quorum.minDirectParticipation) }),
    ...(quorum.perCircle === undefined
      ? {}
      : {
          perCircle: quorum.perCircle.map((entry) => ({
            circleId: entry.circleId,
            min: encFraction(entry.min),
          })),
        }),
    onFailure: quorum.onFailure,
    maxExtensions: quorum.maxExtensions,
    extensionDuration: quorum.extensionDuration,
  };
}

function decQuorum(source: JsonObject, path: string): QuorumConfig {
  const perCircleRaw = source['perCircle'];
  const perCircle =
    perCircleRaw === undefined
      ? undefined
      : arr(source, 'perCircle', path).map((raw, i) => {
          const where = `${path}.perCircle[${String(i)}]`;
          if (!isObject(raw)) throw new DecisionCodecError(where, 'se esperaba un objeto');
          return {
            circleId: circleId(str(raw, 'circleId', where)),
            min: decFraction(raw, 'min', where),
          };
        });
  return {
    participation: decFraction(source, 'participation', path),
    ...(source['approvalOfCensus'] === undefined
      ? {}
      : { approvalOfCensus: decFraction(source, 'approvalOfCensus', path) }),
    ...(source['minDirectParticipation'] === undefined
      ? {}
      : { minDirectParticipation: decFraction(source, 'minDirectParticipation', path) }),
    ...(perCircle === undefined ? {} : { perCircle }),
    onFailure: oneOf(
      str(source, 'onFailure', path),
      ['reject', 'extend', 'escalate'] as const,
      `${path}.onFailure`,
    ),
    maxExtensions: int(source, 'maxExtensions', path),
    extensionDuration: int(source, 'extensionDuration', path),
  };
}

function encEarlyClose(early: EarlyCloseConfig): JsonObject {
  return { enabled: early.enabled, mode: early.mode };
}

function encWindow(window: WindowConfig): JsonObject {
  return {
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    timezone: window.timezone,
    earlyClose: encEarlyClose(window.earlyClose),
    challengeWindow: window.challengeWindow,
  };
}

function decWindow(source: JsonObject, path: string): WindowConfig {
  const early = obj(source, 'earlyClose', path);
  return {
    opensAt: instant(int(source, 'opensAt', path)),
    closesAt: instant(int(source, 'closesAt', path)),
    timezone: oneOf(str(source, 'timezone', path), ['America/Bogota'] as const, `${path}.timezone`),
    earlyClose: {
      enabled: bool(early, 'enabled', `${path}.earlyClose`),
      mode: oneOf(
        str(early, 'mode', `${path}.earlyClose`),
        ['mathematically-irreversible', 'full-turnout', 'never'] as const,
        `${path}.earlyClose.mode`,
      ),
    },
    challengeWindow: int(source, 'challengeWindow', path),
  };
}

function encDelegationConfig(delegation: DelegationConfig): JsonObject {
  return {
    enabled: delegation.enabled,
    maxDepth: delegation.maxDepth,
    cap: encFraction(delegation.cap),
    overflowPolicy: delegation.overflowPolicy,
    maxValidity: delegation.maxValidity,
    brokenChainNotice: delegation.brokenChainNotice,
    lastWordWindow: delegation.lastWordWindow,
  };
}

function decDelegationConfig(source: JsonObject, path: string): DelegationConfig {
  return {
    enabled: bool(source, 'enabled', path),
    maxDepth: int(source, 'maxDepth', path),
    cap: decFraction(source, 'cap', path),
    overflowPolicy: oneOf(
      str(source, 'overflowPolicy', path),
      ['return-to-delegator'] as const,
      `${path}.overflowPolicy`,
    ),
    maxValidity: int(source, 'maxValidity', path),
    brokenChainNotice: int(source, 'brokenChainNotice', path),
    lastWordWindow: int(source, 'lastWordWindow', path),
  };
}

const CONSTITUENT_ACTS: readonly ConstituentAct[] = [
  'reform-student-statute',
  'revoke-mandate',
  'dissolve-circle',
];
const PRIVACY: readonly PrivacyMode[] = ['public-roll-call', 'sealed-tally', 'secret-ballot'];

export function encodeConfig(config: DecisionConfig): JsonObject {
  return {
    decisionId: config.decisionId,
    proposalId: config.proposalId,
    proposalVersionHash: config.proposalVersionHash,
    circleId: config.circleId,
    topics: [...config.topics],
    options: [...config.options],
    electorate: encElectorate(config.electorate),
    method: encMethod(config.method),
    quorum: encQuorum(config.quorum),
    window: encWindow(config.window),
    privacy: config.privacy,
    delegation: encDelegationConfig(config.delegation),
    seedCommitment: config.seedCommitment,
    ...(config.constituentAct === undefined ? {} : { constituentAct: config.constituentAct }),
    ...(config.unanimityAuthorizedBy === undefined
      ? {}
      : { unanimityAuthorizedBy: config.unanimityAuthorizedBy }),
    ...(config.supersedes === undefined ? {} : { supersedes: config.supersedes }),
    configHash: config.configHash,
    engineVersion: config.engineVersion,
  };
}

export function decodeConfig(source: JsonObject, path = 'config'): DecisionConfig {
  const constituentAct = optStr(source, 'constituentAct', path);
  const unanimityAuthorizedBy = optStr(source, 'unanimityAuthorizedBy', path);
  const supersedes = optStr(source, 'supersedes', path);
  return deepFreeze<DecisionConfig>({
    decisionId: decisionId(str(source, 'decisionId', path)),
    proposalId: proposalId(str(source, 'proposalId', path)),
    proposalVersionHash: toHash(str(source, 'proposalVersionHash', path)),
    circleId: circleId(str(source, 'circleId', path)),
    topics: strArray(source, 'topics', path).map<TopicId>(topicId),
    options: strArray(source, 'options', path).map<OptionId>(optionId),
    electorate: decElectorate(obj(source, 'electorate', path), `${path}.electorate`),
    method: decMethod(obj(source, 'method', path), `${path}.method`),
    quorum: decQuorum(obj(source, 'quorum', path), `${path}.quorum`),
    window: decWindow(obj(source, 'window', path), `${path}.window`),
    privacy: oneOf(str(source, 'privacy', path), PRIVACY, `${path}.privacy`),
    delegation: decDelegationConfig(obj(source, 'delegation', path), `${path}.delegation`),
    seedCommitment: toHash(str(source, 'seedCommitment', path)),
    ...(constituentAct === undefined
      ? {}
      : { constituentAct: oneOf(constituentAct, CONSTITUENT_ACTS, `${path}.constituentAct`) }),
    ...(unanimityAuthorizedBy === undefined
      ? {}
      : { unanimityAuthorizedBy: decisionId(unanimityAuthorizedBy) }),
    ...(supersedes === undefined ? {} : { supersedes: decisionId(supersedes) }),
    configHash: toHash(str(source, 'configHash', path)),
    engineVersion: str(source, 'engineVersion', path),
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Papeletas, objeciones y delegaciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

function encObjection(objection: Objection): JsonObject {
  return {
    objectionId: objection.objectionId,
    argument: objection.argument,
    harmedAim: objection.harmedAim,
    ...(objection.proposedAmendment === undefined
      ? {}
      : { proposedAmendment: objection.proposedAmendment }),
    raisedAtRound: objection.raisedAtRound,
  };
}

function decObjection(source: JsonObject, path: string): Objection {
  const amendment = optStr(source, 'proposedAmendment', path);
  return {
    objectionId: objectionId(str(source, 'objectionId', path)),
    argument: str(source, 'argument', path),
    harmedAim: str(source, 'harmedAim', path),
    ...(amendment === undefined ? {} : { proposedAmendment: amendment }),
    raisedAtRound: int(source, 'raisedAtRound', path),
  };
}

const STANCES: readonly ConsentStance[] = ['consent', 'concern', 'object'];

function encBallotPayload(payload: BallotPayload): JsonObject {
  switch (payload.kind) {
    case 'abstain':
      return { kind: payload.kind };
    case 'binary':
      return { kind: payload.kind, approve: payload.approve };
    case 'advice':
      return { kind: payload.kind, stance: payload.stance, reasoning: payload.reasoning };
    case 'consensus':
      return {
        kind: payload.kind,
        stance: payload.stance,
        ...(payload.razon === undefined ? {} : { razon: payload.razon }),
      };
    case 'consent':
      return {
        kind: payload.kind,
        stance: payload.stance,
        ...(payload.objection === undefined ? {} : { objection: encObjection(payload.objection) }),
      };
    case 'score': {
      // Es una LISTA de pares `{option, value}`, nunca `{[opción]: nota}`, por dos razones del
      // perfil canónico del ledger (`packages/crypto/src/canonical.ts`), no una preferencia de
      // estilo:
      //
      //  1. `keyPattern` exige que toda clave de objeto empiece por letra. Un `OptionId` es 32
      //     hexadecimales al azar — cerca del 62 % empieza por dígito — así que usarlo de clave
      //     revienta el hasheo la mayoría de las veces, no en un caso raro.
      //  2. `allowNull` es `false`. `null` («sin opinión», B.5.a) no se puede escribir de ninguna
      //     forma, ni siquiera como valor de una clave bien formada.
      //
      // El dominio (`BallotPayload`, `ballot.ts`) ya trae esta forma —la opción ausente de la
      // lista es «sin opinión»—, así que aquí sólo hace falta ordenar por opción, para que la
      // misma papeleta hashee siempre igual sin importar en qué orden llegaron las notas por HTTP.
      const scores = [...payload.scores]
        .sort((a, b) => (a.option < b.option ? -1 : a.option > b.option ? 1 : 0))
        .map((entry): JsonObject => ({ option: entry.option, value: entry.value }));
      return { kind: payload.kind, scores };
    }
    case 'ranking':
      return { kind: payload.kind, order: [...payload.order] };
    case 'grades': {
      // Misma razón que `score` arriba, sin el problema del `null`: `grades` ya era parcial —una
      // opción sin mención simplemente no aparece—, así que sólo hacía falta dejar de usar la
      // opción como clave.
      const grades = [...payload.grades]
        .sort((a, b) => (a.option < b.option ? -1 : a.option > b.option ? 1 : 0))
        .map((entry): JsonObject => ({ option: entry.option, grade: entry.grade }));
      return { kind: payload.kind, grades };
    }
  }
}

/** Un par `{option, ...}` bien formado en `source[index]`, o el rechazo con su ruta exacta. */
function pairAt(source: readonly JsonValue[], index: number, where: string): JsonObject {
  const item = source[index];
  if (!isObject(item)) throw new DecisionCodecError(where, 'se esperaba un objeto {option, …}');
  return item;
}

/** Que ninguna opción aparezca dos veces en la lista — el dominio también lo exige (INV-12). */
function assertNoRepeatedOption(options: readonly OptionId[], path: string): void {
  const seen = new Set<OptionId>();
  for (const option of options) {
    if (seen.has(option))
      throw new DecisionCodecError(path, `la opción ${option} aparece más de una vez`);
    seen.add(option);
  }
}

function decScores(source: readonly JsonValue[], path: string): readonly ScoreEntry[] {
  const entries = source.map((_, index) => {
    const where = `${path}[${String(index)}]`;
    const pair = pairAt(source, index, where);
    const option = optionId(str(pair, 'option', where));
    const value = int(pair, 'value', where);
    if (value < 0 || value > 5) {
      throw new DecisionCodecError(`${where}.value`, 'la puntuación es un entero de 0 a 5');
    }
    return { option, value: value as Score };
  });
  assertNoRepeatedOption(
    entries.map((entry) => entry.option),
    path,
  );
  return entries;
}

function decGrades(source: readonly JsonValue[], path: string): readonly GradeEntry[] {
  const entries = source.map((_, index) => {
    const where = `${path}[${String(index)}]`;
    const pair = pairAt(source, index, where);
    const option = optionId(str(pair, 'option', where));
    const grade = str(pair, 'grade', where) as GradeId;
    return { option, grade };
  });
  assertNoRepeatedOption(
    entries.map((entry) => entry.option),
    path,
  );
  return entries;
}

function decBallotPayload(source: JsonObject, path: string): BallotPayload {
  const kind = oneOf(
    str(source, 'kind', path),
    ['abstain', 'binary', 'consent', 'score', 'ranking', 'grades', 'advice', 'consensus'] as const,
    `${path}.kind`,
  );
  switch (kind) {
    case 'abstain':
      return { kind };
    case 'binary':
      return { kind, approve: bool(source, 'approve', path) };
    case 'advice':
      return {
        kind,
        stance: oneOf(
          str(source, 'stance', path),
          ['a-favor', 'en-contra', 'matiz'] as const,
          `${path}.stance`,
        ),
        reasoning: str(source, 'reasoning', path),
      };
    case 'consensus': {
      const razon = optStr(source, 'razon', path);
      return {
        kind,
        stance: oneOf(
          str(source, 'stance', path),
          ['de-acuerdo', 'con-reservas', 'me-aparto', 'bloqueo'] as const,
          `${path}.stance`,
        ),
        ...(razon === undefined ? {} : { razon }),
      };
    }
    case 'consent': {
      const objection = optObj(source, 'objection', path);
      return {
        kind,
        stance: oneOf(str(source, 'stance', path), STANCES, `${path}.stance`),
        ...(objection === undefined
          ? {}
          : { objection: decObjection(objection, `${path}.objection`) }),
      };
    }
    case 'score':
      return { kind, scores: decScores(arr(source, 'scores', path), `${path}.scores`) };
    case 'ranking':
      return { kind, order: strArray(source, 'order', path).map(optionId) };
    case 'grades':
      return { kind, grades: decGrades(arr(source, 'grades', path), `${path}.grades`) };
  }
}

function encBallot(ballot: Ballot): JsonObject {
  return {
    ballotId: ballot.ballotId,
    decisionId: ballot.decisionId,
    voter: ballot.voter,
    round: ballot.round,
    payload: encBallotPayload(ballot.payload),
    castAt: ballot.castAt,
    seq: ballot.seq,
    proposalVersionHash: ballot.proposalVersionHash,
  };
}

function decBallot(source: JsonObject, path: string): Ballot {
  return {
    ballotId: ballotId(str(source, 'ballotId', path)),
    decisionId: decisionId(str(source, 'decisionId', path)),
    voter: memberId(str(source, 'voter', path)),
    round: int(source, 'round', path),
    payload: decBallotPayload(obj(source, 'payload', path), `${path}.payload`),
    castAt: instant(int(source, 'castAt', path)),
    seq: int(source, 'seq', path),
    proposalVersionHash: toHash(str(source, 'proposalVersionHash', path)),
  };
}

function encScope(scope: DelegationScope): JsonObject {
  switch (scope.kind) {
    case 'global':
      return { kind: scope.kind };
    case 'circle':
      return { kind: scope.kind, circleId: scope.circleId };
    case 'topic':
      return { kind: scope.kind, topicId: scope.topicId };
  }
}

function decScope(source: JsonObject, path: string): DelegationScope {
  const kind = oneOf(
    str(source, 'kind', path),
    ['global', 'circle', 'topic'] as const,
    `${path}.kind`,
  );
  switch (kind) {
    case 'global':
      return { kind };
    case 'circle':
      return { kind, circleId: circleId(str(source, 'circleId', path)) };
    case 'topic':
      return { kind, topicId: topicId(str(source, 'topicId', path)) };
  }
}

function encDelegation(delegation: Delegation): JsonObject {
  return {
    delegationId: delegation.delegationId,
    delegator: delegation.delegator,
    delegate: delegation.delegate,
    scope: encScope(delegation.scope),
    grantedAt: delegation.grantedAt,
    expiresAt: delegation.expiresAt,
    ...(delegation.revokedAt === undefined ? {} : { revokedAt: delegation.revokedAt }),
    grantedSeq: delegation.grantedSeq,
  };
}

function decDelegation(source: JsonObject, path: string): Delegation {
  const revokedAt = source['revokedAt'];
  return {
    delegationId: delegationId(str(source, 'delegationId', path)),
    delegator: memberId(str(source, 'delegator', path)),
    delegate: memberId(str(source, 'delegate', path)),
    scope: decScope(obj(source, 'scope', path), `${path}.scope`),
    grantedAt: instant(int(source, 'grantedAt', path)),
    expiresAt: instant(int(source, 'expiresAt', path)),
    ...(revokedAt === undefined ? {} : { revokedAt: instant(int(source, 'revokedAt', path)) }),
    grantedSeq: int(source, 'grantedSeq', path),
  };
}

function encDraft(draft: DraftConfig): JsonObject {
  return {
    proposalId: draft.proposalId,
    proposalVersionHash: draft.proposalVersionHash,
    ...(draft.plannedInitiativeId === undefined
      ? {}
      : { plannedInitiativeId: draft.plannedInitiativeId }),
    ...(draft.executionPlanHash === undefined
      ? {}
      : { executionPlanHash: draft.executionPlanHash }),
    summary: draft.summary,
  };
}

function decDraft(source: JsonObject, path: string): DraftConfig {
  const plannedInitiativeId = optStr(source, 'plannedInitiativeId', path);
  const executionPlanHash = optStr(source, 'executionPlanHash', path);
  return {
    proposalId: proposalId(str(source, 'proposalId', path)),
    proposalVersionHash: toHash(str(source, 'proposalVersionHash', path)),
    ...(plannedInitiativeId === undefined
      ? {}
      : { plannedInitiativeId: initiativeId(plannedInitiativeId) }),
    ...(executionPlanHash === undefined ? {} : { executionPlanHash: toHash(executionPlanHash) }),
    summary: str(source, 'summary', path),
  };
}

function memberList(source: JsonObject, key: string, path: string): readonly MemberId[] {
  return strArray(source, key, path).map<MemberId>(memberId);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Payload del evento
// ═════════════════════════════════════════════════════════════════════════════════════════════

const CLOSE_CAUSES: readonly CloseCause[] = [
  'window',
  'early-irreversible',
  'full-turnout',
  'manual',
];
const OUTCOME_KINDS: readonly OutcomeKind[] = [
  'approved',
  'rejected',
  'no-quorum',
  'winner',
  'sample',
  'needs-new-round',
];

/** Cuerpo del payload, SIN la clave `type`: ésa viaja en `eventType` del ledger. */
function encodeBody(payload: DecisionEventPayload): JsonObject {
  switch (payload.type) {
    case 'DecisionDrafted':
      return { draft: encDraft(payload.draft) };
    case 'DecisionOpened':
      return { config: encodeConfig(payload.config) };
    case 'BallotCast':
      return { ballot: encBallot(payload.ballot) };
    case 'BallotVoided':
      return {
        ballotId: payload.ballotId,
        motivation: payload.motivation,
        signers: [...payload.signers],
      };
    case 'DelegationGranted':
      return { delegation: encDelegation(payload.delegation) };
    case 'DelegationRevoked':
      return { delegationId: payload.delegationId, at: payload.at };
    case 'ObjectionRaised':
      return { objection: encObjection(payload.objection), by: payload.by };
    case 'ObjectionAdmitted':
      return {
        objectionId: payload.objectionId,
        panel: [...payload.panel],
        votes: payload.votes,
      };
    case 'ObjectionDismissed':
      return {
        objectionId: payload.objectionId,
        panel: [...payload.panel],
        votes: payload.votes,
        motivation: payload.motivation,
      };
    case 'ObjectionIntegrated':
      return {
        objectionId: payload.objectionId,
        newProposalVersionHash: payload.newProposalVersionHash,
        signedBy: payload.signedBy,
      };
    case 'ObjectionWithdrawn':
      return { objectionId: payload.objectionId };
    case 'RoundOpened':
      return { round: payload.round, proposalVersionHash: payload.proposalVersionHash };
    case 'WindowExtended':
      return { newClosesAt: payload.newClosesAt, reason: payload.reason };
    case 'SeedRevealed':
      return {
        seedAdmin: payload.seedAdmin,
        beaconValue: payload.beaconValue,
        commitment: payload.commitment,
      };
    case 'DecisionClosed':
      return {
        at: payload.at,
        cause: payload.cause,
        ...(payload.signers === undefined ? {} : { signers: [...payload.signers] }),
      };
    case 'ResultComputed':
      return { resultHash: payload.resultHash, outcomeKind: payload.outcomeKind };
    case 'DecisionRatified':
      return {};
    case 'DecisionRejected':
      return { reason: payload.reason };
    case 'DecisionAnnulled':
      return { motivation: payload.motivation, signers: [...payload.signers] };
  }
}

function decodeBody(type: string, body: JsonObject): DecisionEventPayload {
  const path = 'body';
  switch (type) {
    case 'DecisionDrafted':
      return { type, draft: decDraft(obj(body, 'draft', path), `${path}.draft`) };
    case 'DecisionOpened':
      return { type, config: decodeConfig(obj(body, 'config', path), `${path}.config`) };
    case 'BallotCast':
      return { type, ballot: decBallot(obj(body, 'ballot', path), `${path}.ballot`) };
    case 'BallotVoided':
      return {
        type,
        ballotId: ballotId(str(body, 'ballotId', path)),
        motivation: str(body, 'motivation', path),
        signers: memberList(body, 'signers', path),
      };
    case 'DelegationGranted':
      return {
        type,
        delegation: decDelegation(obj(body, 'delegation', path), `${path}.delegation`),
      };
    case 'DelegationRevoked':
      return {
        type,
        delegationId: delegationId(str(body, 'delegationId', path)),
        at: instant(int(body, 'at', path)),
      };
    case 'ObjectionRaised':
      return {
        type,
        objection: decObjection(obj(body, 'objection', path), `${path}.objection`),
        by: memberId(str(body, 'by', path)),
      };
    case 'ObjectionAdmitted':
      return {
        type,
        objectionId: objectionId(str(body, 'objectionId', path)),
        panel: memberList(body, 'panel', path),
        votes: int(body, 'votes', path),
      };
    case 'ObjectionDismissed':
      return {
        type,
        objectionId: objectionId(str(body, 'objectionId', path)),
        panel: memberList(body, 'panel', path),
        votes: int(body, 'votes', path),
        motivation: str(body, 'motivation', path),
      };
    case 'ObjectionIntegrated':
      return {
        type,
        objectionId: objectionId(str(body, 'objectionId', path)),
        newProposalVersionHash: toHash(str(body, 'newProposalVersionHash', path)),
        signedBy: memberId(str(body, 'signedBy', path)),
      };
    case 'ObjectionWithdrawn':
      return { type, objectionId: objectionId(str(body, 'objectionId', path)) };
    case 'RoundOpened':
      return {
        type,
        round: int(body, 'round', path),
        proposalVersionHash: toHash(str(body, 'proposalVersionHash', path)),
      };
    case 'WindowExtended':
      return {
        type,
        newClosesAt: instant(int(body, 'newClosesAt', path)),
        reason: oneOf(str(body, 'reason', path), ['quorum'] as const, `${path}.reason`),
      };
    case 'SeedRevealed':
      return {
        type,
        seedAdmin: str(body, 'seedAdmin', path),
        beaconValue: str(body, 'beaconValue', path),
        commitment: toHash(str(body, 'commitment', path)),
      };
    case 'DecisionClosed': {
      const signers = body['signers'];
      return {
        type,
        at: instant(int(body, 'at', path)),
        cause: oneOf(str(body, 'cause', path), CLOSE_CAUSES, `${path}.cause`),
        ...(signers === undefined ? {} : { signers: memberList(body, 'signers', path) }),
      };
    }
    case 'ResultComputed':
      return {
        type,
        resultHash: toHash(str(body, 'resultHash', path)),
        outcomeKind: oneOf(str(body, 'outcomeKind', path), OUTCOME_KINDS, `${path}.outcomeKind`),
      };
    case 'DecisionRatified':
      return { type };
    case 'DecisionRejected':
      return { type, reason: str(body, 'reason', path) };
    case 'DecisionAnnulled':
      return {
        type,
        motivation: str(body, 'motivation', path),
        signers: memberList(body, 'signers', path),
      };
    default:
      throw new DecisionCodecError('eventType', `${type} no es un evento de decisión conocido`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Evento completo
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Evento de dominio -> borrador del ledger.
 *
 * `actor: 'system'` se traduce **omitiendo** la clave `actor`, no poniéndola a `null`: `{}` y
 * `{"actor":null}` son objetos distintos con hashes distintos, y §1.3.d prohíbe el segundo.
 */
export function encodeDecisionEvent(event: DecisionEvent): LedgerEventDraft {
  const draft: LedgerEventDraft = {
    eventType: event.payload.type,
    eventVersion: DECISION_EVENT_VERSION,
    occurredAt: instantToIso(event.occurredAt),
    ...(event.actor === 'system' ? {} : { actor: event.actor }),
    payload: { eventId: event.eventId, body: encodeBody(event.payload) },
  };
  return draft;
}

/**
 * Evento del ledger -> entrada de dominio.
 *
 * Devuelve un `EventInput`, no un `DecisionEvent`: `seq`, `prevHash` y `hash` los **recomputa**
 * `appendEvent` al rehidratar el log. Almacenarlos y devolverlos permitiría que la copia y el
 * original discreparan sin que nadie lo notara.
 */
export function decodeDecisionEvent(stored: StoredEvent): EventInput {
  const event: CanonicalEvent = stored.event;
  if (event.aggregateType !== DECISION_AGGREGATE_TYPE) {
    throw new DecisionCodecError(
      'aggregateType',
      `${event.aggregateType} no es una decisión: ${DECISION_AGGREGATE_TYPE} esperado`,
    );
  }
  const payload = event.payload;
  const idRaw = payload['eventId'];
  if (typeof idRaw !== 'string') throw new DecisionCodecError('payload.eventId', 'clave ausente');
  const bodyRaw = payload['body'];
  if (!isObject(bodyRaw)) throw new DecisionCodecError('payload.body', 'se esperaba un objeto');

  const id: EventId = eventId(idRaw);
  return {
    eventId: id,
    decisionId: decisionId(event.aggregateId),
    occurredAt: isoToInstant(event.occurredAt),
    actor: event.actor === undefined ? 'system' : memberId(event.actor),
    payload: decodeBody(event.eventType, bodyRaw),
  };
}
