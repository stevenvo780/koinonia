#!/usr/bin/env node
/**
 * Verifica la regla de dependencia del ADR-0001, que en revisión de código se olvida siempre:
 *
 *  - `packages/domain` no puede tener NINGUNA dependencia de tiempo de ejecución salvo,
 *    a lo sumo, `@koinonia/crypto`;
 *  - `packages/crypto` no puede tener NINGUNA dependencia de tiempo de ejecución;
 *  - `packages/consensus` tampoco: no es dominio, pero su único valor es que dos máquinas obtengan
 *    los mismos grupos de opinión a partir de la misma matriz, y eso se pierde con la primera
 *    dependencia que traiga su propio orden, su propio reloj o su propia aleatoriedad;
 *  - `packages/metrics` sólo puede depender de `@koinonia/domain`, y sólo por su aritmética exacta
 *    de fracciones y sus índices de concentración, que ya existen ahí probados contra INV-31.
 *    Cualquier otra dependencia sobra: las cinco métricas de salud reciben datos ya proyectados y
 *    **no leen la base**, así que un cliente de base de datos o un formateador de fechas en este
 *    manifiesto significaría que alguien movió la frontera sin decirlo;
 *  - ninguno de los cuatro puede importar módulos de Node, ni `apps/`, ni `services/`, ni usar
 *    `Date.now()`, `Math.random()` o `localeCompare` (no determinismo).
 *
 * Falla con código 1 y una lista de infracciones. Se corre en `pnpm lint` y en CI.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Dependencias de runtime permitidas por paquete. Todo lo demás es una infracción. */
const PERMITIDAS = {
  'packages/domain': new Set(['@koinonia/crypto']),
  'packages/crypto': new Set([]),
  'packages/consensus': new Set([]),
  'packages/metrics': new Set(['@koinonia/domain']),
};

const CAMPOS_RUNTIME = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const PROHIBIDO_EN_FUENTE = [
  {
    patron: /\bfrom\s+['"]node:/g,
    motivo: 'importa un módulo de Node (rompe la ejecución en navegador)',
  },
  { patron: /\brequire\s*\(/g, motivo: 'usa require() (el paquete es ESM puro)' },
  {
    patron: /\bfrom\s+['"](?:\.\.\/){2,}(?:apps|services)\//g,
    motivo: 'importa de apps/ o services/',
  },
  { patron: /\bDate\.now\s*\(/g, motivo: 'lee el reloj (el instante entra como dato)' },
  { patron: /\bnew\s+Date\s*\(\s*\)/g, motivo: 'lee el reloj (el instante entra como dato)' },
  { patron: /\bMath\.random\s*\(/g, motivo: 'usa aleatoriedad (la semilla entra como dato)' },
  { patron: /\.localeCompare\s*\(/g, motivo: 'usa localeCompare (prohibido por ADR-0004)' },
];

const infracciones = [];

function leerJson(ruta) {
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

/**
 * Elimina comentarios y contenido de cadenas conservando los saltos de línea, para que el número de
 * línea informado siga siendo el real. Sin esto, la propia documentación de la regla ("nada de
 * `Date.now()`") la infringiría, y un guardián que salta con la prosa es un guardián que alguien
 * acaba desactivando.
 *
 * Limitación conocida: no distingue una expresión regular de una división. Ningún fichero de
 * `packages/domain` ni de `packages/crypto` contiene `/` seguido de `/` o `*` dentro de un literal
 * de expresión regular; si algún día lo contiene, este análisis hay que hacerlo con el AST.
 */
function soloCodigo(fuente) {
  let salida = '';
  let estado = 'codigo';
  let comilla = '';
  let i = 0;
  while (i < fuente.length) {
    const c = fuente[i];
    const d = fuente[i + 1];
    if (estado === 'codigo') {
      if (c === '/' && d === '/') {
        estado = 'linea';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        estado = 'bloque';
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        estado = 'cadena';
        comilla = c;
      }
      salida += c;
      i += 1;
      continue;
    }
    if (estado === 'cadena') {
      // Las cadenas se conservan: `from 'node:fs'` es precisamente una de las cosas que se buscan.
      if (c === '\\') {
        salida += fuente.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === comilla) {
        estado = 'codigo';
      }
      salida += c;
      i += 1;
      continue;
    }
    if (estado === 'linea') {
      if (c === '\n') {
        salida += '\n';
        estado = 'codigo';
      }
      i += 1;
      continue;
    }
    // bloque
    if (c === '*' && d === '/') {
      estado = 'codigo';
      i += 2;
      continue;
    }
    if (c === '\n') salida += '\n';
    i += 1;
  }
  return salida;
}

function* ficherosTs(dir) {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      if (entrada === 'node_modules' || entrada === 'dist') continue;
      yield* ficherosTs(ruta);
    } else if (entrada.endsWith('.ts')) {
      yield ruta;
    }
  }
}

for (const [paquete, permitidas] of Object.entries(PERMITIDAS)) {
  const rutaPaquete = join(RAIZ, paquete);
  const manifiesto = leerJson(join(rutaPaquete, 'package.json'));

  for (const campo of CAMPOS_RUNTIME) {
    for (const dependencia of Object.keys(manifiesto[campo] ?? {})) {
      if (!permitidas.has(dependencia)) {
        infracciones.push(
          `${paquete}/package.json: ${campo}.${dependencia} está prohibida ` +
            `(permitidas: ${permitidas.size === 0 ? 'ninguna' : [...permitidas].join(', ')})`,
        );
      }
    }
  }

  const rutaSrc = join(rutaPaquete, 'src');
  for (const fichero of ficherosTs(rutaSrc)) {
    const contenido = soloCodigo(readFileSync(fichero, 'utf8'));
    for (const { patron, motivo } of PROHIBIDO_EN_FUENTE) {
      patron.lastIndex = 0;
      const coincidencia = patron.exec(contenido);
      if (coincidencia !== null) {
        const linea = contenido.slice(0, coincidencia.index).split('\n').length;
        infracciones.push(`${relative(RAIZ, fichero)}:${linea}: ${motivo}`);
      }
    }
  }
}

if (infracciones.length > 0) {
  console.error('Pureza del dominio VIOLADA (ADR-0001):');
  for (const infraccion of infracciones) console.error(`  ✗ ${infraccion}`);
  process.exit(1);
}

// El mensaje se construye desde `PERMITIDAS` para que no pueda mentir: si mañana se añade o se quita
// un paquete de la comprobación —o se le concede una dependencia—, la línea que se imprime cambia
// sola. Un guardián que anuncia haber revisado más de lo que revisa es peor que no tener guardián,
// y uno que dice «sin dependencias» de un paquete al que se le acaba de conceder una, también.
const revisados = Object.entries(PERMITIDAS).map(([paquete, permitidas]) =>
  permitidas.size === 0 ? paquete : `${paquete} (sólo ${[...permitidas].join(', ')})`,
);
const ultimo = revisados.length - 1;
const listado =
  revisados.length === 1
    ? revisados[0]
    : `${revisados.slice(0, ultimo).join(', ')} y ${revisados[ultimo]}`;
console.log(`Pureza del dominio: correcta (${listado}).`);
