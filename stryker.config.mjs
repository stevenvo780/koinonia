/**
 * Mutation testing — `docs/TESTING.md` §10.
 *
 * > Si mutar una regla fundamental no rompe ningún test, los tests son insuficientes — por mucho
 * > que la cobertura diga 100 %.
 *
 * El ámbito no es «todo el repositorio»: es donde la mutación **paga**, que es el código denso en
 * decisiones y pobre en efectos —umbrales, fronteras de ventana, operadores estrictos—. §10 lo fija
 * en `packages/crypto`, `packages/domain/src/tally/**` y los cinco ficheros de reglas de `domain`.
 * `contracts` es casi todo tipos, que Stryker no muta; en `apps/web` las mutaciones caen sobre
 * marcado y no informan de nada.
 *
 * ⚠ Los umbrales de §10 son **85 % de fallo** en los tres ámbitos vigilados. Aquí se pone 85 y no se
 * baja. Si el número queda por debajo, lo que hay que entregar es la lista de mutantes que
 * sobreviven —que es justo la información que se buscaba—, no un umbral más cómodo.
 *
 * `KOINONIA_MUTAR` acota el ámbito para una corrida concreta sin tocar este fichero:
 *
 *     KOINONIA_MUTAR=crypto pnpm run mutation      # sólo packages/crypto
 *     KOINONIA_MUTAR=tally  pnpm run mutation      # sólo packages/domain/src/tally/**
 *     KOINONIA_MUTAR=reglas pnpm run mutation      # quorum, window, state-machine, electorate, ballot
 */

const AMBITOS = {
  crypto: ['packages/crypto/src/**/*.ts'],
  tally: ['packages/domain/src/tally/**/*.ts'],
  reglas: [
    'packages/domain/src/quorum.ts',
    'packages/domain/src/window.ts',
    'packages/domain/src/state-machine.ts',
    'packages/domain/src/electorate.ts',
    'packages/domain/src/ballot.ts',
  ],
};

const elegido = process.env['KOINONIA_MUTAR'];
const mutate =
  elegido === undefined || elegido === ''
    ? [...AMBITOS.crypto, ...AMBITOS.tally, ...AMBITOS.reglas]
    : (AMBITOS[elegido] ??
      (() => {
        throw new Error(
          `KOINONIA_MUTAR='${elegido}' no existe. Ámbitos: ${Object.keys(AMBITOS).join(', ')}`,
        );
      })());

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  // Explícito porque pnpm no aplana `node_modules`: el descubrimiento por convención de Stryker
  // (`@stryker-mutator/*`) no encuentra el runner detrás del enlace simbólico del almacén.
  plugins: ['@stryker-mutator/vitest-runner'],
  // `related: false` es obligatorio aquí: las pruebas importan por el alias `@koinonia/crypto`, no
  // por la ruta del fichero, y el `--related` de Vitest no sabe deshacer el alias. Con `related`
  // activo Stryker no encuentra ninguna prueba y aborta.
  vitest: { configFile: 'stryker.config.vitest.mjs', related: false },

  // Sin `index.ts`: son reexportaciones. Mutarlas produce mutantes que ningún test puede matar
  // porque no hay comportamiento que cambiar, y ensucian el denominador.
  mutate: [...mutate, '!**/index.ts'],

  // `perTest` sólo relanza las pruebas que tocan el mutante. Es la diferencia entre horas y días.
  coverageAnalysis: 'perTest',

  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { allowColor: false, maxTestsToLog: 3 },

  // §10: 85 % de fallo en los tres ámbitos vigilados. NO se baja.
  thresholds: { high: 95, low: 85, break: 85 },

  timeoutMS: 60_000,
  timeoutFactor: 3,
  concurrency: 4,
  tempDirName: 'node_modules/.stryker-tmp',
  ignorePatterns: ['reports', 'playwright-report', 'test-results', 'apps/web/.next'],
};
