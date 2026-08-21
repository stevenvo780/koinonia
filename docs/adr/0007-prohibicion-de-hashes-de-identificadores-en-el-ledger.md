# ADR-0007: Prohibición de hashes de identificadores personales en el Governance Ledger

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** resolución **R2** del arquitecto. Reduce el alcance del ADR-114 propuesto en `11-privacidad-y-voto-secreto.md` §1.4 y corrige la tabla de construcciones de `20-normativa-datos-colombia.md` §7.5 y las reglas duras de §7.6.

## Contexto

El corpus llegó a la conclusión correcta —`sha256(nombre)` es indefendible con 300 personas— y de ahí derivó la conclusión equivocada: que **endurecer** el commitment lo vuelve publicable. La cadena era: sal por registro contra tablas arcoíris, Argon2id para encarecer cada intento, y pepper en el KMS como defensa principal.

El cálculo del propio doc 11 §1.4 muestra por qué eso no basta: 300 candidatos × 150 ms son 45 segundos en un núcleo, ~6 s en ocho. Argon2id compra minutos, no seguridad, contra un espacio enumerable de 300.

Pero el argumento decisivo es otro, y es estructural, no computacional: **el ledger es permanente e incondicional; todo secreto es temporal y condicional.** Un pepper, una clave del KMS o una tabla de sales protegen mientras nadie los filtre. El ledger, en cambio, está anclado externamente y no se puede purgar. Una filtración dentro de diez años reabriría retroactivamente todo el histórico de participación política de 300 personas, y no habría nada que hacer. Un control cuya vigencia depende de que un secreto sobreviva décadas no es un control: es una apuesta.

## Decisión

**Al Governance Ledger no entra ningún hash, commitment, HMAC ni derivación de un identificador personal** —documento, correo, nombre, teléfono— **con o sin sal, con o sin pepper, con o sin función lenta.** El ataque de diccionario sobre un espacio de ~300 personas desaparece **por construcción, no por dificultad computacional**.

La única forma admitida de compromiso en el ledger es el **compromiso a valor aleatorio**: `H(nonce)` con `nonce` de CSPRNG guardado en el PII Vault. El ledger no contiene ninguna función del dato.

**Alcance exacto, para que nadie lo sobreaplique:** la prohibición cubre identificadores de la **identidad civil**. **No** cubre las derivaciones del `MemberId` aleatorio ya publicado en el padrón —el ticket de sorteo `hmac(semilla, "estrato|memberId")` de ADR-0031, las pruebas de inclusión Merkle del recibo de delegación—: su preimagen ya es pública por diseño y no contiene información personal, así que no hay nada que enumerar.

Argon2id y el pepper en KMS **siguen existiendo para el PII Vault** —índice de correo, detección de altas duplicadas, verificación de credenciales— y ahí conservan todo su valor. Lo que dejan de ser es la línea de defensa del ledger.

## Alternativas consideradas

- **`HMAC-SHA-256(k_KMS, identificador)` en el ledger.** Era la opción marcada como aceptable en `20-normativa-datos-colombia.md` §7.5. Rechazada: seguridad condicionada a un secreto que debe sobrevivir tanto como el ancla.
- **`HMAC(pepper, Argon2id(dato, salt))`** (ADR-114 original). Mismo defecto, con más piezas y más formas de equivocarse al rotar.
- **Aceptar el riesgo y documentarlo.** Rechazada: el dato en juego es orientación política, sensible por el art. 5 de la Ley 1581, cuya infracción tiene como sanción disponible el cierre inmediato y definitivo de la operación (art. 23 lit. d).

## Consecuencias

- La defensa del ledger deja de depender de la custodia de secretos y pasa a ser una propiedad verificable por inspección del esquema: **no hay preimagen porque no hay imagen**.
- Refuerza ADR-0005: la afirmación «la raíz Merkle publicada no es dato personal» se sostiene sin condiciones adicionales, y con ella la publicación del ancla fuera de Colombia sin transferencia internacional.
- Refuerza ADR-0006: identificador aleatorio y prohibición de derivaciones son la misma decisión vista desde dos lados.
- Es una regla **mecánicamente verificable**, y por eso se aplica por CI (ADR-0023) y no por revisión de código.

## Consecuencias negativas aceptadas

- Se pierde una función que a alguien le va a hacer falta: **probarle a un tercero, con sólo el ledger, que cierta persona está en el padrón**. Ahora eso exige acceso a la bóveda, con RBAC y auditoría de acceso. Es exactamente lo que se busca, pero es fricción real.
- La deduplicación de altas y la búsqueda por correo sólo funcionan dentro de la bóveda, con la clave disponible; no se pueden resolver desde una réplica del ledger.
- Un `nonce` perdido vuelve inverificable el compromiso correspondiente. Se acepta: el fallo es de disponibilidad, no de confidencialidad, y el evento sigue encadenado.
