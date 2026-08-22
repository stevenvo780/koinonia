/**
 * **Varios calendarios**, y la fusión de sus sellos en un solo `.ots`.
 *
 * ═══ Por qué un calendario no basta ═══
 *
 * OpenTimestamps es el único de los tres anclajes sin tercero de confianza… salvo por un detalle: el
 * calendario. Un calendario **no puede falsificar** un sello —el paso 1 de la verificación lo
 * detecta—, pero sí puede **no sellar**: caerse, estar saturado o negarse. Y si sólo se envía a uno,
 * su caída es la caída de la clase `blockchain` entera, que es la única de las tres que no depende de
 * ninguna persona. Un punto único de fallo en la única defensa que no exige confiar en nadie.
 *
 * Por eso el envío va a varios calendarios y el resultado se **fusiona** en un solo fichero `.ots`
 * con una rama por calendario. Es exactamente lo que hace el cliente oficial, y el fichero resultante
 * lo lee el cliente oficial: cada rama termina en su propia atestación pendiente, y basta con que
 * **una** madure para que el checkpoint quede dentro de Bitcoin.
 *
 * ═══ La regla que hace honesta la fusión ═══
 *
 * Sólo se fusionan sellos **del mismo digest**. Si dos calendarios sellaron cosas distintas, unir sus
 * árboles produciría un fichero que afirma dos cosas a la vez y que el verificador no podría
 * atribuir. Aquí eso es un error ruidoso, no una rama de más.
 */

import { toHex } from '@koinonia/crypto';

import {
  type BackoffPolicy,
  describeError,
  type RetryClock,
  RetriesExhaustedError,
  withBackoff,
} from '../retry.js';
import type { OtsCalendarClient } from './calendar.js';
import {
  type DetachedTimestamp,
  type OtsAttestation,
  type OtsBranch,
  type OtsOp,
  OtsFormatError,
  type OtsTimestamp,
  parseDetachedTimestamp,
  serializeDetachedTimestamp,
} from './format.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Fusión de sellos
// ═════════════════════════════════════════════════════════════════════════════════════════════

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Dos operaciones son la misma rama si coinciden en clase y en argumento, byte a byte. */
export function sameOp(a: OtsOp, b: OtsOp): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'append' || a.kind === 'prepend') {
    const other = b as Extract<OtsOp, { readonly argument: Uint8Array }>;
    return bytesEqual(a.argument, other.argument);
  }
  return true;
}

export function sameAttestation(a: OtsAttestation, b: OtsAttestation): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'pending':
      return a.uri === (b as Extract<OtsAttestation, { readonly kind: 'pending' }>).uri;
    case 'bitcoin':
    case 'litecoin':
    case 'ethereum':
      return a.height === (b as Extract<OtsAttestation, { readonly height: number }>).height;
    case 'unknown': {
      const other = b as Extract<OtsAttestation, { readonly kind: 'unknown' }>;
      return bytesEqual(a.tag, other.tag) && bytesEqual(a.payload, other.payload);
    }
    default:
      return false;
  }
}

/**
 * Fusiona dos sellos que cuelgan del **mismo mensaje**.
 *
 * Las ramas con la misma operación se funden recursivamente en vez de duplicarse: dos calendarios que
 * agregaran igual producirían el mismo camino, y un fichero con el camino repetido es un fichero que
 * afirma dos veces lo mismo y que crece sin motivo en cada `upgrade`.
 */
export function mergeTimestamps(a: OtsTimestamp, b: OtsTimestamp): OtsTimestamp {
  if (!bytesEqual(a.msg, b.msg)) {
    throw new OtsFormatError(
      `no se pueden fusionar sellos de mensajes distintos (${toHex(a.msg).slice(0, 16)}… y ` +
        `${toHex(b.msg).slice(0, 16)}…)`,
    );
  }

  const attestations: OtsAttestation[] = [...a.attestations];
  for (const candidate of b.attestations) {
    if (!attestations.some((existing) => sameAttestation(existing, candidate))) {
      attestations.push(candidate);
    }
  }

  const ops: OtsBranch[] = [...a.ops];
  for (const branch of b.ops) {
    const index = ops.findIndex((existing) => sameOp(existing.op, branch.op));
    const existing = index === -1 ? undefined : ops[index];
    if (existing === undefined) {
      ops.push(branch);
      continue;
    }
    ops[index] = {
      op: existing.op,
      timestamp: mergeTimestamps(existing.timestamp, branch.timestamp),
    };
  }

  return { msg: a.msg, attestations, ops };
}

/**
 * Injerta `incoming` en **todos** los nodos del árbol cuyo mensaje sea `targetMsg`.
 *
 * Es lo que hace falta para madurar: el calendario responde con el sello que cuelga de un compromiso
 * concreto —no del digest del fichero—, y hay que coserlo en el nodo que le corresponde. Colgarlo de
 * la raíz produciría un fichero cuyo camino no llega a ninguna parte, y el verificador lo rechazaría
 * con razón.
 */
export function mergeTimestampAt(
  root: OtsTimestamp,
  targetMsg: Uint8Array,
  incoming: OtsTimestamp,
): OtsTimestamp {
  const node = bytesEqual(root.msg, targetMsg) ? mergeTimestamps(root, incoming) : root;
  return {
    msg: node.msg,
    attestations: node.attestations,
    ops: node.ops.map((branch) => ({
      op: branch.op,
      timestamp: mergeTimestampAt(branch.timestamp, targetMsg, incoming),
    })),
  };
}

/** Fusiona ficheros `.ots` detached. Todos tienen que sellar el mismo digest con la misma operación. */
export async function mergeOtsFiles(files: readonly Uint8Array[]): Promise<Uint8Array> {
  if (files.length === 0) throw new OtsFormatError('no hay ningún sello que fusionar');

  const parsed: DetachedTimestamp[] = [];
  for (const bytes of files) parsed.push(await parseDetachedTimestamp(bytes));

  const first = parsed[0];
  if (first === undefined) throw new OtsFormatError('no hay ningún sello que fusionar');
  if (parsed.length === 1) return serializeDetachedTimestamp(first);

  let timestamp = first.timestamp;
  for (const other of parsed.slice(1)) {
    if (other.fileHashOp.kind !== first.fileHashOp.kind) {
      throw new OtsFormatError(
        `un sello resume el fichero con ${first.fileHashOp.kind} y otro con ` +
          `${other.fileHashOp.kind}: no son sellos de lo mismo`,
      );
    }
    if (!bytesEqual(other.fileDigest, first.fileDigest)) {
      throw new OtsFormatError(
        `un sello es de ${toHex(first.fileDigest).slice(0, 16)}… y otro de ` +
          `${toHex(other.fileDigest).slice(0, 16)}…: fusionarlos afirmaría dos cosas a la vez`,
      );
    }
    timestamp = mergeTimestamps(timestamp, other.timestamp);
  }

  return serializeDetachedTimestamp({
    majorVersion: first.majorVersion,
    fileHashOp: first.fileHashOp,
    fileDigest: first.fileDigest,
    timestamp,
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Calendario con reintentos
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface RetryingCalendarOptions {
  readonly policy: BackoffPolicy;
  readonly clock: RetryClock;
  /** Qué errores merecen otro intento. Por defecto, todos. */
  readonly retryable?: (error: unknown) => boolean;
}

/**
 * Envuelve un calendario con reintentos.
 *
 * `upgrade` también reintenta, pero un `undefined` —«todavía no hay bloque»— **no es un fallo** y no
 * consume intentos: es la respuesta normal durante las primeras horas. Confundir «no maduró» con «no
 * respondió» convertiría cada ciclo de anclaje en cinco peticiones inútiles contra un calendario que
 * está perfectamente sano.
 */
export function retryingCalendar(
  inner: OtsCalendarClient,
  options: RetryingCalendarOptions,
): OtsCalendarClient {
  const conReintentos = async <T>(what: string, operation: () => Promise<T>): Promise<T> => {
    const result = await withBackoff(operation, {
      policy: options.policy,
      clock: options.clock,
      what,
      ...(options.retryable === undefined ? {} : { retryable: options.retryable }),
    });
    return result.value;
  };

  return {
    uri: inner.uri,
    stamp: (fileDigest) => conReintentos(`sellar en ${inner.uri}`, () => inner.stamp(fileDigest)),
    upgrade: (otsBytes) => conReintentos(`madurar en ${inner.uri}`, () => inner.upgrade(otsBytes)),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Conjunto de calendarios
// ═════════════════════════════════════════════════════════════════════════════════════════════

export class CalendarPoolError extends Error {
  /** Qué respondió cada calendario. Va al motivo del evento `AnclajeFallido`. */
  readonly failures: ReadonlyMap<string, string>;

  constructor(detail: string, failures: ReadonlyMap<string, string>) {
    const partes = [...failures].map(([uri, error]) => `${uri}: ${error}`).join(' · ');
    super(`${detail} — ${partes}`);
    this.name = 'CalendarPoolError';
    this.failures = failures;
  }
}

export interface CalendarPoolOptions {
  /**
   * Cuántos calendarios tienen que sellar para dar el envío por bueno. Por defecto **1**.
   *
   * Uno es suficiente para que el anclaje exista, y exigir más convertiría la caída de un servicio
   * ajeno en la falla de nuestro anclaje. Subirlo es una decisión de despliegue, no un valor que
   * este código deba imponer.
   */
  readonly minSuccess?: number;
  /** Nombre del conjunto, para el `raw.calendar` del recibo. Por defecto, las URI unidas. */
  readonly uri?: string;
}

/**
 * Varios calendarios detrás de la misma interfaz.
 *
 * Se les pregunta a **todos** —no al primero que responda—: el objetivo no es la latencia sino que el
 * sello quede en manos de varios agregadores independientes. Que uno se caiga no debe costar nada; que
 * se caigan todos tiene que ser ruidoso, y por eso `CalendarPoolError` trae lo que dijo cada uno.
 */
export function calendarPool(
  clients: readonly OtsCalendarClient[],
  options: CalendarPoolOptions = {},
): OtsCalendarClient {
  if (clients.length === 0) {
    throw new CalendarPoolError('un conjunto de calendarios vacío no puede sellar nada', new Map());
  }
  const minSuccess = options.minSuccess ?? 1;
  if (!Number.isInteger(minSuccess) || minSuccess < 1 || minSuccess > clients.length) {
    throw new CalendarPoolError(
      `minSuccess debe estar entre 1 y ${String(clients.length)} y es ${String(minSuccess)}`,
      new Map(),
    );
  }

  const uri = options.uri ?? clients.map((client) => client.uri).join(' ');

  const preguntarATodos = async <T>(
    operation: (client: OtsCalendarClient) => Promise<T | undefined>,
  ): Promise<{
    readonly ok: readonly Uint8Array[];
    readonly failures: ReadonlyMap<string, string>;
  }> => {
    const settled = await Promise.allSettled(clients.map(async (client) => operation(client)));
    const ok: Uint8Array[] = [];
    const failures = new Map<string, string>();
    settled.forEach((result, index) => {
      const client = clients[index];
      if (client === undefined) return;
      if (result.status === 'rejected') {
        failures.set(client.uri, motivoDe(result.reason));
        return;
      }
      if (result.value === undefined) return;
      ok.push(result.value as Uint8Array);
    });
    return { ok, failures };
  };

  return {
    uri,
    async stamp(fileDigest: Uint8Array): Promise<Uint8Array> {
      const { ok, failures } = await preguntarATodos((client) => client.stamp(fileDigest));
      if (ok.length < minSuccess) {
        throw new CalendarPoolError(
          `hacían falta ${String(minSuccess)} calendario(s) y sellaron ${String(ok.length)} de ` +
            String(clients.length),
          failures,
        );
      }
      return mergeOtsFiles(ok);
    },
    async upgrade(otsBytes: Uint8Array): Promise<Uint8Array | undefined> {
      const { ok, failures } = await preguntarATodos((client) => client.upgrade(otsBytes));
      if (ok.length === 0) {
        // Ningún calendario maduró. Si además **todos** fallaron, eso no es «todavía no»: es que no
        // hay con quién madurar, y callarlo dejaría el sello pendiente para siempre sin decir por qué.
        if (failures.size === clients.length) {
          throw new CalendarPoolError(
            'ningún calendario respondió al intento de madurar',
            failures,
          );
        }
        return undefined;
      }
      // El sello original entra en la fusión: las ramas de los calendarios que aún no maduraron se
      // conservan, que es lo que permite volver a intentarlo con ellas en el ciclo siguiente.
      return mergeOtsFiles([otsBytes, ...ok]);
    },
  };
}

function motivoDe(reason: unknown): string {
  if (reason instanceof RetriesExhaustedError) return reason.message;
  return describeError(reason);
}
