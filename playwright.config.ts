/**
 * Configuración de Playwright.
 *
 * ═══ La matriz ═══
 *
 * En un pull request corre **sólo Chromium**: el ciclo de revisión tiene que caber en el tiempo que
 * alguien está dispuesto a esperar mirando la pestaña, y el 90 % de las regresiones aparecen en el
 * primer navegador. En `main` corre la matriz entera —Chromium, Firefox, WebKit, Chrome móvil y
 * Safari móvil—, porque quien usa esto lo usa en un teléfono y Safari móvil es el navegador donde
 * fallan las cosas que en el escritorio funcionan.
 *
 * La selección se hace con `KOINONIA_MATRIZ=completa`, que pone el flujo de trabajo de `main`.
 *
 * ═══ Un solo trabajador ═══
 *
 * `workers: 1` y `fullyParallel: false` no son una concesión: los escenarios comparten una base de
 * datos y el historial es un **orden total**. Dos escenarios escribiendo a la vez producirían
 * interferencias que no dicen nada sobre el producto y sí mucho sobre el planificador.
 */

import { defineConfig, devices } from '@playwright/test';

const matrizCompleta = process.env['KOINONIA_MATRIZ'] === 'completa';
const enCI = process.env['CI'] === 'true' || process.env['CI'] === '1';

const escritorio = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ...(matrizCompleta
    ? [
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
      ]
    : []),
];

const moviles = matrizCompleta
  ? [
      { name: 'chrome-movil', use: { ...devices['Pixel 7'] } },
      { name: 'safari-movil', use: { ...devices['iPhone 14'] } },
    ]
  : [];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/u,
  // El historial es un orden total: los escenarios no se pisan porque no corren a la vez.
  fullyParallel: false,
  workers: 1,
  forbidOnly: enCI,
  retries: enCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: enCI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    // Sin permisos que no pedimos.
    permissions: [],
  },

  projects: [...escritorio, ...moviles],

  webServer: {
    // Construye y arranca la interfaz de verdad, no el modo de desarrollo: lo que se prueba es lo
    // que se despliega.
    command: 'pnpm --filter @koinonia/web run e2e',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !enCI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      KOINONIA_API_URL: 'http://127.0.0.1:3101',
      NODE_ENV: 'production',
    },
  },
});
