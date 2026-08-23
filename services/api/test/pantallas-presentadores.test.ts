/**
 * Los presentadores de las pantallas nuevas: qué palabras salen y cuáles no.
 *
 * Estas pruebas cubren lo que la integración no puede cubrir barato: los casos raros del texto.
 * Un historial con un tipo de hecho que la tabla no conoce, un consenso sin acuerdo destacable, un
 * reparto de la voz sin nadie que haya prestado nada. Todos ellos tienen que salir en castellano y
 * sin dejar huecos, porque un hueco en una pantalla de gobernanza se lee como que algo se rompió.
 */

import { forbiddenTermsIn } from '@koinonia/contracts';
import { memberId } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { consensoDto, historialDto, normasDto } from '../src/http/presenters.js';
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
  function leido(hechos: HistorialLeido['hechos']): HistorialLeido {
    return { total: hechos.length, desde: 1, hasta: 2, hechos, hayMas: false };
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
