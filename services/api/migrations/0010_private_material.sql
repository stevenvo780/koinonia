-- ADR-0045 — Aperturas textuales restringidas fuera del ledger.
--
-- La fila sólo localiza un ciphertext autenticado. Nonce del commitment, contexto y contenido
-- viven juntos dentro del ciphertext; no hay digest, URL, MIME, nombre ni tamaño exacto buscable.
-- Toda escritura f2 ocupa un frame autenticado de 128 KiB más el tag GCM de 16 bytes: ni siquiera
-- `octet_length(ciphertext)` distingue un texto corto de uno cercano al máximo de 16 KiB.

CREATE TABLE identity.private_material (
  material_id char(32)    NOT NULL PRIMARY KEY,
  owner_id    char(32)    NOT NULL
    REFERENCES identity.member(member_id) ON DELETE CASCADE,
  key_ref     char(32)    NOT NULL
    REFERENCES identity.subject_data_key(key_ref) ON DELETE CASCADE,
  purpose     text        NOT NULL,
  nonce       bytea       NOT NULL,
  ciphertext  bytea       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT private_material_id_hex_ck CHECK (material_id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT private_material_owner_hex_ck CHECK (owner_id ~ '^[0-9a-f]{32}$'),
  CONSTRAINT private_material_key_ref_hex_ck CHECK (key_ref ~ '^[0-9a-f]{32}$'),
  CONSTRAINT private_material_purpose_ck CHECK (
    purpose IN (
      'task-block-detail',
      'task-help-detail',
      'task-evidence-object',
      'task-delivery-summary',
      'task-change-detail'
    )
  ),
  CONSTRAINT private_material_nonce_ck CHECK (octet_length(nonce) = 12),
  CONSTRAINT private_material_ciphertext_ck CHECK (octet_length(ciphertext) = 131088),
  CONSTRAINT private_material_subject_key_fk
    FOREIGN KEY (owner_id, key_ref)
    REFERENCES identity.subject_data_key(member_id, key_ref) ON DELETE CASCADE
);

CREATE INDEX private_material_owner_idx ON identity.private_material (owner_id, material_id);

REVOKE ALL ON identity.private_material FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_ddl') THEN
    EXECUTE 'ALTER TABLE identity.private_material OWNER TO koinonia_ddl';
    EXECUTE 'ALTER INDEX identity.private_material_owner_idx OWNER TO koinonia_ddl';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON identity.private_material TO koinonia_app';
  END IF;
END $$;
