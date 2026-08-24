/**
 * El borrador de dependencias (`execution/dependencias.ts`): casos dirigidos sobre la forma —
 * duplicados, auto-dependencia, referencias rotas — y el primer contraejemplo de ciclo. La propiedad
 * sobre grafos generados vive en `test/props/dependencias-plan-invariants.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { PreconditionError } from '../src/errors.js';
import {
  assertPlanSinCiclos,
  MAX_NODOS_PLAN_DEPENDENCIAS,
  type NodoDependencia,
  primerDefecto,
  tieneCiclo,
  validarPlanDeDependencias,
} from '../src/execution/dependencias.js';

function nodo(id: string, dependeDe: readonly string[] = []): NodoDependencia {
  return { id, dependeDe };
}

describe('validarPlanDeDependencias — forma', () => {
  it('acepta un plan vacío', () => {
    expect(() => {
      validarPlanDeDependencias([]);
    }).not.toThrow();
  });

  it('acepta una cadena lineal A -> B -> C (B depende de A, C depende de B)', () => {
    const plan = [nodo('A'), nodo('B', ['A']), nodo('C', ['B'])];
    expect(() => {
      validarPlanDeDependencias(plan);
    }).not.toThrow();
    expect(tieneCiclo(plan)).toBe(false);
  });

  it('rechaza un id duplicado', () => {
    const plan = [nodo('A'), nodo('A')];
    expect(() => {
      validarPlanDeDependencias(plan);
    }).toThrow(PreconditionError);
    expect(primerDefecto(plan)).toEqual({ tipo: 'id-duplicado', id: 'A' });
  });

  it('rechaza que una tarea dependa de sí misma', () => {
    const plan = [nodo('A', ['A'])];
    expect(() => {
      validarPlanDeDependencias(plan);
    }).toThrow(PreconditionError);
    expect(primerDefecto(plan)).toEqual({ tipo: 'auto-dependencia', id: 'A' });
  });

  it('rechaza una dependencia repetida dentro del mismo nodo', () => {
    const plan = [nodo('A'), nodo('B', ['A', 'A'])];
    expect(primerDefecto(plan)).toEqual({
      tipo: 'dependencia-repetida',
      id: 'B',
      dependeDe: 'A',
    });
  });

  it('rechaza una dependencia que no existe en el borrador', () => {
    const plan = [nodo('B', ['fantasma'])];
    expect(primerDefecto(plan)).toEqual({
      tipo: 'dependencia-inexistente',
      id: 'B',
      dependeDe: 'fantasma',
    });
  });

  it('rechaza más nodos que el máximo admitido', () => {
    const plan = Array.from({ length: MAX_NODOS_PLAN_DEPENDENCIAS + 1 }, (_, i) =>
      nodo(`t${String(i)}`),
    );
    expect(() => {
      validarPlanDeDependencias(plan);
    }).toThrow(PreconditionError);
  });
});

describe('el contraejemplo mínimo: A depende de B y B depende de A', () => {
  it('tieneCiclo lo detecta', () => {
    const plan = [nodo('A', ['B']), nodo('B', ['A'])];
    expect(tieneCiclo(plan)).toBe(true);
  });

  it('primerDefecto lo reporta como ciclo, no como otra cosa', () => {
    const plan = [nodo('A', ['B']), nodo('B', ['A'])];
    const defecto = primerDefecto(plan);
    expect(defecto?.tipo).toBe('ciclo');
    const ciclo = defecto?.tipo === 'ciclo' ? defecto.ciclo : [];
    // El camino cierra donde empezó (mismo id al principio y al final) y pasa por las dos tareas.
    expect(ciclo[0]).toBe(ciclo[ciclo.length - 1]);
    expect(ciclo).toContain('A');
    expect(ciclo).toContain('B');
  });

  it('validarPlanDeDependencias rechaza el plan entero', () => {
    const plan = [nodo('A', ['B']), nodo('B', ['A'])];
    expect(() => {
      validarPlanDeDependencias(plan);
    }).toThrow(PreconditionError);
  });

  it('assertPlanSinCiclos rechaza el mismo par, aislado de la validación de forma', () => {
    const plan = [nodo('A', ['B']), nodo('B', ['A'])];
    expect(() => {
      assertPlanSinCiclos(plan);
    }).toThrow(PreconditionError);
  });

  it('un ciclo más largo (A -> B -> C -> A) también se detecta', () => {
    const plan = [nodo('A', ['C']), nodo('B', ['A']), nodo('C', ['B'])];
    expect(tieneCiclo(plan)).toBe(true);
    expect(() => {
      assertPlanSinCiclos(plan);
    }).toThrow(PreconditionError);
  });

  it('romper el ciclo (quitar una arista) restaura un plan válido — verifica que la prueba prueba algo', () => {
    const conCiclo = [nodo('A', ['B']), nodo('B', ['A'])];
    expect(tieneCiclo(conCiclo)).toBe(true);

    const sinCiclo = [nodo('A', []), nodo('B', ['A'])];
    expect(tieneCiclo(sinCiclo)).toBe(false);
    expect(() => {
      validarPlanDeDependencias(sinCiclo);
    }).not.toThrow();
  });
});
