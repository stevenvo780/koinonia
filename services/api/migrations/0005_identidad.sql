-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0005 — La bóveda de identidad, FÍSICAMENTE separada del historial (ADR-0008).
--
-- Esquema aparte a propósito. En `governance` no hay ni un dato personal: sólo identificadores
-- opacos de 128 bits. Aquí sí los hay, y por eso este esquema tiene reglas contrarias a las de allá:
--
--   · `governance` es append-only y no se borra nunca  → es memoria colectiva.
--   · `identity`   es mutable y SE BORRA de verdad     → es un dato de una persona (ADR-0009).
--
-- Un `DELETE FROM identity.member` deja los eventos del historial exactamente donde estaban, con sus
-- identificadores opacos intactos y sus hashes cuadrando: la persona desaparece y la historia
-- permanece. Eso es lo que hace posible el derecho de supresión sin romper la verificabilidad, y
-- sólo funciona porque los dos mundos no comparten ni una clave foránea.
--
-- ═══ Lo que este esquema NO tiene, y es deliberado ═══
--
-- **No hay ninguna columna de dirección IP.** Ni aquí, ni en el ledger, ni en los registros de la
-- aplicación. Una IP en una comunidad de 300 personas que se conectan desde la misma facultad no es
-- un dato técnico: es un dato de ubicación de una persona identificable. El control de abuso se hace
-- con un contador por sujeto **con pimienta rotada a diario** (`identity.rate_bucket`), que caduca
-- solo y no se puede revertir al sujeto original una vez rota la pimienta del día.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS identity;

-- ── Personas ─────────────────────────────────────────────────────────────────────────────────
--
-- `member_id` es el MISMO identificador opaco que viaja por el ledger, pero la relación
-- `member_id ↔ correo` vive SÓLO aquí. Quien tenga una copia del historial no puede reconstruirla:
-- el identificador es aleatorio de 128 bits y no deriva de ningún dato personal (ADR-0006).
CREATE TABLE IF NOT EXISTS identity.member (
  member_id    char(32)    NOT NULL PRIMARY KEY,
  -- El correo en claro. Hace falta para enviar el enlace mágico; sin él no hay forma de entrar.
  -- Guardarlo hasheado y además poder mandar correo es imposible, y fingir lo contrario sería
  -- criptografía decorativa. Lo que sí se hace es no dejarlo salir nunca de este esquema.
  email        text        NOT NULL UNIQUE,
  -- Búsqueda sin exponer el original en un índice legible de un `pg_dump` parcial.
  email_hash   char(64)    NOT NULL UNIQUE,
  alias        text        NOT NULL,
  roles        text[]      NOT NULL DEFAULT ARRAY['member'],
  circles      char(32)[]  NOT NULL DEFAULT ARRAY[]::char(32)[],
  semestre     text        NOT NULL DEFAULT 's1',
  jornada      text        NOT NULL DEFAULT 'diurna',
  enrolled_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  withdrawn_at timestamptz,
  CONSTRAINT member_id_hex_ck   CHECK (member_id  ~ '^[0-9a-f]{32}$'),
  CONSTRAINT member_hash_hex_ck CHECK (email_hash ~ '^[0-9a-f]{64}$')
);

-- ── Enlaces mágicos ──────────────────────────────────────────────────────────────────────────
--
-- Del token NO se guarda el token: se guarda su huella. Quien lea la base no puede entrar como
-- nadie, porque de la huella no se vuelve al token.
--
-- `consumed_at` es la defensa contra la reproducción: consumir es un `UPDATE … WHERE token_hash = $1
-- AND consumed_at IS NULL`, es decir, una comparación-y-cambio atómica. Dos peticiones simultáneas
-- con el mismo enlace producen exactamente un ganador, porque lo decide el motor de la base y no una
-- lectura seguida de una escritura. Sin esa atomicidad, reenviar el enlace dos veces rápido abriría
-- dos sesiones y el «un solo uso» sería una aspiración.
CREATE TABLE IF NOT EXISTS identity.magic_link (
  token_hash  char(64)    NOT NULL PRIMARY KEY,
  member_id   char(32)    NOT NULL REFERENCES identity.member(member_id) ON DELETE CASCADE,
  issued_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT magic_hash_hex_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT magic_window_ck   CHECK (expires_at > issued_at)
);

CREATE INDEX IF NOT EXISTS magic_link_expires_idx ON identity.magic_link (expires_at);

-- ── Sesiones ─────────────────────────────────────────────────────────────────────────────────
--
-- Mismo principio: sólo la huella. Y sin columna de IP ni de agente de usuario: una sesión no
-- necesita saber desde dónde se abrió, y guardarlo convertiría el registro de sesiones en un
-- registro de movimientos.
CREATE TABLE IF NOT EXISTS identity.session (
  token_hash char(64)    NOT NULL PRIMARY KEY,
  member_id  char(32)    NOT NULL REFERENCES identity.member(member_id) ON DELETE CASCADE,
  issued_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT session_hash_hex_ck CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS session_expires_idx ON identity.session (expires_at);

-- ── Custodia de la semilla pública (B.0.3) ───────────────────────────────────────────────────
--
-- El compromiso `sha256(seed)` se publica DENTRO de la configuración congelada, antes de abrir. La
-- semilla en claro se guarda aquí hasta que toque revelarla. Está en la bóveda y no en el historial
-- por una razón exacta: si viviera en `governance`, que es público y exportable, el compromiso no
-- comprometería nada —cualquiera vería la semilla antes de tiempo— y el sorteo dejaría de ser
-- verificable para pasar a ser teatro.
--
-- DECISIÓN: el corte vertical no sortea nada (no hay paneles de admisibilidad ni comisiones), así
-- que ninguna semilla llega a revelarse todavía. Se compromete igual, porque B.0.3 exige que el
-- compromiso sea ANTERIOR a la apertura y eso no se puede retrofitear después.
CREATE TABLE IF NOT EXISTS identity.decision_seed (
  decision_id char(32)    NOT NULL PRIMARY KEY,
  seed_admin  text        NOT NULL,
  commitment  char(64)    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT seed_decision_hex_ck   CHECK (decision_id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT seed_commitment_hex_ck CHECK (commitment  ~ '^[0-9a-f]{64}$')
);

-- ── Control de abuso sin identificar a nadie ─────────────────────────────────────────────────
--
-- `bucket_key = sha256(pimienta_del_día ‖ sujeto)`. La pimienta cambia cada día, así que la clave de
-- hoy no sirve para correlacionar con la de ayer ni siquiera teniendo la base entera: es el mismo
-- sujeto y son dos claves sin relación computable. Y las filas de días anteriores se barren.
--
-- No es un adorno de privacidad: es lo que hace que un volcado de esta tabla no sea un mapa de quién
-- intentó entrar y cuándo.
CREATE TABLE IF NOT EXISTS identity.rate_bucket (
  bucket_key  char(64)    NOT NULL,
  -- Ventana redondeada. Con `window_start` y `bucket_key` basta para contar y para barrer.
  window_start timestamptz NOT NULL,
  hits        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start),
  CONSTRAINT rate_hash_hex_ck CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT rate_hits_ck     CHECK (hits >= 0)
);

CREATE INDEX IF NOT EXISTS rate_bucket_window_idx ON identity.rate_bucket (window_start);

-- ── Privilegios ──────────────────────────────────────────────────────────────────────────────
--
-- Aquí la aplicación SÍ tiene UPDATE y DELETE, al revés que en `governance`. Es la asimetría
-- completa: la historia no se toca; los datos de una persona se borran de verdad cuando lo pide.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_ddl') THEN
    EXECUTE 'ALTER SCHEMA identity OWNER TO koinonia_ddl';
    EXECUTE 'ALTER TABLE identity.member      OWNER TO koinonia_ddl';
    EXECUTE 'ALTER TABLE identity.magic_link  OWNER TO koinonia_ddl';
    EXECUTE 'ALTER TABLE identity.session     OWNER TO koinonia_ddl';
    EXECUTE 'ALTER TABLE identity.rate_bucket OWNER TO koinonia_ddl';
    EXECUTE 'ALTER TABLE identity.decision_seed OWNER TO koinonia_ddl';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_app') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA identity FROM PUBLIC';
    EXECUTE 'GRANT USAGE ON SCHEMA identity TO koinonia_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.member      TO koinonia_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.magic_link  TO koinonia_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.session     TO koinonia_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.rate_bucket TO koinonia_app';
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON identity.decision_seed TO koinonia_app';
  END IF;
END $$;
