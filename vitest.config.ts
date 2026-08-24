import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolve = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@koinonia/crypto': resolve('./packages/crypto/src/index.ts'),
      '@koinonia/anchor': resolve('./packages/anchor/src/index.ts'),
      '@koinonia/verificar': resolve('./packages/verifier-cli/src/index.ts'),
      '@koinonia/domain': resolve('./packages/domain/src/index.ts'),
      '@koinonia/metrics': resolve('./packages/metrics/src/index.ts'),
      '@koinonia/contracts': resolve('./packages/contracts/src/index.ts'),
      '@koinonia/api': resolve('./services/api/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // Las pruebas de propiedad con fast-check + WebCrypto son asíncronas y numerosas.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      // Los ayudantes de `packages/*/test/**` (fábricas, arbitrarios, matrices) no son código de
      // producción: cuentan cobertura de sí mismos si no se excluyen, y eso infla el número sin decir
      // nada sobre lo que hay que proteger.
      exclude: ['**/test/**'],
      // Piso de cobertura POR PAQUETE (docs/TESTING.md §3), no uno global: un umbral único esconde
      // que `services/api` está al 80 % detrás de que `contracts` está al 99 %. Cada piso es la
      // cobertura REAL medida el 2026-08-23 (`pnpm exec vitest run --coverage`), redondeada hacia
      // ABAJO al entero — así el umbral actúa de trinquete (no puede bajar sin que alguien lo decida
      // a propósito) y no de deuda: nadie tiene que escribir una prueba inútil sólo para llegar a un
      // número inventado. `apps/web` no tiene suite unitaria (se cubre por E2E, docs/TESTING.md §6)
      // y por eso no aparece aquí: no hay nada que instrumentar.
      thresholds: {
        'packages/crypto/src/**': { statements: 94, branches: 89, functions: 100, lines: 96 },
        'packages/domain/src/**': { statements: 90, branches: 83, functions: 96, lines: 91 },
        'packages/contracts/src/**': { statements: 99, branches: 95, functions: 97, lines: 99 },
        'packages/anchor/src/**': { statements: 88, branches: 78, functions: 96, lines: 91 },
        'packages/consensus/src/**': { statements: 97, branches: 72, functions: 94, lines: 97 },
        'packages/metrics/src/**': { statements: 97, branches: 92, functions: 100, lines: 97 },
        'packages/verifier-cli/src/**': { statements: 87, branches: 76, functions: 95, lines: 87 },
        'services/api/src/**': { statements: 79, branches: 67, functions: 82, lines: 81 },
      },
    },
  },
});
