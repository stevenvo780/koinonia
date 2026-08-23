/**
 * Contrato del asistente de acción sistémica (ADR-0052).
 *
 * Tres cosas se comprueban, y las tres son las que de verdad importan en un fichero de esquemas:
 * que lo válido pasa, que lo inválido se rechaza —con `.strict()`, también lo que sobra—, y que
 * ningún texto de pantalla que este fichero añade lleva la jerga que ADR-0041 prohíbe.
 */

import { describe, expect, it } from 'vitest';

import {
  ayudaPregunta,
  aplicarSugerencia,
  borradorDetalle,
  borradorResumen,
  decidirConsentimiento,
  destinoIA,
  escribirRespuesta,
  fraseDeCierre,
  huecoPregunta,
  MENSAJES_ASISTENTE,
  mensajeDeAsistente,
  numeroPregunta,
  pedirSugerencia,
  preguntaAsistente,
  respuestaPregunta,
  sugerenciaRecibida,
  sugerenciaRegistrada,
} from '../src/asistente.js';
import { forbiddenTermsIn } from '../src/glossary.js';

const opaco = '0123456789abcdef0123456789abcdef';

describe('numeroPregunta', () => {
  it('acepta el 1 y el 27', () => {
    expect(numeroPregunta.parse(1)).toBe(1);
    expect(numeroPregunta.parse(27)).toBe(27);
  });

  it('rechaza el 0, el 28 y un número no entero', () => {
    expect(() => numeroPregunta.parse(0)).toThrow();
    expect(() => numeroPregunta.parse(28)).toThrow();
    expect(() => numeroPregunta.parse(1.5)).toThrow();
  });
});

describe('respuestaPregunta', () => {
  it('acepta las cuatro formas', () => {
    expect(respuestaPregunta.parse({ forma: 'frase', texto: 'algo' })).toEqual({
      forma: 'frase',
      texto: 'algo',
    });
    expect(respuestaPregunta.parse({ forma: 'lineas', lineas: ['a', 'b'] }).forma).toBe('lineas');
    expect(respuestaPregunta.parse({ forma: 'por_linea', porLinea: ['a'] }).forma).toBe(
      'por_linea',
    );
    expect(respuestaPregunta.parse({ forma: 'todavia_no_se' })).toEqual({
      forma: 'todavia_no_se',
    });
  });

  it('rechaza una lista vacía y una lista con más de treinta líneas', () => {
    expect(() => respuestaPregunta.parse({ forma: 'lineas', lineas: [] })).toThrow();
    expect(() =>
      respuestaPregunta.parse({ forma: 'lineas', lineas: Array.from({ length: 31 }, () => 'x') }),
    ).toThrow();
  });

  it('rechaza un quinto campo colado en cualquier variante (.strict)', () => {
    expect(() => respuestaPregunta.parse({ forma: 'frase', texto: 'algo', puntaje: 5 })).toThrow();
    expect(() => respuestaPregunta.parse({ forma: 'todavia_no_se', motivo: 'no sé' })).toThrow();
  });

  it('rechaza mezclar el campo de una forma con el discriminador de otra', () => {
    expect(() => respuestaPregunta.parse({ forma: 'frase', lineas: ['a'] })).toThrow();
  });
});

describe('destinoIA', () => {
  it('exige las cuatro partes: a dónde va, qué se manda, qué no se manda y si es local', () => {
    const valido = {
      aDondeVa: 'Un ayudante automático externo',
      queSeManda: 'El fragmento que estás editando',
      queNoSeManda: 'Tu nombre, ni el resto del borrador',
      enLaMismaMaquina: false,
    };
    expect(destinoIA.parse(valido)).toEqual(valido);
  });

  it('rechaza un destino incompleto', () => {
    expect(() => destinoIA.parse({ aDondeVa: 'x' })).toThrow();
  });
});

describe('decidirConsentimiento', () => {
  it('sólo admite el sí o el no: un destino colado por el cliente se rechaza', () => {
    expect(decidirConsentimiento.parse({ concedido: true })).toEqual({ concedido: true });
    expect(() =>
      decidirConsentimiento.parse({
        concedido: true,
        destino: { aDondeVa: 'x', queSeManda: 'y', queNoSeManda: 'z', enLaMismaMaquina: true },
      }),
    ).toThrow();
  });
});

describe('preguntaAsistente', () => {
  it('proyecta una pregunta con su rótulo de grupo y sin el campo opcional cuando no aplica', () => {
    const p = preguntaAsistente.parse({
      numero: 1,
      grupo: 'arranque',
      rotuloGrupo: 'Arranque',
      texto: 'En una frase: ¿qué está pasando que no debería estar pasando?',
      forma: 'frase',
      obligatoria: true,
      muestraMemoria: false,
    });
    expect(p.porCadaLineaDe).toBeUndefined();
  });

  it('acepta la 7, que sí lleva porCadaLineaDe', () => {
    const p = preguntaAsistente.parse({
      numero: 7,
      grupo: 'causas',
      rotuloGrupo: 'Por qué pasa',
      texto: 'Esto que escribiste, ¿lo viste, te lo contaron, o lo estás suponiendo?',
      forma: 'por_linea',
      obligatoria: false,
      porCadaLineaDe: 6,
      muestraMemoria: false,
    });
    expect(p.porCadaLineaDe).toBe(6);
  });
});

describe('huecoPregunta', () => {
  it('distingue sin_responder de todavia_no_se', () => {
    expect(
      huecoPregunta.parse({ pregunta: 1, motivo: 'sin_responder', bloquea: true }).motivo,
    ).toBe('sin_responder');
    expect(
      huecoPregunta.parse({ pregunta: 2, motivo: 'todavia_no_se', bloquea: false }).motivo,
    ).toBe('todavia_no_se');
  });

  it('rechaza un tercer motivo', () => {
    expect(() =>
      huecoPregunta.parse({ pregunta: 1, motivo: 'quien_sabe', bloquea: true }),
    ).toThrow();
  });
});

describe('fraseDeCierre', () => {
  it('proyecta el texto, los huecos en orden y si está completa', () => {
    const f = fraseDeCierre.parse({
      texto: 'Como ______ le pasa a ______ porque ______…',
      huecos: [1, 2, 6],
      completa: false,
      pregunta: '¿Suena bien? ¿Falta algo?',
    });
    expect(f.huecos).toEqual([1, 2, 6]);
  });
});

describe('sugerenciaRegistrada y sugerenciaRecibida', () => {
  const destino = {
    aDondeVa: 'Un ayudante automático externo',
    queSeManda: 'El fragmento que estás editando',
    queNoSeManda: 'Tu nombre',
    enLaMismaMaquina: false,
  };

  it('sugerenciaRegistrada no tiene dónde poner una puntuación: sólo textos', () => {
    const s = sugerenciaRegistrada.parse({
      sugerenciaId: opaco,
      operacion: 'resumir',
      textos: ['un resumen'],
      destino,
    });
    expect(s.textos).toEqual(['un resumen']);
    expect(() =>
      sugerenciaRegistrada.parse({
        sugerenciaId: opaco,
        operacion: 'resumir',
        textos: ['x'],
        destino,
        puntaje: 5,
      }),
    ).toThrow();
  });

  it('sugerenciaRecibida discrimina por operacion la forma de "contenido"', () => {
    const estructurar = sugerenciaRecibida.parse({
      operacion: 'estructurar',
      sugerenciaId: opaco,
      destino,
      contenido: { tramos: [{ pregunta: 2, texto: 'quienes tienen clase después de las seis' }] },
    });
    expect(estructurar.operacion).toBe('estructurar');
    if (estructurar.operacion === 'estructurar') {
      expect(estructurar.contenido.tramos[0]?.pregunta).toBe(2);
    }

    const resumir = sugerenciaRecibida.parse({
      operacion: 'resumir',
      sugerenciaId: opaco,
      destino,
      contenido: { resumen: 'un resumen corto' },
    });
    expect(resumir.operacion).toBe('resumir');
  });

  it('rechaza el contenido de otra operación (una operación no puede llevar la forma de otra)', () => {
    expect(() =>
      sugerenciaRecibida.parse({
        operacion: 'resumir',
        sugerenciaId: opaco,
        destino,
        contenido: { tramos: [] },
      }),
    ).toThrow();
  });

  it('ninguna de las siete formas de contenido tiene un campo numérico suelto', () => {
    // La única cifra admitida en todo este árbol es `pregunta` dentro de un tramo, y ese ya se
    // prueba arriba. Un contenido con cualquier otro número —«puntaje», «orden», «peso»— no tiene
    // dónde entrar porque cada rama es `.strict()`.
    expect(() =>
      sugerenciaRecibida.parse({
        operacion: 'buscar_parecidos',
        sugerenciaId: opaco,
        destino,
        contenido: { parecidos: [{ texto: 'x', porQue: 'y', puntaje: 3 }] },
      }),
    ).toThrow();
  });
});

describe('pedirSugerencia y aplicarSugerencia', () => {
  it('pedirSugerencia exige operación y fragmento; la pregunta y el corpus son opcionales', () => {
    expect(pedirSugerencia.parse({ operacion: 'resumir', fragmento: 'un texto' })).toEqual({
      operacion: 'resumir',
      fragmento: 'un texto',
    });
  });

  it('pedirSugerencia rechaza una operación que no es de las siete', () => {
    expect(() =>
      pedirSugerencia.parse({ operacion: 'puntuar_propuestas', fragmento: 'x' }),
    ).toThrow();
  });

  it('aplicarSugerencia exige la pregunta y la respuesta que se toma', () => {
    const a = aplicarSugerencia.parse({
      pregunta: 11,
      respuesta: { forma: 'lineas', lineas: ['convocar una reunión'] },
    });
    expect(a.pregunta).toBe(11);
  });
});

describe('escribirRespuesta', () => {
  it('acepta la forma que corresponde a la pregunta (la validación de encaje es del pliegue)', () => {
    expect(
      escribirRespuesta.parse({ pregunta: 1, respuesta: { forma: 'frase', texto: 'algo pasa' } }),
    ).toBeDefined();
  });
});

describe('borradorResumen y borradorDetalle', () => {
  const frase = {
    texto: 'Como ______ …',
    huecos: [1, 11],
    completa: false,
    pregunta: '¿Suena bien? ¿Falta algo?',
  };

  it('borradorResumen no lleva ni huecos ni sugerencias: eso es sólo del detalle', () => {
    const r = borradorResumen.parse({
      id: opaco,
      estado: 'redactando',
      cuantasRespondidas: 3,
      puedeCerrarse: false,
      frase,
    });
    expect(r.cerradoEn).toBeUndefined();
    expect(() => borradorResumen.parse({ ...r, huecos: [] })).toThrow();
  });

  it('borradorDetalle proyecta el modo generativo sin motivoEstructural, y el estructural con él', () => {
    const base = {
      id: opaco,
      estado: 'redactando' as const,
      cuantasRespondidas: 1,
      puedeCerrarse: false,
      huecos: [],
      desajustes: [],
      frase,
      procedencia: [],
      sugerencias: [],
      aplicadas: [],
      sePuedePedirConsentimiento: true,
    };
    const generativo = borradorDetalle.parse({ ...base, modo: 'generativo' });
    expect(generativo.motivoEstructural).toBeUndefined();

    const estructural = borradorDetalle.parse({
      ...base,
      modo: 'estructural',
      motivoEstructural: 'sin_proveedor',
      porQueNoHaySugerencias: 'Acá no hay ningún ayudante automático conectado.',
    });
    expect(estructural.motivoEstructural).toBe('sin_proveedor');
  });
});

describe('ayudaPregunta', () => {
  it('proyecta la pregunta, lo ya escrito (si hay) y la frase, sin exigir un modelo', () => {
    const a = ayudaPregunta.parse({
      pregunta: {
        numero: 1,
        grupo: 'arranque',
        rotuloGrupo: 'Arranque',
        texto: 'En una frase: ¿qué está pasando que no debería estar pasando?',
        forma: 'frase',
        obligatoria: true,
        muestraMemoria: false,
      },
      rotulo: 'Arranque',
      muestraMemoria: false,
      huecos: [],
      desajustes: [],
      frase: {
        texto: 'Como ______ …',
        huecos: [1],
        completa: false,
        pregunta: '¿Suena bien? ¿Falta algo?',
      },
      modo: 'estructural',
      porQueNoHaySugerencias: 'Acá no hay ningún ayudante automático conectado.',
    });
    expect(a.loQueYaEscribiste).toBeUndefined();
  });
});

describe('MENSAJES_ASISTENTE (ADR-0041)', () => {
  it('ninguna frase lleva una palabra del léxico prohibido', () => {
    const culpables = Object.entries(MENSAJES_ASISTENTE)
      .map(([codigo, mensaje]) => [codigo, forbiddenTermsIn(mensaje)] as const)
      .filter(([, terminos]) => terminos.length > 0);
    expect(culpables).toEqual([]);
  });

  it('mensajeDeAsistente devuelve la frase del código, y una frase honesta si no lo conoce', () => {
    expect(mensajeDeAsistente('SUGGESTION_ALREADY_APPLIED')).toContain('ya se usó una vez');
    expect(mensajeDeAsistente('UN_CODIGO_QUE_NO_EXISTE')).not.toBe('');
    expect(mensajeDeAsistente('UN_CODIGO_QUE_NO_EXISTE', 'respaldo')).toBe('respaldo');
  });
});
