/**
 * La proyección hacia el cliente, que es **la única barrera** entre el estado plegado y la fuga.
 *
 * ADR-0049 dejó esto como deuda explícita: el `authorId` viaja dentro del evento y por tanto vive en
 * `DeliberationState`, en memoria, en todas las etapas. Quien tenga el estado tiene la autoría. El
 * dominio no puede cerrarlo —lo necesita para reautorizar en el replay— y por eso la responsabilidad
 * baja aquí: **el presentador quita el autor mientras la etapa lo oculte**, y lo hace pasando por
 * `readContributionAuthor`, que es la única puerta de lectura que existe.
 *
 * La prueba central es la última de la primera sección: serializar el estado crudo filtra la etapa
 * entera, y serializar el DTO no filtra nada. Si alguien cambia el presentador por un `...registro`,
 * esa prueba se pone roja.
 */

import {
  type Actor,
  advanceStage,
  circleId,
  type ContributionBody,
  contributionId,
  type DeliberationLog,
  deliberationId,
  eventId,
  instant,
  type Instant,
  memberId,
  openDeliberation,
  presentationSeed,
  replayDeliberation,
  submitContribution,
} from '@koinonia/domain';
import { beforeAll, describe, expect, it } from 'vitest';

import { deliberacionDetalleDto, deliberacionResumenDto } from '../src/http/presenters.js';

const CIRCULO = circleId('e5bac105b1e00000000000000000000b');
const DELIBERACION = deliberationId('1'.repeat(32));
const PROBLEMA = '6'.repeat(32);

// Los identificadores NO van en orden alfabético a propósito: es lo que hace observable que a
// quien mira sin cuenta se le sirve una permutación y no la secuencia en que se escribió.
const ID_PREGUNTA = 'f1'.repeat(16);
const ID_POSTURA = 'd2'.repeat(16);
const ID_RAZON = 'e3'.repeat(16);

const T0 = instant(Date.UTC(2026, 7, 21, 14, 0, 0));
const HORA = 3_600_000;

const LUCIA: Actor = {
  memberId: memberId('a'.repeat(32)),
  roles: ['member', 'facilitator'],
  circles: [CIRCULO],
};
const SARA: Actor = { memberId: memberId('b'.repeat(32)), roles: ['member'], circles: [CIRCULO] };
const JULIAN: Actor = { memberId: memberId('c'.repeat(32)), roles: ['member'], circles: [CIRCULO] };
const GARANTIAS: Actor = {
  memberId: memberId('d'.repeat(32)),
  roles: ['member', 'guarantees'],
  circles: [CIRCULO],
};
const ANONIMA: Actor = { memberId: undefined, roles: ['observer'], circles: [] };

let contador = 0;
function meta(
  actor: Actor,
  at: Instant,
): {
  readonly eventId: ReturnType<typeof eventId>;
  readonly at: Instant;
  readonly actor: Actor;
} {
  contador += 1;
  return { eventId: eventId(contador.toString(16).padStart(32, '0')), at, actor };
}

const PREGUNTA: ContributionBody = {
  kind: 'posicion',
  mode: 'pregunta_aclaratoria',
  text: '¿La sala cierra a las seis todos los días o sólo los viernes?',
};

async function historia(): Promise<DeliberationLog> {
  let log = await openDeliberation(meta(LUCIA, T0), {
    deliberationId: DELIBERACION,
    problemId: PROBLEMA,
    circleId: CIRCULO,
    opensAt: T0,
    closesAt: instant(T0 + HORA),
    presentationSeed: presentationSeed('8'.repeat(32)),
  });

  log = await submitContribution(log, meta(SARA, T0), {
    contributionId: contributionId(ID_PREGUNTA),
    body: PREGUNTA,
  });

  log = await advanceStage(log, meta(LUCIA, instant(T0 + 10)), {
    to: 'perspectivas',
    cause: 'manual',
    opensAt: instant(T0 + 10),
    closesAt: instant(T0 + HORA),
    presentationSeed: presentationSeed('9'.repeat(32)),
  });

  log = await submitContribution(log, meta(SARA, instant(T0 + 20)), {
    contributionId: contributionId(ID_POSTURA),
    body: {
      kind: 'posicion',
      mode: 'afirmacion',
      text: 'La sala tendría que abrir hasta las nueve al menos tres días por semana.',
    },
  });

  log = await submitContribution(log, meta(JULIAN, instant(T0 + 30)), {
    contributionId: contributionId(ID_RAZON),
    body: {
      kind: 'razon',
      relation: 'sostiene',
      positionId: contributionId(ID_POSTURA),
      text: 'La jornada nocturna entra a las seis y no tiene dónde leer antes de clase.',
    },
  });

  return log;
}

let log: DeliberationLog;

beforeAll(async () => {
  log = await historia();
});

describe('presentador: la autoría no sale mientras la etapa la oculte', () => {
  it.each([
    ['un miembro cualquiera', () => JULIAN],
    ['quien cuida el procedimiento', () => LUCIA],
    ['el Círculo de Garantías', () => GARANTIAS],
    ['quien lo escribió', () => SARA],
    ['quien mira sin cuenta', () => ANONIMA],
  ])('ni a %s: la regla es de etapa, no de jerarquía', async (_quien, actor) => {
    const state = replayDeliberation(log);
    const dto = await deliberacionDetalleDto('id', state, actor(), 'La sala cierra a las seis');
    expect(dto.autoriaVisible).toBe(false);
    for (const aporte of dto.aportes) {
      expect(aporte.autorId).toBeUndefined();
      expect(aporte.esMio).toBeUndefined();
      // Y tampoco el instante: al milisegundo, un aporte sin nombre se atribuye con cualquier
      // señal de fuera («acabo de escribir», la hora en que alguien se conectó).
      expect(aporte.cuando).toBeUndefined();
    }
  });

  it('a quien mira sin cuenta no se le sirve el orden de escritura', async () => {
    // Sin sesión no hay semilla propia con la que barajar. Devolver el orden del historial le daría
    // la secuencia exacta en que participó cada persona —y le daría MÁS que a quien sí entró—.
    const state = replayDeliberation(log);
    const dto = await deliberacionDetalleDto('id', state, ANONIMA, 'x');
    const porEscritura = state.contributions.map((c) => c.contributionId);
    const porIdentificador = [...porEscritura].sort();
    expect(dto.aportes.map((a) => a.id)).toEqual(porIdentificador);
    expect(porIdentificador).not.toEqual(porEscritura);
  });

  it('tampoco sale la autoría de lo escrito en la etapa ANTERIOR', async () => {
    // La regla mira la etapa **vigente** de la deliberación, no la etapa en que se escribió cada
    // aporte. Mientras Perspectivas siga abierta, la pregunta de la etapa anterior tampoco tiene
    // autor visible: si lo tuviera, bastaría con preguntar y afirmar seguido para quedar señalada.
    const state = replayDeliberation(log);
    const dto = await deliberacionDetalleDto('id', state, LUCIA, 'La sala cierra a las seis');
    const pregunta = dto.aportes.find((a) => a.comoSeLlama === 'Pregunta');
    expect(pregunta).toBeDefined();
    expect(pregunta?.autorId).toBeUndefined();
  });

  it('EL ESTADO CRUDO SÍ FILTRA, y el DTO no: por eso el presentador existe', async () => {
    const state = replayDeliberation(log);

    // Lo que pasaría si una ruta devolviera el estado plegado tal cual. No es una hipótesis: es un
    // `JSON.stringify` de una línea, y filtra la etapa entera de golpe.
    const crudo = JSON.stringify(state.contributions);
    expect(crudo).toContain(SARA.memberId);
    expect(crudo).toContain(JULIAN.memberId);

    const dto = JSON.stringify(
      await deliberacionDetalleDto('id', state, LUCIA, 'La sala cierra a las seis'),
    );
    expect(dto).not.toContain(SARA.memberId);
    expect(dto).not.toContain(JULIAN.memberId);
    expect(dto).not.toContain('authorId');
    expect(dto).not.toContain('autorId');
  });

  it('el resumen dice que la autoría está oculta, y el detalle lo explica en palabras', async () => {
    const state = replayDeliberation(log);
    expect(deliberacionResumenDto('id', state, 'x').autoriaVisible).toBe(false);
    const dto = await deliberacionDetalleDto('id', state, SARA, 'x');
    expect(dto.avisoDeAutoria).toContain('administra el servidor');
  });
});

describe('presentador: al cerrar la etapa aparece la autoría, para todo el mundo a la vez', () => {
  let cerrada: DeliberationLog;

  beforeAll(async () => {
    cerrada = await advanceStage(log, meta(LUCIA, instant(T0 + 40)), {
      to: 'construccion_alternativas',
      cause: 'manual',
      opensAt: instant(T0 + 40),
      closesAt: instant(T0 + 2 * HORA),
      presentationSeed: presentationSeed('7'.repeat(32)),
    });
  });

  it('cada aporte sale con quien lo escribió, incluido el de la etapa anterior', async () => {
    const state = replayDeliberation(cerrada);
    const dto = await deliberacionDetalleDto('id', state, JULIAN, 'x');
    expect(dto.autoriaVisible).toBe(true);
    expect(dto.aportes.every((a) => a.autorId !== undefined)).toBe(true);
    const pregunta = dto.aportes.find((a) => a.comoSeLlama === 'Pregunta');
    expect(pregunta?.autorId).toBe(SARA.memberId);
  });

  it('«es mío» lo decide el servidor comparando con el autor real, y sólo cuando ya se puede', async () => {
    const state = replayDeliberation(cerrada);
    const paraJulian = await deliberacionDetalleDto('id', state, JULIAN, 'x');
    const suyo = paraJulian.aportes.filter((a) => a.esMio === true);
    expect(suyo).toHaveLength(1);
    expect(suyo[0]?.comoSeLlama).toBe('Razón');

    const paraSara = await deliberacionDetalleDto('id', state, SARA, 'x');
    expect(paraSara.aportes.filter((a) => a.esMio === true)).toHaveLength(2);
  });

  it('quien mira sin cuenta lee el contenido pero NO los nombres, y la pantalla lo dice', async () => {
    // HALLAZGO. `deliberation:read-authorship` es CIRCLE_MEMBER: cerrar la etapa no la vuelve
    // pública, la vuelve legible **para el grupo que lleva el asunto**. Sin este tercer aviso la
    // pantalla diría «ya se ve quién escribió cada cosa» y no mostraría ni un nombre.
    const state = replayDeliberation(cerrada);
    const dto = await deliberacionDetalleDto('id', state, ANONIMA, 'x');
    expect(dto.autoriaVisible).toBe(true);
    expect(dto.aportes.every((a) => a.autorId === undefined)).toBe(true);
    expect(dto.avisoDeAutoria).toContain('los nombres los ve el grupo');
    expect(JSON.stringify(dto)).not.toContain(SARA.memberId);
  });

  it('tampoco los ve quien es miembro de OTRO grupo', async () => {
    const deOtroCirculo: Actor = {
      memberId: memberId('e'.repeat(32)),
      roles: ['member'],
      circles: [circleId('acade31c0000000000000000000000c1')],
    };
    const state = replayDeliberation(cerrada);
    const dto = await deliberacionDetalleDto('id', state, deOtroCirculo, 'x');
    expect(dto.aportes.every((a) => a.autorId === undefined)).toBe(true);
    expect(dto.puedoAportar).toBe(false);
    expect(dto.motivoNoPuedoAportar).toContain('otro grupo');
  });
});

describe('presentador: el grafo se enseña, pero dicho en palabras', () => {
  it('cada arista sale con su relación en castellano y sin nombrar la tabla interna', async () => {
    const state = replayDeliberation(log);
    const dto = await deliberacionDetalleDto('id', state, SARA, 'x');
    const razon = dto.aportes.find((a) => a.comoSeLlama === 'Razón');
    expect(razon?.responde).toEqual([{ aporteId: ID_POSTURA, comoSeRelaciona: 'Sostiene' }]);
  });

  it('el orden es una permutación: nadie ve más ni menos aportes que nadie', async () => {
    const state = replayDeliberation(log);
    const paraSara = await deliberacionDetalleDto('id', state, SARA, 'x');
    const paraJulian = await deliberacionDetalleDto('id', state, JULIAN, 'x');
    expect(paraSara.aportes.map((a) => a.id).sort()).toEqual(
      paraJulian.aportes.map((a) => a.id).sort(),
    );
    expect(paraSara.aportes).toHaveLength(3);
  });

  it('dice qué se puede escribir ahora sin enseñar la tabla de etapas', async () => {
    const state = replayDeliberation(log);
    const dto = await deliberacionDetalleDto('id', state, SARA, 'x');
    expect(dto.queSePuedeEscribirAhora).toContain('postura');
    expect(dto.queSePuedeEscribirAhora).not.toContain('perspectivas');
    expect(dto.tiposQueSeAdmitenAhora).toEqual(['posicion', 'razon', 'evidencia', 'supuesto']);
  });

  it('sólo quien cuida el procedimiento ve el control de avanzar de etapa', async () => {
    const state = replayDeliberation(log);
    expect((await deliberacionDetalleDto('id', state, LUCIA, 'x')).puedoAvanzarEtapa).toBe(true);
    expect((await deliberacionDetalleDto('id', state, GARANTIAS, 'x')).puedoAvanzarEtapa).toBe(
      true,
    );
    expect((await deliberacionDetalleDto('id', state, JULIAN, 'x')).puedoAvanzarEtapa).toBe(false);
    expect((await deliberacionDetalleDto('id', state, ANONIMA, 'x')).puedoAvanzarEtapa).toBe(false);
  });

  it('quien mira sin cuenta no puede aportar, y se le dice por qué', async () => {
    const state = replayDeliberation(log);
    const dto = await deliberacionDetalleDto('id', state, ANONIMA, 'x');
    expect(dto.puedoAportar).toBe(false);
    expect(dto.motivoNoPuedoAportar).toContain('correo institucional');
  });
});
