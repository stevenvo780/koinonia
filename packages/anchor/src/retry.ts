/**
 * Reintentos con **retroceso exponencial**, sin reloj propio y sin azar propio.
 *
 * ═══ Por qué esto vive aquí y no en el adaptador ═══
 *
 * El retroceso es la parte del envío que *sí* se puede probar sin red: es aritmética sobre el número
 * de intento. Lo que no se puede probar sin red es el diálogo HTTP. Separarlos es lo que permite que
 * la política de reintentos —cuántas veces, cuánto se espera, qué se considera reintentable— tenga
 * pruebas de verdad en vez de una nota que diga «se probó a mano una vez».
 *
 * Por eso **el tiempo y el azar entran como datos**: `sleep` y `random` son parámetros. Un
 * `setTimeout` o un `Math.random()` aquí dentro convertirían cada prueba en una espera real y en una
 * lotería, y una política de reintentos que sólo se puede observar esperando es una política que
 * nadie va a comprobar.
 *
 * ═══ La decisión que importa: no todo fallo se reintenta ═══
 *
 * Reintentar un `400 Bad Request` es gastar el presupuesto de intentos en algo que va a fallar igual
 * las cinco veces. Reintentar un `503` es exactamente para lo que existe el mecanismo. `retryable`
 * decide, y su valor por defecto —reintentar todo— es el conservador: prefiere gastar intentos de más
 * a dar por perdido un anclaje que habría entrado al segundo intento.
 */

/** Política de retroceso. Todos los tiempos en milisegundos. */
export interface BackoffPolicy {
  /** Intentos **totales**, incluido el primero. `1` ⇒ sin reintentos. */
  readonly attempts: number;
  /** Retardo del primer reintento, antes del jitter. */
  readonly baseDelayMs: number;
  /** Multiplicador entre reintentos consecutivos. `2` ⇒ 1×, 2×, 4×, 8×… */
  readonly factor: number;
  /** Techo del retardo: sin él, el intento 10 esperaría horas. */
  readonly maxDelayMs: number;
  /**
   * Fracción del retardo que se sortea, en `[0, 1]`.
   *
   * No es un adorno: si varios procesos reintentan a la vez contra el mismo calendario, un retroceso
   * determinista los sincroniza y vuelven todos juntos, que es justo lo que tumba al servicio que se
   * estaba recuperando. `1` = jitter completo (el retardo cae en `(0, base]`).
   */
  readonly jitter: number;
}

/**
 * Cinco intentos, de 500 ms a 8 s, con jitter completo.
 *
 * El orden de magnitud sale de para qué sirve: un calendario de OpenTimestamps que no responde suele
 * volver en segundos, y si no vuelve, el ciclo de anclaje se repite más tarde de todas formas. Esperar
 * minutos aquí sólo alargaría la ventana en la que el checkpoint está sin anclar.
 */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  attempts: 5,
  baseDelayMs: 500,
  factor: 2,
  maxDelayMs: 8_000,
  jitter: 1,
};

export class BackoffPolicyError extends Error {
  constructor(detail: string) {
    super(`política de reintentos inválida: ${detail}`);
    this.name = 'BackoffPolicyError';
  }
}

function assertPolicy(policy: BackoffPolicy): void {
  if (!Number.isInteger(policy.attempts) || policy.attempts < 1) {
    throw new BackoffPolicyError(`attempts debe ser un entero ≥ 1 y es ${String(policy.attempts)}`);
  }
  for (const [name, value] of [
    ['baseDelayMs', policy.baseDelayMs],
    ['factor', policy.factor],
    ['maxDelayMs', policy.maxDelayMs],
    ['jitter', policy.jitter],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new BackoffPolicyError(`${name} debe ser un número finito ≥ 0 y es ${String(value)}`);
    }
  }
  if (policy.jitter > 1) throw new BackoffPolicyError('jitter debe estar en [0, 1]');
  if (policy.factor < 1) throw new BackoffPolicyError('factor < 1 haría decrecer el retroceso');
}

/**
 * Retardo antes del reintento número `attempt` (`0` = el que sigue al primer fallo).
 *
 * Función **pura**: mismo `attempt` y mismo `random`, mismo resultado. Es la que se prueba, y por eso
 * `random` es un número y no un generador: el test le pasa `0`, `0.5` y `0.999` y comprueba las cotas
 * exactas en vez de comprobar una distribución.
 */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy, random: number): number {
  assertPolicy(policy);
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new BackoffPolicyError(`attempt debe ser un entero ≥ 0 y es ${String(attempt)}`);
  }
  if (!Number.isFinite(random) || random < 0 || random >= 1) {
    throw new BackoffPolicyError(`random debe estar en [0, 1) y es ${String(random)}`);
  }
  const crecido = policy.baseDelayMs * policy.factor ** attempt;
  const techo = Math.min(crecido, policy.maxDelayMs);
  const fijo = techo * (1 - policy.jitter);
  return Math.round(fijo + techo * policy.jitter * random);
}

/**
 * El tiempo y el azar, inyectados.
 *
 * `sleep` no es `setTimeout` disfrazado: en los tests es una función que **anota** cuánto se le pidió
 * esperar y vuelve al instante, así que la prueba comprueba la política sin que la suite tarde.
 */
export interface RetryClock {
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

/** Reloj que no espera. Para pruebas y para un ciclo que ya corre dentro de su propio temporizador. */
export function immediateClock(random: () => number = () => 0): RetryClock {
  return { sleep: () => Promise.resolve(), random };
}

/** Un intento fallido, con lo que se esperó después. Es lo que se escribe en el motivo de la falla. */
export interface AttemptFailure {
  /** Número de intento, empezando en 1. */
  readonly attempt: number;
  readonly error: string;
  /** `undefined` ⇒ no se esperó porque no quedaban intentos o el error no era reintentable. */
  readonly waitedMs: number | undefined;
}

export class RetriesExhaustedError extends Error {
  readonly failures: readonly AttemptFailure[];

  constructor(what: string, failures: readonly AttemptFailure[]) {
    const detalle = failures.map((f) => `#${String(f.attempt)}: ${f.error}`).join(' · ');
    super(`${what}: se agotaron ${String(failures.length)} intento(s) — ${detalle}`);
    this.name = 'RetriesExhaustedError';
    this.failures = failures;
  }
}

export interface WithBackoffOptions {
  readonly policy: BackoffPolicy;
  readonly clock: RetryClock;
  /** Qué se estaba intentando, para el mensaje de error. */
  readonly what: string;
  /** Qué errores merecen otro intento. Por defecto, todos. */
  readonly retryable?: (error: unknown) => boolean;
}

export interface BackoffResult<T> {
  readonly value: T;
  /** Los intentos que fallaron antes del que salió bien. Vacío ⇒ salió al primero. */
  readonly failures: readonly AttemptFailure[];
}

/**
 * Ejecuta `operation` hasta que salga bien o se agoten los intentos.
 *
 * Devuelve también **los fallos por el camino**, no sólo el valor: un anclaje que entró al cuarto
 * intento es un anclaje que entró, pero también es la señal de que tres calendarios están caídos, y
 * tirar ese dato es perder la única pista antes de que se caiga el cuarto.
 */
export async function withBackoff<T>(
  operation: (attempt: number) => Promise<T>,
  options: WithBackoffOptions,
): Promise<BackoffResult<T>> {
  assertPolicy(options.policy);
  const retryable = options.retryable ?? ((): boolean => true);
  const failures: AttemptFailure[] = [];

  for (let attempt = 1; attempt <= options.policy.attempts; attempt++) {
    try {
      const value = await operation(attempt);
      return { value, failures };
    } catch (error) {
      const quedan = attempt < options.policy.attempts;
      const reintentable = retryable(error);
      if (!quedan || !reintentable) {
        failures.push({ attempt, error: describeError(error), waitedMs: undefined });
        throw new RetriesExhaustedError(options.what, failures);
      }
      const waitedMs = backoffDelayMs(attempt - 1, options.policy, options.clock.random());
      failures.push({ attempt, error: describeError(error), waitedMs });
      await options.clock.sleep(waitedMs);
    }
  }

  // Inalcanzable: el bucle sale por `return` o por `throw`. Se deja explícito para que el día que
  // alguien toque la condición, el compilador tenga algo que decir.
  throw new RetriesExhaustedError(options.what, failures);
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
