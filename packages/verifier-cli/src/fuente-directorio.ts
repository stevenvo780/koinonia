/**
 * Fuente de export sobre un directorio del disco.
 *
 * Es el ÚNICO módulo del paquete que toca Node. Todo lo demás —el formato, las comprobaciones, el
 * informe— corre igual en un navegador, que es lo que permite reutilizar este mismo código en la
 * pantalla «Verificar integridad» sin duplicar la lógica de verificación.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ExportSource } from './formato.js';

export class RutaInvalidaError extends Error {
  constructor(ruta: string, detalle: string) {
    super(`${ruta}: ${detalle}`);
    this.name = 'RutaInvalidaError';
  }
}

export async function directorySource(raiz: string): Promise<ExportSource> {
  let info;
  try {
    info = await stat(raiz);
  } catch {
    throw new RutaInvalidaError(raiz, 'no existe');
  }
  if (!info.isDirectory()) {
    throw new RutaInvalidaError(
      raiz,
      'no es un directorio. Si tenés un .tar.gz, descomprimilo primero',
    );
  }

  return {
    name: raiz,
    async read(relativo: string): Promise<Uint8Array | undefined> {
      // Sin `..`: el nombre del fichero viene del manifiesto, que es un dato hostil, y un
      // `../../etc/passwd` en la lista de ficheros no debe poder leer nada de fuera del paquete.
      const destino = path.resolve(raiz, relativo);
      if (destino !== raiz && !destino.startsWith(raiz + path.sep)) return undefined;
      try {
        return new Uint8Array(await readFile(destino));
      } catch {
        return undefined;
      }
    },
    async list(): Promise<readonly string[]> {
      const salida: string[] = [];
      const recorrer = async (directorio: string, prefijo: string): Promise<void> => {
        const entradas = await readdir(directorio, { withFileTypes: true });
        for (const entrada of entradas.sort((a, b) => (a.name < b.name ? -1 : 1))) {
          const relativo = prefijo === '' ? entrada.name : `${prefijo}/${entrada.name}`;
          if (entrada.isDirectory()) {
            await recorrer(path.join(directorio, entrada.name), relativo);
          } else if (entrada.isFile()) {
            salida.push(relativo);
          }
        }
      };
      await recorrer(raiz, '');
      return salida;
    },
  };
}
