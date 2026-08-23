-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0011 — El texto de las reglas, direccionado por su huella (ADR-0051, `GOVERNANCE.md` §6).
--
-- ⛔ REGLA DE TIPOS DEL LEDGER (§1.1-bis), aplicada aquí:
--
--   Ningún valor que forme parte de la preimagen de una huella puede vivir en una columna cuyo
--   tipo NORMALICE su representación.
--
-- Esta tabla es un caso límite de esa regla y por eso lleva más comentario que columnas: `body` es
-- literalmente **la preimagen** de `text_hash`. Si el tipo de `body` reescribiera un solo byte al ir
-- y volver, la cláusula dejaría de corresponder a la huella que la asamblea votó, y el sistema
-- diría «el texto de esta regla no es el que se aprobó» sin que nadie lo hubiera tocado. De ahí:
--
--   text_hash   char(64) + CHECK anclado   — 32 bytes en hexadecimal minúscula, exactos.
--                                            `uuid` está fuera de discusión: 128 bits y guiones.
--   title       text                       — sin normalización de ningún tipo.
--   body        text                       — ídem. **Jamás `jsonb`**: reordena claves, renormaliza
--                                            números, colapsa duplicados y ni siquiera es
--                                            inyectivo. Una columna no inyectiva no puede ser la
--                                            fuente de verdad de «los bytes que se hashearon».
--   recorded_at timestamptz                — legítimo: NO entra en ninguna preimagen. La regla
--                                            persigue al hash, no a los tipos ricos de PostgreSQL.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POR QUÉ EL TEXTO NO VA EN EL LEDGER
--
-- El dominio modela una cláusula como el par `(clauseId, textHash)` y **no guarda prosa**
-- (ADR-0051, «Alternativas consideradas»: guardar texto y huella a la vez añade una forma de mentir
-- —declarar una huella que no corresponde al texto— sin añadir ninguna garantía). El agregado está
-- cerrado y probado; meter el texto en el evento exigiría cambiarlo.
--
-- Así que el texto vive **aparte y direccionado por su contenido**: la clave primaria ES la huella.
-- Tres consecuencias, y las tres son la razón de la decisión:
--
--   (1) No hay forma de que la fila y el evento discrepen sin que se note. La correspondencia
--       cláusula → huella vive SÓLO en el ledger; aquí sólo vive huella → texto. Al leer se
--       recomputa SHA-256 sobre la preimagen y se compara con la clave. Un texto alterado no
--       «gana»: deja de resolver.
--   (2) Una cláusula que no cambia entre la versión 3 y la 4 se guarda UNA vez y las dos versiones
--       la resuelven. Recuperar el texto exacto de una versión histórica es leer los pares de su
--       evento y resolver cada huella; por eso «todas las versiones se conservan» deja de ser una
--       propiedad del pliegue en memoria y pasa a ser recuperable de verdad.
--   (3) La tabla no tiene `clause_id`. Sería una segunda copia, NO autoritativa, de un hecho que ya
--       está en el ledger, y una copia no autoritativa que nadie coteja es exactamente el patrón
--       que este proyecto marca con el sufijo `_idx` cuando no puede evitarlo. Aquí sí se puede
--       evitar: se omite.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LA PREIMAGEN, DECLARADA
--
--     textHash = sha256_hex( utf8( title || U+000A || U+000A || body ) )
--
-- Es un texto plano y no un objeto JSON a propósito: `types.ts` define `Clause.textHash` como
-- «sha256Hex(utf8(texto normalizado))», y un objeto canónico obligaría a un perfil de
-- canonicalización para leer una norma, que es precisamente la clase de acoplamiento que hace que
-- un tercero no pueda comprobar nada con herramientas corrientes. Con esto, comprobar una cláusula
-- desde fuera es `printf '%s\n\n%s' "$titulo" "$cuerpo" | sha256sum`.
--
-- El separador obliga a una restricción que NO es cosmética: **el título no puede contener saltos
-- de línea**. Sin esa restricción la codificación no sería inyectiva —(«a\n\nb», «c») y («a»,
-- «b\n\nc») producirían la misma preimagen— y una codificación no inyectiva es el defecto por el
-- que `jsonb` está proscrito tres párrafos más arriba. Se prohíbe en el DDL, no en la aplicación,
-- porque la aplicación se reescribe y el DDL es el que sobrevive a la reescritura.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE governance.clause_text (
  -- La clave ES la huella. No hay identificador de fila aparte: dos textos iguales son la misma
  -- fila, y un texto distinto es otra fila, siempre.
  text_hash   char(64)    NOT NULL PRIMARY KEY
              CONSTRAINT clause_text_hash_hex_ck CHECK (text_hash ~ '^[0-9a-f]{64}$'),

  -- Una sola línea. El CHECK de los saltos de línea es lo que hace inyectiva la preimagen.
  title       text        NOT NULL
              CONSTRAINT clause_text_title_ck
              CHECK (octet_length(title) > 0 AND title !~ '[\n\r]'),

  body        text        NOT NULL
              CONSTRAINT clause_text_body_ck CHECK (octet_length(body) > 0),

  -- Sobre, no preimagen: cuándo se archivó este texto. No entra en la huella y por eso puede ser
  -- del tipo cómodo.
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE governance.clause_text IS
  'Texto normativo direccionado por contenido: la clave primaria es sha256_hex(utf8(title || E''\n\n'' || body)). Público por §6: son las normas del colectivo.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Inmutabilidad.
--
-- Un texto que ya se votó no se corrige: se propone otra reforma. Si se pudiera editar, bastaría un
-- `UPDATE` para cambiar lo que dice una norma vigente dejando intacta la huella del evento… y
-- entonces la comprobación de la lectura empezaría a fallar y el sistema se acusaría a sí mismo.
-- Mejor que no se pueda escribir el `UPDATE`.
--
-- La misma nota honesta que 0002: **esto no detiene a un superusuario**. Detiene el `UPDATE` de la
-- aplicación, la migración descuidada y la consola abierta a las 3 a.m., y deja rastro.
--
-- No se reutiliza `governance.fn_append_only()`: esa función identifica la fila por `leaf_index`,
-- `tree_size` o `request_id` y aquí devolvería `?`, un mensaje que no dice cuál es la fila. El
-- diagnóstico barato importa justo cuando el trigger salta.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION governance.fn_clause_text_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'governance.clause_text es inmutable: % rechazado (huella %)', TG_OP, OLD.text_hash
    USING ERRCODE = '23514',
          HINT = 'El texto de una norma no se corrige: se reforma, y la reforma escribe otra fila.';
END $$;

CREATE TRIGGER trg_clause_text_immutable
  BEFORE UPDATE OR DELETE ON governance.clause_text
  FOR EACH ROW EXECUTE FUNCTION governance.fn_clause_text_immutable();

-- `session_replication_role = 'replica'` desactiva los triggers `ORIGIN` en una línea. `ALWAYS`, no.
ALTER TABLE governance.clause_text ENABLE ALWAYS TRIGGER trg_clause_text_immutable;

CREATE FUNCTION governance.fn_clause_text_no_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'governance.clause_text es inmutable: TRUNCATE rechazado'
    USING ERRCODE = '23514',
          HINT = 'Vaciar el texto de las normas dejaría el historial apuntando a nada.';
END $$;

CREATE TRIGGER trg_clause_text_no_truncate
  BEFORE TRUNCATE ON governance.clause_text
  FOR EACH STATEMENT EXECUTE FUNCTION governance.fn_clause_text_no_truncate();

ALTER TABLE governance.clause_text ENABLE ALWAYS TRIGGER trg_clause_text_no_truncate;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Propiedad y privilegios (§4.1).
--
-- La aplicación NUNCA es dueña: si lo fuera podría `ALTER TABLE … DISABLE TRIGGER` y saltarse el
-- blindaje de arriba sin ser superusuario. Y sólo recibe SELECT e INSERT: el texto de una norma se
-- añade y se lee, nunca se modifica ni se borra.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_ddl') THEN
    EXECUTE 'ALTER TABLE governance.clause_text OWNER TO koinonia_ddl';
    EXECUTE 'ALTER FUNCTION governance.fn_clause_text_immutable() OWNER TO koinonia_ddl';
    EXECUTE 'ALTER FUNCTION governance.fn_clause_text_no_truncate() OWNER TO koinonia_ddl';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_app') THEN
    EXECUTE 'GRANT SELECT, INSERT ON governance.clause_text TO koinonia_app';
  END IF;
END $$;

REVOKE ALL ON governance.clause_text FROM PUBLIC;
