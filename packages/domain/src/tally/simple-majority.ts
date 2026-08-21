/**
 * B.1 — Mayoría simple.
 *
 * ```
 *   Aprueba ⟺ A / D > 1/2        (estricto)
 * ```
 *
 * con `D` según `abstentionPolicy` y `base`. Con la configuración institucional por defecto
 * —`exclude` + `cast`— la fórmula se reduce a `A > R`: **más síes que noes**.
 *
 * ═══ Por qué `>` y no `≥` ═══
 *
 * DECISIÓN B.1.b y B.2.c: la mayoría simple usa `>` estricto porque `1/2` exacto **es un empate
 * real**, y en un empate gana el statu quo: cambiar el estado de cosas exige una mayoría positiva.
 * (Una supermayoría de `2/3` exacta, en cambio, no es un empate sino el umbral cumplido, y por eso
 * `supermajority` usa `≥` por defecto.) Con `A === R` el resultado es **rechazo**, no «empate»: no
 * hay sorteo ni desempate que aplicar.
 *
 * ═══ Por qué una sola opción ═══
 *
 * Binarizar tres o más opciones por separado cae en la paradoja de Anscombe y en la inconsistencia
 * doctrinal: mayorías sobre las premisas incompatibles con la mayoría sobre la conclusión. La
 * validación de configuración lo rechaza antes de abrir.
 *
 * `O(C)` en tiempo, `O(1)` en espacio.
 */

import type { DecisionConfig } from '../config.js';
import { InvalidBallotForMethod } from '../errors.js';
import { HALF, ratio, toPercentString } from '../fraction.js';
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

export function tallySimpleMajority(
  config: DecisionConfig,
  ballots: readonly EffectiveBallot[],
): MethodTally {
  const method = config.method;
  if (method.kind !== 'simple-majority') {
    throw new InvalidBallotForMethod('simple-majority', method.kind);
  }

  const counts = countBinary(ballots, method.kind);
  const census = config.electorate.censusSize;
  const input: ThresholdInput = { ...counts, census };
  const den = thresholdDenominator(input, method.abstentionPolicy, method.base);
  // DECISIÓN B.1.b: `strict` es siempre `true` en la mayoría simple.
  const passed = passesThreshold(input, HALF, true, method.abstentionPolicy, method.base);

  const represented = representedMembers(ballots).length;
  const silence = census - represented;
  const quotient = den === 0n ? ratio(0, 1) : { num: BigInt(counts.approve), den };
  const seqs = ballots.map((b) => b.seq).sort((a, b) => a - b);

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
      `El denominador aplicado es ${den.toString()}. ${abstentionNarrative(method.abstentionPolicy, method.base)}`,
      { denominador: den.toString(), politica: method.abstentionPolicy, base: method.base },
    ),
    step(
      'S4',
      den === 0n
        ? 'No hubo ni un solo voto computable: sin votos no se aprueba nada.'
        : `${String(counts.approve)} de ${den.toString()} es ${toPercentString(quotient)}, y se ` +
            `exigía más de ${toPercentString(HALF)}.`,
      { cociente: `${String(counts.approve)}/${den.toString()}`, exigido: '1/2', estricto: 'sí' },
    ),
    step(
      'S5',
      passed
        ? 'Hubo más síes que noes: la propuesta se aprueba.'
        : counts.approve === counts.reject && den > 0n
          ? 'Hubo empate. En un empate no cambia nada: la propuesta se rechaza.'
          : 'No se alcanzó el umbral: la propuesta se rechaza.',
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
      `Se aprueba si hay más síes que noes. ${abstentionNarrative(method.abstentionPolicy, method.base)} ` +
      `Hubo ${String(counts.approve)} a favor y ${String(counts.reject)} en contra sobre un ` +
      `denominador de ${den.toString()}, de modo que la propuesta ${passed ? 'queda aprobada' : 'queda rechazada'}.`,
  };
}
