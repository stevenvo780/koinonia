/**
 * ESCENARIO 17 — «Corregí tus datos» (Ley 1581, art. 8 lit. a), la hermana de la supresión.
 *
 * ═══ Por qué se llega pulsando el propio nombre, y no con `page.goto` ═══
 *
 * Igual que en `12-pantallas-nuevas.spec.ts`: una pantalla a la que sólo se llega escribiendo la
 * dirección a mano no existe para nadie salvo quien la escribió. Acá el camino no es la navegación
 * principal —esto no es un paso del recorrido de gobernanza, es la cuenta propia— sino el propio
 * nombre en la cabecera (`SesionEnCabecera`, en `marco.tsx`) y la firma de la portada
 * (`BarraSesion`), que hasta este cambio no llevaban a ningún sitio.
 *
 * ═══ Por qué se mide el área táctil de los dos caminos ═══
 *
 * `SesionEnCabecera` sólo se monta a partir de 64rem (`usePantallaAncha`, `marco.tsx`): en un
 * teléfono el único camino hacia `/mis-datos` es la firma de la portada. Que exista un enlace ahí
 * no alcanza si mide menos de los 44 px que promete el encabezado de este proyecto para todo lo que
 * se pulsa; por eso los dos caminos se miden, no sólo se cuentan.
 *
 * ═══ Qué NO se repite acá ═══
 *
 * La protección contra el doble envío (`useAccionUnica`) ya la prueba `10-doble-envio.spec.ts`
 * sobre el propio mecanismo compartido; esta pantalla lo usa tal cual, sin copiarlo, así que
 * volver a perseguir un doble clic acá probaría el mismo hook por segunda vez, no algo propio de
 * esta pantalla.
 */

import AxeBuilder from '@axe-core/playwright';
import { forbiddenTermsIn } from '@koinonia/contracts';
import { expect, type Page, test } from '@playwright/test';

import {
  apiDirecta,
  contenido,
  entrarPorApi,
  marca,
  ponerSesionEnNavegador,
  reiniciarHistorial,
  requestId,
} from './ayudas.js';

test.describe.configure({ mode: 'serial' });

const sufijo = marca();

async function revisar(page: Page, donde: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const graves = resultado.violations.filter(
    (v: { impact?: string | null }) => v.impact === 'serious' || v.impact === 'critical',
  );
  const detalle = graves
    .map((v) => `· [${String(v.impact)}] ${v.id}: ${v.help}\n    ${v.nodes[0]?.html ?? ''}`)
    .join('\n');
  expect(graves, `Violaciones serias o críticas en ${donde}:\n${detalle}`).toEqual([]);

  const visible = await page.locator('body').innerText();
  expect(forbiddenTermsIn(visible), `jerga en ${donde}`).toEqual([]);
}

test.beforeAll(async () => {
  await reiniciarHistorial();
});

test('se llega pulsando el propio nombre en la cabecera, no escribiendo la dirección', async ({
  page,
}) => {
  const persona = await entrarPorApi(`llega.pulsando.${sufijo}@udea.edu.co`);
  await ponerSesionEnNavegador(page, persona);
  // Cualquier pantalla ancha lleva el nombre en la cabecera (`SesionEnCabecera`), no sólo la
  // portada: se entra por `/problemas`, pública, para demostrar justamente eso y de paso evitar el
  // segundo enlace propio que sólo lleva la portada (`<BarraSesion>`, ver `marco.tsx`).
  await page.goto('/problemas');

  const enlaceEnCabecera = page.getByRole('link', { name: /corregir tus datos/iu });
  const caja = await enlaceEnCabecera.boundingBox();
  expect(caja, 'el enlace de la cabecera tiene que tener un área que medir').not.toBeNull();
  expect(
    caja?.height ?? 0,
    'objetivo táctil de 44 px (ADR-0041 / WCAG 2.5.8)',
  ).toBeGreaterThanOrEqual(44);

  await enlaceEnCabecera.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Corregí tus datos' })).toBeVisible();
  await expect(page).toHaveURL(/\/mis-datos$/u);
  await revisar(page, '/mis-datos');
});

test('la portada también ofrece el mismo camino, con el mismo objetivo táctil', async ({
  page,
}) => {
  const persona = await entrarPorApi(`portada.pulsando.${sufijo}@udea.edu.co`);
  await ponerSesionEnNavegador(page, persona);
  await page.goto('/');

  // Acá hay DOS caminos a propósito —`BarraSesion` en el cuerpo de la portada y el nombre en la
  // cabecera, que también se monta ahí— y los dos van al mismo sitio, y los dos tienen que medir
  // 44 px: en un teléfono real sólo el primero existe (`SesionEnCabecera` no se monta por debajo
  // de 64rem), así que no alcanza con comprobar sólo el segundo.
  const enlaces = page.getByRole('link', { name: /corregir tus datos/iu });
  await expect(enlaces).toHaveCount(2);
  for (const enlace of await enlaces.all()) {
    await expect(enlace).toHaveAttribute('href', '/mis-datos');
    const caja = await enlace.boundingBox();
    expect(caja?.height ?? 0, 'objetivo táctil de 44 px').toBeGreaterThanOrEqual(44);
  }
});

test('sin sesión, la pantalla explica cómo entrar y no un formulario a medias', async ({
  page,
}) => {
  await page.goto('/mis-datos');
  await expect(page.getByRole('heading', { level: 1, name: 'Corregí tus datos' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entrá con el correo institucional' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await revisar(page, '/mis-datos (sin sesión)');
});

test('el correo institucional no es una opción, y la pantalla dice por qué', async ({ page }) => {
  const persona = await entrarPorApi(`sin.correo.${sufijo}@udea.edu.co`);
  await ponerSesionEnNavegador(page, persona);
  await page.goto('/mis-datos');

  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('radio', { name: 'Cómo te saludamos' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tu semestre' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tu jornada' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /correo/iu })).toHaveCount(0);
  await expect(page.getByText(/correo institucional no está en esta lista/u)).toBeVisible();
});

test('corrige el alias con texto libre, y semestre y jornada con una lista cerrada', async ({
  page,
}) => {
  const persona = await entrarPorApi(`corrige.tres.${sufijo}@udea.edu.co`);
  await ponerSesionEnNavegador(page, persona);
  await page.goto('/mis-datos');

  // El alias es texto libre.
  await page.getByRole('radio', { name: 'Cómo te saludamos' }).check();
  await expect(page.getByRole('textbox', { name: 'El valor correcto' })).toBeVisible();
  await page.getByRole('textbox', { name: 'El valor correcto' }).fill('Quien firma esto');
  await page.getByRole('button', { name: 'Corregir' }).click();

  let confirmacion = page.getByRole('status').filter({ hasText: 'Corregido' });
  await expect(confirmacion).toBeVisible();
  await expect(confirmacion).toContainText('cómo te saludamos');
  await expect(confirmacion).toContainText('Quien firma esto');
  await expect(confirmacion).toContainText('Radicado');
  await page.getByRole('button', { name: 'Corregir otro dato' }).click();

  // El semestre es una lista cerrada: no hay ningún campo de texto libre para él.
  await page.getByRole('radio', { name: 'Tu semestre' }).check();
  await expect(page.getByRole('combobox', { name: 'El valor correcto' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'El valor correcto' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'El valor correcto' }).selectOption('s8');
  await page.getByRole('button', { name: 'Corregir' }).click();

  confirmacion = page.getByRole('status').filter({ hasText: 'Corregido' });
  await expect(confirmacion).toBeVisible();
  await expect(confirmacion).toContainText('8.º semestre');
  await revisar(page, '/mis-datos (corregido)');

  const api = await apiDirecta(persona);
  try {
    const fila = await api.get('/auth/estado');
    expect(fila.status()).toBe(200);
    // El alias corregido antes SIGUE corregido: la sesión lo sigue diciendo igual.
    const cuerpo = (await fila.json()) as { sesion?: { alias: string } };
    expect(cuerpo.sesion?.alias).toBe('Quien firma esto');
  } finally {
    await api.dispose();
  }
});

test('un valor igual al que ya está guardado se explica en el propio campo', async ({ page }) => {
  const correo = `sin.cambio.${sufijo}@udea.edu.co`;
  const persona = await entrarPorApi(correo);
  await ponerSesionEnNavegador(page, persona);
  await page.goto('/mis-datos');

  // El alias de esta cuenta es la parte local del correo (`udeaIdentityAdapter`, MVP): pedirlo tal
  // cual es exactamente «no hay ningún cambio».
  await page.getByRole('radio', { name: 'Cómo te saludamos' }).check();
  await page.getByRole('textbox', { name: 'El valor correcto' }).fill(correo.split('@')[0] ?? '');
  await page.getByRole('button', { name: 'Corregir' }).click();

  // Acotado a `main`: fuera de ahí, Next monta su propio anunciador de ruta con el mismo papel
  // `alert`, vacío pero suficiente para volver ambiguo un `getByRole('alert')` sin acotar (ver
  // `contenido()` en `ayudas.ts`).
  const aviso = contenido(page).getByRole('alert');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('ya es el valor que tenemos guardado');
  await expect(page.getByRole('textbox', { name: 'El valor correcto' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await revisar(page, '/mis-datos (sin cambios)');
});

test('el alias exacto de otra persona no se acepta: dos no pueden compartirlo', async ({
  page,
}) => {
  const yaLoTiene = await entrarPorApi(`ya.lo.tiene.${sufijo}@udea.edu.co`);
  const quiereRepetirlo = await entrarPorApi(`quiere.repetirlo.${sufijo}@udea.edu.co`);

  const apiDeQuienYaLoTiene = await apiDirecta(yaLoTiene);
  try {
    const primero = await apiDeQuienYaLoTiene.post('/mi/rectificacion', {
      data: {
        requestId: requestId(),
        campo: 'alias',
        valorNuevo: `Nombre disputado ${sufijo}`,
      },
    });
    expect(primero.status(), await primero.text()).toBe(200);
  } finally {
    await apiDeQuienYaLoTiene.dispose();
  }

  await ponerSesionEnNavegador(page, quiereRepetirlo);
  await page.goto('/mis-datos');
  await page.getByRole('radio', { name: 'Cómo te saludamos' }).check();
  await page.getByRole('textbox', { name: 'El valor correcto' }).fill(`Nombre disputado ${sufijo}`);
  await page.getByRole('button', { name: 'Corregir' }).click();

  const aviso = contenido(page).getByRole('alert');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('no pueden compartirlo');
});
