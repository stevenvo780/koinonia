/**
 * `services/api/src/almacen` — el puerto de almacenamiento de objetos binarios: hoy en disco local,
 * listo para S3 el día que haga falta y esté autorizado instalar el SDK.
 *
 * Barrel local, no el punto de entrada del paquete — mismo aviso que `jobs/index.ts`.
 */

export { almacenEnDisco, ObjetoCorruptoError } from './disco.js';
export { crearAlmacen, type ConfiguracionAlmacen } from './fabrica.js';
export {
  ClaveInvalidaError,
  validarClave,
  validarPrefijo,
  type AlmacenDeObjetos,
  type MetadatosDeObjeto,
  type ObjetoLeido,
  type OpcionesDeGuardado,
} from './puerto.js';
export { almacenEnS3, AlmacenS3NoDisponibleError, type ConfiguracionAlmacenS3 } from './s3.js';
