/**
 * **Por qué** se rechaza cada papeleta, no sólo **que** se rechaza.
 *
 * La corrida de mutación dejó `packages/domain/src/ballot.ts` en **58,42 %**, con 30 mutantes sin
 * cobertura alguna. Al mirarlos, dos huecos distintos:
 *
 *  1. Las pruebas que había comprobaban el **código** de rechazo (`OBJECTION_REQUIRED`) o sólo que
 *     algo se lanzaba. El texto que acompaña al código no lo leía nadie, así que se podía vaciar
 *     entero a `""` sin romper nada. Ese texto es lo que ve la persona a la que le rebotan el voto:
 *     un rechazo sin motivo legible es un voto perdido que nadie sabe corregir.
 *  2. Las ramas de `score`, `ranking` y `grades` —líneas 279–361— **no las tocaba ninguna prueba**.
 *     `validateBallot` es el portero de INV-12 («se rechaza, no se convierte») y para tres de los
 *     cinco métodos el portero estaba sin vigilar.
 *
 * Se afirma el mensaje **completo**, tal como sale. Es rígido a propósito: cambiar el texto de un
 * rechazo es cambiar lo que se le dice a quien vota, y eso se decide, no se desliza.
 */

import { describe, expect, it } from 'vitest';

import {
  acceptedPayloadKinds,
  type Ballot,
  type BallotContext,
  ballotRejection,
  type DecisionConfig,
  type GradeId,
  instant,
  InvalidBallotError,
  isBallotValid,
  isVoterEligible,
  MIN_OBJECTION_ARGUMENT_LENGTH,
  type OptionId,
  validateBallot,
  validateObjection,
} from '../src/index.js';
import {
  ARGUMENT,
  buildConfig,
  buildElectorate,
  CLOSES_AT,
  DECISION_ID,
  makeBallots,
  memberIdAt,
  objectionIdAt,
  optionIdAt,
  planToMethod,
  PROPOSAL_V1,
  PROPOSAL_V2,
  SEED_COMMITMENT,
  T0,
} from './arbitraries.js';
import {
  A,
  ACCEPTABLE,
  B,
  C,
  EXCELLENT,
  FIVE_GRADE_SCALE,
  GOOD,
  multiConfig,
} from './tally-helpers.js';

function ctx(config: DecisionConfig, round = 1): BallotContext {
  return {
    window: { opensAt: config.window.opensAt, closesAt: config.window.closesAt },
    round,
    proposalVersionHash: config.proposalVersionHash,
  };
}

function papeleta(config: DecisionConfig, overrides: Partial<Ballot> = {}): Ballot {
  const [base] = makeBallots([{ voterIndex: 0, vote: 'yes' }]);
  if (base === undefined) throw new Error('sin papeleta');
  return { ...base, decisionId: config.decisionId, ...overrides };
}

/** El mensaje completo, tal como lo compone `InvalidBallotError`. */
function motivo(config: DecisionConfig, ballot: Ballot, round = 1): string {
  try {
    validateBallot(config, ballot, ctx(config, round));
  } catch (error) {
    if (error instanceof InvalidBallotError) return error.message;
    throw error;
  }
  return '(la papeleta se aceptó)';
}

const OPCION_AJENA = optionIdAt(9);

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las seis puertas comunes a todos los métodos
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('ballot — el motivo del rechazo se publica entero, no sólo su código', () => {
  async function mayoria(members = 5): Promise<DecisionConfig> {
    return buildConfig({
      electorate: await buildElectorate(members),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
  }

  it('la papeleta de otra decisión nombra las dos decisiones', async () => {
    const config = await mayoria();
    const otra = papeleta(config, { decisionId: DECISION_ID });
    const ajena = { ...otra, decisionId: '0'.repeat(32) as Ballot['decisionId'] };
    expect(motivo(config, ajena)).toBe(
      `papeleta rechazada (WRONG_DECISION): la papeleta apunta a ${ajena.decisionId} y la ` +
        `decisión es ${config.decisionId}`,
    );
  });

  it.each([0, -1, 1.5, Number.NaN])('el `seq` %s se rechaza citando A.7', async (seq) => {
    const config = await mayoria();
    expect(motivo(config, papeleta(config, { seq }))).toBe(
      'papeleta rechazada (INVALID_SEQ): seq debe ser un entero ≥ 1 (A.7)',
    );
  });

  it('`seq = 1` es válido: la frontera del entero ≥ 1 es inclusiva', async () => {
    const config = await mayoria();
    expect(isBallotValid(config, papeleta(config, { seq: 1 }), ctx(config))).toBe(true);
  });

  it('quien no está en el padrón congelado ve el `rollHash` contra el que se le comprobó', async () => {
    const config = await mayoria(3);
    const fuera = memberIdAt(99);
    expect(motivo(config, papeleta(config, { voter: fuera }))).toBe(
      `papeleta rechazada (INELIGIBLE_VOTER): ${fuera} no está en el padrón congelado ` +
        `(rollHash ${config.electorate.rollHash})`,
    );
  });

  it('fuera de ventana se dice que el cierre es exclusivo y que no hay gracia', async () => {
    const config = await mayoria();
    const tarde = instant(CLOSES_AT);
    expect(motivo(config, papeleta(config, { castAt: tarde }))).toBe(
      `papeleta rechazada (OUT_OF_WINDOW): castAt=${String(tarde)} está fuera de ` +
        `[${String(config.window.opensAt)}, ${String(config.window.closesAt)}): el cierre es ` +
        'exclusivo y no hay período de gracia',
    );
    // Y el instante inmediatamente anterior sí entra: `[opensAt, closesAt)`.
    expect(
      isBallotValid(config, papeleta(config, { castAt: instant(CLOSES_AT - 1) }), ctx(config)),
    ).toBe(true);
    expect(isBallotValid(config, papeleta(config, { castAt: instant(T0) }), ctx(config))).toBe(
      true,
    );
  });

  it('la ronda equivocada nombra las dos rondas', async () => {
    const config = await mayoria();
    expect(motivo(config, papeleta(config, { round: 2 }), 3)).toBe(
      'papeleta rechazada (WRONG_ROUND): la papeleta es de la ronda 2 y la ronda vigente es 3',
    );
  });

  it('la versión obsoleta de la propuesta cita A.6', async () => {
    const config = await mayoria();
    expect(motivo(config, papeleta(config, { proposalVersionHash: PROPOSAL_V2 }))).toBe(
      'papeleta rechazada (STALE_PROPOSAL_VERSION): la papeleta se emitió sobre una versión de ' +
        'la propuesta que ya no es la vigente (A.6)',
    );
    expect(
      isBallotValid(config, papeleta(config, { proposalVersionHash: PROPOSAL_V1 }), ctx(config)),
    ).toBe(true);
  });

  /**
   * INV-12 al pie de la letra: el mensaje enumera **lo que el método sí admite**, para que quien
   * vota sepa qué mandar en vez de adivinar. Con la lista vaciada a `""` el rechazo seguía siendo
   * correcto y completamente inútil.
   */
  it('el tipo de papeleta no admitido enumera lo que el método sí acepta', async () => {
    const config = await mayoria();
    expect(motivo(config, papeleta(config, { payload: { kind: 'score', scores: {} } }))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): simple-majority admite binary | abstain y ' +
        'la papeleta es de tipo score; convertirla inventaría una preferencia que nadie expresó',
    );
  });

  /**
   * El sorteo deliberativo **no admite papeleta ninguna**: no se vota, se sortea (B.9). Devolver una
   * lista vacía no es un olvido, y por eso hay que fijarlo: si algún día devolviera `['binary']`, se
   * podría «votar» una decisión que por diseño no se vota.
   */
  it('el sorteo deliberativo no admite ninguna clase de papeleta', async () => {
    const cfg = await multiConfig(
      {
        kind: 'deliberative-sortition',
        sampleSize: 3,
        strata: [],
        allocation: 'proportional',
        seedCommitment: SEED_COMMITMENT,
      },
      [A, B],
      6,
    );
    expect(acceptedPayloadKinds(cfg.method)).toStrictEqual([]);
    expect(motivo(cfg, papeleta(cfg))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): deliberative-sortition admite  y la ' +
        'papeleta es de tipo binary; convertirla inventaría una preferencia que nadie expresó',
    );
  });

  it('`isVoterEligible` es el atajo del padrón congelado, y dice lo mismo que el guardián', async () => {
    const cfg = await mayoria(3);
    expect(isVoterEligible(cfg.electorate, memberIdAt(0))).toBe(true);
    expect(isVoterEligible(cfg.electorate, memberIdAt(99))).toBe(false);
  });

  it('el orden de las seis puertas es estable: la primera que falla es la que se publica', async () => {
    const config = await mayoria(3);
    // Papeleta con TRES defectos a la vez. Se publica el de `decisionId`, que es la primera puerta.
    const rota = papeleta(config, {
      decisionId: '0'.repeat(32) as Ballot['decisionId'],
      seq: 0,
      voter: memberIdAt(99),
    });
    expect(ballotRejection(config, rota, ctx(config))).toBe('WRONG_DECISION');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.5 — score: la rama que no miraba nadie
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('ballot — papeletas de puntuación (B.5)', () => {
  const METHOD = {
    kind: 'score',
    min: 0,
    max: 5,
    aggregator: 'median',
    noOpinionPolicy: 'ignore',
    minCoverage: { num: 3n, den: 4n },
    tieBreak: { cascade: ['higher-mean', 'fewer-zeros', 'more-fives', 'lexicographic-hash'] },
  } as const;

  async function config(): Promise<DecisionConfig> {
    return multiConfig(METHOD, [A, B], 4);
  }

  function conPuntuaciones(
    cfg: DecisionConfig,
    scores: Readonly<Record<string, number | null | undefined>>,
  ): Ballot {
    return papeleta(cfg, { payload: { kind: 'score', scores } as Ballot['payload'] });
  }

  it('una papeleta con todas las opciones y valores en rango es válida', async () => {
    const cfg = await config();
    expect(isBallotValid(cfg, conPuntuaciones(cfg, { [A]: 3, [B]: 4 }), ctx(cfg))).toBe(true);
  });

  /**
   * Las claves se comparan **normalizadas por orden**, no en el orden en que el cliente las
   * serializó. Sin el `.sort()` de `payloadKeys`, esta papeleta perfectamente válida se rechazaba
   * por el orden de dos propiedades de un JSON, que es exactamente el tipo de fallo que nadie
   * reproduce y todo el mundo sufre.
   */
  it('el orden en que llegan las claves no importa: se comparan ordenadas', async () => {
    const cfg = await config();
    const alReves: Record<string, number> = {};
    alReves[B] = 4;
    alReves[A] = 3;
    expect(Object.keys(alReves)).toStrictEqual([B, A]);
    expect(isBallotValid(cfg, conPuntuaciones(cfg, alReves), ctx(cfg))).toBe(true);
  });

  it('faltar una opción se rechaza como «claves extra», no como puntuación inválida', async () => {
    const cfg = await config();
    expect(motivo(cfg, conPuntuaciones(cfg, { [A]: 3 }))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): score debe traer exactamente todas las ' +
        'opciones vivas, sin claves extra (B.5)',
    );
  });

  it('sobrar una opción también, aunque el número de claves cuadre', async () => {
    const cfg = await config();
    expect(motivo(cfg, conPuntuaciones(cfg, { [A]: 3, [C]: 4 }))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): score debe traer exactamente todas las ' +
        'opciones vivas, sin claves extra (B.5)',
    );
    expect(motivo(cfg, conPuntuaciones(cfg, { [A]: 3, [B]: 4, [C]: 5 }))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): score debe traer exactamente todas las ' +
        'opciones vivas, sin claves extra (B.5)',
    );
  });

  it.each([
    [-1, 'por debajo del mínimo'],
    [6, 'por encima del máximo'],
    [2.5, 'no entera'],
  ])('la puntuación %s (%s) se rechaza nombrando la opción', async (valor) => {
    const cfg = await config();
    expect(motivo(cfg, conPuntuaciones(cfg, { [A]: valor, [B]: 3 }))).toBe(
      `papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): la puntuación de ${A} debe estar en [0,5] ` +
        'o ser null',
    );
  });

  /** Las dos fronteras del rango son **inclusivas**: 0 y 5 son puntuaciones legítimas. */
  it.each([0, 5])('la puntuación %i está dentro del rango', async (valor) => {
    const cfg = await config();
    expect(isBallotValid(cfg, conPuntuaciones(cfg, { [A]: valor, [B]: valor }), ctx(cfg))).toBe(
      true,
    );
  });

  it('`null` es «sin opinión» y es válido; `undefined` no lo es', async () => {
    const cfg = await config();
    expect(isBallotValid(cfg, conPuntuaciones(cfg, { [A]: null, [B]: 3 }), ctx(cfg))).toBe(true);
    expect(motivo(cfg, conPuntuaciones(cfg, { [A]: undefined, [B]: 3 }))).toBe(
      `papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): la puntuación de ${A} debe estar en [0,5] ` +
        'o ser null',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.8 / B.6 — ranking
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('ballot — papeletas de ordenación (ranking)', () => {
  const SCHULZE = {
    kind: 'condorcet-schulze',
    allowTruncation: true,
    truncatedMeans: 'tied-last',
    tieBreak: { cascade: ['more-pairwise-wins', 'higher-min-margin', 'lexicographic-hash'] },
  } as const;

  async function config(allowTruncation = true): Promise<DecisionConfig> {
    return multiConfig({ ...SCHULZE, allowTruncation }, [A, B, C], 5);
  }

  function conOrden(cfg: DecisionConfig, order: readonly OptionId[]): Ballot {
    return papeleta(cfg, { payload: { kind: 'ranking', order } as Ballot['payload'] });
  }

  it('un orden estricto completo es válido', async () => {
    const cfg = await config();
    expect(isBallotValid(cfg, conOrden(cfg, [A, B, C]), ctx(cfg))).toBe(true);
  });

  /**
   * El ranking vacío es la trampa: `unique.size === order.length` también se cumple con cero, así
   * que sin la comprobación explícita de `length === 0` una papeleta en blanco se colaba como
   * ordenación válida. Con `allowTruncation: true` **ni siquiera la rama de truncamiento la
   * paraba**, y una papeleta sin ninguna preferencia entraba al escrutinio.
   */
  it('el ranking VACÍO se rechaza, incluso donde el truncamiento está permitido', async () => {
    const cfg = await config(true);
    expect(motivo(cfg, conOrden(cfg, []))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): el ranking debe ser un orden estricto no ' +
        'vacío, sin opciones repetidas',
    );
  });

  it('el ranking con repeticiones se rechaza', async () => {
    const cfg = await config();
    expect(motivo(cfg, conOrden(cfg, [A, B, A]))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): el ranking debe ser un orden estricto no ' +
        'vacío, sin opciones repetidas',
    );
  });

  /**
   * `some` y no `every`: basta **una** opción ajena para tirar la papeleta. Con `every` mutado, un
   * ranking con una opción real y una inventada pasaba el filtro.
   */
  it('basta UNA opción ajena a la decisión para rechazar el ranking', async () => {
    const cfg = await config();
    expect(motivo(cfg, conOrden(cfg, [A, OPCION_AJENA]))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): el ranking contiene una opción que no ' +
        'pertenece a la decisión',
    );
    expect(motivo(cfg, conOrden(cfg, [OPCION_AJENA]))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): el ranking contiene una opción que no ' +
        'pertenece a la decisión',
    );
  });

  it('`allowTruncation` decide si un ranking incompleto entra o no', async () => {
    const permite = await config(true);
    const exige = await config(false);
    expect(isBallotValid(permite, conOrden(permite, [A, B]), ctx(permite))).toBe(true);
    expect(motivo(exige, conOrden(exige, [A, B]))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): el método no permite rankings truncados: ' +
        'deben aparecer todas las opciones',
    );
    // Y con todas las opciones presentes, el método que las exige la acepta.
    expect(isBallotValid(exige, conOrden(exige, [C, A, B]), ctx(exige))).toBe(true);
  });

  /**
   * La regla del truncamiento vale para los **dos** métodos de ordenación, no sólo para Schulze.
   * Toda la cobertura estaba en `condorcet-schulze`, así que la mitad `irv` de la condición podía
   * borrarse sin que nadie se enterara: los rankings truncados habrían entrado en IRV aunque el
   * método los prohibiera, y en IRV un ranking truncado **cambia la cuota** de cada vuelta.
   */
  it('IRV aplica la misma regla de truncamiento que Schulze', async () => {
    const IRV = {
      kind: 'irv',
      exhaustedPolicy: 'reduce-quota',
      eliminationTieBreak: { cascade: ['pairwise-head-to-head', 'lexicographic-hash'] },
      allowTruncation: false,
      tieBreak: { cascade: ['lexicographic-hash'] },
    } as const;
    const exige = await multiConfig(IRV, [A, B, C], 5);
    const permite = await multiConfig({ ...IRV, allowTruncation: true }, [A, B, C], 5);

    expect(motivo(exige, conOrden(exige, [A, B]))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): el método no permite rankings truncados: ' +
        'deben aparecer todas las opciones',
    );
    expect(isBallotValid(permite, conOrden(permite, [A, B]), ctx(permite))).toBe(true);
    expect(isBallotValid(exige, conOrden(exige, [B, C, A]), ctx(exige))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.7 — menciones (majority judgment)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('ballot — papeletas de menciones (B.7)', () => {
  const MJ = {
    kind: 'majority-judgment',
    scale: FIVE_GRADE_SCALE,
    missingGradePolicy: 'reject-ballot',
    tieBreak: { cascade: ['more-excellent', 'fewer-reject', 'lexicographic-hash'] },
  } as const;

  async function config(
    missingGradePolicy: 'reject-ballot' | 'worst' = 'reject-ballot',
  ): Promise<DecisionConfig> {
    return multiConfig({ ...MJ, missingGradePolicy }, [A, B], 4);
  }

  function conMenciones(cfg: DecisionConfig, grades: Readonly<Record<string, GradeId>>): Ballot {
    return papeleta(cfg, { payload: { kind: 'grades', grades } as Ballot['payload'] });
  }

  it('una mención por opción, todas de la escala congelada, es válida', async () => {
    const cfg = await config();
    expect(isBallotValid(cfg, conMenciones(cfg, { [A]: EXCELLENT, [B]: GOOD }), ctx(cfg))).toBe(
      true,
    );
  });

  it('una opción ajena a la decisión se rechaza', async () => {
    const cfg = await config();
    expect(motivo(cfg, conMenciones(cfg, { [A]: GOOD, [OPCION_AJENA]: ACCEPTABLE }))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): la papeleta de menciones contiene una ' +
        'opción ajena a la decisión',
    );
  });

  /**
   * `missingGradePolicy` es la diferencia entre «si no la mencionaste, no vale tu papeleta» y «si
   * no la mencionaste, la trato como la peor». Nadie probaba que la política **tuviera efecto**: con
   * la comparación mutada, las dos se comportaban igual y B.7.b quedaba sin aplicar.
   */
  it('`reject-ballot` exige mención para cada opción; `worst` la deja pasar', async () => {
    const exige = await config('reject-ballot');
    const tolera = await config('worst');
    expect(motivo(exige, conMenciones(exige, { [A]: GOOD }))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): majority-judgment exige una mención para ' +
        'cada opción (B.7.b)',
    );
    expect(isBallotValid(tolera, conMenciones(tolera, { [A]: GOOD }), ctx(tolera))).toBe(true);
  });

  it('una mención fuera de la escala congelada se rechaza', async () => {
    const cfg = await config();
    expect(motivo(cfg, conMenciones(cfg, { [A]: GOOD, [B]: 'estupendo' as GradeId }))).toBe(
      'papeleta rechazada (PAYLOAD_KIND_NOT_ACCEPTED): la papeleta contiene una mención que no ' +
        'pertenece a la escala congelada',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// B.3 — objeciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('ballot — el motivo del rechazo de una objeción (B.3)', () => {
  const OBJECION = {
    objectionId: objectionIdAt(1),
    argument: ARGUMENT,
    harmedAim: 'la continuidad del taller',
    raisedAtRound: 1,
  } as const;

  function razon(objection: Parameters<typeof validateObjection>[0], round = 1): string {
    try {
      validateObjection(objection, round);
    } catch (error) {
      if (error instanceof InvalidBallotError) return error.message;
      throw error;
    }
    return '(la objeción se aceptó)';
  }

  it('la objeción bien formada pasa', () => {
    expect(razon(OBJECION)).toBe('(la objeción se aceptó)');
  });

  /**
   * Las dos caras de B.3: objetar **exige** la objeción por escrito, y no objetar **prohíbe**
   * adjuntarla. El código de rechazo ya se comprobaba; el texto que se le muestra a quien vota, no.
   */
  it('objetar sin objeción, y adjuntar objeción sin objetar, se explican con su texto', async () => {
    const cfg = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({
        kind: 'sociocratic-consent',
        maxRounds: 3,
        minEngagementNum: 1,
        minEngagementDen: 2,
      }),
    });
    expect(motivo(cfg, papeleta(cfg, { payload: { kind: 'consent', stance: 'object' } }))).toBe(
      'papeleta rechazada (OBJECTION_REQUIRED): objetar exige presentar la objeción por escrito: ' +
        'qué objetivo se daña y por qué (B.3)',
    );
    for (const stance of ['consent', 'concern'] as const) {
      expect(
        motivo(cfg, papeleta(cfg, { payload: { kind: 'consent', stance, objection: OBJECION } })),
      ).toBe(
        `papeleta rechazada (OBJECTION_NOT_ALLOWED): una papeleta con postura ${stance} no puede ` +
          'traer una objeción adjunta',
      );
    }
  });

  /**
   * La frontera del mínimo es **inclusiva**: exactamente 40 caracteres bastan. Con `<` mutado a `<=`
   * una objeción de longitud justa se rechazaba, y ese es el caso que más rabia da: la persona
   * escribió lo que se le pidió y el sistema le dice que no.
   */
  it('el mínimo de argumento es inclusivo: 40 caracteres exactos bastan, 39 no', () => {
    const justo = 'a'.repeat(MIN_OBJECTION_ARGUMENT_LENGTH);
    const corto = 'a'.repeat(MIN_OBJECTION_ARGUMENT_LENGTH - 1);
    expect(razon({ ...OBJECION, argument: justo })).toBe('(la objeción se aceptó)');
    expect(razon({ ...OBJECION, argument: corto })).toBe(
      'papeleta rechazada (OBJECTION_ARGUMENT_TOO_SHORT): una objeción exige al menos 40 ' +
        'caracteres de argumento: bloquear a la comunidad tiene que costar, como mínimo, ' +
        'explicarse (B.3)',
    );
  });

  /**
   * Los espacios se **colapsan a uno**, no se borran. La diferencia importa: con el separador
   * mutado a `""`, «palabra palabra…» perdía un carácter por hueco y un argumento legítimo de 40
   * caracteres caía por debajo del mínimo.
   */
  it('los espacios internos se colapsan a uno y siguen contando', () => {
    const veinte = 'ab'.repeat(10); // 20 caracteres
    const conHueco = `${veinte}     ${veinte.slice(0, 19)}`; // 20 + 1 + 19 = 40 tras normalizar
    expect(conHueco.replace(/\s+/gu, ' ').trim()).toHaveLength(MIN_OBJECTION_ARGUMENT_LENGTH);
    expect(razon({ ...OBJECION, argument: conHueco })).toBe('(la objeción se aceptó)');
  });

  it('sin objetivo dañado la objeción es una preferencia, y así se dice', () => {
    expect(razon({ ...OBJECION, harmedAim: '   ' })).toBe(
      'papeleta rechazada (OBJECTION_AIM_MISSING): una objeción es una alegación de daño al fin ' +
        'común: sin objetivo dañado es una preferencia',
    );
  });

  it('la ronda equivocada nombra las dos rondas', () => {
    expect(razon({ ...OBJECION, raisedAtRound: 1 }, 2)).toBe(
      'papeleta rechazada (OBJECTION_ROUND_MISMATCH): la objeción dice pertenecer a la ronda 1 y ' +
        'la papeleta a la ronda 2',
    );
  });

  /** Los tres textos de la objeción pasan por el mismo filtro, **incluida la enmienda**. */
  it.each([
    ['argument', 'el argumento de la objeción'],
    ['harmedAim', 'el objetivo dañado'],
    ['proposedAmendment', 'la enmienda propuesta'],
  ] as const)('%s sin normalizar en NFC se rechaza nombrando el campo', (campo, etiqueta) => {
    const sinNormalizar = `cafe\u0301 ${ARGUMENT}`;
    expect(razon({ ...OBJECION, proposedAmendment: 'una enmienda', [campo]: sinNormalizar })).toBe(
      `papeleta rechazada (TEXT_NOT_CANONICAL): ${etiqueta} debe venir normalizado en NFC: dos ` +
        'textos que se ven idénticos y hashean distinto rompen la verificación (A.1.1)',
    );
  });

  it.each([
    ['argument', 'el argumento de la objeción'],
    ['harmedAim', 'el objetivo dañado'],
    ['proposedAmendment', 'la enmienda propuesta'],
  ] as const)('%s con retorno de carro se rechaza nombrando el campo', (campo, etiqueta) => {
    expect(
      razon({ ...OBJECION, proposedAmendment: 'una enmienda', [campo]: `x\r\n${ARGUMENT}` }),
    ).toBe(
      `papeleta rechazada (TEXT_NOT_CANONICAL): ${etiqueta} contiene CR: los finales de línea se ` +
        'normalizan a LF en el borde de entrada',
    );
  });

  it('la enmienda ausente no se valida: `undefined` es legítimo', () => {
    expect(razon({ ...OBJECION })).toBe('(la objeción se aceptó)');
  });
});
