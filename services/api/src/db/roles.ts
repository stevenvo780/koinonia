/**
 * Credenciales del rol de aplicación.
 *
 * Vive fuera de las migraciones a propósito: una contraseña escrita en un `.sql` acaba en el
 * repositorio, en el historial de git y en todo `pg_dump` que alguien haga después. La migración
 * 0003 crea el rol sin contraseña; ponérsela es una operación, no un cambio de esquema.
 */

import type { PgClient } from './client.js';

/** Nombre del rol de la aplicación. Sólo `SELECT`/`INSERT` sobre `governance.event` (§4.1). */
export const APP_ROLE = 'koinonia_app';
/** Rol dueño de los objetos. `NOLOGIN`: nadie se conecta con él (§4.1). */
export const DDL_ROLE = 'koinonia_ddl';

const SAFE_ROLE = /^[a-z_][a-z0-9_]*$/u;

/**
 * Fija la contraseña del rol de aplicación.
 *
 * `ALTER ROLE` no admite parámetros ligados para la contraseña, así que hay que interpolar. Por eso
 * el valor se **cita con `quote_literal` del propio servidor** en vez de concatenarlo a mano: es la
 * única forma de que un carácter especial en la contraseña no se convierta en inyección SQL en el
 * arranque del servicio.
 */
export async function setAppRolePassword(
  client: PgClient,
  password: string,
  role: string = APP_ROLE,
): Promise<void> {
  if (!SAFE_ROLE.test(role)) throw new Error(`nombre de rol no admitido: ${JSON.stringify(role)}`);
  if (password === '') throw new Error('la contraseña del rol de aplicación no puede estar vacía');
  const { rows } = await client.query<{ stmt: string }>(
    'SELECT format($fmt$ALTER ROLE %I PASSWORD %L$fmt$, $1::text, $2::text) AS stmt',
    [role, password],
  );
  const statement = rows[0]?.stmt;
  if (statement === undefined) throw new Error('no se pudo construir el ALTER ROLE');
  await client.query(statement);
}

export interface GrantAudit {
  readonly table: string;
  readonly privileges: readonly string[];
}

/**
 * Qué puede hacer de verdad el rol de aplicación sobre el esquema `governance`, preguntado al
 * catálogo y no a la migración. Es lo que se comprueba en CI: que `koinonia_app` **no** tenga
 * `UPDATE`, `DELETE` ni `TRUNCATE` sobre `governance.event`.
 */
export async function auditAppGrants(
  client: PgClient,
  role: string = APP_ROLE,
): Promise<readonly GrantAudit[]> {
  const { rows } = await client.query<{ table_name: string; privileges: string[] }>(
    `SELECT c.relname AS table_name,
            array_remove(ARRAY[
              CASE WHEN has_table_privilege($1, c.oid, 'SELECT')   THEN 'SELECT'   END,
              CASE WHEN has_table_privilege($1, c.oid, 'INSERT')   THEN 'INSERT'   END,
              CASE WHEN has_table_privilege($1, c.oid, 'UPDATE')   THEN 'UPDATE'   END,
              CASE WHEN has_table_privilege($1, c.oid, 'DELETE')   THEN 'DELETE'   END,
              CASE WHEN has_table_privilege($1, c.oid, 'TRUNCATE') THEN 'TRUNCATE' END
            ], NULL) AS privileges
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'governance' AND c.relkind = 'r'
      ORDER BY c.relname`,
    [role],
  );
  return rows.map((row) => ({ table: row.table_name, privileges: row.privileges }));
}
