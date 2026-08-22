/**
 * ADR-0040 — «no existe endpoint que ordene miembros por cumplimiento».
 *
 * El encargo pide que la comprobación sea **algo más que una convención de nombres**. Un test que
 * mirara si existe un fichero llamado `ranking.ts` no comprueba nada: la lista de personas
 * ordenadas por actividad cabe perfectamente dentro de una función llamada
 * `resumenDeParticipacionPorCirculo`.
 *
 * Aquí se comprueban las dos barreras reales:
 *
 *  1. **La del compilador.** Se invoca a `tsc` sobre fragmentos que intentan declarar exactamente
 *     el artefacto prohibido, y se exige que produzca un error. No se comprueba que el guardián
 *     exista: se comprueba que muerde. Y el caso de control —una salida legítimamente agregada—
 *     tiene que compilar sin una sola queja, porque un guardián que rechaza todo tampoco protege
 *     nada, sólo se desactiva antes.
 *  2. **La del tiempo de ejecución.** `sellar()` recorre la salida real. Se le dan las formas con
 *     las que una identidad se escapa de verdad: enterrada en un arreglo anidado, usada como
 *     **clave** de objeto, interpolada dentro de una frase, o metida en un `Map`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { FugaDeIdentidadError, identidadMiembro, sellar } from '../src/index.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_TYPES = resolve(AQUI, '../src/types.ts');

/** Especificador relativo desde `dir` hasta `src/types.ts`, con la extensión `.js` que exige NodeNext. */
function especificadorHacia(dir: string): string {
  const relativo = relative(dir, RUTA_TYPES).replace(/\.ts$/u, '.js');
  return relativo.startsWith('.') ? relativo : `./${relativo}`;
}

/** Compila `fragmento` contra los tipos reales del paquete y devuelve sus errores. */
function erroresAlCompilar(fragmento: string): readonly string[] {
  const dir = mkdtempSync(join(tmpdir(), 'koinonia-metrics-'));
  const ruta = join(dir, 'guarda.ts');
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}', 'utf8');
  writeFileSync(
    ruta,
    `import type { Agregado, IdentidadMiembro } from '${especificadorHacia(dir)}';\n${fragmento}\n`,
    'utf8',
  );
  try {
    const programa = ts.createProgram([ruta], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
    });
    return ts
      .getPreEmitDiagnostics(programa)
      .filter((d) => d.file !== undefined && d.file.fileName.endsWith('guarda.ts'))
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('ADR-0040 / capa 1 — el compilador rechaza la métrica individual', () => {
  it('el caso de control compila: una salida agregada es perfectamente legal', () => {
    const errores = erroresAlCompilar(`
      interface SaludDelCirculo {
        readonly circulo: string;
        readonly cumplidos: number;
        readonly deuda: number;
      }
      export function resumen(): Agregado<SaludDelCirculo> {
        return { circulo: 'secretaría', cumplidos: 3, deuda: 1 };
      }
    `);
    expect(errores).toEqual([]);
  });

  it('NO se puede declarar una función que devuelva miembros ordenados por actividad', () => {
    const errores = erroresAlCompilar(`
      interface FilaDeRanking {
        readonly quien: IdentidadMiembro;
        readonly aportes: number;
      }
      export function miembrosPorActividad(): Agregado<readonly FilaDeRanking[]> {
        return [];
      }
    `);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.join(' ')).toMatch(/not assignable to type 'never'/u);
  });

  it('tampoco con la identidad enterrada tres niveles abajo', () => {
    const errores = erroresAlCompilar(`
      interface Hoja { readonly persona: IdentidadMiembro }
      interface Rama { readonly hojas: readonly Hoja[] }
      interface Tronco { readonly ramas: readonly { readonly rama: Rama }[] }
      export function panel(): Agregado<Tronco> {
        return { ramas: [] };
      }
    `);
    expect(errores.length).toBeGreaterThan(0);
  });

  it('tampoco como clave de un mapa, ni dentro de un conjunto', () => {
    const conMapa = erroresAlCompilar(`
      export function porPersona(): Agregado<ReadonlyMap<IdentidadMiembro, number>> {
        return new Map();
      }
    `);
    const conConjunto = erroresAlCompilar(`
      export function nucleo(): Agregado<{ readonly gente: ReadonlySet<IdentidadMiembro> }> {
        return { gente: new Set() };
      }
    `);
    expect(conMapa.length).toBeGreaterThan(0);
    expect(conConjunto.length).toBeGreaterThan(0);
  });

  it('tampoco escondida detrás de una función que la devuelva', () => {
    // Una salida que lleva una función es una salida cuyo contenido no se puede acotar. Se rechaza.
    const errores = erroresAlCompilar(`
      export function perezoso(): Agregado<{ readonly abrir: () => IdentidadMiembro[] }> {
        return { abrir: () => [] };
      }
    `);
    expect(errores.length).toBeGreaterThan(0);
  });
});

describe('ADR-0040 / capa 2 — el sellado rechaza la fuga en tiempo de ejecución', () => {
  const ana = identidadMiembro('p#0001');
  const luis = identidadMiembro('p#0002');
  const padron = [ana, luis];

  it('deja pasar una salida agregada', () => {
    const salida = { personas: 2, cobertura: { num: 1n, den: 2n }, circulo: 'secretaría' };
    expect(sellar(salida, padron)).toBe(salida);
  });

  it('LA LISTA PROHIBIDA: personas ordenadas por actividad no puede salir de aquí', () => {
    const ranking = [
      { quien: luis, aportes: 41 },
      { quien: ana, aportes: 12 },
    ];
    expect(() => sellar(ranking, padron)).toThrow(FugaDeIdentidadError);
  });

  it('ni disfrazada de clave de objeto', () => {
    const panel = { porPersona: { [ana]: 12, [luis]: 41 } };
    expect(() => sellar(panel, padron)).toThrow(FugaDeIdentidadError);
  });

  it('ni interpolada dentro de una frase', () => {
    const panel = { titular: `Quien más participó este mes fue ${luis}, con 41 intervenciones.` };
    expect(() => sellar(panel, padron)).toThrow(FugaDeIdentidadError);
  });

  it('ni dentro de un Map o de un Set', () => {
    expect(() => sellar({ m: new Map([[ana, 3]]) }, padron)).toThrow(FugaDeIdentidadError);
    expect(() => sellar({ s: new Set([luis]) }, padron)).toThrow(FugaDeIdentidadError);
  });

  it('el error dice DÓNDE, y no copia el identificador que acaba de impedir publicar', () => {
    try {
      sellar({ nucleo: [{ quien: ana }] }, padron);
      expect.unreachable('debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(FugaDeIdentidadError);
      const fuga = error as FugaDeIdentidadError;
      expect(fuga.ruta).toBe('salida.nucleo[0].quien');
      expect(fuga.message).not.toContain(ana);
      expect(fuga.code).toBe('FUGA_DE_IDENTIDAD');
    }
  });

  it('aguanta una estructura cíclica sin quedarse dando vueltas', () => {
    const nodo: { yo?: unknown; texto: string } = { texto: 'sin nadie dentro' };
    nodo.yo = nodo;
    expect(() => sellar(nodo, padron)).not.toThrow();
  });

  it('sin identidades en la entrada no hay nada que buscar, y no revienta', () => {
    expect(() => sellar({ lo: 'que sea' }, [])).not.toThrow();
  });
});
