/**
 * ESCENARIO 1 — Gobernanza completa.
 *
 * Problema → evidencia → propuesta con plan → enmienda → abrir decisión → votar → resultado →
 * iniciativa.
 * Todo por la interfaz, como lo haría Daniela desde el bus.
 */

import { expect, test } from '@playwright/test';

import {
  apiDirecta,
  avanzarReloj,
  CIRCULO_ESPACIOS,
  type Cuenta,
  entrarPorApi,
  marca,
  ponerSesionEnNavegador,
  reiniciarHistorial,
  requestId,
} from './ayudas.js';
import { CORREO_FACILITADORA } from './global-setup.js';

test.describe.configure({ mode: 'serial' });

let daniela: Cuenta;
let julian: Cuenta;
let lucia: Cuenta;
const sufijo = marca();
const TITULO = `La sala de estudio cierra a las 6 de la tarde ${sufijo}`;

test.beforeAll(async () => {
  // Cada navegador de la matriz arranca con el historial en blanco. Sin esto, el padrón que dejó el
  // navegador anterior haría que dos respuestas no alcanzaran la participación mínima, y el
  // escenario fallaría por una razón que no dice nada del producto.
  await reiniciarHistorial();
  daniela = await entrarPorApi(`daniela.${sufijo}@udea.edu.co`);
  julian = await entrarPorApi(`julian.${sufijo}@udea.edu.co`);
  lucia = await entrarPorApi(CORREO_FACILITADORA);
});

test('el ciclo completo, de punta a punta', async ({ page }) => {
  await ponerSesionEnNavegador(page, daniela);

  // ── 1. Escribir el problema ────────────────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Koinonía' })).toBeVisible();
  await page.getByRole('link', { name: 'Tengo un problema o una idea' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Tengo un problema o una idea' }),
  ).toBeVisible();
  await page
    .getByLabel('En una frase, ¿qué está pasando que no debería estar pasando?')
    .fill(TITULO);
  await page
    .getByLabel('¿Cómo te diste cuenta? Contá el hecho concreto.')
    .fill(
      'Los de la nocturna llegamos a las 5:40 y la sala cierra a las 6. No tenemos dónde leer y ' +
        'terminamos parados en el pasillo.',
    );
  await page.getByLabel('¿Quién decide esto?').selectOption(CIRCULO_ESPACIOS);
  await page.getByRole('button', { name: 'Guardar el problema' }).click();

  await expect(page.getByRole('heading', { level: 1, name: TITULO })).toBeVisible();
  const problemaUrl = page.url();
  const problemaId = problemaUrl.split('/').pop() ?? '';
  expect(problemaId).toMatch(/^[0-9a-f]{32}$/u);

  // ── 2. Aportar evidencia ───────────────────────────────────────────────────────────────────
  await expect(page.getByText('Todavía nadie aportó nada.')).toBeVisible();
  await page
    .getByLabel('¿Qué sabés?')
    .fill('De los 300 matriculados del Instituto, 86 están en la jornada nocturna.');
  await page.getByRole('radio', { name: 'Lo vi' }).check();
  await page.getByRole('button', { name: 'Aportar', exact: true }).click();
  await expect(page.getByText('86 están en la jornada nocturna')).toBeVisible();

  // ── 3. «A mí también me pasa» ──────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'A mí también me pasa' }).click();
  await expect(page.getByText('Ya dijiste que te pasa')).toBeVisible();
  // El número, nunca los nombres.
  await expect(page.getByText(/A 1 persona más le pasa lo mismo/u)).toBeVisible();

  // ── 4. Redactar la propuesta ───────────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Me ofrezco a redactar' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Escribir una propuesta' }),
  ).toBeVisible();
  await page
    .getByLabel('¿Qué se propone, en una frase?')
    .fill('Pedir que la sala abra hasta las 9');
  await page
    .getByLabel('¿Qué se hace, concretamente?')
    .fill(
      'Radicar una petición a la Dirección del Instituto para que la sala de estudio abra hasta ' +
        'las 9:00 p.m. de lunes a viernes. La llave queda a cargo de una comisión estudiantil.',
    );
  await page
    .getByLabel('¿Qué debería cambiar si esto sale bien?')
    .fill(
      'Quienes estudian en la noche pueden usar la sala hasta las nueve sin quedar en el pasillo.',
    );
  await page
    .getByLabel('¿Qué tendría que pasar para decir que funcionó?')
    .fill('La sala permanece abierta hasta las nueve durante al menos cuatro semanas seguidas.');
  await page.getByLabel('¿Dónde lo comprobamos?').fill('Registro semanal de apertura de la sala');
  await page.getByRole('button', { name: 'Guardar la propuesta' }).click();

  await expect(
    page.getByRole('heading', { level: 2, name: 'Historial de versiones' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Versión 1/u })).toBeVisible();
  const propuestaId = page.url().split('/').pop() ?? '';

  // ── 5. Enmendar ────────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Enmendar mi propuesta' }).click();
  await page
    .getByLabel('Texto de la propuesta')
    .fill(
      'Radicar una petición a la Dirección del Instituto para que la sala de estudio abra hasta ' +
        'las 9:00 p.m. de lunes a viernes, con la vigilancia institucional que la Universidad ya ' +
        'tiene. La comisión estudiantil sólo lleva el registro de uso.',
    );
  await page
    .getByLabel('¿Qué cambia y por qué?')
    .fill(
      'Dejar la llave a estudiantes traslada una responsabilidad patrimonial que no pueden asumir.',
    );
  await page.getByRole('button', { name: 'Guardar la versión nueva' }).click();

  await expect(page.getByRole('heading', { name: /^Versión 2/u })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Versión 1/u })).toBeVisible();

  // ── 6. Abrir la decisión desde la interfaz de facilitación ─────────────────────────────────
  await ponerSesionEnNavegador(page, lucia);
  await page.goto(`/propuestas/${propuestaId}`);
  await page.getByLabel('¿Cómo se toma esta decisión?').selectOption('sociocratic-consent');
  await page.getByLabel('¿Cuánto tiempo hay para responder?').fill('1');
  await page.getByRole('button', { name: 'Abrir la decisión' }).click();
  await expect(page).toHaveURL(/\/decisiones\/[0-9a-f]{32}$/u);
  const decisionId = page.url().split('/').pop() ?? '';

  // ── 7. Votar: «¿Alguien objeta?», no «vote sí o no» ────────────────────────────────────────
  await ponerSesionEnNavegador(page, daniela);
  await page.goto(`/decisiones/${decisionId}`);
  await expect(page.getByRole('group', { name: '¿Alguien objeta?' })).toBeVisible();
  await expect(
    page.getByText('No hace falta que a todos les guste', { exact: false }).first(),
  ).toBeVisible();
  // Qué hace falta para que esto pase, siempre visible antes de responder.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Qué hace falta para que esto pase' }),
  ).toBeVisible();

  await page.getByRole('radio', { name: /^Sin objeción/u }).check();
  await page.getByRole('button', { name: 'Enviar mi respuesta' }).click();
  await expect(page.getByText('Quedó registrado')).toBeVisible();
  await expect(page.getByText('Sin objeción', { exact: false }).first()).toBeVisible();

  // Julián también se manifiesta, para que el grupo llegue al mínimo.
  const apiJulian = await apiDirecta(julian);
  const papeleta = await apiJulian.post(`/decisiones/${decisionId}/papeletas`, {
    data: {
      requestId: requestId(),
      huellaVersion: (
        (await (await apiJulian.get(`/decisiones/${decisionId}`)).json()) as {
          huellaVersion: string;
        }
      ).huellaVersion,
      respuesta: { tipo: 'consent', postura: 'concern' },
    },
  });
  expect(papeleta.status(), await papeleta.text()).toBe(201);
  await apiJulian.dispose();

  // La papeleta se ve reflejada en la pantalla de la decisión.
  await page.reload();
  await expect(page.getByText(/Se manifestaron 2/u).first()).toBeVisible();

  // ── 8. La votación cierra cuando dice que cierra, no antes ─────────────────────────────────
  const apiLucia2 = await apiDirecta(lucia);
  const pronto = await apiLucia2.post(`/decisiones/${decisionId}/cerrar`, {
    data: { requestId: requestId() },
  });
  expect(pronto.status()).toBe(409);
  expect(await pronto.text()).toContain('CIERRE_ANTICIPADO_NO_PERMITIDO');

  // ── 9. Vencida la ventana, se cierra y sale el resultado con su traza ──────────────────────
  await avanzarReloj(61 * 60 * 1000);
  await apiLucia2.dispose();
  await ponerSesionEnNavegador(page, lucia);
  await page.goto(`/decisiones/${decisionId}`);
  await page.getByRole('button', { name: 'Cerrar y publicar el resultado' }).click();
  await expect(page).toHaveURL(`/decisiones/${decisionId}/resultado`);
  // El encabezado dice **de qué** es el resultado. Decía «Resultado» a secas, y a esta pantalla se
  // llega casi siempre por un enlace que alguien pasó: un veredicto sin su asunto no se puede citar.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pedir que la sala abra hasta las 9' }),
  ).toBeVisible();
  await expect(page.getByText('Resultado de la decisión sobre:')).toBeVisible();
  await expect(page.getByText('Aprobada').first()).toBeVisible();
  // La demostración, en castellano y paso por paso.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Por qué salió esto, paso por paso' }),
  ).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Se manifestaron' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Quiénes participaron' })).toBeVisible();

  // La regla de oro se comprueba sobre el resultado antes de seguir el vínculo a la iniciativa.
  const jergaProhibida = [
    'blockchain',
    'merkle',
    'hash',
    'event sourcing',
    'condorcet',
    'sociocracia',
  ];
  const textoResultado = (await page.locator('main').innerText()).toLowerCase();
  for (const prohibida of jergaProhibida) {
    expect(textoResultado, `«${prohibida}» no puede aparecer en el resultado`).not.toContain(
      prohibida,
    );
  }

  // Una aprobación que requiere trabajo nunca termina en el resultado: deja un siguiente paso
  // trazable, todavía provisional durante el periodo de impugnación.
  await expect(page.getByRole('heading', { level: 2, name: 'El siguiente paso' })).toBeVisible();
  await page.getByRole('link', { name: 'Ver la iniciativa y cómo se comprobará' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'El cambio que buscamos' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Quienes estudian en la noche pueden usar la sala hasta las nueve sin quedar en el pasillo.',
    ),
  ).toBeVisible();
  await expect(page.getByText('En revisión').first()).toBeVisible();
  await expect(page.getByText('Registro semanal de apertura de la sala')).toBeVisible();

  const textoIniciativa = (await page.locator('main').innerText()).toLowerCase();
  for (const prohibida of jergaProhibida) {
    expect(textoIniciativa, `«${prohibida}» no puede aparecer en la iniciativa`).not.toContain(
      prohibida,
    );
  }
});
