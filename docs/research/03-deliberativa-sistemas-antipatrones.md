# Investigación 03 — Deliberación, sistemas, DAOs y antipatrones

Cuatro literaturas: teoría deliberativa (qué cuerpo decide), psicología social (cómo se corrompe una discusión), teoría de sistemas (por qué el colectivo no aprende) y evidencia de fracaso de plataformas participativas. Criba: ¿resuelve un fallo real de 300 estudiantes de filosofía, o es sobrepeso importado de un parlamento?

---

## 1. Democracia deliberativa, minipúblicos y sorteo

### 1.1 Cuándo un minipúblico de 12-20 supera a una asamblea de 300

No compiten en el mismo eje: la asamblea maximiza **legitimidad de input**, el minipúblico **calidad epistémica**. La asamblea de 300 tiene tres patologías: el tiempo de palabra tiende a cero (90 minutos son 18 segundos por persona), la autoselección sesga hacia quien tiene tiempo libre y capital verbal, y la polarización de grupo empuja al extremo de la mediana previa.

**Minipúblico cuando se cumplan tres o más:**

1. **La decisión exige leer.** Si formarse una opinión defendible pide más de 30 minutos de material, la asamblea no lee: vota por señal de tribu.
2. **El espacio de opciones es abierto.** Redactar es tarea de comité; ratificar, de asamblea.
3. **Conflicto de intereses asimétrico.** Horarios de la nocturna: los afectados son minoría estructural y pierden 250-50 sin que nadie mienta.
4. **La participación previa está concentrada.** La asamblea sólo amplificaría al núcleo activo (§6); el sorteo es lo único que rompe la autoselección.
5. **El tema quema.** Con carga identitaria la asamblea produce competencia de posicionamiento público; en un grupo de 15 registrado pero no transmitido en vivo, la gente cambia de opinión sin costo.

**Asamblea abierta** cuando la decisión es binaria y de valores (adherir o no a un paro), afecta a todos por igual, o el error es barato y reversible; y siempre para **ratificar** lo que el minipúblico redactó. Arquitectura sana: **asamblea define problema y mandato → minipúblico delibera y redacta → asamblea ratifica o devuelve**.

### 1.2 Estratificación en población estudiantil

El sorteo simple sobre 300 da muestras de 15 con varianza brutal: si la nocturna es el 20%, la probabilidad de que salga ≤1 es ≈17%. La estratificación (`stratifiedSortition`, §B.9 de la spec 30) fija cuotas por mayores restos y sortea dentro de cada estrato con ticket HMAC verificable.

| Eje | Riesgo específico |
|---|---|
| **Semestre** (1-3 / 4-6 / 7-10): quien está en décimo no vive una reforma a tres años. | Con n=15 hay que agrupar niveles, y agrupar es decisión política, no técnica. |
| **Jornada** (diurna / nocturna): el eje de exclusión material más fuerte. | El de mayor declinación. Sin suplentes (B.9.c) la cuota nocturna se vacía y el sorteo "estratificado" devuelve un comité diurno. |
| **Pregrado / posgrado**: intereses distintos en docencia, investigación y recursos. | Estrato pequeño: la cuota fija lo **sobrerrepresenta** de forma permanente. Defendible, pero hay que declararlo como decisión política, no como estratificación. |
| **Participación previa** (≥1 acto en 90 días): sin este eje el sorteo devuelve a los que ya están, porque los inactivos declinan más. | El más manipulable: definís "activo" y definiste el resultado. Y la cuota de inactivos importa gente sin contexto que abandona pronto. |
| **Género**: corrige el desbalance de tiempo de palabra. | Dato sensible (Ley 1581 — investigación 20): autodeclarado, opcional, con estrato `∅` y cuota propia para quien calla. Obligatorio sería ilegal y además falso: fuerza binarismo. |

**Regla:** máximo **dos ejes cruzados** para n ≤ 20; `semestre(3) × jornada(2)` ya son 6 estratos con cuotas de 2-3, y un tercer eje produce cuotas de 1 — un estrato de una persona es una anécdota con cuota. **Los estratos mal elegidos fabrican la representatividad que dicen medir**: elegir el eje es elegir qué diferencia cuenta políticamente, y eso lo decide la asamblea antes del sorteo.

### 1.3 Garantías de legitimidad ante los otros 280

1. **Sorteo verificable, no confiable.** Semilla commit–reveal con faro externo posterior al cierre (B.0.3): cualquiera calcula `hmac(semilla, "estrato|suID")` y comprueba su posición. Se publican padrón, cuotas, tickets y suplentes.
2. **Simetría de información.** Si el comité tiene un documento que la asamblea no tiene, dejó de ser muestra: es élite.
3. **Deliberación registrada, no transmitida.** El hilo se publica al cierre de cada fase —en vivo produce posicionamiento— e incluye las posiciones minoritarias que no prosperaron.
4. **Mandato escrito ex ante.** La asamblea aprueba pregunta exacta, plazo y si el producto es **recomendación** o **decisión**. Cambiarlo a mitad de camino invalida el cuerpo.
5. **Poder real, delimitado.** La recomendación pura mata la motivación; la decisión sin control es oligarquía sorteada. Punto medio: **el minipúblico decide y la asamblea revoca** con 2/3 de los votos emitidos, dentro de 14 días — se juntan firmas para frenar algo, no para que pase.
6. **Derecho de réplica.** Quien discrepa adjunta un voto particular al `Outcome`.

### 1.4 Diseño de la sesión deliberativa asíncrona

Cuatro fases, ~3 semanas. El sistema **no permite** actos de una fase en otra: es una máquina de estados, no una recomendación pedagógica.

**Fase 1 — Información (5 días).** Material curado y acotado (≤20 páginas). Prohibido opinar; la única acción es **preguntar**, y las preguntas fácticas se enrutan a quien pueda responderlas en público. No cierra hasta que toda pregunta tenga respuesta o un "no hay dato" explícito.

**Fase 2 — Escucha de posiciones contrarias (4 días).** Las posiciones se publican como `Statement` cortos, en **orden aleatorio por participante** y con **autoría oculta**; hay que valorar un mínimo antes de pasar a Fase 3 (compuerta, no consejo). Además, tarea de **reformulación**: escribir la mejor versión del argumento que menos le gusta, y el sistema se la muestra a quien sostiene esa posición para que marque "así es" / "no es eso". Es el único mecanismo con evidencia decente de reducir la distancia percibida.

**Fase 3 — Deliberación (7 días).** Se revela autoría. Hilo plano sin respuestas anidadas (Pol.is, investigación 01). Al cierre el sistema calcula las **afirmaciones puente** (consenso transversal entre grupos) y las entrega como insumo obligatorio de la redacción.

**Fase 4 — Redacción y cierre (5 días).** Dos o tres personas sorteadas entre quienes se ofrecen redactan el `Outcome`: borrador → 48 h de objeciones formales → versión final → decisión por el método configurado. El `Outcome` debe incluir qué se decidió, qué se descartó y por qué, qué supuestos quedaron sin verificar, y los votos particulares.

---

## 2. Reducción de sesgos en deliberación

Cada mecanismo compra una cosa y paga otra; ninguno debe estar siempre encendido.

**Autoría temporalmente oculta.** *Sesgo:* halo de autoridad, efecto Mateo, sesgo de género en la atribución de calidad argumental. *Efecto secundario:* impide detectar conflicto de interés, habilita al troll sin costo y disuelve la responsabilidad; en grupos pequeños el estilo desanonimiza igual y se paga el costo sin el beneficio. *Fase:* **Fase 2** y primera valoración; **se revela siempre** al abrir Fase 3 y el registro permanente es nominal. Seudonimato con vencimiento anunciado, nunca anonimato definitivo.

**Orden aleatorio de presentación.** *Sesgo:* primacía y recencia; ventaja acumulativa del que publicó primero (los primeros aportes reciben más votos por posición, no por calidad). *Efecto secundario:* rompe la conversación —no se puede citar "el aporte anterior"— y complica marcar lo leído. *Fase:* **Fase 2**, sobre `Statement`; nunca en el hilo de Fase 3, donde el orden cronológico es información, ni en la lista de iniciativas, donde es prioridad operativa.

**Resultados parciales ocultos hasta el cierre.** *Sesgo:* cascada informacional, arrastre, espiral del silencio, voto estratégico de última hora. *Efecto secundario:* el ocultamiento es **desigual** — el grupo organizado hace su conteo por WhatsApp y sabe dónde está parado; el estudiante suelto no. No elimina la información: la privatiza y se la da al mejor coordinado. *Fase:* durante la votación se publica el **nivel de participación** (por estrato) pero no la distribución.

**Separación entre calidad del argumento y popularidad del autor.** *Sesgo:* efecto Mateo estructural — la reputación acumulada se vuelve peso deliberativo permanente y produce una aristocracia de los antiguos. *Implementación:* ningún contador de reputación, seguidores o karma; ranking por **consenso puente**, no por votos totales. *Efecto secundario:* se pierde señal legítima — quien lleva tres años en bienestar **sí sabe más**; compensa que la experiencia entre como **evidencia adjunta y verificable**, no como estatus. *Fase:* permanente, en el modelo de datos.

**Voto secreto.** *Sesgo:* conformidad pública, presión de pares en un grupo donde todos se van a volver a ver, retaliación. *Efecto secundario:* destruye la rendición de cuentas y es **incompatible con la democracia líquida** — si delegué mi voto, tengo derecho a saber cómo se usó. *Regla:* secreto cuando la decisión recae **sobre personas** (elegir, sancionar, repartir un recurso escaso); público cuando recae **sobre reglas o compromisos** que alguien deberá ejecutar. Y **el voto que carga peso delegado nunca puede ser secreto**.

---

## 3. Teoría de sistemas e inteligencia colectiva aplicada

### 3.1 Teoría del cambio como formulario, no como examen

La cadena canónica (problema → supuestos → actividades → productos → resultados → impacto) es correcta e **inusable** tal cual: el léxico de la gestión de proyectos le comunica a un estudiante de filosofía que este no es su terreno y que va a ser evaluado. Reglas: nada de ese léxico en pantalla; una pregunta por pantalla; **sólo dos obligatorias** (la 1 y la 11), con "todavía no sé" siempre válido y guardado como hueco que genera tarea posterior; el sistema **no corrige**, muestra ejemplos de la memoria; y al final arma la cadena en **una sola frase**.

**Preguntas literales de la interfaz:**

*Arranque*
1. «En una frase: ¿qué está pasando que no debería estar pasando?»

*El problema*
2. «¿A quiénes les pasa esto? Nombralos lo más concreto que puedas: no "los estudiantes", sino "quienes tienen clase después de las 6 p.m.".»
3. «¿Cómo te diste cuenta? Contá el hecho concreto que te lo hizo ver.»
4. «¿Desde cuándo pasa? ¿Hubo algo que lo empeorara o lo mejorara en ese tiempo?»
5. «Si nadie hace nada, ¿qué va a pasar de aquí a un año?»

*Por qué pasa (causas y supuestos)*
6. «¿Por qué creés que pasa? Escribí una causa por línea, las que se te ocurran.»
7. (por cada causa) «Esto que escribiste, ¿lo viste, te lo contaron, o lo estás suponiendo?»
8. «¿Qué tendría que ser cierto para que tu explicación funcione? Por ejemplo: "que la gente sí quiere venir si le avisan con tiempo".»
9. «Si eso que estás suponiendo resultara falso, ¿qué parte de tu plan se cae?»
10. «¿Quién podría no estar de acuerdo con esta explicación? ¿Qué diría?»

*Qué van a hacer*
11. «¿Qué van a hacer, concretamente? Escribí acciones que empiecen con un verbo: convocar, redactar, montar, conseguir.»
12. «¿Quién hace cada una? Poné un nombre, no un cargo. Si todavía no se sabe, escribí "falta".»
13. «¿Para cuándo estaría hecha cada una?»
14. «¿Qué necesitan que hoy no tienen? (un salón, plata, un permiso, un dato, alguien que sepa de algo)»
15. «¿Quién tiene que decir que sí para que esto pueda pasar?»

*Qué va a quedar hecho*
16. «Cuando terminen, ¿qué va a existir que hoy no existe? Algo que se pueda señalar: un documento, un horario nuevo, tres talleres dictados, una lista publicada.»
17. «¿Cómo se cuenta eso? (cuántos talleres, cuántas personas, cuántas páginas)»

*Qué cambia en la gente*
18. «¿Qué van a hacer distinto las personas que nombraste arriba, que hoy no hacen?»
19. «¿Cómo nos daríamos cuenta de que eso cambió, sin preguntarle a nadie del equipo que lo hizo?»
20. «¿Cuánto sería "suficiente"? Poné un número aunque sea a ojo — y marcá que es a ojo.»
21. «¿En cuánto tiempo esperás verlo: un mes, un semestre, dos años?»

*Para qué, al final*
22. «Si esto sale bien y se sostiene tres años, ¿qué sería distinto en el Instituto?»
23. «Eso que sería distinto, ¿depende sólo de ustedes? ¿Qué parte no controlan?»

*Riesgo y salida*
24. «¿Qué es lo más probable que salga mal?»
25. «¿Qué señal te haría decir "esto no está funcionando, hay que cambiarlo"?»
26. «¿Cuándo volvemos a mirar esto para ver cómo va?»
27. «¿Alguien ya intentó algo parecido acá? ¿Sabés qué pasó?» *(el sistema sugiere coincidencias de la memoria)*

*Cierre — la frase armada (generada, editable):*
> «Como **[1]** le pasa a **[2]** porque **[6]**, vamos a **[11]**, con lo que va a quedar **[16]**, para que **[2]** empiece a **[18]**, y a la larga **[22]**. Esto sólo funciona si **[8]**. Si vemos **[25]**, lo cambiamos.» — «¿Suena bien? ¿Falta algo?»

### 3.2 Los doce puntos de apalancamiento de Meadows, traducidos

De menor a mayor poder. **Casi todas las propuestas estudiantiles nacen en los niveles 12-10**, los más visibles y los más inertes; por eso el formulario pregunta: «¿esto cambia un número, cambia quién se entera de qué, o cambia una regla?».

| # | Meadows | Dónde intervenir |
|---|---|---|
| 12 | Constantes y parámetros | Subir el quórum de 20 a 25, pedir 5 firmas en vez de 3. Casi nunca cambia nada. |
| 11 | Tamaño de los amortiguadores | Fondo común para imprevistos, bolsa de horas. Estabiliza y vuelve lento. |
| 10 | Estructura de stocks y flujos | El salón sin ventanas donde nadie quiere reunirse; que todo pase por un único cartel. |
| 9 | Longitud de los retrasos | Que una petición al Consejo tarde 4 meses: cuando llega, quien la hizo se graduó. |
| 8 | Fuerza de los bucles de balance | Revisión trimestral de acuerdos incumplidos **con consecuencia real**. Sin esto nada se autocorrige. |
| 7 | Ganancia de los bucles de refuerzo | Los activos reciben más avisos → participan más → reciben más. Hay que **debilitarlo**. |
| 6 | Estructura de los flujos de información | Publicar el presupuesto del Instituto y las actas del Consejo. La mejor relación beneficio/costo. |
| 5 | Las reglas | `Outcome` obligatorio para cerrar; que una propuesta sin responsable no pase a "aprobada". |
| 4 | Poder de cambiar la estructura | Que la asamblea reforme su reglamento y cree espacios sin autorización administrativa. |
| 3 | Los objetivos del sistema | Si el objetivo tácito es "que el Instituto se vea participativo", ningún cambio de reglas sirve. |
| 2 | El paradigma | De "el estudiante es usuario de un servicio" a "el estudiante es cogobernante". |
| 1 | Trascender el paradigma | Aceptar que este diseño deliberativo es provisional y será reemplazado. |

### 3.3 Stocks, flujos y bucles

- **Confianza.** Entra por acuerdos cumplidos, sorteos verificables y decisiones ejecutadas; drena por incumplimientos sin explicación y procesos que terminan en nada. El más lento de reponer.
- **Capacidad.** Entra por haber hecho cosas y por acompañamiento; drena por **graduación**: ~20% anual, estructural. Si vive en cabezas, el sistema pierde un quinto de su competencia al año.
- **Memoria.** Entra por `Outcome` redactados y evaluaciones cerradas; drena por memoria escrita pero no **recuperable**: un archivo que nadie encuentra es sedimento, no memoria.
- **Deuda de acuerdos incumplidos.** El stock negativo: cada `Initiative` vencida sin informe. Drena por cumplir **o** por declarar el fracaso; nunca por olvido — ahí se vuelve desconfianza.
- **Atención.** Presupuesto fijo y pequeño; quien lo agota no paga el costo: la gente silencia toda la plataforma.

**Bucles.** Virtuoso: participar → ver el efecto → confiar → participar; sólo cierra si "ver el efecto" es rápido (con retraso largo, punto 9, no engancha). Vicioso: activos hipervisibles → los nuevos se sienten fuera de lugar → no participan. De balance: deuda de acuerdos → revisión con consecuencia → deuda baja. Sin él no hay autocorrección.

### 3.4 Cierre del bucle de aprendizaje

1. **La evaluación es un evento programado.** Al aprobar la iniciativa se fija `review_at` (pregunta 26); llegada la fecha pasa a `pendiente_de_evaluación`. **Ninguna propuesta nueva del mismo responsable se abre con una evaluación vencida** — la única presión que funciona sin sanciones.
2. **Evaluación corta, contrastada contra lo declarado:** «¿pasó lo que esperabas (pregunta 18)?», «¿el supuesto de la 8 resultó cierto?», «¿qué te sorprendió?», «¿qué harías distinto?», «¿qué le dirías a quien intente esto el año que viene?».
3. **`Learning` como entidad de primera clase**: (origin_initiative_id, claim, condiciones de aplicabilidad, categorías, nivel_de_confianza {anécdota | repetido | verificado}, autor, fecha), con el `claim` en condicional: «Si convocás con menos de una semana en parciales, no llega nadie de séptimo en adelante».
4. **Recuperación en el momento correcto.** Al responder las preguntas 2, 6 y 11 el sistema busca `Learning` por categoría y similitud léxica y los muestra **al lado del campo**, no en "documentación".
5. **Los aprendizajes envejecen.** Cada `Learning` mostrado registra si fue útil: los que nadie marca en 18 meses van a archivo, los confirmados suben de `anécdota` a `repetido` a `verificado`.
6. **El fracaso se registra igual que el éxito**: una iniciativa fallida con un `Learning` decente vale más que una exitosa sin evaluar.

---

## 4. DAOs y gobernanza on-chain — lectura escéptica

**Lo que el ecosistema DAO sí resolvió**, y vale robar sin cadena ni token:

- **Verificabilidad pública del proceso.** Un registro append-only encadenado por hashes demuestra que el acta no se editó después. Valioso donde la desconfianza hacia la administración es el estado por defecto.
- **Reglas ejecutables antes del hecho.** La configuración de una decisión (umbral, participación mínima, padrón, plazos) se congela en un `configHash` **antes** de abrir: nadie sube el umbral después de ver los votos. No requiere blockchain sino disciplina de inmutabilidad, que la spec 30 ya impone.
- **Resistencia a la captura administrativa.** Con el registro firmado y anclado fuera del servidor que controla el equipo técnico, ni ese equipo ni la Facultad pueden reescribir la historia sin que se note.

**Lo que rechazamos sin matices.** Tokens de gobernanza en cualquier forma. Voto ponderado por tenencia, antigüedad monetizable o *stake*. Quórum comprable. Delegación con mercado secundario. Cualquier activo transferible que represente poder político: si el poder es transferible es comprable, y 300 estudiantes con desigualdad económica real producen plutocracia en un semestre. También la **irreversibilidad como valor** — "el código es la ley" convierte cada bug en constitución, y la historia de las DAOs es la de los forks de emergencia que probaron que la comunidad siempre fue soberana sobre el código. Y la dependencia operativa de cualquier cadena: comisiones, wallets, claves perdidas y una alfabetización cripto que excluiría a más gente de la que incluiría.

**Dónde sí sirve un ancla criptográfica sin criptomoneda:**

1. **Semilla de sorteo con faro externo** (B.0.3): el hash de un bloque de Bitcoin de altura anunciada como aleatoriedad impredecible e inmanipulable. No se compra ni se transfiere nada: se **lee** un número público. Es el uso honesto de una blockchain — un reloj aleatorio compartido.
2. **Cadena de hashes del log + sellado de tiempo.** Cada evento encadena el hash del anterior; el raíz se publica semanalmente por un canal fuera del control del equipo técnico y se sella con OpenTimestamps o una TSA RFC 3161. Costo cero; nadie reescribe el pasado.
3. **Firma del `Outcome`.** Quien cierra una decisión la firma con una clave ligada a su identidad institucional: responsabilidad nominal, no criptoeconomía.

La distinción operativa: criptografía para **probar hechos**, jamás para **asignar poder**. El poder lo asigna la pertenencia al Instituto, y esa lista la mantiene una secretaría, no un contrato.

---

## 5. Antipatrones y evidencia de fracaso

**1. Caída de participación tras el entusiasmo inicial.**
*Síntoma:* pico en las primeras 3 semanas y meseta al 15-20% hacia el mes 3.
*Métrica:* retención por cohorte de alta (D7/D30/D90) y **tiempo hasta el primer efecto visible** — mediana de días entre el primer acto de un usuario y el momento en que produjo algo observable; si supera ~10 días, el bucle no cierra.
*Contramedida:* acortar el retraso (Meadows 9): plazo máximo de 14 días por decisión, acuse de recibo en 72 h, y **una sola cosa pendiente por persona** en la portada.

**2. Minoría hiperactiva que captura el discurso.**
*Síntoma:* los mismos ocho nombres en todos los hilos; los demás leen y callan.
*Métrica:* **índice de concentración de voz (HHI)** sobre autoría en ventana móvil de 30 días, `HHI = Σ sᵢ²`; `HHI > 0.15` equivale a menos de 7 voces efectivas. Complemento: cuota del decil superior (`p90_share`).
*Contramedida:* límite blando por hilo y día («¿cuál de tus tres aportes anteriores reemplaza este?»); y **derivación a minipúblico por sorteo cuando el HHI supera el umbral**.

**3. Fatiga de notificaciones.**
*Síntoma:* silenciamiento masivo, correos sin abrir, "esto no para de escribirme".
*Métrica:* opt-out acumulado por cohorte; **notificaciones por decisión efectiva** (enviadas ÷ decisiones cerradas); tasa de acción por tipo — todo tipo bajo 5% se elimina, no se "mejora".
*Contramedida:* presupuesto duro de atención (máximo N por persona y semana); digest asíncrono salvo lo que exige acción personal; y **nadie notifica al padrón entero salvo por decisión de la asamblea**.

**4. La plataforma como repositorio muerto.**
*Síntoma:* mucho contenido, cero movimiento; sirve para archivar, no para decidir.
*Métrica:* proporción de contenido con al menos una interacción en 90 días; edad mediana del contenido consultado; `stale_ratio` = documentos sin ninguna vista en 180 días.
*Contramedida:* recuperación contextual (§3.4.4), con la memoria dentro del formulario; y prohibición de documentos sueltos: todo cuelga de un problema, una propuesta o una iniciativa.

**5. Decisiones que nunca se ejecutan.**
*Síntoma:* actas impecables, realidad idéntica; "eso ya se decidió hace un año".
*Métrica:* **tasa de cumplimiento de acuerdos** = `Outcome` que llegaron a `ejecutada` o `cerrada_con_informe` en plazo ÷ total aprobados (ventana 180 días). Y el stock: **deuda de acuerdos** = número y antigüedad mediana de iniciativas vencidas sin informe.
*Contramedida:* ninguna decisión aprobada sin `Initiative` con responsable nominal y fecha (investigación 01); tablero público de deuda en la portada; y opción sin estigma de **declarar el fracaso y cerrar** — la deuda drena por reconocimiento o no drena.

**6. El fundador que se cansa y se va (bus factor político y técnico).**
*Síntoma:* una persona responde el 60% de las dudas, tiene todas las credenciales y es la única que sabe por qué las cosas son como son.
*Métrica:* **bus factor técnico** (mínimo de personas cuya salida deja una capacidad crítica sin cobertura: deploy, base de datos, DNS, cuentas); **bus factor político** (HHI sobre acciones administrativas en 90 días); y **semestres restantes del núcleo activo**: si la mediana baja de 3, hay transición inminente y nadie la prepara.
*Contramedida:* rotación obligatoria de roles con solapamiento; cuentas de rol con dos titulares mínimo, nunca credenciales personales; y cada decisión de diseño registrada como `Learning` con su razón, para heredar los porqués y no sólo las contraseñas.

**7. Captura por el grupo más organizado ideológicamente.**
*Síntoma:* votaciones que se resuelven en la última hora con bloques coordinados.
*Métrica:* **coordinación temporal** (`late_burst_ratio`: votos de la última hora sobre el total); **similitud de patrón de voto** entre pares (un bloque idéntico en 15 decisiones no es coincidencia); y participación en Fase 2 de esos miembros — la captura organizada vota mucho y delibera poco.
*Contramedida:* compuerta de deliberación (no se vota sin haber pasado Fase 2); **valoración por menciones** en vez de mayoría simple (un bloque disciplinado del 30% domina una mayoría fragmentada, pero no mueve la mención mediana); y derivar a minipúblico sorteado, que no se puede movilizar.

**8. El efecto "todo se vuelve una votación".**
*Síntoma:* se vota el color del afiche; nadie discute porque todo se resuelve contando.
*Métrica:* **razón deliberación/votación** (decisiones con ≥7 días de fase deliberativa ÷ total); **decisiones por semana** (más de ~3 es sobrecarga a esta escala); **tasa de unanimidad** (decisiones cerradas sin ninguna posición de desacuerdo o bloqueo) — por encima del 85% no es armonía: se vota lo obvio, o quien discrepa ya se fue.
*Contramedida:* umbral de apoyos para abrir votación formal; catálogo de qué **no** se vota (lo operativo lo decide el responsable y responde por ello); y consentimiento («¿alguien objeta?») por defecto para lo de bajo riesgo.

---

## 6. Cierre: las cinco métricas de salud democrática

Se calculan semanalmente, se publican a los 300 y se muestran **con su serie histórica**: el nivel importa menos que la dirección.

1. **Tasa de cumplimiento de acuerdos**, con su stock complementario, la **deuda de acuerdos**. Métrica maestra: mide si decidir sirve para algo. Bajo 0.5 sostenido, la plataforma es teatro y todo lo demás es decoración.
2. **Índice de concentración de voz (HHI)** sobre autoría, ventana de 30 días, alarma en 0.15. Mide si esto es un colectivo o un club con auditorio.
3. **Cobertura del padrón desagregada por estrato**: proporción del `Electorate` con al menos un acto significativo en 30 días, por semestre × jornada. El agregado engaña, el desagregado delata: 40% global con nocturna en 8% es una plataforma diurna que se cree de todos.
4. **Rotación del núcleo activo**: porcentaje del decil más activo del período anterior que ya no lo es, más porcentaje de participantes nuevos. Distingue estabilidad de oligarquía y anticipa el bus factor con semestres de margen.
5. **Razón deliberación/votación con tasa de unanimidad**. Mide si se delibera o sólo se cuenta, y si el disenso encuentra dónde expresarse o simplemente se fue.

Ninguna de las cinco mide "engagement". Las plataformas participativas mueren sanas de engagement y muertas de consecuencia.
