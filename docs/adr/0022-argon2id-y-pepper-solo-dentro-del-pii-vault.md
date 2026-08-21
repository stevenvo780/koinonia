# ADR-0022: Argon2id con pepper en KMS para commitments **dentro del PII Vault**

- **Estado:** Aceptado (alcance reducido por ADR-0007)
- **Fecha:** 2026-08-21
- **Contexto de origen:** `11-privacidad-y-voto-secreto.md` §1.4 (**ADR-114 propuesto**, cuyo alcance original incluía el ledger).

## Contexto

El ADR-114 propuesto establecía la construcción `HMAC(pepper, Argon2id(dato, salt))` para todo commitment sobre un dato de espacio enumerable, y la proponía **también para el ledger**. La resolución R2 del arquitecto (ADR-0007) eliminó esa segunda parte: al Governance Ledger no entra ninguna derivación de un identificador personal, endurecida o no.

Lo que queda en pie es lo que siempre fue sólido: **dentro de la bóveda** sí hacen falta commitments —índice de correo para búsquedas, `enrollmentTag` para detectar altas duplicadas— y ahí la construcción endurecida es exactamente lo correcto, porque la bóveda es mutable, purgable y de retención corta.

## Decisión

Todo commitment sobre un dato de espacio enumerable **almacenado en el PII Vault** usa:

```ts
hmacSha256(PEPPER_FROM_KMS, argon2id({
  password: utf8(normalizeNFC(dato.trim().toLowerCase())),
  salt: saltPorRegistro,     // 128 bits, CSPRNG, único por fila
  memoryCost: 64 * 1024,     // 64 MiB
  timeCost: 3, parallelism: 1, hashLength: 32,
}));
```

Orden correcto: **primero endurecer, después aplicar la clave secreta**. El pepper es una clave de 256 bits que vive en el KMS y **jamás** entra en la base de datos, el repositorio ni un backup de la bóveda.

El razonamiento que lo justifica sigue siendo el del doc 11 §1.4 y conviene no perderlo: la sal por registro mata las tablas arcoíris pero no el diccionario (300 nombres × N registros sigue siendo nada); Argon2id compra minutos, no seguridad, contra un espacio de 300; **lo que sostiene la seguridad es el pepper**, porque sin esos 256 bits el diccionario ni siquiera arranca.

**Fuera de alcance:** el ledger. Ver ADR-0007.

## Alternativas consideradas

- **`sha256(dato)`** — enumerable en microsegundos.
- **`sha256(salt ‖ dato)`** — enumerable en segundos.
- **Argon2id sin pepper** — enumerable en minutos: 300 candidatos × 150 ms son 45 s en un núcleo, ~6 s en ocho.
- **Aplicar el pepper antes de endurecer** — desperdicia el endurecimiento en el caso que importa (atacante con el pepper).
- **Usar esta misma construcción en el ledger** — era el alcance original; anulado por R2/ADR-0007.

## Consecuencias

- Quien roba **sólo la base de datos** no puede enumerar: le faltan 256 bits.
- Si además roba el pepper, Argon2id le impone minutos por registro: defensa en profundidad, no defensa principal.
- La bóveda puede indexar por correo sin almacenarlo en claro, y detectar altas duplicadas sin conservar el documento.
- Como la bóveda es purgable y de retención corta (ADR-0020), la caducidad del secreto deja de ser un problema estructural: es exactamente la diferencia con el ledger.

## Consecuencias negativas aceptadas

- Rotar el pepper obliga a recalcular los ~300 commitments (≈45 s, viable, pero es un procedimiento que hay que tener escrito).
- **Perder el pepper los vuelve inverificables**, así que necesita el mismo respaldo 2-de-3 en sobres físicos que la KEK.
- ~100–150 ms por verificación en el VPS *(verificar por medición real)*: hay que cuidar que un endpoint que verifique en bucle no se convierta en un vector de denegación de servicio.
- **Un commitment no es «dato anónimo»** para la Ley 1581: es seudónimo y se trata como tal, con todas sus obligaciones.
