/**
 * La **demostración** del escrutinio de B.2 (mayoría reforzada) y B.4 (unanimidad).
 *
 * ═══ Por qué existe este fichero ═══
 *
 * La corrida de mutación de `docs/TESTING.md` §10 dejó `tally/supermajority.ts` en **19,23 %** y
 * `tally/unanimity.ts` en **43,40 %**, y al mirar los supervivientes uno por uno el patrón era
 * siempre el mismo: los tests afirmaban sobre `outcome.kind` y **nada más**. `steps`, `tables` y
 * `narrative` no los miraba nadie. Se podía vaciar cada frase de la demostración a `""`, cambiar
 * «al menos» por «más de», decir «sobre todo el padrón» cuando el denominador eran los votos
 * emitidos, o publicar «No votaron: 400» sobre un censo de 300 —el mutante `census - represented`
 * → `census + represented`—, y la suite entera seguía en verde.
 *
 * Eso no es un detalle cosmético. La demostración **entra en la preimagen del `resultHash`**
 * (`resultHashPreimage`, `common.ts`), es lo único que una asamblea lee para creerse el resultado, y
 * es la diferencia entre un recuento auditable y un número que hay que aceptar por fe. Un motor que
 * calcula bien y explica mal es un motor que no se puede impugnar.
 *
 * Aquí se afirma la demostración **entera y exacta** —`toStrictEqual` sobre los pasos, la tabla y el
 * párrafo— para cada rama que el código distingue. Es deliberadamente rígido: si alguien cambia una
 * frase, esta prueba tiene que romperse y obligar a decidir a conciencia si el cambio es correcto.
 */

import { describe, expect, it } from 'vitest';

import {
  abstentionNarrative,
  type DecisionConfig,
  type EffectiveBallot,
  effectiveBallots,
  InvalidBallotForMethod,
  type ProofTable,
  type TallyContext,
  tallySimpleMajority,
  tallySupermajority,
  tallyUnanimity,
} from '../src/index.js';
import {
  buildConfig,
  buildElectorate,
  makeBallots,
  OPTION_MAIN,
  planToMethod,
  type Vote,
} from './arbitraries.js';

function ctx(config: DecisionConfig): TallyContext {
  return {
    window: { opensAt: config.window.opensAt, closesAt: config.window.closesAt },
    round: 1,
    proposalVersionHash: config.proposalVersionHash,
    closedAt: config.window.closesAt,
    voided: [],
  };
}

/** Papeletas efectivas a partir de planes `{votante, voto}` explícitos. */
function efectivas(
  config: DecisionConfig,
  planes: readonly { readonly voterIndex: number; readonly vote: Vote }[],
): readonly EffectiveBallot[] {
  return effectiveBallots(config, makeBallots(planes), ctx(config));
}

/** Una persona por voto, en el orden del padrón. */
function enOrden(config: DecisionConfig, votos: readonly Vote[]): readonly EffectiveBallot[] {
  return efectivas(
    config,
    votos.map((vote, i) => ({ voterIndex: i, vote })),
  );
}

function votos(si: number, no: number, abstenciones = 0): readonly Vote[] {
  return [
    ...Array.from({ length: si }, () => 'yes' as const),
    ...Array.from({ length: no }, () => 'no' as const),
    ...Array.from({ length: abstenciones }, () => 'abstain' as const),
  ];
}

function recuento(
  aFavor: number,
  enContra: number,
  abstencion: number,
  noVoto: number,
): readonly ProofTable[] {
  return [
    {
      title: 'Recuento',
      columns: ['Casilla', 'Peso'],
      rows: [
        ['A favor', aFavor],
        ['En contra', enContra],
        ['Abstención explícita', abstencion],
        ['No votó', noVoto],
      ],
    },
  ];
}

const seqs = (hasta: number): readonly number[] =>
  Array.from({ length: hasta }, (_, i): number => i + 1);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.0.4 — la frase que describe el denominador
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.0.4 — `abstentionNarrative` dice en castellano qué denominador se usó', () => {
  /**
   * Las seis combinaciones. `base:'census'` **gana siempre** sobre la política de abstención: da
   * igual lo que diga `abstentionPolicy`, si el denominador es el padrón la frase tiene que avisar
   * de que callar pesa como votar en contra. Ninguna prueba distinguía esto: con la rama de censo
   * mutada a `false`, las tres filas de censo devolvían la frase de `cast` y nadie se enteraba.
   */
  it.each([
    [
      'exclude',
      'cast',
      'Las abstenciones no cuentan para este cálculo, pero sí cuentan para la participación mínima.',
    ],
    [
      'include',
      'cast',
      'Las abstenciones entran en el denominador: abstenerse equivale a votar «no».',
    ],
    ['as-no', 'cast', 'Las abstenciones se contaron como votos en contra.'],
    [
      'exclude',
      'census',
      'El umbral se mide sobre el censo completo: quien no vota pesa como un voto en contra.',
    ],
    [
      'include',
      'census',
      'El umbral se mide sobre el censo completo: quien no vota pesa como un voto en contra.',
    ],
    [
      'as-no',
      'census',
      'El umbral se mide sobre el censo completo: quien no vota pesa como un voto en contra.',
    ],
  ] as const)('%s sobre %s', (policy, base, esperado) => {
    expect(abstentionNarrative(policy, base)).toBe(esperado);
  });

  it('las tres políticas sobre `cast` dan tres frases DISTINTAS', () => {
    const frases = (['exclude', 'include', 'as-no'] as const).map((p) =>
      abstentionNarrative(p, 'cast'),
    );
    expect(new Set(frases).size).toBe(3);
    for (const frase of frases) expect(frase.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.1 — mayoría simple
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.1 — la demostración de la mayoría simple', () => {
  async function config(abstentionPolicy: 'exclude' | 'include' | 'as-no' = 'exclude', censo = 10) {
    return buildConfig({
      electorate: await buildElectorate(censo),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy }),
    });
  }

  it('aprobada: la demostración completa, paso a paso', async () => {
    const cfg = await config();
    const tally = tallySimpleMajority(cfg, enOrden(cfg, votos(6, 3)));

    expect(tally.outcome).toStrictEqual({ kind: 'approved', option: OPTION_MAIN });
    expect(tally.steps).toStrictEqual([
      {
        id: 'S1',
        claim: 'Se emitieron 9 papeletas, que representan a 9 de 10 personas del padrón.',
        evidence: { papeletas: 9, representados: 9, censo: 10 },
        supportingSeqs: seqs(9),
      },
      {
        id: 'S2',
        claim: 'A favor: 6. En contra: 3. Abstenciones explícitas: 0. No votaron: 1.',
        evidence: { aFavor: 6, enContra: 3, abstenciones: 0, noVotaron: 1 },
        supportingSeqs: seqs(9),
      },
      {
        id: 'S3',
        claim:
          'El denominador aplicado es 9. Las abstenciones no cuentan para este cálculo, pero sí ' +
          'cuentan para la participación mínima.',
        evidence: { denominador: '9', politica: 'exclude', base: 'cast' },
        supportingSeqs: [],
      },
      {
        id: 'S4',
        claim: '6 de 9 es 66.66 %, y se exigía más de 50.00 %.',
        evidence: { cociente: '6/9', exigido: '1/2', estricto: 'sí' },
        supportingSeqs: [],
      },
      {
        id: 'S5',
        claim: 'Hubo más síes que noes: la propuesta se aprueba.',
        evidence: { aprobada: 'sí' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual(recuento(6, 3, 0, 1));
    expect(tally.narrative).toBe(
      'Se aprueba si hay más síes que noes. Las abstenciones no cuentan para este cálculo, pero ' +
        'sí cuentan para la participación mínima. Hubo 6 a favor y 3 en contra sobre un ' +
        'denominador de 9, de modo que la propuesta queda aprobada.',
    );
  });

  /**
   * B.1.b — `strict` es siempre `true`: el empate **no** aprueba. Y S5 tiene una frase propia para
   * él, distinta de «no se alcanzó el umbral», porque un empate y una derrota no son lo mismo para
   * quien tiene que decidir si vuelve a llevar la propuesta.
   */
  it('el empate tiene su propia frase, distinta de la derrota', async () => {
    const cfg = await config();
    const empate = tallySimpleMajority(cfg, enOrden(cfg, votos(3, 3)));
    const derrota = tallySimpleMajority(cfg, enOrden(cfg, votos(2, 4)));

    expect(empate.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(empate.steps[3]?.claim).toBe('3 de 6 es 50.00 %, y se exigía más de 50.00 %.');
    expect(empate.steps[4]).toStrictEqual({
      id: 'S5',
      claim: 'Hubo empate. En un empate no cambia nada: la propuesta se rechaza.',
      evidence: { aprobada: 'no' },
      supportingSeqs: [],
    });

    expect(derrota.steps[3]?.claim).toBe('2 de 6 es 33.33 %, y se exigía más de 50.00 %.');
    expect(derrota.steps[4]?.claim).toBe('No se alcanzó el umbral: la propuesta se rechaza.');
    expect(empate.steps[4]?.claim).not.toBe(derrota.steps[4]?.claim);
  });

  /**
   * La urna vacía **no es un empate**, aunque `A = R = 0`. Sin la guarda `den > 0n`, S5 anunciaba
   * «Hubo empate» a una asamblea en la que no votó nadie: una frase falsa que sugiere que hubo
   * disputa donde sólo hubo silencio.
   */
  it('cero contra cero NO es empate: es ausencia de votos computables', async () => {
    const cfg = await config();
    const tally = tallySimpleMajority(cfg, enOrden(cfg, votos(0, 0, 4)));

    expect(tally.steps[3]).toStrictEqual({
      id: 'S4',
      claim: 'No hubo ni un solo voto computable: sin votos no se aprueba nada.',
      evidence: { cociente: '0/0', exigido: '1/2', estricto: 'sí' },
      supportingSeqs: [],
    });
    expect(tally.steps[4]?.claim).toBe('No se alcanzó el umbral: la propuesta se rechaza.');
    expect(tally.steps[4]?.claim).not.toContain('empate');
    expect(tally.narrative).toContain('denominador de 0');
  });

  it('la política de abstención elegida se publica en S3 y en el párrafo', async () => {
    for (const [policy, denominador, frase] of [
      [
        'exclude',
        '5',
        'Las abstenciones no cuentan para este cálculo, pero sí cuentan para la participación mínima.',
      ],
      [
        'include',
        '8',
        'Las abstenciones entran en el denominador: abstenerse equivale a votar «no».',
      ],
      ['as-no', '8', 'Las abstenciones se contaron como votos en contra.'],
    ] as const) {
      const cfg = await config(policy);
      const tally = tallySimpleMajority(cfg, enOrden(cfg, votos(3, 2, 3)));
      expect(tally.steps[2]).toStrictEqual({
        id: 'S3',
        claim: `El denominador aplicado es ${denominador}. ${frase}`,
        evidence: { denominador, politica: policy, base: 'cast' },
        supportingSeqs: [],
      });
      expect(tally.narrative).toBe(
        `Se aprueba si hay más síes que noes. ${frase} Hubo 3 a favor y 2 en contra sobre un ` +
          `denominador de ${denominador}, de modo que la propuesta ` +
          `${denominador === '5' ? 'queda aprobada' : 'queda rechazada'}.`,
      );
    }
  });

  it('los `seq` que sustentan el paso se publican ordenados, no en orden de padrón', async () => {
    const cfg = await config();
    const tally = tallySimpleMajority(
      cfg,
      efectivas(cfg, [
        { voterIndex: 3, vote: 'yes' },
        { voterIndex: 0, vote: 'yes' },
        { voterIndex: 2, vote: 'no' },
        { voterIndex: 1, vote: 'yes' },
      ]),
    );
    expect(tally.steps[0]?.supportingSeqs).toStrictEqual([1, 2, 3, 4]);
    expect(tally.steps[1]?.supportingSeqs).toStrictEqual([1, 2, 3, 4]);
  });

  it('el silencio publicado es censo menos representados', async () => {
    const cfg = await config('exclude', 12);
    const tally = tallySimpleMajority(cfg, enOrden(cfg, votos(3, 1)));
    expect(tally.steps[1]?.evidence['noVotaron']).toBe(8);
    expect(tally.tables[0]?.rows[3]).toStrictEqual(['No votó', 8]);
  });

  it('rechaza que se le pase un método que no es el suyo, y lo dice', async () => {
    const ajeno = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'unanimity', base: 'cast', abstentionBlocks: false }),
    });
    expect(() => tallySimpleMajority(ajeno, [])).toThrow(InvalidBallotForMethod);
    expect(() => tallySimpleMajority(ajeno, [])).toThrow(
      'una papeleta de tipo simple-majority no se convierte a unanimity: se rechaza',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.2 — mayoría reforzada
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.2 — la demostración de la mayoría reforzada', () => {
  async function config(
    base: 'cast' | 'census',
    strict = false,
    abstentionPolicy: 'exclude' | 'include' | 'as-no' = 'exclude',
    censo = 30,
  ) {
    return buildConfig({
      electorate: await buildElectorate(censo),
      method: planToMethod({
        kind: 'supermajority',
        num: 2,
        den: 3,
        strict,
        base,
        abstentionPolicy,
      }),
    });
  }

  /**
   * El caso canónico de la cabecera del módulo, a escala 1:10: `N = 30`, `A = 14`, `R = 6`, `f = 2/3`
   * con `≥`. Sobre votos emitidos es `14/20 = 70 %` y **aprueba**.
   */
  it('sobre votos emitidos: la demostración completa, paso a paso', async () => {
    const cfg = await config('cast');
    const tally = tallySupermajority(cfg, enOrden(cfg, votos(14, 6)));

    expect(tally.outcome).toStrictEqual({ kind: 'approved', option: OPTION_MAIN });
    expect(tally.steps).toStrictEqual([
      {
        id: 'S1',
        claim: 'Se emitieron 20 papeletas, que representan a 20 de 30 personas del padrón.',
        evidence: { papeletas: 20, representados: 20, censo: 30 },
        supportingSeqs: seqs(20),
      },
      {
        id: 'S2',
        claim: 'A favor: 14. En contra: 6. Abstenciones explícitas: 0. No votaron: 10.',
        evidence: { aFavor: 14, enContra: 6, abstenciones: 0, noVotaron: 10 },
        supportingSeqs: seqs(20),
      },
      {
        id: 'S3',
        claim:
          'El denominador aplicado es 20. Las abstenciones no cuentan para este cálculo, pero sí ' +
          'cuentan para la participación mínima.',
        evidence: { denominador: '20', politica: 'exclude', base: 'cast' },
        supportingSeqs: [],
      },
      {
        id: 'S4',
        claim: '14 de 20 es 70.00 %, y se exigía al menos 2/3 (66.66 %).',
        evidence: { cociente: '14/20', exigido: '2/3', estricto: 'no' },
        supportingSeqs: [],
      },
      {
        id: 'S5',
        claim: 'Se alcanzó la mayoría reforzada exigida: la propuesta se aprueba.',
        evidence: { aprobada: 'sí' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual(recuento(14, 6, 0, 10));
    expect(tally.narrative).toBe(
      'Esta decisión exigía al menos 2/3 de apoyo sobre los votos computables. Hubo 14 a favor ' +
        'sobre un denominador de 20, de modo que la propuesta queda aprobada.',
    );
  });

  /**
   * La MISMA urna sobre censo: `14/30 = 46.66 %` y **rechaza**. Lo que se comprueba aquí no es sólo
   * el resultado —eso ya estaba probado— sino que S3, S4, S5 y el párrafo **dicen otra cosa**. Con
   * `method.base === 'census'` mutado, el motor seguía rechazando pero explicaba el rechazo con la
   * frase de los votos emitidos: la conclusión correcta con la justificación equivocada, que en una
   * impugnación es exactamente igual de inservible.
   */
  it('sobre censo: la misma urna, la misma papeleta, otra explicación entera', async () => {
    const cfg = await config('census');
    const tally = tallySupermajority(cfg, enOrden(cfg, votos(14, 6)));

    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps.map((s) => s.id)).toStrictEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(tally.steps[2]).toStrictEqual({
      id: 'S3',
      claim:
        'El umbral se mide sobre el censo completo: 30 personas. Quien no vota cuenta, en la ' +
        'práctica, como un voto en contra.',
      evidence: { denominador: '30', politica: 'exclude', base: 'census' },
      supportingSeqs: [],
    });
    expect(tally.steps[3]).toStrictEqual({
      id: 'S4',
      claim: '14 de 30 es 46.66 %, y se exigía al menos 2/3 (66.66 %).',
      evidence: { cociente: '14/30', exigido: '2/3', estricto: 'no' },
      supportingSeqs: [],
    });
    expect(tally.steps[4]).toStrictEqual({
      id: 'S5',
      claim: 'No se alcanzó la mayoría reforzada exigida: la propuesta se rechaza.',
      evidence: { aprobada: 'no' },
      supportingSeqs: [],
    });
    expect(tally.narrative).toBe(
      'Esta decisión exigía al menos 2/3 de apoyo sobre todo el padrón. Hubo 14 a favor sobre un ' +
        'denominador de 30, de modo que la propuesta queda rechazada.',
    );
  });

  /**
   * B.2.c — `strict` no sólo cambia el resultado en la frontera: cambia el **comparador que se
   * publica**. «al menos 2/3» y «más de 2/3» son dos reglas distintas y la prueba tiene que poder
   * distinguirlas, o el motor puede aplicar una y anunciar la otra.
   */
  it('`strict` cambia el comparador que se publica, no sólo el resultado', async () => {
    const laxo = await config('cast', false);
    const estricto = await config('cast', true);
    const urna = votos(20, 10); // 20/30 es EXACTAMENTE 2/3

    const conLaxo = tallySupermajority(laxo, enOrden(laxo, urna));
    const conEstricto = tallySupermajority(estricto, enOrden(estricto, urna));

    expect(conLaxo.outcome).toStrictEqual({ kind: 'approved', option: OPTION_MAIN });
    expect(conLaxo.steps[3]?.claim).toBe(
      '20 de 30 es 66.66 %, y se exigía al menos 2/3 (66.66 %).',
    );
    expect(conLaxo.steps[3]?.evidence).toStrictEqual({
      cociente: '20/30',
      exigido: '2/3',
      estricto: 'no',
    });
    expect(conLaxo.narrative).toContain('exigía al menos 2/3');

    expect(conEstricto.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(conEstricto.steps[3]?.claim).toBe(
      '20 de 30 es 66.66 %, y se exigía más de 2/3 (66.66 %).',
    );
    expect(conEstricto.steps[3]?.evidence).toStrictEqual({
      cociente: '20/30',
      exigido: '2/3',
      estricto: 'sí',
    });
    expect(conEstricto.narrative).toContain('exigía más de 2/3');
  });

  /**
   * Denominador cero con papeletas de por medio: tres personas se abstuvieron con política
   * `exclude`, así que hubo participación pero **no hay nada que dividir**. S4 tiene que decirlo con
   * palabras y no publicar un porcentaje inventado.
   */
  it('sin un solo voto computable S4 lo dice, y el cociente publicado es 0/0', async () => {
    const cfg = await config('cast');
    const tally = tallySupermajority(cfg, enOrden(cfg, votos(0, 0, 3)));

    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps[1]).toStrictEqual({
      id: 'S2',
      claim: 'A favor: 0. En contra: 0. Abstenciones explícitas: 3. No votaron: 27.',
      evidence: { aFavor: 0, enContra: 0, abstenciones: 3, noVotaron: 27 },
      supportingSeqs: [1, 2, 3],
    });
    expect(tally.steps[3]).toStrictEqual({
      id: 'S4',
      claim: 'No hubo ni un solo voto computable: sin votos no se aprueba nada.',
      evidence: { cociente: '0/0', exigido: '2/3', estricto: 'no' },
      supportingSeqs: [],
    });
    expect(tally.tables).toStrictEqual(recuento(0, 0, 3, 27));
    expect(tally.narrative).toBe(
      'Esta decisión exigía al menos 2/3 de apoyo sobre los votos computables. Hubo 0 a favor ' +
        'sobre un denominador de 0, de modo que la propuesta queda rechazada.',
    );
  });

  /**
   * El silencio es `censo − representados`. Un `+` en su lugar publicaba «No votaron: 50» sobre un
   * padrón de 30 y ninguna prueba lo veía, ni en el paso ni en la tabla.
   */
  it('el silencio publicado es censo menos representados, en el paso y en la tabla', async () => {
    const cfg = await config('cast', false, 'exclude', 30);
    const tally = tallySupermajority(cfg, enOrden(cfg, votos(4, 1)));

    expect(tally.steps[1]?.evidence['noVotaron']).toBe(25);
    expect(tally.steps[1]?.claim).toContain('No votaron: 25.');
    expect(tally.tables[0]?.rows[3]).toStrictEqual(['No votó', 25]);
    const sumaDeLaTabla = (tally.tables[0]?.rows ?? []).reduce(
      (total, fila) => total + Number(fila[1]),
      0,
    );
    expect(sumaDeLaTabla).toBe(30); // la tabla reparte el padrón entero, sin sobrantes
  });

  /**
   * `supportingSeqs` se publica **ordenado ascendentemente**, no en el orden en que las papeletas
   * salen del padrón. Aquí la persona 3 votó primero y la persona 0 segunda, así que sin el `.sort`
   * la lista saldría `[2, 4, 3, 1]`. La prueba que ya existía usaba votantes en el mismo orden que
   * los `seq`, con lo cual ordenar y no ordenar daban lo mismo y los tres mutantes del comparador
   * —quitarlo, devolver `undefined`, cambiar `a - b` por `a + b`— sobrevivían los tres.
   */
  it('los `seq` que sustentan el paso se publican ordenados, no en orden de padrón', async () => {
    const cfg = await config('cast');
    const tally = tallySupermajority(
      cfg,
      efectivas(cfg, [
        { voterIndex: 3, vote: 'yes' },
        { voterIndex: 0, vote: 'yes' },
        { voterIndex: 2, vote: 'no' },
        { voterIndex: 1, vote: 'yes' },
      ]),
    );
    expect(tally.steps[0]?.supportingSeqs).toStrictEqual([1, 2, 3, 4]);
    expect(tally.steps[1]?.supportingSeqs).toStrictEqual([1, 2, 3, 4]);
    // Y los pasos que no se sustentan en papeletas concretas no citan ninguna.
    expect(tally.steps[2]?.supportingSeqs).toStrictEqual([]);
    expect(tally.steps[3]?.supportingSeqs).toStrictEqual([]);
    expect(tally.steps[4]?.supportingSeqs).toStrictEqual([]);
  });

  it('la política de abstención elegida se publica en S3 y cambia el denominador', async () => {
    for (const [policy, denominador, frase] of [
      [
        'exclude',
        '8',
        'Las abstenciones no cuentan para este cálculo, pero sí cuentan para la participación mínima.',
      ],
      [
        'include',
        '12',
        'Las abstenciones entran en el denominador: abstenerse equivale a votar «no».',
      ],
      ['as-no', '12', 'Las abstenciones se contaron como votos en contra.'],
    ] as const) {
      const cfg = await config('cast', false, policy);
      const tally = tallySupermajority(cfg, enOrden(cfg, votos(6, 2, 4)));
      expect(tally.steps[2]).toStrictEqual({
        id: 'S3',
        claim: `El denominador aplicado es ${denominador}. ${frase}`,
        evidence: { denominador, politica: policy, base: 'cast' },
        supportingSeqs: [],
      });
      expect(tally.narrative).toContain(`denominador de ${denominador}`);
    }
  });

  it('la aprobación arrastra la opción de la decisión; el rechazo, el motivo', async () => {
    const cfg = await config('cast');
    expect(tallySupermajority(cfg, enOrden(cfg, votos(9, 1))).outcome).toStrictEqual({
      kind: 'approved',
      option: OPTION_MAIN,
    });
    expect(tallySupermajority(cfg, enOrden(cfg, votos(1, 9))).outcome).toStrictEqual({
      kind: 'rejected',
      reason: 'threshold-not-met',
    });
  });

  it('rechaza que se le pase un método que no es el suyo, y lo dice', async () => {
    const ajeno = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'unanimity', base: 'cast', abstentionBlocks: false }),
    });
    expect(() => tallySupermajority(ajeno, [])).toThrow(InvalidBallotForMethod);
    expect(() => tallySupermajority(ajeno, [])).toThrow(
      'una papeleta de tipo supermajority no se convierte a unanimity: se rechaza',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.4 — unanimidad
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.4 — la demostración de la unanimidad', () => {
  async function config(base: 'cast' | 'census', abstentionBlocks: boolean, censo = 5) {
    return buildConfig({
      electorate: await buildElectorate(censo),
      method: planToMethod({ kind: 'unanimity', base, abstentionBlocks }),
    });
  }

  it('aprobada sobre votos emitidos: la demostración completa', async () => {
    const cfg = await config('cast', false);
    const tally = tallyUnanimity(cfg, enOrden(cfg, ['yes', 'yes', 'abstain']));

    expect(tally.outcome).toStrictEqual({ kind: 'approved', option: OPTION_MAIN });
    expect(tally.steps).toStrictEqual([
      {
        id: 'S1',
        claim: 'Se emitieron 3 papeletas, que representan a 3 de 5 personas del padrón.',
        evidence: { papeletas: 3, representados: 3, censo: 5 },
        supportingSeqs: [1, 2, 3],
      },
      {
        id: 'S2',
        claim: 'A favor: 2. En contra: 0. Abstenciones explícitas: 1. No votaron: 2.',
        evidence: { aFavor: 2, enContra: 0, abstenciones: 1, noVotaron: 2 },
        supportingSeqs: [1, 2, 3],
      },
      {
        id: 'S3',
        claim:
          'La unanimidad se exige sobre 2 personas computables. Las abstenciones explícitas se ' +
          'apartan del cálculo.',
        evidence: { denominador: 2, base: 'cast', laAbstencionBloquea: 'no' },
        supportingSeqs: [],
      },
      {
        id: 'S4',
        claim: 'Todas las personas computables apoyaron y ninguna se opuso.',
        evidence: { aprobada: 'sí' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual(recuento(2, 0, 1, 2));
    expect(tally.narrative).toBe(
      'Esta decisión exigía unanimidad: basta una sola oposición para que no pase. Todas las ' +
        'personas computables apoyaron y ninguna se opuso. La propuesta queda aprobada.',
    );
  });

  /**
   * **El hueco que más me sorprendió.** No había ni una sola prueba de que una decisión con
   * `abstentionBlocks: true` pudiera APROBARSE. Todas la usaban para comprobar que una abstención la
   * rompe. Consecuencia: el mutante `counts.abstain > 0` → `counts.abstain >= 0` sobrevivía tan
   * campante, y ese mutante convierte el consenso puro en un método que **no puede aprobar nunca**
   * —cero abstenciones también bloquean—. Un fallo así, en producción, deja a un círculo incapaz de
   * acordar nada y sin ninguna prueba en rojo que lo señale.
   */
  it('con `abstentionBlocks: true` y cero abstenciones, la unanimidad SÍ aprueba', async () => {
    const cfg = await config('cast', true);
    const tally = tallyUnanimity(cfg, enOrden(cfg, ['yes', 'yes', 'yes']));

    expect(tally.outcome).toStrictEqual({ kind: 'approved', option: OPTION_MAIN });
    expect(tally.steps[2]).toStrictEqual({
      id: 'S3',
      claim:
        'La unanimidad se exige sobre 3 personas computables. Una abstención explícita rompe la ' +
        'unanimidad.',
      evidence: { denominador: 3, base: 'cast', laAbstencionBloquea: 'sí' },
      supportingSeqs: [],
    });
    expect(tally.steps[3]).toStrictEqual({
      id: 'S4',
      claim: 'Todas las personas computables apoyaron y ninguna se opuso.',
      evidence: { aprobada: 'sí' },
      supportingSeqs: [],
    });
  });

  /** Las cuatro razones de rechazo son cuatro frases distintas, y cada una tiene que salir. */
  it.each([
    {
      caso: 'una oposición',
      base: 'cast' as const,
      bloquea: false,
      urna: ['yes', 'no'] as const,
      razon: 'Hubo 1 de peso en contra: basta uno para romper la unanimidad.',
    },
    {
      caso: 'una abstención cuando bloquea',
      base: 'cast' as const,
      bloquea: true,
      urna: ['yes', 'abstain'] as const,
      razon: 'Hubo 1 de peso en abstención y esta decisión exige que nadie se abstenga.',
    },
    {
      caso: 'la urna vacía',
      base: 'cast' as const,
      bloquea: false,
      urna: [] as const,
      razon:
        'No hubo ni una sola papeleta: cero de cero no es unanimidad, es ausencia de decisión.',
    },
    {
      caso: 'falta gente del padrón',
      base: 'census' as const,
      bloquea: false,
      urna: ['yes', 'yes'] as const,
      razon: 'Se necesitaba el apoyo de las 5 personas del padrón y hubo 2.',
    },
  ])(
    'S4 explica el rechazo por $caso con su propia frase',
    async ({ base, bloquea, urna, razon }) => {
      const cfg = await config(base, bloquea);
      const tally = tallyUnanimity(cfg, enOrden(cfg, urna));
      expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
      expect(tally.steps[3]).toStrictEqual({
        id: 'S4',
        claim: razon,
        evidence: { aprobada: 'no' },
        supportingSeqs: [],
      });
      expect(tally.narrative).toBe(
        `Esta decisión exigía unanimidad: basta una sola oposición para que no pase. ${razon} ` +
          'La propuesta queda rechazada.',
      );
    },
  );

  /** Las cuatro razones son realmente CUATRO, no la misma frase repetida. */
  it('las cuatro razones de rechazo son distintas entre sí', async () => {
    const casos: readonly (readonly ['cast' | 'census', boolean, readonly Vote[]])[] = [
      ['cast', false, ['yes', 'no']],
      ['cast', true, ['yes', 'abstain']],
      ['cast', false, []],
      ['census', false, ['yes', 'yes']],
    ];
    const razones: string[] = [];
    for (const [base, bloquea, urna] of casos) {
      const cfg = await config(base, bloquea);
      razones.push(tallyUnanimity(cfg, enOrden(cfg, urna)).steps[3]?.claim ?? '');
    }
    expect(new Set(razones).size).toBe(4);
  });

  /**
   * El denominador de B.4 tiene tres fórmulas y el paso S3 las publica. Con `abstentionBlocks: true`
   * es `A + R + Ab`; con `false`, `A + R`; sobre censo, `N`. Los mutantes aritméticos de esas dos
   * sumas —`A − R`, `A + R − Ab`— sobrevivían porque nadie leía S3 en una urna donde hubiese a la
   * vez síes, noes y abstenciones.
   */
  it.each([
    { base: 'cast' as const, bloquea: true, denominador: 3, texto: 'sobre 3 personas computables' },
    {
      base: 'cast' as const,
      bloquea: false,
      denominador: 2,
      texto: 'sobre 2 personas computables',
    },
    {
      base: 'census' as const,
      bloquea: false,
      denominador: 5,
      texto: 'sobre el padrón entero: 5 personas',
    },
  ])(
    'S3 publica el denominador $denominador con base $base y bloqueo $bloquea',
    async ({ base, bloquea, denominador, texto }) => {
      const cfg = await config(base, bloquea);
      const tally = tallyUnanimity(cfg, enOrden(cfg, ['yes', 'no', 'abstain']));
      expect(tally.steps[2]?.claim).toContain(texto);
      expect(tally.steps[2]?.evidence).toStrictEqual({
        denominador,
        base,
        laAbstencionBloquea: bloquea ? 'sí' : 'no',
      });
    },
  );

  /**
   * Sobre censo la frase de S3 no menciona la política de abstención **a propósito**: con `D = N`
   * cualquier abstención ya impide `A = N`, así que hablar de ella sería ruido. Lo que sí tiene que
   * decir es que el listón es el padrón entero, y eso es lo que aquí se fija.
   */
  it('sobre censo, S3 habla del padrón entero y no de las abstenciones', async () => {
    const cfg = await config('census', true, 4);
    const tally = tallyUnanimity(cfg, enOrden(cfg, ['yes', 'yes', 'abstain']));
    expect(tally.steps[2]).toStrictEqual({
      id: 'S3',
      claim: 'La unanimidad se exige sobre el padrón entero: 4 personas.',
      evidence: { denominador: 4, base: 'census', laAbstencionBloquea: 'sí' },
      supportingSeqs: [],
    });
    expect(tally.steps[2]?.claim).not.toContain('computables');
  });

  it('el silencio publicado es censo menos representados', async () => {
    const cfg = await config('cast', false, 9);
    const tally = tallyUnanimity(cfg, enOrden(cfg, ['yes', 'yes']));
    expect(tally.steps[1]?.evidence['noVotaron']).toBe(7);
    expect(tally.tables[0]?.rows[3]).toStrictEqual(['No votó', 7]);
  });

  it('los `seq` que sustentan el paso se publican ordenados, no en orden de padrón', async () => {
    const cfg = await config('cast', false);
    const tally = tallyUnanimity(
      cfg,
      efectivas(cfg, [
        { voterIndex: 4, vote: 'yes' },
        { voterIndex: 1, vote: 'yes' },
        { voterIndex: 3, vote: 'yes' },
      ]),
    );
    expect(tally.steps[0]?.supportingSeqs).toStrictEqual([1, 2, 3]);
    expect(tally.steps[1]?.supportingSeqs).toStrictEqual([1, 2, 3]);
  });

  it('la aprobación arrastra la opción; el rechazo, el motivo', async () => {
    const cfg = await config('cast', false);
    expect(tallyUnanimity(cfg, enOrden(cfg, ['yes', 'yes'])).outcome).toStrictEqual({
      kind: 'approved',
      option: OPTION_MAIN,
    });
    expect(tallyUnanimity(cfg, enOrden(cfg, ['yes', 'no'])).outcome).toStrictEqual({
      kind: 'rejected',
      reason: 'threshold-not-met',
    });
  });

  it('rechaza que se le pase un método que no es el suyo, y lo dice', async () => {
    const ajeno = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({
        kind: 'supermajority',
        num: 2,
        den: 3,
        strict: false,
        base: 'cast',
        abstentionPolicy: 'exclude',
      }),
    });
    expect(() => tallyUnanimity(ajeno, [])).toThrow(InvalidBallotForMethod);
    expect(() => tallyUnanimity(ajeno, [])).toThrow(
      'una papeleta de tipo unanimity no se convierte a supermajority: se rechaza',
    );
  });
});
