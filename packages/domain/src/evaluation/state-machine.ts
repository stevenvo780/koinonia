/**
 * La máquina de la evaluación.
 *
 * ```
 *   inexistente ──EvaluationOpened──────────▶ en-curso
 *
 *   en-curso ──CriterionAssessed───────────▶ en-curso
 *   en-curso ──EvaluationEscalated─────────▶ en-curso
 *   en-curso ──LearningRecorded────────────▶ en-curso
 *   en-curso ──EvaluationResultPublished───▶ publicada
 *
 *   publicada ──LearningRecorded───────────▶ publicada
 *   publicada ──EvaluationEscalated────────▶ publicada
 *   publicada ──EvaluationClosed───────────▶ cerrada
 *
 *   cerrada: absorbente
 * ```
 *
 * ═══ Las prohibiciones que importan salen de la tabla, sin un solo `if` ═══
 *
 *  1. **`publicada + CriterionAssessed` es ilegal.** Después de publicar no se vuelve a mover un
 *     veredicto. Si se pudiera, el resultado recomputado cambiaría bajo un resultado ya publicado y
 *     la discrepancia del ADR-0026 dejaría de significar «alguien tocó el registro» para significar
 *     «alguien siguió trabajando». La corrección de un veredicto existe —mientras la evaluación está
 *     `en-curso`— y ahí es donde debe estar.
 *  2. **`en-curso + EvaluationClosed` es ilegal.** No se cierra un acuerdo sin haber publicado qué
 *     pasó. Cerrar sin resultado es exactamente el «actas impecables, realidad idéntica» del
 *     ADR-0033.
 *  3. **`cerrada` es absorbente.** Una evaluación cerrada no se reabre ni se «reconsidera»: lo que
 *     sigue es otra evaluación, con su fecha de revisión y sus criterios.
 *  4. **`inexistente` sólo acepta `EvaluationOpened`.** Sin génesis no hay criterios sellados contra
 *     los que contrastar, y sin eso no hay evaluación sino opinión.
 *
 * ═══ La anulación por inconsistencia NO es una transición ═══
 *
 * `evaluationPublicStatus` la **deriva** comparando lo publicado con lo recomputado. Igual que la
 * caducidad de la constitución, no tiene evento: si hiciera falta que alguien escribiera «esto no
 * cuadra», el registro manipulado seguiría en pie mientras nadie mirara, que es justo al revés de
 * lo que el ADR-0026 pide.
 */

import { IllegalTransitionError } from '../errors.js';
import type {
  EvaluationDiscrepancy,
  EvaluationEventType,
  EvaluationState,
  EvaluationStatus,
} from './types.js';

/** Pseudo-estado previo a `en-curso`: la evaluación todavía no existe. */
export type EvaluationLifecycle = 'inexistente' | EvaluationStatus;

export const EVALUATION_LIFECYCLE: readonly EvaluationLifecycle[] = [
  'inexistente',
  'en-curso',
  'publicada',
  'cerrada',
];

/**
 * Lo que ve quien lee. Añade el estado que **nadie escribe**: el de una evaluación cuyo resultado
 * publicado no corresponde a sus propios hechos.
 */
export type EvaluationPublicStatus = EvaluationStatus | 'anulada-por-inconsistencia';

export interface EvaluationTransition {
  readonly from: EvaluationLifecycle;
  readonly event: EvaluationEventType;
  readonly to: EvaluationStatus;
  /** La razón normativa. Referencia al documento, no adorno. */
  readonly note: string;
}

export const EVALUATION_TRANSITIONS: readonly EvaluationTransition[] = [
  {
    from: 'inexistente',
    event: 'EvaluationOpened',
    to: 'en-curso',
    note: 'ADR-0033: la revisión se convoca en la fecha comprometida, contra criterios ya sellados',
  },
  {
    from: 'en-curso',
    event: 'CriterionAssessed',
    to: 'en-curso',
    note: 'un veredicto se corrige mientras la evaluación está abierta; el anterior no se borra',
  },
  {
    from: 'en-curso',
    event: 'EvaluationEscalated',
    to: 'en-curso',
    note: 'ADR-0040: la escalera se pulsa sobre la tarea, el acuerdo o la carga',
  },
  {
    from: 'en-curso',
    event: 'LearningRecorded',
    to: 'en-curso',
    note: 'lo aprendido puede anotarse antes de saber cómo termina: no depende del desenlace',
  },
  {
    from: 'en-curso',
    event: 'EvaluationResultPublished',
    to: 'publicada',
    note: 'ADR-0026: lo que se publica es una proyección del recuento, no su fuente',
  },
  {
    from: 'publicada',
    event: 'LearningRecorded',
    to: 'publicada',
    note: 'un aprendizaje tardío sigue siendo memoria; no cambia ningún veredicto',
  },
  {
    from: 'publicada',
    event: 'EvaluationEscalated',
    to: 'publicada',
    note: 'el incumplimiento publicado es justamente lo que puede escalar',
  },
  {
    from: 'publicada',
    event: 'EvaluationClosed',
    to: 'cerrada',
    note: 'ADR-0033: mantener, enmendar, derogar o escalar; sin renovación explícita no hay inercia',
  },
];

const INDEX = new Map<string, EvaluationStatus>(
  EVALUATION_TRANSITIONS.map((transition) => [
    `${transition.from}\u0000${transition.event}`,
    transition.to,
  ]),
);

export const TERMINAL_EVALUATION_STATUSES: readonly EvaluationStatus[] = ['cerrada'];

export function isTerminalEvaluationStatus(status: EvaluationLifecycle): boolean {
  return status === 'cerrada';
}

export function isLegalEvaluationTransition(
  from: EvaluationLifecycle,
  event: EvaluationEventType,
): boolean {
  return INDEX.has(`${from}\u0000${event}`);
}

export function peekEvaluationTransition(
  from: EvaluationLifecycle,
  event: EvaluationEventType,
): EvaluationStatus | undefined {
  return INDEX.get(`${from}\u0000${event}`);
}

/**
 * Aplica la transición o lanza. Es la **única** puerta: si esto lanza, el llamante conserva el
 * estado anterior intacto porque nunca se llegó a construir uno nuevo.
 */
export function nextEvaluationStatus(
  from: EvaluationLifecycle,
  event: EvaluationEventType,
): EvaluationStatus {
  const to = peekEvaluationTransition(from, event);
  if (to === undefined) {
    throw new IllegalTransitionError(
      from,
      event,
      isTerminalEvaluationStatus(from)
        ? 'una evaluación cerrada no se reabre: lo que sigue es otra evaluación, con su fecha de ' +
            'revisión y sus criterios'
        : 'la pareja (estado, evento) no está en la tabla de la evaluación',
    );
  }
  return to;
}

/** Todas las transiciones legales desde un estado. Para la interfaz y para los tests exhaustivos. */
export function legalEvaluationEventsFrom(
  from: EvaluationLifecycle,
): readonly EvaluationEventType[] {
  return EVALUATION_TRANSITIONS.filter((transition) => transition.from === from).map(
    (transition) => transition.event,
  );
}

/**
 * El estado que se muestra. Si hay discrepancia entre lo publicado y lo recomputado, **eso** es lo
 * que se dice, y el resultado publicado no produce mandato.
 */
export function evaluationPublicStatus(state: EvaluationState): EvaluationPublicStatus {
  return state.discrepancy === undefined ? state.status : 'anulada-por-inconsistencia';
}

/** Frase en castellano llano para la discrepancia (ADR-0041: sin jerga en la interfaz). */
export function discrepancyNotice(discrepancy: EvaluationDiscrepancy): string {
  const causa =
    discrepancy.reason === 'outcome-mismatch'
      ? 'el resultado guardado'
      : 'la huella del resultado guardado';
  return (
    `${causa} no corresponde a los hechos anotados: se publicó «${discrepancy.published}» y de ` +
    `volver a contar sale «${discrepancy.recomputed}». Mientras eso no se explique, lo publicado ` +
    'no vale, y esto se trata como un incidente y no como un error de datos.'
  );
}
