/**
 * Esquema de `jobs.job`: la tabla que convierte PostgreSQL en la cola.
 *
 * ═══ Por qué esto no es una migración numerada de `services/api/migrations/` ═══
 *
 * Ese directorio tiene un runner propio (`db/migrate.ts`) que hashea cada fichero aplicado y un
 * guardián de tipos (`test/migraciones.test.ts`) que sólo vigila `governance.event`. Añadir un
 * `0014_jobs.sql` ahí es responsabilidad de quien integra: con varios agentes tocando el árbol a la
 * vez, dos ficheros numerados igual chocan, y ese directorio no está entre lo que este módulo puede
 * tocar. La salida no es escribir menos esquema: es que este módulo se aplique **a sí mismo**, de
 * forma idempotente, exactamente como cualquier migración — y que quien integre pueda mover este SQL
 * a un fichero `NNNN_jobs.sql` sin cambiar una línea si prefiere que quede bajo el runner numerado.
 *
 * ═══ Por qué SÍ hay `uuid`, `jsonb` y `timestamptz` aquí, al revés que en `governance.event` ═══
 *
 * La regla de tipos del ledger (§1.1-bis) prohíbe esos tres tipos porque normalizan su
 * representación y esa representación es la preimagen de un hash publicado. `jobs.job` no es parte
 * del historial firmado: es estado operativo, mutable por diseño (un trabajo pasa de `pendiente` a
 * `en_curso` a `hecho`), sin hash que proteger. Usar el tipo que PostgreSQL entiende de verdad —y que
 * sabe indexar, comparar y ordenar— es lo correcto aquí.
 *
 * ═══ El diseño de la cola en una frase ═══
 *
 * Ninguna fila depende de que un proceso siga vivo para significar algo: "tomado" es un dato en la
 * fila (`status='en_curso'`, `locked_by`, `locked_at`), no un lock de sesión de PostgreSQL que muere
 * con la conexión. Si el proceso que la tomó se cae, la fila queda marcada `en_curso` para siempre
 * — por eso existe `liberarExpirados` en `cola.ts`: un barrido que la devuelve a `pendiente` pasado
 * un plazo. La cola sobrevive a cualquier reinicio porque vive en la misma base que el resto del
 * sistema.
 */

import type { PgClient } from '../db/client.js';

/**
 * DDL completo, en un solo bloque para que sea trivial copiarlo a una migración numerada el día que
 * alguien lo decida. `IF NOT EXISTS` en cada sentencia es lo que lo hace seguro de re-ejecutar.
 */
export const ESQUEMA_DE_TRABAJOS_SQL = `
CREATE SCHEMA IF NOT EXISTS jobs;

CREATE TABLE IF NOT EXISTS jobs.job (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (length(kind) BETWEEN 1 AND 200),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pendiente'
                    CHECK (status IN ('pendiente', 'en_curso', 'hecho', 'fallido')),
  run_at          timestamptz NOT NULL,
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts    integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  last_error      text,
  locked_by       text,
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  idempotency_key text UNIQUE
);

-- La cola reclama por (status, run_at): un índice parcial sobre sólo 'pendiente' se mantiene chico
-- aunque la tabla acumule millones de trabajos ya 'hecho' — son la mayoría con el tiempo y no
-- participan nunca de este índice.
CREATE INDEX IF NOT EXISTS job_pendientes_idx
  ON jobs.job (run_at, id)
  WHERE status = 'pendiente';

-- El barrido de expirados busca 'en_curso' antiguos: mismo razonamiento, índice parcial distinto.
CREATE INDEX IF NOT EXISTS job_en_curso_idx
  ON jobs.job (locked_at)
  WHERE status = 'en_curso';

ALTER TABLE jobs.job OWNER TO koinonia_ddl;
REVOKE ALL ON jobs.job FROM PUBLIC;
`;

/**
 * Aplica el esquema si falta. Se puede llamar en cada arranque: la segunda vez y las siguientes no
 * hacen nada (todo es `IF NOT EXISTS`).
 *
 * Requiere un cliente con permiso de `CREATE` sobre el esquema (el rol dueño, `koinonia_ddl`, o el
 * superusuario de pruebas) — el mismo reparto de responsabilidades que `0003_roles_and_grants.sql`:
 * la aplicación nunca es dueña de sus propias tablas.
 */
export async function asegurarEsquemaDeTrabajos(client: PgClient): Promise<void> {
  await client.query(ESQUEMA_DE_TRABAJOS_SQL);
}

/**
 * Concede a `rol` exactamente los privilegios que la cola necesita para operar: nada de `DDL`, nada
 * de dueño. `DELETE` está incluido a propósito para `purgarTerminados` (`cola.ts`) — sin ella la
 * tabla crecería sin límite, y a diferencia de `governance.event` aquí no hay ninguna garantía que
 * proteger borrando un trabajo ya `hecho` hace meses.
 */
export async function otorgarPrivilegiosDeTrabajos(
  client: PgClient,
  rol = 'koinonia_app',
): Promise<void> {
  // `GRANT` no admite parámetros preparados para el nombre del rol (es un identificador, no un
  // valor); se valida a mano en vez de interpolar lo que sea que llegue.
  if (!/^[a-z_][a-z0-9_]*$/u.test(rol)) {
    throw new TypeError(`otorgarPrivilegiosDeTrabajos: nombre de rol inválido: ${rol}`);
  }
  await client.query(`GRANT USAGE ON SCHEMA jobs TO ${rol}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON jobs.job TO ${rol}`);
  await client.query(`GRANT USAGE, SELECT ON SEQUENCE jobs.job_id_seq TO ${rol}`);
}
