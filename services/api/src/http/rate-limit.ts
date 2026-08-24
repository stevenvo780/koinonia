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
 *  2. **La pimienta rota, como mínimo, cada día** —al ritmo de la ventana cuando la ventana dura
 *     más que un día, ver `pepperOfWindow`—, así que la clave de un período y la del siguiente del
 *     mismo sujeto no son correlacionables ni siquiera teniendo la base entera. Un contador de abuso
 *     no debe permitir reconstruir una serie histórica de actividad de nadie (ADR-0040).
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

/** Escrituras de gobierno: 60 por hora y por persona. Red genérica bajo todas las demás. */
export const REGLA_ESCRITURA: RateRule = {
  ambito: 'escritura',
  maximo: 60,
  ventanaMs: 60 * 60 * 1000,
};

/**
 * Propuestas: 3 por persona y por semana (THREAT_MODEL.md T-12).
 *
 * Es el cupo más apretado de los cuatro y a propósito: una propuesta no es un comentario, es un
 * texto que entra a discusión formal y compite por la atención de un círculo entero. Tres por
 * semana le alcanza a cualquier persona que participa de verdad, y no le alcanza a quien quiere
 * enterrar un problema bajo iniciativas propias (T-12, variante barata de la captura de T-19).
 */
export const REGLA_PROPUESTA: RateRule = {
  ambito: 'propuesta',
  maximo: 3,
  ventanaMs: 7 * MS_POR_DIA,
};

/** Comentarios y aportes de deliberación: 20 por persona y por día (THREAT_MODEL.md T-12). */
export const REGLA_COMENTARIO: RateRule = {
  ambito: 'comentario',
  maximo: 20,
  ventanaMs: MS_POR_DIA,
};

/**
 * ═══ Un solo sitio para los números (T-12) ═══
 *
 * Los cuatro cupos del sistema viven juntos, nombrados, en este fichero y en ningún otro. El
 * pliego quiere que estas cifras terminen siendo datos versionados por la comunidad —la
 * «constitución digital»— y no constantes de código; eso no se resuelve acá, es un cambio de
 * almacenamiento y de gobernanza que excede este encargo. Pero mudar un número mañana —de 3 a 4
 * propuestas por semana, de 20 a 30 aportes— es cambiar una línea en un archivo, no perseguirlo
 * repartido por rutas, formularios y mensajes de error.
 */

/**
 * Pimienta de una ventana de conteo.
 *
 * Se deriva del secreto del despliegue y de un número de período. No se almacena: se recalcula. Una
 * pimienta almacenada es una pimienta que sobrevive a la rotación y anula el punto 2 de la nota de
 * cabecera.
 *
 * El período rota **por día calendario como mínimo** —eso es lo que prueba
 * `rate-limits.test.ts`/`http-enlace-magico.test.ts` y lo que documenta la nota de cabecera—, pero
 * nunca más rápido que la propia ventana que se está contando: si la pimienta de un cupo de «3 por
 * semana» rotara a diario, la clave del contador cambiaría todos los días DENTRO de la misma
 * ventana de siete días, el `ON CONFLICT` de `consume` nunca encontraría la fila que ya existía, y
 * el cupo semanal se convertiría, sin que nadie lo pidiera, en un cupo diario. Por eso el período es
 * `max(ventanaMs, un día)`: para los cupos de una hora o de un día (enlace, escritura, comentario)
 * es exactamente un día, igual que antes; para el de propuestas —siete días— es la propia semana.
 */
export function pepperOfWindow(
  secret: string,
  nowMs: number,
  ventanaMs: number = MS_POR_DIA,
): string {
  const periodoMs = Math.max(ventanaMs, MS_POR_DIA);
  const periodo = Math.floor(nowMs / periodoMs);
  return createHash('sha256')
    .update(`${secret}|${String(periodo)}`, 'utf8')
    .digest('hex');
}

/** Retrocompatible: pimienta que rota cada día calendario. Delega en `pepperOfWindow`. */
export function pepperOfDay(secret: string, nowMs: number): string {
  return pepperOfWindow(secret, nowMs);
}

/**
 * `sha256(pimienta ‖ ámbito ‖ sujeto)`. El sujeto es un correo o un `MemberId`; nunca una IP.
 *
 * `ventanaMs` es opcional y por defecto es un día, así que llamar esto sin el quinto argumento
 * —como ya lo hacía cualquier código escrito antes de que existiera el cupo de propuestas—rota
 * igual que siempre. `consume` sí lo pasa siempre, con la ventana de la regla que está aplicando.
 */
export function bucketKey(
  secret: string,
  ambito: string,
  sujeto: string,
  nowMs: number,
  ventanaMs?: number,
): string {
  return createHash('sha256')
    .update(`${pepperOfWindow(secret, nowMs, ventanaMs)}|${ambito}|${sujeto}`, 'utf8')
    .digest('hex');
}

/**
 * Extrae `requestId` del cuerpo de una petición sin recurrir a `any`: el cuerpo de Fastify
 * llega tipado `unknown`, y acá solo nos interesa el caso feliz (objeto con esa clave en
 * texto). Cualquier otra forma —cuerpo ausente, no-objeto, clave no-string— resulta en
 * `undefined`, que es exactamente lo que `consume` ya trata como «sin idempotencia» (ADR-0055).
 */
export function requestIdDeCuerpo(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('requestId' in body)) return undefined;
  const { requestId } = body as { requestId?: unknown };
  return typeof requestId === 'string' ? requestId : undefined;
}

export interface RateVerdict {
  readonly permitido: boolean;
  readonly usados: number;
  readonly maximo: number;
  /** Cuándo se libera el cupo. Se dice en pantalla: un «esperá» sin plazo es un muro. */
  readonly liberaEn: number;
}

/**
 * Cuenta y decide, con idempotencia por `requestId`.
 *
 * ═══ Idempotencia del cupo (ADR-0055) ═══
 *
 * Un reintento tras error de red debe ser seguro. Hoy el `requestId` (clave de idempotencia)
 * protege contra escribir dos veces el evento; pero si el cupo se consumía ANTES de chequear
 * idempotencia, un reintento gastaba cupo aunque no creaba nada nuevo. Esto castiga a quien
 * tiene conexión móvil inestable, que es exactamente quién MÁS usa el mecanismo.
 *
 * Solución (c): Hacer que el CONSUMO DEL CUPO sea idempotente. Si el mismo `requestId`
 * llega dos veces, solo la primera consume. Usamos INSERT ... ON CONFLICT en
 * `identity.rate_consumption` para garantizar atomicidad.
 *
 * El `INSERT … ON CONFLICT DO NOTHING` no tiene hueco entre leer y escribir, así que:
 *  - Dos peticiones con DISTINTO requestId cuentan dos veces (correcto)
 *  - Dos peticiones con MISMO requestId cuentan una sola vez (correcto, idempotente)
 *  - Peticiones sin requestId siguen contando en rate_bucket normalmente
 */
export async function consume(
  client: PgClient,
  options: {
    readonly secret: string;
    readonly regla: RateRule;
    readonly sujeto: string;
    readonly clock: ClockPort;
    readonly requestId?: string | undefined;
  },
): Promise<RateVerdict> {
  const now = options.clock.now();
  const windowStart = Math.floor(now / options.regla.ventanaMs) * options.regla.ventanaMs;

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof options.requestId === 'string' && UUID_REGEX.test(options.requestId)) {
    // Intenta registrar este consumo en la tabla de dedup idempotente.
    // Si la misma (requestId, ambito, sujeto, window_start) ya existe, el INSERT falla
    // porque viola la llave UNIQUE. Eso es lo que queremos: la segunda petición NO
    // incrementa cupo.
    const { rowCount } = await client.query(
      `INSERT INTO identity.rate_consumption (request_id, ambito, sujeto, window_start, consumed_at)
       VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000), NOW())
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [options.requestId, options.regla.ambito, options.sujeto, windowStart],
    );
    if (!rowCount || rowCount === 0) {
      // Ya existe: esta es una petición idempotente repetida, no consume cupo.
      // Devolvemos con usados=0 para que la capa HTTP sepa que fue un reintento.
      return {
        permitido: true,
        usados: 0,
        maximo: options.regla.maximo,
        liberaEn: windowStart + options.regla.ventanaMs,
      };
    }
  }

  const key = bucketKey(
    options.secret,
    options.regla.ambito,
    options.sujeto,
    now,
    options.regla.ventanaMs,
  );

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

/**
 * Mayor ventana entre todas las reglas declaradas arriba. Ninguna fila puede purgarse antes de que
 * su PROPIA ventana termine —si `purgeOldBuckets` la barriera antes, la siguiente escritura crearía
 * una fila nueva con `hits = 1` y el cupo se reiniciaría solo, sin que nadie lo agotara de verdad—.
 * Por eso la retención usa esta cota y no un día fijo: hoy la marca la propuesta semanal.
 */
const VENTANA_MAXIMA_MS = Math.max(
  REGLA_ENLACE.ventanaMs,
  REGLA_ESCRITURA.ventanaMs,
  REGLA_PROPUESTA.ventanaMs,
  REGLA_COMENTARIO.ventanaMs,
);

/** Barre los contadores viejos. Con ellos desaparece la posibilidad de mirar hacia atrás. */
export async function purgeOldBuckets(client: PgClient, clock: ClockPort): Promise<number> {
  const result = await client.query(
    `DELETE FROM identity.rate_bucket
      WHERE window_start < to_timestamp($1::double precision / 1000)`,
    [clock.now() - VENTANA_MAXIMA_MS],
  );
  return result.rowCount ?? 0;
}

/**
 * Barre los registros de consumo idempotente viejos (ADR-0055).
 * No pueden guardarse indefinidamente porque son una fuente de identidad débil:
 * un `requestId` reutilizado años después sería indistinguible de uno nuevo.
 * Se barren con la misma ventana máxima que rate_bucket.
 */
export async function purgeOldConsumptions(client: PgClient, clock: ClockPort): Promise<number> {
  const result = await client.query(
    `DELETE FROM identity.rate_consumption
      WHERE consumed_at < to_timestamp($1::double precision / 1000)`,
    [clock.now() - VENTANA_MAXIMA_MS],
  );
  return result.rowCount ?? 0;
}

/**
 * Se agotó un cupo. Lleva lo necesario para que la capa HTTP construya un 429 legible: nunca uno
 * seco, porque «too many requests» sin fecha es indistinguible de una avería para quien lo lee.
 * `ambito` es el nombre del cupo (propuesta, comentario, escritura…), para que el mensaje en
 * pantalla hable de lo que la persona intentó y no de un código interno.
 */
export class CupoAgotadoError extends Error {
  readonly ambito: string;
  readonly liberaEn: number;

  constructor(ambito: string, veredicto: RateVerdict) {
    super(`cupo de «${ambito}» agotado: ${String(veredicto.usados)}/${String(veredicto.maximo)}`);
    this.name = 'CupoAgotadoError';
    this.ambito = ambito;
    this.liberaEn = veredicto.liberaEn;
  }
}
