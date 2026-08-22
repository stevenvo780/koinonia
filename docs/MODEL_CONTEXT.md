# Contexto para agentes — qué recibe quien recibe una tarea

> **Estado:** normativo para toda delegación en este repositorio, sea a una persona o a un agente.
> **Fecha:** 2026-08-21 · Complementa `docs/TESTING.md`.

Fija dos cosas: **qué contexto mínimo recibe un agente** al que se le delega una tarea, y **el registro
de lo que pasó cuando se delegó** — que no es historia, sino la base para decidir a quién se le da qué.

## 1. El contexto mínimo

Toda delegación lleva **siete campos**. Si falta uno, la tarea no está lista; no se manda «a ver qué
sale».

1. **Objetivo**, en términos de comportamiento observable. No «mejorar el escrutador», sino
   «implementar `tallyMajorityJudgment` de modo que, dado un perfil de menciones, devuelva la mención
   mayoritaria por opción y el desempate de B.7».
2. **Archivos relevantes.** Lista **cerrada** de qué leer y qué se puede escribir, con rutas exactas.
   Si el agente necesita uno que no está en la lista, el recorte estaba mal: se para y se corrige el
   recorte, no se amplía por cuenta propia.
3. **Contratos.** Firmas y tipos a respetar, **copiados literalmente**: qué recibe, qué devuelve, qué
   lanza, qué exporta el `index.ts`. Se citan; no se describen de memoria.
4. **Restricciones** de ese punto del árbol —en `domain` y `crypto`: sin I/O, sin `Date.now()`, sin
   `Math.random()`, sin `localeCompare`, sin módulos de Node, sin dependencias nuevas— y **quién las
   verifica** (`scripts/check-domain-purity.mjs`, ESLint, `tsc`), para que el agente pueda comprobarse.
5. **ADR aplicables**, por número y título, sólo los que aplican. Un ADR no se reabre: si el agente
   cree que está mal, **lo reporta**; no lo ignora.
6. **Tests relacionados.** Qué suites existen, cuáles siguen en verde, cuáles hay que escribir. Si la
   tarea toca un invariante de la PARTE E, se cita su `INV-NN` textual.
7. **Criterio de aceptación**, binario y en comandos: `pnpm run verify` en verde, cobertura sobre el
   umbral del paquete (`TESTING.md` §3), invariantes nuevos pasando, y documento actualizado si cambió
   un contrato.

Cuando aplica se añade un octavo: **qué NO hay que hacer** (no refactorizar de paso, no renombrar, no
tocar `crypto`). Evita la mayoría de los diffs sorpresa.

## 2. No se manda el repositorio entero

Ni el `docs/` completo, ni «todo `packages/`». El contexto se recorta a los siete campos. Tres
razones, y ninguna es el coste:

- **El contexto irrelevante compite con el relevante.** Quien recibe 40 000 líneas aplica la regla que
  recuerda, no la que manda. Existe una **tabla de precedencia normativa**
  (`00-contradicciones-resueltas.md`) precisamente porque los documentos se contradicen: mandar el
  corpus entero es mandar todas las versiones de una regla a la vez.
- **Sin recorte no hay responsabilidad sobre el recorte.** Quien decide qué cinco documentos aplican
  descubre las contradicciones **antes** de delegar; buena parte de C4–C20 apareció así.
- **Lo que no se recorta no se revisa.** Un diff de tres ficheros se lee entero; uno de treinta, no.

La contrapartida se asume: **un recorte mal hecho produce trabajo mal hecho, y la culpa es de quien
recortó** — por eso la regla 2 obliga a parar y avisar en vez de ampliar.

## 3. Registro de delegaciones

| TAREA | TIPO | MODELO | RESULTADO | HALLAZGOS |
|---|---|---|---|---|
| Corpus de investigación (docs 01–21) | investigación · escritura larga | subagentes en paralelo *(id no registrado)* | Entregado; base normativa | Escritura en paralelo sin lectura cruzada ⇒ contradicciones entre documentos (C4–C20) y **una cita fantasma** (C4) |
| Spec 30 — DecisionEngine (2 606 líneas, 60 invariantes) | especificación formal | subagente *(no registrado)* | Entregada; el documento más cuidado del corpus | 14 errores internos invisibles a la lectura (E10–E23) |
| Revisión editorial cruzada del corpus | revisión de documentos | subagente revisor *(no registrado)* | 17 contradicciones (C4–C20) | **Detectó contradicciones entre documentos; ninguna dentro de un documento.** Y produjo C4 |
| 42 ADR | decisión de arquitectura | arquitecto (humano) + redacción asistida | Vigentes | ADR-0001 invertía la dependencia `crypto`↔`domain` (E8); ADR-0004 mandaba el orden de comparación equivocado (E7) |
| `packages/crypto` contra la spec 10 | implementación + tests | subagente implementador *(no registrado)* | **116 pruebas en verde**: JCS, SHA-256, cadena, Merkle | **6 errores de spec + 2 incoherencias entre ADR + 1 divergencia sin cerrar** (E1–E9); cinco de seis, silenciosos |
| `packages/domain` contra la spec 30 | implementación + property-based | subagente implementador *(no registrado)* | **229 pruebas en verde**, 40 propiedades, semilla `30_000_821` | **14 errores de spec** (E10–E23); dos los encontró el arnés de pruebas, no el código |
| Corrección quirúrgica de las 14 erratas | edición técnica | orquestador | Aplicadas en el pasaje exacto, con nota fechada | Nueve de catorce eran dos pasajes correctos por separado que no se sostenían juntos |
| `TESTING.md` y este documento | documentación normativa | orquestador | Entregados | El registro no tenía columna de modelo: el análisis de ruteo era imposible |

> **Regla que deja la tabla:** toda delegación registra desde hoy el **identificador exacto del modelo
> y su versión**. «Subagente implementador» no permite comparar nada, y es la única columna que estaba
> vacía justo en lo que decide el ruteo futuro.

## 4. Dos aprendizajes de ruteo

### 4.1 Implementar es una forma de revisar — y la única que encuentra errores internos

**Los subagentes de implementación encontraron unos 20 errores en las especificaciones que ninguna
revisión por lectura detectó**: 6 en la spec 10 y 14 en la spec 30 (detalle en
`00-contradicciones-resueltas.md`, parte 3). Ambas habían pasado por la revisión editorial que produjo
C4–C20.

El patrón se repite en las dos rondas: **el error no está en lo que el documento ignora, está dentro
de la sección que demuestra dominar el tema.** La sección que dedica media página a cerrar el ataque de
segunda preimagen contenía la línea que lo reabre. Leer no lo detecta: al leer se verifica el
argumento, y el argumento era correcto; lo que falla es su correspondencia con las cuatro líneas de
código de debajo.

**Consecuencia de ruteo:** «revisá el documento X» delegado a un agente lector produce contradicciones
**entre** documentos y casi ninguna **dentro** de uno. Para validar un documento, la tarea correcta no
es «revisalo» sino **«implementá esta parte y contame qué no se puede escribir»**; y para lo que aún no
se implementa, **«escribí los invariantes»** — E11 y E14 aparecieron así, escribiendo el arnés.

### 4.2 Un agente revisor puede citar lo que el otro nunca dijo

**C4**, registrado en `00-contradicciones-resueltas.md`: el documento 11 abrió un bloque titulado
«Corrección al documento 20» citando esta frase del doc 20 — *«La SIC acepta esto como equivalente a la
supresión física del dato personal.»* **Esa frase no existe en el documento 20**; la búsqueda literal
sobre el corpus sólo la encuentra dentro de la propia cita, y el doc 20 sostiene lo contrario. El
efecto fue que **la posición correcta quedó presentada como el error a corregir**. Es el modo
característico en que se degrada un corpus escrito en paralelo: no por afirmaciones falsas sobre el
mundo, sino **falsas sobre lo que dicen los demás documentos** — mucho más difíciles de detectar,
porque suenan a rigor.

**Tres consecuencias de ruteo:**

1. **Toda cita entre documentos incluye sección exacta y debe ser verificable literalmente**, y se
   comprueba en CI (`TESTING.md` §13, regla 3): una cita que no aparece literal falla el build.
2. **Un agente que corrige a otro no puede ser su única fuente.** La salida de una revisión no es
   autoridad: es una **hipótesis** a verificar contra el original antes de aplicarla. Corregir es más
   peligroso que escribir, porque el resultado llega con forma de corrección y se acepta con menos
   escrutinio.
3. **Quien revisa no es quien implementa, y quien confirma una corrección no es quien la propuso** —
   la misma regla de `TESTING.md` §9, por la misma razón.

## 5. Registro de ruteo de la sesión 2026-08-21

Cierra la sesión que dejó el repositorio en `36b37c2` (603 pruebas en verde, 41 ficheros). El detalle
del estado está en `docs/HANDOFF.md`; aquí queda **sólo lo que sirve para decidir a quién se le da
qué la próxima vez**.

### 5.1 El plan declarado, y por qué no se ejecutó

El ruteo se declaró antes de empezar, como manda el procedimiento: `gemini/pro` para la investigación
de contexto largo, `codex/sol` con `effort: high` para la criptografía, `codex/terra` para la teoría
de la elección social, `gemini/flash` para la normativa. **No sobrevivió al contacto con la
infraestructura.** `delegar_a_cloud` (MCP `cloud-offload`) **falló en 4 de 5 intentos**:

| Proveedor | Fallo |
|---|---|
| `codex/gpt-5.6-sol`, `codex/gpt-5.6-terra` | `invalid ID token format` — autenticación del CLI de Codex rota |
| `gemini/pro`, `gemini/flash`, `minimax/MiniMax-M3` | `MCP error -32001: Request timed out` en todo lo no trivial |

La **única** llamada que completó fue a `minimax/MiniMax-M3` con salida de ~15 líneas. Todo lo que
pedía **≥600 palabras** de generación reventó, incluso troceado (se probó a 2800, 2000 y 600-900).
**El trabajo no sobrevive al timeout**: se inspeccionó el disco después y no había quedado nada
escrito. Los CLIs delegados **sí** tienen `bash` y `write` reales —la llamada que funcionó creó
ficheros—, así que el patrón «escribí a disco y devolveme 5 líneas» **es viable pero no salva el
timeout**, porque éste cubre la generación entera.

**Consecuencia de ruteo:** todo terminó ejecutándose en subagentes `task`. El presupuesto abundante de
MiniMax, destinado a **QA exploratorio masivo** y a la **matriz de navegadores**, quedó **sin usar por
transporte, no por criterio**. Cuando el transporte se arregle, **ese es el primer trabajo que debe
irse a MiniMax**.

> **Regla que deja el episodio:** un plan de ruteo no está validado hasta que el **transporte** está
> probado. La comprobación barata —una llamada trivial por proveedor— cuesta segundos y habría
> reasignado el plan entero antes de perder los primeros lanzamientos.

### 5.2 Lo que se delegó a subagentes `task`, y con qué resultado

| Tarea | Resultado | Hallazgos que entregó |
|---|---|---|
| `packages/anchor` — anclaje externo, 3 clases de independencia, quórum 2-de-3 | **80 pruebas en verde** | `GitForgeClient` sin implementación real y `httpCalendar()` nunca ejecutado contra un calendario: **lo reportó en vez de fingirlo** |
| `packages/verifier-cli` — verificador independiente en español | **33 pruebas en verde**, incluidos los 7 escenarios de ataque | Bug propio encontrado por su test: `directorySource()` acusaba de `EXPORT_INCOMPLETO` a un paquete intacto con ruta relativa |
| `services/api` — persistencia del ledger, blindaje, HTTP | **17 unitarias + 110 de integración** contra PostgreSQL real | **Tres errores autodestructivos de la spec**: la `RULE ON DELETE DO INSTEAD NOTHING` que volvía mudo el blindaje, el `ORDER BY tree_size` que ordenaba como texto, y `count(*) = max(leaf_index)+1` que no ve el truncamiento de la cola |
| Corte vertical — capa HTTP, interfaz Next.js, E2E | **28 escenarios**, verdes en chromium/firefox/chrome-movil | Reportó **sin ambigüedad** que WebKit y Safari móvil no arrancan por librerías del sistema ausentes, y **los dejó en rojo** en vez de silenciarlos |
| Documentación normativa (`TESTING.md`, `ARCHITECTURE.md`, README) | Entregada | — |

**Dos instrucciones explícitas que funcionaron y se repiten tal cual:**

- «**Si un test revela un bug, arreglá la implementación, nunca la aserción.**»
- «**Prefiero un informe honesto de lo roto a un verde inventado.**» Varios agentes reportaron lo que
  no pudieron hacer en lugar de fingirlo, que es exactamente el comportamiento que se quiere.

### 5.3 Límites operativos medidos

- **Máximo 2-3 subagentes `task` pesados en paralelo.** Por encima, abortan con
  `Tool execution aborted`. **Se perdieron cuatro lanzamientos** aprendiéndolo.
- **Nunca dos agentes sobre los mismos ficheros a la vez.** Ocurrió: dos colisionaron, uno se refugió
  en un *worktree* y commiteó en una rama, y quedaron **migraciones duplicadas, lint cruzado y un
  `tsconfig` huérfano**; costó una ronda entera de reconciliación. **Particionar por fichero, y
  decirlo explícitamente en el prompt.**
- **Escritura por pasadas** en documentos largos: crear el fichero con las primeras secciones y luego
  añadir. Si el agente aborta, no se pierde todo.
- **Exigir salida real pegada** de `pnpm test` / `typecheck` / `lint`, y que digan sin ambigüedad si
  **Docker** y los **navegadores** arrancaron de verdad.

### 5.4 El aprendizaje confirmado: implementar encuentra lo que revisar no

La sesión **replicó en dos rondas más** el patrón de §4.1, y con eso deja de ser una anécdota de dos
casos. Los tres errores de `services/api` de §5.2 comparten la firma exacta de E1: **no producen un
fallo, producen un sistema que se sabotea en silencio** —un blindaje que aprueba el borrado, una
cadena que se bifurca sin avisar, una prueba de contigüidad ciega justo al ataque más atractivo—. Los
tres estaban **dentro de las secciones que mejor demuestran dominar el tema**, y los tres pasaron por
revisión de lectura sin que nadie los viera.

**Consecuencia de ruteo, ya sin matices:** para validar una especificación, la tarea correcta **no es
«revisala»**, sino **«implementá esta parte y contame qué no se puede escribir»** — o, si aún no toca
implementar, **«escribí los invariantes»**. Un revisor entrega contradicciones **entre** documentos;
un implementador entrega errores **dentro** de uno. Sólo el segundo tipo es autodestructivo.

**Deuda que deja la sesión:** los hallazgos de estas dos rondas **no están volcados** a
`00-contradicciones-resueltas.md` (viven sólo en comentarios de código y nombres de test), y la cifra
«unos 20» de ese documento y de `TESTING.md` se quedó corta. Registrado como tarea 14 en
`HANDOFF.md` §7.

## 6. Registro de ruteo — ADR-0043 y primera iniciativa ejecutable

Sesión del 2026-08-21. Los contadores de tokens por subagente no estuvieron expuestos por el runtime;
se registra `n/d` en lugar de inventarlos. La cuota viva local indicaba margen suficiente de Codex;
Gemini y MiniMax tenían cuota, pero su transporte no estaba registrado en las herramientas de esta
sesión.

| TASK | TIPO | MODELO | TOKENS | RESULTADO | TESTS | REINTENTOS | ESCALAMIENTO |
|---|---|---|---:|---|---|---:|---|
| Investigación primaria de normativa y patrones | investigación | MiniMax M3 solicitado | n/d | **No ejecutado:** faltó `delegar_a_cloud`; cero respuestas atribuidas al proveedor | — | 0 | Investigación acotada por el agente principal con fuentes oficiales |
| Dominio `ExecutionPlan` + `Initiative` | implementación crítica | `gpt-5.6-sol`, high | n/d | Entregado | unitarias de dominio + build/pureza | 0 | — |
| Contratos HTTP | contratos mecánicos | `gpt-5.6-terra`, medium | n/d | Entregado | 6 pruebas de esquemas | 0 | — |
| Interfaz de plan, resultado e iniciativas | UI completa | `gpt-5.6-terra`, high | n/d | Entregado y corregido tras QA | build web + Playwright + axe | 0 | — |
| Propiedades del puente propuesta→iniciativa | property-based | `gpt-5.6-terra`, medium | n/d | Entregado | 590 casos generados con semilla fija | 0 | — |
| Cierre atómico y API de iniciativas | implementación crítica | `gpt-5.6-sol`, high | n/d | Entregado | PostgreSQL real, idempotencia y rollback | 1 | Reabierto después de revisión adversarial |
| Revisión independiente ADR-0043 | adversarial read-only | Codex nativo, high | n/d | **4 P1 + 2 P2 encontrados; merge bloqueado** | reproducciones de logs y lectura transaccional | 0 | Dos reparaciones Sol separadas por archivos |
| Invariantes borrador/configuración | reparación de dominio | `gpt-5.6-sol`, high | n/d | Entregado | replay/verifyLog adversarial e histórico | 0 | — |
| Atomicidad de apertura, colisión y snapshot | reparación API | `gpt-5.6-sol`, high | n/d | Entregado | apertura recuperable, `Promise.all`, colisión/rollback, integridad | 0 | — |
| QA de UX | revisión estática independiente | Codex nativo | n/d | Halló responsable invisible, controles UI sin E2E, foco artificial e ID de objeción expuesto | cobertura corregida en Playwright y presenter | 0 | MiniMax quedó pendiente por transporte |
| Segunda revisión de idempotencia compuesta | adversarial read-only | Codex nativo, high | n/d | Halló que una clave previa en el mismo agregado podía volver no-op un append distinto | dos regresiones HTTP + comparación canónica en Event Store | 0 | Reparación inmediata antes de aprobar ADR-0043 |
| Endurecimiento de replay y enlaces | reparación crítica | Codex nativo | n/d | Entregado | 646 pruebas; claves divergentes 409/rollback; propuesta↔decisión bidireccional | 0 | Suite completa y Chromium repetidos |

**Aprendizaje de ruteo confirmado.** La primera implementación tenía 632 pruebas verdes y aun así la
revisión adversarial encontró una forma de confirmar un resultado sin su iniciativa propia y una
mezcla válida de borrador/configuración. Para transacciones políticas multiagregado, un verde funcional
no sustituye una tarea explícita de «ocupá la reserva, fuerza el segundo append a fallar y demuestra el
rollback». La segunda revisión añadió otra regla: una clave de idempotencia no identifica el contenido;
el replay sólo es seguro si el lote completo coincide con lo ya sellado.

## 7. Registro de ruteo — ADR-0044, activación y consentimiento de tareas

Sesión del 2026-08-21. El runtime no expuso contadores de tokens por subagente. Tampoco registró
`delegar_a_cloud`, `cloud-offload`, MiniMax ni Gemini como herramientas invocables: se hicieron cero
llamadas externas y no se atribuye a esos proveedores ningún resultado.

| TASK | TIPO | MODELO | TOKENS | RESULTADO | TESTS | REINTENTOS | ESCALAMIENTO |
|---|---|---|---:|---|---|---:|---|
| Ratificación/activación, hitos y tareas en dominio | implementación crítica | Codex nativo | n/d | Entregado | unitarias + propiedades + logs adversariales | 0 | — |
| Atomicidad multiagregado, `request_scope`, API y PostgreSQL | implementación crítica | Codex nativo | n/d | Entregado y reparado tras revisión | 134 integraciones totales; carreras, replay, ABA y corrupción | 1 | Reabierto por reloj doble y replay sin reautorizar |
| Contratos y frontera temporal Colombia | contratos | Codex nativo | n/d | Entregado | 16 pruebas de contratos | 0 | — |
| UX de iniciativa y consentimiento | UI | Codex nativo | n/d | Entregado y corregido tras QA | Playwright + axe + teclado | 1 | Reabierto por idempotencia cliente y aceptación predeterminada |
| Revisión UI independiente | adversarial read-only | Codex nativo | n/d | 2 P1 + 5 P2 + 1 P3; segunda revisión sin bloqueantes | Chromium y Chrome móvil focales | 0 | Todos los P1/P2 corregidos antes del commit |
| Revisión dominio/API independiente | adversarial read-only | Codex nativo, high | n/d | Halló 1 P2 + 1 P3; segunda revisión sin P0-P3 | 57 focales + typecheck | 0 | Instante único y autorización viva de replay |
| Cobertura P3 de red/sesión | E2E | Codex nativo | n/d | Entregado | 8/8 Chromium; 16/16 Firefox + Chrome móvil | 1 | Primer locator no incluía los dos puntos visibles; se corrigió semánticamente |
| Alcance de ADR-0045 | exploración read-only | Codex nativo | n/d | Entregado | — | 0 | Detectó texto libre sensible antes de cerrar ADR-0044 |
| QA exploratorio MiniMax | exploración | MiniMax solicitado | n/d | **No ejecutado:** transporte ausente | — | 0 | Se usaron revisores nativos; no se fingió proveedor |

**Aprendizajes de ruteo.** La revisión separada volvió a cambiar el resultado: 695 pruebas verdes no
detectaban que dos lecturas del reloj podían atribuir una ratificación después del retiro ni que una
clave idempotente conservaba de hecho un permiso revocado. Para comandos políticos, el replay debe
revalidar no sólo contenido y actor histórico, sino también la capacidad viva si la respuesta vuelve
a exponerse. En UI móvil, la clave de idempotencia pertenece a la intención del usuario y sobrevive a
una respuesta perdida o a un 401 mientras la página siga abierta.
