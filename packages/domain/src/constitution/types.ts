/**
 * Constitución digital: identificadores, texto versionado, eventos y estado.
 *
 * ═══ Qué es aquí una «regla» ═══
 *
 * `GOVERNANCE.md` §6 lo dice en una frase: los métodos, umbrales, quórums, plazos, dominios y límites
 * del administrador **no son opciones de un panel**, son acuerdos versionados dentro de la
 * plataforma. Este agregado los trata como lo que son: un dato con versión, con la decisión que lo
 * creó y con fecha de caducidad, que sólo cambia por el procedimiento de la fila 13 —o de la 14—.
 *
 * Una **cláusula** es un par `(clauseId, textHash)`: una etiqueta estable y el hash del texto
 * normativo. El texto vive fuera —es `GOVERNANCE.md`, que se publica— y aquí entra por su hash,
 * como entra cualquier otro compromiso del sistema. Que el dominio guarde el hash y no el texto no
 * es ahorro de espacio: es que el dominio **no interpreta prosa**, y una cláusula que sólo existe
 * como hash no se puede reescribir «arreglando una coma» sin que el hash cambie y el pliegue lo vea.
 *
 * Aparte de las cláusulas, el texto versiona los **requisitos de reforma** (`ReformRequirements`) en
 * forma estructurada, porque son las únicas reglas que este agregado tiene que **aplicar** y no sólo
 * conservar. Todo lo demás lo aplican otros módulos, que leen el texto vigente.
 *
 * ═══ Por qué el núcleo intangible no se protege con tipos ═══
 *
 * Un `readonly`, un tipo literal o una unión cerrada desaparecen al compilar. El adversario de este
 * agregado —el administrador técnico del §7, que puede restaurar una copia de seguridad— no llega
 * por la puerta de TypeScript: llega con un **historial traído de fuera**, con sus hashes
 * recalculados y su cadena intacta. Contra eso, un tipo no dice nada: el log se pliega igual.
 *
 * Por eso el núcleo se protege **en el pliegue** (`commands.ts`, `core.ts`): es un conjunto de
 * hashes fijado en el evento fundacional, y `applyConstitution` lo recomputa desde el texto vigente
 * **en cada evento** y lo compara con el del génesis. Si difiere, lanza. Un log forjado que altere
 * el núcleo se rechaza al replegarlo, que es por donde pasa todo historial: el de esta API, el de
 * una restauración y el del fichero que alguien trajo en un USB.
 *
 * ═══ La copia congelada ═══
 *
 * `ReformOpened` lleva dentro `FrozenReformRules`: los umbrales, el censo, el Círculo de Garantías y
 * el calendario **por valor**, tal como estaban al abrir. La reforma se juzga sólo contra esa copia
 * y nunca contra las reglas vigentes. Es el mismo patrón del padrón congelado de ADR-0025, aplicado
 * a la regla en vez de al censo, y cierra la trampa evidente: una reforma que cambia las reglas de
 * su propia aprobación.
 */

import type { Fraction } from '../fraction.js';
import {
  type Brand,
  type DecisionId,
  ID_PATTERN,
  type Hash,
  HASH_PATTERN,
  type Instant,
  LABEL_PATTERN,
  type MemberId,
} from '../ids.js';
import { InvalidIdError } from '../errors.js';
import type { ChainedEvent, ChainedLog } from '../workspace/chain.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Identificadores
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Identificador opaco de la constitución. Hay una por comunidad: es el agregado raíz de §6. */
export type ConstitutionId = Brand<string, 'ConstitutionId'>;
/** Identificador opaco de un proceso de reforma. */
export type ReformId = Brand<string, 'ReformId'>;
/**
 * Etiqueta estable de una cláusula (`lista_taxativa`, `fila_13`…).
 *
 * Es una **etiqueta legible y no un identificador aleatorio** a propósito: una cláusula tiene que
 * poder nombrarse igual en el ledger, en la interfaz y en la discusión de la asamblea. Sigue
 * `LABEL_PATTERN` porque acaba siendo clave de objeto dentro de una preimagen de hash y el perfil
 * canónico del ledger sólo admite `^[A-Za-z][A-Za-z0-9_]*$`.
 */
export type ClauseId = Brand<string, 'ClauseId'>;

const OPAQUE = '32 caracteres hexadecimales en minúscula';

export function constitutionId(value: string): ConstitutionId {
  if (!ID_PATTERN.test(value)) throw new InvalidIdError('ConstitutionId', value, OPAQUE);
  return value as ConstitutionId;
}

export function reformId(value: string): ReformId {
  if (!ID_PATTERN.test(value)) throw new InvalidIdError('ReformId', value, OPAQUE);
  return value as ReformId;
}

export function clauseId(value: string): ClauseId {
  if (!LABEL_PATTERN.test(value)) {
    throw new InvalidIdError('ClauseId', value, 'una etiqueta [a-z][a-z0-9_]{0,31}');
  }
  return value as ClauseId;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El texto versionado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Una cláusula del texto: etiqueta estable y hash de su texto normativo. */
export interface Clause {
  readonly clauseId: ClauseId;
  /** `sha256Hex(utf8(texto normalizado))`. Entra como dato: el dominio no hashea al plegar. */
  readonly textHash: Hash;
}

export function isWellFormedClause(clause: Clause): boolean {
  return LABEL_PATTERN.test(clause.clauseId) && HASH_PATTERN.test(clause.textHash);
}

/**
 * Los requisitos de una vía de reforma. Es la fila 13 —o la 14— escrita como dato.
 *
 * Todas las proporciones son `Fraction` exactas y se comparan por multiplicación cruzada
 * (ADR-0027). «2/3 sobre el censo» **no** es `0.667 × 300`: es `favor × 3 ≥ 2 × censo`, que con 300
 * personas da exactamente 200 y no 199 por un error de representación.
 */
export interface ReformRequirements {
  /** Fracción **del censo** que debe votar a favor. Fila 13: `2/3`. Fila 14: `3/4`. */
  readonly approvalOfCensus: Fraction;
  /**
   * Fracción del censo que debe votar **directamente**. La delegación no cuenta para este mínimo
   * (§5: «la reforma de estas reglas más allá del voto directo mínimo» no se delega).
   */
  readonly minDirectParticipation: Fraction;
  /** Días de deliberación previa. Fila 13: 21. */
  readonly deliberationDays: number;
  /** Días de espera entre el cierre de la votación y la entrada en vigor. Fila 13: 14. */
  readonly waitingDays: number;
  /** `M` de la aprobación M-de-N de Garantías. Fila 13: 3. Fila 14: 4. */
  readonly guaranteeThreshold: number;
  /** `N` de la aprobación M-de-N. El Círculo de Garantías son 5 personas (§3). */
  readonly guaranteeCircleSize: number;
  /** Votaciones exigidas. Fila 14: **dos**, separadas por un semestre (§6.a, doble llave temporal). */
  readonly votesRequired: number;
  /** Meses mínimos entre una votación y la siguiente. Fila 14: 6. */
  readonly separationMonths: number;
  /** Fracción del censo que debe firmar para abrir. Fila 13: `1/10`. Fila 14: `1/5`. */
  readonly sponsorSignatures: Fraction;
}

/**
 * El texto de la constitución en una versión concreta.
 *
 * `ordinary` y `entrenched` son «la sección 10» —la cláusula de enmienda— en forma ejecutable.
 * Cambiarlas exige la vía atrincherada, porque una reforma ordinaria que pudiera reescribir su
 * propio umbral es exactamente el problema de la enmienda de la cláusula de enmienda (§6).
 */
export interface ConstitutionText {
  /** Todas las cláusulas, estrictamente ordenadas por `clauseId`. Incluye las del núcleo. */
  readonly clauses: readonly Clause[];
  /** Fila 13: reforma ordinaria de una regla de este documento. */
  readonly ordinary: ReformRequirements;
  /** Fila 14: reforma de la sección 10 y de la maquinaria de atrincheramiento. */
  readonly entrenched: ReformRequirements;
  /** Meses de vigencia de una versión antes de caducar. §6: la fundacional, **doce**. */
  readonly validityMonths: number;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Reformas
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Las dos vías: la fila 13 y la fila 14. No hay una tercera, ni una «vía rápida». */
export type ReformKind = 'ordinaria' | 'atrincherada';

export const REFORM_KINDS: readonly ReformKind[] = ['ordinaria', 'atrincherada'];

/**
 * Una decisión ya convocada que una reforma no puede pisar (§6.c).
 *
 * `affectsClauseIds` son las cláusulas de las que esa decisión depende. Si la reforma toca alguna,
 * su votación no puede caer en los 30 días anteriores a la decisión: es «no se cambian las reglas
 * viendo el marcador».
 */
export interface ConvenedDecision {
  readonly decisionId: DecisionId;
  readonly opensAt: Instant;
  readonly affectsClauseIds: readonly ClauseId[];
}

/** El calendario contra el que se juzga la ventana de una reforma. Se congela al abrir. */
export interface ReformCalendar {
  /** Fin del semestre académico. Las dos últimas semanas son ventana cerrada (§6.c). */
  readonly semesterEndsAt: Instant;
  /** Decisiones ya convocadas al abrir la reforma. Ordenadas por `decisionId`. */
  readonly convened: readonly ConvenedDecision[];
}

/**
 * La copia por valor de **todo** lo que juzga a la reforma, tomada al abrirla.
 *
 * Ni un solo requisito se lee de las reglas vigentes después de este momento. Si mientras la reforma
 * está en curso se ratifica otra que baja el umbral, esta sigue midiéndose con el umbral que tenía
 * el día que se abrió; y si esta misma reforma pretende bajar el umbral, tampoco se lo aplica a sí
 * misma. Es la cláusula de atrincheramiento (c) en su forma ejecutable.
 */
export interface FrozenReformRules {
  readonly requirements: ReformRequirements;
  /** Censo congelado al abrir. Sin denominador fijo, «2/3 del censo» no tiene valor de verdad (§2). */
  readonly censusSize: number;
  /**
   * El Círculo de Garantías del momento, congelado y ordenado.
   *
   * Va aquí y no en el texto versionado porque **quién** integra Garantías no es una regla
   * constitucional: es el resultado de una elección anual (§7). Congelarlo impide que una firma la
   * ponga alguien que entró al círculo después de que la reforma se abriera.
   */
  readonly guarantors: readonly MemberId[];
  readonly calendar: ReformCalendar;
}

/**
 * El resultado de una votación de reforma, tal como lo publica el escrutinio.
 *
 * Este agregado **no cuenta votos**: el conteo lo hace el motor de decisiones y aquí entra como
 * dato, con el `decisionId` que permite recomputarlo. Lo que sí hace es comprobar que el resultado
 * alcanza el umbral **de la copia congelada**.
 */
export interface ReformVote {
  /** Denso desde 1. Fila 14 exige dos rondas separadas por un semestre. */
  readonly round: number;
  readonly decisionId: DecisionId;
  /** Votos a favor, directos y delegados. Se compara contra el censo, no contra las papeletas. */
  readonly votesInFavor: number;
  /** Personas que votaron **directamente**. La delegación no cuenta aquí (fila 13). */
  readonly directParticipation: number;
  readonly opensAt: Instant;
  readonly closesAt: Instant;
}

/**
 * Por qué se cerró una reforma sin ratificarla. Vocabulario cerrado: el motivo es público.
 *
 * Los cinco son **comprobables contra el historial**, y el pliegue los comprueba. No hay un
 * «otros motivos» ni un texto libre: un motivo que nadie puede contrastar es una firma en blanco
 * para cerrar la reforma que estorbe, y cerrar es tan definitivo como ratificar.
 */
export type ReformRejectionReason =
  | 'umbral_no_alcanzado'
  | 'voto_directo_insuficiente'
  | 'sin_firmas_de_garantias'
  | 'version_desplazada'
  | 'retirada_por_quien_la_propuso';

export const REFORM_REJECTION_REASONS: readonly ReformRejectionReason[] = [
  'umbral_no_alcanzado',
  'voto_directo_insuficiente',
  'sin_firmas_de_garantias',
  'version_desplazada',
  'retirada_por_quien_la_propuso',
];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Eventos
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type ConstitutionPayload =
  | {
      readonly type: 'ConstitutionFounded';
      /** 1 en el génesis; `n+1` en una refundación tras la caducidad. */
      readonly version: number;
      readonly text: ConstitutionText;
      /**
       * El núcleo intangible, **por valor**. En el génesis fija el conjunto para siempre; en una
       * refundación hay que repetirlo idéntico o el pliegue rechaza el evento.
       */
      readonly core: readonly Clause[];
      /** La decisión que la ratificó en asamblea abierta (§6, «el problema del arranque»). */
      readonly foundingDecisionId: DecisionId;
      readonly censusSize: number;
      readonly votesInFavor: number;
      /** Papeletas computables. La regla fundacional es **2/3 de las papeletas**, no del censo. */
      readonly castBallots: number;
      readonly directParticipation: number;
      readonly effectiveAt: Instant;
    }
  | {
      readonly type: 'ReformOpened';
      readonly reformId: ReformId;
      readonly kind: ReformKind;
      /** Versión sobre la que se abre. Control de concurrencia optimista: se revalida al ratificar. */
      readonly targetVersion: number;
      readonly proposedText: ConstitutionText;
      readonly frozen: FrozenReformRules;
      /** Firmas que abren la propuesta. Fila 13: 30, el 10 % del censo. */
      readonly sponsorCount: number;
      readonly deliberationOpensAt: Instant;
      readonly deliberationClosesAt: Instant;
    }
  | {
      readonly type: 'ReformVoteRecorded';
      readonly reformId: ReformId;
      readonly vote: ReformVote;
    }
  | {
      readonly type: 'ReformApprovedByGuarantor';
      readonly reformId: ReformId;
      /**
       * Quién aprueba. Tiene que coincidir con el `actor` del sobre, y el pliegue lo comprueba.
       *
       * **Esto no es una firma criptográfica y no lo simula.** Ver la declaración de `commands.ts`:
       * sin curva elíptica en el dominio (ADR-0001) nada impide que quien administra fabrique este
       * evento. Lo que hay es detección, no prevención.
       */
      readonly guarantorId: MemberId;
    }
  | {
      readonly type: 'ReformRatified';
      readonly reformId: ReformId;
      readonly version: number;
      readonly effectiveAt: Instant;
    }
  | {
      readonly type: 'ReformRejected';
      readonly reformId: ReformId;
      readonly reason: ReformRejectionReason;
    };

export type ConstitutionEventType = ConstitutionPayload['type'];

export const CONSTITUTION_EVENT_TYPES: readonly ConstitutionEventType[] = [
  'ConstitutionFounded',
  'ReformOpened',
  'ReformVoteRecorded',
  'ReformApprovedByGuarantor',
  'ReformRatified',
  'ReformRejected',
];

export type ConstitutionEvent = ChainedEvent<ConstitutionPayload>;
export type ConstitutionLog = ChainedLog<ConstitutionPayload>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Estado
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Estado de una reforma en curso. `ratificada` y `rechazada` son absorbentes. */
export type ReformStatus = 'deliberando' | 'votada' | 'ratificada' | 'rechazada';

export const REFORM_STATUSES: readonly ReformStatus[] = [
  'deliberando',
  'votada',
  'ratificada',
  'rechazada',
];

/** Estado público de la constitución en un instante dado. La caducidad se evalúa perezosamente. */
export type ConstitutionStatus = 'inexistente' | 'vigente' | 'caducada';

export const CONSTITUTION_STATUSES: readonly ConstitutionStatus[] = [
  'inexistente',
  'vigente',
  'caducada',
];

/**
 * Una versión histórica. **Ninguna se borra jamás**: §6 exige publicar «versión, fecha y diferencia
 * respecto de la anterior», y una diferencia contra algo que ya no existe no se puede comprobar.
 */
export interface ConstitutionVersion {
  readonly version: number;
  readonly text: ConstitutionText;
  /** La reforma que la produjo; ausente si la versión nace de una fundación. */
  readonly reformId: ReformId | undefined;
  /** La decisión que la fundó; ausente si nace de una reforma. */
  readonly foundingDecisionId: DecisionId | undefined;
  readonly effectiveAt: Instant;
  /** `effectiveAt + validityMonths`. Pasado ese instante la constitución está caducada. */
  readonly expiresAt: Instant;
  readonly seq: number;
}

export interface ReformRecord {
  readonly reformId: ReformId;
  readonly kind: ReformKind;
  readonly status: ReformStatus;
  readonly targetVersion: number;
  readonly proposedText: ConstitutionText;
  readonly frozen: FrozenReformRules;
  readonly sponsorCount: number;
  readonly deliberationOpensAt: Instant;
  readonly deliberationClosesAt: Instant;
  readonly votes: readonly ReformVote[];
  /** Aprobaciones de Garantías, sin duplicados y en orden de llegada. */
  readonly approvals: readonly MemberId[];
  readonly rejection: ReformRejectionReason | undefined;
  /**
   * Quien la abrió, tomado del `actor` del sobre.
   *
   * Existe para una sola cosa: que «retirada por quien la propuso» sea comprobable. Un motivo de
   * cierre que nadie puede contrastar es una firma en blanco para cerrar lo que estorbe.
   */
  readonly proposedBy: MemberId;
  readonly openedAt: Instant;
  readonly seq: number;
}

export interface ConstitutionState {
  readonly constitutionId: ConstitutionId;
  readonly exists: boolean;
  /**
   * El núcleo intangible fijado por el **evento fundacional** (seq 1) y jamás por otro.
   *
   * Vacío mientras no exista la constitución. A partir del génesis es inmutable: ni una reforma, ni
   * una refundación, ni un historial traído de fuera lo cambian sin que `applyConstitution` lance.
   */
  readonly core: readonly Clause[];
  /** Todas las versiones, en orden ascendente. Nunca se poda. */
  readonly versions: readonly ConstitutionVersion[];
  /** Número de la versión vigente; 0 si no existe constitución. */
  readonly currentVersion: number;
  /** Cuántas veces se fundó. 1 tras el génesis; sube con cada refundación tras una caducidad. */
  readonly foundations: number;
  readonly reforms: readonly ReformRecord[];
  readonly lastSeq: number;
}

export function initialConstitutionState(id: ConstitutionId): ConstitutionState {
  return {
    constitutionId: id,
    exists: false,
    core: [],
    versions: [],
    currentVersion: 0,
    foundations: 0,
    reforms: [],
    lastSeq: 0,
  };
}

/** La versión vigente, o `undefined` si todavía no hay constitución. */
export function currentVersionOf(state: ConstitutionState): ConstitutionVersion | undefined {
  return state.versions.find((v) => v.version === state.currentVersion);
}

/** El texto vigente, o `undefined`. */
export function currentText(state: ConstitutionState): ConstitutionText | undefined {
  return currentVersionOf(state)?.text;
}

/**
 * Una versión histórica cualquiera. Es la comprobación de que «se conservan todas»: tras N reformas,
 * `versionAt(state, k)` sigue devolviendo el texto exacto que estuvo vigente en su momento.
 */
export function versionAt(
  state: ConstitutionState,
  version: number,
): ConstitutionVersion | undefined {
  return state.versions.find((v) => v.version === version);
}

export function findReform(state: ConstitutionState, id: ReformId): ReformRecord | undefined {
  return state.reforms.find((r) => r.reformId === id);
}

/** Reformas abiertas: ni ratificadas ni rechazadas. Dos sobre la misma versión pueden coexistir. */
export function openReforms(state: ConstitutionState): readonly ReformRecord[] {
  return state.reforms.filter((r) => r.status === 'deliberando' || r.status === 'votada');
}

/** Los requisitos que aplican a una vía, dentro de un texto concreto. */
export function requirementsFor(text: ConstitutionText, kind: ReformKind): ReformRequirements {
  return kind === 'ordinaria' ? text.ordinary : text.entrenched;
}
