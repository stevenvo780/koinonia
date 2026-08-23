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
  afirmacionesDeQueEstaBien,
  apiDirecta,
  type Cuenta,
  crearProblemaPorApi,
  entorno,
  contenido,
  entrarPorApi,
  marca,
  NO_ES_PRUEBA_DE_SI_MISMA,
  planDe,
  puntoQueFalla,
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

test('antes de tocar nada, la pantalla NO canta victoria: dice «Sin confirmar»', async ({
  page,
}) => {
  await page.goto('/verificar');

  // El veredicto de partida. No es «está todo bien» y no puede serlo: el informe lo produce el
  // mismo servidor que guarda el historial, y aprobar el propio examen es una presunción, no un
  // éxito. Que esto sea ámbar y no verde es lo que le da valor a la alarma de más abajo: una
  // pantalla que dice que sí siempre no informa de nada el día que tiene que decir que no.
  const veredicto = contenido(page).getByRole('status').filter({ hasText: 'Sin confirmar' });
  await expect(veredicto).toBeVisible();
  await expect(contenido(page).getByRole('alert')).toHaveCount(0);

  // La pieza de honestidad, verbatim. Si una refactorización futura se la lleva por delante, la
  // pantalla pasa a cobrar una confianza que no se ganó, y esto tiene que fallar.
  await expect(veredicto).toContainText(NO_ES_PRUEBA_DE_SI_MISMA);

  // Los dos encabezados que hay, y el que ya no está: «Qué se comprobó» dejó de ser un `h2` para
  // pasar a ser el rótulo en línea de cada punto.
  await expect(page.getByRole('heading', { level: 2, name: 'Comprobalo por fuera' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Qué revisó el servidor' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Qué se comprobó' })).toHaveCount(0);

  // La revisión punto por punto sigue estando —y sigue explicando qué se comprobó y qué
  // significaría que estuviera mal—, pero ahora está plegada. Se abre y se lee: dar por buena la
  // presencia en el DOM sería dar por buena una pantalla que no enseña nada.
  const queSeComprobo = page.getByText('Que el historial está completo y en orden', {
    exact: false,
  });
  await expect(queSeComprobo).toBeHidden();
  await page.locator('summary', { hasText: 'Ver la revisión que hizo el servidor' }).click();
  await expect(queSeComprobo).toBeVisible();
  await expect(
    page.getByText('Cada hecho registrado apunta al anterior', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Que cada apertura privada todavía disponible corresponde', { exact: false }),
  ).toBeVisible();

  // El número que anuncia el desplegable es el número de puntos que enseña. Un resumen que miente
  // sobre cuánto esconde es peor que no tener resumen.
  const puntos = page.locator('ul.tarjetas > li');
  const cuantos = await puntos.count();
  expect(cuantos, 'la revisión del servidor tiene que enseñar sus puntos').toBeGreaterThan(0);
  await expect(
    page.locator('summary', { hasText: 'Ver la revisión que hizo el servidor' }),
  ).toHaveText(new RegExp(`\\(${String(cuantos)} puntos?\\)`, 'u'));

  // Y ni un «Está bien» por punto: la marca por punto se quitó a propósito, porque seis tarjetas
  // casi idénticas eran la nota que el servidor se ponía a sí mismo, seis veces.
  await expect(page.getByText('Está bien', { exact: true })).toHaveCount(0);

  // El verde está proscrito en la evaluación que el servidor hace de sí mismo, y la frase «está
  // todo bien» sólo puede aparecer NEGADA. Se lee la pantalla entera, con el desplegable abierto.
  const texto = await page.locator('main').innerText();
  expect(texto, 'el verde está proscrito en la nota que el servidor se pone').not.toMatch(
    /verde/iu,
  );
  expect(texto).not.toContain('Todas las comprobaciones pasaron');

  // La pantalla nombra la frase para rechazarla, y eso se exige aparte: sin esta línea, el barrido
  // de abajo pasaría también sobre una pantalla que no dijera nada, y un bucle que no recorre nada
  // es una prueba que no comprueba nada.
  expect(texto).toContain('no vas a leer que está todo bien');
  const afirmaciones = afirmacionesDeQueEstaBien(texto);
  expect(afirmaciones.length).toBeGreaterThan(0);
  for (const afirmacion of afirmaciones) {
    expect(afirmacion, 'la pantalla sólo puede nombrar «está todo bien» para rechazarlo').toMatch(
      /\bno\b/iu,
    );
  }
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
  //
  // Se le vuelve a preguntar al servidor **pulsando**, que es lo que haría cualquiera que dudara de
  // lo que está viendo. El botón se llama así porque la pantalla ya preguntó sola al cargar; la
  // primera vez, y sólo la primera, se llama «Comprobar ahora».
  await page.goto('/verificar');
  await page.getByRole('button', { name: 'Volver a preguntarle al servidor' }).click();

  // El titular. No es una advertencia templada ni un error técnico: es la acusación, y va sin
  // rodeos porque lo que pasó es que alguien cambió lo que ya estaba escrito.
  const alarma = contenido(page).getByRole('alert');
  await expect(alarma).toBeVisible();
  await expect(alarma).toContainText('El historial fue alterado');

  // Y es ESE titular y no el otro. La pantalla tiene un titular más suave para cuando lo único que
  // falla es la revisión de material privado local; usarlo acá sería quitarle hierro a una
  // manipulación del historial, que es justo lo que este escenario existe para impedir.
  await expect(alarma).not.toContainText('Falta material privado');

  await expect(alarma).toContainText('Esto se publica, no se arregla en silencio.');
  await expect(alarma).toContainText(NO_ES_PRUEBA_DE_SI_MISMA);

  // Con símbolo y palabra, y no sólo en rojo: quien no distingue el color tiene que poder leer que
  // acá no cuadra. Se busca por el papel que el bloque juega en la página —un artículo con nombre
  // propio— y no por la clase que lo pinta, que es lo que una refactorización de estilos mueve sin
  // avisar. La clase se comprueba además, porque el rojo también tiene que estar.
  const punto = puntoQueFalla(page).first();
  await expect(punto).toBeVisible();
  await expect(punto).toContainText('✕');
  await expect(punto).toContainText('Acá no cuadra');
  await expect(page.locator('.comprobacion.mal').first()).toBeVisible();

  // El punto que falla es el del historial, dicho con todas las letras y no por descarte.
  await expect(punto).toContainText('Que el historial está completo y en orden');

  // Y sigue explicando qué significa, en palabras, sin escupir un error técnico.
  await expect(page.getByText(/cuarentena/u).first()).toBeVisible();

  // El error técnico existe, pero plegado y debajo de las palabras. Se abre y se comprueba que hay
  // algo que llevarse: sin comprobante, «no cuadra» es una opinión que nadie puede rebatir ni
  // confirmar por su cuenta.
  await punto.locator('summary', { hasText: 'Ver el detalle técnico' }).click();
  await expect(punto.locator('code.comprobante')).toBeVisible();
  expect(
    ((await punto.locator('code.comprobante').textContent()) ?? '').trim().length,
  ).toBeGreaterThan(0);

  // Los puntos que sí pasaron quedan plegados y **debajo**, y al abrirlos la pantalla no se
  // desdice: dice que no cambian nada de lo de arriba. Un «5 de 6 están bien» al lado de la alarma
  // es cómo se diluye una alarma sin borrarla.
  const resto = page.locator('summary', { hasText: 'Ver el resto de la revisión' });
  await expect(resto).toBeVisible();
  await resto.click();
  await expect(
    page.getByText('basta con que falle uno para que el historial no se pueda dar por bueno', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(alarma).toContainText('El historial fue alterado');
});

/**
 * Devuelve el historial a como estaba.
 *
 * No es limpieza cosmética: los cinco navegadores de la matriz comparten una sola base, y un
 * historial roto para siempre haría fallar a todos los proyectos que corrieran después por una razón
 * que no tiene nada que ver con lo que prueban.
 *
 * Y de paso demuestra algo que vale la pena: al reponer **los bytes exactos**, la verificación
 * vuelve a cuadrar sola. No hay ninguna bandera de «ya lo arreglé»; lo que hace que cuadre es que
 * el contenido vuelve a ser el que produce esa huella. Si se repusiera un texto *parecido*,
 * seguiría en alarma.
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

test('reponer los bytes exactos apaga la alarma sola, sin ninguna bandera', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Volver a preguntarle al servidor' }).click();
  await expect(contenido(page).getByRole('alert')).toContainText('El historial fue alterado');

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
  await page.getByRole('button', { name: 'Volver a preguntarle al servidor' }).click();
  // La alarma se apaga —no queda ni un `role="alert"` en pie— y el veredicto vuelve al ámbar de
  // partida. No vuelve a un verde, porque ese verde no existe: lo que se recupera es la presunción,
  // no una garantía.
  await expect(
    contenido(page).getByRole('status').filter({ hasText: 'Sin confirmar' }),
  ).toBeVisible();
  await expect(contenido(page).getByRole('alert')).toHaveCount(0);
  await expect(puntoQueFalla(page)).toHaveCount(0);
  await expect(page.locator('.comprobacion.mal')).toHaveCount(0);
});
