/**
 * ESCENARIO 9 — La regla de oro, comprobada sobre el código y no sobre la suerte.
 *
 * ═══ Por qué existe este fichero ═══
 *
 * En `/iniciativas/{id}` había escrito, a la vista, «El resumen no entra al ledger público».
 * «ledger» está en `FORBIDDEN_UI_TERMS` desde el primer día y había **dos** comprobaciones de jerga
 * corriendo. Ninguna lo vio, por dos motivos distintos y los dos instructivos:
 *
 *  1. `08-deliberacion` sí usa la lista ejecutable del contrato, pero sólo recorre
 *     `/deliberaciones`. `04-accesibilidad` sí recorre todas las pantallas, pero llevaba la lista
 *     **copiada a mano** y desactualizada. Ya está arreglado: las dos usan `forbiddenTermsIn`.
 *  2. Y sobre todo: **una pasada por el navegador comprueba el estado que alcanzó, no la pantalla.**
 *     Esa frase vive dentro del formulario de entrega, que sólo se dibuja para quien tiene esa tarea
 *     asignada y en curso. `04-accesibilidad` abría `/iniciativas/{id}` sin sesión, así que el texto
 *     no llegaba nunca al DOM. La pantalla «pasaba» porque la mitad de la pantalla no existía.
 *
 * Perseguir estados a mano es una carrera perdida: cada `&&` de un JSX es un estado más que alguien
 * tiene que acordarse de visitar. Así que la comprobación se hace **sobre el texto que la interfaz
 * puede llegar a escribir**, leyendo el código con el analizador de TypeScript. No depende de
 * alcanzar el estado, ni de tener sesión, ni de que exista el dato que lo dispara.
 *
 * No sustituye a la pasada por el navegador —que ve lo que el servidor manda y lo que se compone en
 * tiempo de ejecución—, la completa: una mira lo que se pudo alcanzar, la otra lo que se puede
 * escribir.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { forbiddenTermsIn } from '@koinonia/contracts';
import { expect, test } from '@playwright/test';
import ts from 'typescript';

const AQUI = dirname(fileURLToPath(import.meta.url));
const WEB = join(AQUI, '..', '..', 'apps', 'web');

/** Atributos cuyo valor lo lee una persona, aunque no se dibuje como texto. */
const ATRIBUTOS_VISIBLES = new Set([
  'aria-label',
  'aria-placeholder',
  'title',
  'alt',
  'placeholder',
]);

function ficherosDe(raiz: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name === '.next') continue;
    const ruta = join(raiz, entrada.name);
    if (entrada.isDirectory()) salida.push(...ficherosDe(ruta));
    else if (ruta.endsWith('.tsx') || ruta.endsWith('.ts')) salida.push(ruta);
  }
  return salida.sort();
}

/**
 * Una cadena que parece prosa y no código.
 *
 * Sin este filtro habría que revisar rutas, nombres de clase y códigos de error, que no son texto
 * de pantalla. Con él se cuelan igual los mensajes de confirmación —«La tarea volvió a estar en
 * curso.»—, que sí lo son y viven en literales sueltos, fuera de todo JSX.
 */
function pareceProsa(texto: string): boolean {
  return /\s/u.test(texto.trim()) && /[a-záéíóúñ]{3}/iu.test(texto);
}

interface Hallazgo {
  readonly fichero: string;
  readonly linea: number;
  readonly texto: string;
  readonly terminos: readonly string[];
}

function revisarFichero(ruta: string): Hallazgo[] {
  const fuente = ts.createSourceFile(
    ruta,
    readFileSync(ruta, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  const hallazgos: Hallazgo[] = [];

  const anotar = (nodo: ts.Node, texto: string): void => {
    if (!pareceProsa(texto)) return;
    const terminos = forbiddenTermsIn(texto);
    if (terminos.length === 0) return;
    hallazgos.push({
      fichero: relative(join(AQUI, '..', '..'), ruta),
      linea: fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1,
      texto: texto.trim().replace(/\s+/gu, ' ').slice(0, 120),
      terminos,
    });
  };

  const caminar = (nodo: ts.Node): void => {
    // El texto tal cual escrito entre etiquetas. Los comentarios `{/* … */}` no son `JsxText` y
    // por tanto no entran: un comentario para quien programa puede decir «ledger» sin problema.
    if (ts.isJsxText(nodo)) anotar(nodo, nodo.text);
    else if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) {
      anotar(nodo, nodo.text);
    } else if (ts.isTemplateExpression(nodo)) {
      // Sólo los trozos literales: lo interpolado es un dato, y el dato no es responsabilidad
      // de esta regla.
      anotar(nodo, [nodo.head.text, ...nodo.templateSpans.map((t) => t.literal.text)].join(' '));
    } else if (ts.isJsxAttribute(nodo)) {
      const nombre = nodo.name.getText(fuente);
      const valor = nodo.initializer;
      if (ATRIBUTOS_VISIBLES.has(nombre) && valor !== undefined && ts.isStringLiteral(valor)) {
        // Sin `pareceProsa`: un `aria-label` de una sola palabra también se lee.
        const terminos = forbiddenTermsIn(valor.text);
        if (terminos.length > 0) {
          hallazgos.push({
            fichero: relative(join(AQUI, '..', '..'), ruta),
            linea: fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1,
            texto: `${nombre}="${valor.text}"`,
            terminos,
          });
        }
      }
    }
    ts.forEachChild(nodo, caminar);
  };

  caminar(fuente);
  return hallazgos;
}

test('ninguna pantalla puede escribir jerga, la alcance alguien o no', () => {
  const ficheros = ficherosDe(WEB);
  expect(ficheros.length, 'no se encontró el código de la interfaz').toBeGreaterThan(10);

  const hallazgos = ficheros.flatMap(revisarFichero);
  const detalle = hallazgos
    .map((h) => `· ${h.fichero}:${String(h.linea)} → [${h.terminos.join(', ')}] «${h.texto}»`)
    .join('\n');
  expect(hallazgos, `Jerga prohibida en el texto de la interfaz:\n${detalle}`).toEqual([]);
});

test('el propio detector reconoce la frase que se le escapó', () => {
  // Una comprobación que nunca ha fallado no ha comprobado nada. Ésta es, literalmente, la frase
  // que estaba en pantalla y que las dos pasadas anteriores dieron por buena.
  expect(forbiddenTermsIn('El resumen no entra al ledger público.')).toEqual(['ledger']);
  expect(pareceProsa('El resumen no entra al ledger público.')).toBe(true);
  // Y no confunde código con prosa.
  expect(pareceProsa('/iniciativas')).toBe(false);
  expect(pareceProsa('STALE_TASK_OFFER')).toBe(false);
});
