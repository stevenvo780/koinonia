/**
 * La regla de dependencia del ADR-0001 no se sostiene con disciplina: se verifica.
 * `packages/domain` no puede tener ninguna dependencia de tiempo de ejecución salvo, a lo sumo,
 * `@koinonia/crypto`; `packages/crypto` no puede tener ninguna.
 *
 * Este test comprueba las dos direcciones: que el repositorio cumple, y que el guardián **detecta**
 * una infracción cuando la hay (un guardián que nunca falla no prueba nada).
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARDIAN = join(RAIZ, 'scripts', 'check-domain-purity.mjs');
const temporales: string[] = [];

interface Manifiesto {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

function manifiesto(paquete: string): Manifiesto {
  return JSON.parse(
    readFileSync(join(RAIZ, 'packages', paquete, 'package.json'), 'utf8'),
  ) as Manifiesto;
}

/** Copia mínima del repositorio en la que se puede introducir una infracción sin ensuciar nada. */
function repoDePrueba(
  dependenciasDeDominio: Record<string, string>,
  fuenteDeDominio = 'export const x = 1;\n',
): string {
  const raiz = mkdtempSync(join(tmpdir(), 'koinonia-purity-'));
  temporales.push(raiz);
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  cpSync(GUARDIAN, join(raiz, 'scripts', 'check-domain-purity.mjs'));
  for (const paquete of ['domain', 'crypto']) {
    const destino = join(raiz, 'packages', paquete);
    mkdirSync(join(destino, 'src'), { recursive: true });
    writeFileSync(
      join(destino, 'src', 'index.ts'),
      paquete === 'domain' ? fuenteDeDominio : 'export const x = 1;\n',
    );
    writeFileSync(
      join(destino, 'package.json'),
      JSON.stringify({
        name: `@koinonia/${paquete}`,
        dependencies: paquete === 'domain' ? dependenciasDeDominio : {},
      }),
    );
  }
  return raiz;
}

function correrGuardian(raiz: string): { readonly ok: boolean; readonly salida: string } {
  try {
    const salida = execFileSync(
      process.execPath,
      [join(raiz, 'scripts', 'check-domain-purity.mjs')],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { ok: true, salida };
  } catch (error) {
    const fallo = error as { stdout?: string; stderr?: string };
    return { ok: false, salida: `${fallo.stdout ?? ''}${fallo.stderr ?? ''}` };
  }
}

afterAll(() => {
  for (const ruta of temporales) rmSync(ruta, { recursive: true, force: true });
});

describe('pureza del dominio (ADR-0001)', () => {
  it('packages/crypto no declara ninguna dependencia de runtime', () => {
    const paquete = manifiesto('crypto');
    expect(paquete.dependencies ?? {}).toStrictEqual({});
    expect(paquete.peerDependencies ?? {}).toStrictEqual({});
    expect(paquete.optionalDependencies ?? {}).toStrictEqual({});
  });

  it('packages/domain sólo puede depender de @koinonia/crypto', () => {
    const paquete = manifiesto('domain');
    for (const campo of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      for (const dependencia of Object.keys(paquete[campo] ?? {})) {
        expect(dependencia).toBe('@koinonia/crypto');
      }
    }
  });

  it('el guardián acepta el repositorio tal como está', () => {
    expect(correrGuardian(RAIZ).ok).toBe(true);
  });

  it('el guardián acepta @koinonia/crypto como dependencia del dominio', () => {
    expect(correrGuardian(repoDePrueba({ '@koinonia/crypto': 'workspace:*' })).ok).toBe(true);
  });

  it('el guardián RECHAZA una dependencia prohibida en el dominio', () => {
    const resultado = correrGuardian(repoDePrueba({ zod: '^3.0.0' }));
    expect(resultado.ok).toBe(false);
    expect(resultado.salida).toContain('dependencies.zod está prohibida');
  });

  it.each([
    ['import de Node', "import { readFileSync } from 'node:fs';\n", 'módulo de Node'],
    ['lectura del reloj', 'export const t = Date.now();\n', 'reloj'],
    ['aleatoriedad', 'export const r = Math.random();\n', 'aleatoriedad'],
    ['localeCompare', "export const c = 'a'.localeCompare('b');\n", 'localeCompare'],
  ])('el guardián RECHAZA %s en el código del dominio', (_nombre, fuente, motivo) => {
    const resultado = correrGuardian(repoDePrueba({}, fuente));
    expect(resultado.ok).toBe(false);
    expect(resultado.salida).toContain(motivo);
  });

  it('el guardián NO se dispara con menciones en comentarios', () => {
    const fuente =
      '// Prohibido: Date.now(), Math.random() y localeCompare().\nexport const x = 1;\n';
    expect(correrGuardian(repoDePrueba({}, fuente)).ok).toBe(true);
  });
});
