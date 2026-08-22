/**
 * Tipos de marca (*branded types*) e identificadores del dominio.
 *
 * ═══ Por qué 32 caracteres hexadecimales en minúscula y no UUID ═══
 *
 * Resolución R2 del arquitecto: **ningún valor que entre en una preimagen de hash puede vivir en un
 * tipo que normalice su representación.** La columna `uuid` de PostgreSQL devuelve la forma con
 * guiones (`8-4-4-4-12`) independientemente de cómo se insertó; si el `MemberId` viviera en esa
 * columna, el padrón hasheado por el servidor y el padrón hasheado por quien audita diferirían por
 * cuatro guiones, y el sistema se acusaría a sí mismo de manipulación. Un `char(32)` de hexadecimal
 * en minúscula tiene **una sola** representación posible y sobrevive a cualquier motor de base de
 * datos, a cualquier driver y a cualquier serializador.
 *
 * ═══ Por qué el `MemberId` es aleatorio ═══
 *
 * DECISIÓN A.0 corregida por R1: 128 bits de CSPRNG, **jamás derivados** de la cédula, del correo
 * ni de ningún otro dato personal. Un identificador derivado es re-derivable por cualquiera que
 * tenga el dato de origen, lo que sobre un espacio de ~300 personas permite confirmar pertenencia
 * por diccionario y vuelve ficticio el borrado. El dominio no conoce nombres ni correos: sólo
 * identificadores opacos. **En este paquete no hay ni un solo campo de datos personales.**
 *
 * La generación ocurre fuera: el dominio no puede producir aleatoriedad (ver `../README` y
 * `scripts/check-domain-purity.mjs`). Aquí sólo se **valida la forma**.
 */

import { InvalidIdError } from './errors.js';

/**
 * Marca nominal. El campo no existe en tiempo de ejecución; sirve para que `MemberId` y `DecisionId`
 * no sean intercambiables aunque ambos sean `string`.
 */
export type Brand<T, B extends string> = T & { readonly __marca: B };

/** Identificador seudónimo estable de una persona. NO es la cédula ni el correo (R1). */
export type MemberId = Brand<string, 'MemberId'>;
export type CircleId = Brand<string, 'CircleId'>;
/** Etiqueta temática, para resolver delegaciones por tema (PARTE C). */
export type TopicId = Brand<string, 'TopicId'>;
export type DecisionId = Brand<string, 'DecisionId'>;
export type ProposalId = Brand<string, 'ProposalId'>;
export type InitiativeId = Brand<string, 'InitiativeId'>;
export type MilestoneId = Brand<string, 'MilestoneId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type OptionId = Brand<string, 'OptionId'>;
export type BallotId = Brand<string, 'BallotId'>;
export type EventId = Brand<string, 'EventId'>;
export type DelegationId = Brand<string, 'DelegationId'>;
export type ObjectionId = Brand<string, 'ObjectionId'>;

/** Clave de estrato (`semestre`, `jornada`…). Es una etiqueta, no un identificador opaco. */
export type StratumKey = Brand<string, 'StratumKey'>;
export type StratumValue = Brand<string, 'StratumValue'>;

/** SHA-256 en hexadecimal minúscula, 64 caracteres. */
export type Hash = Brand<string, 'Hash'>;

/**
 * Milisegundos desde el epoch UTC. Lo asigna **siempre** el servidor en el punto de serialización
 * (DECISIÓN D.3.c), nunca el cliente y nunca el dominio: aquí el instante entra como dato.
 */
export type Instant = Brand<number, 'Instant'>;

/** 128 bits en hexadecimal minúscula. Es la forma de todo identificador opaco del sistema. */
export const ID_PATTERN = /^[0-9a-f]{32}$/u;
/** 256 bits en hexadecimal minúscula. */
export const HASH_PATTERN = /^[0-9a-f]{64}$/u;
/**
 * Etiquetas de estrato: minúsculas ASCII, dígitos y guion bajo. Sin espacios, acentos ni guiones.
 *
 * No es purismo: una `StratumKey` acaba siendo una **clave de objeto** dentro de una preimagen de
 * hash, y el perfil canónico del ledger sólo admite claves `^[A-Za-z][A-Za-z0-9_]*$`. Una etiqueta
 * con guion produciría una configuración imposible de hashear **después** de haberse aceptado.
 */
export const LABEL_PATTERN = /^[a-z][a-z0-9_]{0,31}$/u;

/** Longitud, en caracteres, de un identificador opaco. */
export const ID_LENGTH = 32;

/** El hash de 64 ceros: `prevHash` del primer evento de cualquier decisión (A.7). */
export const ZERO_HASH = '0'.repeat(64) as Hash;

function assertPattern(kind: string, value: string, pattern: RegExp, expected: string): void {
  if (!pattern.test(value)) throw new InvalidIdError(kind, value, expected);
}

const OPAQUE = '32 caracteres hexadecimales en minúscula';

export function memberId(value: string): MemberId {
  assertPattern('MemberId', value, ID_PATTERN, OPAQUE);
  return value as MemberId;
}

export function circleId(value: string): CircleId {
  assertPattern('CircleId', value, ID_PATTERN, OPAQUE);
  return value as CircleId;
}

export function topicId(value: string): TopicId {
  assertPattern('TopicId', value, ID_PATTERN, OPAQUE);
  return value as TopicId;
}

export function decisionId(value: string): DecisionId {
  assertPattern('DecisionId', value, ID_PATTERN, OPAQUE);
  return value as DecisionId;
}

export function proposalId(value: string): ProposalId {
  assertPattern('ProposalId', value, ID_PATTERN, OPAQUE);
  return value as ProposalId;
}

export function initiativeId(value: string): InitiativeId {
  assertPattern('InitiativeId', value, ID_PATTERN, OPAQUE);
  return value as InitiativeId;
}

export function milestoneId(value: string): MilestoneId {
  assertPattern('MilestoneId', value, ID_PATTERN, OPAQUE);
  return value as MilestoneId;
}

export function taskId(value: string): TaskId {
  assertPattern('TaskId', value, ID_PATTERN, OPAQUE);
  return value as TaskId;
}

export function optionId(value: string): OptionId {
  assertPattern('OptionId', value, ID_PATTERN, OPAQUE);
  return value as OptionId;
}

export function ballotId(value: string): BallotId {
  assertPattern('BallotId', value, ID_PATTERN, OPAQUE);
  return value as BallotId;
}

export function eventId(value: string): EventId {
  assertPattern('EventId', value, ID_PATTERN, OPAQUE);
  return value as EventId;
}

export function delegationId(value: string): DelegationId {
  assertPattern('DelegationId', value, ID_PATTERN, OPAQUE);
  return value as DelegationId;
}

export function objectionId(value: string): ObjectionId {
  assertPattern('ObjectionId', value, ID_PATTERN, OPAQUE);
  return value as ObjectionId;
}

export function stratumKey(value: string): StratumKey {
  assertPattern('StratumKey', value, LABEL_PATTERN, 'una etiqueta [a-z][a-z0-9_]{0,31}');
  return value as StratumKey;
}

export function stratumValue(value: string): StratumValue {
  assertPattern('StratumValue', value, LABEL_PATTERN, 'una etiqueta [a-z][a-z0-9_]{0,31}');
  return value as StratumValue;
}

export function hash(value: string): Hash {
  assertPattern('Hash', value, HASH_PATTERN, '64 caracteres hexadecimales en minúscula');
  return value as Hash;
}

/**
 * Un instante válido: entero, no negativo y dentro del rango seguro de IEEE-754.
 *
 * El límite inferior no es cosmético: el perfil canónico del ledger rechaza números fraccionarios,
 * y un `Instant` con decimales produciría un evento no hasheable **después** de haberse aceptado.
 */
export function instant(value: number): Instant {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidIdError(
      'Instant',
      String(value),
      'un entero seguro no negativo (ms desde el epoch UTC)',
    );
  }
  return value as Instant;
}

export function isMemberId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function isHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

/**
 * Orden total estricto **byte a byte** sobre identificadores.
 *
 * DECISIÓN A.0.b: prohibido `localeCompare`, que depende de ICU y de la locale del proceso. Como
 * todo identificador es ASCII, comparar unidades de código UTF-16 con `<` es exactamente comparar
 * los bytes del UTF-8, que es lo que exige A.1.1.1.
 */
export function compareIds(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Copia ordenada ascendentemente. No muta la entrada. */
export function sortIds<T extends string>(values: readonly T[]): readonly T[] {
  return [...values].sort(compareIds);
}

/** ¿La secuencia está estrictamente ordenada (ordenada y sin duplicados)? */
export function isStrictlySorted(values: readonly string[]): boolean {
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined) return false;
    if (compareIds(previous, current) !== -1) return false;
  }
  return true;
}
