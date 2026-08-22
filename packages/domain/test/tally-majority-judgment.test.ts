import { describe, expect, it } from 'vitest';

import {
  majorityGrade,
  majorityJudgmentProfiles,
  mjCompare,
  tallyMajorityJudgment,
  usableGradeBallots,
} from '../src/index.js';
import {
  A,
  ACCEPTABLE,
  B,
  effective,
  EXCELLENT,
  FIVE_GRADE_SCALE,
  GOOD,
  INSUFFICIENT,
  multiConfig,
  REJECT,
} from './tally-helpers.js';

const METHOD = {
  kind: 'majority-judgment',
  scale: FIVE_GRADE_SCALE,
  missingGradePolicy: 'reject-ballot',
  tieBreak: { cascade: ['more-excellent', 'fewer-reject', 'lexicographic-hash'] },
} as const;

describe('B.7 — Majority Judgment', () => {
  /**
   * CONFLICTO RESUELTO — la errata E24 queda RETIRADA: la spec tenía razón y la directiva que la
   * contradecía era el error.
   *
   * Este test afirmaba antes `floor((W-1)/2)` sobre el vector de B.7 y dejaba anclada por escrito
   * una contradicción con INV-49. El invariante semántico normativo es uno solo y no admite
   * lectura alternativa (spec §B.7, líneas 1508-1513): «Ordenadas las `W` menciones de mejor a peor
   * `g_0 ≤ … ≤ g_{W−1}` (índices de grado, `0` = mejor), la mención mayoritaria es `α = g_{⌊W/2⌋}`.
   * Verificación: `W = 2` con `{Excelente, Rechazar}` ⇒ `α = g_1 = Rechazar`. Correcto: es la
   * convención **pesimista** de B–L (la peor de las dos centrales)». Cambiar la aserción está
   * amparado por TESTING.md §14 —«bug de test»— porque el documento normativo dice literalmente lo
   * contrario de lo que el test afirmaba.
   *
   * Lo que sí es falso en la spec (errata E25, que SE MANTIENE) es la frase «misma convención que
   * B.7» de B.5 (líneas 1332 y 1370): la convención semántica sí es la misma, pero la FÓRMULA no
   * puede serlo, porque los dos vectores están ordenados al revés. Peor de las dos centrales con
   * menciones de mejor a peor (B.7) ⇒ `floor(W/2)`; con puntuaciones de peor a mejor (B.5) ⇒
   * `floor((W-1)/2)`. Ver `weightedMedian` en `src/tally/score.ts`.
   */
  it('INV-49 — con W par la mención mayoritaria es la PEOR de las dos centrales', () => {
    // {Excelente, Rechazar} ⇒ Rechazar (índice 4). Es la verificación a mano de la línea 1511.
    expect(majorityGrade([1, 0, 0, 0, 1])).toBe(4);
    // {Bueno, Insuficiente} ⇒ Insuficiente (índice 3).
    expect(majorityGrade([0, 1, 0, 1, 0])).toBe(3);
    // Con W impar no hay dos menciones centrales y la fórmula del índice deja de importar.
    expect(majorityGrade([1, 0, 1, 0, 1])).toBe(2);
    // La orientación es lo que fija el índice: la peor de las dos centrales es la de índice MAYOR
    // aquí, y la de índice MENOR en el histograma ascendente de B.5.
    expect(majorityGrade([0, 0, 1, 1, 0])).toBe(3);
  });

  it('INV-47 corregido — mjCompare es un preorden hasta aplicar el desempate', () => {
    const a = [1, 0, 2, 0, 0];
    const b = [0, 2, 0, 1, 0];
    expect(mjCompare(a, b)).toBe(-mjCompare(b, a));
    expect(mjCompare(a, a)).toBe(0);
  });

  /**
   * PRUEBA POSITIVA (b) — MJ viola *later-no-harm*.
   *
   * `later-no-harm`: mejorar la valoración de una opción MENOS preferida no debería perjudicar a la
   * que uno prefiere. Con menciones donde el índice 0 es la mejor:
   *
   * | papeleta | A | B |
   * |---|---|---|
   * | 1 | 0 Excelente | 0 Excelente |
   * | 2 | 0 Excelente | 3 Insuficiente |
   * | 3 | 2 Aceptable | 0 Excelente |
   *
   * Histogramas: `A = [2,0,1,0,0]`, `B = [2,0,0,1,0]`, `W = 3`. Las dos menciones mayoritarias valen
   * 0 (`⌊3/2⌋ = 1`, y las dos acumulan 2 en Excelente), se retira una ocurrencia de Excelente a cada
   * una y quedan `A = [1,0,1,0,0]` y `B = [1,0,0,1,0]` con `W = 2`. En ese segundo paso `⌊2/2⌋ = 1`
   * separa: `A = 2` (Aceptable) contra `B = 3` (Insuficiente). **Gana A.**
   *
   * El votante 2 sube su B de 3 a 1 —sigue estrictamente por debajo de su A = 0, así que su
   * preferencia entre A y B no cambia—: `B = [2,1,0,0,0]`, y en el segundo paso queda `A = 2` contra
   * `B = 1` (Bueno). **Gana B.** Reforzar la opción posterior le costó la victoria a la preferida.
   *
   * Reproduce con la mención mayoritaria pesimista corregida; el paso en que se separan pasó del
   * tercero al segundo, porque con `W = 2` la mediana ya no vuelve a empatar en Excelente.
   *
   * No es un defecto del escrutinio: ningún método que use la mediana puede satisfacer
   * later-no-harm. Por eso MJ está excluido de esa familia en `props/tally-invariants.test.ts`.
   */
  it('documenta que MJ NO satisface later-no-harm; no es un bug del escrutinio', async () => {
    const config = await multiConfig(METHOD, [A, B], 3);
    const before = await tallyMajorityJudgment(
      config,
      effective([
        { kind: 'grades', grades: { [A]: EXCELLENT, [B]: EXCELLENT } },
        { kind: 'grades', grades: { [A]: EXCELLENT, [B]: INSUFFICIENT } },
        { kind: 'grades', grades: { [A]: ACCEPTABLE, [B]: EXCELLENT } },
      ]),
    );
    expect(before.outcome).toMatchObject({ kind: 'winner', option: A });

    const raisedLaterPreference = await tallyMajorityJudgment(
      config,
      effective([
        { kind: 'grades', grades: { [A]: EXCELLENT, [B]: EXCELLENT } },
        { kind: 'grades', grades: { [A]: EXCELLENT, [B]: GOOD } },
        { kind: 'grades', grades: { [A]: ACCEPTABLE, [B]: EXCELLENT } },
      ]),
    );
    expect(raisedLaterPreference.outcome).toMatchObject({ kind: 'winner', option: B });
  });

  it('B.7.b — con reject-ballot la papeleta incompleta se descarta entera, no se rellena', async () => {
    const config = await multiConfig(METHOD, [A, B], 3);
    const ballots = effective([
      { kind: 'grades', grades: { [A]: EXCELLENT, [B]: REJECT } },
      { kind: 'grades', grades: { [A]: EXCELLENT, [B]: REJECT } },
      // Incompleta: no califica B. Bajo `worst` contaría como «Rechazar» para B y como «Excelente»
      // para A; bajo `reject-ballot` no cuenta para ninguna de las dos.
      { kind: 'grades', grades: { [A]: REJECT } },
    ]);
    const profiles = majorityJudgmentProfiles(config, ballots);
    const totals = profiles.map((profile) =>
      profile.histogram.reduce((sum, count) => sum + count, 0),
    );
    expect(totals).toEqual([2, 2]);
    expect(profiles.map((profile) => profile.histogram)).toEqual([
      [2, 0, 0, 0, 0],
      [0, 0, 0, 0, 2],
    ]);
    expect(usableGradeBallots(config, ballots)).toHaveLength(2);

    // La misma urna bajo `worst` sí cuenta la papeleta incompleta: W = 3 para las dos opciones y el
    // «Rechazar» de A entra en el histograma. Es la diferencia que B.7.b decide.
    const lenient = await multiConfig({ ...METHOD, missingGradePolicy: 'worst' }, [A, B], 3);
    expect(majorityJudgmentProfiles(lenient, ballots).map((p) => p.histogram)).toEqual([
      [2, 0, 0, 0, 1],
      [0, 0, 0, 0, 3],
    ]);
  });

  it('documenta que MJ NO satisface el criterio de mayoría fuerte; no es un bug', async () => {
    const config = await multiConfig(METHOD, [A, B], 5);
    const result = await tallyMajorityJudgment(
      config,
      effective([
        { kind: 'grades', grades: { [A]: EXCELLENT, [B]: GOOD } },
        { kind: 'grades', grades: { [A]: INSUFFICIENT, [B]: REJECT } },
        { kind: 'grades', grades: { [A]: INSUFFICIENT, [B]: REJECT } },
        { kind: 'grades', grades: { [A]: REJECT, [B]: EXCELLENT } },
        { kind: 'grades', grades: { [A]: REJECT, [B]: EXCELLENT } },
      ]),
    );
    // Tres de cinco personas califican A estrictamente mejor que B, pero las distribuciones
    // absolutas dan a A mención Insuficiente y a B mención Bueno. MJ elige B.
    expect(result.outcome).toMatchObject({ kind: 'winner', option: B });
  });
});
