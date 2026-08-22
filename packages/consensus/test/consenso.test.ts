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

import { analizarConsenso, aPantalla, TEXTOS, UMBRAL_NO_FACCION } from '../src/index.js';
import { kMaximoPara } from '../src/kmeans.js';
import { Z_SIGNIFICACION_90, zContraElAzar } from '../src/statements.js';
import { PcaNoConvergente, SinVariacion } from '../src/types.js';
import type { MatrizVotos, ResultadoConsenso } from '../src/types.js';

import {
  conGrupos,
  dosBloques,
  matrizAleatoria,
  matrizConFacciones,
  matrizHomogenea,
  textosDe,
} from './matrices.js';

/** Atajo: analiza y exige que hayan salido grupos. */
function analizar(M: MatrizVotos, textos: ReadonlyArray<string>): ResultadoConsenso {
  return conGrupos(analizarConsenso(M, textos));
}

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
    const r = analizar(CASO, TEXTOS_CASO);
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
    const r = analizar(CASO, TEXTOS_CASO);
    expect(r.grupos.map((g) => g.id)).toEqual([1, 2]);
    for (const g of r.asignaciones) {
      expect(g).toBeGreaterThanOrEqual(1);
      expect(g).toBeLessThanOrEqual(r.grupos.length);
    }
  });

  it('cada persona está en un grupo y sólo en uno, y las cuentas cuadran', () => {
    const r = analizar(CASO, TEXTOS_CASO);
    const suma = r.grupos.reduce((acc, g) => acc + g.tamano, 0);
    expect(suma).toBe(r.participantesConsiderados);
    expect(suma).toBe(CASO.length);
    const porGrupo = new Map<number, number>();
    for (const g of r.asignaciones) porGrupo.set(g, (porGrupo.get(g) ?? 0) + 1);
    for (const grupo of r.grupos) {
      expect(porGrupo.get(grupo.id) ?? 0).toBe(grupo.tamano);
    }
  });

  it('ordena las afirmaciones de más a menos acuerdo transversal', () => {
    const r = analizar(CASO, TEXTOS_CASO);
    // Se mira la tabla COMPLETA y no la lista publicable: con seis personas ninguna afirmación
    // supera el filtro de significación de ADR-0038, y es correcto que no lo supere. Lo que se
    // comprueba aquí es el `GIC` y su orden, que es lo que esta prueba siempre vigiló.
    const indices = r.afirmacionesPuntuadas.map((a) => a.indiceOriginal);
    // La 0 la comparten los dos bloques; la 1 los separa; la 2 la rechazan todos.
    expect(indices).toEqual([0, 1, 2]);
    // GIC de la afirmación 0 = (2/3) · (4/5): un bloque respondió 1 de 1, el otro 3 de 3.
    expect(r.afirmacionesPuntuadas[0]?.metrica).toBeCloseTo((2 / 3) * (4 / 5), 12);
    expect(r.afirmacionesPuntuadas[1]?.metrica).toBeCloseTo(0.8 * 0.2, 12);
    expect(r.afirmacionesPuntuadas[2]?.metrica).toBeCloseTo(0.2 * 0.2, 12);
  });

  it('cada afirmación del informe lleva SU propio texto, no el de otra', () => {
    // Ésta es la comprobación que delata una traducción de índices mal hecha. El orden interno
    // de columnas de este caso no es el de entrada, así que aplicar la permutación donde no
    // toca deja los números bien ordenados pero colgando de la afirmación equivocada.
    const r = analizar(CASO, TEXTOS_CASO);
    const pantalla = aPantalla(r);
    expect(r.textos[r.afirmacionesPuntuadas[0]?.indiceOriginal ?? -1]).toBe(
      'Merece la pena seguir hablando de esto',
    );
    expect(r.textos[r.afirmacionesPuntuadas[2]?.indiceOriginal ?? -1]).toBe(
      'Conviene dejarlo todo igual',
    );
    // Y la más divisiva es la que separa a los bloques.
    expect(pantalla.tipo).toBe('GruposDetectados');
    if (pantalla.tipo !== 'GruposDetectados') return;
    expect(pantalla.afirmacionesDivisivas[0]?.texto).toBe('Hay que aprobarlo tal como está');
  });

  it('con datos suficientes, el informe de pantalla sí lleva afirmaciones puente con su texto', () => {
    // El mismo contrato de arriba, pero sobre una entrada del tamaño para el que el análisis
    // está pensado: aquí la lista publicable no está vacía y se comprueba que cada número
    // sigue colgando de su afirmación.
    const M = dosBloques(60, 12);
    const textos = Array.from(
      { length: 12 },
      (_, j) => `Afirmación distinta número ${(j + 1).toString()}`,
    );
    const r = analizar(M, textos);
    const pantalla = aPantalla(r);
    expect(pantalla.tipo).toBe('GruposDetectados');
    if (pantalla.tipo !== 'GruposDetectados') return;
    expect(pantalla.afirmacionesPuente.length).toBeGreaterThan(0);
    r.afirmacionesPuente.forEach((af, i) => {
      expect(pantalla.afirmacionesPuente[i]?.texto).toBe(textos[af.indiceOriginal]);
    });
  });

  it('las probabilidades publicadas coinciden con las recalculadas desde la matriz', () => {
    for (const semilla of [3, 11, 29, 47]) {
      const M = matrizConFacciones(45, 9, 3, semilla);
      const textos = textosDe(9);
      let r: ResultadoConsenso;
      try {
        r = conGrupos(analizarConsenso(M, textos));
      } catch (e) {
        expect(e instanceof PcaNoConvergente || e instanceof SinVariacion).toBe(true);
        continue;
      }
      for (const af of [...r.afirmacionesPuntuadas, ...r.afirmacionesDivisivas]) {
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
        if (r.afirmacionesPuntuadas.includes(af)) {
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
        r = conGrupos(analizarConsenso(M, textosDe(8)));
      } catch {
        continue;
      }
      for (const af of [...r.afirmacionesPuntuadas, ...r.afirmacionesDivisivas]) {
        for (const p of af.probabilidadesPorGrupo) {
          expect(p).toBeGreaterThan(0);
          expect(p).toBeLessThan(1);
        }
      }
    }
  });

  it('con unanimidad en contra sigue habiendo margen, y con unanimidad a favor también', () => {
    const r = analizar(CASO, TEXTOS_CASO);
    const todas = [...r.afirmacionesPuntuadas, ...r.afirmacionesDivisivas];
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
    const r = analizar(M, TEXTOS_CASO);
    const af = r.afirmacionesPuntuadas.find((a) => a.indiceOriginal === 0);
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
          r = conGrupos(analizarConsenso(M, textosDe(8)));
        } catch {
          continue;
        }
        expect(r.k).toBeGreaterThanOrEqual(2);
        expect(r.k).toBeLessThanOrEqual(r.kMaximo);
        expect(r.kMaximo).toBe(kMaximoPara(n));
        // ADR-0038: nunca más de cinco grupos, tenga la asamblea el tamaño que tenga.
        expect(r.k).toBeLessThanOrEqual(5);
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
    const a = analizar(conPasos, TEXTOS_CASO);
    const b = analizar(conAusencias, TEXTOS_CASO);
    expect(b.primeraComponente).not.toEqual(a.primeraComponente);
  });

  it('quien pasa a todo no acaba junto a quien no vio nada', () => {
    // El corolario en el pipeline completo de que `paso` y ausencia no se colapsan: un bloque que
    // pasó a todas las afirmaciones tiene una postura observada («las vi y no me pronuncio») y
    // otro que no vio ninguna no tiene ninguna. Con la máscara, el primero se ajusta sobre sus
    // observaciones y el segundo no tiene nada sobre lo que ajustarse.
    const conPostura: MatrizVotos = Array.from({ length: 12 }, () => [1, 1, -1, 1, -1, 1]);
    const pasaronATodo: MatrizVotos = Array.from({ length: 6 }, () => [0, 0, 0, 0, 0, 0]);
    const contrario: MatrizVotos = Array.from({ length: 6 }, () => [-1, -1, 1, -1, 1, -1]);
    const M: MatrizVotos = [...conPostura, ...pasaronATodo, ...contrario];
    const r = analizar(M, textosDe(6));
    // Los que pasaron a todo quedan juntos, y no revueltos con ninguno de los dos bloques.
    const pasaron = new Set(r.asignaciones.slice(12, 18));
    expect(pasaron.size).toBe(1);
    expect(pasaron.has(r.asignaciones[0] ?? -1)).toBe(false);
    expect(pasaron.has(r.asignaciones[18] ?? -1)).toBe(false);
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
    const r = analizar(CASO, TEXTOS_CASO);
    const p = aPantalla(r);
    const cadenas: string[] = [];
    for (const valor of Object.values(p.textos)) {
      if (typeof valor === 'string') cadenas.push(valor);
    }
    expect(p.tipo).toBe('GruposDetectados');
    if (p.tipo !== 'GruposDetectados') return;
    cadenas.push(p.titulo, p.descripcion);
    for (const af of [...p.afirmacionesPuente, ...p.afirmacionesDivisivas]) {
      cadenas.push(af.texto, af.grupoMinimo);
    }
    expect(() => {
      sinJerga(cadenas, 'informe');
    }).not.toThrow();
  });

  it('el informe de «no hay grupos claros» tampoco, que es el que más se va a leer', () => {
    const p = aPantalla(analizarConsenso(matrizHomogenea(16, 20, 4), textosDe(20)));
    expect(p.tipo).toBe('FaccionesNoDetectadas');
    if (p.tipo !== 'FaccionesNoDetectadas') return;
    const cadenas: string[] = [
      p.titulo,
      p.descripcion,
      p.acuerdoGeneralTitulo,
      p.acuerdoGeneralDescripcion,
      p.aviso,
    ];
    for (const af of p.acuerdoGeneral) cadenas.push(af.texto, af.grupoMinimo);
    expect(() => {
      sinJerga(cadenas, 'informe sin grupos');
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
    const r = analizar(CASO, TEXTOS_CASO);
    const p = aPantalla(r);
    expect(p.tipo).toBe('GruposDetectados');
    if (p.tipo !== 'GruposDetectados') return;
    for (const af of p.afirmacionesPuente) {
      if (af.grupoMinimo !== '') {
        expect(af.grupoMinimo).toMatch(/^Grupo [1-9]\d*$/);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADR-0038 — umbral de no-facción: «no hay grupos claros» es un resultado
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('ADR-0038 — el umbral de no-facción', () => {
  it('con opiniones homogéneas no inventa grupos: dice que no los hay', () => {
    const r = analizarConsenso(matrizHomogenea(16, 20, 4), textosDe(20));
    expect(r.tipo).toBe('FaccionesNoDetectadas');
    if (r.tipo !== 'FaccionesNoDetectadas') return;
    expect(r.separacionMaxima).toBeLessThan(UMBRAL_NO_FACCION);
    expect(r.umbral).toBe(0.25);
    expect(r.participantesConsiderados).toBe(16);
    // ADR-0038 exige «caso explícito y nunca ausencia de evento»: se dice qué se examinó.
    expect(r.kExaminados).toEqual([2]);
  });

  it('y la persona lee exactamente «No hay grupos claros»', () => {
    // `PRODUCT.md` §4 promete esa frase literal para la pantalla «Consenso». Es la única
    // comprobación que impide que la promesa se quede en el documento.
    const p = aPantalla(analizarConsenso(matrizHomogenea(16, 20, 4), textosDe(20)));
    expect(p.tipo).toBe('FaccionesNoDetectadas');
    if (p.tipo !== 'FaccionesNoDetectadas') return;
    expect(p.titulo).toBe('No hay grupos claros');
    expect(p.descripcion).toContain('es un resultado');
    expect(p.descripcion).toContain('no hay posturas enfrentadas');
    // No es un error: es una de las dos formas normales de terminar.
    expect(p.descripcion).toContain('No es un fallo');
  });

  it('sin grupos sigue publicando el acuerdo general, que es lo que hay que publicar', () => {
    // «Sin facciones claras → se publica sólo el consenso». Aquí la población entera es el
    // único grupo, así que el GIC es el acuerdo general y el filtro z₁ se aplica igual.
    const r = analizarConsenso(matrizHomogenea(16, 20, 4), textosDe(20));
    expect(r.tipo).toBe('FaccionesNoDetectadas');
    if (r.tipo !== 'FaccionesNoDetectadas') return;
    expect(r.afirmacionesPuente.length).toBeGreaterThan(0);
    expect(r.afirmacionesPuntuadas).toHaveLength(20);
    for (const af of r.afirmacionesPuente) {
      // Un solo grupo, y todas las probabilidades siguen dentro de (0,1) por Laplace.
      expect(af.probabilidadesPorGrupo).toHaveLength(1);
      expect(af.cumpleFiltroZ).toBe(true);
    }
    const p = aPantalla(r);
    if (p.tipo !== 'FaccionesNoDetectadas') return;
    expect(p.acuerdoGeneral.length).toBe(r.afirmacionesPuente.length);
    expect(p.aviso).toBe('');
  });

  it('con ruido puro tampoco reparte a la gente en bandos', () => {
    const r = analizarConsenso(matrizAleatoria(14, 12, 10), textosDe(12));
    expect(r.tipo).toBe('FaccionesNoDetectadas');
    if (r.tipo !== 'FaccionesNoDetectadas') return;
    expect(r.separacionMaxima).toBeLessThan(UMBRAL_NO_FACCION);
    // Ruido puro: ni siquiera hay acuerdo general que destacar, y se avisa en vez de callar.
    const p = aPantalla(r);
    if (p.tipo !== 'FaccionesNoDetectadas') return;
    expect(p.acuerdoGeneral).toHaveLength(0);
    expect(p.aviso).toBe(TEXTOS.sinAcuerdoDestacable);
  });

  it('pero con dos bloques nítidos sigue encontrando los dos grupos', () => {
    // La otra mitad del contrato: un umbral que nunca deja pasar nada sería igual de inútil.
    for (const [n, m] of [
      [20, 8],
      [40, 12],
      [60, 20],
      [100, 30],
    ] as const) {
      const r = analizarConsenso(dosBloques(n, m), textosDe(m));
      expect(r.tipo).toBe('GruposDetectados');
      if (r.tipo !== 'GruposDetectados') continue;
      expect(r.k).toBe(2);
      expect(r.grupos.map((g) => g.tamano)).toEqual([n / 2, n / 2]);
      expect(r.separacionMaxima).toBeGreaterThanOrEqual(UMBRAL_NO_FACCION);
      // Los de arriba juntos, los de abajo juntos, y en grupos distintos.
      const arriba = new Set(r.asignaciones.slice(0, n / 2));
      const abajo = new Set(r.asignaciones.slice(n / 2));
      expect(arriba.size).toBe(1);
      expect(abajo.size).toBe(1);
      expect([...arriba][0]).not.toBe([...abajo][0]);
    }
  });

  it('el desenlace sin grupos es tan reproducible como el otro', () => {
    const M = matrizHomogenea(16, 20, 4);
    const a = analizarConsenso(M, textosDe(20));
    const b = analizarConsenso(M, textosDe(20));
    expect(b).toEqual(a);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADR-0038 — filtro de significación z₁ > 1,2816
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('ADR-0038 — el filtro z₁ > 1,2816', () => {
  it('usa la fórmula del ADR: z₁ = 2·√n_v·(p̂ − 0,5)', () => {
    expect(Z_SIGNIFICACION_90).toBe(1.2816);
    // Ocho de nueve, con Laplace p̂ = 9/11: claramente distinto del azar.
    expect(zContraElAzar(9 / 11, 9)).toBeCloseTo(2 * 3 * (9 / 11 - 0.5), 12);
    expect(zContraElAzar(9 / 11, 9)).toBeGreaterThan(Z_SIGNIFICACION_90);
    // Tres de tres, con Laplace p̂ = 4/5: alto, pero sobre tres respuestas no dice nada.
    expect(zContraElAzar(4 / 5, 3)).toBeLessThan(Z_SIGNIFICACION_90);
    // Y el empate a la mitad da exactamente cero, sea cual sea el número de respuestas.
    expect(zContraElAzar(0.5, 1000)).toBe(0);
  });

  it('deja fuera la afirmación que sólo vieron seis personas, aunque su GIC la colocaría arriba', () => {
    // El agujero que el filtro tapa. Sobre dos bloques nítidos se añade una afirmación que sólo
    // vieron tres personas de cada grupo, y las seis dijeron que sí. Con el suavizado de Laplace
    // su GIC es (4/5)² = 0,64: por encima del de TODAS las afirmaciones que separan a los
    // bloques, así que sin filtro se colaría en el temario de la asamblea por delante de ellas
    // con seis respuestas detrás.
    const base = dosBloques(60, 12);
    const M: MatrizVotos = base.map((fila, i) => [
      ...fila,
      i === 0 || i === 1 || i === 2 || i === 30 || i === 31 || i === 32 ? 1 : null,
    ]);
    const r = analizar(M, textosDe(13));

    const escasa = r.afirmacionesPuntuadas.find((a) => a.indiceOriginal === 12);
    expect(escasa).toBeDefined();
    if (escasa === undefined) return;

    // 1. Sólo seis observaciones, tres por grupo, y GIC alto: es justo el problema.
    expect(escasa.observaciones).toBe(6);
    expect(escasa.probabilidadesPorGrupo).toEqual([0.8, 0.8]);
    expect(escasa.metrica).toBeCloseTo(0.64, 12);
    // 2. Y por GIC entraría: en la tabla completa va la cuarta, justo detrás de las tres que sí
    //    se publican y por delante de todas las demás. Sin filtro sería la cuarta del temario.
    expect(r.afirmacionesPuente).toHaveLength(3);
    expect(r.afirmacionesPuntuadas[3]?.indiceOriginal).toBe(12);
    // Dicho de otro modo: es la afirmación de MAYOR acuerdo transversal que el filtro descarta.
    const descartadas = r.afirmacionesPuntuadas.filter((a) => !a.cumpleFiltroZ);
    expect(descartadas[0]?.indiceOriginal).toBe(12);
    // 3. Pero no supera el filtro: z₁ = 2·√3·(0,8 − 0,5) = 1,039 < 1,2816.
    expect(escasa.zMinimo).toBeCloseTo(2 * Math.sqrt(3) * 0.3, 12);
    expect(escasa.zMinimo).toBeLessThan(Z_SIGNIFICACION_90);
    expect(escasa.cumpleFiltroZ).toBe(false);
    // 4. Así que la lista publicable la deja fuera, y la tabla completa la sigue mostrando para
    //    que quien audite vea qué se descartó y por qué.
    expect(r.afirmacionesPuente.map((a) => a.indiceOriginal)).not.toContain(12);
    expect(r.afirmacionesPuntuadas.map((a) => a.indiceOriginal)).toContain(12);
  });

  it('exige el umbral en TODOS los grupos, no en el promedio', () => {
    // ADR-0038 lo hereda de la fórmula operativa: `z₁(g,c) > 1,2816 para TODO g`. Un grupo que
    // no se pronuncia con claridad basta para que la afirmación no sea puente, igual que en el
    // producto un grupo disidente basta para hundir el GIC.
    const r = analizar(dosBloques(60, 12), textosDe(12));
    for (const af of r.afirmacionesPuente) {
      const zs = af.probabilidadesPorGrupo.map((p) => zContraElAzar(p, 0));
      expect(zs.length).toBeGreaterThan(0);
      expect(af.zMinimo).toBeGreaterThan(Z_SIGNIFICACION_90);
    }
    // Y todo lo descartado tiene al menos un grupo por debajo.
    for (const af of r.afirmacionesPuntuadas) {
      if (af.cumpleFiltroZ) continue;
      expect(af.zMinimo).toBeLessThanOrEqual(Z_SIGNIFICACION_90);
    }
  });

  it('la lista de divisivas NO se filtra: se publica precisamente porque no hay acuerdo', () => {
    const r = analizar(dosBloques(60, 12), textosDe(12));
    expect(r.afirmacionesDivisivas).toHaveLength(12);
    expect(r.afirmacionesDivisivas.some((a) => !a.cumpleFiltroZ)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ADR-0038 — histéresis entre instantáneas sucesivas
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('ADR-0038 — la histéresis entre instantáneas', () => {
  it('un cambio pequeño no renumera ni reorganiza los grupos', () => {
    // Dos instantáneas del mismo sondeo: entre una y otra cambian seis votos de setecientos
    // veinte. Sin histéresis el análisis se descuelga a tres grupos y reparte a la gente de
    // otra manera; con la instantánea anterior delante, se queda como estaba.
    const m = 12;
    const primera = analizar(dosBloques(40, m), textosDe(m));
    const despues = dosBloques(40, m, 6, 99);

    const sinHisteresis = conGrupos(analizarConsenso(despues, textosDe(m)));
    const conHisteresis = conGrupos(
      analizarConsenso(despues, textosDe(m), { anterior: primera.instantanea }),
    );

    // Sin histéresis, el mapa cambia aunque casi nada haya cambiado.
    expect(sinHisteresis.k).not.toBe(primera.k);
    expect(sinHisteresis.asignaciones).not.toEqual(primera.asignaciones);

    // Con histéresis: mismo número de grupos, misma numeración, mismas personas en cada uno.
    expect(conHisteresis.k).toBe(primera.k);
    expect(conHisteresis.kConservadoPorHisteresis).toBe(true);
    expect(conHisteresis.asignaciones).toEqual(primera.asignaciones);
  });

  it('conserva el NOMBRE de cada grupo aunque el mapa se dé la vuelta', () => {
    // La numeración por defecto ordena los grupos por su primera coordenada. Un cambio mínimo
    // que invierta el eje intercambia los nombres y el informe parece otro sin serlo. Con la
    // instantánea anterior, cada grupo se queda con el nombre que ya tenía.
    const m = 8;
    const M1 = matrizConFacciones(20, m, 2, 17);
    const primera = analizar(M1, textosDe(m));

    const M2 = M1.map((f) => [...f]);
    const fila = M2[4];
    expect(fila?.[4]).toBeDefined();
    if (fila === undefined) return;
    fila[4] = fila[4] === 1 ? -1 : 1;

    const sinHisteresis = conGrupos(analizarConsenso(M2, textosDe(m)));
    const conHisteresis = conGrupos(
      analizarConsenso(M2, textosDe(m), { anterior: primera.instantanea }),
    );

    const cambiadosSin = contarCambios(primera.asignaciones, sinHisteresis.asignaciones);
    const cambiadosCon = contarCambios(primera.asignaciones, conHisteresis.asignaciones);

    // Sin histéresis, cambiar UN voto renumera a la mayoría de la asamblea.
    expect(cambiadosSin).toBeGreaterThan(10);
    // Con histéresis, sólo se mueve quien de verdad se movió.
    expect(cambiadosCon).toBeLessThanOrEqual(1);
  });

  it('no es un candado: si la estructura cambia de verdad, el número de grupos cambia', () => {
    // Una histéresis que nunca cediera congelaría el mapa en una foto vieja. Se parte de una
    // instantánea con dos grupos y se analiza una matriz con tres facciones nítidas.
    const m = 20;
    const M = matrizConFacciones(90, m, 3, 5);
    const anterior = {
      k: 2,
      centros: [
        [-1, 0],
        [1, 0],
      ],
    } as const;
    const r = conGrupos(analizarConsenso(M, textosDe(m), { anterior }));
    expect(r.k).toBe(3);
    expect(r.kConservadoPorHisteresis).toBe(false);
  });

  it('la instantánea que se devuelve es la que hay que volver a pasar', () => {
    const m = 12;
    const r = analizar(dosBloques(40, m), textosDe(m));
    expect(r.instantanea.k).toBe(r.k);
    expect(r.instantanea.centros).toHaveLength(r.k);
    for (const c of r.instantanea.centros) {
      expect(c).toHaveLength(2);
      for (const x of c) expect(Number.isFinite(x)).toBe(true);
    }
  });
});

function contarCambios(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) n++;
  }
  return n;
}
