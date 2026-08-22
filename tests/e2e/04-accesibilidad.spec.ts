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
import { expect, type Locator, type Page, test } from '@playwright/test';

import {
  apiDirecta,
  avanzarReloj,
  type Cuenta,
  crearProblemaPorApi,
  entrarPorApi,
  marca,
  planDe,
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
let iniciativaId: string;
let resultadoDecisionId: string;

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

async function tabularHasta(page: Page, destino: Locator, maximo = 40): Promise<void> {
  for (let intento = 0; intento < maximo; intento++) {
    await page.keyboard.press('Tab');
    if (await destino.evaluate((elemento) => elemento.ownerDocument.activeElement === elemento)) {
      return;
    }
  }
  throw new Error(`no se alcanzó el control con Tab después de ${String(maximo)} intentos`);
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
      plan: planDe(sara.miembroId),
    },
  });
  propuestaId = ((await propuesta.json()) as { id: string }).id;
  await api.dispose();

  const apiLucia = await apiDirecta(lucia);
  const primera = await apiLucia.post('/decisiones', {
    data: { requestId: requestId(), propuestaId, metodo: 'simple-majority', duracionHoras: 1 },
  });
  expect(primera.status(), await primera.text()).toBe(201);
  const decisionCerrada = (await primera.json()) as { id: string; huellaVersion: string };
  resultadoDecisionId = decisionCerrada.id;
  await apiLucia.dispose();

  // La lista y el detalle de iniciativas también son parte de la superficie accesible. Creamos
  // una de verdad y dejamos una segunda decisión abierta para el recorrido de teclado posterior.
  for (const cuenta of [sara, lucia]) {
    const cliente = await apiDirecta(cuenta);
    const papeleta = await cliente.post(`/decisiones/${decisionCerrada.id}/papeletas`, {
      data: {
        requestId: requestId(),
        huellaVersion: decisionCerrada.huellaVersion,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(papeleta.status(), await papeleta.text()).toBe(201);
    await cliente.dispose();
  }
  await avanzarReloj(61 * 60 * 1000);
  const cierreApi = await apiDirecta(lucia);
  const cierre = await cierreApi.post(`/decisiones/${decisionCerrada.id}/cerrar`, {
    data: { requestId: requestId() },
  });
  expect(cierre.status(), await cierre.text()).toBe(200);
  iniciativaId = ((await cierre.json()) as { iniciativaId: string }).iniciativaId;

  const abierta = await cierreApi.post('/decisiones', {
    data: { requestId: requestId(), propuestaId, metodo: 'sociocratic-consent', duracionHoras: 24 },
  });
  expect(abierta.status(), await abierta.text()).toBe(201);
  decisionId = ((await abierta.json()) as { id: string }).id;
  await cierreApi.dispose();
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

test('Iniciativas: lista', async ({ page }) => {
  await revisar(page, '/iniciativas');
});

test('Iniciativa: detalle y criterios de evaluación', async ({ page }) => {
  await revisar(page, `/iniciativas/${iniciativaId}`);
});

test('Resultado: traza y vínculo con su iniciativa', async ({ page }) => {
  await revisar(page, `/decisiones/${resultadoDecisionId}/resultado`);
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

  // Se llega a la primera opción de la papeleta usando únicamente Tab y se marca con la barra.
  const opcion = page.getByRole('radio', { name: /^Sin objeción/u });
  await tabularHasta(page, opcion);
  await expect(opcion).toBeFocused();
  await page.keyboard.press('Space');
  await expect(opcion).toBeChecked();

  // Y el botón de enviar se alcanza tabulando y se activa con Enter.
  const enviar = page.getByRole('button', { name: /respuesta/u });
  await tabularHasta(page, enviar);
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
