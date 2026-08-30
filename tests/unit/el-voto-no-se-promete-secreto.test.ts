import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Ninguna pantalla puede prometer que el voto es secreto, porque no lo es.
 *
 * ═══ Qué pasó ═══
 *
 * Dos pantallas le decían a quien acababa de votar que su respuesta no se repetía «por tu propio
 * secreto de voto». Es exactamente al revés de lo que hace el sistema, y no por un descuido de
 * implementación sino por diseño declarado:
 *
 *  - `service.ts` abre TODA decisión con `privacy: 'public-roll-call'` — a mano alzada.
 *  - `encBallot` (`services/api/src/decision/codec.ts`) escribe `voter` dentro del propio hecho
 *    registrado, junto a lo que se votó.
 *  - `exportarTodo` publica el contenido de todos los hechos en `GET /integridad/exportar`, que no
 *    pide sesión: se descarga con `curl`. Y la pantalla de comprobar invita a descargarlo, como
 *    debe ser — sin esa descarga no habría nada que comprobar por fuera.
 *
 * O sea que no es sólo que «quien administra el servidor podría verlo»: cualquiera que se baje la
 * copia puede leer quién votó qué. Que el identificador no sea un nombre no lo arregla: es el mismo
 * en todo lo que esa persona hace, y en un instituto pequeño atarlo a alguien es cuestión de
 * cruzarlo una vez.
 *
 * ═══ Por qué esto es una prueba y no un comentario ═══
 *
 * ADR-0010 («el MVP no implementa criptografía de urna», Aceptado) dice, en su propio texto, que lo
 * que el MVP no promete «queda escrito en la propia pantalla de votación, no escondido en un
 * README». ADR-0017 («Declaración de garantías obligatoria», Aceptado) lo vuelve una condición:
 * ninguna elección se abre sin la declaración visible, y exige decir que quien administra el
 * servidor podría ver quién votó qué.
 *
 * Las dos frases falsas convivieron meses con esos dos ADR Aceptados sin que nada se pusiera rojo,
 * y el documento de amenazas ya avisaba de por qué eso importa: «un descargo en pantalla no es un
 * control: es transferir el riesgo al usuario menos informado». Una promesa en pantalla es peor.
 *
 * Esto NO es la ADR-0017 completa: falta la pantalla entera antes del primer voto, el botón que
 * tarda cinco segundos en habilitarse, y sellar la declaración junto a la elección. Falta también
 * la separación de tablas y el recibo que ADR-0010 exige, que no existen. Lo que esta prueba
 * sostiene es lo mínimo: que la mentira no vuelva, y que el aviso esté donde se vota.
 *
 * Comprobado rompiéndolo: devolviendo la frase «por tu propio secreto de voto» al fichero de la
 * decisión falla el primer caso; borrando el aviso falla el segundo. Restaurado después.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PANTALLAS = join(RAIZ, 'apps', 'web');
const DECISION = join(PANTALLAS, 'app', 'decisiones', '[id]', 'page.tsx');

/** Todo `.tsx` de la interfaz, que es donde vive el texto que la gente lee. */
function pantallas(desde: string): readonly string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(desde, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name === '.next') continue;
    const ruta = join(desde, entrada.name);
    if (entrada.isDirectory()) salida.push(...pantallas(ruta));
    else if (entrada.name.endsWith('.tsx')) salida.push(ruta);
  }
  return salida;
}

describe('el voto no se promete secreto en ninguna pantalla', () => {
  it('ninguna pantalla invoca un secreto de voto que el sistema no sostiene', () => {
    /*
     * Se buscan las formas en que se prometería sin decir la palabra «secreto» sola, que aparece
     * legítimamente al explicar por qué el motor SE NIEGA a abrir en ese modo. Lo que no puede
     * aparecer es la promesa en primera persona: «tu secreto», «tu voto es secreto», «en secreto».
     */
    const promesas = [
      /secreto de(l)? voto/iu,
      /tu voto es secreto/iu,
      /vot(o|ás|as) en secreto/iu,
      /nadie puede ver (lo que|qué) vot/iu,
    ];

    const culpables: string[] = [];
    for (const ruta of pantallas(PANTALLAS)) {
      const texto = readFileSync(ruta, 'utf8');
      for (const promesa of promesas) {
        if (promesa.test(texto)) culpables.push(`${relative(RAIZ, ruta)} → ${promesa.source}`);
      }
    }
    expect(culpables).toEqual([]);
  });

  it('la pantalla donde se vota avisa, antes de la papeleta, de que se sabrá qué votaste', () => {
    const texto = readFileSync(DECISION, 'utf8');

    // El aviso existe y dice lo esencial: que no es secreto, y que cualquiera puede leerlo.
    expect(texto).toContain('tu voto no es secreto');
    expect(texto).toMatch(/a mano alzada/u);
    expect(texto).toMatch(/cualquiera que se descargue/u);

    // Y da la salida que ADR-0017 exige dar: que hay temas que todavía van en papel.
    expect(texto).toMatch(/en papel/u);

    /*
     * Va ANTES del formulario, no después. Se comprueba por posición en el fichero porque es lo
     * único que esta prueba puede ver —`apps/web` no tiene suite unitaria; ver la cabecera de
     * `tests/unit/metodos-en-pantalla.test.ts` para la razón, que es de compilación, no de pereza—.
     * Un aviso debajo de la papeleta lo lee quien ya votó, que es tarde.
     */
    const aviso = texto.indexOf('tu voto no es secreto');
    const formulario = texto.indexOf('void responder(e)');
    expect(aviso).toBeGreaterThan(-1);
    expect(formulario).toBeGreaterThan(-1);
    expect(aviso).toBeLessThan(formulario);
  });
});
