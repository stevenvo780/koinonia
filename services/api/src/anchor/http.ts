/**
 * HTTP de salida para el anclaje. **Aquí sí hay I/O**: `packages/anchor` no la hace, este módulo sí.
 *
 * Tres cosas y ninguna más:
 *
 *  1. Un `FetchLike` sobre el `fetch` de Node, con **plazo máximo**. Sin plazo, un calendario que
 *     acepta la conexión y no contesta nunca deja el ciclo de anclaje colgado para siempre, y el
 *     retroceso exponencial —que existe justo para eso— no llega a ejecutarse.
 *  2. Un ayudante para leer JSON de las APIs de las forjas, con cota de tamaño.
 *  3. La clasificación de errores en **reintentables o no**: reintentar cinco veces un `400` gasta
 *     el presupuesto en algo que va a fallar igual; no reintentar un `503` desperdicia un anclaje.
 *
 * ═══ C17 ═══
 *
 * Nada de lo que sale de aquí registra direcciones IP. Los nombres de servidor son **configuración**
 * —los escribió quien desplegó—, no la ubicación observada de una persona, así que aparecer en un
 * mensaje de error no los convierte en un registro de ubicaciones. Lo que sí puede traer una IP es el
 * diagnóstico que devuelve un servidor de correo ajeno, y por eso `sinDireccionesIp()` existe y se
 * aplica antes de escribir nada en un recibo, que acaba en un export público.
 */

import type { FetchLike } from '@koinonia/anchor';

/** 20 s: un calendario sano contesta en menos de uno. */
export const PLAZO_POR_DEFECTO_MS = 20_000;

/** 4 MiB: un objeto commit son kilobytes; un cuerpo mayor es un error o un ataque de agotamiento. */
export const MAX_CUERPO_BYTES = 4 * 1024 * 1024;

export const AGENTE = 'koinonia-anclaje/0.1 (+https://codeberg.org/koinonia)';

export interface HttpOptions {
  readonly timeoutMs?: number;
  readonly userAgent?: string;
  /** Cabeceras fijas: `Authorization` de la forja, por ejemplo. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Inyectable para poder guionizar el diálogo en las pruebas. Por defecto, el `fetch` de Node. */
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly maxBodyBytes?: number;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(url: string, status: number, detail: string) {
    super(`${url} respondió ${String(status)}: ${detail}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

/**
 * ¿Merece otro intento?
 *
 * `408`, `429` y todo `5xx` son estados de los que un servicio se recupera solo. Un `4xx` que no sea
 * de esos es un error nuestro —digest mal formado, credencial caducada— y repetirlo cinco veces sólo
 * añade carga a un servidor que ya dijo que no.
 */
export function esReintentable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  // Fallos de red, plazos agotados y DNS: exactamente lo que hay que reintentar.
  return true;
}

function conPlazo(timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`se agotó el plazo de ${String(timeoutMs)} ms`));
  }, timeoutMs);
  // `unref` evita que un plazo pendiente mantenga vivo el proceso al terminar el ciclo.
  timer.unref();
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
    },
  };
}

async function leerCuerpoAcotado(
  response: Response,
  max: number,
  url: string,
): Promise<Uint8Array> {
  const declarado = response.headers.get('content-length');
  if (declarado !== null && Number(declarado) > max) {
    throw new HttpError(
      url,
      response.status,
      `el cuerpo declara ${declarado} B y el máximo es ${String(max)}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > max) {
    throw new HttpError(
      url,
      response.status,
      `el cuerpo mide ${String(bytes.length)} B y el máximo es ${String(max)}`,
    );
  }
  return bytes;
}

/** `FetchLike` real, el que consume `httpCalendar()`. */
export function nodeFetch(options: HttpOptions = {}): FetchLike {
  const timeoutMs = options.timeoutMs ?? PLAZO_POR_DEFECTO_MS;
  const max = options.maxBodyBytes ?? MAX_CUERPO_BYTES;
  const impl = options.fetchImpl ?? globalThis.fetch;
  const fijas = { 'User-Agent': options.userAgent ?? AGENTE, ...options.headers };

  return async (input, init) => {
    const { signal, cancel } = conPlazo(timeoutMs);
    try {
      const response = await impl(input, {
        method: init?.method ?? 'GET',
        headers: { ...fijas, ...init?.headers },
        ...(init?.body === undefined ? {} : { body: init.body }),
        signal,
        redirect: 'follow',
      });
      const bytes = await leerCuerpoAcotado(response, max, input);
      return {
        ok: response.ok,
        status: response.status,
        // Copia, no vista: `bytes.buffer` puede ser un búfer compartido y mucho mayor, y entregar
        // esa vista dejaría bytes ajenos al alcance de quien mire `.buffer`.
        arrayBuffer: () => {
          const copia = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(copia).set(bytes);
          return Promise.resolve(copia);
        },
      };
    } finally {
      cancel();
    }
  };
}

async function cuerpoDeUnGet(
  url: string,
  accept: string,
  options: HttpOptions,
): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? PLAZO_POR_DEFECTO_MS;
  const max = options.maxBodyBytes ?? MAX_CUERPO_BYTES;
  const impl = options.fetchImpl ?? globalThis.fetch;
  const { signal, cancel } = conPlazo(timeoutMs);

  try {
    const response = await impl(url, {
      method: 'GET',
      headers: {
        'User-Agent': options.userAgent ?? AGENTE,
        Accept: accept,
        ...options.headers,
      },
      signal,
      redirect: 'follow',
    });
    const bytes = await leerCuerpoAcotado(response, max, url);
    if (!response.ok) {
      throw new HttpError(url, response.status, recorte(new TextDecoder().decode(bytes)));
    }
    return bytes;
  } finally {
    cancel();
  }
}

/** GET de un JSON, con plazo y cota. Lanza `HttpError` en cualquier respuesta que no sea 2xx. */
export async function getJson(url: string, options: HttpOptions = {}): Promise<unknown> {
  const bytes = await cuerpoDeUnGet(url, 'application/json', options);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new HttpError(
      url,
      200,
      `la respuesta no es JSON (${error instanceof Error ? error.message : 'ilegible'})`,
    );
  }
}

/**
 * GET de un texto plano, con plazo y cota.
 *
 * Existe por las API de bloques de Bitcoin: devuelven `text/plain` con el hash del bloque o los 160
 * caracteres de la cabecera, no JSON. Pasar eso por `getJson` fallaría siempre.
 */
export async function getTexto(url: string, options: HttpOptions = {}): Promise<string> {
  const bytes = await cuerpoDeUnGet(url, 'text/plain', options);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch (error) {
    throw new HttpError(
      url,
      200,
      `la respuesta no es texto UTF-8 (${error instanceof Error ? error.message : 'ilegible'})`,
    );
  }
}

function recorte(texto: string): string {
  const limpio = texto.replace(/\s+/gu, ' ').trim();
  return limpio.length > 200 ? `${limpio.slice(0, 200)}…` : limpio;
}

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/gu;
const IPV6 = /\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/giu;

/**
 * Borra direcciones IP de un texto **antes** de que acabe en un recibo.
 *
 * C17 dice que la aplicación no registra direcciones IP. El diagnóstico que devuelve el servidor de
 * correo del destinatario —«550 5.1.1 … relay 192.0.2.10 …»— es texto ajeno que se copia tal cual en
 * el recibo, y el recibo se publica en el export. Sin este filtro, la regla se cumpliría en todo el
 * código menos justo en el sitio donde el texto viene de fuera, que es donde más falta hace.
 *
 * No pretende ser un detector perfecto: recorta lo que parece una IP. Un falso positivo estropea un
 * mensaje de diagnóstico; un falso negativo publica una dirección.
 */
export function sinDireccionesIp(texto: string): string {
  return texto.replace(IPV4, '[ip omitida]').replace(IPV6, (coincidencia) =>
    // `::` suelto y cosas como `5.1.1:` no son direcciones; se exige al menos dos grupos con dígitos.
    /[0-9a-f]/iu.test(coincidencia.replace(/:/gu, '')) ? '[ip omitida]' : coincidencia,
  );
}
