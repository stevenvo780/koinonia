/**
 * La constitución digital: fundación, reforma, atrincheramiento y caducidad.
 *
 * Lo que se prueba aquí es el procedimiento del §6 de `GOVERNANCE.md` con sus números exactos: 2/3
 * sobre el censo son **200 de 300** y 199 no valen; 21 días de deliberación son 21 y 20 no; 3 de 5
 * firmas de Garantías son tres personas distintas del círculo congelado.
 *
 * El núcleo intangible y el rechazo de un historial forjado están en `constitution-nucleo.test.ts`,
 * porque son otra clase de garantía: no «la orden lo impide» sino «el pliegue lo rechaza».
 */

import { describe, expect, it } from 'vitest';

import { type Actor, can, denialReason } from '../src/access.js';
import {
  approveReform,
  type Clause,
  type ConstitutionLog,
  type ConstitutionText,
  constitutionId,
  constitutionNotice,
  constitutionVersionAt,
  convenedDecision,
  CORE_CLAUSE_IDS,
  currentText,
  currentVersionOf,
  ENTRENCHED_REFORM_V1,
  findReform,
  foundConstitution,
  meetsShareOf,
  ORDINARY_REFORM_V1,
  openReform,
  ratifyReform,
  recordReformVote,
  type ReformKind,
  reformId,
  rejectReform,
  replayConstitution,
  requiredCount,
  statusAt,
} from '../src/constitution/index.js';
import { fraction } from '../src/fraction.js';
import {
  circleId,
  decisionId,
  eventId,
  type EventId,
  hash,
  type Instant,
  instant,
  type MemberId,
  memberId,
} from '../src/ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escenario
// ═════════════════════════════════════════════════════════════════════════════════════════════

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');
const hex64 = (n: number): string => n.toString(16).padStart(64, '0');

const CONSTI = constitutionId(hex32(0xc0));
const CIRCULO = circleId(hex32(0xc1));
const DECISION_FUNDACIONAL = decisionId(hex32(0xd1));
const mid = (n: number): MemberId => memberId(hex32(0x1000 + n));
const ev = (log: ConstitutionLog): EventId => eventId(hex32(0x6000 + log.length + 1));

const CENSO = 300;
const DIA = 86_400_000;
const T0 = 1_700_000_000_000 as Instant;
const en = (dias: number): Instant => instant(T0 + dias * DIA);

const facilitadora: Actor = { memberId: mid(1), roles: ['facilitator'], circles: [CIRCULO] };
const miembro: Actor = { memberId: mid(30), roles: ['member'], circles: [CIRCULO] };
const admin: Actor = { memberId: mid(40), roles: ['tech-admin'], circles: [CIRCULO] };
const GARANTES: readonly MemberId[] = [mid(20), mid(21), mid(22), mid(23), mid(24)];
const garante = (i: number): Actor => ({
  memberId: GARANTES[i],
  roles: ['guarantees'],
  circles: [CIRCULO],
});

/** Cláusulas ordenadas estrictamente por identificador, como exige el texto bien formado. */
function ordenar(clauses: readonly Clause[]): readonly Clause[] {
  return [...clauses].sort((a, b) =>
    a.clauseId < b.clauseId ? -1 : a.clauseId > b.clauseId ? 1 : 0,
  );
}

const NUCLEO: readonly Clause[] = CORE_CLAUSE_IDS.map((id, i) => ({
  clauseId: id,
  textHash: hash(hex64(0x100 + i)),
}));

function texto(overrides: Partial<ConstitutionText> = {}): ConstitutionText {
  const extras: readonly Clause[] = [
    { clauseId: 'metodo_de_escrutinio' as Clause['clauseId'], textHash: hash(hex64(0x200)) },
    { clauseId: 'plazos_de_fase' as Clause['clauseId'], textHash: hash(hex64(0x201)) },
    { clauseId: 'limites_del_admin' as Clause['clauseId'], textHash: hash(hex64(0x202)) },
  ];
  return {
    clauses: ordenar([...NUCLEO, ...extras]),
    ordinary: ORDINARY_REFORM_V1,
    entrenched: ENTRENCHED_REFORM_V1,
    validityMonths: 12,
    ...overrides,
  };
}

interface FundacionOpts {
  readonly actor?: Actor;
  readonly at?: Instant;
  readonly text?: ConstitutionText;
  readonly core?: readonly Clause[];
  readonly castBallots?: number;
  readonly votesInFavor?: number;
  readonly directParticipation?: number;
  readonly log?: ConstitutionLog;
}

async function fundar(opts: FundacionOpts = {}): Promise<ConstitutionLog> {
  const log = opts.log ?? [];
  const at = opts.at ?? T0;
  return foundConstitution(
    log,
    { eventId: ev(log), at, actor: opts.actor ?? facilitadora },
    {
      constitutionId: CONSTI,
      text: opts.text ?? texto(),
      core: opts.core ?? NUCLEO,
      foundingDecisionId: DECISION_FUNDACIONAL,
      censusSize: CENSO,
      castBallots: opts.castBallots ?? 150,
      votesInFavor: opts.votesInFavor ?? 100,
      directParticipation: opts.directParticipation ?? 100,
      effectiveAt: at,
    },
  );
}

const REFORMA = reformId(hex32(0xf1));
const OTRA_REFORMA = reformId(hex32(0xf2));

interface AperturaOpts {
  readonly reformId?: ReturnType<typeof reformId>;
  readonly kind?: ReformKind;
  readonly actor?: Actor;
  readonly at?: Instant;
  readonly text?: ConstitutionText;
  readonly targetVersion?: number;
  readonly sponsorCount?: number;
  readonly deliberationDays?: number;
  readonly semesterEndsAt?: Instant;
  readonly convened?: readonly ReturnType<typeof convenedDecision>[];
}

/** El texto propuesto por defecto: cambia una cláusula ordinaria y no toca nada más. */
function textoReformado(): ConstitutionText {
  const base = texto();
  return {
    ...base,
    clauses: base.clauses.map((c) =>
      c.clauseId === 'metodo_de_escrutinio' ? { ...c, textHash: hash(hex64(0x2000)) } : c,
    ),
  };
}

async function abrir(log: ConstitutionLog, opts: AperturaOpts = {}): Promise<ConstitutionLog> {
  const at = opts.at ?? en(1);
  const dias = opts.deliberationDays ?? 21;
  return openReform(
    log,
    { eventId: ev(log), at, actor: opts.actor ?? miembro },
    {
      reformId: opts.reformId ?? REFORMA,
      kind: opts.kind ?? 'ordinaria',
      targetVersion: opts.targetVersion ?? replayConstitution(log).currentVersion,
      proposedText: opts.text ?? textoReformado(),
      censusSize: CENSO,
      guarantors: GARANTES,
      calendar: {
        semesterEndsAt: opts.semesterEndsAt ?? en(300),
        convened: opts.convened ?? [],
      },
      sponsorCount: opts.sponsorCount ?? 30,
      deliberationOpensAt: at,
      deliberationClosesAt: instant(at + dias * DIA),
    },
  );
}

interface VotoOpts {
  readonly reformId?: ReturnType<typeof reformId>;
  readonly round?: number;
  readonly opensAt: Instant;
  readonly closesAt: Instant;
  readonly votesInFavor?: number;
  readonly directParticipation?: number;
  readonly at?: Instant;
}

async function votar(log: ConstitutionLog, opts: VotoOpts): Promise<ConstitutionLog> {
  const at = opts.at ?? opts.closesAt;
  return recordReformVote(
    log,
    { eventId: ev(log), at, actor: facilitadora },
    {
      reformId: opts.reformId ?? REFORMA,
      vote: {
        round: opts.round ?? 1,
        decisionId: decisionId(hex32(0xd2 + (opts.round ?? 1))),
        votesInFavor: opts.votesInFavor ?? 200,
        directParticipation: opts.directParticipation ?? 100,
        opensAt: opts.opensAt,
        closesAt: opts.closesAt,
      },
    },
  );
}

async function aprobar(
  log: ConstitutionLog,
  indices: readonly number[],
  at: Instant,
  id = REFORMA,
): Promise<ConstitutionLog> {
  let actual = log;
  for (const i of indices) {
    actual = await approveReform(
      actual,
      { eventId: ev(actual), at, actor: garante(i) },
      { reformId: id },
    );
  }
  return actual;
}

/** Camino completo de una reforma ordinaria: abre, delibera 21 días, vota, firma y ratifica. */
async function reformaCompleta(): Promise<ConstitutionLog> {
  let log = await fundar();
  log = await abrir(log);
  log = await votar(log, { opensAt: en(22), closesAt: en(29) });
  log = await aprobar(log, [0, 1, 2], en(30));
  return ratifyReform(
    log,
    { eventId: ev(log), at: en(43), actor: facilitadora },
    { reformId: REFORMA, effectiveAt: en(43) },
  );
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Fundación
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('fundación (§6, «el problema del arranque»)', () => {
  it('funda con 2/3 de las PAPELETAS y participación de un tercio del censo', async () => {
    const estado = replayConstitution(await fundar());
    expect(estado.exists).toBe(true);
    expect(estado.currentVersion).toBe(1);
    expect(estado.foundations).toBe(1);
    expect(estado.core).toHaveLength(6);
    expect(statusAt(estado, T0)).toBe('vigente');
  });

  it('la versión fundacional caduca a los doce meses, ni un milisegundo antes', async () => {
    const estado = replayConstitution(await fundar());
    const version = currentVersionOf(estado)!;
    // 2023-11-14 17:13:20 en Bogotá + 12 meses = 2024-11-14 17:13:20 en Bogotá. Son **366** días
    // porque 2024 es bisiesto: por eso los meses se suman en el calendario y no en milisegundos.
    expect(version.expiresAt).toBe(1_731_622_400_000);
    expect(version.expiresAt - version.effectiveAt).toBe(366 * DIA);
    expect(statusAt(estado, instant(version.expiresAt - 1))).toBe('vigente');
    expect(statusAt(estado, version.expiresAt)).toBe('caducada');
  });

  it('99 de 150 papeletas no son dos tercios: se rechaza por un voto', async () => {
    await expect(fundar({ votesInFavor: 99 })).rejects.toMatchObject({
      code: 'FOUNDING_THRESHOLD_NOT_MET',
    });
    await expect(fundar({ votesInFavor: 100 })).resolves.toBeDefined();
  });

  it('con 99 personas votando directamente no hay fundación: hacen falta 100 de 300', async () => {
    await expect(
      fundar({ castBallots: 150, votesInFavor: 100, directParticipation: 99 }),
    ).rejects.toMatchObject({ code: 'FOUNDING_PARTICIPATION_NOT_MET' });
  });

  it('un núcleo de cinco puntos no funda nada', async () => {
    await expect(fundar({ core: NUCLEO.slice(0, 5) })).rejects.toMatchObject({
      code: 'CORE_INCOMPLETE',
    });
  });

  it('un texto que no contiene una cláusula del núcleo no funda nada', async () => {
    const sinLista = texto({
      clauses: texto().clauses.filter((c) => c.clauseId !== 'lista_taxativa'),
    });
    await expect(fundar({ text: sinLista })).rejects.toMatchObject({
      code: 'CORE_CLAUSE_MISSING',
    });
  });

  it('fundar otra encima de una vigente es un golpe, no una fundación', async () => {
    const log = await fundar();
    await expect(fundar({ log, at: en(1) })).rejects.toMatchObject({
      code: 'CONSTITUTION_STILL_VIGENT',
    });
  });

  it('sin constitución no se abre ninguna reforma: las reglas no se derivan de sí mismas', () => {
    expect(() => replayConstitution([])).toThrow(expect.objectContaining({ code: 'EMPTY_LOG' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Aritmética exacta
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('umbrales sin punto flotante (ADR-0027)', () => {
  it('2/3 sobre 300 son 200 exactas: 199 no pasa y 200 sí', () => {
    expect(requiredCount(fraction(2n, 3n), 300)).toBe(200);
    expect(meetsShareOf(199, fraction(2n, 3n), 300)).toBe(false);
    expect(meetsShareOf(200, fraction(2n, 3n), 300)).toBe(true);
  });

  it('3/4 sobre 300 son 225 exactas', () => {
    expect(requiredCount(fraction(3n, 4n), 300)).toBe(225);
    expect(meetsShareOf(224, fraction(3n, 4n), 300)).toBe(false);
    expect(meetsShareOf(225, fraction(3n, 4n), 300)).toBe(true);
  });

  it('la reforma se cae por un solo voto: 199 de 300 no es dos tercios', async () => {
    let log = await fundar();
    log = await abrir(log);
    log = await votar(log, { opensAt: en(22), closesAt: en(29), votesInFavor: 199 });
    log = await aprobar(log, [0, 1, 2], en(30));
    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: en(43), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(43) },
      ),
    ).rejects.toMatchObject({ code: 'THRESHOLD_NOT_MET' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Reforma ordinaria — fila 13
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('reforma ordinaria (fila 13)', () => {
  it('el camino completo deja la versión 2 vigente y conserva la 1', async () => {
    const estado = replayConstitution(await reformaCompleta());
    expect(estado.currentVersion).toBe(2);
    expect(estado.versions).toHaveLength(2);
    const v1 = constitutionVersionAt(estado, 1)!;
    const v2 = constitutionVersionAt(estado, 2)!;
    expect(v1.text.clauses.find((c) => c.clauseId === 'metodo_de_escrutinio')!.textHash).toBe(
      hex64(0x200),
    );
    expect(v2.text.clauses.find((c) => c.clauseId === 'metodo_de_escrutinio')!.textHash).toBe(
      hex64(0x2000),
    );
    expect(findReform(estado, REFORMA)!.status).toBe('ratificada');
  });

  it('la ratificación renueva la vigencia: doce meses desde la entrada en vigor', async () => {
    const estado = replayConstitution(await reformaCompleta());
    const v2 = currentVersionOf(estado)!;
    expect(v2.expiresAt).toBeGreaterThan(constitutionVersionAt(estado, 1)!.expiresAt);
  });

  it('veinte días de deliberación no son veintiuno', async () => {
    const log = await fundar();
    await expect(abrir(log, { deliberationDays: 20 })).rejects.toMatchObject({
      code: 'DELIBERATION_TOO_SHORT',
    });
    await expect(abrir(log, { deliberationDays: 21 })).resolves.toBeDefined();
  });

  it('29 firmas no abren una reforma; 30 sí (10 % de 300)', async () => {
    const log = await fundar();
    await expect(abrir(log, { sponsorCount: 29 })).rejects.toMatchObject({
      code: 'NOT_ENOUGH_SPONSORS',
    });
    await expect(abrir(log, { sponsorCount: 30 })).resolves.toBeDefined();
  });

  it('no se vota mientras la deliberación sigue abierta', async () => {
    let log = await fundar();
    log = await abrir(log);
    await expect(votar(log, { opensAt: en(20), closesAt: en(29) })).rejects.toMatchObject({
      code: 'VOTE_BEFORE_DELIBERATION_CLOSES',
    });
  });

  it('no se registra el resultado de una urna que sigue abierta', async () => {
    let log = await fundar();
    log = await abrir(log);
    await expect(
      votar(log, { opensAt: en(22), closesAt: en(29), at: en(28) }),
    ).rejects.toMatchObject({ code: 'VOTE_NOT_CLOSED' });
  });

  it('los 14 días de espera son reales: entrar en vigor antes se rechaza', async () => {
    let log = await fundar();
    log = await abrir(log);
    log = await votar(log, { opensAt: en(22), closesAt: en(29) });
    log = await aprobar(log, [0, 1, 2], en(30));
    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: en(42), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(42) },
      ),
    ).rejects.toMatchObject({ code: 'WAITING_PERIOD_NOT_ELAPSED' });
    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: en(43), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(43) },
      ),
    ).resolves.toBeDefined();
  });

  it('no se ratifica lo que no se votó: la tabla de estados no tiene esa pareja', async () => {
    let log = await fundar();
    log = await abrir(log);
    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: en(43), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(43) },
      ),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });

  it('una reforma cerrada no se reabre: los estados terminales son absorbentes', async () => {
    const log = await reformaCompleta();
    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: en(60), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(60) },
      ),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// M de N — y lo que NO garantiza
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('aprobación M-de-N de Garantías (§6.6)', () => {
  it('con dos firmas la regla queda aprobada pero NO vigente; con la tercera entra', async () => {
    let log = await fundar();
    log = await abrir(log);
    log = await votar(log, { opensAt: en(22), closesAt: en(29) });
    const conDos = await aprobar(log, [0, 1], en(30));
    await expect(
      ratifyReform(
        conDos,
        { eventId: ev(conDos), at: en(43), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(43) },
      ),
    ).rejects.toMatchObject({ code: 'GUARANTEE_THRESHOLD_NOT_MET' });

    const conTres = await aprobar(conDos, [2], en(31));
    await expect(
      ratifyReform(
        conTres,
        { eventId: ev(conTres), at: en(43), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(43) },
      ),
    ).resolves.toBeDefined();
  });

  it('la misma persona no firma dos veces: M de N son M personas distintas', async () => {
    let log = await fundar();
    log = await abrir(log);
    log = await votar(log, { opensAt: en(22), closesAt: en(29) });
    log = await aprobar(log, [0], en(30));
    await expect(aprobar(log, [0], en(31))).rejects.toMatchObject({ code: 'DUPLICATE_APPROVAL' });
  });

  it('no firma quien no estaba en el círculo congelado al abrir la reforma', async () => {
    let log = await fundar();
    log = await abrir(log);
    log = await votar(log, { opensAt: en(22), closesAt: en(29) });
    const intruso: Actor = { memberId: mid(99), roles: ['guarantees'], circles: [CIRCULO] };
    await expect(
      approveReform(log, { eventId: ev(log), at: en(30), actor: intruso }, { reformId: REFORMA }),
    ).rejects.toMatchObject({ code: 'NOT_A_GUARANTOR' });
  });

  it('Garantías no firma antes de que la votación exista: no hay procedimiento que verificar', async () => {
    let log = await fundar();
    log = await abrir(log);
    await expect(aprobar(log, [0], en(10))).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });

  it('nadie aprueba en nombre de otra persona', () => {
    expect(
      can(garante(0), 'constitution:approve', { kind: 'constitution', subject: GARANTES[0] }),
    ).toBe(true);
    expect(
      denialReason(garante(0), 'constitution:approve', {
        kind: 'constitution',
        subject: GARANTES[1],
      }),
    ).toBe('NOT_THE_SUBJECT');
  });

  it('quien facilita no firma: la puesta en vigor es de Garantías y de nadie más', () => {
    expect(denialReason(facilitadora, 'constitution:approve', { kind: 'constitution' })).toBe(
      'ROLE_NOT_GRANTED',
    );
    expect(denialReason(miembro, 'constitution:approve', { kind: 'constitution' })).toBe(
      'ROLE_NOT_GRANTED',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La copia congelada — cláusula de atrincheramiento (c)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('copia congelada: ninguna reforma se juzga con las reglas que ella cambia', () => {
  it('una reforma que baja el umbral se aprueba con el umbral VIEJO, no con el suyo', async () => {
    // Bajar `ordinary.approvalOfCensus` a 3/5 toca la cláusula de enmienda ⇒ vía atrincherada, que
    // exige 225 en dos votaciones separadas por un semestre. La copia congelada la mide con eso.
    const base = texto();
    const masBlanda = texto({
      ordinary: { ...ORDINARY_REFORM_V1, approvalOfCensus: fraction(3n, 5n) },
    });
    let log = await fundar();
    log = await abrir(log, { kind: 'atrincherada', text: masBlanda, sponsorCount: 60 });

    // 200 votos —lo que bastaría con el umbral NUEVO— no alcanzan: se mide con el congelado, 3/4.
    log = await votar(log, {
      opensAt: en(22),
      closesAt: en(29),
      votesInFavor: 225,
      directParticipation: 150,
    });
    const flojo = await votar(log, {
      round: 2,
      opensAt: en(220),
      closesAt: en(230),
      votesInFavor: 200,
      directParticipation: 150,
    });
    const firmado = await aprobar(flojo, [0, 1, 2, 3], en(231));
    await expect(
      ratifyReform(
        firmado,
        { eventId: ev(firmado), at: en(245), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(245) },
      ),
    ).rejects.toMatchObject({ code: 'THRESHOLD_NOT_MET' });

    // Con 225 en las dos rondas sí entra, y a partir de ahí las reformas ordinarias piden 180.
    let bueno = await votar(log, {
      round: 2,
      opensAt: en(220),
      closesAt: en(230),
      votesInFavor: 225,
      directParticipation: 150,
    });
    bueno = await aprobar(bueno, [0, 1, 2, 3], en(231));
    bueno = await ratifyReform(
      bueno,
      { eventId: ev(bueno), at: en(245), actor: facilitadora },
      { reformId: REFORMA, effectiveAt: en(245) },
    );
    const estado = replayConstitution(bueno);
    expect(currentText(estado)!.ordinary.approvalOfCensus).toEqual(fraction(3n, 5n));
    expect(base.ordinary.approvalOfCensus).toEqual(fraction(2n, 3n));
    expect(requiredCount(fraction(3n, 5n), 300)).toBe(180);
  });

  it('la copia congelada tiene que ser fiel: no se elige el umbral con el que se mide', async () => {
    // Se fabrica un `ReformOpened` con una copia congelada rebajada. La cadena queda intacta, y aun
    // así el pliegue lo rechaza: congelar sin cotejar sería peor que no congelar.
    const log = await fundar();
    const abierta = await abrir(log);
    const evento = abierta.at(-1)!;
    expect(evento.payload.type).toBe('ReformOpened');
    if (evento.payload.type !== 'ReformOpened') throw new Error('imposible');
    const forjado = {
      ...evento,
      payload: {
        ...evento.payload,
        frozen: {
          ...evento.payload.frozen,
          requirements: {
            ...evento.payload.frozen.requirements,
            approvalOfCensus: fraction(3n, 5n),
          },
        },
      },
    };
    expect(() => replayConstitution([...log, forjado])).toThrow(
      expect.objectContaining({ code: 'FROZEN_RULES_MISMATCH' }),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// La cláusula de enmienda — fila 14
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('la enmienda de la cláusula de enmienda (§6.a)', () => {
  it('una reforma ordinaria no puede tocar los requisitos de reforma', async () => {
    const log = await fundar();
    const tocado = texto({ ordinary: { ...ORDINARY_REFORM_V1, waitingDays: 1 } });
    await expect(abrir(log, { text: tocado })).rejects.toMatchObject({
      code: 'AMENDMENT_RULE_IS_ENTRENCHED',
    });
  });

  it('tampoco puede tocar la vigencia, que es la caducidad del punto (iv) del núcleo', async () => {
    const log = await fundar();
    await expect(abrir(log, { text: texto({ validityMonths: 24 }) })).rejects.toMatchObject({
      code: 'AMENDMENT_RULE_IS_ENTRENCHED',
    });
  });

  it('la vía atrincherada exige DOS votaciones separadas por un semestre', async () => {
    let log = await fundar();
    log = await abrir(log, {
      kind: 'atrincherada',
      text: texto({ ordinary: { ...ORDINARY_REFORM_V1, waitingDays: 10 } }),
      sponsorCount: 60,
    });
    log = await votar(log, {
      opensAt: en(22),
      closesAt: en(29),
      votesInFavor: 225,
      directParticipation: 150,
    });

    // Con una sola votación no se ratifica; y Garantías tampoco puede firmar todavía, porque el
    // procedimiento que verifican (§6.6) no ha terminado.
    await expect(aprobar(log, [0], en(30))).rejects.toMatchObject({ code: 'VOTES_INCOMPLETE' });
    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: en(43), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(43) },
      ),
    ).rejects.toMatchObject({ code: 'VOTES_INCOMPLETE' });

    // La segunda a los cinco meses tampoco vale: el semestre es completo.
    await expect(
      votar(log, {
        round: 2,
        opensAt: en(170),
        closesAt: en(175),
        votesInFavor: 225,
        directParticipation: 150,
      }),
    ).rejects.toMatchObject({ code: 'VOTES_TOO_CLOSE' });

    // A los seis meses del cierre de la primera, sí.
    const segunda = await votar(log, {
      round: 2,
      opensAt: en(210),
      closesAt: en(215),
      votesInFavor: 225,
      directParticipation: 150,
    });
    const firmada = await aprobar(segunda, [0, 1, 2, 3], en(216));
    const ratificada = await ratifyReform(
      firmada,
      { eventId: ev(firmada), at: en(230), actor: facilitadora },
      { reformId: REFORMA, effectiveAt: en(230) },
    );
    expect(replayConstitution(ratificada).currentVersion).toBe(2);
  });

  it('la vía atrincherada exige 4 de 5 firmas, no 3', async () => {
    let log = await fundar();
    log = await abrir(log, {
      kind: 'atrincherada',
      text: texto({ ordinary: { ...ORDINARY_REFORM_V1, waitingDays: 10 } }),
      sponsorCount: 60,
    });
    log = await votar(log, {
      opensAt: en(22),
      closesAt: en(29),
      votesInFavor: 225,
      directParticipation: 150,
    });
    log = await votar(log, {
      round: 2,
      opensAt: en(210),
      closesAt: en(215),
      votesInFavor: 225,
      directParticipation: 150,
    });
    const conTres = await aprobar(log, [0, 1, 2], en(216));
    await expect(
      ratifyReform(
        conTres,
        { eventId: ev(conTres), at: en(230), actor: facilitadora },
        { reformId: REFORMA, effectiveAt: en(230) },
      ),
    ).rejects.toMatchObject({ code: 'GUARANTEE_THRESHOLD_NOT_MET' });
  });

  it('no se puede dejar la vía atrincherada más blanda que la ordinaria', async () => {
    const log = await fundar();
    const invertido = texto({
      entrenched: { ...ENTRENCHED_REFORM_V1, guaranteeThreshold: 2 },
    });
    await expect(
      abrir(log, { kind: 'atrincherada', text: invertido, sponsorCount: 60 }),
    ).rejects.toMatchObject({ code: 'ENTRENCHED_WEAKER_THAN_ORDINARY' });
  });

  it('ninguna vía baja de la supermayoría: media comunidad no reforma nada', async () => {
    const log = await fundar();
    const mitad = texto({
      ordinary: { ...ORDINARY_REFORM_V1, approvalOfCensus: fraction(1n, 2n) },
    });
    await expect(
      abrir(log, { kind: 'atrincherada', text: mitad, sponsorCount: 60 }),
    ).rejects.toMatchObject({ code: 'THRESHOLD_BELOW_SUPERMAJORITY' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Ventana propia — §6.c
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('prohibición de reformar en ventana propia (§6.c)', () => {
  it('no se vota una reforma en las dos últimas semanas del semestre', async () => {
    let log = await fundar();
    log = await abrir(log, { semesterEndsAt: en(35) });
    await expect(votar(log, { opensAt: en(23), closesAt: en(29) })).rejects.toMatchObject({
      code: 'REFORM_IN_ITS_OWN_WINDOW',
    });
  });

  it('ni en los 30 días previos a una decisión ya convocada que la reforma afectaría', async () => {
    let log = await fundar();
    log = await abrir(log, {
      convened: [
        convenedDecision(decisionId(hex32(0xdd)), en(40), ['metodo_de_escrutinio' as never]),
      ],
    });
    await expect(votar(log, { opensAt: en(22), closesAt: en(29) })).rejects.toMatchObject({
      code: 'REFORM_IN_ITS_OWN_WINDOW',
    });
  });

  it('una decisión convocada que la reforma NO afecta no veda nada', async () => {
    let log = await fundar();
    log = await abrir(log, {
      convened: [convenedDecision(decisionId(hex32(0xdd)), en(40), ['plazos_de_fase' as never])],
    });
    await expect(votar(log, { opensAt: en(22), closesAt: en(29) })).resolves.toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Concurrencia optimista
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('dos reformas abiertas sobre la misma versión', () => {
  it('se ratifica la primera; la segunda encuentra la versión desplazada', async () => {
    let log = await fundar();
    log = await abrir(log, { reformId: REFORMA });
    log = await abrir(log, {
      reformId: OTRA_REFORMA,
      at: en(2),
      text: texto({
        clauses: texto().clauses.map((c) =>
          c.clauseId === 'plazos_de_fase' ? { ...c, textHash: hash(hex64(0x2010)) } : c,
        ),
      }),
    });

    log = await votar(log, { reformId: REFORMA, opensAt: en(22), closesAt: en(29) });
    log = await votar(log, { reformId: OTRA_REFORMA, opensAt: en(23), closesAt: en(30) });
    log = await aprobar(log, [0, 1, 2], en(31), REFORMA);
    log = await aprobar(log, [0, 1, 2], en(31), OTRA_REFORMA);

    log = await ratifyReform(
      log,
      { eventId: ev(log), at: en(43), actor: facilitadora },
      { reformId: REFORMA, effectiveAt: en(43) },
    );
    expect(replayConstitution(log).currentVersion).toBe(2);

    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: en(44), actor: facilitadora },
        { reformId: OTRA_REFORMA, effectiveAt: en(44) },
      ),
    ).rejects.toMatchObject({ code: 'STALE_REFORM_TARGET' });

    // Y se puede cerrar en público con el motivo que el historial sostiene.
    const cerrada = await rejectReform(
      log,
      { eventId: ev(log), at: en(45), actor: facilitadora },
      { reformId: OTRA_REFORMA, reason: 'version_desplazada' },
    );
    expect(findReform(replayConstitution(cerrada), OTRA_REFORMA)!.status).toBe('rechazada');
  });

  it('no se cierra una reforma con un motivo que el historial no sostiene', async () => {
    let log = await fundar();
    log = await abrir(log);
    log = await votar(log, { opensAt: en(22), closesAt: en(29) });
    await expect(
      rejectReform(
        log,
        { eventId: ev(log), at: en(30), actor: facilitadora },
        { reformId: REFORMA, reason: 'umbral_no_alcanzado' },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_REJECTION' });
  });

  it('quien la propuso puede retirarla; otra persona, no', async () => {
    let log = await fundar();
    log = await abrir(log, { actor: miembro });
    await expect(
      rejectReform(
        log,
        { eventId: ev(log), at: en(3), actor: facilitadora },
        { reformId: REFORMA, reason: 'retirada_por_quien_la_propuso' },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_REJECTION' });

    // Quien propuso es miembro raso y `constitution:ratify` no le corresponde: retirar lo propio
    // exige además el permiso de procedimiento. Es una asimetría real y queda anotada.
    expect(denialReason(miembro, 'constitution:ratify', { kind: 'constitution' })).toBe(
      'ROLE_NOT_GRANTED',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Caducidad — decisión (d)
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('caducidad: se declara, no degrada nada', () => {
  const CADUCA = 1_731_622_400_000 as Instant;

  it('caducada, no se abre reforma, no se vota y no se ratifica', async () => {
    let log = await fundar();
    log = await abrir(log);
    log = await votar(log, { opensAt: en(22), closesAt: en(29) });
    log = await aprobar(log, [0, 1, 2], en(30));

    await expect(abrir(log, { reformId: OTRA_REFORMA, at: CADUCA })).rejects.toMatchObject({
      code: 'CONSTITUTION_EXPIRED',
    });
    await expect(
      ratifyReform(
        log,
        { eventId: ev(log), at: CADUCA, actor: facilitadora },
        { reformId: REFORMA, effectiveAt: CADUCA },
      ),
    ).rejects.toMatchObject({ code: 'CONSTITUTION_EXPIRED' });
    await expect(aprobar(log, [3], CADUCA)).rejects.toMatchObject({
      code: 'CONSTITUTION_EXPIRED',
    });
  });

  it('la refundación es lo ÚNICO que se acepta, y exige la regla fundacional completa', async () => {
    const log = await fundar();
    await expect(
      fundar({ log, at: CADUCA, castBallots: 150, votesInFavor: 99 }),
    ).rejects.toMatchObject({ code: 'FOUNDING_THRESHOLD_NOT_MET' });
    await expect(
      fundar({ log, at: CADUCA, castBallots: 150, votesInFavor: 100, directParticipation: 99 }),
    ).rejects.toMatchObject({ code: 'FOUNDING_PARTICIPATION_NOT_MET' });

    const refundada = replayConstitution(await fundar({ log, at: CADUCA }));
    expect(refundada.currentVersion).toBe(2);
    expect(refundada.foundations).toBe(2);
    expect(statusAt(refundada, CADUCA)).toBe('vigente');
    expect(refundada.versions).toHaveLength(2);
  });

  it('ni la refundación cambia el núcleo: eso es fundar otra comunidad', async () => {
    const log = await fundar();
    const otroNucleo = NUCLEO.map((c, i) => (i === 5 ? { ...c, textHash: hash(hex64(0x999)) } : c));
    const otroTexto = texto({
      clauses: texto().clauses.map((c) =>
        c.clauseId === 'lista_taxativa' ? { ...c, textHash: hash(hex64(0x999)) } : c,
      ),
    });
    await expect(
      fundar({ log, at: CADUCA, core: otroNucleo, text: otroTexto }),
    ).rejects.toMatchObject({ code: 'CORE_SET_ALTERED' });
  });

  it('el aviso público dice que caducó y que ningún plazo rebaja las mayorías', async () => {
    const estado = replayConstitution(await fundar());
    expect(constitutionNotice(estado, T0)).toContain('Rige la versión 1');
    const aviso = constitutionNotice(estado, CADUCA);
    expect(aviso).toContain('vencieron');
    expect(aviso).toContain('leer y exportar');
    expect(aviso).toContain('rebaja');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El administrador técnico
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('`tech-admin` no tiene NINGUNA capacidad sobre la constitución (§7)', () => {
  const recurso = { kind: 'constitution' as const };

  it('ni proponer, ni registrar la votación, ni aprobar, ni ratificar, ni fundar', () => {
    expect(denialReason(admin, 'constitution:propose-reform', recurso)).toBe('ROLE_NOT_GRANTED');
    expect(denialReason(admin, 'constitution:record-vote', recurso)).toBe('ROLE_NOT_GRANTED');
    expect(denialReason(admin, 'constitution:approve', recurso)).toBe('ROLE_NOT_GRANTED');
    expect(denialReason(admin, 'constitution:ratify', recurso)).toBe('ROLE_NOT_GRANTED');
    expect(denialReason(admin, 'constitution:found', recurso)).toBe('ROLE_NOT_GRANTED');
  });

  it('tampoco votar la reforma: la papeleta es un acto de miembro', () => {
    expect(
      denialReason(admin, 'decision:cast-ballot', {
        kind: 'decision',
        subject: admin.memberId,
        circleId: CIRCULO,
      }),
    ).toBe('ROLE_NOT_GRANTED');
  });

  it('y las órdenes lanzan, no sólo la matriz', async () => {
    const log = await fundar();
    await expect(
      abrir(log, { actor: admin, reformId: OTRA_REFORMA, at: en(2) }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
    await expect(fundar({ actor: admin })).rejects.toMatchObject({
      code: 'UNAUTHORIZED_ROLE_NOT_GRANTED',
    });
    let conVoto = await abrir(log);
    conVoto = await votar(conVoto, { opensAt: en(22), closesAt: en(29) });
    await expect(
      approveReform(
        conVoto,
        { eventId: ev(conVoto), at: en(30), actor: admin },
        { reformId: REFORMA },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
    await expect(
      recordReformVote(
        conVoto,
        { eventId: ev(conVoto), at: en(30), actor: admin },
        {
          reformId: REFORMA,
          vote: {
            round: 2,
            decisionId: DECISION_FUNDACIONAL,
            votesInFavor: 300,
            directParticipation: 300,
            opensAt: en(22),
            closesAt: en(29),
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
    await expect(
      ratifyReform(
        conVoto,
        { eventId: ev(conVoto), at: en(43), actor: admin },
        { reformId: REFORMA, effectiveAt: en(43) },
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED_ROLE_NOT_GRANTED' });
  });

  it('leer sí: lo público se lee sin cuenta, incluido quien administra', () => {
    expect(can(admin, 'constitution:read', recurso)).toBe(true);
  });
});
