/**
 * Formación de grupos: sin azar, con desempates escritos y con etiquetas estables.
 *
 * El agrupamiento por k-medias es, en su forma habitual, doblemente aleatorio: las semillas se
 * eligen al azar (k-means++) y el número de grupo que le toca a cada cual depende de en qué
 * orden salieron esas semillas. Las dos cosas se han sustituido por reglas fijas, y las dos se
 * prueban aquí, porque de ellas depende que «el grupo 1» signifique lo mismo en dos ejecuciones
 * y, por tanto, que un informe se pueda contrastar con otro.
 */

import { describe, expect, it } from 'vitest';

import { kMaximoPara, kmeansDeterminista } from '../src/kmeans.js';
import type { Matrix } from '../src/matrix.js';

import { lcg } from './matrices.js';

/** Nube de puntos en dos dimensiones alrededor de centros dados. */
function nube(
  centros: ReadonlyArray<readonly [number, number]>,
  porCentro: number,
  semilla: number,
): Matrix {
  const r = lcg(semilla);
  const puntos: number[][] = [];
  for (const [cx, cy] of centros) {
    for (let i = 0; i < porCentro; i++) {
      puntos.push([cx + (r() - 0.5) * 0.4, cy + (r() - 0.5) * 0.4]);
    }
  }
  return puntos;
}

/** Reparte los índices por grupo. */
function particion(asignaciones: ReadonlyArray<number>): Map<number, number[]> {
  const m = new Map<number, number[]>();
  asignaciones.forEach((g, i) => {
    const lista = m.get(g) ?? [];
    lista.push(i);
    m.set(g, lista);
  });
  return m;
}

describe('tope de grupos', () => {
  it('sigue la fórmula min(12, ⌊√(n/2)⌋) y nunca baja de 2', () => {
    expect(kMaximoPara(2)).toBe(2);
    expect(kMaximoPara(8)).toBe(2);
    expect(kMaximoPara(18)).toBe(3);
    expect(kMaximoPara(32)).toBe(4);
    expect(kMaximoPara(50)).toBe(5);
    expect(kMaximoPara(200)).toBe(10);
    // El tope duro: por muchos participantes que haya, no se pasa de 12 grupos.
    expect(kMaximoPara(5000)).toBe(12);
  });
});

describe('grupos deterministas', () => {
  it('dos ejecuciones sobre los mismos puntos dan exactamente lo mismo', () => {
    const X = nube(
      [
        [0, 0],
        [6, 6],
        [0, 7],
      ],
      14,
      31337,
    );
    expect(kmeansDeterminista(X)).toEqual(kmeansDeterminista(X));
  });

  it('recupera nubes bien separadas', () => {
    const X = nube(
      [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
      12,
      555,
    );
    const r = kmeansDeterminista(X, 3);
    expect(r.k).toBe(3);
    const p = particion(r.asignaciones);
    expect(p.size).toBe(3);
    // Cada nube entera cae en un mismo grupo: los 12 primeros juntos, los 12 siguientes, etc.
    for (let bloque = 0; bloque < 3; bloque++) {
      const grupos = new Set(r.asignaciones.slice(bloque * 12, bloque * 12 + 12));
      expect(grupos.size).toBe(1);
    }
  });

  it('cada punto cae en exactamente un grupo y no se pierde ninguno', () => {
    const X = nube(
      [
        [0, 0],
        [5, 5],
      ],
      20,
      99,
    );
    const r = kmeansDeterminista(X);
    expect(r.asignaciones).toHaveLength(40);
    const p = particion(r.asignaciones);
    let suma = 0;
    for (const [, miembros] of p) suma += miembros.length;
    expect(suma).toBe(40);
    for (const g of r.asignaciones) {
      expect(Number.isInteger(g)).toBe(true);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(r.k);
    }
  });

  it('el número de grupos se queda dentro de [2, tope]', () => {
    for (const n of [8, 20, 40, 80]) {
      const X = nube(
        [
          [0, 0],
          [4, 4],
          [8, 0],
        ],
        Math.ceil(n / 3),
        n * 7,
      );
      const r = kmeansDeterminista(X);
      expect(r.k).toBeGreaterThanOrEqual(2);
      expect(r.k).toBeLessThanOrEqual(kMaximoPara(X.length));
    }
  });

  it('respeta el tope aunque se pida un número de grupos mayor', () => {
    const X = nube(
      [
        [0, 0],
        [3, 3],
      ],
      5,
      1,
    );
    const r = kmeansDeterminista(X, 99);
    expect(r.k).toBe(kMaximoPara(10));
  });
});

describe('etiquetado estable', () => {
  it('numera los grupos por la primera coordenada del centro, de menor a mayor', () => {
    // Sin esta regla, el «grupo 0» de una ejecución podría ser el «grupo 1» de la siguiente y
    // dos informes del mismo debate no se podrían comparar.
    const X = nube(
      [
        [9, 0],
        [0, 0],
        [4.5, 0],
      ],
      10,
      2024,
    );
    const r = kmeansDeterminista(X, 3);
    const primeras = r.centroides.map((c) => c[0] ?? 0);
    for (let g = 1; g < primeras.length; g++) {
      expect(primeras[g] ?? 0).toBeGreaterThanOrEqual(primeras[g - 1] ?? 0);
    }
    // La nube de la izquierda (x≈0) es el grupo 0 aunque se haya construido la segunda.
    expect(new Set(r.asignaciones.slice(10, 20)).has(0)).toBe(true);
  });

  it('el orden de los grupos no depende del orden en que se descubran', () => {
    // Mismas nubes, construidas en orden distinto: los centros resultantes deben salir en el
    // mismo orden porque el criterio es el valor del centro, no el momento del hallazgo.
    const a = kmeansDeterminista(
      nube(
        [
          [0, 0],
          [8, 0],
        ],
        10,
        7,
      ),
      2,
    );
    const b = kmeansDeterminista(
      nube(
        [
          [8, 0],
          [0, 0],
        ],
        10,
        7,
      ),
      2,
    );
    expect((a.centroides[0]?.[0] ?? 0) < (a.centroides[1]?.[0] ?? 0)).toBe(true);
    expect((b.centroides[0]?.[0] ?? 0) < (b.centroides[1]?.[0] ?? 0)).toBe(true);
  });
});

describe('casos límite', () => {
  it('con todos los puntos iguales no revienta y reparte de forma estable', () => {
    const X: Matrix = Array.from({ length: 12 }, () => [3, 3]);
    const r = kmeansDeterminista(X);
    expect(kmeansDeterminista(X)).toEqual(r);
    expect(r.asignaciones).toHaveLength(12);
    // Sin variación ninguna, la medida de separación no puede ser un número inválido: si lo
    // fuera, la elección del número de grupos pasaría a depender del orden de recorrido.
    expect(Number.isNaN(r.silhouettePromedio)).toBe(false);
  });

  it('un grupo que se queda sin miembros se vuelve a sembrar, no se abandona', () => {
    // Once puntos juntos y uno lejísimos: al pedir cuatro grupos, alguno se queda vacío en el
    // camino. Debe repoblarse con el punto más alejado, y el resultado seguir siendo estable.
    const X: Matrix = [...Array.from({ length: 11 }, () => [0, 0]), [100, 100]];
    const r = kmeansDeterminista(X, 4);
    expect(r.asignaciones).toHaveLength(12);
    expect(kmeansDeterminista(X, 4)).toEqual(r);
    expect(Number.isFinite(r.inercia)).toBe(true);
  });

  it('rechaza una entrada sin puntos o sin dimensiones', () => {
    expect(() => kmeansDeterminista([])).toThrow(/sin participantes/);
    expect(() => kmeansDeterminista([[], []])).toThrow(/sin dimensiones/);
  });
});
