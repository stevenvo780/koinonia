/**
 * Propiedades de las cinco métricas. Semilla fija `30_000_821`, la misma que el dominio: un
 * contraejemplo encontrado hoy se reproduce mañana, en otra máquina y en CI.
 *
 * Tres familias, en orden de importancia política:
 *
 *  1. **Ninguna salida contiene un identificador de persona.** Es la que sostiene el ADR-0040 y la
 *     que tiene que ser difícil de romper por descuido. Se comprueba con un recorrido escrito en la
 *     prueba, **independiente** del que usa el código: si ambas partes usaran la misma función, lo
 *     único demostrado sería que el guardián se llama a sí mismo.
 *  2. **Permutar la entrada no cambia nada.** Un informe que dependa del orden en que la base
 *     devolvió las filas no es un informe, es un rumor. Y es el fallo que ningún test de ejemplo
 *     encuentra, porque el ejemplo siempre llega ordenado.
 *  3. **Los índices están en su rango.** `0 ≤ reparto ≤ 1`, toda proporción en `[0, 1]`, la razón
 *     no negativa.
 */

import { cmpFraction, ONE, ZERO, type Fraction } from '@koinonia/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  informeDeAcuerdos,
  informeDeCobertura,
  informeDeDeliberacion,
  informeDeRotacion,
  informeDeSalud,
  informeDeVoz,
} from '../../src/index.js';
import type { EntradaSalud, InformeSalud, Medida } from '../../src/index.js';
import { arbEntradaSalud, barajar, cadenasDe, FC, identidadesDe } from '../datos.js';

function enRango(f: Fraction, minimo: Fraction = ZERO, maximo: Fraction = ONE): boolean {
  return cmpFraction(f, minimo) >= 0 && cmpFraction(f, maximo) <= 0;
}

function esProporcion(m: Medida): boolean {
  return !m.hay || enRango(m.valor);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1 — Ninguna salida nombra a nadie (ADR-0040)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-METRICS-1 — ninguna salida contiene un identificador de miembro', () => {
  it('el panel completo, sobre cualquier proyección', () => {
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        const informe = informeDeSalud(entrada);
        const identidades = new Set(identidadesDe(entrada));
        for (const cadena of cadenasDe(informe)) {
          for (const identidad of identidades) {
            expect(cadena.includes(identidad)).toBe(false);
          }
        }
      }),
      FC,
    );
  });

  it('y cada métrica por separado, por si alguna se usa sin pasar por el panel', () => {
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        const identidades = new Set(identidadesDe(entrada));
        const salidas: unknown[] = [
          informeDeAcuerdos(entrada.acuerdos),
          informeDeVoz(entrada.voz),
          informeDeCobertura(entrada.cobertura),
          informeDeRotacion(entrada.rotacion),
          informeDeDeliberacion(entrada.deliberacion),
        ];
        for (const salida of salidas) {
          for (const cadena of cadenasDe(salida)) {
            for (const identidad of identidades) {
              expect(cadena.includes(identidad)).toBe(false);
            }
          }
        }
      }),
      FC,
    );
  });

  it('ninguna salida lleva un arreglo tan largo como el padrón: no hay listas de gente', () => {
    // Un desglose tiene tantas celdas como valores de estrato —una decena—, jamás tantas como
    // personas. Un arreglo del tamaño del padrón sería, casi con certeza, una lista de personas
    // con los nombres cambiados por otra cosa.
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        const personas = new Set(identidadesDe(entrada)).size;
        if (personas < 20) return;
        const largos: number[] = [];
        const medir = (valor: unknown): void => {
          if (Array.isArray(valor)) {
            largos.push((valor as readonly unknown[]).length);
            for (const e of valor as readonly unknown[]) medir(e);
            return;
          }
          if (valor === null || typeof valor !== 'object') return;
          for (const v of Object.values(valor as Record<string, unknown>)) medir(v);
        };
        medir(informeDeSalud(entrada));
        for (const largo of largos) expect(largo).toBeLessThan(personas);
      }),
      FC,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2 — Permutar la entrada no cambia ninguna métrica
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function permutar(entrada: EntradaSalud, semilla: number): EntradaSalud {
  return {
    acuerdos: { ...entrada.acuerdos, acuerdos: barajar(entrada.acuerdos.acuerdos, semilla) },
    voz: { ...entrada.voz, aportes: barajar(entrada.voz.aportes, semilla + 1) },
    cobertura: {
      ...entrada.cobertura,
      padron: barajar(entrada.cobertura.padron, semilla + 2),
      actos: barajar(entrada.cobertura.actos, semilla + 3),
    },
    rotacion: {
      ...entrada.rotacion,
      aportesAnteriores: barajar(entrada.rotacion.aportesAnteriores, semilla + 4),
      aportesActuales: barajar(entrada.rotacion.aportesActuales, semilla + 5),
    },
    deliberacion: {
      ...entrada.deliberacion,
      deliberaciones: barajar(entrada.deliberacion.deliberaciones, semilla + 6),
      votaciones: barajar(entrada.deliberacion.votaciones, semilla + 7),
    },
  };
}

describe('INV-METRICS-2 — el orden de la entrada no cambia ninguna métrica', () => {
  it('el informe completo es idéntico tras barajar todas las listas', () => {
    fc.assert(
      fc.property(arbEntradaSalud, fc.integer({ min: 1, max: 1_000_000 }), (entrada, semilla) => {
        const original: InformeSalud = informeDeSalud(entrada);
        const barajado: InformeSalud = informeDeSalud(permutar(entrada, semilla));
        expect(barajado).toStrictEqual(original);
      }),
      FC,
    );
  });

  it('y es idéntico a sí mismo: la misma entrada da el mismo informe dos veces', () => {
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        expect(informeDeSalud(entrada)).toStrictEqual(informeDeSalud(entrada));
      }),
      FC,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3 — Rangos
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('INV-METRICS-3 — los índices están siempre en su rango', () => {
  it('el reparto de la voz está en [0, 1], normalizado y bruto', () => {
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        const { reparto } = informeDeVoz(entrada.voz);
        if (!reparto.publicado) return;
        expect(enRango(reparto.valor.reparto)).toBe(true);
        expect(enRango(reparto.valor.repartoBruto)).toBe(true);
        // El bruto nunca baja de `1/n`: con `n` personas hablando, el reparto perfecto es `1/n`.
        expect(
          cmpFraction(reparto.valor.repartoBruto, {
            num: 1n,
            den: BigInt(reparto.valor.personasQueHablaron),
          }) >= 0,
        ).toBe(true);
        if (reparto.valor.mayorParticipacion.publicado) {
          expect(cmpFraction(reparto.valor.mayorParticipacion.valor, ZERO) >= 0).toBe(true);
        }
      }),
      FC,
    );
  });

  it('cumplimiento, cobertura, rotación y unanimidad son proporciones de [0, 1]', () => {
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        const acuerdos = informeDeAcuerdos(entrada.acuerdos);
        expect(esProporcion(acuerdos.total.cumplimiento)).toBe(true);
        for (const circulo of acuerdos.porCirculo) {
          if (circulo.desglose.publicado) {
            expect(esProporcion(circulo.desglose.valor.cumplimiento)).toBe(true);
          }
        }
        for (const tipo of acuerdos.porTipo) {
          expect(esProporcion(tipo.cuenta.cumplimiento)).toBe(true);
        }

        const cobertura = informeDeCobertura(entrada.cobertura);
        if (cobertura.global.publicado)
          expect(enRango(cobertura.global.valor.cobertura)).toBe(true);
        for (const celda of cobertura.porEje) {
          if (celda.desglose.publicado) expect(enRango(celda.desglose.valor.cobertura)).toBe(true);
        }
        expect(esProporcion(cobertura.brecha)).toBe(true);

        const rotacion = informeDeRotacion(entrada.rotacion);
        if (rotacion.cambio.publicado) {
          expect(enRango(rotacion.cambio.valor.rotacion)).toBe(true);
          expect(enRango(rotacion.cambio.valor.proporcionDePersonasNuevas)).toBe(true);
        }

        const deliberacion = informeDeDeliberacion(entrada.deliberacion);
        expect(esProporcion(deliberacion.unanimidad)).toBe(true);
        // La razón NO es una proporción: puede pasar de 1 y debe poder.
        if (deliberacion.razon.hay) {
          expect(cmpFraction(deliberacion.razon.valor, ZERO) >= 0).toBe(true);
        }
      }),
      FC,
    );
  });

  it('las cuentas cuadran: cumplidos + deuda + bloqueados + prescritos + en curso = el total', () => {
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        const { total } = informeDeAcuerdos(entrada.acuerdos);
        expect(
          total.cumplidos + total.deuda + total.conRelojDetenido + total.prescritos + total.enCurso,
        ).toBe(total.vencianEnLaVentana);
        expect(total.cumplidosTarde).toBeLessThanOrEqual(total.cumplidos);
      }),
      FC,
    );
  });

  it('un desglose retenido no lleva NINGÚN número dentro: ni siquiera cuánta gente hay', () => {
    fc.assert(
      fc.property(arbEntradaSalud, (entrada) => {
        const cobertura = informeDeCobertura(entrada.cobertura);
        for (const celda of [...cobertura.porEje, ...cobertura.cruceSemestreJornada]) {
          if (!celda.desglose.publicado) {
            expect(Object.keys(celda.desglose)).toEqual(['publicado', 'motivo']);
          }
        }
      }),
      FC,
    );
  });
});
