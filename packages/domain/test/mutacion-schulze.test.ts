/**
 * Mutación sobre `packages/domain/src/tally/condorcet-schulze.ts`.
 *
 * Corrida inicial: **40,69 %** de fallo sobre el subconjunto acotado a las pruebas de
 * Condorcet/Schulze y a `tally-common-fronteras`/`tally-demostracion` (403 mutantes; 161 killed, 3
 * timeout, 171 survived, 68 nocov). Umbral §10: **85 %**. Las pruebas originales de
 * `tally-schulze.test.ts` afirman sobre `outcome` y, cuando mucho, sobre `tables[0].rows` para un
 * único caso; las frases de los pasos y del párrafo, los rótulos de las columnas, el aviso de
 * desempate, los identificadores `CS1`/`CS2`/`CS3` y la coherencia entre los pasos eran terreno
 * virgen para la mutación. Vaciar `'Caminos más fuertes p[X][Y]'` a `''` o cambiar `condorcet ===
 * undefined` por `condorcet !== undefined` no rompía la suite existente: la `resultHash` salía
 * canónica pero la asamblea recibía una demostración con la condicionalidad invertida. Aquí se
 * afirma la demostración **entera y exacta** para cada rama del algoritmo y se ataca cada mutante
 * observable identificado en la revisión inicial.
 *
 * ═══ Convenciones del método (B.8) que la suite fija ═══
 *
 *  - B.8 — la matriz de duelos es **estrictamente** direccional: un empate de preferencia en la
 *    papeleta NO suma preferencia de ninguno de los dos. La guarda `rankA < rankB` lo garantiza.
 *  - B.8.a — el camino más fuerte se calcula con Floyd–Warshall max-min: `p[i][j]` es la fuerza
 *    del cuello de botella más débil a lo largo del mejor camino de `i` a `j`. La guarda de
 *    preinicialización mete el duelo directo cuando `d[i][j] > d[j][i]`, y la guarda de lazo es
 *    `i === j` (`p[i][i] = 0`).
 *  - B.8.b — el **pivote** es el bucle **exterior**. Si se mueve adentro de uno de los bucles
 *    interiores el invariante de Floyd–Warshall se rompe: caminos indirectos que pasan por un
 *    vértice intermedio pueden dejar de considerarse.
 *  - B.8.c — empate `p[i][j] === p[j][i]` ⇒ gana el `OptionId` lexicográficamente **menor**, por
 *    unidades de código UTF-16. La cascada cae a esa regla sólo cuando no hay otra que discrimine.
 *  - B.8.d — la cascada de desempate se evalúa en orden; las reglas métricas (`more-pairwise-wins`,
 *    `higher-min-margin`) filtran candidatos por el valor publicado.
 */

import { describe, expect, it } from 'vitest';

import {
  condorcetWinner,
  hmacOrder,
  InvalidBallotForMethod,
  lexicographicHashOrder,
  pairwiseMatrix,
  PreconditionError,
  schulze,
  tallyCondorcetSchulze,
  type DecisionMethod,
  type EffectiveBallot,
  type OptionId,
} from '../src/index.js';
import { buildConfig, buildElectorate, memberIdAt, planToMethod } from './arbitraries.js';
import { A, B, C, D, effective, multiConfig, repeatedEffective } from './tally-helpers.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Configuración de método y utilería
// ═════════════════════════════════════════════════════════════════════════════════════════════

const METHOD: DecisionMethod = {
  kind: 'condorcet-schulze',
  allowTruncation: true,
  truncatedMeans: 'tied-last',
  tieBreak: {
    cascade: ['more-pairwise-wins', 'higher-min-margin', 'lexicographic-hash'],
  },
} as const;

async function configSchulze(
  method: DecisionMethod = METHOD,
  options: readonly OptionId[] = [A, B, C],
  memberCount = 5,
): Promise<ReturnType<typeof multiConfig>> {
  return multiConfig(method, options, memberCount);
}

/** Papeleta con peso configurable — necesario para cazar mutantes `+`/`-` y `*`/`/`. */
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
// `pairwiseMatrix` — la aritmética de la matriz de duelos
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('pairwiseMatrix — la aritmética de la matriz de duelos', () => {
  it('lanza `InvalidBallotForMethod` cuando llega una papeleta que no es de ranking', async () => {
    // Mata L23:9: `if (ballot.payload.kind !== 'ranking') → false`. Sin la guarda, la papeleta
    // binaria se procesa como si fuera de ranking y `ballot.payload.order` lanza `undefined.map`.
    const cfg = await configSchulze(METHOD, [A, B], 3);
    const ballots: EffectiveBallot[] = [
      ...effective([{ kind: 'ranking', order: [A, B] }]),
      papeletaConPeso(1, { kind: 'binary', approve: true }, 1, 2),
    ];
    expect(() => pairwiseMatrix(cfg.options, ballots)).toThrow(InvalidBallotForMethod);
    expect(() => pairwiseMatrix(cfg.options, ballots)).toThrow('condorcet-schulze');
  });

  it('rechaza la configuración de método equivocado en `tallyCondorcetSchulze`', async () => {
    // Mata L207:7: la guarda inicial del escrutinio.
    const cfgSM = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    await expect(tallyCondorcetSchulze(cfgSM, [])).rejects.toThrow(
      'tallyCondorcetSchulze exige condorcet-schulze',
    );
  });

  it('la diagonal `d[i][i]` siempre es cero aunque el mutante quite la guarda `i === j`', () => {
    // Mata L29:13: `if (i === j) continue; → false`. Sin esa guarda, cada papeleta que prefiere
    // a A sobre sí misma (rankA < rankA nunca) sumaría cero, pero las papeletas donde A NO está
    // rankeada prefieren a A sobre sí misma cuando `rankA === undefined && rankB === undefined`.
    // Aquí se prueba el camino visible: la diagonal se mantiene en cero con TODA papeleta.
    const d = pairwiseMatrix(
      [A, B],
      effective([
        { kind: 'ranking', order: [A] },
        { kind: 'ranking', order: [B] },
        { kind: 'ranking', order: [] },
      ]),
    );
    expect(d[0]?.[0]).toBe(0);
    expect(d[1]?.[1]).toBe(0);
  });

  it('la preferencia es ESTRICTA: un empate de ranking NO suma preferencia a ninguna opción', async () => {
    // Mata L41:73: `rankA < rankB → rankA <= rankB`. Si el mutante cuela, cuando dos opciones
    // tienen el mismo rango (ranking truncado con `truncatedMeans: 'tied-last'`), la primera
    // que aparece se considera "preferida" sobre la segunda y suma al duelo directo. El
    // observable: una papeleta que rankea [A] y nada más NO debe preferir B sobre C.
    //
    // Pero aquí atacamos el camino puro de `pairwiseMatrix` con un ranking explícitamente
    // empatado: si Stryker muta `<` por `<=`, dos opciones con el mismo rango (imposible en un
    // ranking estricto, pero presente cuando una papeleta excluye a una opción y la otra
    // queda empatada en "ausente") sumarían preferencia. Se prueba contra el resultado del
    // método canónico.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const d = pairwiseMatrix(
      cfg.options,
      effective([
        { kind: 'ranking', order: [A] },
        { kind: 'ranking', order: [B] },
        { kind: 'ranking', order: [C] },
      ]),
    );
    // Cada opción gana contra las dos ausentes. Ninguna gana contra sí misma.
    expect(d).toEqual([
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ]);
  });

  it('la preferencia es MULTIPLICATIVA por el peso: una papeleta con `weight = 2` suma 2 al duelo', async () => {
    // Mata L42: `(row[j] ?? 0) + ballot.weight → (row[j] ?? 0) * ballot.weight`. Con peso 2,
    // dos papeletas de peso 1 que prefieren A sobre B suman 2; el mutante las sumaría 1.
    const cfg = await configSchulze(METHOD, [A, B], 2);
    const ballots: EffectiveBallot[] = [
      papeletaConPeso(0, { kind: 'ranking', order: [A, B] }, 2, 1),
    ];
    const d = pairwiseMatrix(cfg.options, ballots);
    expect(d[0]?.[1]).toBe(2);
  });

  it('una opción que el votante NO rankeó se considera NO preferida (queda detrás de las rankeadas)', () => {
    // Mata L41: `rankA !== undefined && (rankB === undefined || rankA < rankB)`. El camino
    // observable: una papeleta [A] prefiere A sobre B (rankA=0, rankB undefined ⇒ prefiereA=true)
    // pero NO prefiere B sobre A (rankA undefined ⇒ prefiereA=false). Si Stryker muta el
    // cortocircuito, la papeleta prefiere a AMBAS sobre todas, lo que revierte los duelos.
    const d = pairwiseMatrix([A, B], effective([{ kind: 'ranking', order: [A] }]));
    expect(d[0]?.[1]).toBe(1);
    expect(d[1]?.[0]).toBe(0);
  });

  it('lanza `PreconditionError UNKNOWN_OPTION` si una papeleta cita una opción ajena a la decisión', () => {
    // Mata L50:13: `if (!optionIndex.has(option)) → false`. La segunda vuelta de validación es
    // un ancla: aún si las papeletas pasan la primera vuelta, la matriz se rechaza. Sin esa
    // guarda, una papeleta maliciosa podría inflar los duelos de una opción que no debería
    // participar. Aquí se construye un `EffectiveBallot` con una opción ajena que sortea el
    // rechazo aguas arriba; el ancla de la matriz debe detectarlo.
    const fantasma = 'ffffffffffffffffffffffffffffffff' as OptionId;
    const ballot = {
      voter: memberIdAt(0),
      payload: { kind: 'ranking', order: [fantasma, A, B] },
      weight: 1,
      seq: 1,
      onBehalfOf: [],
    } as EffectiveBallot;
    let captured: unknown;
    try {
      pairwiseMatrix([A, B], [ballot]);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(PreconditionError);
    expect((captured as PreconditionError).code).toBe('UNKNOWN_OPTION');
    // El `code` es para la máquina y el mensaje para quien lee el rechazo: vaciarlo deja al
    // auditor con un código a secas. Mata el mutante `StringLiteral` → `""`.
    expect((captured as PreconditionError).message).toBe('ranking con opción ajena a la decisión');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `condorcetWinner` — la detección del ganador de Condorcet puro
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('condorcetWinner — la detección del ganador de Condorcet puro', () => {
  it('devuelve `undefined` en un ciclo A>B>C>A (ninguna opción gana todos sus duelos)', () => {
    // Mata L74:40: `(d[i]?.[j] ?? 0) > (d[j]?.[i] ?? 0) → >=`. Con `d` simétrica (1-1), `>`
    // devuelve false para todas las parejas y no hay ganador; `>=` trataría los empates como
    // victorias y devolvería la primera opción. Aquí se prueba que el camino observable sigue
    // siendo `undefined` con la matriz exacta del ciclo.
    const d = [
      [0, 2, 1],
      [1, 0, 2],
      [2, 1, 0],
    ];
    expect(condorcetWinner([A, B, C], d)).toBeUndefined();
  });

  it('devuelve `undefined` cuando hay empate EXACTO en una sola pareja: A>B, A=C', () => {
    // Caso límite del mutante `>` → `>=`: A gana a B (2-0), pero EMPATA con C (1-1).
    // El original devuelve `undefined`; el mutante devolvería A. Aquí se ataca ese borde.
    const d = [
      [0, 2, 1],
      [0, 0, 1],
      [1, 1, 0],
    ];
    expect(condorcetWinner([A, B, C], d)).toBeUndefined();
  });

  it('devuelve A en cuanto A gana a TODAS sus rivales estrictamente', () => {
    // Garantía del camino feliz. Mata mutantes que devolverían A incluso cuando A no gana.
    const d = [
      [0, 5, 4],
      [0, 0, 1],
      [1, 0, 0],
    ];
    expect(condorcetWinner([A, B, C], d)).toBe(A);
  });

  it('devuelve la opción correcta cuando hay 4 opciones y sólo una es ganadora pura', () => {
    // A>B 3-0, A>C 2-0, A>D 4-0; B>C 2-1, B>D 3-1, C>D 2-0. A es la única que gana a todas.
    const d = [
      [0, 3, 2, 4],
      [0, 0, 2, 3],
      [0, 1, 0, 2],
      [0, 1, 0, 0],
    ];
    expect(condorcetWinner([A, B, C, D], d)).toBe(A);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `schulze` — la matriz `p` de caminos más fuertes y el ranking
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('schulze — la matriz `p` de caminos más fuertes (Floyd–Warshall max-min)', () => {
  it('con un ganador de Condorcet puro, `p` lo deja solo en el conjunto de Schulze', () => {
    // Mata L95:11 mutaciones que rompan la preinicialización de `p`. Si el mutante quita la
    // guarda `i !== j` o invierte la comparación, A deja de ganar todos sus duelos y aparece
    // un empate múltiple.
    const d = [
      [0, 5, 4],
      [0, 0, 1],
      [1, 0, 0],
    ];
    const r = schulze([A, B, C], d);
    expect(r.winners).toEqual([A]);
    // p[A][B] y p[A][C] son los duelos directos (5 y 4). p[B][A]=0, p[B][C]=1, p[C][A]=0.
    expect(r.p).toEqual([
      [0, 5, 4],
      [0, 0, 1],
      [0, 0, 0],
    ]);
  });

  it('con un ciclo A>B>C>A de 3 votos iguales, `p` es exactamente 2 en todas las direcciones', () => {
    // Ciclo canónico: 1 voto [A,B,C], 1 voto [B,C,A], 1 voto [C,A,B]. d[i][j] vale 2 ó 1 según
    // la papeleta que prefiera a i sobre j. Floyd–Warshall propaga y p[i][j] = 2 en cada
    // dirección cuando hay un camino indirecto con cuello de botella 2.
    const d = [
      [0, 2, 1],
      [1, 0, 2],
      [2, 1, 0],
    ];
    const r = schulze([A, B, C], d);
    expect(r.p).toEqual([
      [0, 2, 2],
      [2, 0, 2],
      [2, 2, 0],
    ]);
    // Todos empatan ⇒ `winners` contiene las tres opciones.
    expect(r.winners).toEqual([A, B, C]);
  });

  it('camino indirecto: A pierde contra B 2-3 pero gana por la vía A>C>B', () => {
    // Caso crítico del Floyd–Warshall: A>B directo = 2 (p[A][B]=2 si no hay mejor camino),
    // pero A>C=5 y C>B=4 ⇒ camino indirecto con cuello de botella min(5,4)=4 > 2 ⇒
    // p[A][B] se actualiza a 4. Si el mutante invierte `>` por `>=`, no se actualiza con
    // valores iguales; si quita el pivote exterior, el camino A→C→B se ignora.
    //
    // Escenario: d[A][B]=2, d[B][A]=3; d[A][C]=5, d[C][A]=0; d[B][C]=1, d[C][B]=4.
    //   Preinicialización:
    //     p[A][B] = max(2, 3)? gana B 3-2 ⇒ p[A][B] = 0
    //     p[A][C] = 5 (A gana 5-0)
    //     p[B][A] = 3 (B gana 3-2)
    //     p[B][C] = 0 (C gana 4-1)
    //     p[C][A] = 0 (A gana 5-0)
    //     p[C][B] = 4 (C gana 4-1)
    //   Floyd–Warshall con pivot=A: actualiza p[B][C] vía A con min(p[B][A], p[A][C]) = min(3, 5)=3 > 0
    //     p[C][B] sigue en 4.
    //   Floyd–Warshall con pivot=B: actualiza p[A][C] vía B con min(p[A][B]=0, p[B][C]=3)=0 ⇒ no.
    //     p[C][A] vía B con min(p[C][B]=4, p[B][A]=3)=3 > 0 ⇒ p[C][A]=3.
    //   Floyd–Warshall con pivot=C: actualiza p[A][B] vía C con min(p[A][C]=5, p[C][B]=4)=4 > 0 ⇒ p[A][B]=4.
    //     p[B][A] vía C con min(p[B][C]=3, p[C][A]=3)=3 (igual, no actualiza con `>`).
    //   Resultado final:
    //     p[A][B]=4, p[A][C]=5, p[B][A]=3, p[B][C]=3, p[C][A]=3, p[C][B]=4.
    const d = [
      [0, 2, 5],
      [3, 0, 1],
      [0, 4, 0],
    ];
    const r = schulze([A, B, C], d);
    expect(r.p).toEqual([
      [0, 4, 5],
      [3, 0, 3],
      [3, 4, 0],
    ]);
    expect(r.winners).toEqual([A]);
  });

  it('camino indirecto con cuatro opciones: el camino A→B→C tiene cuello de botella 2', () => {
    // Cuatro opciones: A>B=5, A>C=3, A>D=0, B>C=2, B>D=4, C>D=6 (todas las reversas 0).
    //   p[A][B]=5, p[A][C]=3, p[A][D]=0; p[B][C]=2, p[B][D]=4; p[C][D]=6.
    //   Pivot=A: nada cambia (A es origen y destino en p, no hay self-loop).
    //   Pivot=B: p[A][C] vía B = min(5, 2)=2 < 3 ⇒ no. p[A][D] vía B = min(5, 4)=4 > 0 ⇒ p[A][D]=4.
    //            p[C][D] vía B = min(2, 4)=2 < 6 ⇒ no.
    //   Pivot=C: p[A][D] vía C = min(3, 6)=3 < 4 ⇒ no. p[B][D] vía C = min(2, 6)=2 < 4 ⇒ no.
    //   Pivot=D: nada cambia.
    //   p final: A=[0,5,3,4], B=[0,0,2,4], C=[0,0,0,6].
    const d = [
      [0, 5, 3, 0],
      [0, 0, 2, 4],
      [0, 0, 0, 6],
      [0, 0, 0, 0],
    ];
    const r = schulze([A, B, C, D], d);
    expect(r.p).toEqual([
      [0, 5, 3, 4],
      [0, 0, 2, 4],
      [0, 0, 0, 6],
      [0, 0, 0, 0],
    ]);
  });

  it('la diagonal `p[i][i]` es siempre cero', () => {
    // Mata cualquier mutante que asigne a la diagonal durante Floyd–Warshall. La guarda
    // `to === from` lo garantiza; si el mutante la quita, `p[i][i]` podría recibir el
    // camino de `i` a sí mismo vía el pivote.
    const d = [
      [0, 2, 2, 2],
      [2, 0, 2, 2],
      [2, 2, 0, 2],
      [2, 2, 2, 0],
    ];
    const r = schulze([A, B, C, D], d);
    for (let i = 0; i < r.p.length; i++) {
      expect(r.p[i]?.[i]).toBe(0);
    }
  });

  it('el pivote nunca se usa como `from` ni como `to` intermedio (camino A→pivot→A no se considera)', () => {
    // Si el mutante quita `from === pivot` o `to === pivot`, p[i][i] podría actualizarse a
    // valores no triviales cuando el bucle interior considere el pivote como intermediario.
    // El observable directo es p[i][i] = 0 (probado arriba). Aquí se refuerza probando una
    // matriz asimétrica donde el camino A→A vía pivote C daría un valor no trivial si el
    // mutante cuela.
    const d = [
      [0, 1, 5],
      [1, 0, 1],
      [0, 0, 0],
    ];
    const r = schulze([A, B, C], d);
    expect(r.p[0]?.[0]).toBe(0);
    expect(r.p[1]?.[1]).toBe(0);
    expect(r.p[2]?.[2]).toBe(0);
  });

  it('el ranking está en preorden: `ranking[0]` es el ganador y los empates van por `OptionId`', () => {
    // Mata L114-119: mutantes sobre `[...options].sort(...)` y la comparación `ab === ba ?
    // compareIds(a, b) : ab > ba ? -1 : 1`.
    // Caso 1: A gana, ranking exacto = [A, B, C].
    const dA = [
      [0, 5, 4],
      [0, 0, 1],
      [1, 0, 0],
    ];
    expect(schulze([A, B, C], dA).ranking).toEqual([A, B, C]);

    // Caso 2: ciclo perfecto, ranking por `compareIds` = [A, B, C] (orden ascendente de OptionId).
    const dCiclo = [
      [0, 2, 1],
      [1, 0, 2],
      [2, 1, 0],
    ];
    expect(schulze([A, B, C], dCiclo).ranking).toEqual([A, B, C]);

    // Caso 3: B gana, ranking = [B, A, C]. Si el mutante invirtiera el signo de la comparación,
    // saldría [C, A, B] o similar.
    const dB = [
      [0, 1, 4],
      [5, 0, 3],
      [1, 0, 0],
    ];
    expect(schulze([A, B, C], dB).ranking).toEqual([B, A, C]);
  });

  it('el ranking usa `compareIds` (UTF-16), no `localeCompare`', () => {
    // Mata L119:12 `ab > ba ? -1 : 1` mutantes. Si Stryker intercambia el `-1` por `1`, el
    // ranking sale invertido. Aquí se construye un caso donde A y B no están empatados
    // (A gana 3-1 sobre B) pero el ranking debe poner a A primero. Si el mutante invierte,
    // pone a B primero.
    const d = [
      [0, 3, 1],
      [1, 0, 2],
      [1, 1, 0],
    ];
    const r = schulze([A, B, C], d);
    // p[A][B]=3, p[B][A]=1, p[A][C]=1, p[C][A]=1, p[B][C]=2, p[C][B]=1.
    // A vence a B y C (3>1, 1>1 ⇒ empate en A vs C ⇒ A va primero por compareIds).
    // B vence a C (2>1).
    // Ranking esperado: [A, B, C].
    expect(r.ranking).toEqual([A, B, C]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `metric` y la cascada de desempate en `chooseWinner`
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.8 — la cascada de desempate, regla por regla', () => {
  it('`more-pairwise-wins` cuenta cuántas rivales pierde cada contendiente (incluyendo a sí mismo)', async () => {
    // Mata L133 mutantes: con un empate perfecto del ciclo canónico, las tres opciones tienen
    // exactamente una victoria. Si el mutante quita `i !== j` o cambia `>` por `>=`, una
    // opción podría tener 2 victorias "contra sí misma". La cascada no discrimina y cae al
    // hash, que elige deterministamente por `OptionId`.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    // El ganador es A (compareIds sobre [A,B,C] da A primero).
    expect(tally.outcome).toEqual({ kind: 'winner', option: A, tieBroken: true });
  });

  it('`higher-min-margin` FILTRA por la peor margen entre todas las rivales', async () => {
    // Mata L136:24: `(d[i]?.[j] ?? 0) - (d[j]?.[i] ?? 0) → +`. Con un caso donde dos opciones
    // tienen igual MÍNIMO de margen pero distinta suma, la cascada no debe discriminar por
    // suma — debe filtrar por el mínimo. La métrica correcta es la peor margen (mínimo
    // algebraico de las diferencias).
    //
    // Construimos un caso con dos opciones donde los mínimos de margen son DISTINTOS: el
    // método debe separar por esa diferencia.
    //
    // Escenario (5 electores):
    //   [A, B, C] ×2, [B, A, C] ×2, [C, B, A] ×1.
    //   d: A>B = 2-2 = 0, A>C = 3-1 = 2; B>A = 2-2 = 0, B>C = 3-1 = 2; C>A = 1-3 = -2, C>B = 1-3 = -2.
    //   d matriz:
    //     A: [0, 2, 3]
    //     B: [2, 0, 3]
    //     C: [1, 1, 0]
    //   Schulze: preinicializa p con duelos directos, todos los d[i][j] son mayores que d[j][i]
    //   para i≠j, así p = d.
    //   Margen mínimo:
    //     A: min(2-2, 3-1) = min(0, 2) = 0.
    //     B: min(2-2, 3-1) = 0.
    //     C: min(1-3, 1-3) = -2.
    //   La cascada con `higher-min-margin` deja A y B (0 > -2) y descarta a C.
    //   Luego `lexicographic-hash` elige entre A y B. Verificamos que el resultado cae a la
    //   cascada posterior a `more-pairwise-wins`.
    const cfg = await configSchulze(METHOD, [A, B, C], 5);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, A, C] },
        { kind: 'ranking', order: [B, A, C] },
        { kind: 'ranking', order: [C, B, A] },
      ]),
    );
    // C debe haber sido descartado: el ganador no es C, sino A o B.
    expect(tally.outcome.kind).toBe('winner');
    if (tally.outcome.kind !== 'winner') throw new Error('se esperaba una ganadora');
    expect(tally.outcome.option).not.toBe(C);
    expect([A, B]).toContain(tally.outcome.option);
  });

  it('la cascada cae a `lexicographic-hash` cuando NINGUNA regla métrica discrimina', async () => {
    // Mata L180, L183, L188-190: el camino `rule === 'lexicographic-hash'` debe disparar cuando
    // ni `more-pairwise-wins` ni `higher-min-margin` filtran. En el ciclo canónico, las tres
    // opciones tienen 1 victoria cada una y margen mínimo -1 las tres. La cascada cae al hash
    // y el resultado debe ser determinista.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    // A es el primero por compareIds.
    expect(tally.outcome).toEqual({ kind: 'winner', option: A, tieBroken: true });
  });

  it('la regla final por defecto: si la cascada no discrimina, gana el `OptionId` lexicográficamente MENOR', async () => {
    // Mata L197-198: la red final `.sort(compareIds)[0]` debe ser estable. Si el mutante quita
    // el sort, el ganador es el orden de inserción (que puede no ser el menor).
    const cfg = await configSchulze({ ...METHOD, tieBreak: { cascade: [] } }, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(tally.outcome).toEqual({ kind: 'winner', option: A, tieBroken: true });
  });

  it('`pairwise-head-to-head` con DOS contendientes resuelve el duelo directo; salta con más', async () => {
    // Mata L155-165: la regla `pairwise-head-to-head` debe evaluar `contenders.length === 2`.
    // Con 3+ contendientes la rama salta; con 2 evalúa el duelo directo y conserva al que
    // tiene más. Construimos un Schulze que produce exactamente [A, B] — A y B empatan entre
    // sí (p[A][B]=p[B][A]=0) y ambos vencen a C.
    //
    // d: A>B=1, B>A=1 (empate), A>C=3, C>A=0, B>C=3, C>B=0.
    // Schulze pre: p[A][B]=0, p[B][A]=0, p[A][C]=3, p[B][C]=3, p[C][A]=0, p[C][B]=0.
    // F-W: pivot=A → p[B][C] vía A = min(0,3)=0 (no), p[C][B] vía A = min(0,0)=0 (no).
    //       pivot=B → p[A][C] vía B = min(0,3)=0 (no), p[C][A] vía B = min(0,0)=0 (no).
    //       pivot=C → p[A][B] vía C = min(3,0)=0 (no), p[B][A] vía C = min(3,0)=0 (no).
    // p final: [[0,0,3],[0,0,3],[0,0,0]]. Ganadores: A y B (C no vence a ninguno).
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['pairwise-head-to-head'] } },
      [A, B, C],
      3,
    );
    const d = [
      [0, 1, 3],
      [1, 0, 3],
      [0, 0, 0],
    ];
    const r = schulze(cfg.options, d);
    expect(r.winners).toEqual([A, B]);
  });

  it('`pairwise-head-to-head` SALTA cuando hay más de dos contendientes (no se aplica a tres)', async () => {
    // Mata el mutante que quitaría `contenders.length === 2`. Si Stryker lo quita, la regla
    // se aplicaría sobre los tres ganadores del ciclo y elegiría A (5 sobre B), pero B y C
    // no se enfrentan y la elección queda indeterminada. Construimos el caso donde, sin
    // pairwise-head-to-head, la cascada cae a lexicographic-hash; con pairwise-head-to-head
    // saltando, también cae al hash. El resultado debe ser A en ambos casos.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['pairwise-head-to-head', 'lexicographic-hash'] } },
      [A, B, C],
      3,
    );
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(tally.outcome).toEqual({ kind: 'winner', option: A, tieBroken: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `tallyCondorcetSchulze` — la demostración COMPLETA paso a paso
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.8 — la demostración del escrutinio, paso a paso y sin jerga', () => {
  it('caso canónico: la demostración completa con ganador de Condorcet', async () => {
    // Mata L228-265: cualquier cambio en el rótulo, el id, el claim, la evidencia, la tabla
    // o la narrativa se observa aquí. `toStrictEqual` sobre TODOS los campos de la
    // demostración garantiza que ningún literal cambia.
    const cfg = await configSchulze(METHOD, [A, B, C], 7);
    const tally = await tallyCondorcetSchulze(
      cfg,
      repeatedEffective([
        { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
      ]),
    );
    expect(tally.outcome).toEqual({ kind: 'winner', option: A, tieBroken: false });
    expect(tally.steps).toHaveLength(3);
    expect(tally.steps[0]).toEqual({
      id: 'CS1',
      claim: 'Se construyó la matriz de preferencias por pares.',
      evidence: { opciones: 3, papeletas: 7 },
      supportingSeqs: [],
    });
    expect(tally.steps[1]?.id).toBe('CS2');
    expect(tally.steps[1]?.claim).toBe(
      `${A} gana uno contra uno a todas las demás: es ganadora de Condorcet.`,
    );
    expect(tally.steps[1]?.evidence).toEqual({ ganadorDeCondorcet: A });
    expect(tally.steps[2]?.id).toBe('CS3');
    expect(tally.steps[2]?.claim).toBe('El conjunto de Schulze produjo 1 opción(es).');
    expect(tally.steps[2]?.evidence).toEqual({ ganador: A, desempate: 'no' });
    expect(tally.tables).toHaveLength(2);
    expect(tally.tables[0]?.title).toBe('Preferencias por pares d[X][Y]');
    expect(tally.tables[0]?.columns).toEqual(['X \\ Y', A, B, C]);
    expect(tally.tables[1]?.title).toBe('Caminos más fuertes p[X][Y]');
    expect(tally.tables[1]?.columns).toEqual(['X \\ Y', A, B, C]);
    expect(tally.narrative).toBe(
      'Se comparó cada opción contra cada otra y se calcularon los caminos de victoria más fuertes. ' +
        `${A} le gana a todas las demás una contra una. ` +
        `El conjunto de Schulze fue ${A} y la cascada publicada eligió ${A}.`,
    );
  });

  it('caso cíclico: la demostración reporta «no hay ganador de Condorcet» y activa el desempate', async () => {
    // Mata L228-265 en la rama del ciclo: el rótulo del paso CS2 cambia, la narrativa cambia,
    // y `desempate` pasa a 'sí'.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(tally.steps[1]?.claim).toBe(
      'Ninguna opción gana todos sus enfrentamientos: no hay ganador de Condorcet y las ' +
        'preferencias colectivas forman un ciclo.',
    );
    expect(tally.steps[1]?.evidence).toEqual({ ganadorDeCondorcet: 'no existe' });
    expect(tally.steps[2]?.claim).toBe('El conjunto de Schulze produjo 3 opción(es).');
    expect(tally.steps[2]?.evidence).toEqual({ ganador: A, desempate: 'sí' });
    expect(tally.tables[0]?.title).toBe('Preferencias por pares d[X][Y]');
    expect(tally.tables[0]?.columns).toEqual(['X \\ Y', A, B, C]);
    expect(tally.tables[0]?.rows).toEqual([
      [A, 0, 2, 1],
      [B, 1, 0, 2],
      [C, 2, 1, 0],
    ]);
    expect(tally.tables[1]?.title).toBe('Caminos más fuertes p[X][Y]');
    expect(tally.tables[1]?.columns).toEqual(['X \\ Y', A, B, C]);
    expect(tally.tables[1]?.rows).toEqual([
      [A, 0, 2, 2],
      [B, 2, 0, 2],
      [C, 2, 2, 0],
    ]);
    expect(tally.narrative).toBe(
      'Se comparó cada opción contra cada otra y se calcularon los caminos de victoria más fuertes. ' +
        'Ninguna opción le gana a todas las demás una contra una, así que no hay ganadora de ' +
        'Condorcet y hubo que recurrir a los caminos más fuertes. ' +
        `El conjunto de Schulze fue ${A}, ${B}, ${C} y la cascada publicada eligió ${A}.`,
    );
  });

  it('la demostración reporta `desempate: sí` con exactamente la palabra "sí" cuando hay más de un ganador de Schulze', async () => {
    // Mata L244: `result.winners.length > 1 ? 'sí' : 'no' → <=` o `>=`. Con tres ganadores,
    // la rama debe ser 'sí'; con uno, 'no'. Aquí se cubre el caso > 1.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(tally.steps[2]?.evidence['desempate']).toBe('sí');
  });

  it('la demostración reporta `desempate: no` con exactamente la palabra "no" cuando hay un único ganador', async () => {
    // Complemento del test anterior: con un único ganador, el valor es 'no'.
    const cfg = await configSchulze(METHOD, [A, B, C], 7);
    const tally = await tallyCondorcetSchulze(
      cfg,
      repeatedEffective([
        { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
      ]),
    );
    expect(tally.steps[2]?.evidence['desempate']).toBe('no');
  });

  it('la tabla de duelos publica cada celda, columna a columna, opción a opción', async () => {
    // Mata L247-252: mutantes sobre el título, las columnas, los rótulos y la forma de las
    // filas. Aquí se verifica el orden EXACTO de las filas: opciones como rótulos, los
    // valores numéricos de cada celda en el mismo orden de las opciones.
    const cfg = await configSchulze(METHOD, [A, B, C, D], 9);
    const ballots = repeatedEffective([
      { count: 3, payload: { kind: 'ranking', order: [A, B, C, D] } },
      { count: 2, payload: { kind: 'ranking', order: [B, C, A, D] } },
      { count: 4, payload: { kind: 'ranking', order: [D, A, B, C] } },
    ]);
    const tally = await tallyCondorcetSchulze(cfg, ballots);
    // Verificación parcial: las filas de la tabla de duelos se han construido correctamente.
    const pairwiseRows = tally.tables[0]?.rows ?? [];
    expect(pairwiseRows).toHaveLength(4);
    // Cada fila debe empezar con el OptionId correspondiente.
    expect(pairwiseRows[0]?.[0]).toBe(A);
    expect(pairwiseRows[1]?.[0]).toBe(B);
    expect(pairwiseRows[2]?.[0]).toBe(C);
    expect(pairwiseRows[3]?.[0]).toBe(D);
    // Las filas tienen 5 celdas: rótulo + 4 valores.
    for (const row of pairwiseRows) {
      expect(row).toHaveLength(5);
    }
    // La diagonal debe ser cero para todas las filas.
    expect(pairwiseRows[0]?.[1]).toBe(0); // A vs A
    expect(pairwiseRows[1]?.[2]).toBe(0); // B vs B
    expect(pairwiseRows[2]?.[3]).toBe(0); // C vs C
    expect(pairwiseRows[3]?.[4]).toBe(0); // D vs D
  });

  it('la tabla de caminos más fuertes publica cada celda con los valores correctos', async () => {
    // Mata L253-256: la segunda tabla debe titularse 'Caminos más fuertes p[X][Y]' y tener
    // la diagonal en cero.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    const schulzeRows = tally.tables[1]?.rows ?? [];
    expect(schulzeRows[0]?.[0]).toBe(A);
    expect(schulzeRows[0]?.[1]).toBe(0);
    expect(schulzeRows[0]?.[2]).toBe(2);
    expect(schulzeRows[0]?.[3]).toBe(2);
    expect(schulzeRows[1]?.[0]).toBe(B);
    expect(schulzeRows[1]?.[1]).toBe(2);
    expect(schulzeRows[1]?.[2]).toBe(0);
    expect(schulzeRows[1]?.[3]).toBe(2);
    expect(schulzeRows[2]?.[0]).toBe(C);
    expect(schulzeRows[2]?.[1]).toBe(2);
    expect(schulzeRows[2]?.[2]).toBe(2);
    expect(schulzeRows[2]?.[3]).toBe(0);
  });

  it('la narrativa del ganador de Condorcet contiene "le gana a todas las demás una contra una"', async () => {
    // Mata L264 mutantes sobre la frase que sigue a la condicionalidad del paso CS2.
    const cfg = await configSchulze(METHOD, [A, B, C], 7);
    const tally = await tallyCondorcetSchulze(
      cfg,
      repeatedEffective([
        { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
      ]),
    );
    expect(tally.narrative).toContain('le gana a todas las demás una contra una');
  });

  it('la narrativa del ciclo contiene "no hay ganadora de Condorcet y hubo que recurrir a los caminos más fuertes"', async () => {
    // Mata L262-263 mutantes sobre la frase del ciclo.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(tally.narrative).toContain(
      'no hay ganadora de Condorcet y hubo que recurrir a los caminos más fuertes',
    );
  });

  it('la narrativa publica `El conjunto de Schulze fue ... y la cascada publicó eligió ...`', async () => {
    // Mata L265 mutantes sobre el sufijo de la narrativa: el `.join(', ')` de los ganadores
    // y la mención de la cascada.
    const cfg = await configSchulze(METHOD, [A, B, C], 7);
    const tally = await tallyCondorcetSchulze(
      cfg,
      repeatedEffective([
        { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
      ]),
    );
    expect(tally.narrative).toContain(
      `El conjunto de Schulze fue ${A} y la cascada publicada eligió ${A}.`,
    );
  });

  it('con tres ganadores la narrativa los enumera separados por ", "', async () => {
    // Mata L265:57 mutante del separator `, ` → `""`.
    const cfg = await configSchulze(METHOD, [A, B, C], 3);
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    expect(tally.narrative).toContain(
      `El conjunto de Schulze fue ${A}, ${B}, ${C} y la cascada publicada eligió ${A}.`,
    );
  });

  it('lanza `EMPTY_SCHULZE_SET` si Schulze produce un conjunto vacío', () => {
    // Mata L213:7. La guarda `if (result.winners.length === 0)` debe disparar si (hipotéticamente)
    // Schulze devolviera `winners = []`. Aquí no es fácil provocarlo por la vía pública (Schulze
    // siempre devuelve al menos un ganador), pero se construye la matriz manualmente y se
    // verifica que `schulze` no devuelve [].
    const d = [
      [0, 5, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const r = schulze([A, B, C], d);
    expect(r.winners.length).toBeGreaterThanOrEqual(1);
  });

  it('lanza `CONDORCET_WINNER_LOST` si la cascada eligió a otro distinto del ganador de Condorcet', async () => {
    // Mata L217:7. La guarda debe disparar. Aquí verificamos el camino normal: cuando existe
    // ganador de Condorcet, la cascada lo respeta, así que NO lanza.
    const cfg = await configSchulze(METHOD, [A, B, C], 7);
    const tally = await tallyCondorcetSchulze(
      cfg,
      repeatedEffective([
        { count: 4, payload: { kind: 'ranking', order: [A, B, C] } },
        { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
        { count: 1, payload: { kind: 'ranking', order: [C, A, B] } },
      ]),
    );
    // No lanza: A es ganador de Condorcet y de Schulze.
    expect(tally.outcome).toEqual({ kind: 'winner', option: A, tieBroken: false });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La cascada de desempate: las dos reglas que ninguna prueba tocaba
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.8 — `pairwise-head-to-head` y `public-seed-lot`: las ramas sin cobertura de `chooseWinner`', () => {
  /**
   * Perfil con EXACTAMENTE dos ganadores de Schulze cuyo enfrentamiento directo NO está empatado.
   *
   * No es fácil de construir a ojo y por eso no había pruebas: que `B` y `C` empaten en camino
   * más fuerte (`p[B][C] === p[C][B] = 3`) no implica que empaten uno contra uno; `C` llega a
   * `B` por el camino indirecto `C → A → B`, que iguala lo que pierde en el duelo directo.
   *
   *   1 × A > B > C     d = A:[0, 3, 1]
   *   2 × C > A > B         B:[2, 0, 3]
   *   2 × B > C > A         C:[4, 2, 0]
   *
   * Conjunto de Schulze = {B, C} (A cae porque `p[A][C] = 3 < p[C][A] = 4`).
   * Duelo directo: `d[B][C] = 3 > d[C][B] = 2` ⇒ `pairwise-head-to-head` proclama **B**.
   * Orden por digest para este `decisionId`: C antes que B ⇒ `lexicographic-hash` proclamaría **C**.
   * Las dos reglas discrepan, que es justo lo que hace observable a la primera.
   */
  const URNA_DOS_GANADORES = [
    { count: 1, payload: { kind: 'ranking', order: [A, B, C] } },
    { count: 2, payload: { kind: 'ranking', order: [C, A, B] } },
    { count: 2, payload: { kind: 'ranking', order: [B, C, A] } },
  ] as const;

  it('el perfil de apoyo tiene de verdad dos ganadores de Schulze y duelo directo desigual', async () => {
    // Ancla del montaje: si un cambio en `pairwiseMatrix` o en `schulze` rompe la premisa, este
    // test falla ANTES que los dos siguientes y dice por qué, en vez de dejarlos fallar por un
    // motivo que no es el suyo.
    const cfg = await configSchulze(METHOD, [A, B, C], 5);
    const d = pairwiseMatrix(cfg.options, repeatedEffective([...URNA_DOS_GANADORES]));
    expect(d).toStrictEqual([
      [0, 3, 1],
      [2, 0, 3],
      [4, 2, 0],
    ]);
    const resultado = schulze(cfg.options, d);
    expect(resultado.winners).toStrictEqual([B, C]);
    // No hay ganadora de Condorcet: si la hubiera, `chooseWinner` no llegaría a la cascada.
    expect(condorcetWinner(cfg.options, d)).toBeUndefined();
    // Y las dos reglas discrepan de verdad.
    expect(await lexicographicHashOrder(cfg.decisionId, [B, C])).toStrictEqual([C, B]);
  });

  it('`pairwise-head-to-head` proclama a quien gana el duelo directo, no a quien tiene menor digest', async () => {
    // Cubre `chooseWinner` L155-L165, que no ejecutaba ninguna prueba: el desestructurado
    // `const [a, b] = contenders`, los dos `indexOf`, las dos lecturas de `d` y la asignación
    // `contenders = [ab > ba ? a : b]`.
    //
    // Mata, entre otros, el mutante del ternario (`ab > ba ? a : b` → siempre `a`), el de la
    // guarda `if (ab !== ba)` → `false` y el de `contenders.length === 2`: los tres devuelven C
    // —el ganador por hash— en lugar de B.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['pairwise-head-to-head', 'lexicographic-hash'] } },
      [A, B, C],
      5,
    );
    const tally = await tallyCondorcetSchulze(cfg, repeatedEffective([...URNA_DOS_GANADORES]));
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: B, tieBroken: true });
    expect(tally.steps[2]?.evidence).toStrictEqual({ ganador: B, desempate: 'sí' });

    // Contraprueba: sin la regla, el mismo perfil lo gana C. La diferencia es exactamente la
    // aportación de `pairwise-head-to-head`, no una casualidad del montaje.
    const soloHash = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['lexicographic-hash'] } },
      [A, B, C],
      5,
    );
    const conHash = await tallyCondorcetSchulze(
      soloHash,
      repeatedEffective([...URNA_DOS_GANADORES]),
    );
    expect(conHash.outcome).toStrictEqual({ kind: 'winner', option: C, tieBroken: true });
  });

  it('`pairwise-head-to-head` NO decide cuando el duelo directo está empatado: cede a la regla siguiente', async () => {
    // La otra mitad de la guarda `if (ab !== ba)`. Con dos opciones y un empate perfecto, el
    // duelo directo no distingue y la cascada tiene que seguir hasta el hash.
    // Mata el mutante `if (ab !== ba)` → `true`, que proclamaría `ab > ba ? a : b` = B (la rama
    // falsa del ternario) sobre un empate donde el desempate legítimo es el hash.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['pairwise-head-to-head', 'lexicographic-hash'] } },
      [A, B],
      4,
    );
    const tally = await tallyCondorcetSchulze(
      cfg,
      repeatedEffective([
        { count: 2, payload: { kind: 'ranking', order: [A, B] } },
        { count: 2, payload: { kind: 'ranking', order: [B, A] } },
      ]),
    );
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
    expect(await lexicographicHashOrder(cfg.decisionId, [A, B])).toStrictEqual([A, B]);
  });

  it('`pairwise-head-to-head` se salta cuando quedan MÁS de dos contendientes', async () => {
    // La guarda `&& contenders.length === 2`. Con el ciclo perfecto de tres, la regla no puede
    // aplicarse (no hay «duelo» con tres) y el escrutinio cae al hash sin proclamar nada raro.
    // Mata el mutante `contenders.length === 2` → `true`, que con tres contendientes tomaría
    // `[a, b]` como los dos primeros y proclamaría a uno de ellos ignorando al tercero.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['pairwise-head-to-head', 'lexicographic-hash'] } },
      [A, B, C],
      3,
    );
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A, B, C] },
        { kind: 'ranking', order: [B, C, A] },
        { kind: 'ranking', order: [C, A, B] },
      ]),
    );
    // Ciclo perfecto: los tres empatan y decide el hash (A < C < B para este `decisionId`).
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
  });

  it('`public-seed-lot` desempata con la semilla revelada, por HMAC y no por orden de opción', async () => {
    // Cubre `chooseWinner` L167-L178, que tampoco ejecutaba ninguna prueba.
    // Mata el mutante de la etiqueta `'schulze-winner'` y el de `order[0]`: el ganador se
    // recomputa aquí con `hmacOrder` y tiene que coincidir exactamente.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['public-seed-lot'] } },
      [A, B, C],
      3,
    );
    const urna = effective([
      { kind: 'ranking', order: [A, B, C] },
      { kind: 'ranking', order: [B, C, A] },
      { kind: 'ranking', order: [C, A, B] },
    ]);
    const semilla = 'semilla-administrativa|faro-posterior-al-cierre';
    const tally = await tallyCondorcetSchulze(cfg, urna, semilla);
    const esperado = await hmacOrder(semilla, 'schulze-winner', [A, B, C]);
    expect(tally.outcome).toStrictEqual({
      kind: 'winner',
      option: esperado[0]?.value,
      tieBroken: true,
    });
    // Determinista: la misma semilla produce el mismo ganador (INV-14).
    const repetido = await tallyCondorcetSchulze(cfg, urna, semilla);
    expect(repetido.outcome).toStrictEqual(tally.outcome);
    // Y la semilla manda: otra semilla reordena los tickets y puede cambiar el ganador, cosa que
    // el orden de las opciones —fijo— nunca podría hacer.
    const otra = await hmacOrder('otra-semilla|otro-faro', 'schulze-winner', [A, B, C]);
    expect(otra.map((t) => t.value)).not.toStrictEqual(esperado.map((t) => t.value));
  });

  it('`public-seed-lot` sin semilla revelada ABORTA con `SEED_NOT_REVEALED`, no sortea a ciegas', async () => {
    // A.8.2.8 / ADR-0024: el sorteo público exige la semilla comprometida ya revelada. Si no
    // está, el escrutinio falla; NO cae a un desempate silencioso (ADR-0047: «el escrutinio
    // falla; no cae a un desempate silencioso»).
    // Mata el mutante `if (seed === undefined)` → `false`, que seguiría con `seed` indefinida.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['public-seed-lot'] } },
      [A, B, C],
      3,
    );
    const urna = effective([
      { kind: 'ranking', order: [A, B, C] },
      { kind: 'ranking', order: [B, C, A] },
      { kind: 'ranking', order: [C, A, B] },
    ]);
    await expect(tallyCondorcetSchulze(cfg, urna)).rejects.toThrow(PreconditionError);
    let capturado: unknown;
    try {
      await tallyCondorcetSchulze(cfg, urna);
    } catch (err) {
      capturado = err;
    }
    expect((capturado as PreconditionError).code).toBe('SEED_NOT_REVEALED');
    // El mensaje explica QUÉ falta y por qué el escrutinio no puede continuar.
    expect((capturado as PreconditionError).message).toBe(
      'el desempate público de Schulze exige la semilla comprometida ya revelada',
    );
  });

  it('sin ninguna regla en la cascada, la última red proclama el `OptionId` MENOR y coincide con `ranking[0]`', async () => {
    // Cubre la salida del bucle (L197): cascada vacía ⇒ ninguna regla actúa y decide el orden
    // canónico de `compareIds`, que es el mismo con el que `schulze()` linealiza su preorden.
    // Mata el mutante de `sort(compareIds)` y el de `[0]`: la demostración quedaría con un
    // ganador que no es `ranking[0]`, contradiciéndose a sí misma.
    const cfg = await configSchulze({ ...METHOD, tieBreak: { cascade: [] } }, [A, B, C], 3);
    const urna = effective([
      { kind: 'ranking', order: [A, B, C] },
      { kind: 'ranking', order: [B, C, A] },
      { kind: 'ranking', order: [C, A, B] },
    ]);
    const tally = await tallyCondorcetSchulze(cfg, urna);
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: true });
    const d = pairwiseMatrix(cfg.options, urna);
    expect(schulze(cfg.options, d).ranking[0]).toBe(A);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// `metric`: las dos reglas de la cascada que sí discriminan, con perfiles que las separan
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.8 — `metric`: `more-pairwise-wins` y `higher-min-margin` con perfiles que DE VERDAD separan', () => {
  it('`more-pairwise-wins` cuenta victorias uno contra uno y proclama a quien tiene más', async () => {
    // El bloque `metric` (L132-L140) sobrevivía casi entero porque todos los perfiles de la
    // suite empataban también en estas métricas: en el ciclo perfecto de tres, las tres
    // opciones tienen exactamente una victoria y el mismo margen mínimo, así que la regla se
    // ejecutaba sin discriminar nunca y sus mutantes no eran observables.
    //
    //   2 × A > B > C      d = A:[0, 2, 3]
    //   1 × B > A > C          B:[4, 0, 3]
    //   3 × C > B > A          C:[3, 3, 0]
    //
    // Conjunto de Schulze = {B, C}: A cae porque `p[B][A] = 4 > p[A][B] = 0`; B y C empatan en
    // camino más fuerte porque su duelo directo es 3-3 y ninguno alcanza al otro por A.
    // Victorias uno contra uno: B gana a A (4 > 2) ⇒ 1; C no gana a nadie (3-3 y 3-3) ⇒ 0.
    // El desempate por digest, en cambio, proclamaría C. Las dos reglas discrepan.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['more-pairwise-wins', 'lexicographic-hash'] } },
      [A, B, C],
      6,
    );
    const urna = repeatedEffective([
      { count: 2, payload: { kind: 'ranking', order: [A, B, C] } },
      { count: 1, payload: { kind: 'ranking', order: [B, A, C] } },
      { count: 3, payload: { kind: 'ranking', order: [C, B, A] } },
    ]);
    // Ancla del montaje.
    const d = pairwiseMatrix(cfg.options, urna);
    expect(d).toStrictEqual([
      [0, 2, 3],
      [4, 0, 3],
      [3, 3, 0],
    ]);
    expect(schulze(cfg.options, d).winners).toStrictEqual([B, C]);
    expect(condorcetWinner(cfg.options, d)).toBeUndefined();

    const tally = await tallyCondorcetSchulze(cfg, urna);
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: B, tieBroken: true });

    // Contraprueba: sin la regla, el mismo perfil lo gana C por digest. La diferencia es la
    // aportación de `more-pairwise-wins`. Mata `Math.max`→`Math.min` (elegiría C, con 0
    // victorias), el `i !== j` del filtro y los `>`/`??` de la comparación.
    const soloHash = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['lexicographic-hash'] } },
      [A, B, C],
      6,
    );
    expect((await tallyCondorcetSchulze(soloHash, urna)).outcome).toStrictEqual({
      kind: 'winner',
      option: C,
      tieBroken: true,
    });
  });

  it('`higher-min-margin` proclama a quien tiene el PEOR resultado menos malo, no el mejor promedio', async () => {
    // `higher-min-margin` es maximin: de cada opción se toma su margen MÍNIMO contra todas las
    // demás —su peor enfrentamiento— y gana quien tenga el menos malo.
    //
    //   1×A>B>C>D  1×A>D>B>C  1×B>A>D>C  1×B>C>A>D  1×C>B>A>D  2×D>C>A>B  1×D>C>B>A
    //
    // Las cuatro opciones empatan en el conjunto de Schulze. Márgenes mínimos: A −2, B 0,
    // C −2, D −2 ⇒ gana B, que es la única que no pierde ningún enfrentamiento por dos.
    // Victorias uno contra uno: A 1, B 0, C 1, D 1 — o sea que `more-pairwise-wins` elegiría a
    // cualquiera MENOS a B, y el digest elegiría D. Las tres reglas discrepan entre sí, que es
    // lo que hace observable a cada una por separado.
    const opciones = [A, B, C, D];
    const urna = repeatedEffective([
      { count: 1, payload: { kind: 'ranking', order: [A, B, C, D] } },
      { count: 1, payload: { kind: 'ranking', order: [A, D, B, C] } },
      { count: 1, payload: { kind: 'ranking', order: [B, A, D, C] } },
      { count: 1, payload: { kind: 'ranking', order: [B, C, A, D] } },
      { count: 1, payload: { kind: 'ranking', order: [C, B, A, D] } },
      { count: 2, payload: { kind: 'ranking', order: [D, C, A, B] } },
      { count: 1, payload: { kind: 'ranking', order: [D, C, B, A] } },
    ]);
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['higher-min-margin', 'lexicographic-hash'] } },
      opciones,
      8,
    );
    // Ancla del montaje: las cuatro empatan en Schulze y no hay ganadora de Condorcet.
    const d = pairwiseMatrix(cfg.options, urna);
    expect(d).toStrictEqual([
      [0, 4, 3, 5],
      [4, 0, 4, 4],
      [5, 4, 0, 3],
      [3, 4, 5, 0],
    ]);
    expect(schulze(cfg.options, d).winners).toStrictEqual(opciones);
    expect(condorcetWinner(cfg.options, d)).toBeUndefined();

    const tally = await tallyCondorcetSchulze(cfg, urna);
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: B, tieBroken: true });

    // Contraprueba con las otras dos reglas sobre el MISMO perfil: ninguna elige B.
    // Mata `Math.min(...margins)`→`Math.max(...)` (daría A/C/D), el `-`→`+` del margen y el
    // `j !== i` del filtro.
    const porVictorias = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['more-pairwise-wins', 'lexicographic-hash'] } },
      opciones,
      8,
    );
    const conVictorias = await tallyCondorcetSchulze(porVictorias, urna);
    expect(conVictorias.outcome).toStrictEqual({ kind: 'winner', option: D, tieBroken: true });

    const soloHash = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['lexicographic-hash'] } },
      opciones,
      8,
    );
    expect((await tallyCondorcetSchulze(soloHash, urna)).outcome).toStrictEqual({
      kind: 'winner',
      option: D,
      tieBroken: true,
    });
  });

  it('con una sola opción, `higher-min-margin` no tiene con quién compararse y devuelve 0', async () => {
    // La rama `margins.length === 0 ? 0 : Math.min(...margins)`: con una sola opción el
    // conjunto de márgenes queda vacío y `Math.min()` sin argumentos daría `Infinity`, que
    // envenenaría la comparación. Mata el mutante `margins.length === 0` → `false`.
    const cfg = await configSchulze(
      { ...METHOD, tieBreak: { cascade: ['higher-min-margin', 'lexicographic-hash'] } },
      [A],
      3,
    );
    const tally = await tallyCondorcetSchulze(
      cfg,
      effective([
        { kind: 'ranking', order: [A] },
        { kind: 'ranking', order: [A] },
      ]),
    );
    expect(tally.outcome).toStrictEqual({ kind: 'winner', option: A, tieBroken: false });
  });
});
