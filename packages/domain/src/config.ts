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
  /**
   * **Consenso formal (B.10).** Nadie bloquea, y no se apartó demasiada gente.
   *
   * ═══ En qué se distingue de los dos que ya existen ═══
   *
   * `unanimity` pide que TODO EL MUNDO esté a favor. `sociocratic-consent` pide que NADIE objete
   * con daño argumentado — y el silencio no es apoyo, es no haber participado. Los dos son puntos
   * coherentes y ninguno tiene la figura que define al consenso formal: **apartarse**.
   *
   * Apartarse es decir «no lo apoyo, no lo voy a impedir, y quiero que conste que no lo apoyo». En
   * consentimiento eso no existe: o se objeta con argumento de daño, o no se objeta, y quien tiene
   * una reserva profunda que no llega a daño se queda sin manera de dejarla anotada. En unanimidad
   * tampoco: apartarse rompería el acuerdo, así que la única salida honesta sería bloquear.
   *
   * Y tiene una consecuencia que el motor SÍ puede hacer cumplir, que es lo que lo vuelve un método
   * y no un matiz: un acuerdo que pasa con la mitad del grupo apartándose está técnicamente
   * desbloqueado y políticamente hueco. `maxStandAside` es el tope, y las tradiciones de consenso
   * formal lo ponen exactamente por eso. Pasado ese tope no se aprueba: se devuelve para
   * reformular.
   */
  | {
      readonly kind: 'consensus';
      /**
       * Cuánta gente puede apartarse sin que el acuerdo deje de significar algo.
       *
       * Se mide sobre quienes se manifestaron, no sobre el censo: apartarse es un acto, y sólo lo
       * hace quien participó. Medirlo contra el censo diluiría a los que se apartaron con los que
       * no aparecieron, que son cosas distintas.
       */
      readonly maxStandAside: Fraction;
      /** Fracción del círculo que debe manifestarse para que el acuerdo cuente. Como en B.3. */
      readonly minEngagement: Fraction;
    }
  /**
   * **Proceso de consejo (B.9).** Decide UNA persona, después de escuchar.
   *
   * No es una votación y por eso no tiene umbral ni fracción: nadie gana, nadie pierde. Quien
   * decide está obligado a haber recogido consejo de al menos `minAdvisors` personas distintas
   * antes de que su decisión valga; el consejo **no ata**, y ésa es la diferencia con todo lo demás
   * de este catálogo. Lo que el motor hace cumplir no es el contenido de la decisión sino la
   * obligación de haber preguntado — que es exactamente lo que este método promete y lo único que
   * un programa puede comprobar.
   *
   * Sirve para lo que una asamblea no debería votar: qué herramienta usar, cómo redactar un aviso,
   * a quién invitar a una reunión. Votar eso convierte una operación en un plebiscito; decidirlo a
   * puerta cerrada convierte una operación en un privilegio. Ésta es la tercera vía, y su registro
   * deja por escrito a quién se le preguntó.
   */
  | {
      readonly kind: 'advice-process';
      /** Quien decide. Es una sola persona, y eso ES el método, no una limitación suya. */
      readonly decider: MemberId;
      /**
       * Cuántas personas distintas tienen que haber aconsejado para que la decisión valga.
       *
       * Uno no alcanza: «pedí consejo a alguien» es lo que hace cualquiera antes de hacer lo que
       * iba a hacer igual. El mínimo del motor es 2 y se comprueba al abrir.
       */
      readonly minAdvisors: number;
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

/**
 * Los métodos que COMPARAN opciones entre sí: puntuación, orden de preferencia, mención y
 * Condorcet-Schulze. Se distinguen de los binarios y del consentimiento en que su pregunta no es
 * «¿aprobamos esto?» sino «¿cuál de éstas?».
 *
 * Existe porque esa diferencia tiene una consecuencia dura, ver `MULTI_METHOD_NEEDS_TWO_OPTIONS`
 * más abajo: con una sola opción, «cuál gana» no es una pregunta, y todos ellos contestan que gana
 * la única que hay.
 */
export function isComparativeMethod(method: DecisionMethod): boolean {
  return (
    method.kind === 'score' ||
    method.kind === 'irv' ||
    method.kind === 'majority-judgment' ||
    method.kind === 'condorcet-schulze'
  );
}

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
 * Democracia líquida (PARTE C). Los cuatro frenos de ADR-0029 viven aquí, y los cuatro son de
 * dominio: caducidad obligatoria, resolución determinista, tope de profundidad y tope de
 * concentración.
 *
 * `enabled: true` es una configuración **válida** desde esta entrega. Lo que se rechaza es
 * combinarla con `privacy: 'secret-ballot'` (C.7.a / ADR-0030), y hacerlo es una compuerta dura: la
 * decisión **no se abre**. La delegación «inerte» —aceptarla y no resolverla— es la peor de las
 * opciones posibles y la que INV-32 describe como fallo ingenuo: alguien cree que su delegado vota
 * por él y su voto simplemente no existe.
 */
export interface DelegationConfig {
  readonly enabled: boolean;
  /** Profundidad máxima de la cadena, en ARISTAS. Default 4 (C.4.c, `GOVERNANCE.md` §5). */
  readonly maxDepth: number;
  /** Tope de poder por delegado, como fracción del CENSO. Default 1/10 ⇒ 30 de 300 (C.5.a). */
  readonly cap: Fraction;
  readonly overflowPolicy: 'return-to-delegator';
  /** Vigencia máxima al conceder, en ms. Default ≈ un semestre (C.1.a). */
  readonly maxValidity: number;
  /** Antelación del aviso de cadena rota, en ms. Default 24 h (C.4.3). */
  readonly brokenChainNotice: number;
  /** Ventana de última palabra, en ms. Default 0: visible desde que el delegado vota (C.7.d). */
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

/**
 * Vigencia máxima de una delegación: **un semestre** (≈ 180 días).
 *
 * DECISIÓN C.1.a: no existe la delegación perpetua. Las perpetuas se acumulan por inercia —se delega
 * una vez en primer semestre y el poder queda congelado cinco años en personas que quizá ya ni
 * están—, y la caducidad obliga a **reafirmar** el mandato, que es el acto político relevante.
 * Es un tope duro: `maxValidity` no puede superarlo (`GOVERNANCE.md` §5, «vencimiento obligatorio de
 * máximo un semestre»).
 */
export const MAX_DELEGATION_VALIDITY_MS = 180 * 24 * 60 * 60 * 1000;

/** Antelación por defecto del aviso de cadena rota: 24 h (C.4.3, `GOVERNANCE.md` §5). */
export const DEFAULT_BROKEN_CHAIN_NOTICE_MS = 24 * 60 * 60 * 1000;

/** Delegación apagada: el default institucional. Delegar es un acto explícito de configuración. */
export const DELEGATION_DISABLED: DelegationConfig = {
  enabled: false,
  maxDepth: 4,
  cap: { num: 1n, den: 10n },
  overflowPolicy: 'return-to-delegator',
  maxValidity: MAX_DELEGATION_VALIDITY_MS,
  brokenChainNotice: DEFAULT_BROKEN_CHAIN_NOTICE_MS,
  lastWordWindow: 0,
};

/**
 * Delegación encendida con los valores por defecto de ADR-0029: cadenas de cuatro pasos, tope de una
 * décima parte del censo (30 de 300) y devolución del excedente al delegante.
 */
export const DELEGATION_ENABLED: DelegationConfig = { ...DELEGATION_DISABLED, enabled: true };

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
    case 'consensus':
      return {
        kind: method.kind,
        maxStandAside: canonicalFraction(method.maxStandAside),
        minEngagement: canonicalFraction(method.minEngagement),
      };
    case 'advice-process':
      return { kind: method.kind, decider: method.decider, minAdvisors: method.minAdvisors };
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

  /*
   * La contraparte de la regla de arriba, y no es simetría por elegancia: sin ella el motor aprueba
   * cosas que nadie aprobó.
   *
   * Con UNA sola opción, «cuál gana» deja de ser una pregunta: score, orden de preferencia, mención
   * y Condorcet-Schulze contestan todos que gana la única que hay, y el desenlace sale `approved`.
   * Se reprodujo de punta a punta contra PostgreSQL real: una decisión de mención abierta por la
   * API, los CUATRO votantes mandando «rechazar», y el cierre devolviendo `"desenlace":"approved"`.
   * El escrutinio no está mal —«la mejor de una» es la única de una— y la comparación es lo que no
   * significa nada.
   *
   * La guarda vive ACÁ y no en la pantalla que abre la votación, que es donde estaba: una regla que
   * sólo aplica el navegador no es una regla, es una sugerencia, y quien llame a la API se la salta
   * — que es exactamente como se reprodujo. Mientras `abrirDecision` siga abriendo sobre la única
   * propuesta de la decisión, estos cuatro métodos no se pueden abrir, y el motor lo dice en vez de
   * dejar que se abran y mientan al cerrar.
   */
  if (isComparativeMethod(config.method) && config.options.length < 2) {
    reject(
      'MULTI_METHOD_NEEDS_TWO_OPTIONS',
      `${config.method.kind} compara opciones entre sí, y con una sola no hay nada que comparar: ` +
        'gana la única que haya aunque todo el mundo la rechace (B.1)',
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
    case 'consensus': {
      requireProper(method.maxStandAside, 'maxStandAside');
      requireProper(method.minEngagement, 'minEngagement');
      if (circleSize(config.electorate, config.circleId) < 1) {
        reject(
          'CONSENT_CIRCLE_EMPTY',
          'el consenso se mide contra el círculo, y ningún miembro del padrón pertenece a ' +
            `${config.circleId}: la participación sería 0/0`,
        );
      }
      break;
    }
    case 'advice-process': {
      /*
       * Quien decide tiene que estar en el padrón CONGELADO, no en el de hoy: si mañana se da de
       * baja, la decisión que tomó sigue siendo suya y sigue siendo legible. Mirar el padrón vivo
       * dejaría decisiones huérfanas cada vez que alguien se va.
       */
      if (!config.electorate.members.some((m) => m.memberId === method.decider)) {
        reject(
          'DECIDER_NOT_IN_ROLL',
          'quien decide tiene que estar en el padrón de esta decisión: no se le puede encargar a ' +
            'alguien que no podía participar (B.9)',
        );
      }
      if (!Number.isSafeInteger(method.minAdvisors) || method.minAdvisors < 2) {
        reject(
          'MIN_ADVISORS_TOO_LOW',
          'hacen falta al menos DOS consejos: «pedí consejo a alguien» es lo que hace cualquiera ' +
            'antes de hacer lo que iba a hacer igual, y este método existe para que eso no cuente ' +
            '(B.9)',
        );
      }
      /*
       * Y tiene que haber a quién preguntarle. `censusSize - 1` porque quien decide no se aconseja
       * a sí misma: con un padrón de tres y `minAdvisors: 3`, la decisión sería IMPOSIBLE de cerrar
       * y nadie lo notaría hasta el vencimiento. Rechazarlo al abrir es la diferencia entre un
       * error que se ve enseguida y una votación que muere en silencio.
       */
      if (method.minAdvisors > config.electorate.censusSize - 1) {
        reject(
          'MIN_ADVISORS_UNREACHABLE',
          `se piden ${String(method.minAdvisors)} consejos y en el padrón hay ` +
            `${String(config.electorate.censusSize - 1)} personas que puedan darlos (quien decide ` +
            'no cuenta): así no se podría cerrar nunca (B.9)',
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
  const delegation = config.delegation;

  // ═══ C.7.a / ADR-0030 / INV-32 — compuerta dura ═══
  //
  // No «inerte», no «desaconsejada»: `enabled ∧ secret-ballot` es una configuración INVÁLIDA y la
  // decisión no se abre. La razón es C.7.2 y no la comodidad: el voto secreto existe para hacer
  // imposible la coacción, y lo logra porque el votante **no puede demostrarle a un tercero cómo
  // votó**. La delegación destruye esa propiedad por construcción: al coaccionador no le hace falta
  // saber cómo votaste, le basta con exigirte que delegues en él, y eso sí es verificable —el propio
  // delegado ve su lista de delegantes—. Un voto secreto con delegación es un voto secreto con una
  // puerta trasera pública; ofrece la apariencia de protección sin la protección, que es peor que no
  // tener secreto porque induce a confiar.
  //
  // La compuerta C6 hace hoy inalcanzable esta rama desde `openDecision`, pero la regla es
  // independiente y debe existir como control propio: cuando el secreto exista de verdad, seguirá
  // siendo incompatible con la delegación.
  if (config.privacy === 'secret-ballot' && delegation.enabled) {
    reject(
      'SECRET_BALLOT_WITH_DELEGATION',
      'un voto secreto con delegación es un voto secreto con una puerta trasera pública y ' +
        'verificable: al coaccionador le basta con exigirte que delegues en él (C.7.a / ADR-0030)',
    );
  }

  requireProper(delegation.cap, 'delegation.cap');
  if (!Number.isSafeInteger(delegation.maxDepth) || delegation.maxDepth < 1) {
    reject(
      'FRACTION_OUT_OF_RANGE',
      'delegation.maxDepth se mide en aristas y debe ser un entero ≥ 1 (C.4.2)',
    );
  }
  if (!Number.isSafeInteger(delegation.brokenChainNotice) || delegation.brokenChainNotice < 0) {
    reject('FRACTION_OUT_OF_RANGE', 'delegation.brokenChainNotice no puede ser negativa (C.4.3)');
  }
  if (!Number.isSafeInteger(delegation.lastWordWindow) || delegation.lastWordWindow < 0) {
    reject('FRACTION_OUT_OF_RANGE', 'delegation.lastWordWindow no puede ser negativa (C.7.d)');
  }

  if (!delegation.enabled) return;

  // ═══ Caducidad obligatoria (C.1.a / ADR-0029 / `GOVERNANCE.md` §5) ═══
  if (!Number.isSafeInteger(delegation.maxValidity) || delegation.maxValidity < 1) {
    reject(
      'FRACTION_OUT_OF_RANGE',
      'delegation.maxValidity debe ser un intervalo positivo (C.1.a)',
    );
  }
  if (delegation.maxValidity > MAX_DELEGATION_VALIDITY_MS) {
    reject(
      'DELEGATION_VALIDITY_TOO_LONG',
      'el vencimiento obligatorio es de máximo un semestre y la renovación es explícita, jamás ' +
        'automática: una delegación que nadie renueva debe morir sola (C.1.a / ADR-0029)',
    );
  }

  // ═══ El tope tiene que dejar sitio al voto propio Y a una delegación (C.5) ═══
  //
  // `capWeight = ⌊cap·N⌋`.
  //  - Si sale 0, INV-27 («ninguna papeleta pesa más que el tope») es insatisfacible: el peso propio
  //    vale 1 y no es devolvible.
  //  - Si sale 1, la delegación queda habilitada y a la vez es IMPOSIBLE: toda concesión se
  //    rechazaría por tope y el registro público mostraría un mecanismo que no funciona. Es la
  //    delegación «inerte» que ADR-0030 e INV-32 rechazan, sólo que por aritmética en vez de por
  //    modo de privacidad, y con el mismo efecto: alguien cree que puede delegar y no puede.
  //
  // En los dos casos se rechaza al abrir, que es cuando todavía se puede corregir el parámetro.
  const capWeight =
    (delegation.cap.num * BigInt(config.electorate.censusSize)) / delegation.cap.den;
  if (capWeight < 2n) {
    reject(
      'DELEGATION_CAP_TOO_SMALL',
      `el tope de concentración ⌊${delegation.cap.num.toString()}·` +
        `${String(config.electorate.censusSize)}/${delegation.cap.den.toString()}⌋ vale ` +
        `${capWeight.toString()} voto(s): con ese censo la delegación quedaría habilitada y a la ` +
        'vez sería imposible de ejercer (C.5)',
    );
  }

  // ═══ Lo constituyente se vota con la propia mano (D.1.b / `GOVERNANCE.md` §5) ═══
  //
  // «Nunca se delega […] la reforma de estas reglas **más allá del voto directo mínimo**.» La regla
  // no es prohibir la delegación en un acto constituyente: es que exista un piso de participación
  // DIRECTA por debajo del cual el acto no vale. Sin `minDirectParticipation` esa frase no es
  // verificable por el motor y una reforma estatutaria podría aprobarse con doce personas votando
  // por doscientas ochenta, que es exactamente lo que D.1.b existe para impedir.
  if (config.constituentAct !== undefined && config.quorum.minDirectParticipation === undefined) {
    reject(
      'CONSTITUENT_ACT_NEEDS_MIN_DIRECT',
      'un acto constituyente con delegación habilitada exige quorum.minDirectParticipation: para ' +
        'lo constituyente la comunidad debe aparecer con su propia mano (D.1.b / ADR-0029)',
    );
  }
}

/** Miembros del círculo de la decisión, en orden de padrón. Base del `engagement` sociocrático. */
export function decisionCircleMembers(config: DecisionConfig): readonly MemberId[] {
  return membersOfCircle(config.electorate, config.circleId);
}

/** La fracción neutra `0/1`, para armar quórums «sin exigencia». */
export const NO_QUORUM_REQUIRED: Fraction = ZERO;
