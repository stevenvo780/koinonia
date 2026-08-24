/**
 * T-25 (`docs/THREAT_MODEL.md`): la marca `assisted` en `versionRespuesta` y en
 * `procedenciaDeRespuesta`.
 *
 * Fichero nuevo y separado de `asistente.test.ts` a propósito: ese fichero no es de este encargo
 * (T-25/T-19), así que esta prueba no lo toca y sólo añade cobertura para el campo nuevo.
 */

import { describe, expect, it } from 'vitest';

import { procedenciaDeRespuesta, versionRespuesta } from '../src/asistente.js';

const opaco = '0123456789abcdef0123456789abcdef';

describe('versionRespuesta — la marca `assisted` (T-25)', () => {
  it('acepta `assisted: true` cuando el origen es "sugerencia"', () => {
    const parsed = versionRespuesta.parse({
      pregunta: 11,
      respuesta: { forma: 'frase', texto: 'convocar una reunión' },
      origen: 'sugerencia',
      assisted: true,
      sugerenciaId: opaco,
      escritaEn: 1_700_000_000_000,
      seq: 3,
    });
    expect(parsed.assisted).toBe(true);
  });

  it('acepta `assisted: false` cuando el origen es "mano"', () => {
    const parsed = versionRespuesta.parse({
      pregunta: 1,
      respuesta: { forma: 'frase', texto: 'algo que pasó' },
      origen: 'mano',
      assisted: false,
      escritaEn: 1_700_000_000_000,
      seq: 1,
    });
    expect(parsed.assisted).toBe(false);
  });

  it('rechaza que falte `assisted`: no es un campo opcional', () => {
    expect(() =>
      versionRespuesta.parse({
        pregunta: 1,
        respuesta: { forma: 'frase', texto: 'algo' },
        origen: 'mano',
        escritaEn: 1_700_000_000_000,
        seq: 1,
      }),
    ).toThrow();
  });

  it('rechaza `assisted` como algo que no sea booleano', () => {
    expect(() =>
      versionRespuesta.parse({
        pregunta: 1,
        respuesta: { forma: 'frase', texto: 'algo' },
        origen: 'mano',
        assisted: 'no',
        escritaEn: 1_700_000_000_000,
        seq: 1,
      }),
    ).toThrow();
  });
});

describe('procedenciaDeRespuesta — la misma marca `assisted` (T-25)', () => {
  it('acepta `assisted: true` con "sugerencia" y lo exige presente', () => {
    const parsed = procedenciaDeRespuesta.parse({
      pregunta: 11,
      origen: 'sugerencia',
      assisted: true,
      sugerenciaId: opaco,
      escritaEn: 1_700_000_000_000,
      seq: 3,
      versiones: 2,
    });
    expect(parsed.assisted).toBe(true);

    expect(() =>
      procedenciaDeRespuesta.parse({
        pregunta: 11,
        origen: 'sugerencia',
        sugerenciaId: opaco,
        escritaEn: 1_700_000_000_000,
        seq: 3,
        versiones: 2,
      }),
    ).toThrow();
  });
});
