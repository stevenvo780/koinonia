/**
 * El contrato de escribir las reglas.
 *
 * Dos cosas se comprueban aquí y las dos son de forma, no de política: que una proporción viaja en
 * **dos enteros** y nunca en un decimal, y que el título de una regla ocupa **una sola línea**. La
 * segunda parece cosmética y no lo es: título y texto se juntan con una línea en blanco para formar
 * la preimagen de la huella de esa regla, así que un título con saltos de línea haría que dos
 * parejas distintas produjeran la misma huella. Una huella que vale para dos textos no identifica
 * ninguno, que es exactamente el defecto por el que `jsonb` está proscrito en el historial.
 */

import { describe, expect, it } from 'vitest';

import {
  aprobarReforma,
  fundarNormas,
  normas,
  proponerReforma,
  proporcion,
  ratificarReforma,
  registrarVotacionDeReforma,
  reglaRedactada,
} from '../src/http.js';

const REQUEST = '00000000-0000-4000-8000-000000000001';

const REGLA = {
  id: 'horario_de_la_sala',
  titulo: 'La sala de estudio abre de lunes a viernes',
  texto: 'La sala abre de ocho de la mañana a seis de la tarde, de lunes a viernes.',
};

describe('contrato de una regla redactada', () => {
  it('acepta una regla con etiqueta, título de una línea y texto', () => {
    expect(reglaRedactada.parse(REGLA).id).toBe('horario_de_la_sala');
  });

  it('rechaza un título con saltos de línea: la huella dejaría de identificar un solo texto', () => {
    expect(() => reglaRedactada.parse({ ...REGLA, titulo: 'Un título\ncon dos líneas' })).toThrow(
      /una sola línea/u,
    );
  });

  it('la etiqueta sigue el patrón del dominio y no admite mayúsculas ni acentos', () => {
    for (const id of ['Horario', 'horario-de-la-sala', 'horário', '1_horario', '']) {
      expect(() => reglaRedactada.parse({ ...REGLA, id }), id).toThrow();
    }
  });

  it('no admite campos de más: una clave que el servidor ignora es una expectativa falsa', () => {
    expect(() => reglaRedactada.parse({ ...REGLA, irreformable: true })).toThrow();
  });
});

describe('contrato de una proporción', () => {
  it('son dos enteros: «2 de cada 3», nunca 0,667', () => {
    expect(proporcion.parse({ cuantos: 2, deCada: 3 })).toStrictEqual({ cuantos: 2, deCada: 3 });
    expect(() => proporcion.parse({ cuantos: 0.667, deCada: 1 })).toThrow();
  });

  it('no puede pasar del total: «4 de cada 3» no es una proporción', () => {
    expect(() => proporcion.parse({ cuantos: 4, deCada: 3 })).toThrow(/no puede pasar del total/u);
  });
});

describe('contrato de fundar y reformar', () => {
  const fundacion = {
    requestId: REQUEST,
    decisionFundacional: 'd'.repeat(32),
    censo: 300,
    papeletas: 150,
    aFavor: 100,
    votoDirecto: 100,
    rigeDesde: 1_800_000_000_000,
    reglas: [REGLA],
  };

  it('fundar exige la decisión de la asamblea y los números de aquella votación', () => {
    expect(fundarNormas.parse(fundacion).aFavor).toBe(100);
    // Sin la decisión que la ratificó no hay nada que contrastar contra el acta.
    const { decisionFundacional: _sin, ...incompleta } = fundacion;
    expect(() => fundarNormas.parse(incompleta)).toThrow();
  });

  it('fundar no acepta umbrales de reforma: los publica el documento, no quien registra el acta', () => {
    expect(() =>
      fundarNormas.parse({ ...fundacion, requisitos: { ordinaria: {}, atrincherada: {} } }),
    ).toThrow();
  });

  it('la propuesta de reforma lleva el texto entero y la versión que se tenía a la vista', () => {
    const propuesta = proponerReforma.parse({
      requestId: REQUEST,
      via: 'ordinaria',
      sobreLaVersion: 1,
      reglas: [REGLA],
      firmas: 30,
      finDeSemestre: 1_800_000_000_000,
      votacionesConvocadas: [],
      conversacionAbreEn: 1_700_000_000_000,
      conversacionCierraEn: 1_800_000_000_000,
    });
    expect(propuesta.sobreLaVersion).toBe(1);
    expect(propuesta.requisitos).toBeUndefined();
  });

  it('no hay una tercera vía de reforma, ni una «vía rápida»', () => {
    expect(() =>
      proponerReforma.parse({
        requestId: REQUEST,
        via: 'rapida',
        sobreLaVersion: 1,
        reglas: [REGLA],
        firmas: 30,
        finDeSemestre: 1_800_000_000_000,
        votacionesConvocadas: [],
        conversacionAbreEn: 1_700_000_000_000,
        conversacionCierraEn: 1_800_000_000_000,
      }),
    ).toThrow();
  });

  it('la vigencia de una versión va de un mes a veinticuatro: §10 revisa cada dos años', () => {
    const base = {
      requestId: REQUEST,
      via: 'atrincherada' as const,
      sobreLaVersion: 1,
      reglas: [REGLA],
      firmas: 60,
      finDeSemestre: 1_800_000_000_000,
      votacionesConvocadas: [],
      conversacionAbreEn: 1_700_000_000_000,
      conversacionCierraEn: 1_800_000_000_000,
    };
    expect(proponerReforma.parse({ ...base, mesesDeVigencia: 24 }).mesesDeVigencia).toBe(24);
    // 1 200 meses no sería alargar un plazo: sería derogar la caducidad sin tocar su texto.
    expect(() => proponerReforma.parse({ ...base, mesesDeVigencia: 1200 })).toThrow();
    expect(() => proponerReforma.parse({ ...base, mesesDeVigencia: 0 })).toThrow();
  });

  it('transcribir una votación exige decir de cuál salió el resultado', () => {
    const votacion = registrarVotacionDeReforma.parse({
      requestId: REQUEST,
      votacionId: 'c'.repeat(32),
      aFavor: 200,
      votoDirecto: 100,
      abrioEn: 1_700_000_000_000,
      cerroEn: 1_800_000_000_000,
    });
    expect(votacion.votacionId).toHaveLength(32);
    // La ronda no viaja: es «las que van + 1», y la pone el servidor. Si viniera, repetir la
    // primera vuelta hasta que saliera bien sería una petición más.
    expect(Object.keys(votacion)).not.toContain('ronda');
  });

  it('una aprobación no tiene dónde poner a quién se atribuye', () => {
    const aprobacion = aprobarReforma.parse({ requestId: REQUEST });
    expect(Object.keys(aprobacion)).toStrictEqual(['requestId']);
    // Si el campo existiera, existiría la posibilidad de firmar en nombre de otra persona.
    expect(() => aprobarReforma.parse({ requestId: REQUEST, garanteId: 'a'.repeat(32) })).toThrow();
  });

  it('ratificar dice cuándo empieza a regir, y nada más', () => {
    expect(
      ratificarReforma.parse({ requestId: REQUEST, rigeDesde: 1_800_000_000_000 }).rigeDesde,
    ).toBe(1_800_000_000_000);
    expect(() => ratificarReforma.parse({ requestId: REQUEST })).toThrow();
  });
});

describe('contrato de las normas leídas', () => {
  it('una reforma en curso se puede nombrar: sin identificador no se puede votar ni firmar', () => {
    const leidas = normas.parse({
      hayNormas: true,
      titulo: 'Las reglas del juego',
      descripcion: 'Rige la versión 1.',
      versionVigente: 1,
      versiones: [
        {
          version: 1,
          rigeDesde: 1_700_000_000_000,
          caduca: 1_800_000_000_000,
          vigente: true,
          reglas: [{ ...REGLA, irreformable: false }],
        },
      ],
      nucleo: { titulo: 'Lo que no se cambia', explicacion: 'e', reglas: [] },
      vias: [],
      reformasEnCurso: [
        { id: 'f'.repeat(32), titulo: 'Cambio de las reglas', estado: 'En conversación' },
      ],
      vedas: [{ desde: 1_700_000_000_000, hasta: 1_800_000_000_000, motivo: 'fin de semestre' }],
    });
    expect(leidas.reformasEnCurso[0]?.id).toHaveLength(32);
    expect(leidas.versiones[0]?.reglas[0]?.irreformable).toBe(false);
  });
});
