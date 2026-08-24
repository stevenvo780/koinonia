/**
 * `crearAlmacen`: un único punto de entrada para elegir implementación por configuración.
 *
 * Quien construye el servidor declara `{ tipo: 'disco', directorioBase }` hoy y, el día que exista
 * el adaptador de S3, cambia a `{ tipo: 's3', bucket, region, ... }` sin tocar ningún llamador — es
 * la razón de ser de un puerto: el código que guarda un adjunto de tarea no sabe ni le importa cuál
 * de los dos está detrás.
 */

import { almacenEnDisco } from './disco.js';
import type { AlmacenDeObjetos } from './puerto.js';
import { almacenEnS3, type ConfiguracionAlmacenS3 } from './s3.js';

export type ConfiguracionAlmacen =
  | { readonly tipo: 'disco'; readonly directorioBase: string }
  | ({ readonly tipo: 's3' } & ConfiguracionAlmacenS3);

export function crearAlmacen(config: ConfiguracionAlmacen): AlmacenDeObjetos {
  switch (config.tipo) {
    case 'disco':
      return almacenEnDisco(config.directorioBase);
    case 's3':
      return almacenEnS3(config);
  }
}
