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
