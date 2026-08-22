# ADR-0045: Seguimiento, capacidad privada y entrega revisable

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `PRODUCT.md` §6; `GOVERNANCE.md` §4 y §7;
  `THREAT_MODEL.md` T-11, T-14 y T-28; ADR-0007, ADR-0008, ADR-0009, ADR-0023,
  ADR-0040 y ADR-0044.

## Contexto

ADR-0044 termina cuando una persona acepta una tarea. Eso prueba que la responsabilidad no fue
impuesta, pero todavía no permite reconstruir qué pasó con el trabajo: no hay comienzo explícito,
bloqueo, solicitud de ayuda, evidencia, entrega ni revisión. Tampoco se impide aceptar más carga de
la que la propia persona declaró poder sostener.

Resolverlo con un campo mutable de estado perdería precisamente los cambios que explican el
resultado. Resolver la capacidad con un dato visible al responsable convertiría una protección
contra la sobrecarga en información sobre salud, empleo o cuidados. Y guardar una explicación libre
o el nombre de un archivo en el ledger haría permanente una fuga que el derecho de supresión ya no
podría reparar.

Hay además una tensión documental que debe cerrarse expresamente. T-14, en un documento superior a
los ADR, exige un compromiso vinculante `H(nonce || contenido)` para detectar la sustitución de texto
privado. ADR-0007 contiene una frase más amplia —«la única forma admitida es `H(nonce)`»—, pero a
continuación limita su alcance exacto a identificadores civiles. Este ADR conserva sin excepción la
prohibición para nombre, correo, documento y teléfono, y aplica T-14 únicamente a material no
enumerable cuyo contenido deba quedar ligado a un hecho.

## Decisión

### Máquina de una tarea

La tarea conserva cada transición como un evento del stream de la iniciativa:

```text
ofrecida ─aceptar─▶ aceptada ─comenzar─▶ en curso
                                      ├─declarar bloqueo─▶ bloqueada ─reanudar─┐
                                      ├─pedir ayuda──────▶ en apoyo ─reanudar─┤
                                      └───────────────────────────────────────┤
                                                                             ▼
en curso ─entregar─▶ entregada ─pedir cambios─▶ en curso
                              └─aceptar revisión─▶ completada

en curso | bloqueada | en apoyo ─registrar evidencia─▶ mismo estado

ofrecida | aceptada | en curso | bloqueada | en apoyo
  └─pedir reasignación─▶ reasignación solicitada ─reofrecer─▶ ofrecida
```

Los hechos nuevos son `TaskStarted`, `TaskBlocked`, `TaskHelpRequested`, `TaskResumed`,
`TaskEvidenceAdded`, `TaskDelivered`, `TaskChangesRequested` y `TaskReviewAccepted`.

Reglas duras:

- sólo la persona que aceptó la oferta vigente puede comenzar, pausar, reanudar, aportar evidencia
  o entregar;
- todas las dependencias deben estar `completada` antes de comenzar;
- existe como máximo una pausa vigente y una entrega pendiente de revisión;
- bloquear o pedir ayuda detiene el estado de trabajo; reanudar debe referenciar el `pauseId`
  vigente;
- registrar una evidencia previa o recibida durante el apoyo no reanuda la tarea ni hace correr el
  reloj; entregar sí exige reanudar primero;
- entregar exige al menos una evidencia de esa misma tarea y que no haya pausa vigente;
- quien asumió el plan inicial revisa la entrega como acto operativo dentro de su mandato: puede
  pedir cambios con un código cerrado o aceptar; no heredan esa potestad facilitación ni el
  administrador técnico;
- pedir reasignación revoca en el mismo evento la responsabilidad y cierra cualquier pausa; nunca
  borra comienzos, evidencias ni entregas anteriores;
- `completada` es terminal para esa tarea. No cierra automáticamente el hito ni la iniciativa;
- aceptar, rechazar, iniciar, pausar, aportar evidencia y entregar presentan `offerId` y revisión de
  tarea; reofrecer presenta el `offerId` reemplazado; reanudar añade `pauseId`; revisar presenta
  `deliveryId` y revisión de tarea. Una operación obsoleta falla sin escribir.

El responsable revisor sólo afirma una categoría sobre la evidencia de cumplimiento —verificada,
sin verificar o no aplicable—. No puede sobrescribir la entrega ni declarar que un criterio de toda
la iniciativa se cumplió por el cierre de una sola tarea.

### Capacidad como límite propio, no como instrumento de asignación

Cada persona puede declarar entre 0 y 10 080 minutos disponibles por semana. El dato exacto:

- sólo aparece en las respuestas privadas de `GET /mi/capacidad` y `PUT /mi/capacidad`;
- sólo se modifica mediante `PUT /mi/capacidad`, con revisión CAS;
- nunca entra al ledger, a un directorio, a una oferta, a una métrica ni a un error visible para
  otra persona;
- no puede consultarse pasando un `memberId`: el sujeto siempre sale de la sesión.

La ausencia de declaración cierra la aceptación por defecto. Ofrecer una tarea sigue siendo posible
y no consulta capacidad; así el éxito, el error y el tiempo de una oferta no se vuelven un oráculo.
Al aceptar, la respuesta pública ante falta de cupo sólo dice que la persona debe revisar su propia
capacidad. Las cifras se muestran después en su pantalla privada.

La semana es el intervalo entre lunes 00:00 de Bogotá y el lunes siguiente. En este incremento el
esfuerzo total se carga a la semana de vencimiento; si ya venció, a la semana actual. Es una regla
simple y visible, no una afirmación de que el trabajo se distribuye realmente así. Dividirlo entre
semanas requerirá planificación explícita, no una heurística oculta.

La carga se deriva del ledger: suma el esfuerzo de las tareas no terminales que la persona mantiene
aceptadas en el mismo bucket. No hay una segunda tabla de asignaciones que pueda divergir. A la
escala inicial —aproximadamente 300 estudiantes— se acepta reconstruir esa carga bajo el cerrojo del
ledger; antes de escalar se medirá y, si hace falta, se añadirá una proyección privada reconstruible.

Aceptar y cambiar capacidad usan una sola transacción PostgreSQL y este orden de cerrojos:

1. cerrojo global del ledger;
2. validación de sesión, membresía, oferta y revisión;
3. fila de la propia persona `FOR UPDATE`;
4. lectura y descifrado de capacidad;
5. derivación de carga y append de `TaskAccepted`.

Dos aceptaciones que juntas exceden el límite dejan como máximo una confirmada. Bajar la capacidad
después de aceptar no deshace compromisos: puede mostrar sobrecarga sólo a su titular y bloquea una
aceptación siguiente. Un replay exacto de una aceptación ya confirmada reautoriza la membresía, pero
no vuelve a juzgar el cupo ni duplica carga.

Hoy Governance Ledger y PII Vault son esquemas con roles distintos dentro de la misma instancia, por
lo que la transacción es real. Si se separan físicamente, esta decisión exige una saga idempotente
`pending → append → confirmed`: pendientes y confirmadas consumen cupo; un reconciliador sólo libera
una reserva vencida después de demostrar que el evento no existe. Nunca basta un timeout.

### Cifrado de capacidad

La capacidad se cifra con AES-256-GCM y un nonce nuevo de 96 bits en cada revisión. Una DSK aleatoria
por sujeto cifra el dato y queda envuelta por una KEK inyectada desde fuera de PostgreSQL y del
repositorio. El AAD incluye versión, `MemberId`, tabla, campo y revisión; intercambiar ciphertexts
entre personas o revisiones falla cerrado.

El servicio no tiene fallback a texto claro. En producción no arranca sin una KEK válida. Una
lectura con tag inválido o clave indisponible devuelve indisponibilidad y no añade eventos. Las filas
de capacidad y DSK dependen de la fila mutable de identidad y se eliminan físicamente con ella. El
re-shred de restauraciones y el diario durable de supresiones siguen siendo un gate operativo de
ADR-0009 y ADR-0020; este incremento no declara ese gate terminado.

### Detalles privados y compromisos vinculantes

Bloqueos, pedidos de ayuda y solicitudes de cambios usan categorías públicas cerradas. El detalle
opcional vive cifrado fuera del ledger. Si existe, el evento sólo lleva un compromiso versionado:

```text
SHA-256(UTF8("koinonia:private-material:v1\\0") || nonce128 || JCS({ contexto, contenido }))
```

El contexto incluye como mínimo tipo de hecho, iniciativa, tarea, oferta y visibilidad. Cambiar el
texto, moverlo a otra tarea o volver público lo que era restringido rompe la apertura. El nonce es
aleatorio, vive con el material y se destruye al suprimirlo.

La apertura canónica se guarda dentro de un frame autenticado de 128 KiB; con el tag GCM todos los
ciphertexts nuevos miden exactamente 131 088 bytes. Así, acceso SQL o una copia de respaldo no
convierten la longitud cifrada en un oráculo del tamaño del texto. El frame lleva magia y longitud
interna autenticadas, exige relleno cero y queda ligado por AAD a sujeto, `materialId`, propósito y
versión de formato.

Esta excepción **no** cubre identificadores civiles. Si el objeto es nombre, correo, documento o
teléfono, sigue aplicando ADR-0007: el ledger no recibe ninguna función del dato. Tampoco se admiten
hashes desnudos, índices buscables, HMAC de identidad ni un compromiso de capacidad.

### Evidencia y publicación

`TaskEvidenceAdded` registra sólo:

- identificadores opacos y referencias causales;
- visibilidad `restricted` o `public`;
- clase gruesa de material y tamaño;
- compromiso vinculante; la `eventVersion` fija el esquema de apertura.

No registra texto, nonce, nombre original, URL o clave de objeto, MIME exacto, tamaño exacto, bytes,
ni metadatos aportados por el cliente. El servidor detecta el tipo real y guarda los detalles fuera
del ledger. Una evidencia restringida se autoriza como si no existiera: un IDOR no distingue entre
ausencia y falta de acceso.

Publicar es una acción explícita distinta de subir material restringido. Crea una copia saneada con
nuevo identificador, nonce y compromiso; nunca cambia la visibilidad del original ni reutiliza su
apertura. La pantalla advierte que despublicar elimina lo hospedado, pero no puede borrar copias que
terceros ya descargaron.

La autorización y la ejecución son actos distintos. `POST /mi/supresion` no acepta un selector de
persona: deriva al titular de una sesión revalidada dentro de la transacción, emitida hace diez
minutos o menos, exige una confirmación irreversible y crea un agregado `pii_erasure` cuyo seq 0 es
`PIIErasureRequested` con `actor = subjectId`. Un ejecutor técnico recibe sólo el `erasureId`; no
recibe ni puede elegir al sujeto. Lo deriva de seq 0, autentica el conjunto privado, elimina
identidad, capacidad, DSK y aperturas, verifica ausencia y añade seq 1 `PIIErased` como actor sistema,
referenciando el ID y hash exactos de la solicitud.

El compromiso queda sin apertura. Se acepta perder esa verificabilidad para cumplir la supresión; no
se finge que un compromiso permanente y una apertura borrable ofrecen las dos propiedades a la vez.
Una solicitud pendiente todavía no legitima ninguna ausencia: hasta que existe seq 1, identidad y
aperturas deben seguir presentes y auténticas.

### Garantía frente al administrador

Mientras exista una apertura autorizada, sustituir el material rompe el compromiso; cambiar el
evento rompe la cadena y el checkpoint. Eso hace detectable la modificación silenciosa. No impide
que root lea o destruya material restringido: el modelo de amenaza ya declara que frente al
administrador la garantía actual es detección, no prevención. Recuperar una evidencia destruida
exige un custodio o réplica fuera de su control y queda para una decisión separada.

`/integridad` no se limita al ledger: en un único snapshot deriva cada material esperado de los
eventos, autentica su ciphertext y vuelve a calcular el commitment. Una apertura faltante, huérfana,
movida, corrupta o no comprobable deja una comprobación separada en rojo; la salida sólo contiene
códigos y contadores. El auditor lee los eventos canónicos del agregado de supresión y sólo acepta
una ausencia si seq 1 referencia ID, hash y sujeto de un seq 0 válido cuyo actor era el titular. Un
`DELETE` acompañado por un tombstone exacto pero sin esa solicitud propia sigue rojo; también quedan
rojos una solicitud pendiente cuyo sujeto desapareció y cualquier fila que sobreviva a `PIIErased`.

Esta autorización demuestra la frontera de la aplicación y de su modelo de sesión; no es una firma
del estudiante. Root o una aplicación totalmente comprometida todavía podrían fabricar ambos
eventos como append nuevos. Cerrar ese adversario exige WebAuthn/passkey o confirmación de un custodio
externo y queda como hardening posterior; el producto no debe prometer resistencia criptográfica de
la voluntad mientras esa prueba no exista.

`eventId` es global, porque ofertas, pausas, evidencias y entregas lo usan como referencia causal. Un
índice único impide colisiones entre streams, pero no se confía en que root lo conserve: el
verificador del servidor y el CLI independiente vuelven a buscar duplicados en los payloads. La
migración crea el índice sin `IF NOT EXISTS`; un objeto homónimo con otra definición aborta el
despliegue en vez de fingir que la garantía ya está instalada.

## Alternativas consideradas

- **Mostrar capacidad al responsable para que asigne mejor.** Rechazada: transforma autocuidado en
  vigilancia y crea un canal de datos sensibles.
- **Reservar carga en una tabla mutable.** Rechazada mientras ambas fronteras comparten transacción:
  duplica hechos del ledger y necesita reconciliación. Será necesaria sólo al separar bases.
- **Distribuir esfuerzo automáticamente entre semanas.** Rechazada: inventa un calendario de
  trabajo que nadie declaró.
- **`H(nonce)` para todo material.** Rechazada: oculta el contenido, pero no lo liga y por tanto no
  detecta sustitución.
- **Hash desnudo del archivo o texto.** Rechazada: quien conoce el contenido confirma su presencia y
  lo atribuye al actor.
- **Texto libre dentro del evento.** Rechazada: vuelve imposible la supresión y puede inmortalizar
  datos sensibles.
- **Permitir que el administrador complete o reabra.** Rechazada: operación técnica no es mandato
  político ni revisión del trabajo.

## Consecuencias

- La historia ya reconstruye aceptación, trabajo, pausas, ayuda, evidencia, entrega y revisión.
- Avisar temprano detiene la tarea en vez de castigar a quien pide ayuda.
- La propia persona controla su límite sin convertirlo en criterio de selección visible.
- Carreras y reintentos no producen doble aceptación, doble pausa, doble entrega ni doble revisión.
- Las evidencias quedan ligadas a su hecho sin exponer su contenido restringido en el ledger.
- El verificador debe comprobar la máquina, CAS, referencias, compromisos y ausencia de campos
  prohibidos; mientras la apertura exista, `/integridad` la autentica. Tras una supresión legítima,
  el tombstone distingue su ausencia de pérdida o manipulación.

## Consecuencias negativas aceptadas

- La semana de vencimiento es una aproximación deliberadamente tosca y puede incentivar dividir o
  mover tareas. Se mide antes de diseñar planificación más fina.
- Quien asumió el plan inicial concentra la primera revisión de entregas. Una apelación o revisión
  colectiva posterior necesitará su propio procedimiento; no se concede implícitamente a un rol.
- Una categoría pública puede no explicar el problema. El detalle gana privacidad a costa de que la
  comunidad vea menos.
- El cifrado no protege frente a root con acceso simultáneo al proceso y a la base; limita volcados y
  backups, y permite borrado por clave, pero no cambia el adversario declarado.
- Adjuntos S3, previews saneados, publicación y el proceso legal completo de supresión requieren
  adaptadores y pruebas de integración adicionales. La solicitud pública, el radicado opaco y el
  borrado local autorizado ya existen; siguen pendientes la pantalla de estado, el worker durable,
  el informe de trituración, la atención humana y el re-shred de backups. Hasta entonces la
  interfaz no debe prometer carga de archivos ni el SLA legal completo.
- El corte actual cifra notas de evidencia y resúmenes de entrega. Aunque el formato de evento admite
  comprometer un detalle privado de bloqueo, ayuda o pedido de cambios, la frontera HTTP todavía no
  acepta ese texto: sólo ofrece las categorías cerradas y no debe prometer un canal privado allí.

## Pruebas obligatorias

- unitarias e invariantes de todas las transiciones, dependencias, pausas, entregas y terminalidad;
- carreras sobre oferta, revisión, capacidad y doble submit;
- cifrado real, AAD cruzado, ciphertext alterado, clave ausente y ausencia de texto claro;
- longitud cifrada fija para texto mínimo y máximo; frame, relleno y tag autenticados;
- autorización directa a API: assignee, responsable inicial, miembro ajeno y administrador técnico;
- linter de payloads: sin texto, nonce, digest desnudo, capacidad, URL, nombre, MIME o tamaño exacto;
- compromiso: mismo contenido produce valores distintos; cambiar contenido, contexto o visibilidad
  invalida la apertura;
- E2E: aceptar con capacidad, comenzar, bloquear, pedir ayuda, reanudar, aportar evidencia, entregar,
  pedir cambios, volver a entregar y completar;
- adversarial: dos pestañas, IDs y revisiones manipulados, evento fuera de orden, sustitución de
  material, material huérfano/faltante, supresión con/sin tombstone, índice global retirado, dos
  lectores privados concurrentes y carrera aceptar-versus-bajar-capacidad.
