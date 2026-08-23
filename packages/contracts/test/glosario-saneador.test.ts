import { describe, expect, it } from 'vitest';

import { forbiddenTermsIn, normalizeForGlossary, sanearTextoTecnico } from '../src/glossary.js';

/**
 * `sanearTextoTecnico` es la última barrera antes de que un mensaje interno del motor —que nombra la
 * mecánica a propósito, porque está escrito para quien depura un fallo real— llegue a una pantalla
 * pública. Sólo se ve cuando falla una comprobación de integridad, que es raro; y lo que sólo se ve
 * cuando algo falla es justamente lo que nadie prueba.
 *
 * **Sobre la forma de los acentos en estas pruebas:** no se deja al azar del fichero. Un `'ó'` puede
 * guardarse precompuesto (U+00F3, una unidad) o descompuesto (`'o'` + U+0301, dos), las dos formas
 * se ven idénticas en pantalla, y de cuál sea depende por qué camino entra la función. Acá la forma
 * se fija con `.normalize()` dentro de la propia prueba. Una prueba que depende de cómo un editor
 * guardó un acento pasa hoy, se rompe sola el martes, y mientras tanto puede estar ejercitando el
 * camino equivocado sin que nadie se entere.
 */
describe('sanearTextoTecnico', () => {
  const FRASE = 'La comprobación del ledger falló en la posición 41.';

  it('deja el texto sin ninguna palabra prohibida', () => {
    const crudo = 'El ledger rechazó el evento: seq 41 no encadena con el hash previo.';
    expect(forbiddenTermsIn(crudo)).not.toHaveLength(0);
    expect(forbiddenTermsIn(sanearTextoTecnico(crudo))).toHaveLength(0);
  });

  it('atrapa el término aunque venga con acento, que es el caso que el filtro ingenuo pierde', () => {
    // «sociocrático» sólo contiene «sociocratico» después de quitarle la tilde. Un reemplazo hecho
    // sobre el texto crudo no lo vería, y la regla de oro quedaría decorativa.
    expect(forbiddenTermsIn(sanearTextoTecnico('regla sociocrática del círculo'))).toHaveLength(0);
    expect(forbiddenTermsIn(sanearTextoTecnico('material criptográfico ausente'))).toHaveLength(0);
  });

  it('con acentos precompuestos conserva mayúsculas y tildes', () => {
    const precompuesto = FRASE.normalize('NFC');
    expect(precompuesto).toHaveLength(normalizeForGlossary(precompuesto).length);

    const saneado = sanearTextoTecnico(precompuesto);
    expect(forbiddenTermsIn(saneado)).toHaveLength(0);
    expect(saneado).toBe('La comprobación del historial falló en la posición 41.'.normalize('NFC'));
  });

  it('con acentos descompuestos no corrompe el texto, aunque pierda forma', () => {
    // `'o'` + U+0301 en vez de `'ó'`: al quitarle la tilde ese texto ENCOGE, y la correspondencia de
    // índices en la que se apoya el camino rápido deja de valer. Antes de la protección el resultado
    // salía cortado por la mitad. Lo innegociable es esto: sin jerga y sin perder contenido.
    const descompuesto = FRASE.normalize('NFD');
    expect(descompuesto.length).toBeGreaterThan(normalizeForGlossary(descompuesto).length);

    const saneado = sanearTextoTecnico(descompuesto);
    expect(forbiddenTermsIn(saneado)).toHaveLength(0);
    expect(saneado).toBe('la comprobacion del historial fallo en la posicion 41.');
  });

  it('no toca un texto que ya está limpio', () => {
    const limpio = 'No se pudo comprobar el historial. Volvé a intentarlo en un momento.';
    expect(sanearTextoTecnico(limpio)).toBe(limpio);
  });
});
