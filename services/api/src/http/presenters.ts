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
  DecisionResult,
  DecisionState,
  MemberId,
  Outcome,
  ProblemState,
  ProposalState,
  ProposalVersion,
} from '@koinonia/domain';
import type {
  DecisionDetalle,
  DecisionResumen,
  Desenlace,
  Evidencia,
  PasoTraza,
  ProblemaDetalle,
  ProblemaResumen,
  PropuestaDetalle,
  PropuestaResumen,
  ResultadoDecision,
  TablaTraza,
  VersionPropuesta,
} from '@koinonia/contracts';
import { DESENLACE_EN_PALABRAS } from '@koinonia/contracts';

import { queHaceFaltaParaQuePase, type MetodoSoportado } from './service.js';

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
    ...(version.rationale === undefined ? {} : { motivo: version.rationale }),
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
  }
}

export function decisionDetalleDto(
  id: string,
  state: DecisionState,
  titulo: string,
  cuerpo: string,
  quien: MemberId | undefined,
): DecisionDetalle {
  const config = state.config;
  const enPadron =
    quien !== undefined && (config?.electorate.members.some((m) => m.memberId === quien) ?? false);
  const respuesta = quien === undefined ? undefined : miRespuestaEnPalabras(state, quien);
  return {
    ...decisionResumenDto(id, state, titulo),
    cuerpoVersion: cuerpo,
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

function desenlaceDe(outcome: Outcome): Desenlace {
  return outcome.kind;
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
  return { id: step.id, explicacion: step.claim, datos };
}

function tablaDto(tabla: DecisionResult['proof']['tables'][number]): TablaTraza {
  return {
    titulo: tabla.title,
    columnas: [...tabla.columns],
    filas: tabla.rows.map((fila) => [...fila]),
  };
}

export function resultadoDto(resultado: DecisionResult): ResultadoDecision {
  return {
    decisionId: resultado.decisionId,
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
