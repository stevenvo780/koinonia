# ADR-0013: Prohibición estructural de vincular padrón y urna

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §2.4 (**ADR-118 propuesto**).

## Contexto

En el voto secreto de la etapa 1, el secreto depende de que no exista ninguna vía —ni técnica ni accidental— para cruzar «quién votó» con «qué se votó». El fallo clásico es guardarlo todo en una tabla y «anular» la columna del votante al cerrar: el WAL, las réplicas y los backups conservan el valor anterior, de modo que el secreto dura hasta el primer `pg_waldump`.

## Decisión

Dos esquemas separados, `roll` y `urn`, **sin ninguna clave foránea entre ellos**, sin columnas comunes más allá de `decision_id`, con **roles de base de datos distintos**, y un test de CI que analiza el SQL emitido por la aplicación y **falla ante cualquier `JOIN` entre ambos esquemas**.

- `roll.voter_marks (decision_id, member_id, voted_on date)` — la unicidad del voto (R2 de doc 11 §2.1) la da su clave primaria, **no** una relación con la papeleta.
- `urn.ballots (decision_id, tracker, choice, batch_seq)` — sin votante y **sin ninguna columna temporal** (ADR-0014).

Prohibidos por lint: cualquier clave foránea, cualquier columna común adicional, cualquier índice compuesto entre esquemas y cualquier columna con hora en `urn.ballots`.

La elegibilidad se comprueba contra el padrón congelado **al admitir la papeleta**, sin dejar rastro en la urna.

## Alternativas consideradas

- **Una sola tabla con la columna del votante anulada al cerrar.** El WAL y los backups conservan el valor anterior. Es el error que parece resolver el problema y no lo resuelve.
- **Separación por permisos dentro del mismo esquema.** Un `GRANT` mal puesto, un superusuario o un volcado completo la colapsan. Los permisos son revocables; la ausencia de una relación, no.
- **Cifrar el vínculo con una clave que se destruye al cerrar.** Reintroduce la dependencia de la custodia de un secreto para una propiedad que puede obtenerse por construcción.

## Consecuencias

- Cruzar padrón y urna deja de ser una consulta y pasa a ser un acto deliberado, visible y con dos credenciales.
- El test de CI convierte la regla en algo que se rompe **en el pipeline**, no en una revisión de código que falla el día que hay prisa.
- Complementa a ADR-0014 y ADR-0015: sin marcas temporales y con orden canónico publicado, se cierran también los canales laterales que sobreviven a la separación de tablas.

## Consecuencias negativas aceptadas

- **No se puede ofrecer «cambiá tu voto»** sin un mecanismo explícito basado en el tracker, porque no hay forma de localizar la papeleta de una persona.
- Tampoco se puede responder «¿voté ya?» consultando la urna: hay que consultar `roll`, que es un almacén distinto.
- El análisis estático del SQL emitido produce falsos positivos y hay que mantener una lista de excepciones comentada.
- La separación **no protege del administrador**, que tiene acceso a ambos esquemas (ADR-0010). Eleva el coste y deja rastro; no lo impide.
