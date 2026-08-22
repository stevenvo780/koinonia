/**
 * Métrica 5 — razón deliberación/votación y unanimidad.
 *
 * El caso límite que importa: cero votaciones. Un cociente con denominador cero no es «infinito
 * deliberación», es que no hay razón que calcular, y confundirlo produce un panel que anuncia salud
 * perfecta la semana en que no se decidió nada.
 */

import { toFractionString } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { informeDeDeliberacion } from '../src/index.js';
import { DIA, entradaDeliberacion, ORIGEN, VENTANA } from './datos.js';

const CUANDO = ORIGEN + 3 * DIA;

describe('5 — deliberación por votación', () => {
  it('sin nada de nada, ninguna razón: no hay datos, no hay cero', () => {
    const informe = informeDeDeliberacion(entradaDeliberacion([], []));
    expect(informe.razon.hay).toBe(false);
    expect(informe.unanimidad.hay).toBe(false);
    expect(informe.intervencionesPorVotacion.hay).toBe(false);
  });

  it('deliberaciones sin ninguna votación tampoco dan razón', () => {
    const informe = informeDeDeliberacion(
      entradaDeliberacion([{ instante: CUANDO, intervenciones: 9 }], []),
    );
    expect(informe.deliberaciones).toBe(1);
    expect(informe.intervenciones).toBe(9);
    expect(informe.razon.hay).toBe(false);
  });

  it('la razón puede pasar de 1, y debe poder: tres conversaciones por votación es 3/1', () => {
    const informe = informeDeDeliberacion(
      entradaDeliberacion(
        [
          { instante: CUANDO, intervenciones: 4 },
          { instante: CUANDO, intervenciones: 5 },
          { instante: CUANDO, intervenciones: 6 },
        ],
        [{ instante: CUANDO, unanime: false, conDeliberacionPrevia: true }],
      ),
    );
    expect(toFractionString(informe.razon.hay ? informe.razon.valor : { num: 0n, den: 1n })).toBe(
      '3/1',
    );
    expect(
      toFractionString(
        informe.intervencionesPorVotacion.hay
          ? informe.intervencionesPorVotacion.valor
          : { num: 0n, den: 1n },
      ),
    ).toBe('15/1');
  });

  it('votar sin conversar: razón 0 y las votaciones sin conversación previa contadas', () => {
    const informe = informeDeDeliberacion(
      entradaDeliberacion(
        [],
        [
          { instante: CUANDO, unanime: true, conDeliberacionPrevia: false },
          { instante: CUANDO, unanime: true, conDeliberacionPrevia: false },
        ],
      ),
    );
    expect(informe.razon.hay && toFractionString(informe.razon.valor)).toBe('0/2');
    expect(informe.votacionesSinDeliberacionPrevia).toBe(2);
  });

  it('unanimidad total ⇒ 3/3, que NO lleva alarma a propósito', () => {
    const informe = informeDeDeliberacion(
      entradaDeliberacion(
        [{ instante: CUANDO, intervenciones: 2 }],
        [
          { instante: CUANDO, unanime: true, conDeliberacionPrevia: true },
          { instante: CUANDO, unanime: true, conDeliberacionPrevia: true },
          { instante: CUANDO, unanime: true, conDeliberacionPrevia: true },
        ],
      ),
    );
    expect(informe.unanimidad.hay && toFractionString(informe.unanimidad.valor)).toBe('3/3');
    // No existe un campo `alarma` aquí: §6 no da umbral y no se inventa uno. Que todo salga por
    // unanimidad puede ser acuerdo o puede ser que el disenso se fue, y eso no lo decide un número.
    expect('alarma' in informe).toBe(false);
  });

  it('sólo cuenta lo que cae dentro de la ventana', () => {
    const informe = informeDeDeliberacion(
      entradaDeliberacion(
        [
          { instante: VENTANA.desde - DIA, intervenciones: 100 },
          { instante: CUANDO, intervenciones: 3 },
        ],
        [
          { instante: VENTANA.hasta, unanime: true, conDeliberacionPrevia: true },
          { instante: CUANDO, unanime: false, conDeliberacionPrevia: true },
        ],
      ),
    );
    expect(informe.deliberaciones).toBe(1);
    expect(informe.intervenciones).toBe(3);
    expect(informe.votaciones).toBe(1);
  });

  it('un número de intervenciones que no es un entero no negativo se rechaza', () => {
    expect(() =>
      informeDeDeliberacion(entradaDeliberacion([{ instante: CUANDO, intervenciones: -2 }], [])),
    ).toThrow(/entero no negativo/u);
  });
});
