/**
 * `@koinonia/domain` — el modelo de dominio y, más adelante, el `DecisionEngine`.
 *
 * Reglas de este paquete (ADR-0001), verificadas por `scripts/check-domain-purity.mjs`:
 *  - cero dependencias de tiempo de ejecución salvo, si acaso, `@koinonia/crypto`;
 *  - nada de red, disco, `Date.now()`, `Math.random()` ni `localeCompare`;
 *  - el instante y la semilla entran como **datos**, nunca como efectos.
 *
 * Todavía no hay dominio: la primera tarea de código fue el andamiaje y `packages/crypto`.
 */

/** Marca de tiempo del dominio: un instante RFC 3339 UTC, inyectado, nunca leído del reloj. */
export type Instante = string & { readonly __marca: 'Instante' };

/** Identificador de miembro: 128 bits aleatorios en hex minúscula (ADR-0006). */
export type MemberId = string & { readonly __marca: 'MemberId' };
