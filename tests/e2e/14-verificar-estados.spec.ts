/**
 * ESCENARIO 14 — Los tres estados de «Comprobar que nada se cambió», y el titular que distingue.
 *
 * La pantalla de verificación tiene tres estados y **ninguno es verde**:
 *
 *  1. **Vacío** — no hay nada escrito todavía. Es lo que ve el grupo el primer día, y es la
 *     pantalla que todos olvidan. Sobre cero cosas no se enseñan seis comprobaciones.
 *  2. **Sin confirmar** — el servidor dice que los enganches cuadran. Lo dice él, que es la parte
 *     interesada, así que el veredicto es ámbar y la salvedad va pegada al veredicto.
 *  3. **Alarma** — algo dejó de cuadrar.
 *
 * Y dentro de la alarma hay una decisión de diseño que hoy no probaba nadie: **el titular está
 * condicionado**. Si lo único que falla es la revisión de material privado —que es local, que no
 * habla del historial público y que puede fallar porque falte o sobre una apertura—, el titular no
 * puede ser «El historial fue alterado». Gritar eso delante de trescientas personas por algo que no
 * es una manipulación del historial gasta la misma credibilidad que un verde fingido, sólo que en
 * el otro sentido. Basta con que falle **cualquier otro** punto para que el titular vuelva a ser la
 * acusación entera.
 *
 * ═══ Por qué acá se fija el informe y en el escenario 5 no ═══
 *
 * Lo que se prueba en este fichero es **la decisión de la pantalla**: qué titular elige, qué
 * esconde y qué enseña, dado un informe. Eso son tres estados y dos ramas de un titular, y dos de
 * ellos —el historial vacío y «sólo falla el material privado»— no se pueden producir contra la
 * base real sin desmontar el historial que comparten todos los escenarios.
 *
 * Así que el informe se fija en la respuesta, pero **no se inventa**: se pide el de verdad al
 * servicio y se le tocan los bits justos —el número de hechos, o la marca `bien` de un punto—. Los
 * identificadores y los textos de cada punto siguen siendo los del servidor, que es lo que hace que
 * `material-privado` signifique acá lo mismo que allá.
 *
 * Esto **no sustituye** a nada: que una manipulación de verdad se denuncie de verdad se prueba en
 * `05-inmutabilidad`, contra el ledger, con el superusuario y sin ningún doble. Acá se prueba lo
 * que ese escenario no puede alcanzar.
 */

import { expect, type Page, test } from '@playwright/test';

import type { InformeIntegridad } from '@koinonia/contracts';

import {
  afirmacionesDeQueEstaBien,
  apiAnonima,
  contenido,
  NO_ES_PRUEBA_DE_SI_MISMA,
  puntoQueFalla,
} from './ayudas.js';

/**
 * El identificador del único punto de la revisión que **no** habla del historial público.
 *
 * Está escrito dos veces —acá y en `apps/web/app/verificar/page.tsx`— porque son dos lados de un
 * acuerdo, y el `beforeAll` de este fichero comprueba que el servidor lo sigue emitiendo. Si el
 * servicio lo renombrara, la pantalla dejaría de reconocerlo y volvería a gritar «El historial fue
 * alterado» por una apertura privada que falta: un fallo silencioso que sólo se nota el día que ya
 * hizo el daño.
 */
const REVISION_LOCAL = 'material-privado';

let informeReal: InformeIntegridad;

test.beforeAll(async () => {
  const api = await apiAnonima();
  try {
    const respuesta = await api.get('/integridad');
    expect(respuesta.status(), await respuesta.text()).toBe(200);
    informeReal = (await respuesta.json()) as InformeIntegridad;
  } finally {
    await api.dispose();
  }

  expect(
    informeReal.todoBien,
    'el escenario 5 tiene que haber repuesto el historial antes de llegar acá',
  ).toBe(true);
  expect(informeReal.hechosRevisados).toBeGreaterThan(0);

  // El acuerdo entre el servicio y la pantalla, comprobado y no supuesto.
  expect(
    informeReal.comprobaciones.map((punto) => punto.id),
    'la pantalla decide el titular por este identificador exacto',
  ).toContain(REVISION_LOCAL);
});

/** Pinta la pantalla de verificación con un informe dado, sin tocar el historial de nadie. */
async function pintar(page: Page, informe: InformeIntegridad): Promise<void> {
  await page.route('**/api/integridad', async (ruta) => {
    await ruta.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(informe),
    });
  });
  await page.goto('/verificar');
}

/**
 * El informe real con los puntos indicados marcados como fallados.
 *
 * `todoBien` se recalcula en vez de fijarse a mano: es lo que hace el servicio, y fijarlo aparte
 * permitiría un informe imposible —«todo bien» con un punto en rojo— que no prueba nada de la
 * pantalla.
 */
function conFallosEn(...ids: readonly string[]): InformeIntegridad {
  const comprobaciones = informeReal.comprobaciones.map((punto) =>
    ids.includes(punto.id)
      ? {
          ...punto,
          bien: false,
          queSignifica: `Fijado por la prueba: el punto «${punto.id}» dejó de cuadrar.`,
          detalle: `${punto.id}-roto: 1`,
        }
      : punto,
  );
  return {
    ...informeReal,
    comprobaciones,
    todoBien: comprobaciones.every((punto) => punto.bien),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Estado 1 — el primer día
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('con el historial vacío no enseña un tablero de comprobaciones sobre nada', async ({
  page,
}) => {
  const { historialDesde: _sinFecha, ...primerDia } = informeReal;
  await pintar(page, { ...primerDia, hechosRevisados: 0 });

  const veredicto = page
    .getByRole('status')
    .filter({ hasText: 'Todavía no hay nada que comprobar' });
  await expect(veredicto).toBeVisible();
  await expect(veredicto).toContainText('Nadie ha escrito nada todavía');

  // La pieza de honestidad también acá, y no como adorno: el día que haya algo que comprobar, lo
  // que va a valer es la comprobación de afuera, y eso se dice desde el primer día.
  await expect(veredicto).toContainText(NO_ES_PRUEBA_DE_SI_MISMA);
  await expect(veredicto.getByRole('link', { name: 'Comprobalo por fuera' })).toBeVisible();

  // Seis comprobaciones sobre cero cosas eran seis tarjetas que no informaban de nada.
  await expect(page.getByText('El archivo empieza en blanco', { exact: false })).toBeVisible();
  await expect(page.locator('ul.tarjetas > li')).toHaveCount(0);
  await expect(
    page.locator('summary', { hasText: 'Ver la revisión que hizo el servidor' }),
  ).toHaveCount(0);

  // Ni alarma ni promesa: no hay nada que denunciar y no hay nada que garantizar.
  await expect(contenido(page).getByRole('alert')).toHaveCount(0);
  const texto = await page.locator('main').innerText();
  expect(texto).not.toMatch(/verde/iu);
  expect(texto).not.toContain('Todas las comprobaciones pasaron');
  // Sobre un historial vacío la pantalla ni siquiera saca el tema: no hay nada que declarar bien,
  // así que la frase no aparece —ni afirmada ni negada—.
  expect(
    afirmacionesDeQueEstaBien(texto),
    'sobre cero cosas no se declara nada, ni bien ni mal',
  ).toHaveLength(0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Estado 2 — sin confirmar
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('cuando todo cuadra el veredicto es «Sin confirmar», y la salvedad va pegada', async ({
  page,
}) => {
  await pintar(page, informeReal);

  const veredicto = contenido(page).getByRole('status').filter({ hasText: 'Sin confirmar' });
  await expect(veredicto).toBeVisible();

  // Las dos frases van en el MISMO bloque que el veredicto, no tres párrafos más abajo. El orden
  // contrario —la promesa arriba, el «pero» al final— es exactamente el que convierte una
  // herramienta honesta en una garantía fingida.
  await expect(veredicto).toContainText(
    'aprobar su propio examen no es un éxito, es una presunción',
  );
  await expect(veredicto).toContainText(NO_ES_PRUEBA_DE_SI_MISMA);
  await expect(veredicto).toContainText('no vas a leer que está todo bien');

  await expect(contenido(page).getByRole('alert')).toHaveCount(0);
  await expect(puntoQueFalla(page)).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Estado 3 — la alarma, y el titular que la calibra
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('si falla un enganche del historial, el titular es la acusación entera', async ({ page }) => {
  await pintar(page, conFallosEn('cadena'));

  const alarma = contenido(page).getByRole('alert');
  await expect(alarma).toContainText('El historial fue alterado');
  await expect(alarma).not.toContainText('Falta material privado');
  await expect(alarma).toContainText('No es un fallo técnico ni un error de carga');
  await expect(alarma).toContainText('Esto se publica, no se arregla en silencio.');
  await expect(alarma).toContainText(NO_ES_PRUEBA_DE_SI_MISMA);
  await expect(
    alarma.getByRole('link', { name: 'Qué dejó de cuadrar, exactamente' }),
  ).toBeVisible();

  await expect(puntoQueFalla(page)).toHaveCount(1);
  await expect(page.getByText('Acá no cuadra').first()).toBeVisible();
});

test('si lo ÚNICO que falla es el material privado, el titular NO acusa al historial', async ({
  page,
}) => {
  await pintar(page, conFallosEn(REVISION_LOCAL));

  const alarma = contenido(page).getByRole('alert');
  await expect(alarma).toBeVisible();

  // Lo que NO puede decir. Es una alarma falsa, y una alarma falsa se cobra la misma credibilidad
  // que un verde fingido.
  await expect(alarma).not.toContainText('El historial fue alterado');

  // Lo que sí dice: qué falta, que no es culpa de quien mira, y dónde está el detalle.
  await expect(alarma).toContainText('Falta material privado que el historial dejó anotado');
  await expect(alarma).toContainText('Los enganches del historial siguen cuadrando');
  await expect(alarma).toContainText('No es un fallo de esta pantalla ni de tu conexión.');
  await expect(alarma).toContainText(NO_ES_PRUEBA_DE_SI_MISMA);
  await expect(
    alarma.getByRole('link', { name: 'Qué se revisó y qué quiere decir' }),
  ).toBeVisible();

  // Y sigue siendo una alarma: se destaca el punto que falla, no se disuelve entre los que pasaron.
  await expect(puntoQueFalla(page)).toHaveCount(1);
  await expect(page.getByText('Acá no cuadra').first()).toBeVisible();
});

test('un fallo local NO tapa uno del historial: si fallan los dos, el titular acusa', async ({
  page,
}) => {
  // La distinción es «TODOS los que fallan son locales», no «alguno lo es». Con esta combinación un
  // titular que se decidiera por «alguno» escondería una manipulación del historial detrás de una
  // frase suave, que es el peor de los dos errores posibles en esta pantalla.
  await pintar(page, conFallosEn(REVISION_LOCAL, 'cadena'));

  const alarma = contenido(page).getByRole('alert');
  await expect(alarma).toContainText('El historial fue alterado');
  await expect(alarma).not.toContainText('Falta material privado');
  await expect(puntoQueFalla(page)).toHaveCount(2);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Lo que no se puede perder en ninguna refactorización
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('la frase que sostiene la pantalla está, verbatim, en los tres estados', async ({ page }) => {
  const { historialDesde: _sinFecha, ...primerDia } = informeReal;
  const estados: readonly { readonly nombre: string; readonly informe: InformeIntegridad }[] = [
    { nombre: 'vacío', informe: { ...primerDia, hechosRevisados: 0 } },
    { nombre: 'sin confirmar', informe: informeReal },
    { nombre: 'alarma', informe: conFallosEn('cadena') },
  ];

  for (const estado of estados) {
    await page.unroute('**/api/integridad');
    await pintar(page, estado.informe);
    /*
     * La primera navegación del proceso (hidratación + primer fetch de /api/integridad) puede tardar
     * más que las siguientes: sin esperar a que el veredicto real reemplace el «Cargando la
     * comprobación…» inicial, `innerText()` captura ese estado transitorio y la prueba falla por una
     * carrera, no por una frase perdida de verdad.
     *
     * Se esperaba a que hubiera un «status» o un «alert» visible, y NO alcanzaba: el propio
     * cargador es un `status`, así que la espera se cumplía con él y seguía habiendo carrera. Se vio
     * fallar en una corrida completa y pasar 3 de 3 aislada, que es la firma de esto.
     *
     * Lo que se espera ahora es que el cargador se haya IDO, que es la condición que de verdad
     * significa «ya hay veredicto», sea del rol que sea —«status» en vacío y sin confirmar, «alert»
     * en alarma—.
     */
    await expect(page.getByText('Cargando la comprobación…')).toBeHidden();
    await expect(page.getByRole('status').or(page.getByRole('alert')).first()).toBeVisible();
    const texto = await page.locator('main').innerText();
    expect(texto, `falta la frase en el estado «${estado.nombre}»`).toMatch(
      NO_ES_PRUEBA_DE_SI_MISMA,
    );
  }
});
