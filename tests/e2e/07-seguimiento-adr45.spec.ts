/**
 * ESCENARIO 7 — Seguimiento y revisión de una tarea (ADR-0045).
 *
 * La decisión y la oferta se preparan por la API para que el escenario se concentre en su frontera:
 * toda la capacidad, aceptación, ejecución, evidencia y revisión se recorren en la interfaz real.
 */

import { expect, test } from '@playwright/test';

import type { IniciativaDetalle } from '@koinonia/contracts';

import {
  apiDirecta,
  avanzarReloj,
  type Cuenta,
  crearProblemaPorApi,
  entrarPorApi,
  marca,
  planDe,
  ponerSesionEnNavegador,
  reiniciarHistorial,
  requestId,
} from './ayudas.js';
import { CORREO_FACILITADORA } from './global-setup.js';

test.describe.configure({ mode: 'serial' });

const sufijo = marca();
const TITULO_TAREA = `Preparar el informe verificable ${sufijo}`;
const NOTA_RESTRINGIDA =
  `La secretaría confirmó en privado el radicado piloto ${sufijo}; falta contrastarlo con el acta. ` +
  `referencia-${'x'.repeat(500)}`;
const RESUMEN_PRIMERO = `Se preparó el informe inicial ${sufijo} y se vinculó la confirmación recibida como evidencia.`;
const RESUMEN_SEGUNDO = `Se corrigió el informe ${sufijo}, se aclaró el alcance y se conserva la evidencia verificable.`;

let responsable: Cuenta;
let destinataria: Cuenta;
let facilitadora: Cuenta;
let iniciativaId: string;
let hitoId: string;

function fechaFutura(dias: number): number {
  return Date.now() + dias * 24 * 60 * 60 * 1000;
}

async function sembrarIniciativa(): Promise<void> {
  const problemaId = await crearProblemaPorApi(responsable, {
    titulo: `No existe seguimiento verificable de los acuerdos ${sufijo}`,
    cuerpo:
      'Las tareas se reparten en reuniones, pero después no queda una forma común de saber si ' +
      'empezaron, si necesitan ayuda o si la entrega fue revisada.',
  });

  const apiResponsable = await apiDirecta(responsable);
  const propuesta = await apiResponsable.post('/propuestas', {
    data: {
      requestId: requestId(),
      problemaId,
      titulo: `Publicar un informe de seguimiento ${sufijo}`,
      cuerpo:
        'Preparar un informe breve de los acuerdos activos, registrar evidencia y someter la ' +
        'entrega a revisión de la persona responsable inicial.',
      plan: planDe(responsable.miembroId),
    },
  });
  expect(propuesta.status(), await propuesta.text()).toBe(201);
  const propuestaId = ((await propuesta.json()) as { id: string }).id;
  await apiResponsable.dispose();

  const apiFacilitadora = await apiDirecta(facilitadora);
  const abierta = await apiFacilitadora.post('/decisiones', {
    data: {
      requestId: requestId(),
      propuestaId,
      metodo: 'simple-majority',
      duracionHoras: 1,
    },
  });
  expect(abierta.status(), await abierta.text()).toBe(201);
  const decision = (await abierta.json()) as { id: string; huellaVersion: string };
  await apiFacilitadora.dispose();

  for (const cuenta of [responsable, destinataria, facilitadora]) {
    const api = await apiDirecta(cuenta);
    const papeleta = await api.post(`/decisiones/${decision.id}/papeletas`, {
      data: {
        requestId: requestId(),
        huellaVersion: decision.huellaVersion,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(papeleta.status(), await papeleta.text()).toBe(201);
    await api.dispose();
  }

  await avanzarReloj(61 * 60 * 1000);
  // 61 minutos superan el corte por inactividad de la sesión (60 min): el testigo de facilitadora
  // ya no vale por inactividad, aunque el techo absoluto (8 h) esté lejos. Se renueva, como más
  // abajo con el salto de 72 h.
  facilitadora = await entrarPorApi(CORREO_FACILITADORA);
  const apiCierre = await apiDirecta(facilitadora);
  const cierre = await apiCierre.post(`/decisiones/${decision.id}/cerrar`, {
    data: { requestId: requestId() },
  });
  expect(cierre.status(), await cierre.text()).toBe(200);
  iniciativaId = ((await cierre.json()) as { iniciativaId: string }).iniciativaId;
  await apiCierre.dispose();

  await avanzarReloj(72 * 60 * 60 * 1000);
  responsable = await entrarPorApi(responsable.correo);
  destinataria = await entrarPorApi(destinataria.correo);
  facilitadora = await entrarPorApi(CORREO_FACILITADORA);

  const apiRatificacion = await apiDirecta(facilitadora);
  const ratificacion = await apiRatificacion.post(`/decisiones/${decision.id}/ratificar`, {
    data: { requestId: requestId() },
  });
  expect(ratificacion.status(), await ratificacion.text()).toBe(200);
  await apiRatificacion.dispose();

  const apiPlan = await apiDirecta(responsable);
  const hito = await apiPlan.post(`/iniciativas/${iniciativaId}/hitos`, {
    data: {
      requestId: requestId(),
      titulo: `Informe listo para revisión ${sufijo}`,
      criterioDeTerminacion:
        'Existe una entrega con evidencia restringida y una revisión explícita de su responsable.',
      venceEn: fechaFutura(30),
    },
  });
  expect(hito.status(), await hito.text()).toBe(201);
  const vistaHito = (await hito.json()) as IniciativaDetalle;
  const hitoCreadoId = vistaHito.hitos.at(-1)?.id;
  expect(hitoCreadoId).toBeDefined();
  hitoId = hitoCreadoId!;

  const oferta = await apiPlan.post(`/iniciativas/${iniciativaId}/tareas`, {
    data: {
      requestId: requestId(),
      hitoId: hitoCreadoId,
      destinatarioId: destinataria.miembroId,
      titulo: TITULO_TAREA,
      descripcion:
        'Preparar el informe, registrar una nota de evidencia restringida y entregarlo para una ' +
        'revisión que pueda pedir cambios antes de completarlo.',
      venceEn: fechaFutura(14),
      esfuerzoMinutos: 120,
      dependeDe: [],
    },
  });
  expect(oferta.status(), await oferta.text()).toBe(201);
  await apiPlan.dispose();
}

test.beforeAll(async () => {
  await reiniciarHistorial();
  responsable = await entrarPorApi(`responsable.seguimiento.${sufijo}@udea.edu.co`);
  destinataria = await entrarPorApi(`destinataria.seguimiento.${sufijo}@udea.edu.co`);
  facilitadora = await entrarPorApi(CORREO_FACILITADORA);
  await sembrarIniciativa();
});

test('capacidad, ejecución, evidencia privada, cambios y revisión final', async ({ page }) => {
  await ponerSesionEnNavegador(page, destinataria);

  // La declaración ocurre en la pantalla privada; ausencia y cero no se confunden.
  await page.goto('/mis-tareas');
  await expect(page.getByText('Todavía no declaraste una capacidad semanal.')).toBeVisible();
  await page.getByLabel('Horas por semana').fill('4');
  await page.getByLabel('Minutos adicionales').fill('0');
  await page.getByRole('button', { name: 'Guardar mi capacidad' }).click();
  await expect(
    page.getByText('Tu capacidad semanal quedó guardada de forma privada.'),
  ).toBeVisible();
  await expect(page.getByText('Declaraste 4 horas por semana.')).toBeVisible();

  await page.goto(`/iniciativas/${iniciativaId}`);
  let tarjeta = page.getByRole('article', { name: TITULO_TAREA });

  await tarjeta.getByRole('radio', { name: 'La acepto' }).check();
  await tarjeta.getByRole('button', { name: 'Registrar mi respuesta' }).click();
  await expect(page.getByText('Aceptaste la tarea. Desde ahora figura a tu cargo.')).toBeVisible();

  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await tarjeta.getByRole('button', { name: 'Comenzar la tarea' }).click();
  await expect(page.getByText('La tarea quedó en curso desde ahora.')).toBeVisible();

  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await tarjeta.getByLabel('Causa general').selectOption('recurso');
  await tarjeta.getByRole('button', { name: 'Declarar bloqueo' }).click();
  await expect(
    page.getByText('El bloqueo quedó registrado y la tarea dejó de correr.'),
  ).toBeVisible();

  // La evidencia puede registrarse durante la pausa y el texto no aparece en la proyección.
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await tarjeta.getByLabel('Nota restringida').fill(NOTA_RESTRINGIDA);
  await tarjeta.getByRole('button', { name: 'Guardar evidencia restringida' }).click();
  await expect(page.getByText('La nota quedó guardada como evidencia restringida.')).toBeVisible();
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await expect(tarjeta.getByText(NOTA_RESTRINGIDA, { exact: true })).toHaveCount(0);
  await expect(tarjeta.getByText(/texto, tamaño/u)).toBeVisible();

  await tarjeta.getByLabel('Ayuda general').selectOption('revision');
  await tarjeta.getByRole('button', { name: 'Pedir ayuda' }).click();
  await expect(
    page.getByText('El pedido de ayuda quedó registrado y la tarea quedó en apoyo.'),
  ).toBeVisible();

  // El contenido privado sólo cruza la frontera después de solicitar su apertura.
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await expect(tarjeta.getByText(NOTA_RESTRINGIDA, { exact: true })).toHaveCount(0);
  await tarjeta.getByRole('button', { name: 'Abrir evidencia' }).click();
  await expect(tarjeta.getByText(NOTA_RESTRINGIDA, { exact: true })).toBeVisible();

  await tarjeta.getByRole('button', { name: 'Reanudar la tarea' }).click();
  await expect(page.getByText('La tarea volvió a estar en curso.')).toBeVisible();

  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await tarjeta.getByRole('checkbox', { name: /Evidencia texto/u }).check();
  await tarjeta.getByLabel('Resumen restringido').fill(RESUMEN_PRIMERO);
  await tarjeta.getByRole('button', { name: 'Entregar para revisión' }).click();
  await expect(page.getByText('La entrega quedó esperando revisión.')).toBeVisible();
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await expect(tarjeta.getByText(RESUMEN_PRIMERO, { exact: true })).toHaveCount(0);

  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await expect(tarjeta.getByText(RESUMEN_PRIMERO, { exact: true })).toHaveCount(0);
  await tarjeta.getByRole('button', { name: 'Abrir resumen' }).click();
  await expect(tarjeta.getByText(RESUMEN_PRIMERO, { exact: true })).toBeVisible();
  await tarjeta.getByLabel('Motivo general').selectOption('alcance-incompleto');
  await tarjeta.getByRole('button', { name: 'Pedir cambios' }).click();
  await expect(
    page.getByText('Los cambios quedaron pedidos y la tarea volvió a estar en curso.'),
  ).toBeVisible();

  await ponerSesionEnNavegador(page, destinataria);
  await page.goto(`/iniciativas/${iniciativaId}`);
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await tarjeta.getByRole('checkbox', { name: /Evidencia texto/u }).check();
  await tarjeta.getByLabel('Resumen restringido').fill(RESUMEN_SEGUNDO);
  await tarjeta.getByRole('button', { name: 'Entregar para revisión' }).click();
  await expect(page.getByText('La entrega quedó esperando revisión.')).toBeVisible();

  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await tarjeta.getByLabel('Estado de la evidencia').selectOption('verificada');
  await tarjeta.getByRole('button', { name: 'Aceptar y completar' }).click();
  await expect(
    page.getByText('La revisión quedó aceptada y la tarea está completada.'),
  ).toBeVisible();

  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await expect(tarjeta.getByText('Completada', { exact: true })).toBeVisible();
  await expect(tarjeta.getByRole('button', { name: 'Aceptar y completar' })).toHaveCount(0);
  await expect(tarjeta.getByRole('button', { name: 'Pedir cambios' })).toHaveCount(0);
});

test('un cambio de cuenta invalida datos privados y una respuesta tardía no los revive', async ({
  context,
  page,
}) => {
  const observadora = await entrarPorApi(`observadora.seguimiento.${sufijo}@udea.edu.co`);
  await ponerSesionEnNavegador(page, destinataria);
  await page.goto(`/iniciativas/${iniciativaId}`);

  const patronPrivado = `**/api/iniciativas/${iniciativaId}/tareas/*/evidencias/*`;
  let liberarRespuesta: () => void = () => undefined;
  const retenida = new Promise<void>((resolve) => {
    liberarRespuesta = resolve;
  });
  let avisarRespuestaLista: () => void = () => undefined;
  const respuestaLista = new Promise<void>((resolve) => {
    avisarRespuestaLista = resolve;
  });
  await page.route(patronPrivado, async (route) => {
    const respuesta = await route.fetch();
    avisarRespuestaLista();
    await retenida;
    await route.fulfill({ response: respuesta }).catch(() => undefined);
  });

  let tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await tarjeta.getByRole('button', { name: 'Abrir evidencia' }).click();
  await respuestaLista;

  const otraPestana = await context.newPage();
  await ponerSesionEnNavegador(otraPestana, observadora);
  const sesionObservadora = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sesionObservadora;
  liberarRespuesta();
  await page.unroute(patronPrivado);

  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  await expect(tarjeta).toBeVisible();
  await expect(tarjeta.getByText(NOTA_RESTRINGIDA, { exact: true })).toHaveCount(0);
  await expect(tarjeta.getByRole('button', { name: 'Abrir evidencia' })).toHaveCount(0);

  // La capacidad de la cuenta anterior tampoco queda pintada mientras se revalida la sesión.
  await otraPestana.bringToFront();
  await ponerSesionEnNavegador(otraPestana, destinataria);
  let sesionDestinataria = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sesionDestinataria;
  await page.goto('/mis-tareas');
  await expect(page.getByText('Declaraste 4 horas por semana.')).toBeVisible();
  await page.getByLabel('Horas por semana').fill('9');
  await page.getByLabel('Minutos adicionales').fill('15');

  await otraPestana.bringToFront();
  await ponerSesionEnNavegador(otraPestana, observadora);
  const capacidadObservadora = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Declaraste 4 horas por semana.')).toHaveCount(0);
  await capacidadObservadora;
  await expect(page.getByText('Todavía no declaraste una capacidad semanal.')).toBeVisible();
  await expect(page.getByLabel('Horas por semana')).toHaveValue('');
  await expect(page.getByLabel('Minutos adicionales')).toHaveValue('');

  // Volver a la cuenta autorizada exige una nueva apertura explícita; además se preserva el reflow.
  await otraPestana.bringToFront();
  await ponerSesionEnNavegador(otraPestana, destinataria);
  sesionDestinataria = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sesionDestinataria;
  await page.goto(`/iniciativas/${iniciativaId}`);
  tarjeta = page.getByRole('article', { name: TITULO_TAREA });
  const abrir = tarjeta.getByRole('button', { name: 'Abrir evidencia' });
  await abrir.click();
  const contenido = tarjeta.getByRole('status').filter({ hasText: NOTA_RESTRINGIDA });
  await expect(contenido).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
  await contenido.getByRole('button', { name: 'Ocultar y borrar de esta vista' }).click();
  await expect(tarjeta.getByText(NOTA_RESTRINGIDA, { exact: true })).toHaveCount(0);
  await expect(abrir).toBeFocused();
  await otraPestana.close();
});

test('una recarga vieja de la misma cuenta no reemplaza la vista más reciente', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, destinataria);
  await page.goto(`/iniciativas/${iniciativaId}`);
  const api = await apiDirecta(destinataria);
  const base = await api.get(`/iniciativas/${iniciativaId}`);
  expect(base.status(), await base.text()).toBe(200);
  const proyeccion = (await base.json()) as IniciativaDetalle;
  await api.dispose();

  const antigua = `Proyección anterior ${sufijo}`;
  const reciente = `Proyección reciente ${sufijo}`;
  let liberarAntigua: () => void = () => undefined;
  const retenida = new Promise<void>((resolve) => {
    liberarAntigua = resolve;
  });
  let avisarPrimera: () => void = () => undefined;
  const primeraLista = new Promise<void>((resolve) => {
    avisarPrimera = resolve;
  });
  let avisarAntiguaTerminada: () => void = () => undefined;
  const antiguaTerminada = new Promise<void>((resolve) => {
    avisarAntiguaTerminada = resolve;
  });
  let numero = 0;
  await page.route(`**/api/iniciativas/${iniciativaId}`, async (route) => {
    numero += 1;
    if (numero === 1) {
      avisarPrimera();
      await retenida;
      await route.fulfill({ json: { ...proyeccion, objetivo: antigua } }).catch(() => undefined);
      avisarAntiguaTerminada();
      return;
    }
    await route.fulfill({ json: { ...proyeccion, objetivo: reciente } });
  });

  let revalidada = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await revalidada;
  await primeraLista;

  revalidada = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await revalidada;
  await expect(page.getByText(reciente, { exact: true })).toBeVisible();
  liberarAntigua();
  await antiguaTerminada;
  await expect(page.getByText(antigua, { exact: true })).toHaveCount(0);
  await expect(page.getByText(reciente, { exact: true })).toBeVisible();
  await page.unroute(`**/api/iniciativas/${iniciativaId}`);

  await page.goto('/mis-tareas');
  await expect(page.getByText('Declaraste 4 horas por semana.')).toBeVisible();
  await page.getByLabel('Horas por semana').fill('7');
  await page.getByLabel('Minutos adicionales').fill('30');
  const capacidadBase = {
    declarada: true as const,
    revision: 1,
    updatedAt: Date.now(),
  };
  let liberarCapacidad: () => void = () => undefined;
  const capacidadRetenida = new Promise<void>((resolve) => {
    liberarCapacidad = resolve;
  });
  let avisarCapacidad: () => void = () => undefined;
  const capacidadLista = new Promise<void>((resolve) => {
    avisarCapacidad = resolve;
  });
  let avisarCapacidadTerminada: () => void = () => undefined;
  const capacidadTerminada = new Promise<void>((resolve) => {
    avisarCapacidadTerminada = resolve;
  });
  numero = 0;
  await page.route('**/api/mi/capacidad', async (route) => {
    numero += 1;
    if (numero === 1) {
      avisarCapacidad();
      await capacidadRetenida;
      await route
        .fulfill({ json: { ...capacidadBase, minutosPorSemana: 60 } })
        .catch(() => undefined);
      avisarCapacidadTerminada();
      return;
    }
    await route.fulfill({ json: { ...capacidadBase, revision: 2, minutosPorSemana: 120 } });
  });

  revalidada = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await revalidada;
  await capacidadLista;
  revalidada = page.waitForResponse(
    (respuesta) => respuesta.url().endsWith('/api/auth/estado') && respuesta.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await revalidada;
  await expect(page.getByText('Declaraste 2 horas por semana.')).toBeVisible();
  liberarCapacidad();
  await capacidadTerminada;
  await expect(page.getByText('Declaraste 1 hora por semana.')).toHaveCount(0);
  await expect(page.getByText('Declaraste 2 horas por semana.')).toBeVisible();
  await expect(page.getByLabel('Horas por semana')).toHaveValue('7');
  await expect(page.getByLabel('Minutos adicionales')).toHaveValue('30');
  await page.unroute('**/api/mi/capacidad');
});

test('mis tareas permite aceptar y explica por qué una dependencia impide comenzar', async ({
  page,
}) => {
  const tituloPrevia = `Recopilar insumos previos ${sufijo}`;
  const tituloDependiente = `Sintetizar los insumos pendientes ${sufijo}`;
  const api = await apiDirecta(responsable);
  try {
    const previa = await api.post(`/iniciativas/${iniciativaId}/tareas`, {
      data: {
        requestId: requestId(),
        hitoId,
        destinatarioId: responsable.miembroId,
        titulo: tituloPrevia,
        descripcion:
          'Recopilar los insumos que deben existir antes de comenzar la síntesis verificable.',
        venceEn: fechaFutura(12),
        esfuerzoMinutos: 30,
        dependeDe: [],
      },
    });
    expect(previa.status(), await previa.text()).toBe(201);
    const previaId = ((await previa.json()) as IniciativaDetalle).tareas.find(
      (tarea) => tarea.titulo === tituloPrevia,
    )?.id;
    expect(previaId).toBeDefined();

    const dependiente = await api.post(`/iniciativas/${iniciativaId}/tareas`, {
      data: {
        requestId: requestId(),
        hitoId,
        destinatarioId: destinataria.miembroId,
        titulo: tituloDependiente,
        descripcion:
          'Sintetizar los insumos sólo después de que la recopilación previa haya terminado. ' +
          `referencia-publica-${'z'.repeat(500)}`,
        venceEn: fechaFutura(13),
        esfuerzoMinutos: 30,
        dependeDe: [previaId],
      },
    });
    expect(dependiente.status(), await dependiente.text()).toBe(201);
  } finally {
    await api.dispose();
  }

  await ponerSesionEnNavegador(page, destinataria);
  await page.goto('/mis-tareas');
  const tarjetaRapida = page.getByRole('heading', { name: tituloDependiente }).locator('..');
  await expect(
    tarjetaRapida.getByRole('button', { name: 'Pedir que se la ofrezcan a otra persona' }),
  ).toBeVisible();
  await tarjetaRapida.getByRole('button', { name: 'Aceptar oferta' }).click();
  await expect(
    page.getByText('Aceptaste la tarea. Ahora podés comenzar cuando el trabajo empiece.'),
  ).toBeVisible();
  await expect(tarjetaRapida).toBeFocused();
  await expect(tarjetaRapida.getByRole('button', { name: 'Comenzar la tarea' })).toBeDisabled();

  // La razón se sigue dando —si no, el botón apagado sería un misterio—, pero **como cuenta**: la
  // tarea de la que depende ésta es de otra persona, y «Mis tareas» ya no recibe trabajo ajeno.
  // Antes decía «Antes deben completarse: ⟨título de la tarea de la responsable⟩», que es
  // exactamente el dato que esta pantalla no tiene por qué tener.
  await expect(
    tarjetaRapida.getByText('Antes tiene que completarse otra tarea de la que depende esta'),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(tituloPrevia);

  // En la iniciativa, en cambio, se nombra: ahí es donde ese trabajo se rinde en público.
  await page.goto(`/iniciativas/${iniciativaId}`);
  const tarjeta = page.getByRole('article', { name: tituloDependiente });
  await expect(tarjeta.getByText(`${tituloPrevia} (pendiente)`, { exact: false })).toBeVisible();
  await expect(tarjeta.getByRole('button', { name: 'Comenzar la tarea' })).toBeDisabled();
  await expect(tarjeta.getByText(`Antes deben completarse: ${tituloPrevia}.`)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
});

test('la supresión sólo se solicita para una misma, con confirmación y sesión reciente', async () => {
  const correo = `supresion.propia.${sufijo}@udea.edu.co`;
  const initial = await entrarPorApi(correo);
  let api = await apiDirecta(initial);
  const malicious = await api.post('/mi/supresion', {
    data: {
      requestId: requestId(),
      baseLegal: 'ley-1581-art-8e',
      confirmacionIrreversible: true,
      subjectId: destinataria.miembroId,
    },
  });
  expect(malicious.status()).toBe(400);

  await avanzarReloj(10 * 60 * 1000 + 1);
  const stale = await api.post('/mi/supresion', {
    data: {
      requestId: requestId(),
      baseLegal: 'ley-1581-art-8e',
      confirmacionIrreversible: true,
    },
  });
  expect(stale.status()).toBe(401);
  expect(((await stale.json()) as { codigo: string }).codigo).toBe(
    'ERASURE_REAUTHENTICATION_REQUIRED',
  );
  await api.dispose();

  const fresh = await entrarPorApi(correo);
  api = await apiDirecta(fresh);
  try {
    const idempotencyKey = requestId();
    const payload = {
      requestId: idempotencyKey,
      baseLegal: 'ley-1581-art-8e',
      confirmacionIrreversible: true,
    } as const;
    const requested = await api.post('/mi/supresion', { data: payload });
    expect(requested.status(), await requested.text()).toBe(202);
    const receipt = (await requested.json()) as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual([
      'estado',
      'radicado',
      'solicitadaEn',
      'solicitudId',
    ]);
    expect(receipt['estado']).toBe('pendiente');

    const replay = await api.post('/mi/supresion', { data: payload });
    expect(replay.status(), await replay.text()).toBe(202);
    expect(await replay.json()).toEqual(receipt);

    const integrity = await api.get('/integridad');
    expect(integrity.status(), await integrity.text()).toBe(200);
    const privateCheck = (
      (await integrity.json()) as { comprobaciones: { id: string; bien: boolean }[] }
    ).comprobaciones.find((check) => check.id === 'material-privado');
    expect(privateCheck).toEqual(expect.objectContaining({ bien: true }));
  } finally {
    await api.dispose();
  }
});
