/**
 * `execution/dependencias.ts` como propiedad — sobre grafos GENERADOS, no un caso suelto.
 *
 * ═══ El oráculo independiente ═══
 *
 * `tieneCiclo` recorre el grafo con DFS de tres colores. Para no comprobar el algoritmo contra sí
 * mismo, este fichero implementa aparte un ordenamiento topológico de Kahn (grado de entrada, cola de
 * nodos sin dependientes pendientes): un algoritmo genuinamente distinto que sólo coincide con el DFS
 * en el veredicto, nunca en el mecanismo. Si Kahn no logra ordenar TODOS los nodos, el grafo tiene un
 * ciclo. Las dos implementaciones deben coincidir en cada grafo generado.
 *
 * ═══ Cómo se generan los grafos ═══
 *
 * `arbGrafo` produce un número de nodos (2 a 8) y, para cada arista candidata `i → j` con `i ≠ j`,
 * una moneda independiente que decide si existe. Esto cubre TODO el espacio de grafos dirigidos
 * simples sobre ese tamaño —incluidos, con probabilidad alta en los tamaños más grandes, grafos con
 * ciclos de cualquier longitud— sin sesgar la generación hacia acíclicos ni hacia cíclicos.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertPlanSinCiclos,
  type NodoDependencia,
  tieneCiclo,
} from '../../src/execution/dependencias.js';
import { PreconditionError } from '../../src/errors.js';
import { runs } from '../arbitraries.js';

function idDe(i: number): string {
  return `n${String(i)}`;
}

/** Oráculo independiente: Kahn's algorithm. `true` si el grafo tiene al menos un ciclo. */
function referenciaTieneCiclo(nodos: readonly NodoDependencia[]): boolean {
  const gradoEntrada = new Map<string, number>(nodos.map((n) => [n.id, 0]));
  // Arista dependencia -> nodo: "nodo espera a dependencia", así que el grado de entrada de NODO
  // cuenta cuántas dependencias le faltan resolver.
  for (const n of nodos) {
    gradoEntrada.set(n.id, n.dependeDe.length);
  }
  const cola: string[] = nodos.filter((n) => n.dependeDe.length === 0).map((n) => n.id);
  const dependientesDe = new Map<string, string[]>();
  for (const n of nodos) {
    for (const dep of n.dependeDe) {
      const lista = dependientesDe.get(dep) ?? [];
      lista.push(n.id);
      dependientesDe.set(dep, lista);
    }
  }

  let resueltos = 0;
  while (cola.length > 0) {
    const actual = cola.pop()!;
    resueltos += 1;
    for (const dependiente of dependientesDe.get(actual) ?? []) {
      const restante = (gradoEntrada.get(dependiente) ?? 0) - 1;
      gradoEntrada.set(dependiente, restante);
      if (restante === 0) cola.push(dependiente);
    }
  }

  return resueltos !== nodos.length;
}

/** Grafo dirigido simple arbitrario sobre 2 a 8 nodos: cada arista i -> j (i != j) es independiente. */
const arbGrafo: fc.Arbitrary<readonly NodoDependencia[]> = fc
  .integer({ min: 2, max: 8 })
  .chain((n) =>
    fc.array(fc.boolean(), { minLength: n * n, maxLength: n * n }).map((bits) => {
      const dependeDe: string[][] = Array.from({ length: n }, () => []);
      let cursor = 0;
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          const hayArista = bits[cursor];
          cursor += 1;
          if (i !== j && hayArista === true) {
            // nodo i depende de nodo j
            dependeDe[i]?.push(idDe(j));
          }
        }
      }
      return Array.from({ length: n }, (_, i) => ({
        id: idDe(i),
        dependeDe: dependeDe[i] ?? [],
      }));
    }),
  );

describe('execution/dependencias — propiedad sobre grafos generados', () => {
  it('tieneCiclo coincide con un ordenamiento topológico de Kahn calculado aparte', () => {
    fc.assert(
      fc.property(arbGrafo, (grafo) => {
        expect(tieneCiclo(grafo)).toBe(referenciaTieneCiclo(grafo));
      }),
      runs(2000),
    );
  });

  it('assertPlanSinCiclos lanza exactamente cuando el oráculo dice que hay ciclo, y nunca si no', () => {
    fc.assert(
      fc.property(arbGrafo, (grafo) => {
        const esperaCiclo = referenciaTieneCiclo(grafo);
        if (esperaCiclo) {
          expect(() => {
            assertPlanSinCiclos(grafo);
          }).toThrow(PreconditionError);
        } else {
          expect(() => {
            assertPlanSinCiclos(grafo);
          }).not.toThrow();
        }
      }),
      runs(2000),
    );
  });

  it('un grafo sin ninguna arista nunca tiene ciclo, para cualquier cantidad de nodos generada', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (n) => {
        const grafo = Array.from({ length: n }, (_, i) => ({ id: idDe(i), dependeDe: [] }));
        expect(tieneCiclo(grafo)).toBe(false);
      }),
      runs(200),
    );
  });

  it('inyectar un ciclo puro de longitud k (2 a 8) sobre nodos por lo demás sueltos siempre se detecta', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), (k) => {
        const ciclo: NodoDependencia[] = Array.from({ length: k }, (_, i) => ({
          id: idDe(i),
          dependeDe: [idDe((i + k - 1) % k)],
        }));
        expect(tieneCiclo(ciclo)).toBe(true);
        expect(referenciaTieneCiclo(ciclo)).toBe(true);
      }),
      runs(50),
    );
  });
});
