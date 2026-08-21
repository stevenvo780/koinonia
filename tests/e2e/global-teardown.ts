/** Apaga lo que levantó `global-setup`. Corre en el mismo proceso, así que tiene los mismos objetos. */

import { rmSync } from 'node:fs';

import { RUTA_ENTORNO } from './global-setup.js';

export default async function globalTeardown(): Promise<void> {
  const estado = globalThis.__koinoniaE2E;
  if (estado !== undefined) {
    await new Promise<void>((listo) =>
      estado.reloj.close(() => {
        listo();
      }),
    );
    await estado.servidor.close().catch(() => undefined);
    await estado.pool.end().catch(() => undefined);
    await estado.contenedor.stop().catch(() => undefined);
  }
  rmSync(RUTA_ENTORNO, { force: true });
}
