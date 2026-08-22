/**
 * El análisis completo, de la matriz de votos al informe.
 *
 * Dos cosas se vigilan aquí con especial cuidado:
 *
 *  1. **Que cada número cuelgue de la afirmación correcta.** Un ranking bien ordenado pero con
 *     las etiquetas cambiadas es peor que un error ruidoso: sale un informe verosímil que
 *     atribuye a una afirmación el acuerdo que concitó otra, y nada falla. Por eso las
 *     probabilidades no se dan por buenas: se recalculan aquí desde la matriz de entrada y los
 *     grupos devueltos, y se contrastan.
 *  2. **Que ningún texto de pantalla hable en jerga** (ADR-0041). Quien lee el informe es una
 *     persona que participó en la deliberación, no quien programó el cálculo.
 */

import { describe, expect, it } from 'vitest';

import { analizarConsenso, aPantalla, TEXTOS } from '../src/index.js';
import { kMaximoPara } from '../src/kmeans.js';
import { PcaNoConvergente, SinVariacion } from '../src/types.js';
import type { MatrizVotos, ResultadoConsenso } from '../src/types.js';

import { matrizConFacciones, textosDe } from './matrices.js';

/**
 * Recalcula `p̂(g,c)` desde cero: matriz de entrada + grupos devueltos, sin mirar nada más del
 * paquete. Si el ranking etiquetara mal las afirmaciones, esto no cuadraría.
 */
function probabilidadesRecalculadas(
  M: MatrizVotos,
  asignaciones: ReadonlyArray<number>,
  numeroDeGrupos: number,
  columna: number,
): number[] {
  const acuerdos = new Array<number>(numeroDeGrupos).fill(0);
  const observaciones = new Array<number>(numeroDeGrupos).fill(0);
  for (let i = 0; i < M.length; i++) {
    const g = (asignaciones[i] ?? 1) - 1; // los grupos se numeran desde 1 de cara a la persona
    const celda = M[i]?.[columna];
    if (celda === null || celda === undefined || celda === 0) continue;
    observaciones[g] = (observaciones[g] ?? 0) + 1;
    if (celda === 1) acuerdos[g] = (acuerdos[g] ?? 0) + 1;
  }
  const salida: number[] = [];
  for (let g = 0; g < numeroDeGrupos; g++) {
    const o = observaciones[g] ?? 0;
    if (o > 0) salida.push(((acuerdos[g] ?? 0) + 1) / (o + 2));
  }
  return salida;
}

/**
 * Caso pequeño y comprobable a mano.
 *
 * Seis personas en dos bloques. La afirmación 0 concita acuerdo general pero la respondieron
 * menos personas; la 1 los separa; la 2 la rechazan todos. Los distintos números de respuesta
 * son deliberados: hacen que el orden interno de columnas NO sea el de entrada, que es la
 * única circunstancia en la que se nota si los índices se traducen mal.
 */
const CASO: MatrizVotos = [
  [1, 1, -1],
  [1, 1, -1],
  [1, 1, -1],
  [1, -1, -1],
  [null, -1, -1],
  [null, -1, -1],
];
const TEXTOS_CASO = [
  'Merece la pena seguir hablando de esto',
  'Hay que aprobarlo tal como está',
  'Conviene dejarlo todo igual',
];

describe('análisis completo', () => {
  it('reparte a las personas en grupos y los devuelve en el orden de entrada', () => {
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    expect(r.k).toBe(2);
    expect(r.asignaciones).toHaveLength(6);
    // Los tres primeros votaron igual entre sí y distinto de los tres últimos.
    const bloqueA = new Set(r.asignaciones.slice(0, 3));
    const bloqueB = new Set(r.asignaciones.slice(3, 6));
    expect(bloqueA.size).toBe(1);
    expect(bloqueB.size).toBe(1);
    expect([...bloqueA][0]).not.toBe([...bloqueB][0]);
  });

  it('los grupos se numeran desde 1, como los ve la persona', () => {
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    expect(r.grupos.map((g) => g.id)).toEqual([1, 2]);
    for (const g of r.asignaciones) {
      expect(g).toBeGreaterThanOrEqual(1);
      expect(g).toBeLessThanOrEqual(r.grupos.length);
    }
  });

  it('cada persona está en un grupo y sólo en uno, y las cuentas cuadran', () => {
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    const suma = r.grupos.reduce((acc, g) => acc + g.tamano, 0);
    expect(suma).toBe(r.participantesConsiderados);
    expect(suma).toBe(CASO.length);
    const porGrupo = new Map<number, number>();
    for (const g of r.asignaciones) porGrupo.set(g, (porGrupo.get(g) ?? 0) + 1);
    for (const grupo of r.grupos) {
      expect(porGrupo.get(grupo.id) ?? 0).toBe(grupo.tamano);
    }
  });

  it('ordena las afirmaciones puente de más a menos acuerdo transversal', () => {
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    const indices = r.afirmacionesPuente.map((a) => a.indiceOriginal);
    // La 0 la comparten los dos bloques; la 1 los separa; la 2 la rechazan todos.
    expect(indices).toEqual([0, 1, 2]);
    // GIC de la afirmación 0 = (2/3) · (4/5): un bloque respondió 1 de 1, el otro 3 de 3.
    expect(r.afirmacionesPuente[0]?.metrica).toBeCloseTo((2 / 3) * (4 / 5), 12);
    expect(r.afirmacionesPuente[1]?.metrica).toBeCloseTo(0.8 * 0.2, 12);
    expect(r.afirmacionesPuente[2]?.metrica).toBeCloseTo(0.2 * 0.2, 12);
  });

  it('cada afirmación del informe lleva SU propio texto, no el de otra', () => {
    // Ésta es la comprobación que delata una traducción de índices mal hecha. El orden interno
    // de columnas de este caso no es el de entrada, así que aplicar la permutación donde no
    // toca deja los números bien ordenados pero colgando de la afirmación equivocada.
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    const pantalla = aPantalla(r);
    expect(pantalla.afirmacionesPuente[0]?.texto).toBe('Merece la pena seguir hablando de esto');
    expect(pantalla.afirmacionesPuente[2]?.texto).toBe('Conviene dejarlo todo igual');
    // Y la más divisiva es la que separa a los bloques.
    expect(pantalla.afirmacionesDivisivas[0]?.texto).toBe('Hay que aprobarlo tal como está');
  });

  it('las probabilidades publicadas coinciden con las recalculadas desde la matriz', () => {
    for (const semilla of [3, 11, 29, 47]) {
      const M = matrizConFacciones(45, 9, 3, semilla);
      const textos = textosDe(9);
      let r: ResultadoConsenso;
      try {
        r = analizarConsenso(M, textos);
      } catch (e) {
        expect(e instanceof PcaNoConvergente || e instanceof SinVariacion).toBe(true);
        continue;
      }
      for (const af of [...r.afirmacionesPuente, ...r.afirmacionesDivisivas]) {
        const esperadas = probabilidadesRecalculadas(
          M,
          r.asignaciones,
          r.grupos.length,
          af.indiceOriginal,
        );
        expect(af.probabilidadesPorGrupo).toHaveLength(esperadas.length);
        af.probabilidadesPorGrupo.forEach((p, i) => {
          expect(p).toBeCloseTo(esperadas[i] ?? -1, 12);
        });
        // Y el GIC es de verdad el producto de esas probabilidades, no su media.
        if (r.afirmacionesPuente.includes(af)) {
          const producto = esperadas.reduce((a, b) => a * b, 1);
          expect(af.metrica).toBeCloseTo(producto, 12);
        }
      }
    }
  });
});

describe('suavizado de Laplace', () => {
  it('ninguna probabilidad llega nunca a 0 ni a 1', () => {
    // El suavizado existe justo para esto: una afirmación que un grupo rechazó por unanimidad
    // no tiene probabilidad 0 de acuerdo, tiene «muy poca y con estos datos». Un 0 exacto
    // anularía el producto del GIC y daría a un grupo pequeño un veto que no le corresponde.
    for (const semilla of [1, 5, 13, 21, 34]) {
      const M = matrizConFacciones(40, 8, 3, semilla);
      let r: ResultadoConsenso;
      try {
        r = analizarConsenso(M, textosDe(8));
      } catch {
        continue;
      }
      for (const af of [...r.afirmacionesPuente, ...r.afirmacionesDivisivas]) {
        for (const p of af.probabilidadesPorGrupo) {
          expect(p).toBeGreaterThan(0);
          expect(p).toBeLessThan(1);
        }
      }
    }
  });

  it('con unanimidad en contra sigue habiendo margen, y con unanimidad a favor también', () => {
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    const todas = [...r.afirmacionesPuente, ...r.afirmacionesDivisivas];
    const valores = todas.flatMap((a) => [...a.probabilidadesPorGrupo]);
    expect(valores.length).toBeGreaterThan(0);
    expect(Math.min(...valores)).toBeGreaterThan(0);
    expect(Math.max(...valores)).toBeLessThan(1);
  });

  it('un grupo sin ninguna respuesta no entra en el producto y por tanto no veta', () => {
    // La afirmación 0 no la respondió nadie del segundo bloque: no puede arrastrar el GIC a 0.
    const M: MatrizVotos = [
      [1, 1, -1],
      [1, 1, -1],
      [1, 1, -1],
      [null, -1, -1],
      [null, -1, -1],
      [null, -1, -1],
    ];
    const r = analizarConsenso(M, TEXTOS_CASO);
    const af = r.afirmacionesPuente.find((a) => a.indiceOriginal === 0);
    expect(af).toBeDefined();
    // Un solo grupo con respuestas: 3 de 3 → 4/5.
    expect(af?.probabilidadesPorGrupo).toHaveLength(1);
    expect(af?.metrica).toBeCloseTo(4 / 5, 12);
  });
});

describe('número de grupos', () => {
  it('se queda entre 2 y el tope, en muchas configuraciones', () => {
    for (const n of [10, 25, 45, 70]) {
      for (const semilla of [2, 8]) {
        const M = matrizConFacciones(n, 8, 3, n * semilla);
        let r: ResultadoConsenso;
        try {
          r = analizarConsenso(M, textosDe(8));
        } catch {
          continue;
        }
        expect(r.k).toBeGreaterThanOrEqual(2);
        expect(r.k).toBeLessThanOrEqual(r.kMaximo);
        expect(r.kMaximo).toBe(kMaximoPara(n));
      }
    }
  });
});

describe('el silencio y la abstención no son lo mismo', () => {
  it('pasar y no responder producen resultados distintos', () => {
    // Misma matriz salvo que un bloque «pasa» en vez de «no responder». Si el cálculo colapsara
    // ambas cosas, los dos análisis serían idénticos. No lo son: quien pasó vio la afirmación y
    // decidió no pronunciarse, y eso es una postura; quien no respondió no estaba.
    const conPasos: MatrizVotos = [
      [1, 1, -1],
      [1, 1, -1],
      [1, 1, -1],
      [0, -1, 1],
      [0, -1, 1],
      [0, -1, 1],
    ];
    const conAusencias: MatrizVotos = [
      [1, 1, -1],
      [1, 1, -1],
      [1, 1, -1],
      [null, -1, 1],
      [null, -1, 1],
      [null, -1, 1],
    ];
    const a = analizarConsenso(conPasos, TEXTOS_CASO);
    const b = analizarConsenso(conAusencias, TEXTOS_CASO);
    expect(b.primeraComponente).not.toEqual(a.primeraComponente);
  });
});

describe('entrada degenerada', () => {
  it('si todo el mundo respondió igual, lo dice y lo dice siempre igual', () => {
    const M: MatrizVotos = Array.from({ length: 10 }, () =>
      Array.from({ length: 6 }, () => 1 as const),
    );
    const textos = textosDe(6);
    // No es un fallo del cálculo: es que no hay ninguna diferencia sobre la que agrupar.
    expect(() => analizarConsenso(M, textos)).toThrow(SinVariacion);
    // Y el desenlace es el mismo las veces que se repita: estable, no intermitente.
    const mensajes = Array.from({ length: 5 }, () => {
      try {
        analizarConsenso(M, textos);
        return 'sin error';
      } catch (e) {
        return `${(e as Error).name}: ${(e as Error).message}`;
      }
    });
    expect(new Set(mensajes).size).toBe(1);
  });

  it('lo mismo si nadie respondió nada', () => {
    const M: MatrizVotos = Array.from({ length: 5 }, () => Array.from({ length: 4 }, () => null));
    expect(() => analizarConsenso(M, textosDe(4))).toThrow(SinVariacion);
  });

  it('los errores se pueden distinguir en tiempo de ejecución, no sólo en los tipos', () => {
    // Si se exportaran sólo como tipo, `instanceof` no compilaría siquiera: la promesa de
    // «error tipado y nunca un valor aproximado» sería inservible para quien llama.
    const M: MatrizVotos = Array.from({ length: 6 }, () =>
      Array.from({ length: 4 }, () => -1 as const),
    );
    try {
      analizarConsenso(M, textosDe(4));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SinVariacion);
      expect(e).not.toBeInstanceOf(PcaNoConvergente);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('rechaza que sobren o falten textos de afirmación', () => {
    expect(() => analizarConsenso(CASO, ['sólo uno'])).toThrow(/una entrada por columna/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADR-0041 — nada de jerga en lo que se lee
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** Quita tildes y baja a minúsculas, para que «clúster» y «cluster» se detecten igual. */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const JERGA = [
  'pca',
  'componente principal',
  'componentes principales',
  'autovector',
  'autovalor',
  'k-means',
  'kmeans',
  'k-medias',
  'cluster',
  'silhouette',
  'silueta',
  'inercia',
  'eigen',
];

function sinJerga(textos: ReadonlyArray<string>, donde: string): void {
  for (const t of textos) {
    const n = normalizar(t);
    for (const palabra of JERGA) {
      if (n.includes(palabra)) {
        throw new Error(`jerga «${palabra}» en ${donde}: ${JSON.stringify(t)}`);
      }
    }
  }
}

describe('ADR-0041 — la interfaz habla en castellano llano', () => {
  it('los textos de pantalla no contienen jerga técnica', () => {
    const cadenas: string[] = [];
    for (const valor of Object.values(TEXTOS)) {
      if (typeof valor === 'string') cadenas.push(valor);
    }
    cadenas.push(TEXTOS.grupoNumero(1), TEXTOS.grupoNumero(7));
    cadenas.push(TEXTOS.pEstimada(0.5), TEXTOS.pEstimada(0.125));
    expect(cadenas.length).toBeGreaterThan(5);
    expect(() => {
      sinJerga(cadenas, 'TEXTOS');
    }).not.toThrow();
  });

  it('el informe ya montado tampoco', () => {
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    const p = aPantalla(r);
    const cadenas: string[] = [];
    for (const valor of Object.values(p.textos)) {
      if (typeof valor === 'string') cadenas.push(valor);
    }
    for (const af of [...p.afirmacionesPuente, ...p.afirmacionesDivisivas]) {
      cadenas.push(af.texto, af.grupoMinimo);
    }
    expect(() => {
      sinJerga(cadenas, 'informe');
    }).not.toThrow();
  });

  it('los mensajes de error tampoco, porque pueden acabar en pantalla', () => {
    const mensajes: string[] = [];
    const sinVariacion: MatrizVotos = Array.from({ length: 8 }, () =>
      Array.from({ length: 5 }, () => 1 as const),
    );
    try {
      analizarConsenso(sinVariacion, textosDe(5));
    } catch (e) {
      mensajes.push((e as Error).message);
    }
    // Y el de no convergencia, que era el que hablaba de «PCA» y de «componente principal».
    const err = new PcaNoConvergente(1, 1000, 1.3e-9, 1000);
    mensajes.push(err.message);
    mensajes.push(new SinVariacion(10, 6).message);
    expect(mensajes).toHaveLength(3);
    expect(() => {
      sinJerga(mensajes, 'mensajes de error');
    }).not.toThrow();
  });

  it('los grupos se presentan numerados desde 1', () => {
    expect(TEXTOS.grupoNumero(1)).toBe('Grupo 1');
    expect(TEXTOS.grupoNumero(3)).toBe('Grupo 3');
    const r = analizarConsenso(CASO, TEXTOS_CASO);
    const p = aPantalla(r);
    for (const af of p.afirmacionesPuente) {
      if (af.grupoMinimo !== '') {
        expect(af.grupoMinimo).toMatch(/^Grupo [1-9]\d*$/);
      }
    }
  });
});
