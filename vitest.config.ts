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
  },
});
