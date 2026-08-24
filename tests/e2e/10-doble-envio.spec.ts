/**
 * ESCENARIO 10 — Una intención de la persona, una sola escritura.
 *
 * ═══ Qué se prueba, y por qué se prueba así ═══
 *
 * El historial no se puede corregir, así que un envío repetido es un daño permanente. Ninguna de
 * las nueve pantallas que escriben tenía protección: el botón seguía activo durante el POST y —lo
 * más grave— **cada llamada estrenaba `requestId`**, de modo que dos llamadas eran, por definición,
 * dos comandos distintos y el servidor no podía reconocer la repetición.
 *
 * La primera versión de este fichero medía `seManifestaron` y el comprobante del resultado, y
 * **pasaba en verde con la protección desactivada a propósito**. Merece explicarse, porque el
 * hallazgo cambia lo que hay que comprobar:
 *
 *  · `seManifestaron` cuenta personas distintas. Dos papeletas de la misma persona no lo mueven
 *    —«vale la última»—, así que no distinguía nada.
 *  · Y el servidor **ya** se defiende por su cuenta: dos escrituras simultáneas sobre el mismo
 *    historial chocan en el control de concurrencia y la segunda se rechaza; el segundo cierre
 *    recibe «el resultado ya fue publicado». Medido: con la guarda quitada salen 2 POST y queda
 *    1 hecho escrito.
 *
 * O sea que el daño que evita el arreglo del cliente no es «dos hechos» en el caso simultáneo, sino
 * dos cosas concretas que sí se pueden comprobar y que sí distinguen:
 *
 *  1. **Sale una sola petición por intención.** Sin la guarda salen dos, y la segunda vuelve como
 *     error de conflicto: la persona ve «No se pudo» encima de una acción que en realidad funcionó.
 *  2. **Un reintento conserva la clave de idempotencia.** Es lo que protege el caso que el control
 *     de concurrencia no cubre —la respuesta que se perdió por el camino y se vuelve a mandar—, y
 *     es donde de verdad se escribiría dos veces.
 *
 * Las dos pulsaciones se hacen en el **mismo turno del navegador**, que es más duro que dos clics
 * de Playwright: entre una y otra no hay repintado, así que un `disabled` gobernado por estado de
 * React no llega nunca a tiempo. Ahí es donde vive el fallo.
 */

import { expect, type Page, test } from '@playwright/test';

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
  requestId,
} from './ayudas.js';
import { CORREO_FACILITADORA } from './global-setup.js';

test.describe.configure({ mode: 'serial' });

const sufijo = marca();
let sara: Cuenta;
let lucia: Cuenta;
let propuestaId: string;
let problemaId: string;

interface Papeletas {
  readonly seManifestaron: number;
  readonly miRespuesta?: string;
}

/**
 * Dos pulsaciones en el mismo turno del navegador, sin repintado entre medias.
 *
 * Es el doble toque de un pulgar impaciente en un teléfono que va lento, y es el peor caso: la
 * guarda que lo detiene tiene que ser síncrona, y por eso vive en un `ref` y no en el estado.
 */
async function pulsarDosVecesSeguidas(page: Page, etiqueta: string): Promise<void> {
  const pulsado = await page.evaluate((texto) => {
    const boton = Array.from(document.querySelectorAll('button')).find(
      (candidato) => (candidato.textContent ?? '').includes(texto) && !candidato.disabled,
    );
    if (boton === undefined) return false;
    boton.click();
    boton.click();
    return true;
  }, etiqueta);
  expect(pulsado, `no se encontró el botón «${etiqueta}»`).toBe(true);
}

/** Cuenta las peticiones de escritura que salen de la página hacia una ruta. */
function contarEnvios(page: Page, fragmentoRuta: string): { readonly claves: string[] } {
  const claves: string[] = [];
  page.on('request', (peticion) => {
    if (peticion.method() !== 'POST' || !peticion.url().includes(fragmentoRuta)) return;
    const cuerpo = peticion.postData() ?? '{}';
    claves.push((JSON.parse(cuerpo) as { requestId?: string }).requestId ?? '');
  });
  return { claves };
}

/** Hechos escritos en el historial. Lo que no se puede corregir después. */
async function hechosEscritos(): Promise<number> {
  const api = await apiAnonima();
  try {
    const respuesta = await api.get('/integridad');
    expect(respuesta.status(), await respuesta.text()).toBe(200);
    return ((await respuesta.json()) as { hechosRevisados: number }).hechosRevisados;
  } finally {
    await api.dispose();
  }
}

async function decisionAbierta(horas: number): Promise<{ id: string; huellaVersion: string }> {
  const api = await apiDirecta(lucia);
  try {
    const abierta = await api.post('/decisiones', {
      data: {
        requestId: requestId(),
        propuestaId,
        metodo: 'simple-majority',
        duracionHoras: horas,
      },
    });
    expect(abierta.status(), await abierta.text()).toBe(201);
    return (await abierta.json()) as { id: string; huellaVersion: string };
  } finally {
    await api.dispose();
  }
}

/** Una decisión aprobada y vencida, lista para cerrarse. */
async function decisionListaParaCerrar(): Promise<string> {
  const creada = await decisionAbierta(1);
  for (const cuenta of [sara, lucia]) {
    const cliente = await apiDirecta(cuenta);
    const papeleta = await cliente.post(`/decisiones/${creada.id}/papeletas`, {
      data: {
        requestId: requestId(),
        huellaVersion: creada.huellaVersion,
        respuesta: { tipo: 'binary', aprueba: true },
      },
    });
    expect(papeleta.status(), await papeleta.text()).toBe(201);
    await cliente.dispose();
  }
  await avanzarReloj(61 * 60 * 1000);
  // 61 minutos superan el corte por inactividad de la sesión (60 min): el reloj es del servicio
  // entero, así que todos los testigos obtenidos antes del salto quedan inválidos por
  // inactividad. `lucia` cierra la decisión justo después de esta ayuda, y `sara` vuelve a votar
  // si esta misma ayuda se llama una segunda vez (como en «dos toques… cerrar y publicar») — las
  // dos se renuevan acá.
  sara = await entrarPorApi(sara.correo);
  lucia = await entrarPorApi(CORREO_FACILITADORA);
  return creada.id;
}

test.beforeAll(async () => {
  sara = await entrarPorApi(`sara.doble.${sufijo}@udea.edu.co`);
  lucia = await entrarPorApi(CORREO_FACILITADORA);

  problemaId = await crearProblemaPorApi(sara, {
    titulo: `La sala cierra antes de que salgamos de clase ${sufijo}`,
    cuerpo:
      'Los de la nocturna llegamos a las seis menos veinte y la sala ya está cerrando, así que ' +
      'terminamos leyendo de pie en el pasillo.',
  });

  const api = await apiDirecta(sara);
  const propuesta = await api.post('/propuestas', {
    data: {
      requestId: requestId(),
      problemaId,
      titulo: 'Abrir la sala hasta las nueve tres días por semana',
      cuerpo:
        'Ampliar el horario de la sala de estudio hasta las nueve de la noche los martes, ' +
        'miércoles y jueves, con la persona de turno que ya cubre la franja anterior.',
      plan: planDe(sara.miembroId),
    },
  });
  expect(propuesta.status(), await propuesta.text()).toBe(201);
  propuestaId = ((await propuesta.json()) as { id: string }).id;
  await api.dispose();
});

test('dos toques seguidos en «enviar mi respuesta» mandan una sola papeleta', async ({ page }) => {
  const decision = await decisionAbierta(48);
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/decisiones/${decision.id}`);
  await page.waitForLoadState('networkidle');

  const envios = contarEnvios(page, '/papeletas');
  const hechosAntes = await hechosEscritos();

  await page.getByRole('radio', { name: 'Sí', exact: true }).check();
  await pulsarDosVecesSeguidas(page, 'Enviar mi respuesta');
  await expect(page.getByText('Quedó registrado')).toBeVisible();
  await page.waitForTimeout(500);

  // Una intención, una petición. Sin la guarda salen dos.
  expect(envios.claves, `salieron ${String(envios.claves.length)} peticiones`).toHaveLength(1);

  // Y ni un aviso de error: sin la guarda, la segunda petición choca con la primera en el control
  // de concurrencia y la persona ve «No se pudo» sobre una acción que sí funcionó.
  await expect(page.getByText('No se pudo')).toBeHidden();

  // Un solo hecho escrito, y sí se escribió: no estamos celebrando que no pasara nada.
  expect(await hechosEscritos()).toBe(hechosAntes + 1);
  const api = await apiDirecta(sara);
  const estado = (await (await api.get(`/decisiones/${decision.id}`)).json()) as Papeletas;
  await api.dispose();
  expect(estado.seManifestaron).toBe(1);
  expect(estado.miRespuesta).toBeDefined();
});

test('si la respuesta se pierde, el reintento lleva la misma clave y no escribe una segunda', async ({
  page,
}) => {
  // Éste es el caso que el control de concurrencia del servidor **no** cubre: la petición llegó y
  // se escribió, pero la respuesta se perdió por el camino. La persona vuelve a pulsar. Si el
  // cliente estrena clave —como hacía—, el servidor no tiene forma de saber que es la misma
  // intención y escribe la papeleta otra vez. La clave pertenece a la intención, no a la llamada.
  const decision = await decisionAbierta(48);
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/decisiones/${decision.id}`);
  await page.waitForLoadState('networkidle');

  const envios = contarEnvios(page, '/papeletas');
  let cortar = true;
  await page.route(`**/api/decisiones/${decision.id}/papeletas`, async (ruta) => {
    if (cortar) {
      cortar = false;
      // La escritura no llega a ocurrir, pero desde el navegador es indistinguible de una respuesta
      // perdida: es justo la situación en la que la persona vuelve a pulsar.
      await ruta.abort('connectionfailed');
      return;
    }
    await ruta.continue();
  });

  await page.getByRole('radio', { name: 'Sí', exact: true }).check();
  await page.getByRole('button', { name: /Enviar mi respuesta/u }).click();
  await expect(page.getByText('No se pudo')).toBeVisible();

  await page.getByRole('button', { name: /Enviar mi respuesta/u }).click();
  await expect(page.getByText('Quedó registrado')).toBeVisible();

  expect(envios.claves).toHaveLength(2);
  expect(envios.claves[0], 'la clave de la primera petición').not.toBe('');
  // **La misma clave.** Es lo único que le permite al servidor reconocer el reintento.
  expect(envios.claves[1]).toBe(envios.claves[0]);
});

test('cambiar de opinión sí escribe, y el doble toque sigue mandando una sola', async ({
  page,
}) => {
  const decision = await decisionAbierta(48);
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/decisiones/${decision.id}`);
  await page.waitForLoadState('networkidle');

  await page.getByRole('radio', { name: 'Sí', exact: true }).check();
  await page.getByRole('button', { name: /Enviar mi respuesta/u }).click();
  await expect(page.getByText('Quedó registrado')).toBeVisible();

  const envios = contarEnvios(page, '/papeletas');
  const hechosAntes = await hechosEscritos();

  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await pulsarDosVecesSeguidas(page, 'Cambiar mi respuesta');
  await expect(page.getByText('Quedó registrado')).toBeVisible();
  await page.waitForTimeout(500);

  expect(envios.claves).toHaveLength(1);
  // Cambiar de opinión escribe un hecho nuevo: la anterior no se borra, se sustituye. La guarda no
  // puede ser «una vez y ya»; tiene que ser «una vez por intención».
  expect(await hechosEscritos()).toBe(hechosAntes + 1);
});

test('dos toques seguidos en «cerrar y publicar» cierran la decisión una sola vez', async ({
  page,
}) => {
  // Cuánto cuesta **un** cierre, medido y no supuesto: se cierra una decisión gemela por API con
  // una sola llamada. Fijar una constante a mano convertiría esto en una prueba de la aritmética
  // del escrutinio, que cambia cuando cambia el escrutinio.
  const gemela = await decisionListaParaCerrar();
  const antesDeLaGemela = await hechosEscritos();
  const apiPatron = await apiDirecta(lucia);
  const cierreUnico = await apiPatron.post(`/decisiones/${gemela}/cerrar`, {
    data: { requestId: requestId() },
  });
  expect(cierreUnico.status(), await cierreUnico.text()).toBe(200);
  await apiPatron.dispose();
  const hechosDeUnCierre = (await hechosEscritos()) - antesDeLaGemela;
  expect(hechosDeUnCierre).toBeGreaterThan(0);

  const decisionParaCierre = await decisionListaParaCerrar();
  await ponerSesionEnNavegador(page, lucia);
  await page.goto(`/decisiones/${decisionParaCierre}`);
  await page.waitForLoadState('networkidle');

  const envios = contarEnvios(page, '/cerrar');
  const hechosAntes = await hechosEscritos();
  await pulsarDosVecesSeguidas(page, 'Cerrar y publicar el resultado');

  await page.waitForURL(`**/decisiones/${decisionParaCierre}/resultado`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // Una sola orden de cierre sale de la página, y el resultado se publica una sola vez.
  expect(envios.claves, `salieron ${String(envios.claves.length)} órdenes de cierre`).toHaveLength(
    1,
  );
  expect((await hechosEscritos()) - hechosAntes).toBe(hechosDeUnCierre);

  const api = await apiDirecta(lucia);
  const resultado = await api.get(`/decisiones/${decisionParaCierre}/resultado`);
  expect(resultado.status(), await resultado.text()).toBe(200);
  const cuerpo = (await resultado.json()) as { titulo: string; comprobante: string };
  await api.dispose();
  expect(cuerpo.comprobante).toMatch(/^[0-9a-f]{64}$/u);
  expect(cuerpo.titulo).toContain('Abrir la sala hasta las nueve');
});

test('aportar dos veces seguidas deja un aporte, no dos', async ({ page }) => {
  // Un aporte es texto libre: si se escribiera dos veces, quedarían dos entradas idénticas en un
  // historial que no se puede corregir, y con la fecha de cada una. Es el daño más visible de todos.
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/problemas/${problemaId}`);
  await page.waitForLoadState('networkidle');

  const envios = contarEnvios(page, '/evidencia');

  await page
    .getByLabel('¿Qué sabés?')
    .fill('El martes conté once personas esperando en el pasillo a las seis y cinco.');
  await pulsarDosVecesSeguidas(page, 'Aportar');
  await expect(page.getByText('El martes conté once personas')).toBeVisible();
  await page.waitForTimeout(500);

  expect(envios.claves).toHaveLength(1);
  await expect(page.getByText('No se pudo')).toBeHidden();

  const api = await apiDirecta(sara);
  const detalle = (await (await api.get(`/problemas/${problemaId}`)).json()) as {
    evidencias: readonly unknown[];
  };
  await api.dispose();
  expect(detalle.evidencias).toHaveLength(1);
});

test('el botón se bloquea mientras el envío está en vuelo', async ({ page }) => {
  // La otra mitad: además de no mandar dos veces, se ve que está pasando algo. Un botón que no
  // cambia invita al segundo toque, que es de donde salía todo.
  const decision = await decisionAbierta(48);
  await ponerSesionEnNavegador(page, sara);
  await page.goto(`/decisiones/${decision.id}`);
  await page.waitForLoadState('networkidle');

  let soltar = (): void => undefined;
  const retenida = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  await page.route(`**/api/decisiones/${decision.id}/papeletas`, async (ruta) => {
    await retenida;
    await ruta.continue();
  });

  await page.getByRole('radio', { name: 'Sí', exact: true }).check();
  await page.getByRole('button', { name: /Enviar mi respuesta/u }).click({ noWaitAfter: true });

  await expect(page.getByRole('button', { name: /Enviando…/u })).toBeDisabled();
  soltar();
  await expect(page.getByText('Quedó registrado')).toBeVisible();
});
