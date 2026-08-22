/**
 * ESCENARIO 8 — Deliberar por etapas, desde el teléfono.
 *
 * El recorrido entero con navegador de verdad: abrir la conversación, preguntar, pasar de etapa,
 * decir la propia postura, sostenerla con una razón, y cerrar. Y en medio, lo que hace que esto
 * exista: **antes de cerrar Perspectivas no se ve quién escribió cada aporte, y después sí**.
 *
 * Tres cosas se prueban además saltándose la interfaz por completo, porque son las únicas que
 * prueban algo:
 *
 *  · que un aporte de una clase que esa etapa no admite se rechaza —y se rechaza con palabras, no
 *    con la tabla interna—;
 *  · que quien no cuida el procedimiento no puede pasar de etapa **ni llamando a la API**;
 *  · que la autoría tampoco sale por ahí.
 */

import AxeBuilder from '@axe-core/playwright';
import { forbiddenTermsIn } from '@koinonia/contracts';
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
import { CORREO_FACILITADORA } from './global-setup.js';

test.describe.configure({ mode: 'serial' });

const sufijo = marca();
let lucia: Cuenta;
let sara: Cuenta;
let julian: Cuenta;
let deliberacionId: string;
const TITULO_PROBLEMA = `La sala de estudio cierra a las seis ${sufijo}`;

const PREGUNTA = '¿La sala cierra a las seis todos los días o sólo los viernes de este semestre?';
const POSTURA = 'La sala tendría que abrir hasta las nueve tres días por semana.';
const RAZON = 'La jornada nocturna entra a las seis y no tiene dónde leer.';

async function revisarAccesibilidad(page: Page, ruta: string): Promise<void> {
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const detalle = resultado.violations
    .map((v) => `· [${String(v.impact)}] ${v.id}: ${v.help}\n    ${v.nodes[0]?.html ?? ''}`)
    .join('\n');
  expect(resultado.violations, `Violaciones A/AA en ${ruta}:\n${detalle}`).toEqual([]);

  // La regla de oro, con la lista **ejecutable** del contrato y no con una copia de la lista.
  const visible = await page.locator('body').innerText();
  expect(forbiddenTermsIn(visible), `jerga en ${ruta}`).toEqual([]);
}

test.beforeAll(async () => {
  lucia = await entrarPorApi(CORREO_FACILITADORA);
  sara = await entrarPorApi(`sara.delibera.${sufijo}@udea.edu.co`);
  julian = await entrarPorApi(`julian.delibera.${sufijo}@udea.edu.co`);

  await crearProblemaPorApi(sara, {
    titulo: TITULO_PROBLEMA,
    cuerpo:
      'Los de la nocturna llegamos a las 5:40 y la sala cierra a las 6. No tenemos dónde leer y ' +
      'terminamos parados en el pasillo.',
  });
});

test('quien cuida el procedimiento abre la conversación desde la pantalla', async ({ page }) => {
  await ponerSesionEnNavegador(page, lucia);
  await page.goto('/deliberaciones');

  await page.getByLabel('¿Sobre qué problema?').selectOption({ label: TITULO_PROBLEMA });
  await page.getByLabel('¿Cuántas horas dura la primera etapa?').fill('48');
  await page.getByRole('button', { name: 'Abrir la conversación' }).click();

  const enlace = page.getByRole('link', { name: TITULO_PROBLEMA });
  await expect(enlace).toBeVisible();
  await enlace.click();

  await expect(page.getByRole('heading', { level: 1, name: TITULO_PROBLEMA })).toBeVisible();
  // La etapa se dice con su nombre de pantalla, nunca con el identificador del motor.
  await expect(page.getByText('acá va la conversación ahora')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Etapas de la conversación' })).toContainText(
    'Preguntas',
  );

  deliberacionId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  expect(deliberacionId).toMatch(/^[0-9a-f]{32}$/u);
});

test('en Preguntas se pregunta, y la pantalla no ofrece escribir una postura', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/deliberaciones/${deliberacionId}`);

  await expect(page.getByRole('radio', { name: 'Una pregunta', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Una postura', exact: true })).toHaveCount(0);

  await page.getByRole('radio', { name: 'Una pregunta', exact: true }).check();
  await page.getByLabel('Escribilo').fill(PREGUNTA);
  await page.getByRole('button', { name: 'Guardar mi aporte' }).click();

  await expect(page.getByText(PREGUNTA).first()).toBeVisible();
});

test('un aporte que esa etapa no admite se rechaza, y se explica sin jerga', async () => {
  // Por API directa: la interfaz ni siquiera ofrece el control, así que la única forma de probar
  // que la regla existe de verdad es saltársela.
  const api = await apiDirecta(julian);
  const respuesta = await api.post(`/deliberaciones/${deliberacionId}/aportes`, {
    data: { requestId: requestId(), tipo: 'posicion', modo: 'afirmacion', texto: POSTURA },
  });
  expect(respuesta.status(), await respuesta.text()).toBe(422);
  const cuerpo = (await respuesta.json()) as { codigo: string; mensaje: string };
  expect(cuerpo.codigo).toBe('POSITION_MODE_NOT_ALLOWED');

  // Se dice qué etapa es y qué sí cabe, con las mismas palabras que ofrece el formulario. Que diga
  // «una pregunta» y NO «una postura» es lo que se está comprobando: la etapa admite aportes del
  // mismo tipo que el rechazado, y aun así lo rechaza por el modo.
  expect(cuerpo.mensaje).toContain('Preguntas');
  expect(cuerpo.mensaje).toContain('una pregunta');
  expect(cuerpo.mensaje).not.toContain('una postura');
  // Y no se dice con la tabla interna.
  expect(cuerpo.mensaje).not.toContain('preguntas_aclaratorias');
  expect(cuerpo.mensaje).not.toContain('posicion');
  expect(cuerpo.mensaje).not.toContain('afirmacion');
  expect(forbiddenTermsIn(cuerpo.mensaje)).toEqual([]);
  await api.dispose();
});

test('quien no cuida el procedimiento no pasa de etapa, ni por pantalla ni por API', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, julian);
  await page.goto(`/deliberaciones/${deliberacionId}`);
  await expect(page.getByRole('button', { name: /^Cerrar «/u })).toHaveCount(0);

  const api = await apiDirecta(julian);
  const respuesta = await api.post(`/deliberaciones/${deliberacionId}/etapa`, {
    data: { requestId: requestId() },
  });
  expect(respuesta.status(), await respuesta.text()).toBe(403);
  expect(((await respuesta.json()) as { codigo: string }).codigo).toBe(
    'UNAUTHORIZED_ROLE_NOT_GRANTED',
  );

  // Y no se escribió nada: no basta con devolver 403.
  const detalle = (await (await api.get(`/deliberaciones/${deliberacionId}`)).json()) as {
    etapaEnPalabras: string;
  };
  expect(detalle.etapaEnPalabras).toBe('Preguntas');
  await api.dispose();
});

test('se pasa a Perspectivas y ahí se escribe la postura con su razón', async ({ page }) => {
  await ponerSesionEnNavegador(page, lucia);
  await page.goto(`/deliberaciones/${deliberacionId}`);
  await page.getByRole('button', { name: /^Cerrar «Preguntas»/u }).click();
  await expect(page.getByRole('navigation', { name: 'Etapas de la conversación' })).toContainText(
    'Perspectivas',
  );

  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/deliberaciones/${deliberacionId}`);
  await page.getByRole('radio', { name: 'Una postura', exact: true }).check();
  await page.getByLabel('Escribilo').fill(POSTURA);
  await page.getByRole('button', { name: 'Guardar mi aporte' }).click();
  await expect(page.getByText(POSTURA).first()).toBeVisible();

  await ponerSesionEnNavegador(page, julian);
  await page.goto(`/deliberaciones/${deliberacionId}`);
  await page.getByRole('radio', { name: 'Una razón que sostiene una postura' }).check();

  // El destino de la arista se elige de una lista de aportes que ya existen, no se escribe a mano.
  const destino = page.getByLabel('¿Qué postura sostenés?');
  await expect(destino.locator('option')).toHaveCount(2);
  await expect(destino.locator('option').nth(1)).toContainText(POSTURA);
  await destino.selectOption({ label: `Postura: ${POSTURA}` });

  await page.getByLabel('Escribilo').fill(RAZON);
  await page.getByRole('button', { name: 'Guardar mi aporte' }).click();

  await expect(page.getByText(RAZON).first()).toBeVisible();
  // El grafo, dicho en palabras: la razón enseña qué sostiene, y se puede saltar hasta ello.
  await expect(page.getByRole('link', { name: `Postura: ${POSTURA}` })).toBeVisible();
});

test('ANTES de cerrar Perspectivas no se ve quién escribió nada, ni a quien facilita', async ({
  page,
}) => {
  for (const cuenta of [sara, julian, lucia]) {
    await ponerSesionEnNavegador(page, cuenta);
    await page.goto(`/deliberaciones/${deliberacionId}`);
    await expect(page.getByText('Todavía sin nombres')).toBeVisible();
    await expect(page.getByText('Todavía no se ve quién lo escribió').first()).toBeVisible();
    await expect(page.getByText(`Lo escribió ${sara.correo.split('@')[0] ?? ''}`)).toHaveCount(0);
    await expect(page.getByText('Lo escribiste vos')).toHaveCount(0);
    // Y la pantalla dice de quién NO protege: nada de «anónimo» a secas.
    await expect(page.getByText(/administra el servidor/u)).toBeVisible();
  }

  // Tampoco sale por la API, ni por el historial que cualquiera puede descargar sin cuenta.
  const api = await apiDirecta(lucia);
  const detalle = await (await api.get(`/deliberaciones/${deliberacionId}`)).text();
  expect(detalle).not.toContain(sara.miembroId);
  expect(detalle).not.toContain(julian.miembroId);
  await api.dispose();
});

test('a11y — la lista de conversaciones no tiene ni una violación A/AA', async ({ page }) => {
  await ponerSesionEnNavegador(page, lucia);
  await page.goto('/deliberaciones');
  await page.waitForLoadState('networkidle');
  await revisarAccesibilidad(page, '/deliberaciones');
});

test('a11y — la conversación, con su formulario y su grafo, tampoco', async ({ page }) => {
  await ponerSesionEnNavegador(page, julian);
  await page.goto(`/deliberaciones/${deliberacionId}`);
  await page.waitForLoadState('networkidle');
  // Con el formulario desplegado, que es donde están los controles de verdad.
  await page.getByRole('radio', { name: 'Una razón que sostiene una postura' }).check();
  await revisarAccesibilidad(page, `/deliberaciones/${deliberacionId}`);
});

test('DESPUÉS de cerrar la etapa aparece quién escribió cada cosa', async ({ page }) => {
  await ponerSesionEnNavegador(page, lucia);
  await page.goto(`/deliberaciones/${deliberacionId}`);
  await page.getByRole('button', { name: /^Cerrar «Perspectivas»/u }).click();
  await expect(page.getByText('Cada aporte tiene nombre')).toBeVisible();

  const aliasDeSara = sara.correo.split('@')[0] ?? '';
  await ponerSesionEnNavegador(page, julian);
  await page.goto(`/deliberaciones/${deliberacionId}`);
  await expect(page.getByText('Todavía no se ve quién lo escribió')).toHaveCount(0);
  await expect(page.getByText(`Lo escribió ${aliasDeSara}`).first()).toBeVisible();
  await expect(page.getByText('Lo escribiste vos')).toBeVisible();

  // Incluida la pregunta de la etapa anterior, que hasta ahora tampoco tenía nombre.
  await expect(page.getByText(PREGUNTA).first()).toBeVisible();
  await expect(page.getByText(`Lo escribió ${aliasDeSara}`)).toHaveCount(2);
});

test('el historial descargable deja de retener la conversación cuando la etapa cierra', async () => {
  const api = await apiDirecta(julian);
  const texto = await (await api.get('/integridad/exportar')).text();
  expect(texto).toContain('"tipoDeAgregado":"deliberation"');
  expect(texto).toContain(sara.miembroId);
  expect((JSON.parse(texto) as { retenidos: unknown[] }).retenidos).toEqual([]);
  await api.dispose();
});
