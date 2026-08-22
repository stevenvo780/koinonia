# ADR-0044: Ratificar activa la iniciativa; las tareas se ofrecen antes de asignarse

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `PRODUCT.md` §6 y §9; `GOVERNANCE.md` §7; ADR-0033, ADR-0040 y
  ADR-0043.

## Contexto

ADR-0043 impide que una decisión aprobada quede sin promesa de ejecución, pero la iniciativa nace
provisional: el resultado todavía puede impugnarse. También conserva sólo el plan mínimo que se
decidió —objetivo, responsable inicial, revisión y criterios—; aún no existe una forma verificable de
dividirlo en trabajo realizable.

Tratar `InitiativeCreated` como autorización para empezar confundiría escrutinio con ratificación.
Asignar tareas unilateralmente produciría otro problema: el sistema afirmaría que una persona es
responsable aunque nunca haya aceptado. Finalmente, un simple campo mutable de estado perdería las
ofertas rechazadas, los intentos de reasignación y el orden causal que explica cómo llegó la tarea a
su responsable vigente.

## Decisión

### Ratificación y activación atómicas

Una iniciativa de ADR-0043 sólo se activa cuando su decisión pasa de `Closed` a `Ratified`, después
de vencer la ventana de impugnación. El plazo empieza en el instante más tardío entre el cierre y la
publicación de `ResultComputed`: un job que publique tarde no puede consumir a escondidas el tiempo
en el que la comunidad todavía no conocía el resultado. Un miembro con encargo de facilitación o
garantías y pertenencia al círculo puede disparar el acto procedimental. El servicio escribe en
**una sola transacción**:

1. `DecisionRatified` en la decisión;
2. `InitiativeActivated` en la iniciativa reservada, con el identificador y la huella exactos del
   evento de ratificación.

La activación sólo la emite el sistema y sólo puede ocurrir una vez. Si falla cualquiera de los dos
append no queda ninguno. Una iniciativa provisional no admite hitos ni tareas. Una decisión
histórica anterior a ADR-0043 puede ratificarse, pero no se le inventa retroactivamente una
iniciativa.

La ratificación captura un solo instante transaccional. Ese mismo valor decide si la matrícula sigue
vigente y fecha `DecisionRatified` e `InitiativeActivated`: un retiro situado entre dos lecturas del
reloj no puede dejar un acto atribuido después de perder la membresía.

`ResultComputed` también pasa a ser único por decisión y su instante queda en el estado derivado. Sin
esa unicidad un segundo evento podría mover el comienzo de la impugnación o hacer que dos
verificadores eligieran publicaciones distintas.

### Hitos

El responsable inicial del plan puede emitir `MilestonePlanned` con:

- identificador opaco generado por el servidor;
- título;
- criterio observable de terminación;
- fecha límite.

La fecha no puede superar la revisión congelada de la iniciativa. Se permite registrar un plazo que
ya quedó vencido: una ratificación o recuperación tardía debe revelar el atraso, no volver imposible
planificarlo ni falsificar una fecha futura.

### Oferta y aceptación de tareas

El responsable inicial puede emitir `TaskOffered` sobre un hito existente. La oferta fija título,
descripción, esfuerzo estimado en minutos enteros, fecha límite y dependencias existentes. Las
dependencias son únicas, no incluyen la propia tarea y no pueden formar ciclos. La fecha de la tarea
no supera la del hito.

La persona destinataria debe ser un miembro vigente del círculo. La aplicación relee esa condición
dentro de la transacción y mantiene bloqueada la fila de membresía hasta el commit; no alcanza una
sesión emitida antes de un retiro. Mientras no responda, la tarea está `ofrecida`: **no tiene
responsable asignado**. El identificador del propio evento `TaskOffered` es el `offerId` que la
respuesta debe presentar. Así una aceptación tardía no puede aceptar una oferta que ya fue
sustituida.

Quien recibió la oferta puede emitir:

- `TaskAccepted`, que la convierte en responsable;
- `TaskRejected`, con un motivo general estructurado;
- `TaskReassignmentRequested`, con un motivo general estructurado, tanto antes como después de
  aceptar.

Los motivos admitidos son categorías cerradas y no diagnósticos personales: sin disponibilidad,
plazo inviable, alcance no claro, otra persona más adecuada o razón privada. El ledger conserva sólo
esa categoría. No acepta texto libre que pueda revelar salud, empleo u otros datos personales. Si un
incremento posterior necesita explicar una razón privada, el texto y su nonce vivirán cifrados en el
PII Vault y el evento público llevará un commitment aleatorizado, nunca el contenido ni su hash
desnudo.

Pedir reasignación revoca inmediatamente la responsabilidad vigente: el estado
`reasignacion-solicitada` no tiene responsable. Mantener el nombre hasta encontrar reemplazo haría
que la plataforma afirmara un compromiso que la propia persona acaba de declarar imposible.

Después de un rechazo o solicitud de reasignación, el responsable inicial puede emitir
`TaskReoffered` a otra persona. La orden referencia también el `offerId` que reemplaza y el evento lo
conserva como `previousOfferId`; esto cierra tanto una respuesta tardía como una reoferta tardía tras
dos ciclos (el problema ABA). El nuevo evento es un nuevo `offerId`; cualquier operación sobre el
anterior falla con `STALE_TASK_OFFER`. En aceptación, rechazo y solicitud, el actor del evento debe
coincidir con el destinatario o responsable que el estado vigente atribuye: la API no puede actuar en
nombre de otra persona aunque manipulen su cuerpo.

Estados iniciales de tarea:

```text
ofrecida ──aceptar──▶ aceptada ──pedir reasignación──▶ reasignacion-solicitada
    ├──────rechazar──▶ rechazada ───────────────┐
    └─pedir reasignación──▶ reasignacion-solicitada

rechazada | reasignacion-solicitada ──nueva oferta──▶ ofrecida
```

El trabajo realizado, evidencias, bloqueos, ayuda, revisión, evaluación y aprendizajes se incorporan
en el incremento siguiente. Registrar `effortMinutes` ahora permite diseñar capacidad colectiva
después, pero este ADR **no afirma** que ya se controle sobrecarga.

Para no obligar a copiar identificadores técnicos, la persona responsable elige destinatario en un
directorio del círculo. Sólo un miembro autenticado del mismo círculo puede consultarlo; la respuesta
contiene únicamente identificador opaco y alias. El alias se lee del PII Vault para esa pantalla, no
se copia al evento ni a una vista pública.

### Serialización, replay y compatibilidad

Toda mutación de la iniciativa toma el cerrojo global del ledger, relee después del cerrojo y escribe
por comparación con la cabeza vigente. Aceptar, rechazar y pedir reasignación concurrentemente sobre
la misma oferta tienen un único ganador; las demás respuestas reciben un conflicto semántico y no
escriben.

La respuesta presenta además la revisión de tarea que la persona vio. Esa revisión es el `seq` del
último evento que afectó la tarea y funciona como CAS: dos respuestas tomadas desde la misma pantalla
no pueden aplicarse una detrás de otra aunque la primera conserve el mismo `offerId`. Una solicitud de
reasignación posterior a una aceptación sí es válida, pero debe partir de la revisión nueva. Esto evita
que el cerrojo global convierta accidentalmente dos intenciones simultáneas en dos órdenes sucesivas.

Cada petición lleva una clave de idempotencia. Un replay sólo es válido si agregado, tipo de evento,
actor y campos de entrada coinciden con el hecho original; reutilizarla para otra orden falla sin
escritura. La interfaz conserva esa misma clave mientras una intención no reciba éxito inequívoco: si
el servidor confirma el append pero se pierde la respuesta, reintentar recupera el mismo hecho. Sólo
un éxito o un cambio real del formulario abre una intención nueva.

Idempotencia no congela permisos. Antes de devolver incluso un replay exacto, el servicio relee la
membresía, los círculos y el rol y vuelve a autorizar la operación. Una persona que perdió el encargo
no puede recuperar la respuesta política usando una clave antigua; un administrador técnico tampoco.

Los appends internos de una operación multiagregado viven en un `request_scope` reservado que ningún
endpoint acepta del cliente. El mismo UUID público puede identificar el append principal y, en otro
scope, su consecuencia atómica. Derivar otro UUID con un algoritmo público no basta: un cliente podría
calcularlo y ocuparlo antes para provocar un bloqueo selectivo.

`InitiativeCreated` no cambia. Logs históricos con sólo ese evento siguen siendo válidos y se
proyectan como provisionales, sin hitos ni tareas. Los nuevos hechos se agregan al mismo stream de la
iniciativa para que el orden causal sea inequívoco y una sola verificación reconstruya su historia.

Los plazos escritos mediante `datetime-local` se interpretan explícitamente como hora de Colombia
(UTC-05:00), sin depender de la zona configurada en el dispositivo. La interfaz lo declara junto al
campo y el contrato rechaza fechas inexistentes antes de emitir una orden.

## Alternativas consideradas

- **Activar al cerrar la votación.** Rechazada: elimina en la práctica la ventana de impugnación.
- **Crear un agregado por tarea desde el primer corte.** Rechazada por ahora: exige coordinación
  multiagregado para cada transición sin aportar todavía independencia de escala; el stream de la
  iniciativa es pequeño, causal y suficiente.
- **Asignar y permitir rechazar después.** Rechazada: presenta como obligación vigente algo nunca
  consentido y distorsiona cualquier vista de carga.
- **Usar sólo el `taskId` para responder.** Rechazada: una respuesta retardada podría aplicar a una
  oferta posterior hecha a otra persona.
- **Permitir editar una tarea ofrecida.** Rechazada en este incremento: cualquier cambio sustantivo
  requiere una oferta nueva y queda visible; no se sobrescribe la obligación presentada.

## Consecuencias

- Resultado, ratificación y autorización para ejecutar quedan separados y reconstruibles.
- Una tarea sólo muestra responsable después de una aceptación explícita.
- Carreras y doble envío tienen un resultado determinista sin doble asignación.
- Hitos, tareas, dependencias y respuestas pasan por las mismas garantías append-only e integridad
  que el resto del gobierno.
- El verificador global debe comprobar los enlaces ratificación↔activación, la unicidad, las fechas,
  el grafo de dependencias y que cada respuesta corresponda a la oferta vigente.

## Consecuencias negativas aceptadas

- El responsable inicial concentra temporalmente la descomposición y las nuevas ofertas. La
  reasignación colectiva después de intentos fallidos se añade con su propia regla y revisión; no se
  concede silenciosamente a facilitadores ni al administrador técnico.
- Los identificadores seudónimos de destinatario y responsable quedan en el ledger porque son parte
  de la atribución verificable. No se muestran como nombre en vistas públicas y no son anonimato.
- La autorización de membresía se demuestra en el momento de escritura y queda atribuida, pero no se
  copia al ledger una prueba reidentificable del registro institucional. Tras una supresión legal de
  PII, un verificador histórico puede probar el evento y su actor seudónimo, no reconstruir la fila
  personal que habilitó a esa persona; ése es el límite deliberado de ADR-0007 y ADR-0009.
- Todavía no hay control de capacidad, bloqueo, evidencia ni cierre de tarea. La interfaz debe decir
  exactamente qué existe, sin llamar «seguimiento completo» a esta primera máquina de asignación.
