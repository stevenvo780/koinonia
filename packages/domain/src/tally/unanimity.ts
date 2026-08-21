/**
 * B.4 — Consenso puro (unanimidad).
 *
 * ```
 *   Aprueba ⟺ R = 0 ∧ (abstentionBlocks ? Ab = 0 : true) ∧ D > 0 ∧ A = D
 * ```
 *
 * ═══ Una corrección a la fórmula de la especificación ═══
 *
 * DECISIÓN: B.4 fija `D = A + R + Ab` para `base:'cast'` **y además** condiciona por
 * `abstentionBlocks`. Las dos cosas juntas son contradictorias: si `D = A + R + Ab`, entonces
 * `A = D` ya obliga a `R = 0 ∧ Ab = 0`, de modo que `abstentionBlocks: false` no tendría ningún
 * efecto y el campo sería inerte. Se resuelve dándole el efecto que su nombre anuncia:
 *
 *  - `abstentionBlocks: true`  ⇒ `D = A + R + Ab` (cualquier abstención rompe la unanimidad);
 *  - `abstentionBlocks: false` ⇒ `D = A + R`      (la abstención se aparta, como en `exclude`).
 *
 * Con `base:'census'`, `D = N` en ambos casos: unanimidad del padrón entero, donde cualquier
 * abstención o silencio ya impide que `A = N`. Reportado como error de la especificación.
 *
 * ═══ INV-52 — `0/0` nunca aprueba ═══
 *
 * Sin ninguna papeleta, `A = D = 0` y `approve === den` daría `true`: **unanimidad vacía**. Es la
 * trampa clásica. Por eso la condición `D > 0` es explícita y está probada aparte.
 *
 * ═══ Patología reconocida (B.4.a) ═══
 *
 * La unanimidad da poder de veto individual: la última persona en votar tiene poder dictatorial de
 * facto, la presión conformista es brutal, y con `base:'census'` la decisión depende de quien se fue
 * de intercambio y no revisa el correo. Además es **no monótona en participación**: aumentar la
 * participación sólo puede empeorar el resultado. Por eso está deshabilitada por defecto y exige una
 * decisión previa del círculo que la autorice para un caso concreto. Es apropiada sólo cuando la
 * decisión **compromete personalmente a cada miembro** —firmar un comunicado en nombre de todos,
 * asumir una obligación solidaria—: ahí el veto individual no es una patología, es la protección
 * correcta.
 */

import type { DecisionConfig } from '../config.js';
import { InvalidBallotForMethod } from '../errors.js';
import {
  binaryTable,
  countBinary,
  type EffectiveBallot,
  type MethodTally,
  representedMembers,
  step,
} from './common.js';

export function tallyUnanimity(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): MethodTally {
  const method = config.method;
  if (method.kind !== 'unanimity') throw new InvalidBallotForMethod('unanimity', method.kind);

  const counts = countBinary(ballots, method.kind);
  const census = config.electorate.censusSize;
  const represented = representedMembers(ballots).length;
  const silence = census - represented;

  const den =
    method.base === 'census'
      ? census
      : method.abstentionBlocks
        ? counts.approve + counts.reject + counts.abstain
        : counts.approve + counts.reject;

  const blockedByAbstention = method.abstentionBlocks && counts.abstain > 0;
  const passed = counts.reject === 0 && !blockedByAbstention && den > 0 && counts.approve === den;

  const seqs = ballots.map((b) => b.seq).sort((a, b) => a - b);
  const reason = ((): string => {
    if (counts.reject > 0) {
      return `Hubo ${String(counts.reject)} de peso en contra: basta uno para romper la unanimidad.`;
    }
    if (blockedByAbstention) {
      return `Hubo ${String(counts.abstain)} de peso en abstención y esta decisión exige que nadie se abstenga.`;
    }
    if (den === 0)
      return 'No hubo ni una sola papeleta: cero de cero no es unanimidad, es ausencia de decisión.';
    if (counts.approve !== den) {
      return method.base === 'census'
        ? `Se necesitaba el apoyo de las ${String(census)} personas del padrón y hubo ${String(counts.approve)}.`
        : `Se necesitaba que las ${String(den)} personas computables apoyaran y hubo ${String(counts.approve)}.`;
    }
    return 'Todas las personas computables apoyaron y ninguna se opuso.';
  })();

  const steps = [
    step(
      'S1',
      `Se emitieron ${String(ballots.length)} papeletas, que representan a ${String(represented)} ` +
        `de ${String(census)} personas del padrón.`,
      { papeletas: ballots.length, representados: represented, censo: census },
      seqs,
    ),
    step(
      'S2',
      `A favor: ${String(counts.approve)}. En contra: ${String(counts.reject)}. ` +
        `Abstenciones explícitas: ${String(counts.abstain)}. No votaron: ${String(silence)}.`,
      {
        aFavor: counts.approve,
        enContra: counts.reject,
        abstenciones: counts.abstain,
        noVotaron: silence,
      },
      seqs,
    ),
    step(
      'S3',
      method.base === 'census'
        ? `La unanimidad se exige sobre el padrón entero: ${String(census)} personas.`
        : `La unanimidad se exige sobre ${String(den)} personas computables. ` +
            (method.abstentionBlocks
              ? 'Una abstención explícita rompe la unanimidad.'
              : 'Las abstenciones explícitas se apartan del cálculo.'),
      {
        denominador: den,
        base: method.base,
        laAbstencionBloquea: method.abstentionBlocks ? 'sí' : 'no',
      },
    ),
    step('S4', reason, { aprobada: passed ? 'sí' : 'no' }),
  ];

  return {
    outcome: passed
      ? {
          kind: 'approved',
          ...(config.options[0] === undefined ? {} : { option: config.options[0] }),
        }
      : { kind: 'rejected', reason: 'threshold-not-met' },
    steps,
    tables: [binaryTable({ ...counts, silence })],
    narrative:
      'Esta decisión exigía unanimidad: basta una sola oposición para que no pase. ' +
      reason +
      ` La propuesta ${passed ? 'queda aprobada' : 'queda rechazada'}.`,
  };
}
