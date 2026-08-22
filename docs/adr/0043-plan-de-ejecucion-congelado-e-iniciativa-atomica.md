# ADR-0043: El plan de ejecución se congela con la propuesta y la iniciativa nace con el resultado

- **Estado:** Aceptado
- **Fecha:** 2026-08-21
- **Contexto de origen:** `PRODUCT.md` §3, §6 y §9; `GOVERNANCE.md` §1; ADR-0037.

## Contexto

El corte vertical ya conserva el problema, las versiones de la propuesta, las reglas congeladas de la
decisión, las papeletas y el resultado. Sin embargo, un resultado aprobado todavía puede quedar sin
responsable, fecha de revisión ni criterio observable. Añadir esos datos después de contar los votos
permitiría cambiar qué se prometió cuando la comunidad ya decidió. Es la misma sustitución
retroactiva que el versionado de propuestas existe para impedir.

Persistir primero el resultado y crear después la iniciativa tampoco alcanza. Una caída entre ambas
escrituras produciría exactamente el estado ilegítimo que se quiere excluir: una aprobación sin
ejecución asociada. Un reintento ingenuo podría producir dos iniciativas para la misma decisión.

## Decisión

Cada versión nueva de una propuesta lleva un `ExecutionPlan` con, como mínimo:

- objetivo;
- responsable seudónimo;
- fecha de revisión;
- uno o más criterios de éxito con su fuente de verificación.

La huella de la versión incluye la huella canónica de ese plan. Cambiar sólo el plan crea una versión
nueva igual que cambiar el texto. Las propuestas históricas que anteceden a esta decisión continúan
siendo verificables, pero no pueden abrir una decisión nueva mientras no reciban una versión con plan.

En la primera vertical, quien propone sólo puede asumirse a sí mismo como responsable. Nombrar a otra
persona requerirá posteriormente un evento explícito de aceptación; una asignación unilateral no es
responsabilidad colectiva verificable.

Al redactar la decisión, el servidor genera con CSPRNG y congela un `plannedInitiativeId`, junto con la
huella del plan. Ese identificador no depende del resultado ni de datos personales. Al computar un
desenlace `approved`, el servicio escribe en **una sola transacción PostgreSQL**:

1. `DecisionClosed` y `ResultComputed` en el agregado de decisión;
2. `InitiativeCreated` en el identificador ya congelado, enlazando decisión, resultado, propuesta,
   versión, círculo y plan exactos.

Ambos append usan claves de idempotencia derivadas y distintas. El commit contiene los dos hechos o
ninguno. Reintentar devuelve la misma iniciativa; nunca crea otra. Los desenlaces `rejected`,
`no-quorum` y `needs-new-round` no crean iniciativa.

Una clave de idempotencia sólo constituye un replay si el lote solicitado coincide por completo con
el ya sellado: agregado, tipo, cardinalidad y preimagen canónica de cada evento. Coincidir únicamente
en el agregado no alcanza; una orden anterior sobre ese mismo agregado podría convertir uno de los
append del commit compuesto en un no-op silencioso. Una reutilización divergente devuelve conflicto y
revierte la transacción entera.

La iniciativa nace en `por-empezar`. Un resultado escrutado aún está sujeto a la ventana de
impugnación: ningún trabajo irreversible debe comenzar antes de `DecisionRatified`. Una anulación o
rechazo posterior se representa con eventos correctivos; jamás se borra la iniciativa provisional.

El plan es el mínimo para impedir una aprobación huérfana, no el modelo completo de ejecución. Hitos,
tareas, aceptación o rechazo de asignaciones, dependencias, bloqueos, informes, evaluación y
aprendizajes se añaden como eventos del agregado de iniciativa, conservando estos vínculos de origen.

## Alternativas consideradas

- **Pedir el plan al cerrar.** Rechazada: quienes votaron no pudieron evaluar lo que se iba a hacer y
  el facilitador podría cambiar la obligación después del escrutinio.
- **Crear la iniciativa en un job posterior.** Rechazada: admite aprobaciones huérfanas, requiere una
  reparación asíncrona y multiplica los estados intermedios que un equipo pequeño debe operar.
- **Derivar el identificador de la decisión.** Rechazada: los identificadores opacos siguen siendo
  aleatorios; la relación legítima ya queda explícita en el evento.
- **Activar trabajo al publicar el escrutinio.** Rechazada: confunde resultado computado con decisión
  ratificada y vuelve inútil la ventana de impugnación.

## Consecuencias

- La comunidad decide sobre el texto y sobre la promesa mínima de ejecución como una sola versión.
- No existe un commit válido con resultado aprobado y sin iniciativa enlazada.
- La idempotencia puede demostrarse y probarse bajo doble envío y caída de conexión.
- Las claves ocupadas previamente por otra orden no producen commits parciales; el Event Store compara el lote,
  no sólo su etiqueta.
- La interfaz debe mostrar el plan antes de emitir una papeleta y explicar que la iniciativa queda
  pendiente durante la impugnación.
- Las restauraciones y el verificador global deben comprobar también que cada resultado aprobado
  tiene exactamente una iniciativa, que `DecisionLinked` y la decisión se corresponden en ambos
  sentidos, y que ningún otro desenlace crea ejecución.

## Consecuencias negativas aceptadas

- Proponer exige pensar antes en una responsabilidad y en cómo se evaluará; el asistente debe ayudar
  a escribirlo en lenguaje común para que esa fricción no excluya a quien no sabe gestión.
- El cierre pasa a tocar dos agregados y exige una composición transaccional explícita sobre el Event
  Store.
- Las propuestas históricas sin plan necesitan una enmienda antes de volver a someterse.
- La iniciativa provisional añade un estado visible durante la impugnación; ocultarlo sería más
  simple, pero también ocultaría una parte real del procedimiento.
- El mapeo durable de apertura conserva el resultado original, pero todavía no almacena un
  fingerprint del cuerpo HTTP completo. Por eso no puede distinguir si `version` se omitió en el
  primer intento o sólo en un reintento posterior. La recuperación es segura —devuelve la apertura
  ya sellada y no escribe—, aunque una política futura más estricta requerirá persistir ese
  fingerprint, incluida la presencia del campo.
