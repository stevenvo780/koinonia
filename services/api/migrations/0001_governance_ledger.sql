-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0001 — Esquema `governance`: el ledger inmutable.
--
-- Referencia: `docs/research/10-ledger-inmutable.md` §1.1-bis, §2.3, §3.1, §3.2, §6.4.
--
-- ⛔ REGLA DE TIPOS DEL LEDGER (§1.1-bis) — la razón de ser de este fichero.
--
--   Ningún valor que forme parte de la preimagen de un hash puede almacenarse en una columna cuyo
--   tipo NORMALICE su representación.
--
-- Si se viola, al rehidratar el evento desde la base la preimagen cambia, el `event_hash` no
-- coincide, y **el sistema se acusa a sí mismo de haber sido manipulado sin que nadie lo tocara**.
-- Un verificador que grita corrupción cuando no la hay entrena a la asamblea a ignorarlo, y ahí
-- muere la única garantía que este proyecto ofrece.
--
-- Las tres normalizaciones están medidas, no supuestas (ver
-- `tests/integration/tipos-prohibidos-contraste.test.ts`, que las ejecuta contra PostgreSQL real):
--
--   uuid         '9f1c2d3e4a5b60718293a4b5c6d7e8f0'  ->  '9f1c2d3e-4a5b-6071-8293-a4b5c6d7e8f0'
--   jsonb        '{"alfa":1,"b":2,"zeta":3}'         ->  '{"b": 2, "alfa": 1, "zeta": 3}'
--   timestamptz  '2026-08-21T14:03:07.100Z'          ->  '2026-08-21 14:03:07.1+00'
--
-- `jsonb` es la peor de las tres por alcance: no guarda el texto, guarda un árbol descompuesto, y lo
-- reemite con las claves ordenadas por longitud-y-luego-bytes —criterio que NO es el de JCS—, con
-- los números renormalizados (`1e2` -> `100`) y con las claves duplicadas colapsadas en silencio.
-- Con `jsonb` como columna autoritativa, la primera restauración de `pg_dump` invalidaría la
-- historia completa.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA governance;

COMMENT ON SCHEMA governance IS
  'Ledger inmutable. Propietario: koinonia_ddl. La aplicación NUNCA es dueña de estos objetos.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Contador global DENSO. Deliberadamente NO es una secuencia (§3.2).
--
-- `nextval()` no se revierte con `ROLLBACK`: un append fallido dejaría un hueco permanente. Y si
-- los huecos son normales, el verificador que ve que falta el `leaf_index` 4711 no puede concluir
-- «aquí se borró un evento»: el administrador tiene la coartada perfecta y no falsable «fue un
-- rollback». Regalarle esa coartada anula la tercera capa de detección del §2.3.
--
-- La densidad se compra con un punto de serialización global de escrituras. Para ~300 personas es
-- un intercambio consciente de escalabilidad por auditabilidad, y aquí la auditabilidad ES el
-- producto.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE governance.ledger_cursor (
  id              boolean NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (id),
  next_leaf_index bigint  NOT NULL DEFAULT 0 CHECK (next_leaf_index >= 0)
);

INSERT INTO governance.ledger_cursor (id) VALUES (TRUE);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- La tabla de eventos.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE governance.event (
  leaf_index     bigint       NOT NULL PRIMARY KEY CHECK (leaf_index >= 0),

  -- ══════════ PREIMAGEN ══════════
  -- Todo lo que sigue entra en el objeto canónico que se hashea. Tipos permitidos por §1.1-bis:
  -- char(n) con CHECK anclado, text, bytea, bigint, integer, boolean. Nada más.
  --
  -- Nota sobre `char(n)`: por sí solo TAMBIÉN normaliza —rellena con espacios hasta n—, así que
  -- sólo es admisible acompañado del CHECK anclado que fija la longitud exacta. Sin el CHECK,
  -- insertar 'abc' en un char(32) devolvería 'abc' + 29 espacios y la preimagen cambiaría. El
  -- CHECK lo caza porque la conversión bpchar->text que hace el operador `~` recorta los espacios
  -- finales, con lo que 'abc' no cumple `^[0-9a-f]{32}$`. Medido, no supuesto.
  aggregate_id   char(32)     NOT NULL CHECK (aggregate_id ~ '^[0-9a-f]{32}$'),
  aggregate_type text         NOT NULL CHECK (aggregate_type ~ '^#?[a-z][a-z0-9_]*$'),
  seq            integer      NOT NULL CHECK (seq >= 0),
  event_type     text         NOT NULL CHECK (event_type ~ '^[A-Z][A-Za-z0-9]*$'),
  event_version  integer      NOT NULL CHECK (event_version >= 1),

  -- RFC 3339 UTC exacto: 'YYYY-MM-DDTHH:MM:SS.sssZ', 24 caracteres, milisegundos SIEMPRE
  -- presentes. NUNCA timestamptz: cambia el separador, la zona y trunca los ceros de los
  -- milisegundos ('.100' -> '.1').
  occurred_at    char(24)     NOT NULL
                 CONSTRAINT event_occurred_at_shape_ck
                 CHECK (occurred_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),

  -- MemberId de quien actúa. NULL significa «clave `actor` AUSENTE del objeto canónico», nunca
  -- `"actor": null`: el NULL de SQL y el null de JSON no son el mismo valor, y §1.3.d prohíbe el
  -- segundo. La capa de acceso a datos omite la clave; no la emite vacía.
  actor          char(32)     CHECK (actor ~ '^[0-9a-f]{32}$'),

  -- El texto canónico JCS EXACTO que se hasheó. Única fuente de verdad del payload.
  payload        text         NOT NULL CHECK (octet_length(payload) > 0),

  -- Copia derivada y **NO AUTORITATIVA**, sólo para consulta (GIN, ->>). El verificador no la lee
  -- JAMÁS. Si un día diverge de `payload`, la que está mal es ésta, por definición.
  payload_idx    jsonb        GENERATED ALWAYS AS (payload::jsonb) STORED,

  -- ══════════ FIN DE LA PREIMAGEN ══════════
  -- Lo de abajo es sobre: metadatos de almacenamiento o resultados del hash. No entra a ningún
  -- hash, así que `uuid` y `timestamptz` son aquí perfectamente legítimos. La regla es sobre
  -- participar del hash, no una fobia a los tipos ricos de PostgreSQL.

  prev_hash      bytea        NOT NULL CHECK (octet_length(prev_hash) = 32),
  event_hash     bytea        NOT NULL CHECK (octet_length(event_hash) = 32),

  -- Cabeza de la espina de la que cuelga este génesis (§2.3). NULL en todo lo demás.
  spine_hash     bytea        CHECK (spine_hash IS NULL OR octet_length(spine_hash) = 32),

  request_id     uuid         NOT NULL,
  recorded_at    timestamptz  NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT event_agg_seq_uk UNIQUE (aggregate_id, seq),
  CONSTRAINT event_hash_uk    UNIQUE (event_hash),

  -- ── Doble vínculo con la espina dorsal (§2.3) ──────────────────────────────────────────────
  --
  -- DECISIÓN: §3.1 escribe `CHECK ((seq = 0) = (spine_hash IS NOT NULL))`, que obliga al propio
  -- génesis de la espina a llevar un `spine_hash` no nulo… cuando por definición no cuelga de
  -- ninguna espina: es la raíz de confianza. La spec dejaba dos salidas y no elegía ninguna:
  -- guardar 32 ceros centinela en una columna cuyo significado es «hash de una cabeza real de la
  -- espina», o excluir el génesis de la espina. Se elige lo segundo, porque el centinela haría
  -- imposible la clave foránea de abajo, que es lo que convierte el vínculo hacia atrás en una
  -- garantía del motor y no en una convención de la aplicación.
  CONSTRAINT event_genesis_ck CHECK (
    (seq = 0 AND aggregate_id <> '00000000000000000000000000000001') = (spine_hash IS NOT NULL)
  ),

  -- Todo génesis cuelga de la espina y de nada más.
  CONSTRAINT event_genesis_link_ck CHECK (spine_hash IS NULL OR prev_hash = spine_hash),

  -- El génesis de la espina es el ÚNICO evento del sistema que cuelga de 32 ceros (§2.3). Sin
  -- esto, cualquier agregado podría nacer «huérfano» y su desaparición completa volvería a ser
  -- gratuita: es exactamente el ataque que la espina existe para cerrar.
  CONSTRAINT event_zero_prev_ck CHECK (
    prev_hash <> '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea
    OR (aggregate_id = '00000000000000000000000000000001' AND seq = 0)
  )
);

-- El vínculo HACIA ATRÁS, garantizado por el motor: el `spine_hash` de todo génesis apunta a un
-- evento que existe de verdad. Borrar la cabeza de la espina de la que cuelga un agregado deja de
-- ser posible sin tocar antes al agregado. El vínculo HACIA ADELANTE —el `AgregadoAbierto` que la
-- espina escribe con el `genesisHash` del recién nacido— no se puede expresar como clave foránea
-- (vive dentro del texto del payload) y lo comprueba `verifySpine()`: para cada `AgregadoAbierto`,
-- existe el evento con ese hash.
ALTER TABLE governance.event
  ADD CONSTRAINT event_spine_fk
  FOREIGN KEY (spine_hash) REFERENCES governance.event (event_hash);

COMMENT ON COLUMN governance.event.payload IS
  'Texto canónico JCS EXACTO que se hasheó. Única fuente de verdad. NUNCA jsonb.';
COMMENT ON COLUMN governance.event.payload_idx IS
  'DERIVADA y NO AUTORITATIVA. Sólo para consulta. El verificador no la lee jamás.';
COMMENT ON COLUMN governance.event.occurred_at IS
  'char(24) RFC 3339 UTC exacto. Entra en la preimagen: NUNCA timestamptz.';
COMMENT ON COLUMN governance.event.request_id IS
  'Sobre, no preimagen: por eso puede ser uuid sin riesgo (§1.1-bis corolario 3).';

-- `event_agg_seq_uk` ya crea el índice sobre (aggregate_id, seq): §3.1 añadía además un
-- `CREATE INDEX event_agg_idx` idéntico, que sólo duplica el coste de escritura en la ruta caliente
-- del append sin aportar ningún plan nuevo. No se replica.
CREATE INDEX event_type_idx    ON governance.event (aggregate_type, event_type);
CREATE INDEX event_request_idx ON governance.event (request_id);
CREATE INDEX event_payload_idx ON governance.event USING gin (payload_idx);  -- consulta, no verdad

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Cabeza de cadena por agregado: la única fila mutable del subsistema, y caché derivada.
-- Su integridad no descansa en los privilegios sino en que cualquier discrepancia con la cadena
-- recomputada es detectable (`verifyHeads()`).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE governance.aggregate_head (
  aggregate_id   char(32)    NOT NULL PRIMARY KEY CHECK (aggregate_id ~ '^[0-9a-f]{32}$'),
  aggregate_type text        NOT NULL,
  seq            integer     NOT NULL CHECK (seq >= 0),
  head_hash      bytea       NOT NULL CHECK (octet_length(head_hash) = 32),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Idempotencia por `request_id` (§3.5).
--
-- DECISIÓN: §3.1 pone `CONSTRAINT event_request_uk UNIQUE (request_id)` sobre `governance.event`,
-- pero §3.3 inserta un LOTE de N eventos por comando y §3.5 dice que cada COMANDO trae un
-- `requestId`. Las dos cosas juntas son imposibles: con N > 1 el lote viola su propia UNIQUE en el
-- primer intento, y darle un `requestId` distinto a cada evento del lote destruye la idempotencia
-- del comando, que es para lo que existe. La clave de idempotencia se saca a su propia tabla, con
-- el resultado que hay que devolver al reintento; `event.request_id` se conserva como procedencia
-- y se indexa, pero no es único.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE governance.append_request (
  request_id       uuid        NOT NULL PRIMARY KEY,
  aggregate_id     char(32)    NOT NULL CHECK (aggregate_id ~ '^[0-9a-f]{32}$'),
  first_leaf_index bigint      NOT NULL CHECK (first_leaf_index >= 0),
  event_count      integer     NOT NULL CHECK (event_count >= 1),
  head_seq         integer     NOT NULL CHECK (head_seq >= 0),
  head_hash        bytea       NOT NULL CHECK (octet_length(head_hash) = 32),
  recorded_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Checkpoints Merkle (§6.4).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE governance.checkpoint (
  tree_size       bigint      NOT NULL PRIMARY KEY CHECK (tree_size >= 0),
  root_hash       bytea       NOT NULL CHECK (octet_length(root_hash) = 32),
  heads_root      bytea       NOT NULL CHECK (octet_length(heads_root) = 32),
  prev_checkpoint bytea       CHECK (prev_checkpoint IS NULL OR octet_length(prev_checkpoint) = 32),

  -- PREIMAGEN (§1.1-bis): mismo formato exacto que `event.occurred_at`. NUNCA timestamptz.
  issued_at       char(24)    NOT NULL
                  CHECK (issued_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),

  checkpoint_hash bytea       NOT NULL UNIQUE CHECK (octet_length(checkpoint_hash) = 32),
  firm            boolean     NOT NULL DEFAULT FALSE,
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON COLUMN governance.checkpoint.issued_at IS
  'char(24): participa de la preimagen del checkpoint_hash. §3.1 lo tenía como timestamptz.';
