-- ADR-0044: una clave pública y una operación derivada interna no comparten namespace.
-- La columna tiene default para que el hecho histórico ya almacenado sea explícitamente `public`.
ALTER TABLE governance.append_request
  ADD COLUMN request_scope text NOT NULL DEFAULT 'public'
    CHECK (length(request_scope) BETWEEN 1 AND 80 AND request_scope ~ '^[a-z0-9:._-]+$');

ALTER TABLE governance.append_request
  DROP CONSTRAINT append_request_pkey;

ALTER TABLE governance.append_request
  ADD CONSTRAINT append_request_pkey PRIMARY KEY (request_scope, request_id);

COMMENT ON COLUMN governance.append_request.request_scope IS
  'Namespace de idempotencia. public para HTTP; los pasos internos coordinados usan un scope fijo.';
