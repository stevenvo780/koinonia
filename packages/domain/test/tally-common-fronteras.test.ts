/**
 * Las fronteras del marco común del escrutinio (`tally/common.ts`), donde la mutación encontró los
 * huecos más finos.
 *
 * Tres de ellos merecen nombre propio:
 *
 *  1. **El empate de `seq` en `lastBallotPerVoter`.** «La última manda» se resuelve con
 *     `ballot.seq > current.seq`. Cambiarlo por `>=` no rompía ninguna prueba, y sin embargo decide
 *     **qué papeleta cuenta** cuando dos comparten número de orden. En un log legal eso no puede
 *     pasar —`seq` es un orden total (A.9)— pero si pasa, dos réplicas que recorran el mismo log
 *     tienen que llegar al mismo voto, no a votos distintos según el orden de llegada. Aquí se fija:
 *     **manda la primera que se encontró**, y esa decisión queda escrita.
 *  2. **`precheck` explicaba sus tres negativas y nadie leía el texto.** Son los tres invariantes que
 *     protegen el peso (B.0.a, INV-08, INV-21, INV-22); si se disparan, el log está roto y lo único
 *     que se publica es ese mensaje.
 *  3. **La preimagen del `resultHash`.** `canonicalOutcome` tiene una rama por cada clase de
 *     resultado y sólo dos se recorrían. Un campo que se cae de la preimagen es un campo que se
 *     puede cambiar sin que el hash se entere: el anclaje deja de anclar y todo sigue verde.
 */

import { describe, expect, it } from 'vitest';

import {
  type Ballot,
  binaryTable,
  concentrationRatio,
  concentrationReport,
  concentrationStep,
  concentrationTable,
  type DecisionConfig,
  type DecisionResult,
  type EffectiveBallot,
  effectiveBallots,
  fractionEvidence,
  gini,
  herfindahl,
  HIGH_CONCENTRATION_CR1,
  HIGH_CONCENTRATION_HHI,
  hmacOrder,
  hmacSha256Hex,
  lastBallotPerVoter,
  type MemberId,
  normalizedHerfindahl,
  type Outcome,
  precheck,
  PreconditionError,
  ratio,
  representedMembers,
  resultHashPreimage,
  type TallyContext,
  totalWeight,
} from '../src/index.js';
import {
  buildConfig,
  buildElectorate,
  DECISION_ID,
  makeBallots,
  memberIdAt,
  optionIdAt,
  planToMethod,
} from './arbitraries.js';

async function config(members = 5): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(members),
    method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
  });
}

function ctx(cfg: DecisionConfig): TallyContext {
  return {
    window: { opensAt: cfg.window.opensAt, closesAt: cfg.window.closesAt },
    round: 1,
    proposalVersionHash: cfg.proposalVersionHash,
    closedAt: cfg.window.closesAt,
    voided: [],
  };
}

function papeleta(voter: MemberId, seq: number, aprueba: boolean, weight = 1): EffectiveBallot {
  return { voter, payload: { kind: 'binary', approve: aprueba }, weight, seq, onBehalfOf: [] };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-07 / INV-08 — «la última manda» y qué pasa en el empate
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-07 — la última papeleta manda, y el empate de `seq` está decidido', () => {
  function bruta(voterIndex: number, seq: number, aprueba: boolean): Ballot {
    const [base] = makeBallots([{ voterIndex, vote: aprueba ? 'yes' : 'no' }]);
    if (base === undefined) throw new Error('sin papeleta');
    return { ...base, seq, voter: memberIdAt(voterIndex) };
  }

  it('gana la de `seq` mayor, llegue en el orden que llegue', () => {
    const primeroLaAlta = lastBallotPerVoter([bruta(0, 9, true), bruta(0, 2, false)]);
    const primeroLaBaja = lastBallotPerVoter([bruta(0, 2, false), bruta(0, 9, true)]);
    expect(primeroLaAlta).toHaveLength(1);
    expect(primeroLaAlta[0]?.seq).toBe(9);
    expect(primeroLaBaja[0]?.seq).toBe(9);
    expect(primeroLaAlta[0]?.payload).toStrictEqual({ kind: 'binary', approve: true });
    expect(primeroLaBaja[0]?.payload).toStrictEqual({ kind: 'binary', approve: true });
  });

  /**
   * **El mutante que el usuario señaló.** `>` contra `>=` sólo se distingue con `seq` repetido, y
   * ahí es donde deja de ser un detalle: con `>` cuenta la PRIMERA que se encontró, con `>=` la
   * ÚLTIMA, y son votos contrarios. `seq` repetido no debería existir (A.9), pero si un log corrupto
   * lo trae, lo intolerable no es equivocarse: es que dos réplicas se equivoquen **distinto** y el
   * `rollHash` deje de cuadrar sin que nadie sepa por qué.
   */
  it('con `seq` REPETIDO manda la primera encontrada, y el resultado no depende del orden de la lista', () => {
    const empate = lastBallotPerVoter([bruta(0, 5, true), bruta(0, 5, false)]);
    expect(empate).toHaveLength(1);
    expect(empate[0]?.payload).toStrictEqual({ kind: 'binary', approve: true });

    const alReves = lastBallotPerVoter([bruta(0, 5, false), bruta(0, 5, true)]);
    expect(alReves[0]?.payload).toStrictEqual({ kind: 'binary', approve: false });

    // Es decir: la regla es «la primera de las empatadas», no «la que apruebe» ni «la última».
    expect(empate[0]?.ballotId).toBe(bruta(0, 5, true).ballotId);
  });

  it('la salida va en orden de PADRÓN, no de llegada (INV-16/INV-17)', () => {
    const salida = lastBallotPerVoter([bruta(3, 1, true), bruta(0, 2, true), bruta(2, 3, false)]);
    expect(salida.map((b) => b.voter)).toStrictEqual([memberIdAt(0), memberIdAt(2), memberIdAt(3)]);
  });

  it('una lista vacía devuelve una lista vacía, no revienta', () => {
    expect(lastBallotPerVoter([])).toStrictEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.0.1 — precheck: las tres negativas y su texto
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.0.1 — `precheck` explica por qué el log está roto', () => {
  function fallo(cfg: DecisionConfig, ballots: readonly EffectiveBallot[]): string {
    try {
      precheck(cfg, ballots);
    } catch (error) {
      if (error instanceof PreconditionError) return `${error.code}|${error.message}`;
      throw error;
    }
    return '(pasó)';
  }

  it.each([
    [0, 'cero'],
    [-1, 'negativo'],
    [1.5, 'no entero'],
  ])('el peso %s se rechaza con B.0.a y el nombre del votante', async (weight) => {
    const cfg = await config();
    const votante = memberIdAt(0);
    expect(fallo(cfg, [papeleta(votante, 1, true, weight)])).toBe(
      `NON_INTEGER_WEIGHT|el peso de ${votante} no es un entero ≥ 1 (B.0.a)`,
    );
  });

  it('el peso 1 es válido: la frontera del entero ≥ 1 es inclusiva', async () => {
    const cfg = await config();
    expect(fallo(cfg, [papeleta(memberIdAt(0), 1, true, 1)])).toBe('(pasó)');
  });

  /**
   * INV-08 se comprueba sobre pares **consecutivos** y exige orden estricto ascendente. Eso cubre a
   * la vez el duplicado y el desorden: si la lista no viene ordenada por padrón, alguna etapa
   * posterior podría depender del orden de llegada, que es lo que un atacante controla.
   */
  it.each([
    ['un votante repetido', [0, 0]],
    ['la lista desordenada', [2, 1]],
  ])('%s se rechaza con INV-08', async (_caso, indices) => {
    const cfg = await config();
    const ballots = indices.map((i, pos) => papeleta(memberIdAt(i), pos + 1, true));
    expect(fallo(cfg, ballots)).toBe(
      'DUPLICATE_VOTER|INV-08: un votante no puede aportar dos papeletas efectivas',
    );
  });

  it('una sola papeleta nunca dispara INV-08: no hay par que comparar', async () => {
    const cfg = await config();
    expect(fallo(cfg, [papeleta(memberIdAt(4), 1, true)])).toBe('(pasó)');
    expect(fallo(cfg, [])).toBe('(pasó)');
  });

  it('INV-21 — la suma de pesos que excede el censo se rechaza citando las dos cifras', async () => {
    const cfg = await config(3);
    const ballots = [papeleta(memberIdAt(0), 1, true, 4)];
    expect(fallo(cfg, ballots)).toBe(
      'WEIGHT_EXCEEDS_CENSUS|INV-21: la suma de pesos (4) excede el censo (3)',
    );
    // Y con el peso igual al censo, pasa: la frontera es `>`, no `>=`.
    expect(fallo(cfg, [papeleta(memberIdAt(0), 1, true, 3)])).toBe('(pasó)');
  });

  it('INV-22 — quien ya aportó no puede aparecer además como representado', async () => {
    const cfg = await config(4);
    const ballots: readonly EffectiveBallot[] = [
      { ...papeleta(memberIdAt(0), 1, true, 2), onBehalfOf: [memberIdAt(1)] },
      { ...papeleta(memberIdAt(2), 2, true, 2), onBehalfOf: [memberIdAt(1)] },
    ];
    expect(fallo(cfg, ballots)).toBe(
      `MEMBER_COUNTED_TWICE|INV-22: ${memberIdAt(1)} contribuye a más de una papeleta efectiva`,
    );
  });

  it('INV-22 también atrapa al votante que se representa a sí mismo', async () => {
    const cfg = await config(4);
    const ballots: readonly EffectiveBallot[] = [
      { ...papeleta(memberIdAt(0), 1, true, 2), onBehalfOf: [memberIdAt(0)] },
    ];
    expect(fallo(cfg, ballots)).toBe(
      `MEMBER_COUNTED_TWICE|INV-22: ${memberIdAt(0)} contribuye a más de una papeleta efectiva`,
    );
  });

  it('`effectiveBallots` pasa por `precheck`: una delegación cruzada no llega al escrutinio', async () => {
    const cfg = await config(3);
    const ballots = makeBallots([{ voterIndex: 0, vote: 'yes' }]);
    // El resolutor inventa un peso mayor que el censo: `precheck` tiene que pararlo.
    expect(() =>
      effectiveBallots(cfg, ballots, ctx(cfg), (_c, bs) =>
        bs.map((b) => ({
          voter: b.voter,
          payload: b.payload,
          weight: 99,
          seq: b.seq,
          onBehalfOf: [],
        })),
      ),
    ).toThrow(PreconditionError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// PARTE D — representados y peso
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('D.1.d — `representedMembers` ordena y no duplica', () => {
  it('junta al votante con sus representados, en orden de padrón', () => {
    const ballots: readonly EffectiveBallot[] = [
      { ...papeleta(memberIdAt(3), 1, true, 2), onBehalfOf: [memberIdAt(1)] },
      { ...papeleta(memberIdAt(0), 2, true, 2), onBehalfOf: [memberIdAt(4)] },
    ];
    expect(representedMembers(ballots)).toStrictEqual([
      memberIdAt(0),
      memberIdAt(1),
      memberIdAt(3),
      memberIdAt(4),
    ]);
    expect(totalWeight(ballots)).toBe(4);
  });

  it('sin papeletas no hay representados ni peso', () => {
    expect(representedMembers([])).toStrictEqual([]);
    expect(totalWeight([])).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// C.6 — concentración de voz
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('C.6 — los índices de concentración y su paso en la demostración', () => {
  it('INV-31 — con reparto uniforme HHI = 1/n, HHI* = 0 y Gini = 0 EXACTOS', () => {
    expect(herfindahl([3, 3, 3, 3])).toStrictEqual(ratio(1, 4));
    expect(normalizedHerfindahl([3, 3, 3, 3])).toStrictEqual(ratio(0, 1));
    expect(gini([3, 3, 3, 3])).toStrictEqual(ratio(0, 1));
  });

  it('con una sola persona que lo concentra todo, HHI = 1 y HHI* = 1', () => {
    expect(herfindahl([7, 0, 0, 0])).toStrictEqual(ratio(1, 1));
    expect(normalizedHerfindahl([7, 0, 0, 0])).toStrictEqual(ratio(1, 1));
  });

  /**
   * Errata E-41: con `n ≤ 1` la normalización es `0/0` y se resuelve por el lado conservador. Que
   * `n = 1` devuelva `0/1` y `n = 2` NO lo haga es lo que fija la frontera del `<=`.
   */
  it('E-41 — `HHI*` vale 0/1 con cero o una papeleta, y deja de valerlo con dos', () => {
    expect(normalizedHerfindahl([])).toStrictEqual(ratio(0, 1));
    expect(normalizedHerfindahl([9])).toStrictEqual(ratio(0, 1));
    expect(normalizedHerfindahl([2, 0])).toStrictEqual(ratio(1, 1));
  });

  it('sin peso ejercido los tres índices valen 0/1 en vez de dividir por cero', () => {
    expect(herfindahl([])).toStrictEqual(ratio(0, 1));
    expect(gini([])).toStrictEqual(ratio(0, 1));
    expect(herfindahl([0, 0])).toStrictEqual(ratio(0, 1));
    expect(gini([0, 0])).toStrictEqual(ratio(0, 1));
    expect(normalizedHerfindahl([0, 0])).toStrictEqual(ratio(0, 1));
  });

  it('el Gini crece con la desigualdad y nunca sale negativo', () => {
    expect(gini([1, 3])).toStrictEqual(ratio(1, 4));
    expect(gini([1, 1, 10])).toStrictEqual(ratio(1, 2));
    expect(gini([3, 1])).toStrictEqual(gini([1, 3])); // el orden de entrada no lo cambia
  });

  /**
   * `CR1` se mide contra el **censo**, no contra el peso ejercido. Es la diferencia entre «esta
   * persona representa al 5 % de la comunidad» y un número que sube cuando baja la participación.
   */
  it('CR1 se mide sobre el censo, no sobre el peso ejercido', () => {
    expect(concentrationRatio([3, 1, 1], 100)).toStrictEqual(ratio(3, 100));
    expect(concentrationRatio([3, 1, 1], 5)).toStrictEqual(ratio(3, 5));
    expect(concentrationRatio([1, 9, 2], 20)).toStrictEqual(ratio(9, 20)); // toma el MAYOR
    expect(concentrationRatio([], 20)).toStrictEqual(ratio(0, 20));
  });

  it.each([0, -1])('con censo %i, CR1 devuelve 0/1 en vez de dividir por cero', (censo) => {
    expect(concentrationRatio([5], censo)).toStrictEqual(ratio(0, 1));
  });

  it('los dos umbrales de alarma son fracciones exactas, nunca coma flotante', () => {
    expect(HIGH_CONCENTRATION_HHI).toStrictEqual({ num: 3n, den: 20n });
    expect(HIGH_CONCENTRATION_CR1).toStrictEqual({ num: 1n, den: 20n });
  });

  /**
   * La alarma tiene **dos** disparadores independientes y hay que probarlos por separado. Todas las
   * pruebas que había disparaban por `CR1`, así que la mitad `HHI*` de la condición podía anularse
   * entera sin que nada se pusiera en rojo: una comunidad con el poder repartido entre cuatro
   * cabezas sobre un censo grande —`CR1` bajo, `HHI*` alto— no se habría marcado.
   */
  it('`HHI*` dispara la alarma POR SÍ SOLO, con CR1 muy por debajo', () => {
    const informe = concentrationReport(
      [
        papeleta(memberIdAt(0), 1, true, 4),
        papeleta(memberIdAt(1), 2, true, 1),
        papeleta(memberIdAt(2), 3, true, 1),
        papeleta(memberIdAt(3), 4, true, 1),
      ],
      100,
    );
    expect(informe.normalizedHhi).toStrictEqual(ratio(9, 49)); // 0.1836… ≥ 3/20
    expect(informe.cr1).toStrictEqual(ratio(4, 100)); // 0.04 < 1/20
    expect(informe.high).toBe(true);
  });

  /**
   * Y en el borde exacto: `HHI* = 3/20` clavado, `CR1` por debajo. Con `>` en vez de `>=` esta
   * comunidad se quedaría sin marcar por una igualdad exacta, que es precisamente el caso que la
   * aritmética de fracciones del ADR-0027 existe para poder mirar de frente.
   */
  it('`HHI*` exactamente 3/20 YA dispara la alarma: el umbral es inclusivo', () => {
    const informe = concentrationReport(
      [
        papeleta(memberIdAt(0), 1, true, 5),
        papeleta(memberIdAt(1), 2, true, 2),
        papeleta(memberIdAt(2), 3, true, 1),
        papeleta(memberIdAt(3), 4, true, 1),
        papeleta(memberIdAt(4), 5, true, 1),
      ],
      200,
    );
    expect(informe.normalizedHhi).toStrictEqual(HIGH_CONCENTRATION_HHI);
    expect(informe.cr1).toStrictEqual(ratio(5, 200)); // 1/40 < 1/20
    expect(informe.high).toBe(true);
  });

  /** C.6.a: la alarma es `≥`, no `>`. Justo en el umbral **ya** salta. */
  it('la alarma salta EN el umbral, no sólo por encima', () => {
    // CR1 = 1/20 exacto con censo 20 y un peso de 1; HHI* queda por debajo.
    const enElUmbral = concentrationReport(
      Array.from({ length: 20 }, (_, i) => papeleta(memberIdAt(i), i + 1, true, 1)),
      20,
    );
    expect(enElUmbral.cr1).toStrictEqual(ratio(1, 20));
    expect(enElUmbral.high).toBe(true);

    const porDebajo = concentrationReport(
      Array.from({ length: 21 }, (_, i) => papeleta(memberIdAt(i), i + 1, true, 1)),
      21,
    );
    expect(porDebajo.cr1).toStrictEqual(ratio(1, 21));
    expect(porDebajo.high).toBe(false);
  });

  it('el informe lista los CINCO mayores pesos, descendente y con desempate por votante', () => {
    // Los dos empatados a 4 entran en la lista en orden DESCENDENTE de votante (3 antes que 0): si
    // el desempate por identificador no se aplicara, `sort` es estable y los dejaría así.
    const ballots = [
      papeleta(memberIdAt(5), 1, true, 1),
      papeleta(memberIdAt(3), 2, true, 4),
      papeleta(memberIdAt(0), 3, true, 4),
      papeleta(memberIdAt(1), 4, true, 9),
      papeleta(memberIdAt(2), 5, true, 2),
      papeleta(memberIdAt(4), 6, true, 3),
    ];
    const informe = concentrationReport(ballots, 40);
    expect(informe.top).toStrictEqual([
      { voter: memberIdAt(1), weight: 9 },
      { voter: memberIdAt(0), weight: 4 }, // empate a 4: desempata el identificador menor
      { voter: memberIdAt(3), weight: 4 },
      { voter: memberIdAt(4), weight: 3 },
      { voter: memberIdAt(2), weight: 2 },
    ]);
    expect(informe.totalWeight).toBe(23);
    expect(informe.census).toBe(40);
  });

  it('el informe no ordena la lista original: la deja intacta', () => {
    const ballots = [papeleta(memberIdAt(2), 1, true, 1), papeleta(memberIdAt(0), 2, true, 5)];
    const copia = [...ballots];
    concentrationReport(ballots, 10);
    expect(ballots).toStrictEqual(copia);
  });

  it('el paso C1 dice las dos cifras y si superan la alarma, en castellano', () => {
    const alta = concentrationReport([papeleta(memberIdAt(0), 1, true, 5)], 10);
    const paso = concentrationStep(alta);
    expect(paso.id).toBe('C1');
    expect(paso.claim).toBe(
      'La concentración de voz medida con el índice Herfindahl–Hirschman normalizado es 0/1 y la ' +
        'persona con más peso representa a 5/10 de la comunidad. Supera el umbral de alarma ' +
        '(HHI* ≥ 3/20 o CR1 ≥ 1/20): el poder está concentrado. No invalida la decisión; la marca.',
    );
    expect(paso.evidence).toStrictEqual({
      hhi: '1/1',
      hhiNormalizado: '0/1',
      gini: '0/1',
      cr1: '5/10',
      pesoTotal: 5,
      censo: 10,
      concentracionAlta: 'sí',
    });
    expect(paso.supportingSeqs).toStrictEqual([]);
  });

  it('el paso C1 con concentración normal dice lo contrario y no habla de poder concentrado', () => {
    const baja = concentrationReport(
      Array.from({ length: 30 }, (_, i) => papeleta(memberIdAt(i), i + 1, true, 1)),
      30,
    );
    const paso = concentrationStep(baja);
    expect(paso.claim).toContain('No supera el umbral de alarma (HHI* ≥ 3/20 o CR1 ≥ 1/20).');
    expect(paso.claim).not.toContain('el poder está concentrado');
    expect(paso.evidence['concentracionAlta']).toBe('no');
  });

  it('la tabla de concentración publica el peso de cada delegado sobre el censo', () => {
    const informe = concentrationReport(
      [papeleta(memberIdAt(0), 1, true, 3), papeleta(memberIdAt(1), 2, true, 1)],
      12,
    );
    expect(concentrationTable(informe)).toStrictEqual({
      title: 'Concentración alta: mayores pesos',
      columns: ['Votante', 'Peso', 'Sobre el censo'],
      rows: [
        [memberIdAt(0), 3, '3/12'],
        [memberIdAt(1), 1, '1/12'],
      ],
    });
  });

  /** Con censo 0 la tabla divide por `max(1, censo)`: publica `w/1` en vez de reventar. */
  it('la tabla no divide por cero cuando el censo es 0', () => {
    const informe = concentrationReport([papeleta(memberIdAt(0), 1, true, 2)], 0);
    expect(concentrationTable(informe).rows).toStrictEqual([[memberIdAt(0), 2, '2/1']]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// A.6 — la preimagen del `resultHash`
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('A.6 — la preimagen del `resultHash` lleva todo lo que decide, y nada más', () => {
  const BASE: Omit<DecisionResult, 'resultHash' | 'outcome'> = {
    decisionId: DECISION_ID,
    configHash: 'aa'.repeat(32) as DecisionResult['configHash'],
    rollHash: 'bb'.repeat(32) as DecisionResult['rollHash'],
    engineVersion: '1.0.0',
    computedFromSeq: 42,
    turnout: { cast: 3, represented: 4, census: 10, fraction: ratio(4, 10) },
    weights: { totalWeight: 4, hhi: ratio(1, 4), gini: ratio(0, 1) },
    quorumCheck: { passed: true, detail: { global: true, porEstrato: false } },
    proof: {
      steps: [{ id: 'S1', claim: 'algo', evidence: { a: 1 }, supportingSeqs: [1, 2] }],
      tables: [{ title: 'T', columns: ['c'], rows: [['x', 1]] }],
      narrative: 'un párrafo',
    },
  };

  const conResultado = (outcome: Outcome) => resultHashPreimage({ ...BASE, outcome });

  /**
   * DECISIÓN documentada en `common.ts`: `computedFromSeq` es **procedencia**, no conclusión, y por
   * eso se queda fuera. Si entrase, una papeleta inválida que llega al log movería el `resultHash`
   * de un escrutinio idéntico y INV-01 se rompería.
   */
  it('`computedFromSeq` NO entra: es procedencia, no conclusión (INV-01)', () => {
    const preimagen = conResultado({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(preimagen).not.toHaveProperty('computedFromSeq');
    expect(preimagen).not.toHaveProperty('resultHash');
    expect(Object.keys(preimagen).sort()).toStrictEqual([
      'configHash',
      'decisionId',
      'engineVersion',
      'outcome',
      'proof',
      'quorumCheck',
      'rollHash',
      'turnout',
      'weights',
    ]);
  });

  it('mover `computedFromSeq` no cambia la preimagen; mover cualquier otra cosa, sí', () => {
    const outcome: Outcome = { kind: 'rejected', reason: 'threshold-not-met' };
    expect(resultHashPreimage({ ...BASE, outcome, computedFromSeq: 1 })).toStrictEqual(
      resultHashPreimage({ ...BASE, outcome, computedFromSeq: 9999 }),
    );
    expect(resultHashPreimage({ ...BASE, outcome, engineVersion: '2.0.0' })).not.toStrictEqual(
      resultHashPreimage({ ...BASE, outcome }),
    );
  });

  /** Las seis clases de resultado, cada una con sus campos. Sólo dos se recorrían. */
  const CLASES_DE_RESULTADO: readonly (readonly [
    string,
    Outcome,
    Readonly<Record<string, unknown>>,
  ])[] = [
    [
      'aprobado con opción',
      { kind: 'approved', option: optionIdAt(0) },
      { kind: 'approved', option: optionIdAt(0) },
    ],
    ['aprobado sin opción', { kind: 'approved' }, { kind: 'approved' }],
    [
      'rechazado por umbral',
      { kind: 'rejected', reason: 'threshold-not-met' },
      { kind: 'rejected', reason: 'threshold-not-met' },
    ],
    [
      'rechazado por objeciones',
      { kind: 'rejected', reason: 'objections-pending' },
      { kind: 'rejected', reason: 'objections-pending' },
    ],
    [
      'sin quórum',
      { kind: 'no-quorum', achieved: ratio(1, 4), required: ratio(1, 2) },
      {
        kind: 'no-quorum',
        achieved: { num: '1', den: '4' },
        required: { num: '1', den: '2' },
      },
    ],
    [
      'ganadora',
      { kind: 'winner', option: optionIdAt(1), tieBroken: true },
      { kind: 'winner', option: optionIdAt(1), tieBroken: true },
    ],
    [
      'sorteo',
      { kind: 'sample', selected: [memberIdAt(0), memberIdAt(2)] },
      { kind: 'sample', selected: [memberIdAt(0), memberIdAt(2)] },
    ],
    [
      'nueva ronda',
      { kind: 'needs-new-round', nextRound: 3 },
      { kind: 'needs-new-round', nextRound: 3 },
    ],
  ];

  it.each(CLASES_DE_RESULTADO)('canoniza el resultado «%s»', (_caso, outcome, esperado) => {
    expect(conResultado(outcome)['outcome']).toStrictEqual(esperado);
  });

  it('las fracciones se canonizan como cadenas: un BigInt no sobrevive a JSON', () => {
    const preimagen = conResultado({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(preimagen['turnout']).toStrictEqual({
      cast: 3,
      represented: 4,
      census: 10,
      fraction: { num: '4', den: '10' },
    });
    expect(preimagen['weights']).toStrictEqual({
      totalWeight: 4,
      hhi: { num: '1', den: '4' },
      gini: { num: '0', den: '1' },
    });
  });

  it('la demostración entera entra en la preimagen: pasos, tablas y párrafo', () => {
    const preimagen = conResultado({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(preimagen['proof']).toStrictEqual({
      narrative: 'un párrafo',
      steps: [{ id: 'S1', claim: 'algo', evidence: { a: 1 }, supportingSeqs: [1, 2] }],
      tables: [{ title: 'T', columns: ['c'], rows: [['x', 1]] }],
    });
    expect(preimagen['quorumCheck']).toStrictEqual({
      passed: true,
      detail: { global: true, porEstrato: false },
    });
  });

  it('la preimagen COPIA: mutar el resultado después no la cambia', () => {
    const pasos = [{ id: 'S1', claim: 'algo', evidence: { a: 1 }, supportingSeqs: [1, 2] }];
    const mutable = { ...BASE, outcome: { kind: 'approved' } as Outcome };
    const preimagen = resultHashPreimage({
      ...mutable,
      proof: { ...BASE.proof, steps: pasos },
    });
    pasos[0]?.supportingSeqs.push(99);
    expect(
      (preimagen['proof'] as { steps: { supportingSeqs: number[] }[] }).steps[0]?.supportingSeqs,
    ).toStrictEqual([1, 2]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La tabla del recuento binario
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('la tabla del recuento binario reparte las cuatro casillas', () => {
  it('publica las cuatro filas, en su orden, con sus rótulos', () => {
    expect(binaryTable({ approve: 7, reject: 2, abstain: 1, silence: 5 })).toStrictEqual({
      title: 'Recuento',
      columns: ['Casilla', 'Peso'],
      rows: [
        ['A favor', 7],
        ['En contra', 2],
        ['Abstención explícita', 1],
        ['No votó', 5],
      ],
    });
  });

  it('las cuatro casillas son distintas: ninguna repite rótulo', () => {
    const rotulos = binaryTable({ approve: 1, reject: 2, abstain: 3, silence: 4 }).rows.map(
      (fila) => fila[0],
    );
    expect(new Set(rotulos).size).toBe(4);
  });

  /** La fracción de la evidencia va SIN reducir: el par (numerador, denominador) es lo publicado. */
  it('`fractionEvidence` publica la fracción tal cual, sin reducir', () => {
    expect(fractionEvidence(ratio(4, 10))).toBe('4/10');
    expect(fractionEvidence(ratio(0, 1))).toBe('0/1');
    expect(fractionEvidence({ num: 3n, den: 20n })).toBe('3/20');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.0.2 — HMAC para el desempate verificable
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.0.2 — el HMAC del desempate es verificable con herramientas de terceros', () => {
  /** Vectores de RFC 4231 (caso 1 y caso 2), que es lo que hace la comprobación independiente. */
  it('coincide con los vectores de prueba de RFC 4231', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
    expect(await hmacSha256Hex('', '')).toBe(
      'b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad',
    );
  });

  /**
   * La clave más larga que el bloque se **hashea antes**; la más corta se rellena con ceros. Es la
   * frontera de los 64 bytes, y sin una clave que la cruce el `>` de `encodedKey.length > blockSize`
   * podía ser cualquier cosa.
   */
  it('una clave de EXACTAMENTE 64 bytes no se hashea: la frontera del bloque es `>`', async () => {
    // Valores de referencia calculados con `crypto.createHmac('sha256', …)` de Node, que es la
    // implementación contra la que alguien de fuera comprobaría el sorteo. Con la frontera en `>=`
    // la clave de 64 bytes se hashearía de más y nuestro HMAC dejaría de coincidir con `openssl`:
    // el desempate seguiría siendo determinista y **dejaría de ser verificable**, que es justo lo
    // único que se le pide.
    expect(await hmacSha256Hex('k'.repeat(64), 'm')).toBe(
      '3b7a8d453e76edb519238a515105a57508d0f169f480ebeee120a9e7803289fa',
    );
    expect(await hmacSha256Hex('k'.repeat(65), 'm')).toBe(
      'c2d7d4c2256ddb097409ec0c67e1d58fa1a007fc6932cac0d892a525d08af7cc',
    );
  });

  it('el orden por ticket es determinista y desempata por identificador', async () => {
    const valores = [optionIdAt(0), optionIdAt(1), optionIdAt(2)];
    const primero = await hmacOrder('semilla', 'etiqueta', valores);
    const segundo = await hmacOrder('semilla', 'etiqueta', [...valores].reverse());
    expect(primero.map((e) => e.value)).toStrictEqual(segundo.map((e) => e.value));
    // Cambiar la semilla cambia el orden publicado (si no, la semilla no serviría de nada).
    const otra = await hmacOrder('otra-semilla', 'etiqueta', valores);
    expect(otra.map((e) => e.ticket)).not.toStrictEqual(primero.map((e) => e.ticket));
    for (const entrada of primero) expect(entrada.ticket).toHaveLength(64);
  });

  it('la etiqueta forma parte del ticket: dos sorteos distintos no comparten orden', async () => {
    const valores = [optionIdAt(0), optionIdAt(1), optionIdAt(2)];
    const a = await hmacOrder('semilla', 'primero', valores);
    const b = await hmacOrder('semilla', 'segundo', valores);
    expect(a.map((e) => e.ticket)).not.toStrictEqual(b.map((e) => e.ticket));
  });
});
