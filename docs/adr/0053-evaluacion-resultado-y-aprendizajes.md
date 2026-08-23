# ADR-0053: Evaluación contra criterios congelados, resultado derivado y memoria de aprendizajes

- **Estado:** Aceptado
- **Fecha:** 2026-08-23
- **Contexto de origen:** ADR-0026 (el resultado es un dato derivado), ADR-0027 (aritmética exacta),
  ADR-0033 (acuerdo con fecha de revisión y criterios previos), ADR-0040 (sin métricas de actividad
  individual), ADR-0043, ADR-0044 y ADR-0045 (plan congelado, ratificación y seguimiento);
  ADR-0051 (caducidad derivada, no escrita); `02-sociocracia-ostrom.md` principio 4;
  `03-deliberativa-sistemas-antipatrones.md` §3.4 y §5.5 («actas impecables, realidad idéntica»).

## Contexto

El ciclo del producto es `problema → evidencia → deliberación → propuesta → decisión → iniciativa →
hitos → tareas → seguimiento → evaluación → resultado → aprendizaje → memoria`. Hasta ADR-0045 el
sistema llegaba a «seguimiento» y ahí se acababa. Sin el último tramo, el proyecto no cumple su
promesa central —que años después se pueda reconstruir por qué surgió algo, qué se discutió, cómo se
decidió, qué se hizo y **qué resultado tuvo**— y se convierte exactamente en lo que la investigación
describe como el quinto antipatrón: un corpus de acuerdos impecables sobre una realidad idéntica.

El problema no es técnico. Construir una pantalla de evaluación es fácil; construir una que **se
haga** y que **pueda salir mal** no lo es, y las dos cosas se rompen por el mismo sitio:

- una evaluación que sólo puede salir bien es **teatro**: si el que evalúa es el que prometió, si los
  criterios se pueden retocar después, o si el resultado es un campo que alguien escribe, entonces el
  desenlace es siempre «logrado» y el registro deja de significar nada;
- una evaluación que **humilla** no se hace nunca: si produce «Julián cumplió el 90 %», si exige que
  alguien firme su propio fracaso, o si es una ocasión para señalar, se deja de convocar y el ciclo
  se rompe por el otro extremo — con la misma consecuencia final, que es que nada se evalúa.

La tensión es real y no se resuelve con buenas intenciones ni con un texto de ayuda en la interfaz.
Se resuelve con dónde se ponen las cosas.

## Decisión

### 1. Cómo se resuelve la tensión: siete decisiones, no una

**(a) El sujeto de la evaluación es la promesa, no las personas.** La unidad de análisis es el
**criterio de éxito** congelado en el `ExecutionPlan`. Todo lo que este agregado produce habla de
criterios, de la tarea, del acuerdo o de la carga del círculo. Ningún payload admite un `MemberId` y
la proyección **no conserva el `actor` de ningún evento**: quién escribió cada hecho sigue en el log
encadenado, como en todo el sistema, pero la evaluación no lo proyecta y por tanto no puede
agregarlo. `assertNoIndividualActivityMetric` lo comprueba sobre la salida real, no sobre el tipo.

**(b) Afirmar cuesta un hecho; negar no cuesta nada.** Declarar un criterio `cumplido` exige evidencia
`verificada` **y** el `EventId` de la iniciativa que la sostiene. Declararlo `incumplido` o
`sin-evidencia` no exige nada. La asimetría está en el pliegue, no en la interfaz. Es lo que impide
el teatro sin obligar a nadie a confesar: el trabajo de demostrar recae sobre el éxito.

**(c) El silencio produce `inconcluso`, nunca `logrado`.** Los criterios sin valorar entran a la
función como ausencia y se leen «sin evidencia», y un solo criterio sin evidencia vuelve el desenlace
`inconcluso`. Consecuencia deliberada: **no evaluar no es una forma de aprobar**. Se le quita el
premio a la evasión, que es el incentivo que de verdad mata estos procesos.

**(d) Nadie tiene que admitir nada.** El desenlace se **calcula**. `publishEvaluationResultBy` **no
tiene parámetro de desenlace**: no hay firma en el módulo donde quepa un «esto salió bien». No hay
votación de resultado y no hay confesión: hay una función pura, igual para todos y pública. Un
fracaso no es el veredicto de nadie sobre nadie; es una aritmética que cualquiera repite.

**(e) `inconcluso` es un desenlace de primera clase.** «No lo sabemos» no es un suspenso disfrazado:
es la respuesta honesta cuando faltan datos, y tiene su propia casilla. Sin ella, la única forma de
no decir «fracaso» sería mentir.

**(f) El incumplimiento escala sobre el objeto, y preguntando primero.** La escalera del ADR-0040
tiene siete escalones; una **evaluación** sólo puede pulsar dos, y en orden: `consultada` —una
pregunta, no un reproche— y, sólo después, `en-revision-colectiva`. El pliegue exige el primero antes
del segundo. El objeto es `tarea`, `acuerdo` o `carga`, nunca una persona; `dominio-suspendido` no
está en el vocabulario y no debe añadirse: el ADR-0040 lo declara excepcional, nunca automático y
apelable, y un vocabulario que lo admitiera lo volvería alcanzable desde una función.

**(g) El fracaso deja un activo.** Cerrar con un desenlace distinto de `logrado` **exige** al menos un
aprendizaje anotado, y los aprendizajes no llevan autor y no prescriben —mientras que las escaladas
prescriben a los dos semestres (ADR-0040)—. Lo que sobrevive del intento fallido es lo que enseña, no
lo que señala. Y la evaluación no se puede adelantar a la fecha comprometida: evaluar antes de tiempo
garantiza el incumplimiento y convierte la revisión en una emboscada.

El resultado neto es una evaluación **barata de hacer y cara de falsear**, en la que el peor
desenlace posible para una persona concreta es que una tarea suya quede en revisión colectiva y que
el colectivo aprenda algo.

### 2. Los criterios son inmutables por construcción

Los criterios **no viven en el agregado de evaluación**. Guardar aquí una copia editable convertiría
la regla del ADR-0033 en una comprobación, y una comprobación se quita. Viven congelados en el
`ExecutionPlan` de la versión de la propuesta (ADR-0043), cuya huella entra en `proposalVersionHash`
y por ahí en el `configHash` de la decisión. Este agregado sella **la huella y el número**, nunca el
texto.

Para evaluar hay que aportarlos, y sólo entran por `freezeSuccessCriteria`, que devuelve un objeto
marcado con un `Symbol` de módulo —no viaja en JSON, no sale de PostgreSQL, no se reconstruye desde
una petición— y **congelado en profundidad**. Es la construcción de `buildDecisionConfig` (congelar +
hash) en serie con la de `TaskCapacityAdmission` (marca no serializable). El pliegue compara huella,
cardinalidad y fecha contra lo sellado, **en cada evento y no sólo en el génesis**, porque plegar es
leer y quien lee tiene que estar leyendo contra la vara acordada en todo momento.

Las cuatro rutas quedan cerradas:

| El forjador cambia… | Qué pasa |
|---|---|
| el **texto** de un criterio | otra `planHash` ⇒ **el pliegue lanza** `EVALUATION_CRITERIA_TAMPERED` |
| la **huella** sellada en el evento | deja de coincidir con el plan real ⇒ **el pliegue lanza** |
| el **número** de criterios o la **fecha** de revisión | deja de coincidir ⇒ **el pliegue lanza** |
| texto **y** huella a la vez | el `hash` del evento deja de recomputarse ⇒ **la cadena lanza** |
| fabrica un `FrozenCriteria` a mano | no lleva la marca ⇒ **el pliegue lanza** `FROZEN_CRITERIA_REQUIRED` |

La demostración no es «la orden lo rechaza»: las pruebas **rehacen la cadena entera** desde los
payloads editados, de modo que el log forjado verifica sin una sola rotura, y aun así no pliega.

### 3. El resultado es un dato derivado (ADR-0026 aplicado)

`EvaluationResultPublished` es una proyección. El desenlace se recomputa desde los veredictos en cada
lectura y, si no coincide con lo publicado, la **discrepancia se declara**: `evaluationPublicStatus`
devuelve `anulada-por-inconsistencia`, el informe enseña el desenlace recomputado y **no se cierra
ningún acuerdo** sobre un resultado que no corresponde a sus propios hechos. La comprobación tiene
dos niveles: el pliegue síncrono compara el desenlace, y `verifyEvaluationLog` recomputa además la
huella canónica —que incluye `planHash`, así que un resultado calculado contra otros criterios
produce otra huella—.

La anulación **no es un evento**. Igual que la caducidad de la constitución (ADR-0051), es un estado
derivado: si hiciera falta que alguien escribiera «esto no cuadra», el registro manipulado seguiría en
pie mientras nadie mirara, que es justo lo contrario de lo que el ADR-0026 pide. Ver la errata **E99**.

La función del desenlace es exacta (ADR-0027), sin punto flotante:

1. un solo criterio `sin-evidencia` ⇒ `inconcluso`;
2. cero criterios aplicables ⇒ `inconcluso` («cero de cero no es unanimidad, es ausencia», B.0.d);
3. `cumplidos / aplicables = 1` exacto, por multiplicación cruzada ⇒ `logrado`;
4. `≥ 1/2` ⇒ `parcial`; por debajo ⇒ `fallido`.

El suelo de `parcial` es una **constante del dominio y no un parámetro**: un umbral configurable por
evaluación sería la vara elegida a posteriori con otro nombre.

Y lo que **no** entra en la función: cuántas tareas se completaron, cuántas quedan abiertas, quién las
hizo y qué votó nadie. Completar el trabajo es haber trabajado, no haber conseguido; una votación mide
acuerdo, no efecto. Publicar **no mira las tareas**: se publica y se cierra en fracaso o inconcluso con
trabajo abierto, porque esperar a que todo cierre para poder decir «esto no funcionó» es exactamente
cómo un fracaso se convierte en un expediente eternamente en curso.

### 4. Memoria que sobrevive a la rotación

`LearningRecorded` guarda un enunciado y **etiquetas canónicas** —estrictamente ordenadas, sin
repetir—, y la entrada de memoria que produce enlaza decisión, propuesta, iniciativa, círculo,
desenlace recomputado y disposición del acuerdo. **No lleva autor.** La rotación del colectivo es del
20 % anual: una memoria atada a personas caduca con ellas; una atada a la decisión y al círculo no.

`findLearnings` contesta «¿esto ya se intentó?» de forma determinista: filtra por etiqueta, tipo,
desenlace, círculo o decisión, y ordena por instante descendente y, a igualdad, por identificador byte
a byte (`compareIds`). Sin `localeCompare` y sin `Intl`: dos personas que preguntan lo mismo ven la
misma lista, hoy y dentro de cinco años.

### 5. Máquina de estados

```text
inexistente ──EvaluationOpened──▶ en-curso ──EvaluationResultPublished──▶ publicada ──EvaluationClosed──▶ cerrada
                                     │  ▲                                    │  ▲
                CriterionAssessed ───┘  │                 LearningRecorded ───┘  │
                EvaluationEscalated ────┤                 EvaluationEscalated ───┘
                LearningRecorded ───────┘
```

Ocho parejas legales, y las prohibiciones salen de la tabla sin un solo `if`:

- **`publicada + CriterionAssessed` es ilegal**: después de publicar no se mueve un veredicto. Si se
  pudiera, la discrepancia del ADR-0026 dejaría de significar «alguien tocó el registro» para
  significar «alguien siguió trabajando».
- **`en-curso + EvaluationClosed` es ilegal**: no se cierra un acuerdo sin haber publicado qué pasó.
- **`cerrada` es absorbente**: lo que sigue es otra evaluación, con su fecha y sus criterios.

Cerrar decide qué pasa con el acuerdo (ADR-0033): `mantener`, `enmendar`, `derogar` o `escalar`.
**`mantener` está prohibido sobre un desenlace `fallido`** —mantener sin evidencia es lo que convierte
el corpus normativo en un cementerio— y exige comprometer la próxima fecha de revisión, para que la
inercia no renueve sola.

## Alternativas consideradas

- **Guardar los criterios en el agregado de evaluación y comprobar que no cambien.** Rechazada: es la
  forma habitual y es la que falla, porque la comprobación es un `if` que alguien quita en una
  refactorización de viernes. Si no hay copia, no hay nada que comprobar.
- **Recibir el desenlace como parámetro y validarlo.** Rechazada por lo mismo: mientras exista el
  parámetro, existe la tentación y existe la ruta. Quitarlo de la firma cierra el asunto.
- **Que evalúe quien asumió el plan (`ownerOnly`, como el resto del agregado de ejecución).**
  Rechazada: si sólo esa persona puede convocar, basta con no convocar; si sólo ella puede valorar, es
  autocertificación; si sólo ella puede publicar, puede retener un resultado adverso. Lo que sustituye
  a `ownerOnly` es la pertenencia al círculo — principio 4 de Ostrom sin inventar un panel.
- **Declarar éxito al completar todas las tareas.** Rechazada: es precisamente la confusión que este
  ADR existe para deshacer. Es también la más tentadora, porque es automática y siempre da buenas
  noticias.
- **Votar el resultado.** Rechazada: una votación mide acuerdo sobre un juicio, no efecto sobre el
  mundo, y convierte la evaluación en una segunda decisión donde gana quien más gente convoque.
- **Anulación por inconsistencia como evento escrito.** Rechazada: exigiría que alguien la escribiera,
  y mientras nadie lo hiciera el registro manipulado seguiría vigente. Se deriva, como ADR-0051.
- **Umbral de `parcial` configurable por evaluación.** Rechazada: es la vara elegida después con otro
  nombre.
- **Métrica de cumplimiento por responsable «para saber a quién apoyar».** Prohibida por ADR-0040 y,
  además, innecesaria: lo que hay que apoyar es la tarea bloqueada, y esa sí tiene nombre.

## Consecuencias

- El ciclo se cierra: de una decisión de 2026 se puede reconstruir el problema, la deliberación, la
  propuesta, el escrutinio, la ejecución, **el resultado contrastado contra lo que se prometió** y lo
  que el colectivo aprendió.
- La vara no se puede mover después de conocer el resultado, y eso es demostrable con un log forjado,
  no sólo afirmable.
- Un resultado alterado en la base de datos se detecta al leer, sin que nadie tenga que mirar una
  alerta, y bloquea el cierre del acuerdo.
- Se puede decir «esto no funcionó» sin que nadie tenga que admitirlo, sin esperar a que el trabajo
  termine y sin que aparezca el nombre de nadie.
- La deuda normativa deja de ser invisible: un acuerdo fallido no se puede mantener tal cual.
- El informe es publicable sin revisión previa: no puede contener una métrica por persona, porque
  antes de devolverse se comprueba sobre el objeto real.

## Consecuencias negativas aceptadas

- **Evaluar exige a alguien.** Nadie está obligado a convocar la revisión: si el círculo entero mira
  para otro lado, la evaluación no ocurre. Lo que este ADR garantiza es que **no ocurra a favor de
  nadie** —el silencio no produce `logrado`—, no que ocurra. El empujón que falta es el del ADR-0033
  («ninguna propuesta nueva del mismo responsable se abre con una evaluación vencida»), que exige
  tocar el motor de decisiones y queda fuera de este incremento.
- **`cumplido` / `incumplido` sigue siendo un juicio humano.** El criterio congelado trae `description`
  y `evidenceSource`, pero **no un umbral**: no hay un `successIf` que comparar (ver **E95**). La
  evidencia se exige, la interpretación no se automatiza — y no debería, pero conviene no fingir que
  el desenlace es tan mecánico como su aritmética.
- **El `evidenceRef` apunta a otro agregado y este dominio no puede seguirlo.** El pliegue comprueba
  que es un `EventId` bien formado; que ese evento exista, sea de esta iniciativa y sea la entrega que
  se dice, lo tiene que comprobar el verificador que sí ve los dos logs. Es una promesa de integridad
  que aquí queda declarada y no cumplida.
- **Que la escalada nombre una tarea nombra indirectamente a quien la tiene.** Es inevitable: una
  tarea tiene responsable. Lo que se consigue es que la evaluación no lo escriba, no lo agregue y no
  lo compare, y que no exista ninguna consulta de este agregado que responda «cuántas escaladas tiene
  esta persona». Es una barrera de diseño, no una imposibilidad matemática.
- **`assertNoIndividualActivityMetric` es una lista de nombres de campo.** Rechaza objetos indexados
  por identificador opaco y los nombres con los que este dominio nombra a alguien. Un campo nuevo
  llamado `quienIncumplio` pasaría. Mitiga, no demuestra; lo que demuestra es que el vocabulario de
  payloads no admite personas.
- **Una sola evaluación por fecha de revisión, y ninguna reapertura.** Corregir una evaluación cerrada
  exige otra evaluación. Es deliberado y va a molestar.
- **Prescribir las escaladas a los dos semestres borra información** que a alguien le parecerá
  relevante. Es la misma decisión del ADR-0040 y se acepta igual.
- **`Agreement` sigue sin existir como agregado** (ver **E95**). Lo que se evalúa es el plan de
  ejecución, que es lo que de verdad está congelado, y la disposición del acuerdo se guarda en el
  cierre de la evaluación. Un corpus normativo consultable —vigentes, enmendados, derogados,
  caducados— es trabajo aparte.
- **La autorización todavía no está en `access.ts`.** Las siete filas están declaradas como datos y
  se aplican con la misma semántica y los mismos códigos de error, pero mientras no entren en la
  matriz hay **dos** sitios donde vive una regla de acceso, que es exactamente lo que la cabecera de
  `access.ts` argumenta que no debe pasar. Es deuda con fecha: entra con el primer incremento que
  pueda tocar ese fichero.

## `Action` nuevas para `access.ts`

Este incremento no puede editar `access.ts`. Las siete filas quedan declaradas como datos en
`PROPOSED_EVALUATION_ACCESS_RULES` (`packages/domain/src/evaluation/commands.ts`), con una prueba que
las fija. **Ninguna concede nada a `tech-admin`** y ninguna es `ownerOnly`.

| `Action` | Roles | Autenticada | `circleOnly` | Regla y por qué |
|---|---|---|---|---|
| `evaluation:read` | `OPEN` (todos, incluido anónimo) | no | no | La memoria es pública, como el resto del historial. Un aprendizaje que sólo ve el círculo que lo vivió no sobrevive a que ese círculo rote. |
| `evaluation:open` | `member`, `facilitator`, `guarantees` | sí | sí | Cualquier miembro del círculo convoca la revisión a partir de la fecha comprometida. **No es `ownerOnly`**: si lo fuera, bastaría con no convocarla. |
| `evaluation:assess` | `member`, `facilitator`, `guarantees` | sí | sí | Valorar un criterio contra su evidencia lo hace el círculo, no quien lo prometió. La garantía contra el abuso no está en el rol sino en el dominio: `cumplido` exige evidencia verificada y el evento que la sostiene. |
| `evaluation:escalate` | `member`, `facilitator`, `guarantees` | sí | sí | Los dos escalones que la evaluación puede pulsar recaen sobre la tarea, el acuerdo o la carga. |
| `evaluation:record-learning` | `member`, `facilitator`, `guarantees` | sí | sí | Anotar lo aprendido es un derecho de miembro del círculo. |
| `evaluation:publish` | `member`, `facilitator`, `guarantees` | sí | sí | Publicar sólo ancla un valor que la función ya determina. Restringirlo a facilitación daría a un rol la capacidad de retener un resultado adverso sin ganar ninguna garantía. |
| `evaluation:close` | `facilitator`, `guarantees` | sí | sí | Decidir qué pasa con el acuerdo sí es procedimiento (§7). Es la única que no es de miembro raso, y aun así no es `ownerOnly`. |

Al aplicarlas: añadir los siete literales a `Action` y a `ACTIONS`, añadir `'evaluation'` a
`ResourceKind`, y las filas a `RULES` reutilizando `OPEN` y `CIRCLE_MEMBER`. Al hacerlo hay que
**borrar** `EvaluationUnauthorizedError` y `authorizeEvaluation` de `evaluation/commands.ts` y llamar
a `authorize`; los `code` ya coinciden (`UNAUTHORIZED_<motivo>`), de modo que la frontera HTTP no
cambia.

## Erratas y contradicciones detectadas

El registro venía por **E87** (ADR-0052). En paralelo, la **persistencia de la constitución**
(`services/api/src/constitution/index.ts` y `packages/contracts`) produjo **E88–E94** —siete
erratas, fichas en ese código y en `docs/research/00-contradicciones-resueltas.md`—. Las erratas de
este ADR ocupan por tanto **E95–E101**, siguiendo el orden de las siete filas de la tabla.

| # | Dónde | Qué dice y por qué no puede ser | Cómo se resolvió |
|---|---|---|---|
| **E95** | ADR-0033 vs. ADR-0043 | El 0033 define `Agreement` como entidad de primera clase con `evaluationCriteria: { observable, source, successIf }[]`. El 0043, diez ADR después, mete la misma promesa en `ExecutionPlan` con **otra forma** —`{ description, evidenceSource }`— y la congela en la huella de la versión. Hay **dos hogares** para el mismo dato, sólo uno existe en código, y en la conversión **desaparece `successIf`**: el umbral acordado de antemano, que era el núcleo del argumento del 0033 contra la evaluación retrospectiva sesgada | Se evalúa el `ExecutionPlan`, que es lo que de verdad está congelado y hasheado. La pérdida de `successIf` **se declara**: la evidencia se exige, la comparación con un umbral no, y por eso `cumplido`/`incumplido` es un juicio sobre evidencia y no un cálculo. Recuperarlo exige tocar `workspace/execution-plan.ts` y cambiar `proposalVersionHash`, es decir, invalidar toda propuesta histórica; es una decisión aparte |
| **E96** | ADR-0033, «Regla dura» | «Una decisión que crea un acuerdo **no puede pasar a `Ratified`** si `reviewAt` o `evaluationCriteria` están vacíos. Es una invariante del motor». No lo es: `ratifyDecision` y el caso `DecisionRatified` del pliegue (`engine.ts`) comprueban actor, resultado, ventana de impugnación y desenlace — **nunca el plan** | La invariante se cumple, pero **por otro sitio**: `validateExecutionPlanStructure` la impone aguas arriba, al crear la versión de la propuesta (ADR-0043), de modo que una decisión sin criterios no puede ni abrirse. El resultado es más fuerte que lo que el 0033 pedía; la frase del 0033 sobre «el motor» es literalmente falsa y debería corregirse a «una invariante de la versión de la propuesta» |
| **E97** | ADR-0033, cadencias y caducidad | «Sin renovación explícita el acuerdo pasa a `caducado`», con cadencias por defecto según el acuerdo sea operativo, procedimental o constitutivo. Pero `ExecutionPlan.reviewAt` es **un instante absoluto sin tipo de acuerdo**: no hay dato del que derivar una cadencia, y no hay agregado con estado `caducado` que pueda transitar | Se implementa lo ejecutable: `mantener` **exige** comprometer `nextReviewAt`, de modo que la inercia no renueva sola. La caducidad automática y los tres tipos de cadencia quedan como deuda declarada; requieren el agregado `Agreement` de **E95** |
| **E98** | ADR-0040, la escalera de siete escalones | Los siete se presentan como una sola escalera que alguien recorre. No lo son: `por-vencer`, `atrasada`, `bloqueada`, `en-apoyo` y `reasignada` son estados o transiciones de **la tarea**, y ADR-0045 dice con todas las letras que bloquear, pedir ayuda y reanudar **sólo los puede hacer quien aceptó la oferta vigente**. Leída como una escalera continua, sugiere que un tercero puede declarar el bloqueo de otro, que es justo lo que ADR-0045 prohíbe | La evaluación sólo puede pulsar los dos escalones que no hablan por nadie: `consultada` y `en-revision-colectiva`, y el pliegue exige el primero antes del segundo. `dominio-suspendido` **no está en el vocabulario**: el propio ADR lo declara nunca automático, y un vocabulario que lo admitiera lo volvería alcanzable desde una función |
| **E99** | ADR-0026 vs. ADR-0051 | El 0026 dice que la discrepancia «dispara `Annulled` automático. **No es una alerta que alguien deba mirar: es una transición de estado**». Las dos mitades de la frase se contradicen en un sistema event-sourced: una transición necesita un evento, un evento necesita que alguien lo escriba, y mientras nadie lo escriba el registro manipulado sigue vigente — es decir, vuelve a ser una alerta que alguien debe mirar. El propio repositorio ya resolvió el mismo problema al revés un ADR después: la caducidad del 0051 «**no tiene evento**» y se calcula al leer | Se sigue al 0051. `evaluationPublicStatus` **deriva** `anulada-por-inconsistencia` al plegar, sin evento y sin que nadie mire, y el pliegue rechaza cerrar el acuerdo. Lo que el 0026 quería —que no dependa de un vigilante— se consigue exactamente por no hacer lo que su segunda frase dice |
| **E100** | ADR-0040, métricas publicadas | Entre las métricas agregadas que **sí** se publican, el ADR lista «cumplimiento de acuerdos». Calcularla exige justo lo que este módulo produce, y basta con desagregarla por responsable —que es el campo natural de unirla— para obtener la métrica individual que el mismo ADR prohíbe. El ADR no dice dónde está la frontera | Se pone la frontera en el dato, no en la intención: el informe de evaluación **no contiene ninguna persona**, así que no hay por dónde desagregar. La métrica agregada pertenece a `packages/metrics` —fuera del alcance de este incremento— y debe consumir el informe, que ya viene sin nadie dentro |
| **E101** | Encargo, «`tech-admin` no tiene ninguna capacidad» | Es falso como está escrito: en `access.ts`, `OPEN` se define como `ROLES` y `ROLES` **incluye** `tech-admin`, así que el administrador técnico puede `problem:read`, `decision:read`, `ledger:read`, `ledger:export` y `constitution:read`. No es un fallo —esas acciones también las tiene un anónimo—, pero la frase absoluta induce a error y en una revisión futura puede llevar a «arreglar» algo que no está roto | Se cumple en el sentido estricto y verificado por prueba: `tech-admin` **no aparece en ninguna regla de escritura** de la evaluación. `evaluation:read` es `OPEN` porque es pública para cualquiera, incluido quien no tiene cuenta; que el administrador también pueda leerla es una consecuencia de que sea pública, no un permiso suyo |

## Pruebas obligatorias

- **INV-E1** los criterios congelados —huella, texto y cardinalidad— son idénticos antes y después de
  plegar cualquier evaluación, y el objeto está congelado de verdad (`Object.isFrozen`);
- **INV-E2** un log forjado que altere el texto de cualquier criterio, la huella sellada, la
  cardinalidad o la fecha de revisión **lo rechaza el pliegue**, con la cadena rehecha por completo
  desde los payloads editados;
- **INV-E3** lo que publica la orden coincide siempre con lo recomputado; sustituir el desenlace
  guardado por cualquier otro produce `anulada-por-inconsistencia`, el informe sigue enseñando lo
  recomputado, y el cierre del acuerdo se rechaza;
- **INV-E4** `logrado` sale **si y sólo si** todos los criterios aplicables están cumplidos y hay al
  menos uno; el umbral de `parcial` se comprueba por multiplicación cruzada contra `1/2`;
- **INV-E5** cualquier desenlace adverso se publica y se cierra con `derogar`, `enmendar` o `escalar`
  con trabajo abierto; `mantener` sobre `fallido` se rechaza;
- **INV-E6** estado, informe y entradas de memoria pasan `assertNoIndividualActivityMetric` y su
  serialización **no contiene ningún identificador de persona**;
- **INV-E7** el producto cartesiano `estado × evento`: las once parejas ausentes de la tabla lanzan
  `ILLEGAL_TRANSITION`; un evento fuera de secuencia o de otro agregado tampoco entra;
- unitarias: apertura antes de la fecha comprometida, iniciativa no ratificada, criterios ajenos,
  `FrozenCriteria` fabricado a mano, autorización (`tech-admin`, ajeno al círculo, anónimo, miembro
  raso cerrando), las cuatro reglas de veredicto y evidencia, corrección de veredicto sin borrado,
  escalera sin saltar escalones, prescripción a los dos semestres, y **el escenario completo con todas
  las tareas `completada` y el criterio `incumplido`, que da `fallido`**;
- pendientes, y declaradas: verificación cruzada de `evidenceRef` contra el log de la iniciativa;
  bloqueo de propuestas nuevas con evaluación vencida (ADR-0033); métrica agregada de cumplimiento en
  `packages/metrics`; las siete filas en `access.ts`.
