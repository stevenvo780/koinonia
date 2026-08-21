-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0003 — Roles y privilegios (§4.1).
--
-- `koinonia_ddl` es dueño de los objetos; `koinonia_app` NUNCA lo es. La razón no es higiene: si la
-- aplicación fuera dueña de `governance.event` podría `ALTER TABLE … DISABLE TRIGGER` y saltarse
-- entero el blindaje de 0002 sin ser superusuario.
--
-- Ninguno de los dos roles se crea con contraseña aquí: una contraseña en un fichero de migración
-- acaba en el repositorio, en el historial de git y en el `pg_dump`. La credencial de
-- `koinonia_app` la fija la operación con `setAppRolePassword()` (`src/db/roles.ts`).
--
-- Esta migración necesita permiso de creación de roles: la corre el operador, no la aplicación.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_ddl') THEN
    CREATE ROLE koinonia_ddl NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_app') THEN
    CREATE ROLE koinonia_app LOGIN;
  END IF;
END $$;

ALTER SCHEMA governance                 OWNER TO koinonia_ddl;
ALTER TABLE  governance.event           OWNER TO koinonia_ddl;
ALTER TABLE  governance.aggregate_head  OWNER TO koinonia_ddl;
ALTER TABLE  governance.ledger_cursor   OWNER TO koinonia_ddl;
ALTER TABLE  governance.append_request  OWNER TO koinonia_ddl;
ALTER TABLE  governance.checkpoint      OWNER TO koinonia_ddl;
ALTER FUNCTION governance.fn_append_only()        OWNER TO koinonia_ddl;
ALTER FUNCTION governance.fn_event_no_truncate()  OWNER TO koinonia_ddl;

REVOKE ALL ON ALL TABLES IN SCHEMA governance FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA governance FROM koinonia_app;
REVOKE ALL ON SCHEMA governance FROM PUBLIC;

GRANT USAGE ON SCHEMA governance TO koinonia_app;

-- La historia: se lee y se añade. Nada más. Sin UPDATE, sin DELETE, sin TRUNCATE.
GRANT SELECT, INSERT ON governance.event          TO koinonia_app;
GRANT SELECT, INSERT ON governance.append_request TO koinonia_app;
GRANT SELECT, INSERT ON governance.checkpoint     TO koinonia_app;

-- Caché derivada y reconstruible desde `event`: por eso SÍ es mutable. Su integridad no descansa
-- en los privilegios sino en que cualquier discrepancia con la cadena recomputada es detectable.
GRANT SELECT, INSERT, UPDATE ON governance.aggregate_head TO koinonia_app;
GRANT SELECT, UPDATE         ON governance.ledger_cursor  TO koinonia_app;

-- §4.1 cierra con `ALTER DEFAULT PRIVILEGES FOR ROLE koinonia_ddl IN SCHEMA governance REVOKE ALL
-- ON TABLES FROM koinonia_app`. Es un no-op: los privilegios por defecto hacia un rol concreto ya
-- están vacíos, y `ALTER DEFAULT PRIVILEGES … REVOKE` sólo puede quitar lo que un `GRANT` por
-- defecto hubiera puesto. Lo que sí hace falta es lo de abajo, que impide que una tabla nueva del
-- esquema nazca legible por todo el mundo.
ALTER DEFAULT PRIVILEGES FOR ROLE koinonia_ddl IN SCHEMA governance
  REVOKE ALL ON TABLES FROM PUBLIC;
