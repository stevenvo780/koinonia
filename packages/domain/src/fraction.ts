/**
 * Fracciones exactas.
 *
 * Principio 0.1.3 de la especificación: **toda** comparación de umbral se hace con enteros o con
 * fracciones exactas. Está prohibido comparar `0.6666666666666666` contra `2/3`: en aritmética de
 * punto flotante `2/3` no existe, y una supermayoría que se cumplía exactamente se rechazaría por
 * un error de representación. Con `bigint` y multiplicación cruzada el resultado es exacto para
 * cualquier magnitud (INV-18).
 *
 * Las fracciones sólo se redondean **para mostrar**, nunca para decidir.
 */

import { InvalidFractionError } from './errors.js';

/** Fracción exacta no negativa. Invariantes: `den > 0n` y `num >= 0n`. */
export interface Fraction {
  readonly num: bigint;
  readonly den: bigint;
}

/** Constructor validador. Todo `Fraction` del dominio pasa por aquí. */
export function fraction(num: bigint, den: bigint): Fraction {
  if (den <= 0n) {
    throw new InvalidFractionError(
      `el denominador debe ser positivo, se recibió ${den.toString()}`,
    );
  }
  if (num < 0n) {
    throw new InvalidFractionError(
      `el numerador no puede ser negativo, se recibió ${num.toString()}`,
    );
  }
  return { num, den };
}

export const ZERO: Fraction = { num: 0n, den: 1n };
export const ONE: Fraction = { num: 1n, den: 1n };
export const HALF: Fraction = { num: 1n, den: 2n };
export const TWO_THIRDS: Fraction = { num: 2n, den: 3n };
export const THREE_QUARTERS: Fraction = { num: 3n, den: 4n };

/** Compara `a ⋛ b` sin punto flotante. Como `den > 0`, la multiplicación cruzada conserva el signo. */
export function cmpFraction(a: Fraction, b: Fraction): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fractionEquals(a: Fraction, b: Fraction): boolean {
  return cmpFraction(a, b) === 0;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Forma irreducible. `0/n` se normaliza a `0/1`.
 *
 * Se usa para los índices de concentración, donde dos escrutinios que producen el mismo valor deben
 * producir la **misma** estructura (y por tanto el mismo `resultHash`). NO se usa para la
 * participación: allí `187/300` dice más que `187/300` reducido, y el par (emitidas, censo) es
 * exactamente lo que se quiere publicar.
 */
export function normalize(f: Fraction): Fraction {
  if (f.num === 0n) return ZERO;
  const d = gcd(f.num, f.den);
  return { num: f.num / d, den: f.den / d };
}

/** ¿La fracción está en `[0, 1]`? Requisito de todo umbral y de todo quórum. */
export function isProperFraction(f: Fraction): boolean {
  return f.den > 0n && f.num >= 0n && f.num <= f.den;
}

/** Cociente exacto de dos enteros no negativos; el denominador cero es un error del llamante. */
export function ratio(num: number, den: number): Fraction {
  return fraction(BigInt(num), BigInt(den));
}

/**
 * Representación decimal para mostrar, con `digits` decimales, truncada hacia cero.
 *
 * Truncar y no redondear es deliberado: «66.66 %» nunca debe leerse como «66.67 %» y sugerir que se
 * alcanzó un umbral de dos tercios que no se alcanzó.
 */
export function toPercentString(f: Fraction, digits = 2): string {
  const scale = 10n ** BigInt(digits + 2);
  const scaled = (f.num * scale) / f.den;
  const text = scaled.toString().padStart(digits + 1, '0');
  const whole = text.slice(0, text.length - digits);
  const frac = text.slice(text.length - digits);
  return digits === 0 ? `${whole} %` : `${whole}.${frac} %`;
}

/** `2/3` → `"2/3"`. Forma canónica para la traza auditable. */
export function toFractionString(f: Fraction): string {
  return `${f.num.toString()}/${f.den.toString()}`;
}
