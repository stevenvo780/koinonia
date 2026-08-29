import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Cabecera } from '../components/marco';

import './globals.css';

export const metadata: Metadata = {
  title: 'Koinonía',
  description:
    'Gobernanza del estudiantado del Instituto de Filosofía de la Universidad de Antioquia. ' +
    'Escribí un problema, discutilo con plazo y decidí con constancia verificable.',
  manifest: '/manifest.webmanifest',
  /*
   * El icono existía en `public/icono.svg` y no lo declaraba nadie, así que el navegador hacía lo
   * que hace por omisión —pedir `/favicon.ico`— y se llevaba un 404 en CADA carga de CADA pantalla.
   * Declararlo apaga esa petición perdida y además pone el icono real en la pestaña.
   *
   * SVG y no `.ico`: es un rasterizado lo que este proyecto evita, y un `.ico` son mapas de bits
   * de varios tamaños. Éste pesa 300 bytes y escala a cualquier resolución.
   */
  icons: { icon: [{ url: '/icono.svg', type: 'image/svg+xml' }] },
  applicationName: 'Koinonía',
  formatDetection: { telephone: false },
};

/**
 * Cada visita se arma de nuevo, y no es una preferencia: es lo que sostiene la política de contenido.
 *
 * `middleware.ts` pone un número de un solo uso por respuesta y Next.js se lo sella a todos sus
 * guiones — pero sólo puede sellarlos si la pantalla se arma en esa misma respuesta. Con las
 * pantallas prehorneadas en la construcción, el HTML servido no lleva número, la cabecera sí, y el
 * navegador bloquea **todos** los guiones: la aplicación queda muerta, con la cáscara pintada y sin
 * nada que responda. Se comprobó midiendo las dos: `/problemas` forzada a armarse en cada visita
 * traía el mismo número que la cabecera; `/historial`, prehorneada, no traía ninguno.
 *
 * Por eso esta línea es carga estructural y no cosmética. Si alguien la quita, la política pasa a
 * bloquear la aplicación entera en producción — y por eso hay una prueba que lo comprueba en las
 * pantallas de verdad (`tests/e2e/15-politica-de-contenido.spec.ts`) en vez de confiar en que este
 * comentario se lea.
 *
 * Lo que cuesta es poco acá: estas pantallas son componentes de cliente y lo que se prehorneaba era
 * una cáscara vacía —el contenido siempre vino de `/api/*`—, así que armarla no es más trabajo que
 * leerla de disco. Y `/_next/static/`, que es casi todo el peso que viaja, queda fuera del filtro
 * del middleware y se sigue sirviendo igual.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sin `maximumScale`: impedir el zoom es la forma más común de romper WCAG sin darse cuenta.
  //
  // El color de la barra del sistema es el verde institucional de la Universidad de Antioquia
  // (#026937, el del membrete), así que en el teléfono la aplicación empieza antes del primer
  // píxel de la página. Acá va el institucional PURO y no el `--acento` aclarado de `globals.css`:
  // esto es una superficie, no un texto, así que no le aplica el piso de contraste de 7.2:1.
  //
  // Tiene que coincidir con `theme_color` de `public/manifest.webmanifest`. No coincidían: éste
  // decía petróleo `#0d4c58` y aquél un azul `#0b4fa8` que no era de la paleta de nadie, así que
  // la barra del sistema cambiaba de color según se abriera la aplicación desde el navegador o
  // desde el icono instalado.
  themeColor: '#026937',
  // Declarar el esquema no es cosmética: sin esto, el modo oscuro automático de algunos
  // navegadores repinta el papel cálido y los campos por su cuenta, y los contrastes medidos en
  // `globals.css` dejan de ser los que están escritos. Acá hay un solo esquema y es claro.
  colorScheme: 'light',
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    // `es-CO` y no `es`: cambia cómo lee un lector de pantalla y cómo se formatean las fechas.
    <html lang="es-CO">
      <body>
        <a className="saltar" href="#contenido">
          Saltar al contenido
        </a>

        <Cabecera />

        <main id="contenido" className="interior">
          {children}
        </main>

        <footer className="pie">
          <div className="interior">
            <p>
              Koinonía{' '}
              <strong>no es un órgano de la Universidad de Antioquia ni la representa</strong>. Su
              infraestructura, sus datos y su historia son de la comunidad estudiantil, y cualquier
              miembro puede{' '}
              <Link href="/verificar" prefetch={false}>
                descargarlos y comprobarlos
              </Link>
              .
            </p>
            {/*
             * El enlace va en el pie y NO en la navegación principal, y es a propósito: la barra
             * enseña el recorrido —lo que se hace acá— y esta pantalla no es un paso del recorrido,
             * es la respuesta a «¿por qué debería creerles?». Va donde ya está la frase que plantea
             * esa pregunta, que es este mismo párrafo.
             */}
            {/*
             * El texto de acá NO puede decir «administra el servidor», y no es un capricho de
             * estilo: la pantalla de una deliberación abierta usa esa frase exacta para avisar
             * quiénes SÍ pueden ver lo que todavía no tiene nombre, y `08-deliberacion.spec.ts`
             * comprueba que ese aviso esté a la vista. Como el pie sale en las 34 pantallas, decirlo
             * también acá metía una segunda aparición en la misma página y la prueba dejaba de poder
             * señalar la que importa. Se dice lo mismo con otras palabras.
             */}
            <p>
              <Link href="/arquitectura" prefetch={false}>
                Quién es dueño de esto
              </Link>{' '}
              — por qué no hace falta creerle a quien tiene la máquina, y cómo participar sin
              pedirle permiso a nadie.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
