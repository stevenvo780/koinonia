/**
 * ESCENARIO 13 — La navegación.
 *
 * La barra tenía **trece destinos al mismo nivel** y ocupaba 284 px de una pantalla de 800: casi la
 * mitad del teléfono era una lista de enlaces azules antes de que la página dijera de qué trata.
 * Ahora hay dos grupos —«El recorrido», numerado 1→5 y siempre visible, y «Consultar», plegado
 * tras un botón mientras el ancho es escaso— y la vuelta a la portada la hace el nombre de la
 * cabecera, que es lo que antes hacía un enlace llamado «Inicio».
 *
 * Un cambio de navegación es de los que se dan por buenos mirando la pantalla en el monitor de
 * quien lo escribió. Este fichero comprueba lo que ahí no se ve:
 *
 *  1. Que se sigue llegando **pulsando** a las cinco pantallas del recorrido. Una pantalla a la que
 *     sólo se llega escribiendo la dirección a mano no existe para nadie salvo para quien la
 *     escribió, y ése es el fallo que este proyecto ya cometió una vez con «Deliberaciones».
 *  2. Que quitar «Inicio» **no dejó sin vuelta a la portada**: la hace el nombre, y se comprueba
 *     pulsándolo, no leyendo el marcado.
 *  3. Que en el teléfono el segundo grupo se despliega **también con el teclado**. Un desplegable
 *     que sólo abre el dedo esconde seis destinos a quien navega tabulando, y eso no es un detalle
 *     estético: es media plataforma inalcanzable.
 *  4. Que «estás acá» llega al árbol de accesibilidad con `aria-current="page"` y no sólo como un
 *     borde azul, que para quien no ve el borde es no decir nada (WCAG 1.4.1).
 *
 * Y la medida que motivó todo esto: **dónde empieza el `h1` a 360×800**. Sin ese número el
 * rediseño es una opinión.
 *
 * Acá no se escribe nada en el historial y no hace falta cuenta a propósito: la navegación tiene
 * que funcionar igual para quien todavía no entró, que es justamente quien más la necesita.
 */

import AxeBuilder from '@axe-core/playwright';
import { forbiddenTermsIn } from '@koinonia/contracts';
import { expect, type Locator, type Page, test } from '@playwright/test';

/** El teléfono de la queja: 360 px de ancho, que es el más común que llega a este sitio. */
const TELEFONO = { width: 360, height: 800 } as const;

/**
 * El tope de la queja original.
 *
 * El `h1` empezaba en `y=373` de 800, o sea que el 47 % de la pantalla era barra. El listón se pone
 * en **un tercio**: no es el número que da hoy la medida —da bastante menos— sino el punto a partir
 * del cual volveríamos a tener el problema que se acaba de arreglar. Un umbral pegado a la medida
 * de hoy fallaría al primer retoque tipográfico sin que nada estuviera mal.
 */
const TOPE_H1 = Math.round(TELEFONO.height / 3);

/** Los cinco pasos, con el `h1` que tiene que aparecer al llegar. */
const RECORRIDO = [
  { enlace: 'Problemas', ruta: /\/problemas$/u },
  { enlace: 'Deliberaciones', ruta: /\/deliberaciones$/u },
  { enlace: 'Decisiones', ruta: /\/decisiones$/u },
  { enlace: 'Iniciativas', ruta: /\/iniciativas$/u },
  { enlace: 'Mis tareas', ruta: /\/mis-tareas$/u },
] as const;

/** Los siete de consulta. El `h1` de «Verificar» no es el texto del enlace; los otros seis sí. */
const CONSULTA = [
  { enlace: 'En qué coincidimos', encabezado: 'En qué coincidimos' },
  { enlace: 'Quién decide qué', encabezado: 'Quién decide qué' },
  { enlace: 'Reuniones', encabezado: 'Reuniones' },
  { enlace: 'Las reglas del juego', encabezado: 'Las reglas del juego' },
  { enlace: 'Prestar tu voto', encabezado: 'Prestar tu voto' },
  { enlace: 'Todo lo que quedó escrito', encabezado: 'Todo lo que quedó escrito' },
  { enlace: 'Verificar', encabezado: 'Comprobar que nada se cambió' },
] as const;

function navegacion(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Principal' });
}

/**
 * Tabula hasta el control y falla si no llega.
 *
 * Es la única forma de comprobar que algo es **alcanzable**: `focus()` pone el foco donde sea,
 * incluso donde el tabulador no llega nunca.
 */
async function tabularHasta(page: Page, destino: Locator, maximo = 40): Promise<void> {
  for (let intento = 0; intento < maximo; intento++) {
    await page.keyboard.press('Tab');
    if (await destino.evaluate((elemento) => elemento.ownerDocument.activeElement === elemento)) {
      return;
    }
  }
  throw new Error(`no se alcanzó el control con Tab después de ${String(maximo)} intentos`);
}

/** Cero violaciones A/AA, sin filtrar por gravedad, y ni una palabra de jerga. */
async function revisar(page: Page, donde: string): Promise<void> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const detalle = resultado.violations
    .map((v) => `· [${String(v.impact)}] ${v.id}: ${v.help}\n    ${v.nodes[0]?.html ?? ''}`)
    .join('\n');
  expect(resultado.violations, `Violaciones A/AA en ${donde}:\n${detalle}`).toEqual([]);

  const visible = await page.locator('body').innerText();
  expect(forbiddenTermsIn(visible), `jerga en ${donde}`).toEqual([]);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// El recorrido: cinco pantallas, y se llega pulsando
// ═══════════════════════════════════════════════════════════════════════════════════════════════

for (const [indice, destino] of RECORRIDO.entries()) {
  test(`paso ${String(indice + 1)} — «${destino.enlace}» se alcanza pulsando desde la portada`, async ({
    page,
  }) => {
    await page.goto('/');
    await navegacion(page).getByRole('link', { name: destino.enlace }).click();
    await expect(page).toHaveURL(destino.ruta);
    await expect(page.getByRole('heading', { level: 1, name: destino.enlace })).toBeVisible();
  });
}

test('el recorrido va numerado 1→5, y el número no se cuela en el nombre del enlace', async ({
  page,
}) => {
  await page.goto('/');
  const pasos = navegacion(page).getByRole('list', { name: 'El recorrido' }).getByRole('listitem');
  await expect(pasos).toHaveCount(RECORRIDO.length);

  for (const [indice, destino] of RECORRIDO.entries()) {
    // El número está a la vista…
    await expect(pasos.nth(indice)).toHaveText(
      new RegExp(`^${String(indice + 1)}\\s*${destino.enlace}$`, 'u'),
    );
    // …y **fuera** del enlace: si estuviera dentro, el nombre accesible sería «1 Problemas» y
    // dejaría de coincidir con el `h1` del destino, que es lo que oye quien salta por la lista de
    // enlaces. `getByRole` exige el nombre entero, así que esto sólo pasa si el número queda fuera.
    await expect(navegacion(page).getByRole('link', { name: destino.enlace })).toHaveCount(1);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// La portada: se llega igual, aunque ya no haya un enlace llamado «Inicio»
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('en la portada el nombre no se repite como enlace, pero el encabezado sigue estando', async ({
  page,
}) => {
  await page.goto('/');
  // Decirlo dos veces con 350 px de enlaces en medio no ayudaba a nadie, y ninguna de las dos
  // llevaba a ningún lado: ya estabas ahí.
  await expect(page.getByRole('link', { name: 'Koinonía' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Koinonía' })).toBeVisible();
});

test('desde otra pantalla se vuelve a la portada pulsando el nombre', async ({ page }) => {
  // Ésta es la prueba que sustituye al enlace «Inicio»: lo que importaba no era el enlace, era
  // poder volver. Se comprueba pulsando, que es como se vuelve de verdad.
  await page.goto('/decisiones');
  const nombre = page.getByRole('banner').getByRole('link', { name: 'Koinonía' });
  await expect(nombre).toBeVisible();
  await nombre.click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole('heading', { level: 1, name: 'Koinonía' })).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// «Estás acá», dicho donde lo oye un lector de pantalla
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('el enlace de la pantalla actual lleva aria-current="page", y es el único', async ({
  page,
}) => {
  await page.goto('/decisiones');
  await expect(navegacion(page).getByRole('link', { name: 'Decisiones' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // Uno y sólo uno: dos marcas de «estás acá» son igual de inútiles que ninguna.
  await expect(navegacion(page).locator('a[aria-current="page"]')).toHaveCount(1);
});

test('una pantalla de dentro de una sección sigue marcando su sección', async ({ page }) => {
  // Escribiendo un problema seguís estando en «Problemas». Si la marca se apagara al entrar en una
  // subpantalla, «estás acá» sólo funcionaría en las listas, que es donde menos falta hace.
  await page.goto('/problemas/nuevo');
  await expect(navegacion(page).getByRole('link', { name: 'Problemas' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(navegacion(page).locator('a[aria-current="page"]')).toHaveCount(1);
});

test('en el grupo de consulta también se marca', async ({ page }) => {
  await page.goto('/normas');
  // Este test corre también en los proyectos móviles de la matriz (viewport por defecto angosto),
  // donde el grupo «Consultar» llega plegado: el enlace existe pero no está en el árbol de
  // accesibilidad hasta desplegarlo. En pantalla ancha el botón no se renderiza, así que sólo se
  // pulsa cuando hace falta — ver la prueba dedicada más abajo, que ya comprueba que el `aria-current`
  // sobrevive plegado y se lee «al lado» del botón.
  const abridor = navegacion(page).getByRole('button', { name: 'Consultar' });
  if (await abridor.isVisible()) {
    await abridor.click();
  }
  await expect(
    navegacion(page).getByRole('link', { name: 'Las reglas del juego' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(navegacion(page).locator('a[aria-current="page"]')).toHaveCount(1);
});

test('en la portada no se marca ningún enlace: la portada ya no está en la lista', async ({
  page,
}) => {
  await page.goto('/');
  await expect(navegacion(page).locator('[aria-current]')).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// En pantalla ancha no hay nada que desplegar
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test.describe('en pantalla ancha', () => {
  // El ancho se fija a mano y no se hereda del proyecto: en la matriz de `main` corren también
  // `chrome-movil` (412 px) y `safari-movil` (390 px), y los dos están por debajo del corte. Una
  // prueba que dé por hecho el monitor de quien la escribió es la que hace roja la matriz entera
  // el día que se mira desde un teléfono.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('donde el ancho sobra, los doce destinos están a la vista y no hay botón que pulsar', async ({
    page,
  }) => {
    // La otra mitad de plegar: si el botón sobreviviera al ancho, quedaría un mando que no manda
    // nada sobre una lista que ya está abierta, y dos formas de llegar al mismo sitio.
    await page.goto('/');
    await expect(navegacion(page).getByRole('button', { name: 'Consultar' })).toBeHidden();
    for (const destino of [...RECORRIDO, ...CONSULTA]) {
      await expect(navegacion(page).getByRole('link', { name: destino.enlace })).toBeVisible();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// El teléfono: 360×800, que es la pantalla de la queja
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test.describe('en un teléfono de 360 px', () => {
  test.use({ viewport: TELEFONO });

  test('la barra deja de comerse la pantalla: el h1 de la portada entra arriba', async ({
    page,
  }) => {
    await page.goto('/');
    const encabezado = page.getByRole('heading', { level: 1, name: 'Koinonía' });
    await expect(encabezado).toBeVisible();

    const cajaH1 = await encabezado.boundingBox();
    const cajaBarra = await page.getByRole('banner').boundingBox();
    expect(cajaH1, 'el h1 tiene que tener caja').not.toBeNull();
    expect(cajaBarra, 'la cabecera tiene que tener caja').not.toBeNull();

    const arranque = Math.round(cajaH1!.y);
    const alto = Math.round(cajaBarra!.height);
    const porcentaje = Math.round((arranque / TELEFONO.height) * 100);
    // El número queda escrito en el informe de la ejecución: es el dato que justifica el rediseño,
    // y sin él esta prueba diría «pasa» sin decir cuánto.
    test.info().annotations.push({
      type: 'medida',
      description:
        `a ${String(TELEFONO.width)}×${String(TELEFONO.height)} el h1 empieza en y=` +
        `${String(arranque)} px (${String(porcentaje)} % de la pantalla); la cabecera mide ` +
        `${String(alto)} px. Antes: y=373 px (47 %), cabecera de 284 px.`,
    });

    expect(
      arranque,
      `el h1 empieza en y=${String(arranque)} px de ${String(TELEFONO.height)}: la barra volvió a ` +
        'comerse la pantalla',
    ).toBeLessThanOrEqual(TOPE_H1);
    // Y el otro lado: que el `h1` esté arriba porque la barra es corta, no porque haya
    // desaparecido de la vista.
    await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
  });

  test('el segundo grupo llega plegado, y el botón «Consultar» lo despliega', async ({ page }) => {
    await page.goto('/');
    const abridor = navegacion(page).getByRole('button', { name: 'Consultar' });
    await expect(abridor).toBeVisible();
    await expect(abridor).toHaveAttribute('aria-expanded', 'false');

    // Plegado: los seis destinos no están a la vista. No es que estén «un poco escondidos»: no se
    // pueden pulsar.
    for (const destino of CONSULTA) {
      await expect(navegacion(page).getByRole('link', { name: destino.enlace })).toBeHidden();
    }
    // El recorrido, en cambio, no se pliega nunca: es lo que enseña el procedimiento a quien llega.
    for (const paso of RECORRIDO) {
      await expect(navegacion(page).getByRole('link', { name: paso.enlace })).toBeVisible();
    }

    await abridor.click();
    await expect(abridor).toHaveAttribute('aria-expanded', 'true');
    for (const destino of CONSULTA) {
      await expect(navegacion(page).getByRole('link', { name: destino.enlace })).toBeVisible();
    }

    // Y vuelve a plegarse, que es lo que espera quien lo abrió por curiosidad.
    await abridor.click();
    await expect(abridor).toHaveAttribute('aria-expanded', 'false');
    await expect(navegacion(page).getByRole('link', { name: 'Verificar' })).toBeHidden();
  });

  test('desplegado, se llega pulsando a una pantalla de consulta', async ({ page }) => {
    await page.goto('/');
    await navegacion(page).getByRole('button', { name: 'Consultar' }).click();
    await navegacion(page).getByRole('link', { name: 'Las reglas del juego' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Las reglas del juego' }),
    ).toBeVisible();
  });

  test('el desplegable se abre con el teclado, y lo que abre también se alcanza tabulando', async ({
    page,
  }) => {
    // Un desplegable que sólo abre el dedo deja seis destinos fuera del alcance de quien navega con
    // teclado. Acá se comprueba el camino entero sin tocar el ratón: llegar al botón, abrirlo,
    // llegar al primer destino y entrar.
    await page.goto('/');
    const abridor = navegacion(page).getByRole('button', { name: 'Consultar' });
    await tabularHasta(page, abridor);
    await expect(abridor).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(abridor).toHaveAttribute('aria-expanded', 'true');

    const primero = navegacion(page).getByRole('link', { name: CONSULTA[0].enlace });
    await tabularHasta(page, primero);
    await expect(primero).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 1, name: CONSULTA[0].encabezado }),
    ).toBeVisible();
  });

  test('llegando a una pantalla de consulta el grupo sigue plegado, y la marca se escribe al lado', async ({
    page,
  }) => {
    /*
     * Esta prueba exigió lo contrario durante un rato: que al llegar a una de las seis pantallas de
     * consulta el grupo se abriera solo, para que la marca de «estás acá» no quedara escondida
     * detrás de un botón —que es igual que no tenerla—.
     *
     * Se midió y era peor. La lista desplegada ocupa 406 px de los 800 del teléfono, así que el
     * `h1` de `/normas` nacía en `y=648`: el 81 % de la pantalla era barra, contra el 47 % de la
     * queja original que este rediseño vino a arreglar. El remedio empujaba el contenido más abajo
     * que la enfermedad.
     *
     * La conclusión que queda escrita acá para que no se vuelva a intentar: la marca **no necesita
     * la lista abierta, necesita estar escrita**. Se escribe en palabras junto al botón, cuesta
     * cero píxeles —el botón mide 103 px de los 328 del renglón y el resto estaba vacío— y llega
     * igual a quien no ve el borde azul.
     */
    await page.goto('/historial');
    const abridor = navegacion(page).getByRole('button', { name: 'Consultar' });
    await expect(abridor).toHaveAttribute('aria-expanded', 'false');

    // La marca, en palabras y a la vista, sin desplegar nada.
    const marca = navegacion(page).locator('.aca-consulta');
    await expect(marca).toBeVisible();
    await expect(marca).toHaveText(/estás acá:\s*Todo lo que quedó escrito/u);
    // Y **fuera** del botón: dentro pasaría a formar parte de su nombre accesible y el botón
    // dejaría de llamarse «Consultar» a secas, que es como lo busca quien navega por voz.
    await expect(abridor).toHaveAccessibleName('Consultar');

    // Plegado no es «sin marcar»: el enlace sigue llevando su `aria-current`, y al desplegar la
    // marca está donde tiene que estar. Lo que no puede pasar es que se diga dos veces.
    const actual = navegacion(page).getByRole('link', { name: 'Todo lo que quedó escrito' });
    await expect(actual).toBeHidden();
    await abridor.click();
    await expect(actual).toBeVisible();
    await expect(actual).toHaveAttribute('aria-current', 'page');
    await expect(marca).toHaveCount(0);
  });

  test('a11y — la navegación del teléfono no tiene ni una violación A/AA, plegada ni desplegada', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await revisar(page, 'la portada a 360 px con el grupo plegado');

    await navegacion(page).getByRole('button', { name: 'Consultar' }).click();
    await expect(navegacion(page).getByRole('link', { name: 'Verificar' })).toBeVisible();
    await revisar(page, 'la portada a 360 px con el grupo desplegado');
  });
});
