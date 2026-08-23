/**
 * Persistencia y rehidratación de la constitución digital.
 *
 * Copia deliberada de `workspace/repository.ts`: el `seq` del dominio es denso desde 1 y el del
 * ledger desde 0, la correspondencia es `ledgerSeq = domainSeq - 1`, y **se comprueba**. Un log que
 * no continúe exactamente donde el ledger se quedó se rechaza en vez de escribir un tramo que
 * dejaría un hueco o un solape.
 *
 * ═══ Por qué `loadConstitutionState` verifica y pliega, y no sólo lee ═══
 *
 * En este agregado la lectura **no es** una operación pasiva. `replayConstitution` reejecuta, evento
 * por evento, todo lo que la orden comprobó al escribirlo: los umbrales contra la copia congelada,
 * los plazos, la veda del §6.c, el núcleo intangible y —lo que más importa aquí— la
 * **reautorización**: `ReformApprovedByGuarantor` exige que el `actor` del sobre y el `guarantorId`
 * del cuerpo nombren a la misma persona, y que esa persona estuviera en el Círculo de Garantías
 * congelado al abrir la reforma.
 *
 * Eso convierte la lectura en la segunda puerta, y es la que importa frente al adversario nº 2 del
 * modelo de amenaza: quien administra el servidor no entra por la API, entra con un historial
 * traído de fuera —una restauración, un volcado— con los hashes recalculados. Ese historial pasa
 * `verifyChain` sin despeinarse. Lo que no pasa es el pliegue. Por eso aquí no hay ningún camino
 * que devuelva estado sin plegar: `loadConstitutionState` es la única lectura de estado del módulo.
 */

import {
  appendChained,
  type ConstitutionLog,
  type ConstitutionPayload,
  type ConstitutionState,
  type Hash,
  verifyConstitutionLog,
} from '@koinonia/domain';

import type { PgClient, PgPoolClient } from '../db/client.js';
import { appendWithin, readHead, readStream } from '../ledger/event-store.js';
import type { AggregateHead, ExpectedHead } from '../ledger/types.js';
import {
  CONSTITUTION_AGGREGATE_TYPE,
  decodeConstitutionEvent,
  encodeConstitutionEvent,
} from './codec.js';

/**
 * El identificador de la constitución de esta comunidad. Hay **una** (§6, `types.ts`).
 *
 * Es una constante y no un identificador sorteado, y esa es toda la defensa contra la constitución
 * paralela: si el identificador lo eligiera quien funda, dos personas podrían fundar dos
 * constituciones distintas y las dos serían «la» constitución para quien supiera su identificador.
 * Con una constante, la segunda fundación cae en `applyFounded` —«ya hay una constitución vigente:
 * fundar otra encima no es fundar, es un golpe»— porque las dos escriben en el mismo historial.
 *
 * Sigue la convención de los agregados reservados del ledger, que se numeran desde 1 en vez de
 * sortearse: `…0001` es la espina dorsal, `…0002` el anclaje, `…0003` la constitución.
 */
export const CONSTITUTION_AGGREGATE_ID = '00000000000000000000000000000003';

export class ConstitutionPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConstitutionPersistenceError';
  }
}

export interface ConstitutionPersistResult {
  readonly appended: number;
  readonly head: AggregateHead | undefined;
  readonly idempotentReplay: boolean;
}

/**
 * El tramo que falta por escribir, con la cabeza que el llamante afirma haber visto.
 *
 * `expectedHead` no es `'any'` a propósito: escribir sobre una cabeza distinta de la que se leyó
 * significaría que otra persona escribió en medio, y en este agregado «en medio» puede ser la
 * ratificación de otra reforma. Un conflicto de cabeza aquí es un conflicto real y no se reintenta.
 */
function pendingFor(
  log: ConstitutionLog,
  current: AggregateHead | undefined,
): {
  readonly pending: ConstitutionLog;
  readonly expectedHead: ExpectedHead;
} {
  const first = log[0];
  if (first === undefined) {
    throw new ConstitutionPersistenceError('un log vacío no identifica ninguna constitución');
  }
  const persisted = current === undefined ? 0 : current.seq + 1;
  if (persisted > log.length) {
    throw new ConstitutionPersistenceError(
      `el ledger tiene ${String(persisted)} hechos de la constitución y el log trae ` +
        `${String(log.length)}: el log recibido es más corto que la historia ya escrita`,
    );
  }
  const pending = log.slice(persisted);
  for (const [offset, event] of pending.entries()) {
    const expected = persisted + offset + 1;
    if (event.seq !== expected) {
      throw new ConstitutionPersistenceError(
        `el hecho ${String(offset)} del tramo pendiente dice seq=${String(event.seq)} y le toca ` +
          `${String(expected)}: el log no continúa donde el ledger se quedó`,
      );
    }
    if (event.aggregateId !== first.aggregateId) {
      throw new ConstitutionPersistenceError('el log mezcla dos constituciones');
    }
  }
  const expectedHead: ExpectedHead =
    current === undefined ? { kind: 'new' } : { kind: 'at', seq: current.seq, hash: current.hash };
  return { pending, expectedHead };
}

/**
 * Escribe el tramo pendiente **dentro de la transacción del llamante**.
 *
 * No hay variante sobre el pool. Es deliberado: todo hecho de este agregado que nombra una cláusula
 * nueva tiene que archivar su texto en el mismo commit (`text-store.ts`), y una versión cuyo texto
 * quedó fuera porque la segunda escritura falló sería una constitución ilegible con la huella
 * intacta. O entran las dos cosas, o no entra ninguna.
 */
export async function persistConstitutionLogWithin(
  client: PgPoolClient,
  log: ConstitutionLog,
  options: { readonly requestId: string; readonly requestScope?: string },
): Promise<ConstitutionPersistResult> {
  const first = log[0];
  if (first === undefined) {
    throw new ConstitutionPersistenceError('un log vacío no identifica ninguna constitución');
  }
  const current = await readHead(client, first.aggregateId);
  const prepared = pendingFor(log, current);
  if (prepared.pending.length === 0) {
    return { appended: 0, head: current, idempotentReplay: false };
  }
  const result = await appendWithin(client, {
    aggregateId: first.aggregateId,
    aggregateType: CONSTITUTION_AGGREGATE_TYPE,
    events: prepared.pending.map(encodeConstitutionEvent),
    expectedHead: prepared.expectedHead,
    requestId: options.requestId,
    ...(options.requestScope === undefined ? {} : { requestScope: options.requestScope }),
  });
  return {
    appended: result.idempotentReplay ? 0 : prepared.pending.length,
    head: result.head,
    idempotentReplay: result.idempotentReplay,
  };
}

/**
 * Rehidrata el historial desde el ledger, reencadenándolo.
 *
 * `prevHash` y `hash` **no se leen de la base**: los recomputa `appendChained` sobre el payload
 * decodificado. Es lo que convierte la ida y vuelta del codec en una comprobación en vez de una
 * suposición: si el codec perdiera un campo, el hash recomputado no coincidiría con el que
 * `verifyChain` espera y la lectura fallaría en vez de devolver una constitución ligeramente
 * distinta de la que se escribió.
 */
export async function loadConstitutionLog(
  client: PgClient,
  aggregateId: string = CONSTITUTION_AGGREGATE_ID,
): Promise<ConstitutionLog> {
  const stored = await readStream(client, aggregateId);
  let log: ConstitutionLog = [];
  for (const row of stored) {
    if (row.event.seq !== log.length) {
      throw new ConstitutionPersistenceError(
        `hueco en el historial de la constitución: se esperaba seq=${String(log.length)} y llegó ` +
          `${String(row.event.seq)} (leaf_index=${row.leafIndex.toString()})`,
      );
    }
    log = [...log, await appendChained<ConstitutionPayload>(log, decodeConstitutionEvent(row))];
  }
  return log;
}

/**
 * Rehidrata, verifica la cadena **y pliega**.
 *
 * El pliegue no es un adorno: es donde se revalida la autorización de cada aprobación de Garantías
 * y donde el núcleo intangible se recomputa desde el texto vigente. Un historial fabricado a mano
 * que atribuya una firma a alguien que no la puso no llega a estado: se rechaza al leerlo.
 *
 * `expectedCoreHash` queda como parámetro **sin uso interno a propósito**: es el hash del núcleo
 * publicado y anclado fuera del servidor, y sin él esta verificación no distingue un génesis
 * honesto de uno reescrito de arriba abajo. Cuando el despliegue publique ese valor, se pasa aquí y
 * la segunda capa entra en funcionamiento sin tocar nada más.
 */
export async function loadConstitutionState(
  client: PgClient,
  options: {
    readonly aggregateId?: string;
    readonly expectedCoreHash?: Hash;
  } = {},
): Promise<{ readonly log: ConstitutionLog; readonly state: ConstitutionState | undefined }> {
  const log = await loadConstitutionLog(client, options.aggregateId ?? CONSTITUTION_AGGREGATE_ID);
  if (log.length === 0) return { log, state: undefined };
  const state = await verifyConstitutionLog(log, {
    ...(options.expectedCoreHash === undefined
      ? {}
      : { expectedCoreHash: options.expectedCoreHash }),
  });
  return { log, state };
}

export { CONSTITUTION_AGGREGATE_TYPE };
