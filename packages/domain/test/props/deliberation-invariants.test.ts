/**
 * Propiedades de la deliberación estructurada.
 *
 * Aquí no se comprueba que el camino feliz funcione: se generan deliberaciones enteras al azar
 * —cuántos aportes, de qué tipo, de quién, en qué instante de la ventana, con avance manual o por
 * plazo— y se exige que **todo** historial resultante cumpla las nueve invariantes del diseño. La
 * semilla es fija (`30_000_821`, como el resto del repo) para que un contraejemplo se pueda volver a
 * mirar mañana.
 *
 * ═══ Propiedades retiradas en ADR-0049, y por qué ═══
 *
 * Siete pruebas, que eran las cuatro invariantes del sellado criptográfico:
 *
 *  - **INV-D5** (1 prueba) «el evento sellado no contiene el `authorId`»: ahora lo contiene a
 *    propósito, y lo que se protege es su lectura, no su presencia. La sustituye la nueva INV-D5.
 *  - **INV-D6** (3 pruebas) «el compromiso ata la autoría»: no hay compromiso. La reautorización en
 *    el replay ocupa su lugar en la nueva INV-D6, y es una garantía que el compromiso **no daba**.
 *  - **INV-D7** (2 pruebas) «se revela exactamente una vez y no antes de tiempo»: no hay revelación.
 *  - **INV-D8** (1 prueba) «no se sale de `perspectivas_revelando` con aportes sin destapar»: no hay
 *    etapa de revelación, y esa invariante era justamente el modo de fallo permanente que ADR-0049
 *    elimina.
 *
 * Las otras seis invariantes —ventanas, tabla de etapas, aristas, aciclicidad, orden de presentación
 * y transiciones— siguen aquí sin recortes, con los números renumerados a la cadena de seis etapas.
 *
 * ═══ INV-D9, añadida después ═══
 *
 * La novena cierra una escalada horizontal que estas ocho no miraban: `supersedes` no comprobaba la
 * autoría del original, así que cualquiera podía sacar de `currentContributions` el aporte de
 * cualquiera. Es adversarial a propósito —intenta el acto y exige el rechazo— porque una invariante
 * que sólo recorre historiales bien formados no habría encontrado nunca este hueco: el generador
 * tampoco lo intentaba.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Actor, can, type ResourceRef } from '../../src/access.js';
import {
  advanceStage,
  assertBodyAllowedInStage,
  authorizeAuthorshipRead,
  CONTRIBUTION_KINDS,
  type ContributionBody,
  type ContributionId,
  contributionId,
  type ContributionKind,
  contributionsOfAuthorInStage,
  currentContributions,
  DELIBERATION_STAGES,
  type DeliberationCommandMeta,
  type DeliberationLog,
  type DeliberationStage,
  type DeliberationState,
  deliberationId,
  isAcyclic,
  nextStage,
  openDeliberation,
  type PositionMode,
  type PresentationSeed,
  presentationSeed,
  presentationOrder,
  readContributionAuthor,
  type ReasonRelation,
  referencesOf,
  replayDeliberation,
  stageAdmits,
  stageRule,
  submitContribution,
  verifyDeliberationLog,
} from '../../src/deliberation/index.js';
import {
  circleId,
  eventId,
  type EventId,
  type Instant,
  instant,
  type MemberId,
  memberId,
} from '../../src/ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escenario
// ═════════════════════════════════════════════════════════════════════════════════════════════

const hex32 = (n: number): string => n.toString(16).padStart(32, '0');

const DELIB = deliberationId(hex32(0xd0));
const CIRCLE = circleId(hex32(0xc1));
const PROBLEM = hex32(0xb1);

const mid = (n: number): MemberId => memberId(hex32(0x1000 + n));
const ev = (n: number): EventId => eventId(hex32(0x6000 + n));
const cid = (n: number): ContributionId => contributionId(hex32(0x7000 + n));
const seedAt = (n: number): PresentationSeed => presentationSeed(hex32(0xa000 + n));

const facilitador: Actor = { memberId: mid(1), roles: ['facilitator'], circles: [CIRCLE] };
const garantias: Actor = { memberId: mid(2), roles: ['guarantees'], circles: [CIRCLE] };
const MIEMBROS: readonly Actor[] = [
  { memberId: mid(10), roles: ['member'], circles: [CIRCLE] },
  { memberId: mid(11), roles: ['member'], circles: [CIRCLE] },
  { memberId: mid(12), roles: ['member'], circles: [CIRCLE] },
  { memberId: mid(13), roles: ['member'], circles: [CIRCLE] },
];

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const opensAtOf = (i: number): Instant => instant(T0 + i * HOUR);
const closesAtOf = (i: number): Instant => instant(T0 + (i + 1) * HOUR);
const indexOfStage = (s: DeliberationStage): number => DELIBERATION_STAGES.indexOf(s);

const TEXT = 'Un aporte generado con longitud más que suficiente para el mínimo del historial.';

/** Número de corridas por propiedad, escalable con `FC_RUNS` como en el resto del repo. */
const RUNS = Number(process.env['FC_RUNS'] ?? '1000');
const FC = { numRuns: RUNS, seed: 30_000_821, verbose: 0 } as const;
const runs = (atDefault: number): { numRuns: number; seed: number } => ({
  seed: FC.seed,
  numRuns: Math.max(5, Math.round((RUNS * atDefault) / 1000)),
});

interface Plan {
  /** Tipos extra pedidos en cada una de las cinco etapas con escritura. */
  readonly extras: readonly (readonly ContributionKind[])[];
  /** Milésimas de la primera mitad de la ventana en que se escribe cada aporte. */
  readonly fracciones: readonly number[];
  /** Índice de la autora de cada aporte. */
  readonly autores: readonly number[];
  /** ¿El avance de cada etapa es manual? Si no, es por plazo vencido. */
  readonly manuales: readonly boolean[];
}

const arbKinds = fc.array(fc.constantFrom(...CONTRIBUTION_KINDS), { maxLength: 4 });

const arbPlan: fc.Arbitrary<Plan> = fc.record({
  extras: fc.tuple(arbKinds, arbKinds, arbKinds, arbKinds, arbKinds),
  fracciones: fc.array(fc.integer({ min: 0, max: 999 }), { minLength: 40, maxLength: 40 }),
  autores: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 40, maxLength: 40 }),
  manuales: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
});

/** Espina dorsal de cada etapa con escritura: garantiza que las aristas siempre tengan destino. */
const ESPINA: Readonly<Record<number, readonly ContributionKind[]>> = {
  0: ['posicion', 'razon', 'evidencia'],
  1: ['posicion', 'razon'],
  2: ['alternativa'],
  3: ['riesgo'],
  4: ['alternativa'],
};

function meta(log: DeliberationLog, at: Instant, actor: Actor): DeliberationCommandMeta {
  return { eventId: ev(log.length + 1), at, actor };
}

/** El recurso tal como lo arma el dominio: la etapa sale del estado plegado, no del llamante. */
function refDe(estado: DeliberationState): ResourceRef {
  return { kind: 'deliberation', stage: estado.stage, circleId: estado.circleId };
}

/** Un aporte ya escrito, con lo que hace falta para poder elegirlo como destino de una arista. */
interface Escrito {
  readonly id: ContributionId;
  readonly autor: Actor;
  /** Sólo en una `posicion`: si preguntó o si afirmó. */
  readonly mode: PositionMode | undefined;
}

/**
 * Qué modo de posición exige una razón con esa relación.
 *
 * **Se le pregunta al dominio** en vez de repetir la tabla acá. Un generador que se sabe las reglas
 * de memoria deja de servir el día en que las reglas cambian: seguiría fabricando historiales que
 * el dominio ya no acepta, y el fallo aparecería como un contraejemplo ilegible en vez de como lo
 * que es.
 */
function modoQueExige(relation: ReasonRelation): PositionMode | undefined {
  const [referencia] = referencesOf(
    { kind: 'razon', relation, positionId: cid(0), text: TEXT },
    undefined,
  );
  return referencia?.expectedMode;
}

/**
 * Construye una deliberación completa siguiendo el plan, hasta la etapa `hasta`.
 *
 * Los tipos pedidos cuyo destino todavía no existe se **omiten**: el generador propone y el dominio
 * dispone. Lo que se prueba no es que el generador sepa las reglas, sino que el historial resultante
 * las cumpla todas.
 */
async function construir(plan: Plan, hasta: DeliberationStage): Promise<DeliberationLog> {
  const objetivo = indexOfStage(hasta);
  const porTipo = new Map<ContributionKind, Escrito[]>();
  let contador = 0;
  let cursor = 0;

  let log = await openDeliberation(
    { eventId: ev(1), at: opensAtOf(0), actor: facilitador },
    {
      deliberationId: DELIB,
      problemId: PROBLEM,
      circleId: CIRCLE,
      opensAt: opensAtOf(0),
      closesAt: closesAtOf(0),
      presentationSeed: seedAt(0),
    },
  );

  const ultimo = (kind: ContributionKind): Escrito | undefined => {
    const lista = porTipo.get(kind);
    return lista === undefined || lista.length === 0 ? undefined : lista[lista.length - 1];
  };
  /** La última posición **de ese modo**. Preguntar y afirmar no son destinos intercambiables. */
  const ultimaPosicion = (mode: PositionMode): Escrito | undefined => {
    const lista = porTipo.get('posicion') ?? [];
    for (let i = lista.length - 1; i >= 0; i--) {
      const escrito = lista[i];
      if (escrito !== undefined && escrito.mode === mode) return escrito;
    }
    return undefined;
  };
  const alguno = (): Escrito | undefined => {
    for (const kind of CONTRIBUTION_KINDS) {
      const escrito = ultimo(kind);
      if (escrito !== undefined) return escrito;
    }
    return undefined;
  };

  const cuerpo = (
    stage: DeliberationStage,
    kind: ContributionKind,
  ): { body: ContributionBody; supersedes?: ContributionId; autorObligado?: Actor } | undefined => {
    const regla = stageRule(stage);
    if (!regla.kinds.includes(kind)) return undefined;
    switch (kind) {
      case 'posicion': {
        const mode = regla.positionModes[0];
        if (mode === undefined) return undefined;
        return { body: { kind: 'posicion', mode, text: TEXT } };
      }
      case 'razon': {
        const relation = regla.reasonRelations[0];
        if (relation === undefined) return undefined;
        const modo = modoQueExige(relation);
        const destino = modo === undefined ? ultimo('posicion') : ultimaPosicion(modo);
        if (destino === undefined) return undefined;
        return { body: { kind: 'razon', relation, positionId: destino.id, text: TEXT } };
      }
      case 'evidencia': {
        const destino = ultimo('razon');
        if (destino === undefined) return undefined;
        return { body: { kind: 'evidencia', supportsReasonId: destino.id, text: TEXT } };
      }
      case 'supuesto': {
        const destino = alguno();
        if (destino === undefined) return undefined;
        return {
          body: { kind: 'supuesto', appliesToContributionIds: [destino.id], text: TEXT },
        };
      }
      case 'riesgo': {
        const destino = ultimo('alternativa');
        if (destino === undefined) return undefined;
        return {
          body: {
            kind: 'riesgo',
            alternativeId: destino.id,
            severity: 3,
            impact: TEXT,
            mitigation: TEXT,
          },
        };
      }
      case 'alternativa': {
        const origen = ultimo('posicion');
        if (origen === undefined) return undefined;
        const body: ContributionBody = {
          kind: 'alternativa',
          problemId: PROBLEM,
          sourcePositionIds: [origen.id],
          text: TEXT,
        };
        if (!regla.alternativeMustSupersede) return { body };
        const previa = ultimo('alternativa');
        if (previa === undefined) return undefined;
        // La enmienda la escribe quien escribió la salida que enmienda. No es una comodidad del
        // generador: corregir el aporte de otra persona dejó de ser un acto que exista.
        return { body, supersedes: previa.id, autorObligado: previa.autor };
      }
    }
  };

  const escribir = async (stage: DeliberationStage, kind: ContributionKind): Promise<void> => {
    const armado = cuerpo(stage, kind);
    if (armado === undefined) return;
    const i = indexOfStage(stage);
    const frac = plan.fracciones[cursor % plan.fracciones.length] ?? 0;
    const propuesto = MIEMBROS[(plan.autores[cursor % plan.autores.length] ?? 0) % MIEMBROS.length];
    cursor += 1;
    const autor = armado.autorObligado ?? propuesto;
    if (autor === undefined) return;
    contador += 1;
    const id = cid(contador);
    const at = instant(T0 + i * HOUR + Math.floor((frac * (HOUR / 2)) / 1000));
    log = await submitContribution(log, meta(log, at, autor), {
      contributionId: id,
      body: armado.body,
      ...(armado.supersedes === undefined ? {} : { supersedesContributionId: armado.supersedes }),
    });
    const escrito: Escrito = {
      id,
      autor,
      mode: armado.body.kind === 'posicion' ? armado.body.mode : undefined,
    };
    const lista = porTipo.get(kind);
    if (lista === undefined) porTipo.set(kind, [escrito]);
    else lista.push(escrito);
  };

  for (let i = 0; i <= 5; i++) {
    const stage = DELIBERATION_STAGES[i];
    if (stage === undefined) break;

    const espina = ESPINA[i] ?? [];
    const extras = plan.extras[i] ?? [];
    for (const kind of [...espina, ...extras]) await escribir(stage, kind);

    if (i >= objetivo) break;

    const siguiente = DELIBERATION_STAGES[i + 1];
    if (siguiente === undefined) break;
    const manual = plan.manuales[i] ?? false;
    const at = manual ? instant(T0 + i * HOUR + 2_700_000) : closesAtOf(i);
    log = await advanceStage(log, meta(log, at, facilitador), {
      to: siguiente,
      cause: manual ? 'manual' : 'deadline',
      opensAt: opensAtOf(i + 1),
      closesAt: closesAtOf(i + 1),
      presentationSeed: seedAt(i + 1),
    });
  }

  return log;
}

/** Cuerpo mínimo de cada tipo, con aristas cualesquiera: para probar la TABLA, no el estado. */
function cuerpoLibre(
  kind: ContributionKind,
  mode: 'pregunta_aclaratoria' | 'afirmacion',
): ContributionBody {
  switch (kind) {
    case 'posicion':
      return { kind: 'posicion', mode, text: TEXT };
    case 'razon':
      return {
        kind: 'razon',
        relation: mode === 'pregunta_aclaratoria' ? 'responde' : 'sostiene',
        positionId: cid(1),
        text: TEXT,
      };
    case 'evidencia':
      return { kind: 'evidencia', supportsReasonId: cid(2), text: TEXT };
    case 'supuesto':
      return { kind: 'supuesto', appliesToContributionIds: [cid(1)], text: TEXT };
    case 'riesgo':
      return { kind: 'riesgo', alternativeId: cid(3), severity: 3, impact: TEXT, mitigation: TEXT };
    case 'alternativa':
      return {
        kind: 'alternativa',
        problemId: PROBLEM,
        sourcePositionIds: [cid(1)],
        text: TEXT,
      };
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las nueve propiedades
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-D1 · ninguna escritura en la etapa que no admite escritura', () => {
  it('ningún `ContributionSubmitted` en `listo_para_decidir`', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const log = await construir(plan, 'listo_para_decidir');
        for (const evento of log) {
          if (evento.payload.type !== 'ContributionSubmitted') continue;
          expect(evento.payload.stage).not.toBe('listo_para_decidir');
        }
        const estado = replayDeliberation(log);
        expect(estado.stage).toBe('listo_para_decidir');
        for (const aporte of estado.contributions) {
          expect(aporte.stage).not.toBe('listo_para_decidir');
        }
      }),
      runs(50),
    );
  });
});

describe('INV-D2 · cada `body.kind` pertenece a la tabla de su etapa', () => {
  it('producto cartesiano Etapa × Tipo × modo × ¿supersede?: la tabla manda', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DELIBERATION_STAGES),
        fc.constantFrom(...CONTRIBUTION_KINDS),
        fc.constantFrom('pregunta_aclaratoria' as const, 'afirmacion' as const),
        fc.boolean(),
        (stage, kind, mode, supersede) => {
          const regla = stageRule(stage);
          const body = cuerpoLibre(kind, mode);
          const supersedes = supersede ? cid(9) : undefined;

          const admitido =
            regla.kinds.includes(kind) &&
            (kind !== 'posicion' || regla.positionModes.includes(mode)) &&
            (kind !== 'razon' ||
              regla.reasonRelations.includes(
                mode === 'pregunta_aclaratoria' ? 'responde' : 'sostiene',
              )) &&
            (kind !== 'alternativa' || !regla.alternativeMustSupersede || supersedes !== undefined);

          let lanzo = false;
          try {
            assertBodyAllowedInStage(stage, body, supersedes);
          } catch {
            lanzo = true;
          }
          expect(lanzo).toBe(!admitido);
        },
      ),
      runs(1000),
    );
  });

  it('todo aporte de un historial generado está tabulado en su etapa', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const estado = replayDeliberation(await construir(plan, 'listo_para_decidir'));
        for (const aporte of estado.contributions) {
          expect(stageAdmits(aporte.stage, aporte.body.kind)).toBe(true);
        }
      }),
      runs(50),
    );
  });
});

describe('INV-D3 · `submittedAt ∈ [opensAt, closesAt)`', () => {
  it('ningún aporte cae fuera de la ventana de su etapa', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const log = await construir(plan, 'listo_para_decidir');
        let opensAt = 0;
        let closesAt = 0;
        for (const evento of log) {
          const p = evento.payload;
          if (p.type === 'DeliberationOpened' || p.type === 'StageAdvanced') {
            opensAt = p.opensAt;
            closesAt = p.closesAt;
            continue;
          }
          expect(evento.occurredAt).toBeGreaterThanOrEqual(opensAt);
          expect(evento.occurredAt).toBeLessThan(closesAt);
        }
      }),
      runs(50),
    );
  });

  it('un aporte en `closesAt` exacto nunca entra', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const log = await construir(plan, 'preguntas_aclaratorias');
        await expect(
          submitContribution(log, meta(log, closesAtOf(0), MIEMBROS[0]!), {
            contributionId: cid(999),
            body: { kind: 'posicion', mode: 'pregunta_aclaratoria', text: TEXT },
          }),
        ).rejects.toMatchObject({ code: 'WRITE_WINDOW_CLOSED' });
      }),
      runs(25),
    );
  });
});

describe('INV-D4 · toda referencia apunta hacia atrás y el grafo es acíclico', () => {
  it('cada arista apunta a un `seq` estrictamente menor', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const estado = replayDeliberation(await construir(plan, 'listo_para_decidir'));
        const seqPorId = new Map(estado.contributions.map((c) => [c.contributionId, c.seq]));
        for (const aporte of estado.contributions) {
          for (const ref of referencesOf(aporte.body, aporte.supersedesContributionId)) {
            const destino = seqPorId.get(ref.targetId);
            expect(destino).toBeDefined();
            expect(destino!).toBeLessThan(aporte.seq);
          }
        }
      }),
      runs(50),
    );
  });

  it('el grafo resultante es acíclico', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const estado = replayDeliberation(await construir(plan, 'listo_para_decidir'));
        expect(isAcyclic(estado)).toBe(true);
      }),
      runs(50),
    );
  });

  it('y el historial verifica cadena y plegado', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const log = await construir(plan, 'listo_para_decidir');
        await expect(verifyDeliberationLog(log)).resolves.toBeDefined();
      }),
      runs(25),
    );
  });
});

describe('INV-D5 · la autoría no se lee mientras `perspectivas` sea la etapa vigente', () => {
  it('con la etapa abierta se deniega a TODO actor, y cerrada se concede a los mismos', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, fc.integer({ min: 0, max: 3 }), async (plan, quien) => {
        const abierta = replayDeliberation(await construir(plan, 'perspectivas'));
        expect(abierta.stage).toBe('perspectivas');
        expect(abierta.contributions.some((c) => c.stage === 'perspectivas')).toBe(true);

        // Miembro cualquiera, quien facilita y garantías: la denegación es la misma para los tres.
        const actores: readonly Actor[] = [MIEMBROS[quien]!, facilitador, garantias];
        for (const actor of actores) {
          expect(can(actor, 'deliberation:read-authorship', refDe(abierta))).toBe(false);
          expect(() => {
            authorizeAuthorshipRead(abierta, actor);
          }).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }));
          for (const aporte of abierta.contributions) {
            expect(() => readContributionAuthor(abierta, actor, aporte.contributionId)).toThrow(
              expect.objectContaining({ code: 'UNAUTHORIZED_STAGE_STILL_OPEN' }),
            );
          }
        }

        const cerrada = replayDeliberation(await construir(plan, 'construccion_alternativas'));
        for (const actor of actores) {
          expect(() => {
            authorizeAuthorshipRead(cerrada, actor);
          }).not.toThrow();
          for (const aporte of cerrada.contributions) {
            expect(readContributionAuthor(cerrada, actor, aporte.contributionId)).toBe(
              aporte.authorId,
            );
          }
        }
      }),
      runs(25),
    );
  });

  it('en las demás etapas la autoría se lee, y en ninguna la concede la facilitación por su rol', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, fc.constantFrom(...DELIBERATION_STAGES), async (plan, parada) => {
        const estado = replayDeliberation(await construir(plan, parada));
        const permitido = estado.stage !== 'perspectivas';
        for (const actor of [MIEMBROS[0]!, facilitador, garantias]) {
          expect(can(actor, 'deliberation:read-authorship', refDe(estado))).toBe(permitido);
        }
      }),
      runs(25),
    );
  });
});

describe('INV-D6 · el autor del aporte es el actor del sobre, y nadie supera su tope', () => {
  it('cada `ContributionSubmitted` nombra a quien lo firmó', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const log = await construir(plan, 'listo_para_decidir');
        let aportes = 0;
        for (const evento of log) {
          if (evento.payload.type !== 'ContributionSubmitted') continue;
          aportes += 1;
          expect(evento.payload.authorId).toBe(evento.actor);
        }
        expect(aportes).toBeGreaterThan(0);
      }),
      runs(50),
    );
  });

  it('ninguna persona escribe más de `maxContributionsPerAuthorPerStage` en una etapa', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const estado: DeliberationState = replayDeliberation(
          await construir(plan, 'listo_para_decidir'),
        );
        const limite = estado.maxContributionsPerAuthorPerStage;
        expect(limite).toBeDefined();
        for (const stage of DELIBERATION_STAGES) {
          for (const actor of MIEMBROS) {
            if (actor.memberId === undefined) continue;
            expect(
              contributionsOfAuthorInStage(estado, actor.memberId, stage).length,
            ).toBeLessThanOrEqual(limite!);
          }
        }
      }),
      runs(50),
    );
  });
});

describe('INV-D7 · el orden de presentación es una permutación determinista', () => {
  it('mismos `(presentationSeed, viewerId)` ⇒ mismo orden; distinta lectora ⇒ mismo conjunto', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 60 }), { minLength: 2, maxLength: 12 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 9 }),
        async (indices, lectora1, lectora2, semilla) => {
          const ids = indices.map((i) => cid(i));
          const entrada = {
            deliberationId: DELIB,
            presentationSeed: seedAt(semilla),
            viewerId: mid(100 + lectora1),
            contributionIds: ids,
          };
          const a = await presentationOrder(entrada);
          const b = await presentationOrder({ ...entrada, contributionIds: [...ids].reverse() });
          expect(b).toEqual(a);

          const otra = await presentationOrder({ ...entrada, viewerId: mid(100 + lectora2) });
          expect([...otra].sort()).toEqual([...a].sort());
          expect(new Set(otra).size).toBe(ids.length);
          expect(otra).toHaveLength(ids.length);
        },
      ),
      runs(200),
    );
  });

  it('sobre un historial real el orden no pierde ni inventa aportes', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, fc.integer({ min: 0, max: 40 }), async (plan, lectora) => {
        const estado: DeliberationState = replayDeliberation(await construir(plan, 'objeciones'));
        const ids = estado.contributions.map((c) => c.contributionId);
        const orden = await presentationOrder({
          deliberationId: DELIB,
          presentationSeed: estado.presentationSeed!,
          viewerId: mid(200 + lectora),
          contributionIds: ids,
        });
        expect([...orden].sort()).toEqual([...ids].sort());
      }),
      runs(25),
    );
  });
});

describe('INV-D9 · la arista exige el modo del destino y la corrección exige su autoría', () => {
  it('toda razón de un historial generado apunta al modo que su relación exige', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const estado = replayDeliberation(await construir(plan, 'listo_para_decidir'));
        const porId = new Map(estado.contributions.map((c) => [c.contributionId, c]));
        for (const aporte of estado.contributions) {
          for (const ref of referencesOf(aporte.body, aporte.supersedesContributionId)) {
            if (ref.expectedMode === undefined) continue;
            const destino = porId.get(ref.targetId);
            expect(destino).toBeDefined();
            expect(destino!.body.kind).toBe('posicion');
            expect(destino!.body.kind === 'posicion' ? destino!.body.mode : undefined).toBe(
              ref.expectedMode,
            );
          }
        }
      }),
      runs(50),
    );
  });

  it('toda corrección de un historial generado es de quien escribió el original', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, async (plan) => {
        const estado = replayDeliberation(await construir(plan, 'listo_para_decidir'));
        const porId = new Map(estado.contributions.map((c) => [c.contributionId, c]));
        for (const aporte of estado.contributions) {
          if (aporte.supersedesContributionId === undefined) continue;
          const original = porId.get(aporte.supersedesContributionId);
          expect(original).toBeDefined();
          expect(original!.authorId).toBe(aporte.authorId);
        }
      }),
      runs(50),
    );
  });

  it('NADIE puede retirar de lo vigente el aporte de otra persona', async () => {
    // La propiedad adversarial, y la razón de ser de las otras dos. Se toma un historial cualquiera
    // y se intenta, con cada miembro, superseder cada posición ajena: es el acto que sacaría el
    // aporte de `currentContributions` sin borrar nada del historial. Ninguno entra, y el conjunto
    // de aportes vigentes es idéntico antes y después de los intentos.
    await fc.assert(
      fc.asyncProperty(arbPlan, fc.integer({ min: 0, max: 3 }), async (plan, quien) => {
        const log = await construir(plan, 'construccion_alternativas');
        const estado = replayDeliberation(log);
        const atacante = MIEMBROS[quien]!;
        const antes = currentContributions(estado).map((c) => c.contributionId);

        let intentos = 0;
        for (const victima of estado.contributions) {
          if (victima.body.kind !== 'posicion') continue;
          if (victima.authorId === atacante.memberId) continue;
          intentos += 1;
          await expect(
            submitContribution(log, meta(log, opensAtOf(2), atacante), {
              contributionId: cid(900 + intentos),
              body: { kind: 'posicion', mode: victima.body.mode, text: TEXT },
              supersedesContributionId: victima.contributionId,
            }),
          ).rejects.toMatchObject({ code: 'SUPERSEDES_ANOTHER_AUTHOR' });
        }

        expect(currentContributions(replayDeliberation(log)).map((c) => c.contributionId)).toEqual(
          antes,
        );
      }),
      runs(25),
    );
  });
});

describe('INV-D8 · ninguna transición ilegal de etapa es aceptada', () => {
  it('sobre un historial real, sólo el sucesor exacto avanza', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPlan,
        fc.constantFrom(...DELIBERATION_STAGES),
        fc.constantFrom(...DELIBERATION_STAGES),
        async (plan, parada, destino) => {
          const log = await construir(plan, parada);
          const estado = replayDeliberation(log);
          const i = indexOfStage(estado.stage);
          const orden = advanceStage(log, meta(log, closesAtOf(i), facilitador), {
            to: destino,
            cause: 'deadline',
            opensAt: opensAtOf(i + 1),
            closesAt: closesAtOf(i + 1),
            presentationSeed: seedAt(i + 1),
          });
          if (nextStage(estado.stage) === destino) {
            await expect(orden).resolves.toBeDefined();
          } else {
            await expect(orden).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
          }
        },
      ),
      runs(50),
    );
  });
});
