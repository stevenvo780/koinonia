import Link from 'next/link';
import type { ReactNode } from 'react';

import { tituloDe } from '@/app/titulo';

/**
 * La pantalla de «esa dirección no existe».
 *
 * Sin este fichero, Next.js sirve la suya: un «404: This page could not be found.» en inglés, sobre
 * fondo blanco, sin cabecera ni pie ni una sola salida. Se comprobó en producción —
 * `curl .../ruta-que-no-existe` devolvía exactamente esa frase—, así que no era una hipótesis: la
 * única pantalla en inglés de toda la aplicación era justamente la que le toca a quien llegó
 * perdido, que es quien menos margen tiene para lidiar con eso.
 *
 * Tres decisiones sobre el texto:
 *
 *  1. **No culpa a nadie y no adivina.** Un enlace roto de un mensaje reenviado, una dirección
 *     escrita a mano y una pantalla retirada llevan acá, y desde el servidor no se distinguen. Se
 *     dice lo único que se sabe con certeza —que en esa dirección no hay nada— y se ofrecen
 *     salidas, en vez de inventar un «quizá quisiste decir…».
 *  2. **Las salidas son las de verdad, no una sola al inicio.** Quien buscaba una decisión que ya no
 *     está no quiere volver a la portada: quiere el historial, donde nada se borra. Por eso están
 *     los tres sitios donde puede estar lo que buscaba.
 *  3. **Es un componente de servidor**, así que no arrastra ni un kilobyte de JavaScript a la
 *     pantalla que más gente ve por accidente.
 */
export const metadata = tituloDe('Acá no hay nada');

export default function NoEncontrado(): ReactNode {
  return (
    <div className="pagina-prosa">
      <h1>Acá no hay nada</h1>
      <p>
        La dirección que abriste no corresponde a ninguna pantalla. Puede ser un enlace viejo, una
        dirección con una letra de más, o algo que quien lo escribió retiró después.
      </p>
      <p>
        Nada de lo que pasó por Koinonía se borra, así que si buscabas algo que existió, sigue
        escrito:
      </p>
      <ul>
        <li>
          <Link href="/historial">Todo lo que quedó escrito</Link> — todo lo que pasó, en orden y
          sin filtrar.
        </li>
        <li>
          <Link href="/problemas">Problemas</Link> — lo que está abierto ahora mismo.
        </li>
        <li>
          <Link href="/decisiones">Decisiones</Link> — lo que ya se decidió y con qué resultado.
        </li>
      </ul>
      <p>
        <Link className="boton" href="/">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
