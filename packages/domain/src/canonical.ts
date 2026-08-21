/**
 * Proyección canónica del dominio hacia JSON hasheable, y hashing.
 *
 * Toda preimagen de hash de esta especificación es `sha256Hex(utf8(jcs(x)))` (A.1.1). Para que eso
 * tenga sentido hay que fijar **qué** es `x`, y las tres reglas obligatorias previas a JCS:
 *
 *  1. todo conjunto se serializa como arreglo ordenado ascendentemente, byte a byte;
 *  2. ningún campo `undefined`: la ausencia se representa **omitiendo la clave**;
 *  3. ningún número con parte fraccionaria; los `bigint` viajan como cadena decimal, de modo que
 *     una `Fraction` se serializa como `{"den":"3","num":"2"}`.
 *
 * `toCanonicalJson` implementa las reglas 2 y 3 de forma genérica y **rechaza** lo que no encaje
 * (`null`, funciones, números fraccionarios, `NaN`). La regla 1 la garantiza cada llamante ordenando
 * sus colecciones antes de proyectarlas: es una propiedad del dato, no de la serialización.
 */

import {
  canonicalizeToBytes,
  type JsonObject,
  type JsonValue,
  LEDGER_PROFILE,
  sha256,
  toHex,
} from '@koinonia/crypto';

import { DomainError } from './errors.js';
import { type Hash, hash as toHash } from './ids.js';

/** Un valor del dominio no es proyectable a la forma canónica del ledger. */
export class NotCanonicalizableError extends DomainError {
  readonly path: string;

  constructor(path: string, detail: string) {
    super('NOT_CANONICALIZABLE', `${path === '' ? '<raíz>' : path}: ${detail}`);
    this.name = 'NotCanonicalizableError';
    this.path = path;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Proyecta un valor del dominio al subconjunto de JSON que el ledger sabe hashear.
 *
 * Rechaza en vez de acomodar: si un valor pudiera serializarse de dos formas por dos
 * implementaciones honestas, aquí se lanza. Acomodar en silencio produce el fallo más caro posible
 * —dos verificadores que discrepan sin que nadie haya hecho nada mal—.
 */
export function toCanonicalJson(value: unknown, path = ''): JsonValue {
  switch (typeof value) {
    case 'string':
      return value;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'number': {
      if (!Number.isSafeInteger(value)) {
        throw new NotCanonicalizableError(
          path,
          `sólo se hashean enteros seguros; ${String(value)} no lo es (A.1.1.3)`,
        );
      }
      return value;
    }
    case 'undefined':
      throw new NotCanonicalizableError(path, 'undefined no se hashea: omití la clave (A.1.1.2)');
    default:
      break;
  }

  if (value === null) {
    throw new NotCanonicalizableError(path, 'null no se hashea: omití la clave (A.1.1.2)');
  }

  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (let i = 0; i < value.length; i++) {
      items.push(toCanonicalJson(value[i], `${path}[${String(i)}]`));
    }
    return items;
  }

  if (isPlainObject(value)) {
    const out: Record<string, JsonValue> = {};
    // Las claves se ordenan dentro de JCS; aquí sólo se filtran las ausentes.
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child === undefined) continue;
      out[key] = toCanonicalJson(child, path === '' ? key : `${path}.${key}`);
    }
    return out;
  }

  throw new NotCanonicalizableError(
    path,
    `tipo no hasheable: ${Object.prototype.toString.call(value)}`,
  );
}

/** `jcs(x)` en bytes UTF-8, con el perfil restringido del ledger. */
export function canonicalBytes(value: unknown): Uint8Array {
  return canonicalizeToBytes(toCanonicalJson(value), LEDGER_PROFILE);
}

/** `sha256Hex(utf8(jcs(x)))` — la definición de «hash» de toda la especificación 30. */
export async function hashCanonical(value: unknown): Promise<Hash> {
  return toHash(toHex(await sha256(canonicalBytes(value))));
}

/** `sha256Hex` de un texto plano. Se usa para el compromiso de la semilla (B.0.3). */
export async function hashText(text: string): Promise<Hash> {
  return toHash(toHex(await sha256(new TextEncoder().encode(text))));
}

/** Reexporta el tipo de objeto JSON para los constructores de preimágenes. */
export type { JsonObject, JsonValue };

/**
 * Congelación profunda. `readonly` es una promesa del compilador; `Object.freeze` es un hecho de
 * tiempo de ejecución. La `DecisionConfig` es «las reglas del juego» y no puede mutar después de
 * que su hash se publicó, ni siquiera por accidente desde JavaScript sin tipos.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
