-- ADR-0045 — Capacidad propia cifrada dentro de la bóveda mutable de identidad.
--
-- Ni el límite en minutos ni una representación JSON viven en PostgreSQL. Una DSK aleatoria por
-- persona cifra el valor y queda envuelta por una KEK que sólo recibe el proceso. Al borrar la fila
-- de identity.member desaparecen tanto la DSK como el único ciphertext de capacidad del sujeto.

CREATE TABLE identity.subject_data_key (
  member_id      char(32) NOT NULL PRIMARY KEY
    REFERENCES identity.member(member_id) ON DELETE CASCADE,
  key_ref        char(32) NOT NULL UNIQUE,
  wrap_nonce     bytea    NOT NULL,
  wrapped_dek    bytea    NOT NULL,
  crypto_version integer  NOT NULL,
  CONSTRAINT subject_data_key_member_hex_ck CHECK (member_id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT subject_data_key_ref_hex_ck CHECK (key_ref ~ '^[0-9a-f]{32}$'),
  CONSTRAINT subject_data_key_wrap_nonce_ck CHECK (octet_length(wrap_nonce) = 12),
  CONSTRAINT subject_data_key_wrapped_dek_ck CHECK (octet_length(wrapped_dek) >= 48),
  CONSTRAINT subject_data_key_crypto_version_ck CHECK (crypto_version > 0),
  CONSTRAINT subject_data_key_member_ref_uq UNIQUE (member_id, key_ref)
);

CREATE TABLE identity.contribution_capacity (
  member_id  char(32)    NOT NULL PRIMARY KEY
    REFERENCES identity.member(member_id) ON DELETE CASCADE,
  revision   integer     NOT NULL,
  key_ref    char(32)    NOT NULL
    REFERENCES identity.subject_data_key(key_ref) ON DELETE CASCADE,
  nonce      bytea       NOT NULL,
  ciphertext bytea       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT contribution_capacity_member_hex_ck CHECK (member_id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT contribution_capacity_key_ref_hex_ck CHECK (key_ref ~ '^[0-9a-f]{32}$'),
  CONSTRAINT contribution_capacity_revision_ck CHECK (revision > 0),
  CONSTRAINT contribution_capacity_nonce_ck CHECK (octet_length(nonce) = 12),
  CONSTRAINT contribution_capacity_ciphertext_ck CHECK (octet_length(ciphertext) >= 16),
  CONSTRAINT contribution_capacity_subject_key_fk
    FOREIGN KEY (member_id, key_ref)
    REFERENCES identity.subject_data_key(member_id, key_ref) ON DELETE CASCADE
);

REVOKE ALL ON identity.subject_data_key FROM PUBLIC;
REVOKE ALL ON identity.contribution_capacity FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_ddl') THEN
    EXECUTE 'ALTER TABLE identity.subject_data_key OWNER TO koinonia_ddl';
    EXECUTE 'ALTER TABLE identity.contribution_capacity OWNER TO koinonia_ddl';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.subject_data_key TO koinonia_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.contribution_capacity TO koinonia_app';
  END IF;
END $$;
