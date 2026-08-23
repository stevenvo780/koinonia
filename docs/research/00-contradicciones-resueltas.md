# 00 — Registro de contradicciones del corpus de investigación

> **Qué es este archivo.** Los documentos de `docs/research/` los escribieron agentes distintos, en paralelo, sin un árbitro. Se contradicen entre sí en puntos que no son de matiz. Este archivo documenta **qué decía cada documento, en qué consistía el conflicto, cómo se resolvió y por qué**.
>
> Es **memoria del proceso**, no documentación de producto. Si dentro de dos años alguien se pregunta por qué el `MemberId` es aleatorio, o por qué no apostamos al borrado criptográfico, la respuesta está aquí y no hay que reconstruirla.
>
> **Fecha:** 2026-08-21 · **Autoridad:** las resoluciones **R1, R2 y R3** las tomó el arquitecto y son firmes. Las contradicciones **C4 en adelante** las detectó la revisión editorial del corpus; las que R1–R3 adjudican de forma derivada se marcan como **resueltas**, y las que exigen una decisión nueva quedan **pendientes** con la recomendación del editor, que no tiene autoridad para cerrarlas.
>
> **Tres partes, tres formas de encontrar un error.** La **parte 1** (R1–R3) son resoluciones del arquitecto sobre conflictos de fondo. La **parte 2** (C4–C20) la produjo una **revisión editorial**: leer el corpus y compararlo consigo mismo. La **parte 3** (E1–E46 y E78–E87, en cinco rondas) la produjo **implementar el código**: `packages/crypto` contra `10-ledger-inmutable.md`, `packages/domain` contra `30-decision-engine-spec.md` (tres veces) y el asistente de acción sistémica contra `03-deliberativa-sistemas-antipatrones.md`. Las tres partes encuentran cosas distintas, y la tercera encontró justo lo que las dos primeras no podían encontrar. Está argumentado en la cabecera de la parte 3, y es la conclusión más reutilizable de este archivo.

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
> entre sí. Los errores E1–E46 y E78–E87 de abajo los encontró otra cosa: **alguien escribiendo el código**.
>
> Hay cinco rondas, contra tres especificaciones distintas:
>
> | Ronda | Paquete | Spec | Errores | Pruebas en verde al terminar |
> |---|---|---|---|---|
> | 1ª | `packages/crypto` | `10-ledger-inmutable.md` | **E1–E9** — seis en la spec, dos incoherencias entre ADR, una divergencia elevada sin cerrar | 116 |
> | 2ª | `packages/domain` | `30-decision-engine-spec.md` | **E10–E23** — catorce, todos dentro de la spec | 229 |
> | 3ª | `packages/domain` (B.5–B.9) y `packages/consensus` | `30-decision-engine-spec.md` PARTE B, `01-decidim-loomio-polis.md` §3 | **E24–E35** — once en la spec, **una retirada por ser error propio**, más tres bugs del código (B1–B3) | 1 006 en todo el repositorio |
> | 4ª | `packages/domain` (PARTE C) | `30-decision-engine-spec.md` PARTE C y §D.4 | **E36–E46** — once en la spec, **tres autodestructivas** | 1 213 en todo el repositorio |
> | 5ª | `packages/domain` (asistente) | `03-deliberativa-sistemas-antipatrones.md` §3.1 | **E78–E87** — diez errores de especificación | 2 025 en todo el repositorio |
>
> **Fechas:** 2026-08-21 las dos primeras rondas, 2026-08-22 la tercera, la cuarta y la quinta · **Autoridad:**
> las resoluciones las tomó el arquitecto y son firmes. Cada una está aplicada en el punto exacto del
> documento donde vivía el error, con una nota **«Corregido tras la implementación»** que explica qué
> decía antes y qué rompía.
>
> **El dato acumulado, que es el hallazgo principal de esta parte: la implementación ha encontrado ya
> 52 errores que ninguna revisión por lectura detectó** —seis en la spec 10, treinta y seis en la
> spec 30 y diez en la spec 03—, y las tres habían pasado por la revisión editorial que produjo C4–C20 de la parte 2. No es
> un accidente de un documento flojo: es lo que se puede esperar de cualquier especificación no
> ejecutada, por buena que sea. Ver «El hecho metodológico» abajo y su confirmación en las rondas
> segunda, tercera y cuarta.

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

# Tercera ronda — métodos de escrutinio B.5–B.9 y consenso transversal (2026-08-22)

Se implementaron los cinco métodos que faltaban de la PARTE B (`ADR-0047`) y el análisis de consenso
tipo Pol.is en un paquete nuevo (`ADR-0048`). **Doce entradas: una retirada, once errores de spec, y
tres bugs propios encontrados al implementar** que se registran aparte porque no son del documento
sino del código, y son del tipo autodestructivo.

**Lo nuevo de esta ronda, y por qué se registra el error propio.** La primera entrada, **E24, quedó
RETIRADA**: se levantó como error de la especificación y resultó ser un **error del orquestador**. La
spec tenía razón. Se deja **visible y tachada**, con la explicación de por qué se creyó lo contrario,
porque un registro que borra sus propios errores deja de servir para aprender: el modo de fallo
—«corregir» un documento correcto y anclar la corrección en un test— es exactamente el de C4, ahora en
primera persona.

**Dos patrones nuevos**, que no aparecían en las dos rondas anteriores:

1. **La fórmula copiada entre dos vectores orientados al revés** (E25). El documento dice «misma
   convención que B.7» y la convención **sí** es la misma; lo que no puede ser la misma es la
   fórmula, porque los dos vectores están ordenados en sentidos opuestos. Copiarla devuelve
   exactamente el valor contrario al que manda la convención. No falla, no lanza: elige la otra
   opción.
2. **El invariante afirmado al revés por quien escribe la spec.** No lleva ficha `E-NN` porque no
   está en la spec 30 sino en la especificación **nueva** de esta ronda, que produjo un modelo y que
   afirmó como invariantes que Majority Judgment satisface *later-no-harm* y el criterio de mayoría.
   **Las dos son falsas**, y las refutó con contraejemplos numéricos el modelo que la implementó. El
   detalle está en `ADR-0047`. Es el caso de `MODEL_CONTEXT.md` §4.2 en su forma útil: la salida de
   un modelo es una hipótesis, y la verificó otro.

## E24 — ~~la mediana par de B.7~~ · **RETIRADA: el error era del orquestador, no de la spec**

> **Esta entrada no es un error de la especificación.** Se conserva tachada, con su explicación, en
> vez de borrarse.

**Lo que se afirmó.** Que B.7 y INV-49 eran incoherentes con la convención *lower middlemost* y que
la mención mayoritaria con `W` par debía calcularse con `floor((W-1)/2)`. Se implementó así y se
dejó **anclado por escrito en un test** —«la mediana par usa `floor((W-1)/2)` — contradice INV-49»—
una contradicción con el documento normativo.

**Por qué era falso.** La spec es coherente consigo misma y verifica su propia regla a mano: con las
`W` menciones ordenadas **de mejor a peor** (`0` = mejor), `α = g_{⌊W/2⌋}`; con `W = 2` y
`{Excelente, Rechazar}`, `α = g_1 = Rechazar`, que es la **peor** de las dos centrales, o sea la
convención pesimista de Balinski–Laraki. `floor((W-1)/2)` sobre ese mismo vector devuelve
`Excelente`, la mejor: es la convención contraria.

**Resolución.** Se retira la ficha, se restituye `floor(W/2)` en B.7 y **se corrige la aserción del
test**, amparado en `TESTING.md` §14 —«bug de test»— porque el documento normativo decía literalmente
lo contrario de lo que el test afirmaba. Lo que sí queda vivo es **E25**, que es el error de verdad y
que estaba al lado.

**Lo que deja el episodio, y es lo que justifica no borrarla:** una directiva del orquestador llegó
con forma de corrección, y **una corrección recibe menos escrutinio que una afirmación nueva**. Es la
misma lección de C4, con los papeles invertidos. La regla que queda: **una corrección a un documento
normativo se verifica contra el pasaje literal antes de implementarla**, igual que se verifica una
cita.

*Vive en:* `packages/domain/test/tally-majority-judgment.test.ts` › «INV-49 — con W par la mención
mayoritaria es la PEOR de las dos centrales».

## E25 — «misma convención que B.7» en B.5: la misma fórmula elige menciones contrarias

| Documento | Qué decía |
|---|---|
| `30-...` §B.5 | la mediana ponderada es la «mediana inferior, **misma convención que B.7**» |
| `30-...` §B.7 | mención mayoritaria = `g_{⌊W/2⌋}` sobre menciones ordenadas **de mejor a peor** |

**El conflicto.** B.5 indexa las puntuaciones **de peor a mejor** (`0` … `5`) y B.7 indexa las
menciones **de mejor a peor** (`0` = Excelente). La convención semántica —con `W` par, la **peor** de
las dos centrales— es efectivamente la misma; **la fórmula no puede serlo**. Sobre un vector
ascendente la peor de las dos centrales es la de índice **menor**, y la posición es `⌊(W−1)/2⌋`; sobre
uno descendente es la de índice **mayor**, y la posición es `⌊W/2⌋`.

**Por qué importaba.** Aplicar `⌊W/2⌋` en B.5, que es lo que la frase invita a hacer, devuelve la
**mejor** de las dos centrales. No lanza ningún error y no rompe ningún tipo: cambia el ganador en
todo perfil con peso par y puntuaciones centrales distintas, que es el caso corriente. Es el mismo
modo de fallo que E1: el sistema hace algo razonable y equivocado, en silencio.

**Resolución.** «Misma convención» vale **sólo para la semántica, nunca para el índice**. B.5 usa
`⌊(W−1)/2⌋` y B.7 usa `⌊W/2⌋`, y las dos frases quedan enunciadas por la propiedad que producen —«la
peor de las dos centrales»— y no por la fórmula. Aplicado en `30-...` §B.5 (líneas 1332 y 1370).

*Vive en:* `packages/domain/src/tally/score.ts`, en la documentación de `weightedMedian`.

## E26 — B.9 reparte las cuotas del sorteo con división en punto flotante, contra ADR-0027

**El conflicto.** B.9 calcula cuotas y restos del reparto estratificado dividiendo en punto flotante.
ADR-0027 prohíbe el punto flotante en toda comparación que decida un resultado, y por la jerarquía de
`adr/README.md` el ADR manda sobre la spec 30.

**Por qué importaba.** El reparto por mayores restos se decide **comparando restos**. Un resto
calculado en coma flotante puede empatar donde no empata, o desempatar donde debería empatar, y el
efecto es que **una persona entra a una comisión deliberativa y otra no** por el orden en que se
acumularon las sumas. No hay forma de explicarle eso a nadie, y no habría forma de detectarlo:
sucedería una vez.

**Resolución.** Hamilton con **productos, cocientes y restos enteros**; el producto
`sampleSize × peso` en `bigint`; los restos se comparan como enteros exactos y su orden se resuelve
con el ticket verificable, no con redondeo. Aplicado en `30-...` §B.9.

*Vive en:* `packages/domain/src/tally/sortition.ts`, `hamiltonQuotas`.

## E27 — INV-55 afirmaba dos cosas incompatibles cuando `sampleSize > N`

**El conflicto.** INV-55 exige a la vez `|muestra| = min(sampleSize, N)` y `Σ quota = sampleSize`. Si
`sampleSize > N` las dos no pueden ser ciertas: la primera acota la muestra al padrón y la segunda
manda repartir más plazas que personas hay.

**Por qué importaba.** Es un invariante insatisfacible, el patrón 3 de la segunda ronda, y con la
salida barata de siempre: debilitar el invariante hasta que pase y dejar la comprobación
desactivada. El caso no es teórico —una comisión sorteada de 30 sobre un círculo de 12 es
perfectamente posible— y ahí el motor tenía que hacer *algo* sin que el documento dijera qué.

**Resolución.** **Se acota antes de repartir:** `sampleSize ← min(sampleSize, N)`, y a partir de ahí
las dos igualdades se sostienen sin tocar ninguna. La `Proof` publica el tamaño solicitado y el
efectivo, para que el recorte sea un hecho visible y no un silencio. Aplicado en `30-...` INV-55.

## E28 — B.9.b manda redistribuir el faltante y su pseudocódigo no compara nunca cuota con tamaño

**El conflicto.** B.9.b dice que si un estrato tiene menos miembros que su cuota, el faltante se
redistribuye entre los demás. El pseudocódigo de la misma sección **no compara en ningún punto la
cuota con el tamaño del estrato**, así que la regla es inimplementable tal como está escrita.

**Por qué importaba.** Es la regla que decide qué pasa en el único caso en que el sorteo estratificado
se comporta distinto de un sorteo simple. Sin ella, el motor devuelve una muestra más corta que la
pedida y nadie se entera, o intenta tomar 8 de un estrato de 5 y falla por índice fuera de rango.

**Resolución.** La cuota se recorta al tamaño del estrato (`min(⌊cuota⌋, |estrato|)`) y el faltante se
reasigna en el orden de los restos, saltando los estratos ya llenos. Si aun así no se completa la
muestra —porque el padrón entero es menor—, **falla con error tipado**; no devuelve una muestra corta
como si nada. Aplicado en `30-...` §B.9.b.

## E29 — B.9.c: `⌈n/3⌉` suplentes con `n` ambiguo

**El conflicto.** B.9.c fija el número de suplentes en `⌈n/3⌉` sin decir qué es `n`: el tamaño de la
muestra completa o la cuota del estrato. Las dos lecturas son gramaticalmente válidas y dan números
muy distintos.

**Por qué importaba.** Los suplentes son la defensa contra repetir el sorteo hasta que salga quien
convenga. Si cada estrato calcula sus suplentes con un `n` distinto del que usó el vecino, la lista de
suplentes deja de ser comparable y el argumento «son los siguientes tickets, sin sorteo nuevo» se
debilita.

**Resolución.** `n` es el **tamaño de la muestra ya acotado** (E27), igual para todos los estratos.
Aplicado en `30-...` §B.9.c.

## E30 — la cascada de desempate de IRV empieza por una regla que en la ronda 1 no hace nada

**El conflicto.** B.6.b propone como primer criterio de desempate «menos primeras preferencias en
rondas previas». En la ronda 1 **no hay rondas previas**: el criterio es un no-op.

**Por qué importaba.** La ronda 1 es justamente donde el empate es más probable, porque es donde más
opciones siguen vivas y donde los recuentos son más bajos. Una cascada cuyo primer escalón no hace
nada en el caso más frecuente no es una cascada: es un escalón menos, y el desempate cae al
siguiente sin que nadie lo haya decidido.

**Resolución.** La regla se conserva en el catálogo —sirve de la ronda 2 en adelante— pero **deja de
proponerse como primera red**: `DEFAULT_TIE_BREAK` es `['lexicographic-hash']`, que es además la
última instancia implícita de toda cascada. El motor no puede prohibir configurarla primero, así que
queda documentada como configuración legal e inútil. Aplicado en `30-...` §B.6.b.

## E31 — B.6 usa dos formas incompatibles para el mismo `IrvRound`

**El conflicto.** La PARTE B.6 define la estructura de una ronda de IRV de dos maneras distintas en
dos pasajes, con campos que no coinciden. No hay forma de escribir un solo tipo que satisfaga las dos.

**Por qué importaba.** `IrvRound` es lo que se publica en la `Proof`: es el objeto por el que un
auditor rehace la eliminación paso a paso. Dos formas incompatibles significan que la mitad de las
implementaciones posibles produce una prueba que la otra mitad no puede leer.

**Resolución.** Se unifica en una sola forma, la que permite reconstruir la ronda completa —recuentos
por opción, eliminada y transferencias—, y la otra se retira. Aplicado en `30-...` §B.6.

## E32 — B.8 llama a `lexRank`, que no está definido en ninguna parte del documento

**El conflicto.** El pseudocódigo de Condorcet/Schulze invoca `lexRank` para el desempate final. El
identificador **no aparece definido en ningún punto de la especificación**.

**Por qué importaba.** Es el último escalón de la cascada, el que garantiza que el escrutinio termina
con un ganador y no con un empate irresoluble. Sin definición, cada implementación inventa el suyo, y
dos implementaciones honestas devuelven ganadores distintos sobre la misma urna, que es el escenario
que toda la PARTE B existe para impedir.

**Resolución.** Se sustituye por `lexicographic-hash`, que **sí** está definido y ya es la última red
del resto de métodos: orden por un hash que depende del `decisionId` y de la opción, reproducible por
cualquiera. Aplicado en `30-...` §B.8.

## E33 — B.8 exige la semilla revelada, y nada la hace llegar al escrutinio

**El conflicto.** B.8 exige la semilla comprometida y ya revelada para los desempates por sorteo. Ni
A.5 ni B.8 la hacen llegar al escrutinio de los métodos **que no son el sorteo**: la semilla viaja en
el camino del sorteo estratificado y en ningún otro.

**Por qué importaba.** Es la regla que el motor no puede verificar, patrón 2 de la segunda ronda. El
implementador honesto tiene dos salidas: inventar un desempate determinista sin semilla —y entonces
el desempate lo elige quien programó— o dejar el caso sin cubrir. Ninguna es lo que el documento
quería.

**Resolución.** La semilla revelada entra al escrutinio de **todos** los métodos que admitan una regla
de desempate por sorteo, y **si falta, el escrutinio falla**: no cae a un desempate silencioso.
Aplicado en `30-...` §A.5 y §B.8.

## E34 — INV-43 exige que el ganador de Condorcet gane, y la spec nunca pide reportarlo

**El conflicto.** INV-43 obliga a que, si existe ganador de Condorcet, el método lo elija. La
especificación **no pide en ningún sitio publicarlo** en la `Proof`.

**Por qué importaba.** Es la diferencia entre una prueba verificable y una que hay que creerse. Con el
ganador de Condorcet reportado, la asamblea lee «X le gana uno contra uno a todas las demás» y lo
comprueba con la tabla de enfrentamientos delante. Sin él, lo que se publica es «camino más fuerte
143 contra 128», que es correcto, es el resultado del método, y **nadie fuera del equipo técnico
puede comprobarlo**. Un resultado que sólo puede verificar quien lo calculó no es una prueba.

**Resolución.** La `Proof` de B.8 publica la tabla de pares y **declara explícitamente** si hay
ganador de Condorcet o si no lo hay; el camino más fuerte se publica además, no en lugar de.
Aplicado en `30-...` §B.8 e INV-43.

*Vive en:* `packages/domain/src/tally/condorcet-schulze.ts`.

## E35 — `noOpinionPolicy: 'as-zero'` es el fallo que INV-50 tipifica como error

**El conflicto.** A.3 admite `noOpinionPolicy: 'as-zero'` como opción de configuración: quien no
califica una opción cuenta como si la hubiera puntuado con cero. INV-50 describe ese mismo
comportamiento como el fallo ingenuo del voto por puntuación.

**Por qué importaba.** Tratar la ausencia como un cero **hunde sistemáticamente a las propuestas menos
conocidas**: cuanta menos gente la haya leído, más ceros acumula, y el método castiga la falta de
exposición como si fuera rechazo. Es el sesgo que la cobertura mínima existe para neutralizar, y
estaba disponible en un desplegable.

**Resolución.** El documento no puede ofrecer como configuración lo que su propio invariante tipifica
como error. `'as-zero'` se retira de A.3; la ausencia se trata por cobertura mínima y por las
políticas que no inventan un juicio que nadie emitió. Aplicado en `30-...` §A.3 e INV-50.

---

## Tres bugs propios de la tercera ronda: no fallan, sabotean en silencio

No son errores de la especificación sino del código escrito contra ella. Se registran aquí porque
comparten la firma de E1 y de los tres de `services/api`: **no producen un fallo, producen un sistema
que se sabotea a sí mismo sin avisar**, y los tres los encontró alguien auditando lo que otro agente
había dejado escrito, no la suite en verde que ese agente entregó.

### B1 — Majority Judgment ignoraba `missingGradePolicy: 'reject-ballot'`

El escrutinio imputaba «Rechazar» a las opciones que nadie había calificado, incluso con la política
configurada para descartar la papeleta entera. **Es exactamente el sesgo de E35, por la puerta de
atrás:** la opción menos conocida acumula rechazos que nadie emitió. La suite estaba en verde porque
ninguna prueba distinguía las dos políticas.

La corrección devuelve la papeleta incompleta al margen en vez de rellenarla, lo que además preserva
la precondición de `mjCompare` —que `W` sea idéntico para todas las opciones—, que rellenar rompía.

*Vive en:* `packages/domain/src/tally/majority-judgment.ts`, `usableGradeBallots`, y su prueba en
`packages/domain/test/tally-majority-judgment.test.ts` › «B.7.b — con reject-ballot la papeleta
incompleta se descarta entera».

### B2 — el codec de `services/api` no conocía las ocho reglas de desempate nuevas

`TIE_BREAK_RULES` en `services/api/src/decision/codec.ts` conservaba las ocho reglas originales.
Las ocho de los métodos nuevos —`higher-mean`, `fewer-zeros`, `more-fives`,
`fewer-first-preferences-in-previous-rounds`, `more-excellent`, `fewer-reject`, `more-pairwise-wins`,
`higher-min-margin`— **no estaban en la lista de valores admitidos al decodificar**.

Consecuencia: **toda configuración de decisión que usara una de ellas habría sido rechazada al releer
el ledger**, es decir al reconstruir el estado. Y **no daba ningún error de compilación**, porque la
lista es un arreglo de literales y el dominio y el codec no comparten su fuente. El dominio aceptaba
la configuración, la decisión se escribía, y la decisión moría al replay.

Es el peor modo de fallo posible para un sistema de event sourcing: **el hecho está escrito y el
sistema ya no puede leerlo**. La prueba obligatoria que deja es de ida y vuelta sobre **todas** las
reglas, no sobre una muestra.

### B3 — en `packages/consensus`, los índices de afirmación se permutaban dos veces

El ranking de afirmaciones se construía pasando la permutación de columnas a una función que ya
trabajaba en el orden de entrada. El resultado: **los números eran correctos y estaban bien ordenados,
colgando de la afirmación equivocada** siempre que el orden canónico de columnas no fuera la
identidad, es decir en cuanto dos afirmaciones tuvieran distinto número de respuestas — el caso
corriente.

Una salida así pasa cualquier revisión de plausibilidad: las cifras son verosímiles, el orden es
monótono, la suma cuadra. Lo único que la delata es una prueba que siga a **cada afirmación con sus
propios números** a través de una permutación, y esa prueba existe ahora.

*Vive en:* `packages/consensus/src/index.ts`, en el comentario de `analizarConsenso`, y
`packages/consensus/test/props/determinismo.test.ts` › «la traducción de índices es fiel: cada
afirmación conserva SUS números».

---

# Cuarta ronda — democracia líquida, PARTE C (2026-08-22)

Se implementó la PARTE C entera —delegación temática con especificidad, vigencia y revocación
inmediata, recorrido de cadenas, tope de concentración e índices— más la parte de la PARTE D que la
delegación toca. **Once erratas, E36 a E46. Tres son autodestructivas.**

**Por qué esta ronda merecía su propia cabecera.** La PARTE C se abre con una advertencia que ahora
se lee distinto: «una delegación mal modelada no produce un error visible: produce un resultado
**plausible y falso**, con votos que nadie emitió y poder que nadie confirió». Las tres erratas
autodestructivas de esta ronda son exactamente eso, y ninguna es un descuido de redacción:

- **E37** es un **teorema falso**, enunciado como teorema, con su demostración informal al lado y su
  pseudocódigo debajo. La demostración es correcta; lo que falla es la hipótesis, porque la sección
  que la usa (C.4.1) no había leído la sección que la rompe (C.2).
- **E38** es una **precondición que ninguna papeleta legítima puede cumplir** a partir de la ronda 2.
  No lanza: descarta. Toda decisión sociocrática que integrara una objeción habría cerrado con
  no-quórum, y el no-quórum es un desenlace legítimo, así que nadie lo habría investigado.
- **E42** es una **cota que no acota**. El motor firma «este resultado ya no puede cambiar» sobre uno
  que sí puede, y cierra la urna con esa firma detrás.

**El patrón nuevo, que no aparecía en las tres rondas anteriores: el error de ÁMBITO.** Cinco de las
once (E36, E37, E38, E41, E42) tienen la misma forma: **una sección razona correctamente dentro de su
propio marco, y el marco es más chico que el problema**. C.4.1 razona sobre un grafo por ámbito y la
resolución vive en el grafo mezclado; C.3 razona sobre una decisión y la ronda vive fuera de la
configuración; C.6 razona sobre `n ≥ 2` votantes y el caso que quiere vigilar es `n = 1`; D.4.1 razona
sobre un mundo sin delegación dentro del documento que introduce la delegación; y el evento de
delegación razona como si su alcance fuera una decisión cuando su alcance es la comunidad entera.

Es un modo de fallo distinto del de la segunda ronda —«dos pasajes correctos por separado que no se
sostienen juntos»— y **peor de detectar**, porque aquí ni siquiera hay dos pasajes que comparar: hay
uno solo, correcto, aplicado fuera de su dominio de validez. Leerlo no lo delata. Lo delata escribir
el segundo caso de prueba.

## E36 — El evento de delegación vive en el agregado de la decisión, y una delegación no es de una decisión

| Documento | Qué decía |
|---|---|
| `30-...` §A.7 | `DelegationGranted` y `DelegationRevoked` están en el catálogo de eventos **del agregado decisión** |
| `30-...` §A.8.1 | fila `\| Open \| DelegationGranted/Revoked \| Open \| ver PARTE C \|` — sólo son legales dentro de una decisión abierta |
| `30-...` §C.1 | `grantedSeq` es «`seq` del evento `DelegationGranted` (orden canónico)» |
| `30-...` §C.1.a, §C.2 | el ámbito de una delegación es `global`, `circle` o `topic`, y su vigencia por defecto es **un semestre** |

**El conflicto.** El ámbito de una delegación es **transversal y prospectivo**: «delego filosofía
política a Ana durante este semestre» vale para las decisiones sobre ese tema que **todavía no
existen**. Un agregado por decisión no puede alojar ese hecho, y las consecuencias no son teóricas:

1. **`grantedSeq` deja de ordenar.** El `seq` de una delegación concedida en el log de la decisión
   `D₁` y el de otra concedida en el log de `D₂` **no son comparables**: son dos numeraciones
   independientes, cada una empezando en 1. Y C.2 desempata la especificidad por `grantedSeq`, y
   C.5.b.2 devuelve el excedente en orden LIFO de `grantedSeq`. Dos reglas normativas que ordenan por
   una clave que no es un orden total.
2. **El registro no se puede reconstruir plegando un agregado.** Para saber quién delega en quién hoy
   hay que plegar **todos** los logs de **todas** las decisiones, incluidas las cerradas y las
   anuladas, y las delegaciones concedidas antes de que existiera la decisión donde harían falta no
   están en ninguno.
3. **La prevención EX ANTE de C.4.a y C.5.b.1 queda sin sujeto.** Rechazar al conceder exige conocer
   el grafo completo en el momento de conceder; si el grafo está troceado por decisión, no hay
   momento en que exista.

**Por qué importaba.** No es un error de tipos: es que **el agregado elegido no puede sostener el
invariante que la propia PARTE C declara**. Es la contrapartida exacta de la DECISIÓN A.1 (el padrón
se congela por decisión y es inmutable): el padrón **sí** es un hecho de la decisión; la delegación
**no**.

**Resolución.** El motor recibe el registro de delegaciones **por cierre**, como parámetro de
`resolveDelegation` y de las comprobaciones EX ANTE, y no lo lee del log de la decisión. Es la salida
mínima que no miente: deja explícito que el registro **viene de fuera** en vez de fingir que se pliega
de dentro. **Queda pendiente una decisión de arquitectura:** un agregado `DelegationRegistry` propio,
con su propia cadena de hashes y su propia numeración —que sería la que hace de `grantedSeq` un orden
total de verdad—. Hasta que exista, `grantedSeq` es un orden total **por convención del llamador**, y
eso está declarado donde se usa.

*Vive en:* `packages/domain/src/delegation.ts:306` y `:536`.

## E37 — AUTODESTRUCTIVA · «prevención completa» es un teorema falso: el contraejemplo tiene dos aristas

| Documento | Qué decía |
|---|---|
| `30-...` §C.4.1 | «rechazar en el momento de conceder toda arista `A → B` tal que `B` ya alcanza a `A` es una prevención **completa**: nunca puede existir un ciclo» |
| `30-...` §C.4.1, `wouldCreateCycle` | `for (const scopeKey of effectiveScopeKeys(d.scope))` — la alcanzabilidad se comprueba **ámbito por ámbito**, con una arista por `(nodo, ámbito)` |
| `30-...` §C.2 | «gana la de **mayor especificidad**» — la resolución **elige entre ámbitos distintos** para armar un solo grafo |

**El conflicto.** El teorema operativo es correcto: en un grafo acíclico al que se añaden aristas de
una en una, todo ciclo nuevo contiene la última arista. Lo que es falso es que comprobarlo **por
ámbito** implique que no haya ciclos **en el grafo que de verdad se recorre**.

**El contraejemplo, de dos aristas:**

```
Ana  → Beto   ámbito: global      (especificidad 0)
Beto → Ana    ámbito: topic T     (especificidad 2)
```

Ninguno de los dos ámbitos, por separado, tiene ciclo: en `global` sólo existe `Ana → Beto`, y en
`topic T` sólo existe `Beto → Ana`. `wouldCreateCycle` acepta las dos concesiones, y hace bien según
su propia definición. Pero en una decisión `D` con `T ∈ D.topics`, C.2 resuelve el ámbito **por
delegante**: para Ana gana su global (es su única activa que casa) y para Beto gana la de tema (gana
por especificidad). El grafo efectivo de esa decisión es **`Ana → Beto → Ana`**.

**Por qué importaba.** El ciclo llega **exactamente al escrutinio**, que es donde C.4.b lo trata como
«no debería ocurrir». Y su consecuencia es silencio: Ana, Beto y **todos los que desembocan en
ellos** quedan sin asignar, descubierto cuando la urna ya está cerrada y no se puede votar. La
prevención EX ANTE existe precisamente para que eso no pase, y estaba desactivada para la familia de
ciclos más natural que hay: la que aprovecha que la gente delega temas distintos a personas distintas.
La sección que declara la prevención completa es la misma que la vuelve incompleta, en el pseudocódigo
que tiene tres líneas más abajo. Es la firma de E1 y de E4.

**Resolución.** La prevención se hace sobre el **grafo unión** —toda arista vigente, sea cual sea su
ámbito—, que es un supergrafo de todo grafo efectivo posible. Si el delegante no es alcanzable desde
el delegado en la unión, no lo es en ninguna decisión, hoy ni dentro de seis meses: la prevención
vuelve a ser completa, y ahora sí en el sentido que la palabra tiene.

El precio: se rechaza alguna concesión que en la práctica nunca habría ciclado. Se acepta porque **las
dos consecuencias no son simétricas** — un rechazo al conceder es un mensaje inmediato y accionable
(«delegá en otra persona»); un ciclo no detectado es silencio en el escrutinio para un conjunto de
personas que no hicieron nada mal. La red de seguridad del escrutinio se conserva: un log fabricado a
mano puede contener ciclos que ninguna orden habría aceptado.

*Vive en:* `packages/domain/src/delegation-graph.ts:8-33` (el argumento completo) y `unionEdges`
en `:250`; su prueba en `packages/domain/test/delegation-engine.test.ts:352`.

## E38 — AUTODESTRUCTIVA · el PASO 1 filtra por un campo que no existe y por un hash que cambia

| Documento | Qué decía |
|---|---|
| `30-...` §C.3, PASO 1 | `if (b.round !== cfg.currentRound) continue;` y `if (b.proposalVersionHash !== cfg.proposalVersionHash) continue;` |
| `30-...` §A.5, `interface DecisionConfig` | los 15 campos de la configuración. **No hay `currentRound`.** |
| `30-...` §A.5 | `proposalVersionHash` es «hash de la versión EXACTA del texto sometido a decisión», dentro de `configHash` — es decir, **congelado al abrir** |
| `30-...` §A.7 | `RoundOpened { round, proposalVersionHash }` — la ronda y el hash vigentes viven en **el log**, y cambian con cada objeción integrada |

**El conflicto, que son dos.** El primero es trivial de ver y trivial de arreglar mal: `cfg.currentRound`
**no existe**. `DecisionConfig` no tiene ese campo y no puede tenerlo, porque la ronda cambia durante
la ventana y la configuración es inmutable hasta el cierre (T-08 del modelo de amenaza depende de que
lo sea). La salida barata —añadirlo a la configuración— rompería la inmutabilidad que sostiene la
defensa contra el ataque de gobernanza más rentable del catálogo.

El segundo es el peligroso. `cfg.proposalVersionHash` es el hash **congelado al abrir**. Pero el ciclo
sociocrático de B.3 integra objeciones, y cada `ObjectionIntegrated` publica un
`newProposalVersionHash` y abre una ronda nueva con él. Las papeletas de la ronda 2 llevan, como manda
la DECISIÓN A.6, el hash de **la versión que votaron**, que ya no es el congelado.

**Por qué importaba.** Aplicar el PASO 1 literalmente **descarta todas las papeletas de la ronda 2 en
adelante**. No lanza, no avisa, no deja rastro: `direct` queda vacío, la participación da cero, y el
motor devuelve `no-quorum`. Y **`no-quorum` es un desenlace legítimo y frecuente**, así que nadie lo
investiga: se lee como «la gente no votó». El resultado es que **toda decisión sociocrática que
integre una objeción muere de no-quórum fantasma** — es decir, precisamente las decisiones en las que
el procedimiento funcionó como debe, porque alguien objetó y la objeción se integró. El sistema
castiga con silencio el único caso que su segundo principio («no todo se resuelve por mayoría») existe
para proteger.

**Resolución.** Los dos filtros **salen del PASO 1**. `resolveDelegation` no puede comprobarlos:
ninguno de los dos datos es derivable de `DecisionConfig`. La ronda vigente y el hash de propuesta
vigente se resuelven **aguas arriba**, en el motor, que sí pliega el log y sí conoce el último
`RoundOpened`; lo que le llega a la resolución de pesos son las papeletas **ya filtradas por el
contexto correcto**. La frontera queda documentada en el punto exacto donde estaban los dos `continue`,
para que nadie los reponga.

*Vive en:* `packages/domain/src/delegation.ts:144-149`.

## E39 — Un pliegue puro no emite eventos, y C.1.b le manda emitir uno

**El conflicto.** La DECISIÓN C.1.b dice que conceder una delegación nueva para el mismo
`(delegator, scope)` «**emite automáticamente** `DelegationRevoked` de la anterior, con
`revokedAt = grantedAt` de la nueva».

Un pliegue —`apply(estado, evento) → estado`— **no emite**. Si emitiera, dejaría de ser función del
log: el estado ya no sería `fold(apply, ∅, eventos)` sino algo que depende de qué eventos generó el
pliegue por su cuenta, y **el replay dejaría de ser reproducible** — dos replays del mismo log podrían
divergir según cuántas revocaciones automáticas se fueran generando y en qué orden se intercalaran.
Es exactamente lo que INV-01 y el principio 5 del proyecto prohíben.

**Por qué importaba.** Es menos visible que las tres autodestructivas y más profundo: **es la
diferencia entre event sourcing y un ORM con historial**. Implementarlo tal como está escrito produce
un sistema que parece reproducible y no lo es, y el día en que dos réplicas discrepen nadie sabrá por
qué.

**Resolución.** El desplazamiento se aplica **dentro del pliegue**, sin emitir nada: al plegar un
`DelegationGranted` cuyo `(delegator, scopeKey)` ya está ocupado, la delegación anterior queda con
`revokedAt = grantedAt` de la nueva **en el estado**. El log con la revocación explícita y el log sin
ella se pliegan al **mismo estado**, que es la propiedad que se quería y la que se prueba. Si además
llega un `DelegationRevoked` explícito, es idempotente.

*Vive en:* `packages/domain/src/engine.ts:392`.

## E40 — INV-27 es insatisfacible con censos pequeños, y la salida barata era desactivarlo

| Documento | Qué decía |
|---|---|
| `30-...` §C.5 | `capWeight = ⌊ cap.num × N / cap.den ⌋`, `cap` por defecto `1/10` |
| `30-...` INV-27 | `∀ b ∈ effectiveBallots : b.weight ≤ ⌊cap.num · N / cap.den⌋` |
| `30-...` §C.3, PASO 4 | `peso(v) = 1 (propio) + \|{ d : assignedTo(d) = v, d ≠ v }\|` |

**El conflicto.** Con `N = 5` y `cap = 1/10`, `capWeight = ⌊5/10⌋ = 0`. Pero **el peso propio vale 1 y
no es devolvible**: `return-to-delegator` devuelve delegaciones recibidas, y el voto de uno mismo no
es una delegación recibida. Toda papeleta efectiva tiene peso `≥ 1 > 0`, luego **toda papeleta viola
INV-27**. El invariante es insatisfacible, no por un caso raro sino por aritmética: pasa con todo
`N < cap.den`, y con `1/10` eso es cualquier círculo de menos de diez personas — que en un instituto
de 300 estudiantes es la mayoría de los círculos.

**Por qué importaba.** Es el patrón 3 de la segunda ronda (E11, E27) con su salida barata de siempre:
**debilitar el invariante hasta que pase**, o dejar la comprobación desactivada «para censos
pequeños». Cualquiera de las dos apaga la única defensa contra la concentración justo donde la
concentración es más fácil: en un círculo de seis personas, dos delegaciones ya son mayoría.

**Resolución.** Se rechaza **al abrir**, que es el único momento en que todavía se puede corregir.
`openDecision` exige `capWeight ≥ 2` cuando la delegación está habilitada: con `capWeight = 0` o `1`
la delegación queda habilitada y a la vez imposibilitada de surtir efecto, que es la «delegación
inerte» que ADR-0030 llama la peor opción. El mensaje de rechazo dice el número y qué hacer:
subir el `cap`, o abrir sin delegación. **No** se toca INV-27, que es correcto: lo que estaba mal era
permitir la configuración que lo viola.

*Vive en:* `packages/domain/src/delegation.ts:60-72` y `packages/domain/src/config.ts:932-948`.

## E41 — El HHI normalizado da `0/0` justo en el caso que existe para vigilar

**El conflicto.** C.6 define `HHI* = (HHI − 1/n) / (1 − 1/n)`. Con `n = 1` el numerador y el
denominador son **ambos cero**: `HHI = 1` (una sola papeleta se lleva todo), `1/n = 1`, y `1 − 1/n = 0`.

**Por qué importaba.** `n` es el número de **votantes efectivos**, no el censo. `n = 1` no es una
curiosidad matemática: es **una sola persona votando y cargando el peso de todos sus delegantes** —
hasta 30 con el tope por defecto—, que es literalmente el escenario que C.6.a describe como «el
peligro» y para el que dice haber elegido HHI sobre Gini. El indicador normativo del proyecto está
indefinido exactamente en su caso de uso. Y el fallo no es ruidoso: en coma flotante `0/0` es `NaN`,
y `NaN ≥ 0.15` es `false`, así que **la alarma de concentración no se dispara**. La aritmética exacta
de ADR-0027 lo hace visible —una fracción con denominador 0 revienta— pero no lo resuelve.

**Resolución.** Con `n ≤ 1` se devuelve `0/1`, y el motivo se argumenta donde está el código: `HHI*`
mide **desigualdad entre votantes**, y con un votante no hay desigualdad. La ambigüedad es real —una
sola papeleta es a la vez el reparto perfectamente uniforme y la concentración máxima, y la fórmula
no distingue— y por eso la resolución **no se apoya en `HHI*` para cubrir el riesgo**: lo cubre `CR1 =
w₁ / N`, que con un votante que carga 30 pesos sobre un censo de 300 vale `1/10` y dispara su propio
umbral (`CR1 ≥ 1/20`). El umbral de alarma de C.6.a es una disyunción, y esa es la rama que funciona.

*Vive en:* `packages/domain/src/tally/common.ts:405-431`, `normalizedHerfindahl`.

## E42 — AUTODESTRUCTIVA · la cota de irreversibilidad de D.4.1 no es una cota bajo delegación

| Documento | Qué decía |
|---|---|
| `30-...` §D.4.1 | «Sea `movibles` = miembros del padrón que **no** han emitido papeleta directa. **Cada uno puede mover su peso 1** a cualquier casilla» |
| `30-...` §D.4.1, código | `// (1) el quórum sólo puede CRECER ⇒ el peor caso de quórum es el estado actual` |
| `30-...` §D.4.1, prueba | «No hay continuaciones intermedias fuera de ese rango. ∎» |

**El conflicto.** Los dos supuestos que sostienen la demostración son **falsos bajo la PARTE C**, y la
PARTE C está en el mismo documento:

1. **«La participación sólo puede crecer.»** Falso. La regla de oro 4 de C.3.1 dice que **revocar sin
   votar no es abstenerse: el peso queda sin asignar y no suma a la participación**. Quien revoca
   durante la ventana **resta** participación. Y una delegación que **caduca** durante la ventana
   (C.1.a: `expiresAt` es obligatorio) rompe una cadena y resta tantos como la cadena llevara, sin que
   nadie haga nada.
2. **«Cada movible mueve su peso 1.»** Falso. Por la regla de oro 2, quien vota directo **se lleva su
   peso a su papeleta y a la vez se lo quita a la de su delegado**: es un movimiento de **2** en el
   marcador `A`/`R`, no de 1. Con cadenas, un solo voto directo en un nodo intermedio **absorbe la
   cadena entera** —el nodo terminal es siempre absorbente, C.3.1-1— y puede mover mucho más que 2.

**Por qué importaba.** El cálculo se llama `irreversibility` y su salida es `'approved'` o
`'rejected'`, que **cierra la urna** (`DecisionClosed` con `cause: 'early-irreversible'`). Una cota
que subestima cuánto se puede mover declara irreversible un resultado que **todavía puede darse
vuelta**, y el motor cierra con esa firma detrás. Es el peor de los tres modos autodestructivos de
esta ronda, porque el daño es **irreparable por diseño**: A.8.2.1 prohíbe reabrir. Y la propia D.4.2
argumenta que cerrar antes revela información y se acepta *porque el resultado ya está decidido*: si
no lo está, no queda ningún argumento en pie.

**Resolución.** Con `delegation.enabled` el cierre anticipado por irreversibilidad **devuelve
`'open'`**, siempre. No se intenta una cota nueva: cualquier cota correcta bajo delegación tendría que
acotar el efecto de revocaciones, caducidades y absorciones de cadena que ocurrirán **en el futuro**,
y las tres dependen de actos que nadie ha hecho todavía. La decisión cierra por ventana, como las
demás. **La funcionalidad se pierde exactamente donde no se puede sostener**, y eso es preferible a
sostenerla mal: la irreversibilidad sigue viva y probada para las decisiones sin delegación, que son
la mayoría. Queda anotado como una restricción del motor, no como un pendiente: sin una demostración
nueva, no vuelve.

*Vive en:* `packages/domain/src/engine.ts:1532-1542`.

## E43 — ADR-0030 y C.7.a disparan la misma compuerta con condiciones distintas

| Documento | Condición para rechazar `DecisionOpened` |
|---|---|
| `30-...` DECISIÓN C.7.a | «`enabled && privacy === 'secret-ballot'` es una configuración INVÁLIDA» — mira **la bandera** |
| ADR-0030, §Decisión | «El sistema rechaza abrir la decisión **si hay delegaciones vigentes en su ámbito**» — mira **el registro** |

**El conflicto.** No son la misma comprobación y ninguna implica a la otra. El caso que las separa es
el que importa: **`enabled: false` con delegaciones vigentes en el ámbito de la decisión**. La spec
abre sin decir nada; el ADR rechaza.

**Por qué importaba.** Ese caso concreto es **exactamente la «delegación inerte»** que ADR-0030
enumera y descarta como «la peor opción»: «el delegante cree que participó y no participó, y sólo lo
descubre —si acaso— al ver el conteo». La compuerta de la spec, aplicada sola, **produce el escenario
que el ADR existe para impedir**. Y lo produce en decisiones con voto secreto, que por C6 y por el
propio ADR son las delicadas: elegir personas, evaluar, denunciar.

**Resolución.** **Manda el ADR**, por la precedencia de `docs/adr/README.md` y de `HANDOFF.md` §3.1
(los ADR están por encima de la spec 30), y además porque su condición es la más fuerte en la
dirección que importa. **Se implementan las dos**, porque tampoco son redundantes: la de la spec
atrapa la configuración incoherente aunque no haya ni una delegación concedida, y la del ADR atrapa
el registro poblado aunque la bandera esté en `false`. La spec queda enunciada como la conjunción de
ambas. El mensaje de rechazo nombra a las personas afectadas, porque C.4.3 exige que nadie se entere
tarde.

*Vive en:* `packages/domain/src/delegation.ts:534` y su prueba en
`packages/domain/test/delegation-engine.test.ts:501`.

## E44 — INV-28 no dice si lo que se devuelve es una persona o una arista, y en una cadena no es lo mismo

**El conflicto.** INV-28 dice que los devueltos «son exactamente **las delegaciones** de mayor
`grantedSeq` **hacia ese delegado**». En una **estrella** —todos delegan directo en Marta— la frase es
unívoca: las delegaciones hacia Marta son las aristas que entran en Marta, y devolver una arista es
devolver a una persona. En una **cadena** `A → B → C`, con C votando, deja de serlo: hacia C hay **una
sola** arista (`B → C`) y sin embargo C carga **dos** pesos, el de B y el de A.

Las dos lecturas dan resultados distintos:

- **Devolver la arista `B → C`** resta 2 de golpe (B y A), puede dejar a C muy por debajo del tope, y
  **castiga a A, que delegó hace meses y no hizo nada**: el exceso lo produjo B al delegar tarde.
- **Devolver la persona B** resta 1, deja a A llegando a C, y es el recorte mínimo.

**Por qué importaba.** La ambigüedad no es de redacción: es la diferencia entre un tope que recorta el
exceso y uno que arrasa la rama. Y romper la arista reintroduce **por otra puerta** el reparto de
culpa que C.5.b.2 rechaza explícitamente al descartar FIFO —«castigaría a quien delegó hace meses y
confió, lo cual es arbitrario y además incentiva delegar tarde»—, con el agravante de que aquí ni
siquiera hace falta que A haya delegado antes: le pasa por estar detrás.

**Resolución.** Se devuelve **la unidad de peso de una persona**, ordenada por el `grantedSeq` de la
delegación que **esa persona** concedió. Tres razones, y las tres las argumenta la propia C.5:
**(a)** es el recorte mínimo, y el tope pide recortar el exceso, no la rama; **(b)** no castiga a quien
no hizo nada, que es el criterio con el que C.5.b.2 elige LIFO sobre FIFO; **(c)** no cascadea, que es
el vicio que C.5.1 le imputa al prorrateo.

Consecuencia asumida y declarada: **el peso de A puede seguir contando a través de B aunque el peso
propio de B se haya devuelto**. Es coherente —lo devuelto es el voto de B, no el mandato que B
recibió— y los dos reciben el aviso de C.4.3 con su motivo correcto.

*Vive en:* `packages/domain/src/delegation.ts:232-254`; su prueba en
`packages/domain/test/delegation.test.ts:603`.

## E45 — INV-28 se contradice a sí mismo: es falso para su propia implementación correcta

**El conflicto.** INV-28 afirma dos cosas y son incompatibles:

```
∀ π : devueltos(reseq(π(L))) === devueltos(L)
y  devueltos son exactamente las delegaciones de mayor grantedSeq hacia ese delegado
```

`reseq` —el mismo de INV-16, definido en el arnés— **reasigna la numeración** de forma densa según el
orden nuevo. Es decir: permutar el log y volver a numerar **cambia el `grantedSeq` de cada
delegación**. Si los devueltos son «los de mayor `grantedSeq`», entonces por construcción son **otro
conjunto** después de `reseq`. La primera cláusula exige invariancia bajo una operación que la segunda
cláusula garantiza que la rompe.

**Por qué importaba.** Es un invariante **falso para la implementación correcta**, que es el peor tipo:
quien lo escriba tal cual verá la propiedad en rojo con un motor que funciona bien, y el reflejo será
tocar el motor hasta ponerla en verde. El único modo de satisfacer INV-28 literalmente sería **dejar
de usar `grantedSeq`** y desempatar por algo invariante a la renumeración —el `delegationId`, por
ejemplo—, con lo que se perdería la propiedad política que C.5.b.2 argumenta durante un párrafo: que
se devuelve la delegación **más reciente**, la marginal, la que recibió la advertencia al concederse.
Es E24 esperando a ocurrir: una contradicción documento-test resuelta contra el documento, anclada en
una aserción, y descubierta dos rondas después.

**Resolución.** La propiedad que se prueba es la que INV-28 quiere decir y su «fallo ingenuo» delata
—«recortar recorriendo un `Map` (orden de inserción) ⇒ a quién se le quita el voto depende del orden
de llegada de **eventos no relacionados**»—: **se baraja el orden de llegada SIN tocar `grantedSeq`**.
Eso es lo que debe ser invariante, y lo es. `reseq` **no aplica** a INV-28, porque `grantedSeq` no es
un número de orden interno del escrutinio sino **parte del hecho registrado**: es el dato que dice
cuál delegación fue la última. La cláusula `∀ π : devueltos(reseq(π(L))) === devueltos(L)` queda
enunciada sobre el orden de llegada, no sobre la renumeración.

*Vive en:* `packages/domain/test/props/delegation-invariants.test.ts:624-646` — las dos propiedades,
la de barajar sin renumerar y la de que se devuelven los de mayor `grantedSeq`, conviven ahí porque
sólo son compatibles cuando la primera se enuncia bien.

## E46 — C.4.b manda emitir `IntegrityAlert`, un evento que no existe y que no podría existir

| Documento | Qué decía |
|---|---|
| `30-...` DECISIÓN C.4.b | «se emite una alarma `IntegrityAlert` y el hecho se declara en la `Proof`» |
| `30-...` §A.7 | catálogo de **19 tipos de evento**. `IntegrityAlert` no está |
| `30-...` §A.8.1 | tabla de transiciones. No hay fila para `IntegrityAlert` |
| `30-...` §A.8.2 / INV-34 | «lo no listado es ilegal» — «Ninguna transición ilegal se acepta» |

**El conflicto.** El evento no está en el catálogo ni en la tabla. Y añadirlo al catálogo no bastaría:
por la regla de A.8.2, **un evento sin fila en la tabla es ilegal en todo estado**, que es exactamente
el fallo de E20 con `DecisionDrafted`. Emitirlo haría fallar INV-34.

Hay un segundo problema, y es el que decide la resolución: **el escrutinio no es un lugar desde donde
emitir**. La detección de ciclos de C.4.b ocurre dentro de `resolveWeights`, que es una **función pura
de cálculo del resultado**; ADR-0026 declara el resultado un dato **derivado**, e INV-35 exige que
`effectiveBallots` sea idéntico antes y después de `DecisionClosed`. Un escrutinio que escribe en el
log deja de ser recomputable, y la recomputación es lo que permite a `DecisionAnnulled` detectar un
`resultHash` que no cuadra.

**Por qué importaba.** Es el mismo error de E39 en otra sección —confundir un cálculo puro con un
emisor de eventos— y comparte con E19 y E17 el patrón de la segunda ronda: **una regla que exige un
artefacto que el modelo no tiene**. La salida barata es inventar el evento, y el coste de esa salida
es un agujero en la máquina de estados por el que después entra cualquier cosa.

**Resolución.** El hecho **se declara en la `Proof`**, que es la mitad de C.4.b que sí es
implementable y sí es verificable por terceros. La resolución expone `cycleMembers`: si no está
vacío, el grafo tenía un ciclo, y la `Proof` lo dice con nombres. **No se emite ningún evento nuevo**;
el catálogo sigue teniendo 19 tipos y la tabla sigue siendo exhaustiva. La alarma operativa —avisar a
una persona— es responsabilidad de la capa de notificación, que es donde vive `ChainBrokenNotice` de
C.4.3 y donde no compromete la pureza del pliegue.

*Vive en:* `packages/domain/src/delegation.ts:116-117`.

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

**Parte 3, tercera ronda — errores detectados al implementar los métodos B.5–B.9 y el consenso
transversal (2026-08-22).** Once errores dentro de la spec 30, una entrada retirada y tres bugs
propios del código.

| # | Error | Dónde vivía | Estado |
| E24 | ~~La mediana par de B.7 contradice *lower middlemost*~~ | — | **RETIRADA** — el error era del orquestador; la spec era coherente. Se conserva tachada |
| E25 | «Misma convención que B.7» con los dos vectores orientados al revés | `30-...` §B.5 vs §B.7 | **Resuelta** — la semántica se comparte, la fórmula no: `⌊(W−1)/2⌋` y `⌊W/2⌋` |
| E26 | Cuotas y restos del sorteo por división en punto flotante | `30-...` §B.9 vs ADR-0027 | **Resuelta** — Hamilton con enteros y `bigint`; manda el ADR |
| E27 | `\|muestra\| = min(n,N)` y `Σ quota = n` a la vez | `30-...` INV-55 | **Resuelta** — se acota antes de repartir |
| E28 | «Redistribuir el faltante» sin comparar nunca cuota con tamaño | `30-...` §B.9.b | **Resuelta** — recorte al tamaño y reasignación por restos; falla tipado si no alcanza |
| E29 | `⌈n/3⌉` suplentes con `n` ambiguo | `30-...` §B.9.c | **Resuelta** — `n` es la muestra ya acotada |
| E30 | La cascada de IRV empieza por un no-op en la ronda 1 | `30-...` §B.6.b | **Resuelta** — deja de proponerse como primera red; sigue en el catálogo |
| E31 | Dos formas incompatibles del mismo `IrvRound` | `30-...` §B.6 | **Resuelta** — una sola forma, la que permite rehacer la ronda |
| E32 | `lexRank` invocado y nunca definido | `30-...` §B.8 | **Resuelta** — `lexicographic-hash`, que sí está definido |
| E33 | Semilla revelada exigida y nunca entregada al escrutinio | `30-...` §A.5 vs §B.8 | **Resuelta** — llega a todos los métodos; si falta, falla |
| E34 | INV-43 exige que gane el ganador de Condorcet y nadie pide reportarlo | `30-...` §B.8 vs INV-43 | **Resuelta** — la `Proof` lo declara y publica la tabla de pares |
| E35 | `noOpinionPolicy:'as-zero'` ofrecido como configuración e INV-50 lo tipifica como error | `30-...` §A.3 vs INV-50 | **Resuelta** — retirado de A.3 |
| B1 | MJ ignoraba `reject-ballot` e imputaba «Rechazar» a lo no calificado | código, no spec | **Corregido** — bug autodestructivo |
| B2 | El codec de la API no conocía las 8 reglas de desempate nuevas | código, no spec | **Corregido** — habría matado toda configuración nueva al replay |
| B3 | Índices de afirmación permutados dos veces en `consensus` | código, no spec | **Corregido** — números correctos colgando de la afirmación equivocada |

**Parte 3, cuarta ronda — errores detectados al implementar la democracia líquida, PARTE C
(2026-08-22).** Once errores. **Tres autodestructivos**, marcados como tales.

| # | Error | Dónde vivía | Estado |
|---|---|---|---|
| E36 | El evento de delegación vive en el agregado decisión; el ámbito de una delegación es transversal | `30-...` §A.7, §A.8.1 vs §C.1–C.2 | **Resuelta a medias** — las delegaciones pasan por cierre; **pendiente** decidir un agregado `DelegationRegistry` |
| **E37** | «Prevención completa» es un teorema falso: comprueba por ámbito y la resolución mezcla ámbitos | `30-...` §C.4.1 vs §C.2 | **Resuelta** — ciclo comprobado sobre el grafo **unión**. **AUTODESTRUCTIVA** |
| **E38** | El PASO 1 filtra por `cfg.currentRound`, que no existe, y por el `proposalVersionHash` congelado | `30-...` §C.3 vs §A.5, §A.7 | **Resuelta** — los dos filtros salen del PASO 1 y se aplican aguas arriba. **AUTODESTRUCTIVA** |
| E39 | C.1.b manda que el pliegue **emita** `DelegationRevoked`; un pliegue puro no emite | `30-...` §C.1.b | **Resuelta** — el desplazamiento se aplica dentro del pliegue |
| E40 | INV-27 insatisfacible con `N < cap.den`: `capWeight = 0` y el peso propio de 1 no es devolvible | `30-...` INV-27 vs §C.5 | **Resuelta** — se rechaza la configuración al abrir (`capWeight ≥ 2`) |
| E41 | `HHI*` da `0/0` con un solo votante, que es el caso que C.6 existe para vigilar | `30-...` §C.6 | **Resuelta** — `0/1` con `n ≤ 1`; el riesgo lo cubre `CR1` |
| **E42** | La cota de irreversibilidad supone participación creciente y peso movible 1; ambos falsos con delegación | `30-...` §D.4.1 vs §C.3.1 | **Resuelta** — con delegación habilitada devuelve `open`. **AUTODESTRUCTIVA** |
| E43 | ADR-0030 y C.7.a rechazan la apertura con condiciones distintas; la del ADR es más fuerte | ADR-0030 vs `30-...` §C.7.a | **Resuelta** — manda el ADR por precedencia; se implementan **las dos** |
| E44 | INV-28 no define si se devuelve una **persona** o una **arista**; en cadena difieren | `30-...` INV-28 vs §C.5.b.2 | **Resuelta** — se devuelve la persona; romper la arista castiga a quien no hizo nada |
| E45 | INV-28 se contradice: `reseq(π(L))` renumera `grantedSeq`, y los devueltos se definen por `grantedSeq` | `30-...` INV-28 | **Resuelta** — se baraja el orden de llegada **sin** renumerar; `reseq` no aplica |
| E46 | `IntegrityAlert` no está en el catálogo ni en la tabla, y por A.8.2 sería ilegal en todo estado | `30-...` §C.4.b vs §A.7, §A.8.1 | **Resuelta** — el ciclo se declara en la `Proof` (`cycleMembers`); no se emite evento |

**Parte 3, quinta ronda — errores detectados al implementar el asistente de acción sistémica (2026-08-22).** Diez errores de especificación.

| # | Error | Dónde vivía | Estado |
|---|---|---|---|
| E78 | La frase de cierre editable se desincroniza de las respuestas del borrador | `03-...` §3.1 | **Resuelta** — calculada como función pura del borrador, no almacenada |
| E79 | La respuesta «todavía no sé» anula la obligatoriedad de las preguntas de arranque y acción | `03-...` §3.1 | **Resuelta** — se acepta «todavía no sé» pero no cuenta para cerrar |
| E80 | La pregunta 7 no es un campo único e introduce riesgo de descuadre cardinal | `03-...` §3.1 | **Resuelta** — validada en el pliegue por líneas; el descuadre se muestra, no se recorta solo |
| E81 | El vínculo acción-responsable-plazo en prosa rompe la rastreabilidad del plan | `03-...` §3.1 | **Tensión declarada** — se copian literales; estructurarlas requiere cambiar la spec |
| E82 | Instrucciones de control de interfaz embebidas en el texto de las preguntas | `03-...` §3.1 | **Tensión declarada** — prosa libre; se pierde la marca estructurada |
| E83 | El asistente invoca una memoria de aprendizajes (`Learning`) inexistente en el sistema | `03-...` §3.1 y §3.4.4 | **Resuelta** — se usa `muestraMemoria` y se opera por búsqueda local en modo estructural |
| E84 | Búsqueda de parecidos entra en conflicto con la privacidad del texto no publicado | encargo vs privacidad | **Resuelta** — obligación delegada al adaptador; el dominio no verifica publicidad |
| E85 | Contradicción en el encargo del cálculo de aceptación en el paquete de métricas | encargo | **Resuelta** — el conteo y umbral quedan en `domain`; informe como deuda declarada |
| E86 | El puerto de asistencia no puede escribir en el ledger, pero debe registrar la procedencia | `ARCHITECTURE.md` §6 | **Resuelta** — el evento lo escribe el actor `'system'`, manteniendo puro el puerto |
| E87 | Plantilla de frase de cierre rígida e incompatible con la flexión gramatical de las preguntas | `03-...` §3.1 | **Tensión declarada** — se conserva la plantilla literal y se declara la fragilidad |

## E78 — La frase de cierre editable se desincroniza de las respuestas del borrador

| Documento | Qué decía |
|---|---|
| `03-...` §3.1 | La frase de cierre se describe como «(generada, editable)». |

**El conflicto.** Si la frase de cierre se guarda tras ser editada, deja de ser una función de las respuestas individuales a las 27 preguntas. En consecuencia, si el usuario corrige la respuesta a alguna de las preguntas que la integran en una fase posterior, la frase guardada se desincroniza del borrador, produciendo dos versiones conflictivas de la decisión en el sistema.

**Por qué importaba.** Generar un texto editable que luego se almacena rompe la reproducibilidad e integridad del borrador. Al rehidratar el borrador, el motor no tendría forma de saber si la frase representa de forma fidedigna las respuestas o si fue alterada manualmente, ni cuál de las dos fuentes de verdad prevalece para la asamblea.

**Resolución.** La frase de cierre se define como una **función pura** de las respuestas del borrador y se calcula dinámicamente cada vez que se requiere. No se guarda ningún texto de cierre en el historial de eventos. La edición de la frase se realiza editando las respuestas individuales en los campos correctos del formulario, manteniendo la invitación a corregir («¿Suena bien? ¿Falta algo?») como un disparador de ajustes sobre los datos estructurados.

*Vive en:* `packages/domain/src/assistant/cierre.ts:6-23` y `packages/domain/src/assistant/cierre.ts:84-92`.

## E79 — La respuesta «todavía no sé» anula la obligatoriedad de las preguntas de arranque y acción

| Documento | Qué decía |
|---|---|
| `03-...` §3.1 | «Sólo dos preguntas son obligatorias» (la 1 y la 11), conviviendo con «"todavía no sé" es siempre una respuesta válida». |

**El conflicto.** Si «todavía no sé» es una respuesta de valor general y cuenta como tal para el sistema, un usuario puede responder eso a la 1 y a la 11 y cerrar un borrador de plan vacío, burlando la condición de obligatoriedad diseñada para asegurar un mínimo contenido en el plan.

**Por qué importaba.** Permitir que un borrador se cierre con respuestas evasivas en los dos campos fundamentales desvirtúa el propósito del asistente, dejando iniciativas registradas que carecen de definición del problema y de las acciones a realizar.

**Resolución.** Se acepta «todavía no sé» en cualquier pregunta para no bloquear la edición fluida, pero **no se cuenta como respondida** al evaluar si el borrador puede cerrarse (`puedeCerrarse`). La respuesta `todavia_no_se` se trata en el dominio como un hueco persistente que requiere definición posterior y que bloquea el cierre en las preguntas obligatorias (1 y 11).

*Vive en:* `packages/domain/src/assistant/types.ts:627-644` y `packages/domain/src/assistant/types.ts:871-888`.

## E80 — La pregunta 7 no es un campo único e introduce riesgo de descuadre cardinal

| Documento | Qué decía |
|---|---|
| `03-...` §3.1 | Pregunta 7: «Esto que escribiste, ¿lo viste, te lo contaron, o lo estás suponiendo? (por cada causa)» numerada como una sola pregunta. |

**El conflicto.** La anotación «(por cada causa)» implica que la cardinalidad de la pregunta 7 no es uno, sino $N$ (donde $N$ es el número de causas declaradas en la pregunta 6). No es representable ni implementable como un campo de texto plano único. Además, si el usuario edita la pregunta 6 posteriormente agregando o eliminando causas, las respuestas ya dadas a la pregunta 7 quedan descuadradas.

**Por qué importaba.** Un desajuste de cardinalidad provocaría errores de índice o de correspondencia al mapear causas con justificaciones, forzando a la aplicación a recortar datos arbitrariamente o a fallar en tiempo de ejecución.

**Resolución.** La pregunta 7 se implementa con la forma `'por_linea'` atada a la pregunta 6 (`porCadaLineaDe: 6`). El pliegue valida la correspondencia de cardinalidad al recibir el evento. Si el usuario modifica la pregunta 6 después, el sistema no recorta la respuesta a la 7 por su cuenta (lo que violaría el principio de que la máquina no edita al usuario), sino que expone el desajuste a través de la función `desajustes` para que la interfaz alerte a la persona de forma explícita.

*Vive en:* `packages/domain/src/assistant/types.ts:890-909` y `packages/domain/src/assistant/types.ts:917-930`.

## E81 — El vínculo acción-responsable-plazo en prosa rompe la rastreabilidad del plan

| Documento | Qué decía |
|---|---|
| `03-...` §3.1 | Preguntas 12 («¿Quién hace cada una?») y 13 («¿Para cuándo estaría hecha cada una?») son texto libre general. |

**El conflicto.** Aunque conceptualmente las preguntas 12 y 13 operan por cada acción enunciada en la 11, la especificación las trata como preguntas independientes de texto libre. Esto rompe la estructura del dato e impide que el vínculo acción $\leftrightarrow$ responsable $\leftrightarrow$ plazo se registre de forma asociada en la base de datos, contradiciendo el principio 4 del proyecto («toda decisión debe poder convertirse en acción rastreable»).

**Por qué importaba.** Como texto plano en prosa, las tareas no pueden extraerse automáticamente ni integrarse de forma estructurada con el gestor de iniciativas del espacio de trabajo.

**Resolución.** Se conserva la redacción y forma de texto plano de las preguntas en cumplimiento estricto del pliego literal de §3.1 para el MVP, y se declara formalmente la tensión con el principio 4 en el diseño. Su posterior estructuración y corrección metodológica requerirá una decisión del círculo que modifique la redacción original de la especificación.

*Vive en:* `packages/domain/src/assistant/preguntas.ts:244-249`.

## E82 — Instrucciones de control de interfaz embebidas en el texto de las preguntas

| Documento | Qué decía |
|---|---|
| `03-...` §3.1 | Pregunta 20: «¿Cuánto sería "suficiente"? Poné un número aunque sea a ojo — y marcá que es a ojo.» |

**El conflicto.** La instrucción «marcá que es a ojo» presupone un control de interfaz de usuario (como un checkbox) que no está soportado ni tipificado en el modelo de datos de las preguntas, el cual solo gestiona textos literales de respuesta.

**Por qué importaba.** Al no existir un campo estructurado para registrar la naturaleza estimada del dato, el carácter «a ojo» queda diluido en la prosa de la respuesta, perdiendo la distinción entre un indicador medido y uno estimado.

**Resolución.** La pregunta se deja como respuesta de texto libre ('frase') respetando el literal del documento. La distinción entre dato estimado y medido queda declarada como una deuda de interfaz y no del dominio, respondiendo a la instrucción en texto plano dentro del mismo campo.

*Vive en:* `packages/domain/src/assistant/preguntas.ts:281-284`.

## E83 — El asistente invoca una memoria de aprendizajes (`Learning`) inexistente en el sistema

| Documento | Qué decía |
|---|---|
| `03-...` §3.1 y §3.4.4 | El sistema busca coincidencias en la memoria (`Learning`) y las muestra al lado del campo en las preguntas 2, 6, 11 y 27. |

**El conflicto.** La entidad `Learning` (y su almacenamiento correspondiente) no está definida ni implementada en ningún módulo del sistema de gobernanza en esta etapa del proyecto.

**Por qué importaba.** La especificación hace depender una funcionalidad central del asistente (mostrar sugerencias basadas en similitud) de un tipo de datos y un almacén ficticios, lo que causaría fallas de compilación o dependencias vacías.

**Resolución.** Se añade el metadato `muestraMemoria` a los tipos de las preguntas afectadas. El motor de búsqueda de parecidos opera mediante una búsqueda local simple sobre las propuestas y planes ya públicos en el dominio en el modo estructural (sin IA), asegurando que la ayuda funcione de manera autónoma y autocontenida sin depender del modelo de lenguaje ni de entidades no implementadas.

*Vive en:* `packages/domain/src/assistant/preguntas.ts:207`, `:219`, `:242` y `:300`.

## E84 — Búsqueda de parecidos entra en conflicto con la privacidad del texto no publicado

| Documento | Qué decía |
|---|---|
| Encargo de tarea | La operación de buscar parecidos exige enviar también el corpus con el que se compara. |

**El conflicto.** El corpus con el que se realiza la comparación está compuesto por respuestas dadas por otros usuarios en borradores en curso. El dominio no puede comprobar si esos borradores o textos son públicos o privados, pues carece de visibilidad sobre el estado de publicación o los permisos del corpus de origen.

**Por qué importaba.** Si se envían textos de borradores privados al puerto de asistencia para calcular la similitud, se violaría la garantía de privacidad («sólo viaja el fragmento») declarada para proteger el espacio de redacción individual.

**Resolución.** El parámetro `conQueComparar` de la petición al puerto de IA se tipifica de forma restrictiva y se documenta que solo debe ser poblado con textos que el adaptador verifique de forma externa como públicos. El dominio valida la ausencia de identificadores en el payload, pero delega la responsabilidad de filtrar la privacidad de los datos al adaptador correspondiente.

*Vive en:* `packages/domain/src/assistant/types.ts:412-427`.

## E85 — Contradicción en el encargo del cálculo de aceptación en el paquete de métricas

| Documento | Qué decía |
|---|---|
| Encargo de tarea | Medir la tasa de aceptación colectiva de sugerencias en `packages/metrics`, a la vez que se prohíbe explícitamente modificar dicho paquete. |

**El conflicto.** No es posible implementar la acumulación y reporte de la tasa en `packages/metrics` si el ámbito de la tarea veta la modificación de los ficheros de ese paquete.

**Por qué importaba.** Exigir la implementación de una característica en un módulo inaccesible bloquea el cierre limpio del entregable.

**Resolución.** Se implementa el acumulador básico (`ConteoDeSugerencias`), el umbral de fricción y el cálculo puro de la tasa (`tasaDeAceptacionColectiva`) dentro del paquete `packages/domain`. La publicación de la tasa colectiva y su integración final en el informe agregador se declaran como deuda técnica documentada en el ADR-0052 §(f).

*Vive en:* `packages/domain/src/assistant/types.ts:1101` y `packages/domain/src/assistant/index.ts:33`.

## E86 — El puerto de asistencia no puede escribir en el ledger, pero debe registrar la procedencia

| Documento | Qué decía |
|---|---|
| `ARCHITECTURE.md` §6 | La fila de `AIAssistantPort` declara que el puerto de asistencia «nunca escribe en el ledger». |

**El conflicto.** Para poder auditar y medir la tasa de aceptación colectiva de sugerencias de la IA, el sistema necesita registrar en el ledger el evento de que una sugerencia fue recibida y su procedencia, lo cual exige una escritura iniciada por el proceso de asistencia.

**Por qué importaba.** Si el puerto tuviese permiso para escribir, se rompería el aislamiento del puerto de IA y se permitiría la introducción de datos arbitrarios o decisiones autónomas de la máquina en el historial de gobernanza.

**Resolución.** El puerto permanece estrictamente como un resolvedor puro que devuelve valores al dominio. El registro del evento de procedencia (`SugerenciaRecibida`) se realiza y firma en el motor de dominio bajo la autoría del actor `'system'`, manteniendo el aislamiento criptográfico y operativo del puerto de asistencia.

*Vive en:* `packages/domain/src/assistant/commands.ts:633`.

## E87 — Plantilla de frase de cierre rígida e incompatible con la flexión gramatical de las preguntas

| Documento | Qué decía |
|---|---|
| `03-...` §3.1 | Plantilla de frase de cierre: «vamos a [11] ... para que [2] empiece a [18] ...» |

**El conflicto.** La preposición «a» antes del hueco de la pregunta 11 asume que la respuesta vendrá expresada en verbo en infinitivo (por ejemplo, «vamos a *convocar*»). Sin embargo, el conector «empiece a» antes de la pregunta 18 recibe la respuesta a «¿qué van a hacer distinto las personas...?», que comúnmente se responde con un verbo conjugado (por ejemplo, «*llegan* más temprano»), provocando que la frase final quede mal construida gramaticalmente («para que la gente empiece a llegan más temprano»).

**Por qué importaba.** La frase de cierre generada automáticamente puede resultar incoherente o difícil de leer para los miembros de la asamblea, restándole credibilidad y valor de uso al borrador.

**Resolución.** Se conserva la estructura literal de la plantilla tal y como fue validada socialmente en la especificación, y se documenta formalmente la fragilidad de la flexión sintáctica. Su resolución final se traslada como propuesta de cambio sobre la redacción de la pregunta 18 en la especificación de investigación, fuera de los límites del código.

*Vive en:* `packages/domain/src/assistant/cierre.ts:6-23`.

---

### El dato acumulado

**Entre las tres especificaciones, la implementación ha encontrado ya 52 errores que ninguna revisión
por lectura detectó.** El desglose exacto, para que la cifra sea verificable y no un eslogan:

| | Spec 10 (`crypto`) | Spec 30 (`domain`), 2ª ronda | Spec 30, 3ª ronda | Spec 30, 4ª ronda | Spec 03 (`assistant`), 5ª ronda | Total |
|---|---:|---:|---:|---:|---:|---:|
| Errores **dentro de la especificación** | 6 (E1–E6) | 14 (E10–E23) | 11 (E25–E35) | 11 (E36–E46) | 10 (E78–E87) | **52** |
| — de ellos, **autodestructivos** | 5 | *(no clasificado)* | — | **3** (E37, E38, E42) | — | — |
| Incoherencias entre ADR y specs | 2 (E7, E8) | — | — | — | — | 2 |
| Hallazgos derivados al propagar | 2 (E1′, E1″) | — | — | — | — | 2 |
| Divergencias elevadas sin cerrar | 1 (E9) | — | — | — | — | 1 |
| Entradas **retiradas** (error propio) | — | — | 1 (E24) | — | — | 1 |
| Bugs del código, autodestructivos | — | — | 3 (B1–B3) | — | — | 3 |
| **Entradas de la parte 3** | 11 | 14 | 15 | 11 | 10 | **61** |

**Cómo se clasifican los conflictos ADR ↔ spec, porque hay dos filas que podrían competir.** E43
(ADR-0030 contra C.7.a) se cuenta **dentro de la especificación** y no en la fila de incoherencias,
siguiendo el precedente de **E26** (B.9 contra ADR-0027) de la tercera ronda: cuando la corrección
se aplica **en la spec** porque el ADR manda, es una errata de la spec. La fila «incoherencias entre
ADR y specs» queda reservada a E7 y E8, donde lo que estaba mal era **el ADR**.

⚠ **La cifra sigue corta, y hay que decirlo.** Las rondas de `services/api`, `packages/anchor` y
`packages/verifier-cli` produjeron **al menos cuatro hallazgos más** —la `RULE ON DELETE DO INSTEAD
NOTHING` que volvía mudo el blindaje, el `ORDER BY tree_size` que ordenaba como texto,
`count(*) = max(leaf_index)+1` ciego al truncamiento de la cola y el falso positivo de
`directorySource()`— que **siguen sin ficha `E-NN`** y viven sólo en comentarios y nombres de test.
Están descritos en `HANDOFF.md` §5.2 y §5.3 y su volcado sigue siendo la tarea 14 del plan de
continuación. Con ellos el total real ronda los **65 hallazgos**, de los cuales unos **56** son
errores de especificación.

Las especificaciones habían pasado por la revisión editorial que produjo C4–C20 de la parte 2.
Ninguno de los 52 salió de esa revisión: **los 52 salieron de escribir el código y los tests**. Y la
segunda ronda invierte la intuición cómoda de que un documento mejor deja menos errores: la spec 30
—2 600 líneas, 60 invariantes formalizados, 7 anti-invariantes, apéndice de decisiones numeradas— es
el documento más cuidado del corpus y produjo **más del doble** que la spec 10. La tercera ronda no
la contradice, y la cuarta menos todavía: **la misma spec 30 ha dado ya 36 errores en tres rondas**
(14 + 11 + 11), y las tres veces en la parte que aún no se había ejercitado.

**Lo que añade la cuarta ronda, y es un dato nuevo sobre el método.** Es la primera ronda en la que
**los errores no están repartidos**: cinco de once (E36, E37, E38, E41, E42) comparten una sola forma
—**una sección razona bien dentro de un marco más chico que el problema**— y las tres autodestructivas
están entre ellas. Es un modo de fallo distinto del de la segunda ronda («dos pasajes correctos por
separado que no se sostienen juntos») y **más difícil de ver leyendo**, porque no hay dos pasajes que
comparar: hay uno solo, correcto, aplicado fuera de su dominio de validez. Un revisor que lea C.4.1
verá un teorema con su demostración y le dará el visto bueno, y hará bien: el teorema es cierto. Lo
que no se lee es la hipótesis que otra sección, cincuenta líneas antes, dejó de cumplir.

**Y una confirmación incómoda de la tesis de C.4.1 del propio documento:** la PARTE C se abre
advirtiendo que «una delegación mal modelada no produce un error visible: produce un resultado
plausible y falso». La advertencia era correcta y **la escribió el mismo documento que contenía las
tres erratas que la materializan**. Saber cuál es el modo de fallo no protege de cometerlo; sólo
protege escribir el segundo caso de prueba.

Lo que predice los errores no es el descuido sino la **densidad de correspondencias internas**: la
spec 30 ata catálogo de eventos ↔ máquina de estados ↔ métodos ↔ invariantes, y nueve de sus catorce
errores son dos pasajes correctos por separado que no se sostienen juntos. Leer verifica argumentos;
la correspondencia entre un argumento y las cuatro líneas de tipos que tiene debajo sólo se verifica
ejecutándola. **Esa es la razón por la que la estrategia de pruebas de este proyecto
(`docs/TESTING.md`) trata implementar y escribir invariantes como parte de la revisión, y no como
una fase posterior a ella.**
