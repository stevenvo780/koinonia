/**
 * `almacenEnS3`: DELIBERADAMENTE no implementado. Ver la nota de esta tarea:
 *
 * > No inventes un cliente de S3 a mano ni instales el SDK sin autorización: el objetivo es que el
 * > día que haga falta sea enchufar, no reescribir.
 *
 * Un cliente HTTP de S3 escrito a mano (firma SigV4, reintentos, paginación de `ListObjectsV2`,
 * `multipart upload` para objetos grandes) es exactamente el tipo de código que YA resolvió alguien
 * más y que reescribirlo mal es peor que no tenerlo: una firma SigV4 sutilmente incorrecta falla en
 * silencio contra ciertos proveedores compatibles con S3 y en voz alta contra otros. Ese trabajo es
 * `@aws-sdk/client-s3` (o el cliente que se autorice), y la regla de la casa es cero dependencias
 * npm nuevas sin autorización explícita — así que esto se queda como la forma que hay que llenar,
 * no como un intento de resolverlo sin permiso.
 *
 * Lo que SÍ deja listo este fichero, para que ese día sea "enchufar":
 *
 *  · `ConfiguracionAlmacenS3` — la forma exacta que necesita cualquier cliente S3 (bucket, región,
 *    endpoint opcional para compatibles como MinIO, estilo de ruta, prefijo).
 *  · `almacenEnS3(config)` con la MISMA firma que `almacenEnDisco(directorioBase)` — implementarla
 *    de verdad es sustituir el cuerpo de esta función por un objeto que traduzca cada método de
 *    `AlmacenDeObjetos` a `PutObject`/`GetObject`/`HeadObject`/`DeleteObject`/`ListObjectsV2`; nadie
 *    que llame a `crearAlmacen({ tipo: 's3', ... })` (`fabrica.ts`) tiene que cambiar una línea.
 */

import type { AlmacenDeObjetos } from './puerto.js';

export interface ConfiguracionAlmacenS3 {
  readonly bucket: string;
  readonly region: string;
  /** Para compatibles con S3 que no son AWS (MinIO, R2, etc.). Sin esto, el SDK usa AWS real. */
  readonly endpoint?: string;
  /** MinIO y varios compatibles lo necesitan; AWS real, no. */
  readonly forzarEstiloDeRuta?: boolean;
  /** Se antepone a toda clave — el equivalente al `directorioBase` de `almacenEnDisco`. */
  readonly prefijo?: string;
}

/** Lo que lanza `almacenEnS3` mientras no exista el adaptador de verdad. Mensaje accionable, no un `TODO` mudo. */
export class AlmacenS3NoDisponibleError extends Error {
  constructor() {
    super(
      'el almacén compatible con S3 no está implementado todavía: hace falta instalar ' +
        '@aws-sdk/client-s3 (o el cliente equivalente que se autorice) e implementar cada método ' +
        'de AlmacenDeObjetos sobre PutObject/GetObject/HeadObject/DeleteObject/ListObjectsV2 en ' +
        'services/api/src/almacen/s3.ts. La interfaz y la configuración ya están listas: es ' +
        'enchufar, no rediseñar.',
    );
    this.name = 'AlmacenS3NoDisponibleError';
  }
}

export function almacenEnS3(_config: ConfiguracionAlmacenS3): AlmacenDeObjetos {
  throw new AlmacenS3NoDisponibleError();
}
