/**
 * `@koinonia/contracts` — tipos y textos de frontera. Depende de `domain`; nadie depende de `apps/`.
 *
 * Aquí vive **una sola** definición de cada cosa que cruza la red: el servidor valida con ella y el
 * cliente tipa con ella. Y aquí vive también el léxico: la regla de oro de la interfaz (PRODUCT §7)
 * no es una nota de estilo, es una lista comprobable.
 */

/** Versión del formato de export público (§9.3). Congelada como contrato con quien audita. */
export const EXPORT_FORMAT_VERSION = 1;

export { apiError, type ApiError, MENSAJES, mensajeDe } from './errors.js';

export {
  FORBIDDEN_UI_TERMS,
  forbiddenTermsIn,
  GLOSSARY,
  normalizeForGlossary,
  sanearTextoTecnico,
} from './glossary.js';

export {
  email,
  hash64,
  type Hash64,
  instantMs,
  opaqueId,
  type OpaqueId,
  requestId,
} from './ids.js';

export * from './http.js';
export { datetimeLocalColombia, instanteColombia } from './time.js';

// ── Cinco incrementos nuevos, integrados en una fase aparte ──────────────────────────────────
//
// Cinco agentes escribieron estos ficheros en paralelo, sin hablarse entre sí. Ninguno de sus
// nombres exportados choca entre ellos ni contra lo de arriba (comprobado con un diff de las
// listas de exportación antes de añadir estas líneas), así que `export *` alcanza para los
// cinco. La única colisión real la resuelve `metricas.ts` puertas adentro: sus DTOs usan nombres
// distintos de los de `iniciativas.ts` aunque ambos hablen de iniciativas.
export * from './metricas.js';
export * from './evaluacion.js';
export * from './asistente.js';
export * from './iniciativas.js';
export * from './consenso.js';
