/**
 * Rutas HTTP del cierre del ciclo (ADR-0053): evaluación contra criterios congelados, resultado
 * derivado y aprendizajes recuperables.
 *
 * `problema → deliberación → decisión → iniciativa → tareas → resultado → aprendizaje`. Hasta este
 * incremento el sistema llegaba a «tareas» y ahí se acababa: `packages/domain/src/evaluation`
 * (2.471 líneas, con sus pruebas) existía sin una sola ruta HTTP que lo alcanzara. Este fichero le
 * abre la puerta y no le toca ni una línea al motor.
 *
 * ═══ Ficheros nuevos, propiedad exclusiva de este incremento ═══
 *
 * No se edita `services/api/src/http/app.ts` ni `packages/contracts/src/index.ts`: los cuatro
 * ficheros de este incremento son nuevos y se integran en una fase posterior. Consecuencia directa,
 * y deliberada: este módulo **no depende de `@koinonia/contracts`** para validar sus cuerpos (el
 * índice del paquete no re-exporta todavía `evaluacion.ts`, y cruzar la frontera del paquete con una
 * ruta relativa habría sido peor que duplicar cuatro esquemas Zod pequeños). Tampoco depende de
 * `./service.ts` ni de `./app.ts`: la persistencia del agregado —codificador, decodificador y las
 * dos funciones de lectura/escritura del ledger— vive aquí, calcada del patrón exacto de
 * `workspace/repository.ts` y `workspace/codec.ts`, con menos generalidad porque sólo hay un tipo
 * de agregado que persistir.
 *
 * ═══ Una decisión de diseño que no está en el dominio: el id de la evaluación se DERIVA ═══
 *
 * El dominio no ata la evaluación a la iniciativa por su identificador; los ata por los campos que
 * `EvaluationOpened` sella (`initiativeId`, `planHash`, …). El ADR es explícito en que **sólo existe
 * una evaluación por fecha de revisión y ninguna reapertura** (§ «Consecuencias negativas
 * aceptadas»), y el plan de ejecución de una iniciativa no cambia después de ratificada (ADR-0043):
 * para una iniciativa hay como mucho una evaluación viva a la vez, y `GET /iniciativas/:id/evaluacion`
 * necesita saber qué agregado leer sin una tabla de índice aparte. `derivedEvaluationId` resuelve
 * eso con una huella determinista del id de la iniciativa —**no** el mismo id: ver el porqué justo
 * encima de esa función, que es una lección de una prueba de integración real, no una preferencia
 * de estilo—. El día que el proyecto necesite evaluaciones sucesivas sobre la misma iniciativa (una
 * segunda fecha de revisión tras `enmendar`), esta derivación 1:1 es lo primero que hay que romper.
 *
 * ═══ Autorización ═══
 *
 * Ni una línea de este fichero decide quién puede hacer qué: cada orden del dominio llama a
 * `authorizeEvaluation` por dentro (`packages/domain/src/evaluation/commands.ts`), con las siete
 * filas provisionales de `PROPOSED_EVALUATION_ACCESS_RULES` mientras `access.ts` no las incorpora.
 * Este módulo sólo traduce `EvaluationUnauthorizedError` a un estado HTTP (401 si falta identidad,
 * 403 si no alcanza), exactamente como hace `services/api/src/http/app.ts` con `UnauthorizedError`.
 */

import { createHash } from 'node:crypto';

import type { JsonObject, JsonValue } from '@koinonia/crypto';
import {
  AGREEMENT_DISPOSITIONS,
  type AgreementDisposition,
  type Actor,
  appendChained,
  assessCriterionBy,
  type ChainedInput,
  circleId as toCircleId,
  CRITERION_VERDICTS,
  type CriterionAssessed,
  type CriterionVerdict,
  closeEvaluationBy,
  decisionId as toDecisionId,
  discrepancyNotice,
  ESCALATION_PRESCRIPTION_MS,
  ESCALATION_RUNGS,
  ESCALATION_TARGET_KINDS,
  type EscalationRecord,
  type EscalationRung,
  type EscalationTargetKind,
  escalateEvaluationBy,
  EVALUATION_OUTCOMES,
  type EvaluationCommandMeta,
  type EvaluationDiscrepancy,
  type EvaluationEvent,
  evaluationId as toEvaluationId,
  type EvaluationLog,
  type EvaluationOutcome,
  type EvaluationPayload,
  evaluationReport,
  type EvaluationReport,
  EvaluationUnauthorizedError,
  eventId as toEventId,
  type EventId,
  findLearnings,
  freezeSuccessCriteria,
  type FrozenCriteria,
  hash as toHash,
  type InitiativeState,
  initiativeId as toInitiativeId,
  instant,
  LEARNING_KINDS,
  type LearningIndexEntry,
  type LearningKind,
  type LearningRecord,
  learningId as toLearningId,
  learningsOf,
  learningTag as toLearningTag,
  MAX_LEARNING_STATEMENT_LENGTH,
  MAX_LEARNING_TAGS,
  memberId as toMemberId,
  MIN_LEARNING_STATEMENT_LENGTH,
  openEvaluationBy,
  OUTCOME_CRITERION_EVIDENCE,
  type OutcomeCriterionEvidence,
  proposalId as toProposalId,
  publishEvaluationResultBy,
  recordLearningBy,
  replayEvaluation,
  taskId as toTaskId,
  type TaskId,
  verifyEvaluationLog,
  verifyInitiativeLog,
} from '@koinonia/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { PgClient, PgPool } from '../db/client.js';
import { append, readHead, readStream } from '../ledger/event-store.js';
import type {
  AggregateHead,
  ExpectedHead,
  LedgerEventDraft,
  StoredEvent,
} from '../ledger/types.js';
import { instantToIso, isoToInstant } from '../decision/codec.js';
import { resolveSession } from './identity.js';
import type { AuthenticatedMember, ClockPort, RandomPort } from './ports.js';
import { consume, REGLA_ESCRITURA, requestIdDeCuerpo, type RateRule } from './rate-limit.js';
import { loadInitiativeLog, listAggregateIds } from '../workspace/repository.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que esta ruta necesita del ámbito de `buildApp`, y nada más
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ContextoEvaluacion {
  readonly pool: PgPool;
  readonly ports: {
    readonly clock: ClockPort;
    readonly random: RandomPort;
  };
  /** Secreto del despliegue del que se deriva la pimienta diaria del control de abuso. */
  readonly ratePepper: string;
  readonly reglaEscritura?: RateRule;
}

/** Error de esta capa HTTP, con el mismo contrato que `ServicioError` de `service.ts`. */
export class EvaluacionRutaError extends Error {
  readonly codigo: string;
  readonly estado: number;

  constructor(codigo: string, estado: number, mensaje: string) {
    super(mensaje);
    this.name = 'EvaluacionRutaError';
    this.codigo = codigo;
    this.estado = estado;
  }
}

function traducirError(
  error: unknown,
): { readonly estado: number; readonly codigo: string; readonly mensaje: string } | undefined {
  if (error instanceof EvaluacionRutaError) {
    return { estado: error.estado, codigo: error.codigo, mensaje: error.message };
  }
  if (error instanceof EvaluationUnauthorizedError) {
    // 401 si falta identidad, 403 si la identidad no alcanza — misma distinción que app.ts hace
    // para `UnauthorizedError`, y la comparte porque la persona que lee no distingue las dos clases.
    return {
      estado: error.reason === 'NOT_AUTHENTICATED' ? 401 : 403,
      codigo: error.code,
      mensaje: error.message,
    };
  }
  return undefined;
}

/** Envuelve un handler para que un error propio de esta capa se traduzca antes de llegar a Fastify. */
function conTraduccion(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      const traducido = traducirError(error);
      if (traducido === undefined) throw error;
      return await reply
        .status(traducido.estado)
        .send({ codigo: traducido.codigo, mensaje: traducido.mensaje });
    }
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Quién llama, y el cupo de escritura
//
// Copia deliberada del patrón de `app.ts`: la identidad se resuelve del portador `Bearer`, nunca de
// una cookie —esta ruta no depende de que `@fastify/cookie` esté registrado— y no decide nada por
// sí misma. Cuando se integre en `app.ts`, `request.quien` ya viene resuelto por su propio `hook` y
// éste no vuelve a golpear la base: sólo resuelve si todavía no hay nadie.
// ═════════════════════════════════════════════════════════════════════════════════════════════

const ACTOR_ANONIMO: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

async function quienLlama(
  ctx: ContextoEvaluacion,
  request: FastifyRequest,
): Promise<AuthenticatedMember | undefined> {
  const yaResuelto = (request as FastifyRequest & { quien?: AuthenticatedMember }).quien;
  if (yaResuelto !== undefined) return yaResuelto;
  const cabecera = request.headers.authorization;
  const token = cabecera?.startsWith('Bearer ') === true ? cabecera.slice(7) : undefined;
  if (token === undefined || token === '') return undefined;
  const client = await ctx.pool.connect();
  try {
    return await resolveSession(client, token, ctx.ports.clock);
  } finally {
    client.release();
  }
}

function actorDe(quien: AuthenticatedMember | undefined): Actor {
  if (quien === undefined) return ACTOR_ANONIMO;
  return { memberId: quien.memberId, roles: quien.roles, circles: quien.circles };
}

/** Cupo de escritura por persona. Igual que `app.ts`: sin IP, el sujeto es el `MemberId`. */
async function cupoDeEscritura(
  ctx: ContextoEvaluacion,
  quien: AuthenticatedMember | undefined,
  request?: FastifyRequest,
): Promise<void> {
  if (quien === undefined) return;
  const client = await ctx.pool.connect();
  try {
    const veredicto = await consume(client, {
      secret: ctx.ratePepper,
      regla: ctx.reglaEscritura ?? REGLA_ESCRITURA,
      sujeto: quien.memberId,
      clock: ctx.ports.clock,
      requestId: requestIdDeCuerpo(request?.body),
    });
    if (!veredicto.permitido) {
      throw new EvaluacionRutaError(
        'DEMASIADOS_INTENTOS',
        429,
        'escribiste muchas cosas seguidas; esperá un momento',
      );
    }
  } finally {
    client.release();
  }
}

/** Parsea con Zod y deja que el `ZodError` lo traduzca el manejador de errores del `app`. */
function parse<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Codificador ⇄ decodificador del agregado de evaluación
//
// Mismo principio que `workspace/codec.ts`: el decodificador valida, no acomoda. Aquí hay un solo
// tipo de agregado, así que no hace falta la abstracción `Codec<P>` genérica de
// `workspace/repository.ts`: está escrita a mano, calcada, y con menos partes móviles.
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const EVALUATION_AGGREGATE_TYPE = 'evaluation';
const EVALUATION_EVENT_VERSION = 1;

/**
 * El identificador de la evaluación de una iniciativa, derivado del de la iniciativa.
 *
 * **No es el mismo id.** `governance.aggregate_head` usa `aggregate_id` como clave primaria
 * **global**, sin `aggregate_type` en la clave (`services/api/migrations/0001_governance_ledger.sql`,
 * línea 168); lo mismo vale para `governance.event` (`event_agg_seq_uk UNIQUE (aggregate_id, seq)`,
 * sin el tipo). Reutilizar el id de la iniciativa como id de la evaluación no es sólo una idea
 * fea: la evaluación no llega a nacer, porque su génesis choca contra la cabeza que la iniciativa
 * ya dejó en esa misma fila. (Se descubrió así: una prueba de integración contra PostgreSQL real
 * reventó con «aggregateType: initiative no es evaluation» al leer lo que debía ser el ledger de
 * la evaluación y resultó ser, otra vez, el de la iniciativa.)
 *
 * Se deriva en cambio con una huella no reversible, para conservar la propiedad que sí hacía falta
 * —encontrar en O(1) la evaluación de una iniciativa sin inventar una tabla de índice aparte— sin
 * pisar la clave de nadie. Es determinista: la misma iniciativa produce siempre la misma
 * evaluación, y por eso `GET /iniciativas/:id/evaluacion` no necesita buscarla.
 */
function derivedEvaluationId(iniciativaId: string): string {
  return createHash('sha256')
    .update(`koinonia:evaluation:${iniciativaId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

class EvaluacionCodecError extends Error {
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'EvaluacionCodecError';
  }
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(source: JsonObject, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== 'string')
    throw new EvaluacionCodecError(`${path}.${key}`, 'se esperaba texto');
  return value;
}

function optStr(source: JsonObject, key: string, path: string): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string')
    throw new EvaluacionCodecError(`${path}.${key}`, 'se esperaba texto');
  return value;
}

function int(source: JsonObject, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new EvaluacionCodecError(`${path}.${key}`, 'se esperaba un entero seguro');
  }
  return value;
}

function stringArray(source: JsonObject, key: string, path: string): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value))
    throw new EvaluacionCodecError(`${path}.${key}`, 'se esperaba un arreglo');
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new EvaluacionCodecError(`${path}.${key}[${String(index)}]`, 'se esperaba texto');
    }
    return item;
  });
}

function oneOf<T extends string>(value: string, allowed: readonly T[], path: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new EvaluacionCodecError(path, `${value} no está en {${allowed.join(', ')}}`);
  }
  return value as T;
}

function encodeEvaluationBody(payload: EvaluationPayload): JsonObject {
  switch (payload.type) {
    case 'EvaluationOpened':
      return {
        initiativeId: payload.initiativeId,
        decisionId: payload.decisionId,
        proposalId: payload.proposalId,
        circleId: payload.circleId,
        planHash: payload.planHash,
        criteriaCount: payload.criteriaCount,
        reviewAt: payload.reviewAt,
      };
    case 'CriterionAssessed':
      return {
        criterionIndex: payload.criterionIndex,
        verdict: payload.verdict,
        evidence: payload.evidence,
        ...(payload.evidenceRef === undefined ? {} : { evidenceRef: payload.evidenceRef }),
      };
    case 'EvaluationEscalated':
      return {
        criterionIndex: payload.criterionIndex,
        rung: payload.rung,
        targetKind: payload.targetKind,
        ...(payload.taskId === undefined ? {} : { taskId: payload.taskId }),
      };
    case 'LearningRecorded':
      return {
        learningId: payload.learningId,
        kind: payload.kind,
        statement: payload.statement,
        tags: [...payload.tags],
      };
    case 'EvaluationResultPublished':
      return { outcome: payload.outcome, outcomeHash: payload.outcomeHash };
    case 'EvaluationClosed':
      return {
        disposition: payload.disposition,
        ...(payload.nextReviewAt === undefined ? {} : { nextReviewAt: payload.nextReviewAt }),
      };
  }
}

function decodeEvaluationBody(type: string, body: JsonObject): EvaluationPayload {
  switch (type) {
    case 'EvaluationOpened':
      return {
        type,
        initiativeId: toInitiativeId(str(body, 'initiativeId', type)),
        decisionId: toDecisionId(str(body, 'decisionId', type)),
        proposalId: toProposalId(str(body, 'proposalId', type)),
        circleId: toCircleId(str(body, 'circleId', type)),
        planHash: toHash(str(body, 'planHash', type)),
        criteriaCount: int(body, 'criteriaCount', type),
        reviewAt: instant(int(body, 'reviewAt', type)),
      };
    case 'CriterionAssessed': {
      const evidenceRef = optStr(body, 'evidenceRef', type);
      return {
        type,
        criterionIndex: int(body, 'criterionIndex', type),
        verdict: oneOf<CriterionVerdict>(
          str(body, 'verdict', type),
          CRITERION_VERDICTS,
          `${type}.verdict`,
        ),
        evidence: oneOf<OutcomeCriterionEvidence>(
          str(body, 'evidence', type),
          OUTCOME_CRITERION_EVIDENCE,
          `${type}.evidence`,
        ),
        ...(evidenceRef === undefined ? {} : { evidenceRef: toEventId(evidenceRef) }),
      };
    }
    case 'EvaluationEscalated': {
      const taskIdRaw = optStr(body, 'taskId', type);
      return {
        type,
        criterionIndex: int(body, 'criterionIndex', type),
        rung: oneOf<EscalationRung>(str(body, 'rung', type), ESCALATION_RUNGS, `${type}.rung`),
        targetKind: oneOf<EscalationTargetKind>(
          str(body, 'targetKind', type),
          ESCALATION_TARGET_KINDS,
          `${type}.targetKind`,
        ),
        ...(taskIdRaw === undefined ? {} : { taskId: toTaskId(taskIdRaw) }),
      };
    }
    case 'LearningRecorded':
      return {
        type,
        learningId: toLearningId(str(body, 'learningId', type)),
        kind: oneOf<LearningKind>(str(body, 'kind', type), LEARNING_KINDS, `${type}.kind`),
        statement: str(body, 'statement', type),
        tags: stringArray(body, 'tags', type).map((tag) => toLearningTag(tag)),
      };
    case 'EvaluationResultPublished':
      return {
        type,
        outcome: oneOf<EvaluationOutcome>(
          str(body, 'outcome', type),
          EVALUATION_OUTCOMES,
          `${type}.outcome`,
        ),
        outcomeHash: toHash(str(body, 'outcomeHash', type)),
      };
    case 'EvaluationClosed': {
      const nextReviewAtRaw = body['nextReviewAt'];
      return {
        type,
        disposition: oneOf<AgreementDisposition>(
          str(body, 'disposition', type),
          AGREEMENT_DISPOSITIONS,
          `${type}.disposition`,
        ),
        ...(nextReviewAtRaw === undefined
          ? {}
          : { nextReviewAt: instant(int(body, 'nextReviewAt', type)) }),
      };
    }
    default:
      throw new EvaluacionCodecError(
        'eventType',
        `${type} no es lo que se esperaba de una evaluación`,
      );
  }
}

function encodeEvaluationEvent(event: EvaluationEvent): LedgerEventDraft {
  return {
    eventType: event.payload.type,
    eventVersion: EVALUATION_EVENT_VERSION,
    occurredAt: instantToIso(event.occurredAt),
    // `actor: 'system'` se traduce OMITIENDO la clave, jamás poniéndola a `null` (§1.3.d).
    ...(event.actor === 'system' ? {} : { actor: event.actor }),
    payload: { eventId: event.eventId, body: encodeEvaluationBody(event.payload) },
  };
}

function decodeEvaluationEvent(stored: StoredEvent): ChainedInput<EvaluationPayload> {
  const evt = stored.event;
  if (evt.aggregateType !== EVALUATION_AGGREGATE_TYPE) {
    throw new EvaluacionCodecError(
      'aggregateType',
      `${evt.aggregateType} no es ${EVALUATION_AGGREGATE_TYPE}`,
    );
  }
  const idRaw = evt.payload['eventId'];
  if (typeof idRaw !== 'string') throw new EvaluacionCodecError('payload.eventId', 'clave ausente');
  const bodyRaw = evt.payload['body'];
  if (!isJsonObject(bodyRaw))
    throw new EvaluacionCodecError('payload.body', 'se esperaba un objeto');
  return {
    eventId: toEventId(idRaw),
    aggregateId: evt.aggregateId,
    occurredAt: isoToInstant(evt.occurredAt),
    actor: evt.actor === undefined ? 'system' : toMemberId(evt.actor),
    payload: decodeEvaluationBody(evt.eventType, bodyRaw),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Persistencia — mismo patrón que `persist`/`load` de `workspace/repository.ts`
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface EvaluacionPersistResult {
  readonly aggregateId: string;
  readonly appended: number;
  readonly head: AggregateHead | undefined;
}

function pendienteDesde(
  log: EvaluationLog,
  current: AggregateHead | undefined,
): {
  readonly aggregateId: string;
  readonly pending: EvaluationLog;
  readonly expectedHead: ExpectedHead;
} {
  const first = log[0];
  if (first === undefined)
    throw new EvaluacionRutaError('EMPTY_LOG', 500, 'un log vacío no identifica nada');
  const aggregateId = first.aggregateId;
  const persisted = current === undefined ? 0 : current.seq + 1;
  if (persisted > log.length) {
    // Igual que en 'LEDGER_GAP' más abajo: este código no tiene traducción en `MENSAJES`, así que
    // el mensaje llega tal cual a pantalla (ADR-0041) — sin vocabulario del motor.
    throw new EvaluacionRutaError(
      'LEDGER_AHEAD_OF_LOG',
      500,
      `el historial tiene ${String(persisted)} hechos registrados de ${aggregateId} y lo que se ` +
        `escribió trae ${String(log.length)}`,
    );
  }
  const pending = log.slice(persisted);
  for (const [offset, event] of pending.entries()) {
    const expected = persisted + offset + 1;
    if (event.seq !== expected || event.aggregateId !== aggregateId) {
      throw new EvaluacionRutaError(
        'LOG_DISCONTINUOUS',
        500,
        'lo que se escribió no continúa donde el historial se quedó, o mezcla hechos de dos agregados',
      );
    }
  }
  const expectedHead: ExpectedHead =
    current === undefined ? { kind: 'new' } : { kind: 'at', seq: current.seq, hash: current.hash };
  return { aggregateId, pending, expectedHead };
}

async function persistEvaluationLog(
  pool: PgPool,
  log: EvaluationLog,
  options: { readonly requestId: string },
): Promise<EvaluacionPersistResult> {
  const first = log[0];
  if (first === undefined)
    throw new EvaluacionRutaError('EMPTY_LOG', 500, 'un log vacío no identifica nada');
  const client = await pool.connect();
  let current: AggregateHead | undefined;
  try {
    current = await readHead(client, first.aggregateId);
  } finally {
    client.release();
  }
  const prepared = pendienteDesde(log, current);
  if (prepared.pending.length === 0) {
    return { aggregateId: prepared.aggregateId, appended: 0, head: current };
  }
  const result = await append(pool, {
    aggregateId: prepared.aggregateId,
    aggregateType: EVALUATION_AGGREGATE_TYPE,
    events: prepared.pending.map(encodeEvaluationEvent),
    expectedHead: prepared.expectedHead,
    requestId: options.requestId,
  });
  return {
    aggregateId: prepared.aggregateId,
    appended: prepared.pending.length,
    head: result.head,
  };
}

/**
 * Rehidrata decodificando en orden y **recalculando** `seq`, `prevHash` y `hash` con
 * `appendChained` a partir del cuerpo decodificado — nunca leyendo el hash guardado. Es la misma
 * elección de `workspace/repository.ts`: la copia y el original sólo coinciden si de verdad
 * coinciden, y eso se demuestra recalculando, no confiando en la columna.
 */
async function loadEvaluationLog(client: PgClient, id: string): Promise<EvaluationLog> {
  const stored = await readStream(client, id);
  let log: EvaluationLog = [];
  for (const row of stored) {
    if (row.event.seq !== log.length) {
      // 'LEDGER_GAP' es el código estable para el registro; el mensaje —lo único que puede llegar
      // a `mensaje: error.message` sin pasar por un catálogo de traducción, porque este código no
      // está en `MENSAJES`— no puede nombrar la mecánica del motor (ADR-0041).
      throw new EvaluacionRutaError('LEDGER_GAP', 500, `hueco en el historial de ${id}`);
    }
    log = [...log, await appendChained<EvaluationPayload>(log, decodeEvaluationEvent(row))];
  }
  return log;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Carga combinada: la iniciativa (para congelar los criterios) y la evaluación
// ═════════════════════════════════════════════════════════════════════════════════════════════

async function cargarIniciativa(client: PgClient, iniciativaId: string): Promise<InitiativeState> {
  const log = await loadInitiativeLog(client, iniciativaId);
  if (log.length === 0) {
    throw new EvaluacionRutaError('NO_ENCONTRADO', 404, 'no existe esa iniciativa');
  }
  return await verifyInitiativeLog(log);
}

async function cargarEvaluacionAbierta(
  ctx: ContextoEvaluacion,
  iniciativaId: string,
): Promise<{
  readonly initiative: InitiativeState;
  readonly frozen: FrozenCriteria;
  readonly log: EvaluationLog;
}> {
  const client = await ctx.pool.connect();
  try {
    const initiative = await cargarIniciativa(client, iniciativaId);
    const frozen = await freezeSuccessCriteria(initiative.executionPlan);
    const log = await loadEvaluationLog(client, derivedEvaluationId(iniciativaId));
    if (log.length === 0) {
      throw new EvaluacionRutaError(
        'EVALUATION_NOT_OPENED',
        404,
        'todavía no se abrió la evaluación de esta iniciativa; convocala antes de valorar nada',
      );
    }
    return { initiative, frozen, log };
  } finally {
    client.release();
  }
}

function nuevaMeta(ctx: ContextoEvaluacion, actor: Actor): EvaluationCommandMeta {
  return {
    eventId: toEventId(ctx.ports.random.opaqueId()),
    at: instant(ctx.ports.clock.now()),
    by: actor,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lo que se enseña: del informe del dominio a JSON sin nadie dentro
// ═════════════════════════════════════════════════════════════════════════════════════════════

function discrepanciaDto(discrepancy: EvaluationDiscrepancy): JsonObject {
  return {
    motivo:
      discrepancy.reason === 'outcome-mismatch' ? 'resultado-no-coincide' : 'huella-no-coincide',
    publicado: discrepancy.published,
    recalculado: discrepancy.recomputed,
    explicacion: discrepancyNotice(discrepancy),
  };
}

function learningDto(learning: LearningRecord): JsonObject {
  return {
    id: learning.learningId,
    tipo: learning.kind,
    enunciado: learning.statement,
    etiquetas: [...learning.tags],
    en: learning.at,
  };
}

function escaladaDto(escalation: EscalationRecord, ahora: number): JsonObject {
  return {
    id: escalation.escalationId,
    indiceDeCriterio: escalation.criterionIndex,
    escalon: escalation.rung,
    objeto: escalation.targetKind,
    ...(escalation.taskId === undefined ? {} : { tareaId: escalation.taskId }),
    en: escalation.at,
    vigente: ahora - escalation.at < ESCALATION_PRESCRIPTION_MS,
  };
}

function informeDto(report: EvaluationReport, ahora: number): JsonObject {
  return {
    evaluacionId: report.evaluationId,
    iniciativaId: report.initiativeId,
    huellaDelPlan: report.planHash,
    estado: report.status,
    revisarEn: report.reviewAt,
    desenlace: report.outcome,
    ...(report.publishedOutcome === undefined
      ? {}
      : { desenlacePublicado: report.publishedOutcome }),
    ...(report.discrepancy === undefined
      ? {}
      : { discrepancia: discrepanciaDto(report.discrepancy) }),
    criterios: report.criteria.map((criterion) => ({
      indice: criterion.index,
      descripcion: criterion.description,
      fuenteDeVerificacion: criterion.evidenceSource,
      ...(criterion.verdict === undefined ? {} : { veredicto: criterion.verdict }),
      ...(criterion.evidenceRef === undefined
        ? {}
        : { hechoQueLoSostieneId: criterion.evidenceRef }),
    })),
    ...(report.metShare === undefined
      ? {}
      : {
          proporcionCumplida: {
            numerador: Number(report.metShare.num),
            denominador: Number(report.metShare.den),
          },
        }),
    aprendizajes: report.learnings.map(learningDto),
    escaladas: report.escalations.map((escalation) => escaladaDto(escalation, ahora)),
    ...(report.disposition === undefined ? {} : { disposicion: report.disposition }),
    narrativa: report.narrative,
  };
}

function entradaDeMemoriaDto(entry: LearningIndexEntry): JsonObject {
  return {
    evaluacionId: entry.evaluationId,
    iniciativaId: entry.initiativeId,
    decisionId: entry.decisionId,
    propuestaId: entry.proposalId,
    circuloId: entry.circleId,
    desenlace: entry.outcome,
    ...(entry.disposition === undefined ? {} : { disposicion: entry.disposition }),
    aprendizaje: learningDto(entry.learning),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Cuerpos de petición — esquemas locales, no importados de `@koinonia/contracts` (ver cabecera)
// ═════════════════════════════════════════════════════════════════════════════════════════════

const REQUEST_ID = z.uuid();
const OPAQUE_ID = z.string().regex(/^[0-9a-f]{32}$/u);

const paramsIniciativa = z.object({ id: z.string() });
const paramsCriterio = z.object({ id: z.string(), indice: z.coerce.number().int().nonnegative() });

const abrirBody = z.object({ requestId: REQUEST_ID }).strict();
const valorarBody = z
  .object({
    requestId: REQUEST_ID,
    veredicto: z.enum(CRITERION_VERDICTS),
    evidencia: z.enum(OUTCOME_CRITERION_EVIDENCE),
    hechoQueLoSostieneId: OPAQUE_ID.optional(),
  })
  .strict();
const escalarBody = z
  .object({
    requestId: REQUEST_ID,
    escalon: z.enum(ESCALATION_RUNGS),
    objeto: z.enum(ESCALATION_TARGET_KINDS),
    tareaId: OPAQUE_ID.optional(),
  })
  .strict();
const anotarBody = z
  .object({
    requestId: REQUEST_ID,
    tipo: z.enum(LEARNING_KINDS),
    enunciado: z.string().min(MIN_LEARNING_STATEMENT_LENGTH).max(MAX_LEARNING_STATEMENT_LENGTH),
    etiquetas: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/u)).max(MAX_LEARNING_TAGS),
  })
  .strict();
const publicarBody = z.object({ requestId: REQUEST_ID }).strict();
const cerrarBody = z
  .object({
    requestId: REQUEST_ID,
    disposicion: z.enum(AGREEMENT_DISPOSITIONS),
    proximaRevisionEn: z.number().int().nonnegative().optional(),
  })
  .strict();
const consultaAprendizajes = z.object({
  etiqueta: z.string().optional(),
  tipo: z.enum(LEARNING_KINDS).optional(),
  desenlace: z.enum(EVALUATION_OUTCOMES).optional(),
  circuloId: OPAQUE_ID.optional(),
  decisionId: OPAQUE_ID.optional(),
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las rutas
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Registra las rutas de evaluación sobre un `FastifyInstance` ya existente.
 *
 * No llama a `app.setErrorHandler`: usar eso aquí pisaría el manejador global que ya instala
 * `app.ts` para las otras sesenta y tantas rutas. Cada handler traduce sus propios errores
 * conocidos (`EvaluacionRutaError`, `EvaluationUnauthorizedError`) con `conTraduccion` y deja pasar
 * cualquier otro (`DomainError`, `z.ZodError`, …) para que lo resuelva el manejador que ya exista en
 * el `app` que lo integre; en un `app` desnudo sin manejador propio, Fastify los convierte en 500 —
 * comportamiento estándar y suficiente para un incremento que todavía no está integrado.
 */
export function registrarRutasDeEvaluacion(app: FastifyInstance, ctx: ContextoEvaluacion): void {
  // ── Abrir ──────────────────────────────────────────────────────────────────────────────────
  app.post(
    '/iniciativas/:id/evaluacion',
    conTraduccion(async (request, reply) => {
      const quien = await quienLlama(ctx, request);
      await cupoDeEscritura(ctx, quien, request);
      const { id } = parse(paramsIniciativa, request.params);
      const body = parse(abrirBody, request.body);

      const client = await ctx.pool.connect();
      let initiative: InitiativeState;
      try {
        initiative = await cargarIniciativa(client, id);
        const yaAbierta = await loadEvaluationLog(client, derivedEvaluationId(id));
        if (yaAbierta.length > 0) {
          throw new EvaluacionRutaError(
            'EVALUATION_ALREADY_OPENED',
            409,
            'ya existe una evaluación para esta iniciativa; para corregir algo, valorá los ' +
              'criterios de la que está en curso',
          );
        }
      } finally {
        client.release();
      }

      const frozen = await freezeSuccessCriteria(initiative.executionPlan);
      const actor = actorDe(quien);
      const meta = nuevaMeta(ctx, actor);
      const log = await openEvaluationBy(
        meta,
        { evaluationId: toEvaluationId(derivedEvaluationId(id)), initiative },
        frozen,
      );
      await persistEvaluationLog(ctx.pool, log, { requestId: body.requestId });
      const state = replayEvaluation(log, frozen);
      return await reply
        .status(201)
        .send(informeDto(evaluationReport(state, frozen), ctx.ports.clock.now()));
    }),
  );

  // ── Leer el informe ────────────────────────────────────────────────────────────────────────
  app.get(
    '/iniciativas/:id/evaluacion',
    conTraduccion(async (request) => {
      const { id } = parse(paramsIniciativa, request.params);
      const client = await ctx.pool.connect();
      try {
        const initiative = await cargarIniciativa(client, id);
        const frozen = await freezeSuccessCriteria(initiative.executionPlan);
        const log = await loadEvaluationLog(client, derivedEvaluationId(id));
        if (log.length === 0) {
          throw new EvaluacionRutaError(
            'EVALUATION_NOT_OPENED',
            404,
            'todavía no se abrió la evaluación de esta iniciativa',
          );
        }
        const state = await verifyEvaluationLog(log, frozen);
        return informeDto(evaluationReport(state, frozen), ctx.ports.clock.now());
      } finally {
        client.release();
      }
    }),
  );

  // ── Valorar un criterio ────────────────────────────────────────────────────────────────────
  app.post(
    '/iniciativas/:id/evaluacion/criterios/:indice/valoracion',
    conTraduccion(async (request, reply) => {
      const quien = await quienLlama(ctx, request);
      await cupoDeEscritura(ctx, quien, request);
      const { id, indice } = parse(paramsCriterio, request.params);
      const body = parse(valorarBody, request.body);
      const { frozen, log } = await cargarEvaluacionAbierta(ctx, id);
      const meta = nuevaMeta(ctx, actorDe(quien));
      const input: {
        readonly criterionIndex: number;
        readonly verdict: CriterionVerdict;
        readonly evidence: CriterionAssessed['evidence'];
        readonly evidenceRef?: EventId;
      } = {
        criterionIndex: indice,
        verdict: body.veredicto,
        evidence: body.evidencia,
        ...(body.hechoQueLoSostieneId === undefined
          ? {}
          : { evidenceRef: toEventId(body.hechoQueLoSostieneId) }),
      };
      const nextLog = await assessCriterionBy(log, meta, input, frozen);
      await persistEvaluationLog(ctx.pool, nextLog, { requestId: body.requestId });
      const state = replayEvaluation(nextLog, frozen);
      return await reply
        .status(201)
        .send(informeDto(evaluationReport(state, frozen), ctx.ports.clock.now()));
    }),
  );

  // ── Escalar ────────────────────────────────────────────────────────────────────────────────
  app.post(
    '/iniciativas/:id/evaluacion/criterios/:indice/escaladas',
    conTraduccion(async (request, reply) => {
      const quien = await quienLlama(ctx, request);
      await cupoDeEscritura(ctx, quien, request);
      const { id, indice } = parse(paramsCriterio, request.params);
      const body = parse(escalarBody, request.body);
      const { frozen, log } = await cargarEvaluacionAbierta(ctx, id);
      const meta = nuevaMeta(ctx, actorDe(quien));
      const input: {
        readonly criterionIndex: number;
        readonly rung: EscalationRung;
        readonly targetKind: EscalationTargetKind;
        readonly taskId?: TaskId;
      } = {
        criterionIndex: indice,
        rung: body.escalon,
        targetKind: body.objeto,
        ...(body.tareaId === undefined ? {} : { taskId: toTaskId(body.tareaId) }),
      };
      const nextLog = await escalateEvaluationBy(log, meta, input, frozen);
      await persistEvaluationLog(ctx.pool, nextLog, { requestId: body.requestId });
      const state = replayEvaluation(nextLog, frozen);
      return await reply
        .status(201)
        .send(informeDto(evaluationReport(state, frozen), ctx.ports.clock.now()));
    }),
  );

  // ── Anotar un aprendizaje ──────────────────────────────────────────────────────────────────
  app.post(
    '/iniciativas/:id/evaluacion/aprendizajes',
    conTraduccion(async (request, reply) => {
      const quien = await quienLlama(ctx, request);
      await cupoDeEscritura(ctx, quien, request);
      const { id } = parse(paramsIniciativa, request.params);
      const body = parse(anotarBody, request.body);
      const { frozen, log } = await cargarEvaluacionAbierta(ctx, id);
      const meta = nuevaMeta(ctx, actorDe(quien));
      const nextLog = await recordLearningBy(
        log,
        meta,
        {
          learningId: toLearningId(ctx.ports.random.opaqueId()),
          kind: body.tipo,
          statement: body.enunciado,
          tags: [...body.etiquetas].sort().map((tag) => toLearningTag(tag)),
        },
        frozen,
      );
      await persistEvaluationLog(ctx.pool, nextLog, { requestId: body.requestId });
      const state = replayEvaluation(nextLog, frozen);
      return await reply
        .status(201)
        .send(informeDto(evaluationReport(state, frozen), ctx.ports.clock.now()));
    }),
  );

  // ── Publicar el resultado ──────────────────────────────────────────────────────────────────
  app.post(
    '/iniciativas/:id/evaluacion/publicacion',
    conTraduccion(async (request, reply) => {
      const quien = await quienLlama(ctx, request);
      await cupoDeEscritura(ctx, quien);
      const { id } = parse(paramsIniciativa, request.params);
      const body = parse(publicarBody, request.body);
      const { frozen, log } = await cargarEvaluacionAbierta(ctx, id);
      const meta = nuevaMeta(ctx, actorDe(quien));
      const nextLog = await publishEvaluationResultBy(log, meta, frozen);
      await persistEvaluationLog(ctx.pool, nextLog, { requestId: body.requestId });
      const state = replayEvaluation(nextLog, frozen);
      return await reply
        .status(201)
        .send(informeDto(evaluationReport(state, frozen), ctx.ports.clock.now()));
    }),
  );

  // ── Cerrar ─────────────────────────────────────────────────────────────────────────────────
  app.post(
    '/iniciativas/:id/evaluacion/cierre',
    conTraduccion(async (request, reply) => {
      const quien = await quienLlama(ctx, request);
      await cupoDeEscritura(ctx, quien);
      const { id } = parse(paramsIniciativa, request.params);
      const body = parse(cerrarBody, request.body);
      const { frozen, log } = await cargarEvaluacionAbierta(ctx, id);
      const meta = nuevaMeta(ctx, actorDe(quien));
      const nextLog = await closeEvaluationBy(
        log,
        meta,
        {
          disposition: body.disposicion,
          ...(body.proximaRevisionEn === undefined
            ? {}
            : { nextReviewAt: instant(body.proximaRevisionEn) }),
        },
        frozen,
      );
      await persistEvaluationLog(ctx.pool, nextLog, { requestId: body.requestId });
      const state = replayEvaluation(nextLog, frozen);
      return await reply
        .status(200)
        .send(informeDto(evaluationReport(state, frozen), ctx.ports.clock.now()));
    }),
  );

  // ── La memoria institucional: «¿esto ya se intentó?» ──────────────────────────────────────
  //
  // Recorre todos los agregados de evaluación uno por uno. Para el tamaño de este proyecto (unos
  // cientos de iniciativas a lo sumo) es una consulta N+1 aceptable; el día que deje de serlo, la
  // proyección desechable de `projection/` (como ya existe para decisiones) es el patrón a seguir
  // — deuda declarada, no descubierta en producción.
  app.get(
    '/aprendizajes',
    conTraduccion(async (request) => {
      const query = parse(consultaAprendizajes, request.query);
      const client = await ctx.pool.connect();
      let ids: readonly string[];
      try {
        ids = await listAggregateIds(client, EVALUATION_AGGREGATE_TYPE);
      } finally {
        client.release();
      }

      const entries: LearningIndexEntry[] = [];
      for (const id of ids) {
        const c = await ctx.pool.connect();
        try {
          // `id` es el identificador DERIVADO de la evaluación (ver `derivedEvaluationId`), no el
          // de la iniciativa: hay que decodificar el génesis para saber a qué iniciativa pertenece
          // antes de poder congelar sus criterios y plegar el resto.
          const log = await loadEvaluationLog(c, id);
          const genesis = log[0];
          if (genesis === undefined || genesis.payload.type !== 'EvaluationOpened') continue;
          const initiativeLog = await loadInitiativeLog(c, genesis.payload.initiativeId);
          // Se falla cerrado sobre un dato inconsistente en vez de romper la lista entera: si la
          // iniciativa que sostiene esta evaluación desapareciera, esa fila simplemente no aporta
          // memoria, y las demás siguen respondiendo.
          if (initiativeLog.length === 0) continue;
          const initiative = await verifyInitiativeLog(initiativeLog);
          const frozen = await freezeSuccessCriteria(initiative.executionPlan);
          const state = await verifyEvaluationLog(log, frozen);
          entries.push(...learningsOf(state));
        } finally {
          c.release();
        }
      }

      const filtered = findLearnings(entries, {
        ...(query.etiqueta === undefined ? {} : { tags: [toLearningTag(query.etiqueta)] }),
        ...(query.tipo === undefined ? {} : { kinds: [query.tipo] }),
        ...(query.desenlace === undefined ? {} : { outcomes: [query.desenlace] }),
        ...(query.circuloId === undefined ? {} : { circleId: toCircleId(query.circuloId) }),
        ...(query.decisionId === undefined ? {} : { decisionId: toDecisionId(query.decisionId) }),
      });
      return filtered.map(entradaDeMemoriaDto);
    }),
  );
}
