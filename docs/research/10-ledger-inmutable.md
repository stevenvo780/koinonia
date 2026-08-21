# Diseño 10 — Ledger inmutable, Merkle y anclaje externo

> **Propiedad central que este documento debe sostener:** un administrador con acceso `root` al VPS
> **no puede alterar la historia sin que se detecte**. Aceptamos que la destruya o que niegue el
> servicio. No aceptamos alteración silenciosa.
>
> **Numeración:** los ADR propuestos aquí usan el bloque **126–140**. El bloque 110–125 está ocupado
> por `11-privacidad-y-voto-secreto.md`; el 100–109 quedaba corto. Se prefirió contigüidad.
>
> **Decisiones previas que este documento implementa y no reabre:** SHA-256; canonicalización JCS
> (RFC 8785); híbrido cadena-por-agregado + checkpoint Merkle global; `MemberId` aleatorio de 128
> bits; commitments con nonce; separación `governance` / `pii_vault`; padrón hasheado sólo sobre
> `MemberId` ordenados.
>
> **Revisión de 2026-08-21.** La implementación de `packages/crypto` contra este documento encontró
> **seis errores reales** en él —`actor` incoherente con su columna, `SUBPROOF` roto para `m = 0`,
> aritmética de 32 bits sobre un dominio de 64, dos convenciones de hoja mezcladas, una espina que no
> era el UUID que la spec exigía, y el `checkpoint_hash` indefinido para el primer checkpoint—, más
> **dos violaciones de tipos que nadie había mirado** (`occurred_at` e `issued_at` como `timestamptz`).
> Todos están corregidos en el sitio donde vivían, con una nota **«Corregido tras la implementación»**
> que explica qué estaba mal y por qué importaba. El registro consolidado y la lección metodológica
> están en [`00-contradicciones-resueltas.md`](00-contradicciones-resueltas.md), sección «Errores
> detectados por la implementación». La corrección de fondo no es ninguno de los seis parches: es la
> **regla de tipos del ledger** de §1.1-bis.

---

## 1. Esquema del evento y canonicalización

### 1.1 Anatomía: encabezado, carga y sobre

Un evento tiene tres zonas con reglas distintas:

| Zona | Campos | ¿Entra al hash? |
|---|---|---|
| **Encabezado** | `aggregateId`, `aggregateType`, `seq`, `eventType`, `eventVersion`, `occurredAt`, `actor` | **Sí**, dentro del objeto canónico |
| **Carga** | `payload` (objeto JSON del dominio) | **Sí**, dentro del objeto canónico |
| **Sobre** | `prevHash`, `eventHash`, `leafIndex`, `recordedAt`, `requestId` | **No** — son metadatos de almacenamiento o resultados del hash |

`prevHash` es el único elemento del sobre que participa del cálculo, pero **no como campo JSON**:
va como prefijo binario de la preimagen (§2.1). La razón es evitar la circularidad de intentar
firmar un objeto que contiene su propio hash, y evitar que un canonicalizador tenga que representar
32 bytes crudos.

```ts
// packages/crypto/src/chain.ts
export type CanonicalEvent = {
  readonly aggregateId: string;    // 128 bits en 32 hex minúsculas, SIN guiones: ^[0-9a-f]{32}$
  readonly aggregateType: string;  // p.ej. "propuesta", "circulo", "padron"
  readonly seq: number;            // entero >= 0, sin huecos dentro del agregado
  readonly eventType: string;      // p.ej. "ObjecionRegistrada"
  readonly eventVersion: number;   // entero >= 1
  readonly occurredAt: string;     // RFC 3339 UTC, exactamente "YYYY-MM-DDTHH:MM:SS.sssZ"
  readonly actor?: string;         // MemberId, 32 hex minúsculas; AUSENTE si es el sistema
  readonly payload: JsonObject;    // subconjunto restringido de JSON (§1.3)
};
```

`actor` es un `MemberId` (128 bits aleatorios). No es un hash de nada: no hay `sha256(cédula)`, ni
`sha256(correo)`, ni derivación alguna de un identificador institucional. Esa prohibición ya está
adoptada y CI la vigila; aquí sólo se hereda.

**`MemberId` y `aggregateId` son la misma forma léxica: 128 bits en 32 caracteres hexadecimales
minúsculos, sin guiones, validados por `^[0-9a-f]{32}$`.** No son UUID, no llevan nibble de versión,
no admiten mayúsculas y **no se almacenan nunca en una columna `uuid`** (§1.1-bis).

> **Corregido tras la implementación (2026-08-21):** esta línea decía «`MemberId`, 32 hex minúsculas»
> mientras el DDL de §3.1 declaraba `actor uuid` y `aggregate_id uuid`. PostgreSQL **acepta** la
> entrada de 32 hex en una columna `uuid`, pero **devuelve siempre** la forma con guiones (36
> caracteres). Al rehidratar el evento desde la base, la preimagen cambia, el `eventHash` cambia y el
> sistema declara «historia alterada» sin que nadie la haya alterado: exactamente el **falso positivo
> de corrupción** que §1.2 describe como la peor falla posible, provocado por la propia
> especificación. El tipo `uuid` queda proscrito para estos identificadores.

### 1.1-bis Regla de tipos del ledger — norma transversal

Esta regla es más importante que el parche puntual de §1.1: el error de `actor` fue una instancia de
un problema general, y sólo una regla general lo cierra.

> ### ⛔ Regla de tipos del ledger
>
> **Ningún valor que forme parte de la preimagen de un hash puede almacenarse en una columna cuyo
> tipo normalice su representación.** Esto proscribe `uuid` (reescribe la forma), `timestamptz`
> (normaliza la zona horaria), `numeric` (normaliza ceros a la derecha) y **muy especialmente
> `jsonb`, que reordena las claves del objeto y destruiría la canonicalización JCS**. El `payload` se
> almacena como `text` o `bytea` con la forma canónica exacta que se hasheó; si además se quiere
> consultar, se guarda una copia derivada en `jsonb` marcada explícitamente como **NO autoritativa**.

Corolarios operativos, para que la regla sea aplicable sin criterio:

1. **La prueba es la ida y vuelta, no la lectura.** Un tipo es admisible si
   `parse(render(x)) === x` **y** `render(parse(texto)) === texto` para todo valor del dominio. `uuid`,
   `timestamptz`, `numeric` y `jsonb` fallan la segunda mitad: aceptan más formas de las que emiten.
2. **La columna autoritativa es la que se hasheó.** Toda copia derivada (índice, `jsonb` de consulta,
   columna generada, vista materializada) lleva el sufijo `_idx` o vive en `projection`, y el
   verificador **nunca** la lee.
3. **Lo que no entra a la preimagen queda libre.** `request_id`, `recorded_at` y `updated_at` son
   sobre o caché derivada (§1.1): pueden usar `uuid` y `timestamptz` sin riesgo, y de hecho lo hacen.
   La regla no es una fobia a los tipos ricos de PostgreSQL: es una condición sobre **participar del
   hash**.
4. **Se verifica en CI**, no en revisión de código: el mismo test que ya prohíbe columnas nuevas en
   `governance.event` compara el DDL contra una lista de tipos permitidos para las columnas de la
   preimagen (`char(n)`, `text`, `bytea`, `bigint`, `integer`, `boolean`).

> **Corregido tras la implementación (2026-08-21):** la spec no tenía ninguna regla de tipos. Tenía
> seis columnas escritas caso por caso y tres de ellas estaban mal —`aggregate_id`, `actor` y
> `payload`—, más dos que nadie había mirado —`occurred_at` e `issued_at` (§3.1, §6.4)—. Sin una regla
> explícita, la siguiente columna que alguien añada volverá a estar mal, porque el criterio vivía en
> la cabeza de quien escribió el DDL y no en el documento.

### 1.2 Por qué JCS es imprescindible

El hash no se calcula sobre "el evento": se calcula sobre **una secuencia concreta de bytes**. JSON
admite infinitas secuencias de bytes para el mismo valor lógico. Sin una regla que fije una y sólo
una, ocurren tres fallas, en orden creciente de gravedad:

1. **Falsos positivos de corrupción.** El servidor guarda `{"a":1,"b":2}`, `pg_dump`/restauración o
   un cambio de versión de la librería lo reemite como `{"b":2,"a":1}`, el hash no coincide y el
   sistema declara "historia alterada" cuando no lo fue. Un verificador que grita corrupción cuando
   no la hay es peor que no tener verificador: entrena a la asamblea a ignorarlo.
2. **Verificación imposible en el cliente.** El navegador recibe JSON parseado; para recomputar el
   hash debe reserializar. Si su reserialización no es bit-idéntica a la del servidor, **ninguna**
   verificación funciona. JCS existe exactamente para esto: define la serialización en términos de
   `JSON.stringify` de ECMAScript, que es lo que el navegador ya hace.
3. **Colisión semántica deliberada.** Si dos representaciones distintas producen hashes distintos
   pero se consideran "el mismo evento", o peor, si dos objetos distintos pueden producir la misma
   preimagen, el atacante elige. Ejemplo concreto sin canonicalización de duplicados: `{"voto":"si","voto":"no"}`
   es JSON sintácticamente válido; el parser del verificador se queda con el último, el del servidor
   con el primero. JCS opera sobre el *valor* ya parseado, no sobre el texto, y eso elimina la clase
   entera de ataques de "dos parsers, dos lecturas".

### 1.3 Las cuatro trampas y sus reglas

**(a) Coma flotante.** JCS define la serialización de números vía `Number::toString` de ECMA-262
(la representación más corta que hace *round-trip*). Es determinista, pero el valor sigue siendo un
IEEE-754 binario de 64 bits: `0.1 + 0.2` es `0.30000000000000004` y `1e23` puede provenir de dos
literales distintos. Además, más allá de 2^53 los enteros dejan de ser exactos.

> **Regla dura:** el `payload` **no admite números no enteros**, ni enteros fuera de
> `[-(2^53-1), 2^53-1]`. Las cantidades del dominio (umbrales, ponderaciones, conteos) se expresan
> como enteros en la unidad mínima (centésimas, milésimas) o como cadena decimal, y la aritmética
> exacta ya está resuelta en otro ADR. El validador de esquema rechaza el evento **antes** de
> hashearlo. Esto no es una preferencia estética: es la única forma de que el hash del cliente
> coincida con el del servidor cuando uno corre en V8 y el otro en JavaScriptCore o en Deno.

**(b) Unicode y normalización.** **JCS no normaliza.** RFC 8785 lo dice explícitamente: canonicaliza
la *estructura* y el *escapado*, no la *composición* de los caracteres. `"José"` con `é` precompuesto
(U+00E9) y `"José"` con `e` + acento combinante (U+0065 U+0301) son cadenas JSON distintas, se ven
idénticas en pantalla y producen hashes distintos. Un macOS produce lo segundo, un Linux lo primero.

> **Regla dura:** **normalización NFC obligatoria en el borde de entrada**, antes de validar, antes
> de persistir, antes de hashear. `s.normalize('NFC')` sobre toda cadena del `payload` y de las
> claves. Se normaliza *una vez*, al recibir, y lo que queda almacenado ya está en NFC. El
> canonicalizador **no** normaliza (sería tarde: cambiaría el dato respecto de lo que el usuario
> aprobó). También se rechazan caracteres de control, `U+FEFF` y los no-caracteres.

**(c) Orden de claves.** JCS ordena por **unidades de código UTF-16**, no por bytes UTF-8. Para todo
el BMP coinciden; fuera del BMP (emoji, U+10000 en adelante) **no**: los sustitutos UTF-16 caen en
`D800–DFFF`, que en orden UTF-8 quedaría por encima de `U+E000–U+FFFF`. Una implementación en Go o
Rust que ordene por bytes UTF-8 producirá otro orden. Como nuestras claves son identificadores del
esquema (ASCII), la diferencia no se materializa hoy, pero la regla se fija igual: **claves del
`payload` restringidas a `^[a-zA-Z][a-zA-Z0-9_]*$`**, validado por esquema. Así el orden es el mismo
en cualquier implementación y la interoperabilidad del verificador queda garantizada por
construcción, no por suerte.

**(d) Ausencia vs. `null`.** `{}` y `{"actor":null}` son objetos distintos, con hashes distintos, y
ambos "significan" que no hay actor. Dos capas del sistema elegirán distinto.

> **Regla dura:** **`null` prohibido** en encabezado y `payload`. La ausencia se expresa omitiendo la
> clave. `undefined` no existe en JSON y `JSON.stringify` lo elimina silenciosamente, lo que crearía
> una diferencia entre "objeto en memoria" y "objeto serializado": el validador rechaza `undefined`
> explícito en lugar de tolerarlo. Tampoco se admiten `NaN`, `Infinity` ni `-0`.

### 1.4 Implementación

```ts
// packages/crypto/src/canonical.ts
// Implementación de RFC 8785 vendorizada en el repo (no dependencia transitiva),
// con la batería de vectores de prueba del propio RFC + los de Unicode fuera del BMP
// corriendo en CI contra Node y contra un navegador headless.
export function jcs(value: JsonValue): Uint8Array; // devuelve UTF-8, sin BOM
```

Vendorizar y no depender es deliberado: si la canonicalización cambia de comportamiento por una
actualización de dependencia, **toda la historia deja de verificar**. El módulo JCS es el artefacto
más estable del repo; se le trata como tal.

> **ADR-126 (propuesta):** Preimagen canónica restringida — **Decisión:** el evento se serializa con
> JCS (RFC 8785) sobre un subconjunto restringido de JSON: sin flotantes, sin enteros fuera del rango
> seguro, sin `null`, sin `undefined`, claves `[a-zA-Z][a-zA-Z0-9_]*`, y toda cadena normalizada a
> NFC en el borde de entrada. La implementación de JCS se vendoriza y se prueba contra los vectores
> del RFC en Node y en navegador. — **Alternativas descartadas:** (i) JSON crudo tal como lo emite la
> librería del servidor — imposible de reproducir en el cliente; (ii) CBOR canónico / DAG-CBOR —
> técnicamente superior, pero exige WASM o una librería en el navegador, y la decisión de verificar
> con WebCrypto puro lo excluye; (iii) Protobuf — la serialización no está garantizada como
> determinista entre implementaciones; (iv) permitir `null` y normalizar en el canonicalizador —
> mueve el problema a un componente que no debe alterar datos. — **Consecuencias:** el dominio pierde
> expresividad (nada de `0.5`), aparece una capa de validación estricta previa al append, y el
> módulo JCS queda congelado bajo política de cambio equivalente a la de un formato de archivo.

---

## 2. Cadena de hashes por agregado

### 2.1 La fórmula y su encoding

```
eventHash_n = SHA256( 0x02 ‖ prevHash_{n-1} ‖ JCS_utf8(canonicalEvent_n) )
```

Tres precisiones sobre la fórmula del enunciado, todas necesarias:

- **`prevHash` es binario de 32 bytes, no hexadecimal.** Concatenar longitudes fijas elimina la
  ambigüedad de concatenación (que `a‖b == a'‖b'` con particiones distintas). Como el primer operando
  siempre mide exactamente 32 bytes, la partición es única sin necesidad de prefijos de longitud. En
  PostgreSQL se almacena como `bytea` con `CHECK (octet_length(...) = 32)`; en la API se expone en
  hexadecimal minúscula; el hexadecimal **nunca** es la preimagen.
- **Separación de dominio con el octeto `0x02`.** El árbol de Merkle usará `0x00` para hojas y `0x01`
  para nodos internos (§6). Si los eslabones de la cadena no llevaran etiqueta, un valor de 32 bytes
  podría ser simultáneamente un `eventHash` válido y un nodo del árbol, y las dos estructuras
  quedarían acopladas de formas que nadie analizó. Un octeto es barato; la confusión de tipos, no.
- **`JCS_utf8` es UTF-8 sin BOM**, y el objeto canónico **no incluye** `prevHash`, `eventHash`,
  `leafIndex` ni `recordedAt`.

```ts
export async function computeEventHash(prev: Uint8Array, ev: CanonicalEvent): Promise<Uint8Array> {
  if (prev.length !== 32) throw new Error('prevHash debe medir 32 bytes');
  const body = jcs(ev);
  const pre = new Uint8Array(1 + 32 + body.length);
  pre[0] = 0x02; pre.set(prev, 1); pre.set(body, 33);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', pre)); // WebCrypto: navegador y Node
}
```

### 2.2 El punto crítico: una cadena por agregado no protege contra la desaparición del agregado entero

La cadena por agregado detecta con certeza la **modificación** y la **eliminación parcial**: si el
administrador borra el evento 17 de una propuesta, el `prevHash` del evento 18 apunta a un hash que
ya no existe; si lo edita, su `eventHash` cambia y el 18 queda huérfano. Perfecto.

**Y es completamente inútil contra esto:** llega una propuesta incómoda —una moción de censura al
comité que administra el VPS—, acumula 40 eventos y se aprueba. El administrador ejecuta
`DELETE FROM event WHERE aggregate_id = '…'`. Los 40 eventos se van juntos, con toda su cadena
interna. **Ninguna cadena se rompe**, porque la cadena que los unía se fue con ellos. Cada uno de los
otros agregados sigue verificando a la perfección. Un verificador ingenuo que recorra "todos los
agregados que existen" y compruebe sus cadenas dará **verde**. La propuesta simplemente nunca
existió. Es el ataque más obvio y el que la topología "una cadena por agregado" no ve, porque no
existe ninguna afirmación previa sobre *cuántos y cuáles* agregados debe haber.

El problema no es criptográfico sino de **cobertura**: no basta con que cada cosa que existe esté
encadenada; hace falta que **la existencia misma de cada cosa** esté encadenada a algo que no se
pueda borrar sin romper otra cosa.

### 2.3 Solución: espina dorsal `#ledger` con doble vínculo

Se introduce un **agregado singleton**, la *espina dorsal*, con `aggregateId` fijo
`00000000000000000000000000000001` y `aggregateType = "#ledger"`. Es el único agregado cuya
existencia es axiomática: su evento génesis (`LedgerAbierto`, `seq = 0`) es el único del sistema con
`prevHash = 0x00…00` (32 ceros), y su hash se publica y se ancla externamente el día de la puesta en
marcha. Es la raíz de confianza, y cabe en un tuit.

**Ningún otro agregado nace con ceros.** El nacimiento de un agregado `A` es una operación atómica de
dos escrituras, en una sola transacción:

1. Se lee la cabeza actual de la espina: `H_espina` (hash del último evento de `#ledger`).
2. El evento génesis de `A` se calcula con **`prevHash = H_espina`**. Es decir, `A` cuelga
   criptográficamente de un punto concreto de la historia global. *(Vínculo hacia atrás.)*
3. Se escribe en la espina el evento `AgregadoAbierto`, con `prevHash = H_espina` también, y
   `payload = { aggregateId: A, aggregateType: "propuesta", genesisHash: <hash génesis de A> }`.
   *(Vínculo hacia adelante.)*

No hay circularidad: ambos eventos comparten el mismo padre `H_espina`, y sólo el de la espina
menciona al otro. El orden de cálculo es determinista.

> **Corregido tras la implementación (2026-08-21):** la espina se definía como «UUID fijo
> `00000000-0000-0000-0000-00000000ffff`», y §1.1 exigía **UUID v4** para los identificadores. Ese
> valor **no es un UUID v4**: el nibble de versión es `0`, no `4`. Un validador estricto —el nuestro,
> en cuanto alguien lo escribiera bien— habría **rechazado el único agregado que la spec declara
> axiomático**, es decir, la raíz de confianza de todo el sistema. Al pasar los identificadores a 32
> hex (§1.1-bis), el problema se disuelve por construcción: no hay campo de versión que respetar. La
> espina es `00000000000000000000000000000001` y toda mención a «UUID v4» como identificador del
> ledger queda eliminada del documento.

El resultado es un **doble vínculo**. Ahora, borrar la propuesta incómoda exige:

- borrar sus 40 eventos —lo cual deja en la espina un `AgregadoAbierto` que apunta a un
  `genesisHash` inexistente: **el verificador lo detecta con una consulta trivial**, "para cada
  `AgregadoAbierto` de la espina, existe el evento con ese hash";
- por lo tanto, borrar también ese evento de la espina —lo cual **rompe la cadena de la espina**, que
  es una sola cadena lineal para todo el sistema;
- por lo tanto, reescribir la espina completa desde ese punto —lo cual cambia todos los `H_espina`
  posteriores, y con ellos el `prevHash` génesis de **todos los agregados nacidos después**, en
  cascada, y por tanto todos sus eventos, y por tanto la raíz de Merkle de todo checkpoint posterior;
- por lo tanto, contradecir cada raíz ya anclada externamente (§8) y fallar toda prueba de
  consistencia (§7) contra cualquier checkpoint que alguien haya guardado.

La espina convierte "borrar un agregado entero" —que era gratis— en "reescribir la historia global y
contradecir los anclajes públicos", que es exactamente la operación que el diseño quiere hacer
detectable. Y añade una tercera barrera, más barata todavía: el **índice global contiguo**
(`leafIndex`, §3.2). Cada evento del sistema, de cualquier agregado, recibe un entero global sin
huecos. Borrar 40 eventos deja 40 agujeros en una secuencia que se declaró densa; detectarlo es un
`SELECT` de un renglón. Y el checkpoint incluye además un compromiso al **conjunto de cabezas**
(`headsRoot`, §6.4), de modo que un agregado que desaparece altera el checkpoint aunque el atacante
lograra recomponer todo lo demás.

En resumen, tres capas: **doble vínculo con la espina** (detecta la desaparición estructuralmente),
**índice global contiguo** (la detecta aritméticamente), **checkpoint anclado con `headsRoot`** (la
detecta contra un testigo externo). Ninguna de las tres impide el borrado; las tres impiden que sea
silencioso.

> **ADR-127 (propuesta):** `prevHash` binario de 32 bytes como prefijo de longitud fija —
> **Decisión:** la preimagen del eslabón es `0x02 ‖ prevHash(32B) ‖ JCS_utf8(evento)`, con `prevHash`
> como `bytea` de longitud verificada, no hexadecimal ni base64, y con octeto de separación de
> dominio distinto del de hojas (`0x00`) y nodos (`0x01`) del árbol. — **Alternativas descartadas:**
> (i) `prevHash` como campo dentro del objeto JCS — obliga a decidir su encoding textual y a excluirlo
> del propio hash, más frágil; (ii) concatenar hexadecimal — duplica bytes y admite ambigüedad
> mayúscula/minúscula; (iii) sin separación de dominio — acopla dos estructuras que deben ser
> disjuntas. — **Consecuencias:** el `bytea` obliga a conversiones explícitas en la capa de acceso a
> datos y a exponer hex sólo en el borde HTTP; a cambio, la preimagen es inambigua y el árbol y la
> cadena no pueden confundirse.

> **ADR-128 (propuesta):** Espina dorsal `#ledger` con doble vínculo génesis↔espina — **Decisión:**
> existe un agregado singleton `#ledger`; es el único con génesis en 32 ceros; todo agregado nuevo
> nace con `prevHash = ` cabeza de la espina, y la espina registra en el mismo commit un evento
> `AgregadoAbierto` que contiene el `genesisHash` del recién nacido. Un `CHECK` impide `seq = 0` sin
> `spine_hash`. — **Alternativas descartadas:** (i) génesis en ceros por agregado — deja la
> desaparición completa indetectable, que es precisamente el ataque a cubrir; (ii) una única cadena
> global sin cadenas por agregado — obliga a leer toda la historia para verificar una propuesta y
> hace imposible la verificación parcial en el móvil de un estudiante; (iii) confiar sólo en el
> checkpoint Merkle — funciona, pero únicamente contra quien conserve un checkpoint anterior; la
> espina es autocontenida y detecta la desaparición aun con una sola copia del ledger a la vista;
> (iv) registrar el nacimiento en el agregado padre (el círculo) — no hay padre para los agregados de
> primer nivel y crea jerarquías con ciclos. — **Consecuencias:** todo alta de agregado serializa
> contra la espina (un `UPDATE` sobre una fila caliente), y la espina crece con un evento por
> agregado; a cambio, la desaparición completa de un agregado pasa de gratuita a estructuralmente
> detectable con una sola consulta.

---

## 3. Append seguro bajo concurrencia

### 3.1 DDL

```sql
CREATE SCHEMA governance;

-- Propietario: koinonia_ddl (NO el rol de la aplicación). Ver §4.
CREATE TABLE governance.event (
  leaf_index     bigint       NOT NULL PRIMARY KEY,
  -- PREIMAGEN (§1.1-bis): tipos que NO normalizan la representación.
  aggregate_id   char(32)     NOT NULL CHECK (aggregate_id ~ '^[0-9a-f]{32}$'),
  aggregate_type text         NOT NULL,
  seq            integer      NOT NULL CHECK (seq >= 0),
  event_type     text         NOT NULL,
  event_version  integer      NOT NULL CHECK (event_version >= 1),
  -- RFC 3339 UTC exacto: "YYYY-MM-DDTHH:MM:SS.sssZ", 24 caracteres, milisegundos SIEMPRE presentes.
  occurred_at    char(24)     NOT NULL
                 CHECK (occurred_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
                 CHECK (occurred_at::timestamptz IS NOT NULL),   -- que además sea una fecha real
  actor          char(32)     CHECK (actor ~ '^[0-9a-f]{32}$'),  -- MemberId; NULL = sistema
  -- Texto canónico JCS EXACTO que se hasheó. NUNCA jsonb: reordenaría las claves.
  payload        text         NOT NULL CHECK (octet_length(payload) > 0),
  -- Copia derivada y NO AUTORITATIVA, sólo para consulta. El verificador no la lee jamás.
  payload_idx    jsonb        GENERATED ALWAYS AS (payload::jsonb) STORED,
  -- FIN DE LA PREIMAGEN. Lo de abajo es sobre y no entra a ningún hash.
  prev_hash      bytea        NOT NULL CHECK (octet_length(prev_hash) = 32),
  event_hash     bytea        NOT NULL CHECK (octet_length(event_hash) = 32),
  spine_hash     bytea        CHECK (spine_hash IS NULL OR octet_length(spine_hash) = 32),
  request_id     uuid         NOT NULL,   -- uuid PERMITIDO: es sobre, no entra a la preimagen (§3.5)
  recorded_at    timestamptz  NOT NULL DEFAULT clock_timestamp(),  -- ídem: sobre
  CONSTRAINT event_agg_seq_uk   UNIQUE (aggregate_id, seq),
  CONSTRAINT event_hash_uk      UNIQUE (event_hash),
  CONSTRAINT event_request_uk   UNIQUE (request_id),
  -- todo génesis (seq=0) debe colgar de la espina y de nada más
  CONSTRAINT event_genesis_ck   CHECK ((seq = 0) = (spine_hash IS NOT NULL)),
  CONSTRAINT event_genesis_link CHECK (spine_hash IS NULL OR prev_hash = spine_hash)
);

CREATE INDEX event_agg_idx  ON governance.event (aggregate_id, seq);
CREATE INDEX event_type_idx ON governance.event (aggregate_type, event_type);
CREATE INDEX event_payload_idx ON governance.event USING gin (payload_idx);  -- consulta, no verdad

-- Cabeza de cadena por agregado: la única fila mutable del subsistema.
CREATE TABLE governance.aggregate_head (
  aggregate_id   char(32)    NOT NULL PRIMARY KEY CHECK (aggregate_id ~ '^[0-9a-f]{32}$'),
  aggregate_type text        NOT NULL,
  seq            integer     NOT NULL CHECK (seq >= 0),
  head_hash      bytea       NOT NULL CHECK (octet_length(head_hash) = 32),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp()   -- caché derivada: permitido
);

-- Contador global DENSO. Deliberadamente NO es una secuencia (§3.2).
CREATE TABLE governance.ledger_cursor (
  id              boolean NOT NULL PRIMARY KEY DEFAULT TRUE CHECK (id),
  next_leaf_index bigint  NOT NULL DEFAULT 0
);
INSERT INTO governance.ledger_cursor (id) VALUES (TRUE);
```

Dos precisiones sobre el mapeo entre la fila y el objeto canónico, que son fuente de error silencioso:

- **`actor IS NULL` significa «clave `actor` ausente»**, nunca `"actor": null`. El `NULL` de SQL y el
  `null` de JSON no son el mismo valor y §1.3.d prohíbe el segundo. La capa de acceso a datos omite la
  clave; no la emite vacía.
- **`payload` es la única fuente de verdad**; `payload_idx` es una columna generada, existe para que
  los `GIN` y los `->>` sigan funcionando, y **no se lee jamás al recomputar un hash**. Si un día
  divergen, la que está mal es `payload_idx`, por definición.

> **Corregido tras la implementación (2026-08-21):** este DDL contenía **cinco** violaciones de la
> regla de tipos de §1.1-bis, tres señaladas y dos que nadie había mirado:
>
> | Columna | Estaba | Está | Qué rompía |
> |---|---|---|---|
> | `aggregate_id` | `uuid` | `char(32)` | Devuelve la forma con guiones ⇒ preimagen distinta al rehidratar |
> | `actor` | `uuid` | `char(32)` | Ídem, y era la incoherencia directa con §1.1 |
> | `payload` | `jsonb` | `text` (+ `payload_idx` derivado) | **`jsonb` reordena las claves y normaliza los números: destruye JCS entero** |
> | `occurred_at` | `timestamptz` | `char(24)` | Devuelve `2026-08-21 03:14:00.1+00`, no `2026-08-21T03:14:00.100Z`: cambia el separador, la zona **y trunca los ceros de los milisegundos** |
> | `issued_at` (§6.4) | `timestamptz` | `char(24)` | Lo mismo, sobre la preimagen del `checkpoint_hash` |
>
> Las dos últimas no estaban en el informe de implementación: aparecieron al aplicar la regla general
> a todo el DDL en vez de parchear caso por caso. `payload` era la peor de las cinco por alcance:
> `jsonb` no guarda el texto, guarda un árbol descompuesto, y lo reemite con las claves ordenadas por
> longitud-y-luego-bytes —criterio que **no** es el de JCS— y con los números renormalizados. Con
> `jsonb`, la primera restauración de `pg_dump` habría invalidado la historia completa.

### 3.2 Por qué `BIGSERIAL` está prohibido aquí

Una secuencia de PostgreSQL es **no transaccional por diseño**: `nextval()` no se revierte con
`ROLLBACK`. Si una transacción de append falla —violación de restricción, caída del proceso,
reintento por conflicto—, el índice consumido se pierde y queda un hueco permanente.

Eso destruye la propiedad que necesitamos. El verificador externo, al ver que falta el `leaf_index`
4711, debe poder concluir **"aquí se borró un evento"**. Si los huecos son normales, no puede
concluir nada, y el administrador tiene una coartada perfecta y no falsable: "fue un rollback".
Regalarle esa coartada anula la tercera capa de detección de §2.3.

La densidad se obtiene con un `UPDATE ... RETURNING` sobre una fila única dentro de la propia
transacción: si la transacción aborta, la reserva se revierte con ella. El costo es que esa fila se
vuelve un punto de serialización global de escrituras. Para ~300 estudiantes —cuyo pico realista es
una votación con decenas de eventos por minuto— el punto de serialización está holgadamente por
debajo de lo que una fila caliente de PostgreSQL sostiene. Es un intercambio consciente de
escalabilidad por auditabilidad, y en este proyecto la auditabilidad es el producto.

### 3.3 La transacción de append

Combinamos **advisory lock** (orden global, sin tormenta de reintentos) con **CAS optimista** sobre
`aggregate_head` (red de seguridad independiente del lock).

```sql
BEGIN;  -- READ COMMITTED basta: la exclusión la da el lock, no el aislamiento

-- (1) Cerrojo de escritura del ledger. Se libera SOLO al terminar la transacción.
--     Los lectores no lo toman: no bloquea la web.
SELECT pg_advisory_xact_lock(7311064281559162001);

-- (2) Reserva densa de N índices globales; se revierte con la transacción.
UPDATE governance.ledger_cursor
   SET next_leaf_index = next_leaf_index + $n
 WHERE id = TRUE
RETURNING next_leaf_index - $n AS first_leaf_index;

-- (3) Cabeza esperada del agregado (NULL si es un agregado nuevo).
SELECT seq, head_hash FROM governance.aggregate_head WHERE aggregate_id = $agg;

-- (4) …la aplicación calcula en memoria eventHash de cada evento del lote…

-- (5) Inserción del lote.
INSERT INTO governance.event
  (leaf_index, aggregate_id, aggregate_type, seq, event_type, event_version,
   occurred_at, actor, payload, prev_hash, event_hash, spine_hash, request_id)
SELECT * FROM UNNEST($rows);

-- (6) CAS sobre la cabeza. Agregado existente:
UPDATE governance.aggregate_head
   SET seq = $newSeq, head_hash = $newHead, updated_at = clock_timestamp()
 WHERE aggregate_id = $agg AND seq = $expectedSeq AND head_hash = $expectedHead;
--     Si rowCount = 0 -> otro escritor ganó -> ROLLBACK y reintento.

--     Agregado nuevo:
INSERT INTO governance.aggregate_head (aggregate_id, aggregate_type, seq, head_hash)
VALUES ($agg, $type, 0, $genesisHash)
ON CONFLICT (aggregate_id) DO NOTHING;
--     Si rowCount = 0 -> el agregado ya existía -> ROLLBACK.

COMMIT;
```

```ts
// services/api/src/ledger/append.ts — hace I/O, luego NO es packages/crypto (ADR-0001)
const REINTENTABLES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '23505', // unique_violation: carrera en (aggregate_id, seq) o en leaf_index
]);

export async function append(pool: Pool, cmd: AppendCommand, maxIntentos = 5) {
  for (let intento = 0; ; intento++) {
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      const r = await intentarAppend(cx, cmd);   // pasos (1)–(6)
      await cx.query('COMMIT');
      return r;
    } catch (e) {
      await cx.query('ROLLBACK').catch(() => {});
      const code = (e as { code?: string }).code ?? '';
      const conflictoCas = e instanceof ConflictoDeCabeza;
      if ((REINTENTABLES.has(code) || conflictoCas) && intento < maxIntentos) {
        // backoff exponencial con jitter: 10ms, 20ms, 40ms… + [0,10)ms
        await sleep(2 ** intento * 10 + Math.random() * 10);
        continue;
      }
      if (code === '23505' && (e as any).constraint === 'event_request_uk') {
        return await leerResultadoIdempotente(pool, cmd.requestId); // §3.5
      }
      throw e;
    } finally { cx.release(); }
  }
}
```

**Nota sobre el checkpointer:** un lector ingenuo puede ver el `leaf_index` 4712 confirmado mientras
el 4711 sigue en vuelo (reservado pero no *commiteado*), y creer que hay un hueco. Por eso el proceso
de checkpoint (§6) toma **el mismo advisory lock** durante los milisegundos que tarda en leer
`max(leaf_index)` y fijar el corte; con el lock tomado no hay appends en vuelo, y todo lo que ve es
denso y definitivo. Alternativa equivalente: `REPEATABLE READ` + verificación explícita de
contigüidad, descartada por ser más código para la misma garantía.

### 3.4 Alternativas evaluadas

| Mecanismo | Veredicto |
|---|---|
| `BIGSERIAL` global | **No.** Huecos por rollback = coartada para el borrado (§3.2). |
| `SERIALIZABLE` puro | Correcto, pero los conflictos se detectan **al hacer commit**: trabajo desperdiciado, tasa de aborto creciente con la concurrencia y reintentos difíciles de acotar en el pico de una votación. Se usa sólo en el reproceso de proyecciones. |
| `SELECT … FOR UPDATE` sobre `aggregate_head` | Funciona por agregado, pero no da orden global ni permite reservar el índice denso sin un segundo cerrojo. Queda subsumido. |
| Advisory lock `pg_advisory_xact_lock` | **Sí.** Un `bigint` constante, liberación automática al terminar la transacción (no hay fugas si el proceso muere), coste despreciable, orden total de escrituras. |
| CAS optimista sobre la cabeza | **Sí, además.** No cuesta nada y protege si alguien introduce una ruta de escritura que olvida el lock, o si en el futuro se pasa a locks por agregado. |

### 3.5 Idempotencia

Cada comando entrante trae un `requestId` (UUID v4, generado por el cliente). Es el **único**
identificador del subsistema que sigue siendo un UUID, y puede serlo precisamente porque pertenece al
sobre y **no entra a ninguna preimagen** (§1.1, §1.1-bis): que PostgreSQL lo reescriba con guiones no
afecta a ningún hash. `UNIQUE (request_id)` lo
convierte en clave de idempotencia: un reintento de red tras un timeout no duplica el voto, choca
con `23505` sobre `event_request_uk` y la capa devuelve el resultado ya registrado. Sin esto, la red
móvil del campus produce eventos duplicados que son indistinguibles de fraude y ensucian una historia
que, por diseño, no se puede limpiar.

> **ADR-129 (propuesta):** Índice global denso en tabla, no secuencia — **Decisión:** `leaf_index`
> se reserva con `UPDATE … RETURNING` sobre `governance.ledger_cursor`, dentro de la transacción de
> append, garantizando ausencia total de huecos. — **Alternativas descartadas:** `BIGSERIAL`
> (huecos por rollback que dan coartada al borrado), `IDENTITY` (idéntico problema), reindexado
> posterior (reescribiría la historia). — **Consecuencias:** punto de serialización global de
> escrituras, aceptable para la escala del instituto y explícitamente intercambiado por la capacidad
> de afirmar "falta el 4711 ⇒ alguien borró".

> **ADR-130 (propuesta):** Append con advisory lock + CAS optimista + reintentos acotados —
> **Decisión:** `pg_advisory_xact_lock` para el orden total, `READ COMMITTED`, CAS sobre
> `aggregate_head` como red independiente, reintentos con backoff exponencial y jitter ante
> `40001`, `40P01`, `55P03`, `23505` y conflicto de CAS, máximo 5. — **Alternativas descartadas:**
> `SERIALIZABLE` puro (aborto tardío, trabajo desperdiciado), sólo `FOR UPDATE` (sin orden global),
> cola de escritura de un solo proceso (introduce un punto de fallo y un servicio más que operar en
> un VPS voluntario). — **Consecuencias:** los appends se serializan globalmente; el código de
> reintento es una pieza crítica con pruebas de concurrencia propias.

> **ADR-131 (propuesta):** Idempotencia por `request_id` — **Decisión:** `UNIQUE (request_id)` y
> resolución del `23505` devolviendo el resultado previo. — **Alternativas descartadas:**
> deduplicación por contenido (dos votos idénticos legítimos serían indistinguibles de un duplicado),
> ventana temporal (heurística, falla justo bajo carga). — **Consecuencias:** el cliente debe generar
> y reusar el `requestId` durante los reintentos; se documenta en el contrato de la API.

---

## 4. Impedir UPDATE y DELETE

### 4.1 Privilegios

```sql
-- Roles: koinonia_ddl es dueño de los objetos; koinonia_app NUNCA lo es.
-- Si la app fuera dueña podría ALTER TABLE ... DISABLE TRIGGER y saltarse el §4.2.
CREATE ROLE koinonia_ddl NOLOGIN;
CREATE ROLE koinonia_app LOGIN PASSWORD :'app_pw';

ALTER SCHEMA governance OWNER TO koinonia_ddl;
ALTER TABLE governance.event          OWNER TO koinonia_ddl;
ALTER TABLE governance.aggregate_head OWNER TO koinonia_ddl;
ALTER TABLE governance.ledger_cursor  OWNER TO koinonia_ddl;

REVOKE ALL ON ALL TABLES IN SCHEMA governance FROM PUBLIC, koinonia_app;

GRANT USAGE  ON SCHEMA governance TO koinonia_app;
GRANT SELECT, INSERT ON governance.event          TO koinonia_app;  -- sin UPDATE/DELETE/TRUNCATE
GRANT SELECT, INSERT, UPDATE ON governance.aggregate_head TO koinonia_app; -- UPDATE sí: es la cabeza
GRANT SELECT, UPDATE ON governance.ledger_cursor  TO koinonia_app;

ALTER DEFAULT PRIVILEGES FOR ROLE koinonia_ddl IN SCHEMA governance
  REVOKE ALL ON TABLES FROM koinonia_app;
```

`aggregate_head` y `ledger_cursor` **sí** son mutables: son caché derivada, reconstruible desde
`event` en cualquier momento. Su integridad no descansa en los privilegios sino en que cualquier
discrepancia con la cadena recomputada es detectable.

### 4.2 Trigger

```sql
CREATE OR REPLACE FUNCTION governance.fn_event_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'governance.event es append-only: % rechazado (leaf_index=%)',
    TG_OP, COALESCE(OLD.leaf_index, -1)
    USING ERRCODE = '23514',
          HINT = 'La historia no se corrige: se compensa con un evento nuevo.';
END $$;

CREATE TRIGGER trg_event_append_only
  BEFORE UPDATE OR DELETE ON governance.event
  FOR EACH ROW EXECUTE FUNCTION governance.fn_event_append_only();

-- CRÍTICO: sin esto, `SET session_replication_role = 'replica'` desactiva el trigger.
ALTER TABLE governance.event ENABLE ALWAYS TRIGGER trg_event_append_only;

CREATE RULE rl_event_no_truncate AS ON DELETE TO governance.event DO INSTEAD NOTHING;
REVOKE TRUNCATE ON governance.event FROM PUBLIC, koinonia_app;
```

`ENABLE ALWAYS` no es un detalle: `session_replication_role = 'replica'` es una variable de sesión
que cualquier superusuario activa en una línea, y con `ENABLE REPLICA`/`ORIGIN` (el default) el
trigger no dispara. Con `ALWAYS`, dispara siempre.

### 4.3 Nota honesta

**Nada de esto detiene a un superusuario.** `postgres` puede `ALTER TABLE … DISABLE TRIGGER ALL`,
puede `DROP TRIGGER`, puede `GRANT` lo que quiera, y con `root` en la máquina puede editar los
archivos de datos o restaurar un `pg_dump` adulterado. Quien tiene `root` tiene la base.

Estas defensas cubren un conjunto distinto y real de amenazas: un bug de la aplicación que emita un
`UPDATE`, una migración descuidada, un ORM con "auto-fix", un desarrollador con la consola abierta a
las 3 a.m., una inyección SQL. Son **defensa en profundidad**, y su valor añadido es que **dejan
rastro**: desactivar un trigger o cambiar privilegios queda en los logs de PostgreSQL y en el
historial de migraciones. La garantía real contra el administrador no está aquí: está en que
cualquier historia alterada **contradice raíces ya publicadas fuera de su alcance** (§7 y §8).

Complemento operativo barato: una **réplica lógica de sólo lectura** de `governance.event` en una
máquina que administre otra persona (otro estudiante, un docente), o un `pg_dump` diario firmado y
enviado por correo a dos personas distintas. No impide nada; multiplica el número de copias que el
atacante debería alterar simultáneamente, y añade testigos humanos con acceso propio.

> **ADR-132 (propuesta):** Append-only defendido por privilegios y trigger `ENABLE ALWAYS` —
> **Decisión:** `koinonia_app` recibe sólo `SELECT, INSERT` sobre `governance.event`; el dueño de los
> objetos es un rol distinto (`koinonia_ddl`) sin login; trigger `BEFORE UPDATE OR DELETE` que lanza
> excepción, marcado `ENABLE ALWAYS`; `TRUNCATE` revocado. — **Alternativas descartadas:** confiar
> sólo en la disciplina del código (un `UPDATE` accidental es cuestión de tiempo); Row Level Security
> (no cubre `DELETE` del dueño ni aporta sobre `REVOKE`); tablas *foreign* de sólo lectura (rompe la
> transaccionalidad del append). — **Consecuencias:** las correcciones del dominio deben modelarse
> como eventos de compensación, nunca como ediciones; las migraciones que toquen `event` requieren el
> rol `koinonia_ddl` y quedan registradas; ningún superusuario queda contenido por esto y el
> documento lo declara sin adornos.

> **ADR-133 (propuesta):** Réplica y copias en manos de terceros — **Decisión:** replicación lógica
> de sólo lectura y/o `pg_dump` firmado diario hacia al menos dos custodios que no administren el
> VPS. — **Alternativas descartadas:** backup únicamente en el mismo VPS (mismo `root`, misma
> amenaza); backup en un bucket pagado (el proyecto no tiene presupuesto ni titular institucional).
> — **Consecuencias:** aparece una responsabilidad humana recurrente que hay que sostener en el
> tiempo; su incumplimiento debe ser visible en la propia interfaz.

---

## 5. Proyecciones

### 5.1 Principio

Las proyecciones son **derivadas y desechables**. Si alguna vez hay que elegir entre el ledger y una
vista de lectura, el ledger gana siempre: se borra la proyección y se reconstruye. Viven en un
esquema aparte, con permisos normales de lectura/escritura, porque su integridad no se protege con
privilegios sino con reproducibilidad.

```sql
CREATE SCHEMA projection;

CREATE TABLE projection.offset_tracker (
  projection   text        NOT NULL PRIMARY KEY,
  last_leaf    bigint      NOT NULL DEFAULT -1,
  running_hash bytea       NOT NULL DEFAULT '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea,
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

### 5.2 Aplicación idempotente

El avance del offset ocurre **en la misma transacción** que la escritura de la vista, con CAS sobre
`last_leaf`. Así, "aplicar el evento" y "declarar que se aplicó" no pueden divergir:

```sql
BEGIN;
  SELECT last_leaf, running_hash FROM projection.offset_tracker
   WHERE projection = 'tablero_propuestas' FOR UPDATE;

  -- … writes de la vista de lectura …

  UPDATE projection.offset_tracker
     SET last_leaf = $nuevo, running_hash = $nuevoRunning, updated_at = clock_timestamp()
   WHERE projection = 'tablero_propuestas' AND last_leaf = $esperado;
COMMIT;
```

`running_hash` es un plegado sobre los eventos efectivamente aplicados:

```
running_0 = 0x00…00
running_i = SHA256( 0x03 ‖ running_{i-1} ‖ eventHash_i )
```

Con octeto de dominio propio (`0x03`) para no confundirse con eslabones, hojas ni nodos. Su función
es distinguir dos fallas que el `last_leaf` solo no distingue: *"voy atrasado"* (benigno) de *"apliqué
una historia distinta de la que el ledger tiene hoy"* (alarma). Si recomputo el plegado sobre los
eventos 0..`last_leaf` del ledger y no coincide con `running_hash`, la proyección se construyó sobre
eventos que ya no están, o que cambiaron.

Los manejadores además se escriben idempotentes por su cuenta (`INSERT … ON CONFLICT DO UPDATE`,
`UPDATE … WHERE version < $n`), porque un fallo entre el commit de la vista y el del tracker no
existe con el esquema anterior, pero sí existe cuando la proyección escribe fuera de PostgreSQL
(caché, índice de texto, envío de correo). Para esos efectos externos, la regla es que sean
reejecutables o que se registren como eventos propios.

### 5.3 Reproceso

Cambió un manejador, o hay un bug: se reconstruye en sombra. `CREATE SCHEMA projection_v2`,
reproducir desde `leaf_index = 0` con `REPEATABLE READ` para tener una foto consistente, alcanzar el
último `leaf_index`, y hacer el intercambio en una transacción:

```sql
BEGIN;
  ALTER SCHEMA projection    RENAME TO projection_old;
  ALTER SCHEMA projection_v2 RENAME TO projection;
COMMIT;
```

Nadie edita datos a mano. Nunca. Un `UPDATE` manual sobre una proyección es indetectable por el
verificador (no está en el ledger) y crea una divergencia que el próximo reproceso deshará sin
explicación.

### 5.4 Detectar desincronización

Cuatro señales, de la más barata a la más cara, todas expuestas en `/salud`:

1. **Retraso**: `(SELECT max(leaf_index) FROM governance.event) - last_leaf`. Umbral y alerta.
2. **Divergencia de plegado**: recomputar `running_hash` sobre el rango ya aplicado y comparar. Es
   `O(n)` en hashes; para el volumen del instituto, se corre completo cada noche.
3. **Contigüidad**: `count(*) = max(leaf_index) + 1` sobre `governance.event`. Si falla, no es un
   problema de proyección: **faltan eventos** (§2.3).
4. **Diferencia contra sombra**: reconstrucción periódica en un esquema temporal y `EXCEPT` simétrico
   contra la proyección viva. Detecta manejadores no deterministas (uso de `now()`, de `random()`, de
   orden de iteración no estable) y ediciones manuales.

Si (1) o (2) fallan, la interfaz muestra la vista como *posiblemente desactualizada* en lugar de
mentir con datos viejos presentados como frescos. Si (3) falla, la interfaz entra en **estado de
alarma pública**: no es un incidente técnico, es la señal que todo este diseño existe para dar.

> **ADR-134 (propuesta):** Proyecciones desechables con offset transaccional y `running_hash` —
> **Decisión:** vistas de lectura en esquema propio, reconstruibles desde `leaf_index = 0`; avance
> del offset en la misma transacción que la escritura, con CAS; plegado `running_hash` con octeto de
> dominio `0x03` para detectar historia divergente; reproceso por esquema en sombra e intercambio
> atómico; prohibición absoluta de edición manual. — **Alternativas descartadas:** proyecciones como
> fuente de verdad con el ledger como bitácora (invierte la propiedad central); offset en memoria o
> en archivo (se pierde y produce reaplicaciones silenciosas); reproceso in situ sin sombra (deja la
> plataforma inconsistente durante la reconstrucción, en horario de asamblea). — **Consecuencias:**
> los manejadores deben ser deterministas y sin efectos externos irreversibles; se paga un
> recomputo nocturno; a cambio, cualquier divergencia entre lo que la web muestra y lo que el ledger
> dice es detectable automáticamente y por cualquiera.

---

## 6. Merkle tree y checkpoints

### 6.1 Cadencia

La **ventana de anclaje** es la ventana de alterabilidad: todo lo ocurrido desde la última raíz
anclada puede reescribirse sin contradecir nada externo. Por eso la cadencia no es un parámetro de
rendimiento, es la definición de la garantía.

- **Checkpoint corriente:** cada hora en punto, si hubo eventos. Se publica, se encadena, no
  necesariamente se ancla.
- **Checkpoint firme:** diario a las 03:00 (hora de Bogotá). Se envía a **todos** los anclajes (§8).
- **Checkpoint forzado:** al cerrar una votación, al congelar un padrón y al cerrar una objeción.
  Estos momentos son los que alguien querría reescribir; se anclan de inmediato, sin esperar a las
  03:00.

Ventana máxima en el peor caso: 24 h; en los momentos sensibles, minutos.

### 6.2 Hojas: qué, en qué orden, y el nodo impar

La **entrada** `i` del log es el `event_hash` del evento con `leaf_index = i`, y el orden de las
entradas es el del `leaf_index` ascendente. No por hash, no por `occurred_at`, no por agregado: el
árbol es un *log*, y el orden **es** la afirmación histórica. Ordenar por hash produciría un conjunto
y perdería exactamente la información que queremos fijar.

**Entrada no es hoja.** La distinción parece pedante y es el centro de §6.3: la *entrada* `d_i` es el
dato del log (aquí, un `event_hash` de 32 bytes); la *hoja* es `SHA256(0x00 ‖ d_i)`. El árbol se
construye sobre hojas, nunca sobre entradas. Quien confunda una cosa con la otra construye un árbol
sin prefijo de hoja y reabre el ataque de segunda preimagen que §6.3 dedica media página a cerrar.

> **Corregido tras la implementación (2026-08-21):** esta sección decía que la hoja «es el
> `event_hash`», mientras la fórmula de §6.3 decía `MTH({d0}) = SHA256(0x00 ‖ d0)` —dato crudo— y el
> código de ejemplo de §6.3 asumía hojas **ya hasheadas** (`return leaves[0]; // ya vienen hasheadas`).
> Tres convenciones en dos páginas. Quien leyera esta prosa y llamara a ese código obtenía un árbol
> **sin prefijo de hoja**: el ataque de segunda preimagen, servido por la propia especificación. El
> contrato queda ahora explícito y en un solo sentido (§6.3).

Con número impar de nodos en un nivel, **no se duplica nada**. RFC 6962 no razona por niveles sino
por partición recursiva: se corta en `k`, la mayor potencia de dos estrictamente menor que `n`. Un
nodo sin pareja simplemente **asciende** con su hash intacto. Duplicar el último —como hace
Bitcoin— produjo CVE-2012-2459: dos listas de transacciones distintas (una con la cola repetida)
con idéntica raíz. En un ledger de gobernanza eso significaría dos historias distintas con el mismo
checkpoint: fatal.

```
MTH({})      = SHA256("")                                   // 32 bytes de la cadena vacía
MTH({d0})    = SHA256(0x00 ‖ d0)                            // HOJA, sobre la ENTRADA CRUDA d0
MTH(D[n])    = SHA256(0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n]))     // NODO, k = 2^⌊log2(n-1)⌋
```

`D[n]` es la lista de **entradas crudas**, no de hojas. `MTH` aplica `0x00` él mismo. Es la
convención literal de RFC 6962 y es la que fija §6.3 para toda la API pública.

### 6.3 Segunda preimagen: por qué `0x00` y `0x01`

Supongamos que no hay prefijos: hoja = `SHA256(d)`, nodo = `SHA256(l ‖ r)`. Tomemos un árbol de
cuatro hojas `d0..d3`, con nodos `N01 = SHA256(h0‖h1)`, `N23 = SHA256(h2‖h3)` y raíz
`R = SHA256(N01‖N23)`.

Un atacante construye ahora un árbol de **dos** hojas cuyos datos son `d'0 = h0‖h1` (64 bytes) y
`d'1 = h2‖h3`. Sus hashes de hoja son `SHA256(h0‖h1) = N01` y `SHA256(h2‖h3) = N23`, y la raíz es
`SHA256(N01‖N23) = R`. **La misma raíz, un log distinto, sin romper SHA-256.** El atacante no
necesitó ninguna colisión: aprovechó que un hash de nodo interno y un hash de hoja son
sintácticamente indistinguibles. Consecuencias directas: puede exhibir un log de tamaño 2 con la
misma raíz que el de tamaño 4 (negando dos eventos), y puede producir pruebas de inclusión para
"eventos" que nunca se insertaron.

Certificate Transparency lo cierra prefijando la preimagen: hoja = `SHA256(0x00 ‖ d)`, nodo =
`SHA256(0x01 ‖ l ‖ r)`. Los dos dominios son ahora **disjuntos por construcción**: para que un hash
de nodo sirviera como hash de hoja habría que encontrar `d` con
`SHA256(0x00‖d) = SHA256(0x01‖l‖r)`, es decir, una colisión real de SHA-256. En Koinonía el efecto es
doble, porque las hojas son a su vez `event_hash` calculados con prefijo `0x02` (§2.1): los tres
dominios —eslabón de cadena, hoja, nodo interno— son mutuamente disjuntos.

**Contrato de la API pública (normativo):** toda función exportada del módulo Merkle recibe
**entradas crudas** (`event_hash` de 32 bytes) y aplica `leafHash` **internamente**. Ninguna función
pública acepta hojas ya hasheadas. `leafHash` y `nodeHash` se exportan sólo para que el verificador
independiente reproduzca el algoritmo paso a paso, nunca para preprocesar la lista antes de llamar a
`merkleRoot`. Con este contrato, el error de pasar hojas ya hasheadas es **imposible de cometer**: no
existe la firma que lo permita.

```ts
// packages/crypto/src/merkle.ts
const H = async (...p: Uint8Array[]) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', concat(...p)));

export const leafHash = (entry: Uint8Array) => H(Uint8Array.of(0x00), entry);
export const nodeHash = (l: Uint8Array, r: Uint8Array) => H(Uint8Array.of(0x01), l, r);

/** Mayor potencia de dos ESTRICTAMENTE menor que n, para n >= 2. Dominio: bigint de 64 bits. */
export function largestPowerOfTwoLessThan(n: bigint): bigint {
  if (n < 2n) throw new RangeError('n debe ser >= 2');
  let k = 1n;
  while (k * 2n < n) k *= 2n;   // O(log n): 63 vueltas en el peor caso de un bigint de 64 bits
  return k;
}

/** Recibe ENTRADAS CRUDAS. Aplica 0x00 internamente. Nunca recibe hojas ya hasheadas. */
export async function merkleRoot(entries: readonly Uint8Array[]): Promise<Uint8Array> {
  if (entries.length === 0) return H();                // SHA256("")
  if (entries.length === 1) return leafHash(entries[0]!);
  const k = Number(largestPowerOfTwoLessThan(BigInt(entries.length)));
  return nodeHash(await merkleRoot(entries.slice(0, k)), await merkleRoot(entries.slice(k)));
}
```

> **Corregido tras la implementación (2026-08-21):** dos defectos distintos en cuatro líneas.
>
> **(a) Convención de hoja.** `merkleRoot` devolvía `leaves[0]` sin hashear («ya vienen hasheadas con
> `0x00`»), lo que contradecía la fórmula `MTH({d0}) = SHA256(0x00 ‖ d0)` de esta misma sección y la
> prosa de §6.2. La API pública recibe ahora entradas crudas, como en el RFC.
>
> **(b) Aritmética de 32 bits en un dominio de 64.** `1 << (31 - Math.clz32(n - 1))` sólo es correcto
> para `2 ≤ n < 2³¹`: `Math.clz32` **trunca su argumento a 32 bits** y `Number(n)` pierde exactitud por
> encima de `2⁵³`, mientras el DDL declara `leaf_index` y `tree_size` como `bigint`. El tipo decía una
> cosa y la aritmética hacía otra. Con `n = 2³¹` el desplazamiento se sale del rango de un entero con
> signo de 32 bits y `k` sale **negativo**, con lo que `slice()` empieza a cortar desde el final y
> devuelve basura sin lanzar ningún error. Se sustituye por un bucle explícito sobre `bigint`: 63
> iteraciones en el peor caso, coste irrelevante frente a un solo SHA-256, y correcto en todo el
> dominio declarado. **Nada de trucos de bits de 32 bits en un dominio de 64.**

### 6.4 El checkpoint

```sql
CREATE TABLE governance.checkpoint (
  tree_size        bigint      NOT NULL PRIMARY KEY,   -- nº de entradas cubiertas
  root_hash        bytea       NOT NULL CHECK (octet_length(root_hash) = 32),
  heads_root       bytea       NOT NULL CHECK (octet_length(heads_root) = 32),
  prev_checkpoint  bytea       CHECK (prev_checkpoint IS NULL OR octet_length(prev_checkpoint) = 32),
  -- PREIMAGEN (§1.1-bis): mismo formato exacto que event.occurred_at. NUNCA timestamptz.
  issued_at        char(24)    NOT NULL
                   CHECK (issued_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),
  checkpoint_hash  bytea       NOT NULL UNIQUE CHECK (octet_length(checkpoint_hash) = 32),
  firm             boolean     NOT NULL DEFAULT FALSE
);
```

El objeto canónico del checkpoint es

```
checkpoint_hash = SHA256( 0x04 ‖ JCS_utf8( {treeSize, rootHash, headsRoot, prevCheckpoint?, issuedAt} ) )
```

con `rootHash`, `headsRoot` y `prevCheckpoint` en **hex minúscula** dentro del objeto, `treeSize` como
entero y `issuedAt` como la cadena RFC 3339 de 24 caracteres, literalmente la que está en la columna.
Los checkpoints forman **su propia cadena** (`prev_checkpoint`), de modo que la serie publicada
tampoco se puede podar por el medio.

> ### Regla del primer checkpoint
>
> **Si no hay checkpoint previo, la clave `prevCheckpoint` se OMITE del objeto canónico.** No se
> emite `null`, no se emite cadena vacía, no se emite un centinela de 64 ceros. El objeto canónico del
> primer checkpoint tiene **cuatro** claves; el de todos los demás tiene cinco.
>
> Es decir, para `tree_size` inicial:
> `SHA256(0x04 ‖ JCS_utf8({headsRoot, issuedAt, rootHash, treeSize}))` — cuatro claves, ordenadas por
> JCS.

> **Corregido tras la implementación (2026-08-21):** el `checkpoint_hash` estaba **indefinido para el
> primer checkpoint**. `prevCheckpoint` es `NULL` ahí, pero §1.3.d prohíbe `null` en los objetos
> canónicos y la spec no decía si la clave se omite, se pone en cadena vacía o se usa un centinela.
> Dos implementaciones honestas producían **dos hashes distintos para el mismo checkpoint**, y
> justamente para el checkpoint que ancla el origen de la vigencia. Se fija la omisión, que es lo que
> §1.3.d ya manda para el resto del sistema («la ausencia se expresa omitiendo la clave»): la regla
> existía, sólo faltaba aplicarla aquí. `issued_at` pasó además de `timestamptz` a `char(24)` por
> §1.1-bis, porque participa de esta preimagen.

`heads_root` es un segundo árbol de Merkle, con las mismas reglas de dominio, sobre las **entradas**
`aggregate_id(16B) ‖ seq(int64 BE) ‖ head_hash(32B)` —a las que `MTH` aplica su `0x00` de hoja como a
cualquier otra entrada (§6.3)—, **ordenadas por `aggregate_id`**. Los 16 bytes son la decodificación
de los 32 hex del identificador; y como el hexadecimal en minúscula es monótono respecto de los bytes
que representa (`0`–`9` y `a`–`f` son crecientes en ASCII y no se solapan), ordenar por la cadena de
32 hex y ordenar por los 16 bytes dan **el mismo orden**: el `ORDER BY aggregate_id` de SQL y el
ordenamiento binario del verificador no pueden divergir. Aquí el orden por identificador sí
corresponde: es un conjunto, no una historia.
Su función es dar un compromiso explícito al *censo de agregados*: cualquiera que guarde un
checkpoint de ayer y vea que el de hoy tiene un `heads_root` incompatible con la propuesta que él
mismo abrió, tiene evidencia de la desaparición sin necesidad de recorrer todo el log.

Y cada checkpoint emitido se escribe también como evento `CheckpointEmitido` en la espina `#ledger`,
con `payload = { treeSize, rootHash, checkpointHash }`. Ese evento cae en `leaf_index = treeSize`, es
decir, **queda dentro del siguiente checkpoint**: el log se compromete recursivamente con su propia
historia de publicaciones. Retirar un checkpoint del sitio web deja de ser suficiente; hay que
sacarlo también del log, y eso rompe la espina.

### 6.5 Prueba de inclusión y verificación en cliente

El servidor genera el *audit path*; el cliente lo verifica sin confiar en él. La verificación usa el
algoritmo de RFC 6962, que trabaja con el índice de la hoja y el tamaño del árbol, y por eso no
necesita saber la forma del árbol de antemano.

```ts
// packages/crypto/src/merkle.ts — corre igual en navegador y en Node
export async function verifyInclusion(
  entry: Uint8Array,       // ENTRADA CRUDA: el event_hash que el estudiante quiere comprobar
  leafIndex: bigint,       // su posición global en el log
  treeSize: bigint,        // tamaño del árbol del checkpoint
  proof: Uint8Array[],     // audit path entregado por el servidor
  expectedRoot: Uint8Array // raíz del checkpoint ANCLADO (no la que diga la web hoy)
): Promise<boolean> {
  if (leafIndex >= treeSize) return false;
  let fn = leafIndex, sn = treeSize - 1n;
  let r = await leafHash(entry);   // el 0x00 lo aplica la función, no quien la llama (§6.3)
  for (const sibling of proof) {
    if (sn === 0n) return false;                       // sobran nodos: prueba mal formada
    if ((fn & 1n) === 1n || fn === sn) {
      r = await nodeHash(sibling, r);                  // somos hijo derecho (o cola promovida)
      while (fn !== 0n && (fn & 1n) === 0n) { fn >>= 1n; sn >>= 1n; }
    } else {
      r = await nodeHash(r, sibling);                  // somos hijo izquierdo
    }
    fn >>= 1n; sn >>= 1n;
  }
  return sn === 0n && eq(r, expectedRoot);             // sn!==0 => faltan nodos
}
```

El tamaño de la prueba es `⌈log2(treeSize)⌉`: con 100 000 eventos son 17 hashes, 544 bytes. Un
teléfono lo verifica en milisegundos con WebCrypto, sin WASM y sin descargar el log.

> **ADR-135 (propuesta):** Árbol Merkle estilo Certificate Transparency — **Decisión:** hojas
> `SHA256(0x00 ‖ event_hash)`, nodos `SHA256(0x01 ‖ izq ‖ der)`, partición en la mayor potencia de dos
> menor que `n`, **sin duplicar** el nodo impar, hojas ordenadas por `leaf_index`, árbol vacío =
> `SHA256("")`. — **Alternativas descartadas:** árbol estilo Bitcoin con duplicación de la cola
> (CVE-2012-2459: dos historias, una raíz); árbol sin separación de dominio (ataque de segunda
> preimagen de §6.3, que permite negar eventos y fabricar pruebas); hojas ordenadas por hash (pierde
> el orden histórico, que es la afirmación). — **Consecuencias:** interoperabilidad con el ecosistema
> CT (Trillian, `certificate-transparency-go`) para verificadores de terceros; hay que implementar
> partición recursiva en vez del bucle por niveles, ligeramente menos intuitivo.

> **ADR-136 (propuesta):** `heads_root` y auto-registro del checkpoint — **Decisión:** cada
> checkpoint incluye un segundo árbol sobre `(aggregate_id, seq, head_hash)` ordenado por
> `aggregate_id`, y se registra a sí mismo como evento `CheckpointEmitido` en la espina. —
> **Alternativas descartadas:** checkpoint sólo con la raíz del log (la desaparición de un agregado
> exige recorrer todo el log para detectarse); lista plana de cabezas firmada (crece linealmente y
> no admite prueba compacta de pertenencia). — **Consecuencias:** el cálculo del checkpoint recorre
> `aggregate_head` completo; a cambio, un estudiante puede probar en `O(log n)` que *su* propuesta
> seguía existiendo en una fecha dada.

---

## 7. Pruebas de consistencia entre checkpoints

### 7.1 Qué ataque cierran

Un ledger reescrito de cero es **internamente perfecto**: cadenas coherentes, espina coherente,
árbol bien formado, raíz nueva impecable. Toda la verificación de §1–§6 da verde. Lo único que puede
delatarlo es la comparación con una afirmación anterior: *la raíz `R_viejo` sobre `m` hojas que se
publicó el martes*. La **prueba de consistencia** demuestra que el árbol actual de `n` hojas
**contiene al de `m` hojas como prefijo intacto**, con `m ≤ n`. Si el atacante cambió, borró o
reordenó cualquier hoja de las primeras `m`, no existe prueba posible: tendría que exhibir subárboles
que hasheen a `R_viejo` conteniendo datos distintos.

Es la pieza que impide "publicar una raíz nueva coherente pero falsa". Sin ella, cada checkpoint es
una afirmación aislada y el anclaje sólo demuestra *cuándo* se dijo algo, no que lo de hoy sea
compatible con lo de ayer.

### 7.2 Generación (RFC 6962 §2.1.2)

```ts
// PROOF(m, D[n]) = SUBPROOF(m, D[n], true)
// `entries` son ENTRADAS CRUDAS (§6.3), no hojas ya hasheadas.
async function subproof(m: bigint, entries: readonly Uint8Array[], b: boolean): Promise<Uint8Array[]> {
  if (m === 0n) return [];                       // CASO BASE: el árbol vacío es prefijo de todo
  const n = BigInt(entries.length);
  if (m === n) return b ? [] : [await merkleRoot(entries)];
  const k = largestPowerOfTwoLessThan(n);        // bigint, §6.3 — sin trucos de 32 bits
  const izq = entries.slice(0, Number(k)), der = entries.slice(Number(k));
  return m <= k
    ? [...(await subproof(m, izq, b)), await merkleRoot(der)]
    : [...(await subproof(m - k, der, false)), await merkleRoot(izq)];
}
```

La intuición del parámetro `b`: mientras el prefijo antiguo coincide exactamente con un subárbol
completo del árbol nuevo, el verificador ya puede recomponerlo por sí mismo y no hace falta
enviárselo (`b = true`, no se emite nada). En cuanto deja de coincidir, se emite el hash del subárbol
para que pueda reconstruir ambas raíces.

El caso base `m = 0` es el mismo que fija RFC 6962: un árbol de cero entradas es prefijo de cualquier
árbol, y demostrarlo no requiere ningún nodo. **La prueba vacía es la prueba.** El verificador de
§7.3 ya lo contemplaba (`if (m === 0n) return proof.length === 0`); ahora el generador coincide.

> **Corregido tras la implementación (2026-08-21):** `subproof` **no tenía caso base para `m = 0`** y
> se rompía de la peor manera posible: en silencio. Con `m = 0` la recursión bajaba siempre por la
> rama `m <= k` hasta `n = 1`; ahí `m !== n`, así que calculaba `1 << (31 - Math.clz32(0))`. Como
> `Math.clz32(0) = 32`, eso es `1 << -1`, y JavaScript enmascara el desplazamiento a 5 bits: `1 << 31`
> = `-2147483648`. Con `k` negativo, `slice(0, k)` y `slice(k)` reinterpretan el índice desde el final
> y devuelven segmentos arbitrarios; la función **no lanzaba, devolvía basura**.
>
> El verificador de §7.3 **sí** contemplaba `m = 0`. Generador y verificador discrepaban, por tanto,
> justo en el **primer checkpoint de cada vigencia** —el único con `m = 0`—, que es precisamente la
> prueba que §7.4 declara «la que importa políticamente»: la que permite comprobar de un tirón que
> toda la historia del semestre sigue siendo la misma. Cada semestre habría fallado la primera
> verificación, y el modo de fallo (basura, no excepción) habría hecho que el diagnóstico costara
> días.

### 7.3 Verificación

Recomputa **dos** raíces a la vez con la misma lista de nodos: la vieja y la nueva. Sólo si las dos
salen correctas la prueba vale.

```ts
export async function verifyConsistency(
  m: bigint, n: bigint, proof: Uint8Array[],
  oldRoot: Uint8Array, newRoot: Uint8Array
): Promise<boolean> {
  if (m > n) return false;
  if (m === n) return proof.length === 0 && eq(oldRoot, newRoot);
  if (m === 0n) return proof.length === 0;             // el árbol vacío es prefijo de todo

  let fn = m - 1n, sn = n - 1n;
  while ((fn & 1n) === 1n) { fn >>= 1n; sn >>= 1n; }   // descarta los unos de la derecha

  let i = 0, fr: Uint8Array, sr: Uint8Array;
  if (fn === 0n) {                 // m es potencia de 2: la raíz vieja ES un subárbol completo
    fr = oldRoot; sr = oldRoot;    // y por eso NO viene en la prueba
  } else {
    if (proof.length === 0) return false;
    fr = proof[i]; sr = proof[i]; i++;
  }

  for (; i < proof.length; i++) {
    const c = proof[i];
    if (sn === 0n) return false;
    if ((fn & 1n) === 1n || fn === sn) {
      fr = await nodeHash(c, fr);
      sr = await nodeHash(c, sr);
      while (fn !== 0n && (fn & 1n) === 0n) { fn >>= 1n; sn >>= 1n; }
    } else {
      sr = await nodeHash(sr, c);  // rama que sólo existe en el árbol nuevo
    }
    fn >>= 1n; sn >>= 1n;
  }
  return sn === 0n && eq(fr, oldRoot) && eq(sr, newRoot);
}
```

### 7.4 Política

Ningún checkpoint se publica sin su prueba de consistencia contra **el checkpoint firme
inmediatamente anterior** y contra **el primer checkpoint firme de la vigencia** (el del inicio del
semestre). La segunda es la que importa políticamente: permite a cualquiera comprobar de un tirón
que toda la historia del semestre en curso sigue siendo la misma. Las pruebas se archivan como
ficheros junto al checkpoint y se incluyen en el export (§9.3); no se generan bajo demanda, porque
un servidor que las genera bajo demanda es un servidor que puede negarse a generarlas justo cuando
hacen falta.

> **ADR-137 (propuesta):** Prueba de consistencia obligatoria en cada publicación — **Decisión:**
> todo checkpoint se publica acompañado de pruebas RFC 6962 contra el firme anterior y contra el
> primero de la vigencia; se archivan como artefactos estáticos, no se generan bajo demanda. —
> **Alternativas descartadas:** publicar sólo raíces (una raíz nueva coherente pero falsa es
> indistinguible de una legítima); reverificación completa descargando el log entero (imposible en
> un móvil y creciente sin cota); firmar el checkpoint con una clave del servidor (sólo prueba quién
> lo dijo, no que sea compatible con lo anterior — la clave la tiene el mismo administrador). —
> **Consecuencias:** el almacenamiento de checkpoints crece con `O(log n)` hashes por publicación,
> irrelevante en volumen; el verificador debe implementar el algoritmo de doble raíz, que es la parte
> más delicada del código y lleva pruebas contra los vectores de `certificate-transparency-go`.

> **ADR-138 (propuesta):** Recibo de inclusión para el autor — **Decisión:** al confirmar cualquier
> acción, el sistema entrega al miembro un *recibo* descargable con `event_hash`, `leaf_index`,
> `prev_hash`, el evento canónico y, tras el siguiente checkpoint, su prueba de inclusión con la raíz
> anclada. — **Alternativas descartadas:** no entregar nada (la detección dependería sólo de que
> alguien guarde checkpoints; el miembro afectado se quedaría sin evidencia propia de lo que hizo);
> recibo con firma del servidor (la clave está en el VPS). — **Consecuencias:** aparece un artefacto
> que los estudiantes deben conservar para que sirva; se distribuye la capacidad de detección entre
> cientos de personas, que es el objetivo, pero su eficacia depende de un hábito social que hay que
> cultivar y que probablemente sólo unos pocos sostendrán.

---

## 8. Anclaje externo sin criptomonedas

### 8.1 Comparación

| Anclaje | Qué prueba | Confianza requerida | Costo | Latencia | Falla típica |
|---|---|---|---|---|---|
| **OpenTimestamps (Bitcoin)** | Que el hash existía **antes** de un bloque | Ninguna entidad concreta; sólo Bitcoin | Cero (agregadores públicos) | 1–6 h a confirmación | Agregador caído; sello *pendiente* que nunca madura |
| **Git público + commits firmados GPG** | Historia lineal legible, replicada en cada `clone` | La *forja* (GitHub/Codeberg) para la disponibilidad; la firma no depende de ella | Cero | Segundos | Cuenta suspendida; `push --force` (detectable si alguien clonó) |
| **Correo a destinatarios independientes** | Que N personas ajenas recibieron el hash en una fecha | Los destinatarios y sus proveedores | Cero | Minutos | Nadie guarda el correo; filtro de spam; todos usan el mismo proveedor |
| **Log público de terceros (Rekor/sigstore)** | Inclusión en un log transparente ajeno, con su propia prueba | El operador del log (mitigado por su propia auditabilidad) | Cero | Segundos | Cambio de política del operador; el servicio desaparece |
| **Cuenta en red social** | Publicación fechada, muy visible | La plataforma **y** quien controla la cuenta | Cero | Segundos | Post editable/borrable; la cuenta la administra el mismo equipo |

Las diferencias que importan no son técnicas sino de **quién debe mentir para que el ataque
funcione**. Bitcoin exige reescribir una cadena de trabajo acumulado; una forja de git exige
colusión de una empresa que no conoce el proyecto y de todos los que hicieron `clone`; el correo
exige que todos los destinatarios pierdan o entreguen su buzón; la red social exige nada más que la
contraseña de la cuenta, que la tiene el propio administrador. Por eso la cuenta social **no es un
anclaje**: es difusión. Se usa para que la gente sepa que el checkpoint existe, no como prueba.

### 8.2 Recomendación

**Múltiples anclajes independientes, y "firme" definido por quórum.** Un checkpoint diario se
declara `FIRME` cuando **al menos 2 de 3 anclajes de naturaleza distinta** confirmaron:

1. **OpenTimestamps** — sin tercero confiable, tiempo real demostrable, gratis.
2. **Git firmado, empujado a dos forjas distintas** (p. ej. Codeberg y GitHub) desde una clave GPG
   cuyo material privado **no vive en el VPS** sino en el equipo de un miembro de la veeduría. Un
   fichero por checkpoint, más `CHECKPOINTS.txt` acumulativo, legible por un humano.
3. **Correo firmado a cinco destinatarios de dominios distintos**: representación estudiantil,
   dirección del instituto, dos docentes y una persona externa a la universidad.

Opcional cuarto: **Rekor**, si se quiere una prueba de inclusión de un log ajeno.

El punto no es la fuerza individual sino la **independencia de los modos de falla**: no existe una
sola acción —ni siquiera con `root`, ni siquiera con la clave GPG— que borre simultáneamente una
confirmación de Bitcoin, dos forjas y cinco buzones.

Si la clave GPG estuviera en el VPS, el anclaje 2 sería teatro: el administrador firmaría la historia
falsa. Que la clave viva fuera es la mitad del valor del mecanismo.

### 8.3 `AnchorProvider`

```ts
// packages/anchoring/src/provider.ts
export type CheckpointRef = {
  treeSize: bigint; rootHash: Uint8Array;
  headsRoot: Uint8Array; checkpointHash: Uint8Array; issuedAt: string;
};

export type AnchorReceipt = {
  provider: string;            // 'ots' | 'git' | 'email' | 'rekor'
  externalRef: string;         // txid/commit sha/Message-ID/UUID de entrada del log
  proof?: Uint8Array;          // .ots, o prueba de inclusión del log ajeno
  confirmedAt?: string;        // ausente mientras está pendiente
  raw: JsonObject;             // respuesta cruda, para poder reverificar a mano
};

export interface AnchorProvider {
  readonly id: string;
  readonly independenceClass: 'blockchain' | 'vcs' | 'human-witness' | 'third-party-log';
  submit(cp: CheckpointRef): Promise<AnchorReceipt>;             // puede quedar pendiente
  poll?(r: AnchorReceipt): Promise<AnchorReceipt>;               // OTS: madurar el sello
  verify(cp: CheckpointRef, r: AnchorReceipt): Promise<boolean>; // OFFLINE si es posible
}
```

`verify` es obligatorio en la interfaz y debe funcionar **sin llamar a nuestro servidor**: es el
método que reusa el verificador CLI de §9.2. `independenceClass` no es decorativo: el evaluador de
quórum exige dos confirmaciones de **clases distintas**, para que tres proveedores que en el fondo
dependen del mismo tercero no cuenten como tres.

### 8.4 Cuando un anclaje falla

Falla de anclaje = **degradación anunciada**, nunca silencio.

```sql
CREATE TABLE governance.anchor_attempt (
  id            bigserial   PRIMARY KEY,      -- aquí los huecos SÍ dan igual: no es el ledger
  tree_size     bigint      NOT NULL REFERENCES governance.checkpoint(tree_size),
  provider      text        NOT NULL,
  state         text        NOT NULL CHECK (state IN ('PENDIENTE','CONFIRMADO','FALLIDO')),
  attempt_no    integer     NOT NULL DEFAULT 1,
  external_ref  text,
  -- Respuesta cruda del proveedor, TAL CUAL llegó. `text`, no `jsonb`: algunos recibos
  -- (Rekor, DKIM del correo) llevan firma sobre los bytes exactos, y jsonb los reordenaría.
  receipt       text,
  receipt_idx   jsonb GENERATED ALWAYS AS (receipt::jsonb) STORED,   -- consulta; NO autoritativo
  error         text,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
```

> **Corregido tras la implementación (2026-08-21):** `receipt` era `jsonb`. Esta tabla no es el
> ledger y sus huecos dan igual (`bigserial`), pero el recibo **sí** puede ser la preimagen de una
> verificación ajena: `AnchorProvider.verify` debe funcionar **offline** (§8.3) y los recibos de Rekor
> y las cabeceras DKIM del correo firmado se verifican sobre **los bytes exactos** que emitió el
> tercero. Guardarlos en `jsonb` los reordena y deja el anclaje inverificable justo cuando alguien
> quiere comprobarlo a mano. Es la misma regla de §1.1-bis aplicada a una preimagen que no es nuestra.

1. **Reintento** con backoff (1 min, 5, 25, 2 h, 12 h) hasta 24 h.
2. **Registro en el ledger**: cada transición se escribe como evento del agregado `#anclaje`
   (`AnclajeIntentado`, `AnclajeConfirmado`, `AnclajeFallido`, con `treeSize`, `provider`, motivo).
   La falla queda dentro de la estructura protegida: ocultarla exige alterar el ledger, y alterar el
   ledger es lo que el anclaje detecta. Es circular a propósito, y en el sentido correcto: escala el
   costo del encubrimiento.
3. **Sin quórum a las 24 h → estado `NO ANCLADO` visible** en la portada, en la pantalla de
   verificación y en el export, con la fecha desde la cual no hay anclaje válido.
4. **Sin quórum durante 72 h** → según el reglamento, las decisiones adoptadas en ese lapso se marcan
   como *pendientes de confirmación de integridad*. Es una consecuencia de gobernanza, no técnica, y
   es la única que hace que alguien repare el problema.

El fallo nunca se resuelve reanclando en silencio con fecha vieja: el checkpoint se ancla cuando se
ancla, y la brecha temporal queda registrada para siempre.

> **ADR-139 (propuesta):** Anclaje múltiple independiente con quórum 2-de-3 por clase —
> **Decisión:** OpenTimestamps + git firmado GPG en dos forjas (clave fuera del VPS) + correo a cinco
> destinatarios de dominios distintos; `FIRME` requiere dos confirmaciones de clases de independencia
> distintas; las fallas se registran como eventos del ledger y degradan visiblemente el estado
> público. — **Alternativas descartadas:** anclaje único en Bitcoin (latencia y dependencia de un
> agregador; si OTS falla no queda nada); anclaje único en git (una forja, una cuenta, un
> `push --force`); blockchain propia o token (prohibido por ADR previo y absurdo para 300 personas);
> notaría digital de pago (sin presupuesto ni titular institucional); publicar en la cuenta de la
> asamblea como prueba (la controla el mismo administrador). — **Consecuencias:** hay que operar y
> vigilar tres integraciones; la clave GPG introduce una dependencia humana real (si esa persona se
> gradúa y desaparece, el anclaje 2 muere) y necesita procedimiento de relevo.

---

## 9. La pantalla "Verificar integridad"

### 9.1 Qué ve alguien que no sabe qué es un hash

Un solo botón, sin jerga: **"Comprobar que nada fue alterado"**. Debajo, una línea: *"Tu navegador va
a revisar las cuentas por su cuenta. No hace falta que entiendas cómo funciona."*

Al pulsar, una barra con cuatro pasos en lenguaje llano —*Descargando la historia · Recalculando ·
Comparando con el sello externo · Listo*— y uno de tres resultados:

**Verde — "Todo cuadra."**
> Revisamos 12 480 registros desde el 3 de febrero. Ninguno fue modificado ni eliminado.
> El resumen de ayer quedó registrado en Bitcoin el 21 de agosto a las 03:14 y en dos repositorios
> públicos. **Última comprobación externa: hace 11 horas.**

**Ámbar — "Falta la confirmación externa."**
> Las cuentas internas cuadran, pero el resumen de las últimas 26 horas todavía no fue registrado
> fuera de este servidor. Eso significa que lo ocurrido desde entonces **aún no está protegido**.
> No es prueba de que algo esté mal; sí es motivo para avisar a la veeduría. [Ver por qué falló]

**Rojo — "Hay una diferencia."**
> Un registro del 14 de agosto no coincide con el sello publicado ese día.
> **Esto no debería ocurrir nunca.** Guardá esta evidencia y avisá a la veeduría.
> [Descargar evidencia (2 MB)] [Cómo comprobarlo por tu cuenta, sin usar esta página]

Nada de hexadecimal en la primera pantalla. Detrás de *"Ver detalles"*: raíz, `treeSize`, `leaf_index`
y las pruebas, con un enlace a cada anclaje (la página de OpenTimestamps, el commit en Codeberg) que
apunta a **dominios que no son el nuestro**.

Y siempre visible, en la propia pantalla, la advertencia que da sentido a todo lo demás:

> ⚠ **Esta página te la sirve el mismo servidor que estás verificando.** Si ese servidor estuviera
> comprometido, esta página podría mentirte. Para una comprobación real, usá el verificador
> independiente. [Cómo]

### 9.2 Verificador independiente por npm

Si el único verificador es el nuestro, no probamos nada: es pedirle al acusado que redacte el
peritaje. El artefacto que sí prueba algo es un programa que viene por **otra cadena de suministro**,
corre en la máquina de otra persona y no habla con nuestro servidor salvo para descargar datos.

```
$ npx @koinonia/verificar@1.4.0 revisar ./koinonia-export-2026-08-21

  ✓ 12 480 eventos: canonicalización JCS y cadenas por agregado correctas
  ✓ espina: 312 agregados abiertos, 312 génesis presentes y enlazados
  ✓ leaf_index denso: 0..12479, sin huecos
  ✓ raíz Merkle recomputada = 9f3c…a12b (coincide con el checkpoint 12480)
  ✓ consistencia 8102 → 12480 verificada (RFC 6962)
  ✓ OpenTimestamps: hash anclado en el bloque 921 447 (2026-08-21 03:14 UTC)
  ✓ git: commit a3f19c2 firmado por 8F2A…C4D1 (veeduría), presente en Codeberg y GitHub
  ✗ correo: 3 de 5 acuses; falta 2 (informativo, el quórum ya se cumplió)

  RESULTADO: la historia exportada es íntegra y está anclada externamente.
```

Subcomandos: `revisar` (todo), `inclusion --evento <hash>` (un recibo suelto, sin descargar el log),
`consistencia --desde <n> --hasta <m>`, `anclajes`, `diff <exportA> <exportB>` —este último para que
dos personas comparen lo que cada una descargó y detecten un **ataque de vista partida** (§10).

Cadena de suministro distinta *no* es cadena de suministro confiable: npm es un tercero más. Por eso
el paquete se publica con *provenance* de npm, su código vive en el repositorio de anclaje, y el
`sha256` del tarball se publica **dentro del propio git anclado**: quien desconfíe puede
`git clone`, leer las ~600 líneas y ejecutarlas desde el fuente. También se publican los `sha256` del
bundle JS de la web, con `integrity` (SRI) en el HTML, para que al menos un cambio del código servido
sea comparable contra algo publicado fuera.

### 9.3 Formato de export

Un directorio (o `.tar.gz`) autocontenido, en texto, versionado, sin nada propietario:

```
koinonia-export-2026-08-21/
  manifest.json          # versión de formato, rango, algoritmos, sha256 de cada fichero
  events.ndjson          # 1 evento canónico JCS por línea, orden leaf_index ASC
  events.hashes.ndjson   # {leafIndex, eventHash, prevHash, spineHash} — redundante a propósito
  heads.json             # censo de agregados: {aggregateId, type, seq, headHash}
  checkpoints.ndjson     # todos los checkpoints con su encadenamiento
  proofs/consistency/8102-12480.json
  anchors/12480/ots/checkpoint.ots
  anchors/12480/git/commit.json
  anchors/12480/email/receipts.json
  README-VERIFICACION.txt  # el algoritmo COMPLETO en prosa, para reimplementarlo desde cero
```

`README-VERIFICACION.txt` no es cortesía: es la garantía de última instancia. Si el proyecto muere,
si npm nos expulsa y si el repositorio desaparece, un tercero con Python y una tarde debe poder
reimplementar la verificación leyendo ese fichero. Todo lo demás —la web, el CLI, el paquete— es
conveniencia.

El export es **público y descargable sin autenticación**, y no contiene `payload` de eventos con
contenido reservado: ahí van los *commitments* con nonce, y el texto se revela por separado según la
política de privacidad. Ese diseño ya está resuelto en el documento 11.

> **ADR-140 (propuesta):** Verificador independiente y export autocontenido — **Decisión:** CLI
> `@koinonia/verificar` publicado en npm con provenance, código en el repositorio anclado, hash del
> tarball publicado dentro del git anclado, más export público autocontenido con `README-VERIFICACION.txt`
> que describe el algoritmo completo en prosa; la web muestra siempre la advertencia de "código
> servido por el verificado" y publica el SRI de su bundle. — **Alternativas descartadas:** sólo
> verificación en la web (el verificado escribe el peritaje); binarios precompilados (más difíciles de
> auditar que 600 líneas de TypeScript); verificación exclusivamente por un auditor contratado (sin
> presupuesto y reintroduce un tercero confiable). — **Consecuencias:** hay que mantener, versionar y
> publicar un paquete más, y el formato de export queda congelado como contrato público con política
> de compatibilidad; la eficacia real depende de que alguien ajeno lo ejecute alguna vez, lo que se
> institucionaliza como *jornada de verificación* al cierre de cada votación importante.

---

## Lo que este diseño NO garantiza

Sin adornos. Cada punto de aquí es una promesa que **no** hacemos, y decirlo es parte del diseño: un
sistema de integridad que se sobrevende produce una confianza falsa, que es peor que la desconfianza.

**1. No impide la destrucción ni la denegación de servicio.** Está aceptado desde el inicio.
`DROP DATABASE` funciona. La diferencia es que la destrucción es *ruidosa* y la alteración no; este
diseño convierte la segunda en la primera.

**2. No garantiza la veracidad de lo que se registra.** El ledger prueba que un evento no cambió
*después* de escribirse. No prueba que sea cierto. Un administrador que controla la aplicación puede
insertar un `VotoEmitido` perfectamente bien formado, con el `MemberId` de alguien que nunca votó,
y quedará anclado igual que los legítimos. **La integridad no es autenticidad.** Como no hay firmas
por miembro, no hay no-repudio: la única defensa contra eventos fabricados es que la persona
suplantada consulte su historial y desmienta, lo que exige que alguien mire. Firmas de cliente por
miembro cerrarían esta brecha; no están decididas y tienen su propio problema de gestión de claves
en una población que rota cada semestre.

**3. La ventana de anclaje es alterable.** Todo lo ocurrido desde el último checkpoint anclado puede
reescribirse sin contradecir nada externo. Con cadencia diaria, esa ventana es de hasta 24 h. Los
checkpoints forzados la reducen a minutos en los momentos sensibles, **pero sólo en los momentos que
previmos**.

**4. La detección depende de que alguien conserve evidencia y la mire.** Las pruebas de consistencia
protegen a quien guardó un checkpoint anterior. Si nadie guardó nada, nadie ejecutó el CLI y nadie
abrió el correo con el hash, una reescritura completa desde el génesis es **indetectable**. La
criptografía aquí no crea confianza por sí sola: crea la *posibilidad* de verificar. Convertir esa
posibilidad en práctica es un problema social, y es el eslabón más débil de todo el documento.

**5. Ataque de vista partida (*split view*).** El servidor puede servir a Ana una historia y a Bruno
otra, cada una internamente consistente y anclada por separado. Nada en §1–§7 lo detecta. Sólo lo
detecta el **contraste entre personas**: publicación única de checkpoints en anclajes compartidos y
comando `diff` del CLI. Sin ese hábito de comparación, la bifurcación sobrevive.

**6. El código servido por el verificado.** El JavaScript de la pantalla "Verificar integridad" lo
entrega el mismo servidor que se está auditando. Un administrador que controla el servidor sirve un
verificador que siempre dice verde, y **ninguna cantidad de criptografía dentro de ese código lo
arregla**, porque el atacante controla el código. El CLI por npm mueve el problema, no lo elimina:
npm, la forja y el ordenador de quien lo ejecuta son terceros nuevos. SRI ayuda sólo si alguien
compara el `integrity` contra el valor publicado fuera. La mitigación real es **procedimental**: que
personas sin relación con la administración ejecuten el verificador independiente, en sus propios
equipos, en momentos anunciados; y que el `README-VERIFICACION.txt` permita reimplementarlo. Es una
mitigación honesta, no una solución, y depende de que alguien se moleste.

**7. Seudonimato, no anonimato.** El `MemberId` es aleatorio, pero el ledger es público y registra
`occurredAt`. Los patrones temporales de actividad, cruzados con quién estuvo en qué asamblea,
reidentifican. Y el `pii_vault` existe: quien tenga acceso a las dos bases correlaciona en una
consulta. La separación es una barrera de arquitectura y de control de acceso, **no** una garantía
criptográfica.

**8. Los tiempos internos mienten.** `occurred_at` lo pone el servidor. Un administrador escribe la
fecha que quiera. Lo único con tiempo verificable es el **anclaje**, y su granularidad es la de la
cadencia: puedo probar que un evento existía antes del bloque de Bitcoin de las 03:14, no que ocurrió
a las 21:07 del día anterior.

**9. Sin agilidad criptográfica.** SHA-256 está fijado en toda la historia. Si algún día se rompe,
migrar exige rehashear todo con un algoritmo nuevo, re-anclar y publicar una *transición* firmada que
vincule ambas historias — un procedimiento que **no está diseñado** y que habría que diseñar bajo
presión.

**10. Los `CHECK` y `UNIQUE` no verifican los hashes.** PostgreSQL comprueba longitudes y unicidad,
no que `event_hash` sea realmente `SHA256(...)` del contenido. Un `INSERT` con hashes inventados es
aceptado por la base; sólo lo detecta la verificación externa. La base de datos **no** es parte de la
frontera de confianza.

**11. Disponibilidad y continuidad.** Un VPS pagado por un estudiante voluntario es un punto único de
fallo con un modelo de sostenibilidad de un semestre. El anclaje protege la historia, no el servicio,
y no evita que en marzo nadie renueve el hosting.

**12. Ninguna garantía sobrevive al desinterés.** Si la asamblea no exige verificación, si nadie
guarda su recibo, si la jornada de verificación se deja de convocar y el estado ámbar de "sin
anclaje" se vuelve el paisaje habitual que nadie mira, el sistema seguirá calculando hashes
impecables mientras la propiedad central —*no se puede alterar sin que se detecte*— se degrada
silenciosamente a *no se puede alterar sin que se pueda detectar, si alguien mirara*. Que es una
frase muy distinta.
