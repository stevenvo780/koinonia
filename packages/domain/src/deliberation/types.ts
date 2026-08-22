/**
 * Deliberación estructurada: identificadores, aportes tipados y eventos.
 *
 * ═══ Qué es una etapa aquí ═══
 *
 * Una etapa **no** es una pestaña de la interfaz: es una ventana de escritura real. Mientras el
 * agregado está en `perspectivas` no se pueden añadir riesgos, y cuando la ventana vence no se puede
 * añadir nada de esa etapa **aunque el evento de avance todavía no se haya escrito**. La etiqueta de
 * UI que sólo cambia el color del encabezado es exactamente el fallo que este módulo no comete: si
 * la etapa no restringe qué se puede escribir, la deliberación por fases es decorativa.
 *
 * ═══ Por qué los aportes son un grafo y no una lista ═══
 *
 * Un hilo plano de comentarios pierde la única información que hace revisable una deliberación: qué
 * sostiene qué. Aquí cada aporte declara su arista —una `razon` sostiene una `posicion`, una
 * `evidencia` sostiene una `razon`, un `riesgo` ataca una `alternativa`— y esa arista se valida
 * contra el tipo del destino. Un aporte que no sabe a qué responde no entra.
 *
 * Toda referencia apunta a un aporte con `seq` **estrictamente menor** (ver `graph.ts`). Eso hace el
 * grafo acíclico por construcción y no por comprobación posterior: no hay ninguna secuencia de
 * eventos legales que produzca un ciclo, así que no hace falta un detector que alguien pueda
 * olvidarse de llamar.
 *
 * ═══ Corregir es añadir, nunca sobrescribir ═══
 *
 * `supersedesContributionId` marca que un aporte reemplaza a otro. El original **permanece** en el
 * historial con su autoría, su instante y su hash, igual que una versión de propuesta. Un historial
 * donde las correcciones borran el original no es un historial: es el estado actual con fecha.
 */

import { InvalidIdError, PreconditionError } from '../errors.js';
import {
  type Brand,
  type CircleId,
  type Hash,
  ID_PATTERN,
  type Instant,
  type MemberId,
} from '../ids.js';
import type { ChainedEvent, ChainedLog } from '../workspace/chain.js';
import { assertLedgerText, MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from '../workspace/text.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Identificadores
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Identificador opaco de una deliberación. Mismo formato que todo identificador del sistema (R2). */
export type DeliberationId = Brand<string, 'DeliberationId'>;
/** Identificador opaco de un aporte. Es la clave de las aristas del grafo. */
export type ContributionId = Brand<string, 'ContributionId'>;
/**
 * 128 bits de la apertura del compromiso de autoría. **Entra como dato**: el dominio no produce
 * aleatoriedad (ADR-0001), igual que no lee relojes.
 */
export type AuthorNonce = Brand<string, 'AuthorNonce'>;
/**
 * 128 bits secretos por deliberación. Viven fuera del ledger hasta la revelación: sin ellos el
 * seudónimo público no admite ataques de diccionario sobre el padrón.
 */
export type DeliberationNonce = Brand<string, 'DeliberationNonce'>;
/**
 * 128 bits que fijan el orden de presentación de una etapa. Entra como dato en el evento que abre la
 * etapa, para que el orden sea recomputable por cualquiera que lea el historial.
 */
export type PresentationSeed = Brand<string, 'PresentationSeed'>;

const OPAQUE = '32 caracteres hexadecimales en minúscula';

function assertOpaque(kind: string, value: string): void {
  if (!ID_PATTERN.test(value)) throw new InvalidIdError(kind, value, OPAQUE);
}

export function deliberationId(value: string): DeliberationId {
  assertOpaque('DeliberationId', value);
  return value as DeliberationId;
}

export function contributionId(value: string): ContributionId {
  assertOpaque('ContributionId', value);
  return value as ContributionId;
}

export function authorNonce(value: string): AuthorNonce {
  assertOpaque('AuthorNonce', value);
  return value as AuthorNonce;
}

export function deliberationNonce(value: string): DeliberationNonce {
  assertOpaque('DeliberationNonce', value);
  return value as DeliberationNonce;
}

export function presentationSeed(value: string): PresentationSeed {
  assertOpaque('PresentationSeed', value);
  return value as PresentationSeed;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Etapas
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Las siete ventanas de escritura, en el único orden en que pueden recorrerse.
 *
 * `perspectivas_revelando` y `listo_para_decidir` **no admiten ningún aporte**: la primera existe
 * para destapar la autoría de lo escrito a ciegas, y la segunda es terminal.
 */
export type DeliberationStage =
  | 'preguntas_aclaratorias'
  | 'perspectivas'
  | 'perspectivas_revelando'
  | 'construccion_alternativas'
  | 'objeciones'
  | 'enmiendas'
  | 'listo_para_decidir';

export const DELIBERATION_STAGES: readonly DeliberationStage[] = [
  'preguntas_aclaratorias',
  'perspectivas',
  'perspectivas_revelando',
  'construccion_alternativas',
  'objeciones',
  'enmiendas',
  'listo_para_decidir',
];

/** Cómo se avanzó de etapa: por decisión de quien facilita, o porque la ventana venció. */
export type StageAdvanceCause = 'manual' | 'deadline';

export const STAGE_ADVANCE_CAUSES: readonly StageAdvanceCause[] = ['manual', 'deadline'];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Aportes tipados
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type ContributionKind =
  'posicion' | 'razon' | 'evidencia' | 'supuesto' | 'riesgo' | 'alternativa';

export const CONTRIBUTION_KINDS: readonly ContributionKind[] = [
  'posicion',
  'razon',
  'evidencia',
  'supuesto',
  'riesgo',
  'alternativa',
];

/**
 * Preguntar y afirmar no son el mismo acto y no se mezclan en la misma ventana: en
 * `preguntas_aclaratorias` sólo cabe `pregunta_aclaratoria`, y en `perspectivas` sólo `afirmacion`.
 */
export type PositionMode = 'pregunta_aclaratoria' | 'afirmacion';

export const POSITION_MODES: readonly PositionMode[] = ['pregunta_aclaratoria', 'afirmacion'];

/** Una razón o responde a una pregunta, o sostiene una afirmación. Nunca las dos cosas. */
export type ReasonRelation = 'responde' | 'sostiene';

export const REASON_RELATIONS: readonly ReasonRelation[] = ['responde', 'sostiene'];

/** Gravedad declarada de un riesgo, de 1 a 5. Sin valor por defecto: hay que decirlo. */
export type RiskSeverity = 1 | 2 | 3 | 4 | 5;

export const RISK_SEVERITIES: readonly RiskSeverity[] = [1, 2, 3, 4, 5];

/** Mínimo de caracteres de un aporte. Menos que eso es una reacción, no un aporte (PRODUCT §3). */
export const MIN_CONTRIBUTION_LENGTH = 20;

export interface PositionBody {
  readonly kind: 'posicion';
  readonly mode: PositionMode;
  readonly text: string;
}

export interface ReasonBody {
  readonly kind: 'razon';
  readonly relation: ReasonRelation;
  /** Arista obligatoria: toda razón sostiene o responde a una `posicion` concreta. */
  readonly positionId: ContributionId;
  readonly text: string;
}

export interface EvidenceBody {
  readonly kind: 'evidencia';
  /** Arista obligatoria: la evidencia respalda una `razon`, no una opinión suelta. */
  readonly supportsReasonId: ContributionId;
  readonly text: string;
  readonly source?: string | undefined;
}

export interface AssumptionBody {
  readonly kind: 'supuesto';
  /** Arista obligatoria y **no vacía**: un supuesto que no se aplica a nada no es un supuesto. */
  readonly appliesToContributionIds: readonly ContributionId[];
  readonly text: string;
}

export interface RiskBody {
  readonly kind: 'riesgo';
  /** Arista obligatoria: un riesgo es siempre riesgo *de una alternativa*. */
  readonly alternativeId: ContributionId;
  readonly severity: RiskSeverity;
  readonly impact: string;
  readonly mitigation: string;
}

export interface AlternativeBody {
  readonly kind: 'alternativa';
  /** El problema que la alternativa dice resolver. «No se propone sin problema» (PRODUCT §4). */
  readonly problemId: string;
  /** De qué posiciones sale. **No vacío**: una alternativa sin origen no la sostiene nadie. */
  readonly sourcePositionIds: readonly ContributionId[];
  readonly text: string;
}

export type ContributionBody =
  PositionBody | ReasonBody | EvidenceBody | AssumptionBody | RiskBody | AlternativeBody;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Autoría
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Autoría sellada: en el evento sólo viaja el compromiso.
 *
 * `authorId`, `nonce` y `deliberationNonce` **no están aquí y no pueden estarlo**: el evento es
 * público en el historial y un campo «oculto por la interfaz» no oculta nada. Ver `authorship.ts`.
 */
export interface SealedAuthorship {
  readonly mode: 'sealed';
  readonly authorCommitment: Hash;
  /** Atribución estable sólo dentro de esta deliberación; no identifica al autor. */
  readonly authorPseudonym: Hash;
}

/** Autoría pública: el autor viaja en claro, como en el resto de los agregados de trabajo. */
export interface PublicAuthorship {
  readonly mode: 'public';
  readonly authorId: MemberId;
}

export type Authorship = SealedAuthorship | PublicAuthorship;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Eventos
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type DeliberationPayload =
  | {
      readonly type: 'DeliberationOpened';
      readonly problemId: string;
      readonly circleId: CircleId;
      /** Redundante a propósito: fija en el evento la etapa que abre, para poder cotejarla. */
      readonly stage: 'preguntas_aclaratorias';
      readonly opensAt: Instant;
      readonly closesAt: Instant;
      readonly presentationSeed: PresentationSeed;
      /**
       * Límite persistido para que el replay aplique la misma política que la orden. El valor por
       * defecto es 10: permite un hilo breve de argumentos sin dejar la etapa sin cota.
       */
      readonly maxContributionsPerAuthorPerStage: number;
    }
  | {
      readonly type: 'ContributionSubmitted';
      readonly contributionId: ContributionId;
      /** La etapa en la que se escribió. El replay comprueba que coincide con la del agregado. */
      readonly stage: DeliberationStage;
      readonly body: ContributionBody;
      readonly authorship: Authorship;
      readonly supersedesContributionId?: ContributionId | undefined;
    }
  | {
      readonly type: 'ContributionAuthorRevealed';
      readonly contributionId: ContributionId;
      readonly authorId: MemberId;
      readonly nonce: AuthorNonce;
      /** Se publica sólo al destapar la autoría para comprobar también el seudónimo. */
      readonly deliberationNonce: DeliberationNonce;
    }
  | {
      readonly type: 'StageAdvanced';
      readonly from: DeliberationStage;
      readonly to: DeliberationStage;
      readonly cause: StageAdvanceCause;
      readonly opensAt: Instant;
      readonly closesAt: Instant;
      readonly presentationSeed: PresentationSeed;
    };

export type DeliberationEvent = ChainedEvent<DeliberationPayload>;
export type DeliberationLog = ChainedLog<DeliberationPayload>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Estado
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface ContributionRecord {
  readonly contributionId: ContributionId;
  readonly stage: DeliberationStage;
  readonly body: ContributionBody;
  readonly authorship: Authorship;
  readonly supersedesContributionId: ContributionId | undefined;
  readonly submittedAt: Instant;
  /** Posición en la cadena. Toda referencia de este aporte apunta a un `seq` menor que éste. */
  readonly seq: number;
  /** Autoría destapada; `undefined` mientras el compromiso siga sellado. */
  readonly revealedAuthorId: MemberId | undefined;
  /** Apertura publicada en la revelación. Permite a cualquiera recomputar el compromiso. */
  readonly revealedNonce: AuthorNonce | undefined;
}

export interface DeliberationState {
  readonly deliberationId: DeliberationId;
  readonly exists: boolean;
  readonly problemId: string | undefined;
  readonly circleId: CircleId | undefined;
  readonly stage: DeliberationStage;
  /** Ventana de escritura **vigente**. La etapa no es una etiqueta: es este par de instantes. */
  readonly opensAt: Instant | undefined;
  readonly closesAt: Instant | undefined;
  readonly presentationSeed: PresentationSeed | undefined;
  readonly maxContributionsPerAuthorPerStage: number | undefined;
  readonly contributions: readonly ContributionRecord[];
  readonly lastSeq: number;
}

export function initialDeliberationState(id: DeliberationId): DeliberationState {
  return {
    deliberationId: id,
    exists: false,
    problemId: undefined,
    circleId: undefined,
    stage: 'preguntas_aclaratorias',
    opensAt: undefined,
    closesAt: undefined,
    presentationSeed: undefined,
    maxContributionsPerAuthorPerStage: undefined,
    contributions: [],
    lastSeq: 0,
  };
}

/** El aporte con ese identificador, o `undefined`. */
export function findContribution(
  state: DeliberationState,
  id: ContributionId,
): ContributionRecord | undefined {
  return state.contributions.find((c) => c.contributionId === id);
}

/** Aportes sellados que todavía no destaparon su autoría. */
export function unrevealedContributions(state: DeliberationState): readonly ContributionRecord[] {
  return state.contributions.filter(
    (c) => c.authorship.mode === 'sealed' && c.revealedAuthorId === undefined,
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Validación de forma del aporte (texto y campos propios; las aristas están en `graph.ts`)
// ═════════════════════════════════════════════════════════════════════════════════════════════

function assertBodyText(text: string, field: string): void {
  assertLedgerText(text, { field, min: MIN_CONTRIBUTION_LENGTH, max: MAX_BODY_LENGTH });
}

/**
 * Comprueba lo que un aporte declara de sí mismo: textos normalizados y dentro de rango, gravedad en
 * el vocabulario cerrado, listas de aristas no vacías. **No** mira si los destinos existen: eso es
 * `graph.ts`, porque exige el estado.
 */
export function assertContributionBody(body: ContributionBody): void {
  switch (body.kind) {
    case 'posicion': {
      if (!POSITION_MODES.includes(body.mode)) {
        throw new PreconditionError(
          'INVALID_POSITION_MODE',
          'una posición o pregunta aclaratoria o afirma; no hay un tercer modo',
        );
      }
      assertBodyText(body.text, 'la posición');
      return;
    }
    case 'razon': {
      if (!REASON_RELATIONS.includes(body.relation)) {
        throw new PreconditionError(
          'INVALID_REASON_RELATION',
          'una razón o responde a una pregunta o sostiene una afirmación',
        );
      }
      assertBodyText(body.text, 'la razón');
      return;
    }
    case 'evidencia': {
      assertBodyText(body.text, 'la evidencia');
      if (body.source !== undefined) {
        assertLedgerText(body.source, { field: 'la fuente', min: 1, max: MAX_TITLE_LENGTH });
      }
      return;
    }
    case 'supuesto': {
      if (body.appliesToContributionIds.length === 0) {
        throw new PreconditionError(
          'ASSUMPTION_WITHOUT_TARGET',
          'un supuesto que no se aplica a ningún aporte no es un supuesto: es una frase suelta',
        );
      }
      assertBodyText(body.text, 'el supuesto');
      return;
    }
    case 'riesgo': {
      if (!RISK_SEVERITIES.includes(body.severity)) {
        throw new PreconditionError(
          'INVALID_RISK_SEVERITY',
          'la gravedad de un riesgo es un entero de 1 a 5 y no tiene valor por defecto',
        );
      }
      assertBodyText(body.impact, 'el impacto del riesgo');
      assertBodyText(body.mitigation, 'la mitigación del riesgo');
      return;
    }
    case 'alternativa': {
      if (!ID_PATTERN.test(body.problemId)) {
        throw new InvalidIdError('ProblemId', body.problemId, OPAQUE);
      }
      if (body.sourcePositionIds.length === 0) {
        throw new PreconditionError(
          'ALTERNATIVE_WITHOUT_SOURCE',
          'una alternativa sale de posiciones concretas; sin origen no la sostiene nadie',
        );
      }
      assertBodyText(body.text, 'la alternativa');
      return;
    }
  }
}
