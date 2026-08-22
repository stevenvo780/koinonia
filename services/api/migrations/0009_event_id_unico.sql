-- ADR-0045 — `eventId` es una identidad global, no sólo una referencia dentro de cada agregado.
--
-- Los eventos de dominio lo conservan en la envoltura JSON canónica `payload.eventId`. Permitir
-- repetirlo en otro tipo o stream vuelve ambiguas las referencias `offerId`, `pauseId`,
-- `evidenceId` y `deliveryId`; dentro de una misma iniciativa incluso permite un ABA que hace que
-- dos pausas parezcan la misma. El dominio lo comprueba al reconstruir un stream. Este índice cierra
-- además la colisión entre agregados y las carreras de dos procesos.
--
-- Los eventos técnicos históricos que no tienen `eventId` quedan fuera del índice. La expresión usa
-- `payload_idx`, que es una copia derivada del texto canónico; no añade nada a la preimagen ni cambia
-- hashes ya existentes.
-- Deliberadamente sin `IF NOT EXISTS`: un objeto homónimo con otra definición no es una razón
-- para declarar aplicada esta garantía. PostgreSQL debe abortar la migración y obligar a revisar
-- el catálogo, en vez de continuar con una falsa sensación de unicidad.
CREATE UNIQUE INDEX governance_event_payload_event_id_uk
  ON governance.event ((payload_idx ->> 'eventId'))
  WHERE payload_idx ? 'eventId';
