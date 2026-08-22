/**
 * Factorización enmascarada de 2 factores (ADR-0038).
 *
 * Lo que se defiende aquí es que la pérdida se evalúa **sólo sobre las celdas observadas**, que es
 * literalmente lo que pide ADR-0038 («factorización enmascarada de 2 factores, no imputación por
 * la media»). No es un matiz de estilo: con imputación, el hueco de quien votó poco se rellena con
 * la postura media de la afirmación, su residuo queda en cero y su punto se desplaza hacia el
 * centro del mapa. Acaba en el grupo del medio por no haber votado, no por lo que piensa.
 *
 * La comprobación decisiva es la **ecuación normal**: si el ajuste de cada persona minimiza el
 * error sobre sus celdas observadas, su residuo tiene que ser perpendicular a los ejes **restringidos
 * a esas celdas**. Y —esto es lo que distingue una cosa de la otra— NO perpendicular a los ejes
 * completos, que es lo que saldría si los huecos participaran con un valor imputado.
 */

import { describe, expect, it } from 'vitest';

import { factorizarEnmascarada } from '../src/factorizacion.js';
import { prepararMatriz } from '../src/matrix.js';
import type { MatrizVotos } from '../src/types.js';

import { dosBloques, matrizConFacciones } from './matrices.js';

interface Ajuste {
  readonly Y: ReadonlyArray<ReadonlyArray<number>>;
  readonly mascara: ReadonlyArray<ReadonlyArray<boolean>>;
  readonly U: ReadonlyArray<ReadonlyArray<number>>;
  readonly V: ReadonlyArray<ReadonlyArray<number>>;
  readonly factores: number;
}

function ajustar(M: MatrizVotos): Ajuste {
  const prep = prepararMatriz(M);
  const f = factorizarEnmascarada(prep.Y, prep.mascara);
  return {
    Y: prep.Y,
    mascara: prep.mascara,
    U: f.coordenadas,
    V: [f.primerEje, f.segundoEje],
    factores: f.factores,
  };
}

/** `Σ_{j en el conjunto} (y_ij − u_i·v_j) · v_jf`: la ecuación normal del factor `f`. */
function gradienteFila(a: Ajuste, i: number, f: number, soloObservadas: boolean): number {
  const y = a.Y[i] ?? [];
  const masc = a.mascara[i] ?? [];
  const u = a.U[i] ?? [];
  let s = 0;
  for (let j = 0; j < y.length; j++) {
    if (soloObservadas && masc[j] !== true) continue;
    let ajustado = 0;
    for (let g = 0; g < a.factores; g++) {
      ajustado += (u[g] ?? 0) * (a.V[g]?.[j] ?? 0);
    }
    s += ((y[j] ?? 0) - ajustado) * (a.V[f]?.[j] ?? 0);
  }
  return s;
}

/** Norma de una fila de coordenadas. */
function magnitud(u: ReadonlyArray<number>): number {
  let s = 0;
  for (const x of u) s += x * x;
  return Math.sqrt(s);
}

/** Proporción de la discrepancia observada que explican los dos factores ajustados. */
function fraccionExplicada(M: MatrizVotos): number {
  const a = ajustar(M);
  let sumaY2 = 0;
  let sumaError2 = 0;
  for (let i = 0; i < a.U.length; i++) {
    const y = a.Y[i] ?? [];
    const masc = a.mascara[i] ?? [];
    for (let j = 0; j < y.length; j++) {
      if (masc[j] !== true) continue;
      let ajustado = 0;
      for (let g = 0; g < a.factores; g++) {
        ajustado += (a.U[i]?.[g] ?? 0) * (a.V[g]?.[j] ?? 0);
      }
      sumaY2 += (y[j] ?? 0) ** 2;
      sumaError2 += ((y[j] ?? 0) - ajustado) ** 2;
    }
  }
  return 1 - sumaError2 / sumaY2;
}

describe('la pérdida se evalúa sólo sobre lo observado', () => {
  it('el residuo de cada persona es perpendicular a los ejes en SUS celdas votadas', () => {
    // La ecuación normal del ajuste enmascarado. Si se cumple, el ajuste es el de mínimos
    // cuadrados sobre las celdas observadas y no sobre otra cosa.
    for (const semilla of [3, 11, 29]) {
      const a = ajustar(matrizConFacciones(60, 20, 3, semilla));
      for (let i = 0; i < a.U.length; i++) {
        const escala = Math.max(1, magnitud(a.U[i] ?? []));
        for (let f = 0; f < a.factores; f++) {
          expect(Math.abs(gradienteFila(a, i, f, true)) / escala).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('y NO es perpendicular si se cuentan también los huecos: los huecos no son un dato', () => {
    // El contraste que separa las dos rutas. Con imputación por la media, el residuo de un hueco
    // es cero y la suma sobre TODAS las celdas coincidiría con la suma sobre las observadas.
    // Aquí no coincide, porque el hueco entra en esta suma con un valor que el ajuste nunca usó.
    const a = ajustar(matrizConFacciones(60, 20, 3, 11));
    let filasQueDifieren = 0;
    for (let i = 0; i < a.U.length; i++) {
      const conHuecos = Math.abs(gradienteFila(a, i, 0, false));
      const soloVotadas = Math.abs(gradienteFila(a, i, 0, true));
      if (conHuecos > 1e-3 && soloVotadas < 1e-6) filasQueDifieren++;
    }
    // No todas las personas tienen huecos, pero muchas sí.
    expect(filasQueDifieren).toBeGreaterThan(10);
  });

  it('borrar votos a una persona ya no la arrastra hacia el centro del mapa', () => {
    // **La medición que justifica el cambio entero**, y la que ADR-0038 pide con nombre propio:
    // «no introduce sesgo contra quien votó poco».
    //
    // Se toma la misma matriz dos veces y a la misma persona se le borran votos en la segunda.
    // Si el método arrastrara a quien vota poco hacia el centro, su distancia al origen se
    // encogería en proporción a lo que dejó de votar. Con imputación por la media eso es
    // exactamente lo que pasaba: la razón medida sobre estas mismas matrices era 0,759 al votar
    // el 75 %, 0,498 al votar la mitad y 0,269 al votar la cuarta parte —o sea, la fracción
    // votada, clavada—. Con máscara la razón se queda alrededor de 1.
    //
    // Se toma la MEDIANA sobre varias semillas porque la estimación de quien vota poco es
    // legítimamente más ruidosa: la máscara quita el sesgo, no la incertidumbre.
    for (const [fraccion, minimo] of [
      [0.75, 0.9],
      [0.5, 0.85],
    ] as const) {
      const razones: number[] = [];
      for (const semilla of [7919, 15838, 23757, 31676, 39595, 47514, 55433]) {
        const completa = matrizConFacciones(60, 24, 3, semilla);
        const conHuecos = completa.map((f) => [...f]);
        const fila = conHuecos[0];
        if (fila === undefined) continue;
        // Se borran las últimas columnas: el criterio no depende de ningún sorteo.
        for (let j = Math.round(24 * fraccion); j < 24; j++) fila[j] = null;

        const sin = magnitud(coordenadaDe(completa, 0));
        const con = magnitud(coordenadaDe(conHuecos, 0));
        if (sin > 1e-9) razones.push(con / sin);
      }
      razones.sort((a, b) => a - b);
      const mediana = razones[Math.floor(razones.length / 2)] ?? 0;
      expect(razones.length).toBeGreaterThan(4);
      expect(mediana).toBeGreaterThan(minimo);
      // Y desde luego no se queda en la fracción votada, que es la firma de la imputación.
      expect(mediana).toBeGreaterThan(fraccion + 0.1);
    }
  });
});

/** Coordenada de quien ocupaba la posición `i` en la entrada, deshaciendo el orden canónico. */
function coordenadaDe(M: MatrizVotos, i: number): ReadonlyArray<number> {
  const prep = prepararMatriz(M);
  const f = factorizarEnmascarada(prep.Y, prep.mascara);
  return f.coordenadas[prep.filas.indexOf(i)] ?? [];
}

describe('la parametrización del par de factores está fijada', () => {
  it('los ejes son unitarios y perpendiculares entre sí', () => {
    for (const semilla of [5, 19, 47]) {
      const a = ajustar(matrizConFacciones(50, 18, 3, semilla));
      if (a.factores < 2) continue;
      const [v0, v1] = [a.V[0] ?? [], a.V[1] ?? []];
      expect(magnitud(v0)).toBeCloseTo(1, 10);
      expect(magnitud(v1)).toBeCloseTo(1, 10);
      let punto = 0;
      for (let j = 0; j < v0.length; j++) punto += (v0[j] ?? 0) * (v1[j] ?? 0);
      expect(Math.abs(punto)).toBeLessThan(1e-10);
    }
  });

  it('el primer eje recoge más dispersión que el segundo', () => {
    for (const semilla of [5, 19, 47]) {
      const a = ajustar(matrizConFacciones(50, 18, 3, semilla));
      if (a.factores < 2) continue;
      let d0 = 0;
      let d1 = 0;
      let cruz = 0;
      for (const u of a.U) {
        d0 += (u[0] ?? 0) ** 2;
        d1 += (u[1] ?? 0) ** 2;
        cruz += (u[0] ?? 0) * (u[1] ?? 0);
      }
      expect(d0).toBeGreaterThanOrEqual(d1);
      // Y son los ejes principales: la dispersión cruzada se anula.
      expect(Math.abs(cruz) / Math.max(d0, 1)).toBeLessThan(1e-10);
    }
  });

  it('reequilibrar los factores no altera lo que el modelo predice', () => {
    // El paso de reortonormalización mueve escala de los ejes a las coordenadas. Si se aplicara
    // la matriz sin trasponer, el producto `u·v` cambiaría —parte del primer eje se colaría en
    // el segundo— y el mapa saldría girado sin que fallara nada más. Aquí se comprueba contra
    // los datos: lo que el modelo predice en cada celda observada tiene que explicar el residuo.
    //
    // Sobre dos bloques limpios, dos factores tienen que explicarlo TODO: la matriz es de rango
    // bajo por construcción. Basta que el reequilibrio gire el par de factores para que esta
    // cifra se desplome, así que sirve de detector.
    expect(fraccionExplicada(dosBloques(60, 12))).toBeGreaterThan(0.999);
    expect(fraccionExplicada(dosBloques(40, 20))).toBeGreaterThan(0.999);
    // Y sobre datos con ruido, el 20–40 % que ADR-0038 anuncia para el mapa de dos dimensiones.
    const conRuido = fraccionExplicada(matrizConFacciones(60, 20, 2, 8));
    expect(conRuido).toBeGreaterThan(0.2);
    expect(conRuido).toBeLessThan(0.6);
  });

  it('dos ejecuciones sobre la misma matriz devuelven exactamente lo mismo', () => {
    const M = matrizConFacciones(70, 22, 3, 20260822);
    const prep = prepararMatriz(M);
    expect(factorizarEnmascarada(prep.Y, prep.mascara)).toEqual(
      factorizarEnmascarada(prep.Y, prep.mascara),
    );
  });

  it('cuando toda la discrepancia cabe en un eje, ajusta un solo factor', () => {
    const M: MatrizVotos = [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [-1, -1, -1, -1],
      [-1, -1, -1, -1],
    ];
    const a = ajustar(M);
    expect(a.factores).toBe(1);
    // Y la segunda coordenada de todo el mundo es cero: nadie se separa en un eje que no existe.
    for (const u of a.U) expect(u[1]).toBe(0);
    expect(a.V[1]).toEqual([0, 0, 0, 0]);
  });
});

describe('la máscara distingue el hueco del «paso»', () => {
  it('«paso» cuenta como celda observada y la ausencia no', () => {
    const M: MatrizVotos = [
      [1, 0, null, -1],
      [1, 1, 1, 1],
      [-1, -1, -1, -1],
      [0, 0, 1, -1],
    ];
    const prep = prepararMatriz(M);
    // La máscara viene en orden canónico; se comprueba fila a fila contra la entrada.
    for (let c = 0; c < prep.filas.length; c++) {
      const original = M[prep.filas[c] ?? 0] ?? [];
      for (let k = 0; k < prep.columnas.length; k++) {
        const celda = original[prep.columnas[k] ?? 0];
        expect(prep.mascara[c]?.[k]).toBe(celda !== null);
      }
    }
  });

  it('la celda ausente guarda un cero que no es un dato: su residuo no depende de la media', () => {
    // Dos matrices con la misma celda ausente pero medias de columna distintas. Si el hueco se
    // imputara, su residuo sería `media − media = 0` por casualidad; lo que se comprueba aquí es
    // que el hueco queda fuera de la máscara en los dos casos, que es lo que hace que el cero
    // guardado no llegue nunca al ajuste.
    const a = prepararMatriz([
      [null, 1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [1, -1, 1],
    ]);
    const b = prepararMatriz([
      [null, 1, -1],
      [1, 1, -1],
      [1, 1, -1],
      [1, -1, 1],
    ]);
    const huecoA = a.filas.indexOf(0);
    const huecoB = b.filas.indexOf(0);
    const colA = a.columnas.indexOf(0);
    const colB = b.columnas.indexOf(0);
    expect(a.mascara[huecoA]?.[colA]).toBe(false);
    expect(b.mascara[huecoB]?.[colB]).toBe(false);
    // Las medias de esa columna sí son distintas entre las dos matrices.
    expect(a.medias[colA]).not.toBe(b.medias[colB]);
  });
});
