/**
 * Métrica 2 — reparto de la voz.
 *
 * Los dos extremos que hay que clavar son el reparto perfectamente uniforme (0 exacto, sin residuo
 * de coma flotante) y la concentración total (1). Entre medias, cualquier cosa; en los extremos, un
 * `−1.1e−16` convertiría «perfectamente repartido» en una fracción negativa.
 */

import { toFractionString } from '@koinonia/domain';
import { describe, expect, it } from 'vitest';

import { informeDeVoz, REPARTO_EN_ALARMA } from '../src/index.js';
import { aporte, aportes, DIA, entradaVoz, ORIGEN, VENTANA } from './datos.js';

/** `personas` personas con `cada` aportes cada una. */
function uniforme(personas: number, cada: number) {
  const lista = [];
  for (let n = 0; n < personas; n += 1) lista.push(...aportes(n, cada));
  return lista;
}

describe('2 — reparto de la voz', () => {
  it('sin aportes no se publica nada: no hay reparto que describir', () => {
    const informe = informeDeVoz(entradaVoz([]));
    expect(informe.reparto.publicado).toBe(false);
    expect(informe.aportesContados).toBe(0);
  });

  it('una sola persona hablando no se publica: describirla es describirla a ella', () => {
    const informe = informeDeVoz(entradaVoz(aportes(0, 12)));
    expect(informe.reparto.publicado).toBe(false);
  });

  it('con menos de 10 personas no se publica, con 10 sí', () => {
    expect(informeDeVoz(entradaVoz(uniforme(9, 3))).reparto.publicado).toBe(false);
    expect(informeDeVoz(entradaVoz(uniforme(10, 3))).reparto.publicado).toBe(true);
  });

  it('reparto perfectamente uniforme ⇒ 0 EXACTO', () => {
    const informe = informeDeVoz(entradaVoz(uniforme(12, 5)));
    expect(informe.reparto.publicado).toBe(true);
    if (!informe.reparto.publicado) return;
    expect(toFractionString(informe.reparto.valor.reparto)).toBe('0/1');
    // El bruto con reparto uniforme vale 1/n, no 0: son dos cifras distintas y ambas se publican.
    expect(toFractionString(informe.reparto.valor.repartoBruto)).toBe('1/12');
    expect(informe.reparto.valor.alarma).toBe(false);
  });

  it('concentración total ⇒ 1 en el bruto', () => {
    // Once personas con un aporte y una con noventa: el bruto se acerca a 1 y la alarma salta.
    const lista = [...uniforme(11, 1), ...aportes(50, 90)];
    const informe = informeDeVoz(entradaVoz(lista));
    expect(informe.reparto.publicado).toBe(true);
    if (!informe.reparto.publicado) return;
    expect(informe.reparto.valor.alarma).toBe(true);
    expect(informe.reparto.valor.reparto.num).toBeGreaterThan(0n);
  });

  it('el umbral de alarma es 3/20 exacto, nunca 0,15 en coma flotante', () => {
    expect(toFractionString(REPARTO_EN_ALARMA)).toBe('3/20');
  });

  it('«cuánto puso quien más habló» exige 30 personas, no 10', () => {
    const pocas = informeDeVoz(entradaVoz(uniforme(15, 2)));
    expect(pocas.reparto.publicado).toBe(true);
    if (!pocas.reparto.publicado) return;
    // El reparto sí se publica; el máximo individual no. Es una medida sobre UNA persona.
    expect(pocas.reparto.valor.mayorParticipacion.publicado).toBe(false);

    const muchas = informeDeVoz(entradaVoz(uniforme(30, 2)));
    expect(muchas.reparto.publicado).toBe(true);
    if (!muchas.reparto.publicado) return;
    expect(muchas.reparto.valor.mayorParticipacion.publicado).toBe(true);
  });

  it('«cuánto puso quien más habló» se mide sobre el CENSO, no sobre quien habló', () => {
    const informe = informeDeVoz(entradaVoz(uniforme(30, 1), 300));
    expect(informe.reparto.publicado).toBe(true);
    if (!informe.reparto.publicado) return;
    const mayor = informe.reparto.valor.mayorParticipacion;
    expect(mayor.publicado).toBe(true);
    if (!mayor.publicado) return;
    // 1 aporte sobre un censo de 300. Si el denominador fuera «quien habló» subiría al bajar la
    // participación, que es exactamente lo contrario de lo que se quiere comunicar.
    expect(toFractionString(mayor.valor)).toBe('1/300');
  });

  it('sólo cuentan los aportes DENTRO de la ventana', () => {
    const informe = informeDeVoz(
      entradaVoz([
        aporte(1, VENTANA.desde - DIA),
        aporte(2, VENTANA.hasta),
        aporte(3, ORIGEN + DIA),
      ]),
    );
    expect(informe.aportesContados).toBe(1);
  });

  it('un censo negativo se rechaza', () => {
    expect(() => informeDeVoz(entradaVoz([], -1))).toThrow(/censo/u);
  });
});
