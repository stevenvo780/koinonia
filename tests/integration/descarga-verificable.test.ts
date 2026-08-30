import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { directorySource, verificarExport, type TrustRoster } from '@koinonia/verificar';

import { apiEnv, listo, skipNote, type ApiListo } from './helpers/api-env.js';

/**
 * Lo que entrega el botón de descarga es lo que el verificador sabe leer.
 *
 * ═══ Qué se rompió, y por qué nada lo cazó ═══
 *
 * La pantalla de comprobar ofrecía «Descargar la copia del historial» apuntando a
 * `/integridad/exportar`, que devuelve un JSON llano con otro propósito —las pruebas de
 * `http-deliberacion` lo usan para comprobar que el historial público no filtra autoría—. El
 * verificador independiente no lee eso: lee el PAQUETE que produce `buildExport`, con su
 * `manifest.json` y su `events.ndjson`. Pasarle la descarga daba «no es un directorio».
 *
 * Cada mitad estaba probada y ninguna prueba cruzaba la frontera: `anclaje-y-export` verifica el
 * paquete en memoria, sin pasar por HTTP; las de HTTP comprueban el JSON, sin pasar por el
 * verificador. Entre las dos quedaba justo la pregunta que importa —«¿lo que se descarga la persona
 * sirve para lo que le decimos que sirve?»— y la respuesta era que no.
 *
 * Eso dejaba sin cumplir la frase que sostiene el proyecto entero y que va en el pie de las 34
 * pantallas: «por qué no hace falta creerle a quien tiene la máquina».
 *
 * ═══ Por qué esta prueba desempaqueta con el `tar` del sistema ═══
 *
 * Porque es lo que va a usar la persona. Desempaquetar con el mismo código que empaqueta no
 * responde nada: un error simétrico pasa desapercibido en los dos sentidos. Acá el camino es el
 * entero y el real — ruta HTTP, fichero en disco, `tar -xzf`, `directorySource`, `verificarExport`.
 *
 * ═══ Qué NO afirma esta prueba ═══
 *
 * No afirma que el veredicto salga limpio. Sale con hallazgos, y tiene que salir: este despliegue
 * no tiene testigos ni firmantes configurados, así que el anclaje no llega al quórum de dos clases
 * independientes. Eso es el verificador diciendo la verdad. Lo que se comprueba acá es que el
 * paquete se ABRE y se LEE: que la persona llega a tener un veredicto, en vez de un error de
 * formato que la deja sin poder comprobar nada.
 */

const env = await apiEnv();

const RAIZ = mkdtempSync(join(tmpdir(), 'koinonia-descarga-'));

afterAll(async () => {
  rmSync(RAIZ, { recursive: true, force: true });
  if (env.ok) await env.stop();
});

/** El mismo padrón vacío que sirve la aplicación cuando el despliegue no declara ninguno. */
const PADRON_VACIO: TrustRoster = {
  gitSigners: [],
  witnesses: [],
  minDistinctDomains: 2,
  forges: [],
  gitSigningKeyOffHost: false,
};

describe.skipIf(!env.ok)(
  `la descarga que se ofrece es la que el verificador lee${skipNote(env)}`,
  () => {
    let e: ApiListo;

    it('se descarga sin sesión, se abre con tar, y el verificador la entiende', async () => {
      e = listo(env);

      // ── 1. La descarga, tal cual la pide el navegador de cualquiera. Sin cabecera de sesión: si
      //       comprobar exigiera cuenta, quien administra decidiría quién puede auditarlo.
      const respuesta = await e.app.inject({ method: 'GET', url: '/integridad/paquete.tar.gz' });
      expect(respuesta.statusCode, respuesta.body.slice(0, 300)).toBe(200);
      expect(respuesta.headers['content-type']).toBe('application/gzip');
      expect(respuesta.headers['content-disposition']).toContain('historial-koinonia.tar.gz');
      // Sin caché: quien comprueba tiene que estar comprobando el historial de ahora.
      expect(respuesta.headers['cache-control']).toBe('no-store');

      // ── 2. A disco y al `tar` del sistema, que es lo que va a usar la persona.
      const tgz = join(RAIZ, 'historial-koinonia.tar.gz');
      writeFileSync(tgz, respuesta.rawPayload);
      const abierto = join(RAIZ, 'abierto');
      execFileSync('mkdir', ['-p', abierto]);
      execFileSync('tar', ['-xzf', tgz, '-C', abierto]);

      // ── 3. El verificador, por el mismo camino que el programa de consola: un directorio.
      const fuente = await directorySource(abierto);
      const ficheros = await fuente.list();
      expect(ficheros).toContain('manifest.json');
      expect(ficheros).toContain('events.ndjson');
      // La garantía de última instancia viaja dentro: si mañana no existe ni el programa ni esta
      // plataforma, quien tenga el paquete puede rehacer la comprobación leyendo ese fichero.
      expect(ficheros).toContain('README-VERIFICACION.txt');

      const resultado = await verificarExport({
        source: fuente,
        confianza: PADRON_VACIO,
        // El verificador no lee el reloj por su cuenta: el instante entra como dato, para que dos
        // corridas del mismo paquete den lo mismo.
        ahora: new Date(1_800_000_000_000).toISOString(),
      });

      /*
       * Lo que se exige: que haya VEREDICTO. Un fallo de formato no da pasos ni hallazgos, da una
       * excepción — que es exactamente lo que pasaba antes, y por lo que esta línea es la aserción
       * central de la prueba y no un detalle.
       */
      expect(resultado.pasos.length).toBeGreaterThan(0);

      /*
       * Y ninguno de los hallazgos puede ser sobre el paquete EN SÍ: que falte un fichero obligatorio
       * (`EXPORT_INCOMPLETO`), que no se entienda (`FORMATO_DESCONOCIDO`) o que un fichero no cuadre
       * con su huella del manifiesto (`FICHERO_ALTERADO`) significaría que lo que se descarga la
       * persona llega roto. Los hallazgos sobre el ANCLAJE sí pueden salir, y salen: este despliegue
       * no tiene testigos, así que no hay quórum. Ésos son el verificador diciendo la verdad.
       */
      const delPaquete = resultado.hallazgos.filter(
        (h) =>
          h.codigo === 'EXPORT_INCOMPLETO' ||
          h.codigo === 'FORMATO_DESCONOCIDO' ||
          h.codigo === 'FICHERO_ALTERADO',
      );
      expect(delPaquete, JSON.stringify(delPaquete)).toEqual([]);
    });

    it('el comando que la pantalla enseña apunta a esta descarga, no a otra', async () => {
      /*
       * El defecto original no fue del código sino de la costura: la ruta servía una cosa y la
       * pantalla anunciaba otra, y las dos estaban probadas por separado. Esto ata las dos puntas, que
       * es lo único que lo habría cazado.
       */
      const informe = await e.app.inject({ method: 'GET', url: '/integridad' });
      expect(informe.statusCode).toBe(200);

      const como = informe.json<{
        comoComprobarloVosMismo: { urlDeDescarga: string; comando: string };
      }>().comoComprobarloVosMismo;

      expect(como.urlDeDescarga).toBe('/integridad/paquete.tar.gz');

      // El comando tiene que nombrar el fichero que de verdad se descarga.
      expect(como.comando).toContain('historial-koinonia.tar.gz');

      // Y no puede volver a prometer un paquete de npm que no existe: `@koinonia/verificador` nunca
      // se publicó, y `@koinonia/verificar` —el nombre real— tampoco. Los dos daban 404.
      expect(como.comando).not.toMatch(/npx\s+@koinonia/u);
    });
  },
);
