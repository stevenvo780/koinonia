/**
 * `DecisionConfig` — las reglas del juego, congeladas y hasheadas (A.5).
 *
 * Todo lo que puede cambiar el resultado de una decisión vive aquí, se congela al abrir y queda
 * anclado en `configHash`. DECISIÓN A.7: `configHash` incluye `engineVersion`, de modo que una
 * decisión abierta bajo el motor 30.0.0 se re-escruta siempre con 30.0.0 aunque el servidor ya corra
 * 31.x. «Las reglas no se cambian a mitad del partido» es un principio de legitimidad y, además, la
 * única forma de que la reproducibilidad histórica sobreviva a un refactor.
 *
 * La inmutabilidad no es sólo de tipos: `buildDecisionConfig` congela el objeto en profundidad con
 * `Object.freeze`. `readonly` es una promesa del compilador y desaparece en tiempo de ejecución;
 * `Object.freeze` es un hecho.
 */

import { deepFreeze, hashCanonical, type JsonObject, type JsonValue } from './canonical.js';
import { type ConfigRejection, HardSecrecyUnsupported, InvalidConfigError } from './errors.js';
import { circleSize, type Electorate, membersOfCircle } from './electorate.js';
import { type Fraction, isProperFraction, ZERO } from './fraction.js';
import type {
  CircleId,
  DecisionId,
  DelegationId,
  Hash,
  Instant,
  InitiativeId,
  MemberId,
  OptionId,
  ProposalId,
  StratumKey,
  TopicId,
} from './ids.js';
import { isStrictlySorted } from './ids.js';

/** Versión del motor. Cambiar un algoritmo de escrutinio obliga a subirla (A.7). */
export const ENGINE_VERSION = '30.0.0';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Método
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Qué se hace con las abstenciones **explícitas** al calcular el umbral.
 *
 * DECISIÓN B.1.a: `abstentionPolicy` y `base` son obligatorios y sin valor por defecto en el tipo.
 * La disputa post-electoral en una asamblea estudiantil es casi siempre sobre el denominador, no
 * sobre los votos; fijarlo antes y mostrarlo en la papeleta elimina la disputa.
 */
export type AbstentionPolicy =
  /** La abstención NO entra en el denominador del umbral. Es el default institucional (B.1.b). */
  | 'exclude'
  /** La abstención entra en el denominador ⇒ abstenerse equivale a votar «no». */
  | 'include'
  /** La abstención se computa como voto negativo. Sólo por mandato estatutario. */
  | 'as-no';

export type ThresholdBase =
  /** Sobre papeletas computables (`V`). */
  | 'cast'
  /** Sobre el censo congelado (`N`). Sólo para actos constituyentes (B.2.a). */
  | 'census'
  /** Sobre quienes asistieron a la sesión sincrónica. Requiere un registro previo (B.2.b). */
  | 'present';

export type TieBreakRule =
  | 'more-first-preferences'
  | 'more-approvals'
  | 'higher-median'
  | 'fewer-rejections'
  | 'pairwise-head-to-head'
  | 'higher-mean'
  | 'fewer-zeros'
  | 'more-fives'
  | 'fewer-first-preferences-in-previous-rounds'
  | 'more-excellent'
  | 'fewer-reject'
  | 'more-pairwise-wins'
  | 'higher-min-margin'
  | 'earlier-proposal'
  | 'public-seed-lot'
  | 'lexicographic-hash';

/**
 * Cascada de desempate. Se evalúa en orden; la primera regla que discrimina, decide.
 * La última instancia es SIEMPRE e implícitamente `lexicographic-hash`, que es un orden total
 * estricto ⇒ la cascada nunca puede fallar (B.0.2, INV-13).
 */
export interface TieBreakPolicy {
  readonly cascade: readonly TieBreakRule[];
}

/** Admisibilidad de las objeciones sociocráticas (B.3.a). */
export interface ObjectionAdmissibilityConfig {
  /** Tamaño del panel. Impar. Default 3. */
  readonly panelSize: number;
  /** Fracción del panel necesaria para DESESTIMAR. Default 2/3. */
  readonly dismissThreshold: Fraction;
  /** El panel se sortea con la semilla pública entre miembros del círculo. */
  readonly panelSelection: 'sortition';
  /** Plazo del panel, en ms. Vencido sin pronunciamiento ⇒ la objeción queda ADMITIDA. */
  readonly panelDeadline: number;
}

/** Identificador de una mención verbal. El orden semántico vive en `GradeScale.grades`. */
export type GradeId = string & { readonly __marca: 'GradeId' };

export interface GradeScale {
  /** De mejor a peor. Longitud entre 3 y 7. */
  readonly grades: readonly { readonly id: GradeId; readonly label: string }[];
}

/**
 * Métodos de escrutinio del motor 30.
 */
export type DecisionMethod =
  | {
      readonly kind: 'simple-majority';
      readonly abstentionPolicy: AbstentionPolicy;
      readonly base: ThresholdBase;
      readonly tieBreak: TieBreakPolicy;
    }
  | {
      readonly kind: 'supermajority';
      readonly fraction: Fraction;
      /** `true` ⇒ `>` ; `false` ⇒ `≥`. Default `false` para supermayorías (B.2.c). */
      readonly strict: boolean;
      readonly base: ThresholdBase;
      readonly abstentionPolicy: AbstentionPolicy;
      readonly tieBreak: TieBreakPolicy;
    }
  | {
      readonly kind: 'unanimity';
      readonly base: Extract<ThresholdBase, 'cast' | 'census'>;
      /** ¿La abstención rompe la unanimidad? */
      readonly abstentionBlocks: boolean;
    }
  | {
      readonly kind: 'sociocratic-consent';
      /** ≥1, default 3, tope duro 5 (B.3.c). */
      readonly maxRounds: number;
      readonly admissibility: ObjectionAdmissibilityConfig;
      /** Default `'not-participating'`: el silencio NO consiente (B.3.e). */
      readonly silenceMeans: 'consent' | 'not-participating';
      /** Fracción del círculo que debe manifestarse. Default 1/2. */
      readonly minEngagement: Fraction;
    }
  | {
      readonly kind: 'score';
      readonly min: 0;
      readonly max: 5;
      /** B.5: la mediana ponderada es la agregación normativa. */
      readonly aggregator: 'median';
      /** B.5.a: `null` es falta de opinión y queda fuera de numerador y denominador. */
      readonly noOpinionPolicy: 'ignore';
      readonly minCoverage: Fraction;
      readonly tieBreak: TieBreakPolicy;
    }
  | {
      readonly kind: 'irv';
      readonly exhaustedPolicy: 'reduce-quota' | 'fixed-quota';
      readonly eliminationTieBreak: TieBreakPolicy;
      readonly allowTruncation: boolean;
      readonly tieBreak: TieBreakPolicy;
    }
  | {
      readonly kind: 'majority-judgment';
      readonly scale: GradeScale;
      readonly missingGradePolicy: 'worst' | 'reject-ballot';
      readonly tieBreak: TieBreakPolicy;
    }
  | {
      readonly kind: 'condorcet-schulze';
      readonly allowTruncation: boolean;
      /** B.8.b: las omitidas empatan en último lugar; nunca se inventa un orden entre ellas. */
      readonly truncatedMeans: 'tied-last';
      readonly tieBreak: TieBreakPolicy;
    }
  | {
      readonly kind: 'deliberative-sortition';
      readonly sampleSize: number;
      readonly strata: readonly StratumKey[];
      readonly allocation: 'proportional' | 'equal';
      readonly seedCommitment: Hash;
    };

export type DecisionMethodKind = DecisionMethod['kind'];

/** Los métodos de umbral, que comparten `passesThreshold` (B.0.4). */
export type ThresholdMethod = Extract<
  DecisionMethod,
  { kind: 'simple-majority' | 'supermajority' | 'unanimity' }
>;

export function isThresholdMethod(method: DecisionMethod): method is ThresholdMethod {
  return (
    method.kind === 'simple-majority' ||
    method.kind === 'supermajority' ||
    method.kind === 'unanimity'
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Privacidad, quórum, ventana, delegación
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type PrivacyMode =
  /** Voto nominal público en tiempo real. Rendición de cuentas máxima. */
  | 'public-roll-call'
  /** Papeletas selladas hasta el cierre; al cerrar se publica el detalle seudónimo. */
  | 'sealed-tally'
  /** Secreto perpetuo frente a todos, incluida la administración. **Rechazado por la compuerta C6.** */
  | 'secret-ballot';

export interface QuorumConfig {
  /** Participación mínima: personas representadas sobre `N` (D.1.1). */
  readonly participation: Fraction;
  /** Piso absoluto de apoyo sobre el censo, independiente del umbral del método (D.1.2). */
  readonly approvalOfCensus?: Fraction;
  /** Fracción de `N` que debe haber votado **directamente** (D.1.b). */
  readonly minDirectParticipation?: Fraction;
  /** Participación mínima exigida DENTRO de cada círculo listado (D.1.3). */
  readonly perCircle?: readonly { readonly circleId: CircleId; readonly min: Fraction }[];
  readonly onFailure: 'reject' | 'extend' | 'escalate';
  /** ≥0, default 1, tope duro 2 (D.2.a). */
  readonly maxExtensions: number;
  /** Duración de cada prórroga, en ms. */
  readonly extensionDuration: number;
}

export interface EarlyCloseConfig {
  readonly enabled: boolean;
  readonly mode: 'mathematically-irreversible' | 'full-turnout' | 'never';
}

export interface WindowConfig {
  readonly opensAt: Instant;
  /** **Exclusivo**: una papeleta es válida ⟺ `castAt < closesAt` (D.3.b). */
  readonly closesAt: Instant;
  /** Sólo para renderizar; el motor trabaja con `Instant` UTC (D.3.a). */
  readonly timezone: 'America/Bogota';
  readonly earlyClose: EarlyCloseConfig;
  /** Ventana de impugnación tras el cierre, antes de ratificar. ms. Default 72 h. */
  readonly challengeWindow: number;
}

/** Ámbito de una delegación. La especificidad crece hacia abajo (C.1). */
export type DelegationScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'circle'; readonly circleId: CircleId }
  | { readonly kind: 'topic'; readonly topicId: TopicId };

export interface Delegation {
  readonly delegationId: DelegationId;
  readonly delegator: MemberId;
  readonly delegate: MemberId;
  readonly scope: DelegationScope;
  readonly grantedAt: Instant;
  readonly expiresAt: Instant;
  readonly revokedAt?: Instant;
  readonly grantedSeq: number;
}

/**
 * Punto de extensión de la democracia líquida (PARTE C).
 *
 * DECISIÓN: el tipo existe completo y el motor lo transporta, pero `enabled: true` se **rechaza** en
 * esta entrega con `DELEGATION_NOT_IMPLEMENTED`. Aceptarlo y no resolverlo sería exactamente el
 * fallo ingenuo que INV-32 describe —«desactivar la delegación en silencio»—, con el que alguien
 * cree que su delegado vota por él y su voto simplemente no existe. Fallar cerrado y decirlo.
 * El punto de extensión real es `WeightResolver` en `tally/common.ts`: cuando la PARTE C entre, el
 * quórum, el escrutinio y los índices de concentración ya están escritos sobre pesos y sobre `E`.
 */
export interface DelegationConfig {
  readonly enabled: boolean;
  /** Profundidad máxima de la cadena, en ARISTAS. Default 4. */
  readonly maxDepth: number;
  /** Tope de poder por delegado, como fracción del CENSO. Default 1/10. */
  readonly cap: Fraction;
  readonly overflowPolicy: 'return-to-delegator';
  /** Vigencia máxima al conceder, en ms. Default ≈ un semestre. */
  readonly maxValidity: number;
  readonly brokenChainNotice: number;
  readonly lastWordWindow: number;
}

/**
 * Actos constituyentes: los únicos que admiten `base: 'census'` (B.2.a).
 *
 * DECISIÓN: la especificación exige rechazar `base:'census'` fuera de estos tres casos pero **no
 * define ningún campo que permita distinguirlos**. Se añade este campo explícito: sin él, la regla
 * no es verificable por el motor y quedaría como una nota de estilo. Reportado como hueco de la
 * especificación.
 */
export type ConstituentAct = 'reform-student-statute' | 'revoke-mandate' | 'dissolve-circle';

/**
 * Borrador mínimo que crea la decisión en `Draft`.
 *
 * DECISIÓN: A.7 lista `DecisionDrafted { draft: DraftConfig }` pero **nunca define `DraftConfig`**.
 * Se define aquí con lo mínimo imprescindible para que el borrador identifique el asunto: la
 * propuesta, la versión exacta de su texto y un resumen legible. Sin datos personales. Reportado.
 */
export interface DraftConfig {
  readonly proposalId: ProposalId;
  readonly proposalVersionHash: Hash;
  /** Identificador opaco reservado para la iniciativa si el resultado queda aprobado. */
  readonly plannedInitiativeId?: InitiativeId;
  /** Plan exacto que las personas ven junto con esta version de la propuesta. */
  readonly executionPlanHash?: Hash;
  /** Resumen legible del asunto. Sin datos personales. */
  readonly summary: string;
}

export interface DecisionConfig {
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  /** Hash de la versión EXACTA del texto sometido a decisión (A.6). */
  readonly proposalVersionHash: Hash;
  readonly circleId: CircleId;
  /** Etiquetas temáticas, para resolver delegaciones por tema. Estrictamente ordenadas. */
  readonly topics: readonly TopicId[];
  /** Estrictamente ordenadas; ≥1. */
  readonly options: readonly OptionId[];
  readonly electorate: Electorate;
  readonly method: DecisionMethod;
  readonly quorum: QuorumConfig;
  readonly window: WindowConfig;
  readonly privacy: PrivacyMode;
  readonly delegation: DelegationConfig;
  /** Commit de la semilla pública, publicado ANTES de `opensAt` (B.0.3). */
  readonly seedCommitment: Hash;
  /** Presente ⟺ el asunto es constituyente. Habilita `base: 'census'` (B.2.a). */
  readonly constituentAct?: ConstituentAct;
  /**
   * Decisión previa que autorizó usar `unanimity` para este caso concreto (B.4.a).
   *
   * DECISIÓN: B.4.a exige esa autorización previa pero, igual que con `constituentAct`, no define
   * ningún campo donde conste. Sin él la regla no sería verificable por el motor. Reportado.
   */
  readonly unanimityAuthorizedBy?: DecisionId;
  /** Decisión a la que ésta sustituye (reapertura prohibida ⇒ decisión nueva; A.8.2.1). */
  readonly supersedes?: DecisionId;
  /** Identidad criptográfica de las reglas del juego. */
  readonly configHash: Hash;
  readonly engineVersion: string;
}

/** `DecisionConfig` sin su propio hash: lo que se le pasa a `buildDecisionConfig`. */
export type DecisionConfigDraft = Omit<DecisionConfig, 'configHash'>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Valores por defecto institucionales
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** DECISIÓN B.0.2: la cascada termina siempre en `lexicographic-hash`, imparcial en el tiempo. */
export const DEFAULT_TIE_BREAK: TieBreakPolicy = { cascade: ['lexicographic-hash'] };

/** DECISIÓN D.4.a: el cierre anticipado está DESHABILITADO por defecto. */
export const DEFAULT_EARLY_CLOSE: EarlyCloseConfig = { enabled: false, mode: 'never' };

/** DECISIÓN D.2.a: una prórroga; la tercera convocatoria es terquedad. */
export const MAX_EXTENSIONS_HARD_CAP = 2;
/** DECISIÓN B.3.c: tres rondas por defecto, cinco como tope duro. */
export const MAX_ROUNDS_HARD_CAP = 5;
/** Ventana de impugnación por defecto: 72 h. */
export const DEFAULT_CHALLENGE_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Delegación apagada: la única configuración aceptable mientras la PARTE C no esté implementada. */
export const DELEGATION_DISABLED: DelegationConfig = {
  enabled: false,
  maxDepth: 4,
  cap: { num: 1n, den: 10n },
  overflowPolicy: 'return-to-delegator',
  maxValidity: 180 * 24 * 60 * 60 * 1000,
  brokenChainNotice: 24 * 60 * 60 * 1000,
  lastWordWindow: 0,
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Preimagen canónica y hash
// ═════════════════════════════════════════════════════════════════════════════════════════════

function canonicalMethod(method: DecisionMethod): JsonObject {
  switch (method.kind) {
    case 'simple-majority':
      return {
        kind: method.kind,
        abstentionPolicy: method.abstentionPolicy,
        base: method.base,
        tieBreak: [...method.tieBreak.cascade],
      };
    case 'supermajority':
      return {
        kind: method.kind,
        fraction: { num: method.fraction.num.toString(), den: method.fraction.den.toString() },
        strict: method.strict,
        base: method.base,
        abstentionPolicy: method.abstentionPolicy,
        tieBreak: [...method.tieBreak.cascade],
      };
    case 'unanimity':
      return { kind: method.kind, base: method.base, abstentionBlocks: method.abstentionBlocks };
    case 'sociocratic-consent':
      return {
        kind: method.kind,
        maxRounds: method.maxRounds,
        silenceMeans: method.silenceMeans,
        minEngagement: {
          num: method.minEngagement.num.toString(),
          den: method.minEngagement.den.toString(),
        },
        admissibility: {
          panelSize: method.admissibility.panelSize,
          panelSelection: method.admissibility.panelSelection,
          panelDeadline: method.admissibility.panelDeadline,
          dismissThreshold: {
            num: method.admissibility.dismissThreshold.num.toString(),
            den: method.admissibility.dismissThreshold.den.toString(),
          },
        },
      };
    case 'score':
      return {
        kind: method.kind,
        min: method.min,
        max: method.max,
        aggregator: method.aggregator,
        noOpinionPolicy: method.noOpinionPolicy,
        minCoverage: canonicalFraction(method.minCoverage),
        tieBreak: [...method.tieBreak.cascade],
      };
    case 'irv':
      return {
        kind: method.kind,
        exhaustedPolicy: method.exhaustedPolicy,
        eliminationTieBreak: [...method.eliminationTieBreak.cascade],
        allowTruncation: method.allowTruncation,
        tieBreak: [...method.tieBreak.cascade],
      };
    case 'majority-judgment':
      return {
        kind: method.kind,
        scale: method.scale.grades.map((grade) => ({ id: grade.id, label: grade.label })),
        missingGradePolicy: method.missingGradePolicy,
        tieBreak: [...method.tieBreak.cascade],
      };
    case 'condorcet-schulze':
      return {
        kind: method.kind,
        allowTruncation: method.allowTruncation,
        truncatedMeans: method.truncatedMeans,
        tieBreak: [...method.tieBreak.cascade],
      };
    case 'deliberative-sortition':
      return {
        kind: method.kind,
        sampleSize: method.sampleSize,
        strata: [...method.strata],
        allocation: method.allocation,
        seedCommitment: method.seedCommitment,
      };
  }
}

function canonicalFraction(f: Fraction): JsonObject {
  return { num: f.num.toString(), den: f.den.toString() };
}

/**
 * Preimagen del `configHash`.
 *
 * DECISIÓN: el padrón entra por su **identidad** (`rollHash`, que por resolución del arquitecto se
 * calcula sólo sobre los `MemberId`) más los metadatos que ese hash deliberadamente excluye
 * (`frozenAt`, `censusSize`, `registryVersion`, `criterion`). No entran los atributos de cada
 * persona: una corrección administrativa del semestre de alguien no cambia quién puede votar y no
 * debe invalidar un hash ya publicado. A.5 dice «hash de TODO lo anterior»; esto es todo lo anterior
 * *en sustancia*, que es lo que el anclaje necesita.
 */
export function configHashPreimage(config: DecisionConfigDraft): JsonObject {
  const quorum: Record<string, JsonValue> = {
    participation: canonicalFraction(config.quorum.participation),
    onFailure: config.quorum.onFailure,
    maxExtensions: config.quorum.maxExtensions,
    extensionDuration: config.quorum.extensionDuration,
  };
  if (config.quorum.approvalOfCensus !== undefined) {
    quorum['approvalOfCensus'] = canonicalFraction(config.quorum.approvalOfCensus);
  }
  if (config.quorum.minDirectParticipation !== undefined) {
    quorum['minDirectParticipation'] = canonicalFraction(config.quorum.minDirectParticipation);
  }
  if (config.quorum.perCircle !== undefined) {
    quorum['perCircle'] = config.quorum.perCircle.map((entry) => ({
      circleId: entry.circleId,
      min: canonicalFraction(entry.min),
    }));
  }

  const preimage: Record<string, JsonValue> = {
    decisionId: config.decisionId,
    proposalId: config.proposalId,
    proposalVersionHash: config.proposalVersionHash,
    circleId: config.circleId,
    topics: [...config.topics],
    options: [...config.options],
    electorate: {
      rollHash: config.electorate.rollHash,
      frozenAt: config.electorate.frozenAt,
      censusSize: config.electorate.censusSize,
      registryVersion: config.electorate.registryVersion,
      criterion: config.electorate.criterion,
    },
    method: canonicalMethod(config.method),
    quorum,
    window: {
      opensAt: config.window.opensAt,
      closesAt: config.window.closesAt,
      timezone: config.window.timezone,
      challengeWindow: config.window.challengeWindow,
      earlyClose: {
        enabled: config.window.earlyClose.enabled,
        mode: config.window.earlyClose.mode,
      },
    },
    privacy: config.privacy,
    delegation: {
      enabled: config.delegation.enabled,
      maxDepth: config.delegation.maxDepth,
      cap: canonicalFraction(config.delegation.cap),
      overflowPolicy: config.delegation.overflowPolicy,
      maxValidity: config.delegation.maxValidity,
      brokenChainNotice: config.delegation.brokenChainNotice,
      lastWordWindow: config.delegation.lastWordWindow,
    },
    seedCommitment: config.seedCommitment,
    engineVersion: config.engineVersion,
  };
  if (config.constituentAct !== undefined) preimage['constituentAct'] = config.constituentAct;
  if (config.unanimityAuthorizedBy !== undefined) {
    preimage['unanimityAuthorizedBy'] = config.unanimityAuthorizedBy;
  }
  if (config.supersedes !== undefined) preimage['supersedes'] = config.supersedes;
  return preimage;
}

export async function computeConfigHash(config: DecisionConfigDraft): Promise<Hash> {
  return hashCanonical(configHashPreimage(config));
}

/**
 * Construye la configuración: valida, calcula `configHash` y **congela en profundidad**.
 * A partir de aquí, `config` es un hecho, no una variable.
 */
export async function buildDecisionConfig(draft: DecisionConfigDraft): Promise<DecisionConfig> {
  const configHash = await computeConfigHash(draft);
  const config: DecisionConfig = { ...draft, configHash };
  validateDecisionConfig(config);
  return deepFreeze(config);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Compuerta C6 y validación
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * **Compuerta de secreto duro (C6).**
 *
 * `secret-ballot` promete secreto perpetuo: que nadie —tampoco quien administra el servidor— pueda
 * reconstruir el vínculo voto↔votante. El MVP no lo entrega: entrega un voto público con control de
 * acceso. Prometer lo primero y entregar lo segundo es peor que no ofrecer secreto, porque induce a
 * confiar. Estos asuntos se derivan a votación en papel.
 *
 * Es una compuerta **dura**: no hay bandera de configuración que la desactive, y se evalúa antes que
 * cualquier otra validación para que ninguna combinación de parámetros pueda esquivarla.
 */
export function assertHardSecrecySupported(privacy: PrivacyMode): void {
  if (privacy === 'secret-ballot') throw new HardSecrecyUnsupported(privacy);
}

function reject(rejection: ConfigRejection, detail: string): never {
  throw new InvalidConfigError(rejection, detail);
}

function requireProper(f: Fraction, what: string): void {
  if (!isProperFraction(f)) {
    reject('FRACTION_OUT_OF_RANGE', `${what} debe ser una fracción de [0, 1]`);
  }
}

/**
 * Valida la configuración completa. **No** incluye la compuerta C6: ésa la aplica `openDecision`
 * antes de todo lo demás, y se mantiene aparte para poder probar por separado que la regla C.7.a
 * (delegación ∧ voto secreto) también existe como control propio (INV-32).
 */
export function validateDecisionConfig(config: DecisionConfig): void {
  if (config.engineVersion !== ENGINE_VERSION) {
    reject(
      'ENGINE_VERSION_MISMATCH',
      `la decisión declara el motor ${config.engineVersion} y este binario es ${ENGINE_VERSION}; ` +
        'un escrutinio histórico debe correr con su escrutador histórico (A.7)',
    );
  }

  if (config.electorate.censusSize < 1) {
    reject('EMPTY_CENSUS', 'no se abre una decisión sin electores (A.8.1)');
  }
  if (config.options.length < 1) reject('NO_OPTIONS', 'se exige al menos una opción (A.8.1)');
  if (!isStrictlySorted(config.options)) {
    reject('OPTIONS_NOT_SORTED', 'las opciones deben venir ordenadas y sin repetidos (A.1.1.1)');
  }
  if (!isStrictlySorted(config.topics)) {
    reject('TOPICS_NOT_SORTED', 'los temas deben venir ordenados y sin repetidos (A.1.1.1)');
  }

  // Los métodos binarios y el consentimiento deciden sobre UNA propuesta. Binarizar varias
  // opciones por separado cae en la paradoja de Anscombe y en la inconsistencia doctrinal (B.1).
  if (
    (isThresholdMethod(config.method) || config.method.kind === 'sociocratic-consent') &&
    config.options.length !== 1
  ) {
    reject(
      'BINARY_METHOD_NEEDS_SINGLE_OPTION',
      `${config.method.kind} decide sobre una sola propuesta (sí/no); con 3+ opciones el motor ` +
        'rechaza la configuración (B.1)',
    );
  }

  if (config.window.opensAt >= config.window.closesAt) {
    reject('WINDOW_INVERTED', 'la ventana debe ser un intervalo no vacío [opensAt, closesAt)');
  }
  if (!Number.isSafeInteger(config.window.challengeWindow) || config.window.challengeWindow < 0) {
    reject('NEGATIVE_CHALLENGE_WINDOW', 'la ventana de impugnación no puede ser negativa');
  }

  validateMethod(config);
  validateQuorum(config);
  validateEarlyClose(config);
  validatePrivacyAndDelegation(config);
}

function validateMethod(config: DecisionConfig): void {
  const method = config.method;

  if (isThresholdMethod(method)) {
    if (method.base === 'present') {
      // DECISIÓN: B.2.b exige un evento `AttendanceRecorded` cerrado antes de abrir la votación…
      // que el catálogo de eventos de A.7 **no contiene**. Sin ese evento el conjunto «presentes»
      // se determinaría después de votar, es decir, sería manipulable, y el denominador volvería a
      // ser móvil. Se rechaza la configuración en vez de inventar el evento. Reportado.
      reject(
        'PRESENT_BASE_UNSUPPORTED',
        "base:'present' exige un registro de asistencia congelado antes de abrir (B.2.b), y el " +
          'evento AttendanceRecorded no existe en esta versión del motor',
      );
    }
    if (method.base === 'census' && config.constituentAct === undefined) {
      reject(
        'CENSUS_BASE_NOT_ALLOWED',
        "base:'census' es un derecho de veto por inasistencia: sólo se admite para reformar el " +
          'reglamento estudiantil, revocar un mandato o disolver un círculo (B.2.a)',
      );
    }
  }

  switch (method.kind) {
    case 'simple-majority': {
      if (method.base !== 'cast') {
        // DECISIÓN: B.1.c dice que «mayoría absoluta» ES `supermajority { 1/2, strict, census }` y
        // justifica la unificación en «un solo código, un solo conjunto de tests, cero divergencia
        // semántica», pero no llega a prohibir la otra forma de escribirla. Aquí se prohíbe: si las
        // dos configuraciones fueran expresables, la unificación duraría hasta la primera prisa.
        reject(
          'CENSUS_BASE_NOT_ALLOWED',
          "simple-majority sólo admite base:'cast'; para un umbral sobre el censo se usa " +
            'supermajority { fraction: 1/2 } (B.1.c)',
        );
      }
      break;
    }
    case 'supermajority': {
      requireProper(method.fraction, 'la fracción de la supermayoría');
      if (method.fraction.num === 0n) {
        reject('FRACTION_OUT_OF_RANGE', 'una supermayoría de 0 no es un umbral');
      }
      break;
    }
    case 'unanimity': {
      if (config.unanimityAuthorizedBy === undefined) {
        reject(
          'UNANIMITY_NOT_AUTHORIZED',
          'la unanimidad está deshabilitada por defecto: da poder de veto individual y exige una ' +
            'decisión previa del círculo que la autorice para este caso concreto (B.4.a)',
        );
      }
      break;
    }
    case 'sociocratic-consent': {
      if (
        !Number.isSafeInteger(method.maxRounds) ||
        method.maxRounds < 1 ||
        method.maxRounds > MAX_ROUNDS_HARD_CAP
      ) {
        reject(
          'MAX_ROUNDS_OUT_OF_RANGE',
          `maxRounds debe estar en [1, ${String(MAX_ROUNDS_HARD_CAP)}] (B.3.c): la deliberación ` +
            'sin límite no converge por virtud, converge por agotamiento',
        );
      }
      requireProper(method.minEngagement, 'minEngagement');
      requireProper(method.admissibility.dismissThreshold, 'dismissThreshold');
      if (method.admissibility.panelSize < 1 || method.admissibility.panelSize % 2 === 0) {
        reject(
          'FRACTION_OUT_OF_RANGE',
          'el panel de admisibilidad debe ser impar y no vacío (B.3.a)',
        );
      }
      if (circleSize(config.electorate, config.circleId) < 1) {
        reject(
          'CONSENT_CIRCLE_EMPTY',
          'el consentimiento se mide contra el círculo, y ningún miembro del padrón pertenece a ' +
            `${config.circleId}: el engagement sería 0/0`,
        );
      }
      break;
    }
    case 'score': {
      // El rango 0–5, el agregador `median` y `noOpinionPolicy: 'ignore'` son tipos literales
      // (B.5, B.5.a, B.5.b): el compilador ya rechaza cualquier otro valor y una comprobación en
      // tiempo de ejecución sería código muerto. Lo único abierto es la cobertura mínima.
      requireProper(method.minCoverage, 'score.minCoverage');
      break;
    }
    case 'irv': {
      // `exhaustedPolicy` y `allowTruncation` son uniones literales cerradas: nada que validar en
      // tiempo de ejecución. El veto de B.6.c (IRV no elige personas ni reforma estatutos) se
      // comprueba con el resto de las reglas transversales, no aquí.
      break;
    }
    case 'majority-judgment': {
      if (method.scale.grades.length < 3 || method.scale.grades.length > 7) {
        reject('FRACTION_OUT_OF_RANGE', 'la escala de menciones debe tener entre 3 y 7 grados');
      }
      const ids = method.scale.grades.map((grade) => grade.id);
      if (new Set(ids).size !== ids.length || ids.some((id) => id === '')) {
        reject(
          'FRACTION_OUT_OF_RANGE',
          'los identificadores de mención deben ser únicos y no vacíos',
        );
      }
      for (const grade of method.scale.grades) {
        if (grade.label.trim() === '' || grade.label.normalize('NFC') !== grade.label) {
          reject('TEXT_NOT_CANONICAL', 'las etiquetas de mención deben ser NFC y no vacías');
        }
      }
      break;
    }
    case 'condorcet-schulze': {
      // `truncatedMeans` es el literal `'tied-last'` (B.8.b): el tipo ya impide `'ranked-last'`.
      break;
    }
    case 'deliberative-sortition': {
      if (!Number.isSafeInteger(method.sampleSize) || method.sampleSize < 1) {
        reject('FRACTION_OUT_OF_RANGE', 'sampleSize debe ser un entero positivo');
      }
      if (!isStrictlySorted(method.strata)) {
        reject(
          'TOPICS_NOT_SORTED',
          'los ejes de estratificación deben estar ordenados y sin repetidos',
        );
      }
      if (method.sampleSize <= 20 && method.strata.length > 2) {
        reject(
          'FRACTION_OUT_OF_RANGE',
          'ADR-0031 limita a dos ejes cruzados cuando sampleSize ≤ 20',
        );
      }
      if (method.seedCommitment !== config.seedCommitment) {
        reject(
          'CONFIG_HASH_MISMATCH',
          'el compromiso del sorteo debe coincidir con el de la decisión',
        );
      }
      break;
    }
  }
}

function validateQuorum(config: DecisionConfig): void {
  const quorum = config.quorum;
  requireProper(quorum.participation, 'quorum.participation');
  if (quorum.approvalOfCensus !== undefined) {
    requireProper(quorum.approvalOfCensus, 'quorum.approvalOfCensus');
    if (isThresholdMethod(config.method) && config.method.base === 'census') {
      // D.1.c: dos frenos idénticos con nombres distintos producen mensajes de error
      // incomprensibles («no alcanzó el umbral» vs «no alcanzó el quórum de aprobación»).
      reject(
        'REDUNDANT_APPROVAL_QUORUM',
        "con base:'census' el quórum de aprobación es el mismo freno dos veces (D.1.c)",
      );
    }
  }
  if (quorum.minDirectParticipation !== undefined) {
    requireProper(quorum.minDirectParticipation, 'quorum.minDirectParticipation');
  }
  for (const entry of quorum.perCircle ?? [])
    requireProper(entry.min, `perCircle[${entry.circleId}]`);

  if (
    !Number.isSafeInteger(quorum.maxExtensions) ||
    quorum.maxExtensions < 0 ||
    quorum.maxExtensions > MAX_EXTENSIONS_HARD_CAP
  ) {
    reject(
      'MAX_EXTENSIONS_OUT_OF_RANGE',
      `maxExtensions debe estar en [0, ${String(MAX_EXTENSIONS_HARD_CAP)}]: prorrogar hasta ` +
        'alcanzar el quórum equivale a no tener quórum (D.2.a)',
    );
  }
  if (quorum.maxExtensions > 0) {
    if (!Number.isSafeInteger(quorum.extensionDuration) || quorum.extensionDuration <= 0) {
      reject('EXTENSION_DURATION_INVALID', 'una prórroga debe durar un número positivo de ms');
    }
  }
}

function validateEarlyClose(config: DecisionConfig): void {
  const early = config.window.earlyClose;
  if (!early.enabled) return;

  if (early.mode === 'never') {
    reject('EARLY_CLOSE_NOT_ALLOWED', "earlyClose habilitado con mode:'never' es contradictorio");
  }
  if (!isThresholdMethod(config.method)) {
    reject(
      'EARLY_CLOSE_NOT_ALLOWED',
      'el cierre anticipado sólo se permite en métodos de umbral: en los ordinales o graduados la ' +
        'irreversibilidad exige explorar el espacio de continuaciones y el canal lateral de ' +
        'temporización es mucho más rico (D.4.b)',
    );
  }
  if (early.mode === 'mathematically-irreversible' && config.privacy !== 'public-roll-call') {
    // D.4.2: el instante del cierre acota el marcador. En `sealed-tally` eso es exactamente lo que
    // el sello prometía ocultar.
    reject(
      'EARLY_CLOSE_NOT_ALLOWED',
      "el cierre por resultado irreversible sólo se permite con privacy:'public-roll-call', donde " +
        'el marcador ya es público en tiempo real (D.4.b)',
    );
  }
}

function validatePrivacyAndDelegation(config: DecisionConfig): void {
  // C.7.a / INV-32. La compuerta C6 hace hoy inalcanzable esta rama desde `openDecision`, pero la
  // regla es independiente y debe existir como control propio: cuando el secreto exista de verdad,
  // seguirá siendo incompatible con la delegación.
  if (config.privacy === 'secret-ballot' && config.delegation.enabled) {
    reject(
      'SECRET_BALLOT_WITH_DELEGATION',
      'un voto secreto con delegación es un voto secreto con una puerta trasera pública y ' +
        'verificable: al coaccionador le basta con exigirte que delegues en él (C.7.a)',
    );
  }
  if (config.delegation.enabled) {
    reject(
      'DELEGATION_NOT_IMPLEMENTED',
      'la democracia líquida (PARTE C) no está implementada en esta versión del motor. Aceptar la ' +
        'delegación y no resolverla haría que un voto delegado simplemente no existiera',
    );
  }
  requireProper(config.delegation.cap, 'delegation.cap');
  if (config.delegation.maxDepth < 1) {
    reject(
      'FRACTION_OUT_OF_RANGE',
      'delegation.maxDepth se mide en aristas y debe ser ≥ 1 (C.4.2)',
    );
  }
}

/** Miembros del círculo de la decisión, en orden de padrón. Base del `engagement` sociocrático. */
export function decisionCircleMembers(config: DecisionConfig): readonly MemberId[] {
  return membersOfCircle(config.electorate, config.circleId);
}

/** La fracción neutra `0/1`, para armar quórums «sin exigencia». */
export const NO_QUORUM_REQUIRED: Fraction = ZERO;
