// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'docs/**',
      // Arnés de sesión del orquestador (gitignored, ver .gitignore línea 51): no es código del
      // repositorio, es herramienta transitoria de una corrida de mutación manual.
      '.harness/**',
      // Artefactos generados: los produce Next.js y no se revisan, se borran.
      'apps/web/.next/**',
      'apps/web/next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.check.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },

  {
    // ADR-0004: `localeCompare` depende de ICU y de la locale del proceso. Un hash que dependa del
    // entorno es un hash que no se puede verificar en otra máquina.
    //
    // `packages/consensus` entra aquí por la misma razón, no por parecido: su único valor es que dos
    // máquinas agrupen las mismas opiniones a partir de la misma matriz. Un `Math.random()` en la
    // siembra de k-means o un `localeCompare` al ordenar afirmaciones convertirían el análisis en
    // irreproducible sin que ningún test lo notara —cambiaría sólo entre entornos, no entre
    // ejecuciones—, que es la peor forma de perder el determinismo.
    //
    // `packages/metrics` entra por una razón añadida: sus cifras se publican a 300 personas con su
    // serie histórica, y una serie sólo dice algo si cada punto se puede recomputar. Un `Date.now()`
    // haría que el informe de la semana pasada dejara de salir igual —el «ahora» y las ventanas
    // entran como dato—, y un `localeCompare` ordenaría los estratos distinto según la locale del
    // proceso, es decir, produciría dos paneles distintos del mismo mes sin que nadie lo notara.
    files: [
      'packages/domain/**/*.ts',
      'packages/crypto/**/*.ts',
      'packages/consensus/**/*.ts',
      'packages/metrics/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='localeCompare']",
          message:
            'localeCompare está prohibido: depende de la locale. Comparación por code units.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Math.random() está prohibido: la semilla entra como dato.',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Date.now() está prohibido: el instante entra como dato.',
        },
      ],
    },
  },

  {
    // La interfaz tiene su propio `tsconfig`: necesita JSX, `lib: DOM` y resolución de módulos de
    // empaquetador, tres cosas incompatibles con la configuración del resto del monorepo. Se le da
    // su proyecto en vez de excluirla del análisis: una carpeta sin `lint` es una carpeta sin reglas.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: ['./apps/web/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        crypto: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        window: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      // En React el tipo de retorno de un componente lo infiere el compilador y anotarlo en cada
      // manejador de eventos es ruido; el `strict` del `tsconfig` sigue vigilando lo importante.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  {
    // Los escenarios de extremo a extremo tienen su propio proyecto: usan `lib: DOM`, porque el
    // código de `page.evaluate` corre dentro del navegador.
    files: ['tests/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tests/e2e/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['**/test/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      // En un fichero de configuración de JavaScript sin tipos, anotar el retorno no aporta nada.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  prettier,
);
