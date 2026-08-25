import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { forbiddenTermsIn } from '@koinonia/contracts';

/**
 * El nombre de cada pantalla en la pestaña del navegador.
 *
 * ═══ Qué se protege ═══
 *
 * Hasta el 2026-08-25 el único `metadata` del árbol era el del layout raíz, así que `document.title`
 * devolvía la cadena «Koinonía» en las treinta y dos pantallas. Se midió contra producción, ruta por
 * ruta, y salieron dieciséis títulos idénticos. Eso rompe dos cosas:
 *
 *  · **Todos los días.** Quien tiene abierta una decisión, su resultado y la conversación que la
 *    originó —que es exactamente cómo se usa esto durante una asamblea— ve tres pestañas iguales.
 *    Lo mismo en el historial del navegador y en un marcador guardado.
 *  · **WCAG 2.4.2.** En una navegación del lado del cliente no hay recarga, así que el cambio de
 *    `document.title` es lo que le avisa a un lector de pantalla que la ruta cambió. Con un título
 *    constante, quien navega a ciegas pulsa un enlace y no recibe ninguna señal de haber llegado.
 *
 * ═══ Por qué la prueba lee ficheros en vez de importarlos ═══
 *
 * Por lo mismo que `tests/unit/metodos-en-pantalla.test.ts`: `apps/web` es un proyecto de Next con
 * `moduleResolution: Bundler` y sin `"type": "module"`, así que bajo el `NodeNext` de
 * `tsconfig.check.json` —el que compila `tests/**`— importar cualquier fichero suyo rompe
 * `pnpm run typecheck` del repositorio entero (TS1295/TS1287).
 *
 * Comprobado rompiéndolo, uno por uno: borrando `apps/web/app/historial/layout.tsx` falla el primer
 * caso nombrando esa ruta; poniéndole a `/propuestas/nueva` el mismo título que a `/propuestas`
 * falla el segundo; llamando a `/concentracion` «Prestar tu voto prestado» falla el tercero contra
 * «Prestar tu voto» de `/delegaciones`, que comparten los doce primeros caracteres; llamando
 * «La cadena de hash» a `/verificar` falla el cuarto; y quitándole el `metadata` a `not-found.tsx`
 * falla el quinto. Restaurado después de cada uno.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(RAIZ, 'apps', 'web', 'app');

/** El título del layout raíz, que es el que heredan las pantallas sin capa propia. */
const TITULO_RAIZ = 'Koinonía';

/** Cuántos caracteres de una pestaña se alcanzan a leer antes de que el navegador la recorte. */
const LARGO_VISIBLE = 12;

function ficherosLlamados(nombre: string, desde: string = APP): readonly string[] {
  const hallados: string[] = [];
  for (const entrada of readdirSync(desde)) {
    const camino = join(desde, entrada);
    if (statSync(camino).isDirectory()) hallados.push(...ficherosLlamados(nombre, camino));
    else if (entrada === nombre) hallados.push(camino);
  }
  return hallados;
}

/** `/decisiones/[id]/resultado` a partir del camino de su `page.tsx`. */
function rutaDe(pagina: string): string {
  const dentro = relative(APP, dirname(pagina));
  return dentro === '' ? '/' : `/${dentro.split(sep).join('/')}`;
}

/**
 * El título que le toca a una pantalla: el de la capa más cercana subiendo, igual que resuelve
 * Next.js. Sin capa propia en ningún ancestro, hereda el de la raíz.
 */
function tituloDeLaRuta(pagina: string): string {
  let directorio = dirname(pagina);
  while (directorio.startsWith(APP)) {
    const capa = join(directorio, 'layout.tsx');
    try {
      const declarado = /tituloDe\('(?<nombre>[^']+)'\)/u.exec(readFileSync(capa, 'utf8'));
      if (declarado?.groups?.['nombre'] !== undefined) return declarado.groups['nombre'];
    } catch {
      // Sin capa en este nivel: se sigue subiendo, que es lo que hace Next.js.
    }
    if (directorio === APP) break;
    directorio = dirname(directorio);
  }
  return TITULO_RAIZ;
}

describe('el título de la pestaña, pantalla por pantalla', () => {
  const paginas = ficherosLlamados('page.tsx');
  const nombrados = paginas.map((pagina) => ({
    ruta: rutaDe(pagina),
    titulo: tituloDeLaRuta(pagina),
  }));

  it('toda pantalla que no sea la portada declara un nombre propio', () => {
    expect(paginas.length).toBeGreaterThan(30);
    const heredadas = nombrados.filter(
      ({ ruta, titulo }) => ruta !== '/' && titulo === TITULO_RAIZ,
    );
    expect(heredadas.map(({ ruta }) => ruta)).toEqual([]);
  });

  it('no hay dos pantallas que se llamen igual', () => {
    const repetidos = nombrados
      .map(({ titulo }) => titulo)
      .filter((titulo, indice, todos) => todos.indexOf(titulo) !== indice);
    expect([...new Set(repetidos)]).toEqual([]);
  });

  it('se distinguen ya en lo que cabe en una pestaña, no sólo al final', () => {
    // Una pestaña se recorta cerca del carácter doce, así que dos títulos que sólo se separan al
    // final son distintos en el fichero e iguales para quien mira: «Prestar tu voto» y «Prestar tu
    // voto prestado» se leen los dos «Prestar tu v…». Lo que tiene que distinguir una pantalla de
    // otra es el principio del nombre, no el final.
    const prefijos = nombrados.map(({ ruta, titulo }) => ({
      ruta,
      prefijo: titulo.slice(0, LARGO_VISIBLE),
    }));
    const chocan = prefijos.filter(
      ({ prefijo }, indice) => prefijos.findIndex((otro) => otro.prefijo === prefijo) !== indice,
    );
    expect(chocan).toEqual([]);
  });

  it('ningún nombre usa una palabra prohibida en pantalla (ADR-0041)', () => {
    // Un título es texto visible como cualquier otro, y encima es el que aparece en el historial del
    // navegador, donde nadie va a volver a leerlo con contexto alrededor.
    const conJerga = nombrados
      .map(({ ruta, titulo }) => ({ ruta, terminos: forbiddenTermsIn(titulo) }))
      .filter(({ terminos }) => terminos.length > 0);
    expect(conJerga).toEqual([]);
  });

  it('la pantalla de «acá no hay nada» también tiene nombre, y está en español', () => {
    // Sin `not-found.tsx` propio, Next.js sirve el suyo: «404: This page could not be found.», en
    // inglés y sin cabecera ni salida. Era la única pantalla en inglés de toda la aplicación, y le
    // tocaba justo a quien llegó perdido.
    const perdida = readFileSync(join(APP, 'not-found.tsx'), 'utf8');
    expect(/tituloDe\('[^']+'\)/u.test(perdida)).toBe(true);
    // Sin los comentarios: este mismo fichero cita la frase en inglés de Next.js para explicar
    // por qué existe, y esa cita no es texto de pantalla.
    const visible = perdida.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    expect(visible).not.toMatch(/could not be found/iu);
    expect(visible).toMatch(/Acá no hay nada/u);
  });
});
