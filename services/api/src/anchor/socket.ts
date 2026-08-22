/**
 * El socket, detrás de un puerto de cuatro métodos.
 *
 * ═══ Por qué existe esta capa ═══
 *
 * Porque sin ella, SMTP e IMAP sólo se podrían probar contra un servidor de correo de verdad, y un
 * test que necesita un servidor de correo es un test que acaba desactivado. Con ella, el **diálogo
 * completo** —EHLO, STARTTLS, AUTH, MAIL FROM, RCPT TO rechazado, DATA, QUIT— se prueba con un doble
 * que devuelve exactamente los bytes que devolvería un servidor real, incluidas las respuestas de
 * varias líneas y los rechazos por destinatario. Lo que queda sin probar es el `node:net`, que son
 * cuarenta líneas sin lógica.
 *
 * No es una abstracción por gusto: es la línea exacta por donde separar lo comprobable de lo que
 * exige red.
 */

import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export interface DuplexLike {
  write(data: Uint8Array): Promise<void>;
  /** Siguientes bytes disponibles, o `undefined` si el otro lado cerró. */
  read(): Promise<Uint8Array | undefined>;
  /** Eleva la conexión ya establecida a TLS. Es lo que hace `STARTTLS`. */
  upgradeToTls(): Promise<void>;
  close(): Promise<void>;
}

export interface DestinoDeRed {
  readonly host: string;
  readonly port: number;
  /** `true` ⇒ TLS desde el primer byte (puerto 465 / 993). */
  readonly tls: boolean;
}

export type Conectar = (destino: DestinoDeRed) => Promise<DuplexLike>;

/**
 * Adaptador sobre `node:net` y `node:tls`.
 *
 * VERIFICAR: esto es lo único de los módulos de correo que **no** tiene prueba automática, porque
 * probarlo exigiría levantar un servidor real. Su superficie se ha dejado a propósito en lo mínimo:
 * cola de trozos, cola de lectores y una elevación a TLS. Toda la lógica de protocolo está arriba,
 * en `smtp.ts` e `imap.ts`, y ésa sí se prueba entera.
 */
export function nodeConnect(opciones: { readonly timeoutMs?: number } = {}): Conectar {
  return (destino) =>
    new Promise<DuplexLike>((resolve, reject) => {
      const socket = destino.tls
        ? tlsConnect({ host: destino.host, port: destino.port, servername: destino.host })
        : tcpConnect({ host: destino.host, port: destino.port });

      const timeoutMs = opciones.timeoutMs ?? 30_000;
      socket.setTimeout(timeoutMs);
      socket.once('timeout', () => {
        socket.destroy(new Error(`el servidor no contestó en ${String(timeoutMs)} ms`));
      });
      socket.once('error', reject);
      socket.once(destino.tls ? 'secureConnect' : 'connect', () => {
        socket.removeListener('error', reject);
        resolve(envolver(socket, destino.host));
      });
    });
}

function envolver(inicial: Socket, servername: string): DuplexLike {
  let socket = inicial;
  const pendientes: Uint8Array[] = [];
  const lectores: ((valor: Uint8Array | undefined) => void)[] = [];
  let cerrado = false;
  let fallo: Error | undefined;

  const enganchar = (s: Socket): void => {
    s.on('data', (trozo: Buffer) => {
      const bytes = Uint8Array.from(trozo);
      const lector = lectores.shift();
      if (lector === undefined) pendientes.push(bytes);
      else lector(bytes);
    });
    s.on('close', () => {
      cerrado = true;
      while (lectores.length > 0) lectores.shift()?.(undefined);
    });
    s.on('error', (error: Error) => {
      fallo ??= error;
      cerrado = true;
      while (lectores.length > 0) lectores.shift()?.(undefined);
    });
  };

  enganchar(socket);

  return {
    write: (data) =>
      new Promise((resolve, reject) => {
        socket.write(data, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    read: () => {
      const listo = pendientes.shift();
      if (listo !== undefined) return Promise.resolve(listo);
      if (fallo !== undefined) return Promise.reject(fallo);
      if (cerrado) return Promise.resolve(undefined);
      return new Promise((resolve) => lectores.push(resolve));
    },
    upgradeToTls: () =>
      new Promise((resolve, reject) => {
        const anterior = socket;
        anterior.removeAllListeners('data');
        anterior.removeAllListeners('close');
        anterior.removeAllListeners('error');
        const seguro = tlsConnect({ socket: anterior, servername });
        seguro.once('error', reject);
        seguro.once('secureConnect', () => {
          seguro.removeListener('error', reject);
          socket = seguro;
          enganchar(seguro);
          resolve();
        });
      }),
    close: () =>
      new Promise((resolve) => {
        socket.end(() => {
          resolve();
        });
      }),
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Lectura por líneas, compartida por SMTP e IMAP
// ═════════════════════════════════════════════════════════════════════════════════════════════

const CRLF = '\r\n';

/**
 * Acumula bytes y los entrega por líneas.
 *
 * `maxBytes` no es prudencia: un servidor hostil que mande un flujo sin `\r\n` agotaría la memoria
 * del proceso de anclaje, y el anclaje es lo que no puede caerse.
 */
export class LineReader {
  readonly #duplex: DuplexLike;
  readonly #max: number;
  #buffer = '';

  constructor(duplex: DuplexLike, maxBytes = 1024 * 1024) {
    this.#duplex = duplex;
    this.#max = maxBytes;
  }

  /** Siguiente línea sin el `CRLF`, o `undefined` si la conexión se cerró. */
  async readLine(): Promise<string | undefined> {
    for (;;) {
      const corte = this.#buffer.indexOf(CRLF);
      if (corte !== -1) {
        const linea = this.#buffer.slice(0, corte);
        this.#buffer = this.#buffer.slice(corte + 2);
        return linea;
      }
      if (this.#buffer.length > this.#max) {
        throw new Error(`el servidor mandó más de ${String(this.#max)} B sin terminar la línea`);
      }
      const trozo = await this.#duplex.read();
      if (trozo === undefined) {
        if (this.#buffer === '') return undefined;
        const resto = this.#buffer;
        this.#buffer = '';
        return resto;
      }
      this.#buffer += Buffer.from(trozo).toString('binary');
    }
  }

  /** Lee exactamente `n` octetos. Lo necesita IMAP para los literales `{n}`. */
  async readExactly(n: number): Promise<string> {
    while (this.#buffer.length < n) {
      const trozo = await this.#duplex.read();
      if (trozo === undefined) throw new Error('la conexión se cerró en medio de un literal');
      this.#buffer += Buffer.from(trozo).toString('binary');
    }
    const salida = this.#buffer.slice(0, n);
    this.#buffer = this.#buffer.slice(n);
    return salida;
  }
}

/**
 * Doble de socket guionizado, para las pruebas.
 *
 * El guion es una lista de respuestas: cada `write` del cliente consume la siguiente. Así se prueba
 * el diálogo entero —incluido el rechazo de un destinatario concreto en medio de la sesión— sin
 * abrir un puerto.
 */
export interface GuionDeServidor {
  /** Lo que el servidor manda nada más conectar. */
  readonly saludo: string;
  /** Respuesta a cada escritura del cliente, en orden. */
  readonly respuestas: readonly string[];
}

export interface SocketGuionizado extends DuplexLike {
  /** Todo lo que el cliente escribió, en orden. Es lo que se afirma en las pruebas. */
  readonly escrito: readonly string[];
  readonly elevadoATls: () => boolean;
  readonly cerrado: () => boolean;
}

export function socketGuionizado(guion: GuionDeServidor): SocketGuionizado {
  const escrito: string[] = [];
  const salida: string[] = [guion.saludo];
  const respuestas = [...guion.respuestas];
  let tls = false;
  let cerrado = false;

  return {
    escrito,
    elevadoATls: () => tls,
    cerrado: () => cerrado,
    write: (data) => {
      escrito.push(Buffer.from(data).toString('binary'));
      const siguiente = respuestas.shift();
      if (siguiente !== undefined) salida.push(siguiente);
      return Promise.resolve();
    },
    read: () => {
      const trozo = salida.shift();
      if (trozo === undefined) return Promise.resolve(undefined);
      return Promise.resolve(Uint8Array.from(Buffer.from(trozo, 'binary')));
    },
    upgradeToTls: () => {
      tls = true;
      return Promise.resolve();
    },
    close: () => {
      cerrado = true;
      return Promise.resolve();
    },
  };
}
