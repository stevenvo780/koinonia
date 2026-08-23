/**
 * ESCENARIO 2 — Versionado.
 *
 * V1 con plan → V2 → abrir sobre V2 → V3 cambiando sólo el plan → votar sobre la V2 congelada →
 * comprobar que la V1 sigue intacta e íntegra.
 *
 * «Intacta» acá quiere decir tres cosas comprobadas por separado, porque cada una puede fallar sola:
 *
 *  1. El **texto** de la V1 en pantalla es palabra por palabra el que era antes de la enmienda.
 *  2. Su **comprobante** no cambió: protege tanto el texto como el plan de ejecución.
 *  3. La pantalla de comprobación sigue en verde, es decir, la V1 **verifica** después de la V2.
 */

import { expect, test } from '@playwright/test';

import {
  apiDirecta,
  contenido,
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

const TEXTO_V1 =
  'Publicar un mapa de lecturas de primer y segundo semestre, hecho por quienes ya pasaron por ' +
  'esos cursos, con el orden sugerido y una nota de por qué cada texto va donde va.';
const TEXTO_V2 =
  'Publicar un mapa de lecturas de primer a cuarto semestre, hecho por quienes ya pasaron por ' +
  'esos cursos, con el orden sugerido, una nota de por qué cada texto va donde va, y una versión ' +
  'imprimible de una página para la cartelera.';

test.beforeAll(async () => {
  sara = await entrarPorApi(`sara.${sufijo}@udea.edu.co`);
  lucia = await entrarPorApi(CORREO_FACILITADORA);
});

test('la V1 sigue intacta e íntegra después de que existe la V2 y se vota sobre la V2', async ({
  page,
}) => {
  await ponerSesionEnNavegador(page, sara);

  const problemaId = await crearProblemaPorApi(sara, {
    titulo: `Los de primer semestre no sabemos qué leer ${sufijo}`,
    cuerpo:
      'Los PDF circulan por WhatsApp sin criterio y nadie sabe en qué orden leerlos ni por qué.',
  });

  // ── V1 ─────────────────────────────────────────────────────────────────────────────────────
  await page.goto(`/propuestas/nueva?problema=${problemaId}`);
  await page.getByLabel('¿Qué se propone, en una frase?').fill('Publicar un mapa de lecturas');
  await page.getByLabel('¿Qué se hace, concretamente?').fill(TEXTO_V1);
  await page
    .getByLabel('¿Qué debería cambiar si esto sale bien?')
    .fill('Quienes empiezan la carrera encuentran un recorrido de lectura claro y comprobable.');
  await page
    .getByLabel('¿Qué tendría que pasar para decir que funcionó?')
    .fill('El mapa queda publicado y al menos veinte estudiantes reportan haberlo consultado.');
  await page.getByLabel('¿Dónde lo comprobamos?').fill('Página publicada y registro de consultas');
  await page.getByRole('button', { name: 'Guardar la propuesta' }).click();

  await expect(page.getByRole('heading', { name: /^Versión 1/u })).toBeVisible();
  const propuestaId = page.url().split('/').pop() ?? '';

  // El desplegable del comprobante se abre pulsando el `<summary>`: `<summary>` no expone rol de
  // botón en el árbol de accesibilidad de Chromium, así que buscarlo por rol no lo encuentra.
  await page.locator('article.version').filter({ hasText: 'Versión 1' }).locator('summary').click();
  await expect(page.locator('code.comprobante').first()).toBeVisible();

  // El comprobante de la V1, ANTES de que exista la V2. Se lee con `textContent` y no con
  // `innerText` porque después de la enmienda el `<details>` puede estar cerrado —React conserva el
  // elemento— y `innerText` de algo oculto devuelve la cadena vacía, que compararía verde por
  // vacuidad. `textContent` lee el contenido esté abierto o cerrado.
  const comprobanteV1Antes = (
    (await page.locator('code.comprobante').first().textContent()) ?? ''
  ).trim();
  expect(comprobanteV1Antes).toMatch(/^[0-9a-f]{64}$/u);

  // ── V2 ─────────────────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Enmendar mi propuesta' }).click();
  await page.getByLabel('Texto de la propuesta').fill(TEXTO_V2);
  await page
    .getByLabel('¿Qué cambia y por qué?')
    .fill('Se amplía hasta cuarto semestre y se agrega una versión imprimible para la cartelera.');
  await page.getByRole('button', { name: 'Guardar la versión nueva' }).click();

  // ── 1. La V1 sigue con su texto, palabra por palabra ───────────────────────────────────────
  const bloqueV1 = page.locator('article.version').filter({ hasText: 'Versión 1' });
  await expect(bloqueV1).toBeVisible();
  await expect(bloqueV1).toContainText('anterior, y sigue acá entera');
  await expect(bloqueV1.locator('p.texto')).toHaveText(TEXTO_V1);

  const bloqueV2 = page.locator('article.version').filter({ hasText: 'Versión 2' });
  await expect(bloqueV2.locator('p.texto')).toHaveText(TEXTO_V2);

  // ── 2. Su comprobante NO cambió ────────────────────────────────────────────────────────────
  const comprobanteV1Despues = (
    (await bloqueV1.locator('code.comprobante').textContent()) ?? ''
  ).trim();
  expect(comprobanteV1Despues).toBe(comprobanteV1Antes);

  const comprobanteV2 = ((await bloqueV2.locator('code.comprobante').textContent()) ?? '').trim();
  expect(comprobanteV2).toMatch(/^[0-9a-f]{64}$/u);
  expect(comprobanteV2).not.toBe(comprobanteV1Antes);

  // ── 3. Se vota sobre la V2 ─────────────────────────────────────────────────────────────────
  const apiLucia = await apiDirecta(lucia);
  const abierta = await apiLucia.post('/decisiones', {
    data: { requestId: requestId(), propuestaId, metodo: 'simple-majority', duracionHoras: 2 },
  });
  expect(abierta.status(), await abierta.text()).toBe(201);
  const decision = (await abierta.json()) as { id: string; huellaVersion: string };
  await apiLucia.dispose();

  // La decisión se abre sobre la versión vigente, que es la V2.
  expect(decision.huellaVersion).toBe(comprobanteV2);

  // Cambiar únicamente el plan también crea una versión. La V2 ya congelada por la decisión no
  // cambia por eso: se sigue decidiendo el texto y el plan que estaban a la vista al abrir.
  await page.getByRole('button', { name: 'Enmendar mi propuesta' }).click();
  await page
    .getByLabel('¿Qué debería cambiar si esto sale bien?')
    .fill(
      'Quienes empiezan hasta cuarto semestre encuentran y usan un recorrido de lectura claro.',
    );
  await page
    .getByLabel('¿Qué cambia y por qué?')
    .fill('Sólo cambia el resultado observable del plan; el texto de la propuesta sigue intacto.');
  await page.getByRole('button', { name: 'Guardar la versión nueva' }).click();
  const bloqueV3 = page.locator('article.version').filter({ hasText: 'Versión 3' });
  await expect(bloqueV3.locator('p.texto')).toHaveText(TEXTO_V2);
  const comprobanteV3 = ((await bloqueV3.locator('code.comprobante').textContent()) ?? '').trim();
  expect(comprobanteV3).toMatch(/^[0-9a-f]{64}$/u);
  expect(comprobanteV3).not.toBe(comprobanteV2);

  const decisionCongelada = await apiDirecta(sara);
  const detalleCongelado = await decisionCongelada.get(`/decisiones/${decision.id}`);
  expect(((await detalleCongelado.json()) as { huellaVersion: string }).huellaVersion).toBe(
    comprobanteV2,
  );
  await decisionCongelada.dispose();

  await page.goto(`/decisiones/${decision.id}`);
  await page.getByRole('radio', { name: 'Sí', exact: true }).check();
  await page.getByRole('button', { name: 'Enviar mi respuesta' }).click();
  await expect(page.getByText('Quedó registrado')).toBeVisible();

  // ── 4. Una respuesta sobre la V1 se rechaza: se decide ESE texto y ESE plan ─────────────────
  const apiSara = await apiDirecta(sara);
  const vieja = await apiSara.post(`/decisiones/${decision.id}/papeletas`, {
    data: {
      requestId: requestId(),
      huellaVersion: comprobanteV1Antes,
      respuesta: { tipo: 'binary', aprueba: true },
    },
  });
  expect(vieja.status()).toBe(422);
  expect(await vieja.text()).toContain('BALLOT_STALE_PROPOSAL_VERSION');
  await apiSara.dispose();

  // ── 5. Y la V1 sigue VERIFICANDO ───────────────────────────────────────────────────────────
  //
  // El veredicto ya no dice «todas las comprobaciones pasaron»: el informe lo firma el mismo
  // servidor que guarda el historial, así que mientras nadie lo compruebe por fuera se queda en
  // «Sin confirmar». Lo que este escenario prueba no cambia —que la V1 conserva sus palabras
  // aunque exista una V2—, sólo cambia dónde lo dice la pantalla.
  await page.goto('/verificar');
  await expect(
    contenido(page).getByRole('status').filter({ hasText: 'Sin confirmar' }),
  ).toBeVisible();

  // La revisión punto por punto quedó **plegada**. Comprobar que el texto está en el DOM sin abrir
  // el desplegable sería comprobar el marcado, no la pantalla: primero se exige que esté oculto,
  // después se abre, y sólo entonces se lee.
  const conserva = page.getByText(
    'La versión 1 conserva sus palabras, responsable, fecha y criterios',
    { exact: false },
  );
  await expect(conserva).toBeHidden();
  await page.locator('summary', { hasText: 'Ver la revisión que hizo el servidor' }).click();
  await expect(conserva).toBeVisible();
});
