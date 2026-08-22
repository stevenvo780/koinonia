/**
 * ESCENARIO 5 — Inmutabilidad.
 *
 * Se manipula el historial **por debajo**, con el superusuario de la base y desactivando el blindaje
 * a propósito —que es exactamente la posición del administrador técnico— y se comprueba que la
 * pantalla de verificación **lo denuncia**.
 *
 * Va el último a propósito: después de esto el historial queda roto para siempre, que es justamente
 * lo que se quiere demostrar. No hay forma de «arreglarlo» sin que se note, y por eso este escenario
 * no puede correr antes que ningún otro.
 *
 * El ataque que se ejecuta no es el tonto —borrar una fila— sino el interesante: **cambiarle el
 * texto a la propuesta que ya se votó**, dejando los votos intactos. Es el que produciría un acta
 * donde la gente aparece habiendo aprobado algo que nunca leyó.
 */

import { Client } from 'pg';
import { expect, test } from '@playwright/test';

import {
  apiDirecta,
  type Cuenta,
  crearProblemaPorApi,
  entorno,
  entrarPorApi,
  marca,
  planDe,
  requestId,
} from './ayudas.js';

test.describe.configure({ mode: 'serial' });

let andres: Cuenta;
const sufijo = marca();
let propuestaId: string;
/** Lo que había antes de manipular, para poder devolverlo tal cual al terminar. */
let original: { readonly leafIndex: string; readonly payload: string } | undefined;

const TEXTO_ORIGINAL =
  'Radicar una petición para que la sala de estudio abra hasta las 9:00 p.m. de lunes a viernes, ' +
  'con la vigilancia institucional que la Universidad ya tiene.';

test.beforeAll(async () => {
  andres = await entrarPorApi(`andres.inmutable.${sufijo}@udea.edu.co`);
  const problemaId = await crearProblemaPorApi(andres, {
    titulo: `Problema para probar que el historial no se toca ${sufijo}`,
    cuerpo:
      'Este problema existe para que haya un texto real al que cambiarle una palabra por debajo, ' +
      'y comprobar que la plataforma lo dice en voz alta.',
  });
  const api = await apiDirecta(andres);
  const propuesta = await api.post('/propuestas', {
    data: {
      requestId: requestId(),
      problemaId,
      titulo: 'Pedir que la sala abra hasta las 9 de la noche',
      cuerpo: TEXTO_ORIGINAL,
      plan: planDe(andres.miembroId),
    },
  });
  expect(propuesta.status(), await propuesta.text()).toBe(201);
  propuestaId = ((await propuesta.json()) as { id: string }).id;
  await api.dispose();
});

test('antes de tocar nada, la pantalla dice que está todo bien', async ({ page }) => {
  await page.goto('/verificar');
  await expect(page.getByText('El historial está completo y sin alteraciones')).toBeVisible();
  // Y lo dice explicando qué se comprobó y qué significaría que estuviera mal.
  await expect(page.getByRole('heading', { level: 2, name: 'Qué se comprobó' })).toBeVisible();
  await expect(page.getByText('Está bien').first()).toBeVisible();
});

test('la aplicación NO puede alterar el historial ni aunque quiera', async () => {
  // El rol de la aplicación no tiene UPDATE ni DELETE sobre los hechos. Antes de simular al
  // administrador con `root`, se comprueba que el camino normal está cerrado: si no lo estuviera,
  // el resto del escenario probaría una defensa que no hace falta romper.
  const { superUrl } = entorno();
  const cliente = new Client({ connectionString: superUrl });
  await cliente.connect();
  try {
    const { rows } = await cliente.query<{ privilegio: string }>(
      `SELECT privilege_type AS privilegio
         FROM information_schema.role_table_grants
        WHERE grantee = 'koinonia_app'
          AND table_schema = 'governance' AND table_name = 'event'`,
    );
    const privilegios = rows.map((r) => r.privilegio).sort();
    expect(privilegios).toEqual(['INSERT', 'SELECT']);
  } finally {
    await cliente.end();
  }
});

test('el administrador con root cambia el texto, y la verificación LO DENUNCIA', async ({
  page,
}) => {
  const { superUrl } = entorno();
  const cliente = new Client({ connectionString: superUrl });
  await cliente.connect();
  try {
    // Posición del administrador técnico: superusuario y con el blindaje apagado a mano.
    await cliente.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');

    const { rows } = await cliente.query<{ leaf_index: string; payload: string }>(
      `SELECT leaf_index::text AS leaf_index, payload
         FROM governance.event
        WHERE aggregate_id = $1 AND event_type = 'ProposalDrafted'`,
      [propuestaId],
    );
    const fila = rows[0];
    expect(fila, 'debía existir el hecho que creó la propuesta').toBeDefined();
    original = { leafIndex: fila!.leaf_index, payload: fila!.payload };

    // Una sola palabra: «9:00» pasa a «6:00». Los votos no se tocan.
    const alterado = fila!.payload.replace('9:00 p.m.', '6:00 p.m.');
    expect(alterado, 'el texto tenía que cambiar de verdad').not.toBe(fila!.payload);

    await cliente.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
      alterado,
      fila!.leaf_index,
    ]);
  } finally {
    await cliente
      .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
      .catch(() => undefined);
    await cliente.end();
  }

  // ── Y la pantalla lo dice ──────────────────────────────────────────────────────────────────
  await page.goto('/verificar');
  await page.getByRole('button', { name: 'Comprobar ahora' }).click();

  await expect(page.getByText('Algo en el historial no cuadra').first()).toBeVisible();
  await expect(
    page
      .getByText('Esto es una alarma pública, no un arreglo silencioso', { exact: false })
      .first(),
  ).toBeVisible();
  // En rojo, con símbolo y palabra: nada depende sólo del color.
  await expect(page.locator('.comprobacion.mal').first()).toBeVisible();
  await expect(page.getByText('Algo no cuadra').first()).toBeVisible();

  // Y sigue explicando qué significa, en palabras, sin escupir un error técnico.
  await expect(page.getByText(/cuarentena/u).first()).toBeVisible();
});

/**
 * Devuelve el historial a como estaba.
 *
 * No es limpieza cosmética: los cinco navegadores de la matriz comparten una sola base, y un
 * historial roto para siempre haría fallar a todos los proyectos que corrieran después por una razón
 * que no tiene nada que ver con lo que prueban.
 *
 * Y de paso demuestra algo que vale la pena: al reponer **los bytes exactos**, la verificación
 * vuelve al verde sola. No hay ninguna bandera de «ya lo arreglé»; lo que hace que cuadre es que el
 * contenido vuelve a ser el que produce esa huella. Si se repusiera un texto *parecido*, seguiría
 * en rojo.
 */
test.afterAll(async () => {
  if (original === undefined) return;
  const cliente = new Client({ connectionString: entorno().superUrl });
  await cliente.connect();
  try {
    await cliente.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
    await cliente.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
      original.payload,
      original.leafIndex,
    ]);
  } finally {
    await cliente
      .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
      .catch(() => undefined);
    await cliente.end();
  }
});

test('el texto alterado no se cuela como si nada: la propuesta deja de verificar', async () => {
  const api = await apiDirecta(andres);
  const informe = (await (await api.get('/integridad')).json()) as {
    todoBien: boolean;
    comprobaciones: { id: string; bien: boolean; detalle?: string }[];
  };
  await api.dispose();

  expect(informe.todoBien).toBe(false);
  const cadena = informe.comprobaciones.find((c) => c.id === 'cadena');
  expect(cadena?.bien).toBe(false);
  expect(cadena?.detalle).toBeTruthy();
});

test('reponer los bytes exactos devuelve la verificación al verde, sin ninguna bandera', async ({
  page,
}) => {
  expect(original, 'el test anterior debió guardar el original').toBeDefined();

  const cliente = new Client({ connectionString: entorno().superUrl });
  await cliente.connect();
  try {
    await cliente.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
    // Primero, un texto PARECIDO pero no idéntico: sigue en rojo, porque lo que cuadra no es el
    // sentido, es el byte.
    await cliente.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
      original!.payload.replace('9:00 p.m.', '9:00 pm'),
      original!.leafIndex,
    ]);
  } finally {
    await cliente
      .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
      .catch(() => undefined);
    await cliente.end();
  }

  await page.goto('/verificar');
  await page.getByRole('button', { name: 'Comprobar ahora' }).click();
  await expect(page.getByText('Algo en el historial no cuadra').first()).toBeVisible();

  // Ahora sí, los bytes exactos.
  const cliente2 = new Client({ connectionString: entorno().superUrl });
  await cliente2.connect();
  try {
    await cliente2.query('ALTER TABLE governance.event DISABLE TRIGGER trg_event_append_only');
    await cliente2.query('UPDATE governance.event SET payload = $1 WHERE leaf_index = $2::bigint', [
      original!.payload,
      original!.leafIndex,
    ]);
  } finally {
    await cliente2
      .query('ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only')
      .catch(() => undefined);
    await cliente2.end();
  }

  await page.goto('/verificar');
  await page.getByRole('button', { name: 'Comprobar ahora' }).click();
  await expect(page.getByText('El historial está completo y sin alteraciones')).toBeVisible();
});
