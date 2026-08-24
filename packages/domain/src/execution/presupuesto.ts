/**
 * El presupuesto de una iniciativa — **cuando aplica**. PRODUCT.md §6: «un presupuesto con soportes:
 * la mayoría no maneja dinero y el campo ni aparece».
 *
 * ═══ Por qué esto es `Presupuesto | undefined` y no `Presupuesto | null` ═══
 *
 * «El campo ni aparece» es una frase sobre la FORMA del dato, no sobre su valor. Un `null` es un
 * valor: algo que se guardó, se serializó, ocupó una fila o una clave, y que quien lea tiene que
 * interpretar como «no aplica» en vez de, por ejemplo, «no sé». Un campo ausente —`undefined`, que
 * `JSON.stringify` omite igual que si nunca hubiera existido— no dice nada: no hay hueco de
 * presupuesto en la ficha de una iniciativa que no maneja dinero, exactamente como no hay un hueco de
 * fecha de parto en la ficha de alguien que no está embarazada. `validarPresupuesto` refuerza esto
 * mismo del lado de la validación: **rechaza `null` explícitamente**, con un código de error propio,
 * para que a nadie se le ocurra «resolver» la ambigüedad guardando `null` en vez de omitir la clave.
 *
 * ═══ Por qué el monto es un entero, no un `number` con decimales ═══
 *
 * `montoCentavos` está en centavos, como el resto del ecosistema financiero que evita el error clásico
 * de sumar `0.1 + 0.2` en punto flotante. Un presupuesto no es una encuesta: alguien va a sumar estos
 * montos entre iniciativas del mismo círculo, y esa suma tiene que ser exacta.
 *
 * ═══ Por qué exige al menos un soporte ═══
 *
 * PRODUCT.md dice «presupuesto CON soportes», no «presupuesto, y si hay tiempo, soportes». Un monto
 * sin ningún soporte que lo respalde es una promesa sin verificación — lo mismo que un criterio de
 * éxito sin `evidenceSource` en `ExecutionPlan` (`workspace/execution-plan.ts`), que tampoco se
 * admite vacío. El molde de `Soporte` (descripción + fuente) es deliberadamente el mismo molde que
 * `SuccessCriterion` por esa razón: es la misma regla aplicada dos veces.
 */

import { PreconditionError } from '../errors.js';
import { assertLedgerText, InvalidTextError, meaningfulLength } from '../workspace/text.js';

export const MIN_MONTO_CENTAVOS = 1;
/** Un tope alto y arbitrario contra errores de captura (p. ej. un cero de más), no un límite real. */
export const MAX_MONTO_CENTAVOS = 1_000_000_000_00;

export const MONEDA_PATTERN = /^[A-Z]{3}$/u;

export const MIN_SOPORTES = 1;
export const MAX_SOPORTES = 10;
export const MIN_SOPORTE_DESCRIPCION_LENGTH = 5;
export const MAX_SOPORTE_DESCRIPCION_LENGTH = 300;
export const MIN_SOPORTE_FUENTE_LENGTH = 5;
export const MAX_SOPORTE_FUENTE_LENGTH = 500;

/** Un soporte del presupuesto: qué evidencia respalda el monto y dónde encontrarla. */
export interface Soporte {
  readonly descripcion: string;
  readonly fuente: string;
}

/** El presupuesto de una iniciativa. Sólo existe cuando aplica: ver la cabecera de este fichero. */
export interface Presupuesto {
  readonly montoCentavos: number;
  /** Código de tres letras mayúsculas, p. ej. `COP`. No se valida contra ISO 4217 completo. */
  readonly moneda: string;
  readonly soportes: readonly Soporte[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}

function assertTexto(
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

/**
 * Valida el presupuesto de una iniciativa. `undefined` es válido siempre — «no aplica» — y es la
 * única forma legítima de decir eso: `null` se **rechaza** con su propio código, precisamente para
 * que la ausencia se exprese omitiendo la clave y no guardando un centinela.
 */
export function validarPresupuesto(valor: unknown): asserts valor is Presupuesto | undefined {
  if (valor === undefined) return;

  if (valor === null) {
    throw new PreconditionError(
      'PRESUPUESTO_NULL_PROHIBIDO',
      'cuando el presupuesto no aplica, el campo se omite; no se guarda como null',
    );
  }

  if (!isRecord(valor)) {
    throw new PreconditionError(
      'PRESUPUESTO_INVALIDO',
      'el presupuesto debe declarar monto, moneda y soportes',
    );
  }

  const montoCentavos = valor['montoCentavos'];
  if (
    typeof montoCentavos !== 'number' ||
    !Number.isSafeInteger(montoCentavos) ||
    montoCentavos < MIN_MONTO_CENTAVOS ||
    montoCentavos > MAX_MONTO_CENTAVOS
  ) {
    throw new PreconditionError(
      'PRESUPUESTO_MONTO_INVALIDO',
      `el monto debe ser un entero en centavos entre ${String(MIN_MONTO_CENTAVOS)} y ${String(MAX_MONTO_CENTAVOS)}`,
    );
  }

  const moneda = valor['moneda'];
  if (typeof moneda !== 'string' || !MONEDA_PATTERN.test(moneda)) {
    throw new PreconditionError(
      'PRESUPUESTO_MONEDA_INVALIDA',
      'la moneda debe ser un código de tres letras mayúsculas',
    );
  }

  const soportes = valor['soportes'];
  if (
    !Array.isArray(soportes) ||
    soportes.length < MIN_SOPORTES ||
    soportes.length > MAX_SOPORTES
  ) {
    throw new PreconditionError(
      'PRESUPUESTO_SOPORTES_COUNT',
      `el presupuesto exige entre ${String(MIN_SOPORTES)} y ${String(MAX_SOPORTES)} soportes`,
    );
  }
  for (const soporte of soportes) {
    if (!isRecord(soporte)) {
      throw new PreconditionError(
        'PRESUPUESTO_SOPORTE_INVALIDO',
        'cada soporte debe declarar descripción y fuente',
      );
    }
    assertTexto(
      soporte['descripcion'],
      'la descripción del soporte',
      MIN_SOPORTE_DESCRIPCION_LENGTH,
      MAX_SOPORTE_DESCRIPCION_LENGTH,
      'PRESUPUESTO_SOPORTE_DESCRIPCION_LENGTH',
    );
    assertTexto(
      soporte['fuente'],
      'la fuente del soporte',
      MIN_SOPORTE_FUENTE_LENGTH,
      MAX_SOPORTE_FUENTE_LENGTH,
      'PRESUPUESTO_SOPORTE_FUENTE_LENGTH',
    );
  }
}

/** `true` si el presupuesto aplica (el campo está presente). Azúcar sobre `!== undefined`. */
export function aplicaPresupuesto(
  presupuesto: Presupuesto | undefined,
): presupuesto is Presupuesto {
  return presupuesto !== undefined;
}
