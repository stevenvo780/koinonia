/**
 * Reglas de texto de todo lo que entra al historial.
 *
 * Dos textos que **se ven idénticos** y hashean distinto rompen la verificación sin que nadie haya
 * hecho nada mal: es el fallo más caro posible, porque no hay culpable y no hay síntoma hasta que un
 * auditor externo dice «a mí no me da lo mismo». Se normaliza en el borde de entrada (`normalizar`)
 * y se **exige** normalizado en el borde del dominio (`assertLedgerText`).
 *
 * El límite de longitud tampoco es cosmético: un texto de 4 MB en un evento encadenado es un texto
 * de 4 MB que hay que rehashear en cada verificación, para siempre.
 */

import { DomainError } from '../errors.js';

/** Un texto destinado al historial no cumple las reglas de forma. */
export class InvalidTextError extends DomainError {
  readonly field: string;

  constructor(field: string, detail: string) {
    super('INVALID_TEXT', `${field}: ${detail}`);
    this.name = 'InvalidTextError';
    this.field = field;
  }
}

/** Longitud máxima de un título. Un título que no cabe en una pantalla de teléfono no es un título. */
export const MAX_TITLE_LENGTH = 140;
/** Longitud máxima de un cuerpo. Coincide con el tope de una perspectiva del §3 de PRODUCT. */
export const MAX_BODY_LENGTH = 4000;

/**
 * Normaliza un texto para que sea hasheable: NFC, saltos de línea a LF, sin espacios al borde.
 *
 * Se hace **en el borde de entrada**, una sola vez, y a partir de ahí el texto es un hecho. Hacerlo
 * más tarde (por ejemplo al hashear) significaría que lo almacenado y lo hasheado difieren, que es
 * el mismo problema con más pasos.
 */
export function normalizeLedgerText(text: string): string {
  return text.replace(/\r\n?/gu, '\n').normalize('NFC').trim();
}

/** Cuenta caracteres visibles tras colapsar espacios. Para los mínimos, no para los máximos. */
export function meaningfulLength(text: string): number {
  return text.replace(/\s+/gu, ' ').trim().length;
}

export interface TextRules {
  readonly field: string;
  readonly min: number;
  readonly max: number;
}

/** Exige que el texto ya venga normalizado y dentro de rango. Lanza `InvalidTextError`. */
export function assertLedgerText(text: string, rules: TextRules): void {
  if (text.normalize('NFC') !== text) {
    throw new InvalidTextError(
      rules.field,
      'debe venir normalizado en NFC: dos textos que se ven idénticos y hashean distinto rompen ' +
        'la verificación (A.1.1)',
    );
  }
  if (text.includes('\r')) {
    throw new InvalidTextError(
      rules.field,
      'contiene retorno de carro: los finales de línea se normalizan a LF en el borde de entrada',
    );
  }
  const length = meaningfulLength(text);
  if (length < rules.min) {
    throw new InvalidTextError(
      rules.field,
      `hacen falta al menos ${String(rules.min)} caracteres y llegaron ${String(length)}`,
    );
  }
  if (text.length > rules.max) {
    throw new InvalidTextError(
      rules.field,
      `el máximo son ${String(rules.max)} caracteres y llegaron ${String(text.length)}`,
    );
  }
}
