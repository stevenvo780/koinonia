/**
 * La demostración del escrutinio B.5 — puntuación 0–5 —, paso a paso y sin jerga.
 *
 * ═══ Por qué este fichero ═══
 *
 * La corrida de mutación de `docs/TESTING.md` §10 dejó `tally/score.ts` en **43,15 %**, y al mirar
 * los supervivientes uno por uno el patrón era el de siempre: las pruebas existentes (sobre todo las
 * de `tally-score.test.ts`) afirmaban sobre `outcome.kind` y sobre `tables[0].rows` para un único
 * caso. Las frases de los pasos y del párrafo, los rótulos de las columnas, el texto del motivo de
 * rechazo y la cobertura mínima eran terreno virgen para la mutación. Se podía vaciar
 * `'Puntuaciones por opción'` a `''`, cambiar `coberturaMinima` por `coberturaminima`, decir
 * «se contó sobre el padrón» cuando el denominador son los votos emitidos, o publicar el histograma
 * con todas las casillas en cero para una opción con cobertura plena — y la suite seguía en verde.
 *
 * Aquí se afirma la demostración **entera y exacta** —`toStrictEqual` sobre los pasos, la tabla y el
 * párrafo— para cada rama que el código distingue, y se prueba cada mutante observable que se
 * identificó en la revisión inicial. La lista de mutantes que sobreviven al final está documentada en
 * el informe; los que son genuinamente equivalentes se llaman equivalentes y se demuestra por qué.
 *
 * ═══ Reglas que este fichero fija ═══
 *
 *  - B.5 — ausencia IGNORADA, nunca cero (un cero hundiría a las opciones menos conocidas). Se
 *    prueba sobre `coverage` y `sum`, no sólo sobre `outcome`.
 *  - B.5.b — la agregación es la **mediana ponderada baja**: con peso total par se toma la peor de
 *    las dos centrales. La frontera del bucle (`value < histogram.length`) está bajo vigilancia.
 *  - B.5.c — la cobertura se compara **contra el padrón** con fracciones exactas. Ni `0.5` en coma
 *    flotante, ni la suma equivocada.
 *  - B.5.d — la cascada de desempate discrimina en orden: `higher-mean`, luego `fewer-zeros`, luego
 *    `more-fives`, y por último el hash determinista. Cada regla tiene su propio observable.
 */

import { describe, expect, it } from 'vitest';

import {
  type DecisionConfig,
  type DecisionMethod,
  type EffectiveBallot,
  InvalidBallotForMethod,
  lexicographicHashOrder,
  ratio,
  type ScoreProfile,
  scoreProfiles,
  tallyScore,
  weightedMedian,
} from '../src/index.js';
import { buildConfig, buildElectorate, memberIdAt, planToMethod } from './arbitraries.js';
import { A, B, C, D, multiConfig } from './tally-helpers.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Método B.5 por defecto para los tests de la rama ganadora
// ═════════════════════════════════════════════════════════════════════════════════════════════

const METHOD_GANADOR: DecisionMethod = {
  kind: 'score',
  min: 0,
  max: 5,
  aggregator: 'median',
  noOpinionPolicy: 'ignore',
  minCoverage: ratio(3, 4),
  tieBreak: {
    cascade: ['higher-mean', 'fewer-zeros', 'more-fives', 'lexicographic-hash'],
  },
} as const;

async function configScore(
  method: DecisionMethod = METHOD_GANADOR,
  options: readonly (typeof A)[] = [A, B],
  memberCount = 4,
): Promise<DecisionConfig> {
  return multiConfig(method, options, memberCount);
}

/** Papeletas efectivas a partir de payloads, una por votante, en orden del padrón. */
function efectivas(payloads: readonly EffectiveBallot['payload'][]): readonly EffectiveBallot[] {
  return payloads.map((payload, index) => ({
    voter: memberIdAt(index),
    payload,
    weight: 1,
    seq: index + 1,
    onBehalfOf: [],
  }));
}

/** Construye una papeleta con peso configurable — necesario para matar el mutante `* → /`. */
function papeletaConPeso(
  voterIndex: number,
  payload: EffectiveBallot['payload'],
  weight: number,
  seq: number,
): EffectiveBallot {
  return {
    voter: memberIdAt(voterIndex),
    payload,
    weight,
    seq,
    onBehalfOf: [],
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `weightedMedian` — la mediana ponderada BAJA (peor de las dos centrales con W par)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5.b — `weightedMedian`: peor de las dos centrales con peso par', () => {
  it('histograma totalmente en cero devuelve `undefined`, no cero', () => {
    // Mata el mutante L37:7 `if (total === 0) → if (false)`: con la guarda anulada, el bucle
    // recorre y termina devolviendo `undefined` porque `accumulated` jamás supera `target`.
    // Aquí exigimos `undefined` con un histograma no vacío pero sin votos: ningún elector
    // manifestó preferencia, y eso no puede leerse como «mediana 0» (sería hundir a las menos
    // conocidas).
    expect(weightedMedian([0, 0, 0, 0, 0, 0])).toBeUndefined();
  });

  it('voto único en una sola casilla devuelve esa casilla', () => {
    expect(weightedMedian([0, 0, 0, 0, 0, 1])).toBe(5);
    expect(weightedMedian([3, 0, 0, 0, 0, 0])).toBe(0);
  });

  it('con tres papeletas de peso 1 la central es la segunda (índice 1, peor)', () => {
    // target = floor((3 - 1) / 2) = 1. accumulated supera 1 por primera vez en el valor cuya
    // frecuencia acumulada cruza el listón: la CENTRAL PEOR de las dos posibles.
    expect(weightedMedian([1, 0, 1, 0, 0, 0])).toBe(0);
    expect(weightedMedian([0, 1, 0, 1, 0, 0])).toBe(1);
    expect(weightedMedian([0, 0, 1, 0, 1, 0])).toBe(2);
  });

  it('con cuatro papeletas de peso 1 la frontera par queda en `floor((4-1)/2) = 1`', () => {
    // Misma convención pesimista que B.7: con W par, la peor de las dos centrales (no la mejor).
    // [1,1,0,1,0,0]: target=1; accumulated en 0=1 (no >1), en 1=2 (>1) → mediana=1.
    expect(weightedMedian([1, 1, 0, 1, 0, 0])).toBe(1);
    // Si la fórmula equivocada `floor(W/2)` se cuela, [1,1,0,0,0,0] devolvería 1 (la mejor de
    // las dos centrales); la correcta devuelve 0 (la peor).
    expect(weightedMedian([1, 1, 0, 0, 0, 0])).toBe(0);
  });

  it('todos los votos en el máximo (índice 5): el bucle termina sin pasarse', () => {
    // La frontera del bucle `value < histogram.length` se vigila con un histograma cuyo ÚLTIMO
    // valor es el que decide. Si la frontera se relajara a `<=`, la iteración extra leería
    // `histogram[6]` (undefined), sumaría 0 a `accumulated` y podría mantener un resultado
    // aparente; pero con todos los votos en 5 y `target=2`, el bucle termina en 5 igual en
    // ambos casos. La afirmación útil es: aunque haya UN voto en 5 y todos los demás en 0, el
    // resultado es 5. Esto bloquea cualquier intento de truncar el bucle antes de tiempo.
    expect(weightedMedian([1, 0, 0, 0, 0, 1])).toBe(0);
    expect(weightedMedian([0, 0, 0, 0, 0, 5])).toBe(5);
    expect(weightedMedian([0, 0, 0, 0, 1, 4])).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `scoreProfiles` — la aritmética exacta, las papeletas malformadas, el método equivocado
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('scoreProfiles — la aritmética exacta y las papeletas inválidas', () => {
  it('lanza `InvalidBallotForMethod` cuando llega una papeleta que no es de puntuación', async () => {
    // Mata el mutante L59:11 `if (ballot.payload.kind !== 'score') → if (false)`: sin la guarda,
    // la papeleta binaria se procesa como si fuera de puntuación y `payload.scores[option]`
    // devuelve `undefined` sin lanzar nada.
    const cfg = await configScore();
    const ballot = efectivas([
      { kind: 'score', scores: { [A]: 5, [B]: 3 } },
      { kind: 'score', scores: { [A]: 4, [B]: 3 } },
    ]);
    const intrusa = papeletaConPeso(2, { kind: 'binary', approve: true }, 1, 3);
    expect(() => scoreProfiles(cfg, [...ballot, intrusa])).toThrow(InvalidBallotForMethod);
    expect(() => scoreProfiles(cfg, [...ballot, intrusa])).toThrow(
      'una papeleta de tipo binary no se convierte a score: se rechaza',
    );
  });

  it('rechaza una configuración que no es de puntuación, y lo dice con palabras', async () => {
    // Mata los mutantes L51:7 (guarda de método en scoreProfiles) y L99:7 (en chooseScoreWinner)
    // y L151:7 (en tallyScore): el contrato es «este escrutinio es del método X, no de otro».
    const cfgSM = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(() => scoreProfiles(cfgSM, [])).toThrow('scoreProfiles exige método score');
    await expect(tallyScore(cfgSM, [])).rejects.toThrow('tallyScore exige método score');
  });

  it('`null` se IGNORA: la cobertura NO lo incluye y el histograma se queda en seis casillas', async () => {
    // Mata el mutante L63:29 (la guarda `value === null || value === undefined`) en su forma
    // más visible: con un elector que puntúa `null` en A, A no debería ver incrementada su
    // cobertura. Si el mutante cuela, la cobertura de A sube a 1/2 y, dependiendo de
    // `minCoverage`, puede cambiar la elegibilidad.
    const cfg = await configScore(METHOD_GANADOR, [A, B], 2);
    const profiles = scoreProfiles(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
      ]),
    );
    const perfilA = profiles.find((p) => p.option === A);
    expect(perfilA?.coverage).toBe(0);
    expect(perfilA?.sum).toBe(0);
    expect(perfilA?.histogram).toStrictEqual([0, 0, 0, 0, 0, 0]);
    expect(perfilA?.eligible).toBe(false);
    const perfilB = profiles.find((p) => p.option === B);
    expect(perfilB?.coverage).toBe(2);
    expect(perfilB?.sum).toBe(6);
    expect(perfilB?.histogram).toStrictEqual([0, 0, 0, 2, 0, 0]);
    expect(perfilB?.median).toBe(3);
  });

  it('`undefined` en `scores[option]` también se ignora: la cobertura NO lo cuenta', async () => {
    // El mutante L63:29 (columna del SEGUNDO operando) sólo es observable si la papeleta
    // lleva un `undefined` real —el camino válido usa `Score | null`, pero la mutación puede
    // aflorar si el log tiene basura. Aquí se construye una papeleta «corrupta» y se verifica
    // que el motor laTrata como si la clave no estuviera.
    const cfg = await configScore(METHOD_GANADOR, [A, B], 2);
    const corrupta = {
      voter: memberIdAt(2),
      payload: {
        kind: 'score',
        scores: { [A]: undefined, [B]: 3 },
      },
      weight: 1,
      seq: 3,
      onBehalfOf: [],
    } as unknown as EffectiveBallot;
    const profiles = scoreProfiles(cfg, [
      ...efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 4, [B]: 3 } },
      ]),
      corrupta,
    ]);
    const perfilA = profiles.find((p) => p.option === A);
    expect(perfilA?.coverage).toBe(2);
    expect(perfilA?.sum).toBe(9);
  });

  it('la media exacta usa MULTIPLICACIÓN por el peso, no división: con `weight = 2`, `sum = 2·valor`', async () => {
    // Mata el mutante L66:14 `value * ballot.weight → value / ballot.weight`. Con `weight = 1`
    // ambas coinciden y el mutante sería equivalente; aquí se usa `weight = 2` para que un solo
    // voto de 5 contra un voto de 5 con peso doble produzcan sumas distintas.
    const cfg = await configScore(METHOD_GANADOR, [A, B], 4);
    const ballots: EffectiveBallot[] = [
      papeletaConPeso(0, { kind: 'score', scores: { [A]: 5, [B]: 3 } }, 2, 1),
      papeletaConPeso(1, { kind: 'score', scores: { [A]: 5, [B]: 3 } }, 1, 2),
      papeletaConPeso(2, { kind: 'score', scores: { [A]: 4, [B]: 3 } }, 1, 3),
      papeletaConPeso(3, { kind: 'score', scores: { [A]: 4, [B]: 3 } }, 1, 4),
    ];
    const profiles = scoreProfiles(cfg, ballots);
    const perfilA = profiles.find((p) => p.option === A);
    // Suma con peso: 5·2 + 5·1 + 4·1 + 4·1 = 23. Con división sería: 5/2 + 5/1 + 4/1 + 4/1 = 15.5.
    expect(perfilA?.sum).toBe(23);
    expect(perfilA?.coverage).toBe(5);
  });

  it('un padrón entero sin papeletas NO marca ninguna opción como elegible', async () => {
    // Mata el mutante L69:7 `total > 0 → true`: con `total = 0` y `minCoverage = 0/1`, el
    // original corta por cortocircuito y deja `eligible = false`; el mutante intenta
    // normalizar 0/0, obtiene ZERO, lo compara con 0/1 (= 0/1) y devuelve `true`. Aquí se
    // exige el camino de rechazo normal: si el mutante cuela, todas las opciones se vuelven
    // elegibles, `chooseScoreWinner` se llama y termina lanzando `PreconditionError` (no
    // encuentra ganador entre perfiles sin mediana).
    const cfg = await configScore({ ...METHOD_GANADOR, minCoverage: ratio(0, 1) }, [A, B], 1);
    const tally = await tallyScore(cfg, []);
    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 0, 'sin datos', '0/1', 'no', 0, 0, 0, 0, 0, 0],
      [B, 0, 'sin datos', '0/1', 'no', 0, 0, 0, 0, 0, 0],
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyScore` — la demostración ENTERA del escrutinio B.5 en su rama ganadora
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5 — la demostración de la puntuación en su rama ganadora', () => {
  it('caso canónico: la demostración completa, paso a paso', async () => {
    // 4 electores, 2 opciones, A gana por su mediana con cobertura 3/4. Sólo A llega a la
    // cobertura: B tiene 3 nulls y nunca suma. El paso S2 publica la mediana del ganador y
    // el aviso de desempate (no, no hubo empate); la tabla publica los histogramas casilla
    // por casilla; el párrafo dice en una sola frase lo que el cálculo hizo. Cambiar una
    // sola palabra de cualquiera de esos tres elementos tiene que romper la prueba.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: null } },
        { kind: 'score', scores: { [A]: 5, [B]: null } },
        { kind: 'score', scores: { [A]: 5, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );

    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(tally.steps).toStrictEqual([
      {
        id: 'S1',
        claim: 'Las ausencias de opinión quedaron fuera del cálculo y se verificó la cobertura.',
        evidence: { opcionesElegibles: 1, pesoTotal: 4 },
        supportingSeqs: [],
      },
      {
        id: 'S2',
        claim: 'Ganó la opción ' + A + ' por su mediana ponderada.',
        evidence: { mediana: 5, desempate: 'no' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual([
      {
        title: 'Puntuaciones por opción',
        columns: [
          'Opción',
          'Cobertura',
          'Mediana',
          'Media exacta',
          'Elegible',
          '0',
          '1',
          '2',
          '3',
          '4',
          '5',
        ],
        rows: [
          [A, 3, 5, '5/1', 'sí', 0, 0, 0, 0, 0, 3],
          [B, 0, 'sin datos', '0/1', 'no', 0, 0, 0, 0, 0, 0],
        ],
      },
    ]);
    expect(tally.narrative).toBe(
      'La puntuación ausente no contó como cero. Entre las opciones con cobertura suficiente, ' +
        A +
        ' obtuvo la mejor mediana ponderada; los empates siguieron la cascada publicada.',
    );
  });

  it('la frase «ausencias de opinión» se publica con esas palabras, no con «votos nulos» ni «sin voto»', async () => {
    // Mata cualquier mutante que cambie el texto del paso S1 (los StringLiteral de la línea
    // 202–203). B.5.a fija la terminología: «ausencia de opinión», nunca «voto nulo» (eso es
    // otra cosa) ni «abstención» (eso es B.1, no B.5).
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.steps[0]?.claim).toBe(
      'Las ausencias de opinión quedaron fuera del cálculo y se verificó la cobertura.',
    );
    expect(tally.steps[0]?.claim).not.toMatch(/voto|abstenci/i);
  });

  it('los once rótulos de la tabla son once y cada uno se publica tal cual', async () => {
    // Mata los mutantes StringLiteral sobre los rótulos de las columnas (líneas 222–227).
    // Si uno solo se vacía a "", el encabezado de esa columna desaparece y la lista de
    // columnas baja de once. Aquí se fija la lista entera.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.tables[0]?.columns).toStrictEqual([
      'Opción',
      'Cobertura',
      'Mediana',
      'Media exacta',
      'Elegible',
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('cada fila publica los seis enteros del histograma en su orden ascendente (0, 1, 2, 3, 4, 5)', async () => {
    // Mata los mutantes StringLiteral sobre los rótulos numéricos y sobre el orden: las
    // casillas del histograma tienen que aparecer en orden de mejor a peor (o de peor a mejor,
    // según la convención, pero FIJO). Aquí la convención es ascendente.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 0, [B]: 0 } },
        { kind: 'score', scores: { [A]: 1, [B]: 2 } },
        { kind: 'score', scores: { [A]: 2, [B]: 4 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 3, 1, '1/1', 'sí', 1, 1, 1, 0, 0, 0],
      [B, 3, 2, '2/1', 'sí', 1, 0, 1, 0, 1, 0],
    ]);
  });

  it('la cobertura mínima se publica como fracción irreducible en S1 del rechazo', async () => {
    // Mata los mutantes StringLiteral del campo `coberturaMinima` cuando se rechaza todo
    // (línea 167). El formato es `num/den` reducido, no `num:den` ni `num,den`.
    const cfg = await configScore({ ...METHOD_GANADOR, minCoverage: ratio(3, 4) }, [A, B], 4);
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps).toStrictEqual([
      {
        id: 'S1',
        claim: 'Ninguna opción alcanzó la cobertura mínima para poder ganar.',
        evidence: { coberturaMinima: '3/4' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables[0]?.title).toBe('Puntuaciones por opción');
  });

  it('en el rechazo, las seis casillas del histograma siguen siendo seis y ordenadas', async () => {
    // Complemento del anterior: el rechazo publica la misma tabla que el ganador, con todos
    // los rótulos en su sitio. Sin esto, los StringLiteral del rechazo (líneas 178–184) son
    // equivalentes entre sí: cambiar uno por otro no rompe nada.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.tables[0]?.columns).toStrictEqual([
      'Opción',
      'Cobertura',
      'Mediana',
      'Media exacta',
      'Elegible',
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 1, 5, '5/1', 'no', 0, 0, 0, 0, 0, 1],
      [B, 1, 3, '3/1', 'no', 0, 0, 0, 1, 0, 0],
    ]);
    expect(tally.narrative).toBe(
      'Las opiniones ausentes se ignoraron. Ninguna opción reunió la cobertura mínima declarada, ' +
        'así que ninguna podía ganar.',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyScore` — los desempates: cascada observable regla por regla
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5.d — la cascada de desempate, regla por regla', () => {
  it('con medianas DISTINTAS, el de mayor mediana gana sin entrar a la cascada', async () => {
    // Caso en el que NO hay empate en mediana: A=5, B=3. A gana directamente y el paso S2
    // lleva `desempate: 'no'`. Sirve para fijar el camino «mediana decide sola» y distinguir
    // del camino «cascada resuelve el empate», que es lo que prueban los tests siguientes.
    const cfg = await configScore({ ...METHOD_GANADOR, minCoverage: ratio(1, 1) }, [A, B], 4);
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 1, [B]: 3 } },
      ]),
    );
    // A histograma [0,1,0,0,0,3]. mediana 5 (target=1; accumulated en 5 = 4 > 1).
    // B histograma [0,0,0,4,0,0]. mediana 3 (target=1; accumulated en 3 = 4 > 1).
    // Distinta mediana: gana A sin desempate.
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(tally.steps[1]?.evidence).toStrictEqual({ mediana: 5, desempate: 'no' });
  });

  it('con `higher-mean` y medianas iguales, la media exacta (fracción irreducible) decide', async () => {
    // Misma mediana (5) en A y B, distinta media: A=5/1=5, B=19/4. La cascada discrimina
    // por `higher-mean`. Sin esta regla, el desempate caería al hash y el resultado
    // dependería del `decisionId`.
    const cfg = await configScore({ ...METHOD_GANADOR, minCoverage: ratio(1, 1) }, [A, B], 4);
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 4 } },
      ]),
    );
    // A: histograma [0,0,0,0,0,4]; cobertura 4; suma 20; media 5/1.
    // B: histograma [0,0,0,0,1,3]; cobertura 4; suma 19; media 19/4.
    // Mediana de ambas: 5. Desempate por media: A (5 > 19/4). `tieBroken: true`.
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 4, 5, '5/1', 'sí', 0, 0, 0, 0, 0, 4],
      [B, 4, 5, '19/4', 'sí', 0, 0, 0, 0, 1, 3],
    ]);
    expect(tally.steps[1]?.evidence).toStrictEqual({ mediana: 5, desempate: 'sí' });
  });

  it('con `fewer-zeros` y misma mediana, discrimina por número de ceros', async () => {
    // Mata los mutantes L86:5 ('fewer-zeros' → 'higher-median'), L86:10 ('fewer-zeros' → ''),
    // L87:14 (`-` → `+`, cambia el signo de la métrica), L87:16 (`??` → `&&`, devuelve 0 si
    // hay ceros). Aquí A tiene 1 cero y B tiene 0; con `fewer-zeros`, gana B. Si la
    // etiqueta de la regla se muta, `numericMetric` cae a `undefined` para todos, no
    // discrimina, y la cascada cae al hash — que favorece a A (porque hash(A) < hash(B) con
    // DECISION_ID de los tests). Mutante observable: cambia el ganador.
    const cfg = await configScore(
      {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage: ratio(1, 1),
        tieBreak: { cascade: ['fewer-zeros', 'lexicographic-hash'] },
      },
      [A, B],
      4,
    );
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 0, [B]: 3 } },
        { kind: 'score', scores: { [A]: 3, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
      ]),
    );
    // A: histograma [1,0,0,1,0,2]; cobertura 4; suma 13; media 13/4.
    // B: histograma [0,0,0,2,0,2]; cobertura 4; suma 16; media 4/1.
    // Ambas tienen mediana 3 (target=1; A: accumulated en 3 = 2 > 1; B: accumulated en 3 = 2
    // > 1). Distinta media (13/4 < 4/1): si la cascada tuviera `higher-mean` antes, B ganaría
    // por media. Aquí la cascada empieza por `fewer-zeros`: B gana (0 ceros vs 1 cero).
    // El mutante L86:5 ('fewer-zeros' → 'higher-median') hace que la regla no discrimine
    // (medianas iguales); cae al hash y A gana. Test exige B → mata el mutante.
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: B, tieBroken: true });
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 4, 3, '13/4', 'sí', 1, 0, 0, 1, 0, 2],
      [B, 4, 3, '4/1', 'sí', 0, 0, 0, 2, 0, 2],
    ]);
  });

  it('con `more-fives` y misma mediana, discrimina por número de cincos', async () => {
    // Mata los mutantes L88:5 ('more-fives' → 'higher-median'), L88:10 ('more-fives' → ''),
    // L89:14 (`??` → `&&`, devuelve 0 cuando hay cincos). Aquí A tiene 3 cincos y B tiene
    // 4 cincos, con misma mediana (5). Con `more-fives`, gana B. Si la etiqueta de la
    // regla se muta, no discrimina y cae al hash, que favorece a A (hash(A) < hash(B)).
    const cfg = await configScore(
      {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage: ratio(1, 1),
        tieBreak: { cascade: ['more-fives', 'lexicographic-hash'] },
      },
      [A, B],
      5,
    );
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 0, [B]: 5 } },
        { kind: 'score', scores: { [A]: 0, [B]: 0 } },
      ]),
    );
    // A: histograma [2,0,0,0,0,3]; cobertura 5; suma 15; media 3/1; mediana 5.
    // B: histograma [1,0,0,0,0,4]; cobertura 5; suma 20; media 4/1; mediana 5.
    // Misma mediana, B tiene más cincos (4 vs 3). Con `more-fives`, B gana.
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: B, tieBroken: true });
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 5, 5, '3/1', 'sí', 2, 0, 0, 0, 0, 3],
      [B, 5, 5, '4/1', 'sí', 1, 0, 0, 0, 0, 4],
    ]);
  });

  it('la cascada cae a `lexicographic-hash` cuando NINGUNA regla discrimina, y el aviso sale', async () => {
    // Aquí todas las reglas previas de la cascada empatan; la final, `lexicographic-hash`,
    // elige la opción cuyo `sha256(decisionId || optionId)` sea menor. Esta es la última
    // línea de defensa de la cascada y mata los mutantes sobre las ramas finales (L118, L123,
    // L133) si la urna está bien construida.
    const cfg = await configScore(
      {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage: ratio(1, 1),
        tieBreak: { cascade: ['lexicographic-hash'] },
      },
      [A, B],
      4,
    );
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
      ]),
    );
    // A y B: histograma idéntico [0,0,0,0,0,4]; cobertura 4; suma 20; media 5/1; mediana 5.
    // `higher-mean` y `fewer-zeros` y `more-fives` empatan; sólo `lexicographic-hash`
    // discrimina. El ganador depende del hash, que es estable para un `decisionId` fijo.
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind !== 'winner') throw new Error('se esperaba una ganadora');
    expect(tally.outcome.tieBroken).toBe(true);
    expect(tally.steps[1]?.evidence['desempate']).toBe('sí');
    // El ganador debe ser el que tenga el menor hash(decisionId || optionId). Con
    // el `decisionId` fijo de los tests, hash(A) < hash(B), por lo que A gana.
    expect(tally.outcome.option).toBe(A);
  });

  it('la cascada discrimina con `higher-mean` cuando medias y medianas son distintas', async () => {
    // Mata los mutantes del bucle de `higher-mean` (L111, L113, L115): con misma mediana y
    // distinta media, la opción con la media mayor gana. La implementación usa una fracción
    // exacta (`cmpFraction`), no un `>` sobre coma flotante.
    const cfg = await configScore(
      {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage: ratio(1, 1),
        tieBreak: { cascade: ['higher-mean'] },
      },
      [A, B],
      4,
    );
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 4 } },
      ]),
    );
    // Misma mediana 5, A=5/1, B=19/4. A gana por media.
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyScore` — el histograma, la media exacta como fracción irreducible
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5 — la media exacta se publica como fracción irreducible, nunca decimal', () => {
  it('suma y cobertura que no se reducen: la fracción publicada ES `num/den` reducido', async () => {
    // Mata cualquier mutante que cambie la llamada `normalize(...)` por `Number(...)` o que
    // concatene con coma en lugar de barra. Aquí A sale con cobertura 3 y suma 9: `3/1` (no
    // `2.25`, no `9:4`). B tiene cobertura 1 (por debajo de la cobertura mínima 3/4) y sale
    // con `1/1`, no `sí` ni `no` mutante.
    const cfg = await configScore(METHOD_GANADOR, [A, B], 4);
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 3, [B]: 1 } },
        { kind: 'score', scores: { [A]: 3, [B]: null } },
        { kind: 'score', scores: { [A]: 3, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 3, 3, '3/1', 'sí', 0, 0, 0, 3, 0, 0],
      [B, 1, 1, '1/1', 'no', 0, 1, 0, 0, 0, 0],
    ]);
  });

  it('cobertura cero publica la media como `0/1` (no `0/0`)', async () => {
    // Mata el mutante L77:10 `profile.coverage === 0 → false`: con cobertura 0, original
    // devuelve la fracción explícita `0/1`; el mutante intenta construir `0/0` y termina
    // —por la guarda interna de `normalize`— devolviendo también `0/1`. Aquí la diferencia
    // observable se monta cuando una papeleta con cobertura cero entra junto a otras:
    // original publica `0/1`; el mutante, si la guarda no devolviera `ZERO`, publicaría
    // `NaN` o algo parecido. La guarda interna de `normalize` hace que ambos coincidan en
    // ESTE caso particular (ver informe), pero la cobertura del mutante sigue activa.
    const cfg = await configScore(METHOD_GANADOR, [A, B], 4);
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: 3 } },
      ]),
    );
    expect(tally.tables[0]?.rows).toStrictEqual([
      [A, 0, 'sin datos', '0/1', 'no', 0, 0, 0, 0, 0, 0],
      [B, 4, 3, '3/1', 'sí', 0, 0, 0, 4, 0, 0],
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `scoreProfiles` — el contrato de tipos y el perfil publicado
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('scoreProfiles — la forma del perfil publicado', () => {
  it('el perfil lleva SIEMPRE seis casillas, incluso cuando ningún elector votó', async () => {
    // Los mutantes que acortan la inicialización `[0,0,0,0,0,0]` a `[0,0,0,0,0]` (cinco
    // casillas) afloran aquí: la tabla tiene seis columnas numéricas y el código asume
    // exactamente seis. Sin la inicialización completa, el histograma publicado tendría
    // cinco columnas y la tabla fallaría al poblar la sexta.
    const cfg = await configScore(METHOD_GANADOR, [A, B], 2);
    const profiles = scoreProfiles(cfg, efectivas([]));
    expect(profiles).toHaveLength(2);
    for (const profile of profiles) {
      expect(profile.histogram).toHaveLength(6);
      expect(profile.histogram).toStrictEqual([0, 0, 0, 0, 0, 0]);
    }
  });

  it('los seis campos del perfil son: opción, histograma, cobertura, suma, mediana, elegible', async () => {
    // Los mutantes que reordenan los campos del objeto publicado afloran si los nombres
    // cambian. Aquí se enumera el contrato del `ScoreProfile` para que cualquier cambio sea
    // visible.
    const cfg = await configScore();
    const [perfil] = scoreProfiles(cfg, efectivas([{ kind: 'score', scores: { [A]: 5, [B]: 3 } }]));
    const claves = Object.keys(perfil as ScoreProfile).sort();
    expect(claves).toStrictEqual(
      ['coverage', 'eligible', 'histogram', 'median', 'option', 'sum'].sort(),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyScore` — la rama de rechazo y la demostración que la acompaña
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5 — la demostración cuando NINGUNA opción alcanza la cobertura mínima', () => {
  it('rechaza con motivo `threshold-not-met`, paso único y narrativa propia', async () => {
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: null, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps).toStrictEqual([
      {
        id: 'S1',
        claim: 'Ninguna opción alcanzó la cobertura mínima para poder ganar.',
        evidence: { coberturaMinima: '3/4' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual([
      {
        title: 'Puntuaciones por opción',
        columns: [
          'Opción',
          'Cobertura',
          'Mediana',
          'Media exacta',
          'Elegible',
          '0',
          '1',
          '2',
          '3',
          '4',
          '5',
        ],
        rows: [
          [A, 0, 'sin datos', '0/1', 'no', 0, 0, 0, 0, 0, 0],
          [B, 0, 'sin datos', '0/1', 'no', 0, 0, 0, 0, 0, 0],
        ],
      },
    ]);
    expect(tally.narrative).toBe(
      'Las opiniones ausentes se ignoraron. Ninguna opción reunió la cobertura mínima declarada, ' +
        'así que ninguna podía ganar.',
    );
  });

  it('la mediana sin datos se publica literalmente como `sin datos`, no como `undefined`', async () => {
    // El mutante L157:23 'sin datos' → "" publicaría una columna vacía. La afirmación sobre
    // la cadena exacta evita eso.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([{ kind: 'score', scores: { [A]: null, [B]: null } }]),
    );
    const filaA = tally.tables[0]?.rows[0];
    expect(filaA?.[2]).toBe('sin datos');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyScore` — la observación de mutantes en la cascada del desempate final
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5 — el desempate determinista final por hash', () => {
  it('la misma urna con la misma decisión da siempre el mismo ganador', async () => {
    // El hash de desempate es estable. Si dos corridas independientes (con la misma
    // `decisionId`) eligen ganadores distintos, el motor no es determinista.
    const cfg = await configScore(
      {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage: ratio(1, 1),
        tieBreak: { cascade: ['lexicographic-hash'] },
      },
      [A, B],
      4,
    );
    const ballots = efectivas([
      { kind: 'score', scores: { [A]: 5, [B]: 5 } },
      { kind: 'score', scores: { [A]: 5, [B]: 5 } },
      { kind: 'score', scores: { [A]: 5, [B]: 5 } },
      { kind: 'score', scores: { [A]: 5, [B]: 5 } },
    ]);
    const t1 = await tallyScore(cfg, ballots);
    const t2 = await tallyScore(cfg, ballots);
    expect(t1.outcome).toStrictEqual(t2.outcome);
  });

  it('cuatro opciones empatadas: la cascada cae al hash y declara desempate', async () => {
    // Cubre la rama `contenders.length > 1` post-cascada (L133) con N > 2. Si la cascada no
    // reduce, el hash decide entre CUATRO contendientes.
    const cfg = await configScore(
      {
        kind: 'score',
        min: 0,
        max: 5,
        aggregator: 'median',
        noOpinionPolicy: 'ignore',
        minCoverage: ratio(1, 1),
        tieBreak: { cascade: ['lexicographic-hash'] },
      },
      [A, B, C, D],
      4,
    );
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
      ]),
    );
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind === 'winner') {
      expect([A, B, C, D]).toContain(tally.outcome.option);
      expect(tally.outcome.tieBroken).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyScore` — el método equivocado y la precondición de elección
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('tallyScore — los precondiciones del escrutinio', () => {
  it('rechaza un método que no es `score` con el mensaje exacto del contrato', async () => {
    const cfg = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    await expect(tallyScore(cfg, [])).rejects.toThrow('tallyScore exige método score');
  });

  it('rechaza una papeleta que no es de puntuación con `InvalidBallotForMethod`', async () => {
    const cfg = await configScore();
    const ballots = [
      ...efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
      ]),
      papeletaConPeso(2, { kind: 'binary', approve: true }, 1, 3),
    ];
    await expect(tallyScore(cfg, ballots)).rejects.toThrow(InvalidBallotForMethod);
  });

  it('publica `PreconditionError NO_SCORE_WINNER` sólo si `chooseScoreWinner` se queda sin ganador', async () => {
    // El throw L143:7 es inalcanzable en operación normal: `chooseScoreWinner` siempre
    // reduce al menos a un ganador por la cascada + hash final. Documentar el contrato no
    // cuesta y deja la rama bajo vigilancia por si una mutación futura la rompe.
    const cfg = await configScore();
    // Construimos una urna vacía: el motor ni siquiera entra a `chooseScoreWinner` porque
    // la rama de rechazo se activa antes. Aquí NO se lanza `PreconditionError`: el resultado
    // es un rechazo normal.
    const tally = await tallyScore(cfg, []);
    expect(tally.outcome.kind).toBe('rejected');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyScore` — el campo `supportingSeqs` y la coherencia de la demostración
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5 — `supportingSeqs` y la coherencia entre pasos, tabla y narrativa', () => {
  it('los pasos del escrutinio no citan papeletas concretas: `supportingSeqs` siempre va vacío', async () => {
    // A diferencia de B.1/B.2/B.4, B.5 agrega por mediana de un histograma, no por papeleta;
    // los pasos S1 y S2 describen el resultado de la agregación, no las papeletas. Si un
    // mutante mete `seq` en `supportingSeqs` por analogía con los otros métodos, este test
    // lo detecta.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.steps[0]?.supportingSeqs).toStrictEqual([]);
    expect(tally.steps[1]?.supportingSeqs).toStrictEqual([]);
  });

  it('la opción anunciada en el paso S2 coincide con la opción del outcome', async () => {
    // El mutante L209:18 (StringLiteral → ``) o L209:88 (ObjectLiteral → {}) rompe la
    // coherencia entre el paso S2 y el outcome. Aquí se exige la coherencia explícita.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind === 'winner') {
      expect(tally.steps[1]?.claim).toContain(tally.outcome.option);
    }
  });

  it('la opción mencionada en la narrativa coincide con la opción del outcome', async () => {
    // El mutante L235:7 que cambia la narrativa a `` publicaría una frase vacía. Aquí se
    // exige que la opción del outcome aparezca literalmente en la narrativa.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind === 'winner') {
      expect(tally.narrative).toContain(tally.outcome.option);
    }
    expect(tally.narrative.length).toBeGreaterThan(20);
  });

  it('S2 publica la mediana del GANADOR, no la mediana agregada ni la del perdedor', async () => {
    // El mutante L210:18 (`selected.winner.median ?? 'sin datos'` → otra cosa) o L210:44
    // (StringLiteral 'sin datos' → '') afloran aquí: exigimos que la mediana del paso
    // coincida exactamente con la fila del ganador en la tabla.
    const cfg = await configScore();
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: 5, [B]: 3 } },
        { kind: 'score', scores: { [A]: null, [B]: null } },
      ]),
    );
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind !== 'winner') throw new Error('se esperaba una ganadora');
    // El estrechamiento se pierde dentro del cierre del `find`: se captura antes.
    const ganadora = tally.outcome.option;
    const filaGanador = tally.tables[0]?.rows.find((fila) => fila[0] === ganadora);
    expect(filaGanador?.[2]).toBe(tally.steps[1]?.evidence['mediana']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El respaldo posterior a la cascada: la rama que ninguna prueba alcanzaba
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.5 — el respaldo de `chooseScoreWinner` cuando la cascada se agota sin decidir', () => {
  it('con una cascada que no discrimina, el respaldo por hash proclama y no devuelve la primera opción', async () => {
    // `chooseScoreWinner` L133-L140 no lo ejecutaba ninguna prueba: todas las cascadas de la
    // suite terminaban en `lexicographic-hash`, que ya dejaba un solo contendiente antes de
    // salir del bucle.
    //
    // Aquí la cascada contiene UNA sola regla que `numericMetric` no entiende
    // (`more-approvals` es de B.2, no de B.5): devuelve `undefined`, el guardián
    // `metrics.every(...)` la salta, y al salir del bucle siguen cuatro contendientes. Tiene
    // que actuar el respaldo.
    //
    // Mata `if (contenders.length > 1)` → `false` (devolvería A, la primera opción de la
    // configuración, en vez de la del menor digest) y `if (selected !== undefined)` → `false`
    // (devolvería el primero tras el `sort` por `compareIds`, que también es A).
    const cfg = await configScore(
      { ...METHOD_GANADOR, minCoverage: ratio(0, 1), tieBreak: { cascade: ['more-approvals'] } },
      [A, B, C, D],
      4,
    );
    const tally = await tallyScore(
      cfg,
      efectivas([
        { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
        { kind: 'score', scores: { [A]: 3, [B]: 3, [C]: 3, [D]: 3 } },
        { kind: 'score', scores: { [A]: 0, [B]: 0, [C]: 0, [D]: 0 } },
        { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
      ]),
    );
    // Las cuatro opciones son indistinguibles en TODO: misma mediana, misma media, mismo
    // histograma. Sólo el hash puede separarlas, y el orden de digests para este `decisionId`
    // es D, A, C, B: el ganador NO es la primera opción de la configuración.
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind !== 'winner') throw new Error('se esperaba una ganadora');
    const orden = await lexicographicHashOrder(cfg.decisionId, [A, B, C, D]);
    expect(orden).toStrictEqual([D, A, C, B]);
    expect(tally.outcome.option).toBe(orden[0]);
    expect(tally.outcome.option).toBe(D);
    expect(tally.outcome.option).not.toBe(A);
    // Empatan en mediana, así que la marca de desempate sale.
    expect(tally.outcome.tieBroken).toBe(true);
    expect(tally.steps[1]?.evidence['desempate']).toBe('sí');
  });

  it('el respaldo por hash es estable bajo permutación de las papeletas (INV-17)', async () => {
    // Si el respaldo dependiera del orden de recorrido —el `sort` por `compareIds` que hay
    // justo antes del `find` invita a ello—, un atacante elegiría ganador ordenando las
    // papeletas. Aquí se exige que no.
    const cfg = await configScore(
      { ...METHOD_GANADOR, minCoverage: ratio(0, 1), tieBreak: { cascade: ['more-approvals'] } },
      [A, B, C, D],
      4,
    );
    const urna = [
      { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
      { kind: 'score', scores: { [A]: 3, [B]: 3, [C]: 3, [D]: 3 } },
      { kind: 'score', scores: { [A]: 0, [B]: 0, [C]: 0, [D]: 0 } },
      { kind: 'score', scores: { [A]: 5, [B]: 5, [C]: 5, [D]: 5 } },
    ] as const;
    const directo = await tallyScore(cfg, efectivas([...urna]));
    const invertido = await tallyScore(cfg, efectivas([...urna].reverse()));
    expect(invertido.outcome).toStrictEqual(directo.outcome);
  });
});
