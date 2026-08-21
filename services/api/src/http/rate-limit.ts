/**
 * Control de abuso **sin registrar direcciones IP**.
 *
 * ═══ Por qué no hay ni una IP en todo el sistema ═══
 *
 * La respuesta cómoda es «una IP es un dato técnico». No lo es aquí. En una comunidad de 300
 * personas que se conectan desde la misma facultad, desde el mismo wifi y desde teléfonos con
 * operador conocido, una IP con marca temporal es un **dato de ubicación de una persona
 * identificable**: dice quién estuvo en el edificio a las 4 de la tarde. Y en un sistema cuyo
 * propósito es que la gente objete sin miedo, un registro de dónde estaba cada quien cuando objetó
 * es precisamente el registro que no debe existir. No se «anonimiza» después: no se recoge.
 *
 * ═══ Qué se usa en su lugar ═══
 *
 * La clave del contador es
 *
 * ```
 *   bucketKey = sha256( pimienta_del_día ‖ "|" ‖ ámbito ‖ "|" ‖ sujeto )
 *   pimienta_del_día = sha256( secreto_del_despliegue ‖ "|" ‖ número_de_día_UTC )
 * ```
 *
 * Tres consecuencias, y las tres son el punto:
 *
 *  1. **No se puede volver al sujeto** sin el secreto del despliegue: la tabla, vista sola, es ruido.
 *  2. **La pimienta rota cada día**, así que la clave de hoy y la de mañana del mismo sujeto no son
 *     correlacionables ni siquiera teniendo la base entera. Un contador de abuso no debe permitir
 *     reconstruir una serie histórica de actividad de nadie (ADR-0040).
 *  3. **Caduca sola.** Las filas de días anteriores se barren y con ellas desaparece la posibilidad
 *     de mirar hacia atrás.
 *
 * El precio es real y hay que decirlo: sin IP, quien tenga muchos correos institucionales puede
 * pedir muchos enlaces. Es un precio aceptable en una comunidad con padrón conocido, donde el
 * adversario de diseño no es un botnet anónimo sino la presión social entre conocidos.
 */

import { createHash } from 'node:crypto';

import type { PgClient } from '../db/client.js';
import type { ClockPort } from './ports.js';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Política de un ámbito: cuántas veces por ventana. */
export interface RateRule {
  readonly ambito: string;
  readonly maximo: number;
  readonly ventanaMs: number;
}

/**
 * Pedir enlaces: 5 por hora y por correo. Suficiente para quien se equivoca de bandeja; insuficiente
 * para usar el sistema como cañón de correo contra un tercero.
 */
export const REGLA_ENLACE: RateRule = { ambito: 'enlace', maximo: 5, ventanaMs: 60 * 60 * 1000 };

/** Escrituras de gobierno: 60 por hora y por persona. */
export const REGLA_ESCRITURA: RateRule = {
  ambito: 'escritura',
  maximo: 60,
  ventanaMs: 60 * 60 * 1000,
};

/**
 * Pimienta del día.
 *
 * Se deriva del secreto del despliegue y del número de día UTC. No se almacena: se recalcula. Una
 * pimienta almacenada es una pimienta que sobrevive a la rotación y anula el punto 2 de arriba.
 */
export function pepperOfDay(secret: string, nowMs: number): string {
  const dayNumber = Math.floor(nowMs / MS_POR_DIA);
  return createHash('sha256')
    .update(`${secret}|${String(dayNumber)}`, 'utf8')
    .digest('hex');
}

/** `sha256(pimienta ‖ ámbito ‖ sujeto)`. El sujeto es un correo o un `MemberId`; nunca una IP. */
export function bucketKey(secret: string, ambito: string, sujeto: string, nowMs: number): string {
  return createHash('sha256')
    .update(`${pepperOfDay(secret, nowMs)}|${ambito}|${sujeto}`, 'utf8')
    .digest('hex');
}

export interface RateVerdict {
  readonly permitido: boolean;
  readonly usados: number;
  readonly maximo: number;
  /** Cuándo se libera el cupo. Se dice en pantalla: un «esperá» sin plazo es un muro. */
  readonly liberaEn: number;
}

/**
 * Cuenta y decide, en una sola sentencia atómica.
 *
 * El `INSERT … ON CONFLICT DO UPDATE SET hits = rate_bucket.hits + 1 RETURNING hits` no tiene hueco
 * entre leer y escribir, así que diez peticiones simultáneas cuentan diez y no una: el mismo motivo
 * por el que el canje del enlace es una comparación-y-cambio.
 */
export async function consume(
  client: PgClient,
  options: {
    readonly secret: string;
    readonly regla: RateRule;
    readonly sujeto: string;
    readonly clock: ClockPort;
  },
): Promise<RateVerdict> {
  const now = options.clock.now();
  const windowStart = Math.floor(now / options.regla.ventanaMs) * options.regla.ventanaMs;
  const key = bucketKey(options.secret, options.regla.ambito, options.sujeto, now);

  const { rows } = await client.query<{ hits: number }>(
    `INSERT INTO identity.rate_bucket (bucket_key, window_start, hits)
     VALUES ($1, to_timestamp($2::double precision / 1000), 1)
     ON CONFLICT (bucket_key, window_start)
       DO UPDATE SET hits = identity.rate_bucket.hits + 1
     RETURNING hits`,
    [key, windowStart],
  );
  const usados = rows[0]?.hits ?? 1;
  return {
    permitido: usados <= options.regla.maximo,
    usados,
    maximo: options.regla.maximo,
    liberaEn: windowStart + options.regla.ventanaMs,
  };
}

/** Barre los contadores viejos. Con ellos desaparece la posibilidad de mirar hacia atrás. */
export async function purgeOldBuckets(client: PgClient, clock: ClockPort): Promise<number> {
  const result = await client.query(
    `DELETE FROM identity.rate_bucket
      WHERE window_start < to_timestamp($1::double precision / 1000)`,
    [clock.now() - MS_POR_DIA],
  );
  return result.rowCount ?? 0;
}
