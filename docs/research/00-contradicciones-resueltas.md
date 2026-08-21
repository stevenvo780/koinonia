# 00 — Registro de contradicciones del corpus de investigación

> **Qué es este archivo.** Los documentos de `docs/research/` los escribieron agentes distintos, en paralelo, sin un árbitro. Se contradicen entre sí en puntos que no son de matiz. Este archivo documenta **qué decía cada documento, en qué consistía el conflicto, cómo se resolvió y por qué**.
>
> Es **memoria del proceso**, no documentación de producto. Si dentro de dos años alguien se pregunta por qué el `MemberId` es aleatorio, o por qué no apostamos al borrado criptográfico, la respuesta está aquí y no hay que reconstruirla.
>
> **Fecha:** 2026-08-21 · **Autoridad:** las resoluciones **R1, R2 y R3** las tomó el arquitecto y son firmes. Las contradicciones **C4 en adelante** las detectó la revisión editorial del corpus; las que R1–R3 adjudican de forma derivada se marcan como **resueltas**, y las que exigen una decisión nueva quedan **pendientes** con la recomendación del editor, que no tiene autoridad para cerrarlas.
>
> **Tres partes, tres formas de encontrar un error.** La **parte 1** (R1–R3) son resoluciones del arquitecto sobre conflictos de fondo. La **parte 2** (C4–C20) la produjo una **revisión editorial**: leer el corpus y compararlo consigo mismo. La **parte 3** (E1–E8) la produjo **implementar el código**: `packages/crypto` escrito contra `10-ledger-inmutable.md`. Las tres encuentran cosas distintas, y la tercera encontró justo lo que las dos primeras no podían encontrar. Está argumentado en la cabecera de la parte 3, y es la conclusión más reutilizable de este archivo.

## Orden de precedencia normativa

Ninguno de los documentos declaraba una precedencia global, y los tres que se corrigen mutuamente lo hacían con criterios incompatibles (ver **C19**). Queda fijado:

1. **Resoluciones del arquitecto** (R1, R2, R3 y **E1–E8**) — este archivo. La **regla de tipos del ledger** (E1) es de obligado cumplimiento en todo DDL del repositorio, esté en el documento que esté.
2. **ADR** de `docs/adr/`.
3. `30-decision-engine-spec.md` — contrato de implementación del motor.
4. `20-normativa-datos-colombia.md` y `21-normativa-udea.md` — vinculantes en lo que afirmen **sobre la ley**, no sobre el diseño.
5. Documentos de investigación `01`, `02`, `03`, `11`.

---

# PARTE 1 — Las tres resoluciones del arquitecto

## R1 — `MemberId` aleatorio, nunca derivado

**Qué decía cada documento.**

| Documento | Afirmación |
|---|---|
| `30-decision-engine-spec.md`, DECISIÓN A.0 | `MemberId = base32(truncate128(HMAC-SHA256(claveInstitucional, documento)))`. Seudónimo **derivado** del registro institucional. |
| `02-sociocracia-ostrom.md`, principio 1 de Ostrom | «`MemberId` seudónimo estable **derivado del registro institucional**, para que el padrón sea publicable sin violar la Ley 1581». |
| `11-privacidad-y-voto-secreto.md` §1.2 (ADR-111) | Contradice a los dos: el `MemberId` derivado **rompe el borrado**, debe ser aleatorio. |

**El conflicto.** Dos documentos daban por sentada una construcción que el tercero identificaba como fatal. No era un matiz de redacción: era la misma columna definida de dos maneras incompatibles, y la spec 30 es el contrato contra el que se iba a implementar.

**Resolución (firme).** El identificador de miembro en el ledger es un **valor aleatorio de 128 bits generado con CSPRNG**, sin ninguna relación derivable con el documento de identidad, el correo ni ningún dato personal. La **DECISIÓN A.0 queda ANULADA**.

**Por qué.** Un identificador derivado es **re-derivable por cualquiera que posea el dato de origen**. Quien tenga la `claveInstitucional` y la lista de documentos de la UdeA reconstruye el mapeo `MemberId → persona` completo, aunque la bóveda esté vacía: el borrado sería ficción, y bajo la Ley 1581 un dato re-identificable sigue siendo dato personal. Además permite **confirmar pertenencia por diccionario**: con ~300 personas, quien sospeche que Ana participó calcula su `MemberId` y lo busca en el padrón publicado, sin romper nada.

Hay un tercer motivo, estructural: la `claveInstitucional` sería un secreto que tendría que sobrevivir tanto como el ledger —décadas—, y no se puede rotar, porque rotarla invalidaría los `MemberId` de las 299 personas restantes.

**Dónde se aplicó.** `30-decision-engine-spec.md` (DECISIÓN A.0 y apéndice de decisiones normativas), `02-sociocracia-ostrom.md` (principio 1), `20-normativa-datos-colombia.md` (§7.4.1, §7.4.4, §7.6 «SÍ puede entrar al ledger», RL-13), `11-privacidad-y-voto-secreto.md` (§1.2, confirmación).
**ADR:** [0006](../adr/0006-memberid-aleatorio-de-128-bits.md).

## R2 — Nada de hashes de identificadores en el ledger

**Qué decía cada documento.**

| Documento | Afirmación |
|---|---|
| `20-normativa-datos-colombia.md` §7.5 | Tabla de construcciones: `HMAC-SHA-256(k, correo)` con `k` en KMS → «**Sí**, resiste el diccionario, mientras `k` sea secreta». `Argon2id(correo, sal)` → «**Sí**». Ambas marcadas como admisibles. |
| `20-...` §7.6, «SÍ puede entrar al ledger» | «Compromiso del payload: `HMAC-SHA-256(k_KMS, payload)` o `Argon2id(payload, sal_única)`». |
| `11-privacidad-y-voto-secreto.md` §1.4 (ADR-114) | Todo commitment de dato enumerable usa `HMAC(pepper, Argon2id(dato, salt))`; el pepper es «lo que sostiene la seguridad». |

**El conflicto.** El corpus llegó a la conclusión correcta —`sha256(nombre)` es indefendible con 300 personas— y derivó de ella la equivocada: que **endurecer** el commitment lo vuelve publicable. Los tres pasajes convergían en autorizar la publicación de un identificador personal endurecido en un registro permanente.

**Resolución (firme).** Al Governance Ledger **no entra ningún hash, commitment ni derivación de un identificador personal**, con o sin sal, con o sin pepper, con o sin función lenta. El ataque de diccionario sobre un espacio de ~300 personas desaparece **por construcción, no por dificultad computacional**. Argon2id y el pepper siguen existiendo **para el PII Vault**, pero dejan de ser la línea de defensa del ledger.

**Por qué.** El cálculo del propio doc 11 ya mostraba que Argon2id compra minutos, no seguridad: 300 candidatos × 150 ms son 45 s en un núcleo y ~6 s en ocho. Pero el argumento decisivo es otro: **el ledger es permanente e incondicional; todo secreto es temporal y condicional**. Una filtración futura del pepper o de la clave del KMS reabriría retroactivamente todo el histórico de participación política de 300 personas, y el ledger —anclado externamente— no se puede purgar. Un control cuya vigencia depende de que un secreto sobreviva décadas no es un control: es una apuesta.

**Alcance, para que nadie lo sobreaplique.** Cubre identificadores de la **identidad civil** (documento, correo, nombre, teléfono). **No** cubre las derivaciones del `MemberId` aleatorio ya publicado en el padrón —el ticket de sorteo `hmac(semilla, "estrato|memberId")`, las pruebas de inclusión Merkle—: su preimagen ya es pública por diseño y no contiene información personal, así que no hay nada que enumerar. Sin esta precisión, una lectura literal de R2 rompería el sorteo verificable del §B.9, que es una pieza de legitimidad, no un descuido.

**Dónde se aplicó.** `20-...` (§2.3 correo y hash/compromiso, §3.2 regla 5, §7.3, §7.5 tabla completa, §7.6 fila 3 y tabla de admitidos, §8.2 punto 7), `11-...` (§1.4 completa, ADR-114, §1.6 tabla de prohibiciones).
**ADR:** [0007](../adr/0007-prohibicion-de-hashes-de-identificadores-en-el-ledger.md), [0022](../adr/0022-argon2id-y-pepper-solo-dentro-del-pii-vault.md).

## R3 — No apostamos jurídicamente al borrado criptográfico

**Qué decía cada documento.**

| Documento | Afirmación |
|---|---|
| `11-privacidad-y-voto-secreto.md` §1.3 (ADR-112) | Crypto-shredding como mecanismo de supresión: «suprimir = destruir la DSK». El `DELETE` físico aparecía como paso accesorio. |
| `11-...` §1.3, bloque «Corrección al documento 20» | Atribuía al doc 20 la afirmación de que «la SIC acepta esto como equivalente a la supresión física» y la refutaba. |
| `20-normativa-datos-colombia.md` §7.3 | «Respuesta honesta: no lo sé con certeza, y nadie lo sabe con certeza en Colombia». Regla práctica: no apostar la arquitectura a que será aceptado. |
| `20-...` §8.2 punto 7 y §8.3 | Prometían al titular: «destruimos la sal» / «destruimos la clave que los vinculaba al registro histórico», sin mencionar borrado físico. |

**El conflicto.** El análisis jurídico (§7.3) era correcto y prudente, pero **los textos que iban a leer los titulares prometían lo contrario**: que la supresión se materializa destruyendo una clave. Y el doc 11 construía el mecanismo central sobre esa base.

**Resolución (firme).** Queda **ANULADA** cualquier afirmación de que la SIC acepta el borrado criptográfico como equivalente a la supresión física: **no existe doctrina publicada que lo respalde**. La postura del proyecto es: ante una solicitud de supresión se **borra físicamente** el registro del PII Vault (`DELETE` real + `VACUUM FULL`), y el borrado criptográfico **se reserva a backups y réplicas**, donde el borrado físico es imposible. El punto queda marcado como **zona gris con la postura del proyecto explícita**.

**Por qué.** Así la defensa jurídica no depende de una interpretación no respaldada, sino de un hecho verificable: la fila ya no existe. El riesgo es asimétrico —la sanción disponible para el tratamiento ilícito de datos sensibles es el cierre inmediato y definitivo de la operación (art. 23 lit. d, Ley 1581)—, y no hay ninguna razón para asumirlo cuando el borrado real es perfectamente ejecutable en un almacén mutable.

**Dónde se aplicó.** `11-...` (§1.3 y pasos de `shred`, bloque de corrección al doc 20), `20-...` (§7.3 regla práctica, RL-13, §8.2 punto 7, §8.3 texto de autorización).
**ADR:** [0009](../adr/0009-borrado-fisico-en-el-pii-vault.md), [0020](../adr/0020-retencion-de-35-dias-y-re-shred-en-toda-restauracion.md).

---

# PARTE 2 — Contradicciones detectadas en la revisión editorial

## C4 — Cita fantasma: el doc 11 refuta una frase que el doc 20 nunca escribió

**Estado: resuelta** (por R3).

`11-privacidad-y-voto-secreto.md` §1.3 abría un bloque titulado «Corrección al documento 20» con esta cita: *«El doc 20 §2 afirma: "La SIC acepta esto como equivalente a la supresión física del dato personal."»*

**Esa frase no existe en el documento 20.** No está en su §2 ni en ninguna otra sección; la búsqueda literal sobre el corpus completo sólo la encuentra dentro de la propia cita del doc 11. El doc 20 §7.3 sostiene **exactamente lo contrario**, y con más cuidado: «respuesta honesta: no lo sé con certeza, y nadie lo sabe con certeza en Colombia», con argumentos a favor y en contra y una regla práctica que ya decía «no apostar la arquitectura a que el borrado criptográfico será aceptado».

**Por qué importa más de lo que parece.** Es un agente corrigiendo a otro sobre algo que el otro no dijo, y construyendo desde ahí una sección entera. El efecto práctico fue que **la posición correcta del doc 20 quedó presentada como si fuera el error a corregir**, y quien leyera sólo el doc 11 concluiría que el doc 20 es imprudente cuando es el documento más prudente del corpus. Es el modo característico en que se degrada un corpus escrito en paralelo: no por afirmaciones falsas sobre el mundo, sino por afirmaciones falsas sobre lo que dicen los demás documentos.

**Resolución.** Bloque reescrito en `11-...` §1.3: se deja constancia de que la cita era fantasma y se sustituye por la postura firme de R3. **Lección operativa: toda cita entre documentos del corpus debe incluir la sección exacta y ser verificable literalmente.**

## C5 — Seudónimos por proceso contra `MemberId` estable

**Estado: resuelta** (por R1).

| Documento | Afirmación |
|---|---|
| `20-normativa-datos-colombia.md` §7.4.4 | «**Seudónimos por proceso, no globales.** Un seudónimo distinto por deliberación, sin correlación entre ellos. Rompe el enlace longitudinal, que es el vector real de ataque.» Y en §7.6: «Seudónimo de actor **por proceso**, derivado con sal por proceso». |
| `30-decision-engine-spec.md` §A.2, parte C | `MemberId` único y estable: el padrón se publica como `MemberId[]`, el tope de concentración y el `HHI*` se calculan sobre identidad longitudinal. |
| `11-...` §1.5 | El seudónimo de visualización es **estable**: «dos propuestas de Ana siguen atribuidas al mismo autor, lo que preserva la coherencia del debate». |

**El conflicto.** El doc 20 pedía romper el enlace longitudinal; el doc 30 y el doc 11 lo requieren para funcionar. No son dos formas de decir lo mismo: son diseños excluyentes.

**Resolución.** Manda R1: **el `MemberId` es uno solo, aleatorio y estable por persona.** Un seudónimo por proceso es incompatible con tres piezas ya congeladas: (i) el padrón congelado publicado y su `rollHash` verificable; (ii) la unicidad del voto, garantizada por `PRIMARY KEY (decision_id, member_id)`; (iii) la delegación, el tope de concentración y el `HHI*`. Y, además, un seudónimo por proceso «derivado con sal por proceso» sería precisamente una derivación prohibida por R2.

**El coste se acepta y se declara:** el enlace longitudinal permanece, y en n≈300 un patrón de participación peculiar puede re-identificar por inferencia. Se mitiga con truncado temporal, umbral k en agregados y ausencia de texto libre en el ledger. No se elimina. El resto de la §7.4.4 del doc 20 —las otras tres mitigaciones— sigue vigente.

## C6 — El voto secreto exigido contra el voto secreto entregado

**Estado: pendiente. Decisión consciente ya tomada en ADR-0010, contradicción documentada.**

| Documento | Afirmación |
|---|---|
| `20-normativa-datos-colombia.md` §2.3 | Voto secreto: «El vínculo voto↔votante **no debe existir en ningún almacén**. Diseño: papeleta con credencial ciega o *nullifier*. **Ni el administrador con acceso total a la base puede reconstruir el vínculo.**» |
| `20-...` §2.1 | «Un voto secreto cuya vinculación con el votante existe en alguna tabla y solo está protegida por permisos **no es secreto**: es un voto público con control de acceso.» |
| `11-...` §2.4 (ADR-117) y §2.5 | «**El administrador del servidor puede, en principio, ver quién votó qué**, porque tiene acceso a ambas tablas. El esquema descansa en controles no criptográficos y en la confianza en esa persona.» |

**El conflicto.** El documento normativo fija un requisito estructural absoluto; el documento de diseño entrega, para el MVP, exactamente lo que ese requisito llama «un voto público con control de acceso». No es un desacuerdo de grado: el doc 20 usa esa frase para descalificar el diseño que el doc 11 propone.

**Estado real.** ADR-0010 asume la contradicción de frente: acepta el diseño de etapa 1 **y lo declara en la propia pantalla de votación** (ADR-0017), en vez de esconderlo. Las mitigaciones —separación de esquemas sin FK (ADR-0013), ausencia de marcas temporales y sellado por lotes (ADR-0014), triple anclaje (ADR-0016)— elevan el coste y dejan rastro, pero no lo impiden matemáticamente.

**Lo que queda pendiente y le corresponde al arquitecto o a la asamblea:** decidir si el requisito del doc 20 §2.3 se **degrada formalmente** para el MVP —con constancia escrita de que se hace a sabiendas— o si se **prohíbe votar en la plataforma** aquellos asuntos donde el secreto frente al administrador sea condición. El doc 11 apunta a lo segundo cuando dice «hay temas que deben votarse en papel», pero eso no está escrito como regla. Mientras no se decida, hay un requisito normativo formalmente incumplido.

## C7 — La urna criptográfica: peso muerto o destino

**Estado: resuelta** (por etapas; sin conflicto real tras explicitar el eje temporal).

| Documento | Afirmación |
|---|---|
| `01-decidim-loomio-polis.md` §1, «Descartamos» | «**Votings con urna criptográfica (ElGamal / Bulletin Board)**: no repartimos dinero y **no hay adversario con incentivo para atacar la integridad agregada a esta escala**. El costo de operación criptográfica supera el riesgo.» |
| `11-...` §2.2 y §2.4 (ADR-124) | Belenios es el destino de la etapa 2, y el motivo es preciso: el relleno de urna por el propio servidor. |

**El conflicto.** El doc 01 descarta la criptografía de urna **por principio y de forma permanente**; el doc 11 la pospone **por capacidad** y la fija como objetivo.

**Resolución.** Prevalece el doc 11 con el eje temporal explícito: no se implementa en el MVP (ADR-0010) y es el destino declarado de la etapa 2 (ADR-0018). El descarte del doc 01 se lee como «no en el MVP», no como «nunca».

**Pero el argumento del doc 01 es erróneo y conviene dejarlo señalado**, porque es la raíz de C18: sí hay adversario, y está nombrado en el doc 11 —**el administrador del servidor**—, además del grupo organizado del `03-...` §5.7. El coste de la operación criptográfica no supera al riesgo: simplemente excede hoy la capacidad del equipo.

## C8 — SSO institucional que no existe

**Estado: resuelta** (por ADR-0012).

| Documento | Afirmación |
|---|---|
| `01-decidim-loomio-polis.md` §1, «Descartamos» | «tenemos **SSO institucional** sobre un padrón de 300 personas conocidas. Todo el subsistema desaparece.» |
| `21-normativa-udea.md` §4.1 | «**Integrarse con el directorio institucional** (LDAP, SSO, OAuth de la Universidad) **sí requiere autorización formal**, y además crea una relación técnica que puede argumentarse como corresponsabilidad. **Recomendación: no hacerlo en el MVP.**» |

**El conflicto.** El doc 01 elimina un subsistema entero apoyándose en una capacidad que no existe y que el doc 21 recomienda expresamente no construir. Es el patrón más peligroso del corpus: **una decisión de diseño fundada en una API imaginada.**

**Resolución.** ADR-0012: autenticación por **enlace mágico al correo `@udea.edu.co`**, detrás de un puerto `IdentityProviderAdapter`. Verificar por dominio de correo no requiere permiso de nadie —es equivalente a comprobar que alguien controla una dirección— y no genera el riesgo de corresponsabilidad, que destruiría la base de licitud del art. 6 lit. c. Corregido en `01-...` §1.

**Nota de método:** el doc 21 se abre advirtiendo que es el documento con mayor riesgo de alucinación y marca casi todo con `VERIFICAR`. Esa disciplina es la que hizo detectable esta contradicción. El doc 01 no marcó nada.

## C9 — ¿Koinonía recolecta el documento de identidad?

**Estado: resuelta** (por R1 + ADR-0012), con una acción pendiente.

| Documento | Afirmación |
|---|---|
| `30-...` DECISIÓN A.0 (anulada) | Derivaba el `MemberId` del **documento**, lo que presupone recolectarlo. |
| `11-...` §1.1 | «Documento de identidad → Bóveda (cifrado, campo aparte). Identificación fuerte; nunca sale, ni en logs.» Lo da por recolectado. |
| `21-normativa-udea.md` §4.1 | El correo institucional es «el mecanismo **menos invasivo** disponible para acreditar la calidad de miembro **sin pedir documentos de identidad**». |
| `01-...` §1 | Descarta los handlers de DNI de Decidim. |

**El conflicto.** Dos documentos asumían la cédula en la base de datos y dos la evitaban explícitamente.

**Resolución.** Tras R1 el documento **ya no hace falta para nada**: el `MemberId` es aleatorio y la pertenencia se acredita por correo institucional. El principio de finalidad (art. 4 lit. b) obliga a no recolectar lo que no se necesita, y el dato menos arriesgado es el que no existe.

**Acción pendiente:** el `enrollmentTag` para detectar altas duplicadas se definió sobre el documento. Debe redefinirse sobre el **correo institucional normalizado**, que es el identificador que sí se recolecta. Hasta que se haga, la columna `documento` del PII Vault no debe crearse.

## C10 — ¿Qué se publica del padrón? `MemberId[]` o los miembros completos

**Estado: PENDIENTE — requiere decisión del arquitecto.**

| Documento | Afirmación |
|---|---|
| `11-...` §1.1, tabla de frontera | «Padrón congelado → Ledger, **sólo `MemberId[]`**. Necesario para verificar el escrutinio; sin nombres es publicable.» |
| `30-...` §A.2 | `rollHash = hash({ frozenAt, registryVersion, members })`, donde cada `EligibleMember` incluye `circles` **y `strata`**. |
| `03-deliberativa-sistemas-antipatrones.md` §1.3.1 | Para que el sorteo sea verificable «se publican **padrón, cuotas, tickets y suplentes**». |

**El conflicto, en concreto.** Si al ledger sólo entra `MemberId[]`, entonces **nadie fuera del servidor puede recomputar `rollHash`**, porque le faltan `circles` y `strata`: la verificación del padrón —que es la base del quórum, del tope de concentración y del sorteo— se vuelve un acto de fe. Si en cambio se publica el padrón completo, entran al ledger **cuasi-identificadores combinados** (programa, semestre, jornada, círculos por persona), que `20-...` §7.6 filas 6 y 8 y `11-...` §1.6 prohíben expresamente: en n≈300 la tripleta reidentifica.

Es una contradicción **estructural entre dos objetivos legítimos del proyecto**: verificabilidad pública del escrutinio y no reidentificación. No la resuelve ninguna de las tres resoluciones del arquitecto.

**Recomendación del editor (no vinculante).** Separar el `rollHash` en dos compromisos: uno sobre `MemberId[]` —publicable íntegro, suficiente para verificar quórum, unicidad y pertenencia— y otro sobre los atributos de estratificación, publicable **sólo en forma agregada** (tamaño de cada estrato, sin la asignación individual). La verificación individual del ticket de sorteo se resuelve con una prueba de inclusión entregada **a la persona sobre su propio estrato**, siguiendo el criterio que `20-...` §7.5 ya aplica a las pruebas Merkle. Requiere modificar `30-...` §A.2 y §B.9, así que **no se aplicó**: excede la autoridad editorial.

## C11 — El género como estrato: dato sensible dentro del padrón publicable

**Estado: PENDIENTE — requiere decisión del arquitecto. Es la variante más grave de C10.**

| Documento | Afirmación |
|---|---|
| `03-...` §1.2 | Propone **género** como eje de estratificación del sorteo y lo califica de «**dato sensible** (Ley 1581 — investigación 20): autodeclarado, opcional, con estrato `∅` y cuota propia para quien calla». |
| `30-...` §A.2 | `StratumKey` incluye literalmente `'genero'` entre sus ejemplos, dentro de `EligibleMember.strata`, que forma parte del padrón congelado. |
| `30-...` §B.9.a | Para verificar el sorteo, cada persona calcula `hmac(semilla, "estrato\|suID")` — **lo que exige conocer públicamente el estrato de cada `MemberId`**. |
| `20-...` §7.6 fila 6 | Prohíbe en el ledger «datos sensibles del art. 5 en claro: afiliación, **opinión política identificada**, salud, orientación sexual, origen étnico, convicciones religiosas». |

**El conflicto.** El mecanismo de legitimidad del sorteo (verificación individual del ticket) exige publicar la asignación `MemberId → estrato`. Si uno de los ejes es el género, eso significa **publicar un atributo sensible autodeclarado, ligado de forma estable a un identificador, en un registro permanente y anclado externamente**. La sanción disponible para el tratamiento ilícito de sensibles es el cierre definitivo de la operación.

Ni el doc 20 ni el doc 11 clasifican el género en sus tablas —simplemente no lo previeron—, y el doc 03 lo llama sensible citando al doc 20, que no lo dice. Es una **atribución cruzada sin respaldo**, del mismo tipo que C4.

**Recomendación del editor (no vinculante).** Tres opciones, en orden de preferencia: (a) **no usar género como eje de estratificación** —la regla del propio doc 03 es de máximo dos ejes cruzados para n ≤ 20, y `semestre × jornada` ya los agota—; (b) si se usa, mantener la asignación de estratos **fuera del ledger**, con verificación individual por prueba de inclusión como en C10; (c) publicarla sólo con consentimiento explícito y separado del titular para esa publicación concreta, lo que en la práctica hace inverificable el sorteo para quien no consienta. **No se aplicó ningún cambio:** exige decisión de arquitectura y, probablemente, consulta jurídica.

## C12 — Cómo se elige a una persona: valoración por menciones o sociocracia sin candidatos

**Estado: PENDIENTE — requiere decisión del arquitecto.**

| Documento | Afirmación |
|---|---|
| `30-...` DECISIÓN B.7.c | «`majority-judgment` es el método POR DEFECTO de Koinonía para toda decisión con 2 o más opciones sustantivas, y **el único permitido para elegir personas**.» Uso real citado: «elección de representantes estudiantiles». |
| `02-sociocracia-ostrom.md` §1.5 | «Elección sin candidatos»: nominación por pares con argumento, revelación diferida, ronda de cambio, **propuesta motivada del facilitador** —«no es aritmética»—, ronda de objeciones y consentimiento final. Y advierte: «**Una elección por mayoría oculta bajo apariencia de sociocracia es peor que una declarada.**» |
| `03-...` §1.1 | Para cuerpos deliberativos propone **sorteo estratificado**, no elección. |

**El conflicto.** Tres procedimientos distintos para el mismo acto, y uno de ellos se declara «el único permitido». No se pueden aplicar los tres.

**Recomendación del editor (no vinculante).** Son mecanismos para **actos distintos** y el corpus nunca lo dijo: el sorteo conforma cuerpos deliberativos (comités, paneles, minipúblicos); la sociocracia sin candidatos cubre **roles internos de círculo** con dedicación y criterios de desempeño definidos; la valoración por menciones cubre **cargos de representación externa** con varias candidaturas en competencia. Bastaría con acotar la DECISIÓN B.7.c a este último caso y decirlo. **No se aplicó:** modificar el alcance de una decisión normativa de la spec 30 excede la autoridad editorial. ADR-0028 registra la contradicción y declara explícitamente que **no** veta el procedimiento sociocrático.

## C13 — Decisiones sobre personas: ¿secretas o con nominación pública?

**Estado: PENDIENTE — corolario de C12.**

| Documento | Afirmación |
|---|---|
| `03-...` §2, «Voto secreto» | «**Regla:** secreto cuando la decisión recae **sobre personas** (elegir, sancionar, repartir un recurso escaso); público cuando recae sobre reglas o compromisos.» Motivos: conformidad pública, presión de pares «en un grupo donde todos se van a volver a ver», retaliación. |
| `02-...` §1.5, pasos 3 y 4 | «**Publicación simultánea** de todas las nominaciones **con sus argumentos**» y ronda de cambio sobre esas nominaciones públicas. |
| `30-...` D.1.b | Exige `minDirectParticipation` precisamente «para reformas estatutarias y **elección de personas**», y C.7.a prohíbe la delegación en voto secreto. |

**El conflicto.** El procedimiento sociocrático de nominación es **deliberadamente público** —su valor está en que los argumentos circulen y la ronda de cambio los use— y recae sobre personas, que es justo el caso donde el doc 03 exige secreto.

**Recomendación del editor (no vinculante).** Distinguir **nominar** de **decidir**: la nominación con argumento puede ser pública porque nominar a alguien es un acto positivo de baja represalia, mientras que la ronda final —y sobre todo cualquier objeción al ajuste rol–persona— debería poder ser secreta, que es donde aparece la presión de pares. Requiere decidir el modo de privacidad de cada fase del procedimiento del doc 02 §1.5, lo que hoy no está especificado en ninguna parte. **No se aplicó.**

## C14 — Hash de texto libre: SHA-256 desnudo contra commitment con clave

**Estado: PENDIENTE — señalado en ambos documentos.**

| Documento | Afirmación |
|---|---|
| `11-...` §1.1, tabla de frontera | «Comentario deliberativo → **Bóveda, hash en el Ledger**. El ledger guarda `sha256(jcs(texto))`.» |
| `20-...` §7.6, «SÍ puede entrar al ledger» | «Compromiso del payload: `HMAC-SHA-256(k_KMS, payload)`…» — y la fila 4 de «NUNCA» prohíbe el texto libre de intervenciones. |
| `02-...` §1, principio 6 de Ostrom | Para la mediación: «acuerdo privado registrado como **hash sin contenido**». |

**El conflicto.** Un `sha256` desnudo de un comentario admite **ataque de confirmación**: quien sospeche el texto —o lo tenga, por habérselo reenviado alguien— calcula su hash y confirma contra el ledger que esa intervención existió y de quién es, ya que el evento lleva `actor`. Con contenido que revela orientación política (dato sensible, art. 5), eso es exactamente lo que R2 elimina para los identificadores, aplicado a otro tipo de dato.

Nótese que el espacio de entradas de un comentario libre **no es enumerable** como el de 300 nombres, así que no es literalmente el mismo ataque; pero el atacante que **ya tiene el texto** no necesita enumerar nada.

**Recomendación del editor (no vinculante).** Aplicar al texto la misma lógica que R2 aplicó a los identificadores: **compromiso a valor aleatorio** `H(nonce)` con el `nonce` en el PII Vault, que es la construcción que el propio doc 20 §7.5 llama «la opción más limpia» y la que ya quedó como única admitida en su tabla de «SÍ puede entrar». La contradicción se dejó **señalada en los dos documentos** (`11-...` §1.1 y `20-...` §2.3) en lugar de resolverse, porque R2 no la cubre literalmente y la decisión es del arquitecto.

## C15 — El registro de consentimiento sellado en el ledger

**Estado: resuelta** (por aplicación directa de R2).

| Documento | Afirmación |
|---|---|
| `20-...` §3.2, regla 5 | «**Sellado temporal.** Incluir el `consent_record` en la cadena de hashes del ledger (solo el compromiso, no el contenido)… da fecha cierta oponible a terceros.» |
| `11-...` §1.1 y §1.6 | «`consent_logs` (IP, user-agent) → Bóveda. **Prohibida** en el ledger.» Y: «Cualquier ciphertext de PII → sigue siendo dato personal». |

**El conflicto.** El `consent_record` contiene `persona_id`, `ip_hash` y `user_agent_hash`. Un hash de ese registro es una **derivación de datos personales**, que es exactamente lo que R2 prohíbe en el ledger; pero la fecha cierta oponible a terceros es un requisito probatorio real (art. 8 lit. b y art. 17 lit. c).

**Resolución.** Se conserva el sellado y se cambia su forma: el compromiso sellado es `H(nonce)` con `nonce` aleatorio de CSPRNG guardado junto al `consent_record` en el PII Vault. Da la misma fecha cierta y el ledger no contiene ninguna función del dato. Aplicado en `20-...` §3.2.

## C16 — La abstención: ¿participa o sólo está presente?

**Estado: aparente. No es contradicción, pero lo parece y por eso se registra.**

| Documento | Afirmación |
|---|---|
| `01-decidim-loomio-polis.md` §2, «Descartamos» | «**Abstención contando para quórum.** Solo `acuerdo \| desacuerdo \| bloqueo` suman `votos_emitidos`; la abstención se registra como **presencia, no como participación decisoria**.» |
| `30-...` §D.1 | `E` = miembros representados, «**incluidas las de abstención explícita**». Y B.1.b: `abstentionPolicy` por defecto `exclude`, que la saca del **denominador del umbral**. |

**El conflicto es de homonimia, no de fondo.** «Contar» significa cosas distintas en cada documento: el doc 01 habla del **denominador del umbral** y el doc 30 del **quórum de participación**, que son dos cosas separadas. En el diseño resultante la abstención **sí** cuenta para el quórum (fuiste, miraste y decidiste no pronunciarte: participaste) y **no** cuenta para el umbral (`exclude` por defecto), que es exactamente lo que el doc 01 quería.

**Se registra igualmente** porque una lectura rápida produce un cambio de comportamiento erróneo, y porque «votos emitidos» aparece en ambos documentos con dos significados distintos sin que ninguno lo advierta. **Acción recomendada:** unificar el vocabulario —`participantes` para el quórum, `computables` para el umbral— en `packages/contracts`.

## C17 — Dos retenciones incompatibles para el mismo dato

**Estado: PENDIENTE — trivial de resolver, pero nadie lo notó.**

| Documento | Afirmación |
|---|---|
| `20-...` §2.3 | «Dirección IP, user-agent → **Retención ≤ 30 días**, solo para seguridad.» |
| `11-...` §1.3 (ADR-113) | Backups de bóveda y keystore: **35 días** de retención. |

**El conflicto.** Los `consent_logs` con IP viven en la bóveda. Una restauración de backup al día 34 **repone IPs de hasta 35 días de antigüedad**, incumpliendo el límite de 30 declarado en la clasificación de datos. La ventana es estrecha, pero el incumplimiento es real y es exactamente el tipo de detalle que aparece en una inspección.

**Recomendación del editor (no vinculante).** O se sube la retención declarada de IP a 35 días —alineándola con el ciclo de backup—, o `replayPendingErasures()` (ADR-0020) purga además todo `consent_log` con más de 30 días al restaurar. La segunda es preferible: mantiene la promesa hecha al titular.

## C18 — Dos modelos de amenaza incompatibles

**Estado: PENDIENTE — es la contradicción de fondo de la que se derivan C6 y C7.**

| Documento | Modelo de adversario implícito |
|---|---|
| `01-decidim-loomio-polis.md` §1 | «**No hay adversario con incentivo para atacar la integridad agregada a esta escala.** El costo de operación criptográfica supera el riesgo.» |
| `11-privacidad-y-voto-secreto.md` | El adversario principal es **el administrador del servidor**, y buena parte del documento está construida contra él: separación de esquemas, ausencia de timestamps, triple anclaje, custodios enfrentados. |
| `03-...` §5.7 y §5.6 | El adversario es el **grupo organizado ideológicamente** que vota en bloque en la última hora, y el **bus factor político** de quien tiene todas las credenciales. |
| `20-...` §6.3 y `21-...` §7 | El adversario es la **SIC** (sanción por tratamiento ilícito) y la **propia Universidad** (captura, reidentificación de participantes, riesgo disciplinario sobre estudiantes concretos). |

**El conflicto.** Cuatro documentos operan con cuatro adversarios distintos, y uno de ellos afirma que no hay adversario. Eso no es una diferencia de énfasis: **determina qué mecanismos se consideran sobrepeso**. El doc 01 descarta piezas enteras («no hay adversario») que el doc 11 construye precisamente contra el adversario que el doc 01 no ve.

**Por qué es la contradicción más importante del corpus.** Todas las decisiones de coste-beneficio en seguridad y privacidad se toman contra un modelo de amenaza. Sin uno compartido y escrito, cada documento optimiza contra un enemigo distinto y las decisiones resultantes son incomparables entre sí. C6 y C7 son consecuencias directas de esta divergencia.

**Recomendación del editor (no vinculante).** Escribir un documento de modelo de amenaza —`docs/threat-model.md`— con los actores explícitos (administrador del servidor, grupo organizado interno, Universidad, SIC, atacante externo oportunista, votante coaccionado por un par), lo que cada uno puede y quiere hacer, y **qué se defiende y qué se acepta como riesgo residual**. El `README.md` del repositorio ya lo anuncia como existente («ver `docs/` para … modelo de amenazas»), y **no existe**. Es, con diferencia, el hueco más grande del corpus.

## C19 — El corpus no declaraba quién manda

**Estado: resuelta** (por la tabla de precedencia al inicio de este archivo).

| Documento | Regla de precedencia que declara |
|---|---|
| `02-sociocracia-ostrom.md`, cabecera | «Donde discrepen, **manda el 30**; donde el 30 calle, manda este.» |
| `11-...`, cabecera | «Depende de `20-...` y `30-...`. **Donde contradice al doc 20, lo dice y lo argumenta.**» — y de hecho corrigió al doc 30 (DECISIÓN A.0) sin declararse autorizado a hacerlo. |
| `30-...`, cabecera | «Estado: **normativo**. Este documento es el contrato.» |
| `20-...` y `21-...` | No declaran ninguna. |

**El conflicto.** El doc 30 se declara contrato; el doc 02 lo acata; el doc 11 se declara subordinado al 20 pero **enmienda al 30**, que es el que manda sobre el 02. No hay un orden total: hay tres órdenes parciales que se cruzan. En la práctica esto significa que, ante dos afirmaciones incompatibles, **no había forma de saber cuál aplicar** — que es precisamente cómo se llegó a que R1, R2 y R3 hicieran falta.

**Resolución.** La tabla de precedencia del inicio de este archivo, replicada en `docs/adr/README.md`. **Regla operativa añadida:** un documento puede señalar una contradicción con otro de rango superior, pero **no puede resolverla**; la señala aquí y la resuelve el arquitecto.

## C20 — Tensión declarada, no contradicción: delegación contra desconcentración

`30-...` parte C construye democracia líquida, que **por naturaleza concentra peso** en pocas personas. `03-...` §3.2 (punto 7 de Meadows) identifica el bucle de refuerzo «los activos reciben más avisos → participan más → reciben más» y dice que hay que **debilitarlo**; §5.2 mide la concentración de voz con HHI y alarma en 0,15.

No es una contradicción —la spec 30 acota la concentración con caducidad, tope sobre censo y `HHI*` publicado (ADR-0029)—, pero **es una tensión permanente que ningún parámetro elimina**. Se registra para que quien revise el `HHI*` dentro de dos años sepa que el indicador no es una métrica de curiosidad: es el termómetro de una tensión que el diseño asumió a sabiendas.

---

# PARTE 3 — Errores detectados por la implementación

> **Qué es esta parte, y por qué está separada de la anterior.** Las contradicciones C4–C20 las
> encontró una **revisión editorial**: alguien leyendo el corpus con atención y comparando documentos
> entre sí. Los errores E1–E23 de abajo los encontró otra cosa: **alguien escribiendo el código**.
>
> Hay dos rondas, contra dos especificaciones distintas:
>
> | Ronda | Paquete | Spec | Errores | Pruebas en verde al terminar |
> |---|---|---|---|---|
> | 1ª | `packages/crypto` | `10-ledger-inmutable.md` | **E1–E9** — seis en la spec, dos incoherencias entre ADR, una divergencia elevada sin cerrar | 116 |
> | 2ª | `packages/domain` | `30-decision-engine-spec.md` | **E10–E23** — catorce, todos dentro de la spec | 229 |
>
> **Fecha:** 2026-08-21 · **Autoridad:** las resoluciones las tomó el arquitecto y son firmes. Cada
> una está aplicada en el punto exacto del documento donde vivía el error, con una nota
> **«Corregido tras la implementación (2026-08-21)»** que explica qué decía antes y qué rompía.
>
> **El dato acumulado, que es el hallazgo principal de esta parte: entre las dos especificaciones la
> implementación ha encontrado ya unos 20 errores que ninguna revisión por lectura detectó** —seis en
> la spec 10 y catorce en la spec 30—, y las dos habían pasado por la revisión editorial que produjo
> C4–C20 de la parte 2. No es un accidente de un documento flojo: es lo que se puede esperar de
> cualquier especificación no ejecutada, por buena que sea. Ver «El hecho metodológico» abajo y su
> confirmación en la segunda ronda.

## El hecho metodológico, que importa más que los ocho errores

**Ninguno de estos seis errores lo encontró una revisión leyendo la especificación. Los encontró
alguien implementándola.**

Conviene decir con precisión cuánta revisión había pasado antes. El documento 10 se escribió con
cuidado, cita RFC 6962 y RFC 8785 correctamente, dedica media página a explicar el ataque de segunda
preimagen y por qué hacen falta los octetos `0x00`/`0x01`, razona el CVE-2012-2459 de Bitcoin,
justifica por qué `BIGSERIAL` está prohibido y contiene una sección entera —«Lo que este diseño NO
garantiza»— dedicada a enumerar sus propias limitaciones con una honestidad poco común. Pasó por la
revisión editorial que produjo C4–C20 de la parte 2. **Y aun así**:

- La sección que dedica media página a cerrar el ataque de segunda preimagen (§6.3) contenía, en el
  código de ejemplo de esa misma sección, la línea que lo reabre (**E4**).
- La sección que declara el falso positivo de corrupción como la peor falla posible (§1.2) convivía
  con un DDL que lo garantizaba en la primera restauración de `pg_dump` (**E1**).
- El documento que exige pruebas de consistencia contra el primer checkpoint de la vigencia por ser
  «la que importa políticamente» (§7.4) traía un generador que devolvía basura exactamente en ese
  caso (**E2**).

El patrón se repite: **el error no está en lo que el documento ignora, está dentro de la sección que
demuestra dominar el tema.** Leer no lo detecta, porque al leer se verifica el argumento y el
argumento era correcto. Lo que fallaba era la correspondencia entre el argumento y las cuatro líneas
de código o las once líneas de DDL que había debajo. Esa correspondencia sólo se comprueba
ejecutándola.

Cuatro consecuencias prácticas, que valen más que los parches:

1. **Implementar temprano es una técnica de revisión, no una fase posterior.** Un documento de diseño
   sin código que lo ejercite es una hipótesis. La spec 10 tenía seis defectos y el más grave habría
   aparecido, en producción, como una acusación falsa de manipulación de la historia de la asamblea
   —el peor modo de fallo posible para este proyecto, y el que el propio documento identifica como
   tal—. El coste de encontrarlo implementando fue una tarde; el de encontrarlo en la primera
   restauración de un backup, la credibilidad del sistema.
2. **El fallo silencioso es la clase peligrosa.** Cinco de los seis (E1, E2, E3, E4, E6) **no lanzan
   ninguna excepción**: devuelven un hash distinto, un `slice` con índices negativos, un árbol sin
   prefijo o dos hashes honestos e incompatibles. Ninguna prueba de humo los ve. Sólo los ve una
   prueba que compare **contra vectores externos** —los del RFC, los de
   `certificate-transparency-go`— o contra una segunda implementación.
3. **Los casos límite del dominio son el `0`, el `1` y el `2⁵³`.** E2 es `m = 0`, E3 es `n ≥ 2³¹`, E6
   es «el primero de la serie». Los tres son el mismo error de método: la spec razonó el caso general
   y no escribió el degenerado. La regla que queda es que toda recursión declare su caso base en el
   texto, y todo tipo declarado `bigint` se ejercite por encima de `2³²`.
4. **Un parche puntual no cierra una clase de error.** E1 se presentó como «`actor` está mal tipado» y
   resultó ser una instancia de algo mucho mayor, que además afectaba a documentos que nadie estaba
   mirando (la urna del documento 11, la tabla de identificadores del documento 20). La corrección de
   fondo no es cambiar tres columnas: es la **regla de tipos del ledger** de §1.1-bis, que da un
   criterio para la columna que alguien añada dentro de dos años.

## E1 — `actor` incoherente entre §1.1 y el DDL: el falso positivo de corrupción, servido por la spec

| Documento | Qué decía |
|---|---|
| `10-...` §1.1 | `actor` es un «`MemberId`, 32 hex minúsculas»; `aggregateId`, «UUID v4 textual, minúsculas, con guiones» |
| `10-...` §3.1 (DDL) | `actor uuid`, `aggregate_id uuid` |

**El conflicto.** PostgreSQL **acepta** la entrada de 32 hex en una columna `uuid` —normaliza en
silencio— pero **devuelve siempre** la forma canónica con guiones, de 36 caracteres. Al rehidratar el
evento desde la base para reverificarlo, el `actor` ya no es el que se hasheó, la preimagen cambia, el
`eventHash` cambia, y el sistema declara **«historia alterada» sin que nadie la haya alterado**.

Es exactamente el **falso positivo de corrupción** que §1.2 describe como la primera y peor de las
tres fallas de la no-canonicalización, con el agravante de que ahí se atribuía a una restauración de
`pg_dump` o a un cambio de librería, y aquí lo causaba la propia especificación. Y su efecto social es
el que §1.2 anticipa: *«un verificador que grita corrupción cuando no la hay es peor que no tener
verificador: entrena a la asamblea a ignorarlo»*.

**Resolución.** `MemberId` y `aggregateId` son `CHAR(32)` con `CHECK (valor ~ '^[0-9a-f]{32}$')`. **Se
prohíbe el tipo `uuid` para ellos.** Aplicado en `10-...` §1.1 y §3.1, y propagado a `11-...` §2.4,
`20-...` §7, `THREAT_MODEL.md` §7 y `01-...`.

**Y, sobre todo, la regla general** —que es la resolución de verdad, porque el parche puntual habría
dejado vivas las otras cuatro columnas mal tipadas:

> **Regla de tipos del ledger.** Ningún valor que forme parte de la preimagen de un hash puede
> almacenarse en una columna cuyo tipo normalice su representación. Esto proscribe `uuid` (reescribe
> la forma), `timestamptz` (normaliza la zona horaria), `numeric` (normaliza ceros a la derecha) y
> **muy especialmente `jsonb`, que reordena las claves del objeto y destruiría la canonicalización
> JCS**. El `payload` se almacena como `text` o `bytea` con la forma canónica exacta que se hasheó; si
> además se quiere consultar, se guarda una copia derivada en `jsonb` marcada explícitamente como NO
> autoritativa.

Queda en `10-ledger-inmutable.md` **§1.1-bis**, con corolarios operativos y verificación en CI, y
replicada como norma de obligado cumplimiento en `ARCHITECTURE.md`.

**Al aplicarla al DDL completo aparecieron dos columnas más que nadie había señalado**, ambas en
preimágenes de hash:

| Columna | Estaba | Está | Qué rompía |
|---|---|---|---|
| `event.payload` | `jsonb` | `text` (+ `payload_idx` derivado) | `jsonb` no guarda texto: guarda un árbol descompuesto y lo reemite con las claves reordenadas por un criterio que **no** es el de JCS. **Destruye la canonicalización entera.** |
| `event.occurred_at` | `timestamptz` | `char(24)` | Devuelve `2026-08-21 03:14:00.1+00`, no `2026-08-21T03:14:00.100Z`: cambia el separador, cambia la zona **y trunca los ceros de los milisegundos** |
| `checkpoint.issued_at` | `timestamptz` | `char(24)` | Lo mismo, sobre la preimagen del `checkpoint_hash` |
| `urn.ballots.choice` (`11-...`) | `jsonb` | `text` (+ `choice_idx` derivado) | La papeleta **canonicalizada** guardada en un tipo que la descanonicaliza; rompe el `urnRoot` anclado y el recibo del votante |
| `anchor_attempt.receipt` | `jsonb` | `text` (+ `receipt_idx`) | Recibos de Rekor y DKIM se verifican sobre los bytes exactos del tercero; `jsonb` los reordena y deja el anclaje inverificable a mano |

`request_id`, `recorded_at` y `updated_at` **siguen** siendo `uuid` y `timestamptz`, y está bien: son
sobre o caché derivada, no entran a ninguna preimagen. La regla no es una fobia a los tipos ricos de
PostgreSQL; es una condición sobre **participar del hash**.

## E2 — `SUBPROOF` roto para `m = 0`: generador y verificador discrepaban en el primer checkpoint de cada vigencia

**El error.** `subproof` (§7.2) no tenía caso base para `m = 0`. Con `m = 0` la recursión bajaba
siempre por la rama `m <= k` hasta `n = 1`; ahí `m !== n`, así que calculaba
`1 << (31 - Math.clz32(0))`. Como `Math.clz32(0) = 32`, eso es `1 << -1`; JavaScript enmascara el
desplazamiento a 5 bits, con lo que `1 << -1 === 1 << 31 === -2147483648`. Con `k` negativo,
`slice(0, k)` y `slice(k)` reinterpretan el índice desde el final del arreglo y devuelven segmentos
arbitrarios. **La función no lanzaba: devolvía basura.**

**Por qué importaba.** El verificador de §7.3 **sí** contemplaba `m = 0`
(`if (m === 0n) return proof.length === 0`). Generador y verificador discrepaban, por tanto,
exactamente en el **primer checkpoint de cada vigencia** —el único con `m = 0`—, que es justo la
prueba que §7.4 declara «la que importa políticamente»: la que permite a cualquiera comprobar de un
tirón que toda la historia del semestre en curso sigue siendo la misma. Cada semestre habría fallado
su primera verificación, y con un modo de fallo (basura silenciosa, no excepción) que habría costado
días diagnosticar.

**Resolución.** Caso base explícito `m = 0 →` **prueba vacía**: el árbol vacío es prefijo de todo,
igual que en RFC 6962. Aplicado en `10-...` §7.2.

## E3 — `1 << (31 - Math.clz32(n - 1))`: aritmética de 32 bits en un dominio declarado de 64

**El error.** La fórmula para «la mayor potencia de dos estrictamente menor que `n`» sólo es correcta
para `2 ≤ n < 2³¹`. `Math.clz32` **trunca su argumento a 32 bits**, y `Number(n)` pierde exactitud por
encima de `2⁵³`. Mientras tanto, el DDL de §3.1 y §6.4 declara `leaf_index` y `tree_size` como
`bigint`. **El tipo decía una cosa y la aritmética hacía otra.**

**Por qué importaba.** No es una objeción teórica sobre un límite inalcanzable: es que el documento
afirmaba un dominio y lo implementaba en otro, sin decirlo. Un lector razonable que confiara en la
declaración `bigint` habría reusado esa línea en el verificador independiente, donde el `treeSize` sí
llega como `bigint` desde el checkpoint publicado. Y el modo de fallo vuelve a ser silencioso: `k`
negativo, `slice()` cortando desde el final, ninguna excepción.

**Resolución.** Bucle explícito sobre `bigint`
(`largestPowerOfTwoLessThan(n: bigint): bigint`, ≤ 63 iteraciones, coste irrelevante frente a un solo
SHA-256). **Nada de trucos de bits de 32 bits en un dominio de 64.** Aplicado en `10-...` §6.3 y §7.2.

## E4 — Dos convenciones de hoja en la misma sección: la spec reabría el ataque que la spec cierra

| Lugar | Qué decía |
|---|---|
| `10-...` §6.2 (prosa) | «La hoja `i` **es el `event_hash`** del evento con `leaf_index = i`» |
| `10-...` §6.3 (fórmula) | `MTH({d0}) = SHA256(0x00 ‖ d0)` — la hoja se calcula sobre el **dato crudo** |
| `10-...` §6.3 (código) | `if (leaves.length === 1) return leaves[0]; // ya vienen hasheadas con 0x00` |

**El conflicto.** Tres convenciones en dos páginas. Quien leyera la prosa de §6.2 —«la hoja es el
`event_hash`»— y llamara al código de §6.3 construía un árbol **sin prefijo de hoja**: precisamente el
ataque de **segunda preimagen** al que esa misma sección §6.3 dedica media página, con su ejemplo de
cuatro hojas, su `d'0 = h0‖h1` y su conclusión de que permite «negar dos eventos» y «producir pruebas
de inclusión para eventos que nunca se insertaron».

Es el caso más claro del patrón descrito arriba: el argumento de §6.3 es impecable y el código que
está debajo del argumento lo contradice.

**Resolución.** El contrato queda **explícito y normativo** en la spec: **la API pública recibe
entradas crudas y aplica `leafHash` internamente.** Ninguna función exportada acepta hojas ya
hasheadas; `leafHash` y `nodeHash` se exportan sólo para que el verificador independiente reproduzca
el algoritmo paso a paso. Es la convención literal del RFC y **hace imposible el error de pasar hojas
ya hasheadas**: no existe la firma que lo permita. Se introduce además el vocabulario que faltaba
—*entrada* (el dato del log) frente a *hoja* (`SHA256(0x00 ‖ entrada)`)— porque el error empezó siendo
una imprecisión de nombres. Aplicado en `10-...` §6.2, §6.3, §6.4, §6.5 y §7.2.

## E5 — La espina dorsal no era un UUID v4, y §1.1 exigía UUID v4

**El conflicto.** §1.1 exigía «UUID v4» para los identificadores del ledger. §2.3 definía la espina
dorsal como `00000000-0000-0000-0000-00000000ffff`. **Ese valor no es un UUID v4**: el nibble de
versión es `0`, no `4`, y los bits de variante tampoco corresponden.

**Por qué importaba.** Un validador estricto —el nuestro, en cuanto alguien lo escribiera bien—
habría **rechazado el único agregado que la spec declara axiomático**: la espina es la raíz de
confianza de todo el sistema, el único agregado con génesis en 32 ceros, el único cuyo hash se ancla
el día de la puesta en marcha, y aquel del que cuelga criptográficamente el nacimiento de todos los
demás. La spec exigía una forma y luego definía, como caso axiomático, el contraejemplo.

**Resolución.** Por E1 los identificadores del ledger ya no son UUID sino 32 hex, con lo que el
problema se disuelve por construcción: no hay campo de versión que respetar. La espina dorsal pasa a
ser **`00000000000000000000000000000001`** y **toda mención a «UUID v4» como identificador del ledger
queda eliminada del corpus**. Aplicado en `10-...` §1.1 y §2.3, y propagado a `20-...` §7,
`THREAT_MODEL.md` §7 y `01-...`.

> **Pendiente de código, no de documento:** `packages/crypto/src/chain.ts` exporta todavía
> `SPINE_AGGREGATE_ID = '00000000-0000-0000-0000-00000000ffff'`. La constante hay que cambiarla junto
> con el validador de `aggregateId`. No se toca aquí porque esta ronda es de especificación.

## E6 — `checkpoint_hash` indefinido para el primer checkpoint

**El conflicto.** `checkpoint_hash = SHA256(0x04 ‖ JCS_utf8({treeSize, rootHash, headsRoot,
prevCheckpoint, issuedAt}))`. En el **primer** checkpoint, `prevCheckpoint` es `NULL`. Pero §1.3.d
prohíbe `null` en los objetos canónicos, y la spec **no decía** si la clave se omite, se pone en
cadena vacía o se usa un centinela de 64 ceros.

**Por qué importaba.** Es el error más barato de cometer y el más caro de diagnosticar: **dos
implementaciones honestas producen dos hashes distintos para el mismo checkpoint**, ambas convencidas
de estar en lo cierto, y la discrepancia aparece como una acusación mutua de falsedad sobre el
checkpoint que ancla el origen de la vigencia. Es el mismo modo de fallo que E2, en la otra punta de
la misma cadena.

**Resolución.** **Si no hay checkpoint previo, la clave `prevCheckpoint` se OMITE del objeto
canónico.** No se emite `null`, ni cadena vacía, ni centinela. El objeto canónico del primer
checkpoint tiene cuatro claves; el de todos los demás, cinco. La regla ya existía en §1.3.d para el
resto del sistema —«la ausencia se expresa omitiendo la clave»—; sólo faltaba escribir que también se
aplicaba aquí. Aplicado en `10-...` §6.4, con la fórmula reescrita como `prevCheckpoint?`.

## E7 — ADR-0004 y la spec 10 mandaban órdenes de comparación distintos

| Documento | Qué decía |
|---|---|
| `ADR-0004`, regla 1 | ordenar «**byte a byte el UTF-8** (`<` sobre code points)» |
| `10-...` §1.3.c | «JCS ordena por **unidades de código UTF-16**, no por bytes UTF-8» |
| `30-...` §A.1.1 | «comparación **byte a byte del UTF-8** (`<` sobre code points)» |

**El conflicto.** La redacción de ADR-0004 era incorrecta por partida doble. Primero se contradice a
sí misma: el `<` de JavaScript **no** compara code points, compara unidades de código UTF-16.
Segundo, y peor, contradecía a un documento que decía lo correcto, y **ADR-0004 tiene precedencia
sobre la spec 10** según la tabla del inicio de este archivo — de modo que un implementador que
siguiera la regla de precedencia habría implementado la versión equivocada.

**No son la misma función fuera del plano básico.** Los sustitutos UTF-16 caen en `D800`–`DFFF`, así
que todo carácter suplementario se ordena *antes* que `U+E000`–`U+FFFF` en UTF-16 y *después* en bytes
UTF-8. El caso que lo demuestra:

```js
'😂' < '\ufb33'                //  true  — UTF-16: 0xD83D < 0xFB33   ← lo que manda JCS
utf8('😂') < utf8('\ufb33')    //  false — UTF-8:  F0 9F 98 82 > EF AC B3
```

Con dos claves así en un mismo objeto, los dos canonicalizadores emiten objetos distintos y por tanto
**hashes distintos**, y el falso positivo resultante es indistinguible de una alteración real.

**Resolución.** **Manda JCS (RFC 8785): orden por unidades de código UTF-16.** Corregido en ADR-0004
—con el contraejemplo del emoji incorporado al propio ADR, para que la próxima lectura no reabra la
duda—, en `30-...` §A.1.1 y en el resumen de `adr/README.md`. Se añade como consecuencia que los
property-based tests **deben** generar caracteres fuera del BMP: una batería de sólo-ASCII habría dado
verde sobre la regla equivocada indefinidamente, que es exactamente lo que pasó.

## E8 — ADR-0001 declaraba invertida la dirección de dependencia entre `crypto` y `domain`

**El conflicto.** ADR-0001 decía «`packages/crypto` — canonicalización, hashing, cadena de eventos,
Merkle. **Depende sólo de `domain`**». La implementación es al revés, y lo demuestra de la única forma
que cuenta: `packages/crypto/package.json` tiene `"dependencies": {}`.

**Por qué importaba, más allá de la exactitud.** `crypto` implementa piezas cuyo comportamiento debe
quedar **congelado durante décadas**, porque cambiarlas invalida toda la historia anclada (`10-...`
§1.4 lo dice del módulo JCS: «el artefacto más estable del repo»). `domain` cambia cada vez que la
asamblea reforma su reglamento. Hacer que la pieza congelada dependa de la que cambia es
estructuralmente al revés: cada reforma del reglamento habría arrastrado un rebuild de `crypto`. Y
`crypto` es lo que se publica como verificador independiente (`@koinonia/verificar`, §9.2): si
dependiera de `domain`, un tercero que quiera comprobar hashes tendría que arrastrar el motor de
decisiones entero —con las reglas de gobernanza vigentes hoy— para verificar una historia de hace
tres años, y las «~600 líneas auditables» que promete §9.2 serían falsas.

**Resolución.** **`packages/crypto` NO depende de nadie**; es la hoja del grafo. **`packages/domain`
puede depender de `@koinonia/crypto` y de nada más.** El orden total queda
`crypto ← domain ← contracts ← {services/api, apps/web}`, verificado en CI por
`scripts/check-domain-purity.mjs`. Corregido en ADR-0001 y documentado en `ARCHITECTURE.md`.

## Hallazgo adicional — tres representaciones del `MemberId` en el corpus

No venía en el informe de implementación; apareció al propagar E1 a todo el repositorio. El mismo
valor de 128 bits estaba descrito de **tres** formas incompatibles:

| Documento | Forma |
|---|---|
| `ADR-0006` (resolución **R1**) y `30-...` §A.0 | base32, 26 caracteres |
| `10-...` §1.1 | 32 hex minúsculas |
| `10-...` §3.1 (DDL) | columna `uuid` ⇒ 36 caracteres con guiones |

La tercera es E1 y ya está resuelta. Las dos primeras seguían en conflicto después de E1, porque la
resolución del arquitecto fija `CHAR(32)` con `CHECK (~ '^[0-9a-f]{32}$')` y base32 de 128 bits son 26
caracteres. **Queda una sola forma: hex de 32, minúsculas.** El cambio es de codificación, no de
sustancia —los mismos 128 bits del mismo CSPRNG— y se elige hex porque es la forma en que ya se expone
todo hash en el borde HTTP, porque el `CHECK` es una expresión regular trivial, y porque el orden
lexicográfico del hex minúsculo **coincide con el orden binario** de los 16 bytes que representa, de
modo que el `ORDER BY aggregate_id` de PostgreSQL y el ordenamiento del verificador independiente no
pueden divergir al construir el `heads_root` (`10-...` §6.4). Corregido en ADR-0006, `30-...` §A.0 y su
tabla de generadores.

> **Para el arquitecto:** si la intención era conservar base32, lo que hay que cambiar es la regla de
> §1.1-bis y no ADR-0006 — pero una de las dos tiene que ceder, porque hoy se contradicen.

## E9 — **PENDIENTE** · `prevHash` dentro del objeto (spec 30) contra prefijo binario (spec 10)

No es una resolución: es una divergencia que el implementador **declaró en el propio código** y elevó
sin cerrarla. Se registra aquí porque un documento puede señalar una contradicción con otro de rango
superior pero **no puede resolverla** (regla operativa de C19).

| Documento | Qué manda |
|---|---|
| `30-...` §A.7 | `hash = hash({eventId, decisionId, seq, occurredAt, actor, payload, prevHash})` — `prevHash` **como campo dentro del objeto JCS** |
| `10-...` §2.1 y ADR-0005 | `eventHash = SHA256(0x02 ‖ prevHash(32 B) ‖ JCS_utf8(evento))` — `prevHash` como **prefijo binario de longitud fija**, y el objeto canónico **no lo incluye** |

Los dos producen hashes distintos para el mismo evento. `packages/crypto` implementó la construcción
de la spec 10 (`hashEvent` en `hash.ts`), y `packages/domain/src/events.ts` documenta la divergencia
en su cabecera en vez de disimularla.

**Recomendación del editor, sin autoridad para cerrarla:** manda la spec 10. Sus dos argumentos son
técnicos y verificables —el octeto `0x02` de separación de dominio impide que un `eventHash` sea
simultáneamente un nodo del árbol de Merkle, y un primer operando de 32 bytes exactos hace única la
partición de la concatenación—, mientras que meter `prevHash` en el objeto obliga a decidir su
encoding textual y a excluirlo del hash que él mismo forma. Además `packages/crypto` ya está
congelado con esa construcción. **Decide el arquitecto**; hasta entonces, la spec 30 §A.7 sigue
diciendo lo contrario y no se ha tocado.

---

# Segunda ronda — `packages/domain` contra la spec 30 (2026-08-21)

`packages/domain` se implementó contra `30-decision-engine-spec.md` inmediatamente después de
`crypto`, con el mismo método: escribir el motor y los property-based tests contra el documento y
elevar cada punto donde el documento no permite escribir código. **Catorce errores.** El resultado
son 229 pruebas en verde (345 con las 116 de `crypto`), 40 de ellas invariantes de la PARTE E.

**Lo que confirma la segunda ronda.** La spec 30 es un documento mejor que la spec 10: 2 600 líneas,
sesenta invariantes formalizados, siete anti-invariantes, una sección entera dedicada a las
patologías conocidas de cada método de escrutinio y un apéndice con las 60 decisiones normativas
numeradas. Razona la no monotonía de IRV con un contraejemplo numérico y advierte, textualmente, del
peligro de «arreglar» el motor para satisfacer una propiedad que el método no tiene. Es, con
diferencia, el documento más cuidado del corpus. **Y produjo más del doble de errores que la spec
10.** La correlación entre calidad de un documento y número de errores que sobreviven a leerlo es,
por lo visto, débil o inexistente; lo que predice los errores es la **cantidad de correspondencias**
que el documento establece entre partes distintas de sí mismo, y la spec 30 establece muchísimas
(catálogo de eventos ↔ máquina de estados ↔ métodos ↔ invariantes). Nueve de los catorce son
exactamente eso: dos pasajes correctos por separado que no se sostienen juntos.

**Cuatro patrones nuevos**, que no aparecían en la primera ronda:

1. **El campo inerte** (E10). Un campo de configuración que existe, se documenta, se muestra en la
   interfaz y **no puede cambiar ningún resultado**, porque otra parte de la misma fórmula lo anula.
   No falla: hace nada, en silencio, para siempre. Sólo lo ve quien intenta escribir el test que
   distingue las dos ramas y descubre que no hay dos ramas.
2. **La regla que el motor no puede verificar** (E21, y en el fondo E17, E19 y E13). El documento
   enuncia una condición —«sólo para actos constituyentes», «firmado por quien objetó», «con dos
   firmas», «con registro de asistencia»— y no define el campo donde esa condición constaría. El
   implementador honesto la escribe como comentario y sigue; el apurado la olvida. En ningún caso
   la condición existe. **Una regla que el motor no puede verificar no es una regla, es un
   comentario.**
3. **El invariante insatisfacible** (E11, y su reverso E14). El documento exige a la vez `A` y `¬A`
   en dos secciones que nunca se leen juntas. La salida barata es debilitar el invariante hasta que
   pase, y esa salida no deja rastro: la suite queda verde y la comprobación desactivada.
4. **El tipo que no compila** (E15). La spec 30 contiene unas cuarenta declaraciones TypeScript que
   nadie ha pasado nunca por `tsc`. Son prosa con sintaxis de TypeScript. La corrección de fondo no
   es arreglar una línea: es extraer los bloques normativos y typecheckearlos en CI.

**La consecuencia operativa** es la misma de la primera ronda, reforzada: implementar temprano es
una técnica de revisión, no una fase posterior. Y una segunda, específica de esta ronda: **escribir
los invariantes es tan revelador como escribir el motor.** E11 y E14 los encontró el arnés de
property-based testing, no el código de producción; E10 lo encontró la pregunta «¿qué generador
distingue estas dos ramas?».

## E10 — `abstentionBlocks: false`: un campo de configuración que no podía hacer nada

**El conflicto.** B.4 definía `Aprueba ⟺ R = 0 ∧ (abstentionBlocks ? Ab = 0 : true) ∧ A = D` con
`D = A + R + Ab`. Sustituyendo `R = 0` en `A = D` se obtiene `A = A + Ab`, es decir **`Ab = 0`
siempre**, independientemente de `abstentionBlocks`.

**Por qué importaba.** No es una imprecisión de redacción: es una **opción de gobernanza que la
interfaz ofrece y el motor no entrega**. Un círculo que configurara «la abstención no rompe la
unanimidad» —la lectura razonable cuando se pide unanimidad para un compromiso personal, donde
abstenerse significa «no me sumo pero no bloqueo»— vería su decisión rechazada por una abstención,
sin ningún mensaje que explicara por qué, y con el documento de su lado. Además el código de
ejemplo reforzaba la ilusión: la línea `if (m.abstentionBlocks && abstain > 0) return false`
sugiere que la rama importa, cuando la línea siguiente ya lo garantizaba por aritmética.

**Resolución.** **Con `abstentionBlocks: false` el denominador pasa a `A + R`**: las abstenciones
salen del denominador y el campo adquiere el efecto que su nombre promete. La comprobación
explícita se elimina por subsumida. Queda alineado con `abstentionPolicy:'exclude'` de B.0.4 —mismo
denominador, misma doctrina— y el caso degenerado sigue cerrado por B.0.d (`A=R=0, Ab=3 ⇒ D=0 ⇒` no
aprueba). Con `base:'census'` el campo sigue siendo inerte, pero ahora como consecuencia declarada
de lo que significa «unanimidad del censo entero», y la validación debe advertirlo.
Aplicado en `30-...` §B.4 y en el apéndice.

## E11 — `resultHash` imposible: A.6 e INV-01 no podían ser ciertos a la vez

| Documento | Qué decía |
|---|---|
| `30-...` §A.6 | «hash del resultado completo **salvo este campo**» ⇒ la preimagen incluye `computedFromSeq` |
| `30-...` §E.1, INV-01 | un voto inválido no cambia `outcome`, `turnout` ni `resultHash` «**salvo** `computedFromSeq`» |

**El conflicto.** Añadir una papeleta inválida hace avanzar `computedFromSeq`. Si `computedFromSeq`
entra en la preimagen, el `resultHash` cambia **siempre** que llega basura — y INV-01 exige que no
cambie. El invariante era insatisfacible por construcción.

**Por qué importaba.** Es el patrón peligroso: la salida barata es reescribir el test para que
compare todo *menos* el `resultHash`, la suite queda verde y **nadie vuelve a mirar**. Pero el
`resultHash` es la pieza sobre la que descansa A.8: «cualquier auditor puede recomputar desde los
eventos y comparar; si difiere, `Annulled` automático». Con `computedFromSeq` dentro, dos
recomputaciones honestas de la misma urna hechas en momentos distintos —una antes y otra después de
que llegara un voto inválido, que por definición no cambia nada— dan hashes distintos, y el sistema
se acusa a sí mismo de inconsistencia de escrutinio. Es, otra vez, **el falso positivo de
manipulación**: el mismo modo de fallo que E1, en otro documento y por otra vía.

**Resolución.** **`resultHash` excluye `resultHash` y `computedFromSeq`.** Es la única exclusión que
hace ciertas las dos secciones. `resultHash` identifica el resultado, no el punto del log desde el
que se calculó; `computedFromSeq` sigue en el objeto y sigue firmado dentro del `eventHash` de
`ResultComputed`, así que no se pierde trazabilidad. Aplicado en `30-...` §A.6 e INV-01.

## E12 — Dos semillas incompatibles: A.7 servía el sorteo que B.0.3 declara teatro

| Documento | Qué manda |
|---|---|
| `30-...` §A.7 | `SeedRevealed { seed: string; commitment: Hash }` — semilla **única**, generada por el sistema |
| `30-...` §B.0.3 y ADR-0024 | `seed = sha256(seedAdmin ‖ "|" ‖ beaconValue)` — semilla **compuesta**, con faro externo posterior al cierre |

**El conflicto.** Los dos pasajes describen el mismo evento y son incompatibles.

**Por qué importaba, y por qué manda B.0.3.** Una semilla que genera el servidor la elige de hecho
quien opera el servidor. Como el padrón y las opciones son públicos, puede **moler** (*grinding*)
millones de candidatas offline hasta encontrar la que produce el sorteo o el desempate que le
conviene, y comprometerse a esa. El commit–reveal simple certifica que no cambió de opinión
**después**; no certifica que no eligiera **antes**. La propia B.0.3 lo dice con todas las letras:
sin la mezcla con un valor imposible de conocer en el instante del commit, «sorteo verificable» es
**teatro criptográfico**. Lo grave es que un implementador que siguiera A.7 habría construido un
sistema que *parece* verificable —hay commit, hay reveal, el `sha256` cuadra— y que no lo es, y
habría pasado todos sus tests, incluido INV-57 tal como estaba redactado.

**Resolución.** **Manda B.0.3.** `SeedRevealed` publica **ambas partes**: `seedAdmin` y
`beaconValue`, más el `commitment` para que el verificador no tenga que ir a buscar el `configHash`.
Corregido `30-...` §A.7; nota recíproca en §B.0.3 para que la resolución sea visible desde los dos
lados (lección de C4 y E7).

## E13 — `base:'present'` invocaba un evento inexistente, y no debía existir

**El conflicto.** B.2.b exigía que `base:'present'` viniera con «un registro de asistencia con
evento propio (`AttendanceRecorded`) cerrado ANTES de abrir la votación». **`AttendanceRecorded` no
está en el catálogo de A.7.** El denominador `|asistentes registrados|` no era calculable: el
escrutador tenía que dividir por un conjunto que el log no registra.

**Por qué la resolución no es añadir el evento.** Un quórum basado en quién está físicamente
presente en una sala **contradice el primer principio del proyecto**, *asynchronous-first*. La
ventana de 72 h, el padrón congelado, la delegación con resolución al cierre y la regla «delegar es
participar» (D.1.a) existen precisamente para que la voz de alguien no dependa de que pueda estar en
un aula un martes a las 4 p.m. El evento que faltaba habría reintroducido por la puerta del
denominador la desigualdad que toda la arquitectura desactiva, y con ventaja retórica: «2/3 de los
presentes» suena a asamblea legítima mientras significa «2/3 de quienes tuvieron el privilegio de
poder ir». Que el evento faltara es, visto así, la señal de que la opción nunca perteneció a este
diseño — el catálogo de A.7 se escribió entero desde el modelo asincrónico y no tenía dónde poner la
asistencia porque no hay sesión que atender.

**Resolución.** **`base:'present'` se ELIMINA del MVP.** `ThresholdBase` queda en `'cast' | 'census'`.
La opción se marca como **retirada**, con esa razón escrita, y queda anotado que si alguna vez vuelve
deberá venir con (1) su evento en A.7, con régimen de congelación, actor y fila en A.8.1, y (2) una
**justificación de gobernanza, no técnica** — un argumento sobre por qué la presencia física debe
conferir un peso que la ausencia no confiere, en un instituto donde hay estudiantes que trabajan,
que tienen personas a cargo o que no viven en Medellín. «Se puede implementar» no es esa
justificación, y la decisión la toma la asamblea, no quien escribe el escrutador. Aplicado en
`30-...` §A.3, §B.2, §B.2.b y en el apéndice.

## E14 — INV-34 contaba mal el producto cartesiano: «6 × 17 = 102»

**El conflicto.** INV-34 fija los generadores en «producto cartesiano completo `Estado × TipoEvento`
(6 × 17 = 102 casos, exhaustivo, no aleatorio)». **A.7 lista 19 tipos de evento**, no 17.

**Por qué importaba.** El número **es la condición de exhaustividad del test**. Una suite que
declara «102 casos, exhaustivo» y recorre las constantes reales pasaría con 114 sin que nadie lo
note; peor, alguien podría «cuadrar» el conteo excluyendo dos tipos del recorrido para que diera
102. Y los dos tipos que faltaban en la cuenta de 17 son **justamente los dos que A.8.1 no ubicaba
en ninguna fila** (`BallotVoided` y `DecisionDrafted`, ver E20), lo que indica que el 17 se contó
sobre la tabla de transiciones en vez de sobre el catálogo: el error de conteo y el error de la
tabla son el mismo error visto dos veces.

**Resolución.** **6 × 19 = 114**, y **133** contando el estado previo a `Draft` —el del agregado que
aún no existe, desde el cual `DecisionDrafted` es el único evento legal—. El invariante se prueba
con `DECISION_EVENT_TYPES.length` y `LIFECYCLE_STATUSES.length` del propio motor, nunca con un
literal escrito a mano, para que el conteo no pueda volver a divergir. Aplicado en `30-...` INV-34.

## E15 — `ProofTable.rows` no compila: `readonly` sobre una unión de primitivos

**El conflicto.** A.6 declaraba `readonly rows: readonly (readonly (string | number))[][]`. El
modificador `readonly` de TypeScript **sólo se aplica a tipos de arreglo y tupla**;
`readonly (string | number)` es una unión de primitivos y produce `error TS1354`.

**Por qué importaba, más allá de la línea.** La spec 30 contiene unas **cuarenta** declaraciones
TypeScript y ninguna ha pasado nunca por `tsc`. Son prosa con sintaxis de TypeScript, y el lector
las lee como si fueran código verificado. Esta errata es benigna —falla al compilar, ruidosa,
imposible de ignorar—; las peligrosas de esa misma clase son las que **sí** compilan y significan
otra cosa.

**Resolución.** `readonly (readonly (string | number)[])[]`: los paréntesis deben encerrar el `[]`
que el `readonly` modifica, no la unión. **Corrección de fondo, pendiente de trabajo:** extraer los
bloques `ts` normativos de la spec y typecheckearlos en CI, como ya se hace con la pureza del
dominio. Aplicado en `30-...` §A.6.

## E16 — La frontera del alta: la prosa decía una cosa y el invariante otra

| Documento | Qué decía |
|---|---|
| `30-...` §A.2.1, DECISIÓN A.1 | «quien se matricula **después** del instante `frozenAt` no vota» ⇒ el alta simultánea queda **dentro** |
| `30-...` §E.1, INV-03 | `enrolledAt ≥ frozenAt ⇒ m ∉ members` ⇒ el alta simultánea queda **fuera** |

**El conflicto.** Un milisegundo, el de `enrolledAt === frozenAt`, en el que las dos reglas dan
respuestas opuestas sobre si una persona vota.

**Por qué no es un caso de laboratorio.** `frozenAt === DecisionOpened.occurredAt` (A.2) y las altas
llevan el mismo reloj de servidor; en una jornada de matrícula la colisión de milisegundo tiene
probabilidad nada despreciable. Y si el instante perteneciera a los dos lados, `censusSize`
dependería del orden en que dos escrituras del mismo milisegundo llegan al store — exactamente el
indeterminismo que A.9 cierra al prohibir ordenar por `occurredAt`. `N` es el denominador de todos
los quórums: un `N` que depende de una carrera es un resultado que depende de una carrera.

**Resolución.** **Manda el invariante: frontera semiabierta `enrolledAt < frozenAt ≤ withdrawnAt`.**
Es además la convención que el documento ya usaba para la ventana de voto (D.3.b, `castAt <
closesAt`), de modo que el motor queda con **una sola** regla de frontera. El extremo superior es
simétrico: quien se retira **en** `frozenAt` sigue en el padrón, coherente con A.3. Los generadores
deben producir `enrolledAt ∈ {frozenAt − 1, frozenAt, frozenAt + 1}` explícitamente, no esperar a
que salga por azar. Corregida la prosa de A.1.

## E17 — `ObjectionIntegrated` no tenía dónde constar la firma que B.3.b exige

**El conflicto.** B.3.b define «integrar una objeción» con tres condiciones, y la tercera es que el
evento esté **firmado por quien objetó**: «sin la firma del objetante, no hay integración: hay
*modificación unilateral*». El payload de A.7 era `{ objectionId, newProposalVersionHash }`.
**Ningún campo para la firma.**

**Por qué importaba.** La condición más importante de la sección era, en el log, indistinguible de
su ausencia. El motor no podía separar una integración legítima de aquello que la propia B.3.b
identifica como «el abuso documentado más frecuente en implementaciones de sociocracia»: cambiarle
una coma a la propuesta y declarar la objeción resuelta. INV-53 ya exigía exactamente esto —«ni
considerar integrada una objeción sin la firma del objetante»— contra un tipo que lo hacía
imposible de comprobar: un invariante que sólo podía escribirse como comentario.

**Resolución.** Se añade **`signedBy: MemberId`** a `ObjectionIntegrated`, con precondición
`signedBy === objeción.by`; sin ella el evento se rechaza y la objeción sigue viva. La válvula de
escape de B.3.b (retirada tácita si el objetante no responde en `panelDeadline`) no se toca: sigue
impidiendo el bloqueo por ausentismo. Aplicado en `30-...` §A.7 y §B.3.b.

## E18 — `votes` en el evento equivocado: A.7 hacía votar la admisión

| Documento | Qué decía |
|---|---|
| `30-...` §A.7 | `ObjectionAdmitted { objectionId, panel, votes }` · `ObjectionDismissed { objectionId, panel, motivation }` |
| `30-...` §B.3.a | toda objeción **nace admitida**; sólo puede **desestimarse** por 2/3 del panel con motivación escrita |

**Por qué importaba, más de lo que parece.** No es un campo mal colocado: es **la doctrina contraria
escrita en el tipo**. B.3.a construye una presunción de validez y explica durante un párrafo por qué
—la alternativa concentra en una persona el poder de anular disensos, y «en un instituto de
filosofía, donde el prestigio académico es asimétrico, sería capturado en un semestre»—. Un
implementador que leyera sólo A.7 habría construido un panel que **vota la admisión**, invirtiendo
la carga de la prueba y devolviéndole al panel exactamente el poder que B.3.a le quita. Además el
campo era incoherente consigo mismo: la admisión también se produce por **silencio** del panel
vencido `panelDeadline`, caso en el que no hay votos que contar y `votes` no tendría valor posible.

**Resolución.** **`votes` va en `ObjectionDismissed`.** La admisión es la presunción y no vota
nadie; desestimar es lo que exige 2/3 del panel. Aplicado en `30-...` §A.7, con nota recíproca en
§B.3.a.

## E19 — `cause:'manual'` sin firmas: una puerta trasera que esquiva la PARTE D entera

**El conflicto.** A.8.1 exige, para cerrar desde `Open`, «`now ≥ closesAt` ∨ cierre anticipado
válido (D.4) ∨ **cierre manual con 2 firmas**». El payload de `DecisionClosed` era `{ at, cause }`.
**No hay `signers`.**

**Por qué esto no es una errata de tipos, sino un agujero de gobernanza.** `cause:'manual'` sin
firmas permite cerrar la urna cuando alguien quiera, sin más autor que el `actor` del envelope, sin
motivación y sin quórum de firmas. Es decir: **esquiva la PARTE D completa**. La ventana exclusiva
de D.3, el régimen de prórrogas de D.2, y sobre todo las condiciones estrictas del cierre anticipado
de D.4 —piso de 24 h, sólo `public-roll-call`, sólo métodos de umbral, sólo con irreversibilidad
matemática demostrada, protegidas por INV-58 e INV-59— son cuatro páginas de razonamiento cuidadoso
que un `cause:'manual'` sin requisitos vuelve opcionales. Cerrar a mano con el marcador a la vista
es el ataque de «votación hasta que gane mi lado» ejecutado desde el otro extremo: en vez de
reabrir hasta ganar, cerrar cuando vas ganando. A.8.2.1 prohíbe la reapertura con un párrafo
explícito; la simétrica estaba abierta y era legal según los tipos.

**Resolución.** Se añade **`signers?: readonly MemberId[]`** a `DecisionClosed`, **obligatorio ⟺
`cause === 'manual'`**, con `signers.length ≥ 2`, sin repetidos, todos del círculo de garantías y
ninguno igual al `actor` del evento. Aplicado en `30-...` §A.7 y §A.8.1. *(La prueba correspondiente
ya existe: `packages/domain/test/props/log-invariants.test.ts`, «el cierre manual exige dos firmas;
sin ellas sería la vía para esquivar D.4».)*

## E20 — Dos de los 19 eventos no aparecían en la máquina de estados, y `DraftConfig` no existía

**El conflicto.** A.8.1 lista las transiciones legales y A.8.2 establece que lo no listado es ilegal.
`BallotVoided` y `DecisionDrafted` están en el catálogo de A.7 y **en ninguna fila** de A.8.1.
Además `DecisionDrafted.draft: DraftConfig` referenciaba un tipo que el documento no define en
ninguna parte.

**Por qué importaba.** Por la regla de A.8.2, `DecisionDrafted` era **ilegal en todo estado**,
incluido el único en que puede ocurrir: **ninguna decisión podía nacer**. Y `BallotVoided` quedaba
sin estados permitidos, cuando A.2 lo describe con detalle como el acto excepcional que anula un
voto —de modo que la spec definía cuidadosamente un evento que su propia máquina de estados
rechazaba siempre.

**Resolución.**
- **`DecisionDrafted` crea el agregado.** Es el único evento sin estado de origen:
  `apply(undefined, DecisionDrafted) = Draft`, con `seq === 1`, `prevHash` de 64 ceros y ningún
  evento previo para ese `decisionId`; con cualquier estado definido, `IllegalTransitionError`. De
  aquí sale el séptimo estado del conteo de E14.
- **`BallotVoided` sólo es legal en `Open`.** Después del cierre no puede anularse una papeleta:
  INV-35 exige que `effectiveBallots` sea idéntico antes y después de `DecisionClosed`, y anular una
  papeleta con el marcador ya conocido **es escoger el resultado**. Si el vicio se descubre tras el
  cierre, la vía es `DecisionAnnulled` —acto político visible y recurrible—, no la anulación
  quirúrgica del voto que estorba. Los tres requisitos que A.2 ya exigía (motivación escrita, dos
  firmas del círculo de garantías, constancia en el log) se trasladan tal cual a la precondición.
- **`DraftConfig` queda definido** como la configuración **aún mutable** previa a la congelación:
  `DecisionConfig` con todo opcional salvo `decisionId` y `proposalId`, y **sin** `electorate`,
  `configHash` ni `engineVersion`. No lleva `configHash` porque hashear un borrador mutable sería
  prometer inmutabilidad sobre algo que cambia: la identidad criptográfica de las reglas nace en
  `DecisionOpened`, no antes.

Aplicado en `30-...` §A.7 y §A.8.1.

## E21 — Dos reglas inverificables: «sólo para actos constituyentes» y «con autorización previa»

| Documento | Qué enunciaba | Campo donde constaría |
|---|---|---|
| `30-...` §B.2.a | `base:'census'` **sólo** para reformar el reglamento, revocar un mandato o disolver un círculo; «el motor rechaza» lo demás | ninguno |
| `30-...` §B.4.a | `unanimity` deshabilitada por defecto, exige **decisión previa del círculo** que la autorice para un caso concreto | ninguno |

**El conflicto.** «El motor rechaza» era falso, porque el motor no tenía **cómo**. `DecisionMethod`
no distinguía qué acto era ni si había autorización, y la única lectura implementable de «sólo se
permite para X» sobre un tipo que no distingue X es «se permite siempre».

**Por qué importaba.** Los dos frenos protegen las dos configuraciones más peligrosas del documento.
`base:'census'` es, en palabras de la propia B.2, «un derecho de veto por inasistencia»: quien
quiere bloquear no tiene que hacer nada. `unanimity` tiene la patología que B.4 enumera en tres
puntos, empezando por el poder dictatorial de la última persona en votar. Que ambos quedaran
disponibles para cualquier configuración —con una advertencia en la interfaz como única barrera— es
justo lo contrario de lo que las dos decisiones dicen establecer. Y «deshabilitada por defecto» se
degradaba a una casilla, es decir, a nada.

**Resolución.** Se añaden los campos:
- **`constituentAct?: ConstituentAct`** en `supermajority`, **obligatorio ⟺ `base === 'census'`**,
  con exactamente los tres valores de B.2.a y ninguno más.
- **`unanimityAuthorizedBy: UnanimityAuthorization`** en `unanimity`, **obligatorio**, con
  `authorizingDecisionId`, `authorizingConfigHash` y `scope`. La validación exige que la decisión
  autorizante esté ratificada, que su método sea `supermajority` y que su `scope` coincida con el
  `proposalId` de la decisión actual. Se ata al `configHash` y no sólo al id porque el id permitiría
  autorizar una unanimidad con unas reglas y ejercerla bajo otras; y se exige `scope` porque una
  autorización sin alcance sería una llave maestra permanente, que es lo contrario de «autorizada
  para un caso concreto».

Ambos entran en `configHash`, de modo que la justificación queda anclada criptográficamente y es
recurrible en la ventana de impugnación. **La regla general que deja este error: una regla que el
motor no puede verificar no es una regla, es un comentario.** Aplicado en `30-...` §A.3, §B.2.a y
§B.4.a.

## E22 — El milisegundo del cierre: D.2 contra A.8.2.5

| Documento | Qué decía |
|---|---|
| `30-...` §D.2 | el tick emite exactamente uno de `{WindowExtended, DecisionClosed}` y «**ambos pueden llevar `occurredAt === closesAt`**» |
| `30-...` §A.8.2.5 | prohibido `WindowExtended` «emitido **después** de `closesAt`» ⇒ en `closesAt` exacto, permitido |
| `30-...` §A.8.1 | `WindowExtended` exige ser emitido «**antes** de `closesAt`» ⇒ en `closesAt` exacto, prohibido |

**El conflicto.** Tres pasajes y tres respuestas distintas para el mismo instante — el único instante
que importa en toda la PARTE D.

**Por qué la regla anterior no servía.** Si en `closesAt` fueran legales los dos eventos, lo único
que impediría una decisión simultáneamente cerrada y prorrogada sería la **serialización del
store**: una propiedad del runtime (`UNIQUE(decision_id, seq)` más reintento optimista), no del
dominio. Pero `replay` es una **función pura sobre el log**: recibe eventos, no transacciones. Un
log con ambos eventos en `closesAt` es un log que el motor tendría que aceptar o rechazar por sí
mismo, y con la regla anterior no tenía criterio. INV-38 («el tick emite exactamente uno») era, tal
como estaba, un invariante sobre la base de datos disfrazado de invariante del dominio — y por tanto
no comprobable por un auditor externo que sólo tiene el log.

**Resolución.** **El tick de cierre lleva `occurredAt = closesAt` exactamente, y `WindowExtended` es
ilegal a partir de ese instante inclusive** (legal ⟺ `occurredAt < closesAt`).

*El costo, declarado:* D.2 tenía un argumento real —evaluar el quórum antes de `closesAt` es
evaluarlo antes de que lleguen los últimos votos—. Se acepta, y es menor de lo que parece: si el
tick de prórroga se dispara en `closesAt − δ` y en esos `δ` milisegundos llegan los votos que
faltaban, la consecuencia es una ventana más larga de lo necesario y una segunda evaluación del
quórum que la cumplirá — **más participación, no un resultado distinto**. La prórroga no puede
tumbar nada, sólo alargar. La asimetría es deliberada: prorrogar de más cuesta 24 h; cerrar y
prorrogar a la vez cuesta la reproducibilidad del log. Queda además una sola frontera en todo el
documento —`closesAt` pertenece siempre al después, igual que en D.3.b— y `δ` es un parámetro de
operación, no del dominio. Aplicado en `30-...` §D.2, §A.8.1 y §A.8.2.5.

## E23 — `turnout.fraction`: ¿`C/N` o `|E|/N`? Con delegación no es lo mismo

**El conflicto.** A.6 declara `turnout: { cast, census, fraction }` sin decir **de qué** es
`fraction`. Con `cast` al lado, la lectura natural es `C/N`; D.1.1 define la participación como
`|E|/N` (miembros representados sobre censo). Sin delegación las dos coinciden y la ambigüedad es
invisible.

**Por qué importaba.** Con delegación divergen, y divergen justo donde más duele: **12 papeletas que
representan a 280 personas dan 4 % por una fórmula y 93 % por la otra**. Si `turnout.fraction` fuera
`C/N`, el resultado publicaría una participación distinta de la que decidió la validez de esa misma
decisión, y nadie sabría cuál de las dos citar en el acta. Es el material exacto de una disputa
post-electoral, que es lo que B.1.a dice que hay que eliminar fijando el denominador de antemano.

**Resolución.** **`fraction = |E|/N`**, la misma cifra del quórum de D.1.1 — y el resultado publica
**además `cast` y `represented` por separado**. «12 personas votaron» y «280 quedaron
representadas» son dos hechos políticos distintos y los dos deben ser visibles; colapsarlos en una
sola cifra, cualquiera de las dos, esconde exactamente el dato que la PARTE C obliga a vigilar —la
concentración de voz— y lo esconde de forma que sólo lo recupera quien reprocese el log. La `Proof`
debe enunciar los dos. Aplicado en `30-...` §A.6.

---

## Resumen del estado

| # | Contradicción | Estado |
|---|---|---|
| R1 | `MemberId` derivado contra aleatorio | **Resuelta** — resolución del arquitecto |
| R2 | Hashes de identificadores en el ledger | **Resuelta** — resolución del arquitecto |
| R3 | Borrado criptográfico como defensa jurídica | **Resuelta** — resolución del arquitecto |
| C4 | Cita fantasma del doc 11 al doc 20 | Resuelta (R3) |
| C5 | Seudónimos por proceso contra `MemberId` estable | Resuelta (R1) |
| C6 | Secreto del voto exigido contra el entregado | **Pendiente** — decisión consciente, requisito formalmente incumplido |
| C7 | Urna criptográfica: descarte permanente contra etapa 2 | Resuelta (por etapas) |
| C8 | SSO institucional que no existe | Resuelta (ADR-0012) |
| C9 | ¿Se recolecta el documento de identidad? | Resuelta (R1) — queda redefinir `enrollmentTag` |
| C10 | Qué se publica del padrón | **Pendiente** — arquitectura |
| C11 | Género como estrato en el padrón publicable | **Pendiente** — arquitectura + jurídico |
| C12 | Método para elegir personas | **Pendiente** — arquitectura |
| C13 | Secreto en decisiones sobre personas | **Pendiente** — corolario de C12 |
| C14 | `sha256` desnudo de texto libre | **Pendiente** — señalada en ambos documentos |
| C15 | `consent_record` sellado en el ledger | Resuelta (R2) |
| C16 | Abstención: quórum contra umbral | Aparente — unificar vocabulario |
| C17 | Retención de IP: 30 días contra 35 | **Pendiente** — trivial |
| C18 | Modelos de amenaza incompatibles | **Pendiente** — el hueco más grande del corpus |
| C19 | Sin regla de precedencia entre documentos | Resuelta (tabla de precedencia) |
| C20 | Delegación contra desconcentración | Tensión declarada, no contradicción |

**Parte 3, primera ronda — errores detectados por la implementación de `packages/crypto` contra la
spec 10 (2026-08-21).** Los ocho son **resoluciones del arquitecto** y están aplicados en el punto
exacto donde vivía el error.

| # | Error | Dónde vivía | Estado |
|---|---|---|---|
| E1 | `actor`/`aggregateId` en columna `uuid` ⇒ falso positivo de corrupción | `10-...` §1.1 vs §3.1 | **Resuelta** — `char(32)` + **regla de tipos del ledger** (§1.1-bis) |
| E2 | `SUBPROOF` sin caso base para `m = 0`; devolvía basura sin lanzar | `10-...` §7.2 | **Resuelta** — prueba vacía, como RFC 6962 |
| E3 | `Math.clz32` de 32 bits sobre un dominio declarado `bigint` | `10-...` §6.3, §7.2 | **Resuelta** — bucle explícito sobre `bigint` |
| E4 | Dos convenciones de hoja; el código reabría el ataque que la sección cierra | `10-...` §6.2 vs §6.3 | **Resuelta** — la API pública recibe entradas crudas |
| E5 | La espina `…-00000000ffff` no es un UUID v4, y §1.1 exigía v4 | `10-...` §1.1 vs §2.3 | **Resuelta** — espina `000…001`, sin UUID en el ledger |
| E6 | `checkpoint_hash` indefinido para el primer checkpoint | `10-...` §6.4 | **Resuelta** — `prevCheckpoint` se **omite** |
| E7 | Orden UTF-8 (ADR) contra orden UTF-16 (spec) | ADR-0004 vs `10-...` §1.3.c | **Resuelta** — manda JCS: UTF-16 |
| E8 | Dirección de dependencia `crypto`↔`domain` invertida | ADR-0001 | **Resuelta** — `crypto` no depende de nadie |
| E1′ | Cinco columnas más violaban la regla de tipos (`payload`, `occurred_at`, `issued_at`, `choice`, `receipt`) | `10-...`, `11-...` | **Resuelta** — halladas al aplicar §1.1-bis al corpus |
| E1″ | Tres representaciones del `MemberId`: base32 / hex / `uuid` | ADR-0006, `30-...`, `10-...` | **Resuelta** — hex de 32; **confirmar con el arquitecto** |
| E9 | `prevHash` dentro del objeto contra prefijo binario de 32 B | `30-...` §A.7 vs `10-...` §2.1 | **Pendiente** — decide el arquitecto; `crypto` implementó la spec 10 |

**Parte 3, segunda ronda — errores detectados por la implementación de `packages/domain` contra la
spec 30 (2026-08-21).** Los catorce son **resoluciones del arquitecto**, todos dentro de la spec 30,
todos aplicados en el pasaje exacto con su nota «Corregido tras la implementación».

| # | Error | Dónde vivía | Estado |
|---|---|---|---|
| E10 | `abstentionBlocks:false` inerte: `D = A+R+Ab` con `A=D` fuerza `Ab=0` siempre | `30-...` §B.4 | **Resuelta** — con `false` el denominador pasa a `A+R` |
| E11 | `resultHash` imposible: A.6 lo incluye `computedFromSeq`, INV-01 exige que no cambie | `30-...` §A.6 vs INV-01 | **Resuelta** — excluye `resultHash` **y** `computedFromSeq` |
| E12 | Semilla única del sistema contra semilla compuesta con faro externo | `30-...` §A.7 vs §B.0.3 | **Resuelta** — manda B.0.3; `SeedRevealed` publica `seedAdmin` **y** `beaconValue` |
| E13 | `base:'present'` invocaba `AttendanceRecorded`, evento inexistente | `30-...` §B.2.b vs §A.7 | **Resuelta** — `'present'` **retirado del MVP**: contradice *asynchronous-first* |
| E14 | «6 × 17 = 102 casos» con 19 tipos de evento en el catálogo | `30-...` INV-34 | **Resuelta** — 6 × 19 = **114**; **133** con el estado previo a `Draft` |
| E15 | `ProofTable.rows`: `readonly` sobre una unión de primitivos ⇒ TS1354 | `30-...` §A.6 | **Resuelta** — `readonly (readonly (string \| number)[])[]` |
| E16 | Frontera del alta: «después de `frozenAt`» (prosa) contra `≥` (invariante) | `30-...` §A.1 vs INV-03 | **Resuelta** — manda el invariante: `enrolledAt < frozenAt ≤ withdrawnAt` |
| E17 | B.3.b exige la firma del objetante; `ObjectionIntegrated` no tenía campo | `30-...` §A.7 vs §B.3.b | **Resuelta** — `signedBy: MemberId` |
| E18 | `votes` en `ObjectionAdmitted` en vez de `ObjectionDismissed` | `30-...` §A.7 vs §B.3.a | **Resuelta** — `votes` va en `ObjectionDismissed`; la admisión no se vota |
| E19 | Cierre manual «con 2 firmas» sin campo donde ponerlas | `30-...` §A.8.1 vs §A.7 | **Resuelta** — `signers` obligatorio ⟺ `cause:'manual'`; era **agujero de gobernanza**, no errata de tipos |
| E20 | `BallotVoided` y `DecisionDrafted` sin fila en A.8.1; `DraftConfig` indefinido | `30-...` §A.8.1 vs §A.7 | **Resuelta** — `BallotVoided` sólo en `Open`; `DecisionDrafted` crea el agregado; `DraftConfig` definido |
| E21 | «sólo actos constituyentes» y «autorización previa» sin campos que lo acrediten | `30-...` §B.2.a, §B.4.a | **Resuelta** — `constituentAct` y `unanimityAuthorizedBy`, dentro de `configHash` |
| E22 | `WindowExtended` y el instante exacto del cierre: tres reglas distintas | `30-...` §D.2 vs §A.8.1 vs §A.8.2.5 | **Resuelta** — tick con `occurredAt = closesAt`; prórroga ilegal desde ese instante **inclusive** |
| E23 | `turnout.fraction` sin definir: `C/N` o `\|E\|/N`; con delegación difieren | `30-...` §A.6 | **Resuelta** — `\|E\|/N`, y se publican `cast` y `represented` por separado |

### El dato acumulado

**Entre las dos especificaciones, la implementación ha encontrado ya unos 20 errores que ninguna
revisión por lectura detectó.** El desglose exacto, para que la cifra sea verificable y no un
eslogan:

| | Spec 10 (`crypto`) | Spec 30 (`domain`) | Total |
|---|---|---|---|
| Errores **dentro de la especificación** | 6 (E1–E6) | 14 (E10–E23) | **20** |
| Incoherencias entre ADR y specs | 2 (E7, E8) | — | 2 |
| Hallazgos derivados al propagar | 2 (E1′, E1″) | — | 2 |
| Divergencias elevadas sin cerrar | 1 (E9) | — | 1 |
| **Entradas de la parte 3** | 11 | 14 | **25** |

Las dos especificaciones habían pasado por la revisión editorial que produjo C4–C20 de la parte 2.
Ninguno de los 20 salió de esa revisión: **los 20 salieron de escribir el código y los tests**. Y la
segunda ronda invierte la intuición cómoda de que un documento mejor deja menos errores: la spec 30
—2 600 líneas, 60 invariantes formalizados, 7 anti-invariantes, apéndice de decisiones numeradas— es
el documento más cuidado del corpus y produjo **más del doble** que la spec 10.

Lo que predice los errores no es el descuido sino la **densidad de correspondencias internas**: la
spec 30 ata catálogo de eventos ↔ máquina de estados ↔ métodos ↔ invariantes, y nueve de sus catorce
errores son dos pasajes correctos por separado que no se sostienen juntos. Leer verifica argumentos;
la correspondencia entre un argumento y las cuatro líneas de tipos que tiene debajo sólo se verifica
ejecutándola. **Esa es la razón por la que la estrategia de pruebas de este proyecto
(`docs/TESTING.md`) trata implementar y escribir invariantes como parte de la revisión, y no como
una fase posterior a ella.**
