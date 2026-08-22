/**
 * Configuración de Vitest **sólo para Stryker**.
 *
 * Restringe la suite a las pruebas unitarias de `packages/crypto` y `packages/domain`, que son las
 * dueñas del código que se muta (TESTING.md §10). No es una comodidad: `tests/integration/**`
 * levanta PostgreSQL con testcontainers, y Stryker vuelve a lanzar la suite **una vez por mutante**.
 * Con más de mil mutantes eso son mil arranques de contenedor, es decir, días.
 *
 * Lo que esto significa para el número: la puntuación mide si **las pruebas de esos dos paquetes**
 * matan a sus propios mutantes. Un mutante que sólo muriera en una prueba de integración cuenta aquí
 * como superviviente — y eso es lo correcto para lo que §10 pregunta: si mutar una regla fundamental
 * no rompe ningún test de su propio paquete, las aserciones de ese paquete son insuficientes.
 */

import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

/** @param {string} p */
const resolve = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@koinonia/crypto': resolve('./packages/crypto/src/index.ts'),
      '@koinonia/domain': resolve('./packages/domain/src/index.ts'),
    },
  },
  test: {
    include: ['packages/crypto/test/**/*.test.ts', 'packages/domain/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 60_000,
    // Las pruebas de propiedad con fast-check son el grueso del tiempo y no aportan a la mutación lo
    // que cuestan: con la semilla por defecto exploran miles de casos por prueba. Se bajan aquí y
    // sólo aquí; la suite normal las sigue corriendo enteras.
    env: { FC_RUNS: '25' },
  },
});
