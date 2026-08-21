# Investigación 01 — Decidim, Loomio, Pol.is/vTaiwan

Criba: extraer **mecanismos**, no funcionalidades. Qué fallo real de una comunidad de ~300 estudiantes resuelve cada pieza, y qué parte es peso muerto heredado de otra escala (municipio de 1.6M, cooperativa de 20, Estado-nación). Unidad de análisis: padrón conocido y autenticado, asincronía obligatoria, sin presupuesto que repartir, rotación anual del cuerpo estudiantil.

---

## 1. Decidim

### Mecanismo

Decidim (Rails, Barcelona, 2016) separa dos planos ortogonales, y esa ortogonalidad es su aporte conceptual real.

**Espacios de participación**: contenedores con legitimidad y ciclo de vida propios. `ParticipatoryProcess` tiene `steps` ordenados (fases) de los cuales exactamente uno está activo, con fechas; `Assembly` es órgano permanente, jerárquico (asambleas hijas), con `AssemblyMember` que modela sillas, cargos y periodos; `Initiative` nace desde abajo, con tipo, umbral de firmas y máquina de estados propia (`created → validating → published → accepted | rejected`) más ventana temporal de recolección; existen además `Conference` y `Voting`. El espacio define *quién* participa, *bajo qué reglas* y *en qué fase*.

**Componentes**: funcionalidad enchufable en cualquier espacio — `Proposals`, `Meetings`, `Debates`, `Budgets`, `Accountability`, `Surveys`, `Sortitions`, `Blog`, `Pages`. Un componente es una instancia configurable (permisos, ventana de apertura, límites de voto, `settings` por paso) y **todo contenido cuelga de un componente, nunca del espacio**. Por eso "proceso de reforma del plan de estudios" y "asamblea permanente" reutilizan el mismo motor de propuestas con reglas distintas, y por eso una fase puede abrir `Debates` y cerrar `Proposals` sin tocar código.

La trazabilidad opera en dos capas, y es el punto que más se malinterpreta:

1. `Decidim::Traceability` sobre PaperTrail → versionado de recursos con *diff público* por versión (`/proposals/:id/versions`), autoría de cada cambio incluidas las acciones administrativas. `Decidim::ActionLog` publica el registro de actividad, incluida la de administración.
2. `Decidim::ResourceLink` → tabla polimórfica `(from_type, from_id, to_type, to_id, name, data)`. Es un **grafo genérico con arista nombrada**, no un FK ad hoc por cada par de entidades: `proposals_from_meeting`, `included_proposals`, `created_from_collaborative_draft`, `copied_from_component`. Se recorre en ambos sentidos: desde un resultado a las propuestas que lo originaron, desde una propuesta al encuentro donde surgió.

El cierre del ciclo ("accountability") es más simple de lo que sugiere el nombre. Cada `Proposal` tiene `state` (`evaluating | accepted | rejected | withdrawn`), `answer` (texto) y `answered_at`: la norma es que **ninguna propuesta quede sin respuesta escrita y fechada**, y el estado sin texto se considera inválido. Sobre eso, el componente `Accountability` define `Result` con `progress` (0–100), estado, fechas, jerarquía padre-hijo y `TimelineEntry` (fecha + descripción) como bitácora; el `Result` se liga por ResourceLink a las propuestas aceptadas. El porcentaje es lo accesorio; el mecanismo es **respuesta obligatoria + arista persistente propuesta→resultado**.

`Decidim::Amendable` completa el cuadro: una enmienda es una propuesta-emendante que apunta a la emendada, con ciclo propio y aceptación por la autoría original. Es control de versiones social.

### Adoptamos

- **Ortogonalidad Espacio × Componente**, con `Componente` como instancia configurable. Un Espacio "Asamblea del Instituto" y un Espacio "Proceso: reforma de electivas" montan el mismo motor con reglas distintas.
- **Fases con reglas por fase**: qué componentes están abiertos depende de la fase activa. Esto es lo que materializa el principio de separar deliberación / decisión / ejecución: no son etiquetas de UI, son ventanas de escritura.
- **`Vinculo` genérico con arista nombrada** (el ResourceLink) como entidad de primera clase desde el día uno. Es barato ahora e imposible de retrofitear después.
- **Respuesta oficial obligatoria y fechada** sobre toda propuesta publicada, con rol de quien responde. El estado sin texto no se puede persistir.
- **`Compromiso` (Result) con avance, jerarquía y bitácora**, ligado por vínculo a la propuesta de origen, con responsable nominal.
- **Versionado con diff público** de propuestas y actas, incluyendo actos administrativos en el mismo registro visible: el admin técnico no es soberano precisamente porque sus actos son eventos públicos.
- **Enmienda como objeto con ciclo propio**, no como edición del cuerpo.
- **Acta de encuentro como artefacto vinculable**: "propuestas surgidas de este encuentro" es una arista. Así la reunión presencial queda reducida a fuente de insumos trazables, no a sede del gobierno.

### Descartamos

- **Multi-tenancy (`Organization`)**: un solo Instituto. Contamina cada consulta y cada índice.
- **Verificación censal** (handlers de DNI, carta postal certificada, carga de padrón CSV, SMS): tenemos verificación por correo institucional sobre un padrón de 300 personas conocidas. Todo el subsistema desaparece.

  > **Corregido por ADR-0012:** aquí se leía «tenemos **SSO institucional**». No lo tenemos y no
  > vamos a pedirlo: integrarse con el directorio de la UdeA (LDAP/SSO/OAuth) exige autorización
  > formal y crea un vínculo técnico que puede argumentarse como corresponsabilidad de tratamiento
  > (`21-normativa-udea.md` §4.1). El MVP autentica con **enlace mágico al correo `@udea.edu.co`**
  > detrás de un puerto `IdentityProviderAdapter`. No se asumen APIs de la Universidad que no existen.
- **Presupuestos participativos** y **Votings con urna criptográfica (ElGamal / Bulletin Board)**: no repartimos dinero y no hay adversario con incentivo para atacar la integridad agregada a esta escala. El costo de operación criptográfica supera el riesgo.
- **`Conferences` y `Sortitions`** como espacios propios: casos de uso municipales.
- **Triple taxonomía `Scope` + `Area` + `Category`**: se colapsa a una taxonomía plana de ~8 términos compartida por todo el ciclo. Tres jerarquías paralelas son cura peor que la enfermedad.
- **`Endorsements` y `supports` con cupo por usuario**: concurso de popularidad que no distingue apoyo de urgencia ni detecta minorías. Se reemplaza por el sondeo de la §3.
- **Textos participativos** y **newsletter masivo**: versionado + enmienda alcanzan, y el correo masivo destruye la señal de notificación.
- **El monolito Rails**: adoptamos el modelo conceptual, no las ~100 tablas ni el acoplamiento.

### Implicación de modelo de datos

Entidades: `Espacio`(tipo `proceso|asamblea|iniciativa`, slug, reglas, estado) · `Fase`(espacio_id, orden, nombre, inicia_en, termina_en, activa) · `Componente`(espacio_id, tipo, ajustes jsonb, ventana_por_fase) · `Propuesta`(componente_id, autoria_id, cuerpo, estado, respuesta_texto, respondida_en, respuesta_rol, version_actual) · `VersionRecurso`(recurso_tipo, recurso_id, n, diff, autor_id, motivo) · `Vinculo`(origen_tipo, origen_id, destino_tipo, destino_id, nombre, datos) · `Enmienda`(emendada_id, emendante_id, estado) · `Compromiso`(responsable_id, avance, estado, inicia_en, vence_en, padre_id) · `EntradaBitacora`(compromiso_id, fecha, texto, evidencia_url) · `Acta`(encuentro_id, texto, asistentes[], publicada_en).

Eventos: `EspacioCreado` · `FaseActivada{fase_id, cierra_componentes[], abre_componentes[]}` · `ComponenteHabilitado{tipo, ajustes}` · `PropuestaPublicada` · `PropuestaVersionada{n, diff, motivo}` · `EnmiendaPropuesta` / `EnmiendaResuelta{decision}` · `PropuestaRespondida{estado, texto, rol_autor}` · `RecursoVinculado{origen, destino, nombre}` · `CompromisoCreado{propuesta_origen, responsable, vence_en}` · `AvanceRegistrado{pct, evidencia}` · `CompromisoCerrado{resultado}` · `ActaPublicada{encuentro_id, acuerdos[]}` · `ActoAdministrativoRegistrado{actor, accion, objetivo, motivo}`.

Invariante operativo: `PropuestaPublicada` sin `PropuestaRespondida` en N días emite `RespuestaVencida{dias}`. La *deuda de respuesta* es una métrica pública del órgano, no un recordatorio privado.

---

## 2. Loomio

### Mecanismo

Loomio separa **hilo** de **decisión**. El hilo es el expediente: tiene un `context` editable y versionado en la cabecera (el resumen vivo del asunto) y comentarios debajo. La decisión es un objeto discreto, con ciclo de vida propio, **incrustado en la línea de tiempo del hilo**. Se pueden correr varias decisiones secuenciales en un mismo hilo (v1, v2, v3) y la lectura del expediente muestra exactamente dónde se pasó de conversar a decidir.

La propuesta clásica ofrece cuatro posiciones: **acuerdo, abstención, desacuerdo, bloqueo**, cada una con una razón corta visible junto al nombre. El resultado no es un número sino una distribución con motivos legibles: se ve *quién* está incómodo y *por qué*. Se puede cambiar de posición hasta el cierre. Loomio amplió esto a una familia de instrumentos (consentimiento sociocrático, rangos, reparto de puntos, encuesta de tiempos), pero todos comparten el esqueleto: enunciado + convocados + plazo + posiciones + cierre + desenlace.

Tres piezas hacen el trabajo antipatológico:

1. **Plazo obligatorio con cierre automático.** Toda decisión nace con `closing_at`. El sistema envía recordatorios a quienes no se han pronunciado antes del vencimiento y cierra sola. La discusión interminable deja de ser el estado por defecto: el default pasa a ser *se cierra*.
2. **Ocultamiento opcional de resultados hasta el cierre.** Elimina el anclaje y el efecto arrastre: nadie vota mirando el marcador.
3. **Desenlace (`outcome`) obligatorio.** Al cerrar, una persona nombrada debe redactar qué se decidió y qué sigue, opcionalmente con fecha y responsables. Mientras no exista, Loomio marca la decisión como pendiente de desenlace y la exhibe así. El desenlace queda fijado en el hilo y listado en el índice de decisiones del grupo. **El desenlace, no el hilo, es la unidad de memoria.**

El cuarto elemento silencioso y crítico para asincronía: **volumen de notificación por hilo** (fuerte / normal / silencio) y el `context` versionado, que permiten llegar tarde sin leer 90 comentarios ni ahogarse en correo.

Fallos conocidos: el bloqueo es socialmente pesadísimo y, sin procedimiento, convierte a la minoría de uno en rehén; el hilo puede desbordarse igual; y no hay ninguna capa de evidencia ni ningún mapa de opinión — Loomio asume un grupo pequeño con confianza previa.

### Adoptamos

- **Cuatro posiciones cerradas y enumeradas**: `acuerdo | abstencion | desacuerdo | bloqueo`. La razón es opcional en acuerdo y **obligatoria** en desacuerdo y bloqueo. Voto y argumento son campos distintos: el conteo siempre es agregable.
- **Plazo obligatorio, recordatorio a indecisos y cierre automático.** La prórroga es un acto explícito, con motivo y autorización, y queda como evento.
- **Ocultar resultados hasta el cierre** por defecto en decisiones marcadas como sensibles.
- **Desenlace obligatorio con autoría nominal.** Una decisión sin desenlace no puede citarse como precedente y aparece en el panel público de deuda de cierre.
- **Bloqueo con procedimiento de salida acotado**: el bloqueo no vetó nada todavía; obliga a una ronda de enmienda con plazo. Si tras la ronda persiste, la decisión escala a la regla configurada (p. ej. mayoría cualificada de 2/3). Corrige el fallo del consenso puro sin eliminar el peso del bloqueo.
- **Contexto del hilo editable y versionado** como resumen vivo. Es la pieza más barata y de mayor impacto para asynchronous-first.
- **Volumen de notificación por hilo**, con silencio real.
- **Varias decisiones dentro de un mismo hilo**: el hilo es el expediente del asunto.
- **Regla de decisión como configuración, no como entidad**: `consenso | consentimiento | mayoria_simple | mayoria_cualificada | preferencial`. Un solo objeto `Decision` con `regla` y `umbral`.

### Descartamos

- **Bloqueo como veto absoluto e ilimitado.** Ver arriba: rehén de uno.
- **Abstención contando para quórum.** Solo `acuerdo | desacuerdo | bloqueo` suman `votos_emitidos`; la abstención se registra como presencia, no como participación decisoria.
- **Reacciones/emoji sobre comentarios con cualquier peso decisorio.** Pueden existir como señal social; jamás entran al conteo ni ordenan la deliberación.
- **Subgrupos con quórum propio.** Si aparece un subcuerpo, se modela como `Espacio` con sus reglas, no como jerarquía anidada dentro de un hilo.
- **El catálogo completo de instrumentos desde el arranque** (reparto de puntos, encuesta de tiempos, ranqueo). Son valores de `regla`, no entidades nuevas; se habilitan cuando haya demanda real.
- **Que cualquiera abra decisión formal en cualquier momento.** La decisión debe referenciar deliberación y evidencia previas; si no, es una encuesta, y las encuestas no producen desenlaces vinculantes.

### Implicación de modelo de datos

Entidades: `Hilo`(espacio_id, titulo, contexto_texto, contexto_version, estado) · `Decision`(hilo_id, enunciado, regla, umbral, quorum_min, abre_en, cierra_en, resultados_ocultos, estado) · `Postura`(decision_id, participante_id, posicion, razon, emitida_en, version) · `Objecion`(decision_id, participante_id, texto, estado, resuelta_en, resuelta_por) · `Desenlace`(decision_id, texto, redactado_por, redactado_en) · `Tarea`(desenlace_id, responsable_id, vence_en, estado) · `Recordatorio`(decision_id, participante_id, canal, enviado_en).

Estados de `Decision`: `borrador → abierta → pendiente_desenlace → cerrada_aceptada | cerrada_rechazada | cerrada_retirada`. La transición `abierta → pendiente_desenlace` la dispara el reloj; la salida de `pendiente_desenlace` exige `Desenlace` persistido.

Eventos: `DecisionAbierta{regla, umbral, quorum_min, cierra_en}` · `PosturaEmitida{posicion, razon}` · `PosturaRectificada{anterior, nueva}` · `ObjecionRegistrada` · `RondaDeEnmiendaAbierta{cierra_en}` · `ObjecionResuelta{como}` · `RecordatorioEnviado` · `PlazoProrrogado{nuevo_cierre, motivo, autorizado_por}` · `DecisionCerrada{motivo: plazo|quorum|retirada, conteo_congelado}` · `DesenlaceRedactado{texto, autor}` · `DesenlaceVencido{horas}` · `TareaAsignada` / `TareaCumplida`.

Dos invariantes: (a) `DecisionCerrada` **materializa el conteo** en el propio evento, de modo que una corrección posterior de datos no reescriba un resultado histórico; (b) `DecisionCerrada` sin `DesenlaceRedactado` en 72 h emite `DesenlaceVencido` y la decisión queda inutilizable como precedente hasta que se redacte.

---

## 3. Pol.is + vTaiwan

### Mecanismo

Pol.is invierte la forma del foro: **no se puede responder a un comentario**. Solo caben dos actos: proponer una afirmación corta, o votar una afirmación ajena con **acuerdo / desacuerdo / paso**. Sale una matriz esparsa `R ∈ {+1, 0, −1}^{n×m}` (participantes × afirmaciones) con **ausente ≠ paso**: el sistema registra qué se *mostró* a cada quien, así que "no lo vio" y "lo vio y pasó" son datos distintos. Confundirlos es el error más caro de la implementación.

**Esparsidad.** Densidad típica 5–20 %: nadie vota todo. Dos rutas. (a) *Imputación*: centrar por columna y rellenar ausentes con 0, que tras el centrado equivale a imputar la media de la afirmación; es lo que hace la implementación de referencia antes de la PCA por iteración de potencia, y sesga a quien votó poco hacia el centroide. Pol.is lo compensa proyectando solo sobre las afirmaciones efectivamente votadas y reescalando por `|C| / |C_p|` (afirmaciones totales sobre votadas), más un mínimo de ~7 votos para entrar al agrupamiento. (b) *Máscara*: la pérdida se evalúa únicamente sobre entradas observadas (PCA probabilística / ALS). Con `n≈300` y `m≈60–150` la matriz tiene ≤ 45k celdas: la vía enmascarada es trivialmente costeable y no introduce el sesgo de imputación. Es la que corresponde.

**Reducción de dimensionalidad.** Centrado por columna, dos componentes principales (iteración de potencia con deflación, o ALS de 2 factores con máscara). Coordenadas del participante `p`: `(x_p·v₁, x_p·v₂)`. El 2D es la vista pública. Advertencia no negociable: la varianza explicada suele quedar en 20–40 %; el mapa es heurístico de lectura, no verdad geométrica, y debe publicarse con su varianza explicada al lado.

**Agrupamiento.** Pol.is hace dos etapas: primero k-means con K≈100 *clusters base* sobre las coordenadas, solo para acotar costo a decenas de miles de participantes; luego k-means sobre los centroides base ponderados por tamaño, con `k ∈ {2,3,4,5}`, eligiendo el `k` que maximiza la silueta media `s(i) = (b(i) − a(i)) / max(a(i), b(i))`, donde `a(i)` es la distancia media intragrupo y `b(i)` la distancia media al grupo vecino más cercano. El rango es corto por legibilidad: seis facciones no son interpretables por nadie. Con 300 personas la etapa de clusters base sobra. Hace falta además histéresis (semilla fija por snapshot, y conservar el `k` anterior salvo mejora clara), porque un `k` que oscila entre corridas destruye la confianza en el mapa.

**Estadística por afirmación y grupo.** Para el grupo `g` y la afirmación `c`, con `n_v` votos emitidos por miembros de `g` sobre `c`, `n_a` acuerdos y `n_d` desacuerdos:

- Probabilidad suavizada (Laplace): `p̂_a(g,c) = (n_a + 1) / (n_v + 2)`; análogo `p̂_d`.
- Significancia contra el azar (`H₀: p = ½`, aproximación normal): `z₁ = 2·√n_v · (p̂ − 0.5)`.
- Representatividad frente al resto de la población: `R_a(g,c) = p̂_a(g,c) / p̂_a(¬g,c)`.
- Significancia de la diferencia (prueba z de dos proporciones con varianza agrupada `p̄`): `z₂ = (p̂₁ − p̂₂) / √( p̄(1−p̄)(1/n₁ + 1/n₂) )`, umbral unilateral al 90 %: `z > 1.2816`.
- `repness(g,c) = R_a(g,c) · p̂_a(g,c)`, filtrada por `z₂`, ordenada descendente: son las afirmaciones que *definen* al grupo. Sirven para etiquetarlo, nunca para decidir.

**Consenso informado por grupos (afirmaciones puente).** La fórmula operativa:

```
GIC(c) = ∏  p̂_a(g, c)          para g = 1..k
sujeto a:  z₁(g,c) > 1.2816  para TODO g
           c no moderada, tasa_paso(c) < 0.30
orden:     GIC descendente
```

con su gemela para el desacuerdo transversal usando `p̂_d`. El **producto** es el corazón del asunto y no es intercambiable por un promedio: es un AND blando, equivale a maximizar `Σ log p̂_a`, y basta que un grupo caiga a 0.15 para hundir el puntaje aunque los demás estén en 0.95 (`0.95·0.95·0.15 = 0.135`, contra un promedio de 0.68 que la aprobaría). Segunda propiedad, decisiva para nosotros: **es ciego al tamaño del grupo**. Un grupo de 18 personas pesa igual que uno de 180. Una mayoría simple sobre el total premia afirmaciones polarizantes cuando el bloque grande es suficientemente grande; el producto lo prohíbe por construcción. Es la formalización operativa de "no todo se resuelve por mayoría".

**Ruteo de afirmaciones.** No se muestran todas ni en orden fijo. La prioridad combina exploración (pocos votos → mostrar), explotación (extremidad de `p̂` y representatividad) y penalización por tasa de `paso` alta (afirmación mal redactada, ambigua o irrelevante). Sin ruteo, las primeras afirmaciones acaparan los votos y el mapa se congela en el sesgo del arranque. Con 300 personas y sesiones cortas (~15–20 votos por persona), el ruteo decide si la matriz es informativa o basura. Complemento obligatorio: **siembra** de 10–20 afirmaciones plurales; un sondeo sin semilla muere.

**El efecto de no poder responder.** El objeto de interacción es la población, no el autor: desaparece el hilo de dos que se pelea y arrastra a cuarenta. Frente a una afirmación que molesta solo caben dos movimientos: votarla en desacuerdo —acto privado en su forma individual, público solo agregado— o escribir otra afirmación que, para figurar, debe ganar acuerdo de gente que no piensa como uno. El gradiente de incentivos premia **reformular**, no atacar. Un ataque personal es, estructuralmente, una afirmación que solo aprueba el propio grupo: alto `repness` allí y **cero GIC**, así que no asciende. El troleo no se censura: se vuelve *irrelevante*, y la moderación deja de ser el único dique. Tampoco hay contador de respuestas ni notificación "te respondieron", lo que elimina el bucle de recompensa que sostiene la escalada. Es rasgo de diseño, no carencia: con respuestas, el voto mediría la posición de alguien *en el hilo* y no *en el tema*, y el agregado dejaría de ser interpretable. El costo es real: Pol.is no delibera, no admite refutación ni matiz ni evidencia. Produce un mapa. Por eso vTaiwan lo encadena.

**vTaiwan.** Cuatro fases: (1) *Propuesta*: se acota el asunto, se publica el material de base y —clave— la agencia se compromete *ex ante* a responder. (2) *Opinión*: Pol.is abierto 2–4 semanas; salida = mapa de grupos + lista ordenada por consenso informado por grupos; las afirmaciones divisivas se identifican y **se excluyen del temario**. (3) *Reflexión*: reunión presencial transmitida y facilitada, con partes interesadas y expertos; la agenda no la fija el convocante sino las afirmaciones de consenso, y se discute *cómo* implementar lo ya acordado. (4) *Legislación*: borrador normativo y respuesta punto por punto. El caso UberX (2015, ~4.500 participantes) produjo un puñado de puntos de consenso transversal que se volvieron las bases regulatorias; sobre ~26 casos, la mayoría terminó en acción de gobierno.

Lo trasplantable no es la herramienta sino el encadenamiento: compromiso previo de respuesta, consenso como **filtro de agenda** y no como decisión, exclusión deliberada de lo divisivo de la reunión presencial (la reunión no resuelve la polarización: opera lo acordado), y separación tajante entre mapa y texto normativo.

### Adoptamos

- **Módulo `Sondeo` como fase previa obligatoria** para asuntos calificados de controvertidos o con propuestas contradictorias en circulación. Su salida es agenda, no decisión.
- **Trinario acuerdo / desacuerdo / paso**, con `paso` como dato observado y `Exposicion` registrada aparte para distinguir "no lo vio".
- **Factorización enmascarada de 2 factores** (no imputación por la media), `k` por silueta en 2..5, con umbral de no-facción (silueta máx. < ~0.25 → "sin facciones claras", se publica solo el consenso).
- **GIC con producto de probabilidades Laplace + filtro `z₁` al 90 %**, tal cual la fórmula de arriba, más su gemela de desacuerdo transversal.
- **Ruteo con prioridad** y **siembra obligatoria** de 12 afirmaciones por quien convoca, con exigencia explícita de incluir al menos 3 contrarias a su propia posición.
- **Sin respuestas dentro del sondeo.** Afirmación ≤ 280 caracteres; el argumento largo va al módulo de deliberación (§2), que sí tiene hilo. La restricción es el mecanismo.
- **Snapshot inmutable y versionado** del cálculo, con método, semilla, hash de entrada y varianza explicada; la interfaz muestra "calculado a las HH:MM sobre N votos".
- **Etiqueta editorial humana** de cada grupo (jamás automática), publicada junto a las afirmaciones `repness` que la sustentan.
- **Encadenamiento vTaiwan**: `Sondeo → agenda congelada → deliberación (hilo) → propuesta → decisión`. El órgano convocante se compromete de antemano a responder punto por punto las top-N afirmaciones de consenso, y esa respuesta es un evento.

### Descartamos

- **Grupos con poder formal** (cuotas, veto, ponderación). El agrupamiento es descriptivo; darle poder convertiría opiniones circunstanciales en facciones permanentes y crearía el incentivo a agruparse estratégicamente.
- **Pol.is como decisor.** No hay ganador en un sondeo: hay agenda.
- **Clusters base de 100 y PCA en el navegador en tiempo real.** Ambos existen para escalas de 10⁴–10⁵ participantes. Cálculo en servidor, en cola, con caché.
- **`k > 5`** e **imputación por la media como método primario** (ver arriba).
- **Voto nominal público dentro del sondeo.** Autenticado y auditable sí; atribuible en público no. La atribución individual induce voto estratégico y destruye la señal, que es justamente lo que buscamos medir.
- **Tratar `paso` como dato faltante.** Es información: tasa de paso alta = afirmación mal formulada, y así se usa en el ruteo.

### Implicación de modelo de datos

Entidades: `Sondeo`(espacio_id, marco, estado `borrador|abierto|congelado|cerrado`, abre_en, cierra_en, min_votos_clustering=7, umbral_silueta=0.25) · `Afirmacion`(sondeo_id, autor_id, texto≤280, origen `semilla|participante`, estado_moderacion) · `Exposicion`(participante_id, afirmacion_id, mostrada_en) · `Voto`(afirmacion_id, participante_id, valor ∈ {+1,0,−1}, emitido_en, único por par) · `Snapshot`(sondeo_id, calculado_en, n, m, densidad, metodo, varianza_explicada[], k, silueta, semilla_prng, hash_entrada) · `Grupo`(snapshot_id, indice, tamaño, centroide[2], etiqueta_humana, etiquetado_por) · `PosicionParticipante`(snapshot_id, participante_id, x, y, grupo_id, n_votos) · `EstadisticaAfirmacion`(snapshot_id, afirmacion_id, grupo_id nullable, n_vistas, n_acuerdo, n_desacuerdo, n_paso, p_suavizada, z1, z2, representatividad, repness) · `PuntajeConsenso`(snapshot_id, afirmacion_id, gic, gic_desacuerdo, cumple_filtro, rango).

Eventos: `SondeoAbierto{marco, cierra_en, convocante}` · `AfirmacionSembrada` / `AfirmacionPropuesta` · `AfirmacionModerada{decision, moderador, motivo}` · `AfirmacionMostrada{participante, afirmacion}` (compactable) · `VotoEmitido{afirmacion, participante, valor}` · `VotoRectificado{anterior, nuevo}` · `MatematicaRecalculada{snapshot_id, metodo, k, silueta, varianza_explicada, hash_entrada}` · `FaccionesNoDetectadas{silueta_max}` — caso explícito, nunca ausencia de evento · `GrupoEtiquetado{grupo_id, etiqueta, autor}` · `AgendaDeConsensoCongelada{sondeo_id, snapshot_id, afirmaciones[]}` · `SondeoCerrado{motivo}` · `RespuestaDeOrganoRegistrada{afirmacion_id, texto, rol_autor}`.

Invariante que define la frontera: **los snapshots son derivados y reconstruibles** desde `VotoEmitido` + `AfirmacionModerada`; no son fuente de verdad y pueden recalcularse con otro método. `AgendaDeConsensoCongelada`, en cambio, **es un hecho político**: una vez emitida fija el temario aunque el snapshot que la produjo quede obsoleto. Esa asimetría —matemática recalculable, compromiso irrevocable— es lo que impide que quien administra el cálculo administre la política.
