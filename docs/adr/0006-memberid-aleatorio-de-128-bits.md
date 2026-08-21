# ADR-0006: `MemberId` aleatorio de 128 bits, nunca derivado de datos personales

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** resolución **R1** del arquitecto. Consolida el ADR-111 propuesto en `11-privacidad-y-voto-secreto.md` §1.2 y **anula** la `DECISIÓN A.0` de `30-decision-engine-spec.md`. Corrige también `02-sociocracia-ostrom.md`, principio 1.

## Contexto

La spec 30 definía `MemberId = base32(truncate128(HMAC-SHA256(claveInstitucional, documento)))`. Usar HMAC con clave en lugar de un hash con sal pública es mejor que la alternativa ingenua, pero no resuelve el problema real: **es determinista y re-derivable**.

Quien tenga la `claveInstitucional` y la lista de documentos de la UdeA reconstruye el mapeo `MemberId → persona` completo, aunque el PII Vault esté vacío. Es decir: el borrado sería ficción. Y bajo la Ley 1581 un dato re-identificable sigue siendo dato personal, con todas sus obligaciones.

Hay un segundo efecto, más difícil de ver y peor: un identificador derivado permite **confirmar pertenencia por diccionario**. Con ~300 personas, cualquiera que sospeche que Ana participó calcula su `MemberId` y lo busca en el padrón publicado. No hace falta romper nada.

La clave institucional, además, es un secreto que tendría que sobrevivir tanto como el ledger —décadas—; su rotación invalidaría los `MemberId` de las 299 personas restantes, así que en la práctica no se puede rotar nunca.

## Decisión

El `MemberId` es un **valor aleatorio de 128 bits generado con CSPRNG** (`crypto.randomBytes(16)`) en el momento del alta, **codificado en 32 caracteres hexadecimales minúsculos** (`^[0-9a-f]{32}$`), y almacenado en columnas `char(32)`. **No es función de ningún dato personal**: ni del documento, ni del correo, ni del nombre, ni de la fecha de nacimiento, ni de nada derivable de ellos.

> **Corregido tras la implementación (2026-08-21):** este ADR decía «codificado en base32», y `30-decision-engine-spec.md` §A.0 y su tabla de generadores lo repetían («base32, 26 chars»). La resolución del arquitecto sobre la **regla de tipos del ledger** fija el `MemberId` como `char(32)` con `CHECK (~ '^[0-9a-f]{32}$')` (`10-ledger-inmutable.md` §1.1-bis), y `10-...` §1.1 ya lo describía como «32 hex minúsculas» desde el principio. Eran **tres representaciones distintas del mismo valor** en el corpus: base32 de 26 caracteres, hex de 32 caracteres y —en el DDL— una columna `uuid` de 36. Queda una: **hex de 32, minúsculas**.
>
> El cambio es de codificación, no de sustancia: siguen siendo los mismos 128 bits del mismo CSPRNG, y ninguna propiedad de este ADR depende del alfabeto. Se elige hex y no base32 por tres razones prácticas: es la forma en que ya se expone todo hash en el borde HTTP (spec 10 §2.1), permite `CHECK` con una expresión regular trivial y sin ambigüedad de mayúsculas, y —lo que decide— **el orden lexicográfico del hex minúsculo coincide con el orden binario de los 16 bytes que representa**, de modo que el `ORDER BY aggregate_id` de PostgreSQL y el ordenamiento del verificador independiente no pueden divergir al construir el `heads_root` (spec 10 §6.4). Con base32 en el alfabeto RFC 4648 esa coincidencia también se da, pero la representación es de 26 caracteres con relleno implícito y ninguna otra parte del sistema la usa.
>
> **Para el arquitecto:** este punto **no** venía en el informe de implementación; se deduce de aplicar E1 al corpus completo. Si la intención era conservar base32, entonces lo que hay que cambiar es la regla de §1.1-bis, no este ADR — pero una de las dos tiene que ceder, porque hoy se contradicen.

Se genera y se persiste en el PII Vault como columna indexada **antes** de emitir cualquier evento al ledger. El HMAC sobre el documento sobrevive únicamente como `enrollmentTag` **dentro de la bóveda**, para detectar altas duplicadas, y se borra con el registro.

El `MemberId` es **único y estable por persona** —no hay seudónimos por proceso—, porque el padrón congelado, la unicidad del voto y toda la parte C (delegación, tope de concentración, `HHI*`) requieren identidad longitudinal.

## Alternativas consideradas

- **Mantener la derivación de la `DECISIÓN A.0`.** Hace imposible un borrado real y habilita la confirmación por diccionario. Anulada por R1.
- **Rotar la `claveInstitucional` en cada supresión.** Invalidaría los `MemberId` de todas las demás personas y rompería el histórico anclado.
- **Derivar con sal secreta por persona guardada en la bóveda.** Suena equivalente a lo aleatorio, y es peor: introduce un secreto que hay que custodiar y destruir correctamente para que el borrado funcione, cuando el valor aleatorio no necesita ningún secreto. La complejidad extra no compra nada.
- **Seudónimo distinto por proceso** (propuesto en `20-normativa-datos-colombia.md` §7.4.4). Incompatible con el padrón congelado verificable, con la unicidad del voto y con la delegación. Ver contradicción C5 en `00-contradicciones-resueltas.md`.

## Consecuencias

- **El borrado es real.** Destruida la fila de la bóveda, el `MemberId` queda huérfano e irreversible: no hay función que lo lleve de vuelta a una persona, porque nunca la hubo.
- El padrón se puede publicar como `MemberId[]` sin habilitar confirmación por diccionario.
- No hay ningún secreto de larga duración cuya filtración futura reabra retroactivamente el histórico anclado. Ésa es la diferencia estructural con cualquier esquema derivado.
- Es la premisa de ADR-0007: si el identificador del ledger no es función de nada personal, prohibir las derivaciones en el ledger deja de tener excepciones que discutir.

## Consecuencias negativas aceptadas

- **El alta deja de ser sin estado:** hay que escribir en la bóveda antes de emitir el primer evento, y si esa escritura falla a medias queda un `MemberId` huérfano. Requiere transacción y una rutina de conciliación.
- Perder la fila de la bóveda **sin** haberlo pedido (corrupción, error operativo) equivale a un borrado accidental e irreversible de la identidad de esa persona. Con derivación se podría reconstruir; aquí no. Se acepta a cambio de que la irreversibilidad funcione también cuando se desea.
- Un `MemberId` estable mantiene el **enlace longitudinal**: un patrón de participación peculiar entre 300 personas puede re-identificar por inferencia. Se mitiga con truncado temporal, umbral k en agregados y supresión del texto libre del ledger; no se elimina. Sigue siendo tratamiento de datos personales bajo la Ley 1581.
