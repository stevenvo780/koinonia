/**
 * B.2 — Supermayoría (mayoría reforzada).
 *
 * ```
 *   Aprueba ⟺ A / D ▷ f      con ▷ ∈ {>, ≥} según `strict`
 * ```
 *
 * ═══ La diferencia entre `cast` y `census` es enorme ═══
 *
 * Con `N = 300`, `A = 140`, `R = 60`, `f = 2/3`, `strict = false`:
 *  - `base:'cast'`   → `140/200 = 70 % ≥ 66.6 %` ⇒ **aprueba**;
 *  - `base:'census'` → `140/300 = 46.6 %`        ⇒ **no aprueba**.
 *
 * La supermayoría sobre censo es, en la práctica, un **derecho de veto por inasistencia**: quien
 * quiere bloquear no tiene que hacer nada. DECISIÓN B.2.a: por eso `base:'census'` sólo se admite
 * para actos constituyentes —reformar el reglamento estudiantil, revocar un mandato, disolver un
 * círculo—; es el freno adecuado donde la inercia debe pesar, y veneno para la gestión ordinaria,
 * donde produce parálisis y desmoraliza a quien sí participa.
 *
 * ═══ `≥` y no `>` ═══
 *
 * DECISIÓN B.2.c: `strict` por defecto es `false`. Con `2/3` y `D = 300`, `A = 200` es exactamente
 * dos tercios y sería perverso rechazar «200 de 300» por un `>` estricto. `1/2` exacto es un empate;
 * `2/3` exacto no es un empate, es el umbral cumplido.
 *
 * ═══ Patología reconocida ═══
 *
 * *Supermajority hold-up*: un grupo del 34 % obtiene poder de agenda desproporcionado y puede
 * extraer concesiones. Se mitiga con la ventana de impugnación y con la obligación de motivar el
 * voto negativo en decisiones sobre censo — ambas fuera del motor, en el producto.
 *
 * `O(C)` en tiempo.
 */

import type { DecisionConfig } from '../config.js';
import { InvalidBallotForMethod } from '../errors.js';
import { ratio, toFractionString, toPercentString } from '../fraction.js';
import {
  abstentionNarrative,
  binaryTable,
  countBinary,
  type EffectiveBallot,
  type MethodTally,
  passesThreshold,
  representedMembers,
  step,
  type ThresholdInput,
  thresholdDenominator,
} from './common.js';

export function tallySupermajority(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): MethodTally {
  const method = config.method;
  if (method.kind !== 'supermajority') {
    throw new InvalidBallotForMethod('supermajority', method.kind);
  }

  const counts = countBinary(ballots, method.kind);
  const census = config.electorate.censusSize;
  const input: ThresholdInput = { ...counts, census };
  const den = thresholdDenominator(input, method.abstentionPolicy, method.base);
  const passed = passesThreshold(
    input,
    method.fraction,
    method.strict,
    method.abstentionPolicy,
    method.base,
  );

  const represented = representedMembers(ballots).length;
  const silence = census - represented;
  const quotient = den === 0n ? ratio(0, 1) : { num: BigInt(counts.approve), den };
  const seqs = ballots.map((b) => b.seq).sort((a, b) => a - b);
  const required = toFractionString(method.fraction);
  const comparator = method.strict ? 'más de' : 'al menos';

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
        ? `El umbral se mide sobre el censo completo: ${String(census)} personas. ` +
            'Quien no vota cuenta, en la práctica, como un voto en contra.'
        : `El denominador aplicado es ${den.toString()}. ${abstentionNarrative(method.abstentionPolicy, method.base)}`,
      { denominador: den.toString(), politica: method.abstentionPolicy, base: method.base },
    ),
    step(
      'S4',
      den === 0n
        ? 'No hubo ni un solo voto computable: sin votos no se aprueba nada.'
        : `${String(counts.approve)} de ${den.toString()} es ${toPercentString(quotient)}, y se ` +
            `exigía ${comparator} ${required} (${toPercentString(method.fraction)}).`,
      {
        cociente: `${String(counts.approve)}/${den.toString()}`,
        exigido: required,
        estricto: method.strict ? 'sí' : 'no',
      },
    ),
    step(
      'S5',
      passed
        ? 'Se alcanzó la mayoría reforzada exigida: la propuesta se aprueba.'
        : 'No se alcanzó la mayoría reforzada exigida: la propuesta se rechaza.',
      { aprobada: passed ? 'sí' : 'no' },
    ),
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
      `Esta decisión exigía ${comparator} ${required} de apoyo ` +
      `${method.base === 'census' ? 'sobre todo el padrón' : 'sobre los votos computables'}. ` +
      `Hubo ${String(counts.approve)} a favor sobre un denominador de ${den.toString()}, ` +
      `de modo que la propuesta ${passed ? 'queda aprobada' : 'queda rechazada'}.`,
  };
}
