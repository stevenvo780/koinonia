import { describe, expect, it } from 'vitest';

import { motivoDelIntento } from '../src/anchor/tarea.js';

/**
 * Que un intento de anclaje fallido guarde SIEMPRE por qué falló.
 *
 * ═══ Qué se rompía ═══
 *
 * `governance.anchor_attempt` es la tabla que se mira para saber cómo va el anclaje. El 2026-08-25,
 * en producción, tenía **20 intentos fallidos con `error` en NULL**: veinte veces el mismo defecto
 * delante, y ni una palabra de por qué.
 *
 * La razón es que sólo se guardaba `intento.error`, que existe cuando algo **lanzó** —un envío que
 * no salió, una verificación que reventó—. Pero el camino más común no lanza: la verificación
 * termina bien y devuelve `invalido`, con su porqué en `outcome.detail`. Ese texto se publicaba en
 * el evento del historial y se perdía en la fila del intento.
 *
 * Un fallo sin motivo guardado es un fallo que nadie arregla.
 *
 * Comprobado rompiéndolo: si `motivoDelIntento` deja de mirar `outcome`, el segundo caso falla.
 */
describe('el motivo que se guarda con un intento de anclaje', () => {
  it('cuando algo lanzó, se guarda lo que lanzó', () => {
    expect(motivoDelIntento({ error: 'no se pudo enviar el anclaje: la red se cayó' })).toEqual({
      error: 'no se pudo enviar el anclaje: la red se cayó',
    });
  });

  it('cuando la verificación devuelve inválido SIN lanzar, se guarda su explicación', () => {
    // Éste es el caso que dejaba veinte filas mudas, y es el más común de los dos.
    expect(
      motivoDelIntento({
        outcome: { status: 'invalido', detail: 'el recibo miente sobre cuándo se ancló' },
      }),
    ).toEqual({ error: 'el recibo miente sobre cuándo se ancló' });
  });

  it('lo que lanzó gana sobre la explicación, porque es lo que ocurrió primero', () => {
    expect(
      motivoDelIntento({
        error: 'la verificación del recibo lanzó: se acabó el tiempo',
        outcome: { status: 'invalido', detail: 'da igual, esto no llegó a evaluarse' },
      }),
    ).toEqual({ error: 'la verificación del recibo lanzó: se acabó el tiempo' });
  });

  it('un intento que NO fracasó no inventa un motivo', () => {
    // Y devuelve el objeto sin la clave, no la clave con `undefined`: la fila no quiere la columna
    // si no hay nada que poner (`exactOptionalPropertyTypes`).
    expect(motivoDelIntento({ outcome: { status: 'confirmado', detail: 'todo bien' } })).toEqual(
      {},
    );
    expect(motivoDelIntento({})).toEqual({});
    expect(Object.hasOwn(motivoDelIntento({}), 'error')).toBe(false);
  });
});
