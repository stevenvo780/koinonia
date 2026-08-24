/**
 * Contrato de la búsqueda de aprendizajes por parecido (ADR-0053, incremento «lectura»).
 *
 * Tres cosas se comprueban:
 *
 *  1. **Los límites del esquema son los que dice la cabecera** — no un número que se corrió sin que
 *     nadie se diera cuenta.
 *  2. **`coincidenciaDeAprendizaje` es `entradaDeMemoria` MÁS `similitud`/`palabrasCoincidentes`**,
 *     nunca menos: si algún día `entradaDeMemoria` gana un campo y este contrato no lo hereda, esta
 *     prueba no lo va a notar sola porque usa `.extend`, así que en cambio comprueba que una fila
 *     real de `entradaDeMemoria` sigue pasando con los dos campos nuevos encima.
 *  3. **La regla de oro (ADR-0041)**: nada de lo nuevo que aporta este fichero cae en el vocabulario
 *     prohibido.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  buscarAprendizajesParecidos,
  coincidenciaDeAprendizaje,
  LIMITE_RESULTADOS_MAXIMO,
  LIMITE_RESULTADOS_POR_DEFECTO,
  MAX_LONGITUD_CUERPO_PROBLEMA,
  MAX_LONGITUD_TITULO_PROBLEMA,
  MIN_LONGITUD_TITULO_PROBLEMA,
  resultadoDeBusquedaDeAprendizajes,
} from '../src/aprendizajes.js';
import { entradaDeMemoria } from '../src/evaluacion.js';
import { forbiddenTermsIn } from '../src/glossary.js';

describe('buscarAprendizajesParecidos: el problema nuevo', () => {
  it('acepta sólo un título', () => {
    const resultado = buscarAprendizajesParecidos.parse({ titulo: 'La sala cierra muy temprano' });
    expect(resultado.titulo).toBe('La sala cierra muy temprano');
    expect(resultado.cuerpo).toBeUndefined();
    expect(resultado.limite).toBeUndefined();
  });

  it('acepta título, cuerpo y los cinco filtros que ya admite GET /aprendizajes', () => {
    const resultado = buscarAprendizajesParecidos.parse({
      titulo: 'La sala de estudio cierra muy temprano para la jornada nocturna',
      cuerpo: 'Varias personas reportan que no alcanzan a estudiar después de las siete.',
      limite: '10',
      etiqueta: 'horarios',
      tipo: 'lo-que-no-funciono',
      desenlace: 'fallido',
      circuloId: 'a'.repeat(32),
      decisionId: 'b'.repeat(32),
    });
    // `limite` llega como texto por la querystring: el esquema lo coacciona a número.
    expect(resultado.limite).toBe(10);
  });

  it(`rechaza un título de menos de ${String(MIN_LONGITUD_TITULO_PROBLEMA)} caracteres`, () => {
    expect(() => buscarAprendizajesParecidos.parse({ titulo: 'ss' })).toThrow(z.ZodError);
  });

  it(`rechaza un título de más de ${String(MAX_LONGITUD_TITULO_PROBLEMA)} caracteres`, () => {
    expect(() =>
      buscarAprendizajesParecidos.parse({ titulo: 'x'.repeat(MAX_LONGITUD_TITULO_PROBLEMA + 1) }),
    ).toThrow(z.ZodError);
  });

  it(`rechaza un cuerpo de más de ${String(MAX_LONGITUD_CUERPO_PROBLEMA)} caracteres`, () => {
    expect(() =>
      buscarAprendizajesParecidos.parse({
        titulo: 'La sala cierra muy temprano',
        cuerpo: 'x'.repeat(MAX_LONGITUD_CUERPO_PROBLEMA + 1),
      }),
    ).toThrow(z.ZodError);
  });

  it('rechaza un límite por encima del máximo', () => {
    expect(() =>
      buscarAprendizajesParecidos.parse({
        titulo: 'La sala cierra muy temprano',
        limite: LIMITE_RESULTADOS_MAXIMO + 1,
      }),
    ).toThrow(z.ZodError);
    // El propio máximo sí pasa.
    expect(
      buscarAprendizajesParecidos.parse({
        titulo: 'La sala cierra muy temprano',
        limite: LIMITE_RESULTADOS_MAXIMO,
      }).limite,
    ).toBe(LIMITE_RESULTADOS_MAXIMO);
  });

  it('rechaza una etiqueta fuera del formato [a-z][a-z0-9_]{0,31}', () => {
    expect(() =>
      buscarAprendizajesParecidos.parse({
        titulo: 'La sala cierra muy temprano',
        etiqueta: 'Horarios Malos',
      }),
    ).toThrow(z.ZodError);
  });

  it('rechaza un tipo fuera del vocabulario cerrado de aprendizajes', () => {
    expect(() =>
      buscarAprendizajesParecidos.parse({ titulo: 'La sala cierra muy temprano', tipo: 'exito' }),
    ).toThrow(z.ZodError);
  });

  it('LIMITE_RESULTADOS_POR_DEFECTO no supera a LIMITE_RESULTADOS_MAXIMO', () => {
    expect(LIMITE_RESULTADOS_POR_DEFECTO).toBeLessThanOrEqual(LIMITE_RESULTADOS_MAXIMO);
  });
});

describe('coincidenciaDeAprendizaje: entradaDeMemoria + por qué apareció', () => {
  const filaDeMemoria = {
    evaluacionId: 'a'.repeat(32),
    iniciativaId: 'b'.repeat(32),
    decisionId: 'c'.repeat(32),
    propuestaId: 'd'.repeat(32),
    circuloId: 'e'.repeat(32),
    desenlace: 'logrado',
    aprendizaje: {
      id: 'f'.repeat(32),
      tipo: 'lo-que-funciono',
      enunciado: 'Convocar con dos semanas de margen dejó tiempo real para reunir evidencia.',
      etiquetas: ['horarios'],
      en: 1_700_000_000_000,
    },
  };

  it('una fila real de entradaDeMemoria pasa aquí encima con similitud y palabrasCoincidentes', () => {
    // Comprueba el punto 2 de la cabecera: si el día de mañana `entradaDeMemoria` cambia y esta fila
    // deja de tener sentido como `EntradaDeMemoria`, esta línea es la que lo dice.
    expect(entradaDeMemoria.parse(filaDeMemoria)).toBeTruthy();
    const conParecido = coincidenciaDeAprendizaje.parse({
      ...filaDeMemoria,
      similitud: 0.5,
      palabrasCoincidentes: ['horarios'],
    });
    expect(conParecido.similitud).toBe(0.5);
    expect(conParecido.palabrasCoincidentes).toEqual(['horarios']);
  });

  it('rechaza una similitud fuera de [0, 1]', () => {
    expect(() =>
      coincidenciaDeAprendizaje.parse({
        ...filaDeMemoria,
        similitud: 1.5,
        palabrasCoincidentes: [],
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      coincidenciaDeAprendizaje.parse({
        ...filaDeMemoria,
        similitud: -0.1,
        palabrasCoincidentes: [],
      }),
    ).toThrow(z.ZodError);
  });

  it('rechaza una fila sin similitud: no es opcional', () => {
    expect(() =>
      coincidenciaDeAprendizaje.parse({ ...filaDeMemoria, palabrasCoincidentes: [] }),
    ).toThrow(z.ZodError);
  });

  it('resultadoDeBusquedaDeAprendizajes es un arreglo de coincidencias, y admite el vacío', () => {
    expect(resultadoDeBusquedaDeAprendizajes.parse([])).toEqual([]);
    expect(
      resultadoDeBusquedaDeAprendizajes.parse([
        { ...filaDeMemoria, similitud: 1, palabrasCoincidentes: ['horarios'] },
      ]),
    ).toHaveLength(1);
  });
});

describe('la regla de oro (ADR-0041): nada de lo nuevo cae en el vocabulario prohibido', () => {
  const textosNuevos = [
    'similitud',
    'palabrasCoincidentes',
    'titulo',
    'cuerpo',
    'limite',
    'buscarAprendizajesParecidos',
    'coincidenciaDeAprendizaje',
  ];

  it.each(textosNuevos)('%s no lleva jerga del motor', (texto) => {
    expect(forbiddenTermsIn(texto)).toEqual([]);
  });
});
