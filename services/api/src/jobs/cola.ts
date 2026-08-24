/**
 * La cola de trabajos: el puerto (`ColaDeTrabajos`) y su única implementación real, sobre
 * PostgreSQL con `SELECT … FOR UPDATE SKIP LOCKED`.
 *
 * ═══ Por qué PostgreSQL y no una dependencia nueva ═══
 *
 * Ya está en la pila, ya es donde vive todo lo que importa, y `FOR UPDATE SKIP LOCKED` (PostgreSQL
 * 9.5+) resuelve exactamente el problema de una cola: varios trabajadores reclamando de la misma
 * tabla sin que dos se lleven el mismo trabajo y sin que uno bloquee a los demás mientras procesa el
 * suyo. Añadir Redis o un broker dedicado para esto sería una dependencia nueva, un proceso nuevo que
 * mantener, y una segunda fuente de verdad — exactamente lo que la consigna de esta tarea pide
 * argumentar en vez de instalar.
 *
 * ═══ El reclamo, paso a paso ═══
 *
 * `reclamar` hace SELECT+UPDATE dentro de una única transacción corta: elige candidatos con
 * `FOR UPDATE SKIP LOCKED` (así que un trabajador que ya está mirando una fila no bloquea al
 * siguiente, que simplemente la salta y mira otra), los marca `en_curso` y comete. El lock de fila
 * de PostgreSQL se libera al comprometer la transacción — lo que queda marcando "esto está tomado"
 * ya no es un lock de sesión sino el propio `status='en_curso'` de la fila, que sobrevive a que el
 * proceso que lo tomó se caiga. Por diseño: un lock de sesión moriría con la conexión y dejaría el
 * trabajo invisible para nadie; una columna es observable y recuperable (`liberarExpirados`).
 *
 * ═══ El instante entra como parámetro ═══
 *
 * Ninguna función de aquí llama a `Date.now()` ni confía en el `now()` de SQL para decidir nada:
 * quien llama declara `ahora`. Es la misma disciplina que `anchor/tarea.ts` — no es una regla de
 * pureza de dominio (esto SÍ hace I/O), es que una cola cuyas decisiones de tiempo no se pueden fijar
 * desde fuera es una cola que no se puede probar de forma determinista.
 */

import { hasPgCode, PG_ERROR, toBigInt, toInt, toText, type PgPool } from '../db/client.js';

export type EstadoDeTrabajo = 'pendiente' | 'en_curso' | 'hecho' | 'fallido';

export interface NuevoTrabajo {
  /** Qué manejador lo procesa. P.ej. `'anclaje.ciclo'`, `'correo.testigo'`. */
  readonly tipo: string;
  readonly datos?: unknown;
  /**
   * Cuándo puede reclamarse. Obligatorio y no `Date.now()` implícito: quien encola declara el
   * instante, la misma disciplina que el resto del módulo. Para "encolar para ya" se pasa el mismo
   * `ahora()` que se usaría para cualquier otra cosa en esa misma operación.
   */
  readonly ejecutarEn: string;
  readonly intentosMaximos?: number;
  /**
   * Si dos llamadas a `encolar` traen la misma clave, la segunda no crea una fila nueva: devuelve
   * el trabajo ya existente. Es lo que vuelve seguro reintentar "encolar" tras un corte de red sin
   * duplicar el trabajo — la misma idea que `request_id` en el ledger, aplicada a una tabla mutable.
   */
  readonly claveDeIdempotencia?: string;
}

export interface TrabajoEncolado {
  readonly id: string;
  /** `true` sólo cuando la fila ya existía por la clave de idempotencia. */
  readonly yaExistia: boolean;
}

export interface TrabajoReclamado {
  readonly id: string;
  readonly tipo: string;
  readonly datos: unknown;
  readonly intentos: number;
  readonly intentosMaximos: number;
  readonly creadoEn: string;
}

export interface OpcionesDeReclamo {
  /** A qué nombre se atribuye el bloqueo — sale en `locked_by`, útil para depurar quién lo tomó. */
  readonly trabajador: string;
  readonly ahora: string;
  /** Si se omite, reclama de cualquier tipo. Si se da, sólo de estos (p.ej. los que sabe procesar). */
  readonly tipos?: readonly string[];
  readonly maximo?: number;
}

export interface ResultadoDeFallo {
  readonly error: string;
  readonly ahora: string;
  /**
   * Cuándo reintentar, si corresponde. La cola no calcula el backoff — eso es decisión de quien
   * procesa (`trabajador.ts` trae una política por defecto) — sólo aplica lo que le llega.
   */
  readonly reintentarEn?: string;
}

export interface ConteoPorEstado {
  readonly pendiente: number;
  readonly en_curso: number;
  readonly hecho: number;
  readonly fallido: number;
}

export interface ColaDeTrabajos {
  encolar(trabajo: NuevoTrabajo): Promise<TrabajoEncolado>;
  reclamar(opciones: OpcionesDeReclamo): Promise<readonly TrabajoReclamado[]>;
  completar(id: string, ahora: string): Promise<void>;
  /**
   * Registra el fallo. Si ya se agotaron los intentos (`attempts >= max_attempts` tras sumar este),
   * o si `resultado.reintentarEn` no viene, el trabajo queda `fallido` en firme — nadie vuelve a
   * reclamarlo. Si trae `reintentarEn` y aún quedan intentos, vuelve a `pendiente` con ese `run_at`.
   */
  fallar(id: string, resultado: ResultadoDeFallo): Promise<void>;
  /**
   * Barrido de recuperación: cualquier fila `en_curso` cuyo `locked_at` sea anterior a `limite`
   * vuelve a `pendiente`. Es la garantía de "no depende de que el proceso siga vivo" — si el
   * trabajador que la tomó se cayó a mitad de camino, otro la retoma pasado ese plazo.
   */
  liberarExpirados(limite: string, ahora: string): Promise<readonly string[]>;
  contarPorEstado(): Promise<ConteoPorEstado>;
  /** Mantenimiento: borra `hecho`/`fallido` con `updated_at` anterior a `limite`. Devuelve cuántos. */
  purgarTerminados(limite: string): Promise<number>;
}

interface FilaTrabajo {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly created_at: string;
}

export function colaDeTrabajosEnPostgres(pool: PgPool): ColaDeTrabajos {
  return {
    async encolar(trabajo: NuevoTrabajo): Promise<TrabajoEncolado> {
      const runAt = trabajo.ejecutarEn;
      try {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO jobs.job
             (kind, payload, run_at, max_attempts, idempotency_key, created_at, updated_at)
           VALUES ($1, $2::jsonb, $3, $4, $5, $6, $6)
           RETURNING id`,
          [
            trabajo.tipo,
            JSON.stringify(trabajo.datos ?? {}),
            runAt,
            trabajo.intentosMaximos ?? 5,
            trabajo.claveDeIdempotencia ?? null,
            runAt,
          ],
        );
        const fila = rows[0];
        if (fila === undefined) throw new Error('encolar: INSERT no devolvió fila');
        return { id: toText(fila.id, 'jobs.job.id'), yaExistia: false };
      } catch (error) {
        if (
          trabajo.claveDeIdempotencia !== undefined &&
          hasPgCode(error, PG_ERROR.uniqueViolation)
        ) {
          const { rows } = await pool.query<{ id: string }>(
            `SELECT id FROM jobs.job WHERE idempotency_key = $1`,
            [trabajo.claveDeIdempotencia],
          );
          const fila = rows[0];
          if (fila !== undefined) {
            return { id: toText(fila.id, 'jobs.job.id'), yaExistia: true };
          }
        }
        throw error;
      }
    },

    async reclamar(opciones: OpcionesDeReclamo): Promise<readonly TrabajoReclamado[]> {
      const limite = opciones.maximo ?? 10;
      const { rows } = await pool.query<FilaTrabajo>(
        `WITH candidatos AS (
           SELECT id FROM jobs.job
            WHERE status = 'pendiente'
              AND run_at <= $1
              AND ($2::text[] IS NULL OR kind = ANY($2::text[]))
            ORDER BY run_at ASC, id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT $3
         )
         UPDATE jobs.job AS j
            SET status = 'en_curso', locked_by = $4, locked_at = $1, updated_at = $1
           FROM candidatos c
          WHERE j.id = c.id
        RETURNING j.id, j.kind, j.payload, j.attempts, j.max_attempts, j.created_at`,
        [
          opciones.ahora,
          opciones.tipos === undefined ? null : [...opciones.tipos],
          limite,
          opciones.trabajador,
        ],
      );
      return rows.map((fila) => ({
        id: toText(fila.id, 'jobs.job.id'),
        tipo: fila.kind,
        datos: fila.payload,
        intentos: toInt(fila.attempts, 'jobs.job.attempts'),
        intentosMaximos: toInt(fila.max_attempts, 'jobs.job.max_attempts'),
        creadoEn: fila.created_at,
      }));
    },

    async completar(id: string, ahora: string): Promise<void> {
      await pool.query(
        `UPDATE jobs.job SET status = 'hecho', updated_at = $2, locked_by = NULL, locked_at = NULL
          WHERE id = $1`,
        [id, ahora],
      );
    },

    async fallar(id: string, resultado: ResultadoDeFallo): Promise<void> {
      const { rows } = await pool.query<{ attempts: number; max_attempts: number }>(
        `UPDATE jobs.job
            SET attempts = attempts + 1,
                last_error = $2,
                updated_at = $3,
                status = CASE
                  WHEN attempts + 1 < max_attempts AND $4::timestamptz IS NOT NULL
                    THEN 'pendiente'
                  ELSE 'fallido'
                END,
                run_at = CASE
                  WHEN attempts + 1 < max_attempts AND $4::timestamptz IS NOT NULL
                    THEN $4::timestamptz
                  ELSE run_at
                END,
                locked_by = CASE
                  WHEN attempts + 1 < max_attempts AND $4::timestamptz IS NOT NULL THEN NULL
                  ELSE locked_by
                END,
                locked_at = CASE
                  WHEN attempts + 1 < max_attempts AND $4::timestamptz IS NOT NULL THEN NULL
                  ELSE locked_at
                END
          WHERE id = $1
        RETURNING attempts, max_attempts`,
        [id, resultado.error, resultado.ahora, resultado.reintentarEn ?? null],
      );
      if (rows.length === 0) {
        throw new Error(`fallar: no existe el trabajo ${id}`);
      }
    },

    async liberarExpirados(limite: string, ahora: string): Promise<readonly string[]> {
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE jobs.job
            SET status = 'pendiente', locked_by = NULL, locked_at = NULL, updated_at = $2
          WHERE status = 'en_curso' AND locked_at < $1
        RETURNING id`,
        [limite, ahora],
      );
      return rows.map((fila) => toText(fila.id, 'jobs.job.id'));
    },

    async contarPorEstado(): Promise<ConteoPorEstado> {
      const { rows } = await pool.query<{ status: EstadoDeTrabajo; total: string }>(
        `SELECT status, count(*)::text AS total FROM jobs.job GROUP BY status`,
      );
      const conteo: Record<EstadoDeTrabajo, number> = {
        pendiente: 0,
        en_curso: 0,
        hecho: 0,
        fallido: 0,
      };
      for (const fila of rows) {
        conteo[fila.status] = Number(toBigInt(fila.total, 'jobs.job conteo'));
      }
      return conteo;
    },

    async purgarTerminados(limite: string): Promise<number> {
      const { rowCount } = await pool.query(
        `DELETE FROM jobs.job WHERE status IN ('hecho', 'fallido') AND updated_at < $1`,
        [limite],
      );
      return rowCount ?? 0;
    },
  };
}
