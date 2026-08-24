-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0012 — Sesión endurecida (T-06, docs/THREAT_MODEL.md): marca de actividad.
--
-- El umbral de 8 h absolutas ya vive en código (`SESION_VIGENCIA_MS`, `identity.session.expires_at`
-- lo aplica sin tocar el esquema). Lo que SÍ necesita una columna nueva es el corte por
-- **inactividad**: 60 minutos sin ninguna petición autenticada. Sin una marca separada de «última
-- actividad», no hay forma de distinguir «sesión de 7 horas usada sin parar» de «sesión de 7 horas
-- abierta y olvidada en un equipo compartido» — que es precisamente el escenario de robo de sesión
-- que T-06 quiere cortar.
--
-- `last_seen_at` empieza igual a `issued_at` (se fija así en el `INSERT` de `openSession`, no con
-- `DEFAULT clock_timestamp()`: el reloj de esta aplicación es el puerto inyectado, nunca el reloj
-- de la base — la misma razón por la que `issued_at` y `expires_at` tampoco usan `DEFAULT`) y se
-- adelanta con cada petición autenticada, pero no en cada una: `identity.ts::resolveSession` sólo
-- escribe la marca cuando ya pasaron varios minutos desde la última escritura, para no convertir
-- cada lectura en una escritura a la base. El detalle vive en el código, no aquí.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE identity.session
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp();
