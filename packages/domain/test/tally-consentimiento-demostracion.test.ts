/**
 * La demostración del consentimiento sociocrático (B.3) y las dos funciones que la alimentan.
 *
 * `tally/consent.ts` estaba en **47,01 %** de mutación. El escrutinio en sí estaba bien probado
 * —INV-53, las cuatro salidas, el agotamiento de rondas—, pero de la cintura para abajo, desde la
 * tabla de objeciones hasta el párrafo final, no había ni una aserción. Se podía dejar la tabla de
 * objeciones **vacía**, rotular «retirada» a una objeción admitida, o decirle al círculo que se
 * abre la ronda 7 cuando se abre la 2, y la suite no se movía.
 *
 * En B.3 eso es especialmente grave: aquí **no se cuentan votos**. Lo único que decide es si queda
 * una objeción admitida sin integrar, y la única forma que tiene el círculo de comprobarlo es la
 * tabla de objeciones y el paso S4. Si esa tabla miente, el método entero es indistinguible de una
 * decisión a dedo.
 */

import { describe, expect, it } from 'vitest';

import {
  blockingObjections,
  consentEngagement,
  type DecisionConfig,
  type EffectiveBallot,
  effectiveBallots,
  InvalidBallotForMethod,
  mergeObjections,
  type ObjectionRecord,
  type TallyContext,
  tallyConsent,
} from '../src/index.js';
import {
  ARGUMENT,
  buildConfig,
  buildElectorate,
  makeBallots,
  memberIdAt,
  objectionIdAt,
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

function efectivas(config: DecisionConfig, votos: readonly Vote[]): readonly EffectiveBallot[] {
  return effectiveBallots(
    config,
    makeBallots(votos.map((vote, i) => ({ voterIndex: i, vote }))),
    ctx(config),
  );
}

async function config(maxRounds = 3, num = 1, den = 2, members = 4): Promise<DecisionConfig> {
  return buildConfig({
    electorate: await buildElectorate(members),
    method: planToMethod({
      kind: 'sociocratic-consent',
      maxRounds,
      minEngagementNum: num,
      minEngagementDen: den,
    }),
  });
}

function objecion(index: number, overrides: Partial<ObjectionRecord> = {}): ObjectionRecord {
  return {
    objectionId: objectionIdAt(index),
    by: memberIdAt(index),
    raisedAtRound: 1,
    status: 'admitted',
    integrated: false,
    seq: 10 + index,
    ...overrides,
  };
}

const POSTURAS = (consienten: number, reservas: number, objetan: number) => ({
  title: 'Posturas',
  columns: ['Postura', 'Peso'],
  rows: [
    ['Consiente', consienten],
    ['Con reservas', reservas],
    ['Objeta', objetan],
  ],
});

const COLUMNAS_OBJECIONES = ['Objeción', 'Ronda', 'Estado', '¿Integrada?'];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las dos funciones que deciden qué bloquea
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.3 — qué objeciones bloquean', () => {
  /** Sólo `admitted ∧ ¬integrated`. Las otras tres combinaciones dejan pasar. */
  it.each([
    [{ status: 'admitted', integrated: false } as const, true],
    [{ status: 'admitted', integrated: true } as const, false],
    [{ status: 'dismissed', integrated: false } as const, false],
    [{ status: 'withdrawn', integrated: false } as const, false],
  ])('%o bloquea=%s', (overrides, bloquea) => {
    expect(blockingObjections([objecion(0, overrides)])).toHaveLength(bloquea ? 1 : 0);
  });

  it('la lista de bloqueantes sale ordenada por identificador, no por llegada', () => {
    const salida = blockingObjections([objecion(3), objecion(1), objecion(2)]);
    expect(salida.map((o) => o.objectionId)).toStrictEqual([
      objectionIdAt(1),
      objectionIdAt(2),
      objectionIdAt(3),
    ]);
  });

  it('no muta la lista que recibe', () => {
    const entrada = [objecion(3), objecion(1)];
    const copia = [...entrada];
    blockingObjections(entrada);
    expect(entrada).toStrictEqual(copia);
  });

  /**
   * El agujero que documenta la cabecera del módulo: una objeción que viaja **dentro** de la
   * papeleta y falta del registro de eventos cuenta igual, y nace **admitida** (B.3.a). Sin esto,
   * a un log al que le faltase el `ObjectionRaised` le saldría «nadie objetó» con una papeleta que
   * objeta a la vista.
   */
  it('una objeción que sólo viaja en la papeleta se une al registro y nace admitida', async () => {
    const cfg = await config();
    const ballots = efectivas(cfg, ['consent', 'object']);
    const unidas = mergeObjections([], ballots);
    expect(unidas).toHaveLength(1);
    expect(unidas[0]?.status).toBe('admitted');
    expect(unidas[0]?.integrated).toBe(false);
    expect(unidas[0]?.by).toBe(memberIdAt(1));
    expect(blockingObjections(unidas)).toHaveLength(1);
  });

  it('no se duplica: si ya está en el registro, manda el registro', async () => {
    const cfg = await config();
    const ballots = efectivas(cfg, ['consent', 'object']);
    const delLog = mergeObjections([], ballots)[0];
    if (delLog === undefined) throw new Error('sin objeción');
    const yaDesestimada = { ...delLog, status: 'dismissed' as const };
    const unidas = mergeObjections([yaDesestimada], ballots);
    expect(unidas).toHaveLength(1);
    expect(unidas[0]?.status).toBe('dismissed');
    expect(blockingObjections(unidas)).toHaveLength(0);
  });

  it('una papeleta que no objeta no aporta objeción, aunque el método sea el de consentimiento', async () => {
    const cfg = await config();
    expect(mergeObjections([], efectivas(cfg, ['consent', 'concern']))).toStrictEqual([]);
  });

  /**
   * Una papeleta que dice `object` **sin** objeción adjunta no puede existir en un log legal
   * —`validateBallot` la rechaza con `OBJECTION_REQUIRED`— pero `mergeObjections` es una función
   * exportada y pura, y ante esa entrada tiene que **no inventarse nada**. Con la condición de
   * guarda mutada de `||` a `&&`, no sólo se inventaba: reventaba con un `TypeError` leyendo
   * `objectionId` de `undefined`, es decir, un log ligeramente corrupto tumbaba el escrutinio entero
   * en vez de ignorar la papeleta.
   */
  it('una papeleta que dice objetar sin objeción adjunta no inventa ninguna, ni revienta', () => {
    const sinObjecion: readonly EffectiveBallot[] = [
      {
        voter: memberIdAt(0),
        payload: { kind: 'consent', stance: 'object' },
        weight: 1,
        seq: 1,
        onBehalfOf: [],
      },
    ];
    expect(mergeObjections([], sinObjecion)).toStrictEqual([]);
    expect(blockingObjections(mergeObjections([objecion(4)], sinObjecion))).toHaveLength(1);
  });

  /**
   * La deduplicación mira el identificador, no «hay algo en la lista». Con el predicado mutado a
   * `true`, cualquier registro previo —de otra objeción cualquiera— hacía desaparecer la objeción de
   * la papeleta, y con ella el bloqueo. Es la forma más silenciosa de anular una objeción.
   */
  it('una objeción de la papeleta se añade aunque el registro ya traiga otras distintas', async () => {
    const cfg = await config();
    const unidas = mergeObjections([objecion(8)], efectivas(cfg, ['consent', 'object']));
    expect(unidas).toHaveLength(2);
    expect(unidas.map((o) => o.objectionId)).toContain(objectionIdAt(8));
    expect(blockingObjections(unidas)).toHaveLength(2);
  });

  it('la manifestación ignora las papeletas que no son de consentimiento', async () => {
    const cfg = await config(3, 1, 2, 4);
    const mezcla: readonly EffectiveBallot[] = [
      {
        voter: memberIdAt(0),
        payload: { kind: 'consent', stance: 'consent' },
        weight: 1,
        seq: 1,
        onBehalfOf: [],
      },
      {
        voter: memberIdAt(1),
        payload: { kind: 'binary', approve: true },
        weight: 1,
        seq: 2,
        onBehalfOf: [],
      },
    ];
    expect(consentEngagement(cfg.electorate, cfg.circleId, mezcla)).toStrictEqual({
      manifested: 1,
      circleSize: 4,
    });
  });

  it('la unión sale ordenada por identificador', async () => {
    const cfg = await config();
    const unidas = mergeObjections([objecion(7), objecion(2)], efectivas(cfg, ['consent']));
    expect(unidas.map((o) => o.objectionId)).toStrictEqual([objectionIdAt(2), objectionIdAt(7)]);
  });

  /**
   * D.1.d — el `engagement` se atribuye al miembro **representado**, no al autor de la papeleta.
   * Con la delegación viva, una sola papeleta puede manifestar a varias personas del círculo.
   */
  it('la manifestación cuenta a los representados, no las papeletas', async () => {
    const cfg = await config(3, 1, 2, 4);
    const conDelegacion: readonly EffectiveBallot[] = [
      {
        voter: memberIdAt(0),
        payload: { kind: 'consent', stance: 'consent' },
        weight: 3,
        seq: 1,
        onBehalfOf: [memberIdAt(1), memberIdAt(2)],
      },
    ];
    expect(consentEngagement(cfg.electorate, cfg.circleId, conDelegacion)).toStrictEqual({
      manifested: 3,
      circleSize: 4,
    });
  });

  it('quien no pertenece al círculo no cuenta para la manifestación', async () => {
    const cfg = await config(3, 1, 2, 4);
    const fuera: readonly EffectiveBallot[] = [
      {
        voter: memberIdAt(0),
        payload: { kind: 'consent', stance: 'consent' },
        weight: 1,
        seq: 1,
        onBehalfOf: [memberIdAt(99)],
      },
    ];
    expect(consentEngagement(cfg.electorate, cfg.circleId, fuera)).toStrictEqual({
      manifested: 1,
      circleSize: 4,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La demostración, salida por salida
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('B.3 — la demostración del consentimiento, salida por salida', () => {
  it('aprobada: la demostración completa', async () => {
    const cfg = await config();
    const tally = tallyConsent(cfg, efectivas(cfg, ['consent', 'consent', 'concern']), {
      round: 1,
      objections: [],
    });

    expect(tally.outcome).toStrictEqual({ kind: 'approved', option: OPTION_MAIN });
    expect(tally.steps).toStrictEqual([
      {
        id: 'S1',
        claim: 'Ronda 1 de 3. Se manifestaron 3 de 4 miembros del círculo.',
        evidence: { ronda: 1, maxRondas: 3, manifestados: 3, circulo: 4 },
        supportingSeqs: [1, 2, 3],
      },
      {
        id: 'S2',
        claim:
          'Consienten: 2. Con reservas: 1. Objetan: 0. Aquí no se cuentan votos a favor: lo único ' +
          'que impide pasar es una objeción admitida.',
        evidence: { consienten: 2, conReservas: 1, objetan: 0 },
        supportingSeqs: [1, 2, 3],
      },
      {
        id: 'S3',
        claim:
          'La manifestación fue 75.00 % del círculo y se exigía al menos 1/2. El silencio no ' +
          'consiente.',
        evidence: {
          manifestacion: '3/4',
          exigido: '1/2',
          elSilencio: 'not-participating',
          cumple: 'sí',
        },
        supportingSeqs: [],
      },
      {
        id: 'S4',
        claim: 'No queda ninguna objeción admitida sin integrar.',
        evidence: { objecionesBloqueantes: 0 },
        supportingSeqs: [],
      },
      {
        id: 'S5',
        claim: 'Nadie objeta y el círculo se manifestó lo suficiente: la propuesta pasa.',
        evidence: { desenlace: 'approved' },
        supportingSeqs: [],
      },
    ]);
    expect(tally.tables).toStrictEqual([
      POSTURAS(2, 1, 0),
      { title: 'Objeciones', columns: COLUMNAS_OBJECIONES, rows: [] },
    ]);
    expect(tally.narrative).toBe(
      'En este método no se cuentan votos a favor: la propuesta pasa si nadie objeta con ' +
        'argumento de daño al fin común y si el círculo se manifestó lo suficiente. Ninguna ' +
        'objeción quedó en pie, así que la propuesta pasa.',
    );
  });

  /**
   * Ronda nueva: S4 **nombra** las objeciones que bloquean y cita sus `seq`, y S5 dice **qué ronda**
   * se abre. Un número de ronda equivocado ahí manda al círculo a enmendar contra un calendario que
   * no existe.
   */
  it('con objeciones en pie y rondas por delante, S4 las nombra y S5 dice qué ronda se abre', async () => {
    const cfg = await config();
    const tally = tallyConsent(cfg, efectivas(cfg, ['consent', 'consent', 'concern']), {
      round: 1,
      objections: [objecion(0), objecion(1, { status: 'dismissed', integrated: true })],
    });

    expect(tally.outcome).toStrictEqual({ kind: 'needs-new-round', nextRound: 2 });
    expect(tally.steps[3]).toStrictEqual({
      id: 'S4',
      claim: `Quedan 1 objeciones admitidas sin integrar: ${objectionIdAt(0)}.`,
      evidence: { objecionesBloqueantes: 1 },
      supportingSeqs: [10],
    });
    expect(tally.steps[4]).toStrictEqual({
      id: 'S5',
      claim: 'Hay objeciones pendientes: se abre la ronda 2 para enmendar.',
      evidence: { desenlace: 'needs-new-round' },
      supportingSeqs: [],
    });
    // La tabla publica las DOS: la que bloquea y la que ya no, con su estado real.
    expect(tally.tables[1]).toStrictEqual({
      title: 'Objeciones',
      columns: COLUMNAS_OBJECIONES,
      rows: [
        [objectionIdAt(0), 1, 'admitida', 'no'],
        [objectionIdAt(1), 1, 'desestimada', 'sí'],
      ],
    });
    expect(tally.narrative).toBe(
      'En este método no se cuentan votos a favor: la propuesta pasa si nadie objeta con ' +
        'argumento de daño al fin común y si el círculo se manifestó lo suficiente. Quedaron 1 ' +
        'objeciones en pie, así que se abre una ronda nueva para enmendar el texto.',
    );
  });

  /** B.3.c — agotadas las rondas, vuelve al círculo. Y S5 lo dice con otra frase. */
  it('agotadas las rondas con objeciones en pie, S5 dice que vuelve al círculo', async () => {
    const cfg = await config(2);
    const tally = tallyConsent(cfg, efectivas(cfg, ['consent', 'consent', 'object']), {
      round: 2,
      objections: [objecion(2, { status: 'withdrawn' }), objecion(3)],
    });

    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'objections-pending' });
    expect(tally.steps[0]?.claim).toBe(
      'Ronda 2 de 2. Se manifestaron 3 de 4 miembros del círculo.',
    );
    expect(tally.steps[3]).toStrictEqual({
      id: 'S4',
      claim: `Quedan 1 objeciones admitidas sin integrar: ${objectionIdAt(3)}.`,
      evidence: { objecionesBloqueantes: 1 },
      supportingSeqs: [13],
    });
    expect(tally.steps[4]?.claim).toBe(
      'Se agotaron las rondas con objeciones pendientes: la propuesta vuelve al círculo.',
    );
    expect(tally.tables[0]).toStrictEqual(POSTURAS(2, 0, 1));
    expect(tally.tables[1]).toStrictEqual({
      title: 'Objeciones',
      columns: COLUMNAS_OBJECIONES,
      rows: [
        [objectionIdAt(2), 1, 'retirada', 'no'],
        [objectionIdAt(3), 1, 'admitida', 'no'],
      ],
    });
    expect(tally.narrative).toBe(
      'En este método no se cuentan votos a favor: la propuesta pasa si nadie objeta con ' +
        'argumento de daño al fin común y si el círculo se manifestó lo suficiente. Se agotaron ' +
        'las rondas previstas con objeciones todavía en pie, así que la propuesta vuelve al círculo.',
    );
  });

  /**
   * Sin manifestación mínima se falla **cerrado** y con su propia frase: ni ronda nueva ni
   * consentimiento. La distinción importa porque el remedio es otro —prorrogar y convocar, no
   * enmendar el texto—.
   */
  it('sin manifestación suficiente, S5 lo dice sin hablar de objeciones', async () => {
    const cfg = await config(3, 3, 4, 4);
    const tally = tallyConsent(cfg, efectivas(cfg, ['consent', 'consent']), {
      round: 1,
      objections: [],
    });

    expect(tally.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
    expect(tally.steps[2]).toStrictEqual({
      id: 'S3',
      claim:
        'La manifestación fue 50.00 % del círculo y se exigía al menos 3/4. El silencio no ' +
        'consiente.',
      evidence: {
        manifestacion: '2/4',
        exigido: '3/4',
        elSilencio: 'not-participating',
        cumple: 'no',
      },
      supportingSeqs: [],
    });
    expect(tally.steps[3]?.claim).toBe('No queda ninguna objeción admitida sin integrar.');
    expect(tally.steps[4]).toStrictEqual({
      id: 'S5',
      claim: 'El círculo no se manifestó lo suficiente: no hay consentimiento.',
      evidence: { desenlace: 'rejected' },
      supportingSeqs: [],
    });
    expect(tally.narrative).toBe(
      'En este método no se cuentan votos a favor: la propuesta pasa si nadie objeta con ' +
        'argumento de daño al fin común y si el círculo se manifestó lo suficiente. El círculo no ' +
        'se manifestó lo suficiente, así que no hay consentimiento que declarar.',
    );
  });

  /** Las cuatro frases de S5 son cuatro, y las cuatro de la narrativa también. */
  it('las cuatro salidas producen cuatro S5 y cuatro párrafos distintos', async () => {
    const normal = await config();
    const ultima = await config(2);
    const exigente = await config(3, 3, 4, 4);
    const tres: readonly Vote[] = ['consent', 'consent', 'concern'];

    const salidas = [
      tallyConsent(normal, efectivas(normal, tres), { round: 1, objections: [] }),
      tallyConsent(normal, efectivas(normal, tres), { round: 1, objections: [objecion(0)] }),
      tallyConsent(ultima, efectivas(ultima, tres), { round: 2, objections: [objecion(0)] }),
      tallyConsent(exigente, efectivas(exigente, ['consent', 'consent']), {
        round: 1,
        objections: [],
      }),
    ];
    expect(new Set(salidas.map((s) => s.steps[4]?.claim)).size).toBe(4);
    expect(new Set(salidas.map((s) => s.narrative)).size).toBe(4);
    expect(salidas.map((s) => s.steps[4]?.evidence['desenlace'])).toStrictEqual([
      'approved',
      'needs-new-round',
      'rejected',
      'rejected',
    ]);
  });

  /**
   * Con **dos** objeciones bloqueantes, S4 las enumera separadas por «, ». Con una sola el separador
   * no se usa, y por eso el mutante que lo vacía sobrevivía a toda la batería: la lista quedaba
   * pegada en una sola cadena ilegible justo cuando más objeciones hay que leer.
   */
  it('S4 enumera VARIAS objeciones bloqueantes separadas, en orden de identificador', async () => {
    const cfg = await config();
    const tally = tallyConsent(cfg, efectivas(cfg, ['consent', 'consent', 'concern']), {
      round: 1,
      objections: [objecion(5), objecion(1)],
    });
    expect(tally.steps[3]).toStrictEqual({
      id: 'S4',
      claim: `Quedan 2 objeciones admitidas sin integrar: ${objectionIdAt(1)}, ${objectionIdAt(5)}.`,
      evidence: { objecionesBloqueantes: 2 },
      supportingSeqs: [11, 15],
    });
    expect(tally.narrative).toContain('Quedaron 2 objeciones en pie');
  });

  /**
   * `silenceMeans` es la regla más delicada de B.3: decide si callar consiente. La cascada de
   * `planToMethod` sólo produce `not-participating`, así que la otra mitad de la frase de S3 —la que
   * anuncia a un círculo entero que su silencio se está contando como un «sí»— **no la escribía
   * nadie en ninguna prueba**.
   */
  it('S3 anuncia si el silencio consiente, y son dos frases distintas', async () => {
    const base = await config();
    const conSilencioQueConsiente = await buildConfig({
      electorate: base.electorate,
      method: { ...base.method, silenceMeans: 'consent' } as DecisionConfig['method'],
    });
    const tally = tallyConsent(
      conSilencioQueConsiente,
      efectivas(conSilencioQueConsiente, ['consent', 'consent']),
      { round: 1, objections: [] },
    );
    expect(tally.steps[2]).toStrictEqual({
      id: 'S3',
      claim:
        'La manifestación fue 50.00 % del círculo y se exigía al menos 1/2. El silencio se cuenta ' +
        'como consentimiento.',
      evidence: {
        manifestacion: '2/4',
        exigido: '1/2',
        elSilencio: 'consent',
        cumple: 'sí',
      },
      supportingSeqs: [],
    });

    const conSilencioQueNo = tallyConsent(base, efectivas(base, ['consent', 'consent']), {
      round: 1,
      objections: [],
    });
    expect(conSilencioQueNo.steps[2]?.claim).toContain('El silencio no consiente.');
    expect(tally.steps[2]?.claim).not.toBe(conSilencioQueNo.steps[2]?.claim);
  });

  it('el umbral de manifestación es inclusivo: justo en el mínimo, cumple', async () => {
    const cfg = await config(3, 1, 2, 4); // exige 1/2 de 4 = 2
    const justo = tallyConsent(cfg, efectivas(cfg, ['consent', 'consent']), {
      round: 1,
      objections: [],
    });
    expect(justo.steps[2]?.evidence['cumple']).toBe('sí');
    expect(justo.outcome.kind).toBe('approved');

    const corto = tallyConsent(cfg, efectivas(cfg, ['consent']), { round: 1, objections: [] });
    expect(corto.steps[2]?.evidence['cumple']).toBe('no');
    expect(corto.outcome).toStrictEqual({ kind: 'rejected', reason: 'threshold-not-met' });
  });

  it('los `seq` que sustentan el paso se publican ordenados, no en orden de padrón', async () => {
    const cfg = await config();
    const ballots = effectiveBallots(
      cfg,
      makeBallots([
        { voterIndex: 3, vote: 'consent' },
        { voterIndex: 0, vote: 'consent' },
        { voterIndex: 2, vote: 'concern' },
      ]),
      ctx(cfg),
    );
    const tally = tallyConsent(cfg, ballots, { round: 1, objections: [] });
    expect(tally.steps[0]?.supportingSeqs).toStrictEqual([1, 2, 3]);
    expect(tally.steps[1]?.supportingSeqs).toStrictEqual([1, 2, 3]);
  });

  it('rechaza que se le pase un método que no es el suyo, y lo dice', async () => {
    const ajeno = await buildConfig({
      electorate: await buildElectorate(3),
      method: planToMethod({ kind: 'simple-majority', abstentionPolicy: 'exclude' }),
    });
    expect(() => tallyConsent(ajeno, [], { round: 1, objections: [] })).toThrow(
      InvalidBallotForMethod,
    );
    expect(() => tallyConsent(ajeno, [], { round: 1, objections: [] })).toThrow(
      'una papeleta de tipo sociocratic-consent no se convierte a simple-majority: se rechaza',
    );
  });

  /** INV-12 dentro del propio escrutador: una papeleta binaria en B.3 se rechaza, no se traduce. */
  it('una papeleta que no es de consentimiento se rechaza citando su tipo', async () => {
    const cfg = await config();
    const binaria: readonly EffectiveBallot[] = [
      {
        voter: memberIdAt(0),
        payload: { kind: 'binary', approve: true },
        weight: 1,
        seq: 1,
        onBehalfOf: [],
      },
    ];
    expect(() => tallyConsent(cfg, binaria, { round: 1, objections: [] })).toThrow(
      'una papeleta de tipo binary no se convierte a sociocratic-consent: se rechaza',
    );
  });

  /** Las tres posturas suman por PESO, no por cabezas: la delegación multiplica. */
  it('las tres posturas se cuentan por peso, cada una en su casilla', async () => {
    const cfg = await config(3, 1, 4, 4);
    const conPesos: readonly EffectiveBallot[] = [
      {
        voter: memberIdAt(0),
        payload: { kind: 'consent', stance: 'consent' },
        weight: 2,
        seq: 1,
        onBehalfOf: [memberIdAt(1)],
      },
      {
        voter: memberIdAt(2),
        payload: { kind: 'consent', stance: 'concern' },
        weight: 1,
        seq: 2,
        onBehalfOf: [],
      },
      {
        voter: memberIdAt(3),
        payload: {
          kind: 'consent',
          stance: 'object',
          objection: {
            objectionId: objectionIdAt(5),
            argument: ARGUMENT,
            harmedAim: 'la continuidad del taller',
            raisedAtRound: 1,
          },
        },
        weight: 1,
        seq: 3,
        onBehalfOf: [],
      },
    ];
    const tally = tallyConsent(cfg, conPesos, { round: 1, objections: [] });
    expect(tally.steps[1]?.evidence).toStrictEqual({ consienten: 2, conReservas: 1, objetan: 1 });
    expect(tally.tables[0]).toStrictEqual(POSTURAS(2, 1, 1));
    // Y la objeción que venía dentro de la papeleta bloquea de verdad.
    expect(tally.outcome).toStrictEqual({ kind: 'needs-new-round', nextRound: 2 });
    expect(tally.tables[1]?.rows).toStrictEqual([[objectionIdAt(5), 1, 'admitida', 'no']]);
  });
});
