/**
 * Los mensajes de error, sometidos a las dos reglas que ya existían escritas y que nadie comprobaba.
 *
 * Las dos se incumplían en el mismo fichero y por la misma razón: una regla que sólo vive en un
 * comentario se cumple mientras alguien se acuerda.
 *
 *  1. **La regla de oro** (ADR-0041, PRODUCT §7). `FORBIDDEN_UI_TERMS` prohíbe el vocabulario del
 *     motor en pantalla, y `MENSAJES` es texto de pantalla —lo lee quien acaba de que le rechacen
 *     algo—. Se había colado «un evento fuera de orden», que es precisamente el nombre interno de
 *     lo que se anota en el historial.
 *  2. **Un error dice qué hacer.** «No encontramos ese problema», «No encontramos eso», «Faltan
 *     datos o alguno no tiene la forma esperada»: las tres decían qué había fallado y ninguna decía
 *     qué hacer a continuación. WCAG 2.2 lo pide (3.3.3) y la doctrina del proyecto también: quien
 *     se topa con un rechazo mudo concluye que el sistema no es suyo.
 *
 * La segunda regla se comprueba por aproximación, y conviene decirlo: se exige que la frase se
 * dirija a la persona —imperativo voseante, «podés», «tenés», «hay que», «hace falta»—. No demuestra
 * que el consejo sea bueno; sí impide que vuelva a colarse un mensaje que sólo describe la avería.
 */

import { describe, expect, it } from 'vitest';

import { MENSAJES, mensajeDe } from '../src/errors.js';
import { forbiddenTermsIn } from '../src/glossary.js';

/**
 * Segunda persona del voseo, o una fórmula impersonal que igualmente indica el paso siguiente.
 *
 * El final de palabra va con un anticipo negativo y **no** con `\b`: en JavaScript `\b` se define
 * sobre caracteres ASCII, así que «volvé» seguido de un espacio no produce frontera —la «é» ya es
 * un carácter «no-palabra»— y todo imperativo voseante acentuado se escapaba del filtro. Es
 * exactamente el tipo de comprobación que pasa en verde sin comprobar nada.
 */
const FIN = '(?![a-záéíóúüñ])';
const DICE_QUE_HACER = new RegExp(
  `\\b(pod[eé]s|ten[eé]s|neces[ií]t[aá]s|hay que|hace falta|fijate|contalo|hacelo|dejal[oa]|` +
    `desmarc[aá]l[ao]|quital[ao]|divid[ií]l[ao]|abril[ao]|buscal[ao]|creal[ao]|elegil[ao]|` +
    `pedísel[ao]|mov[eé]s|and[aá]|volv[eé]|eleg[ií]|ped[ií]|mir[aá]|escrib[ií]|revis[aá]|abr[ií]|` +
    `complet[aá]|prob[aá]|quit[aá]|desmarc[aá]|cambi[aá]|esper[aá]|entr[aá]|sal[ií]|marc[aá]|` +
    `busc[aá]|conserv[aá]|repas[aá]|mand[aá]|trabaj[aá]|ratific[aá]|us[aá]|aport[aá]|` +
    `reanudal[ao]|reanud[aá]|part[ií])${FIN}`,
  'iu',
);

describe('los mensajes de error', () => {
  // Se acumulan y se enseñan todas juntas. Un `expect` dentro del bucle corta en la primera y
  // esconde las demás, que es como se arregla un fichero de mensajes de tres en tres.
  it('no usan ni una palabra del léxico prohibido', () => {
    const culpables = Object.entries(MENSAJES)
      .map(([codigo, mensaje]) => [codigo, forbiddenTermsIn(mensaje)] as const)
      .filter(([, terminos]) => terminos.length > 0)
      .map(([codigo, terminos]) => `${codigo}: ${terminos.join(', ')}`);
    expect(culpables, 'jerga prohibida en pantalla').toEqual([]);
  });

  it('dicen siempre el paso siguiente, no sólo lo que falló', () => {
    const mudos = Object.entries(MENSAJES)
      .filter(([, mensaje]) => !DICE_QUE_HACER.test(mensaje))
      .map(([codigo, mensaje]) => `${codigo}: «${mensaje}»`);
    expect(mudos, 'mensajes que no dicen qué hacer').toEqual([]);
  });

  it('hablan en español y terminan la frase', () => {
    for (const [codigo, mensaje] of Object.entries(MENSAJES)) {
      expect(mensaje.trim(), codigo).toBe(mensaje);
      expect(mensaje.length, `${codigo} es demasiado escueto`).toBeGreaterThan(30);
      expect(mensaje.endsWith('.'), `${codigo} no termina en punto`).toBe(true);
      // Un código filtrado a la pantalla es exactamente lo que este fichero existe para evitar.
      expect(mensaje, codigo).not.toMatch(/\b[A-Z]{3,}_[A-Z_]+\b/u);
    }
  });

  it('el respaldo para un código desconocido también dice qué hacer, y no filtra el código', () => {
    const frase = mensajeDe('UN_CODIGO_QUE_NO_EXISTE');
    expect(frase).not.toContain('UN_CODIGO_QUE_NO_EXISTE');
    expect(DICE_QUE_HACER.test(frase), `«${frase}»`).toBe(true);
    expect(forbiddenTermsIn(frase)).toEqual([]);
  });

  it('respeta el respaldo explícito cuando el código es desconocido', () => {
    expect(mensajeDe('OTRO_CODIGO_INEXISTENTE', 'Frase de respaldo.')).toBe('Frase de respaldo.');
  });
});
