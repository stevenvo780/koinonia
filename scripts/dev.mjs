#!/usr/bin/env node
/**
 * `pnpm dev` — levanta el servicio y la interfaz juntos.
 *
 * Antes de arrancar comprueba que la base responde y aplica las migraciones. La alternativa —dos
 * terminales y acordarse del orden— es exactamente la clase de instrucción de README que funciona
 * el día que se escribe y falla el mes siguiente.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:koinonia@localhost:55432/koinonia';
const PUERTO_API = process.env.PORT ?? '3001';
const PUERTO_WEB = process.env.PUERTO_WEB ?? '3000';
/*
 * La base con la que se arma el enlace de entrada.
 *
 * Era un literal `http://localhost:${PUERTO_WEB}` metido directamente en el entorno del servicio,
 * y como `lanzar` pisa `process.env` con lo que recibe, no había forma de cambiarlo desde fuera —
 * al contrario que la base de datos y los dos puertos, que sí se dejan elegir tres líneas más
 * arriba. Esa asimetría rompe un caso concreto: **desarrollar contra esta máquina desde otra**
 * (aquí, por Tailscale). El enlace llegaba diciendo `localhost:3000`, que en la máquina que lo
 * abre es esa máquina y no ésta, así que entrar era imposible sin editar la dirección a mano.
 *
 * Por omisión sigue siendo exactamente lo de antes; lo único que cambia es que ahora se puede
 * decir otra cosa:
 *
 *   KOINONIA_WEB_URL=http://100.64.0.2:3000 pnpm dev
 */
const WEB_URL = process.env.KOINONIA_WEB_URL ?? `http://localhost:${PUERTO_WEB}`;

const procesos = [];

function lanzar(nombre, comando, argumentos, entorno) {
  const hijo = spawn(comando, argumentos, {
    cwd: RAIZ,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...entorno },
  });
  const prefijo = `[${nombre}] `;
  for (const flujo of [hijo.stdout, hijo.stderr]) {
    flujo.setEncoding('utf8');
    let resto = '';
    flujo.on('data', (trozo) => {
      const lineas = (resto + trozo).split('\n');
      resto = lineas.pop() ?? '';
      for (const linea of lineas) process.stdout.write(prefijo + linea + '\n');
    });
  }
  hijo.on('exit', (codigo) => {
    process.stdout.write(`${prefijo}terminó con código ${codigo}\n`);
    apagar(codigo ?? 1);
  });
  procesos.push(hijo);
  return hijo;
}

function apagar(codigo) {
  for (const hijo of procesos) hijo.kill('SIGTERM');
  process.exit(codigo);
}

process.on('SIGINT', () => apagar(0));
process.on('SIGTERM', () => apagar(0));

process.stdout.write(
  `Base de datos: ${DATABASE_URL}\n` +
    `Si falla, levantala con:\n  docker compose -f infra/docker/docker-compose.yml up -d\n\n`,
);

// El servicio aplica las migraciones al arrancar, así que no hace falta un paso aparte.
lanzar('api', 'node', ['services/api/dist/bin.js'], {
  DATABASE_URL,
  PORT: PUERTO_API,
  KOINONIA_WEB_URL: WEB_URL,
});

lanzar('web', 'pnpm', ['--filter', '@koinonia/web', 'exec', 'next', 'dev', '--port', PUERTO_WEB], {
  KOINONIA_API_URL: `http://127.0.0.1:${PUERTO_API}`,
});

process.stdout.write(
  `\nInterfaz:  ${WEB_URL}\n` +
    `Servicio:  http://localhost:${PUERTO_API}\n\n` +
    `Para entrar: pedí el enlace en /entrar; en desarrollo aparece en la propia pantalla y\n` +
    `también en esta consola, sin necesidad de un servidor de correo.\n\n`,
);
