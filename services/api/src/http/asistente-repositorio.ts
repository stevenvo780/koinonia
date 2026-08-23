/**
 * Persistencia del historial del asistente (ADR-0052) — el `cargarBorrador`/`guardarEvento`/
 * `listarPropios` que `ContextoAsistente` (`rutas-asistente.ts`) declara y no implementa: ese
 * fichero es propiedad de otro agente y su cabecera dice explícitamente que la persistencia es
 * trabajo de quien integra.
 *
 * Calcado del patrón de `workspace/repository.ts` + `workspace/codec.ts` (y, más de cerca, del
 * códec de un solo agregado que `rutas-evaluacion.ts` escribe a mano para `evaluation`): el
 * decodificador valida, nunca acomoda; `seq`, `prevHash` y `hash` no se guardan como columna propia,
 * se RECALCULAN al leer con `appendChained`, para que la copia y el original sólo coincidan si de
 * verdad coinciden.
 *
 * Seis tipos de evento (`ASSISTANT_EVENT_TYPES`), un solo tipo de agregado: no hace falta la
 * abstracción `Codec<P>` genérica de `workspace/repository.ts`.
 */

import type { JsonObject, JsonValue } from '@koinonia/crypto';
import {
  type AssistantEvent,
  type AssistantLog,
  type AssistantPayload,
  type BorradorId,
  type ChainedInput,
  borradorId as toBorradorId,
  type DestinoIA,
  esNumeroDePregunta,
  eventId as toEventId,
  memberId as toMemberId,
  type MemberId,
  type NumeroPregunta,
  OPERACIONES,
  type OperacionIA,
  type Respuesta,
  sugerenciaId as toSugerenciaId,
  type SugerenciaRegistrada,
  appendChained,
} from '@koinonia/domain';

import type { PgClient, PgPool } from '../db/client.js';
import { instantToIso, isoToInstant } from '../decision/codec.js';
import { append, readHead, readStream } from '../ledger/event-store.js';
import type {
  AggregateHead,
  ExpectedHead,
  LedgerEventDraft,
  StoredEvent,
} from '../ledger/types.js';
import { listAggregateIds } from '../workspace/repository.js';

export const ASSISTANT_AGGREGATE_TYPE = 'assistant';
const ASSISTANT_EVENT_VERSION = 1;

export class AsistenteRepositorioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsistenteRepositorioError';
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Codificador ⇄ decodificador
// ═════════════════════════════════════════════════════════════════════════════════════════════

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(source: JsonObject, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new AsistenteRepositorioError(`${path}.${key}: se esperaba texto`);
  }
  return value;
}

function bool(source: JsonObject, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new AsistenteRepositorioError(`${path}.${key}: se esperaba un booleano`);
  }
  return value;
}

function stringArray(source: JsonObject, key: string, path: string): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new AsistenteRepositorioError(`${path}.${key}: se esperaba un arreglo`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new AsistenteRepositorioError(`${path}.${key}[${String(index)}]: se esperaba texto`);
    }
    return item;
  });
}

function numeroDePregunta(source: JsonObject, key: string, path: string): NumeroPregunta {
  const value = source[key];
  if (typeof value !== 'number' || !esNumeroDePregunta(value)) {
    throw new AsistenteRepositorioError(`${path}.${key}: no es un número de pregunta válido`);
  }
  return value;
}

function encodeDestino(destino: DestinoIA): JsonObject {
  return {
    aDondeVa: destino.aDondeVa,
    queSeManda: destino.queSeManda,
    queNoSeManda: destino.queNoSeManda,
    enLaMismaMaquina: destino.enLaMismaMaquina,
  };
}

function decodeDestino(source: JsonObject, key: string, path: string): DestinoIA {
  const raw = source[key];
  if (!isJsonObject(raw))
    throw new AsistenteRepositorioError(`${path}.${key}: se esperaba un objeto`);
  return {
    aDondeVa: str(raw, 'aDondeVa', `${path}.${key}`),
    queSeManda: str(raw, 'queSeManda', `${path}.${key}`),
    queNoSeManda: str(raw, 'queNoSeManda', `${path}.${key}`),
    enLaMismaMaquina: bool(raw, 'enLaMismaMaquina', `${path}.${key}`),
  };
}

function encodeRespuesta(respuesta: Respuesta): JsonObject {
  switch (respuesta.forma) {
    case 'frase':
      return { forma: 'frase', texto: respuesta.texto };
    case 'lineas':
      return { forma: 'lineas', lineas: [...respuesta.lineas] };
    case 'por_linea':
      return { forma: 'por_linea', porLinea: [...respuesta.porLinea] };
    case 'todavia_no_se':
      return { forma: 'todavia_no_se' };
  }
}

function decodeRespuesta(source: JsonObject, key: string, path: string): Respuesta {
  const raw = source[key];
  if (!isJsonObject(raw))
    throw new AsistenteRepositorioError(`${path}.${key}: se esperaba un objeto`);
  const forma = str(raw, 'forma', `${path}.${key}`);
  switch (forma) {
    case 'frase':
      return { forma: 'frase', texto: str(raw, 'texto', `${path}.${key}`) };
    case 'lineas':
      return { forma: 'lineas', lineas: stringArray(raw, 'lineas', `${path}.${key}`) };
    case 'por_linea':
      return { forma: 'por_linea', porLinea: stringArray(raw, 'porLinea', `${path}.${key}`) };
    case 'todavia_no_se':
      return { forma: 'todavia_no_se' };
    default:
      throw new AsistenteRepositorioError(
        `${path}.${key}.forma: «${forma}» no es una forma válida`,
      );
  }
}

function encodeSugerencia(sugerencia: SugerenciaRegistrada): JsonObject {
  return {
    sugerenciaId: sugerencia.sugerenciaId,
    operacion: sugerencia.operacion,
    ...(sugerencia.pregunta === undefined ? {} : { pregunta: sugerencia.pregunta }),
    textos: [...sugerencia.textos],
    destino: encodeDestino(sugerencia.destino),
  };
}

function decodeSugerencia(source: JsonObject, key: string, path: string): SugerenciaRegistrada {
  const raw = source[key];
  if (!isJsonObject(raw))
    throw new AsistenteRepositorioError(`${path}.${key}: se esperaba un objeto`);
  const operacionRaw = str(raw, 'operacion', `${path}.${key}`);
  if (!(OPERACIONES as readonly string[]).includes(operacionRaw)) {
    throw new AsistenteRepositorioError(`${path}.${key}.operacion: «${operacionRaw}» no es válida`);
  }
  const preguntaRaw = raw['pregunta'];
  return {
    sugerenciaId: toSugerenciaId(str(raw, 'sugerenciaId', `${path}.${key}`)),
    operacion: operacionRaw as OperacionIA,
    pregunta:
      preguntaRaw === undefined ? undefined : numeroDePregunta(raw, 'pregunta', `${path}.${key}`),
    textos: stringArray(raw, 'textos', `${path}.${key}`),
    destino: decodeDestino(raw, 'destino', `${path}.${key}`),
  };
}

function encodeBody(payload: AssistantPayload): JsonObject {
  switch (payload.type) {
    case 'BorradorAbierto':
    case 'BorradorCerrado':
      return {};
    case 'RespuestaEscrita':
      return { pregunta: payload.pregunta, respuesta: encodeRespuesta(payload.respuesta) };
    case 'SugerenciaRecibida':
      return { sugerencia: encodeSugerencia(payload.sugerencia) };
    case 'SugerenciaAplicada':
      return {
        sugerenciaId: payload.sugerenciaId,
        pregunta: payload.pregunta,
        respuesta: encodeRespuesta(payload.respuesta),
      };
    case 'ConsentimientoDecidido':
      return { concedido: payload.concedido, destino: encodeDestino(payload.destino) };
  }
}

function decodeBody(type: string, body: JsonObject): AssistantPayload {
  switch (type) {
    case 'BorradorAbierto':
      return { type };
    case 'BorradorCerrado':
      return { type };
    case 'RespuestaEscrita':
      return {
        type,
        pregunta: numeroDePregunta(body, 'pregunta', type),
        respuesta: decodeRespuesta(body, 'respuesta', type),
      };
    case 'SugerenciaRecibida':
      return { type, sugerencia: decodeSugerencia(body, 'sugerencia', type) };
    case 'SugerenciaAplicada':
      return {
        type,
        sugerenciaId: toSugerenciaId(str(body, 'sugerenciaId', type)),
        pregunta: numeroDePregunta(body, 'pregunta', type),
        respuesta: decodeRespuesta(body, 'respuesta', type),
      };
    case 'ConsentimientoDecidido':
      return {
        type,
        concedido: bool(body, 'concedido', type),
        destino: decodeDestino(body, 'destino', type),
      };
    default:
      throw new AsistenteRepositorioError(`eventType: «${type}» no es un evento del asistente`);
  }
}

function encodeEvent(event: AssistantEvent): LedgerEventDraft {
  return {
    eventType: event.payload.type,
    eventVersion: ASSISTANT_EVENT_VERSION,
    occurredAt: instantToIso(event.occurredAt),
    // `actor: 'system'` se traduce OMITIENDO la clave, nunca poniéndola a `null` (§1.3.d, mismo
    // criterio que `workspace/codec.ts` y el códec de `rutas-evaluacion.ts`).
    ...(event.actor === 'system' ? {} : { actor: event.actor }),
    payload: { eventId: event.eventId, body: encodeBody(event.payload) },
  };
}

/**
 * `seq`, `prevHash` y `hash` NO se decodifican de la fila: se recalculan con `appendChained` a
 * partir de este cuerpo (ver `cargarBorrador`). Guardarlos permitiría que la copia y el original
 * discreparan sin que nadie lo notara — el mismo criterio que `workspace/repository.ts` y el códec
 * de `rutas-evaluacion.ts`.
 */
function decodeEvent(stored: StoredEvent): ChainedInput<AssistantPayload> {
  const evt = stored.event;
  if (evt.aggregateType !== ASSISTANT_AGGREGATE_TYPE) {
    throw new AsistenteRepositorioError(
      `aggregateType: ${evt.aggregateType} no es ${ASSISTANT_AGGREGATE_TYPE}`,
    );
  }
  const idRaw = evt.payload['eventId'];
  if (typeof idRaw !== 'string') {
    throw new AsistenteRepositorioError('payload.eventId: clave ausente');
  }
  const bodyRaw = evt.payload['body'];
  if (!isJsonObject(bodyRaw))
    throw new AsistenteRepositorioError('payload.body: se esperaba un objeto');
  return {
    eventId: toEventId(idRaw),
    aggregateId: evt.aggregateId,
    occurredAt: isoToInstant(evt.occurredAt),
    actor: evt.actor === undefined ? 'system' : toMemberId(evt.actor),
    payload: decodeBody(evt.eventType, bodyRaw),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura y escritura
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Rehidrata **recalculando** la cadena con `appendChained` a partir del cuerpo decodificado, nunca
 * confiando en `prevHash`/`hash` tal como llegaron de la fila: la propiedad que sostiene todo el
 * proyecto es que la copia y el original sólo coinciden si de verdad coinciden.
 */
async function cargarBorradorConCliente(client: PgClient, id: BorradorId): Promise<AssistantLog> {
  const stored = await readStream(client, id);
  let log: AssistantLog = [];
  for (const row of stored) {
    if (row.event.seq !== log.length) {
      throw new AsistenteRepositorioError(
        `hueco en el ledger de ${id}: se esperaba seq=${String(log.length)}`,
      );
    }
    log = [...log, await appendChained<AssistantPayload>(log, decodeEvent(row))];
  }
  return log;
}

/** Misma lectura, tomando su propio cliente del pool — la forma exacta que pide `ContextoAsistente`. */
export async function cargarBorrador(pool: PgPool, id: BorradorId): Promise<AssistantLog> {
  const client = await pool.connect();
  try {
    return await cargarBorradorConCliente(client, id);
  } finally {
    client.release();
  }
}

/**
 * Persiste **un** evento ya sellado (con `seq`/`prevHash`/`hash` calculados sobre el log que
 * `cargarBorrador` acaba de devolver), encadenándolo en `governance.event` con `aggregate_type =
 * 'assistant'`.
 *
 * `ContextoAsistente.guardarEvento` (`rutas-asistente.ts`, fuera de mi ámbito) no recibe un
 * `requestId` de quien llama — a diferencia del resto de las escrituras del proyecto, este módulo
 * no tiene un concepto de idempotencia de comando. `append` sí lo exige (§3.5 del ledger), así que
 * se deriva uno **posicional**: `${id}:${seq}`. Es la clave correcta para lo que hay que proteger
 * aquí — un reintento de red que repita la MISMA orden apunta al mismo `seq` aunque el `eventId`
 * que ella genere sea distinto cada vez (`ctx.idOpaco()` no es determinista) — y dos escrituras que
 * de verdad quieren ocupar el mismo `seq` ya chocan antes, en el `expectedHead`.
 */
export async function guardarEvento(
  pool: PgPool,
  id: BorradorId,
  evento: AssistantEvent,
): Promise<void> {
  let current: AggregateHead | undefined;
  const client = await pool.connect();
  try {
    current = await readHead(client, id);
  } finally {
    client.release();
  }
  const expectedHead: ExpectedHead =
    current === undefined ? { kind: 'new' } : { kind: 'at', seq: current.seq, hash: current.hash };
  const seqEsperado = current === undefined ? 1 : current.seq + 1;
  if (evento.seq !== seqEsperado) {
    throw new AsistenteRepositorioError(
      `el ledger de ${id} espera seq=${String(seqEsperado)} y llega uno con seq=` +
        `${String(evento.seq)}: no continúa donde el ledger se quedó`,
    );
  }
  await append(pool, {
    aggregateId: id,
    aggregateType: ASSISTANT_AGGREGATE_TYPE,
    events: [encodeEvent(evento)],
    expectedHead,
    requestId: `${id}:${String(evento.seq)}`,
  });
}

/**
 * Los borradores abiertos por `actor`. N+1 sobre `governance.event` — aceptable a esta escala
 * (~300 personas), el mismo criterio que ya documenta `rutas-evaluacion.ts` para `GET /aprendizajes`:
 * no hay índice por autor porque un borrador no tiene ACL propia (ADR-0052, la autoría se comprueba
 * en el pliegue, no en una tabla).
 */
export async function listarPropios(pool: PgPool, actor: MemberId): Promise<readonly BorradorId[]> {
  const client = await pool.connect();
  const propios: BorradorId[] = [];
  try {
    const ids = await listAggregateIds(client, ASSISTANT_AGGREGATE_TYPE);
    for (const id of ids) {
      const bid = toBorradorId(id);
      const log = await cargarBorradorConCliente(client, bid);
      if (log[0]?.actor === actor) propios.push(bid);
    }
  } finally {
    client.release();
  }
  return propios;
}
