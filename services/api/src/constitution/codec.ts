/**
 * Codec entre los eventos de la constitución digital y los eventos del ledger.
 *
 * ═══ Explícito, campo a campo, y el decodificador valida ═══
 *
 * Mismo principio que `decision/codec.ts` y `workspace/codec.ts`, por el mismo motivo y con una
 * razón añadida que aquí es más fuerte que en ningún otro agregado: **este payload transporta
 * fracciones exactas**. `approvalOfCensus` es `2/3` en `bigint`, no `0.667`, y un serializador
 * genérico tendría que inventarse una convención para los `bigint` —un sufijo `n`, un objeto
 * `{"$bigint":…}`, un número JSON— que o bien introduce claves fuera del perfil canónico
 * (`^[A-Za-z][A-Za-z0-9_]*$`) o bien pierde exactitud por encima de 2^53 sin avisar. Un umbral que
 * pierde exactitud al ir y volver es una reforma que se aprueba o se rechaza según qué servidor la
 * relea. Aquí cada campo se escribe y se lee a mano, los `bigint` viajan como cadena decimal
 * (A.1.1.3) y un payload que no encaje **se rechaza en vez de acomodarse**.
 *
 * ═══ Lo que NO se almacena ═══
 *
 * `seq`, `prevHash` y `hash` del dominio son función del resto y se recomputan al rehidratar con
 * `appendChained`. Guardarlos permitiría que la copia y el original discreparan sin que nadie lo
 * notara.
 *
 * ═══ Lo que NO viaja en el payload: la prosa ═══
 *
 * Una cláusula es el par `(clauseId, textHash)` y el texto normativo **no está aquí**. No es ahorro
 * de espacio: es que guardar texto y huella a la vez añade una forma de mentir —declarar una huella
 * que no corresponde al texto— sin añadir ninguna garantía (ADR-0051). El texto vive en
 * `governance.clause_text`, direccionado por su propia huella, y `text-store.ts` lo recomputa al
 * leerlo. Si alguna vez alguien mete la prosa en este payload, habrá dos fuentes de verdad para el
 * mismo hecho y podrán discrepar.
 */

import type { CanonicalEvent, JsonObject, JsonValue } from '@koinonia/crypto';
import {
  type ChainedEvent,
  type ChainedInput,
  type Clause,
  type ClauseId,
  clauseId as toClauseId,
  type ConstitutionPayload,
  type ConstitutionText,
  type ConvenedDecision,
  decisionId as toDecisionId,
  eventId as toEventId,
  type Fraction,
  fraction,
  type FrozenReformRules,
  hash as toHash,
  instant,
  type MemberId,
  memberId as toMemberId,
  REFORM_KINDS,
  REFORM_REJECTION_REASONS,
  type ReformCalendar,
  reformId as toReformId,
  type ReformKind,
  type ReformRejectionReason,
  type ReformRequirements,
  type ReformVote,
} from '@koinonia/domain';

import { instantToIso, isoToInstant } from '../decision/codec.js';
import type { LedgerEventDraft, StoredEvent } from '../ledger/types.js';

/** Tipo de agregado en el ledger. Cumple `^#?[a-z][a-z0-9_]*$`. */
export const CONSTITUTION_AGGREGATE_TYPE = 'constitution';

/** Versión del formato del payload. Subirla obliga a escribir el migrador de lectura. */
export const CONSTITUTION_EVENT_VERSION = 1;

export class ConstitutionCodecError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path === '' ? '<payload>' : path}: ${detail}`);
    this.name = 'ConstitutionCodecError';
    this.path = path;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectores validadores
// ═════════════════════════════════════════════════════════════════════════════════════════════

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ni una clave de más ni una de menos.
 *
 * La estrictez no es celo: una clave desconocida que el decodificador ignorara desaparecería al
 * reescribir el evento, y una clave ausente que se rellenara con un valor por defecto aparecería de
 * la nada. Las dos producen un evento que se pliega distinto del que se escribió.
 */
function assertExactKeys(source: JsonObject, expected: readonly string[], path: string): void {
  const wanted = new Set(expected);
  const unknown = Object.keys(source).find((key) => !wanted.has(key));
  if (unknown !== undefined) {
    throw new ConstitutionCodecError(`${path}.${unknown}`, 'campo desconocido o prohibido');
  }
  const missing = expected.find((key) => !Object.prototype.hasOwnProperty.call(source, key));
  if (missing !== undefined) {
    throw new ConstitutionCodecError(`${path}.${missing}`, 'clave ausente');
  }
}

function str(source: JsonObject, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new ConstitutionCodecError(`${path}.${key}`, 'se esperaba texto');
  }
  return value;
}

function int(source: JsonObject, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ConstitutionCodecError(`${path}.${key}`, 'se esperaba un entero seguro');
  }
  return value;
}

function obj(source: JsonObject, key: string, path: string): JsonObject {
  const value = source[key];
  if (!isObject(value)) {
    throw new ConstitutionCodecError(`${path}.${key}`, 'se esperaba un objeto');
  }
  return value;
}

function arr(source: JsonObject, key: string, path: string): readonly JsonValue[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new ConstitutionCodecError(`${path}.${key}`, 'se esperaba un arreglo');
  }
  return value as readonly JsonValue[];
}

function stringArray(source: JsonObject, key: string, path: string): readonly string[] {
  return arr(source, key, path).map((value, index) => {
    if (typeof value !== 'string') {
      throw new ConstitutionCodecError(`${path}.${key}[${String(index)}]`, 'se esperaba texto');
    }
    return value;
  });
}

function objectArray(source: JsonObject, key: string, path: string): readonly JsonObject[] {
  return arr(source, key, path).map((value, index) => {
    if (!isObject(value)) {
      throw new ConstitutionCodecError(`${path}.${key}[${String(index)}]`, 'se esperaba un objeto');
    }
    return value;
  });
}

function oneOf<T extends string>(value: string, allowed: readonly T[], path: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ConstitutionCodecError(path, `${value} no está en {${allowed.join(', ')}}`);
  }
  return value as T;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Fracciones exactas
// ═════════════════════════════════════════════════════════════════════════════════════════════

const DECIMAL = /^\d+$/u;

function encFraction(value: Fraction): JsonObject {
  return { num: value.num.toString(), den: value.den.toString() };
}

function decFraction(source: JsonObject, key: string, path: string): Fraction {
  const where = `${path}.${key}`;
  const raw = obj(source, key, path);
  assertExactKeys(raw, ['num', 'den'], where);
  const num = str(raw, 'num', where);
  const den = str(raw, 'den', where);
  if (!DECIMAL.test(num) || !DECIMAL.test(den)) {
    // Cadena decimal y no número JSON: por encima de 2^53 un número pierde exactitud sin avisar, y
    // el umbral con el que se juzga una reforma es lo último que puede perder exactitud.
    throw new ConstitutionCodecError(where, 'num y den son cadenas decimales, no números');
  }
  return fraction(BigInt(num), BigInt(den));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Piezas del texto versionado
// ═════════════════════════════════════════════════════════════════════════════════════════════

const CLAUSE_KEYS = ['clauseId', 'textHash'] as const;

function encClause(clause: Clause): JsonObject {
  return { clauseId: clause.clauseId, textHash: clause.textHash };
}

function decClause(source: JsonObject, path: string): Clause {
  assertExactKeys(source, CLAUSE_KEYS, path);
  return {
    clauseId: toClauseId(str(source, 'clauseId', path)),
    textHash: toHash(str(source, 'textHash', path)),
  };
}

function encClauses(clauses: readonly Clause[]): readonly JsonObject[] {
  return clauses.map(encClause);
}

function decClauses(source: JsonObject, key: string, path: string): readonly Clause[] {
  return objectArray(source, key, path).map((raw, index) =>
    decClause(raw, `${path}.${key}[${String(index)}]`),
  );
}

const REQUIREMENTS_KEYS = [
  'approvalOfCensus',
  'minDirectParticipation',
  'deliberationDays',
  'waitingDays',
  'guaranteeThreshold',
  'guaranteeCircleSize',
  'votesRequired',
  'separationMonths',
  'sponsorSignatures',
] as const;

function encRequirements(requirements: ReformRequirements): JsonObject {
  return {
    approvalOfCensus: encFraction(requirements.approvalOfCensus),
    minDirectParticipation: encFraction(requirements.minDirectParticipation),
    deliberationDays: requirements.deliberationDays,
    waitingDays: requirements.waitingDays,
    guaranteeThreshold: requirements.guaranteeThreshold,
    guaranteeCircleSize: requirements.guaranteeCircleSize,
    votesRequired: requirements.votesRequired,
    separationMonths: requirements.separationMonths,
    sponsorSignatures: encFraction(requirements.sponsorSignatures),
  };
}

function decRequirements(source: JsonObject, key: string, path: string): ReformRequirements {
  const where = `${path}.${key}`;
  const raw = obj(source, key, path);
  assertExactKeys(raw, REQUIREMENTS_KEYS, where);
  return {
    approvalOfCensus: decFraction(raw, 'approvalOfCensus', where),
    minDirectParticipation: decFraction(raw, 'minDirectParticipation', where),
    deliberationDays: int(raw, 'deliberationDays', where),
    waitingDays: int(raw, 'waitingDays', where),
    guaranteeThreshold: int(raw, 'guaranteeThreshold', where),
    guaranteeCircleSize: int(raw, 'guaranteeCircleSize', where),
    votesRequired: int(raw, 'votesRequired', where),
    separationMonths: int(raw, 'separationMonths', where),
    sponsorSignatures: decFraction(raw, 'sponsorSignatures', where),
  };
}

const TEXT_KEYS = ['clauses', 'ordinary', 'entrenched', 'validityMonths'] as const;

function encText(text: ConstitutionText): JsonObject {
  return {
    clauses: [...encClauses(text.clauses)],
    ordinary: encRequirements(text.ordinary),
    entrenched: encRequirements(text.entrenched),
    validityMonths: text.validityMonths,
  };
}

function decText(source: JsonObject, key: string, path: string): ConstitutionText {
  const where = `${path}.${key}`;
  const raw = obj(source, key, path);
  assertExactKeys(raw, TEXT_KEYS, where);
  return {
    clauses: decClauses(raw, 'clauses', where),
    ordinary: decRequirements(raw, 'ordinary', where),
    entrenched: decRequirements(raw, 'entrenched', where),
    validityMonths: int(raw, 'validityMonths', where),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La copia congelada
// ═════════════════════════════════════════════════════════════════════════════════════════════

const CONVENED_KEYS = ['decisionId', 'opensAt', 'affectsClauseIds'] as const;

function encConvened(decision: ConvenedDecision): JsonObject {
  return {
    decisionId: decision.decisionId,
    opensAt: decision.opensAt,
    affectsClauseIds: [...decision.affectsClauseIds],
  };
}

function decConvened(source: JsonObject, path: string): ConvenedDecision {
  assertExactKeys(source, CONVENED_KEYS, path);
  return {
    decisionId: toDecisionId(str(source, 'decisionId', path)),
    opensAt: instant(int(source, 'opensAt', path)),
    affectsClauseIds: stringArray(source, 'affectsClauseIds', path).map<ClauseId>(toClauseId),
  };
}

const CALENDAR_KEYS = ['semesterEndsAt', 'convened'] as const;

function encCalendar(calendar: ReformCalendar): JsonObject {
  return {
    semesterEndsAt: calendar.semesterEndsAt,
    convened: calendar.convened.map(encConvened),
  };
}

function decCalendar(source: JsonObject, key: string, path: string): ReformCalendar {
  const where = `${path}.${key}`;
  const raw = obj(source, key, path);
  assertExactKeys(raw, CALENDAR_KEYS, where);
  return {
    semesterEndsAt: instant(int(raw, 'semesterEndsAt', where)),
    convened: objectArray(raw, 'convened', where).map((entry, index) =>
      decConvened(entry, `${where}.convened[${String(index)}]`),
    ),
  };
}

const FROZEN_KEYS = ['requirements', 'censusSize', 'guarantors', 'calendar'] as const;

function encFrozen(frozen: FrozenReformRules): JsonObject {
  return {
    requirements: encRequirements(frozen.requirements),
    censusSize: frozen.censusSize,
    guarantors: [...frozen.guarantors],
    calendar: encCalendar(frozen.calendar),
  };
}

function decFrozen(source: JsonObject, key: string, path: string): FrozenReformRules {
  const where = `${path}.${key}`;
  const raw = obj(source, key, path);
  assertExactKeys(raw, FROZEN_KEYS, where);
  return {
    requirements: decRequirements(raw, 'requirements', where),
    censusSize: int(raw, 'censusSize', where),
    guarantors: stringArray(raw, 'guarantors', where).map<MemberId>(toMemberId),
    calendar: decCalendar(raw, 'calendar', where),
  };
}

const VOTE_KEYS = [
  'round',
  'decisionId',
  'votesInFavor',
  'directParticipation',
  'opensAt',
  'closesAt',
] as const;

function encVote(vote: ReformVote): JsonObject {
  return {
    round: vote.round,
    decisionId: vote.decisionId,
    votesInFavor: vote.votesInFavor,
    directParticipation: vote.directParticipation,
    opensAt: vote.opensAt,
    closesAt: vote.closesAt,
  };
}

function decVote(source: JsonObject, key: string, path: string): ReformVote {
  const where = `${path}.${key}`;
  const raw = obj(source, key, path);
  assertExactKeys(raw, VOTE_KEYS, where);
  return {
    round: int(raw, 'round', where),
    decisionId: toDecisionId(str(raw, 'decisionId', where)),
    votesInFavor: int(raw, 'votesInFavor', where),
    directParticipation: int(raw, 'directParticipation', where),
    opensAt: instant(int(raw, 'opensAt', where)),
    closesAt: instant(int(raw, 'closesAt', where)),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Cuerpo del evento
// ═════════════════════════════════════════════════════════════════════════════════════════════

const BODY_KEYS = {
  ConstitutionFounded: [
    'version',
    'text',
    'core',
    'foundingDecisionId',
    'censusSize',
    'votesInFavor',
    'castBallots',
    'directParticipation',
    'effectiveAt',
  ],
  ReformOpened: [
    'reformId',
    'kind',
    'targetVersion',
    'proposedText',
    'frozen',
    'sponsorCount',
    'deliberationOpensAt',
    'deliberationClosesAt',
  ],
  ReformVoteRecorded: ['reformId', 'vote'],
  ReformApprovedByGuarantor: ['reformId', 'guarantorId'],
  ReformRatified: ['reformId', 'version', 'effectiveAt'],
  ReformRejected: ['reformId', 'reason'],
} satisfies Readonly<Record<ConstitutionPayload['type'], readonly string[]>>;

function assertBodyKeys(type: string, body: JsonObject): void {
  // La tabla sigue siendo exhaustiva por el `satisfies`; esta vista más ancha expresa que el
  // discriminante llega de JSON hostil y puede no ser una de sus claves.
  const expected = (BODY_KEYS as Readonly<Record<string, readonly string[] | undefined>>)[type];
  if (expected === undefined) {
    throw new ConstitutionCodecError('eventType', `${type} no es un evento de la constitución`);
  }
  assertExactKeys(body, expected, type);
}

function encodeBody(payload: ConstitutionPayload): JsonObject {
  switch (payload.type) {
    case 'ConstitutionFounded':
      return {
        version: payload.version,
        text: encText(payload.text),
        core: [...encClauses(payload.core)],
        foundingDecisionId: payload.foundingDecisionId,
        censusSize: payload.censusSize,
        votesInFavor: payload.votesInFavor,
        castBallots: payload.castBallots,
        directParticipation: payload.directParticipation,
        effectiveAt: payload.effectiveAt,
      };
    case 'ReformOpened':
      return {
        reformId: payload.reformId,
        kind: payload.kind,
        targetVersion: payload.targetVersion,
        proposedText: encText(payload.proposedText),
        frozen: encFrozen(payload.frozen),
        sponsorCount: payload.sponsorCount,
        deliberationOpensAt: payload.deliberationOpensAt,
        deliberationClosesAt: payload.deliberationClosesAt,
      };
    case 'ReformVoteRecorded':
      return { reformId: payload.reformId, vote: encVote(payload.vote) };
    case 'ReformApprovedByGuarantor':
      return { reformId: payload.reformId, guarantorId: payload.guarantorId };
    case 'ReformRatified':
      return {
        reformId: payload.reformId,
        version: payload.version,
        effectiveAt: payload.effectiveAt,
      };
    case 'ReformRejected':
      return { reformId: payload.reformId, reason: payload.reason };
  }
}

function decodeBody(type: string, body: JsonObject): ConstitutionPayload {
  assertBodyKeys(type, body);
  switch (type) {
    case 'ConstitutionFounded':
      return {
        type,
        version: int(body, 'version', type),
        text: decText(body, 'text', type),
        core: decClauses(body, 'core', type),
        foundingDecisionId: toDecisionId(str(body, 'foundingDecisionId', type)),
        censusSize: int(body, 'censusSize', type),
        votesInFavor: int(body, 'votesInFavor', type),
        castBallots: int(body, 'castBallots', type),
        directParticipation: int(body, 'directParticipation', type),
        effectiveAt: instant(int(body, 'effectiveAt', type)),
      };
    case 'ReformOpened':
      return {
        type,
        reformId: toReformId(str(body, 'reformId', type)),
        kind: oneOf<ReformKind>(str(body, 'kind', type), REFORM_KINDS, `${type}.kind`),
        targetVersion: int(body, 'targetVersion', type),
        proposedText: decText(body, 'proposedText', type),
        frozen: decFrozen(body, 'frozen', type),
        sponsorCount: int(body, 'sponsorCount', type),
        deliberationOpensAt: instant(int(body, 'deliberationOpensAt', type)),
        deliberationClosesAt: instant(int(body, 'deliberationClosesAt', type)),
      };
    case 'ReformVoteRecorded':
      return {
        type,
        reformId: toReformId(str(body, 'reformId', type)),
        vote: decVote(body, 'vote', type),
      };
    case 'ReformApprovedByGuarantor':
      return {
        type,
        reformId: toReformId(str(body, 'reformId', type)),
        guarantorId: toMemberId(str(body, 'guarantorId', type)),
      };
    case 'ReformRatified':
      return {
        type,
        reformId: toReformId(str(body, 'reformId', type)),
        version: int(body, 'version', type),
        effectiveAt: instant(int(body, 'effectiveAt', type)),
      };
    case 'ReformRejected':
      return {
        type,
        reformId: toReformId(str(body, 'reformId', type)),
        reason: oneOf<ReformRejectionReason>(
          str(body, 'reason', type),
          REFORM_REJECTION_REASONS,
          `${type}.reason`,
        ),
      };
    default:
      throw new ConstitutionCodecError('eventType', `${type} no es un evento de la constitución`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Frontera
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Evento de dominio → borrador del ledger.
 *
 * `actor: 'system'` se traduce **omitiendo** la clave `actor`, jamás poniéndola a `null`: `{}` y
 * `{"actor":null}` son objetos distintos con huellas distintas, y §1.3.d prohíbe el segundo. En
 * este agregado la omisión no debería ocurrir nunca —`applyConstitution` rechaza al sistema como
 * actor con `SYSTEM_CANNOT_GOVERN`, porque ningún acto de gobierno es un automatismo—, pero el
 * codec no es el sitio donde se decide eso.
 */
export function encodeConstitutionEvent(
  event: ChainedEvent<ConstitutionPayload>,
): LedgerEventDraft {
  return {
    eventType: event.payload.type,
    eventVersion: CONSTITUTION_EVENT_VERSION,
    occurredAt: instantToIso(event.occurredAt),
    ...(event.actor === 'system' ? {} : { actor: event.actor }),
    payload: { eventId: event.eventId, body: encodeBody(event.payload) },
  };
}

/**
 * Evento del ledger → entrada de dominio.
 *
 * Devuelve un `ChainedInput`: `seq`, `prevHash` y `hash` los **recomputa** `appendChained` al
 * rehidratar el log. Y el `actor` vuelve del sobre, que es lo que permite que el pliegue reejecute
 * la autorización al releer —`ReformApprovedByGuarantor` exige que el sobre y el cuerpo nombren a
 * la misma persona— en vez de limitarse a recomputar una huella.
 */
export function decodeConstitutionEvent(stored: StoredEvent): ChainedInput<ConstitutionPayload> {
  const event: CanonicalEvent = stored.event;
  if (event.aggregateType !== CONSTITUTION_AGGREGATE_TYPE) {
    throw new ConstitutionCodecError(
      'aggregateType',
      `${event.aggregateType} no es ${CONSTITUTION_AGGREGATE_TYPE}`,
    );
  }
  const idRaw = event.payload['eventId'];
  if (typeof idRaw !== 'string') {
    throw new ConstitutionCodecError('payload.eventId', 'clave ausente');
  }
  const bodyRaw = event.payload['body'];
  if (!isObject(bodyRaw)) {
    throw new ConstitutionCodecError('payload.body', 'se esperaba un objeto');
  }
  assertExactKeys(event.payload, ['eventId', 'body'], 'payload');
  return {
    eventId: toEventId(idRaw),
    aggregateId: event.aggregateId,
    occurredAt: isoToInstant(event.occurredAt),
    actor: event.actor === undefined ? 'system' : toMemberId(event.actor),
    payload: decodeBody(event.eventType, bodyRaw),
  };
}
