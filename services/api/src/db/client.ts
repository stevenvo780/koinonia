/**
 * Acceso a PostgreSQL: conexión, transacciones y conversiones de tipo.
 *
 * `services/api` es lo único del repositorio que hace I/O (ADR-0001). Todo lo que hay aquí es
 * adaptador; ni una regla de dominio.
 *
 * ═══ Conversiones, y por qué son el punto delicado ═══
 *
 * El driver devuelve `bytea` como `Buffer` y `bigint` como **cadena** (para no perder precisión).
 * Convertir mal cualquiera de las dos cosas produce exactamente el fallo que la regla de tipos del
 * ledger existe para evitar: una preimagen que cambia al rehidratar. Por eso las conversiones son
 * explícitas, están en un solo sitio y comprueban la longitud.
 */

import pg from 'pg';

/**
 * Lo mínimo que necesita quien sólo consulta: saber ejecutar una sentencia.
 *
 * Deliberadamente NO es `pg.PoolClient | pg.Client | pg.Pool`. Estructural y estrecho, cualquiera de
 * los tres encaja —y también lo hará un cliente envuelto en instrumentación o en un reintento—, y a
 * cambio la firma dice la verdad sobre lo que la función usa: nada de transacciones, nada de
 * `connect()`, nada de `release()`. Una función de lectura que recibiera un `Pool` completo podría
 * abrir conexiones por su cuenta sin que la firma lo delatara.
 */
export interface PgClient {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export type PgPool = pg.Pool;
/** Conexión tomada del pool: la necesita quien abre transacciones explícitas. */
export type PgPoolClient = pg.PoolClient;

export interface PoolOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
  /**
   * Plazo para ABRIR la conexión, en milisegundos. Por defecto
   * {@link PLAZO_DE_CONEXION_POR_DEFECTO_MS}. Ver {@link plazoDeConexion}: el `0` está prohibido a
   * propósito.
   */
  readonly connectionTimeoutMillis?: number;
}

/**
 * Diez segundos para abrir la conexión: la convención del resto de los servicios.
 *
 * Es holgado a propósito. Una base sana en la misma red responde en milisegundos, y una conexión
 * legítimamente lenta —TLS, una base fría, un vecino ruidoso— tiene margen de sobra. Lo que este
 * plazo corta no es la lentitud: es la espera que no termina nunca.
 */
export const PLAZO_DE_CONEXION_POR_DEFECTO_MS = 10_000;

/**
 * Valida el plazo de conexión, y **rechaza el `0`**.
 *
 * En `node-postgres` `connectionTimeoutMillis = 0` no significa «sin espera»: significa **esperar
 * para siempre**, que es justo el defecto que este módulo existe para no tener. Un `0` llegado de
 * una variable de entorno mal puesta reintroduciría la avería con aspecto de configuración
 * deliberada, así que falla al construir el pool —cuando alguien está mirando— y no en la primera
 * petición que se cuelgue.
 */
export function plazoDeConexion(valor: number | undefined): number {
  if (valor === undefined) return PLAZO_DE_CONEXION_POR_DEFECTO_MS;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    throw new RangeError(
      `connectionTimeoutMillis: se esperaba un número finito de milisegundos mayor que cero y llegó ` +
        `${JSON.stringify(valor)}. Ojo con el 0: en node-postgres NO es «sin espera», es «esperar ` +
        `para siempre», y una conexión que no vuelve deja la petición colgada sin error y sin log.`,
    );
  }
  return valor;
}

export function createPool(options: PoolOptions): PgPool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'koinonia-api',
    // El ledger no tolera esperas indefinidas en el punto de serialización global de escrituras:
    // más vale un error accionable que una petición colgada.
    statement_timeout: 30_000,
    // ═══ Y este plazo es OTRA cosa, aunque las dos líneas se parezcan ═══
    //
    // `statement_timeout` acota la CONSULTA: sólo actúa cuando ya hay conexión y el servidor está
    // ejecutando algo. `idleTimeoutMillis` acota el ocio del pool. Ninguno de los dos acota el
    // ABRIR la conexión, y ahí el defecto del driver es `connectionTimeoutMillis = 0`, que en pg
    // significa esperar indefinidamente.
    //
    // POR QUÉ IMPORTA AQUÍ MÁS QUE EN OTROS SITIOS: el pool se usa por petición, así que un connect
    // que no vuelve no impide arrancar. El servicio levanta, sirve, y *una* petición se queda
    // esperando sin error, sin registro y sin 5xx. Quien vota ve una pantalla que no carga y desde
    // fuera no se ve absolutamente nada. Un fallo rápido y con mensaje es peor experiencia y mucho
    // mejor sistema.
    connectionTimeoutMillis: plazoDeConexion(options.connectionTimeoutMillis),
  });
}

/**
 * Códigos de error de PostgreSQL que este servicio distingue.
 *
 * Capturarlos por código y no por el texto del mensaje no es purismo: el texto está traducido según
 * `lc_messages` del servidor, así que una comprobación por cadena funciona en la máquina de quien
 * la escribió y falla en el VPS.
 */
export const PG_ERROR = {
  /** `serialization_failure` — reintentable. */
  serializationFailure: '40001',
  /** `deadlock_detected` — reintentable. */
  deadlockDetected: '40P01',
  /** `lock_not_available` — reintentable. */
  lockNotAvailable: '55P03',
  /** `unique_violation` — carrera en `(aggregate_id, seq)`, en `leaf_index` o en `request_id`. */
  uniqueViolation: '23505',
  /** `check_violation` — lo que lanza el trigger append-only. */
  checkViolation: '23514',
  /** `foreign_key_violation` — un `spine_hash` que no apunta a ningún evento. */
  foreignKeyViolation: '23503',
  /** `insufficient_privilege` — el rol de la aplicación intentando `UPDATE`/`DELETE`. */
  insufficientPrivilege: '42501',
} as const;

/** Los reintentables de §3.3. */
const RETRYABLE: ReadonlySet<string> = new Set([
  PG_ERROR.serializationFailure,
  PG_ERROR.deadlockDetected,
  PG_ERROR.lockNotAvailable,
  PG_ERROR.uniqueViolation,
]);

/** Forma mínima de un error del driver, sin `any`. */
export interface PgErrorShape {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
  readonly message: string;
}

export function pgError(error: unknown): PgErrorShape | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const code = record['code'];
  if (typeof code !== 'string') return undefined;
  const constraint = record['constraint'];
  const message = record['message'];
  return {
    code,
    constraint: typeof constraint === 'string' ? constraint : undefined,
    message: typeof message === 'string' ? message : `error de PostgreSQL ${code}`,
  };
}

export function isRetryable(error: unknown): boolean {
  const info = pgError(error);
  return info !== undefined && info.code !== undefined && RETRYABLE.has(info.code);
}

export function hasPgCode(error: unknown, code: string): boolean {
  return pgError(error)?.code === code;
}

/**
 * Ejecuta `body` dentro de una transacción, con `ROLLBACK` garantizado ante cualquier salida.
 *
 * El `catch(() => {})` del `ROLLBACK` es deliberado: si la conexión ya está rota, insistir sólo
 * sustituiría el error real —el que hay que diagnosticar— por uno de red.
 */
export async function withTransaction<T>(
  pool: PgPool,
  body: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Espera con jitter. Backoff exponencial de §3.3: 10 ms, 20 ms, 40 ms… más [0, 10) ms. */
export async function backoff(attempt: number, random: () => number): Promise<void> {
  const ms = 2 ** attempt * 10 + random() * 10;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Conversiones
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `bytea` -> `Uint8Array`, con copia.
 *
 * La copia no es paranoia: un `Buffer` de Node puede ser una **vista** sobre un `ArrayBuffer`
 * compartido y mucho mayor. Pasar esa vista a `crypto.subtle.digest` sin copiar funciona, pero
 * cualquier código que mire `.buffer` vería bytes ajenos.
 */
export function toBytes(value: unknown, what: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${what}: se esperaba bytea y llegó ${typeof value}`);
  }
  return Uint8Array.from(value);
}

/** `bytea` opcional. */
export function toBytesOrUndefined(value: unknown, what: string): Uint8Array | undefined {
  return value === null || value === undefined ? undefined : toBytes(value, what);
}

/** Un hash de 32 bytes exactos leído de la base. */
export function toHash32(value: unknown, what: string): Uint8Array {
  const bytes = toBytes(value, what);
  if (bytes.length !== 32) {
    throw new TypeError(`${what}: un hash mide 32 bytes y éste mide ${String(bytes.length)}`);
  }
  return bytes;
}

/** `bigint` de PostgreSQL: el driver lo entrega como cadena para no perder precisión. */
export function toBigInt(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${what}: ${String(value)} está fuera del rango entero seguro`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) return BigInt(value);
  throw new TypeError(`${what}: se esperaba un bigint y llegó ${JSON.stringify(value)}`);
}

/** `integer` de PostgreSQL. */
export function toInt(value: unknown, what: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) return Number.parseInt(value, 10);
  throw new TypeError(`${what}: se esperaba un entero y llegó ${JSON.stringify(value)}`);
}

/**
 * `char(n)` de PostgreSQL.
 *
 * `bpchar` **rellena con espacios** hasta `n`, así que un valor más corto del esperado volvería del
 * driver con relleno invisible y la preimagen cambiaría sin que nadie lo notara. Los `CHECK`
 * anclados del DDL impiden que eso llegue a ocurrir; esta función es el segundo cinturón, y falla
 * en vez de recortar: recortar sería «acomodar en silencio», que es justo lo que produce el falso
 * positivo de corrupción del §1.2.
 */
export function toFixedChar(value: unknown, length: number, what: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${what}: se esperaba char(${String(length)}) y llegó ${typeof value}`);
  }
  if (value.length !== length) {
    throw new TypeError(
      `${what}: se esperaban ${String(length)} caracteres exactos y llegaron ${String(value.length)} ` +
        `(${JSON.stringify(value)}). Un char(n) rellena con espacios: la preimagen habría cambiado.`,
    );
  }
  return value;
}

export function toText(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${what}: se esperaba texto y llegó ${typeof value}`);
  }
  return value;
}
