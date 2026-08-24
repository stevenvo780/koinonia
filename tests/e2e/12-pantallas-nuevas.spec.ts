/**
 * ESCENARIO 12 — Las pantallas que faltaban.
 *
 * Consenso, Círculos, Normas, Delegaciones e Historial: funcionalidad que ya estaba construida y
 * probada, y que **nadie podía usar** porque no tenía interfaz.
 *
 * ═══ Por qué acá no se usa `page.goto` ═══
 *
 * Cada pantalla se alcanza **pulsando desde la navegación**. Una pantalla a la que sólo se llega
 * escribiendo la dirección a mano no existe para nadie salvo para quien la escribió, y ése es
 * exactamente el fallo que este proyecto ya cometió una vez con «Deliberaciones». Un `goto` la
 * daría por buena. Un clic no.
 *
 * Lo demás que se comprueba acá:
 *
 *  · **axe-core** sin violaciones serias ni críticas en las seis pantallas, y la regla de oro
 *    (ADR-0041) sobre el texto visible de todas.
 *  · **El estado vacío de Consenso dice «Todavía no hay ningún sondeo»**, que es la promesa
 *    literal de `PRODUCT.md` §4 para ese estado —«no hay grupos claros» es un resultado de un
 *    sondeo puntual, en `/consenso/[id]`, no el vacío del índice—, y NO una lista de grupos vacía
 *    —que se leería como «no participó nadie»—.
 *  · **Un permiso, por API y saltándose la interfaz**: esconder un botón no autoriza nada.
 */

import AxeBuilder from '@axe-core/playwright';
import { forbiddenTermsIn } from '@koinonia/contracts';
import { expect, type Page, test } from '@playwright/test';

import {
  apiAnonima,
  apiDirecta,
  type Cuenta,
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
let sara: Cuenta;
let lucia: Cuenta;

/** Identificador del círculo «Académico»: el adaptador de identidad no mete a nadie en él. */
const CIRCULO_AJENO = 'acade31c0000000000000000000000c1';

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

/**
 * Va a la portada y llega a la pantalla **pulsando** el enlace de la navegación.
 *
 * Desde que la barra se partió en dos grupos, los seis destinos de consulta viajan plegados tras un
 * botón mientras el ancho sea escaso —o sea: en los dos navegadores móviles de la matriz, que son
 * 412 px y 390 px, y en cualquier ventana por debajo de 48 rem—. Ahí el enlace existe pero no se
 * puede pulsar, y sin desplegar primero este fichero entero se cae en `chrome-movil` y en
 * `safari-movil`: son de los `serial`, así que el primer fallo se lleva por delante los veinte
 * escenarios siguientes.
 *
 * Se despliega **pulsando el botón**, que es lo que hace una persona con un teléfono en la mano. No
 * es una concesión para que la prueba pase: el camino sigue siendo un clic de punta a punta —nunca
 * un `goto`— y sigue exigiendo el `h1` del destino al final. Si el destino dejara de ser alcanzable
 * a dedo, esto seguiría fallando, que es justo lo que tiene que hacer.
 */
async function llegarPulsando(page: Page, enlace: string, encabezado: string): Promise<void> {
  await page.goto('/');
  const navegacion = page.getByRole('navigation', { name: 'Principal' });
  await expect(navegacion).toBeVisible();

  const abridor = navegacion.getByRole('button', { name: 'Consultar' });
  if ((await abridor.isVisible()) && (await abridor.getAttribute('aria-expanded')) === 'false') {
    await abridor.click();
  }

  await navegacion.getByRole('link', { name: enlace }).click();
  await expect(page.getByRole('heading', { level: 1, name: encabezado })).toBeVisible();
}

test.beforeAll(async () => {
  await reiniciarHistorial();
  sara = await entrarPorApi(`sara.pantallas.${sufijo}@udea.edu.co`);
  lucia = await entrarPorApi(CORREO_FACILITADORA);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Alcanzables pulsando, que es lo que las hace existir
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('«En qué coincidimos» se alcanza desde la navegación', async ({ page }) => {
  await llegarPulsando(page, 'En qué coincidimos', 'En qué coincidimos');
  await revisar(page, '/consenso');
});

test('«Quién decide qué» se alcanza desde la navegación', async ({ page }) => {
  await llegarPulsando(page, 'Quién decide qué', 'Quién decide qué');
  await revisar(page, '/circulos');
});

test('«Las reglas del juego» se alcanza desde la navegación', async ({ page }) => {
  await llegarPulsando(page, 'Las reglas del juego', 'Las reglas del juego');
  await revisar(page, '/normas');
});

test('«Prestar tu voto» se alcanza desde la navegación', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');
  await revisar(page, '/delegaciones');
});

test('«Todo lo que quedó escrito» se alcanza desde la navegación', async ({ page }) => {
  await llegarPulsando(page, 'Todo lo que quedó escrito', 'Todo lo que quedó escrito');
  await revisar(page, '/historial');
});

test('el detalle de un grupo se alcanza pulsando desde la lista, no a mano', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await llegarPulsando(page, 'Quién decide qué', 'Quién decide qué');
  await page.getByRole('link', { name: 'Espacios y Bienestar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Espacios y Bienestar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quiénes lo integran' })).toBeVisible();
  await revisar(page, '/circulos/[id]');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Consenso: el estado vacío es un resultado, no un hueco
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('sin datos, Consenso dice «Todavía no hay ningún sondeo» y NO una lista de grupos vacía', async ({
  page,
}) => {
  await llegarPulsando(page, 'En qué coincidimos', 'En qué coincidimos');

  /*
   * Antes esta prueba buscaba «No hay grupos claros» directamente al llegar a Consenso. El
   * rediseño partió la pantalla en índice + detalle (ver el comentario al principio de
   * `apps/web/app/consenso/page.tsx`): «no hay grupos claros» es el RESULTADO de un sondeo
   * puntual sin agrupamientos —vive en `/consenso/[id]`—, no el estado vacío del índice con cero
   * sondeos en todo el sistema, que es lo que deja sembrado este escenario (sólo `reiniciarHistorial`
   * en el `beforeAll`, ningún sondeo). Releyendo PRODUCT.md §4: la columna «Estado vacío» de
   * Consenso no promete esa frase — promete que «un sondeo no puede abrirse» sin doce afirmaciones
   * sembradas, tres de ellas contrarias —, y «no hay grupos claros» está en la columna «Errores»
   * como resultado de un sondeo ya en curso. Se comprueba ahora lo que la pantalla dice de verdad.
   */
  await expect(page.getByText('Todavía no hay ningún sondeo')).toBeVisible();
  await expect(
    page.getByText('un sondeo no puede abrirse a valorar hasta que quien lo convoca siembre doce', {
      exact: false,
    }),
  ).toBeVisible();

  // Lo que sigue sin poder aparecer: el encabezado del mapa de grupos con nada debajo. Una lista
  // vacía se lee como «no participó nadie», y lo que pasa es otra cosa.
  await expect(page.getByRole('heading', { name: 'Grupos de opinión' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Grupo \d+$/u })).toHaveCount(0);

  // Nunca un callejón: ofrece por dónde seguir. Aparece dos veces —el botón de arriba y la salida
  // de la pieza `Vacio`—, y basta con que una esté a la vista.
  await expect(page.getByRole('link', { name: 'Abrir un sondeo' }).first()).toBeVisible();
});

test('Consenso no promete un mapa antes de tener con qué dibujarlo', async ({ page }) => {
  await llegarPulsando(page, 'En qué coincidimos', 'En qué coincidimos');
  // Ídem: sin ningún sondeo sembrado, el índice no tiene grupos que inventar.
  await expect(page.getByText('Todavía no hay ningún sondeo')).toBeVisible();
  const texto = await page.locator('main').innerText();
  // Ni una etiqueta de bando inventada.
  expect(texto).not.toMatch(/moderad|crític|radical|bando/iu);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Normas: el núcleo se ve como lo que es
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('las Normas enseñan el núcleo intangible como irreformable, y en palabras', async ({
  page,
}) => {
  await llegarPulsando(page, 'Las reglas del juego', 'Las reglas del juego');

  await expect(
    page.getByRole('heading', { name: 'Lo que no se puede cambiar por ninguna vía' }),
  ).toBeVisible();
  // Seis puntos, los del §6.b, y cada uno marcado **con palabras** y no sólo con un borde: quien no
  // distingue colores tiene que enterarse igual (WCAG 1.4.1).
  // `exact` porque el encabezado de la sección contiene la misma frase, y `getByText` busca
  // subcadenas sin distinguir mayúsculas: sin esto se contarían siete y el test mediría el título.
  await expect(page.getByText('No se puede cambiar por ninguna vía', { exact: true })).toHaveCount(
    6,
  );

  // Y el estado honesto: todavía no hay ninguna versión aprobada dentro de la plataforma.
  // La pieza `Vacio` escribe este texto como título (`<h3>`), sin el punto final que llevaba
  // cuando era un párrafo — mismo aviso que en `01-gobernanza.spec.ts`.
  await expect(
    page.getByText('Todavía no hay ninguna versión aprobada dentro de Koinonía'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver el historial completo' })).toBeVisible();
});

test('las Normas dicen las proporciones como las diría una persona', async ({ page }) => {
  await llegarPulsando(page, 'Las reglas del juego', 'Las reglas del juego');
  await expect(page.getByRole('heading', { name: 'Qué cuesta cambiar una regla' })).toBeVisible();
  const texto = await page.locator('main').innerText();
  expect(texto).toContain('2 de cada 3');
  // Un umbral con decimales no es el umbral: ADR-0027 lo prohíbe en el motor y no tiene por qué
  // aparecer en la pantalla disfrazado de precisión.
  expect(texto).not.toMatch(/0[,.]\d{2,}/u);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Historial: la puerta a comprobar
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('el Historial lleva a comprobar la integridad, pulsando', async ({ page }) => {
  await llegarPulsando(page, 'Todo lo que quedó escrito', 'Todo lo que quedó escrito');
  await page.getByRole('link', { name: 'Comprobar que nada se cambió' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Comprobar que nada se cambió' }),
  ).toBeVisible();
});

test('el Historial NO dice quién hizo cada cosa', async ({ page }) => {
  await ponerSesionEnNavegador(page, sara);
  await llegarPulsando(page, 'Todo lo que quedó escrito', 'Todo lo que quedó escrito');
  // Se espera a que la lista esté pintada antes de leerla: sin esto, el texto que se mide puede ser
  // el de «Cargando…», y entonces la prueba pasaría por no haber mirado nada.
  await expect(page.getByRole('heading', { name: 'Lo último que pasó' })).toBeVisible();
  const texto = await page.locator('main').innerText();
  expect(texto).not.toContain(sara.miembroId);
  expect(texto).not.toContain(lucia.miembroId);
  expect(texto).toContain('no dice quién hizo cada cosa');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Delegaciones: qué lo deshace se dice ANTES
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('Prestar tu voto explica que votar directo lo deshace, antes de ofrecerlo', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, sara);
  await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');
  await expect(
    page.getByText('Si votás vos, tu voto manda y el préstamo no se usa.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cómo funciona' })).toBeVisible();
});

test('sin votaciones abiertas, Prestar tu voto no deja a nadie en un callejón', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, sara);
  await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');
  await expect(page.getByText('No hay ninguna votación abierta')).toBeVisible();
  await expect(page.getByRole('link', { name: 'mirá los problemas abiertos' })).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Permisos, llamando a la API y SALTÁNDOSE la interfaz
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('HORIZONTAL — la lista de un grupo ajeno no se entrega, aunque se pida por API', async () => {
  const api = await apiDirecta(sara);
  try {
    const respuesta = await api.get(`/circulos/${CIRCULO_AJENO}/miembros`);
    expect(respuesta.status(), await respuesta.text()).toBe(403);
    const cuerpo = (await respuesta.json()) as { codigo: string };
    expect(cuerpo.codigo).toMatch(/UNAUTHORIZED/u);
  } finally {
    await api.dispose();
  }
});

test('VERTICAL — sin cuenta no se ve quién integra un grupo, ni por API', async () => {
  const api = await apiAnonima();
  try {
    const respuesta = await api.get('/circulos/e5bac105b1e00000000000000000000b/miembros');
    expect(respuesta.status()).toBe(401);
  } finally {
    await api.dispose();
  }
});

test('VERTICAL — sin cuenta no se presta ningún voto, ni por API', async () => {
  const api = await apiAnonima();
  try {
    const respuesta = await api.post('/decisiones/00000000000000000000000000000000/delegaciones', {
      data: { requestId: requestId(), enQuienId: sara.miembroId },
    });
    // 401 y no 404. No por secreto —qué votaciones hay es público y se lista sin cuenta— sino
    // porque «no encontramos eso» no le sirve de nada a quien lo que le falta es entrar, y porque
    // una escritura sin cuenta no tiene por qué costar una lectura del historial.
    expect(respuesta.status(), await respuesta.text()).toBe(401);
    expect(((await respuesta.json()) as { codigo: string }).codigo).toBe(
      'UNAUTHORIZED_NOT_AUTHENTICATED',
    );
  } finally {
    await api.dispose();
  }
});

test('la interfaz tampoco ofrece prestar el voto a quien no entró', async ({ page }) => {
  // No es la garantía —la garantía está arriba— pero sí es lo correcto: no se ofrece un botón que
  // va a fallar, y se dice qué hacer en vez de dejar un hueco.
  await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');
  // Mismo aviso que en los otros dos: `Vacio` escribe este texto como título, sin punto final.
  await expect(page.getByText('Estás mirando sin cuenta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prestar mi voto' })).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Prestar y recuperar el voto, DESDE EL NAVEGADOR
//
// Es el único formulario nuevo de esta entrega, así que es el único sitio donde el patrón de doble
// envío (`useAccionUnica`) se puede comprobar de verdad. Va aparte y al final porque necesita un
// padrón grande: el tope de concentración es una décima parte del censo, así que por debajo de
// veinte personas el préstamo de voto **no se puede ni encender**. Ese número no lo elegí yo: salió
// de intentar usar la pantalla.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test.describe('prestar el voto de verdad', () => {
  let vecinos: Cuenta[];

  test.beforeAll(async () => {
    vecinos = [];
    for (let i = 0; i < 20; i++) {
      vecinos.push(await entrarPorApi(`vecina.${String(i)}.${sufijo}@udea.edu.co`));
    }

    const api = await apiDirecta(vecinos[0]!);
    const problema = await api.post('/problemas', {
      data: {
        requestId: requestId(),
        titulo: `Comprar una greca para la sala ${sufijo}`,
        cuerpo:
          'No hay dónde calentar agua y la jornada nocturna se queda hasta tarde. Una greca ' +
          'compartida resolvería el problema sin depender de la cafetería.',
        circuloId: 'e5bac105b1e00000000000000000000b',
      },
    });
    expect(problema.status(), await problema.text()).toBe(201);

    const propuesta = await api.post('/propuestas', {
      data: {
        requestId: requestId(),
        problemaId: ((await problema.json()) as { id: string }).id,
        titulo: 'Comprar una greca compartida para la sala de estudio',
        cuerpo:
          'Comprar una greca con el fondo común y dejarla en la sala de estudio, con turnos de ' +
          'limpieza acordados entre quienes la usen.',
        plan: planDe(vecinos[0]!.miembroId),
      },
    });
    expect(propuesta.status(), await propuesta.text()).toBe(201);
    // El identificador se lee ANTES de cerrar el cliente: al cerrarlo, la respuesta se descarta y
    // `json()` deja de poder leerse.
    const propuestaId = ((await propuesta.json()) as { id: string }).id;
    await api.dispose();

    const apiLucia = await apiDirecta(lucia);
    const abierta = await apiLucia.post('/decisiones', {
      data: {
        requestId: requestId(),
        propuestaId,
        metodo: 'simple-majority',
        duracionHoras: 48,
        delegacion: true,
      },
    });
    expect(abierta.status(), await abierta.text()).toBe(201);
    await apiLucia.dispose();
  });

  test('se presta el voto desde la pantalla, y se recupera de un toque', async ({ page }) => {
    await ponerSesionEnNavegador(page, vecinos[1]!);
    await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');

    // La votación aparece con su título, no con un identificador.
    await expect(
      page.getByRole('heading', { name: 'Comprar una greca compartida para la sala de estudio' }),
    ).toBeVisible();

    // El desplegable se alcanza por su etiqueta: si no estuviera asociada, esto no lo encontraría.
    const aQuien = page.getByLabel('¿A quién le prestás tu voto?');
    await expect(aQuien).toBeVisible();
    // Cada prueba presta a una persona DISTINTA y elegida por su nombre. No es manía: el tope de
    // concentración es una décima parte del censo, así que con veintidós personas vale 2 —el voto
    // propio más uno— y **una sola** persona puede recibir un préstamo. Elegir «la primera de la
    // lista» hacía que la tercera prueba chocara contra el tope de la segunda.
    const elegida = `vecina.5.${sufijo}`;
    await aQuien.selectOption({ label: elegida });

    await page.getByRole('button', { name: 'Prestar mi voto' }).click();

    // El resultado se anuncia, no se deduce del cambio de la tarjeta.
    await expect(page.getByText(`Le prestaste tu voto a ${elegida}.`)).toBeVisible();
    await expect(page.getByText(`Le prestaste tu voto a ${elegida} el`)).toBeVisible();

    // Y se ve que la voz se movió: alguien carga ahora un voto ajeno.
    await expect(page.getByText('Personas que cargan votos ajenos')).toBeVisible();

    await revisar(page, '/delegaciones con un préstamo hecho');

    // Recuperarlo: un solo toque, sin diálogo de confirmación ni pasos.
    await page.getByRole('button', { name: 'Recuperar mi voto' }).click();
    await expect(
      page.getByText('Recuperaste tu voto. Desde este momento nadie lo lleva por vos.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recuperar mi voto' })).toHaveCount(0);
    await expect(page.getByLabel('¿A quién le prestás tu voto?')).toBeVisible();
  });

  test('el doble toque presta UNA sola vez, no dos', async ({ page }) => {
    await ponerSesionEnNavegador(page, vecinos[2]!);
    await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');
    await page
      .getByLabel('¿A quién le prestás tu voto?')
      .selectOption({ label: `vecina.6.${sufijo}` });

    // Los dos toques caen **en el mismo turno del navegador**, sin repintado entre medias: es el
    // pulgar impaciente en un teléfono que va lento, y es el peor caso. Un `disabled` gobernado por
    // estado de React no lo ataja, porque el estado se aplica en el render siguiente; la guarda de
    // `useAccionUnica` es síncrona y sí lo ataja. Con dos `click()` de Playwright no se probaría
    // esto: entre uno y otro hay repintado de sobra.
    const idas: string[] = [];
    page.on('request', (peticion) => {
      if (peticion.method() === 'POST' && peticion.url().includes('/delegaciones')) {
        idas.push(peticion.url());
      }
    });
    const pulsado = await page.evaluate(() => {
      const boton = Array.from(document.querySelectorAll('button')).find(
        (candidato) =>
          (candidato.textContent ?? '').includes('Prestar mi voto') && !candidato.disabled,
      );
      if (boton === undefined) return false;
      boton.click();
      boton.click();
      return true;
    });
    expect(pulsado, 'no se encontró el botón «Prestar mi voto»').toBe(true);
    // `.first()`: la frase aparece dos veces a propósito —en el aviso que se anuncia y en la
    // tarjeta que queda—, y las dos son correctas.
    await expect(page.getByText('Le prestaste tu voto a').first()).toBeVisible();

    // Una sola ida al servidor: el segundo toque se descartó antes de salir.
    expect(idas).toHaveLength(1);

    // Una sola delegación en pie: si hubieran entrado dos, la segunda habría desplazado a la
    // primera y el reparto contaría dos préstamos de la misma persona.
    const api = await apiDirecta(vecinos[2]!);
    try {
      const panel = await api.get('/delegaciones');
      const cuerpo = (await panel.json()) as {
        votaciones: { reparto: { prestaron: number } }[];
      };
      expect(cuerpo.votaciones[0]?.reparto.prestaron).toBe(1);
    } finally {
      await api.dispose();
    }
  });

  test('votar directo deshace el préstamo, y la pantalla lo dice', async ({ page }) => {
    await ponerSesionEnNavegador(page, vecinos[3]!);
    await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');
    await page
      .getByLabel('¿A quién le prestás tu voto?')
      .selectOption({ label: `vecina.7.${sufijo}` });
    await page.getByRole('button', { name: 'Prestar mi voto' }).click();
    await expect(page.getByText('Le prestaste tu voto a').first()).toBeVisible();

    // Ahora vota, pasando por la pantalla de la decisión.
    await page
      .getByRole('link', { name: 'Comprar una greca compartida para la sala de estudio' })
      .click();
    await page.getByRole('radio', { name: /^Sí/u }).check();
    await page.getByRole('button', { name: /respuesta/u }).click();
    await expect(page.getByText('Quedó registrado')).toBeVisible();

    await llegarPulsando(page, 'Prestar tu voto', 'Prestar tu voto');
    await expect(page.getByText('Ya votaste')).toBeVisible();
    await expect(
      page.getByText('votar ya lo deshizo: no hace falta que hagas nada más'),
    ).toBeVisible();
  });
});
