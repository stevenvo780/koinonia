/**
 * El informe periódico que bloquea el avance de estado (PRODUCT.md §3): «Informe cada 15 días; sin
 * él la iniciativa no avanza de estado.»
 *
 * Lo que estas pruebas atacan, en orden de importancia:
 *
 *  1. que el primer plazo corra desde `activadaEn` y venza exactamente a los 15 días, en el borde
 *     inclusive — ni un milisegundo antes ni uno de más de tolerancia;
 *  2. que rendir un informe reinicie el reloj desde ESE informe, no desde la activación original, y
 *     que el más reciente gane sin importar el orden en que `informes` los traiga;
 *  3. que `assertPuedeAvanzarDeEstado` falle cerrado con el código estable exacto cuando está
 *     vencido, y no lance nada cuando no lo está;
 *  4. que `edadDelInformeVencidoMs` sea `undefined` mientras no está vencido y crezca linealmente
 *     con el tiempo después.
 */

import { describe, expect, it } from 'vitest';

import {
  assertPuedeAvanzarDeEstado,
  DIA_MS,
  edadDelInformeVencidoMs,
  type EstadoDeInformesDeIniciativa,
  informeVencido,
  INTERVALO_INFORME_DIAS,
  INTERVALO_INFORME_MS,
  proximoInformeVenceEn,
  puedeAvanzarDeEstado,
} from '../src/execution/informe-periodico.js';
import { instant } from '../src/ids.js';
import { PreconditionError } from '../src/errors.js';

const ACTIVADA = instant(1_000_000_000_000);

function estado(
  overrides: Partial<EstadoDeInformesDeIniciativa> = {},
): EstadoDeInformesDeIniciativa {
  return { activadaEn: ACTIVADA, informes: [], ...overrides };
}

describe('constantes', () => {
  it('quince días exactos, ni uno más ni uno menos (PRODUCT.md §3)', () => {
    expect(INTERVALO_INFORME_DIAS).toBe(15);
    expect(INTERVALO_INFORME_MS).toBe(15 * DIA_MS);
    expect(DIA_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('proximoInformeVenceEn / informeVencido — sin ningún informe rendido', () => {
  it('el primer plazo vence exactamente 15 días después de activadaEn', () => {
    expect(proximoInformeVenceEn(estado())).toBe(ACTIVADA + INTERVALO_INFORME_MS);
  });

  it('un milisegundo antes del plazo, no está vencido', () => {
    const ahora = instant(ACTIVADA + INTERVALO_INFORME_MS - 1);
    expect(informeVencido(estado(), ahora)).toBe(false);
  });

  it('exactamente en el plazo, ya está vencido (borde inclusive)', () => {
    const ahora = instant(ACTIVADA + INTERVALO_INFORME_MS);
    expect(informeVencido(estado(), ahora)).toBe(true);
  });

  it('mucho después del plazo, sigue vencido', () => {
    const ahora = instant(ACTIVADA + 10 * INTERVALO_INFORME_MS);
    expect(informeVencido(estado(), ahora)).toBe(true);
  });

  it('recién activada, no hay nada que informar todavía', () => {
    expect(informeVencido(estado(), ACTIVADA)).toBe(false);
  });
});

describe('proximoInformeVenceEn — con informes rendidos', () => {
  it('un informe rendido reinicia el reloj desde SU instante, no desde la activación', () => {
    const rendidoEn = instant(ACTIVADA + 3 * DIA_MS);
    const conInforme = estado({ informes: [{ rendidoEn }] });
    expect(proximoInformeVenceEn(conInforme)).toBe(rendidoEn + INTERVALO_INFORME_MS);
  });

  it('con varios informes, el más reciente es el que cuenta, sin importar el orden de la lista', () => {
    const primero = instant(ACTIVADA + 1 * DIA_MS);
    const masReciente = instant(ACTIVADA + 20 * DIA_MS);
    const intermedio = instant(ACTIVADA + 10 * DIA_MS);

    // Deliberadamente fuera de orden cronológico en el array.
    const conVarios = estado({
      informes: [{ rendidoEn: masReciente }, { rendidoEn: primero }, { rendidoEn: intermedio }],
    });
    expect(proximoInformeVenceEn(conVarios)).toBe(masReciente + INTERVALO_INFORME_MS);
  });

  it('rendir a tiempo evita el vencimiento que habría llegado sin ese informe', () => {
    const rendidoEn = instant(ACTIVADA + 10 * DIA_MS);
    const conInforme = estado({ informes: [{ rendidoEn }] });
    // Sin el informe, a los 15 días desde la activación ya estaría vencido.
    const ahoraQueHabriaVencidoSinInforme = instant(ACTIVADA + INTERVALO_INFORME_MS);
    expect(informeVencido(conInforme, ahoraQueHabriaVencidoSinInforme)).toBe(false);
    // Pero 15 días después de ESE informe, si no llega el siguiente, vuelve a vencer.
    expect(informeVencido(conInforme, instant(rendidoEn + INTERVALO_INFORME_MS))).toBe(true);
  });
});

describe('puedeAvanzarDeEstado / assertPuedeAvanzarDeEstado', () => {
  it('puedeAvanzarDeEstado es exactamente lo contrario de informeVencido', () => {
    const alVencer = instant(ACTIVADA + INTERVALO_INFORME_MS);
    expect(puedeAvanzarDeEstado(estado(), instant(alVencer - 1))).toBe(true);
    expect(puedeAvanzarDeEstado(estado(), alVencer)).toBe(false);
  });

  it('assertPuedeAvanzarDeEstado no lanza mientras el informe está al día', () => {
    expect(() => {
      assertPuedeAvanzarDeEstado(estado(), ACTIVADA);
    }).not.toThrow();
  });

  it('assertPuedeAvanzarDeEstado lanza PreconditionError con el código estable cuando está vencido', () => {
    const ahora = instant(ACTIVADA + INTERVALO_INFORME_MS);
    try {
      assertPuedeAvanzarDeEstado(estado(), ahora);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(PreconditionError);
      expect((error as PreconditionError).code).toBe('INFORME_PERIODICO_VENCIDO');
    }
  });

  it('el mensaje de rechazo nunca menciona a una persona (PRODUCT.md: atribuido al círculo)', () => {
    const ahora = instant(ACTIVADA + INTERVALO_INFORME_MS);
    try {
      assertPuedeAvanzarDeEstado(estado(), ahora);
    } catch (error) {
      const mensaje = (error as PreconditionError).message;
      expect(mensaje).not.toMatch(/responsable|persona|miembro/iu);
    }
  });
});

describe('edadDelInformeVencidoMs', () => {
  it('undefined mientras no está vencido', () => {
    expect(edadDelInformeVencidoMs(estado(), ACTIVADA)).toBeUndefined();
  });

  it('cero en el instante exacto del vencimiento', () => {
    const ahora = instant(ACTIVADA + INTERVALO_INFORME_MS);
    expect(edadDelInformeVencidoMs(estado(), ahora)).toBe(0);
  });

  it('crece linealmente con el tiempo después de vencer', () => {
    const ahora = instant(ACTIVADA + INTERVALO_INFORME_MS + 5 * DIA_MS);
    expect(edadDelInformeVencidoMs(estado(), ahora)).toBe(5 * DIA_MS);
  });
});

describe('validación de entrada', () => {
  it('rechaza un `ahora` que no es un Instant válido', () => {
    expect(() => informeVencido(estado(), -1 as never)).toThrow();
  });

  it('rechaza un `activadaEn` inválido dentro del estado', () => {
    expect(() => proximoInformeVenceEn(estado({ activadaEn: -1 as never }))).toThrow();
  });
});
