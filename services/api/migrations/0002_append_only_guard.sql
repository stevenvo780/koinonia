-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0002 — Blindaje append-only de `governance.event` (§4.2).
--
-- ⚠️ NOTA HONESTA, y va primero porque es lo único que no se puede olvidar:
--
--   **NADA DE ESTE FICHERO DETIENE A UN SUPERUSUARIO.**
--
-- `postgres` puede `ALTER TABLE … DISABLE TRIGGER ALL`, puede `DROP TRIGGER`, puede `GRANT` lo que
-- quiera, y con `root` en la máquina puede editar los ficheros de datos o restaurar un `pg_dump`
-- adulterado. Quien tiene `root` tiene la base. Los tests de integración de este repositorio
-- **ejercen** ese camino a propósito (`borrado-de-agregado.test.ts`), para que la afirmación esté
-- medida y no sea una promesa de documentación.
--
-- Lo que estas defensas sí cubren es un conjunto distinto y muy real: un bug de la aplicación que
-- emita un `UPDATE`, una migración descuidada, un ORM con «auto-fix», alguien con la consola
-- abierta a las 3 a.m., una inyección SQL. Son **defensa en profundidad**, y su valor añadido es
-- que **dejan rastro**: desactivar un trigger o cambiar privilegios queda en los logs de PostgreSQL
-- y en el historial de migraciones.
--
-- **La garantía real contra el administrador no está aquí**: está en que cualquier historia
-- alterada contradice raíces ya publicadas fuera de su alcance (§7 y §8), y en que el doble vínculo
-- de la espina hace que borrar un agregado entero deje un puntero colgante que una sola consulta
-- delata (§2.3).
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- La función es GENÉRICA a propósito: la comparten las tres tablas inmutables del esquema. Una
-- versión que dijera `OLD.leaf_index` funcionaría sobre `event` y, sobre `checkpoint` o
-- `append_request`, fallaría con `42703 undefined_column` en vez de con `23514 check_violation`.
-- Seguiría bloqueando —falla cerrado—, pero con un error que no explica nada y que ningún manejador
-- de errores reconocería como «append-only». Se identifica la fila por su clave, sea cual sea, con
-- `to_jsonb(OLD)`, que existe para cualquier tipo de fila.
CREATE FUNCTION governance.fn_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  referencia text;
BEGIN
  referencia := COALESCE(
    to_jsonb(OLD) ->> 'leaf_index',
    to_jsonb(OLD) ->> 'tree_size',
    to_jsonb(OLD) ->> 'request_id',
    '?'
  );
  RAISE EXCEPTION
    'governance.% es append-only: % rechazado (fila %)',
    TG_TABLE_NAME, TG_OP, referencia
    USING ERRCODE = '23514',
          HINT = 'La historia no se corrige: se compensa con un evento nuevo.';
END $$;

CREATE TRIGGER trg_event_append_only
  BEFORE UPDATE OR DELETE ON governance.event
  FOR EACH ROW EXECUTE FUNCTION governance.fn_append_only();

-- CRÍTICO. `session_replication_role = 'replica'` es una variable de sesión que se activa en una
-- línea, y con `ENABLE REPLICA`/`ORIGIN` (el modo por defecto) el trigger no dispara. Con `ALWAYS`,
-- dispara siempre. Verificado en `append-only.test.ts`.
ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- TRUNCATE.
--
-- ERROR DE LA SPEC (§4.2), medido: el documento cierra el blindaje con
--
--     CREATE RULE rl_event_no_truncate AS ON DELETE TO governance.event DO INSTEAD NOTHING;
--
-- y esa línea **desactiva en silencio el trigger de las tres líneas de arriba**. Una regla reescribe
-- la consulta ANTES de ejecutarla: con `DO INSTEAD NOTHING` el `DELETE` nunca llega a la tabla, no
-- se evalúa ninguna fila y por tanto el trigger `BEFORE DELETE` **no dispara**. Medido contra
-- PostgreSQL 16:
--
--     sin la regla:  DELETE FROM governance.event WHERE leaf_index = 0;
--                    ERROR:  governance.event es append-only: DELETE rechazado
--     con la regla:  DELETE FROM governance.event WHERE leaf_index = 0;
--                    DELETE 0            <-- éxito silencioso
--
-- El fallo ruidoso que §4.2 diseña se convierte en un no-op mudo, que es la peor de las dos
-- opciones: un `DELETE` accidental de la aplicación deja de ser un incidente visible. Y además la
-- regla no hace lo que su nombre dice: **las reglas no interceptan `TRUNCATE`** (medido: `TRUNCATE`
-- vació la tabla con la regla puesta). La regla se descarta.
--
-- Lo que sí para un `TRUNCATE` de forma ruidosa es un trigger de sentencia, que sí existe para esa
-- orden y también admite `ENABLE ALWAYS`.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION governance.fn_event_no_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'governance.event es append-only: TRUNCATE rechazado'
    USING ERRCODE = '23514',
          HINT = 'Para reconstruir desde cero se recrea la base, no se vacía la historia.';
END $$;

CREATE TRIGGER trg_event_no_truncate
  BEFORE TRUNCATE ON governance.event
  FOR EACH STATEMENT EXECUTE FUNCTION governance.fn_event_no_truncate();

ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_no_truncate;

-- Las mismas dos defensas sobre `append_request`: es la prueba de que un comando ya se ejecutó.
-- Si se pudiera borrar, un reintento duplicaría el voto y el duplicado sería indistinguible de un
-- fraude sobre una historia que, por diseño, no se puede limpiar.
CREATE TRIGGER trg_append_request_append_only
  BEFORE UPDATE OR DELETE ON governance.append_request
  FOR EACH ROW EXECUTE FUNCTION governance.fn_append_only();

ALTER TABLE governance.append_request ENABLE ALWAYS TRIGGER trg_append_request_append_only;

-- Un checkpoint publicado tampoco se edita: la serie encadenada por `prev_checkpoint` es
-- precisamente lo que impide podarla por el medio (§6.4).
CREATE TRIGGER trg_checkpoint_append_only
  BEFORE UPDATE OR DELETE ON governance.checkpoint
  FOR EACH ROW EXECUTE FUNCTION governance.fn_append_only();

ALTER TABLE governance.checkpoint ENABLE ALWAYS TRIGGER trg_checkpoint_append_only;
