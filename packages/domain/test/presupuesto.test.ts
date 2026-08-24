/**
 * `execution/presupuesto.ts` — condicional: el campo NO APARECE cuando no aplica.
 *
 * El caso central de este fichero es la distinción `undefined` vs `null` (ver la cabecera del
 * fichero fuente): romperla —aceptar `null` como sinónimo de «no aplica»— es exactamente el defecto
 * que este módulo existe para impedir, así que hay una prueba dedicada que lo comprueba rompiéndolo.
 */

import { describe, expect, it } from 'vitest';

import { PreconditionError } from '../src/errors.js';
import {
  aplicaPresupuesto,
  MAX_SOPORTES,
  type Presupuesto,
  validarPresupuesto,
} from '../src/execution/presupuesto.js';

function presupuestoValido(overrides: Partial<Presupuesto> = {}): Presupuesto {
  return {
    montoCentavos: 500_000_00,
    moneda: 'COP',
    soportes: [
      { descripcion: 'cotización del proveedor', fuente: 'https://ejemplo.org/cotizacion' },
    ],
    ...overrides,
  };
}

describe('validarPresupuesto — la condicionalidad', () => {
  it('undefined es válido: "no aplica" se expresa omitiendo el campo', () => {
    expect(() => {
      validarPresupuesto(undefined);
    }).not.toThrow();
  });

  it('null se RECHAZA explícitamente — no es sinónimo válido de "no aplica"', () => {
    expect(() => {
      validarPresupuesto(null);
    }).toThrow(PreconditionError);
    try {
      validarPresupuesto(null);
      throw new Error('no debería llegar aquí');
    } catch (error) {
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as PreconditionError).code).toBe('PRESUPUESTO_NULL_PROHIBIDO');
    }
  });

  it('aplicaPresupuesto distingue undefined (no aplica) de un presupuesto real', () => {
    expect(aplicaPresupuesto(undefined)).toBe(false);
    expect(aplicaPresupuesto(presupuestoValido())).toBe(true);
  });
});

describe('validarPresupuesto — forma cuando sí aplica', () => {
  it('acepta un presupuesto bien formado', () => {
    expect(() => {
      validarPresupuesto(presupuestoValido());
    }).not.toThrow();
  });

  it('rechaza un monto no entero', () => {
    expect(() => {
      validarPresupuesto(presupuestoValido({ montoCentavos: 10.5 }));
    }).toThrow(PreconditionError);
  });

  it('rechaza un monto cero o negativo', () => {
    expect(() => {
      validarPresupuesto(presupuestoValido({ montoCentavos: 0 }));
    }).toThrow(PreconditionError);
    expect(() => {
      validarPresupuesto(presupuestoValido({ montoCentavos: -100 }));
    }).toThrow(PreconditionError);
  });

  it('rechaza una moneda que no son tres letras mayúsculas', () => {
    expect(() => {
      validarPresupuesto(presupuestoValido({ moneda: 'cop' }));
    }).toThrow(PreconditionError);
    expect(() => {
      validarPresupuesto(presupuestoValido({ moneda: 'PESOS' }));
    }).toThrow(PreconditionError);
  });

  it('rechaza un presupuesto SIN soportes — "con soportes" no es opcional', () => {
    expect(() => {
      validarPresupuesto(presupuestoValido({ soportes: [] }));
    }).toThrow(PreconditionError);
  });

  it('rechaza más soportes que el máximo admitido', () => {
    const soportes = Array.from({ length: MAX_SOPORTES + 1 }, () => ({
      descripcion: 'un soporte más de la cuenta permitida',
      fuente: 'https://ejemplo.org/soporte-adicional',
    }));
    expect(() => {
      validarPresupuesto(presupuestoValido({ soportes }));
    }).toThrow(PreconditionError);
  });

  it('rechaza un soporte con fuente demasiado corta', () => {
    expect(() => {
      validarPresupuesto(
        presupuestoValido({
          soportes: [{ descripcion: 'una cotización cualquiera', fuente: 'x' }],
        }),
      );
    }).toThrow(PreconditionError);
  });
});
