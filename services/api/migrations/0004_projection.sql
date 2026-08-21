-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0004 — Proyecciones (§5).
--
-- Las proyecciones son **derivadas y desechables**. Si alguna vez hay que elegir entre el ledger y
-- una vista de lectura, el ledger gana siempre: se borra la proyección y se reconstruye. Viven en un
-- esquema aparte, con permisos normales de lectura/escritura, porque su integridad no se protege con
-- privilegios sino con **reproducibilidad**.
--
-- Nadie edita datos a mano aquí. Nunca. Un `UPDATE` manual sobre una proyección es indetectable por
-- el verificador —no está en el ledger— y crea una divergencia que el próximo reproceso deshará sin
-- explicación.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA projection;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Offset transaccional.
--
-- El avance del offset ocurre EN LA MISMA TRANSACCIÓN que la escritura de la vista, con CAS sobre
-- `last_leaf`. Así «aplicar el evento» y «declarar que se aplicó» no pueden divergir.
--
-- `running_hash` es un plegado sobre los eventos efectivamente aplicados, con octeto de dominio
-- propio para no confundirse con eslabones (0x02), hojas (0x00) ni nodos (0x01):
--
--     running_0 = 0x00…00
--     running_i = SHA256( 0x03 ‖ running_{i-1} ‖ eventHash_i )
--
-- Su función es distinguir dos fallas que `last_leaf` por sí solo NO distingue: «voy atrasado»
-- (benigno) de «apliqué una historia distinta de la que el ledger tiene hoy» (alarma).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE projection.offset_tracker (
  projection   text        NOT NULL PRIMARY KEY,
  last_leaf    bigint      NOT NULL DEFAULT -1,
  running_hash bytea       NOT NULL
               DEFAULT '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea
               CHECK (octet_length(running_hash) = 32),
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Vista de lectura del tablero de decisiones.
--
-- Todo lo de aquí es reconstruible desde `leaf_index = 0`. Los tipos son los cómodos, no los del
-- ledger: en una proyección `timestamptz` es correcto porque nada de esto entra a ninguna
-- preimagen. La regla de tipos sigue al hash, no al esquema.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE projection.decision_board (
  decision_id     char(32)    NOT NULL PRIMARY KEY,
  status          text        NOT NULL,
  summary         text,
  round           integer     NOT NULL DEFAULT 1,
  ballots_cast    integer     NOT NULL DEFAULT 0,
  distinct_voters integer     NOT NULL DEFAULT 0,
  opened_at       timestamptz,
  closed_at       timestamptz,
  close_cause     text,
  outcome_kind    text,
  result_hash     char(64),
  last_leaf       bigint      NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Quién ha votado, para poder contar votantes distintos sin releer el ledger. Igual que la tabla de
-- arriba: desechable y reconstruible.
CREATE TABLE projection.decision_voter (
  decision_id char(32) NOT NULL,
  voter       char(32) NOT NULL,
  ballots     integer  NOT NULL DEFAULT 0,
  PRIMARY KEY (decision_id, voter)
);

GRANT USAGE ON SCHEMA projection TO koinonia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA projection TO koinonia_app;
