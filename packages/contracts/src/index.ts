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

export * from './metricas.js';
export * from './evaluacion.js';
export * from './asistente.js';
export * from './iniciativas.js';
export * from './consenso.js';
export * from './metodos.js';

// ── Cinco incrementos más, integrados en esta misma fase ─────────────────────────────────────
//
// Doce agentes escribieron estos ficheros en paralelo sin hablarse entre sí. Comprobado con un
// diff de las listas de exportación de cada uno contra lo que ya vive arriba: ningún nombre choca
// (`comm -12` entre ambas listas, vacío), así que `export *` alcanza para los cinco que faltaban.
export * from './aprendizajes.js';
export * from './cierre-ciclo.js';
export * from './concentracion.js';
export * from './etapas.js';

// ── Sexto incremento: desestimación de objeciones (B.3.a, ADR-0031, ADR-0032) ────────────────
//
// `services/api/src/http/rutas-objeciones.ts` escribió su propio esquema Zod local porque esta
// línea todavía no existía cuando ese fichero se escribió (ver la cabecera de `objeciones.ts`).
// Ningún nombre choca con lo ya exportado (comprobado con grep sobre los cuatro nombres de este
// módulo contra el resto de `packages/contracts/src`), así que `export *` alcanza también acá.
export * from './objeciones.js';
