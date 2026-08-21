# ADR-0023: Lista de prohibiciones del ledger aplicada por CI

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §1.6 (**ADR-116 propuesto**) y la tabla de reglas duras de `20-normativa-datos-colombia.md` §7.6. Es el mecanismo de aplicación de ADR-0007 y ADR-0008.

## Contexto

La frontera entre ledger y bóveda es la pieza de la que depende todo el diseño de privacidad. Una regla de esa importancia no puede sostenerse con «lo miramos en el code review»: la revisión humana **falla exactamente el día que hay prisa**, que es el día en que alguien añade un campo `email` a un payload para depurar un problema en producción.

## Decisión

La lista de prohibiciones es **normativa y ejecutable**. Nunca entran al ledger ni al ancla pública: nombre y apellidos; correo en cualquier forma derivada; documento; teléfono; IP y user-agent; foto o avatar; programa y semestre juntos; texto libre de comentarios; hora exacta de un voto secreto; `actor` en un `BallotCast` secreto; cualquier ciphertext de PII; claves, wrapped keys, pepper y sales; motivo textual de un reclamo; datos de menores de edad, aun seudonimizados; adjuntos y binarios.

Se aplica con **dos controles automáticos**:

1. **Lint sobre los tipos.** Se prohíben esos nombres de campo en todo tipo alcanzable desde `DecisionEventPayload`.
2. **Test de propiedad.** Genera eventos con datos aleatorios, los serializa y **falla si el payload contiene un patrón de correo, de cédula o de IP**. Esto atrapa lo que el lint no ve: el dato metido dentro de un `string` genérico o de un campo `metadata`.

Se complementa con el test de CI que impide cualquier `JOIN` entre los esquemas `roll` y `urn` (ADR-0013).

## Alternativas consideradas

- **Revisión humana en code review.** Falla exactamente cuando importa.
- **Documentar la regla y confiar.** Es lo que ya se hizo, y produjo tres documentos con criterios incompatibles entre sí (ver `00-contradicciones-resueltas.md`).
- **Escaneo en tiempo de ejecución** que rechace el evento antes de persistirlo. Útil como última red, pero descubre el problema en producción, con el evento ya construido y el usuario esperando.

## Consecuencias

- La regla de privacidad más importante del proyecto se rompe **en el pipeline**, no en producción ni en una auditoría de la SIC.
- Un mantenedor nuevo, que no leyó los documentos 11 y 20, aprende la frontera al primer intento de cruzarla.
- Da evidencia exportable para el principio de responsabilidad demostrada (Decreto 1377, arts. 26–27): el control existe, se ejecuta y deja registro en cada build.

## Consecuencias negativas aceptadas

- **Falsos positivos.** Un campo `nombre` de una *opción de votación* es legítimo. Se resuelven con una **lista de excepciones comentada**, revisada al añadirla, y **nunca** con un `// eslint-disable` suelto.
- El test de propiedad detecta patrones, no semántica: un identificador personal con formato inesperado pasa sin ser visto. Es una red, no una garantía.
- Mantener las reglas al día es trabajo recurrente que nadie reclamará hasta que falle.
