/**
 * ESCENARIO 4 — Accesibilidad.
 *
 * Pasada de axe-core sobre las pantallas del corte vertical, sin violaciones serias ni críticas.
 *
 * Y dos cosas que axe **no** puede comprobar y que están en la especificación del producto, así que
 * se comprueban a mano:
 *
 *  · el flujo completo de emitir una respuesta se recorre **con el teclado**, que es el que no puede
 *    fallarle a nadie (PRODUCT §7);
 *  · la **regla de oro**: ni una palabra de jerga en el texto visible de ninguna pantalla.
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
import { CORREO_FACILITADORA } from './global-setup.js';

test.describe.configure({ mode: 'serial' });

let sara: Cuenta;
let lucia: Cuenta;
const sufijo = marca();
let problemaId: string;
let propuestaId: string;
let decisionId: string;

/** Términos que no pueden aparecer en pantalla nunca (PRODUCT §7, ADR-0041). */
const JERGA_PROHIBIDA = [
  'blockchain',
  'merkle',
  'hash',
  'event sourcing',
  'condorcet',
  'sociocracia',
  'sociocratico',
  'schulze',
  'ledger',
  'payload',
  'endpoint',
  'sha-256',
  'sha256',
];

function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

async function revisar(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
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
  expect(graves, `Violaciones serias o críticas en ${ruta}:\n${detalle}`).toEqual([]);

  // La regla de oro, sobre el texto visible.
  const visible = sinAcentos(await page.locator('body').innerText());
  for (const termino of JERGA_PROHIBIDA) {
    expect(visible, `«${termino}» no puede aparecer en ${ruta}`).not.toContain(sinAcentos(termino));
  }
}

test.beforeAll(async () => {
  sara = await entrarPorApi(`sara.a11y.${sufijo}@udea.edu.co`);
  lucia = await entrarPorApi(CORREO_FACILITADORA);

  problemaId = await crearProblemaPorApi(sara, {
    titulo: `Problema para revisar accesibilidad ${sufijo}`,
    cuerpo:
      'Este problema existe para que las pantallas del corte vertical tengan contenido real que ' +
      'revisar, y no una página vacía que pasa cualquier revisión.',
  });

  const api = await apiDirecta(sara);
  await api.post(`/problemas/${problemaId}/evidencia`, {
    data: {
      requestId: requestId(),
      certeza: 'me-lo-contaron',
      cuerpo: 'Me contaron que el año pasado se pidió lo mismo y no hubo respuesta.',
    },
  });
  const propuesta = await api.post('/propuestas', {
    data: {
      requestId: requestId(),
      problemaId,
      titulo: 'Propuesta para revisar accesibilidad',
      cuerpo:
        'Un texto de propuesta suficientemente largo para que la pantalla tenga contenido real ' +
        'y la revisión no pase por estar mirando una página en blanco.',
    },
  });
  propuestaId = ((await propuesta.json()) as { id: string }).id;
  await api.dispose();

  const apiLucia = await apiDirecta(lucia);
  const abierta = await apiLucia.post('/decisiones', {
    data: { requestId: requestId(), propuestaId, metodo: 'sociocratic-consent', duracionHoras: 24 },
  });
  decisionId = ((await abierta.json()) as { id: string }).id;
  await apiLucia.dispose();
});

test('Inicio, incluido el estado vacío del primer día', async ({ page }) => {
  await revisar(page, '/');
});

test('Problemas: lista', async ({ page }) => {
  await revisar(page, '/problemas');
});

test('Problemas: escribir uno', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await revisar(page, '/problemas/nuevo');
});

test('Problemas: detalle', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await revisar(page, `/problemas/${problemaId}`);
});

test('Propuestas: detalle con historial de versiones', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await revisar(page, `/propuestas/${propuestaId}`);
});

test('Decisiones: lista', async ({ page }) => {
  await revisar(page, '/decisiones');
});

test('Decisión: emitir la respuesta', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await revisar(page, `/decisiones/${decisionId}`);
});

test('Verificar integridad', async ({ page }) => {
  await revisar(page, '/verificar');
});

test('Entrar', async ({ page }) => {
  await revisar(page, '/entrar');
});

test('el flujo de emitir una respuesta se recorre entero con el teclado', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/decisiones/${decisionId}`);
  await page.waitForLoadState('networkidle');

  // El primer tabulador tiene que dar con el enlace para saltar al contenido: sin él, quien navega
  // con teclado repasa la navegación entera en cada página.
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Saltar al contenido');

  // Se llega a la primera opción de la papeleta sólo con el teclado y se marca con la barra.
  const opcion = page.getByRole('radio', { name: /^Sin objeción/u });
  await opcion.focus();
  await expect(opcion).toBeFocused();
  await page.keyboard.press('Space');
  await expect(opcion).toBeChecked();

  // Y el botón de enviar se alcanza tabulando y se activa con Enter.
  const enviar = page.getByRole('button', { name: /respuesta/u });
  await enviar.focus();
  await expect(enviar).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Quedó registrado')).toBeVisible();
});

test('el foco es visible: hay un contorno de verdad, no `outline: none`', async ({ page }) => {
  await page.goto('/entrar');
  const campo = page.getByLabel('Tu correo institucional');
  await campo.focus();
  const contorno = await campo.evaluate((el) => {
    const estilo = getComputedStyle(el);
    return { ancho: estilo.outlineWidth, estilo: estilo.outlineStyle };
  });
  expect(contorno.estilo).not.toBe('none');
  expect(Number.parseFloat(contorno.ancho)).toBeGreaterThanOrEqual(2);
});

test('el documento declara español de Colombia', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');
});
