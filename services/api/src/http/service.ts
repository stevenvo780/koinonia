/**
 * Servicio de aplicación: compone las órdenes del dominio con la persistencia.
 *
 * ═══ Lo que este módulo NO hace ═══
 *
 * **No autoriza.** Ni una línea de este fichero decide si alguien puede hacer algo. Todas las
 * órdenes que invoca —`openProblem`, `attachEvidence`, `retractEvidence`, `amendProposal`,
 * `castBallot`…— llaman a `authorize` por dentro, y lanzan `UnauthorizedError` antes de construir
 * ningún evento. Si mañana alguien añade una ruta nueva y se olvida de comprobar el permiso, la
 * orden lo comprueba igual, porque la orden **es** la puerta.
 *
 * Lo que sí hace este módulo es leer del ledger el dato con el que se decide la autorización
 * horizontal —quién escribió el aporte, quién redactó la propuesta— y pasárselo a la orden. Ese dato
 * jamás viene del cliente: si viniera, la comprobación horizontal la haría el atacante.
 */

import { toHex } from '@koinonia/crypto';
import {
  type Actor,
  authorize,
  authorizeTaskDeliveryRead,
  authorizeTaskEvidenceRead,
  amendProposal,
  attachEvidence,
  type BallotPayload,
  buildDecisionConfig,
  type CircleId,
  circleId,
  castBallotBy,
  closeDecisionBy,
  computeResult,
  type DecisionConfig,
  type DecisionEvent,
  decisionId,
  type DecisionLog,
  type DecisionResult,
  type DecisionState,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DEFAULT_EARLY_CLOSE,
  DEFAULT_TIE_BREAK,
  DELEGATION_DISABLED,
  draftDecision,
  draftProposal,
  type Electorate,
  ENGINE_VERSION,
  type EventId,
  eventId,
  type EvidenceCertainty,
  freezeElectorate,
  type Hash,
  hash as toHash,
  hashText,
  type Instant,
  instant,
  linkDecision,
  type MemberId,
  memberId,
  objectionId,
  openDecision,
  openProblem,
  optionId,
  type ProblemLog,
  type ProblemState,
  type ProposalLog,
  type ProposalState,
  proposalId as toProposalId,
  ratio,
  recordMeToo,
  replay,
  recordResult,
  replayProblem,
  retractEvidence,
  stratumKey,
  stratumValue,
  verifyLog,
  verifyProposalLog,
  type ProposalVersion,
  currentVersion,
  createInitiative,
  type ExecutionPlan,
  executionPlanHash,
  initiativeId,
  type InitiativeState,
  verifyInitiativeLog,
  versionAt,
  ballotId as toBallotId,
  ratifyDecisionBy,
  activateInitiative,
  acceptTaskBy,
  acceptTaskReviewBy,
  addTaskEvidenceBy,
  admitTaskCapacity,
  blockTaskBy,
  deliverTaskBy,
  offerTaskBy,
  planMilestoneBy,
  prepareTaskAcceptanceBy,
  milestoneId,
  rejectTaskBy,
  reofferTaskBy,
  requestTaskChangesBy,
  requestTaskHelpBy,
  requestTaskReassignmentBy,
  resumeTaskBy,
  startTaskBy,
  taskId,
  type InitiativeEvent,
  type InitiativeLog,
  type TaskCapacityAdmission,
  type TaskBlockCategory,
  type TaskChangeReason,
  type TaskHelpCategory,
  type OutcomeCriterionEvidence,
  type PrivateMaterialContext,
  type TaskEvidenceSizeClass,
  type TaskResponseReason,
} from '@koinonia/domain';

import { withTransaction, type PgClient, type PgPool, type PgPoolClient } from '../db/client.js';
import {
  loadDecisionLog,
  persistDecisionLog,
  persistDecisionLogWithin,
} from '../decision/repository.js';
import { DECISION_AGGREGATE_TYPE } from '../decision/codec.js';
import { lockLedgerWithin, readAll, readAppendRequestWithin } from '../ledger/event-store.js';
import { IdempotencyConflictError, type AppendResult } from '../ledger/types.js';
import { verifyLedger, type LedgerVerification } from '../ledger/verify.js';
import {
  listAggregateIds,
  loadInitiativeLog,
  loadInitiativeState,
  loadProblemLog,
  loadProposalLog,
  loadProposalState,
  persistProblemLog,
  persistInitiativeLogWithin,
  persistProposalLog,
  persistProposalLogWithin,
  PROBLEM_AGGREGATE_TYPE,
  PROPOSAL_AGGREGATE_TYPE,
  INITIATIVE_AGGREGATE_TYPE,
} from '../workspace/repository.js';
import {
  allMembers,
  findActiveMemberInCircleForShare,
  type MemberRecord,
  sha256Hex,
} from './identity.js';
import type { Ports } from './ports.js';
import { readOwnCapacityWithin } from './capacity.js';
import {
  createRestrictedTextMaterialWithin,
  openRestrictedTextMaterialWithin,
  unavailablePrivateMaterialVerification,
  verifyRestrictedPrivateMaterialsWithin,
  type PrivateMaterialVerification,
} from './private-material-store.js';
import { deriveCapacityLoadWithin, taskCapacityBucket } from './task-capacity.js';

/** El actor anónimo con el que se atienden las lecturas públicas. */
export const ACTOR_ANONIMO: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

export function actorDe(member: {
  readonly memberId: MemberId;
  readonly roles: readonly Actor['roles'][number][];
  readonly circles: readonly CircleId[];
}): Actor {
  return { memberId: member.memberId, roles: member.roles, circles: member.circles };
}

export interface ServicioDeps {
  readonly pool: PgPool;
  readonly ports: Ports;
}

/** Método soportado por el corte vertical (PRODUCT §9: dos métodos y ninguno más). */
export type MetodoSoportado = 'simple-majority' | 'sociocratic-consent';

/** Error de aplicación con código estable. La capa HTTP lo traduce a estado y a palabras. */
export class ServicioError extends Error {
  readonly codigo: string;
  readonly estado: number;

  constructor(codigo: string, estado: number, mensaje: string) {
    super(mensaje);
    this.name = 'ServicioError';
    this.codigo = codigo;
    this.estado = estado;
  }
}

const HORA_MS = 60 * 60 * 1000;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Utilidades de composición
// ═════════════════════════════════════════════════════════════════════════════════════════════

function nuevoEventId(deps: ServicioDeps): EventId {
  return eventId(deps.ports.random.opaqueId());
}

function ahora(deps: ServicioDeps): Instant {
  return instant(deps.ports.clock.now());
}

async function conCliente<T>(pool: PgPool, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Un unico corte consistente para auditorias largas, sin permitir escrituras accidentales. */
async function conSnapshotLectura<T>(
  pool: PgPool,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Problemas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ProblemaConId {
  readonly id: string;
  readonly state: ProblemState;
}

export async function crearProblema(
  deps: ServicioDeps,
  actor: Actor,
  input: {
    readonly requestId: string;
    readonly titulo: string;
    readonly cuerpo: string;
    readonly circuloId: string;
  },
): Promise<ProblemaConId> {
  const problemId = deps.ports.random.opaqueId();
  const log = await openProblem(
    { eventId: nuevoEventId(deps), at: ahora(deps), actor },
    {
      problemId,
      title: input.titulo,
      body: input.cuerpo,
      circleId: circleId(input.circuloId),
    },
  );
  await persistProblemLog(deps.pool, log, { requestId: input.requestId });
  return { id: problemId, state: replayProblem(log) };
}

async function conLogDeProblema(
  deps: ServicioDeps,
  problemaId: string,
  requestId: string,
  fn: (log: ProblemLog) => Promise<ProblemLog>,
): Promise<ProblemState> {
  const log = await conCliente(deps.pool, (c) => loadProblemLog(c, problemaId));
  if (log.length === 0) {
    throw new ServicioError('NO_ENCONTRADO', 404, 'no existe ese problema');
  }
  const siguiente = await fn(log);
  await persistProblemLog(deps.pool, siguiente, { requestId });
  return replayProblem(siguiente);
}

export async function aportarEvidencia(
  deps: ServicioDeps,
  actor: Actor,
  problemaId: string,
  input: {
    readonly requestId: string;
    readonly certeza: EvidenceCertainty;
    readonly cuerpo: string;
    readonly fuente?: string | undefined;
  },
): Promise<ProblemState> {
  const evidenceId = deps.ports.random.opaqueId();
  return conLogDeProblema(deps, problemaId, input.requestId, (log) =>
    attachEvidence(
      log,
      { eventId: nuevoEventId(deps), at: ahora(deps), actor },
      {
        evidenceId,
        certainty: input.certeza,
        body: input.cuerpo,
        ...(input.fuente === undefined ? {} : { source: input.fuente }),
      },
    ),
  );
}

/**
 * Retira un aporte. La comprobación horizontal la hace `retractEvidence` con el autor **leído del
 * ledger**; aquí no se le pasa nada que venga del cliente salvo cuál es el aporte.
 */
export async function retirarEvidencia(
  deps: ServicioDeps,
  actor: Actor,
  problemaId: string,
  evidenciaId: string,
  input: { readonly requestId: string; readonly motivo: string },
): Promise<ProblemState> {
  return conLogDeProblema(deps, problemaId, input.requestId, (log) =>
    retractEvidence(
      log,
      { eventId: nuevoEventId(deps), at: ahora(deps), actor },
      { evidenceId: evidenciaId, motivation: input.motivo },
    ),
  );
}

export async function mePasaLoMismo(
  deps: ServicioDeps,
  actor: Actor,
  problemaId: string,
  input: { readonly requestId: string },
): Promise<ProblemState> {
  return conLogDeProblema(deps, problemaId, input.requestId, (log) =>
    recordMeToo(log, { eventId: nuevoEventId(deps), at: ahora(deps), actor }),
  );
}

export async function listarProblemas(deps: ServicioDeps): Promise<readonly ProblemaConId[]> {
  return conCliente(deps.pool, async (client) => {
    const ids = await listAggregateIds(client, PROBLEM_AGGREGATE_TYPE);
    const salida: ProblemaConId[] = [];
    for (const id of ids) {
      const log = await loadProblemLog(client, id);
      if (log.length > 0) salida.push({ id, state: replayProblem(log) });
    }
    return salida;
  });
}

export async function verProblema(deps: ServicioDeps, id: string): Promise<ProblemaConId> {
  return conCliente(deps.pool, async (client) => {
    const log = await loadProblemLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe ese problema');
    return { id, state: replayProblem(log) };
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Propuestas
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface PlanHttp {
  readonly objetivo: string;
  readonly responsableId: string;
  readonly revisarEn: number;
  readonly criteriosDeExito: readonly {
    readonly descripcion: string;
    readonly fuenteDeVerificacion: string;
  }[];
}

function planDeHttp(plan: PlanHttp): ExecutionPlan {
  return {
    objective: plan.objetivo,
    responsibleId: memberId(plan.responsableId),
    reviewAt: instant(plan.revisarEn),
    successCriteria: plan.criteriosDeExito.map((criterion) => ({
      description: criterion.descripcion,
      evidenceSource: criterion.fuenteDeVerificacion,
    })),
  };
}

export interface PropuestaConId {
  readonly id: string;
  readonly state: ProposalState;
}

export async function crearPropuesta(
  deps: ServicioDeps,
  actor: Actor,
  input: {
    readonly requestId: string;
    readonly problemaId: string;
    readonly titulo: string;
    readonly cuerpo: string;
    readonly plan: PlanHttp;
  },
): Promise<PropuestaConId> {
  // «No se propone sin problema» (PRODUCT §4). Es una regla del motor, no del formulario: se
  // comprueba que el problema EXISTE en el ledger, no que el cliente mandó un identificador.
  const problema = await verProblema(deps, input.problemaId);
  const circulo = problema.state.circleId;
  if (circulo === undefined) {
    throw new ServicioError('NO_ENCONTRADO', 404, 'ese problema no tiene grupo competente');
  }

  const proposalId = deps.ports.random.opaqueId();
  const log = await draftProposal(
    { eventId: nuevoEventId(deps), at: ahora(deps), actor },
    {
      proposalId,
      problemId: input.problemaId,
      circleId: circulo,
      title: input.titulo,
      body: input.cuerpo,
      executionPlan: planDeHttp(input.plan),
    },
  );
  await persistProposalLog(deps.pool, log, { requestId: input.requestId });
  return { id: proposalId, state: await estadoDePropuesta(log) };
}

/** Verifica la cadena y la correspondencia de cada versión con su comprobante, y pliega. */
async function estadoDePropuesta(log: ProposalLog): Promise<ProposalState> {
  return verifyProposalLog(log);
}

export async function enmendarPropuesta(
  deps: ServicioDeps,
  actor: Actor,
  propuestaId: string,
  input: {
    readonly requestId: string;
    readonly titulo: string;
    readonly cuerpo: string;
    readonly motivo: string;
    readonly plan: PlanHttp;
  },
): Promise<PropuestaConId> {
  const log = await conCliente(deps.pool, (c) => loadProposalLog(c, propuestaId));
  if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa propuesta');
  const siguiente = await amendProposal(
    log,
    { eventId: nuevoEventId(deps), at: ahora(deps), actor },
    {
      title: input.titulo,
      body: input.cuerpo,
      rationale: input.motivo,
      executionPlan: planDeHttp(input.plan),
    },
  );
  await persistProposalLog(deps.pool, siguiente, { requestId: input.requestId });
  return { id: propuestaId, state: await estadoDePropuesta(siguiente) };
}

export async function listarPropuestas(deps: ServicioDeps): Promise<readonly PropuestaConId[]> {
  return conCliente(deps.pool, async (client) => {
    const ids = await listAggregateIds(client, PROPOSAL_AGGREGATE_TYPE);
    const salida: PropuestaConId[] = [];
    for (const id of ids) salida.push({ id, state: await loadProposalState(client, id) });
    return salida;
  });
}

export async function verPropuesta(deps: ServicioDeps, id: string): Promise<PropuestaConId> {
  return conCliente(deps.pool, async (client) => {
    const log = await loadProposalLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa propuesta');
    return { id, state: await loadProposalState(client, id) };
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Decisiones
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Congela el padrón con el registro vivo en el instante de apertura (A.1).
 *
 * Es el punto exacto donde el registro deja de importar: a partir de aquí, quien se matricule no
 * vota en esta decisión aunque la ventana siga abierta, y quien se retire sigue contando.
 */
async function congelarPadron(at: Instant, registro: readonly MemberRecord[]): Promise<Electorate> {
  return freezeElectorate({
    at,
    registryVersion: 1,
    criterion: 'personas con correo institucional verificado del Instituto de Filosofía',
    registry: registro.map((m) => ({
      memberId: m.memberId,
      // El alta tiene que ser ESTRICTAMENTE anterior a la congelación (INV-03): quien se matricula
      // exactamente en `frozenAt` queda fuera. Se resta un milisegundo a las altas simultáneas para
      // no excluir por un empate de reloj a quien se registró el mismo instante en que se abrió.
      enrolledAt: instant(Math.min(m.enrolledAt, at - 1)),
      ...(m.withdrawnAt === undefined ? {} : { withdrawnAt: instant(m.withdrawnAt) }),
      circles: [...m.circles].sort(),
      strata: {
        [stratumKey('semestre')]: stratumValue(m.semestre),
        [stratumKey('jornada')]: stratumValue(m.jornada),
      },
    })),
  });
}

/** Las reglas del juego de cada método, con los números de GOVERNANCE §4. */
function construirMetodo(metodo: MetodoSoportado): DecisionConfig['method'] {
  if (metodo === 'simple-majority') {
    // Fila 6/8 de GOVERNANCE §4: mayoría simple, más síes que noes, abstenciones fuera del
    // denominador (B.1.b). El denominador se fija ANTES de votar y se muestra en la papeleta: la
    // disputa post-electoral de una asamblea es casi siempre sobre el denominador.
    return {
      kind: 'simple-majority',
      abstentionPolicy: 'exclude',
      base: 'cast',
      tieBreak: DEFAULT_TIE_BREAK,
    };
  }
  // Fila 2 de GOVERNANCE §4: acuerdo interno de un círculo. La mitad del círculo se manifiesta y
  // cero objeciones admitidas sin integrar.
  return {
    kind: 'sociocratic-consent',
    maxRounds: 3,
    admissibility: {
      panelSize: 3,
      dismissThreshold: ratio(2, 3),
      panelSelection: 'sortition',
      panelDeadline: 72 * HORA_MS,
    },
    silenceMeans: 'not-participating',
    minEngagement: ratio(1, 2),
  };
}

function construirQuorum(metodo: MetodoSoportado, circulo: CircleId): DecisionConfig['quorum'] {
  if (metodo === 'simple-majority') {
    // 75 de 300 = 1/4 (GOVERNANCE §4, filas 6 y 8).
    return {
      participation: ratio(1, 4),
      onFailure: 'reject',
      maxExtensions: 0,
      extensionDuration: 0,
    };
  }
  // En el consentimiento la exigencia es «la mitad del círculo se manifiesta». Se expresa como
  // quórum por círculo, que es donde el motor sabe medirlo, y NO como participación sobre el censo:
  // un acuerdo interno de un círculo de 12 personas no puede exigir que se manifieste medio censo.
  return {
    participation: ratio(0, 1),
    perCircle: [{ circleId: circulo, min: ratio(1, 2) }],
    onFailure: 'reject',
    maxExtensions: 0,
    extensionDuration: 0,
  };
}

/** Qué hace falta para que esto pase, **en palabras**. Va siempre en la papeleta (PRODUCT §4). */
export function queHaceFaltaParaQuePase(metodo: MetodoSoportado, podianDecidir: number): string {
  if (metodo === 'simple-majority') {
    const minimo = Math.ceil(podianDecidir / 4);
    return (
      `Se aprueba si hay más síes que noes. Las abstenciones no cuentan para ese cálculo, pero sí ` +
      `para la participación mínima: tienen que responder al menos ${String(minimo)} de las ` +
      `${String(podianDecidir)} personas que podían decidir aquí.`
    );
  }
  return (
    'No hace falta que a todos les guste; hace falta que nadie muestre un daño. Pasa si al cerrar ' +
    'no queda ninguna objeción en pie y si se manifestó al menos la mitad del grupo. Una reserva ' +
    'se registra y no bloquea; una objeción bloquea y exige decir qué se daña.'
  );
}

export interface DecisionAbierta {
  readonly id: string;
  readonly state: DecisionState;
  readonly config: DecisionConfig;
}

export async function abrirDecision(
  deps: ServicioDeps,
  actor: Actor,
  input: {
    readonly requestId: string;
    readonly propuestaId: string;
    readonly version?: number | undefined;
    readonly metodo: MetodoSoportado;
    readonly duracionHoras: number;
  },
): Promise<DecisionAbierta> {
  return withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);

    // `append_request` es el mapeo durable request -> decision. Se consulta antes de generar ids o
    // semillas nuevas, y se reconstruye la respuesta de apertura (los dos eventos originales), no
    // el estado mutable que la decision pueda tener cuando llegue un reintento tardio.
    const previous = await readAppendRequestWithin(client, input.requestId);
    if (previous !== undefined) {
      const openedByThisRequest =
        previous.events.length === 2 &&
        previous.events[0]?.event.aggregateType === DECISION_AGGREGATE_TYPE &&
        previous.events[0].event.seq === 0 &&
        previous.events[0].event.eventType === 'DecisionDrafted' &&
        previous.events[1]?.event.seq === 1 &&
        previous.events[1].event.eventType === 'DecisionOpened';
      if (!openedByThisRequest) {
        throw new ServicioError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          'esa clave de idempotencia ya se uso para otra operacion',
        );
      }
      const original = (await loadDecisionLog(client, previous.aggregateId)).slice(0, 2);
      const state = replay(original);
      const config = state.config;
      if (config === undefined) {
        throw new ServicioError(
          'INTEGRITY_OPEN_REPLAY_INCOMPLETE',
          500,
          'el registro de apertura no contiene la configuracion congelada',
        );
      }
      const sameRequestedOpening =
        config.proposalId === input.propuestaId &&
        config.method.kind === input.metodo &&
        config.window.closesAt - config.window.opensAt === input.duracionHoras * HORA_MS;
      if (!sameRequestedOpening) {
        throw new ServicioError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          'esa clave ya abrió otra propuesta, método o duración; usá una clave nueva',
        );
      }
      const seed = await client.query<{ complete: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM identity.decision_seed
            WHERE decision_id = $1 AND commitment = $2
         ) AS complete`,
        [previous.aggregateId, config.seedCommitment],
      );
      const proposal = await loadProposalState(client, config.proposalId);
      if (
        input.version !== undefined &&
        versionAt(proposal, input.version)?.versionHash !== config.proposalVersionHash
      ) {
        throw new ServicioError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          'esa clave ya abrió otra versión de la propuesta; usá una clave nueva',
        );
      }
      const links = proposal.decisions.filter(
        (link) =>
          link.decisionId === previous.aggregateId &&
          link.versionHash === config.proposalVersionHash,
      );
      if (seed.rows[0]?.complete !== true || links.length !== 1) {
        throw new ServicioError(
          'INTEGRITY_OPEN_REPLAY_INCOMPLETE',
          500,
          'la apertura registrada no conserva atomicamente su semilla y enlace de propuesta',
        );
      }
      authorize(actor, 'decision:open', { kind: 'decision', circleId: config.circleId });
      return { id: previous.aggregateId, state, config };
    }

    // La propuesta se recarga despues del cerrojo. Asi no puede enmendarse entre elegir la version
    // y escribir DecisionLinked, ni un segundo intento puede convertir un estado viejo en un no-op.
    const propuestaLog = await loadProposalLog(client, input.propuestaId);
    if (propuestaLog.length === 0) {
      throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa propuesta');
    }
    const propuesta = await verifyProposalLog(propuestaLog);
    const circulo = propuesta.circleId;
    if (circulo === undefined) {
      throw new ServicioError('NO_ENCONTRADO', 404, 'esa propuesta no tiene grupo competente');
    }
    authorize(actor, 'decision:open', { kind: 'decision', circleId: circulo });

    const version: ProposalVersion | undefined =
      input.version === undefined ? currentVersion(propuesta) : versionAt(propuesta, input.version);
    if (version === undefined) {
      throw new ServicioError('NO_ENCONTRADO', 404, 'esa versión de la propuesta no existe');
    }

    const id = decisionId(deps.ports.random.opaqueId());
    const at = ahora(deps);
    const cierre = instant(at + input.duracionHoras * HORA_MS);
    const plan = version.executionPlan;
    const planHash = version.executionPlanHash;
    if (plan === undefined || planHash === undefined) {
      throw new ServicioError(
        'EXECUTION_PLAN_REQUIRED',
        409,
        'esta versión es anterior al plan de ejecución obligatorio; enmendala antes de decidir',
      );
    }
    if (plan.reviewAt <= cierre + DEFAULT_CHALLENGE_WINDOW_MS) {
      throw new ServicioError(
        'EXECUTION_PLAN_REVIEW_AFTER_CHALLENGE_REQUIRED',
        409,
        'la revisión debe quedar después del cierre y del periodo de impugnación',
      );
    }
    const plannedInitiativeId = initiativeId(deps.ports.random.opaqueId());
    const seedAdmin = toHex(deps.ports.random.bytes(32));
    const seedCommitment: Hash = await hashText(seedAdmin);
    const electorate = await congelarPadron(at, await allMembers(client, at));
    if (electorate.censusSize < 1) {
      throw new ServicioError('SIN_PADRON', 409, 'no hay nadie que pueda decidir todavía');
    }

    const config = await buildDecisionConfig({
      decisionId: id,
      proposalId: toProposalId(input.propuestaId),
      proposalVersionHash: version.versionHash,
      circleId: circulo,
      topics: [],
      options: [optionId(input.propuestaId)],
      electorate,
      method: construirMetodo(input.metodo),
      quorum: construirQuorum(input.metodo, circulo),
      window: {
        opensAt: at,
        closesAt: cierre,
        timezone: 'America/Bogota',
        earlyClose: DEFAULT_EARLY_CLOSE,
        challengeWindow: DEFAULT_CHALLENGE_WINDOW_MS,
      },
      privacy: 'public-roll-call',
      delegation: DELEGATION_DISABLED,
      seedCommitment,
      engineVersion: ENGINE_VERSION,
    });
    const propuestaSiguiente = await linkDecision(
      propuestaLog,
      { eventId: nuevoEventId(deps), at, actor },
      { decisionId: id, versionHash: version.versionHash },
    );
    let log: DecisionLog = await draftDecision([], {
      eventId: nuevoEventId(deps),
      at: instant(at - 1),
      actor: actor.memberId ?? 'system',
      decisionId: id,
      draft: {
        proposalId: toProposalId(input.propuestaId),
        proposalVersionHash: version.versionHash,
        plannedInitiativeId,
        executionPlanHash: planHash,
        summary: version.title,
      },
    });
    log = await openDecision(log, {
      eventId: nuevoEventId(deps),
      at,
      actor: actor.memberId ?? 'system',
      config,
    });

    // Sin `ON CONFLICT DO NOTHING`: una colision de id implica rollback, nunca reutilizar una
    // semilla que no corresponde a la configuracion que acabamos de construir.
    await client.query(
      `INSERT INTO identity.decision_seed (decision_id, seed_admin, commitment)
       VALUES ($1, $2, $3)`,
      [id, seedAdmin, seedCommitment],
    );
    await persistDecisionLogWithin(client, log, { requestId: input.requestId });
    await persistProposalLogWithin(client, propuestaSiguiente, {
      requestId: uuidDesde(sha256Hex(`${input.requestId}|enlace-de-decision`)),
    });
    return { id, state: replay(log), config };
  });
}

/** UUID v4 sintético a partir de una huella. Los `requestId` son claves, no identidades. */
function uuidDesde(hex: string): string {
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

export interface DecisionConEstado {
  readonly id: string;
  readonly log: DecisionLog;
  readonly state: DecisionState;
}

export async function verDecision(deps: ServicioDeps, id: string): Promise<DecisionConEstado> {
  return conCliente(deps.pool, async (client) => {
    const log = await loadDecisionLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa decisión');
    return { id, log, state: replay(log) };
  });
}

export async function listarDecisiones(deps: ServicioDeps): Promise<readonly DecisionConEstado[]> {
  return conCliente(deps.pool, async (client) => {
    const ids = await listAggregateIds(client, DECISION_AGGREGATE_TYPE);
    const salida: DecisionConEstado[] = [];
    for (const id of ids) {
      const log = await loadDecisionLog(client, id);
      if (log.length > 0) salida.push({ id, log, state: replay(log) });
    }
    return salida;
  });
}

/** Lo que la interfaz manda como respuesta a una papeleta. */
export interface RespuestaPapeleta {
  readonly tipo: 'binary' | 'abstain' | 'consent';
  readonly aprueba?: boolean | undefined;
  readonly postura?: 'consent' | 'concern' | 'object' | undefined;
  readonly objecion?:
    | {
        readonly argumento: string;
        readonly objetivoDanado: string;
        readonly enmiendaPropuesta?: string | undefined;
      }
    | undefined;
}

/**
 * Convierte la respuesta de la interfaz en la papeleta del dominio.
 *
 * `ronda` y el identificador de la objeción los pone el **servidor**: son estado, no entrada. Si la
 * ronda viniera del cliente, alguien podría emitir una papeleta de la ronda 1 sobre un texto ya
 * enmendado, que es exactamente lo que INV-09 prohíbe.
 */
export function payloadDePapeleta(
  respuesta: RespuestaPapeleta,
  contexto: { readonly ronda: number; readonly objecionId: string },
): BallotPayload {
  switch (respuesta.tipo) {
    case 'abstain':
      return { kind: 'abstain' };
    case 'binary':
      return { kind: 'binary', approve: respuesta.aprueba === true };
    case 'consent': {
      const postura = respuesta.postura ?? 'consent';
      if (postura !== 'object') return { kind: 'consent', stance: postura };
      const objecion = respuesta.objecion;
      if (objecion === undefined) {
        throw new ServicioError(
          'BALLOT_OBJECTION_REQUIRED',
          422,
          'objetar exige presentar la objeción por escrito',
        );
      }
      return {
        kind: 'consent',
        stance: 'object',
        objection: {
          objectionId: objectionId(contexto.objecionId),
          argument: objecion.argumento,
          harmedAim: objecion.objetivoDanado,
          ...(objecion.enmiendaPropuesta === undefined
            ? {}
            : { proposedAmendment: objecion.enmiendaPropuesta }),
          raisedAtRound: contexto.ronda,
        },
      };
    }
  }
}

export async function emitirPapeleta(
  deps: ServicioDeps,
  actor: Actor,
  decisionIdRaw: string,
  input: {
    readonly requestId: string;
    readonly huellaVersion: string;
    readonly respuesta: RespuestaPapeleta;
  },
): Promise<DecisionConEstado> {
  const { log, state } = await verDecision(deps, decisionIdRaw);
  const votante = actor.memberId;
  if (votante === undefined) {
    throw new ServicioError(
      'UNAUTHORIZED_NOT_AUTHENTICATED',
      401,
      'emitir una papeleta exige una cuenta verificada',
    );
  }
  // `voter` es SIEMPRE el actor autenticado y jamás un campo del cuerpo de la petición. Aunque
  // alguien lo mandara, no llegaría aquí; y aunque llegara, `apply` exige `voter === actor` al
  // plegar, así que el log resultante no existiría.
  const siguiente = await castBallotBy(log, {
    eventId: nuevoEventId(deps),
    at: ahora(deps),
    actor: votante,
    by: actor,
    ballot: {
      ballotId: toBallotId(deps.ports.random.opaqueId()),
      decisionId: decisionId(decisionIdRaw),
      voter: votante,
      round: state.round,
      payload: payloadDePapeleta(input.respuesta, {
        ronda: state.round,
        objecionId: deps.ports.random.opaqueId(),
      }),
      proposalVersionHash: toHash(input.huellaVersion),
    },
  });
  await persistDecisionLog(deps.pool, siguiente, { requestId: input.requestId });
  return { id: decisionIdRaw, log: siguiente, state: replay(siguiente) };
}

export async function cerrarDecision(
  deps: ServicioDeps,
  actor: Actor,
  decisionIdRaw: string,
  input: { readonly requestId: string },
): Promise<{
  readonly state: DecisionState;
  readonly resultado: DecisionResult;
  readonly iniciativaId?: string;
}> {
  return withTransaction(deps.pool, async (client) => {
    // La lectura sucede DESPUES del cerrojo. De otro modo dos cierres podrian leer Open, y el
    // segundo fallaria por CAS en vez de devolver semanticamente el mismo resultado.
    await lockLedgerWithin(client);
    const log = await loadDecisionLog(client, decisionIdRaw);
    if (log.length === 0) {
      throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa decisión');
    }
    const state = replay(log);
    const config = state.config;
    if (config === undefined) {
      throw new ServicioError('ILLEGAL_TRANSITION', 409, 'esa decisión todavía no se ha abierto');
    }
    authorize(actor, 'decision:close', { kind: 'decision', circleId: config.circleId });

    const frozen = await planCongeladoDeDecision(client, state);
    if (state.resultHash !== undefined) {
      const resultado = await computeResult(log);
      const initiative = await iniciativaDeResultado(client, state, resultado, frozen);
      return {
        state,
        resultado,
        ...(initiative === undefined ? {} : { iniciativaId: initiative.initiativeId }),
      };
    }

    const at = ahora(deps);
    if (at < config.window.closesAt) {
      throw new ServicioError(
        'CIERRE_ANTICIPADO_NO_PERMITIDO',
        409,
        'la votación cierra cuando dice que cierra. Un cierre anticipado exige dos firmas del ' +
          'Círculo de Garantías, y eso todavía no existe en esta versión',
      );
    }

    let siguiente = await closeDecisionBy(log, {
      eventId: nuevoEventId(deps),
      at,
      actor: actor.memberId ?? 'system',
      by: actor,
      cause: 'window',
    });
    const resultado = await computeResult(siguiente);
    siguiente = await recordResult(siguiente, {
      eventId: nuevoEventId(deps),
      at,
      actor: 'system',
      result: resultado,
    });
    let initiative: InitiativeState | undefined;
    let initiativeLog: Awaited<ReturnType<typeof createInitiative>> | undefined;
    if (frozen !== undefined) {
      // El identificador se reservo al abrir. Cualquier historia que ya lo ocupe prueba que la
      // cardinalidad atomica fue vulnerada; incluso un contenido casualmente igual nacio fuera de
      // este commit. Se aborta antes de escribir DecisionClosed/ResultComputed.
      const occupied = await loadInitiativeLog(client, frozen.initiativeId);
      if (occupied.length !== 0) {
        throw new ServicioError(
          'INTEGRITY_RESERVED_INITIATIVE_OCCUPIED',
          500,
          'el identificador reservado para la iniciativa ya contiene otra historia',
        );
      }
    }
    if (resultado.outcome.kind === 'approved' && frozen !== undefined) {
      initiativeLog = await createInitiative(
        { eventId: nuevoEventId(deps), at, actor: 'system' },
        {
          initiativeId: frozen.initiativeId,
          outcomeKind: resultado.outcome.kind,
          decisionId: state.decisionId,
          proposalId: config.proposalId,
          proposalVersionHash: config.proposalVersionHash,
          decisionResultHash: resultado.resultHash,
          circleId: config.circleId,
          executionPlan: frozen.plan,
        },
      );
      initiative = await verifyInitiativeLog(initiativeLog);
      await assertInitiativeMatches(initiative, state, resultado, frozen);
    }

    // Las dos historias se escriben solo despues de validar plan, reserva, enlaces y hashes. Un
    // fallo en cualquiera de los appends revierte tambien DecisionClosed/ResultComputed.
    await persistDecisionLogWithin(client, siguiente, {
      requestId: uuidDesde(sha256Hex(`${input.requestId}|${decisionIdRaw}|decision-close-v1`)),
    });
    if (initiativeLog !== undefined && initiative !== undefined && frozen !== undefined) {
      await persistInitiativeLogWithin(client, initiativeLog, {
        requestId: uuidDesde(
          sha256Hex(
            `${input.requestId}|${decisionIdRaw}|${frozen.initiativeId}|initiative-create-v1`,
          ),
        ),
      });
    }
    return {
      state: replay(siguiente),
      resultado,
      ...(initiative === undefined ? {} : { iniciativaId: initiative.initiativeId }),
    };
  });
}

/** Ratifica y activa en el mismo corte del ledger; una decisión histórica sólo se ratifica. */
export async function ratificarDecision(
  deps: ServicioDeps,
  actor: Actor,
  decisionIdRaw: string,
  input: { readonly requestId: string },
): Promise<DecisionState> {
  return withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);

    // Ambos namespaces se leen antes de consumir reloj o azar. El request público identifica la
    // ratificación; el interno identifica su consecuencia atómica sobre la iniciativa.
    const previousDecision = await readAppendRequestWithin(client, input.requestId);
    const previousActivation = await readAppendRequestWithin(
      client,
      input.requestId,
      'internal:initiative-activation:v1',
    );
    if (previousDecision !== undefined && previousDecision.aggregateId !== decisionIdRaw) {
      throw new IdempotencyConflictError(
        input.requestId,
        `ya pertenece a la decisión ${previousDecision.aggregateId}, no a ${decisionIdRaw}`,
      );
    }
    const log = await loadDecisionLog(client, decisionIdRaw);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa decisión');
    const state = replay(log);
    const config = state.config;
    if (config === undefined)
      throw new ServicioError('ILLEGAL_TRANSITION', 409, 'esa decisión no abrió');
    if (actor.memberId === undefined) {
      throw new ServicioError('UNAUTHORIZED_NOT_AUTHENTICATED', 401, 'ratificar exige identidad');
    }
    // Una ratificación tiene un solo corte temporal. Si la membresía se comprobara con un
    // instante y el evento se fechara con otro, una retirada entre ambas lecturas permitiría
    // atribuir un acto posterior a quien ya no era miembro. El mismo `at` gobierna elegibilidad y
    // ambos hechos del commit compuesto.
    const at = ahora(deps);
    const current = await findActiveMemberInCircleForShare(
      client,
      actor.memberId,
      config.circleId,
      at,
    );
    if (current === undefined) {
      throw new ServicioError(
        'UNAUTHORIZED_NOT_IN_CIRCLE',
        403,
        'no pertenecés actualmente a este círculo',
      );
    }
    const currentActor: Actor = {
      memberId: current.memberId,
      roles: current.roles,
      circles: current.circles,
    };

    // Incluso un replay es una lectura autenticada del acto procedimental: un cambio vivo de rol o
    // círculo se respeta, y el administrador técnico no gana soberanía por conocer el UUID.
    authorize(currentActor, 'decision:ratify', { kind: 'decision', circleId: config.circleId });
    const frozen = await planCongeladoDeDecision(client, state);

    if (previousDecision !== undefined) {
      const stored = previousDecision.events[0];
      const original = stored === undefined ? undefined : log[stored.event.seq];
      if (
        previousDecision.aggregateId !== decisionIdRaw ||
        previousDecision.events.length !== 1 ||
        stored?.event.aggregateType !== DECISION_AGGREGATE_TYPE ||
        stored.event.eventType !== 'DecisionRatified' ||
        stored.event.actor !== current.memberId ||
        original?.payload.type !== 'DecisionRatified' ||
        original.actor !== current.memberId
      ) {
        throw new IdempotencyConflictError(
          input.requestId,
          'ya pertenece a otra decisión, actor u operación; usá una clave nueva',
        );
      }
      if (state.status !== 'Ratified') {
        throw new ServicioError(
          'INTEGRITY_RATIFICATION_ATOMICITY',
          500,
          'la clave registra una ratificación que el estado de la decisión no conserva',
        );
      }
      if (frozen !== undefined && previousActivation === undefined) {
        throw new ServicioError(
          'INTEGRITY_RATIFICATION_ATOMICITY',
          500,
          'la ratificación pública existe pero falta su activación interna atómica',
        );
      }
      await assertRatificationActivation(
        client,
        log,
        state,
        original,
        frozen,
        previousActivation,
        input.requestId,
      );
      return state;
    }

    if (previousActivation !== undefined) {
      const stored = previousActivation.events[0];
      if (
        frozen !== undefined &&
        previousActivation.aggregateId === frozen.initiativeId &&
        previousActivation.events.length === 1 &&
        stored?.event.aggregateType === INITIATIVE_AGGREGATE_TYPE &&
        stored.event.eventType === 'InitiativeActivated'
      ) {
        throw new ServicioError(
          'INTEGRITY_RATIFICATION_ATOMICITY',
          500,
          'la activación interna existe pero falta su ratificación pública atómica',
        );
      }
      throw new IdempotencyConflictError(
        input.requestId,
        'ya pertenece a otra activación interna sin esta ratificación pública',
      );
    }

    // Una clave nueva puede consultar idempotentemente una decisión ya ratificada, pero sólo
    // después de demostrar que el enlace atómico existente sigue completo y exacto.
    if (state.status === 'Ratified') {
      const ratification = log.find((event) => event.payload.type === 'DecisionRatified');
      if (ratification === undefined) {
        throw new ServicioError(
          'INTEGRITY_RATIFICATION_ATOMICITY',
          500,
          'el estado ratificado no conserva su evento de ratificación',
        );
      }
      await assertRatificationActivation(client, log, state, ratification, frozen, undefined);
      return state;
    }

    const next = await ratifyDecisionBy(log, {
      eventId: nuevoEventId(deps),
      at,
      by: currentActor,
    });
    const ratification = next.at(-1);
    if (ratification === undefined) throw new Error('la ratificación no produjo evento');

    let activated: Awaited<ReturnType<typeof activateInitiative>> | undefined;
    if (frozen !== undefined) {
      const initiativeLog = await loadInitiativeLog(client, frozen.initiativeId);
      if (initiativeLog.length === 0) {
        throw new ServicioError(
          'INTEGRITY_APPROVED_INITIATIVE_MISSING',
          500,
          'la decisión nueva no conserva su iniciativa provisional',
        );
      }
      const result = await computeResult(log);
      const provisional = await verifyInitiativeLog(initiativeLog);
      await assertInitiativeMatches(provisional, state, result, frozen);
      if (provisional.activatedAt !== undefined) {
        throw new ServicioError(
          'INTEGRITY_INITIATIVE_LINK_MISMATCH',
          500,
          'la iniciativa ya está activa aunque la decisión todavía no fue ratificada',
        );
      }
      activated = await activateInitiative(
        initiativeLog,
        { eventId: nuevoEventId(deps), at, actor: 'system' },
        { ratificationEventId: ratification.eventId, ratificationEventHash: ratification.hash },
      );
    }
    await persistDecisionLogWithin(client, next, { requestId: input.requestId });
    if (activated !== undefined) {
      await persistInitiativeLogWithin(client, activated, {
        requestId: input.requestId,
        requestScope: 'internal:initiative-activation:v1',
      });
    }
    return replay(next);
  });
}

async function assertRatificationActivation(
  client: PgClient,
  decisionLog: DecisionLog,
  decision: DecisionState,
  ratification: DecisionEvent,
  frozen: PlanCongeladoDecision | undefined,
  activationRequest: AppendResult | undefined,
  replayRequestId?: string,
): Promise<void> {
  if (ratification.payload.type !== 'DecisionRatified') {
    throw new ServicioError(
      'INTEGRITY_RATIFICATION_ATOMICITY',
      500,
      'el evento enlazado no es una ratificación',
    );
  }
  if (frozen === undefined) {
    if (activationRequest !== undefined) {
      throw new ServicioError(
        'INTEGRITY_RATIFICATION_ATOMICITY',
        500,
        'una decisión histórica sin iniciativa tiene una activación interna inesperada',
      );
    }
    return;
  }

  const initiativeLog = await loadInitiativeLog(client, frozen.initiativeId);
  if (initiativeLog.length === 0) {
    throw new ServicioError(
      'INTEGRITY_APPROVED_INITIATIVE_MISSING',
      500,
      'la ratificación no conserva la iniciativa que debía activar',
    );
  }
  const initiative = await verifyInitiativeLog(initiativeLog);
  await assertInitiativeMatches(initiative, decision, await computeResult(decisionLog), frozen);
  const activation = initiativeLog.find((event) => event.payload.type === 'InitiativeActivated');
  if (
    activation?.payload.type !== 'InitiativeActivated' ||
    activation.actor !== 'system' ||
    activation.payload.ratificationEventId !== ratification.eventId ||
    activation.payload.ratificationEventHash !== ratification.hash ||
    activation.occurredAt !== ratification.occurredAt ||
    initiative.activatedAt !== ratification.occurredAt ||
    initiative.ratificationEventId !== ratification.eventId ||
    initiative.ratificationEventHash !== ratification.hash
  ) {
    throw new ServicioError(
      'INTEGRITY_RATIFICATION_ATOMICITY',
      500,
      'DecisionRatified e InitiativeActivated no forman el mismo enlace verificable',
    );
  }

  // En un replay con la clave original también se exige la mitad interna exacta. Una ausencia no
  // se interpreta como «ya estaba hecho»: evidencia un commit compuesto incompleto.
  if (activationRequest !== undefined) {
    const stored = activationRequest.events[0];
    const original = stored === undefined ? undefined : initiativeLog[stored.event.seq];
    if (
      activationRequest.aggregateId !== frozen.initiativeId ||
      activationRequest.events.length !== 1 ||
      stored?.event.aggregateType !== INITIATIVE_AGGREGATE_TYPE ||
      stored.event.eventType !== 'InitiativeActivated' ||
      stored.event.actor !== undefined ||
      original?.eventId !== activation.eventId ||
      original.payload.type !== 'InitiativeActivated'
    ) {
      throw new IdempotencyConflictError(
        replayRequestId ?? '00000000-0000-4000-8000-000000000000',
        'el namespace interno ya pertenece a otra activación',
      );
    }
  }
}

interface InitiativeMutation {
  /** El tipo es parte de la intención durable: una clave no cambia de operación al reintentarse. */
  readonly eventType:
    | 'MilestonePlanned'
    | 'TaskOffered'
    | 'TaskAccepted'
    | 'TaskRejected'
    | 'TaskReassignmentRequested'
    | 'TaskReoffered'
    | 'TaskStarted'
    | 'TaskBlocked'
    | 'TaskHelpRequested'
    | 'TaskResumed'
    | 'TaskEvidenceAdded'
    | 'TaskDelivered'
    | 'TaskChangesRequested'
    | 'TaskReviewAccepted';
  /** Sólo para órdenes que ofrecen trabajo. Se bloquea y relee antes de construir el evento. */
  readonly recipientId?: MemberId;
  /** Compara únicamente entradas del cliente; IDs e instante generados se recuperan del evento. */
  readonly matchesReplay: (
    event: InitiativeEvent,
    client: PgPoolClient,
    state: InitiativeState,
  ) => boolean | Promise<boolean>;
  /** Revalida la capacidad viva del actor aun cuando el evento ya exista y no vaya a reescribirse. */
  readonly reauthorizeReplay: (state: InitiativeState, current: Actor) => void;
  readonly run: (
    log: InitiativeLog,
    current: Actor,
    at: Instant,
    recipient: Actor | undefined,
    client: PgPoolClient,
    state: InitiativeState,
  ) => Promise<InitiativeLog>;
}

function rejectInitiativeReplay(requestId: string, detail: string): never {
  throw new IdempotencyConflictError(requestId, detail);
}

/**
 * Comprueba el comando público que ya selló una clave sin volver a generar su eventId, taskId,
 * milestoneId ni instante. El `seq` del ledger es también el índice del evento en el log de dominio
 * (ledger 0 ↔ dominio 1), por lo que la recuperación no depende de buscar un identificador nuevo.
 */
async function assertInitiativeReplay(
  previous: AppendResult,
  initiativeIdRaw: string,
  requestId: string,
  actorId: MemberId,
  mutation: InitiativeMutation,
  log: InitiativeLog,
  client: PgPoolClient,
  state: InitiativeState,
): Promise<void> {
  const stored = previous.events[0];
  const isSingleExpectedEvent =
    previous.aggregateId === initiativeIdRaw &&
    previous.events.length === 1 &&
    stored !== undefined &&
    stored.event.aggregateType === INITIATIVE_AGGREGATE_TYPE &&
    stored.event.eventType === mutation.eventType &&
    stored.event.actor === actorId;
  if (!isSingleExpectedEvent) {
    rejectInitiativeReplay(
      requestId,
      'ya pertenece a otra iniciativa, actor u operación; usá una clave nueva',
    );
  }

  const original = log[stored.event.seq];
  const sameInput =
    original !== undefined &&
    original.actor === actorId &&
    original.payload.type === mutation.eventType &&
    (await mutation.matchesReplay(original, client, state));
  if (!sameInput) {
    rejectInitiativeReplay(
      requestId,
      'no describe los mismos datos que la operación original; usá una clave nueva',
    );
  }
}

async function mutateInitiative(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  requestId: string,
  mutation: InitiativeMutation,
): Promise<InitiativeState> {
  return withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);

    // Debe ser la primera lectura específica de la orden: un replay no consume azar ni reloj y
    // conserva exactamente los identificadores que ya están en el ledger.
    const previous = await readAppendRequestWithin(client, requestId);
    if (previous !== undefined && previous.aggregateId !== id) {
      rejectInitiativeReplay(
        requestId,
        `ya pertenece a la iniciativa ${previous.aggregateId}, no a ${id}`,
      );
    }
    const log = await loadInitiativeLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa iniciativa');
    const state = await verifyInitiativeLog(log);
    if (actor.memberId === undefined)
      throw new ServicioError('UNAUTHORIZED_NOT_AUTHENTICATED', 401, 'requiere identidad');

    const now = deps.ports.clock.now();
    const member = await findActiveMemberInCircleForShare(
      client,
      actor.memberId,
      state.circleId,
      now,
    );
    if (member === undefined)
      throw new ServicioError('UNAUTHORIZED_NOT_IN_CIRCLE', 403, 'no pertenecés al círculo');
    const current: Actor = {
      memberId: member.memberId,
      roles: member.roles,
      circles: member.circles,
    };

    if (previous !== undefined) {
      await assertInitiativeReplay(
        previous,
        id,
        requestId,
        member.memberId,
        mutation,
        log,
        client,
        state,
      );
      // La idempotencia conserva el resultado del comando, no una autorización caducada. El actor
      // y el cuerpo ya coincidieron semánticamente; antes de revelar el replay se vuelve a aplicar
      // la capacidad vigente con los roles y círculos recién leídos de la bóveda.
      mutation.reauthorizeReplay(state, current);
      return state;
    }

    let recipient: Actor | undefined;
    if (mutation.recipientId !== undefined) {
      const currentRecipient = await findActiveMemberInCircleForShare(
        client,
        mutation.recipientId,
        state.circleId,
        now,
      );
      if (currentRecipient === undefined) {
        throw new ServicioError(
          'UNAUTHORIZED_NOT_IN_CIRCLE',
          403,
          'la persona destinataria no pertenece actualmente al círculo',
        );
      }
      recipient = {
        memberId: currentRecipient.memberId,
        roles: currentRecipient.roles,
        circles: currentRecipient.circles,
      };
    }

    const next = await mutation.run(log, current, instant(now), recipient, client, state);
    await persistInitiativeLogWithin(client, next, { requestId });
    return verifyInitiativeLog(next);
  });
}

export async function planificarHito(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  input: { requestId: string; titulo: string; criterioDeTerminacion: string; venceEn: number },
): Promise<InitiativeState> {
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'MilestonePlanned',
    matchesReplay: (event) =>
      event.payload.type === 'MilestonePlanned' &&
      event.payload.title === input.titulo &&
      event.payload.completionCriterion === input.criterioDeTerminacion &&
      event.payload.dueAt === input.venceEn,
    reauthorizeReplay: (state, current) => {
      authorize(current, 'initiative:plan', {
        kind: 'initiative',
        owner: state.executionPlan.responsibleId,
        circleId: state.circleId,
      });
    },
    run: (log, by, at) =>
      planMilestoneBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        {
          milestoneId: milestoneId(deps.ports.random.opaqueId()),
          title: input.titulo,
          completionCriterion: input.criterioDeTerminacion,
          dueAt: instant(input.venceEn),
        },
      ),
  });
}

export async function ofrecerTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  input: {
    requestId: string;
    hitoId: string;
    destinatarioId: string;
    titulo: string;
    descripcion: string;
    venceEn: number;
    esfuerzoMinutos: number;
    dependeDe: readonly string[];
  },
): Promise<InitiativeState> {
  const recipientId = memberId(input.destinatarioId);
  const milestone = milestoneId(input.hitoId);
  const dependencies = input.dependeDe.map(taskId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskOffered',
    recipientId,
    matchesReplay: (event) =>
      event.payload.type === 'TaskOffered' &&
      event.payload.milestoneId === milestone &&
      event.payload.offeredTo === recipientId &&
      event.payload.title === input.titulo &&
      event.payload.description === input.descripcion &&
      event.payload.dueAt === input.venceEn &&
      event.payload.effortMinutes === input.esfuerzoMinutos &&
      event.payload.dependsOn.length === dependencies.length &&
      event.payload.dependsOn.every((dependency, index) => dependency === dependencies[index]),
    reauthorizeReplay: (state, current) => {
      authorize(current, 'task:offer', {
        kind: 'task',
        owner: state.executionPlan.responsibleId,
        circleId: state.circleId,
      });
    },
    run: (log, by, at, recipient) => {
      if (recipient === undefined) throw new Error('la oferta no releyó su destinatario');
      return offerTaskBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        {
          taskId: taskId(deps.ports.random.opaqueId()),
          milestoneId: milestone,
          offeredTo: recipientId,
          title: input.titulo,
          description: input.descripcion,
          effortMinutes: input.esfuerzoMinutos,
          dueAt: instant(input.venceEn),
          dependsOn: dependencies,
          recipient,
        },
      );
    },
  });
}

export async function responderOfertaTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input:
    | { requestId: string; offerId: string; revision: number; tipo: 'aceptar' }
    | {
        requestId: string;
        offerId: string;
        revision: number;
        tipo: 'rechazar';
        motivo: TaskResponseReason;
      }
    | {
        requestId: string;
        offerId: string;
        revision: number;
        tipo: 'pedir-reasignacion';
        motivo: TaskResponseReason;
      },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const offer = eventId(input.offerId);
  const eventType =
    input.tipo === 'aceptar'
      ? 'TaskAccepted'
      : input.tipo === 'rechazar'
        ? 'TaskRejected'
        : 'TaskReassignmentRequested';
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType,
    matchesReplay: (event) => {
      if (event.payload.type !== eventType) return false;
      if (
        event.payload.taskId !== task ||
        event.payload.offerId !== offer ||
        event.payload.expectedTaskSeq !== input.revision
      ) {
        return false;
      }
      if (event.payload.type === 'TaskAccepted') return input.tipo === 'aceptar';
      return input.tipo !== 'aceptar' && event.payload.reason === input.motivo;
    },
    reauthorizeReplay: (state, current) => {
      authorize(
        current,
        input.tipo === 'aceptar'
          ? 'task:accept'
          : input.tipo === 'rechazar'
            ? 'task:reject'
            : 'task:request-reassignment',
        { kind: 'task', subject: current.memberId, circleId: state.circleId },
      );
    },
    run: async (log, by, at, _recipient, client, state) => {
      const meta = { eventId: nuevoEventId(deps), at, by };
      switch (input.tipo) {
        case 'aceptar': {
          const command = {
            taskId: task,
            offerId: offer,
            expectedTaskSeq: input.revision,
          };
          // El preflight de dominio ocurre antes de tocar la fila privada. Asi una oferta o
          // revision manipulada no llega a convertirse en una operacion de Vault.
          const candidate = prepareTaskAcceptanceBy(log, meta, command);
          const taskState = state.tasks.find((currentTask) => currentTask.taskId === task);
          if (taskState === undefined) {
            throw new ServicioError(
              'INTEGRITY_TASK_ACCEPTANCE_STATE',
              500,
              'la tarea validada no aparece en la proyeccion verificada',
            );
          }
          const capacity = await readOwnCapacityWithin(
            client,
            deps.ports.vault,
            candidate.memberId,
          );
          if (!capacity.declarada) {
            throw new ServicioError(
              'TASK_CAPACITY_CONFIRMATION_BLOCKED',
              422,
              'la aceptacion exige revisar primero la capacidad privada propia',
            );
          }
          const bucket = taskCapacityBucket(taskState.dueAt, at);
          const currentLoadMinutes = await deriveCapacityLoadWithin(
            client,
            candidate.memberId,
            bucket,
            at,
          );
          let admission: TaskCapacityAdmission;
          try {
            admission = admitTaskCapacity(candidate, {
              currentLoadMinutes,
              weeklyCapacityMinutes: capacity.minutosPorSemana,
            });
          } catch (error) {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'TASK_CAPACITY_EXCEEDED'
            ) {
              throw new ServicioError(
                'TASK_CAPACITY_CONFIRMATION_BLOCKED',
                422,
                'la aceptacion no cabe en la capacidad privada vigente',
              );
            }
            throw error;
          }
          return await acceptTaskBy(log, meta, command, admission);
        }
        case 'rechazar':
          return rejectTaskBy(log, meta, {
            taskId: task,
            offerId: offer,
            expectedTaskSeq: input.revision,
            reason: input.motivo,
          });
        case 'pedir-reasignacion':
          return requestTaskReassignmentBy(log, meta, {
            taskId: task,
            offerId: offer,
            expectedTaskSeq: input.revision,
            reason: input.motivo,
          });
      }
    },
  });
}

interface MutacionAsignadaInput {
  readonly requestId: string;
  readonly offerId: string;
  readonly revision: number;
}

function reauthorizeAssigneeTask(
  state: InitiativeState,
  current: Actor,
  action:
    | 'task:start'
    | 'task:block'
    | 'task:request-help'
    | 'task:resume'
    | 'task:add-evidence'
    | 'task:deliver',
): void {
  authorize(current, action, {
    kind: 'task',
    subject: current.memberId,
    circleId: state.circleId,
  });
}

function memberFromCurrent(actor: Actor): MemberId {
  if (actor.memberId === undefined) {
    throw new ServicioError('UNAUTHORIZED_NOT_AUTHENTICATED', 401, 'requiere identidad vigente');
  }
  return actor.memberId;
}

function restrictedTextSizeClass(content: string): TaskEvidenceSizeClass {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= 1_024) return 'pequena';
  if (bytes <= 8_192) return 'mediana';
  return 'grande';
}

export async function iniciarTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: MutacionAsignadaInput,
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const offer = eventId(input.offerId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskStarted',
    matchesReplay: (event) =>
      event.payload.type === 'TaskStarted' &&
      event.payload.taskId === task &&
      event.payload.offerId === offer &&
      event.payload.expectedTaskSeq === input.revision,
    reauthorizeReplay: (state, current) => {
      reauthorizeAssigneeTask(state, current, 'task:start');
    },
    run: (log, by, at) =>
      startTaskBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        { taskId: task, offerId: offer, expectedTaskSeq: input.revision },
      ),
  });
}

export async function bloquearTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: MutacionAsignadaInput & { readonly categoria: TaskBlockCategory },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const offer = eventId(input.offerId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskBlocked',
    matchesReplay: (event) =>
      event.payload.type === 'TaskBlocked' &&
      event.payload.taskId === task &&
      event.payload.offerId === offer &&
      event.payload.expectedTaskSeq === input.revision &&
      event.payload.category === input.categoria &&
      event.payload.privateDetailCommitment === undefined,
    reauthorizeReplay: (state, current) => {
      reauthorizeAssigneeTask(state, current, 'task:block');
    },
    run: (log, by, at) =>
      blockTaskBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        {
          taskId: task,
          offerId: offer,
          expectedTaskSeq: input.revision,
          category: input.categoria,
        },
      ),
  });
}

export async function pedirAyudaTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: MutacionAsignadaInput & { readonly categoria: TaskHelpCategory },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const offer = eventId(input.offerId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskHelpRequested',
    matchesReplay: (event) =>
      event.payload.type === 'TaskHelpRequested' &&
      event.payload.taskId === task &&
      event.payload.offerId === offer &&
      event.payload.expectedTaskSeq === input.revision &&
      event.payload.category === input.categoria &&
      event.payload.privateDetailCommitment === undefined,
    reauthorizeReplay: (state, current) => {
      reauthorizeAssigneeTask(state, current, 'task:request-help');
    },
    run: (log, by, at) =>
      requestTaskHelpBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        {
          taskId: task,
          offerId: offer,
          expectedTaskSeq: input.revision,
          category: input.categoria,
        },
      ),
  });
}

export async function reanudarTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: MutacionAsignadaInput & { readonly pauseId: string },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const offer = eventId(input.offerId);
  const pause = eventId(input.pauseId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskResumed',
    matchesReplay: (event) =>
      event.payload.type === 'TaskResumed' &&
      event.payload.taskId === task &&
      event.payload.offerId === offer &&
      event.payload.expectedTaskSeq === input.revision &&
      event.payload.pauseId === pause,
    reauthorizeReplay: (state, current) => {
      reauthorizeAssigneeTask(state, current, 'task:resume');
    },
    run: (log, by, at) =>
      resumeTaskBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        {
          taskId: task,
          offerId: offer,
          expectedTaskSeq: input.revision,
          pauseId: pause,
        },
      ),
  });
}

export async function agregarEvidenciaTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: MutacionAsignadaInput & {
    readonly contenido: string;
    readonly visibilidad: 'restricted';
  },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const offer = eventId(input.offerId);
  const sizeClass = restrictedTextSizeClass(input.contenido);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskEvidenceAdded',
    matchesReplay: async (event, client, state) => {
      if (
        event.payload.type !== 'TaskEvidenceAdded' ||
        event.payload.taskId !== task ||
        event.payload.offerId !== offer ||
        event.payload.expectedTaskSeq !== input.revision ||
        event.payload.kindCode !== 'texto' ||
        event.payload.sizeClass !== sizeClass ||
        event.payload.visibility !== 'restricted' ||
        event.actor === 'system'
      ) {
        return false;
      }
      const context: PrivateMaterialContext = {
        purpose: 'task-evidence-object',
        initiativeId: state.initiativeId,
        taskId: task,
        offerId: offer,
        visibility: 'restricted',
      };
      const opening = await openRestrictedTextMaterialWithin(client, deps.ports.vault, {
        materialId: event.eventId,
        ownerId: event.actor,
        expectedContext: context,
        expectedCommitment: event.payload.objectCommitment,
      });
      return opening.content === input.contenido;
    },
    reauthorizeReplay: (state, current) => {
      reauthorizeAssigneeTask(state, current, 'task:add-evidence');
    },
    run: async (log, by, at, _recipient, client, state) => {
      const evidenceId = nuevoEventId(deps);
      const context: PrivateMaterialContext = {
        purpose: 'task-evidence-object',
        initiativeId: state.initiativeId,
        taskId: task,
        offerId: offer,
        visibility: 'restricted',
      };
      const stored = await createRestrictedTextMaterialWithin(
        client,
        deps.ports.vault,
        deps.ports.random,
        {
          materialId: evidenceId,
          ownerId: memberFromCurrent(by),
          context,
          content: input.contenido,
          createdAt: at,
        },
      );
      return await addTaskEvidenceBy(
        log,
        { eventId: evidenceId, at, by },
        {
          taskId: task,
          offerId: offer,
          expectedTaskSeq: input.revision,
          objectCommitment: stored.commitment,
          kindCode: 'texto',
          sizeClass,
          visibility: 'restricted',
        },
      );
    },
  });
}

export async function entregarTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: MutacionAsignadaInput & {
    readonly evidenciaIds: readonly string[];
    readonly resumen: string;
  },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const offer = eventId(input.offerId);
  const evidenceIds = input.evidenciaIds.map(eventId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskDelivered',
    matchesReplay: async (event, client, state) => {
      if (
        event.payload.type !== 'TaskDelivered' ||
        event.payload.taskId !== task ||
        event.payload.offerId !== offer ||
        event.payload.expectedTaskSeq !== input.revision ||
        event.payload.evidenceIds.length !== evidenceIds.length ||
        !event.payload.evidenceIds.every((evidence, index) => evidence === evidenceIds[index]) ||
        event.actor === 'system'
      ) {
        return false;
      }
      const context: PrivateMaterialContext = {
        purpose: 'task-delivery-summary',
        initiativeId: state.initiativeId,
        taskId: task,
        offerId: offer,
        deliveryId: event.eventId,
        visibility: 'restricted',
      };
      const opening = await openRestrictedTextMaterialWithin(client, deps.ports.vault, {
        materialId: event.eventId,
        ownerId: event.actor,
        expectedContext: context,
        expectedCommitment: event.payload.summaryCommitment,
      });
      return opening.content === input.resumen;
    },
    reauthorizeReplay: (state, current) => {
      reauthorizeAssigneeTask(state, current, 'task:deliver');
    },
    run: async (log, by, at, _recipient, client, state) => {
      const deliveryId = nuevoEventId(deps);
      const context: PrivateMaterialContext = {
        purpose: 'task-delivery-summary',
        initiativeId: state.initiativeId,
        taskId: task,
        offerId: offer,
        deliveryId,
        visibility: 'restricted',
      };
      const stored = await createRestrictedTextMaterialWithin(
        client,
        deps.ports.vault,
        deps.ports.random,
        {
          materialId: deliveryId,
          ownerId: memberFromCurrent(by),
          context,
          content: input.resumen,
          createdAt: at,
        },
      );
      return await deliverTaskBy(
        log,
        { eventId: deliveryId, at, by },
        {
          taskId: task,
          offerId: offer,
          expectedTaskSeq: input.revision,
          evidenceIds,
          summaryCommitment: stored.commitment,
        },
      );
    },
  });
}

export async function pedirCambiosTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: {
    readonly requestId: string;
    readonly deliveryId: string;
    readonly revision: number;
    readonly motivo: TaskChangeReason;
  },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const delivery = eventId(input.deliveryId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskChangesRequested',
    matchesReplay: (event) =>
      event.payload.type === 'TaskChangesRequested' &&
      event.payload.taskId === task &&
      event.payload.deliveryId === delivery &&
      event.payload.expectedTaskSeq === input.revision &&
      event.payload.reason === input.motivo &&
      event.payload.privateDetailCommitment === undefined,
    reauthorizeReplay: (state, current) => {
      authorize(current, 'task:request-changes', {
        kind: 'task',
        owner: state.executionPlan.responsibleId,
        circleId: state.circleId,
      });
    },
    run: (log, by, at) =>
      requestTaskChangesBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        {
          taskId: task,
          deliveryId: delivery,
          expectedTaskSeq: input.revision,
          reason: input.motivo,
        },
      ),
  });
}

export async function aceptarRevisionTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: {
    readonly requestId: string;
    readonly deliveryId: string;
    readonly revision: number;
    readonly evidenciaCriterio: OutcomeCriterionEvidence;
  },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const delivery = eventId(input.deliveryId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskReviewAccepted',
    matchesReplay: (event) =>
      event.payload.type === 'TaskReviewAccepted' &&
      event.payload.taskId === task &&
      event.payload.deliveryId === delivery &&
      event.payload.expectedTaskSeq === input.revision &&
      event.payload.outcomeCriterionEvidence === input.evidenciaCriterio,
    reauthorizeReplay: (state, current) => {
      authorize(current, 'task:accept-review', {
        kind: 'task',
        owner: state.executionPlan.responsibleId,
        circleId: state.circleId,
      });
    },
    run: (log, by, at) =>
      acceptTaskReviewBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        {
          taskId: task,
          deliveryId: delivery,
          expectedTaskSeq: input.revision,
          outcomeCriterionEvidence: input.evidenciaCriterio,
        },
      ),
  });
}

export async function reofrecerTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  input: { requestId: string; offerId: string; destinatarioId: string },
): Promise<InitiativeState> {
  const task = taskId(taskIdRaw);
  const previousOffer = eventId(input.offerId);
  const recipientId = memberId(input.destinatarioId);
  return mutateInitiative(deps, actor, id, input.requestId, {
    eventType: 'TaskReoffered',
    recipientId,
    matchesReplay: (event) =>
      event.payload.type === 'TaskReoffered' &&
      event.payload.taskId === task &&
      event.payload.previousOfferId === previousOffer &&
      event.payload.offeredTo === recipientId,
    reauthorizeReplay: (state, current) => {
      authorize(current, 'task:reoffer', {
        kind: 'task',
        owner: state.executionPlan.responsibleId,
        circleId: state.circleId,
      });
    },
    run: (log, by, at, recipient) => {
      if (recipient === undefined) throw new Error('la reoferta no releyó su destinatario');
      return reofferTaskBy(
        log,
        { eventId: nuevoEventId(deps), at, by },
        { taskId: task, previousOfferId: previousOffer, offeredTo: recipientId, recipient },
      );
    },
  });
}

interface PlanCongeladoDecision {
  readonly initiativeId: ReturnType<typeof initiativeId>;
  readonly plan: ExecutionPlan;
}

async function planCongeladoDeDecision(
  client: PgClient,
  state: DecisionState,
): Promise<PlanCongeladoDecision | undefined> {
  const draft = state.draft;
  const planned = draft?.plannedInitiativeId;
  const planHash = draft?.executionPlanHash;
  if (planned === undefined && planHash === undefined) return undefined;
  if (planned === undefined || planHash === undefined || draft === undefined) {
    throw new ServicioError(
      'INTEGRITY_EXECUTION_PLAN_INCOMPLETE',
      500,
      'la decisión no conserva juntos el plan y la iniciativa reservada',
    );
  }
  const config = state.config;
  if (
    config === undefined ||
    draft.proposalId !== config.proposalId ||
    draft.proposalVersionHash !== config.proposalVersionHash ||
    state.proposalVersionHash !== config.proposalVersionHash
  ) {
    throw new ServicioError(
      'INTEGRITY_DECISION_PROPOSAL_LINK_MISMATCH',
      500,
      'la decision no enlaza de forma consistente la propuesta y su version congelada',
    );
  }
  const proposal = await loadProposalState(client, draft.proposalId);
  const version = proposal.versions.find((item) => item.versionHash === draft.proposalVersionHash);
  if (
    version?.executionPlan === undefined ||
    version.executionPlanHash === undefined ||
    version.executionPlanHash !== planHash
  ) {
    throw new ServicioError(
      'INTEGRITY_EXECUTION_PLAN_MISMATCH',
      500,
      'el plan congelado por la decisión no coincide con la versión de la propuesta',
    );
  }
  return { initiativeId: planned, plan: version.executionPlan };
}

async function assertInitiativeMatches(
  initiative: InitiativeState,
  decision: DecisionState,
  result: DecisionResult,
  frozen: PlanCongeladoDecision,
): Promise<void> {
  const config = decision.config;
  if (
    config === undefined ||
    result.outcome.kind !== 'approved' ||
    initiative.initiativeId !== frozen.initiativeId ||
    initiative.decisionId !== decision.decisionId ||
    initiative.proposalId !== config.proposalId ||
    initiative.proposalVersionHash !== config.proposalVersionHash ||
    initiative.proposalVersionHash !== decision.proposalVersionHash ||
    initiative.decisionResultHash !== result.resultHash ||
    initiative.circleId !== config.circleId ||
    (await executionPlanHash(initiative.executionPlan)) !==
      (await executionPlanHash(frozen.plan)) ||
    (await executionPlanHash(frozen.plan)) !== decision.draft?.executionPlanHash
  ) {
    throw new ServicioError(
      'INTEGRITY_INITIATIVE_LINK_MISMATCH',
      500,
      'la iniciativa no corresponde exactamente a la reserva, decision, version, resultado y plan',
    );
  }
}

async function iniciativaDeResultado(
  client: PgClient,
  decision: DecisionState,
  result: DecisionResult,
  frozen: PlanCongeladoDecision | undefined,
): Promise<InitiativeState | undefined> {
  if (frozen === undefined) return undefined; // legado anterior a ADR-0043
  const log = await loadInitiativeLog(client, frozen.initiativeId);
  if (result.outcome.kind !== 'approved') {
    if (log.length !== 0) {
      throw new ServicioError(
        'INTEGRITY_UNAPPROVED_INITIATIVE',
        500,
        'una decisión no aprobada tiene una iniciativa que no debía existir',
      );
    }
    return undefined;
  }
  if (log.length === 0) {
    throw new ServicioError(
      'INTEGRITY_APPROVED_INITIATIVE_MISSING',
      500,
      'la decisión aprobada no tiene su iniciativa atómica',
    );
  }
  const initiative = await loadInitiativeState(client, frozen.initiativeId);
  await assertInitiativeMatches(initiative, decision, result, frozen);
  return initiative;
}

export async function resultadoDeDecision(
  deps: ServicioDeps,
  decisionIdRaw: string,
): Promise<{ readonly resultado: DecisionResult; readonly iniciativaId?: string }> {
  const { log, state } = await verDecision(deps, decisionIdRaw);
  if (state.closedAt === undefined) {
    throw new ServicioError(
      'NOT_CLOSED',
      409,
      'todavía no hay resultado: la votación sigue abierta',
    );
  }
  const resultado = await computeResult(log);
  return conCliente(deps.pool, async (client) => {
    const initiative = await iniciativaDeResultado(
      client,
      state,
      resultado,
      await planCongeladoDeDecision(client, state),
    );
    return {
      resultado,
      ...(initiative === undefined ? {} : { iniciativaId: initiative.initiativeId }),
    };
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Iniciativas
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface IniciativaConId {
  readonly id: string;
  readonly state: InitiativeState;
  readonly ratificableEn?: Instant;
}

async function ratificableEnDeIniciativa(
  client: PgClient,
  initiative: InitiativeState,
): Promise<Instant | undefined> {
  if (initiative.activatedAt !== undefined) return undefined;
  const log = await loadDecisionLog(client, initiative.decisionId);
  if (log.length === 0) return undefined;
  const decision = replay(log);
  if (
    decision.config === undefined ||
    decision.closedAt === undefined ||
    decision.resultComputedAt === undefined
  ) {
    return undefined;
  }
  return instant(
    Math.max(decision.closedAt, decision.resultComputedAt) + decision.config.window.challengeWindow,
  );
}

export async function listarIniciativas(deps: ServicioDeps): Promise<readonly IniciativaConId[]> {
  return conCliente(deps.pool, async (client) => {
    const result: IniciativaConId[] = [];
    for (const id of await listAggregateIds(client, INITIATIVE_AGGREGATE_TYPE)) {
      const state = await loadInitiativeState(client, id);
      const ratificableEn = await ratificableEnDeIniciativa(client, state);
      result.push({ id, state, ...(ratificableEn === undefined ? {} : { ratificableEn }) });
    }
    return result;
  });
}

export async function verIniciativa(deps: ServicioDeps, id: string): Promise<IniciativaConId> {
  return conCliente(deps.pool, async (client) => {
    const log = await loadInitiativeLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa iniciativa');
    const state = await verifyInitiativeLog(log);
    const ratificableEn = await ratificableEnDeIniciativa(client, state);
    return { id, state, ...(ratificableEn === undefined ? {} : { ratificableEn }) };
  });
}

async function currentInitiativeReader(
  client: PgPoolClient,
  actor: Actor,
  state: InitiativeState,
  now: number,
): Promise<Actor> {
  if (actor.memberId === undefined) {
    throw new ServicioError('UNAUTHORIZED_NOT_AUTHENTICATED', 401, 'requiere identidad');
  }
  const member = await findActiveMemberInCircleForShare(
    client,
    actor.memberId,
    state.circleId,
    now,
  );
  if (member === undefined) {
    throw new ServicioError('UNAUTHORIZED_NOT_IN_CIRCLE', 403, 'no pertenecés al círculo');
  }
  return { memberId: member.memberId, roles: member.roles, circles: member.circles };
}

export async function verEvidenciaTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  evidenceIdRaw: string,
): Promise<{ readonly contenido: string }> {
  return withTransaction(deps.pool, async (client) => {
    const log = await loadInitiativeLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa iniciativa');
    const state = await verifyInitiativeLog(log);
    const current = await currentInitiativeReader(client, actor, state, deps.ports.clock.now());
    const task = taskId(taskIdRaw);
    const evidenceId = eventId(evidenceIdRaw);
    const evidence = authorizeTaskEvidenceRead(state, current, task, evidenceId);
    const context: PrivateMaterialContext = {
      purpose: 'task-evidence-object',
      initiativeId: state.initiativeId,
      taskId: task,
      offerId: evidence.offerId,
      visibility: 'restricted',
    };
    const opening = await openRestrictedTextMaterialWithin(client, deps.ports.vault, {
      materialId: evidence.evidenceId,
      ownerId: evidence.addedBy,
      expectedContext: context,
      expectedCommitment: evidence.objectCommitment,
    });
    return { contenido: opening.content };
  });
}

export async function verResumenEntregaTarea(
  deps: ServicioDeps,
  actor: Actor,
  id: string,
  taskIdRaw: string,
  deliveryIdRaw: string,
): Promise<{ readonly contenido: string }> {
  return withTransaction(deps.pool, async (client) => {
    const log = await loadInitiativeLog(client, id);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa iniciativa');
    const state = await verifyInitiativeLog(log);
    const current = await currentInitiativeReader(client, actor, state, deps.ports.clock.now());
    const task = taskId(taskIdRaw);
    const deliveryId = eventId(deliveryIdRaw);
    const delivery = authorizeTaskDeliveryRead(state, current, task, deliveryId);
    const context: PrivateMaterialContext = {
      purpose: 'task-delivery-summary',
      initiativeId: state.initiativeId,
      taskId: task,
      offerId: delivery.offerId,
      deliveryId: delivery.deliveryId,
      visibility: 'restricted',
    };
    const opening = await openRestrictedTextMaterialWithin(client, deps.ports.vault, {
      materialId: delivery.deliveryId,
      ownerId: delivery.deliveredBy,
      expectedContext: context,
      expectedCommitment: delivery.summaryCommitment,
    });
    return { contenido: opening.content };
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Integridad
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface VerificacionCompleta {
  readonly ledger: LedgerVerification;
  readonly materialPrivado: PrivateMaterialVerification;
  readonly hechos: number;
  readonly desde: number | undefined;
  readonly propuestasVerificadas: number;
  readonly propuestasRotas: readonly { readonly id: string; readonly motivo: string }[];
  readonly decisionesVerificadas: number;
  readonly decisionesRotas: readonly { readonly id: string; readonly motivo: string }[];
  readonly iniciativasVerificadas: number;
  readonly iniciativasRotas: readonly { readonly id: string; readonly motivo: string }[];
  readonly ejecucionRotas: readonly { readonly id: string; readonly motivo: string }[];
}

/**
 * La comprobación completa: la cadena del ledger, la cadena de cada decisión, la de cada propuesta
 * y la correspondencia entre cada versión y su comprobante.
 *
 * Se recomputa todo: no se consulta ninguna bandera de «verificado». Una verificación que consulta
 * una bandera verifica la bandera.
 */
export async function verificarTodo(deps: ServicioDeps): Promise<VerificacionCompleta> {
  return conSnapshotLectura(deps.pool, async (client) => {
    const ledger = await verifyLedger(client);
    const eventos = await readAll(client);
    const desde = eventos[0];

    const propuestasRotas: { id: string; motivo: string }[] = [];
    const proposalStates = new Map<string, ProposalState>();
    let propuestasVerificadas = 0;
    for (const id of await listAggregateIds(client, PROPOSAL_AGGREGATE_TYPE)) {
      try {
        proposalStates.set(id, await loadProposalState(client, id));
        propuestasVerificadas++;
      } catch (error) {
        propuestasRotas.push({
          id,
          motivo: error instanceof Error ? error.message : 'motivo desconocido',
        });
      }
    }

    const decisionesRotas: { id: string; motivo: string }[] = [];
    const iniciativasRotas: { id: string; motivo: string }[] = [];
    const initiativeStates: InitiativeState[] = [];
    const initiativeLogs: InitiativeLog[] = [];
    let iniciativasVerificadas = 0;
    for (const id of await listAggregateIds(client, INITIATIVE_AGGREGATE_TYPE)) {
      try {
        const log = await loadInitiativeLog(client, id);
        initiativeStates.push(await verifyInitiativeLog(log));
        initiativeLogs.push(log);
        iniciativasVerificadas++;
      } catch (error) {
        iniciativasRotas.push({
          id,
          motivo: error instanceof Error ? error.message : 'motivo desconocido',
        });
      }
    }

    let materialPrivado: PrivateMaterialVerification;
    try {
      materialPrivado = await verifyRestrictedPrivateMaterialsWithin(
        client,
        deps.ports.vault,
        initiativeLogs,
      );
    } catch {
      // La pantalla de integridad nunca convierte una comprobación que no pudo correr en verde ni
      // filtra el error SQL/criptográfico. El resto del informe sigue siendo útil.
      materialPrivado = unavailablePrivateMaterialVerification();
    }

    const ejecucionRotas: { id: string; motivo: string }[] = [];
    let decisionesVerificadas = 0;
    const decisionIds = await listAggregateIds(client, DECISION_AGGREGATE_TYPE);
    const decisionStates = new Map<string, DecisionState>();
    const ratificationEvents = new Map<string, DecisionEvent>();
    for (const id of decisionIds) {
      try {
        const log = await loadDecisionLog(client, id);
        await verifyLog(log);
        // El resultado es un dato DERIVADO (ADR-0026): si hay un `ResultComputed` en el log, se
        // recomputa el escrutinio y se compara. Que coincida es lo que impide que un resultado
        // publicado no corresponda a los votos emitidos.
        const anclado = log.find((e) => e.payload.type === 'ResultComputed');
        if (anclado !== undefined && anclado.payload.type === 'ResultComputed') {
          const recomputado = await computeResult(log);
          if (recomputado.resultHash !== anclado.payload.resultHash) {
            decisionesRotas.push({
              id,
              motivo:
                `el resultado publicado (${anclado.payload.resultHash}) no coincide con el que ` +
                `producen los votos emitidos (${recomputado.resultHash})`,
            });
            continue;
          }
        }
        const state = replay(log);
        const ratification = log.find((event) => event.payload.type === 'DecisionRatified');
        if (ratification !== undefined) ratificationEvents.set(id, ratification);
        const config = state.config;
        if (config !== undefined) {
          const proposal = proposalStates.get(config.proposalId);
          const links =
            proposal?.decisions.filter(
              (link) =>
                link.decisionId === state.decisionId &&
                link.versionHash === config.proposalVersionHash,
            ) ?? [];
          if (links.length !== 1) {
            throw new Error(
              `la decisión abierta exige exactamente un enlace desde la propuesta y su versión; hay ${String(links.length)}`,
            );
          }
        }
        decisionStates.set(id, state);
        const planned = state.draft?.plannedInitiativeId;
        const planHash = state.draft?.executionPlanHash;
        if ((planned === undefined) !== (planHash === undefined)) {
          ejecucionRotas.push({
            id,
            motivo: 'la decisión no conserva juntos el plan y la iniciativa reservada',
          });
        } else if (planned !== undefined && planHash !== undefined) {
          const linked = initiativeStates.filter((item) => item.decisionId === state.decisionId);
          const frozenInitiative = initiativeStates.find((item) => item.initiativeId === planned);
          if (state.outcomeKind === 'approved') {
            const initiative = linked[0];
            if (linked.length !== 1 || initiative === undefined) {
              ejecucionRotas.push({
                id,
                motivo: `una decisión aprobada exige exactamente una iniciativa; hay ${String(linked.length)}`,
              });
            } else if (
              initiative.initiativeId !== planned ||
              initiative.proposalId !== state.config?.proposalId ||
              initiative.proposalVersionHash !== state.proposalVersionHash ||
              initiative.decisionResultHash !== state.resultHash ||
              initiative.circleId !== state.config.circleId ||
              (await executionPlanHash(initiative.executionPlan)) !== planHash
            ) {
              ejecucionRotas.push({
                id,
                motivo: 'la iniciativa no coincide con el id, vínculos o plan congelados',
              });
            } else if (state.status === 'Ratified') {
              if (
                ratification === undefined ||
                initiative.activatedAt !== ratification.occurredAt ||
                initiative.ratificationEventId !== ratification.eventId ||
                initiative.ratificationEventHash !== ratification.hash
              ) {
                ejecucionRotas.push({
                  id,
                  motivo:
                    'la decisión ratificada no tiene una InitiativeActivated enlazada al mismo evento y huella',
                });
              }
            } else if (
              initiative.activatedAt !== undefined ||
              initiative.ratificationEventId !== undefined ||
              initiative.ratificationEventHash !== undefined
            ) {
              ejecucionRotas.push({
                id,
                motivo: 'una iniciativa se activó sin que su decisión esté ratificada',
              });
            }
          } else if (linked.length !== 0 || frozenInitiative !== undefined) {
            ejecucionRotas.push({
              id,
              motivo:
                'una decisión no aprobada o todavía abierta no puede tener iniciativa, ni ocupar el identificador que reservó',
            });
          }
        }
        decisionesVerificadas++;
      } catch (error) {
        decisionesRotas.push({
          id,
          motivo: error instanceof Error ? error.message : 'motivo desconocido',
        });
      }
    }
    // La relación se verifica también en sentido inverso. Comprobar sólo decisión → propuesta
    // permitiría inyectar un `DecisionLinked` hacia una decisión inexistente; comprobar sólo
    // propuesta → decisión permitiría una apertura huérfana. La cardinalidad legítima es 1 ↔ 1.
    for (const [proposalId, proposal] of proposalStates) {
      for (const link of proposal.decisions) {
        const decision = decisionStates.get(link.decisionId);
        if (
          decision?.config === undefined ||
          decision.config.proposalId !== proposalId ||
          decision.config.proposalVersionHash !== link.versionHash ||
          decision.proposalVersionHash !== link.versionHash
        ) {
          decisionesRotas.push({
            id: link.decisionId,
            motivo:
              'la propuesta enlaza una decisión inexistente, inválida o abierta sobre otra versión',
          });
        }
      }
    }
    for (const initiative of initiativeStates) {
      const decision = decisionStates.get(initiative.decisionId);
      if (decision === undefined) {
        ejecucionRotas.push({
          id: initiative.initiativeId,
          motivo: 'la iniciativa enlaza una decision inexistente o cuya historia no es valida',
        });
        continue;
      }
      const planned = decision.draft?.plannedInitiativeId;
      const planHash = decision.draft?.executionPlanHash;
      const config = decision.config;
      if (
        decision.outcomeKind !== 'approved' ||
        planned === undefined ||
        planHash === undefined ||
        planned !== initiative.initiativeId ||
        config === undefined ||
        initiative.decisionId !== decision.decisionId ||
        initiative.proposalId !== config.proposalId ||
        initiative.proposalVersionHash !== config.proposalVersionHash ||
        initiative.proposalVersionHash !== decision.proposalVersionHash ||
        initiative.decisionResultHash !== decision.resultHash ||
        initiative.circleId !== config.circleId ||
        (await executionPlanHash(initiative.executionPlan)) !== planHash
      ) {
        ejecucionRotas.push({
          id: initiative.initiativeId,
          motivo:
            'toda iniciativa exige una decision aprobada que reserve exactamente su id, vinculos, resultado y plan',
        });
      } else {
        const ratification = ratificationEvents.get(decision.decisionId);
        if (
          decision.status === 'Ratified' &&
          (ratification === undefined ||
            initiative.activatedAt !== ratification.occurredAt ||
            initiative.ratificationEventId !== ratification.eventId ||
            initiative.ratificationEventHash !== ratification.hash)
        ) {
          ejecucionRotas.push({
            id: initiative.initiativeId,
            motivo:
              'la activación no prueba en sentido inverso la ratificación exacta de su decisión',
          });
        } else if (
          decision.status !== 'Ratified' &&
          (initiative.activatedAt !== undefined ||
            initiative.ratificationEventId !== undefined ||
            initiative.ratificationEventHash !== undefined)
        ) {
          ejecucionRotas.push({
            id: initiative.initiativeId,
            motivo: 'la iniciativa afirma una activación que su decisión no ratificó',
          });
        }
      }
    }

    return {
      ledger,
      materialPrivado,
      hechos: eventos.length,
      desde: desde === undefined ? undefined : Date.parse(desde.event.occurredAt),
      propuestasVerificadas,
      propuestasRotas,
      decisionesVerificadas,
      decisionesRotas,
      iniciativasVerificadas,
      iniciativasRotas,
      ejecucionRotas,
    };
  });
}

/** El historial completo, tal cual está: para que cualquiera lo recompute por su cuenta. */
export async function exportarTodo(deps: ServicioDeps): Promise<{
  readonly formato: number;
  readonly eventos: readonly Record<string, unknown>[];
}> {
  return conCliente(deps.pool, async (client) => {
    const eventos = await readAll(client);
    return {
      formato: 1,
      eventos: eventos.map((e) => ({
        indice: e.leafIndex.toString(),
        agregado: e.event.aggregateId,
        tipoDeAgregado: e.event.aggregateType,
        seq: e.event.seq,
        tipo: e.event.eventType,
        version: e.event.eventVersion,
        cuando: e.event.occurredAt,
        ...(e.event.actor === undefined ? {} : { quien: e.event.actor }),
        contenido: e.payloadText,
        huellaAnterior: toHex(e.prevHash),
        huella: toHex(e.eventHash),
      })),
    };
  });
}

export { memberId, toHash };
