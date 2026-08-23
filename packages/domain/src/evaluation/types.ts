/**
 * Evaluación, resultado y aprendizajes: el último tramo del ciclo.
 *
 * ═══ Por qué los criterios NO viven en este agregado ═══
 *
 * La regla del ADR-0033 es que los criterios se fijan **antes** de acordar, para que nadie elija
 * después la vara que pasa. Guardar aquí una copia editable de esos criterios haría de esa regla una
 * comprobación —y una comprobación se quita—. Así que no hay copia: los criterios viven congelados
 * en el `ExecutionPlan` de la propuesta (ADR-0043), cuyo hash entra en la huella de la versión y por
 * ahí en el `configHash` de la decisión. Este agregado guarda **la huella y el número**, nunca el
 * texto.
 *
 * Para evaluar hay que aportar los criterios, y sólo se aportan a través de `freezeSuccessCriteria`,
 * que devuelve un objeto marcado con un `Symbol` **no serializable**: no se puede fabricar desde
 * JSON, ni desde la base de datos, ni desde una petición HTTP. El pliegue compara la huella de lo
 * aportado contra la huella sellada en el evento génesis y rechaza cualquier diferencia. Es la misma
 * construcción que `buildDecisionConfig` (congelar + hash) y que `TaskCapacityAdmission` (marca de
 * símbolo), puestas en serie:
 *
 *  - alterar el texto de un criterio ⇒ otra `planHash` ⇒ **el pliegue lanza**;
 *  - alterar la `planHash` del evento ⇒ deja de coincidir con el plan real ⇒ **el pliegue lanza**;
 *  - alterar las dos ⇒ el `hash` del evento deja de recomputarse ⇒ **la cadena lanza**;
 *  - inventar un `FrozenCriteria` a mano ⇒ no lleva la marca ⇒ **el pliegue lanza**.
 *
 * No hay ninguna ruta en la que unos criterios distintos de los acordados lleguen a contarse.
 *
 * ═══ Por qué aquí no hay ni un dato de actividad por persona ═══
 *
 * ADR-0040 prohíbe las métricas de actividad individual. La prohibición no se cumple «no publicando»
 * un dato que sí se calcula: se cumple **no teniendo dónde ponerlo**. Ningún payload de este agregado
 * admite un `MemberId`, y la proyección no conserva el `actor` de ningún evento. Quién escribió cada
 * hecho sigue en el log encadenado —como en todo el sistema—, pero la evaluación no lo proyecta, no
 * lo agrega y no lo compara. `assertNoIndividualActivityMetric` lo comprueba sobre la salida real.
 */

import { deepFreeze, type JsonObject, type JsonValue } from '../canonical.js';
import { InvalidIdError, PreconditionError } from '../errors.js';
import { cmpFraction, type Fraction, ONE, ratio } from '../fraction.js';
import {
  type Brand,
  type CircleId,
  compareIds,
  type DecisionId,
  type EventId,
  type Hash,
  ID_PATTERN,
  type InitiativeId,
  type Instant,
  isStrictlySorted,
  LABEL_PATTERN,
  type MemberId,
  type ProposalId,
  type TaskId,
} from '../ids.js';
import type { ChainedEvent, ChainedLog } from '../workspace/chain.js';
import {
  type ExecutionPlan,
  executionPlanHash,
  MAX_SUCCESS_CRITERIA,
  MIN_SUCCESS_CRITERIA,
  type SuccessCriterion,
  validateExecutionPlanStructure,
} from '../workspace/execution-plan.js';
import {
  type OutcomeCriterionEvidence,
  OUTCOME_CRITERION_EVIDENCE,
} from '../workspace/initiative.js';
import { assertLedgerText, InvalidTextError } from '../workspace/text.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Identificadores
// ═════════════════════════════════════════════════════════════════════════════════════════════

export type EvaluationId = Brand<string, 'EvaluationId'>;
export type LearningId = Brand<string, 'LearningId'>;
/** Etiqueta de recuperación de un aprendizaje. Es una etiqueta, no un identificador opaco. */
export type LearningTag = Brand<string, 'LearningTag'>;

const OPAQUE = '32 caracteres hexadecimales en minúscula';

export function evaluationId(value: string): EvaluationId {
  if (!ID_PATTERN.test(value)) throw new InvalidIdError('EvaluationId', value, OPAQUE);
  return value as EvaluationId;
}

export function learningId(value: string): LearningId {
  if (!ID_PATTERN.test(value)) throw new InvalidIdError('LearningId', value, OPAQUE);
  return value as LearningId;
}

export function learningTag(value: string): LearningTag {
  if (!LABEL_PATTERN.test(value)) {
    throw new InvalidIdError('LearningTag', value, 'una etiqueta [a-z][a-z0-9_]{0,31}');
  }
  return value as LearningTag;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Vocabularios cerrados
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Qué pasó con **un criterio**. Nunca con una persona.
 *
 * `sin-evidencia` no es un fallo del criterio: es la constatación de que no se puede afirmar nada.
 * Existe para que el silencio produzca `inconcluso` y no `logrado`, que es la diferencia entre una
 * evaluación y un acta.
 */
export const CRITERION_VERDICTS = ['cumplido', 'incumplido', 'sin-evidencia', 'no-aplica'] as const;
export type CriterionVerdict = (typeof CRITERION_VERDICTS)[number];

/**
 * El resultado de la evaluación. Es **derivado** (ADR-0026): se recomputa desde los veredictos cada
 * vez y no se lee de ningún campo.
 */
export const EVALUATION_OUTCOMES = ['logrado', 'parcial', 'fallido', 'inconcluso'] as const;
export type EvaluationOutcome = (typeof EVALUATION_OUTCOMES)[number];

/**
 * Qué se hace con el acuerdo después de mirarlo (ADR-0033: `AgreementKept`, `AgreementAmended`,
 * `AgreementRepealed`, `AgreementEscalated`).
 */
export const AGREEMENT_DISPOSITIONS = ['mantener', 'enmendar', 'derogar', 'escalar'] as const;
export type AgreementDisposition = (typeof AGREEMENT_DISPOSITIONS)[number];

/**
 * Los dos únicos escalones que una **evaluación** puede pulsar, y en este orden.
 *
 * La escalera completa de ADR-0040 tiene siete escalones, pero cinco de ellos —`por-vencer`,
 * `atrasada`, `bloqueada`, `en-apoyo`, `reasignada`— los mueve la máquina de la tarea y sólo quien
 * la asumió: una evaluación que pudiera declarar un bloqueo ajeno estaría hablando por otra persona.
 * Y `dominio-suspendido` **no está aquí y no debe estarlo**: el ADR dice «excepcional, nunca
 * automático, con consentimiento del círculo y apelable», y un vocabulario que lo admitiera lo
 * volvería alcanzable desde una función.
 *
 * Queda lo que una evaluación sí puede hacer sin hablar por nadie: **preguntar** y, si la pregunta
 * no alcanza, **llevarlo al colectivo**. En ese orden, y el pliegue lo exige.
 */
export const ESCALATION_RUNGS = ['consultada', 'en-revision-colectiva'] as const;
export type EscalationRung = (typeof ESCALATION_RUNGS)[number];

/**
 * Sobre qué escala el incumplimiento. Los tres son objetos, no personas: la tarea, el acuerdo o la
 * carga del círculo. Es literalmente la frase del ADR-0040 —«el objeto es el acuerdo o la carga, no
 * la persona»— con la tarea añadida, que es donde el propio ADR pone la escalera.
 */
export const ESCALATION_TARGET_KINDS = ['tarea', 'acuerdo', 'carga'] as const;
export type EscalationTargetKind = (typeof ESCALATION_TARGET_KINDS)[number];

/** De qué habla un aprendizaje. Cuatro casillas, ninguna con nombre propio. */
export const LEARNING_KINDS = [
  'lo-que-funciono',
  'lo-que-no-funciono',
  'lo-que-faltaba-saber',
  'lo-que-no-hay-que-repetir',
] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════════════════════════

export const MIN_LEARNING_STATEMENT_LENGTH = 40;
export const MAX_LEARNING_STATEMENT_LENGTH = 1000;
export const MAX_LEARNING_TAGS = 8;
export const MAX_LEARNINGS_PER_EVALUATION = 50;

/**
 * Suelo exacto de `parcial`: la mitad de los criterios aplicables (ADR-0027, sin punto flotante).
 *
 * Es una **constante del dominio y no un parámetro**. Un umbral configurable por evaluación sería la
 * vara elegida a posteriori con otro nombre: bastaría con ponerlo bajo para que «parcial» significara
 * lo que uno quisiera. Cambiarlo exige cambiar este fichero, y eso se ve en una revisión.
 */
export const EVALUATION_PARTIAL_FLOOR: Fraction = { num: 1n, den: 2n };

const DAY_MS = 86_400_000;

/**
 * Prescripción de una escalada: dos semestres (ADR-0040). Los aprendizajes **no prescriben**; las
 * escaladas sí. Lo que sobrevive del fracaso es lo que enseña, no lo que señala.
 */
export const ESCALATION_PRESCRIPTION_MS = 2 * 180 * DAY_MS;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Criterios congelados: la marca que no se puede fabricar
// ═════════════════════════════════════════════════════════════════════════════════════════════

const FROZEN_CRITERIA = Symbol('FrozenCriteria');

/**
 * Los criterios acordados, con su huella. **Sólo `freezeSuccessCriteria` los emite.**
 *
 * La marca es un `Symbol` de módulo: no viaja en JSON, no sale de PostgreSQL y no se reconstruye
 * desde una petición. Un adaptador que quiera evaluar tiene que leer el plan real de la iniciativa y
 * pasarlo por aquí; no hay atajo.
 */
export interface FrozenCriteria {
  readonly [FROZEN_CRITERIA]: true;
  /** `executionPlanHash` del plan acordado. Es el eslabón con la versión, la decisión y el padrón. */
  readonly planHash: Hash;
  readonly objective: string;
  readonly responsibleId: MemberId;
  readonly reviewAt: Instant;
  readonly criteria: readonly SuccessCriterion[];
}

/** Congela los criterios de un plan ya acordado y calcula su huella. Es asíncrona una sola vez. */
export async function freezeSuccessCriteria(plan: ExecutionPlan): Promise<FrozenCriteria> {
  validateExecutionPlanStructure(plan);
  const planHash = await executionPlanHash(plan);
  const frozen: FrozenCriteria = {
    [FROZEN_CRITERIA]: true,
    planHash,
    objective: plan.objective,
    responsibleId: plan.responsibleId,
    reviewAt: plan.reviewAt,
    criteria: plan.successCriteria.map((criterion) => ({
      description: criterion.description,
      evidenceSource: criterion.evidenceSource,
    })),
  };
  // `readonly` es una promesa del compilador; `Object.freeze` es un hecho de tiempo de ejecución.
  return deepFreeze(frozen);
}

/**
 * Comprueba la marca. Sin ella no hay evaluación: se falla cerrado.
 *
 * El parámetro ya viene tipado, y aun así se mira en tiempo de ejecución: el tipo se borra al
 * compilar y lo que llega de una base de datos o de una petición no lo respeta.
 */
export function assertFrozenCriteria(value: FrozenCriteria): void {
  const candidate: unknown = value;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    (candidate as Partial<FrozenCriteria>)[FROZEN_CRITERIA] !== true
  ) {
    throw new PreconditionError(
      'FROZEN_CRITERIA_REQUIRED',
      'los criterios sólo entran a la evaluación por freezeSuccessCriteria: un objeto construido ' +
        'a mano, leído de la base o recibido por HTTP no lleva la marca y no se acepta',
    );
  }
  const criteria: unknown = (candidate as Record<string, unknown>)['criteria'];
  if (
    !Array.isArray(criteria) ||
    criteria.length < MIN_SUCCESS_CRITERIA ||
    criteria.length > MAX_SUCCESS_CRITERIA
  ) {
    throw new PreconditionError(
      'FROZEN_CRITERIA_REQUIRED',
      'los criterios congelados no tienen la cardinalidad que el plan exige',
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El resultado, que es una función y no un campo
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * El desenlace, recomputado desde los veredictos. Aritmética exacta (ADR-0027).
 *
 * Cuatro reglas, y las cuatro asimétricas a propósito:
 *
 *  1. **Un solo criterio sin evidencia vuelve todo `inconcluso`.** Un criterio que nadie miró no se
 *     redondea a favor. Como los criterios sin evaluar entran aquí como `undefined` y se leen
 *     `sin-evidencia`, el silencio produce `inconcluso` — nunca `logrado`. Dejar de evaluar no es
 *     una forma de aprobar.
 *  2. **Cero de cero no es unanimidad, es ausencia** (ADR-0027 B.0.d): si todos los criterios son
 *     `no-aplica`, el resultado es `inconcluso`, no `logrado`.
 *  3. `logrado` exige `cumplidos / aplicables = 1` **exacto**, comparado por multiplicación cruzada.
 *  4. Por debajo del suelo exacto de `parcial`, `fallido`.
 *
 * Lo que **no** entra en esta función: cuántas tareas se completaron, cuántas quedan abiertas, quién
 * las hizo y qué votó nadie. No es una omisión: completar las tareas es haber trabajado, no haber
 * conseguido, y una votación mide acuerdo, no efecto.
 */
export function outcomeFromVerdicts(
  verdicts: readonly (CriterionVerdict | undefined)[],
): EvaluationOutcome {
  let applicable = 0;
  let met = 0;
  let missing = 0;
  for (const raw of verdicts) {
    const verdict: CriterionVerdict = raw ?? 'sin-evidencia';
    if (verdict === 'no-aplica') continue;
    applicable += 1;
    if (verdict === 'cumplido') met += 1;
    else if (verdict === 'sin-evidencia') missing += 1;
  }
  if (missing > 0) return 'inconcluso';
  if (applicable === 0) return 'inconcluso';
  const share = ratio(met, applicable);
  if (cmpFraction(share, ONE) === 0) return 'logrado';
  return cmpFraction(share, EVALUATION_PARTIAL_FLOOR) >= 0 ? 'parcial' : 'fallido';
}

/** `cumplidos de aplicables`, exacta. `undefined` cuando no hay aplicables: cero de cero no es nada. */
export function metShare(
  verdicts: readonly (CriterionVerdict | undefined)[],
): Fraction | undefined {
  let applicable = 0;
  let met = 0;
  for (const raw of verdicts) {
    const verdict: CriterionVerdict = raw ?? 'sin-evidencia';
    if (verdict === 'no-aplica') continue;
    applicable += 1;
    if (verdict === 'cumplido') met += 1;
  }
  return applicable === 0 ? undefined : ratio(met, applicable);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Hechos del agregado
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface EvaluationOpened {
  readonly type: 'EvaluationOpened';
  readonly initiativeId: InitiativeId;
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly circleId: CircleId;
  /** Huella de los criterios acordados. **No** los criterios: la huella. */
  readonly planHash: Hash;
  readonly criteriaCount: number;
  /** La fecha comprometida del ADR-0033. Antes de ella no se evalúa. */
  readonly reviewAt: Instant;
}

export interface CriterionAssessed {
  readonly type: 'CriterionAssessed';
  readonly criterionIndex: number;
  readonly verdict: CriterionVerdict;
  /** Categoría cerrada del ADR-0045: qué tan comprobada está la evidencia. */
  readonly evidence: OutcomeCriterionEvidence;
  /** Evento de la iniciativa que sostiene el veredicto. Obligatorio sólo para `cumplido`. */
  readonly evidenceRef?: EventId;
}

export interface EvaluationEscalated {
  readonly type: 'EvaluationEscalated';
  readonly criterionIndex: number;
  readonly rung: EscalationRung;
  readonly targetKind: EscalationTargetKind;
  /** Sólo cuando el objeto es una tarea. **Nunca** hay aquí un identificador de persona. */
  readonly taskId?: TaskId;
}

export interface LearningRecorded {
  readonly type: 'LearningRecorded';
  readonly learningId: LearningId;
  readonly kind: LearningKind;
  readonly statement: string;
  /** Etiquetas canónicas, estrictamente ordenadas. Son la vía de «¿esto ya se intentó?». */
  readonly tags: readonly LearningTag[];
}

export interface EvaluationResultPublished {
  readonly type: 'EvaluationResultPublished';
  /** Proyección, no fuente de verdad (ADR-0026). El pliegue lo recomputa y compara. */
  readonly outcome: EvaluationOutcome;
  readonly outcomeHash: Hash;
}

export interface EvaluationClosed {
  readonly type: 'EvaluationClosed';
  readonly disposition: AgreementDisposition;
  /** Obligatoria al **mantener**: la inercia no renueva sola (ADR-0033). */
  readonly nextReviewAt?: Instant;
}

export type EvaluationPayload =
  | EvaluationOpened
  | CriterionAssessed
  | EvaluationEscalated
  | LearningRecorded
  | EvaluationResultPublished
  | EvaluationClosed;

export type EvaluationEventType = EvaluationPayload['type'];

export const EVALUATION_EVENT_TYPES: readonly EvaluationEventType[] = [
  'EvaluationOpened',
  'CriterionAssessed',
  'EvaluationEscalated',
  'LearningRecorded',
  'EvaluationResultPublished',
  'EvaluationClosed',
];

export type EvaluationEvent = ChainedEvent<EvaluationPayload>;
export type EvaluationLog = ChainedLog<EvaluationPayload>;

/**
 * Los tres estados escritos del agregado.
 *
 * `anulada-por-inconsistencia` **no está aquí**: no es un estado que alguien escriba, es lo que se
 * deriva de comparar lo publicado con lo recomputado (ADR-0026). Ponerlo en esta lista lo convertiría
 * en algo que se puede evitar no escribiéndolo.
 */
export const EVALUATION_STATUSES = ['en-curso', 'publicada', 'cerrada'] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Forma exacta del payload: el vocabulario cerrado que el pliegue exige ANTES de mirar nada
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface PayloadShape {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

const EVALUATION_PAYLOAD_SHAPES: Readonly<Record<EvaluationPayload['type'], PayloadShape>> = {
  EvaluationOpened: {
    required: [
      'type',
      'initiativeId',
      'decisionId',
      'proposalId',
      'circleId',
      'planHash',
      'criteriaCount',
      'reviewAt',
    ],
  },
  CriterionAssessed: {
    required: ['type', 'criterionIndex', 'verdict', 'evidence'],
    optional: ['evidenceRef'],
  },
  EvaluationEscalated: {
    required: ['type', 'criterionIndex', 'rung', 'targetKind'],
    optional: ['taskId'],
  },
  LearningRecorded: {
    required: ['type', 'learningId', 'kind', 'statement', 'tags'],
  },
  EvaluationResultPublished: {
    required: ['type', 'outcome', 'outcomeHash'],
  },
  EvaluationClosed: {
    required: ['type', 'disposition'],
    optional: ['nextReviewAt'],
  },
};

function assertExactArrayPayload(
  value: unknown,
  detail: string,
): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new PreconditionError('INVALID_EVALUATION_ARRAY_PAYLOAD', detail);
  }
  const expected = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    'length',
  ]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !expected.has(key)) {
      throw new PreconditionError('INVALID_EVALUATION_ARRAY_PAYLOAD', detail);
    }
    if (key !== 'length') {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new PreconditionError('INVALID_EVALUATION_ARRAY_PAYLOAD', detail);
      }
    }
  }
}

/**
 * Rechaza cualquier payload que no sea **exactamente** uno de los seis hechos.
 *
 * Comprueba prototipo, descriptores y campos uno a uno, igual que el agregado de iniciativa: un
 * `getter` que devuelve una cosa al validar y otra al hashear es el ataque que un `typeof` no ve.
 * Es lo primero que hace el pliegue, antes de leer ningún valor.
 */
export function assertExactEvaluationPayload(value: unknown): asserts value is EvaluationPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PreconditionError(
      'INVALID_EVALUATION_PAYLOAD',
      'el payload de evaluación debe ser un objeto explícito',
    );
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PreconditionError(
      'INVALID_EVALUATION_PAYLOAD',
      'el payload de evaluación debe ser un objeto plano',
    );
  }
  const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'type');
  if (typeDescriptor === undefined || !typeDescriptor.enumerable || !('value' in typeDescriptor)) {
    throw new PreconditionError(
      'INVALID_EVALUATION_PAYLOAD',
      'el tipo del evento debe ser un dato propio y enumerable',
    );
  }
  const type: unknown = typeDescriptor.value;
  if (
    typeof type !== 'string' ||
    !Object.prototype.hasOwnProperty.call(EVALUATION_PAYLOAD_SHAPES, type)
  ) {
    throw new PreconditionError(
      'UNKNOWN_EVALUATION_EVENT_TYPE',
      'el tipo de evento de evaluación no pertenece al vocabulario cerrado',
    );
  }
  const shape = EVALUATION_PAYLOAD_SHAPES[type as EvaluationPayload['type']];
  const allowed = new Set([...shape.required, ...(shape.optional ?? [])]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new PreconditionError(
        'EVALUATION_PAYLOAD_UNKNOWN_FIELD',
        'el payload de evaluación contiene un campo no permitido para ese evento',
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      throw new PreconditionError(
        'INVALID_EVALUATION_PAYLOAD',
        'todo campo del payload debe ser un dato propio y enumerable',
      );
    }
  }
  for (const key of shape.required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.value === undefined
    ) {
      throw new PreconditionError(
        'EVALUATION_PAYLOAD_MISSING_FIELD',
        'el payload de evaluación no contiene todos los campos exigidos por ese evento',
      );
    }
  }
  for (const key of shape.optional ?? []) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor && descriptor.value === undefined) {
      throw new PreconditionError(
        'INVALID_EVALUATION_PAYLOAD',
        'un campo opcional ausente debe omitirse en lugar de serializarse como undefined',
      );
    }
  }
  if (type === 'LearningRecorded') {
    assertExactArrayPayload(
      (value as Record<string, unknown>)['tags'],
      'la lista de etiquetas contiene propiedades desconocidas o no canónicas',
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Validación de valores
// ═════════════════════════════════════════════════════════════════════════════════════════════

export function isCriterionVerdict(value: string): value is CriterionVerdict {
  return (CRITERION_VERDICTS as readonly string[]).includes(value);
}

export function isEvaluationOutcome(value: string): value is EvaluationOutcome {
  return (EVALUATION_OUTCOMES as readonly string[]).includes(value);
}

function assertMember<T extends string>(
  value: string,
  vocabulary: readonly T[],
  code: string,
  detail: string,
): asserts value is T {
  if (!(vocabulary as readonly string[]).includes(value)) {
    throw new PreconditionError(code, detail);
  }
}

/** Las cuatro reglas que ligan veredicto y evidencia. La asimetría es el punto entero. */
export function assertVerdictEvidence(payload: CriterionAssessed): void {
  assertMember(
    payload.verdict,
    CRITERION_VERDICTS,
    'UNKNOWN_CRITERION_VERDICT',
    'el veredicto de un criterio no pertenece al vocabulario cerrado',
  );
  assertMember(
    payload.evidence,
    OUTCOME_CRITERION_EVIDENCE,
    'UNKNOWN_CRITERION_EVIDENCE',
    'la categoría de evidencia no pertenece al vocabulario cerrado del ADR-0045',
  );
  const hasRef = payload.evidenceRef !== undefined;
  switch (payload.verdict) {
    case 'cumplido':
      // Afirmar que algo se logró cuesta un hecho: una evidencia verificada y el evento que la
      // sostiene. Declarar que no se logró no cuesta nada. Esa asimetría es lo que impide que la
      // evaluación sea teatro sin obligar a nadie a confesar.
      if (payload.evidence !== 'verificada' || !hasRef) {
        throw new PreconditionError(
          'CRITERION_MET_NEEDS_EVIDENCE',
          'un criterio sólo se declara cumplido con evidencia verificada y con el evento de la ' +
            'iniciativa que la sostiene; una afirmación sin hecho no cuenta',
        );
      }
      break;
    case 'incumplido':
      if (payload.evidence === 'no-aplica') {
        throw new PreconditionError(
          'CRITERION_UNMET_EVIDENCE_MISMATCH',
          'un criterio incumplido no puede declarar su evidencia como no aplicable',
        );
      }
      break;
    case 'sin-evidencia':
      if (payload.evidence !== 'sin-verificar' || hasRef) {
        throw new PreconditionError(
          'CRITERION_MISSING_EVIDENCE_MISMATCH',
          'declarar que falta evidencia excluye señalar una: si hay evento que mirar, el criterio ' +
            'está cumplido o incumplido, no sin evidencia',
        );
      }
      break;
    case 'no-aplica':
      if (payload.evidence !== 'no-aplica' || hasRef) {
        throw new PreconditionError(
          'CRITERION_NOT_APPLICABLE_MISMATCH',
          'un criterio que no aplica no lleva evidencia ni evento asociado',
        );
      }
      break;
  }
}

/** Texto y etiquetas de un aprendizaje. Las etiquetas van canónicas para que la huella sea estable. */
export function assertLearningShape(payload: LearningRecorded): void {
  learningId(payload.learningId);
  assertMember(
    payload.kind,
    LEARNING_KINDS,
    'UNKNOWN_LEARNING_KIND',
    'el tipo de aprendizaje no pertenece al vocabulario cerrado',
  );
  if (typeof payload.statement !== 'string') {
    throw new PreconditionError('INVALID_LEARNING_STATEMENT', 'el aprendizaje debe ser texto');
  }
  try {
    assertLedgerText(payload.statement, {
      field: 'el aprendizaje',
      min: MIN_LEARNING_STATEMENT_LENGTH,
      max: MAX_LEARNING_STATEMENT_LENGTH,
    });
  } catch (error) {
    if (error instanceof InvalidTextError) {
      throw new PreconditionError('INVALID_LEARNING_STATEMENT', error.message);
    }
    throw error;
  }
  if (payload.tags.length > MAX_LEARNING_TAGS) {
    throw new PreconditionError(
      'TOO_MANY_LEARNING_TAGS',
      `un aprendizaje admite hasta ${String(MAX_LEARNING_TAGS)} etiquetas`,
    );
  }
  for (const tag of payload.tags) learningTag(tag);
  if (!isStrictlySorted(payload.tags)) {
    throw new PreconditionError(
      'LEARNING_TAGS_NOT_CANONICAL',
      'las etiquetas viajan estrictamente ordenadas y sin repetir: un conjunto se serializa como ' +
        'arreglo ordenado (ADR-0004)',
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Registros de la proyección. Ninguno lleva el actor del evento.
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface CriterionAssessmentRecord {
  readonly criterionIndex: number;
  readonly verdict: CriterionVerdict;
  readonly evidence: OutcomeCriterionEvidence;
  readonly evidenceRef: EventId | undefined;
  readonly at: Instant;
  readonly seq: number;
}

export interface LearningRecord {
  readonly learningId: LearningId;
  readonly kind: LearningKind;
  readonly statement: string;
  readonly tags: readonly LearningTag[];
  readonly at: Instant;
  readonly seq: number;
}

export interface EscalationRecord {
  /** Es exactamente el `eventId` de `EvaluationEscalated`. */
  readonly escalationId: EventId;
  readonly criterionIndex: number;
  readonly rung: EscalationRung;
  readonly targetKind: EscalationTargetKind;
  readonly taskId: TaskId | undefined;
  readonly at: Instant;
  readonly seq: number;
}

export interface PublishedResult {
  readonly outcome: EvaluationOutcome;
  readonly outcomeHash: Hash;
  readonly at: Instant;
  readonly seq: number;
}

export interface EvaluationClosure {
  readonly disposition: AgreementDisposition;
  readonly nextReviewAt: Instant | undefined;
  readonly at: Instant;
}

/** Lo publicado no coincide con lo recomputado. Se **declara**; no se corrige y no se oculta. */
export interface EvaluationDiscrepancy {
  readonly reason: 'outcome-mismatch' | 'outcome-hash-mismatch';
  readonly published: EvaluationOutcome;
  readonly recomputed: EvaluationOutcome;
}

/**
 * La proyección. Nótese lo que **no** tiene: ni un `actor`, ni un `MemberId`, ni un contador por
 * persona. `assertNoIndividualActivityMetric` lo comprueba, y el pliegue la usa contra sí mismo.
 *
 * Tampoco tiene los criterios: sólo su huella y su número. Los criterios se aportan al plegar.
 */
export interface EvaluationState {
  readonly evaluationId: EvaluationId;
  readonly initiativeId: InitiativeId;
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly circleId: CircleId;
  readonly planHash: Hash;
  readonly criteriaCount: number;
  readonly reviewAt: Instant;
  readonly status: EvaluationStatus;
  readonly openedAt: Instant;
  /** Historial completo: corregir un veredicto no borra el anterior. */
  readonly assessments: readonly CriterionAssessmentRecord[];
  /** Veredicto vigente por índice. `undefined` = nadie lo miró todavía, que no es «sin evidencia». */
  readonly verdicts: readonly (CriterionVerdict | undefined)[];
  readonly learnings: readonly LearningRecord[];
  readonly escalations: readonly EscalationRecord[];
  readonly published: PublishedResult | undefined;
  readonly closure: EvaluationClosure | undefined;
  readonly discrepancy: EvaluationDiscrepancy | undefined;
  /** Índice de replay: impide que cualquier evento reutilice un `eventId` anterior (ABA). */
  readonly eventIds: readonly EventId[];
  readonly lastSeq: number;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Memoria institucional
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Una fila de la memoria: qué se decidió, qué se hizo, cómo salió y qué se aprendió.
 *
 * No lleva quién. La rotación del colectivo es del 20 % anual, así que una memoria atada a personas
 * caduca con ellas; una atada a la decisión, la propuesta y el círculo sobrevive a que se gradúen.
 */
export interface LearningIndexEntry {
  readonly evaluationId: EvaluationId;
  readonly initiativeId: InitiativeId;
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly circleId: CircleId;
  /** El desenlace **recomputado**, nunca el publicado. */
  readonly outcome: EvaluationOutcome;
  readonly disposition: AgreementDisposition | undefined;
  readonly learning: LearningRecord;
}

export interface LearningQuery {
  /** Cualquiera de estas etiquetas (unión). Vacío o ausente ⇒ no filtra por etiqueta. */
  readonly tags?: readonly LearningTag[] | undefined;
  readonly kinds?: readonly LearningKind[] | undefined;
  readonly outcomes?: readonly EvaluationOutcome[] | undefined;
  readonly circleId?: CircleId | undefined;
  readonly decisionId?: DecisionId | undefined;
}

function matchesAny<T extends string>(value: T, filter: readonly T[] | undefined): boolean {
  return filter === undefined || filter.length === 0 || filter.includes(value);
}

/**
 * «¿Esto ya se intentó?».
 *
 * Determinista y sin locale: el filtro es por etiquetas canónicas y el orden es por instante
 * descendente y, a igualdad, por identificador byte a byte (`compareIds`, ADR-0004). Dos personas
 * que preguntan lo mismo ven exactamente la misma lista, hoy y dentro de cinco años.
 */
export function findLearnings(
  entries: readonly LearningIndexEntry[],
  query: LearningQuery = {},
): readonly LearningIndexEntry[] {
  const wanted = query.tags;
  const selected = entries.filter((entry) => {
    if (!matchesAny(entry.learning.kind, query.kinds)) return false;
    if (!matchesAny(entry.outcome, query.outcomes)) return false;
    if (query.circleId !== undefined && entry.circleId !== query.circleId) return false;
    if (query.decisionId !== undefined && entry.decisionId !== query.decisionId) return false;
    if (wanted === undefined || wanted.length === 0) return true;
    return entry.learning.tags.some((tag) => wanted.includes(tag));
  });
  return [...selected].sort((a, b) =>
    a.learning.at === b.learning.at
      ? compareIds(a.learning.learningId, b.learning.learningId)
      : b.learning.at - a.learning.at,
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La prohibición del ADR-0040, comprobable sobre la salida real
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Nombres de campo con los que este dominio nombra a una persona. Ninguno puede aparecer en una
 * salida de evaluación.
 */
const PERSON_BEARING_KEYS: readonly string[] = [
  'actor',
  'assignee',
  'assigneeId',
  'author',
  'authorId',
  'by',
  'delegate',
  'deliveredBy',
  'endedBy',
  'memberId',
  'offeredTo',
  'owner',
  'ownerId',
  'principal',
  'requestedBy',
  'responsibleId',
  'subject',
  'voter',
];

export class IndividualMetricError extends PreconditionError {
  readonly path: string;

  constructor(path: string, detail: string) {
    super('INDIVIDUAL_ACTIVITY_METRIC', `${path === '' ? '<raíz>' : path}: ${detail}`);
    this.name = 'IndividualMetricError';
    this.path = path;
  }
}

/**
 * Lanza si una salida contiene una métrica de actividad por persona (ADR-0040).
 *
 * La comprobación no busca la palabra «ranking»: busca **a la persona**. Rechaza (a) cualquier objeto
 * indexado por un identificador opaco —que es la forma que tiene un panel por miembro— y (b)
 * cualquier campo con el que este dominio nombra a alguien. Si en la salida no hay nadie, no puede
 * haber una cifra sobre nadie; y la única manera de meter a alguien es cambiar este fichero, que es
 * exactamente donde queremos que se vea.
 *
 * Se llama sobre la salida de verdad, no sobre el tipo: un tipo se borra al compilar.
 */
export function assertNoIndividualActivityMetric(value: unknown, path = ''): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoIndividualActivityMetric(value[i], `${path}[${String(i)}]`);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (ID_PATTERN.test(key)) {
      throw new IndividualMetricError(
        path,
        'la salida está indexada por un identificador opaco; una serie por persona es exactamente ' +
          'lo que el ADR-0040 prohíbe, aunque nadie la ordene',
      );
    }
    if (PERSON_BEARING_KEYS.includes(key)) {
      throw new IndividualMetricError(
        path === '' ? key : `${path}.${key}`,
        'la evaluación no proyecta a las personas: el incumplimiento escala sobre la tarea, el ' +
          'acuerdo o la carga (ADR-0040)',
      );
    }
    assertNoIndividualActivityMetric(
      (value as Record<string, unknown>)[key],
      path === '' ? key : `${path}.${key}`,
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Preimagen del resultado
// ═════════════════════════════════════════════════════════════════════════════════════════════

export interface EvaluationOutcomePreimageInput {
  readonly evaluationId: EvaluationId;
  readonly initiativeId: InitiativeId;
  readonly decisionId: DecisionId;
  readonly proposalId: ProposalId;
  readonly circleId: CircleId;
  readonly planHash: Hash;
  readonly reviewAt: Instant;
  readonly verdicts: readonly (CriterionVerdict | undefined)[];
  readonly outcome: EvaluationOutcome;
  /** `seq` del `EvaluationResultPublished`. Ata el resultado al punto exacto del historial. */
  readonly publishedAtSeq: number;
}

/**
 * Lo que se hashea. Incluye `planHash`, así que un resultado calculado contra otros criterios
 * produce otra huella: la promesa evaluada es parte del resultado, no un contexto suyo.
 */
export function evaluationOutcomePreimage(input: EvaluationOutcomePreimageInput): JsonObject {
  const preimage: Record<string, JsonValue> = {
    evaluationId: input.evaluationId,
    initiativeId: input.initiativeId,
    decisionId: input.decisionId,
    proposalId: input.proposalId,
    circleId: input.circleId,
    planHash: input.planHash,
    reviewAt: input.reviewAt,
    verdicts: input.verdicts.map((verdict) => verdict ?? 'sin-evidencia'),
    outcome: input.outcome,
    publishedAtSeq: input.publishedAtSeq,
  };
  return preimage;
}
