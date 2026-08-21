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
  versionAt,
  ballotId as toBallotId,
} from '@koinonia/domain';

import type { PgClient, PgPool } from '../db/client.js';
import { loadDecisionLog, persistDecisionLog } from '../decision/repository.js';
import { DECISION_AGGREGATE_TYPE } from '../decision/codec.js';
import { readAll } from '../ledger/event-store.js';
import { verifyLedger, type LedgerVerification } from '../ledger/verify.js';
import {
  listAggregateIds,
  loadProblemLog,
  loadProposalLog,
  loadProposalState,
  persistProblemLog,
  persistProposalLog,
  PROBLEM_AGGREGATE_TYPE,
  PROPOSAL_AGGREGATE_TYPE,
} from '../workspace/repository.js';
import { allMembers, type MemberRecord, sha256Hex } from './identity.js';
import type { Ports } from './ports.js';

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
  },
): Promise<PropuestaConId> {
  const log = await conCliente(deps.pool, (c) => loadProposalLog(c, propuestaId));
  if (log.length === 0) throw new ServicioError('NO_ENCONTRADO', 404, 'no existe esa propuesta');
  const siguiente = await amendProposal(
    log,
    { eventId: nuevoEventId(deps), at: ahora(deps), actor },
    { title: input.titulo, body: input.cuerpo, rationale: input.motivo },
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
  const propuesta = await verPropuesta(deps, input.propuestaId);
  const circulo = propuesta.state.circleId;
  if (circulo === undefined) {
    throw new ServicioError('NO_ENCONTRADO', 404, 'esa propuesta no tiene grupo competente');
  }
  // Se autoriza ANTES de congelar el padrón y de hashear nada: abrir una votación es el acto más
  // caro del sistema, y quien no puede abrirla no debe llegar ni a que se le calcule una semilla.
  // `linkDecision` vuelve a comprobarlo más abajo: la orden autoriza siempre, la ruta también.
  authorize(actor, 'decision:open', { kind: 'decision', circleId: circulo });

  const version: ProposalVersion | undefined =
    input.version === undefined
      ? currentVersion(propuesta.state)
      : versionAt(propuesta.state, input.version);
  if (version === undefined) {
    throw new ServicioError('NO_ENCONTRADO', 404, 'esa versión de la propuesta no existe');
  }

  const id = decisionId(deps.ports.random.opaqueId());
  const at = ahora(deps);
  const cierre = instant(at + input.duracionHoras * HORA_MS);

  // El compromiso de la semilla se publica ANTES de abrir (B.0.3). Se guarda la semilla en la
  // bóveda, nunca en el historial: si viviera en el historial, el compromiso no comprometería nada.
  const seedAdmin = toHex(deps.ports.random.bytes(32));
  const seedCommitment: Hash = await hashText(seedAdmin);

  const registro = await conCliente(deps.pool, allMembers);
  const electorate = await congelarPadron(at, registro);
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

  // La autorización de abrir la comprueba `linkDecision` (acción `decision:open`, que exige
  // facilitación Y pertenecer al círculo). Se hace ANTES de escribir nada de la decisión: si el
  // actor no puede abrir, no queda ni un evento a medias.
  const propuestaLog = await conCliente(deps.pool, (c) => loadProposalLog(c, input.propuestaId));
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
      summary: version.title,
    },
  });
  log = await openDecision(log, {
    eventId: nuevoEventId(deps),
    at,
    actor: actor.memberId ?? 'system',
    config,
  });

  await conCliente(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO identity.decision_seed (decision_id, seed_admin, commitment)
       VALUES ($1, $2, $3) ON CONFLICT (decision_id) DO NOTHING`,
      [id, seedAdmin, seedCommitment],
    );
  });
  await persistDecisionLog(deps.pool, log, { requestId: input.requestId });
  // Dos agregados, dos claves de idempotencia: reusar la misma haría que el segundo `append` se
  // interpretara como una repetición del primero y la propuesta nunca quedaría enlazada.
  await persistProposalLog(deps.pool, propuestaSiguiente, {
    requestId: uuidDesde(sha256Hex(`${input.requestId}|enlace-de-decision`)),
  });

  return { id, state: replay(log), config };
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
): Promise<{ readonly state: DecisionState; readonly resultado: DecisionResult }> {
  const { log, state } = await verDecision(deps, decisionIdRaw);
  const config = state.config;
  if (config === undefined) {
    throw new ServicioError('ILLEGAL_TRANSITION', 409, 'esa decisión todavía no se ha abierto');
  }
  // Cerrar es un acto de procedimiento: `facilitator` o `guarantees`, y del círculo competente.
  authorize(actor, 'decision:close', { kind: 'decision', circleId: config.circleId });

  const at = ahora(deps);
  const anticipado = at < config.window.closesAt;
  if (anticipado) {
    // A.8.1: el cierre manual exige dos firmas del Círculo de Garantías. En el corte vertical no
    // hay dos personas de Garantías, así que sencillamente NO se permite cerrar antes de tiempo:
    // fallar cerrado antes que inventarse una firma.
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
  await persistDecisionLog(deps.pool, siguiente, { requestId: input.requestId });
  return { state: replay(siguiente), resultado };
}

export async function resultadoDeDecision(
  deps: ServicioDeps,
  decisionIdRaw: string,
): Promise<DecisionResult> {
  const { log, state } = await verDecision(deps, decisionIdRaw);
  if (state.closedAt === undefined) {
    throw new ServicioError(
      'NOT_CLOSED',
      409,
      'todavía no hay resultado: la votación sigue abierta',
    );
  }
  return computeResult(log);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Integridad
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface VerificacionCompleta {
  readonly ledger: LedgerVerification;
  readonly hechos: number;
  readonly desde: number | undefined;
  readonly propuestasVerificadas: number;
  readonly propuestasRotas: readonly { readonly id: string; readonly motivo: string }[];
  readonly decisionesVerificadas: number;
  readonly decisionesRotas: readonly { readonly id: string; readonly motivo: string }[];
}

/**
 * La comprobación completa: la cadena del ledger, la cadena de cada decisión, la de cada propuesta
 * y la correspondencia entre cada versión y su comprobante.
 *
 * Se recomputa todo: no se consulta ninguna bandera de «verificado». Una verificación que consulta
 * una bandera verifica la bandera.
 */
export async function verificarTodo(deps: ServicioDeps): Promise<VerificacionCompleta> {
  return conCliente(deps.pool, async (client) => {
    const ledger = await verifyLedger(client);
    const eventos = await readAll(client);
    const desde = eventos[0];

    const propuestasRotas: { id: string; motivo: string }[] = [];
    let propuestasVerificadas = 0;
    for (const id of await listAggregateIds(client, PROPOSAL_AGGREGATE_TYPE)) {
      try {
        await loadProposalState(client, id);
        propuestasVerificadas++;
      } catch (error) {
        propuestasRotas.push({
          id,
          motivo: error instanceof Error ? error.message : 'motivo desconocido',
        });
      }
    }

    const decisionesRotas: { id: string; motivo: string }[] = [];
    let decisionesVerificadas = 0;
    for (const id of await listAggregateIds(client, DECISION_AGGREGATE_TYPE)) {
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
        decisionesVerificadas++;
      } catch (error) {
        decisionesRotas.push({
          id,
          motivo: error instanceof Error ? error.message : 'motivo desconocido',
        });
      }
    }

    return {
      ledger,
      hechos: eventos.length,
      desde: desde === undefined ? undefined : Date.parse(desde.event.occurredAt),
      propuestasVerificadas,
      propuestasRotas,
      decisionesVerificadas,
      decisionesRotas,
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
