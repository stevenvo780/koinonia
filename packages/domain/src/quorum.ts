/**
 * Quórum (D.1) y qué pasa cuando no se alcanza (D.2).
 *
 * ═══ Las tres fórmulas ═══
 *
 * Sea `N` el censo congelado y `E` el conjunto de miembros **representados** en el escrutinio:
 * quienes votaron directamente, más quienes delegaron y cuya cadena terminó en una papeleta emitida
 * (incluida la abstención explícita). Como cada miembro aporta exactamente 1 y los pesos son enteros
 * (B.0.a), `|E| = Σ pesos`.
 *
 * ```
 *  participación   P   = |E| / N                    ≥ quorum.participation      (D.1.1)
 *  aprobación      Aq  = A   / N                    ≥ quorum.approvalOfCensus   (D.1.2)
 *  por círculo     P_c = |E ∩ M_c| / |M_c|          ≥ q_c, y |M_c| = 0 ⇒ NO cumple (D.1.3)
 *  directa         Pd  = |directos| / N             ≥ quorum.minDirectParticipation (D.1.b)
 * ```
 *
 * ═══ Dos reglas contraintuitivas ═══
 *
 * - **DECISIÓN D.1.a — delegar es participar.** Quien delegó y cuyo delegado votó cuenta en `E`
 *   aunque no haya tocado la aplicación. La delegación es un acto político deliberado y verificable;
 *   negarle valor de participación equivale a decir que sólo cuenta quien vota a mano. La condición
 *   «su delegado sí votó» impide inflar el quórum con delegaciones inertes.
 * - **DECISIÓN D.1.d — la participación se atribuye al miembro REPRESENTADO, no al autor de la
 *   papeleta.** Si Ana (círculo *Estética*) delega en Beto (círculo *Lógica*), la participación de
 *   Ana cuenta para *Estética*. El quórum por círculo mide qué parte del círculo está representada,
 *   no cuántas papeletas firmó gente del círculo. La atribución al autor permitiría que un círculo
 *   entero «participe» porque su delegado de otro círculo votó.
 *
 * En esta entrega la delegación está apagada (PARTE C pendiente), así que `E` coincide con el
 * conjunto de votantes directos. Las fórmulas, en cambio, ya están escritas sobre `E`: cuando la
 * delegación entre, no hay que reescribir el quórum, sólo alimentar `represented`.
 *
 * ═══ DECISIÓN D.1.e — el quórum es una condición de VALIDEZ y se evalúa ANTES del escrutinio ═══
 *
 * Si falla, el desenlace es `no-quorum` y **el resultado del método no se publica** (sólo la
 * participación). Publicar «habría ganado X pero no hubo quórum» crea una legitimidad paralela de
 * facto y presión para «respetar la voluntad expresada», vaciando el quórum de sentido (INV-39).
 *
 * ═══ Anti-invariante A-03 ═══
 *
 * La participación **no** crece monótonamente mientras la decisión está abierta: revocar una
 * delegación sin votar directo reduce `|E|`. Por eso el quórum se evalúa **una sola vez**, en el tick
 * de cierre, y no continuamente.
 */

import { type DecisionConfig, isThresholdMethod } from './config.js';
import { circleSize, type Electorate, membersOfCircle } from './electorate.js';
import { cmpFraction, type Fraction, ratio } from './fraction.js';
import { compareIds, type Instant, instant, type MemberId } from './ids.js';

/** Lo que el escrutinio aporta a la comprobación de quórum. */
export interface QuorumSubject {
  /** `E`: miembros representados. Estrictamente ordenado y sin duplicados. */
  readonly represented: readonly MemberId[];
  /** Quienes emitieron papeleta con su propia mano. Subconjunto de `represented`. */
  readonly directVoters: readonly MemberId[];
  /** `A`: peso total a favor, para el quórum de aprobación. */
  readonly approveWeight: number;
}

/** Resultado de una de las comprobaciones, con su aritmética a la vista. */
export interface QuorumCriterion {
  readonly id: string;
  readonly label: string;
  readonly achieved: Fraction;
  readonly required: Fraction;
  readonly passed: boolean;
}

export interface QuorumCheck {
  readonly passed: boolean;
  /** Mapa `id → cumplió`, tal como lo pide `DecisionResult.quorumCheck.detail` (A.6). */
  readonly detail: Readonly<Record<string, boolean>>;
  readonly criteria: readonly QuorumCriterion[];
  /** `|E| / N`, siempre presente aunque no se exija participación mínima. */
  readonly participation: Fraction;
}

function intersectionSize(sorted: readonly MemberId[], other: readonly MemberId[]): number {
  // Ambos conjuntos vienen ordenados: recorrido lineal, sin `Set` y sin dependencia del orden de
  // inserción de nada.
  let i = 0;
  let j = 0;
  let count = 0;
  while (i < sorted.length && j < other.length) {
    const a = sorted[i];
    const b = other[j];
    if (a === undefined || b === undefined) break;
    const c = compareIds(a, b);
    if (c === 0) {
      count++;
      i++;
      j++;
    } else if (c === -1) i++;
    else j++;
  }
  return count;
}

/** `|E ∩ M_c| / |M_c|`, con la convención de D.1.3: `|M_c| = 0` ⇒ no cumple. */
export function circleParticipation(
  electorate: Electorate,
  represented: readonly MemberId[],
  circle: Parameters<typeof membersOfCircle>[1],
): Fraction {
  const members = membersOfCircle(electorate, circle);
  if (members.length === 0) return ratio(0, 1);
  return ratio(intersectionSize(represented, members), members.length);
}

/**
 * Evalúa los cuatro quórums. Se llama **una vez**, en el tick de cierre, con `E` ya resuelto.
 */
export function checkQuorum(config: DecisionConfig, subject: QuorumSubject): QuorumCheck {
  const census = config.electorate.censusSize;
  const participation = ratio(subject.represented.length, census);
  const criteria: QuorumCriterion[] = [];

  criteria.push({
    id: 'participation',
    label: 'participación mínima',
    achieved: participation,
    required: config.quorum.participation,
    passed: cmpFraction(participation, config.quorum.participation) >= 0,
  });

  if (config.quorum.approvalOfCensus !== undefined) {
    const achieved = ratio(subject.approveWeight, census);
    criteria.push({
      id: 'approvalOfCensus',
      label: 'apoyo mínimo sobre el censo',
      achieved,
      required: config.quorum.approvalOfCensus,
      passed: cmpFraction(achieved, config.quorum.approvalOfCensus) >= 0,
    });
  }

  if (config.quorum.minDirectParticipation !== undefined) {
    const achieved = ratio(subject.directVoters.length, census);
    criteria.push({
      id: 'minDirectParticipation',
      label: 'participación directa mínima',
      achieved,
      required: config.quorum.minDirectParticipation,
      passed: cmpFraction(achieved, config.quorum.minDirectParticipation) >= 0,
    });
  }

  for (const entry of config.quorum.perCircle ?? []) {
    const size = circleSize(config.electorate, entry.circleId);
    const achieved = circleParticipation(config.electorate, subject.represented, entry.circleId);
    criteria.push({
      // La clave viaja dentro de una preimagen de hash: sólo `[A-Za-z][A-Za-z0-9_]*`.
      id: `circle_${entry.circleId}`,
      label: `participación mínima del círculo ${entry.circleId}`,
      achieved,
      required: entry.min,
      passed: size > 0 && cmpFraction(achieved, entry.min) >= 0,
    });
  }

  const detail: Record<string, boolean> = {};
  for (const criterion of criteria) detail[criterion.id] = criterion.passed;

  return {
    passed: criteria.every((c) => c.passed),
    detail,
    criteria,
    participation,
  };
}

/**
 * Qué hacer cuando el quórum no se alcanza (D.2).
 *
 * DECISIÓN D.2.a: `maxExtensions` por defecto 1, tope duro 2. Prorrogar indefinidamente hasta
 * alcanzar el quórum equivale a **no tener quórum**: convierte un requisito de legitimidad en una
 * molestia administrativa. DECISIÓN D.2.b: la prórroga **no** reabre el padrón ni invalida las
 * papeletas ya emitidas; si prorrogar recongelara el padrón, prorrogar sería una forma encubierta de
 * cambiar el electorado a la vista del marcador. DECISIÓN D.2.c: `escalate` **nunca** convierte la
 * decisión en aprobada: la falta de quórum es ausencia de mandato, y convertirla en mandato de otro
 * órgano por vía automática sería premiar la desmovilización.
 */
export type QuorumFailureAction =
  | { readonly kind: 'reject' }
  | { readonly kind: 'extend'; readonly newClosesAt: Instant }
  | { readonly kind: 'escalate' };

export function quorumFailureAction(
  config: DecisionConfig,
  extensionsUsed: number,
  currentClosesAt: Instant,
): QuorumFailureAction {
  switch (config.quorum.onFailure) {
    case 'reject':
      return { kind: 'reject' };
    case 'escalate':
      return { kind: 'escalate' };
    case 'extend': {
      if (extensionsUsed >= config.quorum.maxExtensions) return { kind: 'reject' };
      return {
        kind: 'extend',
        newClosesAt: instant(currentClosesAt + config.quorum.extensionDuration),
      };
    }
  }
}

/**
 * Frase para la traza auditable. Se genera por plantilla determinista y sin jerga: quien lee el acta
 * es un estudiante de filosofía, no un ingeniero.
 */
export function quorumNarrative(check: QuorumCheck): string {
  if (check.passed) return 'Se alcanzaron todos los mínimos de participación exigidos.';
  const failed = check.criteria.filter((c) => !c.passed).map((c) => c.label);
  return `No se alcanzó: ${failed.join('; ')}. La decisión no produce resultado.`;
}

/** ¿El método exige un peso «a favor»? El consentimiento no cuenta votos a favor (B.3). */
export function usesApprovalWeight(config: DecisionConfig): boolean {
  return isThresholdMethod(config.method);
}
