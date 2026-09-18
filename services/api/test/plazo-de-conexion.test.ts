/**
 * El plazo para ABRIR la conexión a PostgreSQL.
 *
 * ═══ Qué avería protege ═══
 *
 * Un `connect` sin plazo no falla: se cuelga. Y aquí el pool se usa por petición, así que el
 * servicio levanta, sirve, y *una* petición se queda esperando para siempre — sin error, sin
 * registro y sin 5xx. Desde fuera no se ve nada; quien vota ve una pantalla que no carga.
 *
 * ═══ Por qué estas pruebas abren sockets de verdad ═══
 *
 * La opción es de las que «están puestas» leyendo el código y no hacen nada si el valor no llega al
 * driver. Un doble del pool comprobaría que escribimos la palabra, no que el plazo corta. Por eso
 * se ejercita `createPool` —la fábrica REAL, la misma que usa `prepararBaseDeDatos`— y se mide
 * contra un agujero negro de red y contra un servidor que sí contesta.
 *
 * No hace falta Docker: el «servidor sano» de aquí abajo habla lo justo del protocolo de PostgreSQL
 * para que el driver dé la conexión por abierta.
 */

import net from 'node:net';

import { describe, expect, it } from 'vitest';

import { PLAZO_DE_CONEXION_POR_DEFECTO_MS, createPool, plazoDeConexion } from '../src/db/client.js';

/**
 * TEST-NET-1 (RFC 5737). No se enruta a ninguna parte: el SYN sale y no vuelve nada, que es
 * exactamente el escenario que hay que medir — un servidor que no contesta, no uno que rechaza.
 */
const AGUJERO_NEGRO = '192.0.2.1';
const PUERTO_PG = 5432;
const URL_AGUJERO_NEGRO = `postgres://koinonia:secreto@${AGUJERO_NEGRO}:${String(PUERTO_PG)}/koinonia`;

type Veredicto = 'se-traga-los-paquetes' | `responde-rapido: ${string}`;

/** Abre un socket crudo contra el agujero negro y dice qué hizo la red de ESTA máquina. */
async function sondearAgujeroNegro(esperaMs: number): Promise<Veredicto> {
  return new Promise<Veredicto>((resolve) => {
    const socket = net.connect({ host: AGUJERO_NEGRO, port: PUERTO_PG });
    const terminar = (veredicto: Veredicto): void => {
      clearTimeout(temporizador);
      socket.destroy();
      resolve(veredicto);
    };
    const temporizador = setTimeout(() => {
      terminar('se-traga-los-paquetes');
    }, esperaMs);
    socket.on('connect', () => {
      terminar('responde-rapido: conectó');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      terminar(`responde-rapido: ${error.code ?? error.message}`);
    });
  });
}

interface ServidorSano {
  readonly url: string;
  cerrar: () => Promise<void>;
}

/**
 * Un PostgreSQL de mentira que contesta de verdad, con el retraso que se le pida.
 *
 * Responde al mensaje de arranque con `AuthenticationOk` + `ReadyForQuery`, que es todo lo que el
 * driver necesita para dar por establecida la conexión. Sirve de CONTROL POSITIVO: si el plazo
 * estuviera mal calibrado —o si «fallar rápido» se hubiera convertido en «fallar siempre»—, una
 * conexión lenta pero legítima se rompería aquí.
 */
async function servidorQueContestaTarde(retrasoMs: number): Promise<ServidorSano> {
  const autenticacionCorrecta = Buffer.alloc(9);
  autenticacionCorrecta.write('R', 0, 'latin1');
  autenticacionCorrecta.writeInt32BE(8, 1);
  autenticacionCorrecta.writeInt32BE(0, 5);

  const listoParaConsultar = Buffer.alloc(6);
  listoParaConsultar.write('Z', 0, 'latin1');
  listoParaConsultar.writeInt32BE(5, 1);
  listoParaConsultar.write('I', 5, 'latin1');

  const servidor = net.createServer((socket) => {
    let saludado = false;
    socket.on('error', () => undefined);
    socket.on('data', () => {
      if (saludado) {
        // Lo siguiente que manda el driver es el `Terminate` del cierre.
        socket.destroy();
        return;
      }
      saludado = true;
      setTimeout(() => {
        if (!socket.destroyed)
          socket.write(Buffer.concat([autenticacionCorrecta, listoParaConsultar]));
      }, retrasoMs);
    });
  });

  await new Promise<void>((resolve) => {
    servidor.listen(0, '127.0.0.1', resolve);
  });
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === 'string') {
    throw new Error('el servidor de prueba no consiguió puerto');
  }

  return {
    url: `postgres://koinonia:secreto@127.0.0.1:${String(direccion.port)}/koinonia`,
    cerrar: () =>
      new Promise<void>((resolve) => {
        servidor.close(() => {
          resolve();
        });
      }),
  };
}

describe('plazo de conexión — la red de esta máquina', () => {
  it(
    'el agujero negro se traga los paquetes AQUÍ DENTRO — sin esto, las pruebas de abajo pasarían ' +
      'en verde sin medir nada',
    async () => {
      const veredicto = await sondearAgujeroNegro(1_500);
      expect(
        veredicto,
        `${AGUJERO_NEGRO} tenía que tragarse el SYN y en este contenedor contestó «${veredicto}». ` +
          'Con una red así, un connect sin plazo también fallaría rápido y las pruebas de plazo ' +
          'medirían la red en vez del código: acompañan, no comprueban. Arreglar la red del ' +
          'entorno, o cambiar el destino por uno que de verdad no responda — NO relajar la prueba.',
      ).toBe('se-traga-los-paquetes');
    },
    10_000,
  );
});

describe('plazo de conexión — la configuración real del pool', () => {
  it('el pool que construye la fábrica lleva el plazo puesto, 10 s por defecto', () => {
    const pool = createPool({ connectionString: URL_AGUJERO_NEGRO });
    try {
      // `pool.options` es lo que el driver va a usar de verdad, no una copia nuestra.
      expect(pool.options.connectionTimeoutMillis).toBe(PLAZO_DE_CONEXION_POR_DEFECTO_MS);
      expect(PLAZO_DE_CONEXION_POR_DEFECTO_MS).toBe(10_000);
    } finally {
      void pool.end().catch(() => undefined);
    }
  });

  it('un plazo explícito manda sobre el defecto', () => {
    const pool = createPool({
      connectionString: URL_AGUJERO_NEGRO,
      connectionTimeoutMillis: 2_500,
    });
    try {
      expect(pool.options.connectionTimeoutMillis).toBe(2_500);
    } finally {
      void pool.end().catch(() => undefined);
    }
  });
});

describe('plazo de conexión — lo que hace contra una base que no contesta', () => {
  it('falla dentro del plazo en vez de esperar indefinidamente', async () => {
    const plazo = 700;
    const pool = createPool({
      connectionString: URL_AGUJERO_NEGRO,
      connectionTimeoutMillis: plazo,
    });
    pool.on('error', () => undefined);

    const empezo = Date.now();
    let error: unknown;
    try {
      const cliente = await pool.connect();
      cliente.release();
    } catch (fallo) {
      error = fallo;
    }
    const tardo = Date.now() - empezo;
    await pool.end().catch(() => undefined);

    expect(error, 'una conexión al agujero negro no puede tener éxito').toBeInstanceOf(Error);
    // Sin la opción, esto se queda en los reintentos de SYN del sistema: decenas de segundos.
    // El margen es ancho a propósito: lo que se comprueba es «acotado», no un número exacto.
    expect(tardo, `tardó ${String(tardo)} ms con un plazo de ${String(plazo)} ms`).toBeLessThan(
      5_000,
    );
    expect(tardo, 'no puede fallar ANTES del plazo: eso sería la red, no el plazo').toBeGreaterThan(
      plazo - 150,
    );
  }, 30_000);
});

describe('plazo de conexión — control positivo con una base sana', () => {
  it('una conexión lenta pero legítima NO se convierte en fallo', async () => {
    const servidor = await servidorQueContestaTarde(600);
    const pool = createPool({ connectionString: servidor.url });
    pool.on('error', () => undefined);
    try {
      const empezo = Date.now();
      const cliente = await pool.connect();
      const tardo = Date.now() - empezo;
      cliente.release();
      expect(tardo, 'el saludo tardío tiene que haberse esperado').toBeGreaterThan(400);
      expect(tardo).toBeLessThan(PLAZO_DE_CONEXION_POR_DEFECTO_MS);
    } finally {
      await pool.end().catch(() => undefined);
      await servidor.cerrar();
    }
  }, 30_000);
});

describe('plazo de conexión — valores que no se aceptan', () => {
  it('el 0 se rechaza con su propio caso: en pg significa «esperar para siempre»', () => {
    expect(() => plazoDeConexion(0)).toThrow(RangeError);
    expect(() => plazoDeConexion(0)).toThrow(/esperar\s+para siempre/u);
    expect(() =>
      createPool({ connectionString: URL_AGUJERO_NEGRO, connectionTimeoutMillis: 0 }),
    ).toThrow(RangeError);
  });

  it('los negativos, el NaN y el infinito tampoco pasan', () => {
    for (const valor of [-1, -10_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => plazoDeConexion(valor), `${String(valor)} tendría que rechazarse`).toThrow(
        RangeError,
      );
    }
  });

  it('sin valor, el defecto; con un valor válido, ese valor', () => {
    expect(plazoDeConexion(undefined)).toBe(PLAZO_DE_CONEXION_POR_DEFECTO_MS);
    expect(plazoDeConexion(1)).toBe(1);
    expect(plazoDeConexion(30_000)).toBe(30_000);
  });
});
