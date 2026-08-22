# Arquitectura de Koinonía

- **Estado:** vigente · **Fecha:** 2026-08-21
- **Precedencia:** este documento **describe**; no decide. Ante un conflicto mandan, por este orden,
  las resoluciones del arquitecto (`research/00-contradicciones-resueltas.md`), los ADR de `adr/`, y
  después las specs. Si algo de aquí contradice un ADR, lo que está mal es esto.
- **Para quién:** alguien que llega al repositorio y necesita saber dónde va cada cosa y qué está
  prohibido, antes de escribir la primera línea.

Koinonía es una plataforma de gobernanza para ~300 personas del Instituto de Filosofía de la
Universidad de Antioquia. Su promesa política es una sola frase: **nada de lo decidido puede alterarse
sin que se detecte**. Toda la arquitectura es consecuencia de sostener esa frase con un VPS que paga
un estudiante voluntario y un equipo que rota cada año.

---

## 1. Mapa del monorepo

Un solo repositorio, espacios de trabajo de pnpm, Node 22 ([ADR-0001](adr/0001-monorepo-typescript-con-dominio-puro.md)).

| Ruta | Qué es | Hace I/O | Depende de |
|---|---|---|---|
| `packages/crypto` | JCS (RFC 8785), SHA-256, cadena de eventos, árbol Merkle RFC 6962, pruebas de inclusión y consistencia | No | **Nadie** |
| `packages/domain` | Modelo de dominio y `DecisionEngine`: quórum, umbrales, métodos de decisión, delegación, sorteo, `Proof` | No | `@koinonia/crypto` |
| `packages/contracts` | Tipos y textos de frontera: DTO, formas de evento, cadenas de interfaz | No | `@koinonia/domain` |
| `packages/anchor` | **Anclaje externo**: `AnchorProvider` y tres implementaciones de clases de independencia distintas (OpenTimestamps sobre Bitcoin, commit firmado en dos forjas, testigos por correo), política de quórum 2-de-3 por clase y eventos del agregado `#anclaje` | No (los envíos son puertos) | `@koinonia/crypto` |
| `packages/verifier-cli` | **Verificador independiente** `@koinonia/verificar`. Ejecutable por npm que comprueba un export autocontenido **sin hablar con nuestro servidor**. Publica `README-VERIFICACION.txt`, que describe el algoritmo completo en prosa | Sólo lee el directorio del export | `@koinonia/crypto`, `@koinonia/anchor` |
| `services/api` | Adaptadores: PostgreSQL, HTTP, correo, KMS, anclaje. **Lo único que hace I/O**. Las migraciones del ledger viven en `services/api/migrations/` —SQL plano numerado— porque el DDL es parte del código que se revisa línea a línea, no del despliegue | Sí | `contracts` |
| `apps/web` | Interfaz. Incluye la pantalla «Verificar integridad», que corre en el navegador | Sí | `contracts` |
| `tests/` | Integración y extremo a extremo, fuera de los paquetes. Corren contra PostgreSQL real (Testcontainers): **cero mocks de la base**, que es justo lo que ocultaría los errores de tipos del §3 | Sí | todo |
| `infra/` | Despliegue y PostgreSQL de desarrollo (`infra/docker/`) | — | — |
| `docs/` | Investigación, ADR, producto, gobernanza, modelo de amenazas | — | — |

`packages/crypto` es la **hoja** del grafo y el artefacto más estable del repositorio: cambiarlo
invalida toda la historia anclada, así que su comportamiento queda congelado. Es la base de lo que se
publica en npm como verificador independiente (`@koinonia/verificar`, en `packages/verifier-cli`), y
por eso no puede arrastrar el motor de decisiones: quien compruebe hashes de 2026 en 2031 no debe
necesitar las reglas de gobernanza vigentes hoy.

La rama `crypto ← anchor ← verifier-cli` está **deliberadamente separada** de
`crypto ← domain ← contracts`. El verificador no conoce las reglas de decisión y no importa nada de
`services/api`: los algoritmos del §6.2 y del §6.4 del ledger están **reimplementados** en él, y que
las dos implementaciones coincidan es parte de la prueba. Si el verificador reutilizara el código del
servidor, sólo comprobaría que el servidor está de acuerdo consigo mismo.

## 2. Dependencias permitidas

```mermaid
graph RL
  crypto["packages/crypto<br/>JCS · SHA-256 · cadena · Merkle<br/><b>cero dependencias</b>"]
  domain["packages/domain<br/>DecisionEngine<br/><b>puro: sin I/O, sin reloj</b>"]
  contracts["packages/contracts<br/>DTO · eventos · textos"]
  anchor["packages/anchor<br/>AnchorProvider · quórum 2-de-3<br/><b>sin red obligatoria</b>"]
  verificar["packages/verifier-cli<br/>@koinonia/verificar<br/><b>no habla con el servidor</b>"]
  api["services/api<br/><b>único con I/O</b>"]
  web["apps/web<br/>interfaz + verificador"]

  domain --> crypto
  contracts --> domain
  anchor --> crypto
  verificar --> anchor
  api --> contracts
  api --> verificar
  web --> contracts

  classDef puro fill:#eef7ee,stroke:#2d6a2d,stroke-width:2px
  classDef io fill:#fdf0e6,stroke:#a2582a,stroke-width:2px
  class crypto,domain,contracts,anchor,verificar puro
  class api,web io
```

El orden es **total y sin ciclos**: `crypto ← {domain ← contracts, anchor ← verifier-cli} ← services/api`.
`services/api` depende de `verifier-cli` **sólo para el formato del export**: el exportador y el
verificador tienen que hablar del mismo fichero, y el contrato lo define quien lo va a leer. La
lógica de verificación no viaja en esa dirección.

> ### Regla de pureza del dominio (obligatoria, verificada en CI)
>
> En `packages/domain` y `packages/crypto` está **prohibido**: acceso a red o disco, `Date.now()`,
> `new Date()`, `Math.random()`, `localeCompare`, variables de entorno, punto flotante en
> comparaciones de umbral, e importar cualquier cosa de `apps/`, `services/` o de un framework.
>
> **El tiempo y la aleatoriedad entran como datos**, nunca como efectos: el instante llega como
> parámetro `Instant` y la aleatoriedad como semilla verificable
> ([ADR-0024](adr/0024-semilla-commit-reveal-con-faro-externo.md)). La consecuencia es que el mismo
> escrutinio, ejecutado por cualquiera, en cualquier máquina, dentro de cinco años, produce el mismo
> hash. Sin eso, la auditoría ciudadana es un eslogan.
>
> Lo verifica `scripts/check-domain-purity.mjs` en cada CI, no una revisión de código. Una violación
> es un fallo de compilación, no una discusión.

## 3. Regla de tipos del ledger — norma de obligado cumplimiento

Esta regla es transversal a todos los esquemas del proyecto y **no admite excepción**. Se descubrió al
implementar `packages/crypto` contra la especificación del ledger, después de que el propio DDL de esa
especificación la violara en cinco columnas
(ver [E1](research/00-contradicciones-resueltas.md#parte-3--errores-detectados-por-la-implementación)).

> ### ⛔ Regla de tipos del ledger
>
> **Ningún valor que forme parte de la preimagen de un hash puede almacenarse en una columna cuyo tipo
> normalice su representación.** Esto proscribe `uuid` (reescribe la forma), `timestamptz` (normaliza
> la zona horaria), `numeric` (normaliza ceros a la derecha) y **muy especialmente `jsonb`, que
> reordena las claves del objeto y destruiría la canonicalización JCS**. El `payload` se almacena como
> `text` o `bytea` con la forma canónica exacta que se hasheó; si además se quiere consultar, se
> guarda una copia derivada en `jsonb` marcada explícitamente como **NO autoritativa**.

**Por qué es tan grave.** El fallo no es una excepción ni una pérdida de datos: es que al releer la
fila, la preimagen ya no es la que se hasheó, el `eventHash` no coincide, y el sistema declara
**«historia alterada» sin que nadie la haya alterado**. Un verificador que grita corrupción cuando no
la hay entrena a la asamblea a ignorarlo, y ahí muere la única garantía que el proyecto ofrece.

**Cómo se aplica en la práctica:**

| Concepto | Tipo obligatorio | Prohibido |
|---|---|---|
| `MemberId`, `aggregateId`, `decisionId` y todo identificador del ledger | `char(32)` + `CHECK (~ '^[0-9a-f]{32}$')` | `uuid`, ULID, UUIDv7 |
| `occurredAt`, `issuedAt` y toda marca temporal hasheada | `char(24)`, RFC 3339 `YYYY-MM-DDTHH:MM:SS.sssZ` | `timestamptz`, `timestamp` |
| `payload`, papeletas canonicalizadas, recibos de anclaje | `text` (bytes JCS exactos) | `jsonb` como columna autoritativa |
| Hashes | `bytea` + `CHECK (octet_length = 32)` | `text` hexadecimal como fuente |
| Cantidades del dominio | enteros o fracciones `{num, den}` como cadena | `numeric`, `float`, `double` |

**La regla es sobre participar del hash, no sobre el tipo.** `request_id` sigue siendo `uuid` y
`recorded_at` sigue siendo `timestamptz`: pertenecen al sobre del evento y no entran a ninguna
preimagen. No es una fobia a los tipos ricos de PostgreSQL.

**Corolarios:** (a) la prueba de admisibilidad es la ida y vuelta —`render(parse(t)) === t`—, no la
lectura; (b) toda copia derivada lleva sufijo `_idx` o vive en el esquema `projection`, y el
verificador nunca la lee; (c) se comprueba en CI contra una lista blanca de tipos por columna; (d) la
regla **sigue al hash, no al esquema**: alcanza también a `urn.ballots` y al `evidence_chain` del PII
Vault. Detalle en [`research/10-ledger-inmutable.md` §1.1-bis](research/10-ledger-inmutable.md).

## 4. El recorrido de un evento: de la petición HTTP al anclaje externo

```mermaid
sequenceDiagram
  autonumber
  participant P as Persona (navegador)
  participant API as services/api
  participant D as packages/domain
  participant C as packages/crypto
  participant PG as PostgreSQL (governance)
  participant CK as Checkpointer
  participant EXT as Anclajes externos

  P->>API: POST /decisiones/:id/voto  (requestId del cliente)
  API->>API: autentica · autoriza en la operación · NFC · valida esquema
  API->>D: comando + Instant + padrón congelado
  D->>D: decide (función pura) → evento propuesto
  D-->>API: CanonicalEvent (sin null, sin flotantes, claves ASCII)
  API->>C: canonicalize(evento) → bytes JCS
  API->>PG: BEGIN · advisory lock · reserva leaf_index denso
  PG-->>API: leafIndex, cabeza esperada del agregado
  API->>C: hashEvent(0x02 ‖ prevHash ‖ JCS)
  C-->>API: eventHash
  API->>PG: INSERT event · CAS sobre aggregate_head · COMMIT
  API-->>P: recibo (eventHash, leafIndex, prevHash, evento canónico)
  Note over CK: cada hora, y forzado al cerrar votación/padrón/objeción
  CK->>PG: toma el mismo advisory lock · lee el corte denso
  CK->>C: merkleRoot(entradas crudas) + headsRoot
  CK->>PG: INSERT checkpoint · evento CheckpointEmitido en la espina
  CK->>EXT: OpenTimestamps · git firmado (2 forjas) · correo a 5 dominios
  EXT-->>CK: recibos → FIRME con quórum 2-de-3 de clases distintas
```

Cuatro cosas que no son negociables en ese recorrido:

1. **La propiedad se comprueba en el dominio, en la misma operación que devuelve el dato**, nunca en
   un `guard` previo. El fallo de autorización dominante no es dar el permiso al rol equivocado: es
   darlo sobre el recurso de otro.
2. **El `leaf_index` es denso**, reservado con `UPDATE … RETURNING` dentro de la transacción, no con
   una secuencia. Una secuencia deja huecos al hacer `ROLLBACK`, y un hueco normal es una coartada
   perfecta para el borrado: «fue un rollback».
3. **Todo agregado nace colgado de la espina dorsal `#ledger`**
   (`00000000000000000000000000000001`), con doble vínculo. Sin eso, borrar un agregado completo no
   rompe ninguna cadena y es indetectable.
4. **La ventana de anclaje es la ventana de alterabilidad.** Lo ocurrido desde la última raíz anclada
   se puede reescribir sin contradecir nada externo. Por eso hay checkpoints forzados al cerrar una
   votación, al congelar un padrón y al cerrar una objeción: son los momentos que alguien querría
   reescribir.

Las proyecciones (`projection.*`) son **derivadas y desechables**: si hay que elegir entre el ledger y
una vista de lectura, gana el ledger siempre. Se borran y se reconstruyen desde `leaf_index = 0`.

### 4.1 De una decisión aprobada a una iniciativa, sin estado intermedio

Desde [ADR-0043](adr/0043-plan-de-ejecucion-congelado-e-iniciativa-atomica.md), una versión nueva de
propuesta compromete también su plan mínimo de ejecución: objetivo, responsabilidad aceptada, fecha de
revisión y criterios observables. `proposalVersionHash` identifica **texto y plan**; cambiar cualquiera
de los dos crea otra versión.

Abrir una decisión es una operación compuesta bajo el mismo cerrojo y transacción: inserta la semilla,
`DecisionDrafted`/`DecisionOpened` y `DecisionLinked`, o no inserta ninguno. El `requestId` queda como
mapeo durable al `decisionId`, de modo que perder la respuesta y reintentar recupera exactamente la
apertura original, sin inventar otra decisión.

El `requestId` no vuelve idempotente a cualquier cosa por el solo hecho de repetirse. El Event Store
compara agregado, tipo, cantidad y preimagen canónica de cada evento con el lote que esa clave ya
selló. Si otra orden usó la misma clave —incluso sobre el mismo agregado— responde conflicto y toda la
transacción retrocede. Esta comparación ocurre tanto bajo el cerrojo como en la carrera de la
restricción única.

El borrador reserva un `plannedInitiativeId` aleatorio y la huella del plan. El replay exige que
borrador y configuración coincidan en propuesta y versión; una mezcla fabricada no llega a ser estado.
Al cerrar con desenlace `approved`, PostgreSQL escribe en un solo commit:

```text
DecisionClosed + ResultComputed + InitiativeCreated
```

La reserva debe estar vacía y la iniciativa candidata debe coincidir en identificador, decisión,
resultado, propuesta, versión, círculo y plan. Cualquier colisión o segundo append fallido revierte
también el cierre. Los demás desenlaces crean cero iniciativas. El verificador repite esas relaciones
sobre un snapshot `REPEATABLE READ, READ ONLY`, incluidas dos reglas negativas: una decisión histórica
sin reserva no puede adquirir ejecución retroactiva y ninguna iniciativa puede apuntar a un resultado
no aprobado. También recompone la relación `Proposal.DecisionLinked ↔ DecisionConfig` en los dos
sentidos: ni una decisión huérfana ni un enlace hacia una decisión inexistente pueden dar verde.

### 4.2 Ratificación, activación y aceptación de trabajo

[ADR-0044](adr/0044-ratificacion-activa-hitos-y-ofertas-de-tarea.md) conserva una segunda frontera
atómica. `InitiativeCreated` es la consecuencia provisional del escrutinio, no permiso para ejecutar.
Cuando ya transcurrió la ventana completa desde la publicación única del resultado, una transacción
escribe:

```text
DecisionRatified + InitiativeActivated(ratificationEventId, ratificationEventHash)
```

La iniciativa apunta al evento de ratificación exacto, no sólo a la decisión. El verificador cruza
ambas historias en los dos sentidos. Una caída, una colisión de clave o una iniciativa ocupada dejan
los dos agregados como estaban.

Después de activar, `MilestonePlanned` y los eventos de tarea continúan en el stream de la iniciativa.
Una oferta no es una asignación: `TaskOffered` guarda destinatario y usa su propio `eventId` como
`offerId`; sólo `TaskAccepted` crea `assigneeId`. Toda respuesta y toda reoferta referencia la oferta
vigente. Eso evita que una petición retardada actúe sobre un ciclo posterior, incluso si el estado
visible volvió a llamarse `ofrecida`.

Las mutaciones se serializan bajo el cerrojo del ledger y releen la cabeza después de adquirirlo.
Las respuestas incluyen también la revisión de tarea observada —el `seq` de su último evento— como
CAS. Entre aceptar, rechazar y pedir reasignación desde la misma revisión hay un solo ganador; una
segunda transición legítima debe leer la revisión producida por la primera. La clave de idempotencia
permanece estable en el cliente hasta recibir éxito inequívoco, por lo que perder una respuesta de red
no duplica hitos, ofertas ni respuestas. Un replay exacto vuelve a comprobar el rol, círculo y
membresía actuales antes de devolver éxito: idempotencia no perpetúa una autorización revocada.

También bloquean y revalidan las filas de identidad necesarias hasta el commit: rol, círculo y retiro
no se toman de una sesión vieja. El directorio de selección vive al otro lado de la frontera PII y
devuelve sólo `MemberId` y alias a miembros autenticados del mismo círculo; el alias nunca entra al
evento. Después de una supresión legítima, el historial demuestra la atribución seudónima y las
transiciones, pero deliberadamente no reconstruye la fila personal borrada.

La ratificación usa un único instante para comprobar esa membresía y para fechar las dos mitades del
commit compuesto; no existe una ventana en la que la consulta considere vigente a una persona pero el
evento quede atribuido después de su retiro.

Un rechazo o una solicitud de reasignación publica únicamente una categoría cerrada no sensible. El
API no admite texto libre en esos eventos. Los plazos capturados en la web se convierten desde hora de
Colombia de forma explícita; el servidor siempre recibe un instante epoch, independiente de la zona
del dispositivo.

### 4.3 Seguimiento, capacidad y entrega

[ADR-0045](adr/0045-seguimiento-capacidad-privada-y-entrega-revisable.md) completa el primer ciclo
operativo sin introducir una tabla mutable de estado. `TaskStarted`, `TaskBlocked`,
`TaskHelpRequested`, `TaskResumed`, `TaskEvidenceAdded`, `TaskDelivered`, `TaskChangesRequested` y
`TaskReviewAccepted` se encadenan en el mismo stream. Cada orden lleva la oferta y revisión que vio;
reanudar y revisar llevan además el `pauseId` o `deliveryId` vigente. El dominio rechaza transiciones
ilegales aunque una ruta nueva olvide hacerlo.

La persona asignada mueve el trabajo; quien asumió el plan revisa la entrega. El administrador
técnico no hereda ninguna de las dos capacidades. Las dependencias tienen que estar completadas antes
de empezar, pedir ayuda o declarar bloqueo pausa la tarea, y una entrega exige evidencia y ausencia
de pausa. Pedir cambios conserva la entrega y vuelve al trabajo; aceptar la revisión hace terminal la
tarea, no la iniciativa.

La capacidad semanal cruza deliberadamente la frontera en una sola operación: el número exacto se
lee cifrado desde `identity`, pero la carga se reconstruye de los hechos de tarea. Bajo el orden de
cerrojos `ledger → identity.member`, aceptar comprueba oferta, actor, revisión y cupo y añade
`TaskAccepted` en el mismo commit. No se escribe un `CapacityChecked`: convertiría una protección
privada en un hecho político permanente. Si los dos esquemas pasan a instancias diferentes, este
commit se sustituye por la saga definida en ADR-0045, no por una doble escritura optimista.

Los eventos de material conservan solamente clases gruesas y un compromiso con nonce. La apertura,
el tipo detectado, el tamaño exacto y la clave de almacenamiento quedan fuera del ledger. Con ello un
verificador autorizado detecta sustitución mientras exista la apertura, pero una supresión puede
destruirla sin reescribir la historia. Las aperturas textuales usan un frame autenticado de longitud
fija: 128 KiB más el tag GCM, de modo que inspeccionar `octet_length(ciphertext)` no revela si la nota
era corta o cercana al máximo. La lectura de capacidad y material usa `FOR SHARE`; sólo crear,
suprimir o cambiar datos asciende a `FOR UPDATE`, evitando deadlocks entre lectores.

La comprobación interna de `/integridad` deriva del ledger el conjunto exacto de aperturas esperadas,
las abre dentro del mismo snapshot y contrasta dueño, propósito, instante, contexto y commitment.
Una fila faltante, huérfana, movida, corrupta o una bóveda indisponible deja esa comprobación en rojo
con códigos y contadores sanitizados. El export público no finge poder abrir material privado: su
verificador independiente sí recomprueba cadenas, anclajes y la unicidad global de `eventId`, incluso
si un administrador retiró el índice SQL antes de insertar hechos ambiguos.

La supresión evita confundir cumplimiento legal con destrucción silenciosa. Cada solicitud crea su
propio agregado `pii_erasure`: seq 0 `PIIErasureRequested` sólo nace desde una sesión propia de diez
minutos o menos; seq 1 `PIIErased` sólo puede consumir ese agregado y deriva de él al sujeto, sin
recibirlo del ejecutor. Bajo el orden `ledger → member`, autentica todas las aperturas, ejecuta el
`DELETE` físico y comprueba las cascadas antes del append final. `/integridad` exige actor propio en
seq 0, enlace por ID y hash exactos en seq 1, conjunto exacto y ausencia de la identidad. Un DELETE
más un tombstone sintácticamente perfecto pero sin solicitud queda rojo. Los eventos contienen sólo
MemberId y eventIds ya públicos, nunca correo, token, texto, nonce, DSK ni ciphertext.

## 5. Separación Governance Ledger / PII Vault

```mermaid
graph TB
  subgraph GOV["Governance Ledger — público, append-only, retención indefinida"]
    EV["governance.event<br/>eventos encadenados"]
    HD["governance.aggregate_head"]
    CP["governance.checkpoint"]
    RO["roll.voter_marks<br/><i>quién votó, sin fecha fina</i>"]
    UR["urn.ballots<br/><i>qué se votó, sin votante</i>"]
  end
  subgraph VAULT["PII Vault — privado, mutable, RLS, borrado físico"]
    PER["persona: nombre, correo,<br/>documento, programa"]
    MAP["mapeo MemberId ↔ persona"]
    CON["consent_logs"]
  end
  subgraph KS["Keystore — tercer almacén"]
    DSK["claves por sujeto (DSK envueltas)"]
  end

  EV -. "único puente:<br/>MemberId (aleatorio, no derivado)" .-> MAP
  RO -x UR
  MAP --> PER
  VAULT -. "destruir la clave<br/>es parte del borrado" .-> KS

  classDef pub fill:#eef7ee,stroke:#2d6a2d
  classDef priv fill:#fdeaea,stroke:#a02c2c
  class EV,HD,CP,RO,UR pub
  class PER,MAP,CON,DSK priv
```

Dos bases lógicas distintas, con roles de base de datos distintos y **sin ninguna clave foránea entre
ellas** ([ADR-0008](adr/0008-separacion-fisica-de-ledger-y-pii-vault.md)). La frontera es una regla
operativa, no una intuición:

> Un dato entra al Governance Ledger **si y sólo si su publicación íntegra a un desconocido no revela
> quién es una persona identificable**, asumiendo que ese desconocido tiene la lista pública de
> estudiantes del Instituto.

El único puente es el `MemberId`: 128 bits aleatorios de CSPRNG, **nunca derivados de ningún dato
personal** ([ADR-0006](adr/0006-memberid-aleatorio-de-128-bits.md)). Resolverlo a una persona exige un
*join* aplicativo contra la bóveda, y **ese join es el único punto donde se aplica RBAC y se registra
auditoría de acceso**. Como el identificador nunca fue función de nada, destruir la fila del vault lo
deja huérfano e irreversible: el borrado es real, no una promesa operativa
([ADR-0009](adr/0009-borrado-fisico-en-el-pii-vault.md)).

Dentro del ledger, la urna y el padrón están además separados entre sí: `roll` y `urn` no comparten
más que `decision_id`, no admiten FK ni índices compuestos, y un test de CI falla ante cualquier JOIN
entre ambos ([ADR-0013](adr/0013-prohibicion-estructural-de-vincular-padron-y-urna.md)). La urna **no
guarda hora**: con 300 votantes, el instante exacto es casi un identificador
([ADR-0014](adr/0014-sin-marcas-temporales-en-la-urna-y-sellado-por-lotes.md)).

**Lo que esto no garantiza** está sin adornos en
[`research/10-ledger-inmutable.md`](research/10-ledger-inmutable.md) y en
[`THREAT_MODEL.md`](THREAT_MODEL.md): la separación es una barrera de arquitectura y de control de
acceso, **no** una garantía criptográfica. Quien tenga acceso a las dos bases correlaciona en una
consulta.

## 6. Puertos y adaptadores

El dominio define **puertos** (interfaces); `services/api` provee **adaptadores**. Un puerto existe
cuando la decisión sobre el proveedor es reversible y queremos que siga siéndolo.

```mermaid
graph LR
  D["packages/domain<br/>puertos"] --- AP["AnchorProvider"] --- A1["ots · git · email · rekor"]
  D --- VB["VotingBackend"] --- A2["pseudonymous-tracker → belenios"]
  D --- IP["IdentityProviderAdapter"] --- A3["magic-link-email"]
  D --- NP["NotificationPort"] --- A4["correo · digest semanal"]
  D --- AI["AIAssistantPort"] --- A5["asistente de redacción"]
  D --- VC["VaultCryptoPort"] --- A6["AES-GCM · DSK envuelta"]
  D -. futuro .- ES["EvidenceStorePort"] -. pendiente .- A7["S3 compatible"]
```

| Puerto | Qué abstrae | Implementaciones | Restricción propia | ADR |
|---|---|---|---|---|
| `AnchorProvider` | Publicar el checkpoint fuera del alcance del administrador | `ots` (Bitcoin), `git` (commit firmado en dos forjas), `correo` (testigos con acuse firmado). `rekor` queda como cuarta clase sin implementar | `verify(receipt, checkpointHash)` funciona **sin red** siempre que sea criptográficamente posible; lo que no se puede cerrar sin un dato externo se devuelve como `ResidualClaim` y **nunca** como `confirmado`. `independenceClass` obliga a quórum entre clases distintas, y `signingKeyOffHost = false` **descuenta** al proveedor | [0016](adr/0016-triple-anclaje-de-padron-marcas-y-escrutinio.md) |
| `VotingBackend` | Cómo se emite y escruta un voto | `pseudonymous-tracker` (MVP), `belenios` (etapa 2) | Al abrir cada elección se sella `guaranteesHash = hash(jcs(GuaranteeMatrix))` en el ledger: **la promesa hecha queda congelada** y no se puede reescribir después | [0011](adr/0011-votingbackend-como-puerto.md), [0018](adr/0018-belenios-como-destino-de-la-etapa-2.md) |
| `IdentityProviderAdapter` | Comprobar que alguien controla un correo `@udea.edu.co` | `magic-link-email` | No se asume ninguna API de la Universidad que no exista; un convenio futuro es un adaptador, no una reescritura | [0012](adr/0012-autenticacion-por-enlace-magico-al-correo-institucional.md) |
| `NotificationPort` | Avisar a una persona | correo, resumen periódico | Sujeto al **presupuesto de atención**: tope duro de notificaciones por persona y semana, y todo tipo de aviso con tasa de acción bajo 5 % se elimina, no se «mejora» | [0040](adr/0040-prohibicion-de-metricas-de-actividad-individual.md) |
| `AIAssistantPort` | Ayuda de redacción: teoría del cambio, resúmenes, detección de duplicados | proveedor externo, sustituible | **Nunca decide, nunca puntúa a personas, nunca escribe en el ledger.** Su salida es una sugerencia editable por quien redacta, y la persona sigue siendo la autora del evento | [0039](adr/0039-prohibicion-de-tokens-voto-ponderado-y-reputacion.md), [0040](adr/0040-prohibicion-de-metricas-de-actividad-individual.md) |
| `VaultCryptoPort` | Cifrado autenticado y envoltura de claves por sujeto | AES-256-GCM con KEK inyectada; KMS futuro | No expone claves a contratos HTTP; intercambiar sujeto, campo o revisión rompe el AAD; sin clave falla cerrado, nunca vuelve a texto claro | [0045](adr/0045-seguimiento-capacidad-privada-y-entrega-revisable.md) |
| `EvidenceStorePort` **futuro** | Bytes de evidencia y su borrado fuera del ledger | **No implementado**; S3-compatible es el destino previsto | Clave aleatoria sin identidad; acceso corto y autorizado; publicación crea otra copia; ninguna URL, filename o metadata privada entra al evento | [0045](adr/0045-seguimiento-capacidad-privada-y-entrega-revisable.md) |

`AnchorProvider` y `VotingBackend` son los dos que llevan la garantía: si alguno se degrada, el
sistema lo **anuncia** en la portada en vez de callarlo. El estado público es `NO ANCLADO` **desde el
primer minuto sin quórum** —no a las 24 h—, porque durante esa ventana la historia reciente es
efectivamente alterable y llamarla «anclada» sería la confianza falsa que este diseño existe para
evitar; a las 24 h sube a alerta visible y a las 72 h las decisiones de ese lapso quedan marcadas como
*pendientes de confirmación de integridad*. Es una consecuencia de gobernanza, y es la única que hace
que alguien repare el problema.

### 6-bis. Anclaje externo y verificación independiente

Es la pieza que sostiene la promesa política del §0, y la única que un administrador con `root` no
puede falsificar. Todo lo demás —cadenas, espina, índice denso, raíces Merkle, pruebas de
consistencia— lo puede **recalcular** si reescribe la historia entera, y el resultado sería
internamente perfecto.

**Política de quórum (código, no documentación: `packages/anchor/src/quorum.ts`).** Un checkpoint es
`FIRME` sólo con **dos clases de independencia distintas** confirmadas. Dos recibos de la misma clase
no son dos testigos: comparten modo de falla. Un anclaje se descuenta con motivo explícito por cinco
razones: `no-confirmado`, `checkpoint-distinto`, `proveedor-repetido`, `clase-repetida` y
`clave-en-el-servidor-verificado`. La última es la que impide que el anclaje sea teatro: si la clave
privada vive en la máquina auditada, quien reescribe la historia firma la versión falsa, así que ese
proveedor **nunca** cuenta. Por eso `SignedGitProvider.submit()` no firma —produce la solicitud para
que la veeduría firme en su equipo— y `signingKeyOffHost` es un campo obligatorio sin valor por
defecto.

**Toda falla de anclaje se escribe en el agregado `#anclaje` del propio ledger.** Ocultarla exige
alterar el ledger, y alterar el ledger es lo que el anclaje detecta. Es circular a propósito: escala
el coste del encubrimiento.

**El export** (`services/api/src/ledger/export.ts`) es un directorio de texto autocontenido:
`manifest.json`, `events.ndjson`, `events.hashes.ndjson`, `heads.json`, `checkpoints.ndjson`,
`proofs/consistency/`, `anchors/`, `confianza.json` y `README-VERIFICACION.txt`. Publica el
`next_leaf_index` del cursor porque **sin él el truncamiento de la cola es indetectable**: al borrar
los últimos *k* eventos no queda ningún hueco y `count(*) = max(leaf_index) + 1` sigue dando verde.
Los `sha256` del manifiesto detectan una descarga corrupta y **nada más**; el informe lo dice con esas
palabras para que el verde del índice no parezca una garantía que no es.

**El verificador** (`npx @koinonia/verificar <ruta>`) comprueba las nueve capas, imprime en castellano
llano —qué se comprobó, qué significa y qué hacer— y devuelve un código de salida por tipo de fallo
(`0` correcto · `1` uso · `2` paquete ilegible · `3` sin anclaje firme · `4` anclaje inválido ·
`5` sellos incoherentes · `6` integridad interna rota). El modo `--explicar` describe en prosa qué
hace cada paso y por qué, para poder usarlo como herramienta pedagógica en una asamblea.

## 7. Stack elegido

| Pieza | Elección | Por qué, en una línea | ADR |
|---|---|---|---|
| Lenguaje y repositorio | TypeScript, monorepo pnpm, Node 22 | Un estudiante de filosofía debe poder leer el motor; si el dominio fuera Rust, el proyecto perdería a sus propios auditores | [0001](adr/0001-monorepo-typescript-con-dominio-puro.md) |
| Persistencia | PostgreSQL, event sourcing, **sin broker** | El estado es función del log; `LISTEN`/`NOTIFY` y una tabla `outbox` bastan a esta escala, y Kafka resuelve un problema que no tenemos a costa de un servicio más que operar a las 3 a.m. | [0002](adr/0002-event-sourcing-sobre-postgresql-sin-broker.md) |
| Función de hash | SHA-256, no BLAKE3 | Está en WebCrypto: el verificador independiente es una página estática sin WASM ni dependencias | [0003](adr/0003-sha-256-sobre-blake3.md) |
| Canonicalización | JCS (RFC 8785), vendorizada | Orden **por unidades de código UTF-16**; una actualización de dependencia que cambie el comportamiento invalidaría toda la historia | [0004](adr/0004-canonicalizacion-jcs-obligatoria.md) |
| Integridad | Cadena por agregado + checkpoint Merkle estilo Certificate Transparency | Verificación parcial barata en un móvil, más un compromiso global anclado fuera | [0005](adr/0005-cadena-de-hashes-por-agregado-y-checkpoint-merkle.md) |
| Aritmética | Enteros y fracciones exactas; sin punto flotante | El resultado es idéntico bit a bit en cualquier máquina; un épsilon de tolerancia es una decisión política disfrazada de constante | [0027](adr/0027-aritmetica-exacta-sin-punto-flotante.md) |
| Autenticación | Enlace mágico al correo institucional | Verificar un dominio de correo no requiere permiso de nadie ni crea corresponsabilidad con la Universidad | [0012](adr/0012-autenticacion-por-enlace-magico-al-correo-institucional.md) |
| Cifrado de PII | AES-256-GCM por sujeto, KEK fuera del servidor de aplicación | La destrucción de la clave es parte del borrado, así que no puede vivir junto a lo que protege | [0022](adr/0022-argon2id-y-pepper-solo-dentro-del-pii-vault.md) |
| Pruebas | Vitest + fast-check (`numRuns ≥ 1000` en el dominio) | Los invariantes se afirman con igualdad exacta, no aproximada; y los generadores incluyen caracteres fuera del BMP a propósito | [0001](adr/0001-monorepo-typescript-con-dominio-puro.md) |
| Licencia | AGPL-3.0-or-later | Si alguien la modifica y la despliega como servicio, las modificaciones vuelven a la comunidad que la usa | — |

---

## 8. Las tres cosas que hay que recordar

1. **La dirección de dependencia y la pureza del dominio no son estilo**: son la condición para que un
   tercero recompute un escrutinio de 2026 en 2031 y obtenga el mismo hash.
2. **La regla de tipos del ledger (§3) es de obligado cumplimiento en todo DDL del repositorio.** Se
   escribió porque la propia especificación del ledger la violaba en cinco columnas y nadie lo vio
   leyendo; lo vio quien la implementó.
3. **Ninguna garantía sobrevive al desinterés.** El anclaje protege la historia, no el servicio; las
   pruebas de consistencia protegen a quien guardó un checkpoint anterior. Si nadie ejecuta el
   verificador independiente, el sistema seguirá calculando hashes impecables mientras la propiedad
   central se degrada a *«no se puede alterar sin que se pueda detectar, si alguien mirara»*, que es
   una frase muy distinta.
