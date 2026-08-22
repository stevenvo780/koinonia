/**
 * Commitments de material privado.
 *
 * El ledger sólo conserva el digest. La apertura —nonce y contenido— vive fuera del dominio
 * público y puede destruirse cuando corresponda. El prefijo fijo y el contexto impiden reutilizar
 * el mismo digest entre propósitos, tareas, ofertas, entregas o visibilidades distintas.
 */

import { sha256Concat, toHex } from '@koinonia/crypto';

import { canonicalBytes } from '../canonical.js';
import { PreconditionError } from '../errors.js';
import {
  type Brand,
  type EventId,
  eventId,
  hash,
  type InitiativeId,
  initiativeId,
  type TaskId,
  taskId,
} from '../ids.js';

export type PrivateMaterialCommitment = Brand<string, 'PrivateMaterialCommitment'>;

export type PrivateMaterialContext =
  | {
      readonly purpose: 'task-block-detail' | 'task-help-detail';
      readonly initiativeId: InitiativeId;
      readonly taskId: TaskId;
      readonly offerId: EventId;
      readonly visibility: 'restricted';
    }
  | {
      readonly purpose: 'task-evidence-object';
      readonly initiativeId: InitiativeId;
      readonly taskId: TaskId;
      readonly offerId: EventId;
      readonly visibility: 'public' | 'restricted';
    }
  | {
      readonly purpose: 'task-delivery-summary';
      readonly initiativeId: InitiativeId;
      readonly taskId: TaskId;
      readonly offerId: EventId;
      readonly deliveryId: EventId;
      readonly visibility: 'restricted';
    }
  | {
      readonly purpose: 'task-change-detail';
      readonly initiativeId: InitiativeId;
      readonly taskId: TaskId;
      readonly offerId: EventId;
      readonly deliveryId: EventId;
      readonly visibility: 'restricted';
    };

export interface CreatePrivateMaterialCommitmentInput {
  /** Exactamente 128 bits aleatorios generados fuera del dominio puro. */
  readonly nonce: Uint8Array;
  readonly context: PrivateMaterialContext;
  /** Texto, objeto o manifest privado; nunca se incorpora al evento. */
  readonly content: unknown;
}

const PREFIX = new TextEncoder().encode('koinonia:private-material:v1\0');

function assertExactKeys(value: object, expected: readonly string[]): void {
  const accepted = new Set(expected);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !accepted.has(key)) {
      throw new PreconditionError(
        'INVALID_PRIVATE_MATERIAL_CONTEXT',
        'el contexto del material privado contiene campos desconocidos',
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new PreconditionError(
        'INVALID_PRIVATE_MATERIAL_CONTEXT',
        'todo campo del contexto debe ser un dato propio y enumerable',
      );
    }
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.value === undefined
    ) {
      throw new PreconditionError(
        'INVALID_PRIVATE_MATERIAL_CONTEXT',
        'el contexto del material privado está incompleto',
      );
    }
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_CONTEXT',
      'los identificadores y códigos del contexto deben ser cadenas canónicas',
    );
  }
  return value;
}

function snapshotPrivateContent(value: unknown): unknown {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new PreconditionError(
        'INVALID_PRIVATE_MATERIAL_CONTENT',
        'los números privados canonicalizables deben ser enteros seguros',
      );
    }
    return value;
  }
  if (value === undefined || value === null) {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_CONTENT',
      'el contenido privado no puede contener null ni undefined',
    );
  }
  if (Array.isArray(value)) {
    const expectedKeys = new Set([
      ...Array.from({ length: value.length }, (_, index) => String(index)),
      'length',
    ]);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !expectedKeys.has(key)) {
        throw new PreconditionError(
          'INVALID_PRIVATE_MATERIAL_CONTENT',
          'el contenido privado contiene propiedades de arreglo no canónicas',
        );
      }
    }
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new PreconditionError(
          'INVALID_PRIVATE_MATERIAL_CONTENT',
          'cada elemento privado debe ser un dato propio y enumerable',
        );
      }
      return snapshotPrivateContent(descriptor.value);
    });
  }
  if (typeof value === 'object') {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PreconditionError(
        'INVALID_PRIVATE_MATERIAL_CONTENT',
        'el contenido privado sólo admite objetos planos',
      );
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== 'string' ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      ) {
        throw new PreconditionError(
          'INVALID_PRIVATE_MATERIAL_CONTENT',
          'el contenido privado sólo admite datos propios y enumerables',
        );
      }
      snapshot[key] = snapshotPrivateContent(descriptor.value);
    }
    return snapshot;
  }
  throw new PreconditionError(
    'INVALID_PRIVATE_MATERIAL_CONTENT',
    'el contenido privado contiene un tipo que no puede canonicalizarse',
  );
}

function validateContext(context: PrivateMaterialContext): PrivateMaterialContext {
  const candidate: unknown = context;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_CONTEXT',
      'el contexto del material privado debe ser un objeto explícito',
    );
  }
  const prototype: unknown = Object.getPrototypeOf(candidate);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_CONTEXT',
      'el contexto del material privado debe ser un objeto plano',
    );
  }
  const record = candidate as Record<string, unknown>;
  const purposeDescriptor = Object.getOwnPropertyDescriptor(candidate, 'purpose');
  if (
    purposeDescriptor === undefined ||
    !purposeDescriptor.enumerable ||
    !('value' in purposeDescriptor)
  ) {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_CONTEXT',
      'el propósito debe ser un dato propio y enumerable',
    );
  }
  const purpose: unknown = purposeDescriptor.value;
  const common = ['purpose', 'initiativeId', 'taskId', 'visibility'] as const;
  if (
    purpose === 'task-block-detail' ||
    purpose === 'task-help-detail' ||
    purpose === 'task-evidence-object'
  ) {
    assertExactKeys(context, [...common, 'offerId']);
    eventId(requiredString(record, 'offerId'));
  } else if (purpose === 'task-delivery-summary') {
    assertExactKeys(context, [...common, 'offerId', 'deliveryId']);
    eventId(requiredString(record, 'offerId'));
    eventId(requiredString(record, 'deliveryId'));
  } else if (purpose === 'task-change-detail') {
    assertExactKeys(context, [...common, 'offerId', 'deliveryId']);
    eventId(requiredString(record, 'offerId'));
    eventId(requiredString(record, 'deliveryId'));
  } else {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_CONTEXT',
      'el propósito del material privado no pertenece al vocabulario cerrado',
    );
  }

  initiativeId(requiredString(record, 'initiativeId'));
  taskId(requiredString(record, 'taskId'));
  const visibility = record['visibility'];
  if (purpose === 'task-evidence-object') {
    if (visibility !== 'public' && visibility !== 'restricted') {
      throw new PreconditionError(
        'INVALID_PRIVATE_MATERIAL_CONTEXT',
        'la evidencia privada exige visibilidad public o restricted',
      );
    }
  } else if (visibility !== 'restricted') {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_CONTEXT',
      'los detalles y resúmenes privados siempre usan visibilidad restricted',
    );
  }
  return context;
}

/**
 * Construye `SHA-256(prefix || nonce128 || JCS({context,content}))`.
 *
 * Es pura respecto de sus entradas: no genera nonce, no lee reloj y no conserva la apertura.
 */
export async function createPrivateMaterialCommitment(
  input: CreatePrivateMaterialCommitmentInput,
): Promise<PrivateMaterialCommitment> {
  if (!(input.nonce instanceof Uint8Array) || input.nonce.byteLength !== 16) {
    throw new PreconditionError(
      'INVALID_PRIVATE_MATERIAL_NONCE',
      'el commitment privado exige exactamente 16 bytes de nonce',
    );
  }
  const context = validateContext(input.context);
  const content = snapshotPrivateContent(input.content);
  const digest = await sha256Concat(PREFIX, input.nonce, canonicalBytes({ context, content }));
  return toPrivateMaterialCommitment(toHex(digest));
}

/** Rehidrata exclusivamente el valor ya persistido; nunca reconstruye ni inventa una apertura. */
export function toPrivateMaterialCommitment(value: string): PrivateMaterialCommitment {
  hash(value);
  return value as PrivateMaterialCommitment;
}
