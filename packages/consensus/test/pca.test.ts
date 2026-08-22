/**
 * Ejes de variación: determinismo, canonicalización de signo y honestidad ante lo que no se
 * puede calcular.
 *
 * Lo que se defiende aquí es que el cálculo **no tiene grados de libertad ocultos**. El signo
 * de un eje es matemáticamente arbitrario —si `v` sirve, `−v` sirve igual— y ese detalle, si se
 * deja suelto, se propaga: cambia las coordenadas de las personas, cambia qué grupo queda a la
 * izquierda, cambia la numeración de los grupos y cambia el informe. Por eso el signo se fija
 * con una regla, y por eso la regla se prueba como contrato universal sobre cualquier salida y
 * no sobre un ejemplo elegido a mano.
 */

import { describe, expect, it } from 'vitest';

import { centrar, imputarYOrdenar, vectorInicialPca, type Matrix } from '../src/matrix.js';
import { pca2 } from '../src/pca.js';
import { PcaNoConvergente, SinVariacion } from '../src/types.js';
import type { MatrizVotos } from '../src/types.js';

import { matrizAleatoria, matrizConFacciones } from './matrices.js';

/** Prepara la matriz centrada tal como lo hace el análisis completo. */
function centrada(M: MatrizVotos): Matrix {
  const prep = imputarYOrdenar(M);
  return centrar(prep.X, prep.medias);
}

/**
 * El contrato de signo, verificable sobre CUALQUIER vector devuelto:
 *   - si `|Σvᵢ| > 1e-12`, entonces `Σvᵢ > 0`;
 *   - si no, la componente de mayor magnitud (la primera de ellas en caso de empate) es ≥ 0.
 */
function cumpleCanonicalizacionDeSigno(v: ReadonlyArray<number>): boolean {
  let s = 0;
  for (const x of v) s += x;
  if (Math.abs(s) > 1e-12) return s > 0;
  let iEstrella = 0;
  let mejor = Math.abs(v[0] ?? 0);
  for (let i = 1; i < v.length; i++) {
    const a = Math.abs(v[i] ?? 0);
    if (a > mejor) {
      mejor = a;
      iEstrella = i;
    }
  }
  return (v[iEstrella] ?? 0) >= 0;
}

function norma(v: ReadonlyArray<number>): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function producto(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/** Matriz de Gram `Xᵀ·X` recalculada aquí, para no dar por buena la del propio paquete. */
function gramDe(X: Matrix, m: number): number[] {
  const A = new Array<number>(m * m).fill(0);
  for (const fila of X) {
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) {
        A[a * m + b] = (A[a * m + b] ?? 0) + (fila[a] ?? 0) * (fila[b] ?? 0);
      }
    }
  }
  return A;
}

describe('vector inicial', () => {
  it('es fijo y unitario, sin intervención del azar', () => {
    const v = vectorInicialPca(9);
    expect(Array.from(v)).toEqual(new Array<number>(9).fill(1 / 3));
    expect(norma(Array.from(v))).toBeCloseTo(1, 15);
  });

  it('produce siempre el mismo vector para el mismo tamaño', () => {
    expect(Array.from(vectorInicialPca(50))).toEqual(Array.from(vectorInicialPca(50)));
  });

  it('rechaza tamaños no positivos en vez de devolver algo vacío', () => {
    expect(() => vectorInicialPca(0)).toThrow();
  });
});

describe('ejes de variación', () => {
  it('encuentra la dirección de discrepancia cuando sólo hay una', () => {
    // Dos bloques que responden lo contrario en las dos primeras afirmaciones y lo mismo en las
    // otras dos. El único eje real es «afirmaciones 1 y 2»; las otras dos no separan a nadie.
    const M: MatrizVotos = [
      [1, 1, 1, -1],
      [1, 1, 1, -1],
      [-1, -1, 1, -1],
      [-1, -1, 1, -1],
    ];
    const r = pca2(centrada(M));
    // Las dos afirmaciones que no separan a nadie no pesan en el eje.
    const pesos = r.primeraComponente.map((x) => Math.abs(x));
    const separadoras = pesos.filter((p) => p > 0.4).length;
    expect(separadoras).toBe(2);
    expect(norma(r.primeraComponente)).toBeCloseTo(1, 12);
  });

  it('devuelve vectores unitarios', () => {
    const M = matrizConFacciones(40, 9, 3, 12345);
    const r = pca2(centrada(M));
    expect(norma(r.primeraComponente)).toBeCloseTo(1, 12);
    expect(norma(r.segundaComponente)).toBeCloseTo(1, 12);
  });

  it('da dos ejes independientes entre sí', () => {
    const M = matrizConFacciones(60, 11, 3, 999);
    const r = pca2(centrada(M));
    // La deflación de Hotelling quita el primer eje antes de buscar el segundo: lo que queda es
    // perpendicular. Si no lo fuera, el «segundo» eje repetiría información del primero.
    expect(Math.abs(producto(r.primeraComponente, r.segundaComponente))).toBeLessThan(1e-8);
  });

  it('el primer eje concentra al menos tanta variación como el segundo', () => {
    const M = matrizConFacciones(60, 11, 3, 4242);
    const r = pca2(centrada(M));
    expect(r.autovalor1).toBeGreaterThanOrEqual(r.autovalor2);
  });

  it('devuelve exactamente lo mismo al repetir el cálculo', () => {
    const M = matrizConFacciones(50, 10, 3, 777);
    const Xc = centrada(M);
    expect(pca2(Xc)).toEqual(pca2(Xc));
  });
});

describe('canonicalización de signo', () => {
  it('cumple la regla en los dos ejes, sobre muchas entradas distintas', () => {
    let comprobados = 0;
    for (let semilla = 1; semilla <= 60; semilla++) {
      const M =
        semilla % 2 === 0
          ? matrizConFacciones(20 + (semilla % 25), 5 + (semilla % 8), 2 + (semilla % 3), semilla)
          : matrizAleatoria(10 + (semilla % 20), 4 + (semilla % 7), semilla * 13);
      let r;
      try {
        r = pca2(centrada(M));
      } catch (e) {
        // Abortar es un desenlace legítimo; lo que no vale es devolver un signo suelto.
        expect(e instanceof PcaNoConvergente || e instanceof SinVariacion).toBe(true);
        continue;
      }
      expect(cumpleCanonicalizacionDeSigno(r.primeraComponente)).toBe(true);
      expect(cumpleCanonicalizacionDeSigno(r.segundaComponente)).toBe(true);
      comprobados++;
    }
    expect(comprobados).toBeGreaterThan(40);
  });

  it('el eje devuelto es de verdad un eje, con el signo ya fijado', () => {
    // `A·v = λ·v` comprobado a mano sobre la matriz de Gram. Esto verifica dos cosas a la vez:
    // que el vector es realmente un eje de variación (y no un vector a medio converger), y que
    // el signo con el que se devuelve es coherente con el valor propio positivo, no el opuesto.
    const M = matrizConFacciones(40, 7, 3, 20260822);
    const Xc = centrada(M);
    const r = pca2(Xc);
    const m = r.primeraComponente.length;
    const A = gramDe(Xc, m);
    const Av = new Array<number>(m).fill(0);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += (A[i * m + j] ?? 0) * (r.primeraComponente[j] ?? 0);
      Av[i] = s;
    }
    for (let i = 0; i < m; i++) {
      expect(Av[i] ?? 0).toBeCloseTo(r.autovalor1 * (r.primeraComponente[i] ?? 0), 6);
    }
  });

  it('invertir el signo de los datos ya centrados no cambia los ejes', () => {
    // (−X)ᵀ(−X) = XᵀX: la matriz de Gram es idéntica bit a bit, así que los ejes deben salir
    // idénticos y NO invertidos. Se opera sobre la matriz ya centrada a propósito: invertir los
    // votos en la matriz de entrada es otra cosa —cambia los recuentos de acuerdo y desacuerdo
    // de cada afirmación y con ellos el orden canónico de columnas—, así que no serviría para
    // aislar la cuestión del signo.
    const Xc = centrada(matrizConFacciones(36, 8, 3, 20260822));
    const negada: Matrix = Xc.map((fila) => fila.map((x) => -x));
    expect(pca2(negada)).toEqual(pca2(Xc));
  });
});

describe('lo que no se puede calcular no se inventa', () => {
  it('sin ninguna variación avisa de que no hay grupos, no de un fallo de cálculo', () => {
    // Todas las celdas iguales: nadie discrepa de nadie.
    const M: MatrizVotos = Array.from({ length: 8 }, () =>
      Array.from({ length: 5 }, () => 1 as const),
    );
    expect(() => pca2(centrada(M))).toThrow(SinVariacion);
    try {
      pca2(centrada(M));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SinVariacion);
      expect((e as SinVariacion).participantes).toBe(8);
      expect((e as SinVariacion).afirmaciones).toBe(5);
    }
  });

  it('sin nadie que responda tampoco inventa ejes', () => {
    const M: MatrizVotos = Array.from({ length: 6 }, () => Array.from({ length: 4 }, () => null));
    expect(() => pca2(centrada(M))).toThrow(SinVariacion);
  });

  it('cuando toda la discrepancia cabe en un eje, el segundo es nulo y no un fallo', () => {
    // Dos bloques perfectamente enfrentados: la matriz tiene rango 1. No existe un segundo eje.
    // Antes esto abortaba el análisis entero con «no convergió», que era falso: el cálculo no
    // llegó siquiera a iterar. Ahora el segundo eje es el vector nulo, que es como se dice «no
    // hay», y todo el mundo proyecta en 0 sobre él.
    const M: MatrizVotos = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
    ];
    const r = pca2(centrada(M));
    expect(r.segundaComponente).toEqual([0, 0, 0, 0]);
    expect(r.autovalor2).toBe(0);
    expect(norma(r.primeraComponente)).toBeCloseTo(1, 12);
    expect(r.autovalor1).toBeGreaterThan(0);
  });

  it('cuando los dos ejes son casi iguales aborta con un error tipado y con los datos del fallo', () => {
    // n=24, m=12: los dos primeros valores propios salen 34.315 y 33.760, una razón de 0.9838.
    // Para bajar de 1e-12 en 1000 pasos hace falta una razón menor que 0.9727, así que este
    // caso NO puede converger. No es un defecto: con dos ejes casi iguales la dirección de
    // máxima discrepancia no está determinada por los datos, y devolver una cualquiera sería
    // presentar como hallazgo algo que depende de dónde se corte la iteración.
    const M = matrizAleatoria(24, 12, 16);
    expect(() => pca2(centrada(M))).toThrow(PcaNoConvergente);
    try {
      pca2(centrada(M));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PcaNoConvergente);
      const err = e as PcaNoConvergente;
      expect(err.iteracionesMax).toBe(1000);
      expect(err.iteracion).toBe(1000);
      expect(err.componente).toBe(1);
      // Se informa de lo lejos que quedó, no se disimula.
      expect(err.delta).toBeGreaterThan(0);
      expect(Number.isFinite(err.delta)).toBe(true);
    }
  });

  it('el fallo de convergencia es reproducible: la misma entrada falla igual', () => {
    const M = matrizAleatoria(24, 12, 16);
    const uno = desenlaceDe(() => pca2(centrada(M)));
    const dos = desenlaceDe(() => pca2(centrada(M)));
    expect(dos).toEqual(uno);
    expect(uno.error).toBe('PcaNoConvergente');
  });

  it('sale adelante aunque el eje sea perpendicular al vector de arranque', () => {
    // El arranque fijo (`1/√m` en cada posición, sin azar) tiene un punto ciego: si el eje real
    // es perpendicular a él, la primera multiplicación da exactamente cero y la iteración no
    // arranca. Ocurre siempre que dos bloques del mismo tamaño se enfrentan y las afirmaciones
    // se reparten a favor y en contra, porque entonces el eje suma cero. Es el caso más limpio
    // que existe, no una rareza, y antes abortaba el análisis diciendo «no convergió» sin haber
    // dado un solo paso.
    //
    // Dos personas que responden justo lo contrario: el eje es (1,−1)/√2.
    const M: MatrizVotos = [
      [1, -1],
      [-1, 1],
    ];
    const r = pca2(centrada(M));
    expect(norma(r.primeraComponente)).toBeCloseTo(1, 12);
    expect(Math.abs(r.primeraComponente[0] ?? 0)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(Math.abs(r.primeraComponente[1] ?? 0)).toBeCloseTo(Math.SQRT1_2, 12);
    // Las dos componentes tienen signo opuesto: el eje separa a las dos personas.
    expect((r.primeraComponente[0] ?? 0) * (r.primeraComponente[1] ?? 0)).toBeLessThan(0);
    // Y toda la discrepancia cabe en ese eje, así que no hay un segundo.
    expect(r.segundaComponente).toEqual([0, 0]);
  });

  it('con un eje de suma cero desempata por la componente mayor, y lo hace siempre igual', () => {
    // Éste es el único camino por el que pasa la regla de respaldo del signo. La regla normal
    // («si Σvᵢ es apreciable, se fuerza Σvᵢ > 0») no decide nada cuando la suma es cero, que es
    // justo lo que pasa con un eje perfectamente equilibrado. Sin el respaldo, el signo lo
    // acabaría fijando el redondeo y dos ejecuciones podrían intercambiar los grupos.
    const M: MatrizVotos = [
      [1, -1],
      [-1, 1],
    ];
    const r = pca2(centrada(M));
    const suma = (r.primeraComponente[0] ?? 0) + (r.primeraComponente[1] ?? 0);
    expect(Math.abs(suma)).toBeLessThanOrEqual(1e-12);
    // Con la suma anulada manda la componente de mayor magnitud (la primera, al empatar), que
    // se deja positiva.
    expect(r.primeraComponente[0] ?? 0).toBeGreaterThan(0);
    expect(cumpleCanonicalizacionDeSigno(r.primeraComponente)).toBe(true);
    expect(pca2(centrada(M))).toEqual(r);
  });

  it('exige al menos dos participantes y dos afirmaciones', () => {
    expect(() => pca2([[1, 2]])).toThrow(/2 participantes/);
    expect(() => pca2([[1], [2]])).toThrow(/2 participantes/);
  });
});

function desenlaceDe<T>(f: () => T): { error?: string; valor?: T } {
  try {
    return { valor: f() };
  } catch (e) {
    return { error: e instanceof Error ? e.name : 'desconocido' };
  }
}
