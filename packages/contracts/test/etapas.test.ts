/**
 * `etapas.ts`: los contratos dedicados de `objeciones` y `enmiendas`.
 *
 * Tres cosas se comprueban:
 *
 *  1. Que el tipo admitido por cada esquema coincide EXACTAMENTE con `STAGE_RULES` del dominio —la
 *     única fuente de verdad de qué cabe en cada etapa (`packages/domain/src/deliberation/
 *     state-machine.ts`)—, y no una copia que se puede desalinear con el tiempo.
 *  2. Que `corrigeA` es obligatorio en la rama `alternativa` de `enmienda` — la arista que
 *     `STAGE_RULES.enmiendas.alternativeMustSupersede` exige en tiempo de ejecución, acá exigida en
 *     tiempo de compilación y de parseo.
 *  3. Que `saleDe` y `corrigeA` son dos campos distintos: nada en el esquema los confunde ni los
 *     junta, así que la distinción sigue viva incluso antes de que el motor la valide.
 */

import { REASON_RELATIONS, STAGE_RULES } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import {
  enmienda,
  objecion,
  TIPOS_ADMITIDOS_EN_ENMIENDAS,
  TIPOS_ADMITIDOS_EN_OBJECIONES,
} from '../src/etapas.js';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const ID_A = '1'.repeat(32);
const ID_B = '2'.repeat(32);
const TEXTO_VALIDO = 'Un texto de longitud suficiente para pasar el mínimo de veinte caracteres.';

describe('etapas — coincide con STAGE_RULES del dominio', () => {
  it('TIPOS_ADMITIDOS_EN_OBJECIONES es exactamente STAGE_RULES.objeciones.kinds', () => {
    expect(TIPOS_ADMITIDOS_EN_OBJECIONES).toEqual(STAGE_RULES['objeciones'].kinds);
  });

  it('TIPOS_ADMITIDOS_EN_ENMIENDAS es exactamente STAGE_RULES.enmiendas.kinds', () => {
    expect(TIPOS_ADMITIDOS_EN_ENMIENDAS).toEqual(STAGE_RULES['enmiendas'].kinds);
  });

  it('enmiendas exige que la alternativa supersede a otra, según el propio dominio', () => {
    expect(STAGE_RULES['enmiendas'].alternativeMustSupersede).toBe(true);
  });
});

describe('objecion — sólo lo que STAGE_RULES.objeciones admite', () => {
  it('acepta un riesgo', () => {
    const analizado = objecion.parse({
      requestId: REQUEST_ID,
      tipo: 'riesgo',
      salidaId: ID_A,
      gravedad: 3,
      impacto: TEXTO_VALIDO,
      mitigacion: TEXTO_VALIDO,
    });
    expect(analizado.tipo).toBe('riesgo');
  });

  it.each(REASON_RELATIONS)('acepta una razón que %s', (relacion) => {
    const analizado = objecion.parse({
      requestId: REQUEST_ID,
      tipo: 'razon',
      relacion,
      posicionId: ID_A,
      texto: TEXTO_VALIDO,
    });
    expect(analizado.tipo).toBe('razon');
  });

  it('acepta una evidencia', () => {
    expect(() =>
      objecion.parse({
        requestId: REQUEST_ID,
        tipo: 'evidencia',
        sostieneRazonId: ID_A,
        texto: TEXTO_VALIDO,
      }),
    ).not.toThrow();
  });

  it('acepta un supuesto', () => {
    expect(() =>
      objecion.parse({
        requestId: REQUEST_ID,
        tipo: 'supuesto',
        aplicaA: [ID_A],
        texto: TEXTO_VALIDO,
      }),
    ).not.toThrow();
  });

  it('rechaza una posición: no cabe en objeciones', () => {
    expect(() =>
      objecion.parse({
        requestId: REQUEST_ID,
        tipo: 'posicion',
        modo: 'afirmacion',
        texto: TEXTO_VALIDO,
      }),
    ).toThrow();
  });

  it('rechaza una alternativa: eso es de construccion_alternativas o de enmiendas, no de objeciones', () => {
    expect(() =>
      objecion.parse({
        requestId: REQUEST_ID,
        tipo: 'alternativa',
        problemaId: ID_A,
        saleDe: [ID_B],
        texto: TEXTO_VALIDO,
      }),
    ).toThrow();
  });

  it('rechaza un campo desconocido (el esquema es estricto)', () => {
    expect(() =>
      objecion.parse({
        requestId: REQUEST_ID,
        tipo: 'riesgo',
        salidaId: ID_A,
        gravedad: 3,
        impacto: TEXTO_VALIDO,
        mitigacion: TEXTO_VALIDO,
        campoQueNoExiste: 'algo',
      }),
    ).toThrow();
  });

  it('rechaza un texto por debajo del mínimo', () => {
    expect(() =>
      objecion.parse({
        requestId: REQUEST_ID,
        tipo: 'supuesto',
        aplicaA: [ID_A],
        texto: 'muy corto',
      }),
    ).toThrow();
  });
});

describe('enmienda — sólo lo que STAGE_RULES.enmiendas admite, con la arista obligatoria', () => {
  it('acepta una alternativa CON corrigeA y saleDe apuntando a posiciones', () => {
    const analizado = enmienda.parse({
      requestId: REQUEST_ID,
      tipo: 'alternativa',
      problemaId: ID_A,
      saleDe: [ID_B],
      texto: TEXTO_VALIDO,
      corrigeA: ID_A,
    });
    expect(analizado.tipo).toBe('alternativa');
    if (analizado.tipo === 'alternativa') {
      expect(analizado.corrigeA).toBe(ID_A);
      expect(analizado.saleDe).toEqual([ID_B]);
      // Dos campos distintos, con valores distintos: el esquema no los confunde entre sí.
      expect(analizado.corrigeA).not.toEqual(analizado.saleDe[0]);
    }
  });

  it('RECHAZA una alternativa SIN corrigeA — a diferencia del `aportar` genérico, acá es obligatorio', () => {
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'alternativa',
        problemaId: ID_A,
        saleDe: [ID_B],
        texto: TEXTO_VALIDO,
        // sin corrigeA
      }),
    ).toThrow();
  });

  it('acepta una razón, evidencia y supuesto (ahí corrigeA sigue siendo opcional)', () => {
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'razon',
        relacion: 'sostiene',
        posicionId: ID_A,
        texto: TEXTO_VALIDO,
      }),
    ).not.toThrow();
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'evidencia',
        sostieneRazonId: ID_A,
        texto: TEXTO_VALIDO,
      }),
    ).not.toThrow();
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'supuesto',
        aplicaA: [ID_A],
        texto: TEXTO_VALIDO,
      }),
    ).not.toThrow();
  });

  it('rechaza una posición: no cabe en enmiendas', () => {
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'posicion',
        modo: 'afirmacion',
        texto: TEXTO_VALIDO,
      }),
    ).toThrow();
  });

  it('rechaza un riesgo: eso es de objeciones, no de enmiendas', () => {
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'riesgo',
        salidaId: ID_A,
        gravedad: 2,
        impacto: TEXTO_VALIDO,
        mitigacion: TEXTO_VALIDO,
      }),
    ).toThrow();
  });

  it('rechaza saleDe vacío: una alternativa sin origen no la sostiene nadie', () => {
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'alternativa',
        problemaId: ID_A,
        saleDe: [],
        texto: TEXTO_VALIDO,
        corrigeA: ID_A,
      }),
    ).toThrow();
  });

  it('rechaza saleDe con un id repetido: es un conjunto, no una lista', () => {
    expect(() =>
      enmienda.parse({
        requestId: REQUEST_ID,
        tipo: 'alternativa',
        problemaId: ID_A,
        saleDe: [ID_B, ID_B],
        texto: TEXTO_VALIDO,
        corrigeA: ID_A,
      }),
    ).toThrow();
  });
});
