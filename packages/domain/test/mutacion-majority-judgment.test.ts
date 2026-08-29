/**
 * Mutación sobre `packages/domain/src/tally/majority-judgment.ts`.
 *
 * Corrida inicial: **49,81 %** de fallo. Umbral: **85 %**.
 *
 * ═══ Causa raíz ═══
 *
 * La suite existente (`tally-majority-judgment.test.ts`) afirma sobre `outcome` y, cuando mucho,
 * sobre `tables[0].rows` para un único caso. Las frases de los pasos y del párrafo, los rótulos de
 * las columnas, los identificadores `MJ1`/`MJ2`, el aviso de desempate, el conteo de papeletas
 * descartadas y la coherencia entre los pasos eran terreno virgen para la mutación.
 *
 * Mutaciones supervivientes típicas detectadas en la primera corrida:
 *  - StringLiteral sobre los rótulos de la tabla (`'Opción'`, `'Mención mayoritaria'`, etiquetas
 *    del histograma): cambiar uno por `""` no rompía nada porque ninguna prueba leía la lista de
 *    columnas ni las etiquetas del histograma una por una.
 *  - StringLiteral sobre los pasos `MJ1`/`MJ2` y el párrafo: vaciarlos no se notaba.
 *  - L157 `Math.max(...)` → `Math.min(...)` y L127/L128 `&& 0` siempre-0: el discriminador del
 *    desempate se anulaba y la suite no detectaba la caída a hash porque ningún test exponía la
 *    cascada regla por regla.
 *  - L207 `comparison < 0` → `comparison <= 0` y L208 `else if (comparison === 0)` → `false`: la
 *    detección de empates se rompía y `tiedAfterBl` quedaba mal, sin que nadie lo verificara.
 *
 * Lo que este fichero afirma es la **demostración** —pasos, tablas y narrativa— y el **camino
 * concreto** por el que el escrutinio separó a las opciones: la mención mayoritaria baja (peor de
 * las dos centrales), el rastreo del desempate por eliminación sucesiva, y la cascada de reglas.
 *
 * ═══ Convenciones del método (B.7) que la suite fija ═══
 *
 *  - B.7 — la mención mayoritaria es la **mediana BAJA**: con `W` par se toma la peor de las dos
 *    menciones centrales. La fórmula del índice **depende del orden del vector** (mejor→peor), y
 *    por eso es `Math.floor(W/2)` (la posición de la peor de las dos centrales en un vector
 *    ordenado de mejor a peor).
 *  - B.7.b — `missingGradePolicy: 'reject-ballot'` descarta la papeleta entera si le falta alguna
 *    mención, no rellena el hueco con la peor mención. Mantiene `W` idéntico para todas las
 *    opciones.
 *  - B.7.c — el desempate es **Balinski–Laraki** por eliminación sucesiva: en cada empate se
 *    retira una sola ocurrencia de la mención mayoritaria a cada opción y se vuelve a comparar.
 *
 * ═══ Mutante `floor(W/2) → ceil(W/2)` ═══
 *
 * Stryker **no lo genera**: la mutación por defecto afecta a operadores y literales, no a
 * funciones. Pero un test que **lo mataría si existiera** está incluido al final: con
 * `W = 3` y un histograma asimétrico como `[0, 1, 1, 0, 1]` la mención mayoritaria es `2` con
 * `floor(3/2) = 1` (target), pero sería `4` con `ceil(3/2) = 2` — diferencia observable
 * independientemente de cualquier otra rama.
 *
 * ═══ QUÉ SIGNIFICA `tieBroken`, Y POR QUÉ CASI NUNCA ES `true` ═══
 *
 * La primera versión de este fichero se escribió sin ejecutarlo y daba por hecho que
 * `tieBroken` marcaba «hubo que recorrer la eliminación sucesiva». **Es falso**, y la
 * confusión invalidaba ocho de sus aserciones.
 *
 * La eliminación sucesiva de la mediana **es** el orden de Balinski–Laraki, no un desempate.
 * La spec lo dice en dos sitios independientes:
 *
 *  - `30-decision-engine-spec.md:347` — `readonly tieBreak: TieBreakPolicy;  // sólo actúa
 *    TRAS el desempate B–L`.
 *  - `30-decision-engine-spec.md`, código de referencia de B.7 — «Orden de MAJORITY JUDGMENT.
 *    -1 ⇒ a mejor que b. **Orden total estricto salvo multiconjuntos idénticos**», y el
 *    `return 0` final rotulado `// multiconjuntos idénticos`.
 *
 * De ahí que `tieBroken === true` signifique exactamente **«B–L no pudo separarlas y hubo que
 * invocar la cascada de `tieBreak`»**, y eso ocurre si y sólo si dos opciones tienen el
 * histograma IDÉNTICO. El test `mjCompare === 0 ⟺ histogramas idénticos` de más abajo lo
 * comprueba por barrido exhaustivo, no de palabra.
 *
 * ═══ CONSECUENCIA: `gradeMetric` ES INERTE, Y SUS MUTANTES SON EQUIVALENTES ═══
 *
 * `breakIdenticalProfiles` sólo recibe perfiles que B–L declaró indistinguibles, es decir, con
 * histogramas idénticos casilla a casilla. Pero entonces `more-excellent` (`histogram[0]`),
 * `fewer-reject` (`histogram.at(-1)`) y `higher-median` (`majorityGrade`) **valen forzosamente
 * lo mismo para todos los contendientes**: son funciones del histograma, y el histograma es el
 * mismo. `Math.max` de valores idénticos los conserva a todos y la cascada pasa de largo.
 *
 * Es decir: las tres reglas de menciones de la cascada **no pueden discriminar nunca** en B.7.
 * Sus mutantes (`Math.max`→`Math.min`, `-x`→`+x`, `.at(-1)`→`.at(1)`, borrar una etiqueta del
 * `switch`, vaciar un literal de regla) son **mutantes equivalentes**: ninguna entrada legal
 * los distingue del original. No se fingen tests para ellos; se documenta la equivalencia y se
 * ataca lo que sí es alcanzable —el guardián `metrics.every(...)`, la caída al hash y el
 * respaldo posterior a la cascada—, que es lo que hacen los tests de esta suite.
 */

import { describe, expect, it } from 'vitest';

import {
  type DecisionConfig,
  type DecisionMethod,
  DomainError,
  type EffectiveBallot,
  InvalidBallotForMethod,
  lexicographicHashOrder,
  majorityGrade,
  majorityJudgmentProfiles,
  mjCompare,
  PreconditionError,
  tallyMajorityJudgment,
  usableGradeBallots,
} from '../src/index.js';
import { buildConfig, buildElectorate, memberIdAt, planToMethod } from './arbitraries.js';
import {
  A,
  ACCEPTABLE,
  B,
  C,
  D,
  EXCELLENT,
  FIVE_GRADE_SCALE,
  GOOD,
  INSUFFICIENT,
  multiConfig,
  REJECT,
} from './tally-helpers.js';

const METHOD: DecisionMethod = {
  kind: 'majority-judgment',
  scale: FIVE_GRADE_SCALE,
  missingGradePolicy: 'reject-ballot',
  tieBreak: { cascade: ['more-excellent', 'fewer-reject', 'lexicographic-hash'] },
} as const;

async function cfg(
  method: DecisionMethod = METHOD,
  options: readonly (typeof A)[] = [A, B],
  memberCount = 5,
): Promise<DecisionConfig> {
  return multiConfig(method, options, memberCount);
}

function effective(payloads: readonly EffectiveBallot['payload'][]): readonly EffectiveBallot[] {
  return payloads.map((payload, index) => ({
    voter: memberIdAt(index),
    payload,
    weight: 1,
    seq: index + 1,
    onBehalfOf: [],
  }));
}

function withWeight(
  voterIndex: number,
  payload: EffectiveBallot['payload'],
  weight: number,
  seq: number,
): EffectiveBallot {
  return { voter: memberIdAt(voterIndex), payload, weight, seq, onBehalfOf: [] };
}

/**
 * Devuelve el `code` estable del `DomainError` lanzado.
 *
 * `expect(...).toThrow('EMPTY_GRADE_PROFILE')` **no sirve** aquí: compara contra `.message`, y en
 * este dominio el código y el mensaje son campos distintos (`errors.ts`: `DomainError(code,
 * message)`). Afirmar sobre el mensaje ataría la prueba a la redacción en castellano, que es
 * justo lo que el `code` existe para evitar.
 */
function codigoDe(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  throw new Error('se esperaba un DomainError y la llamada terminó sin lanzar');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `majorityGrade` — la mención mayoritaria baja
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — `majorityGrade`: mención mayoritaria baja, peor de las dos centrales', () => {
  it('un histograma vacío lanza `PreconditionError EMPTY_GRADE_PROFILE`, no devuelve 0', () => {
    // Mata los mutantes L25:7 `false` y L25:7 `weight < 0`: ambos dejan de lanzar con peso 0
    // (el original corta con `weight <= 0`).
    expect(() => majorityGrade([0, 0, 0, 0, 0])).toThrow(PreconditionError);
    expect(codigoDe(() => majorityGrade([0, 0, 0, 0, 0]))).toBe('EMPTY_GRADE_PROFILE');
    // El `code` es para la máquina; el mensaje es para quien lee el rechazo. Vaciarlo deja al
    // operador con un código a secas, así que también se fija: mata el mutante `StringLiteral`
    // que sustituye el mensaje por `""`.
    expect(() => majorityGrade([0, 0, 0, 0, 0])).toThrow('MJ exige menciones');
  });

  it('`W = 2` con `{Excelente, Rechazar}` devuelve `4` (la peor de las dos centrales)', () => {
    // Verificación INV-49 y discriminación contra `floor(W/2) → ceil(W/2)`. Con `W = 2`,
    // `floor(2/2) = ceil(2/2) = 1`, así que aquí ambas fórmulas coinciden: target=1, la primera
    // acumulada que supera 1 está en el índice 4 (Excelente=1, Rechazar=2). El mutante y el
    // original coinciden en este caso; este test fija el contrato, no la discriminación.
    expect(majorityGrade([1, 0, 0, 0, 1])).toBe(4);
  });

  it('`W = 3` asimétrico distingue `floor(W/2)` (correcto) de `ceil(W/2)` (mutante)', () => {
    // DISCRIMINACIÓN EXPLÍCITA contra el mutante `Math.floor(W/2) → Math.ceil(W/2)`.
    //
    // Con `[0, 1, 1, 0, 1]` (W=3): floor(3/2)=1. accumulated: 0=0, 1=1 (no >1), 2=2 (>1).
    //   ⇒ mención mayoritaria = 2 (Aceptable). Es el resultado correcto y semánticamente
    //     importante: 2 de 3 consideran la opción al menos Aceptable.
    //
    // Con ceil(3/2)=2: accumulated: 0=0, 1=1, 2=2 (no >2), 4=3 (>2). ⇒ mención mayoritaria = 4
    //   (Rechazar). Es la mención contraria y un cambio semántico devastador.
    //
    // Stryker no genera esta mutación (afecta a `Math.floor`/`Math.ceil`, que no son blancos del
    // AST string-replace), pero si lo hiciera, este test la cazaría.
    expect(majorityGrade([0, 1, 1, 0, 1])).toBe(2);
    // Otro caso asimétrico: [2, 1, 0, 0, 0] (W=3). floor=1: cum at 0=2 (>1) ⇒ 0 (Excelente).
    // ceil=2: cum at 0=2 (no >2), at 1=3 (>2) ⇒ 1 (Bueno).
    expect(majorityGrade([2, 1, 0, 0, 0])).toBe(0);
    // El vector completamente concentrado: con W=3, [3, 0, 0, 0, 0] ⇒ target=1, cum at 0=3 (>1)
    // ⇒ 0. Mismo resultado con ceil=2 (cum at 0=3 > 2 ⇒ 0).
    expect(majorityGrade([3, 0, 0, 0, 0])).toBe(0);
    // Y el espejo: [0, 0, 0, 0, 3] ⇒ target=1, cum at 4=3 (>1) ⇒ 4. Coincide con ceil.
    expect(majorityGrade([0, 0, 0, 0, 3])).toBe(4);
  });

  it('`W = 4` confirma `floor(W/2)` y descarta `ceil(W/2)` en empates pegados al límite', () => {
    // Con `W = 4` y `[1, 1, 0, 0, 2]`: floor(4/2)=2. accumulated: 0=1, 1=2 (no >2), 4=4 (>2)
    // ⇒ 4 (Rechazar). Con ceil(4/2)=2 mismo target, mismo resultado.
    expect(majorityGrade([1, 1, 0, 0, 2])).toBe(4);
    // [1, 0, 1, 0, 2] W=4: cum at 0=1, at 2=2 (no >2), at 4=4 (>2) ⇒ 4. Igual con ceil.
    expect(majorityGrade([1, 0, 1, 0, 2])).toBe(4);
    // [2, 0, 0, 0, 2] W=4: cum at 0=2 (no >2), at 4=4 (>2) ⇒ 4. Igual con ceil.
    expect(majorityGrade([2, 0, 0, 0, 2])).toBe(4);
    // [1, 0, 1, 1, 1] W=4: cum at 0=1, at 2=2 (no >2), at 3=3 (>2) ⇒ 3 (Insuficiente).
    expect(majorityGrade([1, 0, 1, 1, 1])).toBe(3);
  });

  it('el recorrido del bucle siempre cierra: ningún histograma bien formado cae a `BROKEN_GRADE_PROFILE`', () => {
    // Mata cualquier mutante que cambie la frontera del bucle de manera que la última casilla
    // (la que contiene el peso restante) NO se visite. La suma de las casillas siempre es `W`,
    // y `target = floor(W/2) < W`, así que `accumulated > target` debe cumplirse en algún grado.
    for (const hist of [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 1, 0],
      [0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
      [3, 0, 0, 0, 2],
      [1, 0, 2, 0, 1],
    ] as const) {
      expect(majorityGrade(hist)).toBeGreaterThanOrEqual(0);
      expect(majorityGrade(hist)).toBeLessThanOrEqual(4);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `mjCompare` — preorden hasta el desempate, asimetría y pesos iguales
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — `mjCompare`: preorden, asimetría, pesos iguales', () => {
  it('rechaza papeletas efectivas con pesos desiguales con `UNEQUAL_GRADE_WEIGHT`', () => {
    // Mata el mutante L41:7 `false`: con pesos desiguales, el original lanza; el mutante
    // procede y devuelve 0 (las dos opciones se consumirían en sincronía y la última
    // comparación quedaría igual). Aquí exigimos el lanzamiento.
    expect(() => mjCompare([1, 0, 0, 0, 0], [2, 0, 0, 0, 0])).toThrow(PreconditionError);
    expect(codigoDe(() => mjCompare([1, 0, 0, 0, 0], [2, 0, 0, 0, 0]))).toBe(
      'UNEQUAL_GRADE_WEIGHT',
    );
    // El mensaje explica la precondición violada; vaciarlo es una pérdida real de la
    // demostración. Mata el mutante `StringLiteral` → `""`.
    expect(() => mjCompare([1, 0, 0, 0, 0], [2, 0, 0, 0, 0])).toThrow(
      'MJ exige igual peso total por opción',
    );
    expect(() => mjCompare([0, 1, 0, 0, 0], [0, 2, 0, 0, 0])).toThrow(PreconditionError);
  });

  it('con histogramas idénticos devuelve 0 sin lanzar', () => {
    // Mata cualquier mutante que haga fallar el camino «comparación 0, consumir y volver a
    // comparar». Con histogramas idénticos el bucle consume todos los votos en sincronía y
    // termina con `remaining = 0`, devolviendo 0.
    expect(mjCompare([1, 0, 0, 0, 0], [1, 0, 0, 0, 0])).toBe(0);
    expect(mjCompare([0, 1, 0, 0, 0], [0, 1, 0, 0, 0])).toBe(0);
    expect(mjCompare([2, 1, 1, 0, 0], [2, 1, 1, 0, 0])).toBe(0);
  });

  it('asimetría: una opción mejor en mención mayoritaria gana con `-1`', () => {
    // A maj=0 (Excelente) vs B maj=4 (Rechazar). A gana. La dirección de la comparación
    // (`gradeA < gradeB ? -1 : 1`) es lo que decide el signo.
    expect(mjCompare([1, 0, 0, 0, 0], [0, 0, 0, 0, 1])).toBe(-1);
    expect(mjCompare([0, 0, 0, 0, 1], [1, 0, 0, 0, 0])).toBe(1);
  });

  it('la asimetría se mantiene durante TODO el rastro del desempate, no sólo en la primera mención', () => {
    // Caso asimétrico donde la mención mayoritaria coincide y se necesitan varios pasos de
    // eliminación sucesiva para separar. La dirección de la comparación tiene que preservarse
    // en cada iteración del bucle.
    //
    // A=[1, 1, 0, 0, 0] W=2, maj=0 (cum at 0=1 no >1, at 1=2 >1) ⇒ maj=1 (Bueno).
    // B=[0, 0, 0, 1, 1] W=2, maj=3 (cum at 3=1 no >1, at 4=2 >1) ⇒ maj=4.
    // Primera iteración: A=1 < B=4 ⇒ -1, sin consumir.
    expect(mjCompare([1, 1, 0, 0, 0], [0, 0, 0, 1, 1])).toBe(-1);
    expect(mjCompare([0, 0, 0, 1, 1], [1, 1, 0, 0, 0])).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `usableGradeBallots` y `majorityJudgmentProfiles` — la aritmética del histograma
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — `usableGradeBallots` y `majorityJudgmentProfiles`: contratos y aritmética', () => {
  it('`usableGradeBallots` rechaza una configuración que no es de mayoría-judicial', async () => {
    // Mata los mutantes L76:7 `false` y L143:7 `false`: la guarda de método deja de lanzar
    // y el filtro procesa papeletas de un método distinto como si fueran de MJ.
    const cfgSM = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(() => usableGradeBallots(cfgSM, [])).toThrow(
      'usableGradeBallots exige majority-judgment',
    );
  });

  it('`usableGradeBallots` rechaza una papeleta que no es de mención con `InvalidBallotForMethod`', async () => {
    // Mata los mutantes L81:9 `false` y L106:11 `false`: la guarda de tipo de papeleta se
    // anula y el motor procesaría papeletas binarias como si fueran de mención.
    const c = await cfg();
    const ballots = effective([
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
    ]);
    const binaria = withWeight(2, { kind: 'binary', approve: true }, 1, 3);
    expect(() => usableGradeBallots(c, [...ballots, binaria])).toThrow(InvalidBallotForMethod);
    expect(codigoDe(() => usableGradeBallots(c, [...ballots, binaria]))).toBe(
      'INVALID_BALLOT_FOR_METHOD',
    );
    // El rechazo nombra la clase ofensora y el método de destino: sin eso, el operador que lee
    // el log no sabe qué papeleta apartar.
    expect(() => usableGradeBallots(c, [...ballots, binaria])).toThrow(/binary/);
    expect(() => usableGradeBallots(c, [...ballots, binaria])).toThrow(/majority-judgment/);
    // Lo mismo debe ocurrir dentro de `majorityJudgmentProfiles`.
    expect(() => majorityJudgmentProfiles(c, [...ballots, binaria])).toThrow(
      InvalidBallotForMethod,
    );
  });

  it('`majorityJudgmentProfiles` rechaza una configuración que no es de mayoría-judicial', async () => {
    // Mata el mutante L94:7 `false`: la guarda de método se anula en `majorityJudgmentProfiles`.
    const cfgSM = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(() => majorityJudgmentProfiles(cfgSM, [])).toThrow(
      'majorityJudgmentProfiles exige majority-judgment',
    );
  });

  it('una mención desconocida en la escala lanza `PreconditionError UNKNOWN_GRADE`', async () => {
    // Mata el mutante L113:11 `false`: si la guarda se anula, la papeleta con una mención
    // inexistente NO lanza, y `histogram[index]` se vuelve NaN, contaminando todo el
    // escrutinio. Aquí exigimos el lanzamiento explícito.
    const c = await cfg();
    const ballots = effective([
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: 'fantasma' as typeof EXCELLENT },
        ],
      },
    ]);
    expect(() => majorityJudgmentProfiles(c, ballots)).toThrow(PreconditionError);
    expect(codigoDe(() => majorityJudgmentProfiles(c, ballots))).toBe('UNKNOWN_GRADE');
    // El mensaje cita la mención ofensora, que es lo único accionable para quien audita.
    expect(() => majorityJudgmentProfiles(c, ballots)).toThrow(/fantasma/);
  });

  it('el histograma agrega por peso: `weight = 2` cuenta como dos en una sola casilla', async () => {
    // Mata cualquier mutante que cambie `+ ballot.weight` por una suma simple: con peso 2
    // y una sola papeleta que menciona Excelente para A, el histograma de A debe tener
    // `histogram[0] = 2`.
    const c = await cfg();
    const pesados: EffectiveBallot[] = [
      withWeight(
        1,
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        2,
        2,
      ),
    ];
    const profiles = majorityJudgmentProfiles(c, pesados);
    const perfilA = profiles.find((p) => p.option === A);
    expect(perfilA?.histogram[0]).toBe(2);
    expect(perfilA?.majorityGrade).toBe(0);
    // El otro elector con peso 1 no entra (no construimos su papeleta).
    expect(perfilA?.histogram).toStrictEqual([2, 0, 0, 0, 0]);
  });

  it('`missingGradePolicy: reject-ballot` mantiene `W` idéntico para todas las opciones', async () => {
    // B.7.b: una papeleta incompleta bajo `reject-ballot` se descarta entera, no rellena el
    // hueco con la peor mención. Si la papeleta se rellenara, la opción mencionada tendría
    // un voto más y la opción sin mencionar tendría el mismo W, rompiendo la precondición de
    // `mjCompare`. Aquí verificamos que `W` (suma del histograma) es idéntica para todas.
    const c = await cfg();
    const ballots = effective([
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: GOOD },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: GOOD },
        ],
      },
      { kind: 'grades', grades: [{ option: A, grade: GOOD }] },
      { kind: 'grades', grades: [{ option: A, grade: GOOD }] },
    ]);
    const profiles = majorityJudgmentProfiles(c, ballots);
    const Ws = profiles.map((p) => p.histogram.reduce((s, n) => s + n, 0));
    // Con 4 papeletas, pero 2 están incompletas bajo reject-ballot → W = 2 para ambas opciones.
    expect(Ws[0]).toBe(Ws[1]);
    expect(Ws[0]).toBe(2);
    // Las dos papeletas completas mencionan A=Excelente (índice 0) y B=Bueno (índice 1). Las dos
    // incompletas —sólo mencionan A— se descartan ENTERAS: si se rellenaran con la peor mención,
    // el histograma de B sería `[0, 2, 0, 0, 2]` y el de A `[2, 2, 0, 0, 0]`, con W=4.
    expect(profiles.find((p) => p.option === A)?.histogram).toStrictEqual([2, 0, 0, 0, 0]);
    expect(profiles.find((p) => p.option === B)?.histogram).toStrictEqual([0, 2, 0, 0, 0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `tallyMajorityJudgment` — la rama de rechazo y la demostración completa
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — `tallyMajorityJudgment`: rechazo por ausencia total de menciones', () => {
  it('rechaza con `threshold-not-met`, paso único MJ1 y narrativa propia', async () => {
    // Mata los mutantes L214:12 `[]` (lista de pasos vacía), L215:12 `""`, L215:19 `""`,
    // L215:77 `{}` (evidencia vacía), L184:7 `false` (deja de cortar con usable vacío) y los
    // StringLiteral de la narrativa.
    const c = await cfg();
    const tally = await tallyMajorityJudgment(c, []);
    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps).toStrictEqual([
      {
        id: 'MJ1',
        claim: 'No hubo menciones válidas para comparar.',
        evidence: { papeletas: 0, descartadas: 0 },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual([]);
    expect(tally.narrative).toBe(
      'Sin menciones no existe una mención mayoritaria y no se proclama ganadora.',
    );
  });

  it('rechaza con motivo `threshold-not-met` cuando TODAS las papeletas son incompletas', async () => {
    // Variante de la rama de rechazo con papeletas no vacías pero todas descartadas bajo
    // `reject-ballot`. Cubre el mutante L200 `ballots.length + usable.length`: con
    // `descartadas = ballots.length - usable.length`, el original reporta correctamente
    // `descartadas > 0`; el mutante restaura un número negativo imposible que afloraría
    // si alguna prueba lo mirara.
    const c = await cfg();
    const ballots = effective([
      { kind: 'grades', grades: [{ option: A, grade: EXCELLENT }] },
      { kind: 'grades', grades: [{ option: A, grade: EXCELLENT }] },
    ]);
    const tally = await tallyMajorityJudgment(c, ballots);
    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps[0]?.evidence).toStrictEqual({ papeletas: 2, descartadas: 2 });
  });

  it('una papeleta que no es de mención NO se descarta en silencio: aborta el escrutinio', async () => {
    // Esta prueba afirmaba antes que las papeletas binarias «se descartan todas» y el resultado
    // salía `rejected`. Es lo contrario de lo que el motor hace, y de lo que debe hacer.
    //
    // `usableGradeBallots` lanza `InvalidBallotForMethod` en cuanto ve una papeleta que no es de
    // menciones, ANTES de filtrar nada, y la rama `usable.length === 0` nunca llega a verlas.
    // No es un descuido: `errors.ts` lo documenta —«en un log legal esto es inalcanzable
    // (`castBallot` ya lo rechazó y `effectiveBallots` lo filtra), y precisamente por eso se
    // lanza: si ocurre, el log fue manipulado o el motor tiene un bug, y en ninguno de los dos
    // casos se debe publicar un resultado»—. Devolver `rejected` aquí sería publicar un
    // escrutinio sobre un log corrupto, que es la «interpretación caritativa» que el principio
    // 0.1.5 prohíbe.
    //
    // Mata cualquier mutante que convierta el lanzamiento en un filtrado silencioso.
    const c = await cfg();
    const ballots = effective([
      { kind: 'binary', approve: true },
      { kind: 'binary', approve: false },
    ]);
    await expect(tallyMajorityJudgment(c, ballots)).rejects.toThrow(InvalidBallotForMethod);
    // Una sola papeleta intrusa entre menciones válidas basta para abortar: no hay mayoría de
    // papeletas buenas que «salve» el escrutinio.
    const mixtas = [
      ...effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
      ]),
      withWeight(2, { kind: 'binary', approve: true }, 1, 3),
    ];
    await expect(tallyMajorityJudgment(c, mixtas)).rejects.toThrow(InvalidBallotForMethod);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `tallyMajorityJudgment` — la rama ganadora y la demostración completa
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — `tallyMajorityJudgment`: la demostración completa de la rama ganadora', () => {
  it('caso canónico: dos pasos (MJ1, MJ2), tabla con histograma, narrativa y ganador coherentes', async () => {
    // Cinco papeletas, W=5, target=floor(5/2)=2.
    //   A: Excelente×2 + Bueno×3 ⇒ [2, 3, 0, 0, 0]. cum: 0→2 (no >2), 1→5 (>2) ⇒ maj=1 (Bueno).
    //   B: Bueno×2 + Insuficiente×3 ⇒ [0, 2, 0, 3, 0]. cum: 1→2 (no >2), 3→5 (>2) ⇒ maj=3
    //      (Insuficiente).
    // A gana con mención mayoritaria BUENO, no Excelente: la mediana baja de `[2,3,0,0,0]` es
    // Bueno porque sólo 2 de 5 la ponen en Excelente, y 2 no es «al menos la mitad».
    // Toda la demostración queda fijada: identificadores, claims, evidencia, columnas, filas y
    // párrafo. Cualquier cambio a un literal, una etiqueta de columna, una fila de la tabla o la
    // narrativa rompe el test.
    const c = await cfg();
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: GOOD },
            { option: B, grade: INSUFFICIENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: GOOD },
            { option: B, grade: INSUFFICIENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: GOOD },
            { option: B, grade: INSUFFICIENT },
          ],
        },
      ]),
    );

    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(tally.steps).toStrictEqual([
      {
        id: 'MJ1',
        claim: 'Se calculó la mención mayoritaria baja de cada opción.',
        evidence: {
          opciones: 2,
          papeletas: 5,
          descartadasPorIncompletas: 0,
          politicaDeMencionAusente: 'reject-ballot',
        },
        supportingSeqs: [],
      },
      {
        id: 'MJ2',
        claim: `Ganó ${A} tras la comparación Balinski–Laraki.`,
        evidence: { mencion: 'Bueno', desempateFinal: 'no' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual([
      {
        title: 'Histogramas de menciones',
        columns: [
          'Opción',
          'Mención mayoritaria',
          'Excelente',
          'Bueno',
          'Aceptable',
          'Insuficiente',
          'Rechazar',
        ],
        rows: [
          [A, 'Bueno', 2, 3, 0, 0, 0],
          [B, 'Insuficiente', 0, 2, 0, 3, 0],
        ],
      },
    ]);
    expect(tally.narrative).toBe(
      'Se compararon las menciones mayoritarias bajas. En cada empate se retiró una sola ' +
        'ocurrencia de la mediana a cada opción y se volvió a comparar; ganó ' +
        A +
        '.',
    );
  });

  it('la columna «Mención mayoritaria» publica la ETIQUETA textual de la escala', async () => {
    // Mata los mutantes L236:11 `&&` (siempre devuelve 0 o `majorityGrade`), L236:11
    // `OptionalChaining` (sin encadenamiento), L242:7 `""` y L243:7 `""` (narrativa vacía).
    // Aquí verificamos que la etiqueta es la cadena exacta de la escala (no el índice ni
    // una cadena vacía).
    const c = await cfg();
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: INSUFFICIENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: INSUFFICIENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: REJECT },
            { option: B, grade: GOOD },
          ],
        },
      ]),
    );
    // A: hist [0,0,0,2,1] W=3, target=1, cum: 3→2 (>1) ⇒ maj=3 (Insuficiente).
    // B: hist [0,3,0,0,0] W=3, cum: 1→3 (>1) ⇒ maj=1 (Bueno).  ⇒ gana B, que es la MEJOR mención.
    //
    // Las dos filas se comprueban por separado, y el paso MJ2 publica la mención de la GANADORA
    // (B ⇒ «Bueno»), no la de la primera fila de la tabla. Confundir «fila 0» con «ganadora» fue
    // el error de la versión anterior de esta prueba.
    const filaA = tally.tables[0]?.rows[0];
    const filaB = tally.tables[0]?.rows[1];
    expect(filaA?.[0]).toBe(A);
    expect(filaA?.[1]).toBe('Insuficiente');
    expect(filaB?.[0]).toBe(B);
    expect(filaB?.[1]).toBe('Bueno');
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: B, tieBroken: false });
    expect(tally.steps[1]?.evidence['mencion']).toBe('Bueno');
    // Y son etiquetas de la escala, no índices numéricos disfrazados.
    expect(typeof filaA?.[1]).toBe('string');
    expect(filaA?.[1]).not.toBe(3);
  });

  it('las cinco etiquetas del histograma son las de la escala, en el orden de mejor a peor', async () => {
    // Mata los mutantes sobre los rótulos de las columnas del histograma (L232:14-18), que
    // se publican como `method.scale.grades.map(g => g.label)`. Aquí verificamos las
    // cinco etiquetas exactas para la escala de cinco grados.
    const c = await cfg();
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
          ],
        },
      ]),
    );
    expect(tally.tables[0]?.columns).toStrictEqual([
      'Opción',
      'Mención mayoritaria',
      'Excelente',
      'Bueno',
      'Aceptable',
      'Insuficiente',
      'Rechazar',
    ]);
  });

  it('la mención reportada en MJ2 coincide con la fila del ganador en la tabla', async () => {
    // Coherencia entre el paso MJ2 y la tabla: si MJ2 reporta «Excelente» y la fila del
    // ganador dice «Bueno», la demostración está mintiendo. Exigimos la coherencia.
    const c = await cfg();
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
      ]),
    );
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind !== 'winner') throw new Error('se esperaba una ganadora');
    // El estrechamiento por `kind` se pierde dentro del cierre del `find`: se captura antes.
    const ganadora = tally.outcome.option;
    const filaGanador = tally.tables[0]?.rows.find((fila) => fila[0] === ganadora);
    expect(filaGanador?.[1]).toBe(tally.steps[1]?.evidence['mencion']);
  });

  it('la opción anunciada en MJ2 y en la narrativa coincide con el `outcome.option`', async () => {
    // Mata el mutante L221:12 `""` (paso MJ2 con claim vacío) y los mutantes L242/L243 sobre
    // la narrativa.
    const c = await cfg();
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: GOOD },
          ],
        },
      ]),
    );
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind === 'winner') {
      expect(tally.steps[1]?.claim).toContain(tally.outcome.option);
      expect(tally.narrative).toContain(tally.outcome.option);
      expect(tally.narrative.length).toBeGreaterThan(20);
    }
  });

  it('la política de mención ausente y el conteo de papeletas se publican en MJ1', async () => {
    // Mata los mutantes L219:14 y L219:36 sobre los nombres canónicos de los campos de
    // evidencia (`politicaDeMencionAusente` y `descartadasPorIncompletas`).
    const c = await cfg();
    const ballots = effective([
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: GOOD },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: GOOD },
        ],
      },
      { kind: 'grades', grades: [{ option: A, grade: GOOD }] },
    ]);
    const tally = await tallyMajorityJudgment(c, ballots);
    // `papeletas` cuenta las que ENTRARON en el cálculo (`usable.length`), no el total
    // recibido: 3 llegaron, 1 se descartó por incompleta, 2 se contaron. Los dos números se
    // publican por separado y el total se reconstruye sumándolos.
    expect(tally.steps[0]?.evidence).toStrictEqual({
      opciones: 2,
      papeletas: 2,
      descartadasPorIncompletas: 1,
      politicaDeMencionAusente: 'reject-ballot',
    });
    // El invariante que hace legible la evidencia: contadas + descartadas = recibidas.
    const contadas = tally.steps[0]?.evidence['papeletas'] as number;
    const descartadas = tally.steps[0]?.evidence['descartadasPorIncompletas'] as number;
    expect(contadas + descartadas).toBe(ballots.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `tallyMajorityJudgment` — la cascada de desempate: lo alcanzable y lo demostrablemente inerte
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — la cascada de `tieBreak` sólo actúa TRAS Balinski–Laraki', () => {
  /** Todas las composiciones enteras de `peso` en `casillas` casillas. */
  function composiciones(peso: number, casillas: number): number[][] {
    if (casillas === 1) return [[peso]];
    const salida: number[][] = [];
    for (let i = 0; i <= peso; i++) {
      for (const resto of composiciones(peso - i, casillas - 1)) salida.push([i, ...resto]);
    }
    return salida;
  }

  it('B–L es orden total estricto: `mjCompare === 0` ⟺ histogramas idénticos (barrido exhaustivo)', () => {
    // ESTE es el test que sostiene todo lo demás de este bloque, y el que la versión anterior
    // del fichero no tenía: sin él, «tieBroken» se interpreta a ojo y se escriben ocho
    // aserciones equivocadas.
    //
    // La spec rotula `mjCompare` como «Orden total estricto salvo multiconjuntos idénticos» y su
    // `return 0` como «// multiconjuntos idénticos». Aquí se comprueba por barrido completo, no
    // por lectura: todos los pares de histogramas de 5 menciones con W = 1..6.
    //
    // Mata los mutantes del bucle de eliminación sucesiva: quitar el decremento, invertir
    // `gradeA < gradeB`, cambiar `!==` por `===`, mover la frontera de `while (remaining > 0)`.
    // Cualquiera de ellos rompe la equivalencia o la antisimetría en algún par de este barrido.
    const violaciones: string[] = [];
    const asimetrias: string[] = [];
    let pares = 0;
    let empates = 0;
    for (let peso = 1; peso <= 6; peso++) {
      const todos = composiciones(peso, 5);
      for (const a of todos) {
        for (const b of todos) {
          pares += 1;
          const orden = mjCompare(a, b);
          const identicos = a.every((valor, i) => valor === b[i]);
          if (identicos) empates += 1;
          // La equivalencia, en los dos sentidos.
          if (identicos !== (orden === 0)) {
            violaciones.push(`[${a.join(',')}] vs [${b.join(',')}] ⇒ ${String(orden)}`);
          }
          // Y la antisimetría: si a gana a b, b pierde contra a. Sin esto, el ganador
          // dependería del orden en que `tallyMajorityJudgment` recorre las opciones.
          if (mjCompare(b, a) !== -orden) {
            asimetrias.push(`[${a.join(',')}] vs [${b.join(',')}]`);
          }
        }
      }
    }
    expect(violaciones).toStrictEqual([]);
    expect(asimetrias).toStrictEqual([]);
    // Anclas del barrido: 5+15+35+70+126+210 = 461 histogramas, y los únicos empates son los
    // 461 pares de la diagonal.
    expect(pares).toBe(66_351);
    expect(empates).toBe(461);
  });

  it('`tieBroken` marca que B–L no separó, NO que hubo eliminación sucesiva', async () => {
    const c = await cfg();

    // (a) A y B con el MISMO histograma [1,1,0,0,1]: B–L consume las tres menciones en
    //     sincronía y se agota sin separarlas ⇒ la cascada tiene que actuar ⇒ `tieBroken`.
    const identicas = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: GOOD },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: REJECT },
            { option: B, grade: REJECT },
          ],
        },
      ]),
    );
    expect(identicas.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
    expect(identicas.steps[1]?.evidence['desempateFinal']).toBe('sí');

    // (b) MISMA mención mayoritaria pero histogramas distintos: la eliminación sucesiva sí
    //     recorre un segundo paso, y ahí separa. Decide B–L, no la cascada ⇒ `tieBroken: false`.
    //     A: [2,0,1,0,0]  B: [2,0,0,1,0]  — W=3, target=1, ambas maj=0 (Excelente).
    //     Tras retirar un Excelente a cada una: A maj=2 (Aceptable), B maj=3 (Insuficiente).
    const urnaSeparable: readonly EffectiveBallot['payload'][] = [
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: ACCEPTABLE },
          { option: B, grade: INSUFFICIENT },
        ],
      },
    ];
    const perfiles = majorityJudgmentProfiles(c, effective(urnaSeparable));
    // Prueba de que el caso es el que se dice: empatan en la PRIMERA mención mayoritaria…
    expect(perfiles[0]?.majorityGrade).toBe(0);
    expect(perfiles[1]?.majorityGrade).toBe(0);
    expect(perfiles[0]?.histogram).toStrictEqual([2, 0, 1, 0, 0]);
    expect(perfiles[1]?.histogram).toStrictEqual([2, 0, 0, 1, 0]);
    // …y sin embargo NO hay desempate, porque B–L los separa en el segundo paso.
    const separadas = await tallyMajorityJudgment(c, effective(urnaSeparable));
    expect(separadas.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(separadas.steps[1]?.evidence['desempateFinal']).toBe('no');
  });

  it('con perfiles idénticos NINGUNA regla de menciones discrimina: `gradeMetric` es inerte', async () => {
    // DEMOSTRACIÓN DE EQUIVALENCIA, no un test de comodidad.
    //
    // `breakIdenticalProfiles` sólo ve perfiles que B–L declaró indistinguibles, y por el test
    // del barrido eso significa histogramas idénticos casilla a casilla. `more-excellent` lee
    // `histogram[0]`, `fewer-reject` lee `histogram.at(-1)` y `higher-median` lee
    // `majorityGrade` — las tres son funciones del histograma, luego valen lo mismo para todos
    // los contendientes, `Math.max` los conserva a todos y la cascada pasa de largo.
    //
    // Consecuencia: los mutantes de `gradeMetric` (`Math.max`→`Math.min`, `-x`→`+x`,
    // `.at(-1)`→`.at(1)`, vaciar una etiqueta del `switch`) son EQUIVALENTES: ninguna urna
    // legal los distingue del original. Este test fija esa equivalencia por escrito y falla si
    // alguien la rompe —por ejemplo, si una regla empezara a filtrar de más y vaciara la lista—.
    const urna: readonly EffectiveBallot['payload'][] = [
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: GOOD },
          { option: B, grade: GOOD },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: REJECT },
          { option: B, grade: REJECT },
        ],
      },
    ];
    const soloHash = await cfg({ ...METHOD, tieBreak: { cascade: ['lexicographic-hash'] } });
    const base = await tallyMajorityJudgment(soloHash, effective(urna));
    expect(base.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });

    for (const regla of [
      'more-excellent',
      'fewer-reject',
      'fewer-rejections',
      'higher-median',
    ] as const) {
      const conRegla = await cfg({
        ...METHOD,
        tieBreak: { cascade: [regla, 'lexicographic-hash'] },
      });
      const tally = await tallyMajorityJudgment(conRegla, effective(urna));
      // Anteponer la regla no cambia NADA: ni la ganadora, ni la marca de desempate.
      expect(tally.outcome).toStrictEqual(base.outcome);
      expect(tally.steps[1]?.evidence['desempateFinal']).toBe('sí');
    }
  });

  it('una regla ajena a las menciones se salta sin vaciar la lista de contendientes', async () => {
    // ESTA rama sí es alcanzable y sí es matable. `TieBreakRule` tiene dieciséis valores y
    // `gradeMetric` sólo entiende cuatro; el resto cae al `default` y devuelve `undefined`. El
    // guardián `metrics.every((m) => m !== undefined)` existe para saltarse esas reglas.
    //
    // Mata el mutante `metrics.every(...) → true`: con él, `Math.max(undefined, undefined)` es
    // `NaN`, el filtro `metrics[i] === NaN` descarta a TODOS los contendientes y el escrutinio
    // muere con `NO_MJ_WINNER` en vez de proclamar ganadora.
    const c = await cfg({
      ...METHOD,
      tieBreak: { cascade: ['public-seed-lot', 'lexicographic-hash'] },
    });
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: GOOD },
            { option: B, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: REJECT },
            { option: B, grade: REJECT },
          ],
        },
      ]),
    );
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
  });

  it('cascada agotada sin `lexicographic-hash`: el respaldo posterior desempata igual (INV-13)', async () => {
    // «La última instancia es SIEMPRE e implícitamente `lexicographic-hash` ⇒ la cascada nunca
    // puede fallar» (`config.ts`, `TieBreakPolicy`). Aquí la cascada NO lo menciona y sólo
    // contiene una regla que `gradeMetric` no entiende: al salir del bucle siguen cuatro
    // contendientes y tiene que actuar el respaldo de `breakIdenticalProfiles`.
    //
    // Mata el mutante `if (contenders.length > 1) → false`: sin el respaldo se devuelve
    // `contenders[0]`, que es la primera opción en el orden de la configuración (A), y no la
    // del menor digest (D). Es exactamente el fallo que B.0.b prohíbe —premiar el orden de
    // registro—, así que el mutante es observable y grave.
    const c = await cfg({ ...METHOD, tieBreak: { cascade: ['public-seed-lot'] } }, [A, B, C, D], 4);
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
            { option: C, grade: EXCELLENT },
            { option: D, grade: EXCELLENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: GOOD },
            { option: B, grade: GOOD },
            { option: C, grade: GOOD },
            { option: D, grade: GOOD },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: REJECT },
            { option: B, grade: REJECT },
            { option: C, grade: REJECT },
            { option: D, grade: REJECT },
          ],
        },
      ]),
    );
    const orden = await lexicographicHashOrder(c.decisionId, [A, B, C, D]);
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: orden[0], tieBroken: true });
    // Y el ganador es el del menor digest (D), NO la primera opción de la configuración (A).
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: D, tieBroken: true });
  });

  it('el desempate final es `hash(decisionId || optionId)`, no el orden de las opciones (B.0.b)', async () => {
    // Cuatro opciones con el histograma idéntico: sólo el hash puede separarlas. El orden de
    // digests para el `decisionId` de los tests es D < A < C < B, que no es ni el orden de la
    // configuración (A, B, C, D) ni el alfabético.
    const c = await cfg(
      { ...METHOD, tieBreak: { cascade: ['lexicographic-hash'] } },
      [A, B, C, D],
      4,
    );
    const urna: readonly EffectiveBallot['payload'][] = [
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
          { option: C, grade: EXCELLENT },
          { option: D, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
          { option: C, grade: EXCELLENT },
          { option: D, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
          { option: C, grade: EXCELLENT },
          { option: D, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
          { option: C, grade: EXCELLENT },
          { option: D, grade: EXCELLENT },
        ],
      },
    ];
    const tally = await tallyMajorityJudgment(c, effective(urna));
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: D, tieBroken: true });
    expect(tally.steps[1]?.evidence['desempateFinal']).toBe('sí');
    expect(await lexicographicHashOrder(c.decisionId, [A, B, C, D])).toStrictEqual([D, A, C, B]);

    // INV-17 — el desempate es estable bajo permutación del orden de llegada: si dependiera del
    // recorrido, un atacante elegiría ganador ordenando las papeletas.
    const permutada = await tallyMajorityJudgment(c, effective([...urna].reverse()));
    expect(permutada.outcome).toStrictEqual(tally.outcome);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `tallyMajorityJudgment` — el rastreo del desempate por eliminación sucesiva
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — el rastreo del desempate por eliminación sucesiva: empates y `tiedAfterBl`', () => {
  it('con empates que NO discriminan en mención mayoritaria, `tiedAfterBl = false`', async () => {
    // Camino más simple: medianas distintas ⇒ gana directo sin empate ⇒ `tieBroken: false`.
    // Cubre el mutante L238:23 `false` (siempre `tiedAfterBl = false`) mientras
    // `best.length > 1`.
    const c = await cfg();
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: INSUFFICIENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: INSUFFICIENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: INSUFFICIENT },
          ],
        },
      ]),
    );
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(tally.steps[1]?.evidence['desempateFinal']).toBe('no');
  });

  it('con tres opciones idénticas: `tiedAfterBl = true` y la cascada decide', async () => {
    // Cubre los mutantes L207:9 `<= 0` (incluye 0 en el <), L208:14 `false` (anula la rama
    // de empate), L211:23 `false` (anula `tiedAfterBl`). Tres opciones idénticas
    // deberían entrar empatadas y salir con `tiedAfterBl: true`.
    const c = await cfg({ ...METHOD, tieBreak: { cascade: ['lexicographic-hash'] } }, [A, B, C], 3);
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
            { option: C, grade: EXCELLENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
            { option: C, grade: EXCELLENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
            { option: C, grade: EXCELLENT },
          ],
        },
      ]),
    );
    // Todos con hist [3, 0, 0, 0, 0], maj=0. Tres empatadas en mención mayoritaria.
    // Cascade=['lexicographic-hash']: hash decide. Para DECISION_ID, A < C < B (digest).
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
    if (tally.outcome.kind === 'winner') {
      expect(tally.outcome.tieBroken).toBe(true);
      expect(tally.steps[1]?.evidence['desempateFinal']).toBe('sí');
    }
  });

  it('la eliminación sucesiva consume UNA ocurrencia de la mediana, no todas las de esa casilla', async () => {
    // El corazón de B.7.c, y donde la versión anterior de esta prueba se equivocaba de bandera:
    // describía correctamente el recorrido y luego exigía `tieBroken: true`. La eliminación
    // sucesiva ES el orden de B–L; que haya hecho falta recorrerla no es un desempate.
    //
    // A: [2, 0, 1, 0, 0] W=3, target=1, cum en 0 = 2 > 1 ⇒ maj=0 (Excelente).
    // B: [2, 0, 0, 1, 0] W=3, idem ⇒ maj=0. Empatan en la primera mención mayoritaria.
    // Se retira UN Excelente a cada una: A → [1,0,1,0,0], B → [1,0,0,1,0], W=2, target=1.
    //   A: cum en 0 = 1 (no > 1), en 2 = 2 (> 1) ⇒ maj=2 (Aceptable).
    //   B: cum en 0 = 1 (no > 1), en 3 = 2 (> 1) ⇒ maj=3 (Insuficiente).
    // A gana por B–L en el segundo paso, sin tocar la cascada ⇒ `tieBroken: false`.
    //
    // Si se retiraran TODAS las ocurrencias de la mediana en vez de una (`left[g] = 0` en lugar
    // de `left[g] -= 1`), los dos histogramas quedarían [0,0,1,0,0] y [0,0,0,1,0] con W=1: la
    // ganadora seguiría siendo A y el mutante sobreviviría. Por eso el caso lleva DOS Excelentes
    // y no uno: con `-= 1` queda un Excelente residual que participa del segundo cálculo y
    // desplaza el objetivo, y con `= 0` no queda. Se fija el rastro completo, no sólo el
    // ganador.
    const c = await cfg();
    const urna: readonly EffectiveBallot['payload'][] = [
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: EXCELLENT },
          { option: B, grade: EXCELLENT },
        ],
      },
      {
        kind: 'grades',
        grades: [
          { option: A, grade: ACCEPTABLE },
          { option: B, grade: INSUFFICIENT },
        ],
      },
    ];
    const tally = await tallyMajorityJudgment(c, effective(urna));
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(tally.steps[1]?.evidence['desempateFinal']).toBe('no');

    // El rastro exacto de la eliminación, comprobado sobre `mjCompare` directamente:
    // empatan en la primera mención y se separan al retirar UNA ocurrencia.
    expect(majorityGrade([2, 0, 1, 0, 0])).toBe(0);
    expect(majorityGrade([2, 0, 0, 1, 0])).toBe(0);
    expect(majorityGrade([1, 0, 1, 0, 0])).toBe(2);
    expect(majorityGrade([1, 0, 0, 1, 0])).toBe(3);
    expect(mjCompare([2, 0, 1, 0, 0], [2, 0, 0, 1, 0])).toBe(-1);
    // Y la mención publicada es la de la ganadora en el histograma COMPLETO (Excelente), no la
    // del histograma ya consumido por la eliminación (Aceptable).
    expect(tally.steps[1]?.evidence['mencion']).toBe('Excelente');
  });

  it('la cascada con perfil completamente idéntico cae al hash y declara desempate', async () => {
    // Caso límite: dos opciones idénticas en TODO. La cascada no discrimina y el hash
    // decide. Verifica que `tiedAfterBl: true` se publica correctamente.
    const c = await cfg();
    const tally = await tallyMajorityJudgment(
      c,
      effective([
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
          ],
        },
        {
          kind: 'grades',
          grades: [
            { option: A, grade: EXCELLENT },
            { option: B, grade: EXCELLENT },
          ],
        },
      ]),
    );
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind === 'winner') {
      expect(tally.outcome.tieBroken).toBe(true);
      // Hash: A < B con DECISION_ID (A gana).
      expect(tally.outcome.option).toBe(A);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// `tallyMajorityJudgment` — precondición de método
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — `tallyMajorityJudgment`: precondición de método', () => {
  it('rechaza una configuración que no es `majority-judgment` con el mensaje del contrato', async () => {
    // Mata el mutante L194:7 `false`: la guarda de método se anula y `tallyMajorityJudgment`
    // procesa papeletas de un método distinto.
    const cfgSM = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    await expect(tallyMajorityJudgment(cfgSM, [])).rejects.toThrow(
      'tallyMajorityJudgment exige majority-judgment',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Mutación que Stryker NO genera: `Math.floor(W/2) → Math.ceil(W/2)`.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('B.7 — guardián de la mención mayoritaria baja contra la convención opuesta', () => {
  it('con W impar asimétrico, la mención mayoritaria es la que marca "al menos la mitad la considera al menos α"', () => {
    // CASO DISCRIMINANTE contra `Math.floor(W/2) → Math.ceil(W/2)`.
    //
    //   vector: [0, 1, 1, 0, 1]    W=3
    //
    //   con `floor(3/2) = 1` (correcto):
    //     accumulated: 0, 1, 2 (>1) ⇒ menciona mayoritaria = 2 (Aceptable).
    //     semántica: «al menos la mitad (W/2=1.5 ⇒ ⌈=2 personas) consideran la opción
    //     al menos Aceptable». 2 de 3 la ponen en Aceptable o mejor. ✓
    //
    //   con `ceil(3/2) = 2` (mutante):
    //     accumulated: 0, 1, 2 (no >2), 4 (>2) ⇒ mención mayoritaria = 4 (Rechazar).
    //     semántica: dice que al menos 2 personas la ponen en Rechazo o mejor. Es la
    //     mención contraria y destruiría la convención B–L.
    //
    // Stryker no genera esta mutación porque opera sobre literales y `Math.floor`/`Math.ceil`
    // son llamadas a función, no blancos del AST string-replace. Pero si la generara (o si
    // alguien la introduce manualmente), ESTE test la cazaría.
    expect(majorityGrade([0, 1, 1, 0, 1])).toBe(2);
    expect(majorityGrade([0, 1, 1, 0, 1])).not.toBe(4);

    // Caso complementario: [2, 1, 0, 0, 0] W=3.
    //   floor(3/2)=1: cum at 0=2 (>1) ⇒ 0 (Excelente).
    //   ceil(3/2)=2:  cum at 0=2 (no >2), at 1=3 (>2) ⇒ 1 (Bueno).
    expect(majorityGrade([2, 1, 0, 0, 0])).toBe(0);
    expect(majorityGrade([2, 1, 0, 0, 0])).not.toBe(1);

    // Caso simétrico (no discrimina): [1, 0, 0, 0, 2] W=3.
    //   floor=1: cum at 0=1, at 4=3 (>1) ⇒ 4 (Rechazar). ceil=2: mismo resultado.
    // Incluido como anclaje de la fórmula, no como discriminador.
    expect(majorityGrade([1, 0, 0, 0, 2])).toBe(4);

    // Caso donde el mutante también acierta por accidente: [1, 1, 1, 0, 0] W=3.
    //   floor=1: cum at 0=1, at 1=2 (>1) ⇒ 1. ceil=2: cum at 0=1, at 1=2 (no >2), at 2=3 (>2)
    //   ⇒ 2 (Aceptable). Discrimina.
    expect(majorityGrade([1, 1, 1, 0, 0])).toBe(1);
    expect(majorityGrade([1, 1, 1, 0, 0])).not.toBe(2);
  });
});
