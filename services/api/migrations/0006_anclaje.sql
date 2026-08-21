-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0006 — Anclaje externo (§8.4).
--
-- NUMERACIÓN: esta migración se escribió como `0005_anclaje.sql` en la rama del anclaje, a la vez
-- que `0005_identidad.sql` se escribía en la principal. Dos ficheros con el mismo número rompen el
-- orden total y el runner los rechaza a propósito (`loadMigrations`, «migraciones con el mismo
-- número»). Se renumera ésta a 0006 y no la otra porque entre las dos NO hay dependencia: la de
-- identidad crea el esquema `identity` entero, sin tocar `governance`, y ésta sólo necesita
-- `governance.checkpoint` (0001) y los roles (0003). Con el orden libre, se renumera la que aún no
-- se había integrado.
--
-- Esta tabla **no es el ledger**: la historia autoritativa de los anclajes vive en el agregado
-- `#anclaje`, dentro del ledger. Esto es una caché de trabajo del proceso de anclaje.
--
-- DECISIÓN (discrepancia con §8.4): la spec le pone `id bigserial PRIMARY KEY` con el comentario
-- «aquí los huecos SÍ dan igual: no es el ledger». Es cierto, pero (a) el guardián de CI de este
-- repositorio prohíbe `serial` en TODAS las migraciones —deliberadamente romo, porque un guardián
-- con excepciones es un guardián que alguien acaba ampliando— y (b) la tabla no necesita clave
-- subrogada: `(tree_size, provider)` ya es su clave natural, y con ella la unicidad deja de ser una
-- restricción añadida para ser la identidad de la fila. Se elimina el `bigserial`.
--
-- ⚠ La excepción que sí importa: `receipt` es `text`, NO `jsonb`.
--
-- El recibo puede ser la preimagen de una verificación **ajena**. `AnchorProvider.verify` debe
-- funcionar sin red sobre los bytes exactos del recibo, y esos bytes incluyen firmas de terceros
-- (la de la veeduría en el commit, la de cada testigo en su acuse) calculadas sobre una forma
-- canónica concreta. `jsonb` reordena las claves y no guarda el texto: guardarlo ahí dejaría el
-- anclaje inverificable justo cuando alguien quiere comprobarlo a mano. Es la regla de tipos del
-- §1.1-bis aplicada a una preimagen que no es nuestra.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE governance.anchor_attempt (
  tree_size    bigint      NOT NULL REFERENCES governance.checkpoint(tree_size),
  provider     text        NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]*$'),

  -- Clase de independencia. El quórum exige DOS clases distintas, así que el valor no es
  -- decorativo: es lo que impide que tres proveedores del mismo tipo cuenten como tres testigos.
  independence_class text  NOT NULL
               CHECK (independence_class IN ('blockchain','vcs','human-witness','third-party-log')),

  state        text        NOT NULL CHECK (state IN ('PENDIENTE','CONFIRMADO','FALLIDO')),
  attempt_no   integer     NOT NULL DEFAULT 1 CHECK (attempt_no >= 1),
  external_ref text,

  -- Recibo canónico EXACTO. Ver el aviso de arriba: `text`, nunca `jsonb`.
  receipt      text        CHECK (receipt IS NULL OR octet_length(receipt) > 0),
  -- Copia derivada y NO autoritativa, sólo para consultar. El verificador no la lee jamás.
  receipt_idx  jsonb       GENERATED ALWAYS AS (receipt::jsonb) STORED,

  -- `SHA256(0x12 ‖ JCS(recibo))`. Es lo que se cita dentro del evento `AnclajeConfirmado`, para
  -- atar el recibo al ledger sin meter el sello entero en la preimagen de un hash.
  receipt_hash bytea       CHECK (receipt_hash IS NULL OR octet_length(receipt_hash) = 32),

  error        text,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp(),

  -- Un solo recibo vigente por (checkpoint, proveedor). Los reintentos actualizan la fila; el
  -- rastro de cada transición está en el ledger, que es donde no se puede borrar.
  CONSTRAINT anchor_attempt_pk PRIMARY KEY (tree_size, provider),

  -- Un recibo confirmado sin recibo sería una afirmación sin prueba.
  CONSTRAINT anchor_attempt_confirmed_ck CHECK (state <> 'CONFIRMADO' OR receipt IS NOT NULL)
);

COMMENT ON TABLE governance.anchor_attempt IS
  'Caché de trabajo del anclaje externo. La historia autoritativa vive en el agregado #anclaje.';
COMMENT ON COLUMN governance.anchor_attempt.receipt IS
  'Recibo canónico EXACTO. text y no jsonb: puede ser preimagen de una firma de un tercero.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Cabeceras de bloque de Bitcoin conocidas.
--
-- Son 80 bytes que cierran la última afirmación de un sello OpenTimestamps: «el bloque N tiene esta
-- raíz de Merkle». Se guardan para poder publicarlas en el export y que la verificación sea
-- completa SIN RED. Que las publiquemos nosotros no las hace confiables —quien desconfíe compara el
-- identificador del bloque contra cualquier explorador—, pero sí hace que la comprobación se pueda
-- hacer entera en un avión.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE governance.bitcoin_header (
  height     bigint      NOT NULL PRIMARY KEY CHECK (height >= 0),
  header     bytea       NOT NULL CHECK (octet_length(header) = 80),
  seen_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Propiedad y privilegios.
--
-- Las dos tablas son de `koinonia_ddl`, como todo lo de `governance` (§4.1). No es una formalidad:
-- el dueño de una tabla puede hacer `ALTER TABLE … DISABLE TRIGGER` y saltarse el blindaje
-- append-only. Si la aplicación fuera dueña de algo aquí dentro, tendría una llave que no debe
-- tener. Lo comprueba `tests/integration/append-only.test.ts`, que es quien destapó que a esta
-- migración le faltaban estas dos líneas.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE governance.anchor_attempt  OWNER TO koinonia_ddl;
ALTER TABLE governance.bitcoin_header  OWNER TO koinonia_ddl;

-- `UPDATE` sobre `anchor_attempt` sí hace falta: un reintento pisa la fila. Es legítimo porque esta
-- tabla no es historia; la historia de los intentos está en el agregado `#anclaje`, donde ni el rol
-- de la aplicación ni el trigger permiten un `UPDATE`.
GRANT SELECT, INSERT, UPDATE ON governance.anchor_attempt TO koinonia_app;
GRANT SELECT, INSERT         ON governance.bitcoin_header TO koinonia_app;
