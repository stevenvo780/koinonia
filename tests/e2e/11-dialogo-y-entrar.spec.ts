/**
 * ESCENARIO 11 — El diálogo que reemplaza a `window.prompt`, y las salidas de `/entrar`.
 *
 * ═══ El diálogo ═══
 *
 * Retirar un aporte pedía el motivo con `window.prompt`. No es un atajo feo: es una pantalla que no
 * se puede etiquetar, que los lectores de pantalla manejan mal, y que **en la PWA de iOS se cierra
 * sin valor o devuelve `null`** —que es como entra buena parte del público de esto—. El resultado
 * era un motivo perdido en silencio en un historial que no se puede corregir.
 *
 * Además, `window.prompt` es invisible para axe-core y para Playwright: una comprobación de
 * accesibilidad sobre esa pantalla pasaba en verde sin haber mirado el único control que importaba.
 * Ahora hay un `<dialog>` de la casa, y por tanto hay algo que revisar: etiqueta de verdad, foco
 * atrapado, `Escape` que cierra sin escribir, y dos botones en castellano.
 *
 * ═══ `/entrar` ═══
 *
 * Tres callejones, y uno de ellos con una condición que no se puede romper al arreglarlo: la
 * pantalla **no revela quién tiene cuenta y quién no**. Por eso el último test comprueba que la
 * respuesta a un correo del Instituto y a uno inventado es, palabra por palabra, la misma.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

import {
  apiDirecta,
  type Cuenta,
  crearProblemaPorApi,
  entrarPorApi,
  marca,
  ponerSesionEnNavegador,
  requestId,
} from './ayudas.js';

test.describe.configure({ mode: 'serial' });

const sufijo = marca();
let sara: Cuenta;
let problemaId: string;

async function sinViolaciones(page: Page, donde: string): Promise<void> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const detalle = resultado.violations
    .map((v) => `· [${String(v.impact)}] ${v.id}: ${v.help}\n    ${v.nodes[0]?.html ?? ''}`)
    .join('\n');
  expect(resultado.violations, `Violaciones A/AA en ${donde}:\n${detalle}`).toEqual([]);
}

test.beforeAll(async () => {
  sara = await entrarPorApi(`sara.dialogo.${sufijo}@udea.edu.co`);
  problemaId = await crearProblemaPorApi(sara, {
    titulo: `No hay dónde dejar la bici sin que la roben ${sufijo}`,
    cuerpo:
      'Este mes desaparecieron dos bicicletas del costado norte y no hay ni un anclaje fijo en ' +
      'todo el edificio.',
  });

  const api = await apiDirecta(sara);
  const aporte = await api.post(`/problemas/${problemaId}/evidencia`, {
    data: {
      requestId: requestId(),
      certeza: 'visto',
      cuerpo: 'Vi el candado cortado tirado junto al poste el martes por la mañana.',
    },
  });
  expect(aporte.status(), await aporte.text()).toBe(201);
  await api.dispose();
});

test('el diálogo de retirar tiene etiqueta, foco atrapado y salida con Escape', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/problemas/${problemaId}`);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Retirar mi aporte' }).click();

  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  // Nombre accesible: sin esto un lector de pantalla anuncia «diálogo» y nada más.
  await expect(dialogo).toHaveAccessibleName('Retirar tu aporte');

  // El campo tiene `<label>` de verdad, y el foco aterriza en él y no en el título ni en cancelar.
  const campo = page.getByLabel('¿Por qué lo retirás?');
  await expect(campo).toBeFocused();

  await sinViolaciones(page, 'el diálogo de retirar un aporte');

  // Los dos botones, en castellano y dentro del diálogo.
  await expect(dialogo.getByRole('button', { name: 'Retirar el aporte' })).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Dejarlo como está' })).toBeVisible();

  // Foco atrapado: tabulando en círculo nunca se sale del diálogo.
  for (let vuelta = 0; vuelta < 8; vuelta++) {
    await page.keyboard.press('Tab');
    const dentro = await page.evaluate(
      () =>
        document.activeElement?.closest('dialog') !== null &&
        document.activeElement?.closest('dialog') !== undefined,
    );
    expect(dentro, `el foco se escapó del diálogo en la vuelta ${String(vuelta)}`).toBe(true);
  }

  // `Escape` cierra, y cerrar no es confirmar: el aporte sigue entero.
  await campo.fill('Escrito a medias y arrepentido.');
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(page.getByText('Se retiró este aporte')).toHaveCount(0);

  // Y al reabrirlo empieza en blanco: el diálogo no rescata como motivo de hoy lo que se escribió
  // y se descartó antes. `window.prompt` tampoco lo hacía, pero tampoco se podía comprobar.
  await page.getByRole('button', { name: 'Retirar mi aporte' }).click();
  await expect(page.getByLabel('¿Por qué lo retirás?')).toHaveValue('');
  await page.keyboard.press('Escape');
});

test('el diálogo no deja confirmar sin motivo, y con motivo retira de verdad', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/problemas/${problemaId}`);
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Retirar mi aporte' }).click();
  const dialogo = page.getByRole('dialog');

  // Confirmar en vacío no escribe nada y **dice por qué**, que es lo que `window.prompt` no podía
  // hacer: allí un texto vacío se iba en silencio y el aporte quedaba sin retirar sin explicación.
  await dialogo.getByRole('button', { name: 'Retirar el aporte' }).click();
  // Acotado al diálogo: Next mantiene su propio `role="alert"` para anunciar rutas, y un locator
  // que resuelve a dos elementos no está comprobando el que importa.
  await expect(dialogo.getByRole('alert')).toContainText('Escribí el motivo');
  await expect(page.getByLabel('¿Por qué lo retirás?')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialogo).toBeVisible();

  await page.getByLabel('¿Por qué lo retirás?').fill('Me confundí de fecha: fue el lunes.');
  await dialogo.getByRole('button', { name: 'Retirar el aporte' }).click();

  await expect(dialogo).toBeHidden();
  const retirado = page.getByText('Se retiró este aporte');
  await expect(retirado).toBeVisible();
  // El hueco se declara con su motivo: nunca una ausencia silenciosa.
  await expect(retirado).toContainText('Me confundí de fecha');
});

test('/entrar marca el campo y lo describe cuando la API rechaza el correo', async ({ page }) => {
  await page.goto('/entrar');
  await sinViolaciones(page, '/entrar en reposo');

  const campo = page.getByLabel('Tu correo institucional');
  // Antes de fallar no hay nada que marcar: `aria-invalid` no puede estar puesto por costumbre.
  await expect(campo).not.toHaveAttribute('aria-invalid', 'true');

  await campo.fill('alguien@gmail.com');
  await page.getByRole('button', { name: 'Mandame el enlace' }).click();

  // Por su `id`, que es el mismo al que apunta `aria-describedby`: `getByRole('alert')` a secas
  // también atrapa el anunciador de rutas de Next y comprobaría el elemento equivocado.
  await expect(page.locator('#error-correo')).toContainText('@udea.edu.co');
  await expect(page.locator('#error-correo')).toHaveAttribute('role', 'alert');
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  // Y el campo apunta al error, que es lo que hace que se oiga al llegar al campo.
  await expect(campo).toHaveAttribute('aria-describedby', /error-correo/u);

  await sinViolaciones(page, '/entrar con el correo rechazado');

  // El formulario sigue ahí, con lo escrito: rechazar no puede ser expulsar.
  await expect(campo).toHaveValue('alguien@gmail.com');
});

test('/entrar deja pedir otro enlace después de equivocarse de dirección', async ({ page }) => {
  await page.goto('/entrar');
  await page.getByLabel('Tu correo institucional').fill(`sara.tipo.${sufijo}@udea.edu.co`);
  await page.getByRole('button', { name: 'Mandame el enlace' }).click();

  await expect(page.getByText('Revisá tu correo')).toBeVisible();

  // Lo que faltaba: quien no recibe nada tenía la pantalla cerrada, sin instrucción ni vuelta.
  await expect(page.getByRole('heading', { name: '¿No te llega?' })).toBeVisible();
  await expect(page.getByText('correo no deseado')).toBeVisible();
  await sinViolaciones(page, '/entrar tras pedir el enlace');

  await page.getByRole('button', { name: /Escribir otro correo/u }).click();

  const campo = page.getByLabel('Tu correo institucional');
  await expect(campo).toBeVisible();
  await expect(campo).toBeFocused();
});

test('sigue sin revelar quién tiene cuenta: la respuesta es idéntica en los dos casos', async ({
  page,
}) => {
  // La propiedad es deliberada y arreglar los callejones no puede haberla tocado. Se comparan los
  // dos textos completos, no una frase suelta.
  const textos: string[] = [];
  for (const correo of [sara.correo, `fantasma.${sufijo}@udea.edu.co`]) {
    await page.goto('/entrar');
    await page.getByLabel('Tu correo institucional').fill(correo);
    await page.getByRole('button', { name: 'Mandame el enlace' }).click();
    await expect(page.getByText('Revisá tu correo')).toBeVisible();
    const visible = await page.locator('main').innerText();
    // La dirección escrita sí cambia —se la repetimos a la persona—; el resto no puede cambiar.
    textos.push(visible.replace(correo, '⟨correo⟩'));
  }
  expect(textos[0]).toBe(textos[1]);
});
