/**
 * La regla de dependencia del ADR-0001 no se sostiene con disciplina: se verifica.
 * `packages/domain` no puede tener ninguna dependencia de tiempo de ejecución salvo, a lo sumo,
 * `@koinonia/crypto`; `packages/crypto` y `packages/consensus` no pueden tener ninguna;
 * `packages/metrics` sólo `@koinonia/domain`.
 *
 * Este test comprueba las dos direcciones: que el repositorio cumple, y que el guardián **detecta**
 * una infracción cuando la hay (un guardián que nunca falla no prueba nada).
 *
 * ⚠ 2026-08: este fichero se quedó viejo. Se añadió `packages/metrics` al guardián y aquí no, y las
 * nueve pruebas sintéticas se rompieron con `ENOENT` mientras la que cuenta ocurrencias de
 * `packages/` fallaba por un 4 contra un 3. El molde ahora deriva de una sola lista, `REVISADOS`,
 * que lleva **la concesión de cada paquete**, y hay una fila de rechazo por paquete cubierto: si
 * mañana entra un quinto, basta añadir la fila y todo lo demás se genera.
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

/**
 * Los paquetes que el guardián revisa, **con la dependencia que cada uno tiene concedida**. La lista
 * está duplicada a propósito respecto de `PERMITIDAS` en el script: si alguien añade un paquete allí
 * y no aquí, el test «acepta el repositorio tal como está» sigue en verde pero los sintéticos fallan
 * con `ENOENT`, que es exactamente la señal de que hay que actualizar el molde. El test del mensaje
 * de salida, más abajo, cierra la otra dirección.
 *
 * Que aquí figure la **concesión** y no sólo el nombre es lo que permite la prueba diferencial:
 * `@koinonia/crypto` es legal en `domain` e ilegal en `metrics`, y `@koinonia/domain` al revés. Un
 * guardián que sólo supiera la lista de paquetes pasaría las dos.
 */
const REVISADOS = [
  { paquete: 'domain', permitida: '@koinonia/crypto' },
  { paquete: 'crypto', permitida: undefined },
  { paquete: 'consensus', permitida: undefined },
  { paquete: 'metrics', permitida: '@koinonia/domain' },
] as const;

type Paquete = (typeof REVISADOS)[number]['paquete'];

interface RepoSintetico {
  /** Dependencias de runtime por paquete. Lo que no se nombra va sin dependencias. */
  readonly dependencias?: Partial<Record<Paquete, Record<string, string>>>;
  /** Fuente de `src/index.ts` por paquete. Lo que no se nombra lleva un módulo trivial. */
  readonly fuentes?: Partial<Record<Paquete, string>>;
}

const FUENTE_TRIVIAL = 'export const x = 1;\n';

/** Copia mínima del repositorio en la que se puede introducir una infracción sin ensuciar nada. */
function repoDePrueba({ dependencias = {}, fuentes = {} }: RepoSintetico = {}): string {
  const raiz = mkdtempSync(join(tmpdir(), 'koinonia-purity-'));
  temporales.push(raiz);
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  cpSync(GUARDIAN, join(raiz, 'scripts', 'check-domain-purity.mjs'));
  for (const { paquete } of REVISADOS) {
    const destino = join(raiz, 'packages', paquete);
    mkdirSync(join(destino, 'src'), { recursive: true });
    writeFileSync(join(destino, 'src', 'index.ts'), fuentes[paquete] ?? FUENTE_TRIVIAL);
    writeFileSync(
      join(destino, 'package.json'),
      JSON.stringify({ name: `@koinonia/${paquete}`, dependencies: dependencias[paquete] ?? {} }),
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

  it('packages/consensus no declara ninguna dependencia de runtime', () => {
    const paquete = manifiesto('consensus');
    expect(paquete.dependencies ?? {}).toStrictEqual({});
    expect(paquete.peerDependencies ?? {}).toStrictEqual({});
    expect(paquete.optionalDependencies ?? {}).toStrictEqual({});
  });

  it('packages/metrics sólo puede depender de @koinonia/domain', () => {
    const paquete = manifiesto('metrics');
    for (const campo of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      for (const dependencia of Object.keys(paquete[campo] ?? {})) {
        expect(dependencia).toBe('@koinonia/domain');
      }
    }
  });

  it('el guardián acepta el repositorio tal como está', () => {
    expect(correrGuardian(RAIZ).ok).toBe(true);
  });

  /**
   * El mensaje de éxito es una afirmación sobre lo que se revisó, y por tanto tiene que ser
   * comprobable. Un guardián que anuncia cuatro paquetes revisando tres es peor que ninguno: da por
   * cubierto lo que nadie mira. Y uno que dice el nombre pero calla la concesión —«revisé
   * packages/metrics» sin añadir «sólo @koinonia/domain»— oculta justo el dato que importa.
   */
  it('el mensaje de éxito nombra exactamente los paquetes que revisa y qué le concede a cada uno', () => {
    const salida = correrGuardian(RAIZ).salida;
    for (const { paquete, permitida } of REVISADOS) {
      expect(salida).toContain(
        permitida === undefined ? `packages/${paquete}` : `packages/${paquete} (sólo ${permitida})`,
      );
    }
    expect(salida.match(/packages\//gu) ?? []).toHaveLength(REVISADOS.length);
  });

  /**
   * El corazón del test: **cada** paquete cubierto tiene que ver rechazada una dependencia ajena.
   * Que el guardián detecte a `zod` en `domain` no dice nada de si mira siquiera `metrics`; hasta
   * 2026-08 no lo miraba, y el molde de este fichero no se enteró.
   */
  it.each(REVISADOS.map(({ paquete }) => paquete))(
    'el guardián RECHAZA una dependencia prohibida en packages/%s',
    (paquete) => {
      const resultado = correrGuardian(
        repoDePrueba({ dependencias: { [paquete]: { 'ml-kmeans': '^6.0.0' } } }),
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.salida).toContain(`packages/${paquete}/package.json`);
      expect(resultado.salida).toContain('dependencies.ml-kmeans está prohibida');
    },
  );

  it.each(['peerDependencies', 'optionalDependencies'] as const)(
    'el guardián mira también %s, no sólo dependencies',
    (campo) => {
      const raiz = repoDePrueba();
      writeFileSync(
        join(raiz, 'packages', 'domain', 'package.json'),
        JSON.stringify({ name: '@koinonia/domain', [campo]: { zod: '^3.0.0' } }),
      );
      const resultado = correrGuardian(raiz);
      expect(resultado.ok).toBe(false);
      expect(resultado.salida).toContain(`${campo}.zod está prohibida`);
    },
  );

  /**
   * La concesión es **por paquete**, no global. Si el guardián guardara una sola lista de permitidas
   * para todos, estas dos filas pasarían las dos y nadie se enteraría de que `metrics` puede tirar
   * de `crypto` por la puerta de atrás.
   */
  it.each([
    { paquete: 'domain', dependencia: '@koinonia/crypto', legal: true },
    { paquete: 'domain', dependencia: '@koinonia/domain', legal: false },
    { paquete: 'metrics', dependencia: '@koinonia/domain', legal: true },
    { paquete: 'metrics', dependencia: '@koinonia/crypto', legal: false },
    { paquete: 'crypto', dependencia: '@koinonia/domain', legal: false },
    { paquete: 'consensus', dependencia: '@koinonia/domain', legal: false },
  ] as const)(
    'la concesión es por paquete: $dependencia en packages/$paquete → legal=$legal',
    ({ paquete, dependencia, legal }) => {
      const resultado = correrGuardian(
        repoDePrueba({ dependencias: { [paquete]: { [dependencia]: 'workspace:*' } } }),
      );
      expect(resultado.ok).toBe(legal);
      if (!legal) expect(resultado.salida).toContain(`dependencies.${dependencia} está prohibida`);
    },
  );

  it('el mensaje de la infracción dice qué SÍ estaba permitido, no sólo qué no', () => {
    const sinConcesion = correrGuardian(
      repoDePrueba({ dependencias: { crypto: { zod: '^3.0.0' } } }),
    );
    expect(sinConcesion.salida).toContain('(permitidas: ninguna)');
    const conConcesion = correrGuardian(
      repoDePrueba({ dependencias: { metrics: { zod: '^3.0.0' } } }),
    );
    expect(conConcesion.salida).toContain('(permitidas: @koinonia/domain)');
  });

  const NO_DETERMINISMO = [
    ['import de Node', "import { readFileSync } from 'node:fs';\n", 'módulo de Node'],
    ['require()', 'const fs = require("node:fs");\n', 'require()'],
    ['import de apps/', "import { x } from '../../apps/web/x.js';\n", 'apps/ o services/'],
    ['lectura del reloj', 'export const t = Date.now();\n', 'reloj'],
    ['constructor de Date sin argumentos', 'export const t = new Date();\n', 'reloj'],
    ['aleatoriedad', 'export const r = Math.random();\n', 'aleatoriedad'],
    ['localeCompare', "export const c = 'a'.localeCompare('b');\n", 'localeCompare'],
  ] as const;

  it.each(NO_DETERMINISMO)(
    'el guardián RECHAZA %s en el código del dominio',
    (_n, fuente, motivo) => {
      const resultado = correrGuardian(repoDePrueba({ fuentes: { domain: fuente } }));
      expect(resultado.ok).toBe(false);
      expect(resultado.salida).toContain(motivo);
    },
  );

  /** Y en los otros tres también: la regla de determinismo no es privilegio del dominio. */
  it.each(REVISADOS.map(({ paquete }) => paquete))(
    'el guardián RECHAZA el reloj en el código de packages/%s',
    (paquete) => {
      const resultado = correrGuardian(
        repoDePrueba({ fuentes: { [paquete]: 'export const t = Date.now();\n' } }),
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.salida).toContain(`packages/${paquete}/src/index.ts:1: `);
      expect(resultado.salida).toContain('reloj');
    },
  );

  it('el guardián NO se dispara con menciones en comentarios ni dentro de cadenas de prosa', () => {
    const fuente =
      '// Prohibido: Date.now(), Math.random() y localeCompare().\n' +
      '/* Tampoco new Date() ni require(). */\n' +
      'export const x = 1;\n';
    expect(correrGuardian(repoDePrueba({ fuentes: { domain: fuente } })).ok).toBe(true);
  });

  /** Pero la cadena de un `import` sí se conserva: es justo lo que hay que cazar. */
  it('el guardián sí ve el módulo de Node aunque venga en una cadena', () => {
    const fuente = "import * as fs from 'node:fs';\nexport const x = 1;\n";
    expect(correrGuardian(repoDePrueba({ fuentes: { crypto: fuente } })).ok).toBe(false);
  });

  it('el guardián informa del número de línea real, no del de la fuente sin comentarios', () => {
    const fuente =
      '/*\n * Un comentario\n * de varias líneas.\n */\nexport const t = Date.now();\n';
    const resultado = correrGuardian(repoDePrueba({ fuentes: { domain: fuente } }));
    expect(resultado.ok).toBe(false);
    expect(resultado.salida).toContain('packages/domain/src/index.ts:5:');
  });
});
