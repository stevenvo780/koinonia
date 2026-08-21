# ADR-0002: Event sourcing sobre PostgreSQL, sin broker de eventos dedicado

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** decisión estructural del arquitecto; base de `30-decision-engine-spec.md` §A.7–A.10 (`replay` por `seq`, resultado derivado, `occurredAt` del servidor) y de `11-privacidad-y-voto-secreto.md` §1.1 (Governance Ledger sólo-INSERT).

## Contexto

La promesa política de Koinonía es «nada de lo decidido puede alterarse». Eso exige que el estado sea una **función del log** y no al revés: si el resultado de una votación es una fila mutable, cualquiera con acceso a la base la edita y no queda rastro. Con event sourcing, el resultado es derivado y recomputable, y una discrepancia entre lo almacenado y lo recomputado es detectable y dispara anulación (ADR-0026).

La pregunta abierta era la infraestructura. La tentación estándar —Kafka, NATS, RabbitMQ— añade un componente distribuido más a un sistema que lo administra un estudiante voluntario en un VPS, con rotación anual y bus factor de uno o dos (`03-deliberativa-sistemas-antipatrones.md` §5.6).

## Decisión

**Event sourcing con PostgreSQL como único almacén.** El Governance Ledger es una tabla append-only (`INSERT` únicamente; sin `UPDATE`, sin `DELETE`, revocado a nivel de rol de base de datos) con:

- `seq bigserial` — **el orden canónico de replay es por `seq`, nunca por `occurredAt`** (spec 30 §A.9).
- `occurredAt` — instante asignado por el servidor, único válido para evaluar ventanas (§A.10).
- `prevHash` / `hash` — encadenamiento (ADR-0005).

Las proyecciones y vistas materializadas se reconstruyen desde el log. La notificación entre componentes usa `LISTEN`/`NOTIFY` y una tabla `outbox` con reintentos; no hay broker.

## Alternativas consideradas

- **Kafka o NATS como bus de eventos.** Resuelve un problema de escala que no tenemos (300 personas, unidades de eventos por minuto en el pico) y agrega un servicio con su propio ciclo de vida, su propia persistencia y su propio modo de fallar a las tres de la mañana. El coste operativo recae sobre una persona que además está en parciales.
- **CRUD clásico con tabla de auditoría.** Es lo que hace todo el mundo y es exactamente lo que Koinonía no puede hacer: la auditoría es un efecto secundario que el mismo actor con permisos de escritura puede desactivar o editar. El log deja de ser fuente de verdad y pasa a ser una promesa.
- **Base de datos append-only especializada** (Datomic, QLDB, EventStoreDB). Añade dependencia de proveedor o de un stack ajeno al equipo, y ninguna aporta algo que PostgreSQL con un rol restringido no dé a esta escala.
- **Blockchain.** Descartada con argumento propio en `03-deliberativa-sistemas-antipatrones.md` §4: comisiones, wallets, claves perdidas y una alfabetización que excluiría a más gente de la que incluiría. Lo único que se toma de ahí es el anclaje externo (ADR-0005) y el faro de aleatoriedad (ADR-0024).

## Consecuencias

- Una sola pieza de infraestructura con estado que respaldar, restaurar y entender. Un relevo generacional del equipo aprende una cosa, no cuatro.
- Transacciones ACID entre el evento y sus efectos: la marca de «X votó» y la papeleta se insertan en la misma transacción, lo que da la unicidad del voto sin coordinación distribuida (`11-privacidad-y-voto-secreto.md` §2.6.1).
- El `replay` completo del histórico es viable por tamaño y sirve como prueba de integridad periódica.
- Los `snapshots` son optimización, nunca fuente de verdad: siempre reconstruibles.

## Consecuencias negativas aceptadas

- PostgreSQL es un punto único de fallo. Se mitiga con réplica y backups probados, no se elimina.
- Los eventos son inmutables, así que **todo error de modelado de un evento se hereda para siempre**; corregirlo exige versionar el esquema de evento y mantener el lector antiguo.
- Migrar a un bus real, si el proyecto federara con otros estamentos (`02-sociocracia-ostrom.md`, principio 8), costará trabajo. Se acepta: es un problema que sólo tendremos si el proyecto triunfa mucho más de lo previsto.
- Las consultas de lectura complejas exigen proyecciones mantenidas a mano; no hay ORM que las genere solo.
