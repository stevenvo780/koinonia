'use client';

import type { ReactNode } from 'react';

import './globals.css';

/**
 * El último borde: el que atrapa un fallo del propio layout raíz.
 *
 * `error.tsx` vive dentro del layout, así que no puede atrapar un fallo del layout mismo —de la
 * cabecera, por ejemplo, que es un componente de cliente con estado—. Cuando eso pasa, Next.js
 * reemplaza el documento entero por este, y por eso acá hay que pintar `<html>` y `<body>` a mano.
 *
 * Es deliberadamente austero: si el layout falló, cualquier cosa que dependa de él puede fallar
 * también. Sin cabecera, sin navegación, sin nada que pueda volver a romperse; sólo la hoja de
 * estilos, para que el papel y los tipos sean los de siempre y esto no parezca otra aplicación.
 * Tampoco hay enlaces de `next/link`: una recarga entera de `/` es lo que más probabilidades tiene
 * de dejar la aplicación en un estado sano otra vez.
 */
export default function ErrorGlobal({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): ReactNode {
  return (
    <html lang="es-CO">
      <body>
        <main id="contenido" className="interior">
          <div className="pagina-prosa">
            <h1>Koinonía no pudo abrir</h1>
            <p role="alert">
              Algo falló antes de que la aplicación terminara de cargar. Nada de lo que estaba
              escrito se perdió: el historial vive en el servidor y no se toca desde acá.
            </p>
            <p>
              <button type="button" className="boton" onClick={reset}>
                Volver a intentarlo
              </button>{' '}
              <a className="boton secundario" href="/">
                Recargar desde el inicio
              </a>
            </p>
            <p>
              Si vuelve a pasar, contalo con este número al lado:{' '}
              {error.digest === undefined ? (
                <em>esta vez no quedó número</em>
              ) : (
                <code>{error.digest}</code>
              )}
              .
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
