# ADR-0054: Procedencia del padrón — el denominador de todas las reglas es el único estado de gobierno sin historial

- **Estado:** Propuesto
- **Fecha:** 2026-08-23
- **Contexto de origen:** hallazgo de la sesión del 2026-08-23 al leer `services/api/src/http/identity.ts`, `services/api/migrations/0005_identidad.sql` y `packages/domain/src/electorate.ts`. Recoge y amplía la errata **E93** ya registrada en `docs/research/00-contradicciones-resueltas.md:2084` y en el comentario de cabecera de `services/api/src/constitution/index.ts:95-104`. Toca `GOVERNANCE.md` §7 y Fila 19, `THREAT_MODEL.md` T-18, ADR-0006, ADR-0007, ADR-0008, ADR-0009, ADR-0021 y ADR-0025.

> **Este ADR no decide. Recomienda.** Lo que está en juego —qué promete la plataforma cuando alguien ejerce el derecho de supresión— no es una cuestión técnica: es jurídica y política, y le toca a la comunidad y a un abogado, no a quien escribe código. Igual que el 0018, el 0019, el 0042 y el 0050, este documento **no manda** hasta que se acepte. Mientras tanto, sigue vigente lo que hay, que es lo que este documento describe como defectuoso.

## Contexto

### El hallazgo

El padrón —el censo de personas con derecho a decidir— es **el denominador de todas las reglas de decisión del proyecto**. «Dos tercios de 300 son 200», «tres cuartos son 225», «100 firmas directas», «la mitad del círculo»: los cuatro números salen del mismo sitio. `GOVERNANCE.md` §4 los fija y `packages/domain` los evalúa contra `Electorate.censusSize`, que es `members.length` (`packages/domain/src/electorate.ts:69`).

Y el padrón es **el único estado de gobierno que no está en el historial encadenado**. Vive en `identity.member`, una tabla mutable de la bóveda de identidad. No hay agregado, no hay cadena de huellas, no hay anclaje. Concretamente:

- **El alta no emite ningún evento.** `upsertMember()` (`services/api/src/http/identity.ts:132`) es un `INSERT INTO identity.member … ON CONFLICT (email_hash) DO UPDATE SET alias, roles, circles`. Escribe la pertenencia, el rol y los círculos, y no llama al event store. La ruta de acceso la invoca directamente: `services/api/src/http/app.ts:512`, dentro de `POST /auth/enlace`. **Entrar por primera vez es un alta en el padrón, y esa alta no deja rastro en ninguna parte.**
- **La tabla es mutable y la aplicación tiene permiso de mutarla.** `services/api/migrations/0005_identidad.sql:31` crea `identity.member` con `withdrawn_at timestamptz` nulable y sin restricción de monotonía (`:45`); `:145` concede `SELECT, INSERT, UPDATE, DELETE` sobre ella al rol `koinonia_app`. Es la asimetría deliberada de ADR-0008 —`governance` es append-only, `identity` se borra de verdad— pero alcanza también a la pertenencia, que es un hecho de gobierno y no un dato de contacto.
- **No hay continuidad versionada que delate un salto.** `congelarPadron()` (`services/api/src/http/service.ts:577`) pasa `registryVersion: 1` como constante literal (`:580`). El campo existe en el dominio, se valida como entero no negativo (`electorate.ts:149`) y entra en `configHash` (`packages/domain/src/config.ts:532`), pero **nunca se incrementa**. Dos padrones congelados con cinco días y sesenta bajas de diferencia declaran los dos `registryVersion = 1`.
- **`rollHash` sella el conjunto, no su origen.** `computeRollHash()` (`packages/domain/src/electorate.ts:97`) es `sha256(jcs({ memberIds: [...ordenados] }))` y `freezeElectorate()` (`:141`) lo calcula sobre lo que le entreguen. La cabecera del módulo lo dice sin ambigüedad (`:92-99`, `:134-140`): el padrón congelado es la única fuente de elegibilidad y el registro vivo «deja de importar para esta decisión, para siempre». Correcto —y por eso mismo, lo que se congele mal queda mal para siempre.

**Un dato que agrava lo anterior y que no estaba en la formulación inicial del hallazgo: ninguna línea de la aplicación escribe jamás `withdrawn_at`.** Las únicas escrituras sobre `identity.member` en todo `services/api/src` son el `upsert` de `identity.ts:139` y un `DELETE FROM identity.member` en `services/api/src/http/private-material-erasure.ts:271`, que es la supresión autoservicio. Todo lo demás son `SELECT`. Es decir: **hoy no existe camino de aplicación para dar de baja a nadie.** La baja del padrón —el acto que ADR-0025 A.2 y A.3 regulan con tanto cuidado, y que `GOVERNANCE.md` Fila 19 declara «un hecho verificable»— sólo puede ocurrir por SQL directo. No es que el rastro sea pobre: es que la única vía disponible es, por construcción, clandestina.

### El ataque, con pasos

1. Quien administra abre una sesión de base de datos. No necesita romper nada: tiene las credenciales, y para la baja ni siquiera hay una alternativa legítima que evitar.
2. Antes de abrir la votación, escribe sobre `identity.member`: pone `withdrawn_at` a una fecha pasada en quienes previsiblemente votarán en contra; inserta o reactiva a los afines; cambia `circles` para mover gente al círculo que le conviene, o `semestre`/`jornada` para sesgar el estrato de un sorteo.
3. Abre la votación. `congelarPadron()` lee la tabla en ese instante y `freezeElectorate()` fotografía exactamente esa lectura. El `rollHash` se calcula sobre el conjunto manipulado y queda dentro de `DecisionOpened`, encadenado y anclado. **A partir de aquí el fraude está protegido por el mismo mecanismo que protege la verdad.**
4. Restaura la tabla. El padrón vivo vuelve a ser el correcto. No queda ninguna diferencia observable, porque no había nada contra lo que diferir.

La aritmética. Bajar el censo de 300 a 240 baja los dos tercios de **200 a 160** y los tres cuartos de **225 a 180**. El atacante no sólo rebaja el listón: **además excluye a los 60**, que no pueden votar porque no están en el padrón congelado y cuya ausencia, por A.3 de ADR-0025, ni siquiera se nota como abstención. Es un ataque que opera sobre el numerador y el denominador a la vez, y su coste es una transacción SQL.

### Por qué congelar (ADR-0025) no basta

ADR-0025 es correcto y no se discute aquí. Cierra el **relleno administrativo** —matricular aliados cuando ya se conoce el marcador— y la **deserción** —retirarse en masa para tumbar el quórum—, y hace del quórum una proposición con valor de verdad. Pero los dos ataques que cierra son *posteriores* a la apertura.

Congelar **desplaza la ventana; no la cierra**. Las decisiones ya abiertas quedan protegidas de cambios posteriores, y a la vez **conservan para siempre cualquier padrón fraudulento congelado antes**. El congelado convierte una manipulación anterior a la apertura en un hecho permanente, anclado y verificable: exactamente lo contrario de lo que se quería. Y las decisiones futuras quedan igual de expuestas, porque cada apertura vuelve a leer la misma tabla mutable.

Dicho de otro modo: ADR-0025 garantiza que **el retrato no se retoca**. No dice nada sobre **quién posó**.

### Por qué el verificador independiente no lo ve

El verificador (`packages/verifier-cli`) comprueba que nadie alteró el evento, la cadena o el anclaje **después**. Su catálogo completo de hallazgos son 25 códigos (`packages/verifier-cli/src/hallazgos.ts:19-48`), repartidos en cuatro familias: el export en sí, la integridad interna (canonicalización, cadena, huecos, cola truncada, espina dorsal, cabezas), los checkpoints y el anclaje. **Ninguno de los 25 habla de la procedencia del registro**, y no por olvido: no hay contra qué comprobarla.

Ante un padrón fraudulento congelado limpiamente, el verificador saldría **verde**. El `rollHash` coincidiría con los miembros, el evento verificaría, la cadena cuadraría y el anclaje respaldaría el checkpoint. Certificaría, con toda corrección técnica, **una mentira coherente**.

El `rollHash` sí sirve para dos cosas reales, y conviene no despreciarlas: detecta la **sustitución posterior** del padrón y permite **probar inclusión** de una persona en un conjunto publicado. Lo que no hace —lo que no puede hacer— es **demostrar elegibilidad**: que quienes están en la lista tenían matrícula, y que quien los dio de alta estaba autorizado a hacerlo.

### Dos matices honestos

Dos cosas que la formulación alarmista de este hallazgo podría hacer creer, y que son falsas:

1. **El padrón histórico de cada votación no falta.** Cada decisión guarda su padrón **completo** —la lista de `MemberId` con sus círculos y sus estratos— dentro de `DecisionOpened`. Se serializa en `encElectorate()` (`services/api/src/decision/codec.ts:254-269`) y se rehidrata en `decElectorate()` (`:271-295`). Es un evento del ledger, encadenado y anclado como cualquier otro. Cualquiera puede reconstruir quiénes eran los electores de la decisión de octubre. **Lo que falta no es el padrón histórico: es la procedencia del registro vivo del que ese padrón se extrajo.**
2. **La supresión autoservicio sí deja eventos.** No es un `DELETE` mudo. Es un agregado propio, `pii_erasure`, con dos eventos: `PIIErasureRequested` en la secuencia 0, que autoriza y exige una sesión revalidada de diez minutos o menos, y **`PIIErased`** en la secuencia 1, que ejecuta (`services/api/src/http/private-material-store.ts:314-319`, ADR-0021). Eso está bien construido. Lo que no impide es una **baja clandestina por SQL**, que no pasa por ese camino y no deja nada.

## Lo que hay que decidir

La reparación técnica es evidente y no es la parte difícil: **un agregado de padrón event-sourced**. `MemberAdmitted`, `MemberWithdrawn`, cambios de círculo y de estrato, con una versión monotónica de verdad en lugar del `1` constante; el padrón vivo pasa a ser una **proyección reconstruida por replay**, y `congelarPadron()` deja de leer una tabla mutable para leer un estado derivado del historial. Se usa **sólo el `MemberId` aleatorio de 128 bits**, que es lo que R1/ADR-0006 y R2/ADR-0007 permiten expresamente: ADR-0007:21 declara que la prohibición **no** cubre las derivaciones del `MemberId` ya publicado en el padrón, «porque su preimagen ya es pública por diseño y no contiene información personal». Ni un correo, ni un nombre, ni una matrícula entran al ledger.

Y cada transición debería llevar **autorización externa o firma**, no un compromiso calculado por el servidor: un compromiso que produce y verifica la misma máquina que se quiere vigilar **sella su propia mentira**. Es la lección de ADR-0016 y del quórum 2 de 3 de anclaje, aplicada al padrón.

**El problema no es construir eso. El problema es qué significa entonces suprimir.**

Un agregado de padrón deja **un seudónimo permanente**: el `MemberId` de quien fue admitido y luego se retiró queda en el evento, encadenado y anclado, para siempre. Y ya queda hoy, además, dentro de cada `DecisionOpened` de las votaciones en que participó. **Un padrón verificable por eventos y el borrado absoluto de la pertenencia pasada son incompatibles.** No hay ingeniería que reconcilie las dos: hay que elegir cuál de las dos promete la plataforma.

### Opción (A) — la supresión es la destrucción irreversible del vínculo

Suprimir deja de significar «que no quede prueba de que esa persona existió» y pasa a significar **«que no quede forma de saber quién era»**: se destruye de manera irreversible el vínculo entre el `MemberId` y la persona —`DELETE` físico más `VACUUM FULL` en la bóveda, R3/ADR-0009, y destrucción de la DSK para cubrir backups—, y se conserva el seudónimo huérfano en el historial.

Es la postura que **ADR-0008 ya sostiene** —dos mundos sin clave foránea, y el único puente es el `MemberId`— y que ADR-0021 escribe con todas las letras: la supresión no altera eventos, y la identidad «falla en abierto» hacia un seudónimo estable. Elegir (A) es, sobre todo, **declarar lo que ya es**.

**Coste, sin suavizar:**

- Quien suprime **deja su `MemberId` en el padrón congelado de cada votación en la que participó**, y lo dejará también en el agregado de padrón. Eso es un rastro permanente de participación política.
- Ese rastro **no es opaco por sí solo**. Ver más abajo, en «Alternativas consideradas», por qué el argumento de que R1 y R2 lo vuelven inofensivo **es más débil de lo que parece**.
- Hay que **decirlo en lenguaje llano** en la pantalla de supresión y en el consentimiento, no en letra chica y no con jerga (ADR-0041). La frase honesta es incómoda: «se destruye para siempre la forma de saber que este identificador era tuyo; el identificador se queda».
- Si un abogado concluye que ese seudónimo sigue siendo dato personal bajo el art. 3 lit. c de la Ley 1581, **(A) no es una opción legal disponible** y hay que volver a esta mesa. Ver `## Riesgo jurídico`.

### Opción (B) — el borrado absoluto se mantiene, y la autenticidad se declara externa

Se conserva el borrado absoluto como promesa, y en consecuencia se **declara** que la autenticidad del padrón **no depende del registro** sino de una **autoridad externa cofirmante** —secretaría del Instituto, Círculo de Garantías, un testigo—: alguien fuera del servidor firma que el censo del día era ése, y esa firma es lo que sostiene el número.

Es la opción honesta si se prefiere no prometer lo que no se puede cumplir. Y tiene la virtud de no exigir código: exige una ceremonia y una firma.

**Coste, sin suavizar:**

- **Obliga a enmendar `GOVERNANCE.md`, que es la máxima autoridad del corpus, para retirar una promesa que hoy hace explícitamente.** §7 (`docs/GOVERNANCE.md:236`) dice, en la lista de «cómo se verifica que cumple, con mecanismos y no con promesas», que «todo acto administrativo es un evento público en el mismo historial que el resto». La tabla de `:230` dice que quien administra **no puede** «crear, eliminar o modificar miembros del padrón». Las dos cosas son falsas hoy. (B) las declara falsas para siempre.
- **Reubica la confianza; no la elimina.** El modelo de amenaza canónico dice que contra **A2** la estrategia no es prevención sino **detección** (`THREAT_MODEL.md` §0). Una cofirma externa no produce detección desde el registro: produce una segunda firma, cuyo modo de fallo es **A6** —un director presionando a quien cofirma— más **A5** —el cofirmante que rota y deja credenciales vivas—. Los dos actores están en la tabla de §2.
- La verificabilidad del padrón deja de ser una propiedad del sistema y pasa a ser una propiedad de una persona, en un proyecto cuyo principio 7 es que quien administra **no es soberano político**.

### Recomendación razonada: **(A)**, con la advertencia de que la decisión no está tomada

Se recomienda **(A)**. Cuatro argumentos, del más fuerte al más débil, y con lo que cada uno **no** demuestra:

**1. (B) ya es inalcanzable retroactivamente, así que la elección real no es la que parece.** Cada `DecisionOpened` **ya** contiene la lista completa de `MemberId`, encadenada y anclada fuera del servidor. Para satisfacer «que no quede prueba de que esa persona existió» habría que alterar o retirar esos eventos, que es literalmente **T-01** —el administrador reescribe la historia— y rompería los anclajes. Luego (B), tomada al pie de la letra, **ya no está disponible para nadie que haya participado en una decisión**. (B) sólo puede significar «borrado absoluto del registro **vivo**», que es justamente la parte donde vive el hueco de procedencia. Así que (B) no compra el borrado que promete y paga con toda la verificabilidad del padrón.

   *Lo que este argumento no demuestra:* que (A) sea buena. Demuestra que (B) no es lo que dice ser. Usar una exposición ya existente para justificar institucionalizarla sería un argumento de coste hundido, y no es lo que se afirma aquí: se afirma que **la opción (B) descrita no existe**, y que quien la elija estará eligiendo otra cosa sin decirlo.

**2. `GOVERNANCE.md` ya promete (A), y la máxima autoridad del corpus no debería estar mintiendo.** El §7 promete que todo acto administrativo es un evento del historial y que quien administra no puede tocar el padrón. Hoy eso es falso. **(A) hace verdadera la promesa; (B) obliga a retirarla.** Entre hacer cierto un documento normativo y enmendarlo para que deje de prometer, lo primero es preferible salvo que sea imposible —y no lo es: es un agregado más, del mismo tipo que los siete que ya existen.

**3. (A) admite endurecerse después; (B) no admite recuperar lo que destruye.** Un padrón por eventos se puede minimizar más adelante (menos atributos en el evento, estratos agregados, cofirma por transición). Una vez que se decide que la autenticidad del padrón es externa y no se escribe el agregado, **la procedencia de los años intermedios no se puede reconstruir**: no hay dónde buscarla.

**4. El seudónimo huérfano no es re-derivable desde el ledger. Cuidado: eso es menos de lo que suena.** R1/ADR-0006 hace el `MemberId` aleatorio de CSPRNG y R2/ADR-0007 prohíbe meter derivaciones de la identidad civil, así que **desde el identificador no se vuelve a la persona**: el ataque de diccionario sobre 300 candidatos está cerrado por construcción, no por coste.

   *Lo que este argumento no demuestra, y es importante:* **no cierra la re-identificación por intersección.** Un `MemberId` con sus círculos y sus estratos, cruzado con la fecha de un `PIIErasureRequested` público, con el tamaño del censo y con lo que cualquiera sabe del Instituto, puede volver determinable a una persona en un universo de 300. R1 y R2 cierran la **re-derivación desde el identificador**; **no** cierran la **inferencia desde los metadatos adheridos**. Quien recomiende (A) tiene que aceptar eso y minimizar lo que el evento de padrón lleva adherido, no negarlo. Este punto se corrigió tras una revisión adversarial que lo señaló, y se deja escrito porque la versión fuerte del argumento era falsa.

**La decisión no está tomada.** Este ADR queda en **Propuesto** porque lo que se elige aquí no es una técnica: es qué le promete la plataforma a alguien que pide que lo borren, con una sanción disponible que es el cierre definitivo de la operación. Lo decide la comunidad, informada por un abogado. **Hasta que se acepte, manda lo que hay:** el padrón sigue en `identity.member`, sin historial, y `THREAT_MODEL.md` T-18 queda corregido para que al menos **diga la verdad sobre lo que no está cubierto** (corrección del 2026-08-23).

## Alternativas consideradas

- **(C) Compromisos salados en lugar del `MemberId` desnudo.** En vez de guardar el `MemberId` en el padrón congelado, guardar `H(MemberId ‖ sal)` con la sal sólo en la bóveda; suprimir destruye la sal y pulveriza la traza longitudinal sin tocar el evento. Es la propuesta más seria contra (A), la levantó la revisión adversarial de esta sesión, y **se rechaza por tres razones, la primera de las cuales es decisiva**:
  1. **No resuelve la procedencia: la reproduce un piso más arriba.** Un compromiso que calcula el servidor sobre el conjunto que él mismo eligió sigue sin decir nada sobre si ese conjunto era legítimo. Sella el retrato, no acredita quién posó — que es **exactamente el error que este ADR le imputa a T-18**. Contra el ataque de los cuatro pasos de arriba, (C) es tan verde como el `rollHash` de hoy.
  2. **Destruye la verificación independiente, que es la propiedad por la que existe el proyecto.** La elegibilidad del escrutinio se resuelve por búsqueda binaria sobre `members[].memberId` (`packages/domain/src/electorate.ts:240`), y la delegación recorre `MemberId`. Con compromisos salados, comprobar quién podía votar exige las sales, es decir **exige la bóveda de PII**. Adiós a ADR-0001 —dominio puro, sin I/O, para que un tercero recompute cualquier escrutinio— y adiós al verificador de una sola orden, que dejaría de ser independiente del servidor. `THREAT_MODEL.md` §1.1 exige «detectabilidad de la mutación **por un tercero sin privilegios**»; (C) le pide privilegios al tercero.
  3. **Una supresión anularía decisiones pasadas.** Por ADR-0026 el resultado es un dato derivado y la discrepancia con lo recomputado dispara **anulación automática**. Destruida la sal, el padrón de esa votación deja de recomputarse: una persona ejerciendo su derecho tumbaría decisiones ajenas ya cerradas. Además, hacer que la legibilidad del ledger dependa de que sobreviva un secreto es justo el razonamiento que **ADR-0007 rechazó** por escrito: «el ledger es permanente e incondicional; todo secreto es temporal y condicional».
- **Dejarlo como está y documentarlo.** Es lo que hay hoy, y es lo que este ADR viene a hacer imposible de sostener en silencio. El hueco está registrado desde antes (E93) y no se cerró; documentarlo otra vez sin decidir es la tercera vez que se escribe el mismo hallazgo.
- **Firmar el padrón con doble firma antes de abrir, sin agregado.** Es la mitigación «Después» que T-18 ya contempla («doble firma del padrón por secretaría y un testigo antes de abrir»). Es (B) con otro nombre: sostiene el número con una ceremonia y no con el registro. Se considera compatible con (A) como refuerzo, **no** como sustituto.
- **Derivar el padrón de un registro institucional externo en el momento de abrir.** Trasladaría la procedencia a la Universidad. Choca con ADR-0012 y con ADR-0042: no hay convenio, no hay API institucional, y depender de ella para el censo es entregarle a la institución el control del electorado de la plataforma que existe para hacerle contrapeso.

## Riesgo jurídico — lo que decide un abogado, no este documento

El argumento de que un seudónimo cuyo vínculo fue destruido **deja de ser dato personal** y por tanto sale del alcance del art. 8 lit. e de la Ley 1581 **es una apuesta, no un hecho**, y quien recomiende (A) tiene que decirlo así.

- **Dónde es fuerte:** el vínculo informático directo se corta de verdad —`DELETE` físico más `VACUUM FULL` (R3), más destrucción de DSK para backups (ADR-0020)—, y el identificador es aleatorio y no derivado (R1), así que no hay re-derivación posible desde el ledger.
- **Dónde es una apuesta:** el art. 3 lit. c define dato personal como el que hace a la persona **determinable**, no sólo identificada. Seudonimizar no es anonimizar. Con 300 personas, los metadatos adheridos al `MemberId` congelado —círculos, estratos, la fecha pública de la solicitud de supresión— pueden bastar para determinar a una parte apreciable del censo por inferencia y contexto. Y el dato en juego es **orientación política**, sensible por el art. 5, cuya infracción tiene como sanción disponible el **cierre inmediato y definitivo** (art. 23 lit. d).

**`VERIFICAR` (abogado), tres preguntas concretas**, en la misma línea que las preguntas abiertas de ADR-0042:

1. ¿Un `MemberId` aleatorio cuyo vínculo con la persona fue destruido irreversiblemente es «dato personal» bajo el art. 3 lit. c, si sobrevive junto a círculo y estrato en un universo de 300?
2. Si lo es, ¿el deber de conservación del registro de decisiones colectivas constituye alguno de los límites del art. 8 lit. e («salvo deber legal o contractual de permanencia»)?
3. ¿Qué grado de minimización de los atributos adheridos al evento de padrón haría defendible la posición (A)?

## Consecuencias si se acepta (A)

- El padrón pasa a ser un agregado event-sourced con cadena de huellas y anclaje, y `GOVERNANCE.md` §7 deja de prometer algo que no ocurre.
- El ataque de los cuatro pasos deja de ser silencioso: alterar el censo exige emitir eventos que quedan en la cadena y en el checkpoint anclado. **No se previene —A2 tiene root— pero se detecta**, que es la propiedad que el modelo de amenaza pide contra A2.
- `registryVersion` pasa a ser la versión real del agregado, así que un salto de versión entre dos aperturas es visible y explicable.
- El verificador independiente puede, por primera vez, decir algo sobre el padrón que no sea «el conjunto no fue sustituido después».
- La supresión queda redefinida y **hay que decirlo en pantalla en lenguaje llano**, con el consentimiento actualizado.

## Consecuencias negativas aceptadas si se acepta (A)

- **El seudónimo huérfano es permanente y su exposición no es nula.** Es un rastro de participación política que sobrevive a la supresión, y en un instituto de 300 personas los metadatos adheridos pueden estrecharlo. Se acepta a cambio de que el censo sea auditable, y se mitiga minimizando lo que el evento lleva adherido — no negando el problema.
- **La promesa que se retira es la que más suena a derecho.** «Que no quede prueba de que existí» es lo que mucha gente entiende por borrarse. Decirle a alguien que eso no se puede cumplir es una conversación real, no un aviso.
- **No se cierra por prevención.** Quien tenga root podrá seguir escribiendo eventos falsos de padrón; lo que cambia es que **tendrá que escribirlos** y quedarán anclados. Sin cofirma externa por transición, un administrador que fabrica altas produce un historial coherente y falso, igual que hoy. **La cofirma es la mitad que hace de esto un control y no un registro**, y debe planificarse con el agregado, no después.
- Coste de migración: hay que sembrar el agregado con el padrón actual, y ese acto fundacional **no tiene procedencia** por definición. Hay que declararlo así, con fecha y con firma, en vez de fingir que la historia empieza limpia.

## Pruebas obligatorias si se acepta (A)

- **El alta emite evento:** entrar por primera vez por `POST /auth/enlace` produce un `MemberAdmitted` en el ledger, y el padrón vivo es la proyección de ese historial, no una tabla escrita a mano.
- **La baja tiene camino de aplicación:** existe una ruta que emite `MemberWithdrawn`, y `withdrawn_at` deja de ser una columna que sólo sabe escribir `psql`.
- **La proyección reconstruida coincide bit a bit** con el padrón vivo, y la discrepancia es un hallazgo, no un aviso (mismo patrón que ADR-0026).
- **`registryVersion` es monotónica** y dos aperturas separadas por una modificación del censo declaran versiones distintas.
- **El escenario del ataque, en positivo:** una prueba que altere el censo por fuera del agregado y comprobar que el verificador **lo denuncia**. Si el verificador sigue verde, la reparación no reparó nada.
- **La supresión no rompe el escrutinio:** ejecutar una supresión y recomputar un resultado anterior debe seguir dando el mismo resultado, exactamente. (Es la prueba que descarta (C) y debe seguir pasando con (A).)
