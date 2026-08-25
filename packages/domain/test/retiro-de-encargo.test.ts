/**
 * El peldaño 7, «encargo retirado» (PRODUCT.md §6): «Excepcional. Nunca automático: exige
 * consentimiento del círculo y es apelable. Público y motivado.»
 *
 * Lo que estas pruebas atacan, en orden de importancia:
 *
 *  1. que ninguna de las tres condiciones —techo de la escalera, consentimiento explícito, motivo
 *     real— sea suficiente por sí sola ni en pareja: hacen falta las tres a la vez;
 *  2. que un motivo vacío, de relleno o hecho sólo de espacios en blanco no cuente como motivo —el
 *     pliego exige «público y motivado», no «público»;
 *  3. que `registrarRetiroDeEncargo` nunca produzca el registro sin las tres condiciones, y que
 *     cuando las produce, el motivo quede recortado y el instante sea exactamente el que entró, no
 *     uno calculado internamente (nunca `Date.now()`);
 *  4. que cada rechazo tenga un código estable distinto, para que quien integra pueda mostrar el
 *     motivo exacto sin adivinarlo del mensaje.
 */

import { describe, expect, it } from 'vitest';

import { DOMINIO_SUSPENDIDO, type EscalonTarea } from '../src/execution/escalones.js';
import {
  MAX_MOTIVO_RETIRO_LENGTH,
  MIN_MOTIVO_RETIRO_LENGTH,
  porQueNoSePuedeRetirarEncargo,
  puedeRetirarEncargo,
  registrarRetiroDeEncargo,
  type SolicitudDeRetiroDeEncargo,
} from '../src/execution/retiro-de-encargo.js';
import { instant } from '../src/ids.js';
import { PreconditionError } from '../src/errors.js';

const AHORA = instant(1_700_000_000_000);
const MOTIVO_VALIDO =
  'El círculo revisó tres reasignaciones consecutivas de esta tarea y decidió, en sesión, retirar el encargo.';

function solicitud(
  overrides: Partial<SolicitudDeRetiroDeEncargo> = {},
): SolicitudDeRetiroDeEncargo {
  return {
    escalonActual: 'en-revision-colectiva',
    consentimientoDelCirculo: true,
    motivo: MOTIVO_VALIDO,
    ...overrides,
  };
}

const OTROS_ESCALONES: readonly (EscalonTarea | undefined)[] = [
  undefined,
  'por-vencer',
  'atrasada',
  'consultada',
  'bloqueada',
  'en-apoyo',
  'reasignada',
];

describe('puedeRetirarEncargo — las tres condiciones, ninguna basta sola', () => {
  it('las tres a la vez: sí se puede', () => {
    expect(puedeRetirarEncargo(solicitud())).toBe(true);
  });

  it('sin el techo de la escalera, ningún otro peldaño habilita el retiro', () => {
    for (const escalonActual of OTROS_ESCALONES) {
      expect(puedeRetirarEncargo(solicitud({ escalonActual }))).toBe(false);
    }
  });

  it('en el techo, pero sin consentimiento del círculo: no', () => {
    expect(puedeRetirarEncargo(solicitud({ consentimientoDelCirculo: false }))).toBe(false);
  });

  it('en el techo, con consentimiento, pero sin motivo: no', () => {
    expect(puedeRetirarEncargo(solicitud({ motivo: '' }))).toBe(false);
  });

  it('un motivo de una palabra no alcanza: «público y motivado» exige una frase real', () => {
    expect(puedeRetirarEncargo(solicitud({ motivo: 'sí' }))).toBe(false);
  });

  it('un motivo hecho sólo de espacios en blanco no cuenta, aunque su longitud cruda alcance', () => {
    const soloEspacios = ' '.repeat(MIN_MOTIVO_RETIRO_LENGTH + 5);
    expect(puedeRetirarEncargo(solicitud({ motivo: soloEspacios }))).toBe(false);
  });

  it('justo en el mínimo de caracteres (recortado), ya cuenta', () => {
    const motivo = 'x'.repeat(MIN_MOTIVO_RETIRO_LENGTH);
    expect(puedeRetirarEncargo(solicitud({ motivo }))).toBe(true);
  });

  it('un carácter por debajo del mínimo, no cuenta', () => {
    const motivo = 'x'.repeat(MIN_MOTIVO_RETIRO_LENGTH - 1);
    expect(puedeRetirarEncargo(solicitud({ motivo }))).toBe(false);
  });

  it('un motivo más largo que el máximo se rechaza', () => {
    const motivo = 'x'.repeat(MAX_MOTIVO_RETIRO_LENGTH + 1);
    expect(puedeRetirarEncargo(solicitud({ motivo }))).toBe(false);
  });

  it('consentimiento sin techo de escalera tampoco alcanza, aunque el motivo sea válido', () => {
    expect(
      puedeRetirarEncargo(
        solicitud({ escalonActual: 'bloqueada', consentimientoDelCirculo: true }),
      ),
    ).toBe(false);
  });
});

describe('porQueNoSePuedeRetirarEncargo — un código por cada rechazo', () => {
  it('undefined cuando de hecho se puede', () => {
    expect(porQueNoSePuedeRetirarEncargo(solicitud())).toBeUndefined();
  });

  it('sin-techo-de-escalera', () => {
    expect(porQueNoSePuedeRetirarEncargo(solicitud({ escalonActual: 'bloqueada' }))).toBe(
      'sin-techo-de-escalera',
    );
  });

  it('sin-consentimiento-del-circulo', () => {
    expect(porQueNoSePuedeRetirarEncargo(solicitud({ consentimientoDelCirculo: false }))).toBe(
      'sin-consentimiento-del-circulo',
    );
  });

  it('sin-motivo', () => {
    expect(porQueNoSePuedeRetirarEncargo(solicitud({ motivo: '' }))).toBe('sin-motivo');
  });

  it('motivo-demasiado-largo', () => {
    const motivo = 'x'.repeat(MAX_MOTIVO_RETIRO_LENGTH + 1);
    expect(porQueNoSePuedeRetirarEncargo(solicitud({ motivo }))).toBe('motivo-demasiado-largo');
  });

  it('cuando fallan varias condiciones a la vez, reporta la primera en el orden del pliego (techo → consentimiento → motivo)', () => {
    expect(
      porQueNoSePuedeRetirarEncargo(
        solicitud({ escalonActual: undefined, consentimientoDelCirculo: false, motivo: '' }),
      ),
    ).toBe('sin-techo-de-escalera');
  });
});

describe('registrarRetiroDeEncargo — el hecho registrable, o el rechazo tipado', () => {
  it('con las tres condiciones, produce el registro con el motivo recortado y el instante exacto', () => {
    const conEspacios = solicitud({ motivo: `  ${MOTIVO_VALIDO}  ` });
    const registrado = registrarRetiroDeEncargo(conEspacios, AHORA);
    expect(registrado).toEqual({
      peldano: DOMINIO_SUSPENDIDO,
      motivo: MOTIVO_VALIDO,
      decididoEn: AHORA,
    });
  });

  it('nunca aplica Date.now(): el instante que sale es exactamente el que entró', () => {
    const otro = instant(AHORA + 123_456);
    expect(registrarRetiroDeEncargo(solicitud(), otro).decididoEn).toBe(otro);
  });

  it('lanza PreconditionError con RETIRO_ENCARGO_SIN_TECHO_DE_ESCALERA', () => {
    expect(() => registrarRetiroDeEncargo(solicitud({ escalonActual: 'en-apoyo' }), AHORA)).toThrow(
      PreconditionError,
    );
    try {
      registrarRetiroDeEncargo(solicitud({ escalonActual: 'en-apoyo' }), AHORA);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect((error as PreconditionError).code).toBe('RETIRO_ENCARGO_SIN_TECHO_DE_ESCALERA');
    }
  });

  it('lanza PreconditionError con RETIRO_ENCARGO_SIN_CONSENTIMIENTO_DEL_CIRCULO — nunca automático', () => {
    try {
      registrarRetiroDeEncargo(solicitud({ consentimientoDelCirculo: false }), AHORA);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as PreconditionError).code).toBe(
        'RETIRO_ENCARGO_SIN_CONSENTIMIENTO_DEL_CIRCULO',
      );
    }
  });

  it('lanza PreconditionError con RETIRO_ENCARGO_SIN_MOTIVO cuando el motivo no alcanza', () => {
    try {
      registrarRetiroDeEncargo(solicitud({ motivo: 'muy corto' }), AHORA);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect((error as PreconditionError).code).toBe('RETIRO_ENCARGO_SIN_MOTIVO');
    }
  });

  it('lanza PreconditionError con RETIRO_ENCARGO_MOTIVO_DEMASIADO_LARGO', () => {
    const motivo = 'x'.repeat(MAX_MOTIVO_RETIRO_LENGTH + 1);
    try {
      registrarRetiroDeEncargo(solicitud({ motivo }), AHORA);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect((error as PreconditionError).code).toBe('RETIRO_ENCARGO_MOTIVO_DEMASIADO_LARGO');
    }
  });

  it('rechaza un `decididoEn` que no es un Instant válido', () => {
    expect(() => registrarRetiroDeEncargo(solicitud(), -1 as never)).toThrow();
  });
});

describe('nunca hay un identificador de persona en la solicitud ni en el registro', () => {
  it('las claves de la solicitud y del registro no incluyen nada parecido a un id de miembro', () => {
    const registrado = registrarRetiroDeEncargo(solicitud(), AHORA);
    const claves = [...Object.keys(solicitud()), ...Object.keys(registrado)];
    for (const clave of claves) {
      expect(clave.toLowerCase()).not.toMatch(/member|responsable|destinatario|persona/u);
    }
  });
});
