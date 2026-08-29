/**
 * `escalaDeMencionesDto`: la escala de menciones que `GET /decisiones/:id` le da a la pantalla.
 *
 * Es la única forma que tiene el formulario de valoración por menciones
 * (`apps/web/app/decisiones/[id]/page.tsx`) de saber qué identificadores de mención puede mandar de
 * vuelta en la papeleta: son parte de `DecisionConfig.method`, congelada al abrir, y pueden no ser
 * la escala neutra por defecto si quien abrió la votación mandó la suya propia.
 *
 * Se prueba la función sola y no `decisionDetalleDto` completo a propósito: construir un
 * `DecisionConfig` de punta a punta (padrón, ventana, quórum, delegación…) para ejercitar una
 * función que sólo mira `method.kind` y `method.scale.grades` sería pagar por cubrir una vez más lo
 * que ya cubren las pruebas del dominio (`packages/domain/test`). El camino completo —que el campo
 * llegue de verdad por HTTP con la escala real que congeló `abrirCon`— lo prueba
 * `tests/integration/http-metodos.test.ts`.
 */

import type { DecisionConfig, GradeId } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { escalaDeMencionesDto } from '../src/http/presenters.js';

/**
 * Un `DecisionConfig` con sólo el campo que la función lee. El resto de la interfaz —y del propio
 * método, cuando no es `majority-judgment`— no importa aquí: se castea a propósito en vez de
 * rellenar veinte campos que la función nunca mira.
 */
function conMetodo(
  method: Partial<DecisionConfig['method']> & { readonly kind: string },
): DecisionConfig {
  return { method } as unknown as DecisionConfig;
}

describe('escalaDeMencionesDto', () => {
  it('con majority-judgment, devuelve la escala congelada en id + etiqueta', () => {
    const config = conMetodo({
      kind: 'majority-judgment',
      scale: {
        grades: [
          { id: 'excelente' as GradeId, label: 'Excelente' },
          { id: 'aceptable' as GradeId, label: 'Aceptable' },
          { id: 'rechazar' as GradeId, label: 'Rechazar' },
        ],
      },
      missingGradePolicy: 'reject-ballot',
      tieBreak: { cascade: ['lexicographic-hash'] },
    });
    expect(escalaDeMencionesDto(config)).toEqual([
      { id: 'excelente', etiqueta: 'Excelente' },
      { id: 'aceptable', etiqueta: 'Aceptable' },
      { id: 'rechazar', etiqueta: 'Rechazar' },
    ]);
  });

  it('con cualquier otro método, no hay escala que dar', () => {
    expect(escalaDeMencionesDto(conMetodo({ kind: 'simple-majority' }))).toBeUndefined();
  });

  it('sin configuración congelada todavía (decisión en borrador), tampoco hay escala', () => {
    expect(escalaDeMencionesDto(undefined)).toBeUndefined();
  });
});
