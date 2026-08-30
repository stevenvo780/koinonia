-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 0015 — Que la purga de `identity.rate_consumption` pueda ejecutarse (ADR-0055).
--
-- La 0013 creó la tabla, escribió en su cabecera que «se purga con la misma cadencia que
-- identity.rate_bucket» y hasta creó el índice `rate_consumption_consumed_at` diciendo, con esas
-- palabras, que era «para la purga por antigüedad». Y después concedió:
--
--     GRANT SELECT, INSERT ON identity.rate_consumption TO koinonia_app;
--
-- Sin DELETE. Así que la purga que esa misma migración daba por hecha no podía ejecutarse: el rol
-- de la aplicación es el único que corre en el servicio, y un DELETE suyo sobre esa tabla falla con
-- 42501. `purgeOldConsumptions` estaba escrita, probada y desplegada, y no la llamaba nadie —lo que
-- tapaba el problema, porque el día que alguien la llamara habría empezado a fallar cada hora—.
--
-- Es un descuido y no una decisión de seguridad: `identity.rate_bucket`, que guarda datos de la
-- misma naturaleza y se barre con la misma cadencia, sí tiene DELETE desde la 0005.
--
-- ═══ Qué NO cambia ═══
--
-- Sigue sin haber UPDATE. Una fila de consumo se pone y se borra cuando caduca; corregirla no
-- significa nada, y no tenerlo cierra que se pueda reescribir el rastro de idempotencia en vez de
-- retirarlo entero. `governance.event` no se toca acá ni podría: el historial es de sólo-anexar y
-- esta migración no lo menciona.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'koinonia_app') THEN
    EXECUTE 'GRANT DELETE ON identity.rate_consumption TO koinonia_app';
  END IF;
END
$$;
