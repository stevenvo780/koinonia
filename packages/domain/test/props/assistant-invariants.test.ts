/**
 * Invariantes del asistente de acción sistémica.
 *
 * No se comprueba que el camino feliz funcione —eso está en `assistant.test.ts`—: se generan
 * borradores enteros al azar, con actos de persona y ofertas de máquina entremezclados en cualquier
 * orden, y se exige que **todo** historial resultante cumpla las nueve invariantes. La semilla es
 * fija (`30_000_821`, como el resto del repo) para que un contraejemplo se pueda volver a mirar
 * mañana.
 *
 * Las nueve, y de dónde sale cada una:
 *
 *  - **INV-A1** — un borrador sólo se cierra si están respondidas la 1 y la 11.
 *  - **INV-A2** — la frase de cierre es determinista y función pura de las respuestas: el orden en
 *    que se respondió no la cambia, y llamarla dos veces da lo mismo.
 *  - **INV-A3** — ninguna cantidad de sugerencias recibidas cambia por sí sola una respuesta: toda
 *    versión del historial procede de un evento cuyo actor es una persona.
 *  - **INV-A4** — aceptar una sugerencia que nunca se recibió se rechaza.
 *  - **INV-A5** — una respuesta escrita a mano prevalece sobre una sugerencia aceptada antes.
 *  - **INV-A6** — sin consentimiento no se invoca el puerto, y no entra ninguna sugerencia.
 *  - **INV-A7** — con el puerto nulo el agregado se comporta exactamente igual, salvo por la
 *    ausencia de sugerencias.
 *  - **INV-A8** — toda oferta de la máquina lleva `actor: 'system'`, y ningún acto de persona lo
 *    lleva. Es la que impide contar los rechazos de nadie (ADR-0040).
 *  - **INV-A9** — la tasa de aceptación es colectiva, exacta y no admite una identidad ni por error.
 *
 * ═══ Por qué el generador produce actos y no historiales ═══
 *
 * Un generador de historiales bien formados nunca intenta lo que no debe, y por tanto nunca encuentra
 * el hueco por el que se cuela lo que no debe. Aquí se generan **intenciones** —«responder la 14»,
 * «aplicar la tercera sugerencia», «cerrar»— y se ejecutan contra el agregado sin filtrarlas: las que
 * el dominio rechaza se cuentan como rechazos y las invariantes se comprueban sobre lo que quedó. Así
 * el generador sí intenta cerrar sin la 11, aplicar sugerencias inexistentes y escribir en la 7 sin
 * causas.
 *
 * ═══ Cobertura medida del generador ═══
 *
 * Sobre 400 guiones con la semilla fija: **47 borradores llegan a cerrarse**, 296 intentos de cierre
 * se rechazan por falta de una obligatoria, entran 250 ofertas de máquina y 76 se aplican. Se deja
 * escrito porque la primera versión de este generador daba **0 borradores cerrados** —27 preguntas
 * equiprobables y guiones cortos— y las invariantes del cierre pasaban sin haber visto nunca el caso
 * que dicen proteger. De ahí el sesgo de `arbPregunta` y el consentimiento inicial de `arbGuion`. Si
 * alguien toca el generador, conviene volver a medir: una propiedad verde que no llega al caso es
 * peor que no tenerla, porque además tranquiliza.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  abrirBorrador,
  aplicarSugerencia,
  applyAssistant,
  type AssistantEvent,
  type AssistantLog,
  type AssistantState,
  ayudaEstructural,
  type BorradorId,
  borradorId,
  cerrarBorrador,
  conteoDeSugerencias,
  consentimientoCubre,
  construirPeticion,
  decidirConsentimiento,
  desajustes,
  type DestinoIA,
  escribirRespuesta,
  faltanObligatorias,
  fraseDeCierre,
  huecos,
  initialAssistantState,
  MINIMO_DE_BORRADORES,
  modoDelAsistente,
  type NumeroPregunta,
  pregunta,
  PREGUNTAS,
  procedencia,
  puedeCerrarse,
  registrarSugerencia,
  replayAssistant,
  type Respuesta,
  respuestaDe,
  type ResumenSugerido,
  SIN_IA,
  type Sugerencia,
  type SugerenciaId,
  sugerenciaId,
  tasaDeAceptacionColectiva,
  textoSugerido,
  verifyAssistantLog,
} from '../../src/assistant/index.js';
import { DomainError } from '../../src/errors.js';
import { eventId, type Instant, instant, type MemberId, memberId } from '../../src/ids.js';

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Escenario
// ═════════════════════════════════════════════════════════════════════════════════════════════

const RUNS = Number(process.env['FC_RUNS'] ?? '300');
const SEED = 30_000_821;
const runs = (aMil: number): { numRuns: number; seed: number } => ({
  seed: SEED,
  numRuns: Math.max(5, Math.round((RUNS * aMil) / 300)),
});

const hex = (n: number): string => n.toString(16).padStart(32, '0');

const BORRADOR: BorradorId = borradorId(hex(0x0b));
const ANA: MemberId = memberId(hex(0xa11a));
const T0 = 1_700_000_000_000;

const DESTINO: DestinoIA = {
  aDondeVa: 'Un servicio de redacción fuera de la Universidad',
  queSeManda: 'Sólo el pedazo de texto que estás escribiendo ahora',
  queNoSeManda: 'Tu nombre y lo que hayas escrito antes',
  enLaMismaMaquina: false,
};

/**
 * Textos seguros: sin acentos descompuestos, sin retornos de carro y sin ninguna tira de 32
 * caracteres hexadecimales, que el dominio confunde —con razón— con un identificador.
 */
const arbTexto: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(
      'no hay luz en el salón',
      'falta plata para el taller',
      'nadie avisa con tiempo',
      'cierran la sala temprano',
      'se llena y no cabe nadie',
    ),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([base, n]) => `${base} ${String(n)}`);

/**
 * Las 27, pero con la 1 y la 11 sobrerrepresentadas.
 *
 * Sin este sesgo el generador **nunca cierra un borrador**: con 27 preguntas equiprobables y guiones
 * de catorce actos, la probabilidad de responder justo esas dos antes de intentar cerrar es
 * despreciable, y la invariante del cierre quedaría verde sin haber visto un solo borrador cerrado.
 * Se midió: con la versión anterior, 0 de 400. Una propiedad que no llega al caso que dice proteger
 * es peor que no tenerla, porque además tranquiliza.
 */
const arbPregunta: fc.Arbitrary<NumeroPregunta> = fc.oneof(
  { arbitrary: fc.constantFrom<NumeroPregunta>(1, 11), weight: 5 },
  { arbitrary: fc.constantFrom(...PREGUNTAS.map((q) => q.numero)), weight: 4 },
);

type Acto =
  | { readonly tipo: 'responder'; readonly pregunta: NumeroPregunta; readonly texto: string }
  | { readonly tipo: 'no_se'; readonly pregunta: NumeroPregunta }
  | { readonly tipo: 'ofrecer'; readonly pregunta: NumeroPregunta; readonly texto: string }
  | { readonly tipo: 'aplicar'; readonly indice: number }
  | { readonly tipo: 'consentir'; readonly concedido: boolean }
  | { readonly tipo: 'cerrar' };

const arbActo: fc.Arbitrary<Acto> = fc.oneof(
  {
    arbitrary: fc.record({
      tipo: fc.constant('responder' as const),
      pregunta: arbPregunta,
      texto: arbTexto,
    }),
    weight: 6,
  },
  {
    arbitrary: fc.record({ tipo: fc.constant('no_se' as const), pregunta: arbPregunta }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      tipo: fc.constant('ofrecer' as const),
      pregunta: arbPregunta,
      texto: arbTexto,
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      tipo: fc.constant('aplicar' as const),
      indice: fc.integer({ min: 0, max: 5 }),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({ tipo: fc.constant('consentir' as const), concedido: fc.boolean() }),
    weight: 2,
  },
  { arbitrary: fc.record({ tipo: fc.constant('cerrar' as const) }), weight: 1 },
);

/**
 * Un guion: un consentimiento inicial opcional, el cuerpo al azar y a veces un intento de cerrar.
 *
 * El consentimiento al principio existe por la misma razón que el sesgo de `arbPregunta`: sin él casi
 * ninguna oferta de máquina llega a entrar, y las invariantes sobre sugerencias se comprobarían sobre
 * borradores que no tienen ninguna.
 */
const arbGuion: fc.Arbitrary<readonly Acto[]> = fc
  .tuple(
    fc.option(fc.boolean(), { nil: undefined }),
    fc.array(arbActo, { minLength: 1, maxLength: 14 }),
    fc.boolean(),
  )
  .map(([consentimiento, cuerpo, cierraAlFinal]) => [
    ...(consentimiento === undefined
      ? []
      : [{ tipo: 'consentir', concedido: consentimiento } as const]),
    ...cuerpo,
    ...(cierraAlFinal ? [{ tipo: 'cerrar' } as const] : []),
  ]);

/** La respuesta con la forma que pide cada pregunta; la 7 se alinea con las causas que haya. */
function respuestaPara(estado: AssistantState, numero: NumeroPregunta, texto: string): Respuesta {
  const q = pregunta(numero);
  if (q.forma === 'lineas') return { forma: 'lineas', lineas: [texto] };
  if (q.forma === 'por_linea') {
    const origen = q.porCadaLineaDe;
    const version = origen === undefined ? undefined : respuestaDe(estado, origen);
    const cuantas =
      version?.respuesta.forma === 'lineas'
        ? version.respuesta.lineas.filter((l) => l.trim() !== '').length
        : 0;
    return { forma: 'por_linea', porLinea: Array.from({ length: cuantas }, () => texto) };
  }
  return { forma: 'frase', texto };
}

interface Corrida {
  readonly log: AssistantLog;
  readonly estado: AssistantState;
  /** Códigos de los actos que el dominio rechazó, en orden. */
  readonly rechazos: readonly string[];
  /** Cuántos actos de persona escribieron de verdad una versión. */
  readonly escrituras: number;
}

/**
 * Ejecuta un guion contra el agregado. Los actos que el dominio rechaza se anotan y se sigue: eso es
 * lo que hace una persona delante de un formulario, y es donde aparecen los huecos interesantes.
 */
async function correr(
  guion: readonly Acto[],
  opciones: { readonly conIA: boolean } = { conIA: true },
): Promise<Corrida> {
  let log: AssistantLog = [];
  const rechazos: string[] = [];
  let escrituras = 0;
  let n = 0;
  const siguiente = (): {
    readonly eventId: ReturnType<typeof eventId>;
    readonly occurredAt: Instant;
  } => {
    n += 1;
    return { eventId: eventId(hex(0x1000 + n)), occurredAt: instant(T0 + n * 60_000) };
  };
  const intentar = async (hacer: () => Promise<AssistantEvent>): Promise<boolean> => {
    try {
      log = [...log, await hacer()];
      return true;
    } catch (error) {
      rechazos.push(error instanceof DomainError ? error.code : `raro: ${String(error)}`);
      return false;
    }
  };

  await intentar(() => abrirBorrador(BORRADOR, log, { ...siguiente(), actor: ANA }));

  let ofrecidas = 0;
  for (const acto of guion) {
    const estado = replayAssistant(BORRADOR, log);
    switch (acto.tipo) {
      case 'responder': {
        const ok = await intentar(() =>
          escribirRespuesta(
            BORRADOR,
            log,
            {
              pregunta: acto.pregunta,
              respuesta: respuestaPara(estado, acto.pregunta, acto.texto),
            },
            { ...siguiente(), actor: ANA },
          ),
        );
        if (ok) escrituras += 1;
        break;
      }
      case 'no_se': {
        const ok = await intentar(() =>
          escribirRespuesta(
            BORRADOR,
            log,
            { pregunta: acto.pregunta, respuesta: { forma: 'todavia_no_se' } },
            { ...siguiente(), actor: ANA },
          ),
        );
        if (ok) escrituras += 1;
        break;
      }
      case 'ofrecer': {
        if (!opciones.conIA) break;
        ofrecidas += 1;
        const sugerencia: Sugerencia<ResumenSugerido> = {
          clase: 'sugerencia',
          operacion: 'resumir',
          contenido: { resumen: textoSugerido(acto.texto) },
        };
        await intentar(() =>
          registrarSugerencia(
            BORRADOR,
            log,
            {
              sugerenciaId: sugerenciaId(hex(0x5000 + ofrecidas)),
              sugerencia,
              pregunta: acto.pregunta,
              destino: DESTINO,
            },
            siguiente(),
          ),
        );
        break;
      }
      case 'aplicar': {
        const disponible = estado.sugerencias[acto.indice % Math.max(1, estado.sugerencias.length)];
        const id: SugerenciaId = disponible?.sugerenciaId ?? sugerenciaId(hex(0xdead));
        const numero = disponible?.pregunta ?? 1;
        const texto = disponible?.textos[0] ?? 'inventado';
        const ok = await intentar(() =>
          aplicarSugerencia(
            BORRADOR,
            log,
            { sugerenciaId: id, pregunta: numero, respuesta: respuestaPara(estado, numero, texto) },
            { ...siguiente(), actor: ANA },
          ),
        );
        if (ok) escrituras += 1;
        break;
      }
      case 'consentir':
        await intentar(() =>
          decidirConsentimiento(
            BORRADOR,
            log,
            { concedido: acto.concedido, destino: DESTINO },
            { ...siguiente(), actor: ANA },
          ),
        );
        break;
      case 'cerrar':
        await intentar(() => cerrarBorrador(BORRADOR, log, { ...siguiente(), actor: ANA }));
        break;
    }
  }

  return { log, estado: replayAssistant(BORRADOR, log), rechazos, escrituras };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A1 · el cierre exige la 1 y la 11
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A1 · un borrador sólo se cierra con la 1 y la 11 respondidas', () => {
  it('nunca queda cerrado con una obligatoria en blanco', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado } = await correr(guion);
        if (estado.estado === 'cerrado') expect(faltanObligatorias(estado)).toEqual([]);
      }),
      runs(300),
    );
  });

  it('las otras 25 pueden quedar en blanco sin impedir nada', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado } = await correr(guion);
        for (const hueco of huecos(estado)) {
          expect(hueco.bloquea).toBe(hueco.pregunta === 1 || hueco.pregunta === 11);
        }
        expect(puedeCerrarse(estado)).toBe(
          estado.estado === 'redactando' && faltanObligatorias(estado).length === 0,
        );
      }),
      runs(300),
    );
  });

  it('«todavía no sé» nunca cuenta como respuesta para cerrar', async () => {
    await fc.assert(
      fc.asyncProperty(arbTexto, async (texto) => {
        const { estado } = await correr([
          { tipo: 'no_se', pregunta: 1 },
          { tipo: 'responder', pregunta: 11, texto },
          { tipo: 'cerrar' },
        ]);
        expect(estado.estado).toBe('redactando');
        expect([...faltanObligatorias(estado)]).toEqual([1]);
      }),
      runs(120),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A2 · la frase es determinista y función pura de las respuestas
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A2 · la frase de cierre es determinista', () => {
  it('dos llamadas sobre el mismo estado dan exactamente lo mismo', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado } = await correr(guion);
        expect(fraseDeCierre(estado)).toEqual(fraseDeCierre(estado));
      }),
      runs(300),
    );
  });

  it('no depende del orden en que se respondió', async () => {
    const arbRespuestas = fc
      .uniqueArray(fc.tuple(arbPregunta, arbTexto), {
        minLength: 1,
        maxLength: 6,
        selector: ([q]) => q,
      })
      .chain((pares) =>
        fc.tuple(fc.constant(pares), fc.shuffledSubarray(pares, { minLength: pares.length })),
      );

    await fc.assert(
      fc.asyncProperty(arbRespuestas, async ([enOrden, barajadas]) => {
        const guionDe = (pares: readonly (readonly [NumeroPregunta, string])[]): readonly Acto[] =>
          pares.map(([q, texto]) => ({ tipo: 'responder', pregunta: q, texto }) as const);
        const a = await correr(guionDe(enOrden));
        const b = await correr(guionDe(barajadas));
        // La 7 depende de cuántas causas hubiera al escribirla, así que sólo se comparan los
        // borradores en que ambos órdenes la aceptaron o ambos la rechazaron.
        const respondidas = (c: typeof a): number => c.estado.historial.length;
        if (respondidas(a) !== respondidas(b)) return;
        expect(fraseDeCierre(b.estado).texto).toBe(fraseDeCierre(a.estado).texto);
        expect([...fraseDeCierre(b.estado).huecos]).toEqual([...fraseDeCierre(a.estado).huecos]);
      }),
      runs(200),
    );
  });

  it('nunca aparece en el historial: no es un dato guardado', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { log, estado } = await correr(guion);
        const frase = fraseDeCierre(estado).texto;
        expect(JSON.stringify(log)).not.toContain(frase);
      }),
      runs(200),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A3 y INV-A8 · la máquina no escribe; la máquina no tiene nombre
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A3 · ninguna cantidad de sugerencias cambia por sí sola una respuesta', () => {
  it('toda versión del historial viene de un evento de persona', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { log, estado } = await correr(guion);
        const porSeq = new Map(log.map((e) => [e.seq, e]));
        for (const version of estado.historial) {
          const evento = porSeq.get(version.seq);
          expect(evento).toBeDefined();
          expect(evento?.actor).toBe(ANA);
          expect(
            evento?.payload.type === 'RespuestaEscrita' ||
              evento?.payload.type === 'SugerenciaAplicada',
          ).toBe(true);
        }
      }),
      runs(300),
    );
  });

  it('el número de versiones es el de actos de persona aceptados, no el de sugerencias', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado, escrituras } = await correr(guion);
        expect(estado.historial).toHaveLength(escrituras);
      }),
      runs(300),
    );
  });
});

describe('INV-A8 · la oferta de la máquina no se atribuye a nadie', () => {
  it('`SugerenciaRecibida` lleva `system` y ningún otro evento lo lleva', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { log } = await correr(guion);
        for (const evento of log) {
          const esOferta = evento.payload.type === 'SugerenciaRecibida';
          expect(evento.actor === 'system').toBe(esOferta);
        }
      }),
      runs(300),
    );
  });

  it('no hay ningún evento de rechazo: lo no aplicado se sabe por ausencia', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { log, estado } = await correr(guion);
        for (const evento of log) {
          expect(JSON.stringify(evento.payload)).not.toMatch(/rechaz|descart|ignor/iu);
        }
        const conteo = conteoDeSugerencias(estado);
        expect(conteo.ofrecidas - conteo.aplicadas).toBeGreaterThanOrEqual(0);
      }),
      runs(200),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A4 · una sugerencia que nunca existió no se acepta
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A4 · aceptar una sugerencia que nunca se recibió se rechaza', () => {
  it('con cualquier identificador inventado', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, fc.integer({ min: 1, max: 0xffff }), async (guion, semilla) => {
        const { log, estado } = await correr(guion);
        if (estado.estado !== 'redactando') return;
        const inventado = sugerenciaId(hex(0xf00000 + semilla));
        if (estado.sugerencias.some((s) => s.sugerenciaId === inventado)) return;
        await expect(
          aplicarSugerencia(
            BORRADOR,
            log,
            { sugerenciaId: inventado, pregunta: 1, respuesta: { forma: 'frase', texto: 'nada' } },
            { eventId: eventId(hex(0x2ffff)), occurredAt: instant(T0 + 9_000_000), actor: ANA },
          ),
        ).rejects.toMatchObject({ code: 'UNKNOWN_SUGGESTION' });
      }),
      runs(200),
    );
  });

  it('y tampoco un texto que la sugerencia no contenía', async () => {
    await fc.assert(
      fc.asyncProperty(arbTexto, arbTexto, async (sugerido, propio) => {
        if (sugerido === propio) return;
        const { log, estado } = await correr([
          { tipo: 'consentir', concedido: true },
          { tipo: 'ofrecer', pregunta: 1, texto: sugerido },
        ]);
        const id = estado.sugerencias[0]?.sugerenciaId;
        expect(id).toBeDefined();
        if (id === undefined) return;
        await expect(
          aplicarSugerencia(
            BORRADOR,
            log,
            { sugerenciaId: id, pregunta: 1, respuesta: { forma: 'frase', texto: propio } },
            { eventId: eventId(hex(0x2fffe)), occurredAt: instant(T0 + 9_000_000), actor: ANA },
          ),
        ).rejects.toMatchObject({ code: 'TEXT_NOT_IN_SUGGESTION' });
      }),
      runs(150),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A5 · la mano manda sobre lo aceptado antes
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A5 · lo escrito a mano prevalece sobre una sugerencia aceptada antes', () => {
  it('la versión vigente es siempre la última escrita, con su procedencia', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado } = await correr(guion);
        for (const p of PREGUNTAS) {
          const versiones = estado.historial.filter((v) => v.pregunta === p.numero);
          const ultima = versiones.at(-1);
          expect(respuestaDe(estado, p.numero)).toEqual(ultima);
        }
        for (const fila of procedencia(estado)) {
          if (fila.origen === 'mano') expect(fila.sugerenciaId).toBeUndefined();
          else expect(fila.sugerenciaId).toBeDefined();
        }
      }),
      runs(300),
    );
  });

  it('escribir después de aceptar deja la respuesta en «mano», y la sugerencia sigue en el historial', async () => {
    await fc.assert(
      fc.asyncProperty(arbTexto, arbTexto, async (sugerido, aMano) => {
        if (sugerido === aMano) return;
        const { estado } = await correr([
          { tipo: 'consentir', concedido: true },
          { tipo: 'ofrecer', pregunta: 1, texto: sugerido },
          { tipo: 'aplicar', indice: 0 },
          { tipo: 'responder', pregunta: 1, texto: aMano },
        ]);
        const vigente = respuestaDe(estado, 1);
        expect(vigente?.origen).toBe('mano');
        expect(vigente?.respuesta).toEqual({ forma: 'frase', texto: aMano });
        expect(estado.historial.filter((v) => v.pregunta === 1).map((v) => v.origen)).toEqual([
          'sugerencia',
          'mano',
        ]);
        expect(estado.aplicadas).toHaveLength(1);
      }),
      runs(150),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A6 · sin consentimiento no se invoca el puerto
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A6 · sin consentimiento no sale nada', () => {
  it('toda sugerencia del historial estaba cubierta por un consentimiento previo', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { log } = await correr(guion);
        let estado = initialAssistantState(BORRADOR);
        for (const evento of log) {
          if (evento.payload.type === 'SugerenciaRecibida') {
            expect(consentimientoCubre(estado, evento.payload.sugerencia.destino)).toBe(true);
          }
          estado = applyAssistant(estado, evento);
        }
      }),
      runs(300),
    );
  });

  it('`construirPeticion` lanza siempre que el modo no sea generativo', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, fc.boolean(), arbTexto, async (guion, hayProveedor, fragmento) => {
        const { estado } = await correr(guion);
        const disponibilidad = { hayProveedor, destino: hayProveedor ? DESTINO : undefined };
        const generativo = modoDelAsistente(estado, disponibilidad) === 'generativo';
        if (generativo) {
          const peticion = construirPeticion(estado, disponibilidad, {
            operacion: 'resumir',
            fragmento,
          });
          expect(Object.keys(peticion).sort()).toEqual([
            'conQueComparar',
            'fragmento',
            'operacion',
          ]);
          expect(JSON.stringify(peticion)).not.toContain(ANA);
          expect(JSON.stringify(peticion)).not.toContain(BORRADOR);
        } else {
          expect(() =>
            construirPeticion(estado, disponibilidad, { operacion: 'resumir', fragmento }),
          ).toThrow(DomainError);
        }
      }),
      runs(200),
    );
  });

  it('tras un «no» el sistema no vuelve a preguntar y no entra ninguna sugerencia', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbActo, { maxLength: 6 }), async (cola) => {
        const { estado } = await correr([
          { tipo: 'consentir', concedido: false },
          ...cola.filter((a) => a.tipo !== 'consentir'),
        ]);
        expect(estado.sugerencias).toHaveLength(0);
        expect(modoDelAsistente(estado, { hayProveedor: true, destino: DESTINO })).toBe(
          'estructural',
        );
      }),
      runs(150),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A7 · el puerto nulo no cambia nada
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A7 · con el puerto nulo el agregado se comporta igual', () => {
  /** El mismo guion sin los actos que dependen de que exista un modelo. */
  const sinMaquina = (guion: readonly Acto[]): readonly Acto[] =>
    guion.filter((a) => a.tipo !== 'ofrecer' && a.tipo !== 'aplicar');

  it('las mismas respuestas, los mismos huecos, la misma frase y el mismo cierre', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const limpio = sinMaquina(guion);
        const conIA = await correr(limpio, { conIA: true });
        const sinIA = await correr(limpio, { conIA: false });
        expect(fraseDeCierre(sinIA.estado).texto).toBe(fraseDeCierre(conIA.estado).texto);
        expect(huecos(sinIA.estado)).toEqual(huecos(conIA.estado));
        expect(puedeCerrarse(sinIA.estado)).toBe(puedeCerrarse(conIA.estado));
        expect(sinIA.estado.estado).toBe(conIA.estado.estado);
      }),
      runs(200),
    );
  });

  it('las sugerencias que nadie aplica no dejan huella en las respuestas', async () => {
    /** El guion sin los actos de aplicar: las ofertas quedan, pero nadie las toma. */
    const sinAplicar = (guion: readonly Acto[]): readonly Acto[] =>
      guion.filter((a) => a.tipo !== 'aplicar');

    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const base = sinAplicar(guion);
        const conOfertas = await correr(base, { conIA: true });
        const sinOfertas = await correr(base, { conIA: false });
        const respuestas = (c: Corrida): unknown =>
          c.estado.historial.map((v) => [v.pregunta, v.respuesta, v.origen]);
        expect(respuestas(sinOfertas)).toEqual(respuestas(conOfertas));
        expect(fraseDeCierre(sinOfertas.estado).texto).toBe(fraseDeCierre(conOfertas.estado).texto);
        expect(sinOfertas.estado.sugerencias).toHaveLength(0);
      }),
      runs(200),
    );
  });

  it('los desajustes se declaran, nunca se arreglan solos', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado } = await correr(guion);
        for (const d of desajustes(estado)) {
          expect(pregunta(d.pregunta).porCadaLineaDe).toBe(d.deLaPregunta);
          expect(d.tiene).not.toBe(d.deberiaTener);
          // Lo que la persona escribió sigue ahí, entero: se avisa, no se recorta.
          const version = respuestaDe(estado, d.pregunta);
          expect(version?.respuesta.forma).toBe('por_linea');
        }
      }),
      runs(200),
    );
  });

  it('la ayuda estructural responde para las 27 preguntas y nunca lanza', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado } = await correr(guion);
        for (const p of PREGUNTAS) {
          const ayuda = ayudaEstructural(estado, p.numero, SIN_IA);
          expect(ayuda.pregunta.numero).toBe(p.numero);
          expect(ayuda.frase.texto.length).toBeGreaterThan(0);
          expect(ayuda.porQueNoHaySugerencias.length).toBeGreaterThan(0);
        }
      }),
      runs(150),
    );
  });

  it('la cadena del historial siempre se verifica y vuelve a plegarse igual', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { log, estado } = await correr(guion);
        await expect(verifyAssistantLog(BORRADOR, log)).resolves.toEqual(estado);
      }),
      runs(150),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// INV-A9 · la tasa es colectiva y exacta
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-A9 · la tasa de aceptación es colectiva y exacta', () => {
  const arbConteos = fc.array(
    fc
      .tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }))
      .map(([a, b]) => ({ ofrecidas: Math.max(a, b), aplicadas: Math.min(a, b) })),
    { minLength: 0, maxLength: 30 },
  );

  it('la fricción se enciende exactamente en tres cuartos, con enteros', () => {
    fc.assert(
      fc.property(arbConteos, (conteos) => {
        const tasa = tasaDeAceptacionColectiva(conteos);
        if (!tasa.hayDatos) {
          expect(
            conteos.length < MINIMO_DE_BORRADORES || conteos.every((c) => c.ofrecidas === 0),
          ).toBe(true);
          return;
        }
        expect(tasa.tasa.num).toBe(BigInt(tasa.aplicadas));
        expect(tasa.tasa.den).toBe(BigInt(tasa.ofrecidas));
        expect(tasa.enFriccion).toBe(4 * tasa.aplicadas >= 3 * tasa.ofrecidas);
      }),
      runs(300),
    );
  });

  it('el conteo de un borrador no lleva ni un identificador', async () => {
    await fc.assert(
      fc.asyncProperty(arbGuion, async (guion) => {
        const { estado } = await correr(guion);
        const conteo = conteoDeSugerencias(estado);
        expect(Object.keys(conteo).sort()).toEqual(['aplicadas', 'ofrecidas']);
        expect(JSON.stringify(conteo)).not.toContain(ANA);
        expect(JSON.stringify(conteo)).not.toContain(BORRADOR);
      }),
      runs(150),
    );
  });
});
