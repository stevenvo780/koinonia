import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import '../src/errors.js';
import { forbiddenTermsIn } from '../src/glossary.js';
import { emitirPapeleta, solicitarSupresion } from '../src/http.js';

/**
 * Lo que escribe la validación cuando rechaza algo, que es texto de pantalla como cualquier otro.
 *
 * ═══ Qué se protege ═══
 *
 * Una prueba contra producción pidió ocho rutas con datos mal formados y recibió, en el campo que
 * la pantalla muestra: «Unrecognized key: foo», «Invalid input: expected string, received
 * undefined», «Too small: expected string to have >=1 characters». Tres problemas a la vez: está
 * en inglés en una plataforma que sólo habla español; habla de tipos y de claves, que es la jerga
 * que ADR-0041 saca de la pantalla; y la primera **devuelve el dato que llegó**.
 *
 * El mapa que lo arregla vive en `errors.ts` y se aplica al importar el paquete. Esta prueba no
 * comprueba el mapa leyéndolo: ejercita esquemas de verdad del contrato, con datos mal formados de
 * verdad, y mira qué frase sale.
 *
 * ═══ Los dos casos que importan más ═══
 *
 *  · **Que un mensaje escrito a mano siga ganando.** Este repositorio tiene decenas de
 *    `.min(3, 'Escribí…')` en español y bien redactados. Un mapa global que los pisara sería peor
 *    que el problema que arregla.
 *  · **Que no se devuelva lo que llegó.** Nombrar la clave sobrante es reflejar entrada ajena en la
 *    respuesta, y además no le sirve a nadie: quien manda un dato de más no necesita leerlo de vuelta.
 *
 * Comprobado rompiéndolo: quitando el `z.config` de `errors.ts`, los cuatro primeros casos fallan
 * con el texto en inglés de la biblioteca. Restaurado.
 */
describe('lo que dice la validación cuando rechaza un dato', () => {
  /** Todas las frases que produce un esquema al rechazar. */
  function frasesDe(esquema: z.ZodType, dato: unknown): readonly string[] {
    const resultado = esquema.safeParse(dato);
    expect(resultado.success, 'el dato tenía que ser rechazado').toBe(false);
    return resultado.success ? [] : resultado.error.issues.map((problema) => problema.message);
  }

  it('un dato que falta se dice en español y sin nombrar tipos', () => {
    const frases = frasesDe(emitirPapeleta, {});
    expect(frases.length).toBeGreaterThan(0);
    for (const frase of frases) {
      expect(frase).not.toMatch(/[Ii]nvalid|expected|received|[Rr]equired/u);
    }
    expect(frases.join(' ')).toMatch(/Falta este dato/u);
  });

  it('un dato de más NO devuelve el nombre de lo que llegó', () => {
    // `solicitarSupresion` y no `emitirPapeleta`: ésta es de las 53 que sí son estrictas, y una
    // clave de más sólo se rechaza donde el esquema la rechaza.
    const frases = frasesDe(solicitarSupresion, {
      requestId: '00000000-0000-4000-8000-000000000001',
      baseLegal: 'consentimiento-retirado',
      confirmacionIrreversible: true,
      colateral: 'algo que nadie pidió',
    });
    expect(frases.join(' ')).not.toMatch(/colateral|Unrecognized/u);
    expect(frases.join(' ')).toMatch(/dato que esta operación no espera/u);
  });

  it('un texto demasiado corto dice cuánto falta, con el número de verdad', () => {
    expect(frasesDe(z.string().min(8), 'corto')).toEqual(['Escribí al menos 8 caracteres.']);
    expect(frasesDe(z.string().min(1), '')).toEqual(['Esto no puede quedar vacío.']);
    expect(frasesDe(z.array(z.string()).min(2), ['uno'])).toEqual(['Elegí al menos 2.']);
  });

  it('un texto demasiado largo también', () => {
    expect(frasesDe(z.string().max(5), 'demasiado largo')).toEqual([
      'No entran más de 5 caracteres.',
    ]);
  });

  it('un mensaje escrito a mano gana sobre el mapa', () => {
    // Es la mitad que importa: hay decenas de estos en el repositorio y son mejores que cualquier
    // frase genérica, porque saben de qué campo hablan.
    const propio = z.string().min(3, 'Escribí al menos tres letras del nombre de tu grupo.');
    expect(frasesDe(propio, 'a')).toEqual(['Escribí al menos tres letras del nombre de tu grupo.']);
  });

  it('ninguna frase de las que produce el mapa usa una palabra prohibida (ADR-0041)', () => {
    const muestras: readonly (readonly [z.ZodType, unknown])[] = [
      [z.string(), 5],
      [z.string(), undefined],
      [z.number(), 'ocho'],
      [z.boolean(), 'quizá'],
      [z.array(z.string()), 'no es lista'],
      [z.object({ a: z.string() }).strict(), { a: 'x', sobra: 1 }],
      [z.string().min(4), 'ab'],
      [z.string().max(2), 'largo'],
      [z.enum(['uno', 'dos']), 'tres'],
      [z.email(), 'no-es-correo'],
      [z.union([z.string(), z.number()]), true],
      [z.number().multipleOf(5), 7],
    ];
    const conJerga = muestras
      .flatMap(([esquema, dato]) => frasesDe(esquema, dato))
      .map((frase) => ({ frase, terminos: forbiddenTermsIn(frase) }))
      .filter(({ terminos }) => terminos.length > 0);
    expect(conJerga).toEqual([]);
  });

  it('y ninguna deja escapar el inglés de la biblioteca', () => {
    const muestras: readonly (readonly [z.ZodType, unknown])[] = [
      [z.string(), 5],
      [z.number(), 'ocho'],
      [z.object({ a: z.string() }).strict(), { a: 'x', sobra: 1 }],
      [z.string().min(4), 'ab'],
      [z.enum(['uno', 'dos']), 'tres'],
      [z.union([z.string(), z.number()]), true],
    ];
    for (const [esquema, dato] of muestras) {
      for (const frase of frasesDe(esquema, dato)) {
        expect(frase).not.toMatch(/Invalid|Unrecognized|Too small|Too big|expected|received/u);
      }
    }
  });
});
