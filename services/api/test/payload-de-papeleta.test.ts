/**
 * `payloadDePapeleta`: de lo que manda la interfaz a la papeleta que el dominio valida y cuenta.
 *
 * Las ramas `score`, `ranking` y `grades` son las que desbloquean puntuación, voto por rondas,
 * valoración por menciones y comparación por pares — hasta ahora implementadas y probadas en
 * `packages/domain/src/tally/` pero inalcanzables porque esta función sólo sabía convertir
 * `binary`/`abstain`/`consent`. La forma que reciben (una LISTA de pares `{opcion, valor}` /
 * `{opcion, mencion}`, nunca un mapa con la opción de clave) es la misma que exige
 * `BallotPayload` del dominio (`packages/domain/src/ballot.ts`): un identificador de opción no
 * puede ser clave de ningún objeto que termine en el historial, porque el serializador canónico
 * exige que toda clave empiece por letra y un `OptionId` no lo hace la mayoría de las veces (32
 * hexadecimales al azar, ~62 % empieza por dígito).
 */

import { describe, expect, it } from 'vitest';

import { payloadDePapeleta, type RespuestaPapeleta } from '../src/http/service.js';

const CTX = { ronda: 1, objecionId: '1'.repeat(32) };

// Empieza por dígito a propósito: es la mayoría de los identificadores reales, y es exactamente el
// caso que rompía el historial cuando la opción viajaba como clave de un mapa.
const OPCION_A = '0184fbe5000000000000000000000000';
const OPCION_B = 'ab000000000000000000000000000000';

describe('payloadDePapeleta — score', () => {
  it('una nota por opción arma una lista de pares {option, value}', () => {
    const respuesta: RespuestaPapeleta = {
      tipo: 'score',
      puntuaciones: [
        { opcion: OPCION_A, valor: 5 },
        { opcion: OPCION_B, valor: 0 },
      ],
    };
    expect(payloadDePapeleta(respuesta, CTX)).toEqual({
      kind: 'score',
      scores: [
        { option: OPCION_A, value: 5 },
        { option: OPCION_B, value: 0 },
      ],
    });
  });

  /**
   * «Sin opinión» es la opción AUSENTE de la lista, nunca un `valor: null`: el perfil canónico del
   * historial prohíbe `null` como cualquier valor (`packages/crypto/src/canonical.ts`,
   * `allowNull: false`), así que la papeleta jamás puede prometer transportarlo.
   */
  it('la opción que no viene en la lista queda fuera: es «sin opinión», no cero', () => {
    const respuesta: RespuestaPapeleta = {
      tipo: 'score',
      puntuaciones: [{ opcion: OPCION_A, valor: 3 }],
    };
    const payload = payloadDePapeleta(respuesta, CTX);
    expect(payload).toEqual({ kind: 'score', scores: [{ option: OPCION_A, value: 3 }] });
    expect(payload.kind === 'score' && payload.scores.some((e) => e.option === OPCION_B)).toBe(
      false,
    );
  });

  it('una lista vacía —o ausente— es una papeleta válida sin ninguna opinión', () => {
    expect(payloadDePapeleta({ tipo: 'score', puntuaciones: [] }, CTX)).toEqual({
      kind: 'score',
      scores: [],
    });
    expect(payloadDePapeleta({ tipo: 'score' }, CTX)).toEqual({ kind: 'score', scores: [] });
  });
});

describe('payloadDePapeleta — ranking', () => {
  it('el orden se traduce a una lista de identificadores de opción, en el mismo orden', () => {
    const respuesta: RespuestaPapeleta = { tipo: 'ranking', orden: [OPCION_B, OPCION_A] };
    expect(payloadDePapeleta(respuesta, CTX)).toEqual({
      kind: 'ranking',
      order: [OPCION_B, OPCION_A],
    });
  });

  it('sin orden, la papeleta trae un orden vacío (que el dominio rechaza, no esta función)', () => {
    expect(payloadDePapeleta({ tipo: 'ranking' }, CTX)).toEqual({ kind: 'ranking', order: [] });
  });
});

describe('payloadDePapeleta — grades', () => {
  it('una mención por opción arma una lista de pares {option, grade}', () => {
    const respuesta: RespuestaPapeleta = {
      tipo: 'grades',
      menciones: [
        { opcion: OPCION_A, mencion: 'excelente' },
        { opcion: OPCION_B, mencion: 'rechazar' },
      ],
    };
    expect(payloadDePapeleta(respuesta, CTX)).toEqual({
      kind: 'grades',
      grades: [
        { option: OPCION_A, grade: 'excelente' },
        { option: OPCION_B, grade: 'rechazar' },
      ],
    });
  });

  it('la opción que no viene en la lista queda sin mención (majority-judgment decide qué hacer)', () => {
    const respuesta: RespuestaPapeleta = {
      tipo: 'grades',
      menciones: [{ opcion: OPCION_A, mencion: 'excelente' }],
    };
    const payload = payloadDePapeleta(respuesta, CTX);
    expect(payload).toEqual({ kind: 'grades', grades: [{ option: OPCION_A, grade: 'excelente' }] });
    expect(payload.kind === 'grades' && payload.grades.some((e) => e.option === OPCION_B)).toBe(
      false,
    );
  });
});
