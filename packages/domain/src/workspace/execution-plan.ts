/** La promesa minima de ejecucion que se congela con cada version de propuesta. */

import { hashCanonical } from '../canonical.js';
import { PreconditionError } from '../errors.js';
import { isMemberId, type Hash, type Instant, type MemberId } from '../ids.js';
import { assertLedgerText, InvalidTextError, meaningfulLength } from './text.js';

export const MIN_EXECUTION_OBJECTIVE_LENGTH = 20;
export const MAX_EXECUTION_OBJECTIVE_LENGTH = 1000;
export const MIN_SUCCESS_CRITERIA = 1;
export const MAX_SUCCESS_CRITERIA = 10;
export const MIN_SUCCESS_DESCRIPTION_LENGTH = 20;
export const MAX_SUCCESS_DESCRIPTION_LENGTH = 500;
export const MIN_EVIDENCE_SOURCE_LENGTH = 5;
export const MAX_EVIDENCE_SOURCE_LENGTH = 500;

export interface SuccessCriterion {
  readonly description: string;
  readonly evidenceSource: string;
}

export interface ExecutionPlan {
  readonly objective: string;
  readonly responsibleId: MemberId;
  readonly reviewAt: Instant;
  readonly successCriteria: readonly SuccessCriterion[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}

function assertTextLength(
  text: unknown,
  field: string,
  min: number,
  max: number,
  code: string,
): asserts text is string {
  if (typeof text !== 'string') {
    throw new PreconditionError(code, `${field} debe ser texto`);
  }
  const length = meaningfulLength(text);
  if (length < min || text.length > max) {
    throw new PreconditionError(
      code,
      `${field} debe tener entre ${String(min)} y ${String(max)} caracteres; llegaron ${String(length)} significativos`,
    );
  }
  try {
    assertLedgerText(text, { field, min, max });
  } catch (error) {
    if (error instanceof InvalidTextError) throw new PreconditionError(code, error.message);
    throw error;
  }
}

/** Valida la forma persistente del plan, sin comparar su fecha con un reloj o evento posterior. */
export function validateExecutionPlanStructure(plan: unknown): asserts plan is ExecutionPlan {
  if (!isRecord(plan)) {
    throw new PreconditionError(
      'EXECUTION_PLAN_REQUIRED',
      'cada version nueva exige un plan de ejecucion',
    );
  }

  const candidate = plan;

  assertTextLength(
    candidate['objective'],
    'el objetivo del plan',
    MIN_EXECUTION_OBJECTIVE_LENGTH,
    MAX_EXECUTION_OBJECTIVE_LENGTH,
    'EXECUTION_PLAN_OBJECTIVE_LENGTH',
  );

  const responsibleId = candidate['responsibleId'];
  if (typeof responsibleId !== 'string' || !isMemberId(responsibleId)) {
    throw new PreconditionError(
      'EXECUTION_PLAN_RESPONSIBLE_INVALID',
      'el responsable debe ser un identificador opaco valido',
    );
  }

  const reviewAt = candidate['reviewAt'];
  if (typeof reviewAt !== 'number' || !Number.isSafeInteger(reviewAt) || reviewAt < 0) {
    throw new PreconditionError(
      'EXECUTION_PLAN_REVIEW_INVALID',
      'la fecha de revisión debe ser un instante válido',
    );
  }

  const rawCriteria = candidate['successCriteria'];
  if (!Array.isArray(rawCriteria)) {
    throw new PreconditionError(
      'EXECUTION_PLAN_CRITERIA_COUNT',
      `el plan exige entre ${String(MIN_SUCCESS_CRITERIA)} y ${String(MAX_SUCCESS_CRITERIA)} criterios de exito`,
    );
  }
  const successCriteria: readonly unknown[] = rawCriteria;
  if (
    successCriteria.length < MIN_SUCCESS_CRITERIA ||
    successCriteria.length > MAX_SUCCESS_CRITERIA
  ) {
    throw new PreconditionError(
      'EXECUTION_PLAN_CRITERIA_COUNT',
      `el plan exige entre ${String(MIN_SUCCESS_CRITERIA)} y ${String(MAX_SUCCESS_CRITERIA)} criterios de exito`,
    );
  }

  for (const criterion of successCriteria) {
    if (!isRecord(criterion)) {
      throw new PreconditionError(
        'EXECUTION_PLAN_CRITERION_INVALID',
        'cada criterio de exito debe declarar descripcion y fuente de evidencia',
      );
    }
    const criterionFields = criterion;
    assertTextLength(
      criterionFields['description'],
      'la descripcion del criterio de exito',
      MIN_SUCCESS_DESCRIPTION_LENGTH,
      MAX_SUCCESS_DESCRIPTION_LENGTH,
      'EXECUTION_PLAN_CRITERION_DESCRIPTION_LENGTH',
    );
    assertTextLength(
      criterionFields['evidenceSource'],
      'la fuente de evidencia del criterio de exito',
      MIN_EVIDENCE_SOURCE_LENGTH,
      MAX_EVIDENCE_SOURCE_LENGTH,
      'EXECUTION_PLAN_EVIDENCE_SOURCE_LENGTH',
    );
  }
}

/** Valida el plan cuando se acuerda: su revisión debe quedar después de esa versión. */
export function validateExecutionPlan(
  plan: unknown,
  createdAt: Instant,
): asserts plan is ExecutionPlan {
  validateExecutionPlanStructure(plan);
  if (plan.reviewAt <= createdAt) {
    throw new PreconditionError(
      'EXECUTION_PLAN_REVIEW_NOT_FUTURE',
      'la fecha de revisión debe ser posterior al instante de creación de la versión',
    );
  }
}

/** SHA-256 canonico de los cuatro campos, conservando el orden declarado de criterios. */
export async function executionPlanHash(plan: ExecutionPlan): Promise<Hash> {
  return hashCanonical({
    objective: plan.objective,
    responsibleId: plan.responsibleId,
    reviewAt: plan.reviewAt,
    successCriteria: plan.successCriteria.map((criterion) => ({
      description: criterion.description,
      evidenceSource: criterion.evidenceSource,
    })),
  });
}
