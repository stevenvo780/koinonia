# ADR-0026: El resultado es un dato derivado; la discrepancia entre lo almacenado y lo recomputado dispara anulación

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `30-decision-engine-spec.md` DECISIONES A.7, A.8, A.9 y A.10; `02-sociocracia-ostrom.md`, principio 4 de Ostrom (monitoreo por los propios miembros).

## Contexto

En un sistema CRUD, el resultado de una votación es una fila. Quien tiene permisos de escritura la edita, y la única defensa es un registro de auditoría que el mismo actor puede tocar. En una plataforma cuyo propósito declarado es servir de contrapeso frente a una institución, eso es inaceptable: **el equipo técnico no puede ser soberano político** (`02-sociocracia-ostrom.md`, principio 7).

## Decisión

`ResultComputed` **no es fuente de verdad**: es una proyección. El resultado se recomputa desde el log —papeletas, delegaciones, configuración congelada y semilla— y:

- **La discrepancia entre lo almacenado y lo recomputado dispara `Annulled` automático.** No es una alerta que alguien deba mirar: es una transición de estado.
- **El orden canónico de replay es por `seq`, nunca por `occurredAt`** (A.9). Un reloj que retrocede no puede reordenar la historia.
- **`occurredAt` es el reloj del servidor** y es el único válido para evaluar la ventana (A.10). El cliente no aporta tiempo.
- **`configHash` incluye `engineVersion`** (A.7): un cambio de algoritmo produce un hash distinto, y los escrutadores históricos se conservan y se mantienen ejecutables. Una decisión de 2026 se verifica con el motor de 2026.
- `DecisionCerrada` **materializa el conteo en el propio evento**, de modo que una corrección posterior de datos no reescriba un resultado histórico (`01-decidim-loomio-polis.md` §2).

## Alternativas consideradas

- **Resultado como estado autoritativo.** Es lo estándar y hace la manipulación indetectable.
- **Alerta en vez de anulación automática.** Deja la decisión en manos de quien mira la alerta —posiblemente la misma persona que provocó la discrepancia.
- **Un único escrutador siempre actualizado.** Cambiar el algoritmo cambiaría retroactivamente resultados históricos. Es la razón de conservar los escrutadores antiguos.

## Consecuencias

- Alterar un resultado en la base de datos es **criptográficamente detectable** y se autoinvalida.
- Cualquier miembro puede ejecutar un verificador independiente que recompute el resultado desde los eventos y comparar.
- La `Proof` que acompaña a cada `DecisionResult` es reproducible, lo que hace la auditoría accesible a alguien sin formación técnica (spec 30 §0.1.2).

## Consecuencias negativas aceptadas

- **Un bug propio en el motor puede anular una decisión legítima.** El riesgo es real y por eso la spec 30 exige 60 invariantes de property-based testing con `numRuns ≥ 1000` antes de habilitar la anulación automática.
- Hay que **mantener ejecutables los escrutadores antiguos indefinidamente**. Es deuda de mantenimiento que sólo crece.
- Recomputar es más caro que leer una fila; a esta escala es irrelevante, pero condiciona cualquier proyección que se quiera hacer en caliente.
- La anulación automática puede ser usada como ataque de denegación si alguien encuentra cómo provocar una discrepancia. Hay que tratar cualquier `Annulled` por inconsistencia como incidente de seguridad, no como error de datos.
