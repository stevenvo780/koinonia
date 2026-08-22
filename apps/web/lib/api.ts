/**
 * Cliente de la API.
 *
 * Todo pasa por `/api/...`, que es un proxy del propio Next hacia el servicio (ver
 * `app/api/[...ruta]/route.ts`). Eso hace que la cookie de sesión sea de **primera parte** y que no
 * haya CORS ni cookies entre dominios, que es la clase de complejidad que acaba resolviéndose con
 * `SameSite=None` y una superficie de ataque de regalo.
 *
 * Los tipos vienen de `@koinonia/contracts`: una sola definición para el servidor y el cliente.
 */

import type { ApiError } from '@koinonia/contracts';

export class ErrorDeApi extends Error {
  readonly codigo: string;
  readonly campo: string | undefined;
  readonly queHacer: string | undefined;
  readonly estado: number;

  constructor(estado: number, cuerpo: ApiError) {
    super(cuerpo.mensaje);
    this.name = 'ErrorDeApi';
    this.estado = estado;
    this.codigo = cuerpo.codigo;
    this.campo = cuerpo.campo;
    this.queHacer = cuerpo.queHacer;
  }
}

async function leerError(respuesta: Response): Promise<ErrorDeApi> {
  try {
    const cuerpo = (await respuesta.json()) as ApiError;
    return new ErrorDeApi(respuesta.status, cuerpo);
  } catch {
    // Decía «si estás sin conexión, lo que ves es lo último que se descargó», y era engañoso dos
    // veces: en una primera visita no hay nada descargado —la pantalla está vacía, no vieja—, y
    // este camino ni siquiera es el de estar sin conexión, porque sin red `fetch` ni llega acá.
    // Acá el servidor sí contestó, con un error que no supimos leer. Se dice eso y nada más: no se
    // afirma que lo escrito se guardara, porque no lo sabemos.
    return new ErrorDeApi(respuesta.status, {
      codigo: 'ERROR_INTERNO',
      mensaje:
        'El servidor contestó con un error que no pudimos leer. No sabemos si lo que mandaste llegó ' +
        'a guardarse. Volvé a cargar la pantalla antes de escribirlo otra vez, para no dejarlo dos ' +
        'veces.',
    });
  }
}

export async function traer<T>(ruta: string, signal?: AbortSignal): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!respuesta.ok) throw await leerError(respuesta);
  return (await respuesta.json()) as T;
}

export async function enviar<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) throw await leerError(respuesta);
  return (await respuesta.json()) as T;
}

/** Reemplaza un recurso propio. Se usa para contratos CAS como la capacidad privada. */
export async function reemplazar<T>(ruta: string, cuerpo: unknown): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!respuesta.ok) throw await leerError(respuesta);
  return (await respuesta.json()) as T;
}

/**
 * Clave de idempotencia del comando.
 *
 * Sin ella, un reintento por red intermitente —que en un bus con datos móviles no es una hipótesis—
 * escribiría el mismo aporte dos veces en un historial que no se puede corregir.
 */
export function nuevoRequestId(): string {
  const fuente: Crypto = crypto;
  if (typeof fuente.randomUUID === 'function') return fuente.randomUUID();
  const bytes = new Uint8Array(16);
  fuente.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-` +
    `8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  );
}

/** Fecha y hora en palabras, en hora de Colombia. Nunca un instante crudo en pantalla. */
export function cuando(ms: number): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(ms));
}

/** «Cierra en 3 días» / «Cerró hace 2 horas». Un plazo en palabras, no una cuenta atrás cruda. */
export function plazo(ms: number, ahora = Date.now()): string {
  const delta = ms - ahora;
  const futuro = delta >= 0;
  const abs = Math.abs(delta);
  const dias = Math.floor(abs / 86_400_000);
  const horas = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutos = Math.floor((abs % 3_600_000) / 60_000);
  const trozo =
    dias > 0
      ? `${String(dias)} ${dias === 1 ? 'día' : 'días'}`
      : horas > 0
        ? `${String(horas)} ${horas === 1 ? 'hora' : 'horas'}`
        : `${String(minutos)} ${minutos === 1 ? 'minuto' : 'minutos'}`;
  return futuro ? `Cierra en ${trozo}` : `Cerró hace ${trozo}`;
}
