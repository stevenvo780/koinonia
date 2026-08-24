/**
 * Lo que una iniciativa declara que le falta: recursos que necesita y no tiene, riesgos que podrían
 * torcerla. Dos campos del pliego (PRODUCT.md §6), un mismo molde porque comparten la misma regla.
 *
 * ═══ La regla que los une: un hueco, no un inventario ═══
 *
 * PRODUCT.md §6 es literal: «cada iniciativa declara qué **recursos** necesita que hoy no tiene».
 * No dice «qué recursos tiene» ni «cuánto vale cada uno»: la ficha no es un inventario de activos del
 * círculo, es una lista de huecos — lo mínimo que hace falta para que quien lee sepa qué falta
 * conseguir, no un balance patrimonial. Por eso `RecursoNecesario` no tiene campo `disponible` ni
 * `cantidadActual`: modelarlos sería la puerta de entrada a exactamente el inventario que el pliego
 * no pide. Un recurso que ya se consiguió simplemente se retira de la lista en la siguiente versión
 * del plan — no queda un registro marcado «resuelto» dentro de este módulo, porque ese registro
 * volvería a ser inventario con un paso más.
 *
 * `RiesgoDeclarado` sigue la misma forma por la misma razón, aplicada a lo que podría salir mal en
 * vez de a lo que hace falta conseguir: una lista de qué podría torcer la iniciativa, con una
 * severidad gruesa (no una probabilidad numérica: cuantificar probabilidades de eventos únicos sin
 * datos históricos es teatro de precisión) y sin ranking entre iniciativas — este módulo no compara
 * una iniciativa con otra, sólo valida la lista de UNA.
 *
 * ═══ Por qué el texto es corto y de vocabulario cerrado donde puede serlo ═══
 *
 * La severidad es un enum de tres valores, no un texto libre: un campo abierto ahí sería la puerta
 * a describir a una PERSONA como el riesgo («depende de que Fulano entregue a tiempo»), que es
 * exactamente el tipo de dato individual que ADR-0039/ADR-0040 prohíben en una pantalla colectiva.
 * La descripción sí es texto libre, acotado en longitud, para el motivo — igual que el resto del
 * ledger (`assertLedgerText`).
 *
 * ═══ Por qué esto NO es lo mismo que `RiskBody`/`RiskSeverity` de `deliberation/types.ts` ═══
 *
 * Ese `riesgo` (severidad 1-5, con `impact` y `mitigation`) es una CONTRIBUCIÓN a la deliberación de
 * una PROPUESTA todavía no decidida: riesgo de una alternativa, antes de que exista ninguna
 * iniciativa. `RiesgoDeclarado` es del otro lado del ciclo: la iniciativa YA existe (la decisión ya
 * se tomó) y declara qué podría torcer su ejecución. Dos aristas, dos agregados, deliberadamente sin
 * vocabulario compartido — por eso el nombre y la escala son distintos, no por descuido.
 */

import { PreconditionError } from '../errors.js';
import { assertLedgerText, InvalidTextError, meaningfulLength } from '../workspace/text.js';

export const MIN_DESCRIPCION_RECURSO_LENGTH = 5;
export const MAX_DESCRIPCION_RECURSO_LENGTH = 300;
export const MAX_RECURSOS_POR_INICIATIVA = 20;

export const MIN_DESCRIPCION_RIESGO_LENGTH = 5;
export const MAX_DESCRIPCION_RIESGO_LENGTH = 300;
export const MAX_RIESGOS_POR_INICIATIVA = 20;

/** Categorías gruesas de recurso. Cierran el vocabulario para que el conteo agregado tenga sentido. */
export const CATEGORIAS_RECURSO = [
  'economico',
  'espacio',
  'equipo-tecnico',
  'aval-institucional',
  'tiempo-experto',
  'otro',
] as const;
export type CategoriaRecurso = (typeof CATEGORIAS_RECURSO)[number];

/** Un recurso que la iniciativa necesita y hoy no tiene. Ver la cabecera: nunca un inventario. */
export interface RecursoNecesario {
  readonly categoria: CategoriaRecurso;
  readonly descripcion: string;
}

/** Severidad gruesa y cerrada — nunca una probabilidad numérica ni el nombre de quien la causa. */
export const SEVERIDADES_RIESGO = ['baja', 'media', 'alta'] as const;
export type SeveridadRiesgo = (typeof SEVERIDADES_RIESGO)[number];

/** Un riesgo declarado sobre la iniciativa. Nunca sobre una persona (ver cabecera). */
export interface RiesgoDeclarado {
  readonly severidad: SeveridadRiesgo;
  readonly descripcion: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}

function assertDescripcion(
  text: unknown,
  field: string,
  min: number,
  max: number,
  code: string,
): asserts text is string {
  if (typeof text !== 'string') {
    throw new PreconditionError(code, `${field} debe ser texto`);
  }
  const length = meaningfulLength(text);
  if (length < min || text.length > max) {
    throw new PreconditionError(
      code,
      `${field} debe tener entre ${String(min)} y ${String(max)} caracteres; llegaron ${String(length)} significativos`,
    );
  }
  try {
    assertLedgerText(text, { field, min, max });
  } catch (error) {
    if (error instanceof InvalidTextError) throw new PreconditionError(code, error.message);
    throw error;
  }
}

/** `true` si el valor pertenece al vocabulario cerrado `T`. Ayuda de forma, no de negocio. */
function perteneceA<T extends string>(valores: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (valores as readonly string[]).includes(value);
}

/**
 * Valida la lista de recursos faltantes de una iniciativa. Una lista vacía es válida — significa que
 * hoy no le falta nada — y por eso no hay mínimo, sólo el máximo de la constante de arriba.
 */
export function validarRecursosNecesarios(
  valor: unknown,
): asserts valor is readonly RecursoNecesario[] {
  if (!Array.isArray(valor)) {
    throw new PreconditionError(
      'RECURSOS_NECESARIOS_LISTA',
      'los recursos necesarios son una lista',
    );
  }
  if (valor.length > MAX_RECURSOS_POR_INICIATIVA) {
    throw new PreconditionError(
      'RECURSOS_NECESARIOS_DEMASIADOS',
      `una iniciativa declara como máximo ${String(MAX_RECURSOS_POR_INICIATIVA)} recursos faltantes`,
    );
  }
  for (const item of valor) {
    if (!isRecord(item)) {
      throw new PreconditionError(
        'RECURSO_NECESARIO_INVALIDO',
        'cada recurso necesario debe declarar categoría y descripción',
      );
    }
    if (!perteneceA(CATEGORIAS_RECURSO, item['categoria'])) {
      throw new PreconditionError(
        'RECURSO_NECESARIO_CATEGORIA_INVALIDA',
        'la categoría del recurso no pertenece al vocabulario cerrado',
      );
    }
    assertDescripcion(
      item['descripcion'],
      'la descripción del recurso necesario',
      MIN_DESCRIPCION_RECURSO_LENGTH,
      MAX_DESCRIPCION_RECURSO_LENGTH,
      'RECURSO_NECESARIO_DESCRIPCION_LENGTH',
    );
  }
}

/** Valida la lista de riesgos declarados. Vacía es válida: hoy no hay ningún riesgo que señalar. */
export function validarRiesgosDeclarados(
  valor: unknown,
): asserts valor is readonly RiesgoDeclarado[] {
  if (!Array.isArray(valor)) {
    throw new PreconditionError('RIESGOS_DECLARADOS_LISTA', 'los riesgos declarados son una lista');
  }
  if (valor.length > MAX_RIESGOS_POR_INICIATIVA) {
    throw new PreconditionError(
      'RIESGOS_DECLARADOS_DEMASIADOS',
      `una iniciativa declara como máximo ${String(MAX_RIESGOS_POR_INICIATIVA)} riesgos`,
    );
  }
  for (const item of valor) {
    if (!isRecord(item)) {
      throw new PreconditionError(
        'RIESGO_DECLARADO_INVALIDO',
        'cada riesgo declarado debe traer severidad y descripción',
      );
    }
    if (!perteneceA(SEVERIDADES_RIESGO, item['severidad'])) {
      throw new PreconditionError(
        'RIESGO_DECLARADO_SEVERIDAD_INVALIDA',
        'la severidad del riesgo no pertenece al vocabulario cerrado',
      );
    }
    assertDescripcion(
      item['descripcion'],
      'la descripción del riesgo',
      MIN_DESCRIPCION_RIESGO_LENGTH,
      MAX_DESCRIPCION_RIESGO_LENGTH,
      'RIESGO_DECLARADO_DESCRIPCION_LENGTH',
    );
  }
}
