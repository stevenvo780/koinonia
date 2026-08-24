/**
 * El flujo de incumplimiento (ADR-0040) para la tarea VIVA: los peldaños 0 a 6 y la puerta —nunca la
 * palanca— del 7.º, excepcional.
 *
 * Lo que estas pruebas atacan, en orden de importancia:
 *
 *  1. que los peldaños derivados del tiempo (0, 1, 2) caigan exactamente en los bordes que fija
 *     PRODUCT.md §6 (48 h antes, al vencer, a las 72 h de atraso) y en ningún otro instante;
 *  2. que los estados con el reloj detenido (`bloqueada`, `en-apoyo`) y el regreso al círculo
 *     (`reasignada`) ganen siempre sobre cualquier lectura de tiempo, y que `completada` apague la
 *     escalera entera sin importar el historial;
 *  3. que el techo (`en-revision-colectiva`) se alcance tanto por conteo de reasignaciones como por
 *     el patrón que otra capa ya calculó, y que ninguna de las dos rutas se salte silenciosamente;
 *  4. que el peldaño excepcional (`dominio-suspendido`) sea estructuralmente inalcanzable sin un
 *     consentimiento explícito — no hay combinación de tiempo ni de estado que lo produzca sola.
 */

import { describe, expect, it } from 'vitest';

import {
  calcularEscalonDeTarea,
  DOMINIO_SUSPENDIDO,
  type EntradaEscalonDeTarea,
  ESCALONES_DE_TAREA,
  HORA_MS,
  puedeSuspenderDominio,
  UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA,
  VENTANA_CONSULTA_MS,
  VENTANA_POR_VENCER_MS,
} from '../src/execution/escalones.js';
import { instant } from '../src/ids.js';
import { PreconditionError } from '../src/errors.js';
import type { TaskStatus } from '../src/workspace/initiative.js';

const DUE = instant(1_000_000_000_000); // ancla arbitraria, muy dentro del rango seguro de Instant

function entrada(overrides: Partial<EntradaEscalonDeTarea> = {}): EntradaEscalonDeTarea {
  return {
    status: 'en-curso',
    dueAt: DUE,
    reasignaciones: 0,
    ...overrides,
  };
}

describe('calcularEscalonDeTarea — el tramo de tiempo (peldaños 0, 1, 2)', () => {
  it('todavía no hay nada que avisar más de 48 h antes del vencimiento', () => {
    const ahora = instant(DUE - VENTANA_POR_VENCER_MS - 1);
    expect(calcularEscalonDeTarea(entrada(), ahora)).toBeUndefined();
  });

  it('exactamente a las 48 h antes ya es «por-vencer» (borde inclusive)', () => {
    const ahora = instant(DUE - VENTANA_POR_VENCER_MS);
    expect(calcularEscalonDeTarea(entrada(), ahora)).toBe('por-vencer');
  });

  it('un minuto antes del vencimiento sigue siendo «por-vencer»', () => {
    const ahora = instant(DUE - 60_000);
    expect(calcularEscalonDeTarea(entrada(), ahora)).toBe('por-vencer');
  });

  it('exactamente al vencer ya es «atrasada»: no es sanción, es un hecho', () => {
    expect(calcularEscalonDeTarea(entrada(), DUE)).toBe('atrasada');
  });

  it('a las 71 h de atraso todavía es «atrasada»', () => {
    const ahora = instant(DUE + 71 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada(), ahora)).toBe('atrasada');
  });

  it('exactamente a las 72 h de atraso pasa a «consultada» (borde inclusive)', () => {
    const ahora = instant(DUE + VENTANA_CONSULTA_MS);
    expect(calcularEscalonDeTarea(entrada(), ahora)).toBe('consultada');
  });

  it('mucho después del vencimiento sigue en «consultada», no inventa un peldaño nuevo', () => {
    const ahora = instant(DUE + 1000 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada(), ahora)).toBe('consultada');
  });

  it('el tramo de tiempo sólo aplica con la tarea en manos de quien la aceptó', () => {
    const ahora = instant(DUE + VENTANA_CONSULTA_MS);
    for (const status of ['aceptada', 'en-curso'] as const) {
      expect(calcularEscalonDeTarea(entrada({ status }), ahora)).toBe('consultada');
    }
  });
});

describe('calcularEscalonDeTarea — los estados con el reloj detenido ganan sobre el tiempo', () => {
  it('«bloqueada» se mantiene aunque falten meses para el vencimiento', () => {
    const ahora = instant(DUE - 500 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada({ status: 'bloqueada' }), ahora)).toBe('bloqueada');
  });

  it('«bloqueada» se mantiene aunque el atraso ya pasó la ventana de consulta', () => {
    const ahora = instant(DUE + 500 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada({ status: 'bloqueada' }), ahora)).toBe('bloqueada');
  });

  it('«en-apoyo» pesa igual, con el reloj detenido en cualquier instante', () => {
    const ahora = instant(DUE + 500 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada({ status: 'en-apoyo' }), ahora)).toBe('en-apoyo');
  });

  it('«rechazada» y «reasignacion-solicitada» son las dos caras de «reasignada»', () => {
    const ahora = DUE;
    expect(calcularEscalonDeTarea(entrada({ status: 'rechazada' }), ahora)).toBe('reasignada');
    expect(calcularEscalonDeTarea(entrada({ status: 'reasignacion-solicitada' }), ahora)).toBe(
      'reasignada',
    );
  });
});

describe('calcularEscalonDeTarea — estados fuera de la escalera', () => {
  it('una oferta todavía no respondida no tiene peldaño: nadie se comprometió a un plazo', () => {
    const ahora = instant(DUE + 500 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada({ status: 'ofrecida' }), ahora)).toBeUndefined();
  });

  it('entregada no es atraso: ya se entregó y espera revisión', () => {
    const ahora = instant(DUE + 500 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada({ status: 'entregada' }), ahora)).toBeUndefined();
  });

  it('completada apaga la escalera aunque el reloj llevara mucho corriendo', () => {
    const ahora = instant(DUE + 500 * HORA_MS);
    expect(calcularEscalonDeTarea(entrada({ status: 'completada' }), ahora)).toBeUndefined();
  });
});

describe('calcularEscalonDeTarea — el techo: en-revision-colectiva', () => {
  it('la tercera reasignación abre el techo, la segunda todavía no', () => {
    const ahora = DUE;
    expect(
      calcularEscalonDeTarea(
        entrada({ status: 'reasignacion-solicitada', reasignaciones: 2 }),
        ahora,
      ),
    ).toBe('reasignada');
    expect(
      calcularEscalonDeTarea(
        entrada({
          status: 'reasignacion-solicitada',
          reasignaciones: UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA,
        }),
        ahora,
      ),
    ).toBe('en-revision-colectiva');
  });

  it('el patrón en el círculo, ya calculado por quien llama, también abre el techo con 0 reasignaciones', () => {
    const ahora = DUE;
    expect(
      calcularEscalonDeTarea(entrada({ reasignaciones: 0, patronEnElCirculo: true }), ahora),
    ).toBe('en-revision-colectiva');
  });

  it('patronEnElCirculo en false u omitido no dispara nada por sí solo', () => {
    const ahora = DUE;
    expect(
      calcularEscalonDeTarea(entrada({ reasignaciones: 0, patronEnElCirculo: false }), ahora),
    ).not.toBe('en-revision-colectiva');
  });

  it('el techo gana incluso sobre bloqueada o en-apoyo: es el objeto del círculo, no un peldaño más liviano', () => {
    const ahora = DUE;
    expect(
      calcularEscalonDeTarea(
        entrada({
          status: 'bloqueada',
          reasignaciones: UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA,
        }),
        ahora,
      ),
    ).toBe('en-revision-colectiva');
    expect(
      calcularEscalonDeTarea(
        entrada({
          status: 'en-apoyo',
          reasignaciones: UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA,
        }),
        ahora,
      ),
    ).toBe('en-revision-colectiva');
  });

  it('completada gana incluso sobre el techo: una tarea cerrada no tiene nada pendiente que mostrar', () => {
    const ahora = DUE;
    expect(
      calcularEscalonDeTarea(
        entrada({ status: 'completada', reasignaciones: 10, patronEnElCirculo: true }),
        ahora,
      ),
    ).toBeUndefined();
  });
});

describe('calcularEscalonDeTarea — entradas inválidas fallan cerrado', () => {
  it('rechaza un conteo de reasignaciones negativo', () => {
    expect(() => calcularEscalonDeTarea(entrada({ reasignaciones: -1 }), DUE)).toThrow(
      PreconditionError,
    );
  });

  it('rechaza un conteo de reasignaciones no entero', () => {
    expect(() => calcularEscalonDeTarea(entrada({ reasignaciones: 1.5 }), DUE)).toThrow(
      PreconditionError,
    );
  });

  it('el código del error de reasignaciones inválidas es estable', () => {
    try {
      calcularEscalonDeTarea(entrada({ reasignaciones: -1 }), DUE);
      throw new Error('no debía llegar aquí');
    } catch (error) {
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as PreconditionError).code).toBe('ESCALON_REASIGNACIONES_INVALIDAS');
    }
  });

  it('rechaza un `ahora` que no es un instante válido', () => {
    expect(() =>
      calcularEscalonDeTarea(entrada(), -1 as unknown as ReturnType<typeof instant>),
    ).toThrow();
  });
});

describe('calcularEscalonDeTarea — es pura', () => {
  it('el mismo par (entrada, ahora) produce siempre el mismo resultado', () => {
    const unaEntrada = entrada({ status: 'bloqueada' });
    const primero = calcularEscalonDeTarea(unaEntrada, DUE);
    const segundo = calcularEscalonDeTarea(unaEntrada, DUE);
    expect(primero).toBe(segundo);
  });

  it('cubre exactamente los siete peldaños documentados por ADR-0040, en el mismo orden', () => {
    expect(ESCALONES_DE_TAREA).toEqual([
      'por-vencer',
      'atrasada',
      'consultada',
      'bloqueada',
      'en-apoyo',
      'reasignada',
      'en-revision-colectiva',
    ]);
  });
});

describe('calcularEscalonDeTarea — la transición completa de una tarea', () => {
  it('recorre por-vencer → atrasada → consultada → bloqueada → en-apoyo → reasignada → en-revision-colectiva', () => {
    // Una sola tarea, siguiendo la misma historia que describe PRODUCT.md §6, comprobada peldaño a
    // peldaño con el mismo `dueAt` y sin retroceder nunca sin que el estado subyacente cambie.
    const dueAt = DUE;

    expect(calcularEscalonDeTarea(entrada({ dueAt }), instant(dueAt - VENTANA_POR_VENCER_MS))).toBe(
      'por-vencer',
    );
    expect(calcularEscalonDeTarea(entrada({ dueAt }), dueAt)).toBe('atrasada');
    expect(calcularEscalonDeTarea(entrada({ dueAt }), instant(dueAt + VENTANA_CONSULTA_MS))).toBe(
      'consultada',
    );

    const tras = instant(dueAt + VENTANA_CONSULTA_MS + HORA_MS);
    expect(calcularEscalonDeTarea(entrada({ dueAt, status: 'bloqueada' }), tras)).toBe('bloqueada');
    expect(calcularEscalonDeTarea(entrada({ dueAt, status: 'en-apoyo' }), tras)).toBe('en-apoyo');
    expect(
      calcularEscalonDeTarea(
        entrada({ dueAt, status: 'reasignacion-solicitada', reasignaciones: 1 }),
        tras,
      ),
    ).toBe('reasignada');
    expect(
      calcularEscalonDeTarea(
        entrada({
          dueAt,
          status: 'reasignacion-solicitada',
          reasignaciones: UMBRAL_REASIGNACIONES_PARA_REVISION_COLECTIVA,
        }),
        tras,
      ),
    ).toBe('en-revision-colectiva');
  });
});

describe('puedeSuspenderDominio — la puerta del peldaño excepcional', () => {
  it('nunca es alcanzable sin consentimiento del círculo, aunque esté en el techo', () => {
    expect(
      puedeSuspenderDominio({
        escalonActual: 'en-revision-colectiva',
        consentimientoDelCirculo: false,
      }),
    ).toBe(false);
  });

  it('nunca es alcanzable desde un peldaño que no sea el techo, aunque haya consentimiento', () => {
    for (const escalonActual of [...ESCALONES_DE_TAREA, undefined]) {
      if (escalonActual === 'en-revision-colectiva') continue;
      expect(puedeSuspenderDominio({ escalonActual, consentimientoDelCirculo: true })).toBe(false);
    }
  });

  it('sólo es alcanzable con las dos condiciones a la vez', () => {
    expect(
      puedeSuspenderDominio({
        escalonActual: 'en-revision-colectiva',
        consentimientoDelCirculo: true,
      }),
    ).toBe(true);
  });

  it('el nombre del peldaño excepcional es una constante estable y no un literal repetido', () => {
    expect(DOMINIO_SUSPENDIDO).toBe('dominio-suspendido');
    expect(ESCALONES_DE_TAREA as readonly string[]).not.toContain(DOMINIO_SUSPENDIDO);
  });
});

describe('calcularEscalonDeTarea — cubre todos los TaskStatus del dominio sin dejar ninguno afuera', () => {
  // Si `workspace/initiative.ts` agrega un estado nuevo algún día, esta prueba obliga a decidir a
  // qué peldaño corresponde (o a que no tenga ninguno) en vez de que caiga en `undefined` por olvido.
  const TODOS_LOS_ESTADOS: readonly TaskStatus[] = [
    'ofrecida',
    'aceptada',
    'en-curso',
    'bloqueada',
    'en-apoyo',
    'entregada',
    'completada',
    'rechazada',
    'reasignacion-solicitada',
  ];

  const ESPERADO: Readonly<Record<TaskStatus, EscalonTareaEsperada>> = {
    ofrecida: undefined,
    aceptada: 'tiempo',
    'en-curso': 'tiempo',
    bloqueada: 'bloqueada',
    'en-apoyo': 'en-apoyo',
    entregada: undefined,
    completada: undefined,
    rechazada: 'reasignada',
    'reasignacion-solicitada': 'reasignada',
  };

  type EscalonTareaEsperada = 'bloqueada' | 'en-apoyo' | 'reasignada' | 'tiempo' | undefined;

  it('cada estado cae exactamente donde esta tabla dice', () => {
    const ahora = DUE; // en el tramo de tiempo, DUE mismo produce 'atrasada'
    for (const status of TODOS_LOS_ESTADOS) {
      const resultado = calcularEscalonDeTarea(entrada({ status }), ahora);
      const esperado = ESPERADO[status];
      if (esperado === 'tiempo') {
        expect(resultado).toBe('atrasada');
      } else {
        expect(resultado).toBe(esperado);
      }
    }
  });
});
