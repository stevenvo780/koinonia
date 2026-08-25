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
  // El color de la barra del sistema es el acento de la marca —petróleo #0d4c58, el mismo del
  // membrete y de los enlaces—, así que en el teléfono la aplicación empieza antes del primer
  // píxel de la página.
  themeColor: '#0d4c58',
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
          </div>
        </footer>
      </body>
    </html>
  );
}
