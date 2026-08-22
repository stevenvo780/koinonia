/**
 * Determinismo del análisis de consenso, como pruebas de propiedad.
 *
 * Por qué éstas y no otras: el resultado de este paquete se publica y se contrasta. Si dos
 * ejecuciones sobre los mismos votos pueden dar grupos distintos, entonces nadie puede
 * comprobar el informe recalculándolo, y un análisis que no se puede recalcular no es un
 * análisis, es una afirmación de autoridad. Todo lo demás que hace el paquete —qué afirmaciones
 * son puente, cómo se numeran los grupos— descansa sobre esto.
 *
 * La más delicada es la invariancia al orden de los participantes (P2). Nada en los datos
 * distingue a quien rellenó el formulario primero de quien lo rellenó último, así que el orden
 * de llegada no puede cambiar los grupos. Pero el orden de llegada sí cambia el orden en que se
 * suman los números en coma flotante, y esa suma no es asociativa: (a+b)+c y a+(b+c) pueden
 * diferir en el último bit. El paquete lo resuelve reordenando filas y columnas a un orden
 * canónico que depende del contenido y no de la posición, antes de calcular nada.
 *
 * Abortar con un error tipado cuenta como desenlace: cuando los dos primeros ejes de variación
 * son casi iguales, la dirección de máxima discrepancia no está determinada por los datos y
 * devolver una cualquiera sería inventarla. Lo que se exige no es que siempre haya resultado,
 * sino que la misma entrada produzca siempre lo mismo, sea un valor o sea el mismo fallo.
 *
 * La semilla de fast-check está fijada: un contraejemplo se reproduce entre ejecuciones.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { analizarConsenso } from '../../src/index.js';
import { kMaximoPara } from '../../src/kmeans.js';
import type { MatrizVotos, ResultadoConsenso } from '../../src/types.js';

import {
  arbMatriz,
  arbPermutacion,
  desenlace,
  matrizConFacciones,
  permutar,
  permutarColumnas,
  textosDe,
  type Desenlace,
} from '../matrices.js';

const FC = { numRuns: 300, seed: 20260822, verbose: 0 } as const;
/** La invariancia al orden de los participantes es la crítica: se le dan muchos más casos. */
const FC_INTENSO = { numRuns: 1000, seed: 20260822, verbose: 0 } as const;

function analizar(M: MatrizVotos): Desenlace<ResultadoConsenso> {
  return desenlace(() => analizarConsenso(M, textosDe(M[0]?.length ?? 0)));
}

/**
 * Parte un ranking en tramos de métrica idéntica, devolviendo los índices (traducidos al
 * sistema de referencia común) ordenados dentro de cada tramo.
 *
 * Dos rankings con los mismos tramos dicen exactamente lo mismo: coinciden en todo salvo en el
 * orden interno de los empates, que ningún dato puede decidir.
 */
function tramosDeEmpate(
  afirmaciones: ReadonlyArray<{ readonly metrica: number; readonly indiceOriginal: number }>,
  traducir: (indice: number) => number,
): number[][] {
  const tramos: number[][] = [];
  let actual: number[] = [];
  let metrica = Number.NaN;
  for (const af of afirmaciones) {
    if (actual.length > 0 && af.metrica !== metrica) {
      tramos.push([...actual].sort((a, b) => a - b));
      actual = [];
    }
    metrica = af.metrica;
    actual.push(traducir(af.indiceOriginal));
  }
  if (actual.length > 0) tramos.push([...actual].sort((a, b) => a - b));
  return tramos;
}

/** Inversa de una permutación: `inv[p[j]] === j`. */
function inversa(p: ReadonlyArray<number>): number[] {
  const inv = new Array<number>(p.length).fill(0);
  p.forEach((destino, j) => {
    inv[destino] = j;
  });
  return inv;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// P1 — la misma entrada, dos veces
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('P1 — determinismo bit a bit', () => {
  it('dos ejecuciones sobre la misma matriz dan una salida idéntica', () => {
    fc.assert(
      fc.property(arbMatriz(), (M) => {
        const a = analizar(M);
        const b = analizar(M);
        expect(b).toEqual(a);
      }),
      FC,
    );
  });

  it('también en matrices grandes y con estructura', () => {
    for (const semilla of [7, 19, 53, 101, 211]) {
      const M = matrizConFacciones(120, 24, 4, semilla);
      expect(analizar(M)).toEqual(analizar(M));
    }
  });

  it('a escala real (300 participantes × 200 afirmaciones)', () => {
    // El tamaño que declara el diseño. Aquí el número de sumas en coma flotante es enorme y
    // cualquier dependencia del orden de acumulación tendría margen de sobra para aparecer.
    const M = matrizConFacciones(300, 200, 5, 424242);
    const a = analizar(M);
    const b = analizar(M);
    expect(b).toEqual(a);
    expect(a.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// P2 — permutar participantes (la crítica)
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('P2 — el orden de llegada de los participantes no cambia nada', () => {
  it('cada persona acaba en el mismo grupo, cambie por donde cambie de sitio', () => {
    fc.assert(
      fc.property(
        arbMatriz({ minFilas: 4, maxFilas: 20, minCols: 2, maxCols: 10 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (M, semilla) => {
          const p = fc.sample(arbPermutacion(M.length), { numRuns: 1, seed: semilla })[0];
          if (p === undefined) return;
          const base = analizar(M);
          const movida = analizar(permutar(M, p));

          if (!base.ok || !movida.ok) {
            // Si una aborta, la otra tiene que abortar igual: el desenlace no puede depender
            // del orden de llegada tampoco cuando el desenlace es un fallo.
            expect(movida.ok).toBe(base.ok);
            if (!base.ok && !movida.ok) expect(movida.error).toBe(base.error);
            return;
          }

          // La persona que ahora ocupa la posición i es la que antes ocupaba la p[i].
          const esperado = p.map((origen) => base.valor.asignaciones[origen]);
          expect(movida.valor.asignaciones).toEqual(esperado);
          // Y todo lo que no depende del orden de las personas sale exactamente igual.
          expect(movida.valor.k).toBe(base.valor.k);
          expect(movida.valor.grupos).toEqual(base.valor.grupos);
          expect(movida.valor.primeraComponente).toEqual(base.valor.primeraComponente);
          expect(movida.valor.segundaComponente).toEqual(base.valor.segundaComponente);
          expect(movida.valor.afirmacionesPuente).toEqual(base.valor.afirmacionesPuente);
          expect(movida.valor.afirmacionesDivisivas).toEqual(base.valor.afirmacionesDivisivas);
        },
      ),
      FC_INTENSO,
    );
  });

  it('tampoco con matrices grandes y estructuradas, donde hay más sumas que desordenar', () => {
    for (const semilla of [5, 23, 61]) {
      const M = matrizConFacciones(90, 20, 4, semilla);
      const p = fc.sample(arbPermutacion(M.length), { numRuns: 1, seed: semilla })[0];
      expect(p).toBeDefined();
      if (p === undefined) continue;
      const base = analizar(M);
      const movida = analizar(permutar(M, p));
      expect(base.ok).toBe(true);
      if (!base.ok || !movida.ok) continue;
      expect(movida.valor.asignaciones).toEqual(p.map((o) => base.valor.asignaciones[o]));
      expect(movida.valor.afirmacionesPuente).toEqual(base.valor.afirmacionesPuente);
    }
  });

  it('invertir el orden de llegada por completo tampoco altera los grupos', () => {
    // El caso extremo de reordenación, y el más fácil de razonar a mano.
    for (const semilla of [3, 17, 44, 88]) {
      const M = matrizConFacciones(60, 14, 3, semilla);
      const alReves = [...M].reverse();
      const base = analizar(M);
      const otro = analizar(alReves);
      if (!base.ok || !otro.ok) continue;
      const esperado = [...base.valor.asignaciones].reverse();
      expect(otro.valor.asignaciones).toEqual(esperado);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// P3 — permutar afirmaciones
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('P3 — el orden de las afirmaciones no cambia los grupos', () => {
  it('las personas quedan repartidas igual y el ranking se traduce sin perderse', () => {
    fc.assert(
      fc.property(
        arbMatriz({ minFilas: 6, maxFilas: 20, minCols: 3, maxCols: 10 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (M, semilla) => {
          const m = M[0]?.length ?? 0;
          const p = fc.sample(arbPermutacion(m), { numRuns: 1, seed: semilla })[0];
          if (p === undefined) return;
          const base = analizar(M);
          const movida = analizar(permutarColumnas(M, p));

          if (!base.ok || !movida.ok) {
            expect(movida.ok).toBe(base.ok);
            return;
          }
          // Las personas no se han movido: el reparto en grupos debe ser el mismo.
          expect(movida.valor.asignaciones).toEqual(base.valor.asignaciones);
          expect(movida.valor.k).toBe(base.valor.k);
          // El ranking sale con los mismos valores y en el mismo orden.
          expect(movida.valor.afirmacionesPuente.map((a) => a.metrica)).toEqual(
            base.valor.afirmacionesPuente.map((a) => a.metrica),
          );
          // Y cada tramo de empate contiene exactamente las mismas afirmaciones.
          //
          // Se compara por tramos y no posición a posición porque dos afirmaciones a las que
          // TODO el mundo respondió lo mismo son indistinguibles: mismo GIC, mismas cuentas,
          // mismas probabilidades por grupo. Entre ellas decide el desempate por índice, así
          // que al reordenar las columnas pueden intercambiarse. Exigir que conserven un orden
          // concreto sería exigir que el cálculo distinga lo que no se distingue por ningún
          // dato. Lo que sí se exige —y se comprueba— es que el orden entre afirmaciones con
          // métricas DISTINTAS no cambie, y eso es justo lo que compara la igualdad de tramos.
          expect(tramosDeEmpate(movida.valor.afirmacionesPuente, (i) => p[i] ?? -1)).toEqual(
            tramosDeEmpate(base.valor.afirmacionesPuente, (i) => i),
          );
        },
      ),
      FC,
    );
  });

  it('la traducción de índices es fiel: cada afirmación conserva SUS números', () => {
    // Comprueba que al reordenar las columnas cada métrica sigue a su afirmación en vez de
    // quedarse en su posición. Es la comprobación que delata una permutación aplicada de más.
    for (const semilla of [9, 31, 57]) {
      const M = matrizConFacciones(50, 12, 3, semilla);
      const p = fc.sample(arbPermutacion(12), { numRuns: 1, seed: semilla })[0];
      if (p === undefined) continue;
      const base = analizar(M);
      const movida = analizar(permutarColumnas(M, p));
      if (!base.ok || !movida.ok) continue;
      const inv = inversa(p);
      for (const af of base.valor.afirmacionesPuente) {
        const gemela = movida.valor.afirmacionesPuente.find(
          (b) => b.indiceOriginal === inv[af.indiceOriginal],
        );
        expect(gemela).toBeDefined();
        expect(gemela?.metrica).toBeCloseTo(af.metrica, 12);
        expect(gemela?.observaciones).toBe(af.observaciones);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// P4 a P7 — invariantes del resultado
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('P4 — el suavizado de Laplace mantiene las probabilidades lejos de los extremos', () => {
  it('siempre 0 < p̂ < 1, estrictamente', () => {
    fc.assert(
      fc.property(arbMatriz(), (M) => {
        const r = analizar(M);
        if (!r.ok) return;
        for (const af of [...r.valor.afirmacionesPuente, ...r.valor.afirmacionesDivisivas]) {
          for (const p of af.probabilidadesPorGrupo) {
            expect(p).toBeGreaterThan(0);
            expect(p).toBeLessThan(1);
            expect(Number.isFinite(p)).toBe(true);
          }
        }
      }),
      FC,
    );
  });
});

describe('P5 — el reparto en grupos es una partición', () => {
  it('los tamaños suman el total y cada persona está en un grupo y sólo uno', () => {
    fc.assert(
      fc.property(arbMatriz(), (M) => {
        const r = analizar(M);
        if (!r.ok) return;
        const res = r.valor;
        expect(res.asignaciones).toHaveLength(M.length);
        expect(res.participantesConsiderados).toBe(M.length);

        const cuenta = new Map<number, number>();
        for (const g of res.asignaciones) {
          expect(Number.isInteger(g)).toBe(true);
          expect(g).toBeGreaterThanOrEqual(1);
          expect(g).toBeLessThanOrEqual(res.grupos.length);
          cuenta.set(g, (cuenta.get(g) ?? 0) + 1);
        }
        const suma = res.grupos.reduce((acc, g) => acc + g.tamano, 0);
        expect(suma).toBe(M.length);
        for (const grupo of res.grupos) {
          expect(grupo.tamano).toBe(cuenta.get(grupo.id) ?? 0);
        }
        // Los identificadores son 1..k, sin huecos ni repeticiones.
        expect(res.grupos.map((g) => g.id)).toEqual(
          Array.from({ length: res.grupos.length }, (_, i) => i + 1),
        );
      }),
      FC,
    );
  });
});

describe('P6 — el número de grupos se queda en su rango', () => {
  it('2 ≤ k ≤ kMáximo, y kMáximo es el que dice la fórmula', () => {
    fc.assert(
      fc.property(arbMatriz(), (M) => {
        const r = analizar(M);
        if (!r.ok) return;
        expect(r.valor.kMaximo).toBe(kMaximoPara(M.length));
        expect(r.valor.k).toBeGreaterThanOrEqual(2);
        expect(r.valor.k).toBeLessThanOrEqual(r.valor.kMaximo);
      }),
      FC,
    );
  });
});

describe('P7 — el ranking de afirmaciones puente no sube nunca', () => {
  it('el GIC va de mayor a menor a lo largo de la lista', () => {
    fc.assert(
      fc.property(arbMatriz(), (M) => {
        const r = analizar(M);
        if (!r.ok) return;
        const puente = r.valor.afirmacionesPuente;
        for (let i = 1; i < puente.length; i++) {
          expect(puente[i]?.metrica ?? 0).toBeLessThanOrEqual(puente[i - 1]?.metrica ?? 0);
        }
        // Y el de divisivas, por dispersión, tampoco.
        const div = r.valor.afirmacionesDivisivas;
        for (let i = 1; i < div.length; i++) {
          expect(div[i]?.metrica ?? 0).toBeLessThanOrEqual(div[i - 1]?.metrica ?? 0);
        }
      }),
      FC,
    );
  });

  it('el GIC es el producto de las probabilidades por grupo, no su media', () => {
    // El producto castiga a cualquier grupo que discrepe: basta uno con p̂ baja para hundir el
    // total. Una media dejaría pasar como «puente» una afirmación que entusiasma a la mayoría y
    // repugna a una minoría, que es exactamente lo contrario de un puente.
    fc.assert(
      fc.property(arbMatriz(), (M) => {
        const r = analizar(M);
        if (!r.ok) return;
        for (const af of r.valor.afirmacionesPuente) {
          const producto = af.probabilidadesPorGrupo.reduce((a, b) => a * b, 1);
          expect(af.metrica).toBeCloseTo(producto, 12);
        }
      }),
      FC,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// P8 — canonicalización de signo
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('P8 — el signo de los ejes está fijado por una regla', () => {
  it('o la suma es positiva, o manda la componente de mayor magnitud', () => {
    fc.assert(
      fc.property(arbMatriz(), (M) => {
        const r = analizar(M);
        if (!r.ok) return;
        for (const v of [r.valor.primeraComponente, r.valor.segundaComponente]) {
          if (v.every((x) => x === 0)) continue; // no hay segundo eje: es el vector nulo
          let s = 0;
          for (const x of v) s += x;
          if (Math.abs(s) > 1e-12) {
            expect(s).toBeGreaterThan(0);
          } else {
            let iEstrella = 0;
            let mejor = Math.abs(v[0] ?? 0);
            for (let i = 1; i < v.length; i++) {
              const a = Math.abs(v[i] ?? 0);
              if (a > mejor) {
                mejor = a;
                iEstrella = i;
              }
            }
            expect(v[iEstrella] ?? 0).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      FC,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// P9 — entradas degeneradas
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('P9 — entradas sin ninguna variación', () => {
  it('una matriz con todas las celdas iguales siempre da el mismo desenlace', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Array<1 | -1 | 0 | null>>(1, -1, 0, null),
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 2, max: 20 }),
        (celda, n, m) => {
          const M: MatrizVotos = Array.from({ length: n }, () =>
            Array.from({ length: m }, () => celda),
          );
          const a = analizar(M);
          const b = analizar(M);
          expect(b).toEqual(a);
          // Sin variación no hay grupos que hallar, y se dice con un error tipado en vez de
          // partir en dos a un conjunto de personas que respondieron exactamente igual.
          expect(a.ok).toBe(false);
          if (!a.ok) expect(a.error).toBe('SinVariacion');
        },
      ),
      FC,
    );
  });

  it('una matriz con columnas constantes y una sola que separa sigue funcionando', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 40 }), fc.integer({ min: 2, max: 12 }), (n, m) => {
        const M: MatrizVotos = Array.from({ length: n }, (_, i) =>
          Array.from({ length: m }, (_, j) => (j === 0 ? (i % 2 === 0 ? 1 : -1) : 1)),
        );
        const a = analizar(M);
        expect(analizar(M)).toEqual(a);
        if (a.ok) {
          expect(a.valor.k).toBeGreaterThanOrEqual(2);
          const suma = a.valor.grupos.reduce((acc, g) => acc + g.tamano, 0);
          expect(suma).toBe(n);
        }
      }),
      FC,
    );
  });
});
