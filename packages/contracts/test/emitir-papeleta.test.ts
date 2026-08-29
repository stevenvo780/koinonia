/**
 * `emitirPapeleta`: las seis clases de papeleta que `POST /decisiones/:id/papeletas` sabe recibir.
 *
 * Las tres nuevas —`score`, `ranking`, `grades`— son las que desbloquean puntuación, voto por
 * rondas, valoración por menciones y comparación por pares. Las tres se transportan como LISTA de
 * pares (`{opcion, valor}` / `{opcion, mencion}`, u opciones sueltas para `orden`), nunca como un
 * mapa con la opción de CLAVE: un identificador de opción son 32 hexadecimales al azar —cerca del
 * 62 % empieza por dígito— y el perfil canónico del historial exige que toda clave de objeto
 * empiece por letra (`packages/crypto/src/canonical.ts`). Esta forma también cierra, de paso, el
 * hueco que describe `mensajes-de-validacion.test.ts`: con `z.record(opaqueId, …)` la ruta del
 * error de Zod incluía la clave que mandó el cliente; con una lista, la ruta es un índice numérico.
 */

import { describe, expect, it } from 'vitest';

import { emitirPapeleta } from '../src/http.js';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const HUELLA = 'a'.repeat(64);
const OPCION_A = '0184fbe5000000000000000000000000';
const OPCION_B = 'ab000000000000000000000000000000';

function cuerpo(respuesta: unknown): unknown {
  return { requestId: REQUEST_ID, huellaVersion: HUELLA, respuesta };
}

describe('emitirPapeleta — score', () => {
  it('acepta una lista de {opcion, valor}, incluida una opción que empieza por dígito', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({ tipo: 'score', puntuaciones: [{ opcion: OPCION_A, valor: 5 }] }),
    );
    expect(resultado.success).toBe(true);
  });

  it('una lista vacía es válida: es una papeleta sin ninguna opinión', () => {
    expect(emitirPapeleta.safeParse(cuerpo({ tipo: 'score', puntuaciones: [] })).success).toBe(
      true,
    );
  });

  it('rechaza la misma opción puntuada dos veces', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({
        tipo: 'score',
        puntuaciones: [
          { opcion: OPCION_A, valor: 3 },
          { opcion: OPCION_A, valor: 4 },
        ],
      }),
    );
    expect(resultado.success).toBe(false);
  });

  it('rechaza una nota fuera de [0,5] y una nota nula', () => {
    expect(
      emitirPapeleta.safeParse(
        cuerpo({ tipo: 'score', puntuaciones: [{ opcion: OPCION_A, valor: 6 }] }),
      ).success,
    ).toBe(false);
    expect(
      emitirPapeleta.safeParse(
        cuerpo({ tipo: 'score', puntuaciones: [{ opcion: OPCION_A, valor: null }] }),
      ).success,
    ).toBe(false);
  });

  /**
   * El caso que rompía en producción (defecto de la revisión anterior): «sin opinión» mandado como
   * `null` en vez de como una opción ausente de la lista. Ahora no hay ningún campo `valor: null`
   * posible: la única forma de decir «sin opinión» es no incluir el par.
   */
  it('no existe una forma de mandar «sin opinión» como valor nulo: sólo se omite el par', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({ tipo: 'score', puntuaciones: [{ opcion: OPCION_A }] }),
    );
    expect(resultado.success).toBe(false);
  });
});

describe('emitirPapeleta — ranking', () => {
  it('acepta un orden no vacío de opciones', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({ tipo: 'ranking', orden: [OPCION_B, OPCION_A] }),
    );
    expect(resultado.success).toBe(true);
  });

  it('rechaza el orden vacío', () => {
    expect(emitirPapeleta.safeParse(cuerpo({ tipo: 'ranking', orden: [] })).success).toBe(false);
  });

  it('rechaza una opción repetida en el orden', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({ tipo: 'ranking', orden: [OPCION_A, OPCION_A] }),
    );
    expect(resultado.success).toBe(false);
  });
});

describe('emitirPapeleta — grades', () => {
  it('acepta una lista de {opcion, mencion}', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({ tipo: 'grades', menciones: [{ opcion: OPCION_A, mencion: 'excelente' }] }),
    );
    expect(resultado.success).toBe(true);
  });

  it('rechaza la misma opción valorada dos veces', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({
        tipo: 'grades',
        menciones: [
          { opcion: OPCION_A, mencion: 'excelente' },
          { opcion: OPCION_A, mencion: 'rechazar' },
        ],
      }),
    );
    expect(resultado.success).toBe(false);
  });

  it('rechaza una mención vacía', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({ tipo: 'grades', menciones: [{ opcion: OPCION_A, mencion: '' }] }),
    );
    expect(resultado.success).toBe(false);
  });
});

describe('emitirPapeleta — la ruta del error no repite entrada ajena del cliente', () => {
  it('una opción repetida se rechaza sin que la ruta del problema incluya esa opción como clave', () => {
    const resultado = emitirPapeleta.safeParse(
      cuerpo({
        tipo: 'score',
        puntuaciones: [
          { opcion: OPCION_A, valor: 1 },
          { opcion: OPCION_A, valor: 2 },
        ],
      }),
    );
    expect(resultado.success).toBe(false);
    if (resultado.success) return;
    const rutas = resultado.error.issues.map((issue) => issue.path.join('.'));
    // Con `z.record(opaqueId, …)` la ruta del error incluía la opción que mandó el cliente
    // (`respuesta.puntuaciones.<opción>`); con una lista, la ruta es un índice o el arreglo entero.
    for (const ruta of rutas) {
      expect(ruta).not.toContain(OPCION_A);
    }
  });
});
