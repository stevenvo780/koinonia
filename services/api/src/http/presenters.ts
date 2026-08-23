/**
 * Del dominio a la pantalla.
 *
 * Aquí se aplica la **regla de oro** (PRODUCT §7): el rigor va en el motor y en la demostración,
 * nunca en el rótulo. Un `resultHash` es un `resultHash` en el motor y «el comprobante de este
 * resultado» en la respuesta; un `rollHash` es «el comprobante de la lista de quiénes podían decidir
 * aquí». La traducción se hace **en el servidor** y no en la web, porque el verificador independiente
 * y cualquier otro cliente tienen que leer las mismas palabras.
 *
 * Y aquí se decide también qué **no** sale: `meTooBy` sale como número y nunca como lista (PRODUCT
 * §4: «agregado, sin nombres»; ADR-0040: nada de métricas de actividad individual).
 */

import type {
  Actor,
  ContributionRecord,
  DecisionConfig,
  DecisionResult,
  DecisionState,
  DelegationResolution,
  DeliberationState,
  ExecutionPlan,
  InitiativeState,
  MemberId,
  Outcome,
  ProblemState,
  ProposalState,
  ProposalVersion,
  ReformRequirements,
  TaskPauseRecord,
} from '@koinonia/domain';
import {
  can,
  capWeight,
  currentContributions,
  instant,
  nextStage,
  orderContributionsForViewer,
  projectedRepresented,
  readContributionAuthor,
  referencesOf,
  stageRule,
  UnauthorizedError,
  vigentDelegations,
} from '@koinonia/domain';
import { type AfirmacionParaPantalla, aPantalla, TEXTOS } from '@koinonia/consensus';
import type {
  AporteDeliberacion,
  Consenso,
  DecisionDetalle,
  DecisionResumen,
  DelegacionesDeDecision,
  DeliberacionDetalle,
  DeliberacionResumen,
  Desenlace,
  Evidencia,
  Historial,
  IniciativaDetalle,
  MisTareas,
  Normas,
  PanelDeDelegaciones,
  PausaTarea,
  PlanEjecucion,
  PasoTraza,
  ProblemaDetalle,
  ProblemaResumen,
  PropuestaDetalle,
  PropuestaResumen,
  RepartoDeLaVoz,
  ResultadoDecision,
  TablaTraza,
  Tarea,
  TextoDeConsenso,
  VersionPropuesta,
} from '@koinonia/contracts';
import {
  AVISO_AUTORIA_OCULTA,
  AVISO_AUTORIA_SOLO_DEL_GRUPO,
  AVISO_AUTORIA_VISIBLE,
  DESENLACE_EN_PALABRAS,
  ETAPA_EN_PALABRAS,
  ETAPA_PARA_QUE_SIRVE,
  GRAVEDAD_EN_PALABRAS,
  MODO_POSICION_EN_PALABRAS,
  RELACION_RAZON_EN_PALABRAS,
  TIPO_APORTE_EN_PALABRAS,
} from '@koinonia/contracts';

import {
  type ConsensoCalculado,
  type DelegacionesDeUnaDecision,
  type HistorialLeido,
  type NormasDelDespliegue,
  ocultaLaAutoria,
  queHaceFaltaParaQuePase,
  queSePuedeEscribirAhora,
  type MetodoSoportado,
} from './service.js';

function evidenciaDto(
  registro: ProblemState['evidence'][number],
  quien: MemberId | undefined,
): Evidencia {
  return {
    id: registro.evidenceId,
    certeza: registro.certainty,
    cuerpo: registro.body,
    ...(registro.source === undefined ? {} : { fuente: registro.source }),
    cuando: registro.at,
    // Lo decide el servidor comparando con el autor real. Si lo decidiera el cliente, el botón de
    // «retirar» aparecería donde el cliente quisiera, y esa es la mitad visible del fallo de
    // autorización horizontal; la otra mitad la cierra el dominio al rechazar la escritura.
    esMia: quien !== undefined && registro.by === quien,
    ...(registro.retracted === undefined
      ? {}
      : {
          retirada: {
            cuando: registro.retracted.at,
            motivo: registro.retracted.motivation,
          },
        }),
  };
}

export function problemaResumenDto(
  id: string,
  state: ProblemState,
  propuestas: number,
): ProblemaResumen {
  return {
    id,
    titulo: state.title,
    estado: state.status,
    circuloId: state.circleId ?? '',
    desde: state.openedAt ?? 0,
    // Número, jamás la lista.
    lesPasaLoMismo: state.meTooBy.length,
    aportes: state.evidence.filter((e) => e.retracted === undefined).length,
    propuestas,
  };
}

export function problemaDetalleDto(
  id: string,
  state: ProblemState,
  propuestas: number,
  quien: MemberId | undefined,
): ProblemaDetalle {
  return {
    ...problemaResumenDto(id, state, propuestas),
    cuerpo: state.body,
    evidencias: state.evidence.map((e) => evidenciaDto(e, quien)),
    yaDijeQueMePasa: quien !== undefined && state.meTooBy.includes(quien),
    esMio: quien !== undefined && state.author === quien,
  };
}

function versionDto(version: ProposalVersion): VersionPropuesta {
  return {
    version: version.version,
    titulo: version.title,
    cuerpo: version.body,
    huella: version.versionHash,
    cuando: version.at,
    ...(version.executionPlan === undefined ? {} : { plan: planDto(version.executionPlan) }),
    ...(version.rationale === undefined ? {} : { motivo: version.rationale }),
  };
}

function planDto(plan: ExecutionPlan): PlanEjecucion {
  return {
    objetivo: plan.objective,
    responsableId: plan.responsibleId,
    revisarEn: plan.reviewAt,
    criteriosDeExito: plan.successCriteria.map((criterion) => ({
      descripcion: criterion.description,
      fuenteDeVerificacion: criterion.evidenceSource,
    })),
  };
}

export function propuestaResumenDto(
  id: string,
  state: ProposalState,
  quien: MemberId | undefined,
): PropuestaResumen {
  return {
    id,
    problemaId: state.problemId ?? '',
    circuloId: state.circleId ?? '',
    titulo: state.versions.at(-1)?.title ?? '',
    versionVigente: state.versions.length,
    esMia: quien !== undefined && state.author === quien,
    decisiones: state.decisions.map((d) => ({ decisionId: d.decisionId, huella: d.versionHash })),
  };
}

export function propuestaDetalleDto(
  id: string,
  state: ProposalState,
  quien: MemberId | undefined,
  problemaTitulo: string,
): PropuestaDetalle {
  return {
    ...propuestaResumenDto(id, state, quien),
    // **Todas** las versiones. Es lo que hace visible que la 1 sigue intacta después de la 2.
    versiones: state.versions.map(versionDto),
    problemaTitulo,
  };
}

function metodoDe(state: DecisionState): MetodoSoportado {
  return state.config?.method.kind === 'sociocratic-consent'
    ? 'sociocratic-consent'
    : 'simple-majority';
}

export function decisionResumenDto(
  id: string,
  state: DecisionState,
  titulo: string,
): DecisionResumen {
  const config = state.config;
  const podian = config?.electorate.censusSize ?? 0;
  const metodo = metodoDe(state);
  const votantes = new Set(state.ballots.map((b) => b.voter));
  return {
    id,
    propuestaId: config?.proposalId ?? '',
    titulo,
    estado: state.status,
    metodo,
    abreEn: config?.window.opensAt ?? 0,
    cierraEn: state.closesAt ?? config?.window.closesAt ?? 0,
    huellaVersion: state.proposalVersionHash ?? config?.proposalVersionHash ?? '',
    podianDecidir: podian,
    seManifestaron: votantes.size,
    queHaceFaltaParaQuePase: queHaceFaltaParaQuePase(metodo, podian),
  };
}

/** Cómo se dice la respuesta que alguien ya emitió, para poder mostrarla y poder cambiarla. */
function miRespuestaEnPalabras(state: DecisionState, quien: MemberId): string | undefined {
  const mias = state.ballots.filter((b) => b.voter === quien && b.round === state.round);
  const ultima = mias.at(-1);
  if (ultima === undefined) return undefined;
  switch (ultima.payload.kind) {
    case 'abstain':
      return 'Me abstengo';
    case 'binary':
      return ultima.payload.approve ? 'Sí' : 'No';
    case 'consent':
      return ultima.payload.stance === 'consent'
        ? 'Sin objeción'
        : ultima.payload.stance === 'concern'
          ? 'Tengo una reserva'
          : 'Objeto';
    case 'score':
      return 'Puntué las opciones';
    case 'ranking':
      return 'Ordené las opciones por preferencia';
    case 'grades':
      return 'Valoré cada opción con una mención';
  }
}

export function decisionDetalleDto(
  id: string,
  state: DecisionState,
  titulo: string,
  cuerpo: string,
  quien: MemberId | undefined,
  plan?: ExecutionPlan,
): DecisionDetalle {
  const config = state.config;
  const enPadron =
    quien !== undefined && (config?.electorate.members.some((m) => m.memberId === quien) ?? false);
  const respuesta = quien === undefined ? undefined : miRespuestaEnPalabras(state, quien);
  return {
    ...decisionResumenDto(id, state, titulo),
    cuerpoVersion: cuerpo,
    ...(plan === undefined ? {} : { plan: planDto(plan) }),
    puedoDecidir: enPadron && state.status === 'Open',
    ...(respuesta === undefined ? {} : { miRespuesta: respuesta }),
    ...(enPadron
      ? {}
      : {
          motivoNoPuedo:
            quien === undefined
              ? 'Para responder hay que entrar con el correo institucional.'
              : 'No estabas en la lista de quienes podían decidir aquí, que se cerró al abrir la ' +
                'votación y ya no cambia.',
        }),
  };
}

/**
 * `Outcome` del motor → `Desenlace` del contrato HTTP.
 *
 * El motor 30 añadió `winner` (métodos de varias opciones) y `sample` (sorteo). El contrato público
 * —`packages/contracts`— todavía no tiene palabras para ellos, y ampliarlo cambiaría la respuesta de
 * la API sin que nadie haya pedido esa pantalla. Los dos casos se dicen «Aprobada», que es lo que la
 * máquina de estados ya sostiene: `engine.ts` ratifica `winner` y `sample` por el mismo camino que
 * `approved` y rechaza los tres por igual. La opción ganadora y la muestra sorteada no se pierden:
 * viajan en el `Outcome` del resultado, que es lo que el verificador independiente lee.
 */
function desenlaceDe(outcome: Outcome): Desenlace {
  switch (outcome.kind) {
    case 'winner':
    case 'sample':
      return 'approved';
    default:
      return outcome.kind;
  }
}

/**
 * Por qué salió lo que salió, en una frase.
 *
 * Se compone sobre la narrativa del motor, que ya está escrita sin jerga, y se le añade el desenlace
 * en palabras. Nunca se muestra el identificador del desenlace.
 */
function relatoDe(resultado: DecisionResult): string {
  const desenlace = DESENLACE_EN_PALABRAS[desenlaceDe(resultado.outcome)];
  const detalle =
    resultado.outcome.kind === 'rejected'
      ? resultado.outcome.reason === 'objections-pending'
        ? ' Quedaron objeciones en pie después de las rondas previstas.'
        : ' No se alcanzó lo que hacía falta.'
      : resultado.outcome.kind === 'needs-new-round'
        ? ` Se abre la ronda ${String(resultado.outcome.nextRound)} para enmendar el texto.`
        : '';
  return `${desenlace}.${detalle} ${resultado.proof.narrative}`;
}

function pasoDto(step: DecisionResult['proof']['steps'][number]): PasoTraza {
  const datos: Record<string, string | number> = {};
  for (const clave of Object.keys(step.evidence)) {
    const valor = step.evidence[clave];
    if (valor !== undefined) datos[clave] = valor;
  }
  const objeciones = step.evidence['objecionesBloqueantes'];
  const explicacion =
    step.id === 'S4' && typeof objeciones === 'number' && objeciones > 0
      ? objeciones === 1
        ? 'Queda 1 objeción admitida sin integrar.'
        : `Quedan ${String(objeciones)} objeciones admitidas sin integrar.`
      : step.claim;
  return { id: step.id, explicacion, datos };
}

function tablaDto(tabla: DecisionResult['proof']['tables'][number]): TablaTraza {
  if (tabla.title === 'Objeciones' && tabla.columns[0] === 'Objeción') {
    return {
      titulo: tabla.title,
      columnas: ['Referencia', ...tabla.columns.slice(1)],
      filas: tabla.rows.map((fila, indice) => [`Objeción ${String(indice + 1)}`, ...fila.slice(1)]),
    };
  }
  return {
    titulo: tabla.title,
    columnas: [...tabla.columns],
    filas: tabla.rows.map((fila) => [...fila]),
  };
}

export function resultadoDto(
  resultado: DecisionResult,
  titulo: string,
  iniciativaId?: string,
): ResultadoDecision {
  return {
    decisionId: resultado.decisionId,
    titulo,
    ...(iniciativaId === undefined ? {} : { iniciativaId }),
    desenlace: desenlaceDe(resultado.outcome),
    desenlaceEnPalabras: DESENLACE_EN_PALABRAS[desenlaceDe(resultado.outcome)],
    relato: relatoDe(resultado),
    pasos: resultado.proof.steps.map(pasoDto),
    tablas: resultado.proof.tables.map(tablaDto),
    participacion: {
      emitidas: resultado.turnout.cast,
      representadas: resultado.turnout.represented,
      podianDecidir: resultado.turnout.census,
    },
    comprobante: resultado.resultHash,
    comprobanteReglas: resultado.configHash,
    comprobanteLista: resultado.rollHash,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Deliberación
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ **Esta proyección es la que impide la fuga de autoría hacia el cliente.**
 *
 * `DeliberationState` lleva el `authorId` de cada aporte en memoria, en todas las etapas y a
 * propósito (ADR-0049). El dominio no puede cerrar eso: quien tiene el estado plegado tiene la
 * autoría, y un `JSON.stringify(state.contributions)` en cualquier ruta filtraría la etapa entera de
 * golpe. La única barrera es que **nada de este fichero copie el registro**: cada campo del DTO se
 * escribe a mano, y el autor sólo aparece si `readContributionAuthor` —la única puerta de lectura
 * del dominio— lo concede.
 *
 * Por eso aquí **no hay ni un `...registro`**. Un spread convertiría cada campo nuevo del motor en
 * una fuga silenciosa el día que alguien lo añada, sin que nadie tocara este fichero. Y por eso
 * `esMio` también falta mientras la autoría esté oculta: si viajara, comparar dos respuestas
 * bastaría para atribuir cada aporte por diferencia, y el motor deniega esa lectura incluso a quien
 * lo escribió.
 */
function autorVisible(
  state: DeliberationState,
  actor: Actor,
  id: ContributionRecord['contributionId'],
): MemberId | undefined {
  try {
    return readContributionAuthor(state, actor, id);
  } catch (error) {
    if (error instanceof UnauthorizedError) return undefined;
    throw error;
  }
}

/** Cómo se dice cada arista del grafo. El dibujo se enseña igual, pero con palabras. */
function comoSeRelaciona(field: string, body: ContributionRecord['body']): string {
  switch (field) {
    case 'positionId':
      return body.kind === 'razon' ? RELACION_RAZON_EN_PALABRAS[body.relation] : 'Se refiere a';
    case 'supportsReasonId':
      return 'Respalda';
    case 'appliesToContributionIds':
      return 'Se aplica a';
    case 'alternativeId':
      return 'Riesgo de';
    case 'sourcePositionIds':
      return 'Sale de';
    default:
      return 'Se refiere a';
  }
}

/** El nombre del aporte en pantalla. Una pregunta y una postura son los dos `posicion` en el motor. */
function comoSeLlamaElAporte(body: ContributionRecord['body']): string {
  if (body.kind === 'posicion') return MODO_POSICION_EN_PALABRAS[body.mode];
  return TIPO_APORTE_EN_PALABRAS[body.kind];
}

function textoDelAporte(body: ContributionRecord['body']): string {
  return body.kind === 'riesgo' ? body.impact : body.text;
}

function aporteDto(
  state: DeliberationState,
  actor: Actor,
  registro: ContributionRecord,
  vigente: boolean,
): AporteDeliberacion {
  const autorId = autorVisible(state, actor, registro.contributionId);
  const body = registro.body;
  const referencias = referencesOf(body, registro.supersedesContributionId).filter(
    (referencia) => referencia.field !== 'supersedesContributionId',
  );
  return {
    id: registro.contributionId,
    tipo: body.kind,
    etapa: registro.stage,
    etapaEnPalabras: ETAPA_EN_PALABRAS[registro.stage],
    comoSeLlama: comoSeLlamaElAporte(body),
    ...(body.kind === 'posicion' ? { modo: body.mode } : {}),
    texto: textoDelAporte(body),
    ...(body.kind === 'evidencia' && body.source !== undefined ? { fuente: body.source } : {}),
    ...(body.kind === 'riesgo'
      ? {
          gravedad: body.severity,
          gravedadEnPalabras: GRAVEDAD_EN_PALABRAS[body.severity],
          mitigacion: body.mitigation,
        }
      : {}),
    responde: referencias.map((referencia) => ({
      aporteId: referencia.targetId,
      comoSeRelaciona: comoSeRelaciona(referencia.field, body),
    })),
    ...(registro.supersedesContributionId === undefined
      ? {}
      : { corrigeA: registro.supersedesContributionId }),
    vigente,
    // Los tres juntos o ninguno. `cuando` viaja con la autoría porque un instante al milisegundo
    // junto a un aporte sin nombre se atribuye con cualquier señal de fuera —«acabo de escribir»,
    // el momento en que alguien se conectó— sin llegar a intentar la acción denegada.
    ...(autorId === undefined
      ? {}
      : { autorId, esMio: autorId === actor.memberId, cuando: registro.submittedAt }),
  };
}

export function deliberacionResumenDto(
  id: string,
  state: DeliberationState,
  problemaTitulo: string,
): DeliberacionResumen {
  return {
    id,
    problemaId: state.problemId ?? '',
    problemaTitulo,
    circuloId: state.circleId ?? '',
    etapa: state.stage,
    etapaEnPalabras: ETAPA_EN_PALABRAS[state.stage],
    queSeHaceEnEstaEtapa: ETAPA_PARA_QUE_SIRVE[state.stage],
    abreEn: state.opensAt ?? 0,
    cierraEn: state.closesAt ?? 0,
    cuantosAportes: state.contributions.length,
    autoriaVisible: !ocultaLaAutoria(state.stage),
  };
}

/**
 * El detalle, con los aportes **en el orden de esta lectora**.
 *
 * El orden se aleatoriza por persona con la semilla que quedó en el historial, para que el primero
 * de la lista no pese más que el último por estar arriba.
 *
 * Quien mira sin cuenta no tiene semilla propia. **No se le devuelve el orden de escritura**: se le
 * ordena por el identificador del aporte, que es aleatorio y no dice nada. Servirle el orden de
 * escritura le entregaría, gratis y sin cuenta, la secuencia exacta en que participó cada persona
 * —justo lo que la permutación existe para no dar—, y encima le daría a quien no entró más
 * información que a quien entró.
 */
export async function deliberacionDetalleDto(
  id: string,
  state: DeliberationState,
  actor: Actor,
  problemaTitulo: string,
): Promise<DeliberacionDetalle> {
  const vigentes = new Set(currentContributions(state).map((c) => c.contributionId));
  const orden =
    actor.memberId === undefined
      ? [...state.contributions].sort((a, b) =>
          a.contributionId < b.contributionId ? -1 : a.contributionId > b.contributionId ? 1 : 0,
        )
      : await orderContributionsForViewer(state, actor.memberId);

  const regla = stageRule(state.stage);
  const siguiente = nextStage(state.stage);
  const puedeEscribirEnLaEtapa = regla.kinds.length > 0;
  const enCirculo =
    state.circleId !== undefined &&
    can(actor, 'deliberation:contribute', { kind: 'deliberation', circleId: state.circleId });

  // Tres casos, no dos. La etapa decide si la autoría está oculta **para todo el mundo**; la
  // pertenencia al círculo decide si además la ve quien está mirando. Decir «ya se ve quién escribió
  // cada cosa» a alguien que no va a ver ni un nombre es una contradicción en la misma pantalla.
  const leeLaAutoria =
    state.circleId !== undefined &&
    can(actor, 'deliberation:read-authorship', {
      kind: 'deliberation',
      stage: state.stage,
      circleId: state.circleId,
    });

  return {
    ...deliberacionResumenDto(id, state, problemaTitulo),
    avisoDeAutoria: ocultaLaAutoria(state.stage)
      ? AVISO_AUTORIA_OCULTA
      : leeLaAutoria
        ? AVISO_AUTORIA_VISIBLE
        : AVISO_AUTORIA_SOLO_DEL_GRUPO,
    aportes: orden.map((registro) =>
      aporteDto(state, actor, registro, vigentes.has(registro.contributionId)),
    ),
    queSePuedeEscribirAhora: queSePuedeEscribirAhora(state.stage),
    tiposQueSeAdmitenAhora: [...regla.kinds],
    modosQueSeAdmitenAhora: [...regla.positionModes],
    relacionesQueSeAdmitenAhora: [...regla.reasonRelations],
    laSalidaDebeCorregirAOtra: regla.alternativeMustSupersede,
    puedoAportar: enCirculo && puedeEscribirEnLaEtapa,
    ...(enCirculo && puedeEscribirEnLaEtapa
      ? {}
      : {
          motivoNoPuedoAportar: !puedeEscribirEnLaEtapa
            ? 'Esta conversación ya está lista para decidir: acá no se escribe más.'
            : actor.memberId === undefined
              ? 'Para aportar hay que entrar con el correo institucional.'
              : 'Este asunto lo lleva otro grupo, y hay que ser parte de él.',
        }),
    puedoAvanzarEtapa:
      siguiente !== undefined &&
      state.circleId !== undefined &&
      can(actor, 'deliberation:advance-stage', {
        kind: 'deliberation',
        circleId: state.circleId,
      }),
    ...(siguiente === undefined
      ? {}
      : {
          etapaSiguiente: siguiente,
          etapaSiguienteEnPalabras: ETAPA_EN_PALABRAS[siguiente],
        }),
  };
}

function pausaTareaDto(pausa: TaskPauseRecord): PausaTarea {
  return {
    id: pausa.pauseId,
    tipo: pausa.kind === 'blocked' ? 'bloqueo' : 'apoyo',
    categoria: pausa.category,
    iniciadaEn: pausa.startedAt,
    ...(pausa.endedAt === undefined || pausa.endedBy === undefined
      ? {}
      : {
          finalizadaEn: pausa.endedAt,
          causaDeFin:
            pausa.endedBy === 'resumed' ? ('reanudacion' as const) : ('reasignacion' as const),
        }),
  };
}

export function iniciativaDto(
  id: string,
  state: InitiativeState,
  quien?: MemberId,
  ratificableEn?: number,
): IniciativaDetalle {
  return {
    id,
    decisionId: state.decisionId,
    propuestaId: state.proposalId,
    circuloId: state.circleId,
    objetivo: state.executionPlan.objective,
    responsableId: state.executionPlan.responsibleId,
    revisarEn: state.executionPlan.reviewAt,
    criteriosDeExito: state.executionPlan.successCriteria.map((criterion) => ({
      descripcion: criterion.description,
      fuenteDeVerificacion: criterion.evidenceSource,
    })),
    // El campo histórico conserva su único valor público; `activa` expresa la nueva distinción.
    estado: 'por-empezar',
    creadaEn: state.createdAt,
    comprobanteDecision: state.decisionResultHash,
    comprobanteVersion: state.proposalVersionHash,
    // Los streams históricos sólo tienen InitiativeCreated: se proyectan como provisionales y sin
    // trabajo, sin inventarles una activación ni una asignación.
    activa: state.activatedAt !== undefined,
    ...(state.activatedAt !== undefined || ratificableEn === undefined ? {} : { ratificableEn }),
    ...(state.activatedAt === undefined ? {} : { activadaEn: state.activatedAt }),
    esResponsableInicial: quien !== undefined && state.executionPlan.responsibleId === quien,
    hitos: state.milestones.map((milestone) => ({
      id: milestone.milestoneId,
      titulo: milestone.title,
      criterioDeTerminacion: milestone.completionCriterion,
      venceEn: milestone.dueAt,
      planificadoEn: milestone.plannedAt,
    })),
    tareas: state.tasks.map((task) => tareaDto(task, state, quien)),
  };
}

/**
 * Una tarea, dicha en la lengua de la pantalla.
 *
 * Se extrajo de `iniciativaDto` para que `GET /mi/tareas` presente la tarea **exactamente igual**
 * que la iniciativa. Dos redacciones del mismo objeto acaban divergiendo, y la que diverge siempre
 * es la que decide si algo es tuyo.
 */
export function tareaDto(
  task: InitiativeState['tasks'][number],
  state: InitiativeState,
  quien?: MemberId,
): Tarea {
  return {
    id: task.taskId,
    hitoId: task.milestoneId,
    destinatarioId: task.offeredTo,
    ...(task.assigneeId === undefined ? {} : { responsableId: task.assigneeId }),
    ofertaId: task.currentOfferId,
    revision: task.lastSeq,
    titulo: task.title,
    descripcion: task.description,
    venceEn: task.dueAt,
    esfuerzoMinutos: task.effortMinutes,
    dependeDe: [...task.dependsOn],
    estado: task.status,
    ...(task.startedAt === undefined ? {} : { iniciadaEn: task.startedAt }),
    pausas: task.pauses.map(pausaTareaDto),
    ...(task.currentPause === undefined
      ? {}
      : {
          pausaActual: pausaTareaDto(task.currentPause),
        }),
    solicitudesDeAyuda: task.helpRequests.map((request) => ({
      id: request.helpRequestId,
      pausaId: request.pauseId,
      categoria: request.category,
      solicitadaEn: request.requestedAt,
    })),
    evidencias: task.evidence.map((evidence) => ({
      id: evidence.evidenceId,
      tipo: evidence.kindCode,
      tamano: evidence.sizeClass,
      visibilidad: evidence.visibility,
      agregadaEn: evidence.addedAt,
      puedeAbrirse:
        quien !== undefined &&
        (evidence.addedBy === quien || state.executionPlan.responsibleId === quien),
    })),
    entregas: task.deliveries.map((delivery) => ({
      id: delivery.deliveryId,
      evidenciaIds: [...delivery.evidenceIds],
      entregadaEn: delivery.deliveredAt,
      puedeAbrirse:
        quien !== undefined &&
        (delivery.deliveredBy === quien || state.executionPlan.responsibleId === quien),
      ...(delivery.review === undefined
        ? {}
        : {
            revision:
              delivery.review.type === 'changes-requested'
                ? {
                    tipo: 'cambios-solicitados' as const,
                    motivo: delivery.review.reason,
                    revisadaEn: delivery.review.at,
                  }
                : {
                    tipo: 'aceptada' as const,
                    evidenciaCriterio: delivery.review.outcomeCriterionEvidence,
                    revisadaEn: delivery.review.at,
                  },
          }),
    })),
    ...(task.currentDeliveryId === undefined ? {} : { entregaActualId: task.currentDeliveryId }),
    ...(task.completedAt === undefined ? {} : { completadaEn: task.completedAt }),
    esMia: quien !== undefined && (task.assigneeId === quien || task.offeredTo === quien),
  };
}

/**
 * Las tareas **propias**, y nada más.
 *
 * El filtro es del servidor: `esMia` deja de ser una condición de pintado y pasa a ser la condición
 * de existencia de la fila. Lo que no es tuyo no se serializa, así que no puede filtrarse por un
 * fallo de la interfaz, no ocupa la conexión y no queda en la memoria del teléfono.
 *
 * De las dependencias sale **cuántas faltan**, no cuáles: para decidir si podés empezar alcanza el
 * número, y los títulos son de tareas de otras personas.
 */
export function misTareasDto(
  iniciativas: readonly { readonly id: string; readonly state: InitiativeState }[],
  quien: MemberId,
): MisTareas {
  return iniciativas.flatMap(({ id, state }) =>
    state.tasks
      .filter((task) => task.assigneeId === quien || task.offeredTo === quien)
      .map((task) => ({
        iniciativaId: id,
        objetivo: state.executionPlan.objective,
        tarea: tareaDto(task, state, quien),
        dependenciasPendientes: task.dependsOn.filter((dependencyId) => {
          const dependencia = state.tasks.find((otra) => otra.taskId === dependencyId);
          // Una dependencia que no aparece en el estado se cuenta como pendiente: nunca se anuncia
          // «ya podés empezar» a partir de una ausencia.
          return dependencia?.status !== 'completada';
        }).length,
      })),
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Consenso
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * De dónde salen los grupos, dicho para quien desconfía.
 *
 * Es la frase más importante de esa pantalla. Un mapa de bandos sin esta línea se lee como un
 * veredicto sobre las personas —«vos sos de los de allá»— y ADR-0038 advierte exactamente de esa
 * lectura. Con la línea se lee como lo que es: un resumen de respuestas que ya son públicas.
 */
const DE_DONDE_SALE =
  'Esto no es una encuesta ni una etiqueta sobre nadie: sale de las respuestas que cada quien ya ' +
  'dio en las votaciones cerradas, que son públicas y cualquiera puede volver a contar. Se juntan ' +
  'las personas que respondieron parecido y se mira en qué coinciden todas. Los grupos no tienen ' +
  'nombre ni bando: son cómo se respondió, no quién es quién.';

/** «82,4 %». El redondeo se decide una vez, en el servidor, y no en cada cliente. */
function comoPorcentaje(p: number): string {
  return `${(p * 100).toFixed(1)} %`;
}

function textoDeConsensoDto(afirmacion: AfirmacionParaPantalla): TextoDeConsenso {
  return {
    texto: afirmacion.texto,
    respuestas: afirmacion.observaciones,
    acuerdoPorGrupo: afirmacion.pPorGrupo.map((p, indice) => ({
      // El grupo se numera desde 1 para las personas (ADR-0041). El índice del arreglo no se
      // enseña nunca: un «Grupo 0» es una fuga del lenguaje de la máquina.
      grupo: indice + 1,
      acuerdo: comoPorcentaje(p),
    })),
  };
}

/** Por qué todavía no hay nada que calcular, y qué tendría que pasar. Nunca un callejón. */
const CONSENSO_TODAVIA_NO: Readonly<
  Record<
    'sin-votaciones' | 'poca-gente' | 'sin-diferencias' | 'no-se-estabilizo',
    {
      readonly descripcion: string;
      readonly queFalta: string;
    }
  >
> = {
  'sin-votaciones': {
    descripcion:
      'Para ver en qué coincide la gente hacen falta varias votaciones ya cerradas: con una sola, ' +
      'lo único que se puede decir es quién votó qué, y eso ya está en el resultado de esa votación.',
    queFalta:
      'Hacen falta al menos tres votaciones cerradas. Las decisiones salen de problemas escritos y ' +
      'discutidos antes.',
  },
  'poca-gente': {
    descripcion:
      'Todavía respondieron muy pocas personas. Con este puñado de respuestas, cualquier reparto ' +
      'en grupos diría más del azar que de lo que la gente piensa.',
    queFalta: 'Hace falta que participe más gente en las votaciones que ya están abiertas.',
  },
  'sin-diferencias': {
    descripcion:
      'Todo el mundo respondió igual a todo. No hay ninguna diferencia sobre la que agrupar a ' +
      'nadie, y eso es un resultado: en estos asuntos no hubo desacuerdo.',
    queFalta:
      'Cuando aparezca un asunto en el que la gente no coincida, acá se va a ver en qué se separa.',
  },
  'no-se-estabilizo': {
    descripcion:
      'El cálculo no llegó a una respuesta estable con estas respuestas, y preferimos no enseñar ' +
      'un resultado aproximado: dos personas que lo miraran verían mapas distintos.',
    queFalta:
      'Con más votaciones cerradas el cálculo se estabiliza. Mientras tanto, no hay grupos que ' +
      'mostrar.',
  },
};

/**
 * El consenso, con los tres desenlaces discriminados.
 *
 * El título de «no hay grupos claros» sale de `TEXTOS.sinGruposTitulo`, del propio paquete, y no de
 * una cadena escrita aquí: `PRODUCT.md` §4 lo promete literalmente y el paquete ya tiene una prueba
 * que lo fija. Copiarlo sería aceptar que un día digan cosas distintas.
 */
export function consensoDto(calculado: ConsensoCalculado): Consenso {
  const personas = calculado.datos.participantes.length;
  const votaciones = calculado.datos.votaciones;

  if (calculado.tipo === 'todavia-no') {
    const motivo = CONSENSO_TODAVIA_NO[calculado.motivo];
    return {
      tipo: 'todavia-no',
      // Mismo título que el desenlace de «no hay facciones», y a propósito: la pregunta de quien
      // llega es «¿en qué grupos está la gente?» y la respuesta honesta es la misma. Lo que cambia
      // —y por eso son dos casos y no uno— es el porqué, que va justo debajo.
      titulo: TEXTOS.sinGruposTitulo,
      descripcion: motivo.descripcion,
      queFalta: motivo.queFalta,
      personas,
      votaciones,
    };
  }

  const pantalla = aPantalla(calculado.resultado);
  if (pantalla.tipo === 'FaccionesNoDetectadas') {
    return {
      tipo: 'sin-grupos',
      titulo: pantalla.titulo,
      descripcion: pantalla.descripcion,
      deDondeSale: DE_DONDE_SALE,
      personas,
      votaciones,
      acuerdoGeneral: {
        titulo: pantalla.acuerdoGeneralTitulo,
        descripcion: pantalla.acuerdoGeneralDescripcion,
        textos: pantalla.acuerdoGeneral.map(textoDeConsensoDto),
        aviso: pantalla.aviso,
      },
    };
  }

  return {
    tipo: 'grupos',
    titulo: pantalla.titulo,
    descripcion: pantalla.descripcion,
    deDondeSale: DE_DONDE_SALE,
    personas,
    votaciones,
    grupos: pantalla.grupos.map((grupo) => ({ numero: grupo.id, personas: grupo.tamano })),
    ...(calculado.miGrupo === undefined ? {} : { miGrupo: calculado.miGrupo }),
    enQueCoinciden: {
      titulo: pantalla.textos.afirmacionesPuenteTitulo,
      descripcion: pantalla.textos.afirmacionesPuenteDescripcion,
      textos: pantalla.afirmacionesPuente.map(textoDeConsensoDto),
      aviso: pantalla.afirmacionesPuente.length === 0 ? pantalla.textos.sinAcuerdoDestacable : '',
    },
    enQueSeSeparan: {
      titulo: pantalla.textos.afirmacionesDivisivasTitulo,
      descripcion: pantalla.textos.afirmacionesDivisivasDescripcion,
      textos: pantalla.afirmacionesDivisivas.map(textoDeConsensoDto),
      aviso:
        pantalla.afirmacionesDivisivas.length === 0
          ? 'Ninguna votación separó a los grupos de forma destacable.'
          : '',
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Delegaciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Qué es prestar el voto y qué lo deshace. Va arriba de la pantalla, siempre, y no en una ayuda.
 *
 * La tercera línea es la que evita el fallo que INV-23 describe: alguien presta su voto, después
 * vota igualmente, y no entiende por qué su delegado no votó por él. Vota directo **gana**, y hay
 * que decirlo antes de que pase, no explicarlo después.
 */
const COMO_FUNCIONA_DELEGAR: readonly string[] = [
  'Prestarle tu voto a alguien sirve para no dejar tu parte en silencio cuando no vas a poder ' +
    'mirar una votación. Esa persona vota, y tu voto va con el suyo.',
  'Lo recuperás cuando quieras, de un toque, y tiene efecto en el momento: aunque quien lo tenía ya ' +
    'haya votado, si lo recuperás antes del cierre tu parte deja de ir con la suya.',
  'Si votás vos, tu voto manda y el préstamo no se usa. No hace falta que lo recuperes antes: ' +
    'votar ya lo deshace.',
  'Nadie puede juntar más votos que el tope. Lo que pasa del tope vuelve a quien lo prestó, ' +
    'empezando por el préstamo más reciente.',
  'El préstamo se acaba solo al cerrar la votación. No existe el préstamo para siempre.',
];

/** Cómo está repartida la voz, en una frase. Nunca el nombre del índice (ADR-0041). */
function comoEstaLaVoz(cargan: number, maximo: number, tope: number): string {
  if (cargan === 0) {
    return 'Nadie le prestó el voto a nadie todavía: cada quien lleva el suyo.';
  }
  if (maximo * 2 >= tope * 2 - 1 && maximo >= tope) {
    return (
      `La voz está concentrada: alguien ya llegó al tope de ${String(tope)} votos. Lo que pase de ` +
      'ahí vuelve a quien lo prestó.'
    );
  }
  if (cargan === 1) {
    return (
      `Una sola persona carga votos prestados, y llegó a ${String(maximo)} de un tope de ` +
      `${String(tope)}. Cuanta menos gente los cargue, menos repartida está la voz.`
    );
  }
  return (
    `Los votos prestados están repartidos entre ${String(cargan)} personas, y quien más lleva ` +
    `junta ${String(maximo)} de un tope de ${String(tope)}.`
  );
}

/**
 * El reparto de la voz, contado **ex ante**.
 *
 * Se cuenta a quién representaría cada delegado si la votación cerrara ahora, con la misma función
 * que el dominio usa para rechazar una concesión que pasa del tope. Contar sólo lo que ya llegó a
 * una papeleta daría cero mientras nadie haya votado —que es la mitad de la vida de una votación—,
 * y justamente ahí es cuando la persona necesita ver si su voz se está juntando en pocas manos.
 */
function repartoDto(
  state: DecisionState,
  config: DecisionConfig,
  resolucion: DelegationResolution | undefined,
  at: number,
): RepartoDeLaVoz {
  // `at + 1` y no `at`: una delegación no está vigente en su propio milisegundo (C.2), así que
  // contar en `at` dejaría fuera justo la que se acaba de conceder. Es la convención de
  // `firstActiveInstant`, la misma con la que el dominio comprueba el tope antes de aceptarla.
  const desdeYa = instant(at + 1);
  const vigentes = vigentDelegations(state.delegations, desdeYa);
  const destinatarios = new Set(vigentes.map((d) => d.delegate));
  let maximo = 0;
  for (const destinatario of destinatarios) {
    const representados = projectedRepresented(
      state.delegations,
      destinatario,
      desdeYa,
      config.delegation.maxDepth,
    );
    maximo = Math.max(maximo, representados.length + 1);
  }
  const tope = capWeight(config);
  const cargan = destinatarios.size;
  return {
    prestaron: vigentes.length,
    cargan,
    maximo,
    tope,
    comoEsta: comoEstaLaVoz(cargan, maximo, tope),
    devueltos: resolucion?.returnedByCap.length ?? 0,
  };
}

/**
 * Una votación con el estado de delegación de quien mira.
 *
 * `podesDelegarEn` llega ya filtrado por el servidor —integrantes del padrón congelado, sin quien
 * mira— porque una lista que incluyera a la propia persona ofrecería una acción que el dominio
 * rechaza con `SELF_DELEGATION`, y un desplegable que ofrece lo imposible es un error que la
 * interfaz produce y la persona paga.
 */
export function delegacionesDeDecisionDto(
  datos: DelegacionesDeUnaDecision,
  titulo: string,
  alias: ReadonlyMap<string, string>,
  quien: MemberId | undefined,
  at: number,
): DelegacionesDeDecision {
  const config = datos.config;
  if (config === undefined) {
    throw new Error('una votación abierta siempre tiene sus reglas congeladas');
  }
  const sePuedeDelegar = config.delegation.enabled && !datos.yaVote && datos.puedoDecidir;
  const porQueNo = !config.delegation.enabled
    ? 'Esta votación se abrió sin préstamo de voto: acá cada quien responde por sí mismo.'
    : !datos.puedoDecidir
      ? 'No estabas en la lista de quiénes podían decidir en esta votación, así que no hay voto ' +
        'que prestar.'
      : datos.yaVote
        ? 'Ya votaste. Tu voto manda sobre cualquier préstamo, así que no hace falta prestarlo.'
        : undefined;

  return {
    decisionId: datos.id,
    titulo,
    cierraEn: config.window.closesAt,
    sePuedeDelegar,
    ...(porQueNo === undefined ? {} : { porQueNo }),
    yaVote: datos.yaVote,
    ...(datos.miDelegacion === undefined
      ? {}
      : {
          miDelegacion: {
            id: datos.miDelegacion.delegationId,
            enQuien: alias.get(datos.miDelegacion.delegate) ?? 'Alguien que ya no está',
            desde: datos.miDelegacion.grantedAt,
            hasta: datos.miDelegacion.expiresAt,
          },
        }),
    podesDelegarEn: config.electorate.members
      .filter((miembro) => miembro.memberId !== quien)
      .map((miembro) => ({
        id: miembro.memberId,
        alias: alias.get(miembro.memberId) ?? 'Alguien que ya no está',
      }))
      .sort((a, b) => a.alias.localeCompare(b.alias, 'es-CO')),
    reparto: repartoDto(datos.state, config, datos.resolucion, at),
  };
}

export function panelDeDelegacionesDto(
  votaciones: readonly DelegacionesDeDecision[],
): PanelDeDelegaciones {
  return { comoFunciona: [...COMO_FUNCIONA_DELEGAR], votaciones: [...votaciones] };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Normas
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** «2 de cada 3» y no «0,667». Una fracción exacta dicha como la diría una persona. */
function comoProporcion(fraccion: { readonly num: bigint; readonly den: bigint }): string {
  return `${fraccion.num.toString()} de cada ${fraccion.den.toString()}`;
}

function requisitosEnPalabras(requisitos: ReformRequirements): readonly string[] {
  return [
    `${comoProporcion(requisitos.approvalOfCensus)} de todas las personas del padrón tiene que ` +
      'votar a favor. No de quienes voten: del padrón entero.',
    `Al menos ${comoProporcion(requisitos.minDirectParticipation)} tiene que votar en persona. ` +
      'Un voto prestado no cuenta para este mínimo.',
    `${String(requisitos.deliberationDays)} días de conversación antes de votar.`,
    `${String(requisitos.waitingDays)} días de espera entre el cierre y la entrada en vigor, para ` +
      'poder impugnarla.',
    `Firma de ${String(requisitos.guaranteeThreshold)} de las ` +
      `${String(requisitos.guaranteeCircleSize)} personas que cuidan las garantías. Sólo revisan ` +
      'que el procedimiento se haya cumplido, nunca el fondo.',
    `${comoProporcion(requisitos.sponsorSignatures)} del padrón tiene que firmar para abrirla.`,
    ...(requisitos.votesRequired > 1
      ? [
          `${String(requisitos.votesRequired)} votaciones distintas, separadas por al menos ` +
            `${String(requisitos.separationMonths)} meses. Un semestre dura más que una coyuntura: ` +
            'quien vota la segunda vez ya no es el mismo grupo.',
        ]
      : []),
  ];
}

/**
 * Las reglas, tal como están hoy.
 *
 * `hayNormas` sale en `false` y eso **no** es un hueco sin diseñar: es el estado real. El núcleo
 * intangible y los requisitos de cada vía sí son datos del dominio y se publican; lo que todavía no
 * existe es la copia versionada dentro de la plataforma, con su fecha y su decisión fundacional. Se
 * dice, con todas las letras, en vez de enseñar una versión 1 que nadie aprobó.
 */
export function normasDto(normas: NormasDelDespliegue): Normas {
  return {
    hayNormas: normas.fijadas,
    titulo: 'Las reglas del juego',
    descripcion:
      'Cómo se decide acá, qué decide cada grupo y qué no se decide nunca. Estas reglas no son ' +
      'opciones de un panel que alguien pueda cambiar por su cuenta: cambiar una exige el ' +
      'procedimiento que está más abajo, y quien administra la plataforma no puede tocarlas.',
    versionVigente: 0,
    versiones: [],
    nucleo: {
      titulo: 'Lo que no se puede cambiar por ninguna vía',
      explicacion:
        'Estas seis cosas no se reforman: ni con todos los votos, ni con todas las firmas, ni con ' +
        'todo el tiempo del mundo. Cambiar una no sería reformar Koinonía, sería fundar otra cosa, ' +
        'y el único camino honesto para eso es disolverla en público, entregar la historia entera y ' +
        'empezar de nuevo.',
      reglas: normas.nucleo.map((regla) => ({
        id: regla.id,
        titulo: regla.titulo,
        texto: regla.texto,
        irreformable: true,
      })),
    },
    vias: [
      {
        nombre: 'Cambiar una regla',
        paraQue: 'Para cambiar cualquiera de las reglas que no están en la lista de arriba.',
        requisitos: [...requisitosEnPalabras(normas.ordinaria)],
      },
      {
        nombre: 'Cambiar la regla de cambiar las reglas',
        paraQue:
          'Para cambiar el propio procedimiento de reforma. Es más difícil a propósito: si fuera ' +
          'igual de fácil, a quien tuviera una mayoría pasajera le bastaría con cambiar primero ' +
          'esta regla para volverse inamovible.',
        requisitos: [...requisitosEnPalabras(normas.atrincherada)],
      },
    ],
    reformasEnCurso: [],
    vedas: [],
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Historial
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Sobre qué es cada hecho. El nombre interno del agregado no se enseña nunca. */
const SOBRE_QUE: Readonly<Record<string, string>> = {
  problem: 'Un problema',
  proposal: 'Una propuesta',
  decision: 'Una votación',
  deliberation: 'Una conversación',
  initiative: 'Lo que se está haciendo',
  spine: 'La plataforma',
};

/**
 * Qué pasó, en una frase.
 *
 * La tabla es explícita y no se genera partiendo el nombre interno en palabras: `BallotCast` no es
 * «papeleta emitida», es «alguien respondió». Un nombre interno traducido a golpe de expresión
 * regular sigue siendo un nombre interno con espacios.
 */
const QUE_PASO: Readonly<Record<string, string>> = {
  LedgerAbierto: 'Se abrió el historial',
  AgregadoAbierto: 'Empezó a registrarse algo nuevo',
  CheckpointEmitido: 'Se selló el historial hasta acá',
  ProblemOpened: 'Alguien escribió un problema',
  EvidenceAttached: 'Alguien aportó algo que lo sostiene',
  EvidenceRetracted: 'Se retiró un aporte',
  MeTooRecorded: 'A alguien más le pasa lo mismo',
  ProposalDrafted: 'Se escribió una propuesta',
  ProposalAmended: 'Se corrigió una propuesta',
  DecisionLinked: 'Una propuesta se llevó a votación',
  DecisionDrafted: 'Se preparó una votación',
  DecisionOpened: 'Se abrió una votación',
  BallotCast: 'Alguien respondió',
  DecisionClosed: 'Se cerró una votación',
  ResultRecorded: 'Se publicó un resultado',
  DecisionRatified: 'Se confirmó una decisión',
  DelegationGranted: 'Alguien le prestó su voto a otra persona',
  DelegationRevoked: 'Alguien recuperó su voto',
  RoundOpened: 'Se abrió otra vuelta de la votación',
  ObjectionIntegrated: 'Se atendió una objeción',
  DeliberationOpened: 'Empezó una conversación',
  ContributionSubmitted: 'Se escribió un aporte',
  StageAdvanced: 'La conversación pasó a otra etapa',
  InitiativeCreated: 'Se abrió lo que hay que hacer',
  InitiativeActivated: 'Empezó a ejecutarse una decisión',
  MilestonePlanned: 'Se puso una fecha de avance',
  TaskOffered: 'Se le ofreció una tarea a alguien',
  TaskAccepted: 'Alguien aceptó una tarea',
  TaskRejected: 'Alguien no pudo tomar una tarea',
  TaskStarted: 'Empezó una tarea',
  TaskBlocked: 'Una tarea quedó trabada',
  TaskHelpRequested: 'Alguien pidió ayuda con una tarea',
  TaskResumed: 'Se retomó una tarea',
  TaskEvidenceAdded: 'Se sumó una prueba de lo hecho',
  TaskDelivered: 'Se entregó una tarea',
  TaskChangesRequested: 'Se pidieron cambios en una entrega',
  TaskReviewAccepted: 'Se aceptó una entrega',
  TaskReoffered: 'Una tarea pasó a otra persona',
};

export function historialDto(leido: HistorialLeido): Historial {
  return {
    total: leido.total,
    ...(leido.desde === undefined ? {} : { desde: leido.desde }),
    ...(leido.hasta === undefined ? {} : { hasta: leido.hasta }),
    hechos: leido.hechos.map((hecho) => {
      const enlace = enlaceDelHecho(hecho.tipoDeAgregado, hecho.agregado);
      return {
        numero: hecho.numero,
        cuando: hecho.cuando,
        // Un tipo que esta tabla no conozca no se enseña con su nombre interno: se dice que quedó
        // registrado. Es verdad, no es jerga, y no obliga a que la tabla esté completa para que la
        // pantalla sea correcta.
        que: QUE_PASO[hecho.tipo] ?? 'Quedó registrado algo',
        sobre: SOBRE_QUE[hecho.tipoDeAgregado] ?? 'La plataforma',
        ...(enlace === undefined ? {} : { enlace }),
      };
    }),
    hayMas: leido.hayMas,
  };
}

/** Adónde lleva un hecho, si hay pantalla que lo muestre. Sin pantalla, no hay enlace roto. */
function enlaceDelHecho(tipoDeAgregado: string, agregado: string): string | undefined {
  switch (tipoDeAgregado) {
    case 'problem':
      return `/problemas/${agregado}`;
    case 'proposal':
      return `/propuestas/${agregado}`;
    case 'decision':
      return `/decisiones/${agregado}`;
    case 'deliberation':
      return `/deliberaciones/${agregado}`;
    case 'initiative':
      return `/iniciativas/${agregado}`;
    default:
      return undefined;
  }
}
