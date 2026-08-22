/**
 * Métrica 3 — cobertura del padrón por estrato.
 *
 * Dos cosas se prueban aquí y las dos son jurídicas antes que técnicas: que el género no puede
 * entrar como eje (art. 5 de la Ley 1581, C11) y que una celda pequeña no se publica aunque §6
 * pida desagregar.
 */

import { toFractionString } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { EjeProhibidoError, informeDeCobertura, validarEstratos } from '../src/index.js';
import type { Estratos } from '../src/index.js';
import { acto, DIA, entradaCobertura, estratos, miembro, ORIGEN, VENTANA } from './datos.js';

/** `cuantos` miembros del mismo estrato, numerados desde `desde`. */
function grupo(desde: number, cuantos: number, e: Estratos) {
  const salida = [];
  for (let i = 0; i < cuantos; i += 1) salida.push(miembro(desde + i, e));
  return salida;
}

const DIURNA = estratos('3', 'diurna');
const NOCTURNA = estratos('3', 'nocturna');

describe('3 — el género no es eje (C11, art. 5 de la Ley 1581)', () => {
  it('un estrato con clave `genero` se rechaza con su propio mensaje', () => {
    const conGenero = { ...DIURNA, genero: 'f' } as unknown as Estratos;
    expect(() => {
      validarEstratos(conGenero);
    }).toThrow(EjeProhibidoError);
    expect(() => {
      validarEstratos(conGenero);
    }).toThrow(/dato sensible del art\. 5 de la Ley 1581/u);
  });

  it('la comprobación es sobre el OBJETO, no sobre el tipo: una proyección dinámica no lo esquiva', () => {
    // Así es como llega de verdad: `Object.fromEntries` de una consulta, con las columnas que
    // tenga la tabla. El tipo lo acepta y la validación no.
    const deLaBase = Object.fromEntries([
      ['semestre', '3'],
      ['jornada', 'diurna'],
      ['nivel', 'pregrado'],
      ['participacionPrevia', 'sí'],
      ['genero', 'no-binario'],
    ]) as unknown as Estratos;
    expect(() => informeDeCobertura(entradaCobertura([miembro(1, deLaBase)], []))).toThrow(
      EjeProhibidoError,
    );
  });

  it('cualquier otro eje de más también se rechaza, no sólo el género', () => {
    const conEdad = { ...DIURNA, edad: '22' } as unknown as Estratos;
    expect(() => {
      validarEstratos(conEdad);
    }).toThrow(/no es un eje de estratificación válido/u);
  });

  it('un eje que falta se rechaza', () => {
    const sinNivel = { semestre: '3', jornada: 'diurna', participacionPrevia: 'sí' };
    expect(() => {
      validarEstratos(sinNivel as unknown as Estratos);
    }).toThrow(/falta el eje/u);
  });
});

describe('3 — cobertura y k-anonimato', () => {
  it('un padrón vacío no publica nada', () => {
    const informe = informeDeCobertura(entradaCobertura([], []));
    expect(informe.global.publicado).toBe(false);
    expect(informe.porEje).toEqual([]);
    expect(informe.padron).toBe(0);
  });

  it('la cobertura global es exacta y conserva el par: 12 de 40, no 3 de 10', () => {
    const padron = grupo(0, 40, DIURNA);
    const actos = [];
    for (let i = 0; i < 12; i += 1) actos.push(acto(i, ORIGEN + DIA));
    const informe = informeDeCobertura(entradaCobertura(padron, actos));
    expect(informe.global.publicado).toBe(true);
    if (!informe.global.publicado) return;
    // Sin reducir: «12 de 40» y «120 de 400» son la misma proporción y no son la misma noticia.
    expect(toFractionString(informe.global.valor.cobertura)).toBe('12/40');
    expect(informe.global.valor.conAlMenosUnActo).toBe(12);
  });

  it('varios actos de la misma persona cuentan como una persona cubierta', () => {
    const padron = grupo(0, 20, DIURNA);
    const informe = informeDeCobertura(
      entradaCobertura(padron, [acto(0, ORIGEN + DIA), acto(0, ORIGEN + 2 * DIA)]),
    );
    expect(informe.global.publicado && informe.global.valor.conAlMenosUnActo).toBe(1);
  });

  it('un estrato de menos de 10 personas NO se publica, y se dice cuántas celdas se retuvieron', () => {
    // 30 diurnos y 4 nocturnos: el desglose por jornada delataría a los cuatro.
    const padron = [...grupo(0, 30, DIURNA), ...grupo(30, 4, NOCTURNA)];
    const informe = informeDeCobertura(entradaCobertura(padron, [acto(0, ORIGEN + DIA)]));
    const nocturna = informe.porEje.find((c) => c.eje === 'jornada' && c.valor === 'nocturna');
    const diurna = informe.porEje.find((c) => c.eje === 'jornada' && c.valor === 'diurna');
    expect(nocturna?.desglose.publicado).toBe(false);
    expect(diurna?.desglose.publicado).toBe(true);
    expect(informe.celdasNoPublicadas).toBeGreaterThan(0);
  });

  it('un estrato de entre 10 y 29 se publica con advertencia', () => {
    const padron = [...grupo(0, 30, DIURNA), ...grupo(30, 12, NOCTURNA)];
    const informe = informeDeCobertura(entradaCobertura(padron, []));
    const nocturna = informe.porEje.find((c) => c.eje === 'jornada' && c.valor === 'nocturna');
    expect(nocturna?.desglose.publicado).toBe(true);
    expect(nocturna?.desglose.publicado === true && nocturna.desglose.grupoPequeno).toBe(true);
  });

  it('un estrato vacío simplemente no aparece: no se inventan celdas', () => {
    const informe = informeDeCobertura(entradaCobertura(grupo(0, 20, DIURNA), []));
    expect(informe.porEje.some((c) => c.valor === 'nocturna')).toBe(false);
  });

  it('la brecha delata el «40 % global con la nocturna en el 8 %»', () => {
    const padron = [...grupo(0, 20, DIURNA), ...grupo(20, 20, NOCTURNA)];
    const actos = [];
    // 20 de 20 diurnos, 0 de 20 nocturnos ⇒ brecha = 1.
    for (let i = 0; i < 20; i += 1) actos.push(acto(i, ORIGEN + DIA));
    const informe = informeDeCobertura(entradaCobertura(padron, actos));
    expect(informe.brecha.hay).toBe(true);
    if (!informe.brecha.hay) return;
    expect(toFractionString(informe.brecha.valor)).toBe('1/1');
  });

  it('con una sola celda publicada por eje no hay brecha que medir', () => {
    const informe = informeDeCobertura(entradaCobertura(grupo(0, 20, DIURNA), []));
    expect(informe.brecha.hay).toBe(false);
  });

  it('el cruce semestre × jornada existe y también respeta el k-anonimato', () => {
    const padron = [
      ...grupo(0, 20, estratos('1', 'diurna')),
      ...grupo(20, 3, estratos('9', 'nocturna')),
    ];
    const informe = informeDeCobertura(entradaCobertura(padron, []));
    expect(informe.cruceSemestreJornada).toHaveLength(2);
    const pequena = informe.cruceSemestreJornada.find((c) => c.semestre === '9');
    expect(pequena?.desglose.publicado).toBe(false);
  });

  it('sólo cuentan los actos DENTRO de la ventana', () => {
    const padron = grupo(0, 20, DIURNA);
    const informe = informeDeCobertura(
      entradaCobertura(padron, [acto(0, VENTANA.desde - DIA), acto(1, VENTANA.hasta)]),
    );
    expect(informe.global.publicado && informe.global.valor.conAlMenosUnActo).toBe(0);
  });

  it('un padrón con la misma persona dos veces se rechaza', () => {
    expect(() =>
      informeDeCobertura(entradaCobertura([miembro(1, DIURNA), miembro(1, NOCTURNA)], [])),
    ).toThrow(/dos veces/u);
  });
});
