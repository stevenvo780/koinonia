#!/usr/bin/env node
/**
 * Punto de entrada ejecutable. Lo único de todo el paquete que hace algo por el hecho de cargarse.
 *
 * Existe separado de `server.ts` para que importar `@koinonia/api` no arranque nada: un módulo de
 * librería con efectos al importarse es una bomba de relojería que estalla el día que alguien lo
 * importa desde un test.
 */

import { main } from './server.js';

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
