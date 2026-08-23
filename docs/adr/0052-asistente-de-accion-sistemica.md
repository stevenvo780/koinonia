# ADR-0052: El asistente de acción sistémica es un formulario event-sourced, y el puerto de IA no puede decidir *en el tipo*

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Contexto de origen:** `03-deliberativa-sistemas-antipatrones.md` §3.1 (las 27 preguntas literales),
  §3.4 (el bucle de aprendizaje) y §6 (las cinco métricas); principio 6 del proyecto; `ARCHITECTURE.md`
  §6 (`AIAssistantPort`, declarado y no implementado); ADR-0001 (dominio puro), ADR-0027 (aritmética
  exacta), ADR-0039 (sin reputación), ADR-0040 (sin métricas de actividad individual), ADR-0041 (sin
  jerga en la interfaz).

## Contexto

Una idea informal —«la sala de estudio cierra a las cinco y no alcanzamos»— tiene que poder llegar a
ser un plan con responsables y fecha de revisión **sin que quien la escribe sepa gestión de
proyectos**. La cadena canónica de ese oficio (problema → supuestos → actividades → productos →
resultados → impacto) es correcta e **inusable**: su léxico le comunica a un estudiante de filosofía
que este no es su terreno y que va a ser evaluado. §3.1 ya resolvió el problema redactando 27
preguntas en castellano de Colombia, con dos reglas duras —**sólo la 1 y la 11 son obligatorias**, y
«todavía no sé» vale siempre— y una frase final que arma la cadena entera.

Al mismo tiempo, `ARCHITECTURE.md` §6 lleva declarando desde hace tiempo un `AIAssistantPort` sin
implementar, con una restricción escrita en prosa: «nunca decide, nunca puntúa a personas, nunca
escribe en el ledger». Prosa es lo que no era: una restricción que sólo vive en una tabla de
documentación se incumple en la primera prisa, y la primera prisa llega con el primer adaptador.

El adversario aquí **no es** el administrador técnico del ADR-0051. Son dos, y ninguno actúa de mala
fe:

1. **El adaptador con prisa**, que devuelve un campo de más porque «así la interfaz queda mejor»: una
   puntuación de calidad, un booleano de «esto está listo», el identificador de la propuesta parecida.
   Cada uno de esos campos es una decisión tomada por una máquina y aceptada por una persona que ya no
   está decidiendo, está firmando.
2. **La acumulación**. Una IA que «sólo sugiere» pero cuyas sugerencias se aceptan casi siempre
   **gobierna de hecho**, sin haber violado ninguna regla.

## Decisión

**Un agregado `Assistant` event-sourced y puro en `packages/domain/src/assistant/`, con seis tipos de
evento, y un puerto `AIAssistantPort` cuyo tipo de retorno es incapaz de expresar una decisión o una
mutación.**

### (a) Las 27 preguntas son literales, y hay una prueba que lo comprueba contra el documento

`preguntas.ts` las copia carácter a carácter de §3.1. `test/assistant.test.ts` **lee el fichero de
investigación en tiempo de ejecución**, extrae las 27 con una expresión regular y las compara una a
una. Si alguien las «mejora», falla; si alguien cambia el documento sin cambiar el código, también.

Se les quitan sólo las comillas angulares con que el documento las cita —son su modo de citar, no
texto de pantalla— y las dos anotaciones que van **fuera** de la cita: «(por cada causa)» en la 7 y
«(el sistema sugiere coincidencias de la memoria)» en la 27. Ninguna es una pregunta; las dos son
información sobre **cómo** se hace la pregunta y viven como campos (`forma`, `muestraMemoria`).

Sólo la 1 y la 11 llevan `obligatoria: true`, y `PREGUNTAS_OBLIGATORIAS` se declara **aparte** y se
coteja en una prueba en vez de derivarse: si alguien marca una tercera, las dos discrepan y salta.
Derivarla habría dejado pasar ese cambio en silencio, y ese cambio es el que no debe pasar en
silencio.

### (b) La frase de cierre es una función pura, y por eso no puede desincronizarse

`fraseDeCierre(estado)` se calcula cada vez desde las respuestas y **no se guarda en ningún evento**.
Una frase guardada se desincroniza: alguien corrige la pregunta 11 tres días después y a partir de ahí
el sistema tiene dos versiones de lo que la gente acordó hacer, sin poder decir cuál manda.

Es también la parte más fácil de romper sin querer, así que la plantilla se comprueba **contra el
documento**: la prueba extrae la línea `> «Como **[1]** …»`, sustituye cada hueco por una marca,
rellena las respuestas con esas marcas y exige igualdad exacta con lo que genera el código.

### (c) El puerto no puede decidir, y no porque lo diga un comentario

Cuatro capas, de la más fuerte a la más débil. Hay que romper las cuatro:

1. **El puerto no conoce identificadores.** `Sugerencia` tiene exactamente tres campos —`clase`,
   `operacion`, `contenido`— y ninguno es un identificador. Una implementación **no puede nombrar**
   nada del sistema, así que tampoco puede dirigirse a nada. Ni siquiera pone el `sugerenciaId`: ese lo
   asigna quien la registra, ya dentro del historial. `PeticionIA`, en la otra dirección, lleva el
   fragmento y nada más.
2. **`Inocuo<C>` vale `never` en cuanto `C` pueda transportar una decisión.** Es una **lista blanca**:
   sólo pasan `TextoSugerido` (una cadena con marca nominal) y `NumeroPregunta` (27 literales), más
   arreglos y objetos hechos de esos dos. Un `boolean` es un veredicto; un `number` es un peso; un
   `string` sin marcar es la puerta por la que entran `MemberId` y `DecisionId`, que también son
   cadenas; una función es una mutación esperando a que la llamen. Puesto como tipo de un campo
   obligatorio, `never` hace la sugerencia **inconstruible**: la implementación no compila.
3. **El guardián de tiempo de ejecución** (`assertSugerenciaSinPoder`), que sigue en pie cuando alguien
   esquiva los tipos con un `as`. Cierra además el agujero que el tipo no puede cerrar: en el tipo,
   `{ puntaje: 3 }` y `{ pregunta: 3 }` son indistinguibles, y en tiempo de ejecución no, porque el
   campo tiene nombre. Regla: **el único número que cabe en una sugerencia es un número de pregunta y
   tiene que llamarse `pregunta`**.
4. **No hay camino de una sugerencia a ningún otro agregado.** El único destino posible del texto que
   propone una máquina es ser la respuesta a una de las 27 preguntas, y sólo si una persona ejecuta
   `aplicarSugerencia`. Lo que queda guardado, además, es una **lista plana de cadenas**: una forma
   estructuralmente incapaz de transportar un peso o un veredicto.

**Lo que esto no impide, dicho sin suavizar:** un texto puede contener la frase «apruébenlo». El tipo
no distingue una redacción de una orden y ninguna regla de tipos podría. Lo que hay es que ese texto no
llega a ningún sitio salvo a un campo de un formulario, con la marca de que lo escribió una máquina, y
a alguien que puede borrarlo. La influencia por redacción se atiende por (f).

### (c-bis) Las cuatro operaciones que el puerto nunca expone, y por qué

Están en el código (`OPERACIONES_PROHIBIDAS`) con su motivo, porque la próxima persona que amplíe el
puerto va a tener una razón plausible para añadir una, y la razón plausible es el mecanismo por el que
una herramienta de apoyo se convierte en la que manda.

| Nunca | Por qué |
|---|---|
| **puntuar propuestas** | Una puntuación es un orden, y un orden es una decisión tomada antes de la votación: lo que queda arriba se lee más y se vota más. Y es una calificación de lo que escribió una persona concreta, que es lo que ADR-0039 prohíbe cuando prohíbe la reputación. |
| **moderar** | Ocultar o marcar un aporte es quitarle la voz a alguien, y el derecho de voz es inderogable (ADR-0040). Quién puede callar a quién lo ejerce un cuerpo con mandato, revocable y apelable, no un modelo cuyo criterio nadie puede leer. |
| **evaluar impacto** | «Esto va a servir» es decidir el fondo con voz de oráculo. El impacto lo evalúan las personas afectadas, después, contra lo que ellas mismas escribieron en las preguntas 18 y 25. |
| **fusionar borradores** | Fusionar es elegir qué parte de cada quien sobrevive, y hace desaparecer la posición que perdió sin que nadie la haya retirado. La máquina, como mucho, avisa de que dos se parecen. |

Las siete que sí hay —estructurar, resumir, buscar parecidos, señalar contradicciones, proponer
alternativas, partir en tareas y explicar una regla— comparten forma: entra un fragmento de texto, sale
texto.

### (d) Procedencia sin vigilancia: quién escribió qué, y nadie contando rechazos

Tres reglas, y las tres las aplica el pliegue:

1. **`SugerenciaRecibida` lleva `actor: 'system'`**, y se exige. Si la oferta de la máquina estuviera
   atada a una persona, el historial permitiría calcular cuántas rechaza cada quien: una métrica de
   actividad individual, prohibida por ADR-0040. `registrarSugerencia` recibe `MetaDeSistema`, que **no
   tiene campo `actor`**: no hay dónde escribir ese nombre.
2. **`SugerenciaAplicada` lleva a la persona.** Aplicar es un acto suyo y la autoría es suya.
3. **No existe un evento de rechazo.** Que una sugerencia no se aplicara se sabe por **ausencia**. El
   agregado de lo no aplicado sirve para auditar a la máquina; no sirve para perfilar a quien la usó,
   porque no hay a quién atribuirlo.

Y el pliegue **coteja el texto aplicado contra el sugerido**: `SugerenciaAplicada` sólo entra si el
texto estaba literalmente entre los que aquella sugerencia ofreció. Sin ese cotejo, «lo sugirió la
máquina» sería una etiqueta que cualquiera se pone. Quien tome una sugerencia y la retoque antes de
guardarla no está aplicándola: está escribiendo, y se guarda como `RespuestaEscrita`, con su nombre
encima. La distinción no es burocrática: es la diferencia entre «lo dijo la máquina» y «lo dije yo
después de leer a la máquina», y sólo la segunda es autoría.

### (e) El modo sin IA es el modo por defecto, y consentimiento antes de que nada salga

**Sin proveedor configurado el asistente funciona entero.** `PuertoDeIA = AIAssistantPort | undefined`
pone la ausencia en el tipo, no en una variable de entorno: quien recibe un puerto está obligado por el
compilador a tratar el `undefined`. El modo pasa de **generativo** a **estructural** y `cierre.ts` da
las 27 preguntas, los huecos, la siguiente pregunta y la frase. **Ninguna función de ese fichero
lanza**: si pedir ayuda sin proveedor fuera una excepción, la ausencia de IA sería una avería, y es una
decisión legítima de quien despliega (principio 10).

Lo que de verdad ayuda a alguien que nunca escribió un plan no es que una máquina se lo redacte: es que
le pregunten 27 cosas en orden y le muestren al final lo que acaba de decir en una sola frase. Eso es
aritmética de texto.

**Consentimiento.** Antes de que el texto de alguien salga hacia un tercero se le pregunta, diciendo **a
dónde va y qué se manda**. El destino se copia **por valor** dentro del evento —el patrón de las reglas
congeladas de ADR-0025 y ADR-0051— y el pliegue exige que el destino de cada sugerencia coincida con esa
copia: cambiar de proveedor, o cambiar la frase que describe qué se envía, **invalida** el
consentimiento anterior, porque nadie consintió a eso. Si la respuesta es no, se degrada al modo
estructural sin penalización y `sePuedePedirConsentimiento` pasa a `false` para siempre: **el sistema no
insiste**; la persona puede cambiar de idea por su cuenta.

`construirPeticion` es el único camino legítimo a una llamada y aplica los dos guardianes: consentimiento
para **ese** destino, y `assertPeticionSinIdentidad`, que busca en el texto cualquier cosa con forma de
identificador opaco **y** los identificadores concretos de ese borrador. Vive en el dominio y no en el
adaptador porque el adaptador es donde acaba habiendo prisa.

### (f) La tasa de aceptación se mide sobre el colectivo, jamás por persona

Una IA cuyas sugerencias se aceptan casi siempre gobierna de hecho. Hay que verlo, y para verlo hay que
contar. Lo que **no** se hace es contarlo por persona: «fricción adaptativa si un usuario acepta más del
75 %» es, con otro nombre, una métrica de actividad individual —ADR-0040—; produce un perfil de quién es
«dependiente de la máquina», y ese perfil, una vez existe, se usa para otra cosa. Además castigaría a
quien más ayuda necesita.

Se mide sobre el colectivo, con `Fraction` exacta (ADR-0027, porque el umbral tiene consecuencia), con un
mínimo de cinco borradores por el mismo argumento de k-anonimato de las métricas de salud, y **la
fricción se activa para todo el mundo por igual**.

**Dónde debería vivir:** en `packages/metrics`, como sexta métrica de salud. Es exactamente su forma
—entrada ya proyectada, sin identidad, salida agregada con umbral en fracción exacta— y ese paquete ya
tiene el sellado que revienta si una identidad se cuela. Aquí queda el **conteo por borrador**
(`ConteoDeSugerencias`, sin `borradorId` ni autor: no hay dónde ponerlos) y el umbral, porque es una
regla del asistente. La firma que habría que añadir allí es

```ts
export function informeDeAceptacion(entrada: EntradaAceptacion): Agregado<InformeAceptacion>;
```

con `EntradaAceptacion = { readonly conteos: readonly ConteoDeSugerencias[]; readonly ventana: Ventana }`.
No se hizo en esta entrega: `packages/metrics/**` está fuera del alcance de este trabajo (E85).

## Alternativas consideradas

- **Prohibir la IA por completo.** Coherente y defendible; pierde lo único que la máquina hace bien
  aquí, que es ordenar un texto largo en los campos a los que responde. Y el formulario ya funciona sin
  ella: la IA es el extra, no el producto.
- **La restricción del puerto como convención documentada** (lo que había). Es lo que se sustituye. Una
  regla que sólo vive en una tabla se incumple en la primera prisa.
- **Prohibir listas negras de campos en vez de la lista blanca de `Inocuo`.** Habría que acordarse de
  prohibir cada novedad. Con lista blanca, la novedad se rechaza sola hasta que alguien la autorice por
  escrito, que es la conversación que se quiere provocar.
- **Guardar la frase de cierre como texto editable**, que es lo que insinúa §3.1. Se desincroniza (E78).
- **Fricción por persona a partir del 75 % de aceptación.** Es vigilancia individual (E85 y §f).
- **Registrar cada rechazo de sugerencia.** También es vigilancia: se registra que la sugerencia
  **existió** y si se aplicó; lo no aplicado se sabe por ausencia.
- **Recortar sola la pregunta 7 cuando cambia la 6.** Sería la máquina editando a la persona. Se avisa
  (`desajustes`) y no se toca (E80).
- **Reabrir un borrador cerrado.** Cambiaría en retrospectiva un texto que otras cosas ya citaron.
  Corregir después de cerrar es abrir otro, como con las versiones de la constitución.

## Consecuencias

- El formulario existe y es **usable sin ninguna dependencia externa**; un colectivo puede autoalojar
  Koinonía sin contratar a nadie y no pierde nada del ciclo idea → plan.
- La procedencia queda en el historial: años después se puede reconstruir qué escribió una persona y qué
  le propuso una máquina, y **no** se puede reconstruir a quién le cae mal la máquina.
- Un adaptador que intente devolver una puntuación **no compila**. Uno que lo fuerce con un `as` no pasa
  el guardián. Uno que forje el historial no pasa el pliegue.
- Los huecos declarados («todavía no sé») son el insumo de las tareas posteriores del §3.1, y ahora son
  un dato consultable en vez de una intención.
- ADR-0041 se cumple en el sitio donde más importa: 27 preguntas y ocho rótulos sin una palabra de la
  jerga de gestión, comprobado por una prueba que busca la lista negra.

## Consecuencias negativas aceptadas

- **`buscar_parecidos` transporta texto de otras personas** y el dominio no puede comprobar que fuera
  público: no conoce el estado de publicación de nada. La obligación es del adaptador y está declarada
  (E84). Un despliegue que no pueda garantizarlo debe dejar el corpus vacío.
- **La autoría de los actos se comprueba en el pliegue, no en `access.ts`.** No hay un `ResourceKind`
  `'borrador'` porque ese fichero está fuera del alcance de esta entrega; la regla aplicada es la misma
  que `access.ts` llamaría `NOT_THE_OWNER`. Deuda declarada.
- **La tasa colectiva no se publica todavía**: aquí está el conteo y el umbral, no el informe (E85).
- **La pregunta 7 puede quedar descuadrada** si se corrige la 6 después de responderla. Se avisa y no se
  corrige solo (E80).
- **El vínculo acción ↔ responsable ↔ plazo no queda como dato**, porque las preguntas 12 y 13 son texto
  libre en el documento y se copian literales (E81). Convertir eso en tareas rastreables —principio 4—
  exige otra pasada, y probablemente una decisión sobre si se toca la redacción de §3.1.
- **Un texto sugerido puede contener una orden.** Ningún tipo lo impide. Lo que se acota es a dónde
  puede llegar ese texto, y la tasa colectiva es lo que vigila que la acumulación no se vuelva gobierno.

## Erratas y contradicciones detectadas

El registro venía por **E77** (ADR-0051). Estas son de §3.1, de `ARCHITECTURE.md` §6 y del propio
encargo.

| # | Dónde | Qué dice y por qué no puede ser | Cómo se resolvió |
|---|---|---|---|
| **E78** | §3.1, rótulo de la frase de cierre | «(generada, editable)». Las dos cosas juntas no se sostienen: editable **y guardada** se desincroniza en cuanto alguien corrige una respuesta; editable y **no** guardada no existe | La frase se genera y **editarla es editar las respuestas**, que es donde vive lo que se dijo. «¿Suena bien? ¿Falta algo?» sigue siendo la invitación a corregir, pero lleva al campo correcto en vez de a un texto paralelo |
| **E79** | §3.1 | «Sólo dos obligatorias (la 1 y la 11), con "todavía no sé" siempre válido» se contradice si «todavía no sé» cuenta como respuesta: la 1 se «respondería» con un hueco y la obligatoriedad no obligaría a nada | Se separan dos cosas que el documento junta: «todavía no sé» **se acepta siempre** —nunca se rechaza la entrada— y **no cuenta como respondida** para cerrar. Es lo único que hace verdaderas las dos frases a la vez |
| **E80** | §3.1, pregunta 7 | «(por cada causa)» no es una pregunta: son **N** preguntas, y N depende de la respuesta a la 6. Numerada como una sola es **inimplementable** como campo único. Y hay un segundo problema que el documento no ve: si se corrige la 6 después de responder la 7, la 7 queda descuadrada | `forma: 'por_linea'` con `porCadaLineaDe: 6`; la cardinalidad se valida en el pliegue **al escribir**. El descuadre posterior **se muestra** (`desajustes`) y no se arregla solo: recortar la 7 sería la máquina editando a la persona, e impedir corregir la 6 castigaría a quien está pensando. Consecuencia: «una pregunta por pantalla» no son 27 pantallas, son 26 + N |
| **E81** | §3.1, preguntas 12 y 13 | «¿Quién hace cada una?» y «¿Para cuándo estaría hecha cada una?» son, como la 7, **por cada acción** de la 11 — pero el documento **no** las marca así. Como texto libre, el vínculo acción ↔ responsable ↔ plazo queda en prosa, y el principio 4 pide que una decisión llegue a tarea con responsable **rastreable** | Se copian **literales**, que es lo mandado, y la tensión se declara. Estructurarlas exigiría cambiar su redacción, y esa es una decisión sobre §3.1, no sobre el código |
| **E82** | §3.1, preguntas 17 y 20 | La 20 pide «poné un número aunque sea a ojo — **y marcá que es a ojo**»: «marcá» es un control de interfaz, y el texto de una pregunta no puede llevarlo. La 17 («¿cómo se cuenta eso?») pide un modo de conteo que tampoco queda como dato | Ambas quedan como texto libre, literales. La marca de «a ojo» es deuda de interfaz declarada; sin ella, la 20 se responde en prosa y se pierde la distinción entre una cifra estimada y una medida |
| **E83** | §3.1 y §3.4.4 | «El sistema no corrige, **muestra ejemplos de la memoria**», y §3.4.4 lo concreta para las preguntas 2, 6 y 11. Pero `Learning` —la memoria— **no existe todavía** como agregado | `muestraMemoria` marca las cuatro preguntas donde iría (2, 6, 11 y 27). Importa decir una cosa: **mostrar lo que ya pasó es una búsqueda, no un modelo de lenguaje**, así que esa ayuda pertenece al modo estructural y funcionará sin ningún proveedor |
| **E84** | Encargo, «sólo viaja el fragmento» vs. `buscar_parecidos` | Detectar duplicados exige mandar también los textos con los que se compara, **que son de otras personas**. Las dos exigencias no caben enteras a la vez | `conQueComparar` sólo debe llevar material ya público. El dominio comprueba que no lleve identificadores y **no puede comprobar que fuera público**: no conoce el estado de publicación de nada. Es obligación del adaptador y queda escrita en el tipo. Sin garantía, corpus vacío |
| **E85** | Encargo, corrección (i) vs. lista cerrada de ficheros | La corrección (i) dice que la tasa colectiva «encaja en `packages/metrics`»; la lista de ficheros pone `packages/metrics/**` entre los prohibidos. Las dos instrucciones son del mismo encargo y no se pueden cumplir a la vez | Se cumple la lista: aquí quedan el conteo por borrador y el umbral; el informe agregado queda como **deuda declarada** con la firma exacta en §(f). No se duplicó nada, porque en `packages/metrics` no había nada que duplicar: sus cinco métricas no incluyen esta |
| **E86** | `ARCHITECTURE.md` §6, fila de `AIAssistantPort` | «Nunca escribe en el ledger» es correcto y, tal cual, incompatible con la procedencia: **algo** tiene que escribir que la sugerencia existió, o no hay forma de reconstruir qué propuso una máquina | Lo escribe **el sistema**, no el puerto: `SugerenciaRecibida` con `actor: 'system'`. El puerto devuelve un valor y no tiene acceso al historial —ni forma de nombrarlo—. La frase de la tabla debería precisarse; el fichero está fuera del alcance de esta entrega |
| **E87** | §3.1, plantilla de la frase | La plantilla pide infinitivo en el hueco **[11]** («vamos a *convocar*»), y la pregunta 11 lo pide explícitamente. Pero **[18]** («para que … empiece a *[18]*») recibe la respuesta a «¿qué van a hacer distinto las personas…?», que se contesta en forma conjugada («llegan más temprano»), y la frase queda mal construida | Se conserva la plantilla **literal**: es la que se validó con gente. La fragilidad se declara. Arreglarla exige reescribir la pregunta 18 o el conector, y las dos cosas son decisiones sobre §3.1 |

## Pruebas obligatorias

- **Las 27 preguntas se leen del documento** y se comparan una a una; también su numeración densa, su
  normalización NFC y que sólo la 1 y la 11 sean obligatorias;
- **la plantilla de la frase se extrae del documento**, se rellena con marcas y se exige igualdad exacta,
  incluido el orden de los huecos y que la 2 aparezca dos veces;
- ninguna pregunta contiene jerga de gestión (ADR-0041);
- **INV-A1** un borrador nunca queda cerrado con la 1 o la 11 en blanco, ni con «todavía no sé» en ellas;
- **INV-A2** la frase es determinista, no depende del orden en que se respondió y **no aparece en el
  historial**;
- **INV-A3** toda versión de toda respuesta procede de un evento cuyo actor es una persona, y el número
  de versiones es el de actos de persona aceptados, no el de sugerencias;
- **INV-A4** aplicar una sugerencia inexistente se rechaza; aplicar un texto que no estaba en ella,
  también;
- **INV-A5** la versión vigente es siempre la última escrita, y escribir a mano después de aceptar deja
  la respuesta en «mano» **sin borrar** la sugerencia del historial;
- **INV-A6** toda sugerencia del historial estaba cubierta por un consentimiento previo **a ese destino**;
  `construirPeticion` lanza siempre que el modo no sea generativo; tras un «no» no entra ninguna;
- **INV-A7** con el puerto nulo la frase, los huecos, el cierre y las respuestas son idénticos; la ayuda
  estructural responde para las 27 preguntas en cualquier estado y **nunca lanza**;
- **INV-A8** `SugerenciaRecibida` lleva `system` y ningún otro evento lo lleva; no hay ningún evento de
  rechazo;
- **INV-A9** la fricción se enciende exactamente en tres cuartos comparando enteros, y el conteo por
  borrador no lleva ni un identificador;
- **en el tipo**: una sugerencia con puntuación, veredicto, identificador de persona o función **no
  compila**; `Sugerencia` no tiene dónde poner un `sugerenciaId`, un `borradorId` ni un `decisionId`;
  `PeticionIA` no tiene dónde poner al autor ni su historial; ninguna operación prohibida cabe en
  `OperacionIA`. Se comprueba con anotaciones de error esperado, que `tsc` verifica sobre los tests;
- **en tiempo de ejecución**: el guardián revienta ante un número que no vaya bajo un campo llamado
  `pregunta`, ante un booleano, una función, un nulo o un símbolo, y señala el camino exacto;
- el pliegue rechaza un historial forjado con un evento de otro borrador, con la secuencia rota, con un
  borrador abierto por el sistema, con un número donde debería haber texto y con una operación prohibida;
- **la cobertura del generador está medida y escrita** en la cabecera del fichero de propiedades: 47
  borradores cerrados de 400 y 250 sugerencias ofrecidas. La primera versión daba **0 cerrados** y las
  invariantes del cierre pasaban sin haber visto el caso.
