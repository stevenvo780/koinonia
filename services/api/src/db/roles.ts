/**
 * Credenciales del rol de aplicación, y con qué privilegios está conectada de verdad la API.
 *
 * Vive fuera de las migraciones a propósito: una contraseña escrita en un `.sql` acaba en el
 * repositorio, en el historial de git y en todo `pg_dump` que alguien haga después. La migración
 * 0003 crea el rol sin contraseña; ponérsela es una operación, no un cambio de esquema.
 *
 * La segunda mitad del fichero existe por un hueco medido en producción: la 0003 partía los
 * privilegios en dos —`koinonia_ddl` dueño, `koinonia_app` con sólo `SELECT, INSERT` sobre
 * `governance.event`— y el despliegue servía las peticiones como `postgres`. La asimetría estaba en
 * el esquema y no estaba en vigor. Un esquema que reparte privilegios sin que nadie compruebe con
 * cuál se conecta el servicio es documentación, no una defensa; `inspectLedgerPrivileges` es la
 * comprobación que faltaba, y el arranque la hace y la dice.
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

/** Quién es de verdad una conexión. Preguntado al catálogo, no deducido de la cadena de conexión. */
export interface ConnectionIdentity {
  /** El `current_user` efectivo. */
  readonly user: string;
  /**
   * Si esta conexión **es** superusuario o **puede llegar a serlo**.
   *
   * No basta con `rolsuper` del propio rol: un rol miembro de `postgres` hace `SET ROLE postgres` en
   * una línea, y con `INHERIT` ni siquiera hace falta eso. Se pregunta por pertenencia (`MEMBER`),
   * que es lo que cubre los dos caminos.
   */
  readonly superuser: boolean;
}

export async function connectionIdentity(client: PgClient): Promise<ConnectionIdentity> {
  const { rows } = await client.query<{ role: string; superuser: boolean }>(
    `SELECT current_user::text AS role,
            EXISTS (
              SELECT 1 FROM pg_roles r
               WHERE r.rolsuper AND pg_has_role(current_user, r.oid, 'MEMBER')
            ) AS superuser`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('la base no dijo con qué rol está conectada la sesión');
  return { user: row.role, superuser: row.superuser };
}

/** Lo que `koinonia_app` no puede tener sobre `governance.event` sin que el ledger deje de serlo. */
export const HISTORY_REWRITING_PRIVILEGES = ['UPDATE', 'DELETE', 'TRUNCATE'] as const;

export interface LedgerPrivilegeVerdict {
  readonly identity: ConnectionIdentity;
  /** Privilegios efectivos de esta conexión sobre `governance.event`. */
  readonly eventPrivileges: readonly string[];
  /** `true` si esta conexión podría alterar la historia por la vía normal de SQL. */
  readonly canRewriteHistory: boolean;
  /** Por qué, cuando la respuesta es que sí. Pensado para imprimirse tal cual en el arranque. */
  readonly reason: string | undefined;
}

/**
 * Qué puede hacerle **esta** conexión al ledger.
 *
 * `auditAppGrants` responde «qué puede el rol `koinonia_app`», que es una pregunta sobre el esquema.
 * Ésta responde «qué puede quien está conectado ahora mismo», que es la pregunta sobre el despliegue
 * —la que estaba sin hacer cuando la API se conectaba como `postgres` y los `GRANT` de la 0003 no
 * protegían nada—. La distinción importa porque para un superusuario `has_table_privilege` devuelve
 * `true` en todo sin que exista ni un `GRANT`: el privilegio no está en el catálogo de permisos,
 * está en el rol.
 */
export async function inspectLedgerPrivileges(client: PgClient): Promise<LedgerPrivilegeVerdict> {
  const identity = await connectionIdentity(client);
  const grants = await auditAppGrants(client, identity.user);
  const eventPrivileges = grants.find((grant) => grant.table === 'event')?.privileges ?? [];

  if (identity.superuser) {
    return {
      identity,
      eventPrivileges,
      canRewriteHistory: true,
      reason:
        `«${identity.user}» es SUPERUSUARIO: ningún GRANT le aplica y además puede ` +
        'desactivar el trigger append-only de la 0002 en una línea',
    };
  }

  const peligrosos = HISTORY_REWRITING_PRIVILEGES.filter((p) => eventPrivileges.includes(p));
  if (peligrosos.length > 0) {
    return {
      identity,
      eventPrivileges,
      canRewriteHistory: true,
      reason: `«${identity.user}» tiene ${peligrosos.join(', ')} sobre governance.event`,
    };
  }

  return { identity, eventPrivileges, canRewriteHistory: false, reason: undefined };
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
