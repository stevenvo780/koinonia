/**
 * Los presentadores de las pantallas nuevas: qué palabras salen y cuáles no.
 *
 * Estas pruebas cubren lo que la integración no puede cubrir barato: los casos raros del texto.
 * Un historial con un tipo de hecho que la tabla no conoce, un consenso sin acuerdo destacable, un
 * reparto de la voz sin nadie que haya prestado nada. Todos ellos tienen que salir en castellano y
 * sin dejar huecos, porque un hueco en una pantalla de gobernanza se lee como que algo se rompió.
 */

import { forbiddenTermsIn } from '@koinonia/contracts';
import { DECISION_EVENT_TYPES, memberId } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { consensoDto, historialDto, normasDto, QUE_PASO } from '../src/http/presenters.js';
import { verNormas, type ConsensoCalculado, type HistorialLeido } from '../src/http/service.js';

const SIN_DATOS = {
  matriz: [],
  textos: [],
  participantes: [],
  votaciones: 0,
} as const;

/**
 * `Extract` sobre la unión y no `infer` sobre el todo: `ConsensoCalculado` es una unión, así que
 * `ConsensoCalculado extends { motivo: infer M }` da `never` —ninguna unión extiende a una de sus
 * ramas— y el parámetro se vuelve inaceptable para cualquier argumento. Compilaba de milagro
 * mientras nadie lo llamaba.
 */
type MotivoTodaviaNo = Extract<ConsensoCalculado, { tipo: 'todavia-no' }>['motivo'];

function todaviaNo(motivo: MotivoTodaviaNo): ConsensoCalculado {
  return { tipo: 'todavia-no', motivo, datos: SIN_DATOS };
}

describe('consenso: los cuatro motivos de «todavía no» tienen su propia explicación', () => {
  const motivos = ['sin-votaciones', 'poca-gente', 'sin-diferencias', 'no-se-estabilizo'] as const;

  it('cada motivo dice algo distinto y siempre dice qué falta', () => {
    const vistos = new Set<string>();
    for (const motivo of motivos) {
      const dto = consensoDto(todaviaNo(motivo));
      if (dto.tipo !== 'todavia-no') throw new Error('debería ser «todavía no»');
      expect(dto.titulo).toBe('No hay grupos claros');
      expect(dto.descripcion.length).toBeGreaterThan(40);
      // Nunca un callejón: siempre hay una salida escrita.
      expect(dto.queFalta.length).toBeGreaterThan(20);
      vistos.add(dto.descripcion);
    }
    // Cuatro descripciones distintas: si dos coincidieran, uno de los cuatro casos estaría
    // contando algo que no le pasó a esa persona.
    expect(vistos.size).toBe(motivos.length);
  });

  it('«todos respondieron igual» no se cuenta como un fallo del cálculo', () => {
    const dto = consensoDto(todaviaNo('sin-diferencias'));
    if (dto.tipo !== 'todavia-no') throw new Error('debería ser «todavía no»');
    expect(dto.descripcion).toMatch(/es un resultado/u);
    expect(dto.descripcion).not.toMatch(/error|fall(o|ó)|roto/iu);
  });

  it('ninguna explicación trae jerga', () => {
    for (const motivo of motivos) {
      const dto = consensoDto(todaviaNo(motivo));
      expect(forbiddenTermsIn(JSON.stringify(dto)), motivo).toEqual([]);
    }
  });
});

describe('consenso: «no hay grupos claros» conserva la promesa del producto', () => {
  const analizado: ConsensoCalculado = {
    tipo: 'analizado',
    miGrupo: undefined,
    datos: { ...SIN_DATOS, participantes: [memberId('a'.repeat(32))], votaciones: 4 },
    resultado: {
      tipo: 'FaccionesNoDetectadas',
      separacionMaxima: 0.18,
      umbral: 0.25,
      kExaminados: [2],
      participantesConsiderados: 1,
      afirmacionesPuente: [],
      afirmacionesPuntuadas: [],
      textos: [],
    },
  };

  it('el título es exactamente el que promete el producto, y no una copia parecida', () => {
    const dto = consensoDto(analizado);
    expect(dto.tipo).toBe('sin-grupos');
    expect(dto.titulo).toBe('No hay grupos claros');
  });

  it('sin acuerdo destacable pone un aviso, nunca una lista vacía y muda', () => {
    const dto = consensoDto(analizado);
    if (dto.tipo !== 'sin-grupos') throw new Error('debería ser «sin grupos»');
    expect(dto.acuerdoGeneral.textos).toEqual([]);
    expect(dto.acuerdoGeneral.aviso.length).toBeGreaterThan(20);
  });

  it('dice de dónde sale, que es lo que necesita quien desconfía', () => {
    const dto = consensoDto(analizado);
    if (dto.tipo !== 'sin-grupos') throw new Error('debería ser «sin grupos»');
    expect(dto.deDondeSale).toMatch(/no es una encuesta ni una etiqueta sobre nadie/u);
    expect(dto.deDondeSale).toMatch(/cualquiera puede volver a contar/u);
  });
});

describe('historial: un índice, no un volcado', () => {
  function leido(hechos: HistorialLeido['hechos'], delSellado = 0): HistorialLeido {
    return {
      total: hechos.length + delSellado,
      enLaLista: hechos.length,
      delSellado,
      desde: 1,
      hasta: 2,
      hechos,
      hayMas: false,
    };
  }

  it('traduce cada hecho a una frase y nunca enseña el nombre interno', () => {
    const dto = historialDto(
      leido([
        {
          numero: 2,
          cuando: 1_800_000_000_000,
          tipo: 'BallotCast',
          tipoDeAgregado: 'decision',
          agregado: 'd'.repeat(32),
        },
      ]),
    );
    expect(dto.hechos[0]?.que).toBe('Alguien respondió');
    expect(dto.hechos[0]?.sobre).toBe('Una votación');
    expect(dto.hechos[0]?.enlace).toBe(`/decisiones/${'d'.repeat(32)}`);
    expect(JSON.stringify(dto)).not.toContain('BallotCast');
  });

  it('separa el sellado automático de lo demás, y da las dos cifras', () => {
    /*
     * La pantalla enseñaba los últimos 60 hechos en crudo y salían 52 líneas iguales que decían
     * «Quedó registrado algo», porque la tarea de anclaje escribe ~7 por hora en el mismo historial
     * y llegó a ser el 99,6 % de lo escrito. Las dos cifras van separadas para que la pantalla
     * pueda decir «una cosa anotada» sin esconder que hay 2312 sellos más: contarlos aparte no es
     * lo mismo que ocultarlos, y la diferencia es lo que esta prueba fija.
     */
    const dto = historialDto(
      leido(
        [
          {
            numero: 3,
            cuando: 1_800_000_000_000,
            tipo: 'ProblemOpened',
            tipoDeAgregado: 'problem',
            agregado: 'p'.repeat(32),
          },
        ],
        2312,
      ),
    );

    expect(dto.enLaLista).toBe(1);
    expect(dto.delSellado).toBe(2312);
    expect(dto.total).toBe(2313);
    // Y lo que se lista es lo de la gente, no el sellado.
    expect(dto.hechos).toHaveLength(1);
    expect(dto.hechos[0]?.que).toBe('Alguien escribió un problema');
  });

  it('el sellado automático tiene nombre propio: no cae en «quedó registrado algo»', () => {
    // No se lista en esa pantalla, pero el mismo presentador sirve a quien mire un hecho suelto, y
    // un tipo que sí conocemos tiene que decirse. Antes los cuatro caían al genérico.
    for (const [tipo, frase] of [
      ['AnclajeIntentado', 'Se mandó el resumen a un testigo de fuera'],
      ['AnclajeConfirmado', 'Un testigo de fuera confirmó el resumen'],
      ['AnclajeFallido', 'Un testigo de fuera no pudo confirmar el resumen'],
      ['AnclajeEstadoPublicado', 'Se publicó cómo va la confirmación de fuera'],
    ] as const) {
      const dto = historialDto(
        leido([
          {
            numero: 1,
            cuando: 1_800_000_000_000,
            tipo,
            tipoDeAgregado: '#anclaje',
            agregado: 'a'.repeat(32),
          },
        ]),
      );
      expect(dto.hechos[0]?.que, tipo).toBe(frase);
      expect(dto.hechos[0]?.sobre, tipo).toBe('El sellado externo');
    }
  });

  it('ningún hecho de una votación se queda sin frase: la tabla no puede ir por detrás del motor', () => {
    /*
     * El respaldo `?? 'Quedó registrado algo'` existe para el hecho que alguien añada mañana. Se
     * había convertido en otra cosa: DIEZ tipos que el motor ya sabía escribir salían así en
     * pantalla, y entre ellos lo más cargado que puede pasar en una votación —que alguien objete,
     * que se anule, que se alargue el plazo—. Nadie lo notó porque el respaldo es una frase
     * perfectamente correcta.
     *
     * Esto se ata a `DECISION_EVENT_TYPES`, que es la lista del dominio, y no a una copia: el día
     * que el motor aprenda un hecho nuevo, esta prueba se pone roja y obliga a decidir cómo se dice
     * en castellano, en vez de que la pantalla empiece a decir «algo» sin que nadie se entere.
     */
    const sinFrase = DECISION_EVENT_TYPES.filter((tipo) => QUE_PASO[tipo] === undefined);
    expect(sinFrase).toEqual([]);

    // Y ninguna frase puede ser el nombre interno con espacios: eso sigue siendo jerga.
    for (const tipo of DECISION_EVENT_TYPES) {
      expect(QUE_PASO[tipo], tipo).not.toContain(tipo);
    }
  });

  it('un tipo que la tabla no conoce se dice en castellano, no se escupe crudo', () => {
    // Es el caso que importa: la tabla de traducción se va a quedar atrás cuando alguien añada un
    // hecho nuevo, y ese día la pantalla NO puede empezar a enseñar `AlgoRaroOcurrido`.
    const dto = historialDto(
      leido([
        {
          numero: 1,
          cuando: 1,
          tipo: 'AlgoQueTodavíaNoExiste',
          tipoDeAgregado: 'agregado-desconocido',
          agregado: 'e'.repeat(32),
        },
      ]),
    );
    expect(dto.hechos[0]?.que).toBe('Quedó registrado algo');
    expect(dto.hechos[0]?.sobre).toBe('La plataforma');
    // Y sin enlace: un enlace inventado a una pantalla que no existe es peor que ninguno.
    expect(dto.hechos[0]?.enlace).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain('AlgoQueTodavíaNoExiste');
  });

  it('las frases del historial no traen jerga', () => {
    const tipos = [
      'LedgerAbierto',
      'ProblemOpened',
      'DecisionOpened',
      'BallotCast',
      'DelegationGranted',
      'DelegationRevoked',
      'ContributionSubmitted',
      'CheckpointEmitido',
    ];
    const dto = historialDto(
      leido(
        tipos.map((tipo, i) => ({
          numero: i + 1,
          cuando: 1,
          tipo,
          tipoDeAgregado: 'decision',
          agregado: 'f'.repeat(32),
        })),
      ),
    );
    for (const hecho of dto.hechos) {
      expect(forbiddenTermsIn(hecho.que), hecho.que).toEqual([]);
    }
    // «LedgerAbierto» se dice «Se abrió el historial»: el término prohibido está en el nombre
    // interno y no puede sobrevivir a la traducción.
    expect(dto.hechos[0]?.que).toBe('Se abrió el historial');
  });
});

describe('normas: el núcleo sale del dominio, no de una copia a mano', () => {
  it('publica los seis puntos del núcleo, todos marcados como irreformables', () => {
    const dto = normasDto(verNormas());
    expect(dto.nucleo.reglas).toHaveLength(6);
    expect(dto.nucleo.reglas.every((regla) => regla.irreformable)).toBe(true);
    // Cada uno con título y texto propios: seis viñetas vacías no son un núcleo intangible.
    expect(dto.nucleo.reglas.every((regla) => regla.texto.length > 60)).toBe(true);
  });

  it('no inventa una versión vigente que nadie aprobó', () => {
    const dto = normasDto(verNormas());
    expect(dto.hayNormas).toBe(false);
    expect(dto.versionVigente).toBe(0);
    expect(dto.versiones).toEqual([]);
  });

  it('dice los umbrales como proporciones exactas y nunca como decimales', () => {
    const dto = normasDto(verNormas());
    const todos = dto.vias.flatMap((via) => via.requisitos);
    expect(todos.some((requisito) => /2 de cada 3/u.test(requisito))).toBe(true);
    expect(todos.some((requisito) => /3 de cada 4/u.test(requisito))).toBe(true);
    for (const requisito of todos) {
      expect(requisito, requisito).not.toMatch(/\d[,.]\d/u);
    }
  });

  it('la vía atrincherada exige dos votaciones separadas y lo explica', () => {
    const dto = normasDto(verNormas());
    const atrincherada = dto.vias[1];
    expect(atrincherada?.requisitos.some((r) => /2 votaciones distintas/u.test(r))).toBe(true);
    expect(atrincherada?.requisitos.some((r) => /6 meses/u.test(r))).toBe(true);
  });

  it('ni una palabra prohibida en toda la pantalla de normas', () => {
    expect(forbiddenTermsIn(JSON.stringify(normasDto(verNormas())))).toEqual([]);
  });
});
