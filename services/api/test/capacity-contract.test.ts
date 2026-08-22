import {
  actualizarCapacidad,
  capacidadPropia,
  MENSAJES,
  type ActualizarCapacidad,
  type CapacidadPropia,
} from '@koinonia/contracts';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('contrato de capacidad propia', () => {
  it('distingue ausencia de una declaración válida de cero', () => {
    expect(capacidadPropia.parse({ declarada: false })).toStrictEqual({ declarada: false });
    expect(
      capacidadPropia.parse({
        declarada: true,
        revision: 1,
        minutosPorSemana: 0,
        updatedAt: 1,
      }),
    ).toMatchObject({ declarada: true, minutosPorSemana: 0 });
    expectTypeOf(capacidadPropia.parse({ declarada: false })).toExtend<CapacidadPropia>();
  });

  it('admite sólo 0..10080 y rechaza cualquier selector memberId', () => {
    expect(actualizarCapacidad.parse({ revision: 0, minutosPorSemana: 0 })).toStrictEqual({
      revision: 0,
      minutosPorSemana: 0,
    } satisfies ActualizarCapacidad);
    expect(actualizarCapacidad.safeParse({ revision: 0, minutosPorSemana: 10_080 }).success).toBe(
      true,
    );
    expect(actualizarCapacidad.safeParse({ revision: 0, minutosPorSemana: -1 }).success).toBe(
      false,
    );
    expect(actualizarCapacidad.safeParse({ revision: 0, minutosPorSemana: 10_081 }).success).toBe(
      false,
    );
    expect(
      actualizarCapacidad.safeParse({
        revision: 0,
        minutosPorSemana: 60,
        memberId: 'a'.repeat(32),
      }).success,
    ).toBe(false);
  });

  it('publica mensajes seguros para CAS e indisponibilidad', () => {
    expect(MENSAJES['STALE_CAPACITY_REVISION']).toMatch(/capacidad/u);
    expect(MENSAJES['CAPACITY_SERVICE_UNAVAILABLE']).toMatch(/no está disponible/u);
    expect(MENSAJES['TASK_CAPACITY_NOT_DECLARED']).toBe(
      MENSAJES['TASK_CAPACITY_CONFIRMATION_BLOCKED'],
    );
    expect(MENSAJES['TASK_CAPACITY_NOT_DECLARED']).toMatch(/capacidad propia/u);
    expect(MENSAJES['TASK_CAPACITY_NOT_DECLARED']).not.toMatch(/\d/u);
  });
});
