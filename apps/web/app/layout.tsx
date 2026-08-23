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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sin `maximumScale`: impedir el zoom es la forma más común de romper WCAG sin darse cuenta.
  themeColor: '#0b4fa8',
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
