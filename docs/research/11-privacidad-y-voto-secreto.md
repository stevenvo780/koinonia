# Diseño 11 — Privacidad, borrado criptográfico y voto secreto verificable

> **Estado:** propuesta. Depende de `20-normativa-datos-colombia.md` y `30-decision-engine-spec.md`.
> Donde contradice al doc 20, lo dice y lo argumenta.
> **Versión:** 11.0.0 · **Fecha:** 2026-08-21 · **Jurisdicción:** Colombia, Ley 1581 de 2012.
>
> **Advertencia:** los datos sobre Helios y Belenios (licencias, versiones, variantes) provienen de
> literatura publicada y **deben re-verificarse contra el repositorio oficial antes de comprometer un
> despliegue**. Lo marcado *(verificar)* no es firme.

---

## 0. El problema en una frase

Koinonía promete dos cosas contradictorias: **«nada de lo decidido puede alterarse»** —razón de ser del
ledger append-only con cadena de hashes y anclaje externo— y **«tus datos personales se borran si lo
pedís»** (Art. 8 lit. e, Ley 1581). Un sistema honesto no elige una y miente sobre la otra.

Tesis: **el conflicto es aparente y nace de un error de diseño, no de la ley.** El error es meter datos
personales en el ledger. Si el ledger nunca los contiene, no hay nada que borrar en él, y la supresión se
ejecuta íntegramente en un almacén mutable diseñado para eso.

---

# PARTE 1 — PRIVACIDAD vs INMUTABILIDAD

## 1.1 Arquitectura de dos almacenes

```
┌──────────────────────────────┐        ┌───────────────────────────────┐
│     GOVERNANCE LEDGER        │        │          PII VAULT            │
│  PostgreSQL, sólo INSERT     │        │  PostgreSQL, mutable, RLS     │
│  · EventEnvelope encadenado  │        │  · nombre, correo, documento  │
│  · MemberId (seudónimo)      │◄─ref───│  · mapeo MemberId ↔ persona   │
│  · payloads sin texto        │MemberId│  · cifrado por campo con DSK  │
│    atribuible a una persona  │        │  · consent_logs               │
│  · raíz Merkle diaria        │        │           │                   │
│        │                     │        │           ▼                   │
│        ▼                     │        │  KEYSTORE (claves por sujeto) │
│  ancla externa pública       │        └───────────────────────────────┘
└──────────────────────────────┘   el ancla NUNCA toca la columna derecha
```

**La frontera como regla operativa:** un dato entra al Governance Ledger si y sólo si **su publicación
íntegra a un desconocido no revela quién es una persona identificable**, asumiendo que el desconocido tiene
la lista pública de estudiantes del Instituto. Todo lo demás va a la bóveda.

| Dato | Almacén | Justificación |
|---|---|---|
| `MemberId` (seudónimo opaco) | Ledger | Sin la bóveda no resuelve a nadie; es la bisagra entre ambos mundos. |
| Nombre, apellidos | Bóveda (cifrado) | Semiprivado (doc. 20 §2); publicarlo destruye la seudonimización. |
| Correo institucional | Bóveda (cifrado) | Semiprivado y además contiene el nombre en el *local-part* de la UdeA. |
| Documento de identidad | Bóveda (cifrado, campo aparte) | Identificación fuerte; nunca sale, ni en logs. |
| Programa académico, semestre | Bóveda (cifrado) | Cuasi-identificador: cruzado con el padrón reduce a 1-3 personas. |
| Padrón congelado | Ledger, sólo `MemberId[]` | Necesario para verificar el escrutinio; sin nombres es publicable. |
| `BallotCast` público | Ledger | El voto público lo es por configuración de la comunidad. |
| `BallotCast` en `secret-ballot` | Ledger, **sin `actor`** (ADR-119) | Dato sensible (Art. 5); el sobre del evento delataría al votante. |
| Marca «X votó» | Ledger, tabla separada | La participación es verificable y legítima; se separa físicamente del voto. |
| Texto de una propuesta | Ledger | Es el acto de gobierno; se pide sin datos personales de terceros. |
| Comentario deliberativo | **Bóveda**, hash en el Ledger | Sensible: perfila ideológicamente. El ledger guarda `sha256(jcs(texto))`. |
| Resultado y `Proof` | Ledger | Agregado, no atribuible. |
| `consent_logs` (IP, user-agent) | Bóveda | La IP es dato personal. **Prohibida** en el ledger. |
| Claves por sujeto | **Keystore** (tercer almacén) | Su destrucción *es* el borrado; no puede vivir junto a lo que protege. |
| Raíz Merkle diaria | Ledger + ancla externa | Hash de hashes: no revela contenido. |

> **Nota del editor — dos filas de esta tabla siguen abiertas** (no las resuelve R1, R2 ni R3; se
> documentan en `00-contradicciones-resueltas.md`):
> - **«Comentario deliberativo → hash en el Ledger, `sha256(jcs(texto))`».** El doc 20 §7.6 exige
>   `HMAC-SHA-256(k_KMS, payload)` y prohíbe el texto libre. Un SHA-256 sin clave de un comentario
>   admite **ataque de confirmación**: quien sospeche el texto prueba su hash y confirma autoría contra
>   el ledger. Contradicción **C14**, pendiente de resolución del arquitecto.
> - **«Padrón congelado → Ledger, sólo `MemberId[]`».** El `rollHash` de la spec 30 §A.2 se calcula
>   sobre `members` **completos** (con `circles` y `strata`). O se publica el padrón completo —y entran
>   cuasi-identificadores al ledger— o el `rollHash` no es verificable por un tercero. Contradicción
>   **C10**, pendiente.

> **ADR-110 (propuesta):** Separación estricta Governance Ledger / PII Vault —
> **Decisión:** ningún dato personal, ni cifrado, entra al Governance Ledger; sólo seudónimos opacos, hashes
> y datos de gobierno. La bóveda es relacional y mutable, donde `DELETE` es normal. —
> **Alternativas descartadas:** cifrar la PII *dentro* del payload —el ciphertext sigue siendo dato personal
> mientras exista una clave; «tombstones» que reescriben eventos —rompen `prevHash`. —
> **Consecuencias:** el replay nunca ve PII (ya era invariante de A.0); la supresión no toca el ledger; la
> interfaz necesita un *join* con la bóveda para mostrar nombres, y ese join es el único punto donde aplicar
> RBAC y auditoría de acceso.

## 1.2 El `MemberId` derivado rompe el borrado (corrección a la DECISIÓN A.0)

> **Confirmado por resolución R1 del arquitecto (2026-08-21):** esta sección ya no es una
> propuesta. La `DECISIÓN A.0` de `30-decision-engine-spec.md` quedó **ANULADA** y corregida en
> ese documento: el `MemberId` es un valor aleatorio de 128 bits generado con CSPRNG, sin ninguna
> relación derivable con el documento, el correo ni ningún dato personal. El ADR-111 de abajo se
> promovió a **ADR-0006, estado Aceptado**.

La spec 30 define `MemberId = base32(truncate128(HMAC-SHA256(claveInstitucional, documento)))`. Usar HMAC
con clave en vez de hash con sal pública es **correcto** (§1.4 explica por qué), pero es fatal para la
supresión: **es determinista y re-derivable**. Quien tenga la `claveInstitucional` y la lista de documentos
de la UdeA reconstruye el mapeo `MemberId → persona` entero, aunque la bóveda esté vacía. El borrado sería
ficción, y bajo la Ley 1581 un dato re-identificable sigue siendo dato personal.

> **ADR-111 (propuesta):** `MemberId` aleatorio, no derivado —
> **Decisión:** 128 bits de `crypto.randomBytes` en el alta, guardado en la bóveda como columna indexada;
> **no es función del documento**. El HMAC de A.0 sobrevive sólo como `enrollmentTag` **dentro de la bóveda**,
> para detectar altas duplicadas, y se borra con el registro. —
> **Alternativas descartadas:** mantener la derivación —hace imposible un borrado real; rotar la
> `claveInstitucional` en cada supresión —invalidaría los `MemberId` de las 299 personas restantes. —
> **Consecuencias:** el alta exige escribir en la bóveda antes de emitir eventos; destruida la fila, el
> `MemberId` queda huérfano e irreversible.

## 1.3 Borrado criptográfico (crypto-shredding)

> **Corregido por resolución R3 del arquitecto:** el borrado criptográfico **no es** el mecanismo
> principal de cumplimiento del art. 8 lit. e. Ante una solicitud de supresión, la postura del
> proyecto es **borrado físico**: `DELETE` real de la fila del PII Vault, más `VACUUM FULL`. El
> crypto-shredding queda **reservado a backups y réplicas**, donde el borrado físico es
> imposible. La defensa jurídica no puede depender de que la SIC acepte la destrucción de la
> clave como equivalente a la supresión, porque no existe doctrina publicada que lo respalde.
> El orden de `shred` que se describe abajo se mantiene, pero su paso (2) —`DELETE` físico— deja
> de ser accesorio y pasa a ser **el acto de supresión**; los pasos (1) y (3) son la cobertura de
> lo que el `DELETE` no alcanza. Ver `docs/adr/0009-borrado-fisico-en-el-pii-vault.md`.

Aun con ADR-110 la bóveda lo necesita **para lo que el `DELETE` no alcanza**: `DELETE` no borra del
WAL, ni de las réplicas, ni de los backups. La defensa es que el dato **nunca esté en claro en disco**.

```
KEK maestra ──(en KMS: age/SOPS con clave en llave física; nunca sale; sólo wrap/unwrap)
   │
   ▼
DSK — Data Subject Key, una por persona, AES-256-GCM, ALEATORIA (no derivada)
   │   almacenada únicamente envuelta: wrap(KEK, DSK)
   ▼
campos: nombre, correo, documento, programa, comentarios  ← AES-256-GCM(DSK, texto, aad)
```

La DSK es aleatoria por el mismo motivo que ADR-111: si fuera derivable, destruirla no serviría de nada.

```ts
/** El material de clave NUNCA está en este tipo: sólo la referencia envuelta. */
export interface SubjectKeyRecord {
  readonly memberId: MemberId;
  readonly keyId: string;                 // uuid v4
  readonly wrappedDsk: Uint8Array;        // wrap(KEK_activa, DSK)
  readonly kekVersion: number;
  readonly createdAt: Instant;
  readonly destroyedAt: Instant | null;   // != null ⇒ wrappedDsk sobrescrito con ceros
}

export interface CipherField {
  readonly keyId: string;
  readonly nonce: Uint8Array;             // 96 bits, único por (keyId, campo)
  readonly ct: Uint8Array;                // AES-256-GCM
  readonly aad: string;                   // `${memberId}:${tabla}:${columna}` — impide mover blobs
}

export interface PiiVault {
  put(memberId: MemberId, field: string, plaintext: string): Promise<void>;
  get(memberId: MemberId, field: string, ctx: AccessContext): Promise<string | null>;
  /** Idempotente. Devuelve el inventario de lo que quedó irrecuperable. */
  shred(memberId: MemberId, reason: ErasureReason): Promise<ShredReport>;
}

export interface ShredReport {
  readonly memberId: MemberId;
  readonly keyId: string;
  readonly destroyedAt: Instant;
  readonly fieldsRendered: readonly string[];    // campos ahora indescifrables
  readonly rowsHardDeleted: readonly string[];   // además, DELETE físico donde se puede
  /** Honestidad obligatoria: estos backups aún contienen la clave envuelta. */
  readonly backupsPendingExpiry: readonly { snapshotId: string; expiresAt: Instant }[];
}
```

`shred` hace tres cosas en orden: (1) `UPDATE subject_keys SET wrapped_dsk = <ceros>`, para que el WAL
registre una sobrescritura y no sólo un borrado lógico; (2) **`DELETE` físico de toda fila del sujeto,
en claro o cifrada** —éste es el acto de supresión propiamente dicho (R3), no un accesorio—; (3)
`VACUUM FULL` sobre las tablas afectadas. El paso (1) existe para cubrir backups y réplicas, no para
sustituir al (2).

**Rotación.** La DSK no se rota por defecto —obligaría a re-cifrar y dejaría ciphertext viejo en el WAL—,
sólo ante compromiso conocido. La KEK se rota anualmente por *re-wrap*, sin tocar los datos: 300 operaciones.
El momento correcto es **justo después** de que expire el último backup con la KEK anterior.

> **ADR-112 (propuesta):** Crypto-shredding con clave por sujeto y cifrado sobre —
> **Decisión:** toda PII se cifra con AES-256-GCM bajo una DSK aleatoria por persona; la DSK sólo existe
> envuelta bajo una KEK custodiada fuera de la base de datos; suprimir = destruir la DSK. —
> **Alternativas descartadas:** cifrado de disco (LUKS) —protege del robo del disco, no da granularidad por
> sujeto; una clave por tabla —no permite borrar a una persona sin borrar a todas. —
> **Consecuencias:** cada lectura cuesta un unwrap (caché con TTL ≤ 5 min, invalidada por `shred`); **perder
> la KEK borra toda la PII de golpe**, así que necesita respaldo 2-de-3 en sobres físicos.

### El problema de los backups viejos — límite real, no resuelto

Si hoy alguien pide supresión y existe un backup de hace un mes con `wrappedDsk` **y** la KEK de entonces,
ese backup permite reconstruir sus datos. Destruir la clave hoy no alcanza el pasado. No hay solución
criptográfica, sólo mitigaciones operativas:

1. **Retención corta y dura:** 35 días para bóveda y keystore, destrucción automática sin excepciones. El
   ledger, sin PII, puede tener retención infinita —ahí está el valor de ADR-110.
2. **Backups separados con custodios distintos:** el del keystore no comparte medio, proveedor ni credencial
   con el de datos; restaurar exige a dos personas.
3. **Cola de supresión diferida:** un backup **nunca** se restaura sin pasar por `replayPendingErasures()`,
   que re-ejecuta los `shred` pendientes sobre el snapshot.
4. **Declaración al titular:** *«sus datos ya son irrecuperables en producción; las copias que aún los
   contienen se destruyen el DD/MM/AAAA»*. Eso es defendible ante la SIC; afirmar borrado instantáneo no.

> **ADR-113 (propuesta):** Retención de 35 días y re-shred obligatorio en toda restauración —
> **Decisión:** los backups con material de clave duran 35 días máximo; toda restauración pasa por
> `replayPendingErasures()` antes de aceptar tráfico. —
> **Alternativas descartadas:** backups sin PII —imposible, la bóveda *es* PII; confiar en que nadie restaure
> —no es un control. —
> **Consecuencias:** se pierde recuperación a largo plazo de la bóveda (reconstruible desde el registro
> institucional); el SLA de supresión efectiva es 15 días hábiles + 35 de expiración, y **hay que decirlo**.

> **Corregido por resolución R3 del arquitecto.** Este bloque decía: *«El doc 20 §2 afirma: "La SIC acepta
> esto como equivalente a la supresión física del dato personal."»* **Esa frase no existe en el documento
> 20**, ni en su §2 ni en ninguna otra sección: es una cita fantasma contra la que se argumentaba. El doc 20
> §7.3 sostiene exactamente lo contrario («respuesta honesta: no lo sé con certeza, y nadie lo sabe con
> certeza en Colombia») y su regla práctica ya es «no apostar la arquitectura a que el borrado criptográfico
> será aceptado». Ver `00-contradicciones-resueltas.md`, contradicción C4.
>
> **La postura del proyecto, que sí es firme:** no existe doctrina publicada de la SIC ni opinión vinculante
> del EDPB que declare el crypto-shredding equivalente a la supresión (Art. 17 RGPD / art. 8 lit. e Ley 1581).
> Es **zona gris**. Por eso, ante una solicitud de supresión **se borra físicamente** el registro del PII Vault
> (`DELETE` real + `VACUUM FULL`), y el borrado criptográfico se reserva a **backups y réplicas**, donde el
> borrado físico es imposible. Así la defensa jurídica no depende de una interpretación no respaldada:
> depende de un hecho verificable. Al titular se le declara la ventana de expiración de copias, no un borrado
> instantáneo. Ver `docs/adr/0009-borrado-fisico-en-el-pii-vault.md`.

## 1.4 Commitments y el ataque de diccionario con 300 estudiantes

> **Corregido por resolución R2 del arquitecto:** esta sección razonaba sobre **cómo endurecer** un
> commitment de un identificador personal para poder publicarlo. Esa pregunta ya no se hace: al
> Governance Ledger **no entra ningún hash, commitment ni derivación de un identificador personal**,
> con o sin sal, con o sin pepper, con o sin función lenta. El ataque de diccionario sobre un espacio
> de ~300 personas desaparece **por construcción, no por dificultad computacional**. Todo lo que sigue
> conserva su valor **dentro del PII Vault** —donde el commitment sí es útil para búsquedas, para
> detectar altas duplicadas y para el índice de correo—, y como explicación de por qué la construcción
> ingenua es indefendible. Lo que queda anulado es cualquier lectura de esta sección como autorización
> para publicar un identificador endurecido. Ver `docs/adr/0007-prohibicion-de-hashes-de-identificadores-en-el-ledger.md`
> y `docs/adr/0022-argon2id-y-pepper-solo-dentro-del-pii-vault.md`.
>
> *Alcance exacto de la prohibición:* cubre identificadores de la **identidad civil** (documento,
> correo, nombre, teléfono) y cualquier función de ellos. **No** cubre las derivaciones del `MemberId`
> aleatorio ya publicado en el padrón —tickets de sorteo `hmac(semilla, "estrato|memberId")`, pruebas
> de inclusión Merkle—: su preimagen ya es pública y no contiene información personal, así que no hay
> nada que enumerar.

Tentación frecuente: guardar `commit = sha256(nombre)` y decir «es sólo un hash, no hay dato personal».
**Es falso, y con 300 estudiantes es trivialmente falso:** el espacio de entradas no es el de un hash de 256
bits, es la lista pública de estudiantes. El atacante calcula 300 hashes y termina.

**Sal por registro:** obligatoria. Impide precomputar una tabla que sirva para todos los registros y mata las
tablas arcoíris. Pero no impide el ataque: la sal está junto al commitment, así que el atacante prueba los
300 nombres *contra cada registro* y el coste pasa de 300 a 300 × N hashes. Sigue siendo nada.

**Función lenta:** obligatoria también. Propuesta: **Argon2id, m = 64 MiB, t = 3, p = 1**, sal de 128 bits,
salida de 256 —segunda opción del RFC 9106, más conservadora que el mínimo de OWASP (m = 19 MiB, t = 2, p = 1)
y sostenible en el VPS: ~100-150 ms por hash *(verificar por medición real)*.

Y aquí está el punto: 300 candidatos × 150 ms = **45 segundos por registro** en un núcleo, ~6 s en ocho; con
5.000 nombres, ~12 min y ~90 s. **El ataque tiene éxito.** Argon2id compra minutos, no seguridad: contra un
espacio enumerable de tamaño 300 ninguna función lenta con parámetros usables alcanza, porque el mismo coste
que frena al atacante frena al servidor legítimo y el atacante sólo lo paga una vez.

**Conclusión que contradice la premisa habitual:** sal y Argon2id son necesarias pero **no suficientes**. Lo
que sostiene la seguridad es el **pepper**: una clave secreta de 256 bits fuera de la base de datos.

```ts
// El pepper vive en el KMS. JAMÁS en la BD, ni en el repo, ni en el backup de la bóveda.
// Orden correcto: primero endurecer, después aplicar la clave secreta.
export function commitIdentity(nombre: string, saltPorRegistro: Uint8Array): Uint8Array {
  const hardened = argon2id({
    password: utf8(normalizeNFC(nombre.trim().toLowerCase())),
    salt: saltPorRegistro,          // 128 bits, crypto.randomBytes, único por fila
    memoryCost: 64 * 1024,          // KiB → 64 MiB
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
  return hmacSha256(PEPPER_FROM_KMS, hardened);   // sin esta clave el diccionario no arranca
}
```

Con pepper, quien roba **sólo la base de datos** no puede enumerar: le faltan 256 bits. Si además roba el
pepper, Argon2id le impone esos minutos —defensa en profundidad, no defensa principal.

> **Corregido por resolución R2 del arquitecto:** el párrafo terminaba diciendo que «ésta es la razón por
> la que A.0 usó HMAC con clave: fue la elección correcta». **No lo fue.** A.0 quedó anulada por R1, y el
> pepper dejó de ser la línea de defensa del ledger: es la línea de defensa **del PII Vault**. Publicar un
> identificador endurecido nunca fue una opción aceptable; lo que la vuelve inaceptable no es que Argon2id
> compre pocos minutos, sino que el ledger es permanente y el pepper no: basta una filtración futura del
> pepper para reabrir retroactivamente todos los registros ya anclados. Un secreto que debe sobrevivir
> décadas no es un control, es una apuesta.

> **ADR-114 (propuesta):** Commitments con Argon2id + pepper en KMS; prohibido el hash con sal pública —
> **Alcance reducido por R2:** vale **sólo dentro del PII Vault**; ningún commitment de identificador entra
> al ledger. —
> **Decisión:** todo commitment sobre un dato de espacio enumerable **almacenado en la bóveda** usa
> `HMAC(pepper, Argon2id(dato, salt))`
> con m=64 MiB, t=3, p=1 y sal de 128 bits por registro; el pepper nunca entra en la BD, el repo ni un backup. —
> **Alternativas descartadas:** `sha256(dato)` —enumerable en microsegundos; `sha256(salt‖dato)` —en segundos;
> Argon2id sin pepper —en minutos, según el cálculo anterior. —
> **Consecuencias:** rotar el pepper obliga a recalcular los 300 commitments (≈ 45 s, viable); perderlo los
> hace inverificables, así que necesita el respaldo 2-de-3 de la KEK; y **un commitment no es «dato anónimo»**
> para la Ley 1581: es seudónimo y se trata como tal.

## 1.5 Seudonimización retroactiva

Ana propuso «Asamblea permanente los jueves», se aprobó, la comunidad la ejecutó dos años, y hoy Ana ejerce
supresión. Borrar el evento destruiría la historia de una institución; negarla violaría la ley. La salida es
que **el hecho sobreviva y la persona desaparezca**.

Con ADR-110 es casi trivial: `ProposalSubmitted` nunca contuvo «Ana Gómez», contuvo
`actor: MemberId("K7F2…")`. Al ejecutar `shred`, la fila de la bóveda que traducía `K7F2…` deja de existir.
El evento no cambia **ni un byte**: `prevHash` verifica y la raíz Merkle anclada hace dos años sigue válida.
Lo único que cambia es que la interfaz, sin poder resolver el `MemberId`, muestra una etiqueta estable:

```
Propuesta #47 — «Asamblea permanente los jueves»
Autoría: Miembro retirado K7F2 · datos personales suprimidos el 14/03/2027
```

El seudónimo se deriva del `MemberId` (ya opaco), es estable —dos propuestas de Ana siguen atribuidas al
mismo autor, lo que preserva la coherencia del debate— y no resuelve a ninguna persona. La supresión misma se
registra como acto de gobierno:

```ts
| { readonly type: 'PIIErasureRequested';
    readonly subject: MemberId;
    readonly requestedAt: Instant;
    readonly legalBasis: 'ley-1581-art-8e' | 'revocatoria-consentimiento';
    readonly claimRef: string }                  // radicado, sin PII
| { readonly type: 'PIIErased';
    readonly subject: MemberId;
    readonly executedAt: Instant;
    readonly shredReportHash: Hash;              // el informe vive en la bóveda
    readonly displayPseudonym: string;           // 'Miembro retirado K7F2'
    readonly backupsClearAt: Instant }           // cuándo expira la última copia
```

**Por qué esto NO es reescribir la historia.** Reescribirla sería afirmar que la propuesta #47 no existió,
que la escribió otro, o cambiar su contenido. Nada de eso ocurre: el acto, su fecha, su texto, quién lo votó
y qué se decidió siguen íntegros y verificables contra el ancla externa. Lo que se retira es el **vínculo
entre un acto público y una identidad civil privada** —vínculo que nunca estuvo en el ledger, que vivía sólo
en una tabla de traducción, y cuya permanencia la ley no exige. Es un acta de asamblea: el acuerdo sigue
vigente aunque el archivo de afiliados se depure.

> **ADR-115 (propuesta):** Seudonimización retroactiva con `PIIErasureRequested` / `PIIErased` —
> **Decisión:** la supresión no altera eventos pasados; se registra como dos eventos nuevos y la resolución
> de identidad falla en abierto hacia un seudónimo estable. —
> **Alternativas descartadas:** reescribir `actor` a `'anónimo'` —rompe la cadena de hashes y destruye la
> coherencia del debate (deja de saberse que dos intervenciones eran de la misma persona); ocultar la
> propuesta —expropia a la comunidad de una decisión que ejecutó. —
> **Consecuencias:** la historia gana información en vez de perderla y queda auditable el SLA del Art. 15; un
> observador sabe que *alguien* se borró, dato mínimo sobre esa persona: coste aceptado y declarado.

## 1.6 Regla dura: lo que NUNCA entra al ledger ni al ancla pública

Normativo para el equipo, aplicado por lint sobre los tipos de payload y por test de CI.

| Prohibido en ledger / ancla | Por qué | Dónde va |
|---|---|---|
| Nombre, apellidos, apodo real | Identificación directa | Bóveda, cifrado |
| Correo, **en cualquier forma derivada**: hash, HMAC, Argon2id, con o sin sal o pepper | Enumerable: `nombre.apellido@udea.edu.co`. **R2:** la prohibición ya no depende del endurecimiento | Bóveda |
| Documento, nombre o teléfono en cualquier forma derivada (hash, HMAC, commitment) | **R2:** ningún derivado de un identificador personal entra al ledger | Bóveda |
| Documento de identidad | Identificación fuerte | Bóveda |
| IP, user-agent | Dato personal; geolocaliza y correlaciona | `consent_logs`, bóveda |
| Foto o avatar | Biométrico potencial | Object storage cifrado |
| Teléfono | Identificación directa | Bóveda |
| Programa + semestre juntos | Cuasi-identificador: reduce a 1-3 personas en 300 | Bóveda; en ledger sólo agregados con k ≥ 10 |
| Texto libre de comentarios | Estilometría: el autor es identificable por su escritura | Bóveda; hash en ledger |
| Hora exacta de un voto secreto | Correlación por timing (§2.6) | Truncado y en lote |
| `actor` en un `BallotCast` secreto | El sobre delata al votante | `actor: 'system'` |
| Cualquier ciphertext de PII | Sigue siendo dato personal; ata el ledger a la clave | Bóveda |
| Claves, wrapped keys, pepper, sales | Obvio, y sin embargo pasa | Keystore |
| Motivo textual de un reclamo | Suele contener PII y datos sensibles | Bóveda; en ledger sólo el radicado |

> **ADR-116 (propuesta):** Lista de prohibiciones aplicada por CI —
> **Decisión:** se prohíben por lint esos nombres de campo en todo tipo alcanzable desde
> `DecisionEventPayload`, y un test de propiedad genera eventos y falla si el payload serializado contiene un
> patrón de correo, cédula o IP. —
> **Alternativas descartadas:** revisión humana en code review —falla exactamente el día que hay prisa. —
> **Consecuencias:** falsos positivos ocasionales (un campo `nombre` de una *opción de votación* es legítimo);
> se resuelven con lista de excepciones comentada, nunca con `// eslint-disable`.

---

# PARTE 2 — VOTO SECRETO VERIFICABLE

## 2.1 Requisitos sin ambigüedad

| # | Requisito | Nombre técnico |
|---|---|---|
| R1 | Sólo quien está en el padrón congelado puede votar | Elegibilidad |
| R2 | Como máximo un voto contado por persona | Unicidad |
| R3 | Nadie puede saber cómo votó una persona concreta | Secreto |
| R4 | Puedo comprobar que **mi** voto está y como lo emití | Verificabilidad individual |
| R5 | Cualquiera puede comprobar que el conteo es correcto | Verificabilidad universal |
| R6 | El administrador no puede alterar votos sin que se detecte | Resistencia a manipulación administrativa |
| R7 | Nadie puede *probarle a un tercero* cómo votó | Ausencia de recibo / resistencia a coerción |

R7 es de otra categoría: casi ningún sistema de voto por internet lo cumple, y es el que más se promete a la
ligera.

## 2.2 Helios vs Belenios — comparación honesta

| | **Helios** (Ben Adida, USENIX Sec. 2008) | **Belenios** (INRIA / Loria) |
|---|---|---|
| Criptografía | ElGamal exponencial, conteo homomórfico, pruebas disyuntivas de papeleta bien formada, Chaum-Pedersen de descifrado *(verificar: v1 usó mixnet)* | Igual base + **firma de la papeleta** con credencial del votante |
| R1 Elegibilidad | Impuesta por el servidor de registro | **Verificable**: credenciales emitidas por una autoridad distinta del registro |
| R2 Unicidad | Sí | Sí, por credencial |
| R3 Secreto | Sí, con umbral de custodios | Sí, con umbral de custodios |
| R4 Individual | **Benaloh challenge** (cast-or-audit) + hash de la papeleta en urna pública | Ídem, con *smart ballot tracker* |
| R5 Universal | Pruebas ZK verificables por cualquiera | Ídem |
| R6 Anti-admin | **Débil: el servidor puede emitir votos por los abstencionistas** y nadie reclama, porque quien no votó no revisa la urna | **Fuerte:** stuffing exige que registro **y** autoridad de credenciales sean deshonestos a la vez |
| R7 Coerción | **NO.** El paper lo declara y acota el uso a elecciones de **bajo riesgo de coerción** (clubes, sociedades científicas, gobierno estudiantil) | **NO** en la versión base: el votante puede probar su voto |
| Variantes | — | **BeleniosRF** (receipt-freeness por re-aleatorización), **BeleniosVS**; **no asumirlas disponibles** *(verificar)* |
| Stack / licencia | Django/Python, Apache 2.0 *(verificar)* | OCaml, licencia libre tipo AGPL *(verificar)* |
| Servicio aparte | Sí; API limitada, es aplicación completa | Sí: hospedado en `belenios.loria.fr` o self-hosted |
| Madurez | Años de despliegue; la IACR lo usa para su junta | Miles de elecciones; auditoría académica continua |
| Coste de integración | Medio | Medio-alto, necesariamente **federado** |

El **Benaloh challenge** merece explicación porque es la pieza que da *cast-as-intended*: tras cifrar tu voto
podés «auditar» —el sistema revela la aleatoriedad y comprobás con una herramienta independiente que cifró lo
que elegiste— o «emitir». Como el cliente no sabe de antemano qué elegirás, uno tramposo es detectado con
probabilidad creciente. La diferencia decisiva para Koinonía está en R6: la **integración es federada**
—Koinonía crea la elección, delega el acto de votar e importa la urna y las pruebas—; ninguno de los dos es
una biblioteca que se importe. Nota de licencia: AGPL sobre un servicio hospedado obliga a publicar
modificaciones, algo alineado con Koinonía pero que hay que decidir a conciencia.

> **ADR-124 (propuesta):** Belenios como destino de la etapa 2, no Helios —
> **Decisión:** si Koinonía adopta criptografía de urna, el objetivo es Belenios desplegado como servicio
> aparte. —
> **Alternativas descartadas:** Helios —no resuelve el ballot stuffing por el servidor, que es precisamente
> el riesgo cuando el VPS lo administra un voluntario; implementación propia de ElGamal en TypeScript
> —irresponsable: la criptografía de elecciones se ataca durante años antes de ser confiable. —
> **Consecuencias:** dependencia de un stack OCaml ajeno al proyecto; a cambio, verificabilidad de
> elegibilidad real y auditoría académica externa que Koinonía nunca podría costear.

## 2.3 El problema del trustee (custodios de clave)

Con urna cifrada, el secreto depende de que la clave privada **nunca se reconstruya en un solo lugar**. Se
reparte con Shamir k-de-n y al cierre cada custodio aporta un descifrado parcial. Si uno solo tuviera la
clave completa, podría abrir la urna a mitad de la votación.

**Quiénes son los custodios en un instituto de 300 personas.** No cinco amigos del administrador, ni cinco
del mismo grupo político, ni cinco que se gradúen el mismo semestre. Propuesta **n = 5, k = 3** con perfiles
estructuralmente enfrentados: (1) un representante estudiantil electo del año en curso; (2) un representante
de la corriente que **perdió** la última elección; (3) un profesor no directivo; (4) alguien del personal
administrativo; (5) el administrador del VPS —que aporta capacidad técnica pero **nunca** llega a 3 solo.
Con k = 2 la colusión sería fácil; con k = 4 la elección se bloquea en el primer viaje de campo.

**Ceremonia de generación**, ~40 minutos, presencial, con acta firmada y video:

1. **Convocatoria** 7 días antes: se publica `TrusteeCeremonyScheduled` con fecha, lugar y los cinco nombres;
   cualquier miembro puede asistir como observador.
2. **Preparación:** portátil sin red, arrancado desde un USB en vivo verificado por hash por dos personas
   distintas; cinco USB nuevos, sellados, abiertos delante de todos.
3. **Generación y entrega:** se generan la clave y las cinco partes; los cinco leen en voz alta la huella de
   la clave pública y confirman que coincide. Cada custodio recibe su USB y una frase de paso de seis palabras
   sacada al azar de una lista Diceware impresa —**no la inventa**, la gente inventa frases malas—, que
   escribe a mano y guarda aparte.
4. **Prueba de recuperación inmediata:** *antes* de terminar se ensaya una reconstrucción con tres custodios
   sobre una **elección de juguete**. Si no funciona ahí, no va a funcionar en octubre.
5. **Cierre:** se destruye el USB de arranque ante los presentes y se publica
   `TrusteeSetEstablished { publicKeyFingerprint, trusteeIds, k, n, actaHash }`.

**Cuando un custodio se gradúa** —escenario normal, no excepción—: **rotación anual obligatoria** en la
primera semana del semestre, haya o no bajas, porque una ceremonia que sólo se hace en emergencias es una que
nadie sabe ejecutar. La sustitución es por **re-reparto** (juntar k = 3 y generar cinco partes nuevas),
**nunca** entregando la parte del que se fue: una parte copiada no se des-copia, y el re-reparto invalida la
anterior porque cambia el polinomio. Si se pierden 3 partes, la urna de una elección abierta **es
irrecuperable**: se anula y se repite, y eso va en el reglamento *antes*, no improvisado después.

> **ADR-125 (propuesta):** Custodios 3-de-5 con perfiles enfrentados, rotación anual y re-reparto —
> **Decisión:** n=5, k=3, composición obligatoriamente heterogénea, ceremonia presencial documentada,
> rotación anual, sustitución por re-reparto, anulación declarada si se pierden 3 partes. —
> **Alternativas descartadas:** clave única en el servidor —anula el secreto; clave de rescate del admin
> —lo vuelve el punto único de fallo político del Instituto; implementar Shamir a mano en TypeScript —las
> bibliotecas JS varían mucho en calidad, pocas son de tiempo constante y casi ninguna autentica las partes,
> así que un custodio puede entregar una parte falsa sin ser detectado (eso resuelve el *secret sharing
> verificable* de Feldman/Pedersen). Se usa el modo de umbral que ya trae Belenios. —
> **Consecuencias:** la elección depende de que 3 personas aparezcan el día del escrutinio; hay que agendar
> el cierre con esa restricción.

## 2.4 Recomendación pragmática por etapas

**Para el MVP no debemos implementar criptografía de urna.** No por pereza: un sistema cifrado mal integrado,
con custodios que no entienden su rol y un escrutinio que nadie sabe verificar, ofrece *menos* garantías
reales que un esquema simple bien explicado —y ofrece la ilusión de ofrecer más, que es peor.

### Etapa 1 (MVP) — voto seudónimo con recibo

**(a) Separación física de tablas.** Dos tablas sin ninguna clave foránea entre ellas, en esquemas distintos
con permisos distintos:

```sql
-- Esquema 'roll': quién votó. NO contiene el voto.
CREATE TABLE roll.voter_marks (
  decision_id uuid NOT NULL,
  member_id   text NOT NULL,                 -- seudónimo opaco (ADR-111)
  voted_on    date NOT NULL,                 -- SÓLO fecha, jamás hora
  PRIMARY KEY (decision_id, member_id)       -- garantiza R2
);

-- Esquema 'urn': qué se votó. NO contiene al votante.
CREATE TABLE urn.ballots (
  decision_id uuid  NOT NULL,
  tracker     text  NOT NULL,                -- recibo, p. ej. 'K7F2-9QMX-3B'
  choice      jsonb NOT NULL,                -- papeleta canonicalizada (JCS, RFC 8785)
  batch_seq   int   NOT NULL,                -- lote, NO orden de llegada
  PRIMARY KEY (decision_id, tracker)
);
-- Prohibido por lint: cualquier FK, columna común adicional, índice compuesto
-- entre esquemas, o columna temporal con hora en urn.ballots.
```

La unicidad (R2) la da la clave primaria de `roll.voter_marks`, **no** una relación con la papeleta. La
elegibilidad (R1) se comprueba contra el padrón congelado al admitir, sin dejar rastro en la urna.

**(b) Recibo / tracker.** El navegador genera 160 bits aleatorios y deriva un código legible de 10 caracteres
en base32 agrupado (`K7F2-9QMX-3B`) que envía con la papeleta; el servidor rechaza colisiones. Al cerrar se
publica la tabla `(tracker, choice)`: el votante busca su código y ve su voto (R4), y cualquiera suma
`choice` y verifica el resultado (R5). Nadie liga el tracker a una persona **salvo la persona misma** —lo que
significa que también sirve para que alguien le exija mostrarlo.

**(c) Firma y anclaje.** Al cerrar se construye un árbol de Merkle sobre las papeletas ordenadas por
`tracker`, se emite `TallySigned { urnRoot, rollRoot, resultHash, censusSize, ballotCount }` firmado con la
clave de la instancia, y `urnRoot` entra en la raíz Merkle diaria anclada externamente. Después del anclaje,
cambiar un voto exige romper SHA-256 o falsificar el ancla. El recibo de inclusión es una prueba Merkle de
~10 hashes, reutilizando el mecanismo de la DECISIÓN C.7.c.

**(d) Declaración explícita en la interfaz** (§2.5).

> **ADR-117 (propuesta):** El MVP no implementa criptografía de urna —
> **Decisión:** etapa 1 = voto seudónimo con tracker, tablas separadas, escrutinio firmado y anclado, y
> declaración visible de garantías. —
> **Alternativas descartadas:** Belenios desde el día uno —el coste de integración y de operación de
> custodios excede la capacidad del equipo y retrasa el MVP meses; criptografía propia —irresponsable. —
> **Consecuencias:** **el administrador del servidor puede, en principio, ver quién votó qué**, porque tiene
> acceso a ambas tablas. El esquema descansa en controles no criptográficos y en la confianza en esa persona.
> Eso va en la interfaz, no escondido en un README.

> **ADR-118 (propuesta):** Prohibición estructural de vincular padrón y urna —
> **Decisión:** esquemas separados, sin FK, sin columnas comunes más allá de `decision_id`, roles de base de
> datos distintos, y test de CI que analiza el SQL emitido para impedir cualquier JOIN entre ambos. —
> **Alternativas descartadas:** una sola tabla con la columna del votante «anulada» al cerrar —el WAL y los
> backups conservan el valor anterior. —
> **Consecuencias:** no se puede ofrecer «cambiá tu voto» sin un mecanismo explícito basado en el tracker.

### Etapa 2 — migración a Belenios sin romper el historial

La clave es que **el historial no necesita re-verificarse con la criptografía nueva**. Cada decisión registra
al abrirse qué backend la produjo y qué garantizaba:

```ts
| { readonly type: 'VotingBackendDeclared';
    readonly kind: VotingBackendKind;
    readonly version: string;
    readonly guaranteesHash: Hash;   // hash(jcs(GuaranteeMatrix)) — congela la promesa hecha
    readonly paramsHash: Hash }
```

Una decisión de 2026 se verifica con el verificador de la etapa 1 archivado y versionado; una de 2028, con el
de Belenios. El ledger es común, la cadena de hashes continua, y la interfaz muestra en cada decisión
histórica **la declaración vigente en su momento**, lo que impide el fraude retórico de decir «siempre
tuvimos voto secreto verificable».

```ts
export type VotingBackendKind = 'pseudonymous-tracker' | 'belenios';

/** Lo que el backend promete. Se sella en el ledger y ALIMENTA EL TEXTO DE LA UI. */
export interface GuaranteeMatrix {
  readonly eligibility: 'enforced-by-server' | 'cryptographically-verifiable';
  readonly uniqueness: 'db-constraint' | 'credential-signature';
  readonly secrecyFrom: readonly ('other-voters' | 'other-members' | 'server-admin')[];
  readonly individualVerifiability: 'tracker-lookup' | 'encrypted-ballot-hash';
  readonly universalVerifiability: 'public-plaintext-tally' | 'zk-proofs';
  readonly adminTamperEvidence: 'anchored-signed-tally' | 'anchored-signed-tally+ballot-signatures';
  readonly coercionResistance: false;         // literal: ningún backend soportado lo ofrece
  readonly receiptFreeness: false;
}

export interface VotingBackend {
  readonly kind: VotingBackendKind;
  readonly version: string;
  readonly guarantees: GuaranteeMatrix;

  openElection(spec: ElectionSpec): Promise<ElectionHandle>;
  /** Etapa 1: no-op. Etapa 2: genera y entrega credenciales fuera de banda. */
  issueCredentials(h: ElectionHandle, roll: readonly MemberId[]): Promise<CredentialIssuance>;
  /** `auth` demuestra elegibilidad; el backend NO debe persistir el vínculo auth↔ballot. */
  castBallot(h: ElectionHandle, auth: VoterAuth, ballot: BallotPayload): Promise<CastReceipt>;
  closeElection(h: ElectionHandle): Promise<SealedUrn>;
  tally(urn: SealedUrn, trustee: TrusteeInput): Promise<TallyEvidence>;
  /** Ejecutable por un tercero con sólo los artefactos públicos. */
  verify(evidence: TallyEvidence): Promise<VerificationReport>;
}

export interface CastReceipt {
  readonly kind: VotingBackendKind;
  /** Etapa 1: el tracker. Etapa 2: el hash de la papeleta cifrada. */
  readonly locator: string;
  readonly inclusionProof: MerkleProof | null;   // null hasta el cierre
  readonly humanText: string;                    // qué hacer con esto, en castellano llano
}

export interface TallyEvidence {
  readonly urnRoot: Hash;
  readonly rollRoot: Hash;
  readonly resultHash: Hash;
  readonly signature: Signature;
  readonly anchor: ExternalAnchorRef | null;
  readonly zkProofs: readonly Uint8Array[] | null;   // sólo Belenios
}
```

> **ADR-123 (propuesta):** `VotingBackend` con `GuaranteeMatrix` como dato de primera clase —
> **Decisión:** ambos backends implementan la misma interfaz y **declaran sus garantías como estructura de
> datos**, que se sella en el ledger y de la que se deriva el texto mostrado al usuario. —
> **Alternativas descartadas:** texto de garantías escrito a mano en la plantilla —se desincroniza del
> backend real en la primera refactorización, y ahí nace la mentira. —
> **Consecuencias:** cambiar una garantía obliga a cambiar código y queda en el diff; `coercionResistance`
> está tipado como `false` literal, así que **el compilador impide** ponerlo en `true` sin cambiar el tipo y
> sostener esa afirmación ante revisión.

## 2.5 Declaración de garantías — texto literal para la interfaz

Pantalla completa antes del primer voto de cada elección, con un botón «Entiendo» que no se habilita durante
5 segundos, y enlace permanente junto a la urna. Sin jerga, conforme a la DECISIÓN 0.A.

> ### Antes de votar, leé esto
>
> **Qué sí te garantiza esta votación**
>
> - **Sólo vota quien puede votar.** La lista de quiénes podían votar se cerró antes de abrir la votación y
>   está publicada. Nadie fue agregado después.
> - **Una persona, un voto.** El sistema no acepta un segundo voto tuyo.
> - **Podés comprobar que tu voto está y que dice lo que elegiste.** Al votar recibís un código, por ejemplo
>   `K7F2-9QMX-3B`. Cuando la votación cierre se publica la lista completa de votos con sus códigos, sin
>   nombres. Buscá el tuyo y vas a ver tu voto tal como lo emitiste.
> - **Cualquiera puede recontar.** La lista de votos es pública. Vos, o cualquier persona, puede sumarla a
>   mano y compararla con el resultado anunciado.
> - **El resultado queda sellado.** Al cerrar, el conteo se firma y su huella digital se publica fuera de
>   este servidor. Si alguien cambiara un voto después, la huella dejaría de coincidir y se notaría.
> - **Tu nombre no está en la lista de votos.** Sólo está tu código, que nadie más conoce.
>
> **Qué NO te garantiza**
>
> - **No te protege si alguien te presiona.** Tu código sirve para que compruebes tu voto, pero también sirve
>   para que alguien te exija mostrarlo. Si alguien te obliga a enseñarle cómo votaste, este sistema no puede
>   impedirlo. **No le muestres tu código a nadie.**
> - **Quien administra el servidor podría, técnicamente, ver quién votó qué.** Guardamos «quién votó» y «qué
>   se votó» en lugares separados y tomamos medidas para que no se puedan cruzar, pero esas medidas son
>   organizativas, no matemáticas. Hoy dependemos de que esa persona sea honesta. La próxima versión del
>   sistema eliminará esa confianza.
> - **No te protege de un computador o teléfono infectado.** Si tu dispositivo tiene un programa malicioso,
>   puede cambiar tu voto antes de enviarlo o espiar lo que elegiste.
> - **No podés comprobar que la página que estás usando es la correcta.** El programa que corre en tu
>   navegador lo entrega este mismo servidor. Si alguien lo alterara, no lo verías.
> - **No impide que alguien apague el servidor** el día de la votación.
>
> **En resumen:** esta votación es **verificable** —podés comprobar el resultado— y es **secreta frente a
> otros estudiantes**, pero **no** frente a quien administra el servidor, y **no** te protege de que alguien
> te presione para que muestres tu voto. Si el tema que se vota es delicado y creés que alguien podría
> presionarte, decilo en la asamblea: hay temas que deben votarse en papel.

> **ADR-122 (propuesta):** Declaración de garantías obligatoria, generada desde `GuaranteeMatrix` —
> **Decisión:** ninguna elección puede abrirse sin declaración visible; el texto se deriva de la matriz del
> backend y se sella en el ledger junto con la elección. —
> **Alternativas descartadas:** enlace a términos y condiciones —nadie los lee y no informa nada. —
> **Consecuencias:** fricción deliberada al votar; a cambio la comunidad decide con información real si un
> tema debe votarse en la plataforma o en papel. Esa decisión es política y le corresponde a ella.

## 2.6 Ataques concretos y mitigaciones

**(1) Doble voto.** Clave primaria `(decision_id, member_id)`, insertada en la misma transacción que la
papeleta; un duplicado aborta todo. *Residual:* si el admin borra la marca se vota dos veces, pero se detecta
porque `ballotCount > |marcas|` y ambos números están anclados.

**(2) Voto por inelegible.** El padrón se congela en `Draft → Open` (DECISIÓN A.1) y su raíz se publica; se
comprueba pertenencia antes de admitir. *Residual:* el servidor podría admitir a alguien fuera del padrón, y
se detecta porque su `member_id` no está en el padrón anclado.

**(3) Sustitución de papeleta por el servidor.** En la etapa 1 sólo hay evidencia: si el servidor cambia tu
voto **vos lo ves** al buscar tu tracker, y podés probar la discrepancia si guardaste el recibo. Es detección,
no prevención, y depende de que la gente revise. Se mitiga de verdad en la etapa 2 con papeletas firmadas.

**(4) Correlación por timing.** Si el padrón dice «Ana votó a las 14:32:07» y hay una papeleta insertada a
las 14:32:07, están ligadas: **con 300 votantes repartidos en días, la hora exacta es casi un identificador
único**. No hay parámetros canónicos publicados; se derivan del tamaño del electorado. Tres capas:

- **Truncado:** `roll.voter_marks.voted_on` es `date`, **sin hora**; `urn.ballots` **no tiene ninguna columna
  temporal**. El escrutinio no necesita saber cuándo llegó cada voto.
- **Lotes:** las papeletas se retienen en un búfer y se sellan al acumular **k = 15 papeletas** o al pasar
  **60 minutos**, lo que ocurra primero; **ningún lote sale con menos de 5** salvo el último, que se fusiona
  con el anterior si quedaría por debajo. Con k = 15 el conjunto de anonimato es de 15 personas: compromiso
  razonable para 300 votantes en 7 días.
- **Retardo aleatorio:** cada papeleta espera un tiempo uniforme en **[0, 15 min]** antes de ser elegible para
  un lote, para que el orden interno no refleje el de llegada aunque el lote se llene rápido.
- **En el sobre del evento:** `BallotBatchSealed` lleva `actor: 'system'` y un `occurredAt` igual al sellado
  del lote, **nunca** el del voto individual. Es crítico: `EventEnvelope.hash` incluye `occurredAt` y `actor`,
  así que una hora exacta o un `MemberId` ahí quedarían sellados para siempre.

*Límite honesto:* si sólo votan 4 personas, ningún lote las anonimiza. La interfaz debe **advertir** cuando la
participación hace que el secreto sea nominal, y permitir anular por participación insuficiente.

> **ADR-119 (propuesta):** Sin timestamps en la urna; lotes k=15/60 min con retardo [0,15 min] —
> **Decisión:** la urna no almacena tiempo, el padrón sólo fecha, las papeletas se sellan en lotes con mínimo
> de 5, y `BallotCast` secreto lleva `actor: 'system'`. —
> **Alternativas descartadas:** truncar a la hora en punto —con ~1,8 votos/hora deja conjuntos de anonimato de
> 2, inútil; guardar la hora «sólo para depurar» —los datos de depuración se filtran. —
> **Consecuencias:** el votante no ve su voto reflejado al instante (hasta 75 min); hay que explicarlo en la
> interfaz como característica, no como lentitud.

**(5) Correlación por orden de inserción.** Sin timestamps, el orden físico de las filas (`ctid`, secuencias,
el orden natural de un `SELECT *`) todavía reproduce el de llegada, correlacionable con las marcas del padrón.
Mitigación: el escrutinio publicado se ordena canónicamente **por `tracker`**, no por inserción, y el orden
dentro de cada lote se baraja con Fisher-Yates sembrado por la semilla compuesta `commit-reveal` de la
DECISIÓN B.0.c (`seedAdmin` comprometido antes + faro externo posterior). Así el barajado es **determinista y
verificable por un tercero**, no un `Math.random()` que habría que creerle al servidor.

> **ADR-120 (propuesta):** Barajado verificable del escrutinio con la semilla compuesta de B.0.c —
> **Decisión:** orden publicado = `sort(tracker)`; el orden dentro de cada lote se permuta con Fisher-Yates
> sembrado por la semilla ya revelada en `SeedRevealed`. —
> **Alternativas descartadas:** `ORDER BY random()` —no reproducible, un auditor no puede recomputarlo;
> confiar en el orden de la tabla —es el canal lateral que queremos cerrar. —
> **Consecuencias:** reutiliza un mecanismo ya especificado; el auditor independiente puede reconstruir el
> escrutinio publicado bit a bit.

**(6) El administrador que añade votos.** Tres controles: el **padrón congelado y anclado** fija el máximo
(`ballotCount ≤ censusSize`, verificable por cualquiera); el **conteo de marcas anclado** debe coincidir con
el número de papeletas; y en la etapa 2 la **firma de credencial** hace que fabricar una papeleta exija la
clave privada del votante. En la etapa 1 el control es **detección**, no prevención: dicho de frente, un
administrador que añade un voto por alguien que no votó **puede lograrlo** si el total sigue bajo el padrón y
esa persona nunca revisa. Es el agujero que Belenios cierra y la razón principal para migrar.

> **ADR-121 (propuesta):** Anclaje del padrón, del conteo de marcas y del escrutinio como triple contador —
> **Decisión:** se anclan `rollRoot`, `|marcas|`, `urnRoot` y `ballotCount`; cualquier discrepancia dispara
> `DecisionAnnulled` automático por inconsistencia, igual que la DECISIÓN A.8. —
> **Alternativas descartadas:** anclar sólo el resultado —permite cuadrar los libros antes de anclar. —
> **Consecuencias:** el anclaje debe ocurrir **antes** de publicar el resultado, o el control no vale nada.

---

## Lo que este diseño NO garantiza

Si algo de esta lista es inaceptable para una votación concreta, esa votación **no debe hacerse en Koinonía**,
y el reglamento del Instituto debe permitir el papel.

1. **No hay resistencia a coerción. En ninguna etapa** —ni la 1 ni Belenios base. Si alguien te mira votar o
   te exige el código después, el sistema no puede hacer nada: el recibo que da verificabilidad individual es
   literalmente el mismo objeto que sirve para probarle a un coaccionador cómo votaste. Tensión conocida y no
   resuelta en el estado del arte para voto remoto.

2. **No hay defensa contra el dispositivo del votante comprometido.** Un teléfono con malware puede mostrarte
   «voté A» y enviar B. El Benaloh challenge de la etapa 2 lo detecta *probabilísticamente* y sólo si el
   votante audita —y casi nadie audita.

3. **En el MVP, el administrador del servidor puede violar el secreto del voto.** Tiene acceso a las dos
   tablas. La separación de esquemas, la ausencia de timestamps y los lotes elevan el coste y dejan rastro,
   pero **no lo impiden matemáticamente**. Es una persona de confianza necesaria, y nombrarla públicamente es
   parte del diseño.

4. **Nadie puede verificar el JavaScript que sirve el propio servidor.** Aunque el código publicado sea
   perfecto, el servidor podría entregar otro el día de la votación, o sólo a algunos votantes. SRI y
   compilaciones reproducibles ayudan a quien sabe mirar; para 300 estudiantes de filosofía, no. Vale igual
   para Helios y Belenios: es el talón de Aquiles de **todo** voto por internet basado en navegador, y ninguna
   propiedad criptográfica de este documento lo repara.

5. **No hay defensa contra la negación de servicio.** Quien controla el servidor puede apagarlo en las últimas
   horas, cuando vota la mitad de la gente. La prórroga por quórum (A.11) mitiga el daño; no impide el ataque.

6. **El crypto-shredding no alcanza a los backups ya tomados.** Hasta 35 días de ventana en que los datos son
   recuperables por quien tenga el backup **y** la clave maestra. Se declara al titular; no se disimula.

7. **Un `MemberId` no es un dato anónimo, es seudónimo.** Mientras exista la bóveda es reversible; y aun sin
   ella, un patrón de participación peculiar entre 300 personas puede re-identificar por inferencia. Bajo la
   Ley 1581 sigue siendo tratamiento de datos personales con todas sus obligaciones.

8. **La ceremonia de custodios depende de que humanos hagan bien una tarea aburrida una vez al año.** Es el
   eslabón más débil de la etapa 2 y no tiene solución técnica: se mitiga con guion, ensayo y observadores;
   se rompe con una ceremonia hecha con prisa antes de un parcial.

9. **Nada de esto sustituye la deliberación.** Un sistema verificable garantiza que se contó lo que se emitió.
   No garantiza que la pregunta fuera justa, que la gente estuviera informada, ni que el resultado sea
   legítimo. Eso lo decide la asamblea, no el software.
