/**
 * ADR-0041 — nada de jerga en pantalla, comprobado término por término.
 *
 * «En el momento en que la pantalla dice “método de Schulze” o “índice HHI”, el mensaje que recibe
 * quien lee es *este no es tu terreno y no vas a poder verificar nada*.» Una guía de estilo se
 * cumple hasta la primera prisa; una lista negra ejecutable se rompe en el pipeline.
 */

import { describe, expect, it } from 'vitest';

import { comoPorcentaje, comoRazon, medidaEnPorcentaje, SIN_DATOS, TEXTOS } from '../src/index.js';

/**
 * La lista negra. Incluye la jerga del ADR-0041 y la que trae esta métrica en concreto: los índices
 * de dispersión y los cortes de la distribución, que son las palabras con las que un panel de salud
 * democrática se vuelve ilegible sin darse cuenta.
 */
const PROHIBIDOS = [
  'hhi',
  'herfindahl',
  'hirschman',
  'índice de concentración',
  'indice de concentración',
  'gini',
  'decil',
  'percentil',
  'cuartil',
  'mediana',
  'desviación',
  'varianza',
  'coeficiente',
  'normalizado',
  'normalizada',
  'k-anonimato',
  'anonimato',
  'logaritmo',
  'condorcet',
  'schulze',
  'beatpath',
  'balinski',
  'irv',
  'quórum',
  'supermayoría',
];

/**
 * La búsqueda es por PALABRA COMPLETA, no por subcadena.
 *
 * Buscar «irv» dentro de la cadena encontraba «servir» y «Sirve», y una lista negra que grita con
 * la prosa normal es una lista negra que alguien acaba desactivando entera —que es exactamente el
 * fallo que el propio ADR-0041 anticipa cuando avisa de que «la lista negra es literal: producirá
 * falsos positivos». Los límites se hacen con `\p{L}` y no con `\b`, porque `\b` no considera letra
 * a la «í» de «índice» y el límite se rompería justo en los términos acentuados.
 */
function comoPalabra(termino: string): RegExp {
  const escapado = termino.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapado}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Todas las cadenas de `TEXTOS`, invocando las que son funciones con un valor de muestra. */
function cadenasDeTextos(): readonly string[] {
  const salida: string[] = [];
  for (const valor of Object.values(TEXTOS)) {
    if (typeof valor === 'string') salida.push(valor);
    else salida.push(valor(3));
  }
  return salida;
}

describe('ADR-0041 — los textos de pantalla no llevan jerga', () => {
  it('ninguna cadena visible contiene un término de la lista negra', () => {
    const encontrados: string[] = [];
    for (const cadena of cadenasDeTextos()) {
      for (const termino of PROHIBIDOS) {
        if (comoPalabra(termino).test(cadena)) encontrados.push(`«${termino}» en: ${cadena}`);
      }
    }
    expect(encontrados).toEqual([]);
  });

  it('la lista negra funciona: si alguien mete jerga, salta', () => {
    // Sin esto, la prueba anterior pasaría también con una lista negra vacía o con una expresión
    // regular que no casa con nada, que es la forma habitual de que un control deje de controlar.
    expect(comoPalabra('hhi').test('El HHI de esta semana es 0,21.')).toBe(true);
    expect(comoPalabra('índice de concentración').test('Subió el Índice de Concentración.')).toBe(
      true,
    );
    expect(comoPalabra('decil').test('El decil más activo no cambió.')).toBe(true);
    // Y no salta con prosa normal que sólo contiene las letras.
    expect(comoPalabra('irv').test('decidir aquí no está sirviendo para nada')).toBe(false);
    expect(comoPalabra('gini').test('la página original')).toBe(false);
  });

  it('el rótulo de la segunda métrica es LITERALMENTE el de la tabla del ADR-0041', () => {
    // La tabla normativa dice: «Índice de concentración (HHI)» → «qué tan repartida está la voz».
    // Se escribe aquí palabra por palabra para que cambiarlo obligue a cambiar también el ADR.
    expect(TEXTOS.vozTitulo).toBe('Qué tan repartida está la voz');
  });

  it('el panel dice en castellano llano lo que NO mide, y por qué', () => {
    expect(TEXTOS.loQueNoSeMide).toMatch(/no se mide la actividad de cada persona/u);
    expect(TEXTOS.loQueNoSeMide).toMatch(/están prohibidos/u);
  });

  it('el desglose retenido se declara retenido y explica el motivo', () => {
    expect(TEXTOS.noSePublicaDescripcion).toMatch(/menos de 10 personas/u);
    expect(TEXTOS.noSePublicaDescripcion).toMatch(/deducir por descarte/u);
    expect(TEXTOS.grupoPequenoAdvertencia(12)).toMatch(/12 personas, menos de 30/u);
  });

  it('el plural de las celdas retenidas está bien, que es lo que mira quien lee', () => {
    expect(TEXTOS.celdasRetenidas(0)).toBe('Se publican todos los desgloses.');
    expect(TEXTOS.celdasRetenidas(1)).toMatch(/1 desglose no se publica/u);
    expect(TEXTOS.celdasRetenidas(4)).toMatch(/4 desgloses no se publican/u);
  });

  it('avisar de un bloqueo se explica como lo que es y no como una excusa', () => {
    expect(TEXTOS.acuerdosRelojDetenido).toMatch(/el plazo se detiene/u);
  });
});

describe('formato de cifras: exacto y truncado, nunca redondeado hacia arriba', () => {
  it('el porcentaje trunca hacia cero: 2/3 es 66,6 %, no 66,7 %', () => {
    expect(comoPorcentaje({ num: 2n, den: 3n })).toBe('66.6 %');
  });

  it('49,99 % no se convierte en 50 % y sugiere un mínimo que no se alcanzó', () => {
    expect(comoPorcentaje({ num: 4999n, den: 10_000n })).toBe('49.9 %');
  });

  it('una razón se muestra como razón, no como porcentaje: 3/1 es 3,0', () => {
    expect(comoRazon({ num: 3n, den: 1n })).toBe('3,0');
    expect(comoRazon({ num: 3n, den: 2n })).toBe('1,5');
  });

  it('una medida sin datos se dice, no se muestra como cero', () => {
    expect(medidaEnPorcentaje(SIN_DATOS)).toBe(TEXTOS.sinDatos);
    expect(medidaEnPorcentaje({ hay: true, valor: { num: 1n, den: 4n } })).toBe('25.0 %');
  });
});
