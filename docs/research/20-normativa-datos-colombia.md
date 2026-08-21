# Marco normativo 20 — Protección de datos personales en Colombia

**Proyecto:** Koinonía — plataforma de gobernanza colectiva del estudiantado del Instituto de Filosofía, Universidad de Antioquia.
**Audiencia:** ingeniería. Cada sección termina en una decisión de diseño, no en una reflexión.
**Convención:** donde no tengo certeza del dato normativo escribo `VERIFICAR:` con el documento exacto a conseguir. Una cita inventada invalida el entregable; un `VERIFICAR` honesto no.

---

## 1. Marco general

### 1.1 Las dos normas que gobiernan todo

- **Ley Estatutaria 1581 de 2012** — régimen general de protección de datos personales. Desarrolla el art. 15 de la Constitución (hábeas data) y el art. 20 (información). Fue objeto de control previo de constitucionalidad en la **Sentencia C-748 de 2011** de la Corte Constitucional, que condicionó la exequibilidad de varios artículos; esa sentencia es parte del derecho aplicable, no doctrina opcional.
- **Decreto 1377 de 2013**, reglamentario, hoy compilado en el **Decreto Único Reglamentario 1074 de 2015** (Sector Comercio, Industria y Turismo), Libro 2, Parte 2, Título 2, Capítulo 25. En este documento cito el Decreto 1377 por su articulado original porque es como se usa en la práctica, pero la referencia vigente es la compilada. `VERIFICAR: correspondencia artículo-a-artículo Decreto 1377/2013 ↔ Decreto 1074/2015 (arts. 2.2.2.25.x.x), en el texto oficial del DUR en funcionpublica.gov.co.`

Autoridad de vigilancia: **Superintendencia de Industria y Comercio (SIC)**, Delegatura para la Protección de Datos Personales (Ley 1581, art. 19).

### 1.2 Ámbito: ¿aplica a Koinonía?

Sí. El art. 2 de la Ley 1581 excluye, entre otras, las bases de datos "mantenidas en un ámbito exclusivamente personal o doméstico". Una plataforma con ~300 titulares, gobernanza colectiva y publicación de resultados **no** es ámbito doméstico. No hay excepción aplicable. Koinonía es tratamiento regulado desde el primer registro.

### 1.3 Los ocho principios traducidos a requisitos de software

El art. 4 de la Ley 1581 fija los principios. Traducción operativa (uno a uno, sin adornos):

| # | Principio (art. 4) | Requisito de software concreto |
|---|---|---|
| 1 | **Legalidad** (lit. a) | Ningún registro de dato personal puede existir sin una FK no nula a `consentimiento_id`. Constraint a nivel de base de datos (`NOT NULL` + `REFERENCES`), no validación de aplicación. Un `INSERT` sin base de licitud debe fallar en el motor. |
| 2 | **Finalidad** (lit. b) | Catálogo cerrado de finalidades (`enum finalidad`) versionado en código. Cada tabla y cada campo declara la(s) finalidad(es) que lo justifican en un metadato del esquema. Prohibidos los campos de texto libre "notas" sin finalidad declarada: son el vector por el que entran datos sensibles no previstos. |
| 3 | **Libertad** (lit. c) | Checkbox sin premarcar, uno por finalidad separable. Estado tri-valuado (`otorgado` / `denegado` / `no_preguntado`), nunca booleano con default `true`. Revocación accesible desde el perfil en ≤ 2 clics. |
| 4 | **Veracidad o calidad** (lit. d) | Autoservicio de rectificación para todo dato declarativo (programa, semestre, nombre de pila usado). Los datos derivados del sistema (participación, votos) no son rectificables por el titular: son hechos, y su rectificación es una corrección con traza, no una sobrescritura. |
| 5 | **Transparencia** (lit. e) | Endpoint de exportación integral (`GET /me/export`) que devuelve **todo** lo asociado al titular, incluidos metadatos, logs de acceso y la propia autorización. Gratuito y sin fricción. |
| 6 | **Acceso y circulación restringida** (lit. f) | Row-Level Security en PostgreSQL como capa primaria (no solo RBAC de aplicación). `robots.txt` + `X-Robots-Tag: noindex` en toda vista con datos personales. Sin URLs públicas adivinable-secuenciales: UUIDv7 o ULID, nunca `id` autoincremental expuesto. |
| 7 | **Seguridad** (lit. g) | Cifrado en tránsito (TLS 1.3) y en reposo (LUKS/volumen cifrado + cifrado de columna para sensibles). Gestión de claves fuera del servidor de aplicación (KMS o HSM software tipo age/SOPS con clave en hardware). MFA obligatorio para roles administrativos. Backups cifrados y con prueba de restauración documentada. |
| 8 | **Confidencialidad** (lit. h) | Acuerdos de confidencialidad firmados por administradores (obligación que sobrevive al fin de la relación, según el propio literal). Acceso administrativo a contenido deliberativo con registro inmutable de quién vio qué y por qué (`access_log` append-only). |

El principio 7 se refuerza además con el **art. 17 lit. d** (deber del Responsable de "conservar la información bajo las condiciones de seguridad necesarias para impedir su adulteración, pérdida, consulta, uso o acceso no autorizado o fraudulento") y con el **art. 26 y 27 del Decreto 1377 de 2013** ("responsabilidad demostrada" / *accountability*): no basta cumplir, hay que **poder demostrarlo ante la SIC**. Consecuencia técnica: todo control de esta tabla debe producir evidencia exportable (política versionada en Git con firma, inventario de bases de datos, registro de incidentes, actas de revisión). `VERIFICAR: numeración exacta de los artículos de responsabilidad demostrada en el Decreto 1377/2013 y su equivalente en el Decreto 1074/2015; complementar con la "Guía para la implementación del principio de responsabilidad demostrada" de la SIC.`

### 1.4 Ley 1266 de 2008: no aplica

La **Ley 1266 de 2008** regula el hábeas data **financiero, crediticio, comercial, de servicios y el proveniente de terceros países** — el dato destinado a calcular riesgo crediticio y a operar en centrales de información (Datacrédito, TransUnion). Su objeto material es el comportamiento de pago de obligaciones dinerarias.

Koinonía no trata datos financieros ni de comportamiento crediticio. **La Ley 1266 no le aplica.** La Ley 1581 lo confirma por vía negativa: su art. 2 excluye de su ámbito la información regulada por la Ley 1266, lo que implica que ambos regímenes son excluyentes por materia, y aquí el aplicable es el general (Ley 1581).

**Pero un elemento de la Ley 1266 sí se usa**: su art. 3 define la tipología **dato público / semiprivado / privado**, que la Corte Constitucional había construido antes en la **Sentencia T-729 de 2002** y que la SIC sigue usando como criterio de clasificación. La Ley 1581 no repite esa tipología (solo define "dato público" y "dato sensible", este último en su art. 5, y el Decreto 1377 art. 3 define "dato público"), así que la clasificación de cuatro niveles de la sección 2 se apoya en T-729/2002 + Ley 1266 art. 3 como marco conceptual, y en Ley 1581 art. 5 como norma vinculante para lo sensible. `VERIFICAR: literales exactos del art. 3 de la Ley 1266 de 2008 que definen dato semiprivado y privado.`

---

## 2. Clasificación de datos

### 2.1 La pregunta que cambia el diseño: ¿la opinión política es dato sensible?

El **art. 5 de la Ley 1581 de 2012** define datos sensibles como aquellos "que afectan la intimidad del Titular o cuyo uso indebido puede generar su discriminación", y enumera expresamente, entre otros: el origen racial o étnico, **la orientación política**, las convicciones religiosas o filosóficas, **la pertenencia a sindicatos, organizaciones sociales, de derechos humanos o que promueva intereses de cualquier partido político**, los datos de salud, de vida sexual y biométricos.

Respuestas directas:

- **¿La opinión política es sensible?** Sí. La "orientación política" está en la enumeración literal del art. 5. Una intervención deliberativa firmada sobre, por ejemplo, la posición del estudiantado frente a una reforma del plan de estudios o frente a una decisión del Consejo de Instituto **revela orientación política** y cae en la categoría.
- **¿La afiliación a un movimiento estudiantil es sensible?** Sí, con altísima probabilidad. El art. 5 cubre "la pertenencia a […] organizaciones sociales". Un colectivo o movimiento estudiantil es una organización social. Aunque se discutiera el encuadre, el criterio general del propio art. 5 ("cuyo uso indebido puede generar su discriminación") lo captura de sobra en un contexto universitario. **Decisión de ingeniería: tratar como sensible por defecto, sin esperar dictamen.** El costo de equivocarse hacia el lado restrictivo es bajo; hacia el otro lado, es el cierre definitivo de la operación (art. 23 lit. d).
- **¿El voto es sensible?** El **contenido** del voto sobre una materia política, sí: es una manifestación de orientación política. Además, cuando el voto es **secreto**, hay una capa adicional que no es de protección de datos sino de integridad democrática: el secreto debe ser garantizado **estructuralmente**, no por política de acceso. Un voto secreto cuya vinculación con el votante existe en alguna tabla y solo está protegida por permisos **no es secreto**: es un voto público con control de acceso.
- **¿Una objeción argumentada firmada es sensible?** Sí. Es opinión política + identidad, deliberadamente vinculadas. El hecho de que el titular la haga pública **no la convierte en dato público** en el sentido del art. 10 lit. b de la Ley 1581. Sigue siendo sensible; lo que ocurre es que existe autorización explícita del titular para su tratamiento y divulgación en el ámbito acordado (art. 6 lit. a). Esa autorización debe ser específica, revocable y limitada en su alcance de difusión.

### 2.2 Consecuencias de la calificación como sensible

Tres consecuencias, todas duras:

1. **Prohibición general con excepciones tasadas (art. 6).** El tratamiento de datos sensibles está *prohibido*, salvo: (a) autorización **explícita** del titular; (b) interés vital del titular incapacitado; (c) actividades legítimas y con las debidas garantías **por parte de una fundación, ONG, asociación u otro organismo sin ánimo de lucro cuya finalidad sea política, filosófica, religiosa o sindical, siempre que se refieran exclusivamente a sus miembros** o a personas con contacto regular por razón de su finalidad —y en ese caso **los datos no se podrán suministrar a terceros sin autorización del titular**—; (d) datos necesarios para el reconocimiento, ejercicio o defensa de un derecho en un proceso judicial; (e) finalidad **histórica, estadística o científica**, "en cuyo evento deberán adoptarse las medidas conducentes a la supresión de identidad de los Titulares".

   El **literal (c) es la base de licitud estructural de Koinonía** y es la razón jurídica principal para constituir la organización estudiantil como entidad sin ánimo de lucro (ver sección 5). El **literal (e) es la base para conservar el hecho histórico de una decisión tras suprimir la identidad** (ver sección 7).

2. **Parágrafo del art. 6: "Ninguna actividad podrá condicionarse a que el Titular suministre datos personales sensibles."** Esto es una restricción de producto, no de texto legal. Significa que **el registro y el uso básico de Koinonía no pueden exigir declarar afiliación, posición política ni ningún sensible**. Todo campo sensible es opcional, y su ausencia no puede degradar el acceso al servicio. Un usuario debe poder registrarse, leer, y ejercer sus derechos sin revelar un solo sensible.

3. **Deber reforzado de informar (art. 12 lit. b).** Al recolectar sensibles hay que informar expresamente **el carácter facultativo de la respuesta**. En UI: etiqueta visible "opcional — puedes usar la plataforma sin responder esto", no un asterisco.

### 2.3 Tabla de clasificación

Base de licitud: `A-exp` = autorización explícita del titular para dato sensible (Ley 1581, art. 6 lit. a); `A` = autorización previa, expresa e informada (art. 9); `Art.6c` = actividad legítima de organismo sin ánimo de lucro de finalidad política/filosófica respecto de sus miembros; `Art.6e` = finalidad histórica/estadística con supresión de identidad.

| Dato | Categoría | Base de licitud | Consecuencia técnica |
|---|---|---|---|
| Nombre y apellidos | Personal, identificador. Dato público en cuanto identificación básica (Decreto 1377, art. 3, num. 2) | `A` | Columna en `personas`, cifrada en reposo. **Nunca en el ledger en claro.** Separada de la tabla de eventos. |
| Correo institucional `@udea.edu.co` | Semiprivado (identificador de contacto y de pertenencia institucional) | `A` | Único identificador de autenticación. **Nunca en el ledger, en ninguna forma: ni en claro, ni hasheado, ni salado, ni con HMAC bajo clave del KMS** (R2, ver §7.5). El índice sobre HMAC con clave en KMS existe **sólo dentro del PII Vault**, para búsquedas. |
| Programa académico | Semiprivado (dato académico, T-729/2002) | `A` | Cuasi-identificador. Prohibido publicarlo junto a semestre y cualquier atributo de participación: en n≈300 la tripleta reidentifica. |
| Semestre / cohorte | Semiprivado | `A` | Idem. Solo en agregados con umbral k ≥ 10. |
| Edad / fecha de nacimiento | Privado | `A` | Se recolecta **únicamente** para determinar mayoría de edad. Almacenar el booleano derivado `es_mayor_de_edad` + fecha de verificación; **no** la fecha completa, salvo necesidad probada. |
| Participación en deliberaciones (metadato: que participó, cuándo) | Privado; **sensible por contexto** si la deliberación versa sobre materia política | `A` + `Art.6c` | Separar el *hecho* de participación del *contenido*. El hecho puede ir al ledger seudonimizado; el contenido no. |
| Contenido de una intervención deliberativa | **SENSIBLE** (orientación política, art. 5) | `A-exp` | Almacenamiento off-ledger, cifrado por columna, clave destruible. En el ledger solo un **compromiso a valor aleatorio** `H(nonce)`, con el `nonce` en la bóveda (§7.6, corregido por R2). *El doc 11 §1.1 aún dice `sha256(jcs(texto))` para este mismo dato: contradicción **C14**, pendiente de resolución del arquitecto.* |
| Objeción argumentada firmada | **SENSIBLE** | `A-exp` específica para firma y publicación, revocable | Requiere consentimiento separado del general, con alcance de difusión explícito (interno del colectivo / público). Revocación → despublicación y seudonimización del autor, conservando el texto de la objeción si el proceso ya cerró (art. 6 lit. e). |
| Voto **secreto** | **SENSIBLE** | `A-exp` | El vínculo voto↔votante **no debe existir en ningún almacén**. Diseño: papeleta con credencial ciega o *nullifier* derivado de secreto del votante; se persiste el voto y, por separado, la marca "X ya votó". Ni el administrador con acceso total a la base puede reconstruir el vínculo. |
| Voto **nominal / público** | **SENSIBLE** (manifestación de orientación política) | `A-exp` para cada votación nominal | El carácter nominal debe anunciarse **antes** de abrir la votación y aceptarse por el votante en ese acto. No se puede convertir retroactivamente una votación secreta en nominal. |
| Tareas asignadas | Privado | `A` | Datos operativos. Retención corta tras cierre de la iniciativa. |
| Evaluaciones de desempeño en iniciativas | Privado, **alto impacto reputacional**; roza lo sensible por potencial discriminatorio | `A` específica, opt-in | Acceso restringido al evaluado y al órgano competente. **Nunca al ledger, ni siquiera hasheadas.** Retención máxima definida y purga automática. Derecho de contradicción antes de que produzca efectos. |
| Afiliación a movimiento/colectivo estudiantil | **SENSIBLE** (art. 5: pertenencia a organizaciones sociales) | `A-exp`, campo **opcional** (parágrafo art. 6) | Campo nulable, sin efecto en permisos ni en funcionalidad. No participa en ningún cálculo publicado. |
| Dirección IP, user-agent | Personal (identificador en línea) | `A` o interés en seguridad, informado | Retención ≤ 30 días, solo para seguridad. **Nunca al ledger.** Anonimización del último octeto en logs de larga duración. |
| Resultado agregado de una votación (conteos) | No personal si n ≥ umbral | — | Publicable. Con n pequeño (p. ej. 3 votantes, resultado 3-0) **sí es dato personal inferible**: aplicar umbral mínimo de publicación. |
| Hash/compromiso salado de un evento | Seudonimizado ⇒ **sigue siendo dato personal** mientras exista la sal | `A` | Ver §7.5. Solo deja de ser dato personal cuando la sal/clave se destruye irreversiblemente y no hay otra vía de reidentificación. **R2:** por eso ningún compromiso de un identificador personal entra al ledger —el ledger es permanente y la sal no, así que su seguridad tendría fecha de vencimiento. |

---

## 3. Autorización del titular

### 3.1 Requisitos

**Ley 1581, art. 9**: en el tratamiento se requiere la autorización **previa e informada** del titular, "la cual deberá ser obtenida por cualquier medio que pueda ser objeto de consulta posterior". El **art. 4 lit. c** (libertad) añade el carácter **expreso**: sin consentimiento previo, expreso e informado no hay tratamiento. Para sensibles, el **art. 6 lit. a** exige que sea **explícita**.

**Decreto 1377 de 2013**: la autorización puede constar por escrito, de forma oral o mediante **conductas inequívocas** del titular; y **"en ningún caso el silencio podrá asimilarse a una conducta inequívoca"**. `VERIFICAR: número exacto del artículo del Decreto 1377/2013 que contiene la regla de "modo de obtener la autorización" y la prohibición del silencio (creo que es el art. 7; confirmar en el texto oficial).`

**Casos en que no se requiere autorización — Ley 1581, art. 10**: (a) información requerida por entidad pública o administrativa en ejercicio de sus funciones legales o por orden judicial; (b) datos de naturaleza pública; (c) urgencia médica o sanitaria; (d) tratamiento autorizado por la ley para fines históricos, estadísticos o científicos; (e) datos relacionados con el Registro Civil. Para Koinonía, ninguno sustituye la autorización general.

### 3.2 Carga de la prueba y cómo se implementa

La carga de probar la autorización es **del Responsable** (Ley 1581, art. 8 lit. b, que da al titular el derecho a *solicitar prueba de la autorización*; y art. 17 lit. c, deber de conservar copia de la respectiva autorización). Un checkbox marcado en producción no prueba nada por sí solo: prueba que hoy hay un `true` en una fila.

**Diseño del registro de consentimiento con valor probatorio:**

```
consent_record
  id                 uuid pk
  persona_id         uuid fk
  policy_version     text        -- 'v1.3.0'
  policy_hash        text        -- SHA-256 del texto exacto mostrado
  policy_text_ref    text        -- ruta al blob inmutable del texto renderizado
  purpose            enum        -- una fila POR finalidad, no una por usuario
  state              enum        -- otorgado | denegado | revocado
  granted_at         timestamptz -- con zona, siempre
  method             enum        -- web_form | ...
  ui_snapshot_hash   text        -- hash del render exacto del formulario (HTML)
  ip_hash            text        -- HMAC, no IP en claro
  user_agent_hash    text
  evidence_chain     text        -- hash encadenado con el registro anterior
  revoked_at         timestamptz null
```

> **Corregido tras la implementación (2026-08-21):** esta tabla vive en el **PII Vault**, y por eso
> `uuid` y `timestamptz` serían aceptables aquí —el vault es mutable, se borra físicamente y nada de
> lo suyo entra al ledger (ADR-0008, ADR-0009)—. **Pero `evidence_chain` es una cadena de hashes**, y
> eso cambia el análisis: los campos que entren a su preimagen quedan bajo la **regla de tipos del
> ledger** (`10-ledger-inmutable.md` §1.1-bis) aunque no salgan nunca de la bóveda. Si `granted_at`
> entra a la preimagen, PostgreSQL lo devolverá como `2026-08-21 03:14:00.1+00` y no como el
> `2026-08-21T03:14:00.100Z` que se hasheó, y el registro de consentimiento **perderá exactamente el
> valor probatorio que justifica su existencia** — que es lo que la SIC pediría ver.
>
> Se fija: **los campos que entran a la preimagen de `evidence_chain` se declaran explícitamente y se
> almacenan en tipos que no normalizan** (`char(24)` para el instante, `char(32)` para los
> identificadores, `text` para el resto). Los campos que **no** entran —`method`, `user_agent_hash`,
> `revoked_at`— pueden seguir con el tipo natural. La lista de campos hasheados es parte del esquema,
> no una convención: sin ella, la cadena no es reproducible por un tercero y no prueba nada.

Reglas:

1. **Una fila por finalidad.** Consentimiento granular ⇒ granularidad en el almacenamiento. Revocar una finalidad no debe tocar las otras.
2. **Versionado del texto, no referencia al texto vigente.** Se debe poder reconstruir *exactamente qué leyó el usuario en esa fecha*. Guardar el hash del texto y el blob del texto. Si la política cambia, las autorizaciones anteriores siguen apuntando a la versión antigua.
3. **Append-only.** Revocar = insertar fila nueva con `state='revocado'`, nunca `UPDATE`. El historial completo es la prueba.
4. **Snapshot del render.** Guardar el hash del HTML servido demuestra que la casilla no estaba premarcada. Es la diferencia entre "afirmamos que cumplimos" y "aquí está la evidencia".
5. **Sellado temporal.** Incluir el `consent_record` en la cadena de hashes del ledger (solo el compromiso, no el contenido) y en la raíz publicada externamente da fecha cierta oponible a terceros.

   > **Corregido por resolución R2 del arquitecto:** ese «compromiso» no puede ser un hash del registro
   > de consentimiento, porque el registro contiene datos personales (`persona_id`, `ip_hash`,
   > `user_agent_hash`) y un hash suyo es una derivación de ellos. La forma admitida es la única que
   > sobrevive a R2 y que la propia §7.5 llama «la opción más limpia»: **compromiso a un valor
   > aleatorio** —`H(nonce)` con `nonce` de CSPRNG guardado junto al `consent_record` en el PII Vault,
   > fuera del ledger—. Da la misma fecha cierta y el ledger no contiene ninguna función del dato.
6. **Exportable en un clic.** El titular puede pedir prueba de su autorización (art. 8 lit. b); el sistema debe emitir un PDF/JSON firmado con todo lo anterior.

### 3.3 Aviso de privacidad y Política de Tratamiento

Son documentos distintos con contenido mínimo distinto (Decreto 1377 de 2013).

**Aviso de privacidad** — comunicación breve, en el punto de recolección. Contenido mínimo: (i) identidad y datos de contacto del Responsable; (ii) tipo de tratamiento y su finalidad; (iii) mecanismos para conocer la Política de Tratamiento y sus cambios sustanciales; (iv) **si se recolectan datos sensibles, debe indicarse expresamente**. `VERIFICAR: art. exacto del Decreto 1377/2013 sobre contenido mínimo del aviso de privacidad (creo art. 12) y el deber de conservar modelo del aviso mientras dure el tratamiento.`

**Política de Tratamiento** — documento completo, en medio físico o electrónico, **en lenguaje claro y sencillo**. Contenido mínimo: (a) nombre/razón social, domicilio, dirección, correo electrónico y teléfono del Responsable; (b) tratamiento al cual serán sometidos los datos y su finalidad; (c) derechos del titular; (d) persona o área responsable de atender peticiones, consultas y reclamos, con sus datos de contacto; (e) procedimiento para ejercer los derechos; (f) fecha de entrada en vigencia y período de vigencia de la base de datos. `VERIFICAR: art. exacto del Decreto 1377/2013 (creo art. 13) y literales.`

Regla de ingeniería: la Política vive en `docs/legal/politica-tratamiento.md` **en el repositorio**, versionada con SemVer, cada release firmado con tag GPG. Los cambios sustanciales se comunican al titular antes de entrar en vigor y no aplican retroactivamente a autorizaciones ya otorgadas.

---

## 4. Derechos del titular convertidos en SLAs de software

### 4.1 Catálogo de derechos (Ley 1581, art. 8)

(a) conocer, actualizar y rectificar; (b) solicitar prueba de la autorización; (c) ser informado, previa solicitud, del uso dado a sus datos; (d) presentar quejas ante la SIC por infracciones; (e) revocar la autorización y/o solicitar la supresión del dato en los términos del artículo; (f) **acceder en forma gratuita** a sus datos objeto de tratamiento.

Sobre (d): el **art. 16** impone un **requisito de procedibilidad** — el titular solo puede quejarse ante la SIC **después** de agotar el trámite de consulta o reclamo ante el Responsable/Encargado. Consecuencia: el canal interno debe ser real, trazable y responder a tiempo; si no, el requisito se entiende agotado y la queja procede igual.

### 4.2 Plazos legales exactos

**Consultas — Ley 1581, art. 14:**
- Término máximo de respuesta: **diez (10) días hábiles**, contados desde la fecha de recibo.
- Prórroga: si no es posible atenderla en ese término, se debe **informar al interesado** los motivos de la demora y la fecha en que se atenderá, la cual **no podrá superar los cinco (5) días hábiles siguientes al vencimiento del primer término**.
- **Tope absoluto: 15 días hábiles.**
- Parágrafo: leyes especiales o reglamentos del Gobierno pueden fijar términos **inferiores**.

**Reclamos — Ley 1581, art. 15:**
- Reclamo incompleto: se requiere al interesado **dentro de los cinco (5) días siguientes** a la recepción para que subsane. Si transcurren **dos (2) meses** desde el requerimiento sin respuesta, **se entiende desistido**.
- Si quien recibe no es competente: **traslado en máximo dos (2) días hábiles**, informando al interesado.
- Recibido el reclamo completo: se incluye en la base de datos la leyenda **"reclamo en trámite"** y el motivo, **en término no mayor a dos (2) días hábiles**, y se mantiene hasta que el reclamo se decida.
- Término máximo para atender el reclamo: **quince (15) días hábiles** contados **a partir del día siguiente** a la fecha de recibo.
- Prórroga: informando motivos y nueva fecha, que **no podrá superar los ocho (8) días hábiles siguientes al vencimiento del primer término**.
- **Tope absoluto: 23 días hábiles.**

**Acceso gratuito:** el titular puede consultar sus datos gratuitamente al menos una vez cada mes calendario; consultas adicionales pueden regularse en la política. `VERIFICAR: artículo del Decreto 1377/2013 que fija la gratuidad mensual (creo art. 21) y sus condiciones exactas.`

### 4.3 Instrumentación en software

| Derecho / trámite | Plazo legal | Instrumentación |
|---|---|---|
| Consulta (art. 14) | 10 h. + 5 h. de prórroga | `request` con `type='consulta'`, `due_at` calculado con calendario de **días hábiles colombianos**, alerta a los 5 y 8 días hábiles, escalamiento automático al Responsable a los 9. |
| Reclamo (art. 15) | 15 h. + 8 h. | Idem con `due_at` desde el **día siguiente** al recibo (offset +1, error clásico). Alertas a los 8, 12 y 14 días hábiles. |
| Subsanación de reclamo incompleto | Requerimiento en 5 días; desistimiento a los 2 meses | Estado `pendiente_subsanacion` con dos temporizadores independientes; el de desistimiento cuenta desde el requerimiento, no desde el reclamo. |
| Traslado por incompetencia | 2 días hábiles | Estado `trasladado` con destinatario y notificación al interesado registrada. |
| Leyenda "reclamo en trámite" | 2 días hábiles | Flag `en_reclamo` en la fila del titular, expuesto en toda vista de sus datos. Es una obligación **sobre la base de datos**, no sobre el ticket. |
| Prueba de autorización (art. 8 lit. b) | Dentro del plazo de consulta | Exportación firmada del `consent_record` completo. |
| Acceso gratuito (art. 8 lit. f) | Inmediato, ≥1/mes gratis | Autoservicio, sin ticket. |
| Revocación (art. 8 lit. e) | Efecto inmediato hacia futuro | Inserta `state='revocado'`; dispara el pipeline de la sección 7. |

**Detalles que rompen implementaciones ingenuas:**

1. **"Días hábiles" ≠ días laborables genéricos.** Se requiere un calendario de festivos colombianos, con los traslados al lunes de la **Ley 51 de 1983** ("Ley Emiliani"). Implementar como tabla `festivos_co` poblada anualmente y auditada, no como librería con datos hardcodeados. `VERIFICAR: listado oficial de festivos del año en curso y regla de traslado de la Ley 51 de 1983.`
2. **Zona horaria.** `America/Bogota` (UTC-5, sin horario de verano). Almacenar en UTC, calcular plazos en hora local.
3. **La respuesta debe quedar registrada**, no solo enviada: contenido, canal, fecha y acuse. Es la prueba de cumplimiento (accountability).
4. **El reloj no se detiene** porque el equipo esté en vacaciones o en semana de parciales. El canal debe tener responsable suplente designado.

---

## 5. Roles y obligaciones

### 5.1 Responsable vs Encargado

**Ley 1581, art. 3:** *Responsable del Tratamiento* es quien **decide sobre la base de datos y/o el Tratamiento** (los fines y los medios). *Encargado del Tratamiento* es quien **realiza el tratamiento por cuenta del Responsable**. Los deberes están en los arts. 17 (Responsable) y 18 (Encargado).

### 5.2 Escenarios y consecuencias

**Escenario A — La Universidad de Antioquia es Responsable** (Koinonía adoptada como plataforma institucional).
- Consecuencias: la UdeA es persona jurídica de naturaleza pública ⇒ **obligada a registrar la base de datos en el RNBD**. Aplica el art. 27 de la Ley 1581 (personas de derecho público). Sujeta a control interno, a la Ley 1712 de 2014 y al régimen de responsabilidad estatal.
- Riesgo político: la institución adquiere control sobre los fines y medios de una plataforma cuyo propósito es, entre otros, ejercer contrapeso frente a la institución. **Riesgo de captura.** Además, el art. 6 lit. c (organismo sin ánimo de lucro de finalidad política/filosófica) **no** ampararía el tratamiento de sensibles.

**Escenario B — Una organización estudiantil con personería jurídica (ESAL) es Responsable.** ← **RECOMENDADO**
- La asociación decide fines y medios; la UdeA no interviene; los proveedores de infraestructura son Encargados.
- Encaja **directamente en el art. 6 lit. c**: "actividades legítimas y con las debidas garantías por parte de una fundación, ONG, asociación o cualquier otro organismo sin ánimo de lucro, cuya finalidad sea política, filosófica […] siempre que se refieran exclusivamente a sus miembros". Koinonía es exactamente eso. Esta es la base de licitud más sólida disponible para el tratamiento de sensibles.
- **Con la contrapartida literal del mismo literal: "los datos no se podrán suministrar a terceros sin la autorización del Titular."** Esto restringe la publicación externa y refuerza que la raíz criptográfica publicada no puede contener datos personales.
- Interpone una persona jurídica entre el proyecto y el patrimonio personal de los administradores.
- RNBD: probablemente **no obligada** (ver §5.3).

**Escenario C — Un estudiante persona natural administra el servidor y decide fines y medios.** ← **PEOR ESCENARIO**
- Él es el Responsable. Las sanciones del art. 23 son "de carácter **personal** e institucional": ese estudiante responde con su patrimonio hasta 2.000 SMMLV.
- No aplica el art. 6 lit. c (no es un organismo sin ánimo de lucro) ⇒ el tratamiento de sensibles queda colgando únicamente de la autorización explícita, sin respaldo estructural.

**Escenario D — Colectivo de hecho, sin personería.** Jurídicamente equivale a C: la responsabilidad recae, de forma personal y potencialmente solidaria, sobre quienes efectivamente deciden fines y medios.

**Recomendación estructurada:**
1. Constituir una **entidad sin ánimo de lucro** (asociación) con objeto explícito de participación democrática estudiantil y finalidad filosófica/política, registrada ante la Cámara de Comercio de Medellín. `VERIFICAR: requisitos vigentes de constitución y registro de ESAL en Colombia (Decreto 2150 de 1995 y normas posteriores) y trámite específico ante la Cámara de Comercio de Medellín para Antioquia.`
2. Designar formalmente en acta a la asociación como **Responsable** y nombrar un **oficial de protección de datos** (persona o área del art. 13 lit. d del Decreto 1377) con correo público de contacto.
3. Firmar **contratos de transmisión de datos** con cada Encargado (hosting, correo, almacenamiento).
4. Mantener el vínculo con la Universidad como **convenio de colaboración**, no como subordinación jerárquica, para no desplazar la calidad de Responsable.

### 5.3 Registro Nacional de Bases de Datos (RNBD)

Creado por el **art. 25 de la Ley 1581 de 2012**, reglamentado por el **Decreto 886 de 2014** (compilado en el Decreto 1074 de 2015) e instruido por la SIC mediante circular externa.

El umbral vigente proviene del **Decreto 090 de 2018**, que modificó el Decreto 1074 de 2015: deben registrar sus bases de datos **(i) las sociedades y entidades sin ánimo de lucro con activos totales superiores a 100.000 UVT** y **(ii) las personas jurídicas de naturaleza pública**. Las personas naturales no están obligadas.

Aplicación:
- **Escenario A (UdeA Responsable):** obligatorio, por ser persona jurídica de naturaleza pública.
- **Escenario B (ESAL estudiantil):** no obligatorio mientras los activos totales no superen 100.000 UVT — condición que una asociación estudiantil no alcanzará ni de lejos.
- **Escenarios C/D (persona natural):** no obligatorio, pero eso no es una ventaja: el resto de obligaciones sigue intacto y la sanción es personal.

`VERIFICAR: (a) que el umbral de 100.000 UVT del Decreto 090 de 2018 sigue vigente y no fue modificado; (b) valor de la UVT del año en curso (resolución anual de la DIAN) para calcular el umbral en pesos; (c) circular externa de la SIC vigente con las instrucciones operativas del RNBD y los plazos de actualización anual.`

---

## 6. Casos particulares

### 6.1 Transferencia y transmisión internacional

El **Decreto 1377 de 2013, art. 3** distingue:
- **Transferencia**: envío de datos a un receptor que es, a su vez, **Responsable**, dentro o fuera del país.
- **Transmisión**: comunicación de datos a un **Encargado** para que trate por cuenta del Responsable, dentro o fuera del país.

El **art. 26 de la Ley 1581** prohíbe la transferencia a países que no ofrezcan **niveles adecuados de protección**, salvo: (a) autorización **expresa e inequívoca** del titular para la transferencia; (b) intercambio de datos médicos por razón de salud pública; (c) transferencias bancarias o bursátiles; (d) transferencias en el marco de tratados internacionales de los que Colombia sea parte; (e) transferencias necesarias para la ejecución de un contrato entre titular y Responsable; (f) transferencias legalmente exigidas para salvaguardar el interés público o para el ejercicio o defensa de un derecho en un proceso judicial.

La **transmisión** internacional a un Encargado no requiere autorización adicional del titular si media un **contrato de transmisión de datos personales** con las cláusulas exigidas por el reglamento (deberes del Encargado, medidas de seguridad, finalidad, confidencialidad). `VERIFICAR: artículos del Decreto 1377/2013 sobre contrato de transmisión y cláusulas mínimas (creo arts. 24–25) y el régimen de declaración de conformidad ante la SIC.`

La SIC publicó la lista de países considerados con **nivel adecuado de protección** mediante circular externa. Estados Unidos **no** figura en esa lista con carácter general. `VERIFICAR CRÍTICO: circular externa de la SIC vigente con la lista de países con nivel adecuado (creo Circular Externa 005 de 2017, que modificó el Título V de la Circular Única) y si ha habido actualizaciones posteriores. De esto depende directamente la elección del proveedor de VPS/S3.`

**Decisiones de arquitectura que se derivan:**

1. **Preferencia fuerte por alojamiento en Colombia** o en país de la lista de adecuación. Elimina el problema de raíz.
2. Si el VPS o el bucket S3 están en EE. UU.: la vía practicable es **transmisión a Encargado con contrato**, más autorización expresa e inequívoca del titular como cinturón de seguridad, informándole el país de destino y el proveedor concretos (por nombre, no "proveedores en el exterior").
3. **Backups**: la región del backup es tan relevante como la del primario. Un backup replicado a `us-east-1` es una transmisión internacional.
4. **La raíz criptográfica publicada externamente**: si —y solo si— se diseña de modo que no sea dato personal (ver §7.5), su publicación **no es transferencia internacional de datos personales**. Este es el argumento clave para poder usar un servicio de sellado de tiempo o una cadena pública fuera de Colombia. El diseño debe sostener esa afirmación técnicamente, no declararla.
5. **CDN, analítica, tipografías, error tracking**: cada uno es un tercero receptor. Auto-hospedar todo activo estático. Cero analítica de terceros. Si se usa monitoreo de errores, autohospedado y con *scrubbing* de PII.

### 6.2 Menores de edad

Mayoría de edad en Colombia: 18 años. Es realista que haya estudiantes de 16–17 años en primeros semestres.

El **art. 7 de la Ley 1581** ordena asegurar el respeto de los derechos prevalentes de niños, niñas y adolescentes y establece que **queda proscrito el tratamiento de sus datos personales, salvo aquellos de naturaleza pública**. La **Sentencia C-748 de 2011** matizó esa prohibición: el tratamiento es admisible cuando responde al **interés superior del menor** y se respetan sus derechos fundamentales, en particular su **derecho a ser escuchado**. El reglamento exige que la autorización la otorgue el **representante legal**, previo ejercicio del derecho del menor a ser escuchado, valorando su madurez y autonomía. `VERIFICAR: artículo del Decreto 1377/2013 sobre datos de niños, niñas y adolescentes y su redacción exacta; y los apartados pertinentes de la Sentencia C-748 de 2011.`

**Implementación mínima:**
- Verificar mayoría de edad **en el registro**, antes de recolectar cualquier sensible.
- Si el usuario es menor: flujo diferenciado con autorización del representante legal; **prohibición absoluta de recolectar sensibles** (afiliación, opinión política identificada, voto nominal) mientras sea menor; participación en modo estrictamente anónimo o suspendida hasta la mayoría de edad.
- **Nunca** escribir datos de menores en el ledger inmutable, ni siquiera seudonimizados: el consentimiento del representante legal es revocable y el menor, al cumplir 18, tiene derecho a revisar el tratamiento consentido por otro.
- Registrar la fecha de mayoría de edad y disparar un flujo de **reconsentimiento propio** al cumplirla.

Alternativa de diseño defendible y mucho más simple: **restringir el registro a mayores de edad** en el MVP y documentar la exclusión. Elimina toda la superficie de riesgo del art. 7.

### 6.3 Régimen sancionatorio de la SIC

**Ley 1581, art. 23** — sanciones aplicables a Responsables y Encargados:
- **a)** Multas **de carácter personal e institucional hasta por el equivalente de dos mil (2.000) salarios mínimos mensuales legales vigentes** al momento de la imposición.
- **b)** Suspensión de las actividades relacionadas con el tratamiento hasta por **seis (6) meses**.
- **c)** Cierre temporal de las operaciones, si transcurrido el término de suspensión no se adoptaron los correctivos.
- **d)** **Cierre inmediato y definitivo de la operación que involucre el Tratamiento de datos sensibles.**

El **art. 24** fija criterios de graduación (dimensión del daño, beneficio obtenido, reincidencia, resistencia a la investigación, reconocimiento o aceptación expresa de la infracción antes de la sanción, entre otros).

**Dimensionamiento del riesgo:** `VERIFICAR: SMMLV vigente (decreto anual del Gobierno Nacional).` A título puramente ilustrativo, con un SMMLV del orden de $1,4 millones COP, el tope de 2.000 SMMLV se ubica alrededor de **$2.800 millones de pesos**. Es una cifra que no guarda relación con la capacidad patrimonial de un colectivo estudiantil, y por eso la sección 5 recomienda interponer una persona jurídica.

El literal **d)** es el que debe gobernar el diseño: Koinonía trata datos sensibles por su propia naturaleza, y el cierre definitivo es una sanción disponible. **El proyecto entero está bajo el régimen más severo de la ley.**

---

## 7. El conflicto duro: supresión vs registro inmutable

### 7.1 ¿Es absoluto el derecho de supresión?

No.

El derecho a solicitar la supresión está en el **art. 8 lit. e de la Ley 1581**, y su redacción ya es restrictiva: el titular puede "revocar la autorización y/o solicitar la supresión del dato **cuando en el Tratamiento no se respeten los principios, derechos y garantías constitucionales y legales**", y añade que la revocatoria y/o supresión "procederá cuando la Superintendencia de Industria y Comercio haya determinado que en el Tratamiento el Responsable o Encargado han incurrido en conductas contrarias a esta ley y a la Constitución". Es decir, el texto legal no consagra un derecho al borrado incondicionado al estilo del art. 17 del RGPD.

Además, el reglamento fija un límite expreso y directamente aplicable aquí: **la solicitud de supresión de la información y la revocatoria de la autorización no procederán cuando el titular tenga un deber legal o contractual de permanecer en la base de datos.** `VERIFICAR CRÍTICO: artículo exacto del Decreto 1377 de 2013 que contiene esta regla (creo art. 9, "Revocatoria de la autorización"; confirmar también su numeración compilada en el Decreto 1074 de 2015). Esta es la cita que sostiene toda la arquitectura del ledger: no puede quedar sin verificar.`

La SIC ha sostenido, además, que la supresión no procede cuando obstaculice actuaciones judiciales o administrativas, ni cuando exista una obligación legal de conservación. `VERIFICAR: concepto o guía de la SIC que recoja estos límites, para citarlo con referencia y fecha.`

**Consecuencia para Koinonía:** el estatuto de la organización debe establecer, y el consentimiento debe informar con toda claridad, que **la pertenencia al órgano deliberativo genera un deber estatutario de permanencia del registro de las decisiones colectivas**, análogo al deber de conservación de actas de una asamblea. Eso no legitima conservar *todo*; legitima conservar el **hecho institucional**.

### 7.2 Finalidad histórica y de interés legítimo

Sí, es sostenible, y tiene anclaje textual explícito.

El **art. 6 lit. e de la Ley 1581** exceptúa de la prohibición de tratar datos sensibles el tratamiento con **finalidad histórica, estadística o científica**, con una condición literal: *"En este evento deberán adoptarse las medidas conducentes a la supresión de identidad de los Titulares."* Y el **art. 10 lit. d** exime de autorización el tratamiento "autorizado por la ley para fines históricos, estadísticos o científicos".

Esto habilita un diseño de dos velocidades, que es el núcleo de la solución:

- **El hecho de la decisión se conserva indefinidamente**: qué se decidió, cuándo, con qué quórum, bajo qué regla, con qué resultado agregado. Esto es memoria institucional y es lo que hace que la gobernanza sea auditable.
- **La identidad de quienes la tomaron se suprime a solicitud**, mediante seudonimización irreversible.

La legitimidad de la conservación no descansa en un "interés legítimo" genérico —figura que la Ley 1581 **no** consagra como base de licitud autónoma, a diferencia del art. 6.1.f del RGPD— sino en la finalidad histórica del art. 6 lit. e y en el deber estatutario de permanencia del §7.1. **No importar el razonamiento del "interés legítimo" europeo: no existe en el derecho colombiano como base de licitud.**

### 7.3 Borrado criptográfico: ¿satisface el estándar colombiano?

**Respuesta honesta: no lo sé con certeza, y nadie lo sabe con certeza en Colombia.**

Lo que sí puede afirmarse:

1. **La Ley 1581 y el Decreto 1377 no definen técnicamente "supresión".** No hay norma, resolución ni circular de la SIC que diga si destruir la clave equivale a destruir el dato. `VERIFICAR: buscar conceptos de la Delegatura de Protección de Datos de la SIC sobre supresión, anonimización o borrado seguro; y jurisprudencia de tutela sobre hábeas data y borrado en registros inmutables.`
2. **Argumento a favor:** si la clave se destruye de forma verificable y no existe otra vía razonable de reidentificación, el dato deja de ser dato personal porque el titular ya no es "determinable" —requisito de la definición de dato personal del art. 3 lit. c de la Ley 1581—. Bajo esa lectura, el resultado material de la supresión se alcanza.
3. **Argumento en contra:** el dato cifrado **sigue existiendo** físicamente. Un avance criptoanalítico, una copia de la clave en un backup olvidado o una filtración previa lo revierten. La supresión legal se lee naturalmente como eliminación, no como inaccesibilidad.

**Comparación europea, con la misma honestidad.** El RGPD (art. 4.5) define seudonimización y su Considerando 26 aclara que solo la información **anónima** queda fuera del reglamento, aplicando un criterio de "medios razonablemente utilizables" para reidentificar. La discusión sobre *crypto-shredding* en cadenas inmutables está abierta:
- La autoridad francesa **CNIL**, en su documento sobre blockchain y RGPD (2018), reconoce que borrar la clave es la solución que más se aproxima al borrado en una cadena inmutable, pero **no afirma que satisfaga plenamente el art. 17**; recomienda mantener los datos personales **fuera de la cadena** y anclar solo compromisos. `VERIFICAR: título, fecha y texto exacto del documento de la CNIL sobre blockchain y RGPD antes de citarlo formalmente.`
- La **AEPD y el SEPD**, en su documento conjunto sobre funciones hash como técnica de seudonimización, concluyen que un hash de un dato personal es, por regla general, **dato personal seudonimizado y no anónimo**. `VERIFICAR: título, año y conclusiones exactas de ese documento conjunto AEPD–EDPS.`
- El **Dictamen 05/2014 del Grupo de Trabajo del art. 29** sobre técnicas de anonimización sostiene que la seudonimización **no es** anonimización. `VERIFICAR: numeración y contenido del dictamen.`

**Regla práctica para ingeniería, dada la incertidumbre:** no apostar la arquitectura a que el borrado criptográfico será aceptado. **Diseñar de modo que no haga falta.** Los datos personales viven fuera del ledger, en almacenamiento mutable donde el borrado es borrado de verdad (`DELETE` + vacuum + purga de backups en ventana definida). El ledger no contiene ninguna función de un dato personal. El borrado criptográfico se usa como **defensa en profundidad**, nunca como mecanismo principal de cumplimiento del art. 8 lit. e.

> **Corregido por resoluciones R2 y R3 del arquitecto (2026-08-21).** Dos precisiones sobre el párrafo anterior, que en lo esencial ya era correcto:
> - **R2.** Se leía «el ledger contiene solo compromisos que, tras destruir la sal, no son reversibles ni siquiera por fuerza bruta». Eso todavía admitía publicar un compromiso de un identificador personal y confiar en la destrucción de la sal. **Ya no.** Al Governance Ledger no entra ningún hash, commitment ni derivación de un identificador personal. La irreversibilidad deja de ser un resultado que hay que sostener con custodia de claves y pasa a ser una propiedad estructural: no hay preimagen porque no hay imagen.
> - **R3.** «Diseñar de modo que no haga falta» se vuelve **postura explícita y no sólo aspiración**: ante una solicitud de supresión se ejecuta un `DELETE` físico del registro del PII Vault. El borrado criptográfico queda **reservado a backups y réplicas**, donde el borrado físico es imposible. La zona gris de §7.3 sigue siendo zona gris; lo que cambia es que la defensa del proyecto no depende de resolverla a nuestro favor.

### 7.4 Seudonimización retroactiva

Es defendible, y probablemente sea el mecanismo central de cumplimiento. Condiciones:

1. **Irreversible por diseño.** ~~Sustituir el identificador por un seudónimo derivado de una sal aleatoria por titular, y **destruir la sal**.~~

   > **Corregido por resolución R1 del arquitecto:** no hay nada que sustituir ni ninguna sal que destruir, porque **el identificador del ledger nunca fue una función del dato personal**: el `MemberId` es aleatorio de 128 bits (CSPRNG) desde el alta. La seudonimización retroactiva consiste en **borrar la fila de traducción `MemberId ↔ persona` del PII Vault**; el `MemberId` queda huérfano e irreversible sin tocar un byte del ledger. Un esquema basado en «derivar y luego destruir la sal» sigue dependiendo de que la destrucción haya sido completa en cada réplica, cada WAL y cada backup —es decir, seguiría siendo una promesa operativa en vez de una propiedad estructural.
2. **Anunciada ex ante.** El consentimiento y la política deben explicar, antes del primer uso, que la supresión se materializa así y qué queda. Aplicar retroactivamente una técnica no anunciada es sorpresivo y debilita la defensa.
3. **Verificable.** El acto de seudonimización debe dejar su propia entrada en el ledger (evento `identity_severed`, sin datos personales), con la fecha. Es la prueba de haber atendido el derecho.
4. **Con control de reidentificación por cruce.** En n≈300, un seudónimo con historial rico (mismos tres compañeros de iniciativa, mismo patrón horario, mismo estilo de escritura) se reidentifica sin necesidad de romper nada. Por eso:
   - ~~**Seudónimos por proceso, no globales.** Un seudónimo distinto por deliberación, sin correlación entre ellos.~~

     > **Corregido por resolución R1 del arquitecto:** el `MemberId` es **uno solo, aleatorio y estable** por persona. Un seudónimo por proceso es incompatible con tres piezas ya congeladas del diseño y no puede sostenerse: (i) el padrón congelado se publica como `MemberId[]` y su `rollHash` debe poder verificarse (spec 30 §A.2); (ii) la unicidad del voto se garantiza con `PRIMARY KEY (decision_id, member_id)` en `roll.voter_marks` (doc 11 §2.4); (iii) la delegación, el tope de concentración y el `HHI*` requieren identidad longitudinal (spec 30, parte C). Además, un seudónimo por proceso derivado con «sal por proceso» sería precisamente una derivación prohibida por R2. **El enlace longitudinal se acepta como coste declarado**, y se mitiga con lo que sigue: truncado temporal, umbral k y supresión del texto libre. Ver contradicción **C5** en `00-contradicciones-resueltas.md`.
   - Truncar timestamps a granularidad gruesa (día, no milisegundo) en lo publicado.
   - Umbral k mínimo para publicar cualquier agregado.
   - Considerar la supresión también del **texto** libre, no solo del nombre: el estilo y el contenido identifican.
5. **Que no vacíe de sentido el hecho conservado.** Si tras seudonimizar el registro es inservible como memoria institucional, no había razón para conservarlo: hay que borrarlo entero.

### 7.5 ¿La raíz criptográfica publicada es dato personal?

**Depende enteramente del diseño, y por defecto la respuesta es sí.**

**El ataque, con números concretos.** El universo es de ~300 personas. Los correos institucionales siguen un patrón predecible del tipo `nombre.apellido@udea.edu.co`. Un atacante que quiera saber si `X` participó en la deliberación `D`:
- Si en el ledger hay `SHA-256(correo)`: generar 300 hashes es trabajo de **microsegundos**. Ni siquiera hacen falta 300: se prueba el correo de la persona concreta. El "espacio de búsqueda" no es 2²⁵⁶, es **1**. Un hash sin sal de un identificador conocido no oculta absolutamente nada.
- Si hay `SHA-256(nombre || fecha)`: con listas públicas de estudiantes y fechas acotadas, el espacio sigue siendo trivialmente enumerable.

**Lo que sí lo evita:**

| Construcción | ¿Resiste el diccionario de 300? | ¿Admitida en el ledger? | Comentario |
|---|---|---|---|
| `SHA-256(correo)` | **No** | **NO** | Reversible en microsegundos. |
| `SHA-256(sal_pública ‖ correo)` | **No** | **NO** | Si la sal está en el ledger, el atacante la tiene. |
| `HMAC-SHA-256(k, correo)`, `k` en KMS | Sí, mientras `k` sea secreta | **NO (R2)** | Sirve **dentro del PII Vault** como índice de búsqueda. En el ledger, no: el ledger es permanente y `k` no. |
| `Argon2id(correo, sal_única_por_registro)`, sal **fuera** del ledger | Sí, mientras la sal exista | **NO (R2)** | Igual: útil en la bóveda, inadmisible en el ledger. |
| Compromiso a valor aleatorio: `H(nonce)` con `nonce` random guardado off-ledger | **Sí, absolutamente** | **SÍ — la única** | El ledger no contiene ninguna función del dato personal. |

> **Corregido por resolución R2 del arquitecto (2026-08-21):** esta tabla originalmente marcaba como aceptables las filas 3 y 4 —`HMAC` con clave en KMS y `Argon2id` con sal fuera del ledger— para publicar un identificador personal. **Quedan anuladas para el ledger.** La razón no es que sean criptográficamente débiles: es que su seguridad es **condicional y temporal** (vale mientras el secreto siga siendo secreto), mientras que el ledger es **incondicional y permanente**. Una filtración futura del pepper, de la clave del KMS o de la tabla de sales reabriría retroactivamente todo el histórico anclado, y a diferencia de una base de datos el ledger no se puede purgar. Con ~300 personas, la única defensa que no vence es la que hace desaparecer la preimagen: **compromiso a valor aleatorio**. Las filas 3 y 4 conservan su lugar **dentro del PII Vault**, que sí es mutable y purgable. Ver `docs/adr/0007-prohibicion-de-hashes-de-identificadores-en-el-ledger.md`.

**Parámetros (aplicables sólo dentro del PII Vault):** Argon2id con `m ≥ 64 MiB`, `t ≥ 3`, `p = 1` como piso, ajustados a la máquina. `VERIFICAR: parámetros mínimos recomendados vigentes de OWASP para Argon2id.` Sal de ≥ 16 bytes de CSPRNG, **única por registro**, almacenada en la tabla mutable y borrable, nunca en el ledger.

**La raíz Merkle en sí.** Si el árbol se construye sobre compromisos correctamente salados y **solo se publica la raíz** (32 bytes) más, a lo sumo, el número de hojas y el rango temporal, entonces la raíz publicada no permite reidentificar a nadie: es un valor pseudoaleatorio sin preimagen enumerable. Bajo esa construcción es **defendible que la raíz no es dato personal**, y su publicación externa no es transferencia internacional de datos personales.

Esa defensa se cae por completo si:
- se publican las **hojas** o las **pruebas de inclusión** de forma general (una prueba de inclusión revela la hoja);
- alguna hoja contiene un hash sin sal;
- se publica el **árbol completo** para "transparencia";
- se publican metadatos correlacionables (número exacto de participantes por proceso en grupos pequeños).

**Regla práctica para ingeniería, en una línea:** *al ledger y a la raíz publicada solo entran valores que serían indistinguibles de aleatorios para alguien que conozca la lista completa de las 300 personas y todo el contenido posible de los eventos.* Si un valor no pasa esa prueba mental, no entra. Y las pruebas de inclusión se entregan **al titular sobre su propio evento, bajo demanda**, nunca se publican en bloque.

### 7.6 Tabla final de reglas duras del ledger

**NUNCA puede entrar al ledger inmutable:**

| # | Dato | Razón |
|---|---|---|
| 1 | Nombre, apellidos o documento de identidad, en claro | Dato personal irreversible en registro inmutable; imposibilita la supresión. |
| 2 | Correo institucional en claro | Identificador directo. |
| 3 | **Cualquier derivación de un identificador personal** (correo, nombre, cédula, teléfono): hash, HMAC, commitment o compromiso, **con o sin sal, con o sin pepper, con o sin función lenta** | **R2.** No es cuestión de dificultad computacional sino de estructura: el ledger es permanente y todo secreto es temporal. Es el error más probable del equipo. *No aplica a derivaciones del `MemberId` aleatorio ya publicado —tickets de sorteo, pruebas Merkle—: su preimagen ya es pública y no es un dato personal.* |
| 4 | Texto libre de intervenciones, objeciones o comentarios | Sensible (art. 5) + puede contener datos de terceros que nunca consintieron. |
| 5 | Contenido de un voto secreto vinculable a un votante, incluso cifrado con clave recuperable | Destruye el secreto del voto de forma permanente e irreparable. |
| 6 | Datos sensibles del art. 5 en claro: afiliación, opinión política identificada, salud, orientación sexual, origen étnico, convicciones religiosas | Prohibición general del art. 6; sanción de cierre definitivo (art. 23 lit. d). |
| 7 | Evaluaciones de desempeño individuales, en claro o hasheadas de forma verificable contra un texto conocido | Alto impacto reputacional, sin finalidad histórica que justifique perpetuidad. |
| 8 | Cuasi-identificadores combinados (programa + semestre + rol + fecha fina) | Reidentificación por cruce sin romper criptografía. |
| 9 | Direcciones IP, user-agent, huella de dispositivo, geolocalización | Identificadores en línea; ninguna finalidad histórica los justifica. |
| 10 | Cualquier dato de un menor de edad, aun seudonimizado | Art. 7 Ley 1581; el consentimiento del representante legal es revocable. |
| 11 | Adjuntos, imágenes o binarios subidos por usuarios | Contenido no inspeccionable ⇒ PII y sensibles no controlados; metadatos EXIF. |
| 12 | Claves, sales, tokens, secretos o cualquier material que permita revertir un compromiso | Anula por completo el borrado criptográfico. |
| 13 | El texto de la política de privacidad de un titular concreto junto a su identidad | Ver 1 y 2. |

**SÍ puede entrar al ledger:**

| Elemento | Forma |
|---|---|
| Identificador de evento | 128 bits aleatorios en **32 hex minúsculas** (`^[0-9a-f]{32}$`). **No UUID, no ULID** — ver nota |
| Marca temporal | UTC, truncada a la granularidad mínima necesaria, en RFC 3339 exacto `YYYY-MM-DDTHH:MM:SS.sssZ` almacenado como texto, nunca `timestamptz` |
| Tipo de evento y versión de esquema | Enum cerrado |
| Compromiso del payload | `H(nonce)` con `nonce` aleatorio de CSPRNG guardado en el PII Vault. **R2: ya no `HMAC-SHA-256(k_KMS, payload)` ni `Argon2id(payload, sal_única)`** |
| Seudónimo de actor | El `MemberId` aleatorio de 128 bits, **único y estable por persona**. **R1: ya no un seudónimo por proceso derivado con sal por proceso** |
| Resultado agregado de votación | Solo con n ≥ umbral k |
| Identificador de decisión, quórum, regla de decisión aplicada, umbral exigido | Datos institucionales, no personales |
| Hash del documento de decisión publicado | El documento vive fuera |
| Encadenamiento | `prev_hash`, `merkle_root`, altura |
| Eventos de gobernanza del propio sistema | `identity_severed`, `policy_version_activated`, `key_rotated` — sin datos personales |

> **Corregido tras la implementación (2026-08-21):** esta tabla proponía **UUIDv7 / ULID** como forma
> del identificador de evento. Queda anulado por dos motivos independientes, y el segundo es
> jurídico, no técnico:
>
> 1. **Técnico.** Todo identificador del ledger es de 128 bits en **32 hex minúsculas**
>    (`10-ledger-inmutable.md` §1.1-bis). Ni `uuid` ni ULID sirven: PostgreSQL reescribe la forma del
>    primero al devolverlo (36 caracteres con guiones), lo que cambia la preimagen del `eventHash` al
>    rehidratar el evento y produce un falso positivo de «historia alterada». Es el error que la
>    propia spec 10 arrastraba y que la implementación destapó.
> 2. **De protección de datos.** **UUIDv7 y ULID incrustan la marca temporal de creación en el
>    identificador** (48 bits de milisegundos Unix, en los bits más significativos y por tanto
>    ordenables). Un identificador así **es** un dato de tiempo fino disfrazado de identificador
>    opaco, y hace inútil el requisito de la fila de arriba —truncar la marca temporal a la
>    granularidad mínima necesaria— porque la hora exacta viaja igualmente en el `id`. Con 300
>    personas eso reabre el vector 8 de la tabla anterior (cuasi-identificadores por fecha fina) y
>    contradice ADR-0014, que prohíbe marcas temporales en la urna precisamente por esto. El
>    identificador es **aleatorio de CSPRNG, sin componente temporal ni ordenable**.
>
> El mismo argumento (2) se aplica al principio 6 de §1.3, donde UUIDv7/ULID aparecen como forma de
> los identificadores de URL pública: para un recurso enumerable el requisito es «no adivinable», y
> un identificador con reloj dentro cumple lo de no-secuencial pero filtra el instante de creación.
> Úsese aleatorio de 128 bits ahí también.

---

## 8. Entregables

### 8.1 Matriz de requisitos legales

| ID | Norma y artículo | Requisito | Implementación técnica concreta | Prioridad | Estado |
|---|---|---|---|---|---|
| RL-01 | L.1581 art. 9 | Autorización previa, expresa e informada | Tabla `consent_record` append-only, una fila por finalidad, con `policy_hash` y `ui_snapshot_hash` | MVP | Pendiente |
| RL-02 | L.1581 art. 8 lit. b y art. 17 lit. c | Conservar y poder exhibir prueba de la autorización | Export firmado del `consent_record` desde el perfil | MVP | Pendiente |
| RL-03 | D.1377 art. 7 `VERIFICAR` | El silencio no es autorización | Checkboxes sin premarcar; estado tri-valuado | MVP | Pendiente |
| RL-04 | L.1581 art. 6 lit. a y parágrafo | Autorización explícita para sensibles; ninguna actividad condicionada a suministrarlos | Consentimiento separado por cada categoría sensible; campos nulables sin efecto en permisos | MVP | Pendiente |
| RL-05 | L.1581 art. 5 | Identificar los datos sensibles | Metadato `sensitivity` por columna en el esquema; test que falla si una columna sensible carece de cifrado | MVP | Pendiente |
| RL-06 | L.1581 art. 12 lit. b | Informar el carácter facultativo de responder sobre sensibles | Etiqueta visible "opcional" en cada campo sensible | MVP | Pendiente |
| RL-07 | L.1581 art. 14 | Responder consultas en 10 días hábiles (+5 de prórroga) | Cola `requests` con `due_at` sobre calendario de días hábiles CO; alertas 5/8/9 | MVP | Pendiente |
| RL-08 | L.1581 art. 15 | Responder reclamos en 15 días hábiles (+8) desde el día siguiente | Idem con offset +1; alertas 8/12/14 | MVP | Pendiente |
| RL-09 | L.1581 art. 15 num. 2 | Leyenda "reclamo en trámite" en la base de datos en ≤2 días hábiles | Flag `en_reclamo` en la fila del titular, visible en toda vista | MVP | Pendiente |
| RL-10 | L.1581 art. 15 num. 1 | Requerir subsanación en 5 días; desistimiento a los 2 meses | Dos temporizadores independientes en estado `pendiente_subsanacion` | Posterior | Pendiente |
| RL-11 | L.1581 art. 8 lit. f y D.1377 art. 21 `VERIFICAR` | Acceso gratuito | `GET /me/export` autoservicio, sin ticket | MVP | Pendiente |
| RL-12 | L.1581 art. 8 lit. a | Actualizar y rectificar | Autoservicio para datos declarativos; corrección con traza para derivados | MVP | Pendiente |
| RL-13 | L.1581 art. 8 lit. e + D.1377 art. 9 `VERIFICAR` | Supresión y revocación, con el límite del deber legal o contractual de permanencia | **`DELETE` físico de la fila del PII Vault + `VACUUM FULL`** (R3), destrucción de la DSK para cubrir backups y réplicas, y eventos `PIIErasureRequested` / `PIIErased` en el ledger. **R1/R2:** no hay «destrucción de sal» porque no hay derivación que destruir | MVP | Pendiente |
| RL-14 | L.1581 art. 16 | Requisito de procedibilidad: canal interno real | Canal público documentado + SLA medido + informe mensual de cumplimiento | MVP | Pendiente |
| RL-15 | L.1581 art. 4 lit. g y art. 17 lit. d | Seguridad | TLS 1.3, cifrado en reposo, KMS externo, MFA administrativo, backups cifrados con prueba de restauración | MVP | Pendiente |
| RL-16 | L.1581 art. 4 lit. h | Confidencialidad, incluso tras terminar la relación | NDA firmado por administradores; `access_log` append-only de accesos administrativos | MVP | Pendiente |
| RL-17 | L.1581 art. 4 lit. b | Finalidad | Enum cerrado de finalidades; metadato por campo; CI que falla ante campo sin finalidad | MVP | Pendiente |
| RL-18 | D.1377 arts. 26–27 `VERIFICAR` | Responsabilidad demostrada | Política versionada en Git con tag firmado; inventario de bases; registro de incidentes; acta de revisión semestral | Posterior | Pendiente |
| RL-19 | D.1377 art. 12 `VERIFICAR` | Aviso de privacidad con contenido mínimo | Componente reutilizable en todo punto de recolección; versionado | MVP | Pendiente |
| RL-20 | D.1377 art. 13 `VERIFICAR` | Política de Tratamiento con contenido mínimo | `docs/legal/politica-tratamiento.md`, SemVer, publicada en URL estable | MVP | Pendiente |
| RL-21 | L.1581 art. 26 y D.1377 art. 24–25 `VERIFICAR` | Transferencia/transmisión internacional | Preferir hosting en Colombia o país adecuado; contratos de transmisión con cada Encargado; informar país y proveedor por nombre | MVP | Pendiente |
| RL-22 | L.1581 art. 7 + C-748/2011 | Menores de edad | Verificación de mayoría de edad en registro; flujo restringido o exclusión documentada en MVP | MVP | Pendiente |
| RL-23 | L.1581 art. 25 + D.090/2018 `VERIFICAR` | RNBD | Evaluar según escenario de responsabilidad; documentar la conclusión y revisarla anualmente | Posterior | Pendiente |
| RL-24 | L.1581 art. 6 lit. e | Finalidad histórica con supresión de identidad | Separación estructural hecho/identidad; seudónimos por proceso | MVP | Pendiente |
| RL-25 | L.1581 art. 3 lit. c (definición de dato personal) | Que el titular no sea determinable en lo publicado | Umbral k para agregados; truncado temporal; regla del §7.5 aplicada en CI sobre el esquema del ledger | MVP | Pendiente |
| RL-26 | L.1581 art. 17 lit. k `VERIFICAR` | Informar a la SIC violaciones de seguridad | Runbook de incidentes con plazo y plantilla de notificación `VERIFICAR: plazo exigido por la SIC` | Posterior | Pendiente |

### 8.2 Borrador de Política de Tratamiento de Datos Personales

> **Versión 0.1 — BORRADOR, no publicar sin revisión de abogado.**
> Los campos entre `<>` deben completarse tras definir la estructura jurídica de la sección 5.

**1. Quiénes somos.** `<Nombre de la organización>`, `<NIT si aplica>`, con domicilio en Medellín, Antioquia, correo `<correo de contacto>`, teléfono `<teléfono>`. Somos el **Responsable** del tratamiento de tus datos en la plataforma Koinonía. **Koinonía no es un órgano oficial de la Universidad de Antioquia** ni actúa en su nombre.

**2. Qué datos tratamos.** Tu nombre, tu correo institucional, tu programa y semestre; el hecho de que participes en deliberaciones y las decisiones en que intervienes; las tareas que asumes; y —solo si tú decides dárnoslos— el contenido de tus intervenciones, tus objeciones firmadas, tus votos y tu pertenencia a colectivos estudiantiles.

**3. Datos sensibles.** Algunos de esos datos son **sensibles** según el art. 5 de la Ley 1581 de 2012, porque revelan tu orientación política o tu pertenencia a organizaciones sociales. **No estás obligado a dárnoslos.** Puedes registrarte y usar la plataforma sin entregar ni uno solo. Si decides hacerlo, te pediremos una autorización aparte, específica, que puedes revocar cuando quieras.

**4. Para qué los usamos.** Únicamente para: (a) verificar que eres estudiante del Instituto y que puedes participar; (b) organizar deliberaciones y decisiones colectivas; (c) llevar una memoria verificable de lo que se decidió; (d) coordinar tareas; (e) responderte cuando ejerzas tus derechos. **No los vendemos, no los cedemos a terceros y no hacemos publicidad con ellos.**

**5. Tus derechos.** Puedes conocer tus datos, actualizarlos, rectificarlos, pedirnos prueba de tu autorización, saber cómo los hemos usado, revocar tu autorización, pedir la supresión de tus datos, y quejarte ante la Superintendencia de Industria y Comercio. El acceso a tus datos es **gratuito**.

**6. Cómo ejerces tus derechos.** Escribiendo a `<correo de datos>` o desde la sección "Mis datos" de la plataforma. Responderemos tus **consultas en máximo 10 días hábiles**, prorrogables por 5 días hábiles más avisándote. Los **reclamos, en máximo 15 días hábiles** desde el día siguiente a que los recibamos, prorrogables por 8 días hábiles más avisándote. Responsable de atender tus solicitudes: `<persona o área>`.

**7. La memoria de las decisiones.** Koinonía guarda un registro encadenado que no se puede alterar ni reescribir. **En ese registro no guardamos tu nombre, ni tu correo, ni tu documento, ni el texto de lo que escribes — ni siquiera en forma de huella o código calculado a partir de ellos.** Lo que aparece es un código aleatorio que te asignamos al registrarte y que no se puede calcular a partir de ningún dato tuyo, más los datos de la decisión misma (qué se decidió, cuándo, con qué quórum). Cuando pides la supresión de tus datos, **borramos de verdad** —no ocultamos— la fila que traduce ese código a tu nombre; a partir de ahí el código no lleva a ninguna parte. En las copias de seguridad, donde no se puede borrar una fila suelta, destruimos la clave que las descifra y esas copias expiran en un plazo que te informamos. Lo que permanece es el hecho de que la comunidad tomó una decisión, sin ti dentro. Conservamos ese hecho por su **finalidad histórica**, amparados en el art. 6 lit. e de la Ley 1581 de 2012, que exige precisamente suprimir la identidad de los titulares en esos casos.

> **Corregido por resoluciones R1, R2 y R3 del arquitecto.** El texto anterior prometía que el registro guarda «huellas criptográficas con una sal secreta» y que la supresión consiste en «destruir la sal». Ambas cosas dejaron de ser ciertas y prometerlas sería engañoso: el ledger ya no contiene ninguna huella derivada de un dato personal (R1/R2), y la supresión se ejecuta como **borrado físico** en la bóveda (R3), no como destrucción de una sal.

**8. Voto secreto.** Cuando una votación es secreta, la plataforma está construida para que **nadie**, ni siquiera quien administra el servidor, pueda saber cómo votaste. Cuando una votación es nominal, te lo decimos **antes** de que votes y necesitamos tu autorización explícita.

**9. Seguridad.** Ciframos la información en tránsito y en reposo, restringimos el acceso a lo estrictamente necesario, exigimos doble factor a quienes administran, y registramos cada acceso administrativo a contenido tuyo.

**10. Dónde están tus datos.** `<País y proveedor de alojamiento>`. `VERIFICAR: completar tras decidir infraestructura; si está fuera de Colombia, este apartado debe informar el país y el proveedor por su nombre y recoger autorización expresa para la transferencia.`

**11. Menores de edad.** `<Completar: exclusión de menores en el MVP, o flujo con autorización del representante legal.>`

**12. Vigencia.** Esta política rige desde `<fecha>`. Las bases de datos se conservan mientras dure tu vinculación y por `<período>` después. Te avisaremos de cualquier cambio sustancial antes de que entre en vigor.

### 8.3 Borrador del texto de autorización en el registro

> **Antes de continuar, léelo. Está escrito para que se entienda.**
>
> Koinonía va a guardar datos tuyos. Aquí decides cuáles.
>
> **Lo necesario para que la plataforma funcione** (sin esto no podemos darte una cuenta):
>
> - ☐ Autorizo el tratamiento de mi **nombre, correo institucional, programa y semestre** para verificar que soy estudiante del Instituto de Filosofía y poder participar. He leído la [Política de Tratamiento](#).
>
> **Opcional — datos sensibles.** Estos revelan tu orientación política y por eso la ley los protege de forma especial (art. 5, Ley 1581 de 2012). **Puedes usar Koinonía sin marcar ninguna de estas casillas.** Puedes cambiar de opinión cuando quieras.
>
> - ☐ Autorizo que **el contenido de mis intervenciones** en deliberaciones quede asociado a mi nombre dentro de la comunidad.
> - ☐ Autorizo **firmar objeciones con mi nombre** y que esas objeciones sean visibles para los demás miembros.
> - ☐ Autorizo que **mis objeciones firmadas puedan hacerse públicas fuera de la comunidad** cuando así lo decida el colectivo.
> - ☐ Autorizo participar en **votaciones nominales** (aquellas en las que se sabe cómo votó cada quien). *Te avisaremos antes de cada votación nominal; una votación secreta nunca se volverá nominal después.*
> - ☐ Autorizo registrar **mi pertenencia a colectivos o movimientos estudiantiles**.
>
> **Opcional — otros:**
>
> - ☐ Autorizo recibir **avisos por correo** sobre deliberaciones abiertas y decisiones tomadas.
> - ☐ Autorizo que **mis evaluaciones de desempeño** en iniciativas colectivas se registren y sean visibles para `<órgano>`.
>
> **Qué pasa cuando pidas borrar tus datos:** **borramos tus datos personales de nuestra base de datos** —borrado real, no ocultamiento—, incluida la fila que traducía tu código a tu identidad. En las copias de seguridad, donde no se puede borrar un dato suelto, destruimos la clave que las descifra y te decimos la fecha exacta en que expira la última copia. Queda constancia de que la comunidad tomó ciertas decisiones, pero sin tu identidad. Esto es así porque el registro de decisiones no se puede reescribir; te lo decimos ahora, no después. *(Corregido por la resolución R3 del arquitecto: la versión anterior decía sólo «destruimos la clave», lo que habría hecho depender tu derecho de una interpretación jurídica que nadie ha confirmado en Colombia.)*
>
> Responderemos tus consultas en **10 días hábiles** y tus reclamos en **15 días hábiles**. Escríbenos a `<correo>`.

### 8.4 Preguntas abiertas para un abogado, priorizadas

**Prioridad 1 — bloquean decisiones de arquitectura del MVP:**

1. ¿La cláusula "no procederán cuando el titular tenga un deber legal o contractual de permanecer en la base de datos" (Decreto 1377) sirve para sostener la permanencia de registros de gobernanza cuando el deber nace de un **estatuto asociativo** aceptado por el titular? ¿Es "contractual" un estatuto de asociación voluntaria?
2. ¿La SIC ha aceptado alguna vez la **destrucción de la clave** como forma válida de supresión? ¿Hay concepto, resolución o precedente?
3. ¿La **seudonimización irreversible** satisface el art. 8 lit. e, o la SIC exigirá eliminación física del registro?
4. ¿Una **raíz Merkle** construida sobre compromisos salados publicada en un servicio externo es dato personal? Si no lo es, ¿confirma que su publicación no constituye transferencia internacional?
5. ¿El art. 6 lit. c (organismo sin ánimo de lucro de finalidad política/filosófica) ampara a una **asociación estudiantil** respecto de sus miembros? ¿Exige personería jurídica formal?

**Prioridad 2 — determinan la estructura jurídica:**

6. ¿Quién es Responsable si la plataforma usa el **correo institucional** de la UdeA para autenticar pero la UdeA no decide fines ni medios? ¿La verificación por dominio genera corresponsabilidad?
7. ¿Conviene constituir ESAL? ¿Qué protección real ofrece frente a las sanciones "de carácter personal" del art. 23?
8. ¿Aplica el RNBD? Confirmar umbral vigente y valor de la UVT del año.

**Prioridad 3 — operativas:**

9. ¿Qué plazo y qué canal exige la SIC para reportar una violación de seguridad de datos personales?
10. ¿Puede una votación nominal considerarse "dato hecho público por el titular" y quedar exenta de nuevas autorizaciones para su conservación?
11. Menores de edad: ¿es defensable excluirlos del registro, o eso vulnera su derecho de participación?
12. ¿Qué régimen aplica a los datos de un estudiante que se **retira** del Instituto? ¿Cesa la base del art. 6 lit. c al dejar de ser miembro?
13. Interacción con la **Ley 1712 de 2014**: si la UdeA se involucra, ¿parte del contenido pasa a ser información pública sujeta a acceso?

---

## Fuentes citadas y su estado de verificación

| Fuente | Uso | Estado |
|---|---|---|
| Constitución Política, arts. 15, 20 | Fundamento del hábeas data | Alta confianza |
| Ley 1581 de 2012, arts. 2–10, 12, 14–19, 23–27 | Núcleo del análisis | Alta confianza; **verificar literalidad** de arts. 6, 14, 15 y 23 contra el diario oficial |
| Decreto 1377 de 2013 | Autorización, aviso, política, transmisión, revocatoria | **Numeración de artículos por verificar** |
| Decreto 1074 de 2015 (DUR) | Norma compilada vigente | Correspondencia por verificar |
| Decreto 886 de 2014 y Decreto 090 de 2018 | RNBD y umbral 100.000 UVT | Vigencia por verificar |
| Ley 1266 de 2008, arts. 2–3 | Inaplicabilidad y tipología de datos | Literales por verificar |
| Ley 51 de 1983 | Días hábiles / festivos | Alta confianza en la regla, listado anual por verificar |
| Sentencia C-748 de 2011 | Control previo Ley 1581; menores | Apartados exactos por verificar |
| Sentencia T-729 de 2002 | Clasificación de datos | Alta confianza en la doctrina, cita textual por verificar |
| Circular Externa SIC sobre países con nivel adecuado | Elección de proveedor | **VERIFICAR CRÍTICO** |
| CNIL, blockchain y RGPD | Comparación europea | **VERIFICAR** título y contenido |
| AEPD–EDPS, hash como seudonimización | Comparación europea | **VERIFICAR** título y contenido |
| Dictamen 05/2014 GT29, anonimización | Comparación europea | **VERIFICAR** numeración |
