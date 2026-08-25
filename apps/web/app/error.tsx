'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * El borde de contención cuando una pantalla se rompe al pintarse.
 *
 * Sin este fichero, un fallo al renderizar deja la pantalla en blanco y el aviso por omisión de
 * Next.js, en inglés. Con él, el error queda contenido dentro de `<main>`: la cabecera, la
 * navegación y el pie siguen ahí, así que quien se topó con esto puede irse a otro lado sin tener
 * que reescribir la dirección a mano.
 *
 * **No se muestra el mensaje del error.** No es prudencia decorativa: ese texto viene de una
 * excepción de JavaScript, está en inglés, nombra la mecánica del motor —lo que ADR-0041 prohíbe en
 * pantalla— y puede arrastrar el contenido que se estaba pintando cuando reventó. Lo que sí se
 * muestra es el `digest`, que es un identificador opaco que Next.js pone del lado del servidor: no
 * dice nada de nadie y sirve para que dos personas hablen del mismo fallo.
 *
 * El botón de volver a intentar existe porque una parte de estos fallos son de una sola vez —una
 * respuesta a medias, una red que se cortó en el peor momento— y `reset()` vuelve a pintar sin
 * recargar la aplicación entera.
 */
export default function ErrorDePantalla({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}): ReactNode {
  return (
    <div className="pagina-prosa">
      <h1>Esta pantalla se rompió</h1>
      <p role="alert">
        No pudimos terminar de mostrarla. No es culpa de lo que hiciste, y no se perdió nada de lo
        que ya estaba escrito: el historial no se toca desde acá.
      </p>
      <p>
        <button type="button" className="boton" onClick={reset}>
          Volver a intentarlo
        </button>
      </p>
      <p>
        Si vuelve a pasar, contalo con este número al lado —es lo que permite encontrar el fallo
        exacto sin tener que adivinar—:{' '}
        {error.digest === undefined ? (
          <em>esta vez no quedó número</em>
        ) : (
          <code>{error.digest}</code>
        )}
        .
      </p>
      <p>
        <Link href="/">Ir al inicio</Link> ·{' '}
        <Link href="/historial">Todo lo que quedó escrito</Link>
      </p>
    </div>
  );
}
