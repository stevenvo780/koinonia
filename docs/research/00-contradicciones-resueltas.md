# 00 — Registro de contradicciones del corpus de investigación

> **Qué es este archivo.** Los documentos de `docs/research/` los escribieron agentes distintos, en paralelo, sin un árbitro. Se contradicen entre sí en puntos que no son de matiz. Este archivo documenta **qué decía cada documento, en qué consistía el conflicto, cómo se resolvió y por qué**.
>
> Es **memoria del proceso**, no documentación de producto. Si dentro de dos años alguien se pregunta por qué el `MemberId` es aleatorio, o por qué no apostamos al borrado criptográfico, la respuesta está aquí y no hay que reconstruirla.
>
> **Fecha:** 2026-08-21 · **Autoridad:** las resoluciones **R1, R2 y R3** las tomó el arquitecto y son firmes. Las contradicciones **C4 en adelante** las detectó la revisión editorial del corpus; las que R1–R3 adjudican de forma derivada se marcan como **resueltas**, y las que exigen una decisión nueva quedan **pendientes** con la recomendación del editor, que no tiene autoridad para cerrarlas.

## Orden de precedencia normativa

Ninguno de los documentos declaraba una precedencia global, y los tres que se corrigen mutuamente lo hacían con criterios incompatibles (ver **C19**). Queda fijado:

1. **Resoluciones del arquitecto** (R1, R2, R3) — este archivo.
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
