#!/usr/bin/env node
/**
 * `npx @koinonia/verificar <ruta-al-paquete>`.
 *
 * Deliberadamente diminuto: aquí sólo se conectan el disco, la salida estándar y el reloj. Todo lo
 * que se puede equivocar vive en `programa.ts`, y por eso está probado.
 */

import { readFile } from 'node:fs/promises';

import { directorySource } from './fuente-directorio.js';
import { ejecutar } from './programa.js';

const resultado = await ejecutar(process.argv.slice(2), {
  escribir: (linea) => {
    process.stdout.write(`${linea}\n`);
  },
  abrir: directorySource,
  leerFichero: (ruta) => readFile(ruta, 'utf8'),
  ahora: () => new Date().toISOString(),
});

process.exitCode = resultado.codigo;
