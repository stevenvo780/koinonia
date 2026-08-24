-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0013 — Idempotencia del consumo de cuota (ADR-0055).
--
-- El mecanismo de `requestId` protege reintentos tras error de red. Antes, si un reintento
-- con la misma clave fallaba en `append()`, había gastado el cupo aunque no creó nada nuevo.
-- Esto castiga a quien tiene conexión móvil inestable.
--
-- Solución: tabla separada para marcar que un (requestId, ambito, sujeto, window_start) ya
-- consumió cuota. Si llega el mismo (requestId, ambito, sujeto, window_start) dos veces,
-- solo la primera consume; la segunda es idempotencia segura.
--
-- La tabla se purga con la misma cadencia que `identity.rate_bucket` (máxima ventana de cuota).
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- Tabla de dedup idempotente para consumo de cuota.
CREATE TABLE IF NOT EXISTS identity.rate_consumption (
  request_id VARCHAR(36) NOT NULL,
  ambito VARCHAR(50) NOT NULL,
  sujeto VARCHAR(32) NOT NULL,
  window_start TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- La combinación de estos cuatro campos es lo que hace idempotente el consumo.
  -- Si la misma (request_id, ambito, sujeto, window_start) llega dos veces, el segundo
  -- INSERT violará esta restricción UNIQUE y el ON CONFLICT lo manejará.
  UNIQUE (request_id, ambito, sujeto, window_start)
);

-- Índice para la purga por antigüedad (barrido de registros viejos).
CREATE INDEX IF NOT EXISTS rate_consumption_consumed_at
  ON identity.rate_consumption (consumed_at);

-- Grant: el usuario de la aplicación puede leer y escribir.
GRANT SELECT, INSERT ON identity.rate_consumption TO koinonia_app;
