/**
 * Propiedades de la constitución digital.
 *
 * No se comprueba el camino feliz: se generan constituciones enteras al azar —cuántas reformas, con
 * cuántos votos, con cuántas firmas de Garantías, tocando qué cláusulas— y se exige que **todo**
 * historial resultante cumpla las nueve invariantes del diseño. La semilla es fija
 * (`30_000_821`, como el resto del repo) para que un contraejemplo se pueda volver a mirar mañana.
 *
 * Dos de las nueve son **adversariales**: no recorren historiales bien formados, sino que fabrican
 * el historial que fabricaría quien tiene el servidor —con la cadena de hashes recalculada— y exigen
 * que el pliegue lo rechace. Una invariante que sólo recorre lo que el propio generador sabe
 * construir no habría encontrado nunca ese hueco, porque el generador tampoco lo intentaba.
 *
 * ═══ Una nota sobre INV-C4 ═══
 *
 * `GOVERNANCE.md` se contradice sobre qué exige la fila 14: la tabla del §4 dice que sirve para
 * «tocar el núcleo intangible», y el §6.b y el §10 dicen que el núcleo **no se reforma por ningún
 * procedimiento**. Manda lo segundo —es la cláusula de atrincheramiento—, así que la doble llave
 * temporal se prueba sobre lo que la fila 14 sí gobierna: la cláusula de enmienda. Que el núcleo no
 * se toca ni con dos votaciones ni con cuatro firmas lo prueban INV-C1 e INV-C2.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Actor } from '../../src/access.js';
import {
  approveReform,
  type Clause,
  type ConstitutionLog,
  type ConstitutionPayload,
  type ConstitutionState,
  type ConstitutionText,
  CONSTITUTION_EVENT_TYPES,
  constitutionId,
  constitutionVersionAt,
  CORE_CLAUSE_IDS,
  currentText,
  ENTRENCHED_REFORM_V1,
  findReform,
  foundConstitution,
  isLegalReformTransition,
  nextReformStatus,
  openReform,
  ORDINARY_REFORM_V1,
  ratifyReform,
  recordReformVote,
  REFORM_LIFECYCLE,
  REFORM_TRANSITIONS,
  type ReformId,
  reformId,
  replayConstitution,
  statusAt,
} from '../../src/constitution/index.js';
import { fraction } from '../../src/fraction.js';
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
} from '../../src/ids.js';
import { appendChained, verifyChain } from '../../src/workspace/chain.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escenario
// ═════════════════════════════════════════════════════════════════════════════════════════════

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');
const hex64 = (n: number): string => n.toString(16).padStart(64, '0');

const CONSTI = constitutionId(hex32(0xc0));
const CIRCULO = circleId(hex32(0xc1));
const mid = (n: number): MemberId => memberId(hex32(0x1000 + n));
const ev = (log: ConstitutionLog): EventId => eventId(hex32(0x6000 + log.length + 1));
const rid = (n: number): ReformId => reformId(hex32(0xf000 + n));

const CENSO = 300;
const DIA = 86_400_000;
const T0 = 1_700_000_000_000 as Instant;
const en = (dias: number): Instant => instant(T0 + dias * DIA);

const facilitadora: Actor = { memberId: mid(1), roles: ['facilitator'], circles: [CIRCULO] };
const miembro: Actor = { memberId: mid(30), roles: ['member'], circles: [CIRCULO] };
const GARANTES: readonly MemberId[] = [mid(20), mid(21), mid(22), mid(23), mid(24)];
const garante = (i: number): Actor => ({
  memberId: GARANTES[i],
  roles: ['guarantees'],
  circles: [CIRCULO],
});

const NUCLEO: readonly Clause[] = CORE_CLAUSE_IDS.map((id, i) => ({
  clauseId: id,
  textHash: hash(hex64(0x100 + i)),
}));

const ORDINARIAS: readonly string[] = ['metodo_de_escrutinio', 'plazos_de_fase', 'limites_admin'];

function ordenar(clauses: readonly Clause[]): readonly Clause[] {
  return [...clauses].sort((a, b) =>
    a.clauseId < b.clauseId ? -1 : a.clauseId > b.clauseId ? 1 : 0,
  );
}

const TEXTO_BASE: ConstitutionText = {
  clauses: ordenar([
    ...NUCLEO,
    ...ORDINARIAS.map((id, i) => ({
      clauseId: id as Clause['clauseId'],
      textHash: hash(hex64(0x200 + i)),
    })),
  ]),
  ordinary: ORDINARY_REFORM_V1,
  entrenched: ENTRENCHED_REFORM_V1,
  validityMonths: 12,
};

function conClausula(text: ConstitutionText, clause: string, nuevo: string): ConstitutionText {
  return {
    ...text,
    clauses: text.clauses.map((c) => (c.clauseId === clause ? { ...c, textHash: hash(nuevo) } : c)),
  };
}

async function fundar(at: Instant = T0): Promise<ConstitutionLog> {
  return foundConstitution(
    [],
    { eventId: ev([]), at, actor: facilitadora },
    {
      constitutionId: CONSTI,
      text: TEXTO_BASE,
      core: NUCLEO,
      foundingDecisionId: decisionId(hex32(0xd1)),
      censusSize: CENSO,
      castBallots: 150,
      votesInFavor: 100,
      directParticipation: 100,
      effectiveAt: at,
    },
  );
}

/** Número de corridas por propiedad, escalable con `FC_RUNS` como en el resto del repo. */
const RUNS = Number(process.env['FC_RUNS'] ?? '1000');
const SEED = 30_000_821;
const runs = (atDefault: number): { numRuns: number; seed: number } => ({
  seed: SEED,
  numRuns: Math.max(5, Math.round((RUNS * atDefault) / 1000)),
});

interface PlanReforma {
  /** Votos a favor de la ronda. El umbral son 200 de 300, así que el generador cruza la frontera. */
  readonly votosAFavor: number;
  /** Personas en voto directo. El mínimo son 100 de 300. */
  readonly votoDirecto: number;
  /** Cuántos de los cinco garantes aprueban. El umbral son 3. */
  readonly firmas: number;
  /** Cuál de las cláusulas ordinarias toca. */
  readonly clausula: number;
}

const arbReforma: fc.Arbitrary<PlanReforma> = fc.record({
  votosAFavor: fc.integer({ min: 196, max: 204 }),
  votoDirecto: fc.integer({ min: 97, max: 103 }),
  firmas: fc.integer({ min: 0, max: 5 }),
  clausula: fc.integer({ min: 0, max: ORDINARIAS.length - 1 }),
});

const arbPlan = fc.array(arbReforma, { minLength: 1, maxLength: 4 });

interface Intento {
  readonly reformId: ReformId;
  readonly ratificada: boolean;
  readonly esperada: boolean;
  readonly codigo: string | undefined;
}

interface Construccion {
  readonly log: ConstitutionLog;
  readonly intentos: readonly Intento[];
}

function codigoDe(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/**
 * Construye una constitución con N reformas ordinarias, secuenciales, cada una con sus números.
 *
 * Las que no cumplen fallan **de verdad** —la orden lanza— y eso se anota. Lo que se prueba no es
 * que el generador sepa las reglas, sino que el historial resultante las cumpla todas.
 */
async function construir(plan: readonly PlanReforma[]): Promise<Construccion> {
  let log = await fundar();
  const intentos: Intento[] = [];

  for (let i = 0; i < plan.length; i++) {
    const paso = plan[i]!;
    const base = 1 + i * 60;
    const id = rid(i + 1);
    const version = replayConstitution(log).currentVersion;
    const texto = conClausula(
      currentText(replayConstitution(log))!,
      ORDINARIAS[paso.clausula]!,
      hex64(0x3000 + i * 16 + paso.clausula),
    );

    log = await openReform(
      log,
      { eventId: ev(log), at: en(base), actor: miembro },
      {
        reformId: id,
        kind: 'ordinaria',
        targetVersion: version,
        proposedText: texto,
        censusSize: CENSO,
        guarantors: GARANTES,
        calendar: { semesterEndsAt: en(3000), convened: [] },
        sponsorCount: 30,
        deliberationOpensAt: en(base),
        deliberationClosesAt: en(base + 21),
      },
    );
    log = await recordReformVote(
      log,
      { eventId: ev(log), at: en(base + 29), actor: facilitadora },
      {
        reformId: id,
        vote: {
          round: 1,
          decisionId: decisionId(hex32(0xd100 + i)),
          votesInFavor: paso.votosAFavor,
          directParticipation: paso.votoDirecto,
          opensAt: en(base + 22),
          closesAt: en(base + 29),
        },
      },
    );
    for (let g = 0; g < paso.firmas; g++) {
      log = await approveReform(
        log,
        { eventId: ev(log), at: en(base + 30), actor: garante(g) },
        { reformId: id },
      );
    }

    const esperada = paso.votosAFavor >= 200 && paso.votoDirecto >= 100 && paso.firmas >= 3;
    try {
      log = await ratifyReform(
        log,
        { eventId: ev(log), at: en(base + 43), actor: facilitadora },
        { reformId: id, effectiveAt: en(base + 43) },
      );
      intentos.push({ reformId: id, ratificada: true, esperada, codigo: undefined });
    } catch (error) {
      intentos.push({ reformId: id, ratificada: false, esperada, codigo: codigoDe(error) });
    }
  }

  return { log, intentos };
}

/**
 * La herramienta del adversario: cambia un evento y **vuelve a encadenar** todo lo que viene
 * detrás. El historial resultante pasa `verifyChain` sin una queja.
 */
async function reencadenar(
  log: ConstitutionLog,
  indice: number,
  payload: ConstitutionPayload,
): Promise<ConstitutionLog> {
  let out: ConstitutionLog = log.slice(0, indice);
  for (let i = indice; i < log.length; i++) {
    const original = log[i]!;
    out = [
      ...out,
      await appendChained<ConstitutionPayload>(out, {
        eventId: original.eventId,
        aggregateId: original.aggregateId,
        occurredAt: original.occurredAt,
        actor: original.actor,
        payload: i === indice ? payload : original.payload,
      }),
    ];
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C1 · el núcleo intangible es idéntico antes y después de cualquier reforma ratificada
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C1 · el núcleo sobrevive a toda reforma ratificada', () => {
  it('los seis puntos son los mismos en TODAS las versiones del historial', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { log } = await construir(plan);
        const estado: ConstitutionState = replayConstitution(log);
        expect(estado.core).toEqual(NUCLEO);
        for (const version of estado.versions) {
          for (const punto of NUCLEO) {
            const enTexto = version.text.clauses.find((c) => c.clauseId === punto.clauseId);
            expect(enTexto).toBeDefined();
            expect(enTexto!.textHash).toBe(punto.textHash);
          }
        }
      }),
      runs(40),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C2 · un log forjado que altere el núcleo es rechazado POR EL PLIEGUE
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C2 · el pliegue rechaza el núcleo alterado, con la cadena intacta', () => {
  it('altere el punto que altere, y en la reforma que sea', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPlan,
        fc.integer({ min: 0, max: CORE_CLAUSE_IDS.length - 1 }),
        fc.integer({ min: 0, max: 999 }),
        async (plan, punto, cual) => {
          const { log } = await construir(plan);
          const aperturas = log
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => e.payload.type === 'ReformOpened');
          const elegida = aperturas[cual % aperturas.length]!;
          const payload = elegida.e.payload;
          if (payload.type !== 'ReformOpened') throw new Error('imposible');

          const forjado = await reencadenar(log, elegida.i, {
            ...payload,
            proposedText: conClausula(
              payload.proposedText,
              CORE_CLAUSE_IDS[punto]!,
              hex64(0xf00 + punto),
            ),
          });

          // La cadena está impecable: es lo que puede fabricar quien tiene la base de datos.
          await expect(verifyChain(forjado)).resolves.toBeUndefined();
          // Y aun así no se pliega.
          expect(() => replayConstitution(forjado)).toThrow(
            expect.objectContaining({ code: 'CORE_CLAUSE_ALTERED' }),
          );
        },
      ),
      runs(25),
    );
  });

  it('quitar un punto del núcleo del texto tampoco se pliega', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPlan,
        fc.integer({ min: 0, max: CORE_CLAUSE_IDS.length - 1 }),
        async (plan, punto) => {
          const { log } = await construir(plan);
          const indice = log.findIndex((e) => e.payload.type === 'ReformOpened');
          const payload = log[indice]!.payload;
          if (payload.type !== 'ReformOpened') throw new Error('imposible');
          const id = CORE_CLAUSE_IDS[punto]!;

          const forjado = await reencadenar(log, indice, {
            ...payload,
            proposedText: {
              ...payload.proposedText,
              clauses: payload.proposedText.clauses.filter((c) => c.clauseId !== id),
            },
          });
          await expect(verifyChain(forjado)).resolves.toBeUndefined();
          expect(() => replayConstitution(forjado)).toThrow(
            expect.objectContaining({ code: 'CORE_CLAUSE_MISSING' }),
          );
        },
      ),
      runs(20),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C3 · toda reforma se juzga contra su copia congelada, nunca contra lo vigente
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C3 · la copia congelada es la que manda', () => {
  it('la copia de cada reforma es la del texto de SU versión objetivo', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { log } = await construir(plan);
        const estado = replayConstitution(log);
        for (const reforma of estado.reforms) {
          const objetivo = constitutionVersionAt(estado, reforma.targetVersion)!;
          expect(reforma.frozen.requirements).toEqual(objetivo.text.ordinary);
        }
      }),
      runs(40),
    );
  });

  it('una reforma que rebaja el umbral no se aplica el suyo: la miden con el viejo', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          fraction(3n, 5n),
          fraction(11n, 20n),
          fraction(7n, 12n),
          fraction(13n, 25n),
        ),
        fc.integer({ min: 180, max: 224 }),
        async (nuevoUmbral, votos) => {
          // Cambiar `ordinary` toca la cláusula de enmienda ⇒ vía atrincherada, 3/4 = 225.
          let log = await fundar();
          log = await openReform(
            log,
            { eventId: ev(log), at: en(1), actor: miembro },
            {
              reformId: rid(9),
              kind: 'atrincherada',
              targetVersion: 1,
              proposedText: {
                ...TEXTO_BASE,
                ordinary: { ...ORDINARY_REFORM_V1, approvalOfCensus: nuevoUmbral },
              },
              censusSize: CENSO,
              guarantors: GARANTES,
              calendar: { semesterEndsAt: en(3000), convened: [] },
              sponsorCount: 60,
              deliberationOpensAt: en(1),
              deliberationClosesAt: en(22),
            },
          );
          const votar = async (
            actual: ConstitutionLog,
            ronda: number,
            dia: number,
            favor: number,
          ): Promise<ConstitutionLog> =>
            recordReformVote(
              actual,
              { eventId: ev(actual), at: en(dia + 7), actor: facilitadora },
              {
                reformId: rid(9),
                vote: {
                  round: ronda,
                  decisionId: decisionId(hex32(0xd200 + ronda)),
                  votesInFavor: favor,
                  directParticipation: 150,
                  opensAt: en(dia),
                  closesAt: en(dia + 7),
                },
              },
            );

          // `votos` está por debajo de 225 y —para los umbrales generados— por encima del NUEVO.
          // Si la reforma se midiera con lo que ella propone, entraría. No entra.
          log = await votar(log, 1, 22, votos);
          log = await votar(log, 2, 220, votos);
          for (const g of [0, 1, 2, 3]) {
            log = await approveReform(
              log,
              { eventId: ev(log), at: en(230), actor: garante(g) },
              { reformId: rid(9) },
            );
          }
          await expect(
            ratifyReform(
              log,
              { eventId: ev(log), at: en(245), actor: facilitadora },
              { reformId: rid(9), effectiveAt: en(245) },
            ),
          ).rejects.toMatchObject({ code: 'THRESHOLD_NOT_MET' });
        },
      ),
      runs(20),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C4 · la doble llave temporal: dos votaciones separadas por un semestre
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C4 · la vía atrincherada exige dos votaciones separadas por un semestre', () => {
  it('cualquier separación menor de seis meses civiles se rechaza', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 30, max: 260 }), async (dias) => {
        let log = await fundar();
        log = await openReform(
          log,
          { eventId: ev(log), at: en(1), actor: miembro },
          {
            reformId: rid(8),
            kind: 'atrincherada',
            targetVersion: 1,
            proposedText: {
              ...TEXTO_BASE,
              ordinary: { ...ORDINARY_REFORM_V1, waitingDays: 10 },
            },
            censusSize: CENSO,
            guarantors: GARANTES,
            calendar: { semesterEndsAt: en(3000), convened: [] },
            sponsorCount: 60,
            deliberationOpensAt: en(1),
            deliberationClosesAt: en(22),
          },
        );
        log = await recordReformVote(
          log,
          { eventId: ev(log), at: en(29), actor: facilitadora },
          {
            reformId: rid(8),
            vote: {
              round: 1,
              decisionId: decisionId(hex32(0xd301)),
              votesInFavor: 225,
              directParticipation: 150,
              opensAt: en(22),
              closesAt: en(29),
            },
          },
        );

        const segunda = recordReformVote(
          log,
          { eventId: ev(log), at: en(29 + dias), actor: facilitadora },
          {
            reformId: rid(8),
            vote: {
              round: 2,
              decisionId: decisionId(hex32(0xd302)),
              votesInFavor: 225,
              directParticipation: 150,
              opensAt: en(29 + dias - 3),
              closesAt: en(29 + dias),
            },
          },
        );

        // Seis meses civiles desde el 2023-12-13 son el 2024-06-13: 183 días.
        if (dias >= 183) await expect(segunda).resolves.toBeDefined();
        else await expect(segunda).rejects.toMatchObject({ code: 'VOTES_TOO_CLOSE' });
      }),
      runs(40),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C5 · ratificar exige el umbral de Garantías y los umbrales de la votación
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C5 · ratificar exige umbral, voto directo y M de N', () => {
  it('se ratifica exactamente cuando se cumplen las tres, y el motivo lo dice', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { intentos } = await construir(plan);
        for (const intento of intentos) {
          expect(intento.ratificada).toBe(intento.esperada);
          if (intento.ratificada) continue;
          expect([
            'THRESHOLD_NOT_MET',
            'DIRECT_PARTICIPATION_NOT_MET',
            'GUARANTEE_THRESHOLD_NOT_MET',
          ]).toContain(intento.codigo);
        }
      }),
      runs(40),
    );
  });

  it('toda reforma ratificada del historial tiene sus firmas y sus votos', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const estado = replayConstitution((await construir(plan)).log);
        for (const reforma of estado.reforms) {
          if (reforma.status !== 'ratificada') continue;
          const req = reforma.frozen.requirements;
          expect(reforma.approvals.length).toBeGreaterThanOrEqual(req.guaranteeThreshold);
          expect(new Set(reforma.approvals).size).toBe(reforma.approvals.length);
          for (const firmante of reforma.approvals) {
            expect(reforma.frozen.guarantors).toContain(firmante);
          }
          expect(reforma.votes).toHaveLength(req.votesRequired);
          for (const voto of reforma.votes) {
            expect(voto.votesInFavor * Number(req.approvalOfCensus.den)).toBeGreaterThanOrEqual(
              Number(req.approvalOfCensus.num) * reforma.frozen.censusSize,
            );
          }
        }
      }),
      runs(40),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C6 · ninguna transición ilegal se acepta
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C6 · la tabla de estados manda', () => {
  it('producto cartesiano Estado × Evento: lo que no está en la tabla lanza', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REFORM_LIFECYCLE),
        fc.constantFrom(...CONSTITUTION_EVENT_TYPES),
        (estado, evento) => {
          const enTabla = REFORM_TRANSITIONS.some((t) => t.from === estado && t.event === evento);
          expect(isLegalReformTransition(estado, evento)).toBe(enTabla);
          let lanzo = false;
          try {
            nextReformStatus(estado, evento);
          } catch {
            lanzo = true;
          }
          expect(lanzo).toBe(!enTabla);
        },
      ),
      runs(1000),
    );
  });

  it('sobre un historial real, ratificar dos veces la misma reforma es imposible', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { log, intentos } = await construir(plan);
        const ratificada = intentos.find((i) => i.ratificada);
        if (ratificada === undefined) return;
        await expect(
          ratifyReform(
            log,
            // El día 250 es posterior a la última ratificación posible del plan (224) y anterior
            // a cualquier caducidad (la más temprana es el día 366): así el rechazo que se mide es
            // el de la tabla de estados y no el de la compuerta de vigencia, que corre antes.
            { eventId: ev(log), at: en(250), actor: facilitadora },
            { reformId: ratificada.reformId, effectiveAt: en(250) },
          ),
        ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
      }),
      runs(25),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C7 · caducada, sólo se acepta la refundación
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C7 · con la constitución caducada sólo entra la refundación', () => {
  it('todo lo demás se rechaza, en cualquier instante posterior al vencimiento', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4000 }), async (despues) => {
        const log = await fundar();
        const estado = replayConstitution(log);
        const vence = estado.versions[0]!.expiresAt;
        const at = instant(vence + despues * DIA);
        expect(statusAt(estado, at)).toBe('caducada');

        await expect(
          openReform(
            log,
            { eventId: ev(log), at, actor: miembro },
            {
              reformId: rid(7),
              kind: 'ordinaria',
              targetVersion: 1,
              proposedText: conClausula(TEXTO_BASE, 'plazos_de_fase', hex64(0x4444)),
              censusSize: CENSO,
              guarantors: GARANTES,
              calendar: { semesterEndsAt: instant(at + 3000 * DIA), convened: [] },
              sponsorCount: 30,
              deliberationOpensAt: at,
              deliberationClosesAt: instant(at + 21 * DIA),
            },
          ),
        ).rejects.toMatchObject({ code: 'CONSTITUTION_EXPIRED' });

        // La refundación entra —y sigue exigiendo la regla fundacional completa—.
        const refundada = await foundConstitution(
          log,
          { eventId: ev(log), at, actor: facilitadora },
          {
            constitutionId: CONSTI,
            text: TEXTO_BASE,
            core: NUCLEO,
            foundingDecisionId: decisionId(hex32(0xd7)),
            censusSize: CENSO,
            castBallots: 150,
            votesInFavor: 100,
            directParticipation: 100,
            effectiveAt: at,
          },
        );
        const nuevo = replayConstitution(refundada);
        expect(nuevo.foundations).toBe(2);
        expect(statusAt(nuevo, at)).toBe('vigente');
        expect(nuevo.core).toEqual(NUCLEO);
      }),
      runs(20),
    );
  });

  it('la caducidad no rebaja NINGÚN umbral: la refundación floja se rechaza igual', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 99 }),
        async (favor, directo) => {
          const log = await fundar();
          const vence = replayConstitution(log).versions[0]!.expiresAt;
          await expect(
            foundConstitution(
              log,
              { eventId: ev(log), at: vence, actor: facilitadora },
              {
                constitutionId: CONSTI,
                text: TEXTO_BASE,
                core: NUCLEO,
                foundingDecisionId: decisionId(hex32(0xd8)),
                censusSize: CENSO,
                castBallots: 150,
                votesInFavor: favor,
                directParticipation: directo,
                effectiveAt: vence,
              },
            ),
          ).rejects.toMatchObject({
            code: favor < 100 ? 'FOUNDING_THRESHOLD_NOT_MET' : 'FOUNDING_PARTICIPATION_NOT_MET',
          });
        },
      ),
      runs(30),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C8 · dos reformas concurrentes sobre la misma versión no se ratifican las dos
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C8 · concurrencia optimista', () => {
  it('abiertas las dos sobre la misma versión, ratifica una sola', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: ORDINARIAS.length - 1 }),
        fc.integer({ min: 0, max: ORDINARIAS.length - 1 }),
        fc.boolean(),
        async (a, b, primeroA) => {
          let log = await fundar();
          const abrir = async (
            actual: ConstitutionLog,
            id: ReformId,
            clausula: number,
            dia: number,
          ): Promise<ConstitutionLog> =>
            openReform(
              actual,
              { eventId: ev(actual), at: en(dia), actor: miembro },
              {
                reformId: id,
                kind: 'ordinaria',
                targetVersion: 1,
                proposedText: conClausula(
                  TEXTO_BASE,
                  ORDINARIAS[clausula]!,
                  hex64(0x5000 + clausula),
                ),
                censusSize: CENSO,
                guarantors: GARANTES,
                calendar: { semesterEndsAt: en(3000), convened: [] },
                sponsorCount: 30,
                deliberationOpensAt: en(dia),
                deliberationClosesAt: en(dia + 21),
              },
            );
          log = await abrir(log, rid(1), a, 1);
          log = await abrir(log, rid(2), b, 2);

          for (const [id, dia] of [
            [rid(1), 22],
            [rid(2), 23],
          ] as const) {
            log = await recordReformVote(
              log,
              { eventId: ev(log), at: en(dia + 7), actor: facilitadora },
              {
                reformId: id,
                vote: {
                  round: 1,
                  decisionId: decisionId(hex32(0xd400 + dia)),
                  votesInFavor: 220,
                  directParticipation: 140,
                  opensAt: en(dia),
                  closesAt: en(dia + 7),
                },
              },
            );
            for (const g of [0, 1, 2]) {
              log = await approveReform(
                log,
                { eventId: ev(log), at: en(dia + 8), actor: garante(g) },
                { reformId: id },
              );
            }
          }

          const primero = primeroA ? rid(1) : rid(2);
          const segundo = primeroA ? rid(2) : rid(1);
          log = await ratifyReform(
            log,
            { eventId: ev(log), at: en(45), actor: facilitadora },
            { reformId: primero, effectiveAt: en(45) },
          );
          await expect(
            ratifyReform(
              log,
              { eventId: ev(log), at: en(46), actor: facilitadora },
              { reformId: segundo, effectiveAt: en(46) },
            ),
          ).rejects.toMatchObject({ code: 'STALE_REFORM_TARGET' });

          const estado = replayConstitution(log);
          expect(estado.currentVersion).toBe(2);
          expect(findReform(estado, primero)!.status).toBe('ratificada');
          expect(findReform(estado, segundo)!.status).toBe('votada');
        },
      ),
      runs(20),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-C9 · todas las versiones históricas siguen siendo recuperables
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-C9 · no se pierde ni una versión', () => {
  it('tras N reformas, las N+1 versiones siguen ahí, densas y en orden', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { log, intentos } = await construir(plan);
        const estado = replayConstitution(log);
        const ratificadas = intentos.filter((i) => i.ratificada).length;
        expect(estado.versions).toHaveLength(ratificadas + 1);
        expect(estado.currentVersion).toBe(ratificadas + 1);

        for (let v = 1; v <= estado.currentVersion; v++) {
          const version = constitutionVersionAt(estado, v);
          expect(version).toBeDefined();
          expect(version!.version).toBe(v);
          expect(version!.text.clauses.length).toBeGreaterThan(0);
        }
        // La versión 1 conserva su texto original, cambien lo que cambien las reformas.
        expect(constitutionVersionAt(estado, 1)!.text).toEqual(TEXTO_BASE);
        // Y cada versión declara de dónde viene: o de una fundación, o de una reforma.
        for (const version of estado.versions) {
          const nace = version.reformId !== undefined || version.foundingDecisionId !== undefined;
          expect(nace).toBe(true);
        }
      }),
      runs(40),
    );
  });

  it('el historial completo verifica cadena y pliegue', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const { log } = await construir(plan);
        await expect(verifyChain(log)).resolves.toBeUndefined();
        expect(() => replayConstitution(log)).not.toThrow();
      }),
      runs(25),
    );
  });
});
