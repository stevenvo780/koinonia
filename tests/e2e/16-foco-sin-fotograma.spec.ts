/**
 * ESCENARIO 16 — El aviso de resultado llega aunque el navegador no repinte.
 *
 * Trece sitios de la interfaz mueven el foco después de una acción: al aviso de resultado, a la
 * tarjeta que acaba de cambiar de estado, al campo que hay que corregir. Ese salto **es** el aviso:
 * para quien usa un lector de pantalla, es lo que le dice que su acción terminó y cómo salió.
 *
 * Los trece se colgaban de `requestAnimationFrame`, que **no se ejecuta si no hay fotograma**: una
 * pestaña en segundo plano, una ventana tapada, un navegador con el repintado limitado no lo llaman
 * nunca — no tarde: nunca. Y entonces el foco no se movía, en silencio, sin error en ninguna parte.
 *
 * No es una hipótesis: se encontró midiendo. La prueba de aceptar una tarea fallaba en Firefox sólo
 * dentro de la corrida completa —aislada pasaba cinco de cinco—, con el elemento resuelto y sin
 * foco durante los diez segundos enteros. Diez segundos sobran para cualquier lentitud; lo que
 * pasaba es que el fotograma no llegaba.
 *
 * Este fichero apaga `requestAnimationFrame` a propósito —lo reemplaza por uno que **nunca** llama
 * a su función— y comprueba que el foco se mueve igual, por el camino de respaldo de
 * `apps/web/lib/foco.ts`. Es la única forma de probar ese camino: con el navegador repintando
 * normalmente gana siempre el fotograma, así que una prueba «normal» pasaría en verde con el
 * respaldo roto.
 *
 * Se prueba sobre `/entrar` porque es la única pantalla que ejercita los dos sentidos del mecanismo
 * sin necesitar cuenta: el foco tras un rechazo y el foco al volver al formulario.
 *
 * Comprobado rompiéndolo: poniéndole a los reintentos de `apps/web/lib/foco.ts` plazos
 * inalcanzables —`[600_000]` en vez de `[120, 360, 800]`; vaciar la lista del todo no sirve como
 * comprobación, porque deja la constante sin usar y lo que falla es la construcción, no la
 * prueba—, los dos casos se ponen en rojo con el foco quieto donde estaba. Restaurado.
 */

import { expect, test } from '@playwright/test';

/**
 * Deja `requestAnimationFrame` mudo antes de que cargue ni un guion de la aplicación.
 *
 * Devuelve un identificador para que `cancelAnimationFrame` siga siendo válido: se simula un
 * navegador que no repinta, no uno roto.
 */
const SIN_FOTOGRAMAS = `
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => undefined;
`;

/**
 * El elemento con el foco, descrito lo justo para que el fallo se lea sin abrir la traza.
 *
 * Función y no cadena: `page.evaluate` con una cadena la evalúa como **expresión**, así que una
 * flecha entre comillas devuelve la función y no su resultado — y la aserción compara contra
 * `undefined` sin que nada avise.
 */
function dondeEstaElFoco(): string {
  const activo = document.activeElement;
  if (activo === null) return 'ninguno';
  return `${activo.tagName.toLowerCase()}#${activo.id === '' ? '(sin id)' : activo.id}`;
}

test.describe('el foco se mueve aunque no llegue ningún fotograma', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('un correo rechazado devuelve el foco al campo que hay que corregir', async ({ page }) => {
    await page.addInitScript(SIN_FOTOGRAMAS);
    await page.goto('/entrar');
    // Que el apagado esté puesto de verdad: si `requestAnimationFrame` fuera el de siempre, el
    // camino de respaldo no se ejercitaría y esta prueba pasaría sin comprobar nada.
    expect(await page.evaluate(() => window.requestAnimationFrame(() => undefined))).toBe(1);

    // Una dirección que la API rechaza: sólo se admiten correos del Instituto. Hace falta el
    // rechazo porque el envío correcto no mueve el foco — muestra el panel de «revisá tu correo».
    await page.locator('#correo').fill('alguien@gmail.com');
    await page
      .getByRole('button', { name: /enlace/iu })
      .first()
      .click();

    await expect
      .poll(async () => page.evaluate(dondeEstaElFoco), { timeout: 15_000 })
      .toBe('input#correo');
  });

  test('volver al formulario después de pedir un enlace también devuelve el foco', async ({
    page,
  }) => {
    await page.addInitScript(SIN_FOTOGRAMAS);
    await page.goto('/entrar');

    await page.locator('#correo').fill('nadie.prueba.foco@udea.edu.co');
    await page
      .getByRole('button', { name: /enlace/iu })
      .first()
      .click();
    const volver = page.getByRole('button', { name: 'Escribir otro correo o pedir otro enlace' });
    await expect(volver).toBeVisible();
    await volver.click();

    await expect
      .poll(async () => page.evaluate(dondeEstaElFoco), { timeout: 15_000 })
      .toBe('input#correo');
  });
});
