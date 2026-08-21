# Investigación 02 — Sociocracia 3.0 y los principios de Ostrom

> **Estado:** investigación de diseño. Alimenta el modelo de dominio de `@koinonia/domain` y
> justifica lo ya congelado en `30-decision-engine-spec.md` (`sociocratic-consent`, admisibilidad
> de objeciones, `proposalVersionHash`). Donde discrepen, manda el 30; donde el 30 calle, manda
> este. **Fecha:** 2026-08-21 · **Zona:** `America/Bogota`.

---

# PARTE 1 — Sociocracia 3.0 y consentimiento

## 1.1 Consenso y consentimiento: la diferencia es operativa, no de tono

El consenso es una **función de acuerdo**: pregunta «¿es esta la mejor propuesta?» y termina cuando
todos prefieren activamente el resultado. El consentimiento es una **función de ausencia de daño**:
pregunta «¿es suficientemente buena por ahora y suficientemente segura para intentarla?» y termina
cuando nadie puede argumentar un perjuicio al objetivo del círculo. Son criterios de terminación
distintos, y de ahí sale todo lo demás.

| Dimensión | Consenso | Consentimiento |
|---|---|---|
| Condición de cierre | Todos prefieren | Nadie objeta con argumento |
| Objeto del juicio | La propuesta *óptima* | El *rango de lo tolerable* |
| Qué habilita el bloqueo | Preferencia | Daño alegado al objetivo del círculo |
| Costo de negociación | Diádico, ~O(n²) | Barrido, ~O(n) |
| Reversibilidad asumida | Baja (se busca acertar) | Alta (se acuerda con fecha de revisión) |
| Terminación garantizada | No | Sí (rondas acotadas, doc 30 B.3.c) |

El consenso no escala por tres razones concretas, no por falta de virtud: (a) el espacio de
bloqueo es ilimitado —cualquier preferencia sirve para no cerrar—, así que el costo esperado de
cierre crece con el número de participantes y con la varianza de gustos; (b) la convergencia de
preferencias en 300 personas con calendarios incompatibles solo se logra por desgaste, y el
desgaste **selecciona por disponibilidad horaria**, que en una facultad no es una distribución
neutral; (c) no tiene condición de parada, de modo que la única salida real es informal —el
facilitador declara consenso—, lo que concentra poder en un rol invisible.

El consentimiento escala porque acota lo que detiene la decisión a una clase verificable de
razones, porque el costo por participante adicional es una lectura y una papeleta, y porque asume
reversibilidad: se acuerda un experimento con fecha de revisión, no una verdad. Eso baja el umbral
de aceptación —consentir no es aprobar— y es lo que lo hace asincronizable.

## 1.2 Qué es una objeción válida

Una objeción es una **alegación argumentada de que la propuesta daña el objetivo (driver) del
círculo o su capacidad de cumplirlo**. No es un «no me gusta», ni una preferencia por otra opción,
ni una duda. Koinonía distingue tres actos con efecto distinto:

- `consent` — no veo daño; procedamos.
- `concern` — reserva registrada, **no bloquea**, queda en el acta y en la revisión del acuerdo.
- `object` — bloqueo, exige argumento y activa el procedimiento de admisibilidad.

### Criterios verificables de admisibilidad

El formulario de objeción obliga a responder tres preguntas (doc 30 §B.3) y el panel aplica cinco
tests, cada uno con verificación mecánica parcial en la interfaz:

1. **Test de anclaje.** `harmedAim` debe referenciar un objetivo **declarado** del círculo o un
   acuerdo vigente. La UI ofrece un desplegable con los objetivos y acuerdos del círculo; no admite
   texto libre en ese campo. *Verificable: el campo apunta a un ID existente.*
2. **Test de impersonalidad.** El daño debe seguir ocurriendo aunque quien objeta no participara.
   Pregunta literal en el formulario: «Si usted no estuviera en el círculo, ¿el daño ocurriría
   igual?». Un «no» honesto reclasifica la objeción como `concern`. *Verificable por lectura.*
3. **Test de contrafáctico.** La objeción describe un estado del mundo distinto y observable
   («nos quedamos sin sala los martes del próximo semestre»), no un juicio de valor («es
   improvisado»). *Verificable: existe un observable con sujeto, efecto y horizonte.*
4. **Test de enmienda.** Debe existir al menos una modificación imaginable que la disolvería. Si la
   respuesta a `proposedAmendment` es «nada; simplemente no debe hacerse», la objeción sigue siendo
   admisible pero se marca `irreducible` y activa directamente el escalamiento del doc 30 §B.3.d.
5. **Test de dominio.** El daño alegado cae dentro del dominio del círculo. Si cae fuera, la
   objeción no se desestima: se **reenvía** al círculo competente como driver nuevo.

### Quién califica y con qué garantías

Calificar objeciones es el poder más peligroso del sistema: quien decide qué disenso cuenta,
gobierna. Por eso el doc 30 §B.3.a lo resuelve así y este documento lo ratifica: **presunción de
validez** (toda objeción nace admitida), desestimación solo por **panel de 3 sorteados del propio
círculo** con la semilla pública, mayoría de 2/3, motivación escrita publicada, y **silencio
administrativo a favor del objetante** (vencido `panelDeadline` sin pronunciamiento, queda
admitida). Garantías adicionales:

- El facilitador **no** califica. Nunca. Su rol es procedimental.
- Exclusión del sorteo: quien objeta, quien propuso, y quien tenga vínculo declarado con ambos.
- Recusación: el objetante puede recusar a un panelista una vez, sin motivar.
- Apelación al círculo superior por la vía del doble vínculo (§1.4), no al administrador técnico.
- **Métrica anti-captura pública:** tasa de desestimación por círculo y período. Una tasa alta y
  sostenida es síntoma de captura del procedimiento, y dispara un driver de revisión del acuerdo
  que fija la admisibilidad.
- Anti-obstrucción: una objeción sustancialmente idéntica ya desestimada se marca `reiterada` y no
  reabre ronda; el tope duro de rondas (5) cierra el ciclo en todo caso.

## 1.3 El ciclo de rondas, asincronizado sin romperlo

La ronda presencial hace tres trabajos simultáneos que hay que reponer por separado en una web:
**iguala el turno de palabra**, **impide el anclaje** (nadie conoce la opinión ajena antes de
formar la propia en la primera vuelta) y **hace visible el agotamiento del tema**. Un foro con
plazo pierde los tres: habla quien más tiempo tiene, todos leen a los primeros antes de opinar, y
nada indica cuándo parar.

La traducción es **fase asíncrona con plazo, capacidades restringidas por fase, y revelación
diferida**:

| Fase | Plazo por defecto | Se puede | Está bloqueado | Avance |
|---|---|---|---|---|
| F0 · Driver | — | Describir situación, necesidad, evidencia | Proponer solución | Driver aceptado por el círculo |
| F1 · Presentación | 48 h | Leer, adjuntar contexto el proponente | Comentar, reaccionar, votar | Vence el plazo |
| F2 · Preguntas aclaratorias | 72 h | Preguntas **interrogativas**; el proponente responde | Argumentar a favor/en contra | Vence, o 24 h sin preguntas nuevas |
| F3 · Reacciones y perspectivas | 96 h | Emitir **una** perspectiva (≤1500 caracteres) | Ver las ajenas antes de emitir la propia | Vence, o `minEngagement` alcanzado |
| F4 · Enmienda | 72 h | Solo proponente + facilitador; produce `proposalVersionHash` nuevo | Emitir papeletas | Publicación de la versión enmendada |
| F5 · Ronda de consentimiento | 96 h | `consent` / `concern` / `object` | Editar la propuesta | Vence, o todos se manifestaron |
| F6 · Integración de objeciones | `panelDeadline` (120 h) | Panel; enmienda firmada por el objetante | Cerrar la decisión | `ObjectionIntegrated` o `ObjectionDismissed` |
| F7 · Nueva ronda o cierre | — | `RoundOpened(r+1)` si `r < maxRounds` | — | Cierre y escrutinio |

Reglas transversales de asincronía, todas de dominio (no de interfaz):

- **Revelación diferida en F3.** Nadie ve las perspectivas ajenas hasta haber emitido la propia o
  hasta que vence el plazo. Esta es la pieza que replica la primera vuelta de la ronda y corta la
  cascada informacional; sin ella, la asincronía degenera en «los tres primeros fijan el marco».
  Es también el mecanismo de la nominación (§1.5).
- **El silencio no consiente** (doc 30 §B.3.e). Por eso existe `minEngagement` (½ del círculo).
- **Turno igualitario por presupuesto de intervención.** Una perspectiva por persona en F3, con
  tope de caracteres. Réplicas ilimitadas reproducen la asimetría de tiempo libre.
- **Consentir es consentir *ese* texto.** Toda papeleta lleva `proposalVersionHash`; una enmienda
  invalida las papeletas de la versión anterior y notifica para revotar (doc 30 §A.6).
- **Calendario académico.** Los plazos se suspenden en parciales y receso, no vencen en fin de
  semana ni festivo, y cierran 23:59 Bogotá. Un plazo que vence el sábado de parciales es una
  exclusión silenciosa.
- **Recordatorio y prórroga.** Aviso 24 h antes y prórroga automática única si `minEngagement`
  sigue bajo el umbral (doc 30 `WindowExtended`).

## 1.4 Círculos, dominios y delegación de autoridad

Un **círculo** es la tupla `(driver, dominio, miembros, acuerdos)`. El **dominio** es la lista
explícita de materias sobre las que decide **sin consultar**, más sus límites (techo presupuestal,
horizonte, población afectada). El dominio delegado se **sustrae** del delegante, no se duplica: si
el padre delega «programación del coloquio», deja de decidirlo. Duplicarlo produce doble
jurisdicción y conflictos irresolubles.

Toda propuesta se enruta por dominio; si toca dos, sube al ancestro común o se crea un círculo
conjunto ad hoc con fecha de disolución. **Subsidiariedad** dura: decide el círculo más pequeño
cuyo dominio contenga la materia.

El **doble vínculo** consiste en que dos personas —una elegida por el círculo hacia arriba, otra
designada por el círculo superior hacia abajo— participan **con plena capacidad de objetar en
ambos círculos**. Para qué sirve realmente, más allá del diagrama: (i) impide que la información
suba filtrada por una sola persona, que es el modo estándar de captura jerárquica; (ii) convierte
la voz del círculo inferior en **poder de bloqueo** dentro del superior, no en «derecho a ser
escuchado»; (iii) sustituye la relación de reporte por membresía recíproca; (iv) hace operativo el
principio 8 de Ostrom. Costo: dos personas por enlace —con 8–12 círculos, ~20 roles—, con tope de
**dos enlaces simultáneos por persona** para que la red no se concentre en los mismos cinco
nombres.

Entidades: `Circle(id, parentId, driverId, aims[])`, `Domain(circleId, matters[], limits)`,
`CircleMembership(circleId, memberId, from, until)`, `LinkRole(circleId, peerCircleId, memberId,
direction, termEndsAt)`. Eventos: `CircleFormed`, `DomainDelegated`, `DomainRevoked`,
`LinkAppointed`, `CircleDissolved`.

## 1.5 Elección sin candidatos

La autopostulación selecciona por confianza en uno mismo —que correlaciona con género, clase y
antigüedad, no con idoneidad—. El procedimiento sociocrático invierte la carga: **nominan los
pares, con argumento**. Algoritmo asíncrono:

1. **Definición del rol antes de cualquier nombre:** driver, dominio, entregables, dedicación
   estimada en horas/semana, duración del mandato y **criterios de evaluación** del desempeño.
   Sin este paso, la nominación mide simpatía.
2. **Ronda de nominación con revelación diferida (72 h).** Cada miembro nomina a una persona
   —puede ser a sí mismo— con argumento obligatorio referido explícitamente a los criterios del
   paso 1. Nadie ve nominaciones ajenas.
3. **Publicación simultánea** de todas las nominaciones con sus argumentos.
4. **Ronda de cambio (48 h).** Cualquiera puede cambiar su nominación habiendo leído los argumentos
   ajenos. Esta ronda es la que hace el trabajo: convierte un conteo de popularidad en un juicio
   informado.
5. **Propuesta motivada del facilitador.** No es aritmética: propone **un** nombre citando los
   argumentos que lo sostienen frente a los criterios; el conteo es insumo visible, no regla. Una
   elección por mayoría oculta bajo apariencia de sociocracia es peor que una declarada.
6. **Ronda de objeciones sobre el ajuste rol–persona**, no sobre la persona. Mismo procedimiento de
   admisibilidad de §1.2.
7. Si hay objeción admitida, se propone otro nombre **del conjunto ya nominado**, hasta tres
   intentos; agotados, el rol se declara desierto y vuelve como driver.
8. **Consentimiento final** y registro con `termEndsAt` obligatorio.

Garantías: la persona nominada puede **declinar en cualquier punto sin justificar** y declinar no
deja rastro evaluativo; quien facilita no puede resultar elegido en ese proceso; tope de roles
simultáneos por persona; historial de roles públicos consultable. Entidades: `Role`,
`Nomination(roleId, byMemberId, forMemberId, argument)`, `RoleTerm`. Eventos:
`RoleDefined`, `NominationSubmitted`, `NominationsRevealed`, `RoleProposed`, `RoleConsented`,
`RoleDeclined`, `TermExpired`.

## 1.6 Acuerdos con fecha de revisión obligatoria

Un **acuerdo** (`Agreement`) no es una decisión: la decisión es el acto puntual; el acuerdo es la
norma que queda vigente. Koinonía los separa como entidades porque tienen ciclos de vida distintos.

Campos obligatorios, validados en el dominio y no en el formulario:

```ts
interface Agreement {
  agreementId: AgreementId;
  driverId: DriverId;              // el motivo que lo originó
  decisionId: DecisionId;          // el acto que lo creó
  circleId: CircleId;              // quién lo puede revisar
  ownerId: MemberId;               // quién convoca la revisión
  reviewAt: Instant;               // NOT NULL. Sin esto no hay ratificación.
  evaluationCriteria: readonly {   // ≥1. Definidos ANTES de acordar.
    observable: string;            // qué se mira
    source: string;                // de dónde sale el dato
    successIf: string;             // umbral acordado de antemano
  }[];
  status: 'vigente' | 'en-revision' | 'enmendado' | 'derogado' | 'caducado';
}
```

> **Regla dura:** una decisión que crea un acuerdo **no puede pasar a `Ratified`** si
> `reviewAt` está vacío o si `evaluationCriteria` está vacío. Es una invariante del motor, no una
> validación de interfaz.

Por qué esta es la pieza que evita el cementerio de acuerdos: (a) convierte el corpus normativo en
un conjunto con caducidad —sin renovación explícita el acuerdo pasa a `caducado`, de modo que la
inercia trabaja a favor de la limpieza y no de la acumulación; (b) los criterios fijados **antes**
eliminan la evaluación retrospectiva sesgada, que es el modo normal en que un acuerdo fracasado se
declara exitoso; (c) baja el costo político de derogar: revisar es rutina calendarizada, no un
ataque a quien lo propuso; (d) hace honesto el «suficientemente seguro para intentar»: solo es
honesto si hay una fecha comprometida para mirar el resultado.

Cadencias por defecto: operativo, un semestre; procedimental, un año; constitutivo, dos años con
revisión intermedia. Toda revisión produce evento —`AgreementKept`, `AgreementAmended`,
`AgreementRepealed`, `AgreementEscalated`— y **mantener también exige evidencia** contra los
criterios. Métrica de salud: deuda normativa (acuerdos vencidos sin revisar), atribuida al círculo,
nunca a una persona.

## 1.7 El driver: la propuesta no es el principio

La sociocracia no parte de una propuesta suelta sino de un **driver**: la descripción de una
situación y de la necesidad organizacional que genera. Estructura mínima: situación observada (con
evidencia), a quiénes afecta y cómo, necesidad que exige respuesta, y dominio al que corresponde.

Importa porque el driver ancla todo lo demás: el consentimiento evalúa el ajuste
**propuesta ↔ driver**; la objeción alega daño **al driver**; la revisión del acuerdo se evalúa
contra el driver original. Sin driver no hay criterio para juzgar nada y la deliberación es un
concurso de soluciones sin problema. En el ciclo de Koinonía, el «problema» inicial **es** el
driver y la «evidencia» son sus adjuntos.

Reglas: toda `Proposal` cuelga de un `Driver` (FK obligatoria); un driver admite varias propuestas
en competencia; **modificar el driver invalida el consentimiento** igual que modificar el texto, y
por el mismo mecanismo de versión hasheada. Entidad: `Driver(id, circleId, situation, affected,
need, evidence[], status)`. Eventos: `DriverStated`, `DriverAccepted`, `DriverAmended`,
`DriverClosed`.

---

# PARTE 2 — Los ocho principios de Ostrom como requisitos de software

Ostrom derivó estos principios del metaanálisis de instituciones de recurso común duraderas. El
traslado exige nombrar el recurso: aquí no es un pastizal, son cuatro bienes rivales y agotables:
**la atención colectiva**, **la capacidad de decidir** (que se degrada por saturación y por
captura), **los bienes materiales del Instituto** y **la memoria y la legitimidad**. La
sobreexplotación se observa como saturación del canal, decisiones tomadas por cinco personas a
nombre de trescientas, y tareas comprometidas que nadie ejecuta.

## Principio 1 — Límites claros

**Qué significa aquí.** Debe ser inequívoco y verificable quién es miembro, con qué vigencia, y
sobre qué recurso tiene derecho de uso y de decisión.

**Requisito de software.** Padrón congelado por decisión (`Electorate`, doc 30 §A.2) con `criterion`
en castellano común, `frozenAt` y `rollHash` publicados al abrir. Cuatro estatus disjuntos:
**miembro** (delibera y decide), **participante de círculo** (decide en ese dominio), **invitado**
(delibera, no decide) y **observador** (solo lectura). `MemberId` seudónimo estable **aleatorio de
128 bits**, para que el padrón sea publicable sin violar la Ley 1581.

> **Corregido por resolución R1 del arquitecto:** aquí se leía «`MemberId` seudónimo estable
> **derivado del registro institucional**». El `MemberId` es estable pero **no derivado**: es un
> valor aleatorio de 128 bits (CSPRNG) sin relación calculable con el documento, el correo ni
> ningún dato personal. Un identificador derivado haría que la publicación del padrón fuese
> re-identificable por quien posea el dato de origen. Ver `docs/adr/0006-memberid-aleatorio-de-128-bits.md`.

**Pantalla.** «Quiénes pueden decidir aquí»: censo, criterio, fecha de congelación, huella
verificable, y la lista seudónima descargable.

**Entidad/evento.** `Electorate`, `CircleMembership` · `DecisionOpened`, `MembershipGranted`,
`MembershipExpired`.

## Principio 2 — Congruencia con las condiciones locales

**Qué significa aquí.** Las reglas de aporte y de uso deben ser proporcionales a la realidad de un
estudiante de filosofía: semestres, parciales, matrícula variable, cero remuneración.

**Requisito de software.** Un `AcademicCalendar` de primera clase del que **dependen todos los
plazos** (§1.3). Capacidad de aporte declarada por cada miembro (`contributionCapacity`,
horas/semana) que **limita** la asignación: el sistema rechaza asignar por encima de lo declarado.
Selección de método guiada por una matriz reversibilidad × costo y no por preferencia del
proponente: reversible y barato → consentimiento de círculo; irreversible o costoso →
supermayoría con quórum.

**Regla.** Ninguna constante temporal en el código: todo plazo se resuelve contra el calendario.

**Entidad/evento.** `AcademicCalendar`, `DeadlinePolicy`, `ContributionCapacity` ·
`CalendarPeriodDeclared`, `DeadlineShifted`.

## Principio 3 — Arreglos de elección colectiva

**Qué significa aquí.** Quienes viven bajo las reglas del sistema deben poder cambiarlas **dentro
del sistema**, sin pasar por el administrador técnico.

**Requisito de software.** Meta-gobernanza reificada: los parámetros de gobierno (método por
defecto, umbrales, quórum, plazos, `maxRounds`, composición del panel) **no son constantes ni
opciones de un panel de admin**: son `Agreement` de tipo `constitutivo`, y toda `DecisionConfig` se
deriva del acuerdo vigente. Cambiarlos exige decisión con `base:'census'` y 2/3 (doc 30 §B.2.a). El
administrador técnico no puede escribir estos valores.

**Pantalla.** «Reglas vigentes»: cada regla con enlace a la decisión que la creó, a su driver y a
su fecha de revisión, y botón «proponer cambio» que abre un driver.

**Entidad/evento.** `Agreement(kind:'constitutivo')`, `RuleBinding` · `RuleChangeProposed`,
`RuleChanged`.

## Principio 4 — Monitoreo por los propios miembros

**Qué significa aquí.** Monitoreo del **cumplimiento de acuerdos y del estado del recurso**, hecho
por miembros que rinden cuentas al círculo. No es vigilancia de personas.

**Requisito de software.** (a) Log encadenado consultable por cualquier miembro, con `Proof`
legible y verificador independiente que recomputa el resultado desde los eventos (doc 30 §A.6/A.8);
(b) rol de monitoreo **sorteado y rotatorio**, con mandato acotado, que reporta al círculo y no al
administrador; (c) `AccountabilityUpdate` obligatorio con la periodicidad declarada en la
iniciativa (doc 01), sin el cual esta no avanza de estado; (d) tableros agregados por círculo.

**Prohibición explícita.** No se recolectan métricas de actividad individual (mensajes, sesiones,
tiempo en línea) ni se exponen. Monitorear el recurso no es monitorear personas.

**Entidad/evento.** `MonitorRole`, `AccountabilityUpdate`, `AuditRun` · `MonitorAppointed`,
`ProgressReported`, `AuditMismatchDetected`.

## Principio 5 — Sanciones graduadas, sin gamificación tóxica

**Qué significa aquí.** El incumplimiento de una tarea comprometida es el fallo más frecuente y el
más corrosivo para la confianza. La respuesta debe ser **gradual, proporcional, reversible y
orientada a recuperar el trabajo**, no a castigar. Supuesto de diseño: la mayoría de los
incumplimientos son sobrecarga o bloqueo, no mala fe.

**Requisito de software: escalera de siete escalones.**

| # | Estado | Disparador | Acción del sistema | Visibilidad |
|---|---|---|---|---|
| 0 | `por-vencer` | 48 h antes | Recordatorio privado. **No es sanción** | Solo la persona |
| 1 | `atrasada` | Vencido el plazo | Marca en la tarea, no en la persona | Persona + responsable del círculo |
| 2 | `consultada` | 72 h de atraso | Pregunta, no reproche: «sigo» / «necesito ayuda» / «no puedo» | Persona |
| 3 | `bloqueada` | La persona declara bloqueo | **El reloj se detiene**; se registra la causa como driver | Círculo (la causa, no la persona) |
| 4 | `en-apoyo` | Solicitud de ayuda | Convocatoria abierta; ofrecerse queda registrado como aporte | Círculo |
| 5 | `reasignada` | Sin avance tras apoyo, o «no puedo» | Devolución **sin culpa** al círculo; se registra en el círculo | Círculo |
| 6 | `en-revision-colectiva` | ≥3 reasignaciones del mismo compromiso, o patrón en el círculo | Se abre driver. **El objeto es el acuerdo o la carga, no la persona** | Círculo |
| 7 | `dominio-suspendido` | Excepcional | Retiro temporal del rol, **nunca automático**: exige consentimiento del círculo y es apelable | Público motivado |

**Reglas que impiden la deriva punitiva —todas de dominio:**

1. **Prohibido el ranking interpersonal de cumplimiento.** No existe endpoint que ordene miembros
   por tareas cumplidas. Es una restricción del modelo, no una decisión de UI.
2. **Sin puntos, insignias, rachas ni niveles.** La motivación extrínseca desplaza la intrínseca y
   convierte el compromiso político en desempeño performativo.
3. **Las métricas de cumplimiento son del círculo y del tipo de tarea.** La serie individual solo
   la ve la propia persona y su vínculo, y solo para ofrecer apoyo.
4. **Declarar bloqueo o pedir ayuda detiene el reloj.** El incentivo debe apuntar a avisar
   temprano; si avisar castiga, nadie avisa y el sistema se entera tarde.
5. **Prescripción.** Los atrasos caducan a los dos semestres y dejan de computar.
6. **Proporcionalidad.** La severidad depende de la criticidad de la tarea y de la reincidencia
   dentro de la ventana, jamás del prestigio académico de las partes.
7. **El derecho de voz es inderogable.** Ninguna sanción, en ningún escalón, puede quitar a alguien
   la capacidad de deliberar, objetar o votar. La sanción máxima es perder un dominio, no la
   ciudadanía.

**Entidad/evento.** `Commitment(initiativeId, memberId, dueAt, state)`, `Blocker`, `SupportOffer`
· `CommitmentOverdue`, `BlockerDeclared`, `HelpRequested`, `HelpOffered`, `CommitmentReassigned`,
`CollectiveReviewOpened`, `DomainSuspended`.

## Principio 6 — Resolución de conflictos rápida y barata

**Qué significa aquí.** El conflicto interpersonal es inevitable; lo que mata a la organización es
que **cueste caro** resolverlo (tiempo, exposición pública, riesgo de perder la relación). La arena
debe ser más barata que dejar el conflicto podrirse o que irse.

**Requisito de software: cuatro niveles con escalamiento por vencimiento.**

- **N0 · Aclaración asistida** (48 h, privada, sin registro público): plantilla estructurada
  —hecho observado, efecto en mí, petición concreta—. Se cierra con «resuelto» de ambas o escala.
- **N1 · Mediación por par** (5 días hábiles): mediador sorteado de una lista de voluntarios
  formados, recusable una vez sin motivar. Resultado: acuerdo privado registrado como hash sin
  contenido, o escalamiento.
- **N2 · Panel de tres sorteados** del círculo —mismo mecanismo que la admisibilidad de
  objeciones—: decisión motivada, publicada **anonimizada**, apelable una vez.
- **N3 · Círculo de garantías**: elegido sin candidatos, mandato de un año, no acumulable con otros
  roles, última instancia interna. Es el cuerpo que firma anulaciones de decisión (doc 30).

**Garantías.** Plazos máximos con regla «silencio ⇒ escalamiento automático»; nada exige
presencialidad; el conflicto **no bloquea** el trabajo sustantivo del círculo; las *ratio
decidendi* anonimizadas forman un corpus consultable que abarata el caso siguiente. Métrica
objetivo: mediana de resolución bajo diez días hábiles en N0–N2.

**Entidad/evento.** `Dispute`, `DisputeStage`, `Ruling` · `DisputeRaised`, `MediatorAssigned`,
`MediatorRecused`, `RulingIssued`, `DisputeEscalated`, `DisputeClosed`.

## Principio 7 — Reconocimiento mínimo del derecho a auto-organizarse

**Qué significa aquí.** Frente a la Universidad: que la instancia externa no anule de facto las
decisiones internas, y que la plataforma no dependa de su permiso para existir. Frente a nosotros
mismos: que el administrador técnico no sea soberano político.

**Requisito de software.** (a) Campo `institutionalStatus` en `Agreement`
—`interno` | `requiere_aval` | `avalado` | `objetado_por_instancia`— que **separa** lo decidido por
autonomía de lo que requiere refrendo, y registra la respuesta institucional con motivación y
fecha; la ausencia de respuesta en plazo se registra como tal y es dato público. (b) **Soberanía de
datos**: exportación completa y verificable (eventos + adjuntos) en formato abierto por cualquier
miembro, y auto-hospedaje; una comunidad que no puede llevarse su historia no es autónoma.
(c) **El admin técnico carece de dominio político**: no puede
crear miembros, alterar padrones, cerrar decisiones ni tocar resultados; toda acción administrativa
queda en el log público con actor identificado; la alteración de un resultado es criptográficamente
detectable y dispara anulación automática (doc 30 §A.8).

**Entidad/evento.** `InstitutionalReferral`, `ExportManifest`, `AdminAction` ·
`ReferralSubmitted`, `ReferralAnswered`, `ExportGenerated`, `AdminActionLogged`.

## Principio 8 — Empresas anidadas (gobernanza policéntrica)

**Qué significa aquí.** Trescientas personas no deliberan como un cuerpo único: lo hacen en
círculos con dominio propio, anidados y conectados por doble vínculo.

**Requisito de software.** Jerarquía con `parentId` y **subsidiariedad ejecutable**: el enrutador
resuelve el círculo competente a partir del dominio y **rechaza** abrir la decisión en un círculo
incompetente, proponiendo el correcto. Propagación acotada: un acuerdo del padre vincula al hijo
solo si la materia cae en el dominio del padre, y el hijo objeta **dentro** del padre vía su
vínculo. Colisión de dominios: se abre driver en el ancestro común, que asigna la materia y lo
registra como acuerdo con fecha de revisión. El modelo no asume un único cuerpo raíz, de modo que
la federación con otros estamentos no exija rediseño.

**Pantalla.** Mapa de círculos: dominio, vínculos, acuerdos vigentes y deuda normativa de cada uno.

**Entidad/evento.** `Circle(parentId)`, `Domain`, `LinkRole`, `DomainConflict` ·
`DomainDelegated`, `DomainConflictRaised`, `DomainReassigned`.

---

## Cierre

Las tres piezas que este documento agrega al doc 30 son: el **driver** como raíz obligatoria de
toda propuesta, el **acuerdo con fecha de revisión y criterios previos** como entidad separada de
la decisión, y la **escalera de incumplimiento sin gamificación**. Las tres son requisitos de
dominio: implementadas como validación de formulario, se pierden en el primer refactor.

Queda abierto: la definición operativa de «materia» dentro de un dominio (hoy texto libre, debería
ser taxonomía cerrada compartida con la del doc 01) y el protocolo de federación del principio 8.
