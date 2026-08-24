/**
 * `execution/recursos-y-riesgos.ts` — huecos declarados, nunca un inventario (ver la cabecera del
 * fichero fuente). Las pruebas comprueban la forma Y que la lista vacía —«hoy no falta nada»— es
 * válida, porque ese es precisamente el caso que un inventario nunca dejaría vacío por defecto.
 */

import { describe, expect, it } from 'vitest';

import { PreconditionError } from '../src/errors.js';
import {
  MAX_DESCRIPCION_RECURSO_LENGTH,
  MAX_DESCRIPCION_RIESGO_LENGTH,
  MAX_RECURSOS_POR_INICIATIVA,
  MAX_RIESGOS_POR_INICIATIVA,
  validarRecursosNecesarios,
  validarRiesgosDeclarados,
} from '../src/execution/recursos-y-riesgos.js';

describe('validarRecursosNecesarios', () => {
  it('acepta la lista vacía: hoy no le falta nada a la iniciativa', () => {
    expect(() => {
      validarRecursosNecesarios([]);
    }).not.toThrow();
  });

  it('acepta un recurso bien formado', () => {
    expect(() => {
      validarRecursosNecesarios([
        { categoria: 'espacio', descripcion: 'un salón para las diez reuniones semanales' },
      ]);
    }).not.toThrow();
  });

  it('rechaza una categoría fuera del vocabulario cerrado', () => {
    expect(() => {
      validarRecursosNecesarios([{ categoria: 'dinero-magico', descripcion: 'algo suficiente' }]);
    }).toThrow(PreconditionError);
  });

  it('rechaza una descripción demasiado corta', () => {
    expect(() => {
      validarRecursosNecesarios([{ categoria: 'otro', descripcion: 'x' }]);
    }).toThrow(PreconditionError);
  });

  it('rechaza una descripción más larga que el máximo', () => {
    const larga = 'x'.repeat(MAX_DESCRIPCION_RECURSO_LENGTH + 1);
    expect(() => {
      validarRecursosNecesarios([{ categoria: 'otro', descripcion: larga }]);
    }).toThrow(PreconditionError);
  });

  it('rechaza más recursos que el máximo admitido', () => {
    const lista = Array.from({ length: MAX_RECURSOS_POR_INICIATIVA + 1 }, () => ({
      categoria: 'otro' as const,
      descripcion: 'un recurso más de la cuenta permitida por iniciativa',
    }));
    expect(() => {
      validarRecursosNecesarios(lista);
    }).toThrow(PreconditionError);
  });

  it('rechaza un valor que no es una lista', () => {
    expect(() => {
      validarRecursosNecesarios('no-es-lista');
    }).toThrow(PreconditionError);
  });

  it('no admite un campo "disponible" ni "cantidadActual": no es parte del molde validado', () => {
    // No hay forma de que un item con esos campos extra pase a describir "lo que ya se tiene": el
    // validador sólo lee categoria/descripcion, así que el resto es ruido ignorado, nunca inventario.
    expect(() => {
      validarRecursosNecesarios([
        {
          categoria: 'economico',
          descripcion: 'aporte para materiales del taller trimestral',
          disponible: true,
          cantidadActual: 500,
        },
      ]);
    }).not.toThrow();
  });
});

describe('validarRiesgosDeclarados', () => {
  it('acepta la lista vacía: hoy no hay ningún riesgo que señalar', () => {
    expect(() => {
      validarRiesgosDeclarados([]);
    }).not.toThrow();
  });

  it('acepta un riesgo bien formado', () => {
    expect(() => {
      validarRiesgosDeclarados([
        { severidad: 'media', descripcion: 'el local reservado podría cancelarse sin aviso' },
      ]);
    }).not.toThrow();
  });

  it('rechaza una severidad fuera del vocabulario cerrado (nunca un número libre)', () => {
    expect(() => {
      validarRiesgosDeclarados([{ severidad: 0.7, descripcion: 'una probabilidad inventada' }]);
    }).toThrow(PreconditionError);
  });

  it('rechaza una descripción demasiado corta', () => {
    expect(() => {
      validarRiesgosDeclarados([{ severidad: 'baja', descripcion: 'x' }]);
    }).toThrow(PreconditionError);
  });

  it('rechaza una descripción más larga que el máximo', () => {
    const larga = 'x'.repeat(MAX_DESCRIPCION_RIESGO_LENGTH + 1);
    expect(() => {
      validarRiesgosDeclarados([{ severidad: 'alta', descripcion: larga }]);
    }).toThrow(PreconditionError);
  });

  it('rechaza más riesgos que el máximo admitido', () => {
    const lista = Array.from({ length: MAX_RIESGOS_POR_INICIATIVA + 1 }, () => ({
      severidad: 'baja' as const,
      descripcion: 'un riesgo más de la cuenta permitida por iniciativa',
    }));
    expect(() => {
      validarRiesgosDeclarados(lista);
    }).toThrow(PreconditionError);
  });
});
