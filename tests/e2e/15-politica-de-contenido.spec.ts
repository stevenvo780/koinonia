/**
 * ESCENARIO 15 — La política de contenido, aplicada de verdad.
 *
 * Hasta el 2026-08-25 la política vivía en el proxy y en modo **de sólo informe**: no bloqueaba
 * nada. Una prueba de humo contra producción contó **nueve violaciones en cada carga** —guiones y
 * estilos en línea sin sellar—, todas registradas y ninguna impedida. Una política que se incumple
 * en cada visita no protege de nada, y encima no se podía pasar a obligatoria sin dejar la
 * aplicación en blanco.
 *
 * Ahora la pone `apps/web/middleware.ts` con un número de un solo uso por respuesta, y Next.js se lo
 * sella a todos sus guiones. Pero eso **sólo funciona si la pantalla se arma en esa misma
 * respuesta**: con una pantalla prehorneada en la construcción, el HTML servido no lleva número, la
 * cabecera sí, y el navegador bloquea todos los guiones — la aplicación queda muerta, con la cáscara
 * pintada y sin nada que responda. Se midió: `/problemas` forzada a armarse por visita traía el
 * mismo número que la cabecera; `/historial`, prehorneada, no traía ninguno.
 *
 * De ahí que este fichero exista y no un comentario. Lo que sostiene todo es una sola línea —
 * `export const dynamic = 'force-dynamic'` en `apps/web/app/layout.tsx`— y quitarla no rompe la
 * construcción, no rompe los tipos y no rompe ninguna otra prueba: rompe la aplicación en
 * producción, en silencio. Acá se comprueba mirando lo que llega al navegador.
 *
 * Comprobado rompiéndolo: quitando esa línea, el segundo caso falla nombrando las pantallas cuyos
 * guiones llegan sin sellar, y el tercero deja de hidratar. Restaurada.
 */

import { expect, test } from '@playwright/test';

/**
 * Una muestra ancha: portada, índices, formularios, la de comprobación y la de «no existe».
 *
 * No son las 32 porque cada una cuesta una carga completa con red en reposo, y el defecto que esto
 * protege es del layout raíz —o sea, común a todas—. Van las que difieren en forma: las que sólo
 * leen, las que traen formulario, la que dibuja medidores y la que no existe.
 */
const MUESTRA = [
  '/',
  '/problemas',
  '/decisiones',
  '/mis-tareas',
  '/delegaciones',
  '/normas',
  '/verificar',
  '/entrar',
  '/problemas/nuevo',
  '/ruta-que-no-existe',
] as const;

test.describe('la política de contenido', () => {
  // El desplegable de la navegación —la prueba de vida de más abajo— es el mando del teléfono, y en
  // escritorio el grupo va desplegado sin él. Se mide a 390 px, que además es donde este proyecto
  // decide todo lo demás.
  test.use({ viewport: { width: 390, height: 844 } });

  test('es obligatoria, no de sólo informe, y no admite guiones en línea ni evaluar texto', async ({
    page,
  }) => {
    const respuesta = await page.goto('/problemas');
    expect(respuesta).not.toBeNull();
    const cabeceras = respuesta === null ? {} : respuesta.headers();

    // Que exista la obligatoria es la mitad; la otra mitad es que no quede además la de sólo
    // informe, que diría cosas distintas sobre la misma página y llenaría la consola de ruido.
    const politica = cabeceras['content-security-policy'];
    expect(politica, 'no llegó la política obligatoria').toBeDefined();
    expect(cabeceras['content-security-policy-report-only']).toBeUndefined();

    const guiones = /script-src ([^;]+)/u.exec(politica ?? '')?.[1] ?? '';
    expect(guiones).toContain("'self'");
    expect(guiones).toMatch(/'nonce-[A-Za-z0-9+/=]+'/u);
    // Las dos palabras que volverían decorativa la política entera.
    expect(guiones).not.toContain('unsafe-inline');
    expect(guiones).not.toContain('unsafe-eval');
    // Y el resto del encuadre, que es lo que impide que la página cargue algo de otro sitio o
    // termine embebida dentro de una que no controlamos.
    expect(politica).toContain("default-src 'none'");
    expect(politica).toContain("frame-ancestors 'none'");
    expect(politica).toContain("object-src 'none'");
    expect(politica).toContain("base-uri 'none'");
  });

  test('el número de la cabecera es el que llevan los guiones de cada pantalla', async ({
    request,
  }) => {
    const sinSellar: string[] = [];
    for (const ruta of MUESTRA) {
      /*
       * Se pide por HTTP directo y no navegando con `page`, por dos motivos distintos y los dos
       * medidos:
       *
       *  · **`page.content()` no sirve.** Los navegadores esconden a propósito el valor del número
       *    una vez usado —si se pudiera leer del árbol, un selector de CSS lo filtraría y la
       *    protección no valdría nada—, así que desde el árbol siempre se ve vacío.
       *  · **`respuesta.text()` de una navegación tampoco.** En Chromium funciona; en Firefox
       *    revienta con `NS_ERROR_INVALID_CONTENT_ENCODING` al leer el cuerpo comprimido de un
       *    documento. Se descubrió en la matriz completa, después de haber dado esto por bueno
       *    mirando sólo Chromium.
       *
       * Acá no hace falta navegador: lo que se comprueba es qué manda el servidor, y la cabecera y
       * el cuerpo salen de la MISMA respuesta, que es justo lo que la comparación necesita.
       *
       * `accept-encoding: identity` de más: el cambio de arriba (navegación → `request.get`) redujo
       * el fallo pero no lo cerró — comprobado el 2026-08-25, la misma excepción reaparecía **con
       * `request.get` también**, en la misma ruta de Firefox al leer un cuerpo `gzip` +
       * `Transfer-Encoding: chunked` (confirmado con `curl` que la respuesta del servidor es
       * perfectamente válida: el defecto es de la descompresión de Firefox, no del servidor). Pedir
       * el cuerpo sin comprimir no cambia qué se compara —cabecera y cuerpo siguen viniendo de la
       * MISMA respuesta—, sólo evita la ruta de código de Firefox que revienta.
       */
      const respuesta = await request.get(ruta, { headers: { 'accept-encoding': 'identity' } });
      const politica = respuesta.headers()['content-security-policy'] ?? '';
      const deLaCabecera = /'nonce-([A-Za-z0-9+/=]+)'/u.exec(politica)?.[1];
      const servido = await respuesta.text();
      const delCuerpo = new Set([...servido.matchAll(/nonce="([^"]+)"/gu)].map((m) => m[1]));
      // Un solo número, y el mismo que anunció la cabecera. Si la pantalla vuelve a prehornearse
      // el conjunto queda vacío; si algo sellara con otro número, tendría más de uno.
      if (deLaCabecera === undefined || delCuerpo.size !== 1 || !delCuerpo.has(deLaCabecera)) {
        sinSellar.push(
          `${ruta} (cabecera=${String(deLaCabecera)} cuerpo=${[...delCuerpo].join('|')})`,
        );
      }
    }
    expect(sinSellar).toEqual([]);
  });

  test('ninguna pantalla incumple su propia política, y todas siguen vivas', async ({ page }) => {
    const incumplen: string[] = [];
    const rotas: string[] = [];
    page.on('console', (mensaje) => {
      if (/Content Security Policy/iu.test(mensaje.text())) {
        incumplen.push(`${page.url()} · ${mensaje.text().slice(0, 120)}`);
      }
    });
    page.on('pageerror', (error) => {
      rotas.push(`${page.url()} · ${String(error).slice(0, 120)}`);
    });

    const muertas: string[] = [];
    for (const ruta of MUESTRA) {
      await page.goto(ruta, { waitUntil: 'networkidle' });
      // La prueba de vida: el desplegable de la navegación es un componente de cliente. Si los
      // guiones estuvieran bloqueados, la cáscara se vería igual y el botón no haría nada — que es
      // exactamente la forma en que este fallo pasa desapercibido si sólo se mira una captura.
      const abridor = page.locator('button.abridor');
      const antes = await abridor.getAttribute('aria-expanded');
      await abridor.click();
      if ((await abridor.getAttribute('aria-expanded')) === antes) muertas.push(ruta);
    }

    expect(incumplen).toEqual([]);
    expect(rotas).toEqual([]);
    expect(muertas).toEqual([]);
  });
});
