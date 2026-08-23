import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

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

        <header className="cabecera">
          <Link className="marca" href="/">
            Koinonía
          </Link>
          <nav className="principal" aria-label="Principal">
            <ul>
              <li>
                <Link href="/">Inicio</Link>
              </li>
              <li>
                <Link href="/problemas">Problemas</Link>
              </li>
              {/*
                Va entre Problemas y Decisiones porque ése es el recorrido real: un problema se
                conversa y después se decide. Faltaba, y sin el enlace la pantalla existía sólo para
                quien supiera escribir la dirección a mano, que es no existir.

                El texto del enlace es el mismo que el `h1` de destino, igual que los demás: quien
                navega con lector de pantalla salta por la lista de enlaces y tiene que reconocer a
                dónde llegó.
              */}
              <li>
                <Link href="/deliberaciones">Deliberaciones</Link>
              </li>
              <li>
                <Link href="/decisiones">Decisiones</Link>
              </li>
              {/*
                «Prestar tu voto» va pegado a Decisiones porque es lo mismo visto desde el otro
                lado: o votás, o le pedís a alguien que lleve tu parte. Separarlo del recorrido de
                decidir lo convertiría en una función de experta, que es lo contrario de lo que
                hace falta para que la use quien no puede estar pendiente.
              */}
              <li>
                <Link href="/delegaciones">Prestar tu voto</Link>
              </li>
              <li>
                <Link href="/consenso">En qué coincidimos</Link>
              </li>
              <li>
                <Link href="/iniciativas">Iniciativas</Link>
              </li>
              <li>
                <Link href="/mis-tareas">Mis tareas</Link>
              </li>
              {/*
                Los tres últimos son el bloque de «cómo funciona esto y cómo se comprueba»: quién
                decide qué, con qué reglas, y todo lo que quedó escrito. El texto de cada enlace es
                el mismo que el `h1` de destino, como los demás: quien navega saltando por la lista
                de enlaces tiene que reconocer a dónde llegó.
              */}
              <li>
                <Link href="/circulos">Quién decide qué</Link>
              </li>
              <li>
                <Link href="/normas">Las reglas del juego</Link>
              </li>
              <li>
                <Link href="/historial">Todo lo que quedó escrito</Link>
              </li>
              <li>
                <Link href="/verificar">Verificar</Link>
              </li>
            </ul>
          </nav>
        </header>

        <main id="contenido">{children}</main>

        <footer className="pie">
          <p>
            Koinonía{' '}
            <strong>no es un órgano de la Universidad de Antioquia ni la representa</strong>. Su
            infraestructura, sus datos y su historia son de la comunidad estudiantil, y cualquier
            miembro puede <Link href="/verificar">descargarlos y comprobarlos</Link>.
          </p>
        </footer>
      </body>
    </html>
  );
}
