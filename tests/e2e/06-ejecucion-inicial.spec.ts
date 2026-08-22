/**
 * ESCENARIO 6 — La decisión aprobada no se vuelve trabajo por arte de magia.
 *
 * Cierre → ventana de impugnación → ratificación → hito → oferta → aceptación. También recorre
 * rechazo → nueva oferta y demuestra por API que una respuesta a la oferta vieja no puede colarse.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

import type { IniciativaDetalle } from '@koinonia/contracts';

import {
  apiAnonima,
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
const correoResponsable = `responsable.ejecucion.${sufijo}@udea.edu.co`;
const correoDestinataria = `destinataria.ejecucion.${sufijo}@udea.edu.co`;
const correoReemplazo = `reemplazo.ejecucion.${sufijo}@udea.edu.co`;
const aliasDestinataria = correoDestinataria.split('@')[0]!;
const aliasReemplazo = correoReemplazo.split('@')[0]!;

const TITULO_HITO = `Petición preparada ${sufijo}`;
const TITULO_HITO_REINTENTO = `Seguimiento de red inestable ${sufijo}`;
const TITULO_HITO_DOBLE_TOQUE = `Publicación sin doble toque ${sufijo}`;
const TITULO_HITO_SESION_RENOVADA = `Continuidad después del reingreso ${sufijo}`;
const TITULO_TAREA_ACEPTADA = `Redactar la petición ${sufijo}`;
const TITULO_TAREA_REOFRECIDA = `Revisar el horario ${sufijo}`;

let responsable: Cuenta;
let destinataria: Cuenta;
let reemplazo: Cuenta;
let facilitadora: Cuenta;
let propuestaId: string;
let decisionId: string;
let iniciativaId: string;
let hitoId: string;
let tareaAceptadaId: string;
let tareaReofrecidaId: string;
let ofertaViejaId: string;

function fechaDeFormulario(diasDesdeHoy: number): string {
  const instanteDeseado = Date.now() + diasDesdeHoy * 24 * 60 * 60 * 1000;
  const horaColombiaComoUtc = instanteDeseado - 5 * 60 * 60 * 1000;
  return new Date(horaColombiaComoUtc).toISOString().slice(0, 16);
}

async function iniciativaComo(cuenta: Cuenta): Promise<IniciativaDetalle> {
  const api = await apiDirecta(cuenta);
  try {
    const respuesta = await api.get(`/iniciativas/${iniciativaId}`);
    expect(respuesta.status(), await respuesta.text()).toBe(200);
    return (await respuesta.json()) as IniciativaDetalle;
  } finally {
    await api.dispose();
  }
}

async function esperarTarea(
  cuenta: Cuenta,
  titulo: string,
): Promise<IniciativaDetalle['tareas'][number]> {
  let encontrada: IniciativaDetalle['tareas'][number] | undefined;
  await expect
    .poll(async () => {
      encontrada = (await iniciativaComo(cuenta)).tareas.find((tarea) => tarea.titulo === titulo);
      return encontrada !== undefined;
    })
    .toBe(true);
  return encontrada!;
}

async function tabularHasta(page: Page, destino: Locator, maximo = 100): Promise<void> {
  for (let intento = 0; intento < maximo; intento++) {
    await page.keyboard.press('Tab');
    if (await destino.evaluate((elemento) => elemento.ownerDocument.activeElement === elemento)) {
      return;
    }
  }
  throw new Error(`no se alcanzó el control con Tab después de ${String(maximo)} intentos`);
}

async function revisarAccesibilidad(page: Page, estado: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const analisis = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const detalle = analisis.violations
    .map(
      (violacion) =>
        `[${String(violacion.impact)}] ${violacion.id}: ${violacion.help}\n` +
        `  ${violacion.nodes[0]?.html ?? ''}`,
    )
    .join('\n');
  expect(analisis.violations, `Violaciones de accesibilidad en ${estado}:\n${detalle}`).toEqual([]);
}

test.beforeAll(async () => {
  await reiniciarHistorial();
  responsable = await entrarPorApi(correoResponsable);
  destinataria = await entrarPorApi(correoDestinataria);
  reemplazo = await entrarPorApi(correoReemplazo);
  facilitadora = await entrarPorApi(CORREO_FACILITADORA);

  const problemaId = await crearProblemaPorApi(responsable, {
    titulo: `Falta un horario nocturno estable ${sufijo}`,
    cuerpo:
      'El horario cambia sin aviso y quienes estudian en la noche no pueden saber cuándo estará ' +
      'disponible la sala de lectura del Instituto.',
  });

  const apiResponsable = await apiDirecta(responsable);
  const propuesta = await apiResponsable.post('/propuestas', {
    data: {
      requestId: requestId(),
      problemaId,
      titulo: `Publicar un horario verificable ${sufijo}`,
      cuerpo:
        'Preparar una petición estudiantil con el horario que hace falta, radicarla y comprobar ' +
        'semanalmente si la sala abre en las franjas que la comunidad acordó.',
      plan: planDe(responsable.miembroId),
    },
  });
  expect(propuesta.status(), await propuesta.text()).toBe(201);
  propuestaId = ((await propuesta.json()) as { id: string }).id;
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
  decisionId = decision.id;
  await apiFacilitadora.dispose();

  // Todo el padrón congelado se manifiesta: el escenario no depende del mínimo configurado.
  for (const cuenta of [responsable, destinataria, reemplazo, facilitadora]) {
    const api = await apiDirecta(cuenta);
    const papeleta = await api.post(`/decisiones/${decisionId}/papeletas`, {
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
  const apiCierre = await apiDirecta(facilitadora);
  const cierre = await apiCierre.post(`/decisiones/${decisionId}/cerrar`, {
    data: { requestId: requestId() },
  });
  expect(cierre.status(), await cierre.text()).toBe(200);
  iniciativaId = ((await cierre.json()) as { iniciativaId: string }).iniciativaId;
  await apiCierre.dispose();
});

test('la impugnación es real y un miembro raso no puede ratificar', async ({ page }) => {
  const apiMiembro = await apiDirecta(responsable);
  const sinRol = await apiMiembro.post(`/decisiones/${decisionId}/ratificar`, {
    data: { requestId: requestId() },
  });
  expect(sinRol.status(), await sinRol.text()).toBe(403);
  await apiMiembro.dispose();

  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);
  await expect(page.getByText('En revisión').first()).toBeVisible();
  await expect(page.getByText('La ratificación puede hacerse desde')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Ratificar y abrir la organización del trabajo' }),
  ).toHaveCount(0);

  const apiFacilitadora = await apiDirecta(facilitadora);
  const prematura = await apiFacilitadora.post(`/decisiones/${decisionId}/ratificar`, {
    data: { requestId: requestId() },
  });
  expect(prematura.status(), await prematura.text()).toBe(422);
  expect(((await prematura.json()) as { codigo: string }).codigo).toBe('CHALLENGE_WINDOW_OPEN');
  await apiFacilitadora.dispose();

  await ponerSesionEnNavegador(page, facilitadora);
  await page.goto(`/iniciativas/${iniciativaId}`);
  await page.getByRole('button', { name: 'Ratificar y abrir la organización del trabajo' }).click();
  await expect(page.getByText('Todavía está abierto el tiempo para impugnar')).toBeVisible();

  const provisional = await iniciativaComo(responsable);
  expect(provisional.activa).toBe(false);
  expect(provisional.ratificableEn).toBeDefined();
  expect(provisional.hitos).toEqual([]);
  expect(provisional.tareas).toEqual([]);
});

test('tras 72 horas se ratifica, se crea un hito y se ofrece una tarea sin asignarla', async ({
  page,
}) => {
  await avanzarReloj(72 * 60 * 60 * 1000);

  // Las sesiones duran 12 horas. Se entra de nuevo; el identificador institucional permanece.
  responsable = await entrarPorApi(correoResponsable);
  destinataria = await entrarPorApi(correoDestinataria);
  reemplazo = await entrarPorApi(correoReemplazo);
  facilitadora = await entrarPorApi(CORREO_FACILITADORA);

  await ponerSesionEnNavegador(page, facilitadora);
  await page.goto(`/iniciativas/${iniciativaId}`);
  await page.getByRole('button', { name: 'Ratificar y abrir la organización del trabajo' }).click();
  await expect(page.getByText('Iniciativa activa').first()).toBeVisible();
  await expect(page.getByText('La decisión quedó ratificada')).toBeVisible();

  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Organizar el trabajo inicial' }),
  ).toBeVisible();

  const formularioHito = page.getByRole('group', { name: 'Agregar un hito' });
  await formularioHito.getByLabel('¿Qué momento concreto queremos alcanzar?').fill(TITULO_HITO);
  await formularioHito
    .getByLabel('¿Qué tendría que verse para decir que se logró?')
    .fill('La petición está revisada, firmada y lista para radicarse ante la Dirección.');
  await formularioHito.getByLabel('Fecha y hora límite').fill(fechaDeFormulario(30));
  await formularioHito.getByRole('button', { name: 'Agregar el hito' }).click();
  await expect(page.getByRole('heading', { name: TITULO_HITO })).toBeVisible();

  const vista = await iniciativaComo(responsable);
  hitoId = vista.hitos.find((hito) => hito.titulo === TITULO_HITO)!.id;

  const formularioTarea = page.getByRole('group', { name: 'Ofrecer una tarea' });
  await formularioTarea.getByLabel('¿A qué hito aporta?').selectOption(hitoId);
  await formularioTarea.getByLabel('¿Qué hay que hacer?').fill(TITULO_TAREA_ACEPTADA);
  await formularioTarea
    .getByLabel('¿Qué incluye esta tarea?')
    .fill(
      'Escribir el primer borrador, contrastarlo con el acuerdo y dejarlo listo para revisión.',
    );
  await formularioTarea
    .getByLabel('¿A quién querés ofrecérsela?')
    .selectOption({ label: aliasDestinataria });
  await formularioTarea.getByLabel('Fecha y hora límite').fill(fechaDeFormulario(14));
  await formularioTarea.getByLabel('Tiempo estimado, en minutos').fill('90');
  await formularioTarea.getByRole('button', { name: 'Ofrecer la tarea' }).click();
  await expect(page.getByText('Sólo tendrá responsable si la persona la acepta')).toBeVisible();

  const tarea = await esperarTarea(destinataria, TITULO_TAREA_ACEPTADA);
  tareaAceptadaId = tarea.id;
  expect(tarea.estado).toBe('ofrecida');
  expect(tarea.responsableId).toBeUndefined();
  expect(tarea.esMia).toBe(true);
});

test('la destinataria acepta con teclado y sólo entonces queda como responsable', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, destinataria);
  await page.goto(`/iniciativas/${iniciativaId}`);
  await revisarAccesibilidad(page, 'una oferta pendiente de respuesta');

  const tarjeta = page.getByRole('article', { name: TITULO_TAREA_ACEPTADA });
  await expect(tarjeta.getByText('Todavía no figura a tu cargo')).toBeVisible();
  const aceptar = tarjeta.getByRole('radio', { name: 'La acepto' });
  await expect(aceptar).not.toBeChecked();
  await expect(tarjeta.getByRole('button', { name: 'Registrar mi respuesta' })).toBeDisabled();
  await tabularHasta(page, aceptar);
  await expect(aceptar).toBeFocused();
  await page.keyboard.press('Space');
  const registrar = tarjeta.getByRole('button', { name: 'Registrar mi respuesta' });
  await tabularHasta(page, registrar);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Aceptaste la tarea. Desde ahora figura a tu cargo.')).toBeVisible();
  await expect(page.locator('#resultado-accion')).toBeFocused();

  const vista = await iniciativaComo(destinataria);
  const tarea = vista.tareas.find((candidata) => candidata.id === tareaAceptadaId)!;
  expect(tarea.estado).toBe('aceptada');
  expect(tarea.responsableId).toBe(destinataria.miembroId);
});

test('rechazo, reoferta y respuesta vieja: la oferta vigente es la única que vale', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);
  const formulario = page.getByRole('group', { name: 'Ofrecer una tarea' });
  await formulario.getByLabel('¿A qué hito aporta?').selectOption(hitoId);
  await formulario.getByLabel('¿Qué hay que hacer?').fill(TITULO_TAREA_REOFRECIDA);
  await formulario
    .getByLabel('¿Qué incluye esta tarea?')
    .fill(
      'Comparar el horario solicitado con las franjas reales y señalar cualquier contradicción.',
    );
  await formulario
    .getByLabel('¿A quién querés ofrecérsela?')
    .selectOption({ label: aliasDestinataria });
  await formulario.getByLabel('Fecha y hora límite').fill(fechaDeFormulario(16));
  await formulario.getByLabel('Tiempo estimado, en minutos').fill('45');
  await formulario.getByRole('checkbox', { name: TITULO_TAREA_ACEPTADA }).check();
  await formulario.getByRole('button', { name: 'Ofrecer la tarea' }).click();

  const ofrecida = await esperarTarea(destinataria, TITULO_TAREA_REOFRECIDA);
  tareaReofrecidaId = ofrecida.id;
  ofertaViejaId = ofrecida.ofertaId;
  expect(ofrecida.dependeDe).toEqual([tareaAceptadaId]);
  expect(ofrecida.responsableId).toBeUndefined();

  await ponerSesionEnNavegador(page, destinataria);
  await page.goto(`/iniciativas/${iniciativaId}`);
  const tarjetaDestinataria = page.getByRole('article', { name: TITULO_TAREA_REOFRECIDA });
  await tarjetaDestinataria.getByRole('radio', { name: 'No puedo aceptarla' }).check();
  await tarjetaDestinataria.getByLabel('Motivo general').selectOption('sin-disponibilidad');
  await tarjetaDestinataria.getByRole('button', { name: 'Registrar mi respuesta' }).click();
  await expect(page.getByText('La tarea no figura a tu cargo')).toBeVisible();

  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);
  const tarjetaResponsable = page.getByRole('article', { name: TITULO_TAREA_REOFRECIDA });
  const nuevaPersona = tarjetaResponsable.getByLabel('Nueva persona');
  await expect(nuevaPersona.getByRole('option', { name: aliasReemplazo, exact: true })).toHaveCount(
    1,
  );
  await expect(
    nuevaPersona.getByRole('option', { name: aliasDestinataria, exact: true }),
  ).toHaveCount(0);
  await revisarAccesibilidad(page, 'una tarea rechazada lista para reofrecer');
  await nuevaPersona.selectOption({ label: aliasReemplazo });
  await tarjetaResponsable.getByRole('button', { name: 'Hacer la nueva oferta' }).click();
  await expect(page.getByText('La nueva oferta reemplazó la anterior')).toBeVisible();

  // El destinatario anterior intenta aceptar el enlace lógico viejo llamando a la API directamente.
  const apiVieja = await apiDirecta(destinataria);
  const vieja = await apiVieja.post(
    `/iniciativas/${iniciativaId}/tareas/${tareaReofrecidaId}/respuestas`,
    {
      data: {
        requestId: requestId(),
        offerId: ofertaViejaId,
        revision: ofrecida.revision,
        tipo: 'aceptar',
      },
    },
  );
  expect(vieja.status(), await vieja.text()).toBe(409);
  expect(((await vieja.json()) as { codigo: string }).codigo).toBe('STALE_TASK_OFFER');
  await apiVieja.dispose();

  await ponerSesionEnNavegador(page, reemplazo);
  await page.goto(`/iniciativas/${iniciativaId}`);
  const tarjetaReemplazo = page.getByRole('article', { name: TITULO_TAREA_REOFRECIDA });
  await tarjetaReemplazo.getByRole('radio', { name: 'La acepto' }).check();
  await tarjetaReemplazo.getByRole('button', { name: 'Registrar mi respuesta' }).click();
  await expect(page.getByText('Aceptaste la tarea. Desde ahora figura a tu cargo.')).toBeVisible();

  const vista = await iniciativaComo(reemplazo);
  const aceptada = vista.tareas.find((candidata) => candidata.id === tareaReofrecidaId)!;
  expect(aceptada.estado).toBe('aceptada');
  expect(aceptada.responsableId).toBe(reemplazo.miembroId);
  expect(aceptada.ofertaId).not.toBe(ofertaViejaId);

  // Aceptar no encierra a nadie: pedir relevo retira inmediatamente la atribución vigente.
  await tarjetaReemplazo.getByLabel('Motivo general').selectOption('razon-privada');
  await tarjetaReemplazo.getByRole('button', { name: 'Pedir otra persona' }).click();
  await expect(page.getByText('La tarea dejó de figurar a tu cargo inmediatamente')).toBeVisible();
  const reasignada = (await iniciativaComo(reemplazo)).tareas.find(
    (candidata) => candidata.id === tareaReofrecidaId,
  )!;
  expect(reasignada.estado).toBe('reasignacion-solicitada');
  expect(reasignada.responsableId).toBeUndefined();
});

test('si el servidor guardó pero se perdió la respuesta, reintenta la misma intención una sola vez', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);

  const requestIds: string[] = [];
  let primera = true;
  const patron = `**/api/iniciativas/${iniciativaId}/hitos`;
  await page.route(patron, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { requestId?: string };
    if (body.requestId !== undefined) requestIds.push(body.requestId);
    if (primera) {
      primera = false;
      const committed = await route.fetch();
      expect(committed.status(), await committed.text()).toBe(201);
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  const formulario = page.getByRole('group', { name: 'Agregar un hito' });
  await formulario
    .getByLabel('¿Qué momento concreto queremos alcanzar?')
    .fill(TITULO_HITO_REINTENTO);
  await formulario
    .getByLabel('¿Qué tendría que verse para decir que se logró?')
    .fill('El historial contiene exactamente un hito aunque la primera respuesta no haya llegado.');
  await formulario.getByLabel(/Fecha y hora límite/).fill(fechaDeFormulario(25));
  await formulario.getByRole('button', { name: 'Agregar el hito' }).click();
  await expect(page.getByText('No se pudo')).toBeVisible();
  await expect(formulario.getByRole('button', { name: 'Agregar el hito' })).toBeEnabled();

  await formulario.getByRole('button', { name: 'Agregar el hito' }).click();
  await expect(page.getByRole('heading', { name: TITULO_HITO_REINTENTO })).toHaveCount(1);
  await page.unroute(patron);

  expect(requestIds).toHaveLength(2);
  expect(requestIds[1]).toBe(requestIds[0]);
  const vista = await iniciativaComo(responsable);
  expect(vista.hitos.filter((hito) => hito.titulo === TITULO_HITO_REINTENTO)).toHaveLength(1);
});

test('la API y la interfaz reservan la planificación a la responsable inicial', async ({
  page,
}) => {
  const antes = await iniciativaComo(responsable);
  const apiNoResponsable = await apiDirecta(destinataria);
  const indebido = await apiNoResponsable.post(`/iniciativas/${iniciativaId}/hitos`, {
    data: {
      requestId: requestId(),
      titulo: 'Un hito que no puede registrar otra persona',
      criterioDeTerminacion: 'Este criterio no debería llegar a formar parte del historial.',
      venceEn: Date.now() + 20 * 24 * 60 * 60 * 1000,
    },
  });
  expect(indebido.status(), await indebido.text()).toBe(403);
  await apiNoResponsable.dispose();

  const anonima = await apiAnonima();
  const directorio = await anonima.get(`/circulos/${antes.circuloId}/miembros`);
  expect(directorio.status(), await directorio.text()).toBe(401);
  await anonima.dispose();

  const despues = await iniciativaComo(responsable);
  expect(despues.hitos).toHaveLength(antes.hitos.length);

  await ponerSesionEnNavegador(page, destinataria);
  await page.goto(`/iniciativas/${iniciativaId}`);
  await expect(page.getByRole('heading', { name: 'Organizar el trabajo inicial' })).toHaveCount(0);
  await expect(page.getByLabel('¿A quién querés ofrecérsela?')).toHaveCount(0);
});

test('un doble toque mantiene bloqueadas las mutaciones y sólo envía una solicitud', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);

  const requestIds: string[] = [];
  let avisarSolicitud!: () => void;
  const solicitudRetenida = new Promise<void>((resolve) => {
    avisarSolicitud = resolve;
  });
  let liberarRespuesta!: () => void;
  const respuestaRetenida = new Promise<void>((resolve) => {
    liberarRespuesta = resolve;
  });
  const patron = `**/api/iniciativas/${iniciativaId}/hitos`;
  await page.route(patron, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { requestId?: string };
    if (body.requestId !== undefined) requestIds.push(body.requestId);
    avisarSolicitud();
    await respuestaRetenida;
    await route.continue();
  });

  try {
    const formulario = page.getByRole('group', { name: 'Agregar un hito' });
    await formulario
      .getByLabel('¿Qué momento concreto queremos alcanzar?')
      .fill(TITULO_HITO_DOBLE_TOQUE);
    await formulario
      .getByLabel('¿Qué tendría que verse para decir que se logró?')
      .fill('Una sola solicitud agrega un solo hito aunque el botón reciba dos toques seguidos.');
    await formulario.getByLabel(/Fecha y hora límite/).fill(fechaDeFormulario(23));

    const guardar = formulario.locator('button');
    await guardar.evaluate((elemento) => {
      (elemento as HTMLButtonElement).click();
      (elemento as HTMLButtonElement).click();
    });
    await solicitudRetenida;

    await expect(guardar).toBeDisabled();
    await expect(guardar).toHaveText('Guardando…');
    await expect(formulario.getByLabel('¿Qué momento concreto queremos alcanzar?')).toBeDisabled();
    const formularioTarea = page.getByRole('group', { name: 'Ofrecer una tarea' });
    await expect(formularioTarea.getByLabel('¿A qué hito aporta?')).toBeDisabled();
    await expect(formularioTarea.getByRole('button', { name: 'Ofrecer la tarea' })).toBeDisabled();
    expect(requestIds).toHaveLength(1);

    liberarRespuesta();
    await expect(page.getByRole('heading', { name: TITULO_HITO_DOBLE_TOQUE })).toHaveCount(1);
    const vista = await iniciativaComo(responsable);
    expect(vista.hitos.filter((hito) => hito.titulo === TITULO_HITO_DOBLE_TOQUE)).toHaveLength(1);
    expect(requestIds).toHaveLength(1);
  } finally {
    liberarRespuesta();
    await page.unroute(patron);
  }
});

test('una sesión expirada conserva formulario y requestId hasta reingresar en otra pestaña', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, responsable);
  await page.goto(`/iniciativas/${iniciativaId}`);

  const requestIds: string[] = [];
  const patron = `**/api/iniciativas/${iniciativaId}/hitos`;
  await page.route(patron, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { requestId?: string };
    if (body.requestId !== undefined) requestIds.push(body.requestId);
    await route.continue();
  });

  const formulario = page.getByRole('group', { name: 'Agregar un hito' });
  const criterio =
    'El reingreso permite terminar exactamente la intención que ya estaba completa en pantalla.';
  const vence = fechaDeFormulario(21);

  try {
    await formulario
      .getByLabel('¿Qué momento concreto queremos alcanzar?')
      .fill(TITULO_HITO_SESION_RENOVADA);
    await formulario.getByLabel('¿Qué tendría que verse para decir que se logró?').fill(criterio);
    await formulario.getByLabel(/Fecha y hora límite/).fill(vence);

    await avanzarReloj(12 * 60 * 60 * 1000 + 1);
    await formulario.getByRole('button', { name: 'Agregar el hito' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Tu sesión terminó' })).toBeVisible();
    await expect(formulario.getByLabel('¿Qué momento concreto queremos alcanzar?')).toHaveValue(
      TITULO_HITO_SESION_RENOVADA,
    );
    await expect(
      formulario.getByLabel('¿Qué tendría que verse para decir que se logró?'),
    ).toHaveValue(criterio);
    await expect(formulario.getByLabel(/Fecha y hora límite/)).toHaveValue(vence);
    expect(requestIds).toHaveLength(1);
    await revisarAccesibilidad(page, 'una sesión expirada con el formulario conservado');

    const [entrada] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('link', { name: 'Entrá de nuevo en otra pestaña' }).click(),
    ]);
    await expect(entrada).toHaveURL(/\/entrar$/u);

    responsable = await entrarPorApi(correoResponsable);
    await ponerSesionEnNavegador(entrada, responsable);
    await entrada.close();
    await page.bringToFront();

    const sesionRecargada = page.waitForResponse(
      (respuesta) => respuesta.url().endsWith('/api/auth/yo') && respuesta.status() === 200,
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await sesionRecargada;

    await formulario.getByRole('button', { name: 'Agregar el hito' }).click();
    await expect(page.getByRole('heading', { name: TITULO_HITO_SESION_RENOVADA })).toHaveCount(1);

    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    const vista = await iniciativaComo(responsable);
    expect(vista.hitos.filter((hito) => hito.titulo === TITULO_HITO_SESION_RENOVADA)).toHaveLength(
      1,
    );
  } finally {
    await page.unroute(patron);
  }
});
