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
  analizarConsenso,
  type Celda,
  type MatrizVotos,
  PcaNoConvergente,
  type ResultadoAnalisis,
  SinVariacion,
} from '@koinonia/consensus';
import {
  type Aportar,
  APORTE_EN_PALABRAS,
  clavesDeAporte,
  type ConfiguracionDeMetodoHttp,
  ETAPA_EN_PALABRAS,
  type IdMetodo,
  METODOS_DISPONIBLES,
} from '@koinonia/contracts';
import {
  type Actor,
  advanceStage,
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
  type ContributionBody,
  type ContributionId,
  contributionId,
  deliberationId as toDeliberationId,
  type DeliberationLog,
  type DeliberationStage,
  type DeliberationState,
  DomainError,
  nextStage,
  normalizeLedgerText,
  openDeliberation,
  presentationSeed as toPresentationSeed,
  replayDeliberation,
  ruleFor,
  stageRule,
  submitContribution,
  verifyDeliberationLog,
  type DecisionConfig,
  type DecisionEvent,
  decisionId,
  type DecisionLog,
  type DecisionResult,
  type DecisionState,
  CORE_CLAUSE_IDS,
  DEFAULT_CHALLENGE_WINDOW_MS,
  DEFAULT_EARLY_CLOSE,
  DEFAULT_TIE_BREAK,
  DELEGATION_DISABLED,
  DELEGATION_ENABLED,
  type Delegation,
  type GradeId,
  type GradeScale,
  type StratumKey,
  delegationAt,
  delegationId as toDelegationId,
  type DelegationResolution,
  ENTRENCHED_REFORM_V1,
  FOUNDATIONAL_VALIDITY_MONTHS,
  grantDelegationBy,
  MAX_DELEGATION_VALIDITY_MS,
  ORDINARY_REFORM_V1,
  type ReformRequirements,
  revokeDelegationBy,
  vigentDelegations,
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
  type Score,
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
  addDays,
  approveReform,
  blackoutsFor,
  changedClauseIds,
  reformVotesPass,
  type Clause,
  type ClauseId,
  clauseId as toClauseId,
  type ConstitutionCommandMeta,
  type Fraction,
  type ReformId,
  type ConstitutionState,
  type ConstitutionText,
  constitutionId as toConstitutionId,
  constitutionNotice,
  type ConvenedDecision,
  currentText,
  foundConstitution,
  fraction,
  openReform,
  openReforms,
  ratifyReform,
  recordReformVote,
  type ReformCalendar,
  type ReformKind,
  type ReformRecord,
  reformId as toReformId,
  statusAt,
} from '@koinonia/domain';

import {
  assertWellFormedClauseText,
  type ClauseText,
  clauseTextHash,
  CONSTITUTION_AGGREGATE_ID,
  loadConstitutionLog,
  loadConstitutionState,
  normalizeClauseText,
  persistConstitutionLogWithin,
  readClauseTexts,
  saveClauseTextsWithin,
} from '../constitution/index.js';
import { withTransaction, type PgClient, type PgPool, type PgPoolClient } from '../db/client.js';
import { loadDecisionLog, persistDecisionLogWithin } from '../decision/repository.js';
import { DECISION_AGGREGATE_TYPE } from '../decision/codec.js';
import { lockLedgerWithin, readAll, readAppendRequestWithin } from '../ledger/event-store.js';

import { ANCHOR_AGGREGATE_TYPE } from '@koinonia/anchor';

import { IdempotencyConflictError, type AppendResult } from '../ledger/types.js';
import { verifyLedger, type LedgerVerification } from '../ledger/verify.js';
import {
  DELIBERATION_AGGREGATE_TYPE,
  listAggregateIds,
  loadDeliberationLog,
  loadDeliberationState,
  loadInitiativeLog,
  loadInitiativeState,
  loadProblemLog,
  loadProposalLog,
  loadProposalState,
  persistDeliberationLog,
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

/**
 * Método soportado al abrir una decisión. El motor (`@koinonia/domain`) implementa los nueve
 * métodos de `packages/contracts/src/metodos.ts` desde ADR-0047; hasta este incremento la frontera
 * HTTP sólo dejaba elegir dos (`simple-majority`, `sociocratic-consent`) porque `construirMetodo`,
 * `construirQuorum` y `queHaceFaltaParaQuePase` sólo sabían construir esos dos. Alias de `IdMetodo`
 * —el mismo tipo que ya usa el catálogo— para no tener dos nombres del mismo conjunto de valores.
 */
export type MetodoSoportado = IdMetodo;

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

/**
 * Escala neutra de cinco menciones (Balinski–Laraki), el default institucional de
 * `majority-judgment` cuando quien abre la votación no manda una propia. Misma escala que usa la
 * batería de pruebas del motor (`packages/domain/test/tally-helpers.ts`, `FIVE_GRADE_SCALE`): no
 * es un invento de esta capa, es la que el dominio ya ejercita.
 */
const ESCALA_DE_MENCIONES_POR_DEFECTO: GradeScale = {
  grades: [
    { id: 'excelente' as GradeId, label: 'Excelente' },
    { id: 'buena' as GradeId, label: 'Buena' },
    { id: 'aceptable' as GradeId, label: 'Aceptable' },
    { id: 'insuficiente' as GradeId, label: 'Insuficiente' },
    { id: 'rechazar' as GradeId, label: 'Rechazar' },
  ],
};

/** Los dos ejes con los que ya se congela el padrón (`congelarPadron`): el sorteo deliberativo se
 * reparte por los mismos, para que la muestra represente lo mismo que ya representa el censo. */
const ESTRATOS_DEL_SORTEO_POR_DEFECTO: readonly StratumKey[] = [
  stratumKey('semestre'),
  stratumKey('jornada'),
];

/** `abstenciones` del contrato público → `AbstentionPolicy` del motor. Mismo orden que
 * `configuracionDeMetodoHttp` en `http.ts`. */
const ABSTENCIONES_A_POLITICA = {
  excluir: 'exclude',
  incluir: 'include',
  'como-no': 'as-no',
} as const;

function comoFraccion(f: { readonly numerador: number; readonly denominador: number }): Fraction {
  return ratio(f.numerador, f.denominador);
}

/**
 * Las reglas del juego de cada uno de los nueve métodos (GOVERNANCE §4 para los que tienen fila
 * propia; el resto, los defaults documentados en `packages/contracts/src/metodos.ts`, que es el
 * catálogo que la pantalla lee para saber qué preguntar).
 *
 * `configuracion`, si viene, ya está comprobada por el llamador como perteneciente a `metodo`
 * (`configuracion.metodo === metodo`); acá sólo se leen sus campos opcionales para reemplazar el
 * default correspondiente.
 */
function construirMetodo(
  metodo: IdMetodo,
  configuracion: ConfiguracionDeMetodoHttp | undefined,
  contexto: { readonly seedCommitment: Hash },
): DecisionConfig['method'] {
  switch (metodo) {
    case 'simple-majority': {
      // Fila 6/8 de GOVERNANCE §4: mayoría simple, más síes que noes, abstenciones fuera del
      // denominador (B.1.b) salvo que se pida otra cosa explícitamente.
      const cfg = configuracion?.metodo === 'simple-majority' ? configuracion : undefined;
      return {
        kind: 'simple-majority',
        abstentionPolicy: ABSTENCIONES_A_POLITICA[cfg?.abstenciones ?? 'excluir'],
        base: 'cast',
        tieBreak: DEFAULT_TIE_BREAK,
      };
    }
    case 'supermajority': {
      // GOVERNANCE §4 fila 3: dos de cada tres, no estricto, salvo que se configure otra fracción.
      const cfg = configuracion?.metodo === 'supermajority' ? configuracion : undefined;
      return {
        kind: 'supermajority',
        fraction: cfg?.fraccion === undefined ? ratio(2, 3) : comoFraccion(cfg.fraccion),
        strict: cfg?.estricto ?? false,
        base: 'cast',
        abstentionPolicy: 'exclude',
        tieBreak: DEFAULT_TIE_BREAK,
      };
    }
    case 'unanimity': {
      // B.4.a: la regla más fuerte por defecto — cualquier abstención rompe la unanimidad — salvo
      // que el círculo la haya desactivado explícitamente al abrir.
      const cfg = configuracion?.metodo === 'unanimity' ? configuracion : undefined;
      return {
        kind: 'unanimity',
        base: 'cast',
        abstentionBlocks: cfg?.abstencionesBloquean ?? true,
      };
    }
    case 'sociocratic-consent': {
      // Fila 2 de GOVERNANCE §4: acuerdo interno de un círculo. La mitad del círculo se
      // manifiesta y cero objeciones admitidas sin integrar.
      const cfg = configuracion?.metodo === 'sociocratic-consent' ? configuracion : undefined;
      return {
        kind: 'sociocratic-consent',
        maxRounds: cfg?.rondasMaximas ?? 3,
        admissibility: {
          panelSize: 3,
          dismissThreshold: ratio(2, 3),
          panelSelection: 'sortition',
          panelDeadline: (cfg?.plazoDelPanelHoras ?? 72) * HORA_MS,
        },
        silenceMeans: 'not-participating',
        minEngagement:
          cfg?.minimoDeParticipacion === undefined
            ? ratio(1, 2)
            : comoFraccion(cfg.minimoDeParticipacion),
      };
    }
    case 'score': {
      const cfg = configuracion?.metodo === 'score' ? configuracion : undefined;
      return {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage:
          cfg?.coberturaMinima === undefined ? ratio(1, 2) : comoFraccion(cfg.coberturaMinima),
        tieBreak: DEFAULT_TIE_BREAK,
      };
    }
    case 'irv': {
      const cfg = configuracion?.metodo === 'irv' ? configuracion : undefined;
      return {
        kind: 'irv',
        exhaustedPolicy: 'reduce-quota',
        eliminationTieBreak: DEFAULT_TIE_BREAK,
        allowTruncation: cfg?.admiteTruncamiento ?? true,
        tieBreak: DEFAULT_TIE_BREAK,
      };
    }
    case 'majority-judgment': {
      // ADR-0028: método por defecto del proyecto para dos o más opciones sustantivas.
      const cfg = configuracion?.metodo === 'majority-judgment' ? configuracion : undefined;
      const scale: GradeScale =
        cfg?.escala === undefined
          ? ESCALA_DE_MENCIONES_POR_DEFECTO
          : { grades: cfg.escala.map((g) => ({ id: g.id as GradeId, label: g.etiqueta })) };
      return {
        kind: 'majority-judgment',
        scale,
        // B.7.b: una papeleta que no menciona alguna opción se descarta entera. Es la regla más
        // exigente; la alternativa ('worst') la elige quien abre, en `configuracion`.
        missingGradePolicy: 'reject-ballot',
        tieBreak: DEFAULT_TIE_BREAK,
      };
    }
    case 'condorcet-schulze': {
      const cfg = configuracion?.metodo === 'condorcet-schulze' ? configuracion : undefined;
      return {
        kind: 'condorcet-schulze',
        allowTruncation: cfg?.admiteTruncamiento ?? true,
        // B.8.b: las opciones omitidas empatan en último lugar, nunca se inventa un orden.
        truncatedMeans: 'tied-last',
        tieBreak: DEFAULT_TIE_BREAK,
      };
    }
    case 'deliberative-sortition': {
      // ADR-0031: muestra de 5 por defecto, repartida por los mismos ejes del padrón.
      const cfg = configuracion?.metodo === 'deliberative-sortition' ? configuracion : undefined;
      return {
        kind: 'deliberative-sortition',
        sampleSize: cfg?.tamanoDeMuestra ?? 5,
        strata: ESTRATOS_DEL_SORTEO_POR_DEFECTO,
        allocation: 'proportional',
        seedCommitment: contexto.seedCommitment,
      };
    }
    default: {
      // Red de seguridad de tipos: si `IdMetodo` alguna vez gana un décimo valor sin que este
      // switch se actualice, esto falla en tiempo de compilación (never) y, si algo se saltara el
      // tipo, en tiempo de ejecución con un 400 claro en vez de una configuración a medio construir.
      const _exhaustivo: never = metodo;
      throw new ServicioError('DATOS_INVALIDOS', 400, `método desconocido: ${String(_exhaustivo)}`);
    }
  }
}

/**
 * El quórum de cada método. Los nueve, salvo dos, comparten la misma exigencia institucional de
 * GOVERNANCE §4 filas 6/8 —75 de 300, es decir 1/4 del censo— porque ninguna fila de GOVERNANCE.md
 * define un piso de participación distinto para puntuación, rondas, menciones o comparación por
 * pares: son formas distintas de contar la MISMA papeleta emitida por el MISMO censo, no votaciones
 * con una exigencia de participación propia.
 *
 * Los dos que sí difieren tienen razones estructurales, no arbitrarias: `sociocratic-consent` mide
 * participación DENTRO del círculo, no sobre el censo entero (un acuerdo interno de doce personas no
 * puede exigir que se manifieste medio censo); `deliberative-sortition` no tiene papeleta que contar
 * — el sorteo en sí es el mecanismo — así que no hay participación que exigir.
 */
function construirQuorum(metodo: IdMetodo, circulo: CircleId): DecisionConfig['quorum'] {
  if (metodo === 'sociocratic-consent') {
    return {
      participation: ratio(0, 1),
      perCircle: [{ circleId: circulo, min: ratio(1, 2) }],
      onFailure: 'reject',
      maxExtensions: 0,
      extensionDuration: 0,
    };
  }
  if (metodo === 'deliberative-sortition') {
    return {
      participation: ratio(0, 1),
      onFailure: 'reject',
      maxExtensions: 0,
      extensionDuration: 0,
    };
  }
  // 75 de 300 = 1/4 (GOVERNANCE §4, filas 6 y 8).
  return {
    participation: ratio(1, 4),
    onFailure: 'reject',
    maxExtensions: 0,
    extensionDuration: 0,
  };
}

/** Qué hace falta para que esto pase, **en palabras**. Va siempre en la papeleta (PRODUCT §4). */
export function queHaceFaltaParaQuePase(metodo: IdMetodo, podianDecidir: number): string {
  const minimo = Math.ceil(podianDecidir / 4);
  switch (metodo) {
    case 'simple-majority':
      return (
        `Se aprueba si hay más síes que noes. Las abstenciones no cuentan para ese cálculo, pero ` +
        `sí para la participación mínima: tienen que responder al menos ${String(minimo)} de las ` +
        `${String(podianDecidir)} personas que podían decidir aquí.`
      );
    case 'supermajority':
      return (
        `Se aprueba si al menos dos de cada tres respuestas dicen que sí (salvo que se haya ` +
        `pedido otra fracción al abrir). Las abstenciones no cuentan para ese cálculo, pero sí ` +
        `para la participación mínima: tienen que responder al menos ${String(minimo)} de las ` +
        `${String(podianDecidir)} personas que podían decidir aquí.`
      );
    case 'unanimity':
      return (
        `Se aprueba únicamente si nadie dice que no. Salvo que el círculo haya decidido lo ` +
        `contrario al abrir, cualquier abstención también rompe el acuerdo. Tienen que responder ` +
        `al menos ${String(minimo)} de las ${String(podianDecidir)} personas que podían decidir aquí.`
      );
    case 'sociocratic-consent':
      return (
        'No hace falta que a todos les guste; hace falta que nadie muestre un daño. Pasa si al ' +
        'cerrar no queda ninguna objeción en pie y si se manifestó al menos la mitad del grupo. ' +
        'Una reserva se registra y no bloquea; una objeción bloquea y exige decir qué se daña.'
      );
    case 'score':
      return (
        `Cada persona pone una nota de 0 a 5 a cada opción. Gana la que tenga la nota de en medio ` +
        `más alta entre quienes respondieron. Tienen que responder al menos ${String(minimo)} de ` +
        `las ${String(podianDecidir)} personas que podían decidir aquí.`
      );
    case 'irv':
      return (
        `Cada persona ordena las opciones de la que más prefiere a la que menos. Si nadie junta ` +
        `más de la mitad de las primeras preferencias, se descarta la opción con menos apoyo y se ` +
        `reparten sus votos según la siguiente preferencia, hasta que alguna llegue a la mitad. ` +
        `Tienen que responder al menos ${String(minimo)} de las ${String(podianDecidir)} personas ` +
        `que podían decidir aquí.`
      );
    case 'majority-judgment':
      return (
        `Cada persona pone una mención a cada opción, de la mejor a la peor. Gana la que tenga la ` +
        `mención de en medio más alta; si dos empatan en esa mención, se desempata quitando de a ` +
        `una las menciones repetidas hasta que una de las dos quede mejor ubicada. Tienen que ` +
        `responder al menos ${String(minimo)} de las ${String(podianDecidir)} personas que podían ` +
        `decidir aquí.`
      );
    case 'condorcet-schulze':
      return (
        `Cada persona ordena las opciones. Se comparan de a pares y gana la que le gana a todas ` +
        `las demás una contra una; si ninguna le gana a todas, se resuelve repitiendo la ` +
        `comparación entre las que van quedando hasta encontrar la que resiste mejor. Tienen que ` +
        `responder al menos ${String(minimo)} de las ${String(podianDecidir)} personas que podían ` +
        `decidir aquí.`
      );
    case 'deliberative-sortition':
      return (
        `No hay papeleta que llenar: se sortea al azar un grupo pequeño de las ` +
        `${String(podianDecidir)} personas del censo, con sorteo público y verificable, y ese ` +
        `grupo es el que delibera y decide.`
      );
    default: {
      const _exhaustivo: never = metodo;
      return `método desconocido: ${String(_exhaustivo)}`;
    }
  }
}

export interface DecisionAbierta {
  readonly id: string;
  readonly state: DecisionState;
  readonly config: DecisionConfig;
}

/**
 * El tope de concentración es una **fracción del censo**, y con poca gente esa fracción es cero.
 *
 * HALLAZGO (aparecido al construir la pantalla de delegaciones). `DELEGATION_ENABLED` fija el tope
 * en una décima parte del censo, que es lo que dice ADR-0029 pensando en 300 personas. Con menos de
 * diez, `⌊censo/10⌋` vale 0 y la configuración es contradictoria: el dominio la rechaza —y hace
 * bien, porque una delegación habilitada e inejercitable es el fallo silencioso de INV-32—. Con
 * menos de veinte vale 1, que es el peso propio de cada quien: la delegación se puede encender pero
 * la primera concesión choca contra el tope.
 *
 * El dominio ya falla cerrado. Lo que faltaba es que fallara **en palabras**: su mensaje trae
 * `⌊1·9/10⌋` y una referencia de especificación, y ese texto llega tal cual a la pantalla de quien
 * facilita, que no tiene por qué leer una fórmula para entender que todavía son pocos. Así que la
 * condición se comprueba antes, aquí, y se dice en castellano. La regla sigue siendo del dominio;
 * esta capa sólo la traduce a tiempo.
 */
function asertarQueSePuedePrestarElVoto(censo: number): void {
  const tope = (DELEGATION_ENABLED.cap.num * BigInt(censo)) / DELEGATION_ENABLED.cap.den;
  if (tope >= 2n) return;
  throw new ServicioError(
    'DELEGACION_SIN_MARGEN',
    409,
    `todavía son muy pocas personas para prestar el voto: con ${String(censo)} en la lista, ` +
      'nadie podría cargar el voto de nadie sin pasarse del tope que impide que la voz se ' +
      'concentre. Abrí esta votación sin préstamo de voto.',
  );
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
    /**
     * Configuración pública del método elegido (`packages/contracts/src/metodos.ts`). Si se omite,
     * `construirMetodo` usa los valores por defecto del catálogo. Si viene, su campo `metodo` tiene
     * que coincidir con `metodo` de aquí arriba — lo comprueba `construirMetodo`, no este tipo,
     * porque son dos campos hermanos y no hay forma de expresar esa igualdad en el sistema de tipos
     * sin un genérico que ningún llamador necesita.
     */
    readonly configuracion?: ConfiguracionDeMetodoHttp | undefined;
    /**
     * Si en esta votación se puede prestar el voto.
     *
     * Apagado por defecto, que es el default institucional: delegar es un acto explícito de
     * configuración y una delegación colgada por error no debe alterar un escrutinio que se abrió
     * sin ella. Antes esto era una constante y no había forma de encenderlo: todo el motor de
     * democracia líquida —tope de concentración, detección de ciclos, devolución LIFO— estaba
     * construido, probado y **apagado con un literal**, así que nadie podía usarlo nunca.
     */
    readonly delegacion?: boolean | undefined;
  },
): Promise<DecisionAbierta> {
  if (input.configuracion !== undefined && input.configuracion.metodo !== input.metodo) {
    throw new ServicioError(
      'DATOS_INVALIDOS',
      400,
      'la configuración que mandaste es de otro método: revisá el campo "metodo" de "configuracion"',
    );
  }
  if (input.delegacion === true && !METODOS_DISPONIBLES[input.metodo].delegacionPermitida) {
    throw new ServicioError(
      'DELEGACION_NO_ADMITIDA',
      409,
      'el método elegido no admite prestar el voto: abrí esta votación sin préstamo de voto o ' +
        'elegí otro método.',
    );
  }
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
        config.window.closesAt - config.window.opensAt === input.duracionHoras * HORA_MS &&
        // Sin esta línea, reintentar con la misma clave y `delegacion` cambiada devolvería la
        // votación anterior como si fuera la pedida: quien creyó abrirla con delegación se
        // encontraría con que prestar el voto no existe, y sin ningún error de por medio.
        config.delegation.enabled === (input.delegacion === true);
      if (!sameRequestedOpening) {
        throw new ServicioError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          'esa clave ya abrió otra propuesta, método, duración o forma de delegar; usá una clave nueva',
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
    if (input.delegacion === true) {
      asertarQueSePuedePrestarElVoto(electorate.censusSize);
    }

    const config = await buildDecisionConfig({
      decisionId: id,
      proposalId: toProposalId(input.propuestaId),
      proposalVersionHash: version.versionHash,
      circleId: circulo,
      // `topics` se congela SIEMPRE vacío. Es una decisión, no un hueco por rellenar después.
      //
      // HALLAZGO (segundo intento de la tarea de delegación por tema). El primer intento expuso un
      // ámbito de delegación `'tema'` por HTTP mientras esta línea seguía congelando `topics: []` en
      // TODA decisión: `matchesScope` para ese ámbito (`packages/domain/src/delegation-graph.ts`)
      // exige `subject.topics.includes(scope.topicId)`, y con `topics` siempre vacío esa condición
      // es `false` en cualquier decisión que este producto abra, hoy y dentro de seis meses. Una
      // delegación de tema se habría escrito igual en el historial —que es de sólo-anexar e
      // irreparable— prometiendo un préstamo que NUNCA podría regir, y la pantalla la habría
      // mostrado como activa. Un revisor independiente lo rechazó con razón: escribir una mentira
      // permanente en un registro irreparable es peor que no tener la función.
      //
      // La causa de raíz no es esta línea: es que no existe, en ningún punto del producto, un
      // catálogo de temas ni una pantalla donde quien abre una votación pueda etiquetarla con
      // alguno. No hay nada legítimo que pudiera ir en este array todavía; rellenarlo con datos
      // inventados sólo para que la delegación por tema tuviera algo contra qué casar sería la misma
      // mentira por otra puerta. Por eso esta sesión no expone el ámbito de tema por ninguna ruta
      // (`delegarVoto`, más abajo, sigue concediendo únicamente `circle` — ver el porqué junto a esa
      // línea) y deja esta congelación documentada como lo que es, no como algo transitorio. El día
      // que exista un catálogo real de temas, esta línea y esa decisión se revisan juntas.
      topics: [],
      options: [optionId(input.propuestaId)],
      electorate,
      method: construirMetodo(input.metodo, input.configuracion, { seedCommitment }),
      quorum: construirQuorum(input.metodo, circulo),
      window: {
        opensAt: at,
        closesAt: cierre,
        timezone: 'America/Bogota',
        earlyClose: DEFAULT_EARLY_CLOSE,
        challengeWindow: DEFAULT_CHALLENGE_WINDOW_MS,
      },
      privacy: 'public-roll-call',
      delegation: input.delegacion === true ? DELEGATION_ENABLED : DELEGATION_DISABLED,
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

/**
 * Leer una decisión, dejar que el dominio produzca el log siguiente y escribirlo — las tres cosas
 * dentro de la MISMA transacción y bajo el cerrojo de escritura del ledger.
 *
 * ═══ Por qué existe ═══
 *
 * Antes cada una de estas operaciones hacía `verDecision(...)` (una transacción), construía el
 * evento en memoria contra esa lectura, y llamaba a `persistDecisionLog(...)` (otra transacción).
 * Entre la lectura y la escritura no había nada que impidiera que otra persona escribiera primero,
 * y eso pasa todo el tiempo: en una votación, el último minuto es cuando vota casi todo el mundo.
 *
 * Las pruebas de carga lo midieron con 300 personas (`docs/TESTING.md` §11.2) y el resultado fue
 * peor que lentitud: de 300 papeletas sólo 2 quedaron contadas, 124 recibieron un 500 y **174
 * recibieron un `201` sobre un voto que nunca llegó a la base**. Quien recibe un 201 no tiene
 * ninguna señal de que su voto no cuenta; en un sistema de gobernanza eso es una falla de
 * integridad, no de rendimiento.
 *
 * ═══ Por qué el cerrojo y no un bucle de reintentos ═══
 *
 * `pg_advisory_xact_lock` es el cerrojo que TODA escritura del ledger toma ya (`§3.3`,
 * `lockLedgerWithin`), sólo que lo tomaba dentro de `append`, es decir **después** de que el
 * llamante hubiera leído. Tomarlo antes de leer no agrega un mecanismo nuevo al sistema: mueve el
 * principio de la sección crítica al sitio donde de verdad empieza. Un bucle de reintentos
 * optimista habría necesitado, en el peor caso, tantos intentos como personas votando a la vez, y
 * habría dejado la corrección dependiendo de un número máximo elegido a ojo.
 *
 * El costo es que las escrituras sobre decisiones se serializan de verdad. Ya se serializaban —el
 * cerrojo es global y lo toma cada `append`—; lo que se alarga es cuánto se sostiene, porque ahora
 * incluye la lectura del log. Es el precio de que un «tu voto se registró» signifique lo que dice.
 */
/**
 * Se exporta —era privada— porque `rutas-objeciones.ts` la necesita. Esa ruta era el ÚLTIMO
 * escritor del repositorio que seguía leyendo fuera del cerrojo y persistiendo después, con
 * `persistDecisionLog` sobre el pool en vez de `persistDecisionLogWithin` dentro de la
 * transacción. Ver el comentario de arriba: no es un detalle de estilo, es la diferencia entre
 * que una desestimación concurrente con una papeleta se rechace y que se escriba mal.
 */
export async function escribirSobreDecision(
  deps: ServicioDeps,
  decisionIdRaw: string,
  requestId: string,
  producir: (actual: DecisionConEstado) => Promise<DecisionLog>,
): Promise<DecisionConEstado> {
  return await withTransaction(deps.pool, async (client) => {
    // Antes de leer, no después: es el arreglo entero.
    await lockLedgerWithin(client);
    const log = await loadDecisionLog(client, decisionIdRaw);
    if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa decisión');
    const siguiente = await producir({ id: decisionIdRaw, log, state: replay(log) });
    await persistDecisionLogWithin(client, siguiente, { requestId });
    return { id: decisionIdRaw, log: siguiente, state: replay(siguiente) };
  });
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
  readonly tipo: 'binary' | 'abstain' | 'consent' | 'score' | 'ranking' | 'grades';
  readonly aprueba?: boolean | undefined;
  readonly postura?: 'consent' | 'concern' | 'object' | undefined;
  readonly objecion?:
    | {
        readonly argumento: string;
        readonly objetivoDanado: string;
        readonly enmiendaPropuesta?: string | undefined;
      }
    | undefined;
  /**
   * Una nota (0 a 5) por opción puntuada. La opción que no aparece es «sin opinión»: no cuenta
   * como cero (B.5.a). Es una LISTA, no un mapa con la opción de clave — ver `payloadDePapeleta`.
   */
  readonly puntuaciones?:
    readonly { readonly opcion: string; readonly valor: number }[] | undefined;
  /** El orden de preferencia, de la que más se prefiere a la que menos. */
  readonly orden?: readonly string[] | undefined;
  /** Una mención (de la escala congelada al abrir) por opción valorada. */
  readonly menciones?: readonly { readonly opcion: string; readonly mencion: string }[] | undefined;
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
    case 'score':
      // `BallotPayload['score'].scores` (dominio) es exactamente esta forma —una LISTA de pares
      // `{option, value}`—, no un mapa con la opción de clave: un `OptionId` de clave rompería el
      // perfil canónico del historial las más de las veces (empieza por dígito ~62 % de las veces,
      // y `null` está prohibido del todo). «Sin opinión» es la opción que no viene en
      // `puntuaciones`, y por eso no hay nada que traducir: la lista del contrato ya es la lista
      // del dominio, opción por opción.
      return {
        kind: 'score',
        scores: (respuesta.puntuaciones ?? []).map((entrada) => ({
          option: optionId(entrada.opcion),
          value: entrada.valor as Score,
        })),
      };
    case 'ranking':
      return { kind: 'ranking', order: (respuesta.orden ?? []).map((opcion) => optionId(opcion)) };
    case 'grades':
      return {
        kind: 'grades',
        grades: (respuesta.menciones ?? []).map((entrada) => ({
          option: optionId(entrada.opcion),
          grade: entrada.mencion as GradeId,
        })),
      };
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
  const votante = actor.memberId;
  if (votante === undefined) {
    throw new ServicioError(
      'UNAUTHORIZED_NOT_AUTHENTICATED',
      401,
      'emitir una papeleta exige una cuenta verificada',
    );
  }
  // La papeleta se construye DENTRO del cerrojo (ver `escribirSobreDecision`): `state.round` y el
  // largo del log tienen que ser los mismos que va a encontrar la escritura, o el voto se pierde
  // en silencio cuando otra persona vota en el mismo instante.
  return await escribirSobreDecision(deps, decisionIdRaw, input.requestId, async ({ log, state }) =>
    // `voter` es SIEMPRE el actor autenticado y jamás un campo del cuerpo de la petición. Aunque
    // alguien lo mandara, no llegaría aquí; y aunque llegara, `apply` exige `voter === actor` al
    // plegar, así que el log resultante no existiría.
    castBallotBy(log, {
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
    }),
  );
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
          'el estado ratificado no conserva lo que quedó escrito de la ratificación',
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
      'lo que quedó escrito enlazado no es una ratificación',
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
): Promise<{
  readonly resultado: DecisionResult;
  readonly state: DecisionState;
  readonly iniciativaId?: string;
}> {
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
      state,
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
// Deliberación
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface DeliberacionConId {
  readonly id: string;
  readonly state: DeliberationState;
}

/**
 * ¿Esta etapa oculta todavía quién escribió cada aporte?
 *
 * Se **deriva de la matriz** (`ruleFor('deliberation:read-authorship').deniedDuringStage`), nunca de
 * una copia de la palabra `perspectivas`: si la regla cambiara de etapa —o dejara de tener alcance
 * temporal— la pantalla cambia con ella. Una constante repetida aquí sería la segunda fuente de
 * verdad que ADR-0049 evitó al meter la regla en la tabla de acceso.
 *
 * No tiene actor y **no sustituye a `authorize`**: nadie lee una autoría por este camino. Decide qué
 * frase le toca a la pantalla y nada más. Vivía en `ledger/export.ts` mientras el export retuvo
 * deliberaciones, porque allí respondía además a «¿qué se retiene?»; retirada la retención, se
 * mudó junto a su único consumidor en vez de quedarse de huésped en un módulo que ya no la llama.
 */
export function ocultaLaAutoria(stage: DeliberationStage): boolean {
  return ruleFor('deliberation:read-authorship').deniedDuringStage === stage;
}

/**
 * Los conjuntos de aristas viajan **ordenados** hacia el dominio.
 *
 * El motor los exige estrictamente ordenados porque entran en la preimagen de hash del evento
 * (`graph.ts`, regla 1 de `canonical.ts`): dos implementaciones honestas que los ordenaran distinto
 * producirían dos huellas del mismo aporte. Ordenarlos aquí **no es acomodar una entrada inválida**
 * —el duplicado se rechaza en la frontera con Zod, y sigue rechazándose en el motor—: es que el
 * orden de una casilla marcada en un formulario no es información, y hacérselo escribir al cliente
 * sería inventar un requisito que ninguna persona puede cumplir a mano.
 */
function conjuntoDeAportes(ids: readonly string[]): readonly ContributionId[] {
  return [...ids].sort().map((id) => contributionId(id));
}

/** Del cuerpo de la petición al cuerpo del dominio. Nombres del contrato → nombres del motor. */
function cuerpoDeAporte(input: AportarHttp): ContributionBody {
  switch (input.tipo) {
    case 'posicion':
      return { kind: 'posicion', mode: input.modo, text: normalizeLedgerText(input.texto) };
    case 'razon':
      return {
        kind: 'razon',
        relation: input.relacion,
        positionId: contributionId(input.posicionId),
        text: normalizeLedgerText(input.texto),
      };
    case 'evidencia':
      return {
        kind: 'evidencia',
        supportsReasonId: contributionId(input.sostieneRazonId),
        text: normalizeLedgerText(input.texto),
        ...(input.fuente === undefined ? {} : { source: normalizeLedgerText(input.fuente) }),
      };
    case 'supuesto':
      return {
        kind: 'supuesto',
        appliesToContributionIds: conjuntoDeAportes(input.aplicaA),
        text: normalizeLedgerText(input.texto),
      };
    case 'riesgo':
      return {
        kind: 'riesgo',
        alternativeId: contributionId(input.salidaId),
        severity: input.gravedad,
        impact: normalizeLedgerText(input.impacto),
        mitigation: normalizeLedgerText(input.mitigacion),
      };
    case 'alternativa':
      return {
        kind: 'alternativa',
        problemId: input.problemaId,
        sourcePositionIds: conjuntoDeAportes(input.saleDe),
        text: normalizeLedgerText(input.texto),
      };
  }
}

/**
 * Qué se puede escribir **ahora**, en palabras. Sale de la tabla del motor, no de una copia.
 *
 * Se nombra por la combinación tipo × modo × relación y no por el tipo a secas. La diferencia no es
 * cosmética: en `Preguntas` el motor admite un aporte de tipo `posicion`, pero sólo en modo
 * pregunta. Decir «acá se escribe: postura» en la etapa que rechaza una postura es peor que no
 * decir nada, y es exactamente lo que hacía la primera versión de esta función.
 */
export function queSePuedeEscribirAhora(stage: DeliberationStage): string {
  const regla = stageRule(stage);
  if (regla.kinds.length === 0) {
    return 'En esta etapa ya no se escribe: lo que sigue es una decisión.';
  }
  const nombres = clavesDeAporte({
    tiposQueSeAdmitenAhora: regla.kinds,
    modosQueSeAdmitenAhora: regla.positionModes,
    relacionesQueSeAdmitenAhora: regla.reasonRelations,
  }).map((clave) => APORTE_EN_PALABRAS[clave].nombre.toLowerCase());
  const lista =
    nombres.length === 1
      ? nombres[0]
      : `${nombres.slice(0, -1).join(', ')} y ${String(nombres.at(-1))}`;
  const matiz =
    stage === 'preguntas_aclaratorias'
      ? ' Todavía no se opina: primero se entiende el problema.'
      : stage === 'perspectivas'
        ? ' Todavía no se proponen salidas: primero se dice cómo se ve el problema.'
        : stage === 'enmiendas'
          ? ' Cada salida que escribas acá corrige a una anterior.'
          : '';
  return `Acá se escribe: ${String(lista)}.${matiz}`;
}

/**
 * Traduce el rechazo de la tabla etapa × tipo de aporte a una frase que se entiende.
 *
 * La decisión sigue siendo del motor —esta función sólo se ejecuta **después** de que el motor
 * rechazó— y la etapa sale del estado plegado, no del cliente. Sin esto, la persona leería
 * «la etapa perspectivas no admite aportes de tipo riesgo; admite [posicion, razon, evidencia,
 * supuesto]», que es la tabla interna en crudo.
 */
function conRechazoEnPalabras(stage: DeliberationStage, error: unknown): never {
  const traducibles = new Set([
    'CONTRIBUTION_KIND_NOT_ALLOWED',
    'POSITION_MODE_NOT_ALLOWED',
    'REASON_RELATION_NOT_ALLOWED',
  ]);
  if (error instanceof DomainError && traducibles.has(error.code)) {
    throw new ServicioError(
      error.code,
      422,
      `Eso no se escribe en «${ETAPA_EN_PALABRAS[stage]}», que es la etapa en la que va la ` +
        `conversación. ${queSePuedeEscribirAhora(stage)}`,
    );
  }
  throw error;
}

async function conLogDeDeliberacion(
  deps: ServicioDeps,
  deliberacionId: string,
  fn: (log: DeliberationLog, state: DeliberationState) => Promise<DeliberationLog>,
  requestId: string,
): Promise<DeliberacionConId> {
  const log = await conCliente(deps.pool, (c) => loadDeliberationLog(c, deliberacionId));
  if (log.length === 0) {
    throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa conversación');
  }
  // Se verifica la cadena ANTES de escribir encima: añadir un evento a un historial que ya no
  // cuadra sería sellar la rotura con una firma nueva.
  const state = await verifyDeliberationLog(log);
  const siguiente = await fn(log, state);
  await persistDeliberationLog(deps.pool, siguiente, { requestId });
  return { id: deliberacionId, state: replayDeliberation(siguiente) };
}

/**
 * Abre la deliberación de un problema, en `Preguntas` y con plazo.
 *
 * La semilla del orden de presentación **entra como dato**: el dominio no genera azar. Es lo que
 * permite que cualquiera recompute el orden en que le aparecieron los aportes a otra persona y
 * compruebe que nadie puso el dedo.
 */
export async function abrirDeliberacion(
  deps: ServicioDeps,
  actor: Actor,
  input: {
    readonly requestId: string;
    readonly problemaId: string;
    readonly duracionHoras: number;
  },
): Promise<DeliberacionConId> {
  // «No se delibera sin problema»: se comprueba que el problema EXISTE en el historial, no que el
  // cliente mandó un identificador con forma de tal.
  const problema = await verProblema(deps, input.problemaId);
  const circulo = problema.state.circleId;
  if (circulo === undefined) {
    throw new ServicioError('NO_ENCONTRADO', 404, 'ese problema no tiene grupo competente');
  }

  const id = deps.ports.random.opaqueId();
  const at = ahora(deps);
  const log = await openDeliberation(
    { eventId: nuevoEventId(deps), at, actor },
    {
      deliberationId: toDeliberationId(id),
      problemId: input.problemaId,
      circleId: circulo,
      opensAt: at,
      closesAt: instant(at + input.duracionHoras * HORA_MS),
      presentationSeed: toPresentationSeed(deps.ports.random.opaqueId()),
    },
  );
  await persistDeliberationLog(deps.pool, log, { requestId: input.requestId });
  return { id, state: replayDeliberation(log) };
}

/** Lo que la interfaz manda como aporte. Es el contrato de `@koinonia/contracts`, ya validado. */
export type AportarHttp = Aportar;

export async function aportarADeliberacion(
  deps: ServicioDeps,
  actor: Actor,
  deliberacionId: string,
  input: AportarHttp,
): Promise<DeliberacionConId> {
  const nuevoId = deps.ports.random.opaqueId();
  return conLogDeDeliberacion(
    deps,
    deliberacionId,
    async (log, state) => {
      try {
        return await submitContribution(
          log,
          { eventId: nuevoEventId(deps), at: ahora(deps), actor },
          {
            contributionId: contributionId(nuevoId),
            body: cuerpoDeAporte(input),
            ...(input.corrigeA === undefined
              ? {}
              : { supersedesContributionId: contributionId(input.corrigeA) }),
          },
        );
      } catch (error) {
        return conRechazoEnPalabras(state.stage, error);
      }
    },
    input.requestId,
  );
}

/**
 * Avanza a la etapa siguiente. La causa **no la elige quien llama**: la deriva el reloj del
 * servidor contra la ventana vigente, y el dominio comprueba el plazo si dice `deadline`.
 *
 * La ventana nueva dura lo mismo que la que se cierra. Es una decisión de producto —el ritmo de la
 * conversación no cambia porque cambie la etapa— y no del motor, que sólo exige que dure algo.
 */
export async function avanzarEtapaDeliberacion(
  deps: ServicioDeps,
  actor: Actor,
  deliberacionId: string,
  input: { readonly requestId: string },
): Promise<DeliberacionConId> {
  return conLogDeDeliberacion(
    deps,
    deliberacionId,
    async (log, state) => {
      const siguiente = nextStage(state.stage);
      if (siguiente === undefined) {
        throw new ServicioError(
          'ILLEGAL_TRANSITION',
          422,
          'esta conversación ya está lista para decidir: no hay una etapa después',
        );
      }
      const at = ahora(deps);
      const duracion =
        state.opensAt === undefined || state.closesAt === undefined
          ? HORA_MS
          : state.closesAt - state.opensAt;
      return await advanceStage(
        log,
        { eventId: nuevoEventId(deps), at, actor },
        {
          to: siguiente,
          cause: state.closesAt !== undefined && at >= state.closesAt ? 'deadline' : 'manual',
          opensAt: at,
          closesAt: instant(at + duracion),
          presentationSeed: toPresentationSeed(deps.ports.random.opaqueId()),
        },
      );
    },
    input.requestId,
  );
}

export async function listarDeliberaciones(
  deps: ServicioDeps,
): Promise<readonly DeliberacionConId[]> {
  return conCliente(deps.pool, async (client) => {
    const salida: DeliberacionConId[] = [];
    for (const id of await listAggregateIds(client, DELIBERATION_AGGREGATE_TYPE)) {
      salida.push({ id, state: await loadDeliberationState(client, id) });
    }
    return salida;
  });
}

export async function verDeliberacion(deps: ServicioDeps, id: string): Promise<DeliberacionConId> {
  return conCliente(deps.pool, async (client) => {
    const log = await loadDeliberationLog(client, id);
    if (log.length === 0) {
      throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa conversación');
    }
    return { id, state: await verifyDeliberationLog(log) };
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
  readonly deliberacionesVerificadas: number;
  readonly deliberacionesRotas: readonly { readonly id: string; readonly motivo: string }[];
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

    // Las conversaciones se vuelven a armar enteras. No es una comprobación de adorno: el plegado es
    // donde se revalida que cada aporte sigue a nombre de quien lo escribió y que ninguno responde a
    // algo que no está. Sin esta fila, una conversación rota sólo se notaría porque el export la
    // retiene para siempre —y una retención permanente sin alarma es un fallo silencioso.
    const deliberacionesRotas: { id: string; motivo: string }[] = [];
    let deliberacionesVerificadas = 0;
    for (const id of await listAggregateIds(client, DELIBERATION_AGGREGATE_TYPE)) {
      try {
        await loadDeliberationState(client, id);
        deliberacionesVerificadas++;
      } catch (error) {
        deliberacionesRotas.push({
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
      deliberacionesVerificadas,
      deliberacionesRotas,
    };
  });
}

/**
 * El historial, tal cual está y **entero**, para que cualquiera lo recompute por su cuenta.
 *
 * Esta es la superficie de `ledger:export`, que la matriz declara `OPEN`: la sirve cualquier persona
 * sin cuenta, desde el enlace de descarga de «Verificar integridad».
 *
 * ═══ Aquí hubo una retención, y se retiró ═══
 *
 * Mientras «perspectivas» siguiera abierta, los hechos de esa deliberación no salían por aquí y un
 * campo `retenidos` declaraba qué faltaba y por qué. Cerraba la deuda que ADR-0049 dejó anotada
 * —quien no puede leer una autoría por la API la leía descargando esto— y se pagaba con los cuatro
 * hallazgos que el verificador independiente levanta ante un historial con huecos, uno de ellos
 * `COLA_TRUNCADA`, que es literalmente el nombre de un ataque. Un historial público al que hay que
 * explicarle a quien audita por qué está roto ya no es un historial público.
 *
 * Se eligió la verificabilidad. La protección frente a los pares —que es el objetivo de producto—
 * la sigue dando `deliberation:read-authorship`, denegada durante la etapa en la API y en la
 * pantalla. Y el alcance de lo que eso NO cubre se dice en la pantalla, no se calla:
 * `AVISO_AUTORIA_OCULTA` declara que quien descargue el historial completo sí puede ver quién
 * escribió cada aporte.
 */
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

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Consenso: en qué coincide la gente y en qué no
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * De dónde salen los grupos de opinión.
 *
 * `@koinonia/consensus` pide una matriz de personas × afirmaciones. Aquí la afirmación es **la
 * propuesta que se sometió a votación** y la respuesta es la papeleta que cada quien emitió, que en
 * este sistema es pública por diseño (`privacy: 'public-roll-call'`): quien descarga el historial ya
 * puede ver quién votó qué. El análisis no publica nada que no estuviera publicado; lo que hace es
 * decir en qué se parecen y en qué se separan esas respuestas.
 *
 * Se toman **sólo las votaciones cerradas**. Una votación abierta cambiaría el mapa a cada papeleta
 * y, sobre todo, enseñaría el marcador a quien todavía no votó: el análisis es agenda para la
 * conversación siguiente, nunca un sondeo en vivo que induzca el voto.
 */
const CONSENSO_PARTICIPANTES_MINIMOS = 6;

/** Con menos de tres votaciones no hay eje sobre el que separar a nadie: hay coincidencias. */
const CONSENSO_VOTACIONES_MINIMAS = 3;

export interface MatrizDeConsenso {
  readonly matriz: MatrizVotos;
  readonly textos: readonly string[];
  /** Participantes en el orden de las filas. Sirve para decirle a cada quien en qué grupo quedó. */
  readonly participantes: readonly MemberId[];
  readonly votaciones: number;
}

/** `+1` a favor, `-1` en contra, `0` se abstuvo o expresó reserva, `null` no se pronunció. */
function celdaDePapeleta(payload: BallotPayload): Celda {
  switch (payload.kind) {
    case 'binary':
      return payload.approve ? 1 : -1;
    case 'abstain':
      return 0;
    case 'consent':
      // Una reserva no es un desacuerdo: se registra y no bloquea. Colapsarla con la objeción
      // fabricaría un bando que la persona no eligió.
      return payload.stance === 'consent' ? 1 : payload.stance === 'object' ? -1 : 0;
    default:
      // Los métodos con puntuación u orden no están en el corte vertical. Antes que traducirlos
      // a un signo inventado, no se cuentan: una celda vacía es «no lo sabemos», que es verdad.
      return null;
  }
}

/** Última papeleta de cada persona en la ronda vigente. Cambiar de opinión no suma dos filas. */
function ultimaPapeletaPorVotante(state: DecisionState): ReadonlyMap<MemberId, BallotPayload> {
  const ultima = new Map<MemberId, { readonly seq: number; readonly payload: BallotPayload }>();
  for (const papeleta of state.ballots) {
    if (papeleta.round !== state.round) continue;
    const previa = ultima.get(papeleta.voter);
    if (previa === undefined || papeleta.seq > previa.seq) {
      ultima.set(papeleta.voter, { seq: papeleta.seq, payload: papeleta.payload });
    }
  }
  return new Map([...ultima].map(([voter, { payload }]) => [voter, payload]));
}

export async function matrizDeConsenso(
  deps: ServicioDeps,
  tituloDe: (propuestaId: string, huella: string) => Promise<string>,
): Promise<MatrizDeConsenso> {
  const cerradas = (await listarDecisiones(deps)).filter(
    (d) => d.state.status !== 'Open' && d.state.status !== 'Draft',
  );

  const columnas: { readonly texto: string; readonly votos: ReadonlyMap<MemberId, Celda> }[] = [];
  const participantes = new Set<MemberId>();
  for (const { state } of cerradas) {
    const papeletas = ultimaPapeletaPorVotante(state);
    if (papeletas.size === 0) continue;
    const votos = new Map<MemberId, Celda>();
    for (const [votante, payload] of papeletas) {
      const celda = celdaDePapeleta(payload);
      if (celda === null) continue;
      votos.set(votante, celda);
      participantes.add(votante);
    }
    if (votos.size === 0) continue;
    columnas.push({
      texto: await tituloDe(state.config?.proposalId ?? '', state.proposalVersionHash ?? ''),
      votos,
    });
  }

  // Orden estable e independiente de cómo los devuelva la base: el análisis promete ser reproducible
  // y una permutación de filas que dependa del planificador de PostgreSQL lo rompería en silencio.
  const filas = [...participantes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    matriz: filas.map((persona) => columnas.map((columna) => columna.votos.get(persona) ?? null)),
    textos: columnas.map((columna) => columna.texto),
    participantes: filas,
    votaciones: columnas.length,
  };
}

/** Los tres desenlaces que la pantalla tiene que saber pintar, ya discriminados. */
export type ConsensoCalculado =
  | {
      readonly tipo: 'analizado';
      readonly resultado: ResultadoAnalisis;
      readonly datos: MatrizDeConsenso;
      /** El grupo en el que quedó quien mira, si votó en alguna de estas votaciones. */
      readonly miGrupo: number | undefined;
    }
  | {
      readonly tipo: 'todavia-no';
      /** Por qué todavía no se puede calcular. Cada motivo tiene su frase propia en pantalla. */
      readonly motivo: 'sin-votaciones' | 'poca-gente' | 'sin-diferencias' | 'no-se-estabilizo';
      readonly datos: MatrizDeConsenso;
    };

export async function calcularConsenso(
  deps: ServicioDeps,
  tituloDe: (propuestaId: string, huella: string) => Promise<string>,
  yo: MemberId | undefined,
): Promise<ConsensoCalculado> {
  const datos = await matrizDeConsenso(deps, tituloDe);
  if (datos.votaciones < CONSENSO_VOTACIONES_MINIMAS) {
    return { tipo: 'todavia-no', motivo: 'sin-votaciones', datos };
  }
  if (datos.participantes.length < CONSENSO_PARTICIPANTES_MINIMOS) {
    return { tipo: 'todavia-no', motivo: 'poca-gente', datos };
  }
  try {
    const resultado = analizarConsenso(datos.matriz, datos.textos);
    const fila = yo === undefined ? -1 : datos.participantes.indexOf(yo);
    const miGrupo =
      resultado.tipo === 'GruposDetectados' && fila >= 0 ? resultado.asignaciones[fila] : undefined;
    return { tipo: 'analizado', resultado, datos, miGrupo };
  } catch (error) {
    // Los dos desenlaces anómalos del paquete **no** son errores de servidor: son estados del dato,
    // y cada uno merece su explicación. Devolver un 500 aquí convertiría «todos respondieron igual»
    // en «se rompió algo», que es exactamente la lectura que no queremos que la gente haga.
    if (error instanceof SinVariacion) {
      return { tipo: 'todavia-no', motivo: 'sin-diferencias', datos };
    }
    if (error instanceof PcaNoConvergente) {
      return { tipo: 'todavia-no', motivo: 'no-se-estabilizo', datos };
    }
    throw error;
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Delegaciones: prestarle tu voto a alguien
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Cuánto dura una delegación concedida desde la interfaz.
 *
 * Hasta el cierre de la votación y ni un minuto más. El dominio admite hasta un semestre, pero
 * aquí la delegación es **de esta votación**: dejarla viva después del cierre sería un mandato que
 * la persona no pidió y que nadie recordaría haber dado. La renovación es explícita, jamás
 * automática (C.1.a).
 */
function vigenciaDeDelegacion(config: DecisionConfig, desde: Instant): Instant {
  const hasta = config.window.closesAt;
  const tope = desde + Math.min(config.delegation.maxValidity, MAX_DELEGATION_VALIDITY_MS);
  return instant(Math.min(hasta, tope));
}

export interface DelegacionesDeUnaDecision {
  readonly id: string;
  readonly state: DecisionState;
  readonly config: DecisionConfig | undefined;
  readonly resolucion: DelegationResolution | undefined;
  readonly miDelegacion: Delegation | undefined;
  readonly yaVote: boolean;
  readonly puedoDecidir: boolean;
}

/**
 * Lo que hace falta para pintar la pantalla de delegaciones de una votación abierta.
 *
 * La resolución se pide **en el instante de ahora** y no al abrir: revocar tiene efecto inmediato
 * (C.2, INV-24) y una vista que resolviera con el grafo congelado enseñaría una revocación que ya
 * ocurrió como si no hubiera ocurrido.
 */
export function delegacionesDe(
  deps: ServicioDeps,
  decision: DecisionConEstado,
  yo: MemberId | undefined,
): DelegacionesDeUnaDecision {
  const config = decision.state.config;
  const at = ahora(deps);
  const puedoDecidir =
    yo !== undefined && (config?.electorate.members.some((m) => m.memberId === yo) ?? false);
  const yaVote =
    yo !== undefined &&
    decision.state.ballots.some((b) => b.voter === yo && b.round === decision.state.round);
  // HALLAZGO (aparecido al pintar la pantalla). `isVigent` exige `grantedAt < at` **estricto**: en
  // su propio milisegundo una delegación todavía no cuenta (C.2). Preguntar «¿presté mi voto?» en
  // `ahora` devuelve «no» justo después de haberlo prestado, y con el reloj de las pruebas —que no
  // avanza solo— eso no es una rareza teórica: es lo que pasa siempre. En producción se esconde
  // detrás de un par de milisegundos, que es peor, porque entonces falla una vez de cada mil.
  //
  // La pregunta de la pantalla no es «¿está vigente en este instante exacto?» sino «¿qué queda en
  // pie a partir de ahora?», y ésa se responde en `at + 1`, que es la misma convención que usa el
  // dominio para sus comprobaciones ex ante (`firstActiveInstant`).
  const desdeYa = instant(at + 1);
  const vigentes = vigentDelegations(decision.state.delegations, desdeYa);
  return {
    id: decision.id,
    state: decision.state,
    config,
    resolucion:
      config?.delegation.enabled === true ? delegationAt(decision.state, desdeYa) : undefined,
    miDelegacion: yo === undefined ? undefined : vigentes.find((d) => d.delegator === yo),
    yaVote,
    puedoDecidir,
  };
}

/** Las votaciones abiertas, con el estado de delegación de quien mira. */
export async function listarDelegaciones(
  deps: ServicioDeps,
  yo: MemberId | undefined,
): Promise<readonly DelegacionesDeUnaDecision[]> {
  const abiertas = (await listarDecisiones(deps)).filter((d) => d.state.status === 'Open');
  return abiertas.map((decision) => delegacionesDe(deps, decision, yo));
}

/**
 * Las negativas del préstamo de voto, dichas para quien las lee.
 *
 * HALLAZGO (aparecido al pulsar el botón en el navegador). Los mensajes del dominio son excelentes
 * *para quien escribe el dominio*: llevan la notación del cálculo y la referencia de la
 * especificación —«esa persona ya representaría a 2 miembros y el tope de concentración es 2 votos
 * sobre un censo de 22 (C.5)»—. Esos mensajes salen tal cual por la API y aparecen en pantalla, así
 * que ADR-0041 se incumple en el único sitio donde nadie mira: el texto de un error.
 *
 * El dominio no se toca —su mensaje es el correcto para un registro y para quien depura—: se traduce
 * en la frontera, que es donde vive la traducción de todo lo demás. Cada frase dice además **qué
 * hacer**, porque una negativa sin salida es un callejón con otro nombre.
 */
const PORQUE_NO_SE_PUEDE_PRESTAR: Readonly<Record<string, string>> = {
  DELEGATION_DISABLED:
    'esta votación se abrió sin préstamo de voto, así que acá cada quien responde por sí mismo',
  SELF_DELEGATION: 'delegar en uno mismo no es delegar: si querés votar, votá',
  DELEGATOR_NOT_IN_CENSUS:
    'no estabas en la lista de quiénes podían decidir en esta votación, así que no hay voto que ' +
    'prestar',
  DELEGATE_NOT_IN_CENSUS:
    'esa persona no estaba en la lista de quiénes podían decidir acá, así que tu voto no llegaría ' +
    'a ninguna parte; elegí a alguien de la lista',
  DELEGATION_WOULD_CREATE_CYCLE:
    'esa persona ya te prestó su voto a vos, directamente o a través de alguien más. Si vos le ' +
    'prestás el tuyo, no votaría ninguno de los dos. Elegí a otra persona o votá vos',
  DELEGATION_CAP_REACHED:
    'esa persona ya llegó al tope de votos que alguien puede juntar. El tope existe para que la ' +
    'voz no se concentre en pocas manos. Elegí a otra persona, o votá vos',
  DELEGATION_VALIDITY_EXCEEDED:
    'no existe el préstamo para siempre: se acaba al cerrar la votación y hay que volver a darlo',
  DELEGATION_EXPIRY_INVALID: 'esta votación ya cerró o está por cerrar: no queda plazo que prestar',
  UNKNOWN_DELEGATION: 'ese préstamo no existe en esta votación; volvé a cargar la pantalla',
  DELEGATION_ALREADY_REVOKED:
    'ya habías recuperado tu voto. No hace falta que lo hagas otra vez: volvé a cargar la pantalla',
  DELEGATION_REVOKED_BEFORE_GRANT:
    'todavía no se terminó de registrar el préstamo. Esperá un segundo y volvé a intentarlo',
};

/**
 * Corre una orden de delegación traduciendo su negativa a castellano.
 *
 * Sólo se traducen los códigos de la tabla: cualquier otro error sigue su camino intacto, porque
 * tragarse un error desconocido y darle una frase amable es cómo se pierde un fallo de verdad.
 */
async function conMensajeDePrestamo<T>(correr: () => Promise<T>): Promise<T> {
  try {
    return await correr();
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      const enPalabras = PORQUE_NO_SE_PUEDE_PRESTAR[error.code];
      if (enPalabras !== undefined) throw new ServicioError(error.code, 422, enPalabras);
    }
    throw error;
  }
}

/**
 * Presta tu voto a otra persona en una votación.
 *
 * **No autoriza aquí.** `grantDelegationBy` llama a `authorize(..., 'decision:cast-ballot', {
 * subject: delegator })` por dentro, con el sujeto puesto por el servidor desde la sesión: nadie
 * puede delegar el voto de otra persona ni mandando el campo en el cuerpo.
 */
export async function delegarVoto(
  deps: ServicioDeps,
  actor: Actor,
  decisionIdRaw: string,
  input: { readonly requestId: string; readonly enQuienId: string },
): Promise<DecisionConEstado> {
  // La sesión se comprueba **antes** de tocar el historial. No es una autorización adelantada —el
  // permiso lo sigue decidiendo `grantDelegationBy` por dentro— sino la diferencia entre contestarle
  // a quien no entró «no encontramos eso», que no le sirve de nada, y «entrá con tu correo», que es
  // lo que tiene que hacer. De paso, una escritura sin cuenta deja de costar una lectura del log.
  const delegante = actor.memberId;
  if (delegante === undefined) {
    throw new ServicioError(
      'UNAUTHORIZED_NOT_AUTHENTICATED',
      401,
      'prestar tu voto exige una cuenta verificada',
    );
  }
  return await escribirSobreDecision(
    deps,
    decisionIdRaw,
    input.requestId,
    async ({ log, state }) => {
      const config = state.config;
      if (config === undefined) {
        throw new ServicioError('NO_ENCONTRADO', 404, 'esa votación todavía no está abierta');
      }
      const at = ahora(deps);
      return await conMensajeDePrestamo(async () =>
        grantDelegationBy(log, {
          eventId: nuevoEventId(deps),
          at,
          by: actor,
          delegation: {
            delegationId: toDelegationId(deps.ports.random.opaqueId()),
            delegator: delegante,
            delegate: memberId(input.enQuienId),
            // Ámbito fijo, a propósito — no una elección pendiente de cablear.
            //
            // El dominio admite tres ámbitos (`DelegationScope`: global/circle/topic,
            // `packages/domain/src/config.ts`, con pruebas propias de cada uno), pero esta ruta sólo
            // concede `circle`, y esta sesión revisó la alternativa —dejar elegir— y la descartó por
            // dos motivos, no por descuido:
            //
            //  1. `topic` no puede regir NUNCA con este producto tal como está: `abrirDecision`
            //     congela `topics: []` siempre (ver el porqué junto a esa línea, arriba en este
            //     mismo fichero) porque no existe catálogo de temas en ningún punto de la
            //     aplicación. Exponerlo escribiría, en un historial de sólo-anexar, un préstamo que
            //     la pantalla mostraría activo y que el escrutinio jamás aplicaría — la misma
            //     mentira permanente que un revisor independiente rechazó en el intento anterior.
            //
            //  2. `global` sí podría regir en principio (`matchesScope` para `global` es siempre
            //     `true`), pero en esta arquitectura una delegación vive y muere en el agregado de
            //     la ÚNICA decisión donde se concedió: `escribirSobreDecision` la anexa al log de
            //     ESTA decisión, y el escrutinio de cualquier OTRA ni siquiera lo abre. Así que
            //     «para cualquier votación abierta» nunca ocurre de verdad — dentro de la decisión
            //     donde se concede, `global` y `circle` producen exactamente el mismo resultado
            //     (`subject.circleId` es siempre el de esta misma decisión), y fuera de ella ninguno
            //     de los dos hace nada. Ofrecer a elegir entre dos opciones indistinguibles, con una
            //     etiqueta que promete algo que ninguna cumple, es la misma falla que ya describió
            //     el revisor sobre el radio «Para todo» del intento anterior: no se arregla
            //     escribiendo mejor el texto, se arregla no ofreciendo la elección.
            //
            // Si el día de mañana las delegaciones dejan de vivir dentro del agregado de una sola
            // decisión, `global` empieza a significar algo distinto de `circle` y esta decisión se
            // revisa junto con ese cambio.
            scope: { kind: 'circle', circleId: config.circleId },
            expiresAt: vigenciaDeDelegacion(config, at),
          },
        }),
      );
    },
  );
}

/** Recupera tu voto. Efecto inmediato: el escrutinio resuelve el grafo al cerrar, no al abrir. */
export async function revocarDelegacionDeVoto(
  deps: ServicioDeps,
  actor: Actor,
  decisionIdRaw: string,
  delegacionIdRaw: string,
  input: { readonly requestId: string },
): Promise<DecisionConEstado> {
  if (actor.memberId === undefined) {
    throw new ServicioError(
      'UNAUTHORIZED_NOT_AUTHENTICATED',
      401,
      'recuperar tu voto exige una cuenta verificada',
    );
  }
  return await escribirSobreDecision(deps, decisionIdRaw, input.requestId, async ({ log }) =>
    conMensajeDePrestamo(async () =>
      revokeDelegationBy(log, {
        eventId: nuevoEventId(deps),
        at: ahora(deps),
        by: actor,
        delegationId: toDelegationId(delegacionIdRaw),
      }),
    ),
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Normas: las reglas del juego
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El estado real de la constitución digital de este despliegue.
 *
 * ═══ Por qué esto no lee nada ═══
 *
 * El agregado `constitution` está construido y probado en `@koinonia/domain`, pero **no tiene
 * persistencia**: no hay codificador que escriba sus hechos en el historial ni orden que lo funde.
 * Fundarlo aquí, al vuelo y en cada petición, para tener algo que enseñar sería fabricar un acto de
 * gobierno que nadie realizó —`foundConstitution` exige la decisión fundacional, el censo y los
 * votos a favor—, y una pantalla que enseña una versión 1 que nadie aprobó miente sobre lo único
 * que esa pantalla existe para demostrar.
 *
 * Así que se dice lo que es verdad: **estas son las reglas y todavía no están fijadas como
 * documento versionado dentro de Koinonía**. Lo que sí es dato del dominio y sale de él —el núcleo
 * intangible y los requisitos exactos de cada vía de reforma— se publica desde el dominio, no desde
 * una copia a mano que se quedaría atrás.
 */
/** Una regla con su texto, ya resuelto contra el archivo y con la huella comprobada. */
export interface ReglaLeida {
  readonly id: string;
  readonly titulo: string;
  readonly texto: string;
  /** `true` si es uno de los seis puntos que no se reforman por ninguna vía (§6.b). */
  readonly irreformable: boolean;
}

export interface VersionLeida {
  readonly version: number;
  readonly rigeDesde: number;
  readonly caduca: number;
  readonly vigente: boolean;
  readonly reglas: readonly ReglaLeida[];
}

export interface ReformaLeida {
  readonly id: string;
  readonly titulo: string;
  readonly estado: string;
  readonly cierraEn: number;
}

export interface VedaLeida {
  readonly desde: number;
  readonly hasta: number;
  readonly motivo: string;
}

/**
 * Las reglas de este despliegue.
 *
 * Los cinco últimos campos son **opcionales y eso significa algo**: mientras nadie funde, no hay
 * versión vigente, ni historial de versiones, ni reformas, ni vedas, y la respuesta honesta es que
 * esas cosas no existen —no que estén vacías por casualidad—. `verNormas()` devuelve ese estado;
 * `leerNormas()` lo sustituye por el del historial en cuanto hay un hecho fundacional.
 */
export interface NormasDelDespliegue {
  readonly fijadas: boolean;
  readonly nucleo: readonly {
    readonly id: string;
    readonly titulo: string;
    readonly texto: string;
  }[];
  readonly ordinaria: ReformRequirements;
  readonly atrincherada: ReformRequirements;
  readonly mesesDeVigenciaFundacional: number;
  /** El aviso del dominio en castellano llano: qué rige, desde cuándo y hasta cuándo. */
  readonly aviso?: string;
  readonly versionVigente?: number;
  readonly versiones?: readonly VersionLeida[];
  readonly reformasEnCurso?: readonly ReformaLeida[];
  readonly vedas?: readonly VedaLeida[];
}

/**
 * El núcleo intangible del §6.b, palabra por palabra.
 *
 * Los identificadores **no** se escriben a mano: se toman de `CORE_CLAUSE_IDS`, que es la lista
 * que el dominio recomputa en cada hecho para rechazar un historial que la altere. Si mañana el
 * núcleo cambiara de forma, esto deja de compilar en vez de enseñar una lista vieja.
 */
const NUCLEO_EN_PALABRAS: Readonly<Record<string, { titulo: string; texto: string }>> = {
  derecho_de_voz_y_voto: {
    titulo: 'Toda persona miembro puede hablar, objetar y votar',
    texto:
      'Nadie puede quitarle a un miembro el derecho a participar en la conversación, a mostrar un ' +
      'daño concreto y a votar. Ni una mayoría, ni quien facilita, ni quien administra.',
  },
  publicidad_del_registro: {
    titulo: 'Lo que pasa queda escrito y cualquiera puede comprobarlo por su cuenta',
    texto:
      'El registro es público y se puede comprobar sin confiar en este servidor ni en quien lo ' +
      'opera. La comprobación no depende de nuestro permiso.',
  },
  poder_no_transferible: {
    titulo: 'La voz no se vende ni se regala en propiedad',
    texto:
      'Prestarle tu voto a alguien es revocable en cualquier momento y caduca solo. Nadie puede ' +
      'comprar poder político ni acumularlo de forma permanente.',
  },
  caducidad_de_los_acuerdos: {
    titulo: 'Los acuerdos caducan, y estas reglas también',
    texto:
      'Ningún acuerdo rige para siempre. Hay que volver a aprobarlo. Nadie queda gobernado ' +
      'indefinidamente por reglas que aprobó gente que ya se fue.',
  },
  derecho_a_exportar: {
    titulo: 'Podés llevarte la historia completa',
    texto:
      'Cualquier miembro puede descargar todo lo que pasó, entero, y usarlo fuera de acá. No hay ' +
      'forma de quedar atrapado en esta herramienta.',
  },
  lista_taxativa: {
    titulo: 'Lo que nunca se decide acá es una lista cerrada',
    texto:
      'Hay asuntos que no se someten a votación por ninguna vía, y esa lista no se amplía con ' +
      'excepciones: ampliarla no es reformar, es fundar otra cosa.',
  },
};

export function verNormas(): NormasDelDespliegue {
  return {
    // El estado ANTES de que exista el hecho fundacional. Sigue siendo la respuesta correcta
    // mientras nadie funde: decir que sí hay reglas fijadas sería la única mentira que esta
    // pantalla no puede permitirse. `leerNormas` lo sustituye en cuanto el historial tiene algo.
    fijadas: false,
    nucleo: CORE_CLAUSE_IDS.map((id) => {
      const palabras = NUCLEO_EN_PALABRAS[id];
      if (palabras === undefined) {
        throw new ServicioError(
          'NUCLEO_SIN_TEXTO',
          500,
          `el núcleo declara «${id}» y esta capa no sabe decirlo en castellano`,
        );
      }
      return { id, titulo: palabras.titulo, texto: palabras.texto };
    }),
    ordinaria: ORDINARY_REFORM_V1,
    atrincherada: ENTRENCHED_REFORM_V1,
    mesesDeVigenciaFundacional: FOUNDATIONAL_VALIDITY_MONTHS,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Las reglas, escritas: fundar y tramitar una reforma
//
// ═══ EL ARRANQUE: por qué NO se funda sola ═══
//
// Tres caminos posibles y dos son falsos.
//
//  (a) **Una migración que escriba el hecho fundacional.** Imposible y además indeseable.
//      Imposible: `applyConstitution` rechaza `actor: 'system'` con `SYSTEM_CANNOT_GOVERN` —«ningún
//      acto de gobierno es un automatismo: todos tienen responsable con nombre propio»—, y una
//      migración no tiene una persona detrás. Habría que mentir sobre el actor para que compilara.
//      Indeseable por dos razones más: una migración aplicada queda registrada por su huella y no
//      se puede corregir editándola, así que el acto fundacional de la comunidad sería un fichero
//      del repositorio inmodificable escrito por quien administra —exactamente lo que el §7 le
//      prohíbe—; y tendría que inventarse el censo, las papeletas y los votos a favor de una
//      asamblea que no se celebró.
//  (b) **Fundarla al vuelo la primera vez que alguien mire la pantalla.** Es (a) sin migración: el
//      mismo acto de gobierno inventado, con el agravante de que empieza a correr **la caducidad de
//      doce meses** del §6. A los doce meses de instalar el servidor, Koinonía se declararía «sin
//      reglas» en público por culpa de un script de instalación. Un reloj que nadie pidió.
//  (c) **El sistema funciona sin constitución hasta que alguien la funde.** Es lo que se
//      implementa. La máquina de estados del dominio ya tiene ese estado —`inexistente`— y ya dice
//      qué se puede hacer en él: leer y exportar. La pantalla lo dice con todas las letras en vez
//      de enseñar una versión 1 que nadie aprobó.
//
// Fundar es entonces **una orden con responsable**: `POST /normas/fundacion`, autorizada por
// `constitution:found` (facilitación o Garantías, nunca `tech-admin`), con la decisión de la
// asamblea, el censo y los votos como datos públicos que cualquiera puede contrastar contra el
// acta. Es lo que el §6 pide —«ratificación en asamblea abierta con la regla declarada de
// antemano»— y lo único que un servidor puede hacer honestamente: registrar un acto que ocurrió
// fuera, con quién lo registró.
//
// **Lo que esto NO comprueba, dicho sin suavizar:** que la asamblea existiera. El
// `decisionFundacional`, el censo y los conteos entran como dato. No pueden no entrar como dato: la
// votación que aprueba la versión 1 no cabe dentro de una plataforma cuyas reglas todavía no
// existen, y ése es literalmente «el problema del arranque» del §6. Lo que sí queda es el registro
// público, con autor y fecha, en un historial anclado fuera del servidor.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Una regla tal como la escribe quien la redacta. */
export interface ReglaRedactadaEntrada {
  readonly id: string;
  readonly titulo: string;
  readonly texto: string;
}

/** Una proporción exacta dicha en enteros: «2 de cada 3». Nunca un decimal (ADR-0027). */
export interface ProporcionEntrada {
  readonly cuantos: number;
  readonly deCada: number;
}

export interface RequisitosEntrada {
  readonly aFavorDelPadron: ProporcionEntrada;
  readonly votoDirectoMinimo: ProporcionEntrada;
  readonly diasDeConversacion: number;
  readonly diasDeEspera: number;
  readonly firmasDeGarantias: number;
  readonly personasEnGarantias: number;
  readonly votaciones: number;
  readonly mesesEntreVotaciones: number;
  readonly firmasParaAbrir: ProporcionEntrada;
}

function aRequisitos(entrada: RequisitosEntrada): ReformRequirements {
  const proporcion = (valor: ProporcionEntrada): Fraction =>
    fraction(BigInt(valor.cuantos), BigInt(valor.deCada));
  return {
    approvalOfCensus: proporcion(entrada.aFavorDelPadron),
    minDirectParticipation: proporcion(entrada.votoDirectoMinimo),
    deliberationDays: entrada.diasDeConversacion,
    waitingDays: entrada.diasDeEspera,
    guaranteeThreshold: entrada.firmasDeGarantias,
    guaranteeCircleSize: entrada.personasEnGarantias,
    votesRequired: entrada.votaciones,
    separationMonths: entrada.mesesEntreVotaciones,
    sponsorSignatures: proporcion(entrada.firmasParaAbrir),
  };
}

/**
 * Reglas redactadas → texto versionado + los textos que hay que archivar.
 *
 * El dominio sólo se lleva el par `(etiqueta, huella)`; la prosa se queda aquí y va a
 * `governance.clause_text`, direccionada por esa misma huella. Las cláusulas salen **ordenadas por
 * etiqueta** porque `assertWellFormedText` lo exige: sin orden fijo, dos servidores honestos
 * hashean el mismo documento de dos formas.
 */
async function componerTexto(
  reglas: readonly ReglaRedactadaEntrada[],
  requisitos: {
    readonly ordinary: ReformRequirements;
    readonly entrenched: ReformRequirements;
    readonly validityMonths: number;
  },
): Promise<{ readonly texto: ConstitutionText; readonly textos: readonly ClauseText[] }> {
  const vistas = new Set<string>();
  const clauses: Clause[] = [];
  const textos: ClauseText[] = [];
  for (const [indice, regla] of reglas.entries()) {
    if (vistas.has(regla.id)) {
      throw new ServicioError(
        'REGLA_REPETIDA',
        422,
        `la regla «${regla.id}» viene dos veces: un documento con dos versiones de la misma regla ` +
          'no dice cuál rige',
      );
    }
    vistas.add(regla.id);
    const texto = normalizeClauseText({ title: regla.titulo, body: regla.texto });
    assertWellFormedClauseText(texto, `reglas[${String(indice)}]`);
    textos.push(texto);
    clauses.push({ clauseId: toClauseId(regla.id), textHash: await clauseTextHash(texto) });
  }
  clauses.sort((a, b) => (a.clauseId < b.clauseId ? -1 : a.clauseId > b.clauseId ? 1 : 0));
  return {
    texto: {
      clauses,
      ordinary: requisitos.ordinary,
      entrenched: requisitos.entrenched,
      validityMonths: requisitos.validityMonths,
    },
    textos,
  };
}

/**
 * El núcleo, tomado del texto que se propone.
 *
 * Quien funda **no elige** qué es el núcleo: los seis identificadores salen de `CORE_CLAUSE_IDS`,
 * que es la lista que el pliegue recomputa en cada hecho. Lo único que aporta el documento es el
 * texto de cada uno. Un documento al que le falte uno de los seis no se funda: vaciar el núcleo no
 * incluyéndolo es la forma más barata de derogarlo.
 */
function nucleoDe(texto: ConstitutionText): readonly Clause[] {
  const porEtiqueta = new Map<ClauseId, Clause>(texto.clauses.map((c) => [c.clauseId, c]));
  return CORE_CLAUSE_IDS.map((id) => {
    const clause = porEtiqueta.get(id);
    if (clause === undefined) {
      throw new ServicioError(
        'NUCLEO_INCOMPLETO',
        422,
        `al documento le falta «${id}», que es uno de los seis puntos que no se reforman por ` +
          'ninguna vía. Un documento sin ellos no es la constitución de esta comunidad',
      );
    }
    return clause;
  });
}

function normasMeta(deps: ServicioDeps, actor: Actor): ConstitutionCommandMeta {
  return { eventId: nuevoEventId(deps), at: ahora(deps), actor };
}

/**
 * Quien actúa, con identidad. Se exige **antes** de tocar el ledger.
 *
 * Las órdenes del dominio también lo comprueban (`requireIdentity`); esto no las sustituye, se
 * adelanta a ellas para no tomar el candado global de escritura por cuenta de alguien que no puede
 * escribir nada.
 */
function quienActua(actor: Actor): MemberId {
  const id = actor.memberId;
  if (id === undefined) {
    throw new ServicioError(
      'UNAUTHORIZED_NOT_AUTHENTICATED',
      401,
      'este acto exige una cuenta verificada',
    );
  }
  return id;
}

function estadoDeNormas(state: ConstitutionState | undefined): ConstitutionState {
  if (state === undefined || !state.exists) {
    throw new ServicioError(
      'CONSTITUTION_NOT_FOUNDED',
      409,
      'todavía no hay reglas aprobadas: no se reforma un documento que nadie fundó',
    );
  }
  return state;
}

export interface FundarNormasEntrada {
  readonly requestId: string;
  readonly decisionFundacional: string;
  readonly censo: number;
  readonly papeletas: number;
  readonly aFavor: number;
  readonly votoDirecto: number;
  readonly rigeDesde: number;
  readonly reglas: readonly ReglaRedactadaEntrada[];
}

/**
 * Funda las reglas, o las **refunda** después de que caduquen.
 *
 * ═══ Por qué los umbrales de reforma NO vienen en la petición ═══
 *
 * Lo que se funda es el texto: las etiquetas y la prosa de cada regla. Cuánto cuesta reformarlas
 * —las filas 13 y 14— lo pone el dominio desde `ORDINARY_REFORM_V1` y `ENTRENCHED_REFORM_V1`, que
 * son los números que `GOVERNANCE.md` publica y que la asamblea leyó antes de votar. Si vinieran en
 * el cuerpo de la petición, quien registra la fundación podría instalar una cláusula de enmienda
 * distinta de la que se ratificó, y el §6 empieza exigiendo lo contrario: «publicidad previa total,
 * el texto y el procedimiento se publican antes de que empiece la discusión y no cambian durante el
 * proceso». Cambiarlos después es lo que existe la vía atrincherada para hacer, y ésa sí pasa por
 * una votación.
 *
 * La vigencia es la fundacional del §6: **doce meses**. Es la contrapartida declarada de que la
 * regla fundacional sea más baja que la de reforma.
 */
export async function fundarNormas(
  deps: ServicioDeps,
  actor: Actor,
  input: FundarNormasEntrada,
): Promise<NormasDelDespliegue> {
  // La puerta de verdad es `foundConstitution`, que autoriza por dentro antes de construir el
  // evento. Ésta es el felpudo: evita tomar el candado global del ledger por cuenta de alguien que
  // no puede escribir. Misma acción, misma matriz: no pueden divergir.
  authorize(actor, 'constitution:found', { kind: 'constitution' });
  quienActua(actor);

  const { texto, textos } = await componerTexto(input.reglas, {
    ordinary: ORDINARY_REFORM_V1,
    entrenched: ENTRENCHED_REFORM_V1,
    validityMonths: FOUNDATIONAL_VALIDITY_MONTHS,
  });
  const nucleo = nucleoDe(texto);

  await withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);
    const log = await loadConstitutionLog(client);
    const siguiente = await foundConstitution(log, normasMeta(deps, actor), {
      constitutionId: toConstitutionId(CONSTITUTION_AGGREGATE_ID),
      text: texto,
      core: nucleo,
      foundingDecisionId: decisionId(input.decisionFundacional),
      censusSize: input.censo,
      votesInFavor: input.aFavor,
      castBallots: input.papeletas,
      directParticipation: input.votoDirecto,
      effectiveAt: instant(input.rigeDesde),
    });
    // El texto se archiva DESPUÉS de que la orden haya autorizado y plegado, y en el mismo commit:
    // una versión cuya prosa quedó fuera porque la segunda escritura falló sería una constitución
    // ilegible con la huella intacta.
    await saveClauseTextsWithin(client, textos);
    await persistConstitutionLogWithin(client, siguiente, { requestId: input.requestId });
  });

  return leerNormas(deps, actor);
}

export interface VotacionConvocadaEntrada {
  readonly votacionId: string;
  readonly abreEn: number;
  readonly dependeDe: readonly string[];
}

export interface ProponerReformaEntrada {
  readonly requestId: string;
  readonly via: ReformKind;
  readonly sobreLaVersion: number;
  readonly reglas: readonly ReglaRedactadaEntrada[];
  readonly requisitos?:
    { readonly ordinaria: RequisitosEntrada; readonly atrincherada: RequisitosEntrada } | undefined;
  readonly mesesDeVigencia?: number | undefined;
  readonly firmas: number;
  readonly finDeSemestre: number;
  readonly votacionesConvocadas: readonly VotacionConvocadaEntrada[];
  readonly conversacionAbreEn: number;
  readonly conversacionCierraEn: number;
}

/**
 * El calendario contra el que se juzga la veda del §6.c, ordenado y sin repetir.
 *
 * ⚠ **Entra como dato y el servidor no puede comprobarlo.** Ni el fin del semestre —no hay
 * calendario académico en la plataforma— ni qué reglas necesita cada votación ya convocada: esa
 * relación no está modelada en ninguna parte, y ADR-0051 la declara como hueco del documento
 * (§6.c no define ninguna de las dos cosas). Lo que sí ocurre es que el calendario declarado queda
 * **por valor y en público** dentro del hecho que abre la reforma: una reforma que declare que no
 * hay ninguna votación convocada dice eso en el historial, con autor y fecha, y comprobar el
 * procedimiento es precisamente lo que el §6.6 le encarga a Garantías antes de firmar.
 */
function calendarioDe(input: ProponerReformaEntrada): ReformCalendar {
  const vistas = new Set<string>();
  const convened: ConvenedDecision[] = [];
  for (const votacion of input.votacionesConvocadas) {
    if (vistas.has(votacion.votacionId)) {
      throw new ServicioError(
        'VOTACION_CONVOCADA_REPETIDA',
        422,
        'una votación convocada aparece dos veces en el calendario',
      );
    }
    vistas.add(votacion.votacionId);
    convened.push({
      decisionId: decisionId(votacion.votacionId),
      opensAt: instant(votacion.abreEn),
      affectsClauseIds: votacion.dependeDe.map(toClauseId),
    });
  }
  convened.sort((a, b) => (a.decisionId < b.decisionId ? -1 : a.decisionId > b.decisionId ? 1 : 0));
  return { semesterEndsAt: instant(input.finDeSemestre), convened };
}

/**
 * Abre una reforma y congela en el hecho todo lo que va a juzgarla.
 *
 * Tres datos **no** los aporta quien propone y por eso no están en la petición:
 *
 *  - el **censo**, que sale del padrón vivo. Si viniera en el cuerpo, la reforma elegiría el
 *    denominador de «dos tercios del censo», que es la trampa que el padrón congelado cierra;
 *  - **quiénes son Garantías**, que salen de los roles del padrón. Si vinieran en el cuerpo, quien
 *    propone elegiría a las cinco personas que después firman;
 *  - los **umbrales vigentes**, que los copia la orden del dominio del texto en vigor.
 *
 * Lo que sí aporta quien propone, y no puede ser de otro modo, es el número de firmas: la
 * plataforma no recoge las 30 firmas del 10 % del censo, así que ese conteo es una afirmación
 * pública suya. Queda escrita.
 */
export async function proponerReforma(
  deps: ServicioDeps,
  actor: Actor,
  input: ProponerReformaEntrada,
): Promise<NormasDelDespliegue> {
  authorize(actor, 'constitution:propose-reform', { kind: 'constitution' });
  quienActua(actor);

  await withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);
    const { log, state } = await loadConstitutionState(client);
    const vigente = currentText(estadoDeNormas(state));
    if (vigente === undefined) {
      throw new ServicioError('CONSTITUTION_NOT_FOUNDED', 409, 'no hay texto vigente que reformar');
    }
    const { texto, textos } = await componerTexto(input.reglas, {
      ordinary:
        input.requisitos === undefined ? vigente.ordinary : aRequisitos(input.requisitos.ordinaria),
      entrenched:
        input.requisitos === undefined
          ? vigente.entrenched
          : aRequisitos(input.requisitos.atrincherada),
      validityMonths: input.mesesDeVigencia ?? vigente.validityMonths,
    });

    const padron = await allMembers(client, deps.ports.clock.now());
    const garantes = padron
      .filter((persona) => persona.roles.includes('guarantees'))
      .map((persona) => persona.memberId);

    const siguiente = await openReform(log, normasMeta(deps, actor), {
      reformId: toReformId(deps.ports.random.opaqueId()),
      kind: input.via,
      targetVersion: input.sobreLaVersion,
      proposedText: texto,
      censusSize: padron.length,
      guarantors: garantes,
      calendar: calendarioDe(input),
      sponsorCount: input.firmas,
      deliberationOpensAt: instant(input.conversacionAbreEn),
      deliberationClosesAt: instant(input.conversacionCierraEn),
    });
    await saveClauseTextsWithin(client, textos);
    await persistConstitutionLogWithin(client, siguiente, { requestId: input.requestId });
  });

  return leerNormas(deps, actor);
}

export interface RegistrarVotacionEntrada {
  readonly requestId: string;
  readonly votacionId: string;
  readonly aFavor: number;
  readonly votoDirecto: number;
  readonly abrioEn: number;
  readonly cerroEn: number;
}

/**
 * Transcribe el resultado de una votación de reforma, ya cerrada.
 *
 * La ronda no viene en la petición: es `las que van + 1`, y lo comprueba el pliegue. Si viniera,
 * repetir la ronda 1 hasta que saliera bien sería una petición más.
 *
 * **El conteo entra como dato.** Este agregado no cuenta votos —lo hace el motor de decisiones— y
 * lo que se guarda es el `votacionId` que permite recomputarlo con un verificador independiente.
 */
export async function registrarVotacionDeReforma(
  deps: ServicioDeps,
  actor: Actor,
  reformaIdRaw: string,
  input: RegistrarVotacionEntrada,
): Promise<NormasDelDespliegue> {
  authorize(actor, 'constitution:record-vote', { kind: 'constitution' });
  quienActua(actor);
  const reforma = toReformId(reformaIdRaw);

  await withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);
    const { log, state } = await loadConstitutionState(client);
    const rondas = reformaDe(estadoDeNormas(state), reforma).votes.length;
    const siguiente = await recordReformVote(log, normasMeta(deps, actor), {
      reformId: reforma,
      vote: {
        round: rondas + 1,
        decisionId: decisionId(input.votacionId),
        votesInFavor: input.aFavor,
        directParticipation: input.votoDirecto,
        opensAt: instant(input.abrioEn),
        closesAt: instant(input.cerroEn),
      },
    });
    await persistConstitutionLogWithin(client, siguiente, { requestId: input.requestId });
  });

  return leerNormas(deps, actor);
}

function reformaDe(state: ConstitutionState, reforma: ReformId): ReformRecord {
  const encontrada = state.reforms.find((r) => r.reformId === reforma);
  if (encontrada === undefined) {
    throw new ServicioError('UNKNOWN_REFORM', 404, 'esa reforma no está en el historial');
  }
  return encontrada;
}

/**
 * Una de las aprobaciones de Garantías (§6.6).
 *
 * ⚠ **No es una firma criptográfica y la interfaz no puede llamarla así.** Es un hecho del
 * historial cuyo autor tiene que coincidir con la persona a la que se atribuye, y el pliegue lo
 * revalida al releer. Eso ata la aprobación a una identidad **dentro** del sistema, no a una llave
 * que sólo esa persona tenga: quien administra el servidor puede fabricarla. Lo que hay es
 * detección —queda anclada fuera, con fecha y autor, y quien la sufra puede repudiarla en
 * público—, no prevención. Está declarado en `constitution/commands.ts` y en ADR-0051.
 */
export async function aprobarReforma(
  deps: ServicioDeps,
  actor: Actor,
  reformaIdRaw: string,
  input: { readonly requestId: string },
): Promise<NormasDelDespliegue> {
  // `subject` es quien actúa y lo pone el servidor desde la sesión: nadie aprueba en nombre de otra
  // persona, ni mandando el campo en el cuerpo, porque el campo no existe.
  authorize(actor, 'constitution:approve', { kind: 'constitution', subject: quienActua(actor) });
  const reforma = toReformId(reformaIdRaw);

  await withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);
    const log = await loadConstitutionLog(client);
    const siguiente = await approveReform(log, normasMeta(deps, actor), { reformId: reforma });
    await persistConstitutionLogWithin(client, siguiente, { requestId: input.requestId });
  });

  return leerNormas(deps, actor);
}

/** Pone la reforma en vigor: nace la versión nueva y **se conservan todas** las anteriores. */
export async function ratificarReforma(
  deps: ServicioDeps,
  actor: Actor,
  reformaIdRaw: string,
  input: { readonly requestId: string; readonly rigeDesde: number },
): Promise<NormasDelDespliegue> {
  authorize(actor, 'constitution:ratify', { kind: 'constitution' });
  quienActua(actor);
  const reforma = toReformId(reformaIdRaw);

  await withTransaction(deps.pool, async (client) => {
    await lockLedgerWithin(client);
    const log = await loadConstitutionLog(client);
    const siguiente = await ratifyReform(log, normasMeta(deps, actor), {
      reformId: reforma,
      effectiveAt: instant(input.rigeDesde),
    });
    await persistConstitutionLogWithin(client, siguiente, { requestId: input.requestId });
  });

  return leerNormas(deps, actor);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Leer las reglas
// ─────────────────────────────────────────────────────────────────────────────────────────────

function comoSeLlamaLaReforma(reforma: ReformRecord): string {
  return reforma.kind === 'atrincherada'
    ? `Cambio de lo que cuesta cambiar las reglas, sobre la versión ${String(reforma.targetVersion)}`
    : `Cambio de las reglas, sobre la versión ${String(reforma.targetVersion)}`;
}

const ESTADO_DE_REFORMA: Readonly<Record<ReformRecord['status'], string>> = {
  deliberando: 'En conversación',
  votada: 'Votada',
  ratificada: 'En vigor',
  rechazada: 'Cerrada sin cambiar nada',
};

function plural(cuantas: number, singular: string, plural_: string): string {
  return `${String(cuantas)} ${cuantas === 1 ? singular : plural_}`;
}

/**
 * En qué va una reforma, dicho entero.
 *
 * El §6.6 no pide sólo que las firmas hagan falta: pide que **«sin las firmas la regla queda
 * aprobada pero no vigente, y eso es público»**. Un estado que dijera «votada» y nada más deja
 * escondido justo el caso que el documento manda publicar —la reforma que ganó y que alguien no
 * está firmando—, que es donde un bloqueo silencioso tiene más valor para quien bloquea.
 */
function estadoDeLaReforma(reforma: ReformRecord): string {
  if (reforma.status !== 'votada') return ESTADO_DE_REFORMA[reforma.status];
  const requisitos = reforma.frozen.requirements;
  if (reforma.votes.length < requisitos.votesRequired) {
    return (
      `Votada ${String(reforma.votes.length)} de ${String(requisitos.votesRequired)} veces: falta ` +
      `otra votación, separada por al menos ${plural(requisitos.separationMonths, 'mes', 'meses')}`
    );
  }
  if (!reformVotesPass(reforma)) return 'Votada sin alcanzar el respaldo que hace falta';
  const faltan = requisitos.guaranteeThreshold - reforma.approvals.length;
  if (faltan > 0) {
    return (
      `Aprobada y todavía no vigente: ${plural(faltan, 'falta', 'faltan')} de las ` +
      `${String(requisitos.guaranteeThreshold)} firmas que hacen falta, de las ` +
      `${String(requisitos.guaranteeCircleSize)} personas que cuidan las garantías`
    );
  }
  return 'Aprobada y firmada: sólo falta que entre en vigor';
}

/**
 * Cuándo vuelve a haber algo que hacer con esta reforma.
 *
 * Mientras se conversa, cuando cierra la conversación. Ya votada, **la fecha más temprana en que
 * puede entrar en vigor**: los días de espera del §6.4 son impugnables ante Garantías, y un plazo
 * que se puede impugnar y no se publica no se impugna.
 */
function cuandoTocaAlgo(reforma: ReformRecord): number {
  if (reforma.status !== 'votada') return reforma.deliberationClosesAt;
  const ultima = reforma.votes.at(-1);
  return ultima === undefined
    ? reforma.deliberationClosesAt
    : addDays(ultima.closesAt, reforma.frozen.requirements.waitingDays);
}

/**
 * Las reglas tal como están escritas en el historial, con su texto y su huella comprobada.
 *
 * Cada versión se sirve resolviendo las huellas de **sus** cláusulas contra el archivo de textos, y
 * `readClauseTexts` recomputa SHA-256 antes de devolver nada. Por eso esta lectura puede fallar: si
 * alguien cambió la letra de una norma sin pasar por una reforma, la pantalla lo dice en vez de
 * enseñar el texto nuevo bajo la huella vieja. Un fallo ruidoso es la única respuesta honesta.
 */
export async function leerNormas(deps: ServicioDeps, actor: Actor): Promise<NormasDelDespliegue> {
  authorize(actor, 'constitution:read', { kind: 'constitution' });
  const at = ahora(deps);

  return conCliente(deps.pool, async (client) => {
    const { state } = await loadConstitutionState(client);
    if (state === undefined || !state.exists) return verNormas();

    const vigente = currentText(state);
    if (vigente === undefined) return verNormas();

    const huellas = state.versions.flatMap((version) =>
      version.text.clauses.map((clause) => clause.textHash),
    );
    const textos = await readClauseTexts(client, huellas);
    const esDelNucleo = new Set<string>(CORE_CLAUSE_IDS);

    const reglasDe = (texto: ConstitutionText): readonly ReglaLeida[] =>
      texto.clauses.map((clause) => {
        const escrito = textos.get(clause.textHash);
        if (escrito === undefined) {
          // `readClauseTexts` ya lanza si falta alguna; esto cubre el caso imposible sin inventar
          // un texto vacío, que sería enseñar una regla en blanco como si eso fuera una regla.
          throw new ServicioError(
            'CLAUSE_TEXT_MISSING',
            500,
            `falta el texto de la regla «${clause.clauseId}»`,
          );
        }
        return {
          id: clause.clauseId,
          titulo: escrito.title,
          texto: escrito.body,
          irreformable: esDelNucleo.has(clause.clauseId),
        };
      });

    const reglasVigentes = reglasDe(vigente);
    const abiertas = openReforms(state);
    const vedas = abiertas.flatMap((reforma) => {
      const objetivo = state.versions.find((v) => v.version === reforma.targetVersion);
      const tocadas =
        objetivo === undefined ? [] : changedClauseIds(objetivo.text, reforma.proposedText);
      return blackoutsFor(reforma.frozen.calendar, tocadas).map((veda) => ({
        desde: veda.from,
        hasta: veda.to,
        motivo: veda.reason,
      }));
    });

    return {
      fijadas: true,
      // El núcleo se enseña con el texto que la asamblea aprobó, no con la copia en castellano de
      // esta capa: en cuanto hay documento fundado, la copia deja de ser la fuente. Y va en el
      // orden del §6.b —(i) a (vi)—, no en el alfabético de las etiquetas: es una enumeración del
      // documento y leerla desordenada es leer otra cosa.
      nucleo: CORE_CLAUSE_IDS.map((id) => {
        const regla = reglasVigentes.find((r) => r.id === id);
        if (regla === undefined) {
          // Imposible: el pliegue rechaza todo texto vigente al que le falte un punto del núcleo.
          throw new ServicioError(
            'NUCLEO_INCOMPLETO',
            500,
            `el texto vigente no contiene «${id}», que es uno de los seis puntos del núcleo`,
          );
        }
        return { id: regla.id, titulo: regla.titulo, texto: regla.texto };
      }),
      ordinaria: vigente.ordinary,
      atrincherada: vigente.entrenched,
      mesesDeVigenciaFundacional: FOUNDATIONAL_VALIDITY_MONTHS,
      aviso: constitutionNotice(state, at),
      versionVigente: statusAt(state, at) === 'vigente' ? state.currentVersion : 0,
      versiones: state.versions.map((version) => ({
        version: version.version,
        rigeDesde: version.effectiveAt,
        caduca: version.expiresAt,
        vigente: version.version === state.currentVersion && statusAt(state, at) === 'vigente',
        reglas: reglasDe(version.text),
      })),
      reformasEnCurso: abiertas.map((reforma) => ({
        id: reforma.reformId,
        titulo: comoSeLlamaLaReforma(reforma),
        estado: estadoDeLaReforma(reforma),
        cierraEn: cuandoTocaAlgo(reforma),
      })),
      vedas,
    };
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Historial: todo lo que quedó escrito
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface HechoLeido {
  readonly numero: number;
  readonly cuando: number;
  readonly tipo: string;
  readonly tipoDeAgregado: string;
  readonly agregado: string;
}

export interface HistorialLeido {
  /** Cuántas cosas hay escritas EN TOTAL, incluido el sellado automático. */
  readonly total: number;
  /** De ésas, cuántas se listan: todo salvo el sellado automático. */
  readonly enLaLista: number;
  /** Y cuántas son del sellado automático, que se cuenta pero no se lista una por una. */
  readonly delSellado: number;
  readonly desde: number | undefined;
  readonly hasta: number | undefined;
  readonly hechos: readonly HechoLeido[];
  readonly hayMas: boolean;
}

/**
 * El sellado automático: lo que la máquina escribe sola, cada hora, para siempre.
 *
 * Son dos cosas y no una: TODO el expediente de anclaje —los intentos, las confirmaciones y los
 * fallos de cada testigo de fuera— y, del expediente de la espina, los sellos periódicos. Medido en
 * producción: 2187 del primero y 122 del segundo, o sea 2309 de 2317.
 *
 * Lo que NO entra acá, y por eso esto no es «todo lo interno»: «Se abrió el historial» y «Empezó a
 * registrarse algo nuevo». Ésos pasan una vez, son hechos de verdad del registro del grupo, y el
 * primero es el que hace que la pantalla del primer día tenga algo que enseñar en vez de parecer
 * rota. El primer corte que escribí se los llevaba por delante y se notó enseguida: una prueba de
 * navegador que llevaba tiempo pasando dejó de encontrar la lista, porque contra una base recién
 * creada lo único escrito es justamente «Se abrió el historial».
 *
 * Ver `verHistorial` para qué hace este corte y por qué NO es una censura.
 */
function esDelSellado(tipoDeAgregado: string, tipo: string): boolean {
  return tipoDeAgregado === ANCHOR_AGGREGATE_TYPE || tipo === 'CheckpointEmitido';
}

/**
 * Los últimos hechos del historial, del más reciente al más viejo.
 *
 * ═══ Aquí NO va quién ═══
 *
 * El actor de cada hecho existe en el historial y sale en la descarga completa, pero **no sale por
 * aquí**. Mientras una conversación tiene la autoría sellada, una lista que dijera «alguien escribió
 * un aporte a las 14:03» junto al nombre rompería el sello desde fuera, sin tocar la pantalla que lo
 * protege: bastaría cruzar dos listas. Esta pantalla cuenta *qué pasó y cuándo*, que es exactamente
 * lo que hace falta para ver que no falta ninguno y que nada se movió de sitio.
 *
 * Tampoco sale el contenido. Un historial legible no es un volcado: es un índice.
 *
 * ═══ Por qué el sellado automático se cuenta y no se lista ═══
 *
 * Esta pantalla enseñaba los últimos 60 hechos EN CRUDO, y el resultado era inservible: 52 de esas
 * 60 líneas decían «Quedó registrado algo · La plataforma» y las 8 restantes «Se selló el historial
 * hasta acá». Ni una sola línea con algo que hubiera hecho una persona.
 *
 * La causa no es la pantalla: es que la tarea de anclaje escribe ~7 hechos por hora en el MISMO
 * historial, para siempre. Cuando se midió, 2309 de 2317 eran suyos. Con una ventana de 60, lo que
 * escribe alguien desaparece de la vista en unas ocho horas y no vuelve nunca — y ya había pasado:
 * el único problema que había escrito una persona en producción, el número 2173, quedaba fuera
 * mientras la pantalla no bajaba del 2260. Quien entra el jueves a ver la constancia de lo que
 * escribió el martes, no la encuentra, y lo que ve parece una aplicación rota repitiendo un
 * mensaje de relleno.
 *
 * Así que se listan los actos de personas y el sellado se CUENTA aparte, con su cifra a la vista.
 * No es filtrar para que quede bonito, y la diferencia importa: nada se oculta ni se borra, el
 * sellado sigue entero en la descarga verificable —que es donde sirve, porque es lo que el
 * verificador recalcula— y esta pantalla dice cuántos hay. Un historial legible es un índice de lo
 * que hizo el colectivo, no el registro de actividad de un proceso automático.
 */
export async function verHistorial(
  deps: ServicioDeps,
  actor: Actor,
  opciones: { readonly cuantos: number },
): Promise<HistorialLeido> {
  authorize(actor, 'ledger:read', { kind: 'ledger' });
  return conCliente(deps.pool, async (client) => {
    const eventos = await readAll(client);
    const enLaLista = eventos.filter(
      (e) => !esDelSellado(e.event.aggregateType, e.event.eventType),
    );
    const ordenados = [...enLaLista].reverse();
    const recortados = ordenados.slice(0, opciones.cuantos);
    // El rango de fechas es el del historial ENTERO, no el de lo que se lista: dice desde cuándo
    // hay registro, y eso empieza cuando se abrió el historial.
    const primero = eventos[0];
    const ultimo = eventos[eventos.length - 1];
    return {
      total: eventos.length,
      enLaLista: enLaLista.length,
      delSellado: eventos.length - enLaLista.length,
      desde: primero === undefined ? undefined : Date.parse(primero.event.occurredAt),
      hasta: ultimo === undefined ? undefined : Date.parse(ultimo.event.occurredAt),
      hechos: recortados.map((e) => ({
        // `leafIndex` cuenta desde 0 y la gente cuenta desde 1. El número está para que se vea que
        // no falta ninguno, así que tiene que ser el que la persona espera.
        numero: Number(e.leafIndex) + 1,
        cuando: Date.parse(e.event.occurredAt),
        tipo: e.event.eventType,
        tipoDeAgregado: e.event.aggregateType,
        agregado: e.event.aggregateId,
      })),
      hayMas: enLaLista.length > recortados.length,
    };
  });
}

export { memberId, toHash };
