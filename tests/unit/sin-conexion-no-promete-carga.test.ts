import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * La copia sin conexión no puede prometer algo que no va a llegar.
 *
 * ═══ Qué se protege ═══
 *
 * `apps/web/public/sw.js` guarda el HTML que el servidor mandó **antes** de que la aplicación
 * pidiera nada, y le quita los `<script>` a propósito —está argumentado ahí mismo: React hidrata
 * todo el documento y borraría el aviso de «sin conexión» en cuanto arrancara—. La consecuencia es
 * que ese HTML se queda congelado con el estado inicial de carga: «Cargando las decisiones…» y las
 * tarjetas de relleno. Una prueba de humo contra producción encontró justo eso: recargar
 * `/decisiones` sin conexión dejaba ese texto para siempre, debajo del aviso que decía que no había
 * conexión. Dos mensajes que se contradicen, y el que engaña es el que está donde mira la vista.
 *
 * ═══ Por qué el segundo caso importa más que el primero ═══
 *
 * El service worker reescribe ese HTML buscando `class="cargando"`, `class="tarjetas esqueleto"` y
 * `class="solo-lectores"`. Son nombres que pone `apps/web/components`, y un service worker no
 * importa componentes: si alguien renombra una de esas clases, las expresiones dejan de encontrar
 * nada **en silencio** y la pantalla sin conexión vuelve a mentir sin que ninguna prueba se ponga
 * en rojo. Por eso el segundo caso comprueba que el acoplamiento sigue en pie: no prueba el service
 * worker, prueba que el service worker todavía habla de algo que existe.
 *
 * Comprobado rompiéndolo: cambiando `cargando` por `cargando-x` en la expresión del service worker
 * falla el primero; renombrando la clase en `marco.tsx` falla el segundo. Restaurado.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(RAIZ, 'apps', 'web');

/**
 * Carga las funciones puras del service worker.
 *
 * No se puede `import`: es un guion de navegador, sin exportaciones, y su último renglón registra
 * un oyente en `self`. Se ejecuta con un `self` de mentira y se devuelven las dos funciones que
 * sólo tocan texto.
 */
function funcionesDelServiceWorker(): {
  readonly sinPromesaDeCarga: (html: string) => string;
} {
  const fuente = readFileSync(join(WEB, 'public', 'sw.js'), 'utf8');
  // No es eval sobre texto dinámico ni dependiente de entrada externa: es la única forma de
  // ejecutar un guion de navegador sin exportaciones (sw.js) dentro de un módulo de prueba, con
  // una fuente fija leída del propio repositorio en tiempo de prueba.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fabricar = new Function('self', `${fuente}\nreturn { sinPromesaDeCarga };`) as (
    self: unknown,
  ) => { readonly sinPromesaDeCarga: (html: string) => string };
  return fabricar({ addEventListener: () => undefined });
}

/**
 * Marcado copiado LETRA POR LETRA de `apps/web/.next/server/app/problemas.html` recién construido.
 *
 * Se copia en vez de leer el fichero construido porque una prueba que depende de que alguien haya
 * corrido `build:web` antes falla por el motivo equivocado. Los comentarios vacíos no son basura:
 * son lo que React intercala alrededor del texto interpolado, y son justo lo que hace que un
 * `indexOf('Cargando los problemas…')` ingenuo no encuentre nada.
 */
const COMO_LO_MANDA_EL_SERVIDOR =
  '<section><ul class="tarjetas esqueleto" aria-hidden="true">' +
  '<li><div class="esqueleto-linea esqueleto-titulo"></div>' +
  '<div class="esqueleto-linea esqueleto-pildora"></div><div class="esqueleto-linea"></div></li>' +
  '</ul><div class="solo-lectores"><p class="cargando" role="status">' +
  'Cargando <!-- -->los problemas<!-- -->…</p></div></section>';

describe('la pantalla guardada sin conexión', () => {
  it('cambia «Cargando…» por lo que de verdad pasa, y se lleva las tarjetas de relleno', () => {
    const { sinPromesaDeCarga } = funcionesDelServiceWorker();
    const sinConexion = sinPromesaDeCarga(COMO_LO_MANDA_EL_SERVIDOR);

    expect(sinConexion).not.toMatch(/Cargando/u);
    expect(sinConexion).toContain('Sin conexión no hay forma de mostrar los problemas.');
    // Las tarjetas de relleno existen para reservar la altura de lo que está por llegar. Sin
    // conexión no está por llegar nada, y dejarlas es la misma promesa dicha con formas.
    expect(sinConexion).not.toMatch(/esqueleto/u);
    // Y el aviso deja de estar sólo para lectores de pantalla: al quitar las tarjetas es lo único
    // que queda por decir ahí, así que tiene que verse.
    expect(sinConexion).not.toMatch(/solo-lectores/u);
    expect(sinConexion).toMatch(/role="status"/u);
  });

  it('no toca un documento que no traía nada cargándose', () => {
    const { sinPromesaDeCarga } = funcionesDelServiceWorker();
    const yaResuelto =
      '<section><ul class="tarjetas"><li>Un problema de verdad</li></ul></section>';
    expect(sinPromesaDeCarga(yaResuelto)).toBe(yaResuelto);
  });

  it('sigue hablando de clases que los componentes todavía ponen', () => {
    const sw = readFileSync(join(WEB, 'public', 'sw.js'), 'utf8');
    const marco = readFileSync(join(WEB, 'components', 'marco.tsx'), 'utf8');
    const piezas = readFileSync(join(WEB, 'components', 'piezas.tsx'), 'utf8');

    // `Cargando` (marco.tsx): la clase y el texto exacto que el service worker desarma.
    expect(marco).toMatch(/'cargando'/u);
    expect(marco).toMatch(/Cargando \{que\}…/u);
    expect(sw).toContain('class="cargando');

    // `Esqueleto` (piezas.tsx): las tarjetas de relleno y el envoltorio que las acompaña.
    expect(piezas).toContain('"tarjetas esqueleto"');
    expect(piezas).toContain('"solo-lectores"');
    expect(sw).toContain('class="tarjetas esqueleto" aria-hidden="true"');
    expect(sw).toContain('class="solo-lectores"');
  });
});
