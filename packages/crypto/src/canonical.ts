/**
 * Canonicalización JSON (JCS, RFC 8785) — el cimiento de la verificación de Koinonía.
 *
 * El hash de un evento no se calcula sobre "el evento": se calcula sobre **una secuencia concreta
 * de bytes**. JSON admite infinitas secuencias de bytes para el mismo valor lógico. Este módulo fija
 * una y sólo una. Si dos serializaciones del mismo objeto pudieran diferir, la verificación entera
 * se rompe (`docs/research/10-ledger-inmutable.md` §1.2).
 *
 * Reglas implementadas:
 *  - claves de objeto ordenadas ascendentemente por **unidades de código UTF-16** (§1.3.c);
 *  - sin espacio en blanco de ningún tipo;
 *  - escapado de cadenas idéntico al de `JSON.stringify` de ECMAScript (RFC 8785 §3.2.2.2);
 *  - números: sólo enteros seguros en el perfil del ledger (§1.3.a);
 *  - salida UTF-8 sin BOM.
 *
 * Y, sobre todo, **rechaza en vez de acomodar**: ante cualquier valor cuya representación canónica
 * pudiera ser ambigua entre dos implementaciones honestas, este módulo lanza un error. Acomodar
 * silenciosamente es lo que produce el fallo más caro del sistema: dos verificadores que discrepan
 * sin que nadie haya hecho nada mal.
 *
 * DECISIÓN: la spec (§1.3.b) exige normalización NFC "en el borde de entrada" y dice explícitamente
 * que el canonicalizador **no** normaliza (normalizar aquí alteraría el dato después de que el
 * usuario lo aprobó). El enunciado de la tarea, en cambio, pedía "normalización NFC" en este módulo.
 * Se resuelve sin contradecir a ninguno de los dos: el canonicalizador **verifica** NFC y rechaza lo
 * que no lo esté (`NOT_NFC`), y la normalización propiamente dicha se expone aparte, en `toNfc()`,
 * para que la aplique la capa de entrada. Así NFC vive en este paquete, pero nunca muta un dato ya
 * hasheable.
 */

/** Un valor JSON. `null` es representable por el tipo, pero el perfil del ledger lo rechaza. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type CanonicalErrorCode =
  | 'NOT_FINITE'
  | 'FRACTIONAL_NUMBER'
  | 'UNSAFE_INTEGER'
  | 'NEGATIVE_ZERO'
  | 'NULL_FORBIDDEN'
  | 'UNDEFINED_FORBIDDEN'
  | 'UNSUPPORTED_TYPE'
  | 'SYMBOL_KEY'
  | 'CIRCULAR'
  | 'KEY_PATTERN'
  | 'NOT_NFC'
  | 'CONTROL_CHAR'
  | 'LONE_SURROGATE'
  | 'NONCHARACTER'
  | 'BYTE_ORDER_MARK'
  | 'MAX_DEPTH'
  | 'NOT_CANONICAL';

/** Fallo de canonicalización. Siempre indica el código y la ruta exacta dentro del valor. */
export class CanonicalizationError extends Error {
  readonly code: CanonicalErrorCode;
  readonly path: string;

  constructor(code: CanonicalErrorCode, path: string, detail: string) {
    super(`[${code}] ${path === '' ? '<raíz>' : path}: ${detail}`);
    this.name = 'CanonicalizationError';
    this.code = code;
    this.path = path;
  }
}

export interface CanonicalProfile {
  readonly name: string;
  /** `null` como valor. El ledger lo prohíbe: la ausencia se expresa omitiendo la clave (§1.3.d). */
  readonly allowNull: boolean;
  /** Números con parte fraccionaria y enteros fuera del rango seguro IEEE-754 (§1.3.a). */
  readonly allowFractionalNumbers: boolean;
  /** `-0`. ECMAScript lo serializa como `0`; el ledger prefiere rechazarlo (§1.3.d). */
  readonly rejectNegativeZero: boolean;
  /** Restricción de claves. `null` = cualquier cadena válida. */
  readonly keyPattern: RegExp | null;
  readonly requireNfc: boolean;
  /** Puntos de código de control admitidos, o `'all'` para no restringir. */
  readonly allowedControlCodePoints: ReadonlySet<number> | 'all';
  readonly rejectNoncharacters: boolean;
  readonly rejectByteOrderMark: boolean;
  readonly rejectLoneSurrogates: boolean;
  readonly maxDepth: number;
}

/**
 * Perfil del ledger: el subconjunto restringido de JSON del ADR-126.
 *
 * DECISIÓN: la spec dice "se rechazan caracteres de control" sin excepciones, pero una plataforma de
 * deliberación necesita texto multilínea (una propuesta, una objeción). Se admiten U+0009 y U+000A y
 * se rechaza U+000D: CRLF frente a LF es exactamente la misma clase de problema que NFC —dos textos
 * que se ven idénticos y hashean distinto según el sistema operativo del autor—. El borde de entrada
 * normaliza los finales de línea a LF junto con NFC (`toLedgerText`).
 */
export const LEDGER_PROFILE: CanonicalProfile = {
  name: 'ledger',
  allowNull: false,
  allowFractionalNumbers: false,
  rejectNegativeZero: true,
  keyPattern: /^[A-Za-z][A-Za-z0-9_]*$/,
  requireNfc: true,
  allowedControlCodePoints: new Set([0x09, 0x0a]),
  rejectNoncharacters: true,
  rejectByteOrderMark: true,
  rejectLoneSurrogates: true,
  maxDepth: 64,
};

/**
 * Perfil RFC 8785 puro: JSON completo, sin las restricciones de dominio de Koinonía.
 * Existe para poder correr los vectores de prueba oficiales del RFC, que contienen `null` y
 * flotantes. **No se usa para hashear nada del ledger.**
 */
export const RFC8785_PROFILE: CanonicalProfile = {
  name: 'rfc8785',
  allowNull: true,
  allowFractionalNumbers: true,
  rejectNegativeZero: false,
  keyPattern: null,
  requireNfc: false,
  allowedControlCodePoints: 'all',
  rejectNoncharacters: false,
  rejectByteOrderMark: false,
  rejectLoneSurrogates: false,
  maxDepth: 256,
};

const ESCAPES = new Map<number, string>([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

const UTF8 = new TextEncoder();

function isControl(unit: number): boolean {
  // C0, DEL y C1. Los tres bloques son invisibles y viajan mal por cualquier tubería de texto.
  return unit < 0x20 || unit === 0x7f || (unit >= 0x80 && unit <= 0x9f);
}

function isNoncharacter(codePoint: number): boolean {
  if (codePoint >= 0xfdd0 && codePoint <= 0xfdef) return true;
  return (codePoint & 0xfffe) === 0xfffe;
}

function unicodeEscape(unit: number): string {
  return `\\u${unit.toString(16).padStart(4, '0')}`;
}

/**
 * Serializa una cadena según RFC 8785 §3.2.2.2 (el escapado de `JSON.stringify` de ECMAScript),
 * validando de paso las prohibiciones del perfil.
 */
function serializeString(value: string, path: string, profile: CanonicalProfile): string {
  if (profile.requireNfc && value.normalize('NFC') !== value) {
    throw new CanonicalizationError(
      'NOT_NFC',
      path,
      'la cadena no está en forma normal NFC; normalizá en el borde de entrada, no aquí',
    );
  }

  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);

    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        const codePoint = 0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00);
        if (profile.rejectNoncharacters && isNoncharacter(codePoint)) {
          throw new CanonicalizationError(
            'NONCHARACTER',
            path,
            `U+${codePoint.toString(16).toUpperCase()} es un no-carácter Unicode`,
          );
        }
        out += value.charAt(i) + value.charAt(i + 1);
        i++;
        continue;
      }
      out += surrogateOrThrow(unit, path, profile);
      continue;
    }

    if (unit >= 0xdc00 && unit <= 0xdfff) {
      out += surrogateOrThrow(unit, path, profile);
      continue;
    }

    if (unit === 0xfeff && profile.rejectByteOrderMark) {
      throw new CanonicalizationError(
        'BYTE_ORDER_MARK',
        path,
        'U+FEFF (BOM / ZWNBSP) es invisible y cambia el hash sin cambiar lo que se lee',
      );
    }

    if (profile.rejectNoncharacters && isNoncharacter(unit)) {
      throw new CanonicalizationError(
        'NONCHARACTER',
        path,
        `U+${unit.toString(16).toUpperCase()} es un no-carácter Unicode`,
      );
    }

    if (isControl(unit)) {
      const allowed = profile.allowedControlCodePoints;
      if (allowed !== 'all' && !allowed.has(unit)) {
        throw new CanonicalizationError(
          'CONTROL_CHAR',
          path,
          `carácter de control U+${unit.toString(16).toUpperCase().padStart(4, '0')} no admitido`,
        );
      }
    }

    const escape = ESCAPES.get(unit);
    if (escape !== undefined) {
      out += escape;
    } else if (unit < 0x20) {
      out += unicodeEscape(unit);
    } else {
      out += value.charAt(i);
    }
  }
  return `${out}"`;
}

function surrogateOrThrow(unit: number, path: string, profile: CanonicalProfile): string {
  if (profile.rejectLoneSurrogates) {
    throw new CanonicalizationError(
      'LONE_SURROGATE',
      path,
      `sustituto UTF-16 suelto U+${unit.toString(16).toUpperCase()}: no es codificable en UTF-8`,
    );
  }
  // Comportamiento "well-formed JSON.stringify" de ECMAScript: se escapa tal cual.
  return unicodeEscape(unit);
}

function serializeNumber(value: number, path: string, profile: CanonicalProfile): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(
      'NOT_FINITE',
      path,
      `${String(value)} no es representable en JSON`,
    );
  }
  if (profile.rejectNegativeZero && Object.is(value, -0)) {
    throw new CanonicalizationError(
      'NEGATIVE_ZERO',
      path,
      '-0 y 0 son valores distintos que serializan igual: prohibido',
    );
  }
  if (!profile.allowFractionalNumbers) {
    if (!Number.isInteger(value)) {
      throw new CanonicalizationError(
        'FRACTIONAL_NUMBER',
        path,
        `${String(value)} tiene parte fraccionaria; usá enteros en la unidad mínima o cadenas decimales`,
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalizationError(
        'UNSAFE_INTEGER',
        path,
        `${String(value)} está fuera de [-(2^53-1), 2^53-1] y deja de ser exacto`,
      );
    }
    return String(value);
  }
  // RFC 8785 §3.2.2.3 define la serialización de números como `Number::toString` de ECMAScript,
  // que es exactamente lo que hace `JSON.stringify` con un número finito.
  return JSON.stringify(value);
}

function serializeKey(key: string, path: string, profile: CanonicalProfile): string {
  const pattern = profile.keyPattern;
  if (pattern !== null && !pattern.test(key)) {
    throw new CanonicalizationError(
      'KEY_PATTERN',
      path,
      `la clave ${JSON.stringify(key)} no cumple ${pattern.source}`,
    );
  }
  return serializeString(key, path, profile);
}

/**
 * Comparador por unidades de código UTF-16, tal como manda RFC 8785 §3.2.3.
 * No es `localeCompare` (prohibido por ADR-0004: depende de ICU y de la locale del proceso) ni
 * orden de bytes UTF-8 (que difiere fuera del BMP).
 */
function compareUtf16(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serializeValue(
  value: unknown,
  path: string,
  profile: CanonicalProfile,
  depth: number,
  seen: Set<object>,
): string {
  if (depth > profile.maxDepth) {
    throw new CanonicalizationError(
      'MAX_DEPTH',
      path,
      `profundidad máxima ${String(profile.maxDepth)} excedida`,
    );
  }

  if (value === null) {
    if (!profile.allowNull) {
      throw new CanonicalizationError(
        'NULL_FORBIDDEN',
        path,
        'null está prohibido: la ausencia se expresa omitiendo la clave',
      );
    }
    return 'null';
  }

  switch (typeof value) {
    case 'undefined':
      throw new CanonicalizationError(
        'UNDEFINED_FORBIDDEN',
        path,
        'undefined no existe en JSON y JSON.stringify lo elimina en silencio',
      );
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value, path, profile);
    case 'string':
      return serializeString(value, path, profile);
    case 'bigint':
      throw new CanonicalizationError(
        'UNSUPPORTED_TYPE',
        path,
        'bigint no es JSON; representalo como cadena decimal',
      );
    case 'function':
    case 'symbol':
      throw new CanonicalizationError('UNSUPPORTED_TYPE', path, `tipo ${typeof value} no es JSON`);
    default:
      break;
  }

  // Tras el `switch`, lo único que queda es un objeto no nulo.
  const asObject: object = value;
  if (seen.has(asObject)) {
    throw new CanonicalizationError('CIRCULAR', path, 'referencia circular');
  }
  seen.add(asObject);
  try {
    if (Array.isArray(asObject)) {
      const items = asObject as readonly unknown[];
      const parts = items.map((item, index) =>
        serializeValue(item, `${path}[${String(index)}]`, profile, depth + 1, seen),
      );
      return `[${parts.join(',')}]`;
    }

    if (!isPlainObject(asObject)) {
      throw new CanonicalizationError(
        'UNSUPPORTED_TYPE',
        path,
        `${asObject.constructor.name} no es un objeto JSON plano; convertilo antes de hashear`,
      );
    }

    if (Object.getOwnPropertySymbols(asObject).length > 0) {
      throw new CanonicalizationError(
        'SYMBOL_KEY',
        path,
        'las claves Symbol se perderían en silencio al serializar',
      );
    }

    const record = asObject as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareUtf16);
    const parts = keys.map((key) => {
      const childPath = path === '' ? key : `${path}.${key}`;
      const serializedKey = serializeKey(key, childPath, profile);
      const serializedValue = serializeValue(record[key], childPath, profile, depth + 1, seen);
      return `${serializedKey}:${serializedValue}`;
    });
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(asObject);
  }
}

/**
 * Devuelve la forma canónica (RFC 8785) del valor, como cadena.
 *
 * DECISIÓN: el parámetro es `unknown` y no `JsonValue`. La validación de este módulo es de
 * ejecución y exhaustiva —tiene que serlo, porque los datos llegan de la red y de la base—; tipar la
 * entrada como `JsonValue` daría una falsa garantía y obligaría a `as` en cada llamada real.
 */
export function canonicalize(value: unknown, profile: CanonicalProfile = LEDGER_PROFILE): string {
  return serializeValue(value, '', profile, 0, new Set<object>());
}

/** La forma canónica en UTF-8 sin BOM: los bytes exactos que se hashean. */
export function canonicalizeToBytes(
  value: unknown,
  profile: CanonicalProfile = LEDGER_PROFILE,
): Uint8Array {
  return UTF8.encode(canonicalize(value, profile));
}

/**
 * Parsea un texto y exige que sea **exactamente** su propia forma canónica.
 *
 * Es la operación que hace un verificador con el `events.ndjson` de un export: no basta con que el
 * texto sea JSON válido y "equivalente"; tiene que ser el mismo byte a byte, porque es lo que se
 * hasheó. De regalo cierra la clase de ataques de "dos parsers, dos lecturas" (§1.2.3): un texto con
 * claves duplicadas, con espacios o con las claves desordenadas no sobrevive a la comparación.
 */
export function parseCanonical(
  text: string,
  profile: CanonicalProfile = LEDGER_PROFILE,
): JsonValue {
  const parsed: unknown = JSON.parse(text);
  const recanonicalized = canonicalize(parsed, profile);
  if (recanonicalized !== text) {
    throw new CanonicalizationError(
      'NOT_CANONICAL',
      '',
      'el texto no está en forma canónica JCS (orden de claves, espacios, escapes o claves duplicadas)',
    );
  }
  return parsed as JsonValue;
}

/** `true` si el texto ya está en forma canónica bajo el perfil dado. */
export function isCanonical(text: string, profile: CanonicalProfile = LEDGER_PROFILE): boolean {
  try {
    parseCanonical(text, profile);
    return true;
  } catch {
    return false;
  }
}

/** `true` si la cadena ya está en forma normal NFC. */
export function isNfc(value: string): boolean {
  return value.normalize('NFC') === value;
}

/**
 * Normalización del **borde de entrada** (§1.3.b): NFC sobre claves y valores de cadena, y finales
 * de línea a LF. Se aplica una vez, al recibir el dato, antes de validar, persistir y hashear.
 * Devuelve una copia; no muta la entrada.
 */
export function toNfc<T>(value: T): T {
  return normalizeDeep(value) as T;
}

function normalizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return toLedgerText(value);
  if (Array.isArray(value)) return (value as readonly unknown[]).map(normalizeDeep);
  if (typeof value === 'object' && value !== null && isPlainObject(value)) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      out[toLedgerText(key)] = normalizeDeep(source[key]);
    }
    return out;
  }
  return value;
}

/** NFC + finales de línea LF. La única transformación de texto admitida antes de hashear. */
export function toLedgerText(value: string): string {
  return value.normalize('NFC').replace(/\r\n?/gu, '\n');
}
