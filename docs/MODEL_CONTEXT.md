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

## 4. Cuatro aprendizajes de ruteo

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

### 4.3 El límite de delegación es la duración y no la cuota

El límite de `delegar_a_cloud` no es la cuota sino la duración de cada llamada. MiniMax y Gemini estuvieron todo el tiempo por encima del 90% y 67% libres de cuota. Una ola de nueve llamadas simultáneas las tumbó todas y dejó procesos colgados que saturaron el transporte más de una hora. **Paralelizar bien es hacer más llamadas y más cortas, no llamadas más grandes.** Cloud para trabajo acotado que devuelve texto o toca pocos ficheros; subagentes `task` para lo largo que necesita correr pruebas.

### 4.4 El trabajo sobrevive al timeout pero sin verificar

Se registró previamente que «el trabajo sobrevive al timeout». Aunque esto es cierto, resulta incompleto: **sobrevive SIN VERIFICAR**. Cuatro ficheros de prueba escritos por agentes caídos quedaron en disco con 20 errores de tipos, 34 de lint y 17 pruebas fallando, ya que nunca llegaron a ejecutarse. La pauta correcta es **auditar lo heredado antes de darlo por bueno**.

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

## 8. Registro de ruteo — sesión 2026-08-22 (ADR-0046, ADR-0047 y ADR-0048)

Primera sesión en la que **`delegar_a_cloud` funcionó de verdad** y el ruteo multiproveedor se
ejecutó como estaba planeado, en vez de degradar a subagentes `task` por transporte. El runtime
tampoco expuso contadores de tokens por tarea: se registra `n/d` en lugar de inventarlos.

**Cómo leer la columna TESTS.** Las cifras son las que **reportó cada agente al entregar**. Las
únicas verificadas por el orquestador al cerrar la sesión son las globales: **1 006 pruebas en 77
ficheros**, con Docker real, repartidas en `crypto` 108, `domain` 481, `anchor` 80, `verifier-cli`
34, `contracts` 24, `consensus` 65, `services/api` 53 y `tests/integration` 161.

| TASK | TIPO | MODELO | TOKENS | RESULTADO | TESTS | REINTENTOS | ESCALAMIENTO |
|---|---|---|---:|---|---|---:|---|
| Rescate de ADR-0045 y verificación del verde | recuperación + verificación | subagente `task` | n/d | 2 commits; **falsó su propio verde** rompiendo `DOCKER_HOST` para demostrar que la suite no sobrevive sin Docker; corrigió además un `grep` mal escrito del orquestador | 798/798 con Docker real | 0 | — |
| Spec de los métodos de escrutinio B.5–B.9 | especificación formal | `gemini/pro` | n/d | Entregada; **dos invariantes FALSOS**: afirmó que MJ satisface *later-no-harm* y el criterio de mayoría | — | 0 | Refutados por `codex/sol` al implementar |
| Diseño del agregado de deliberación | arquitectura | `codex/gpt-5.6-terra`, high | n/d | Entregado; **sobre-diseñó** con cifrado umbral y NIZK, inviables sin dependencias de runtime | — | 0 | El orquestador lo bajó a commitment con nonce (ADR-0046) |
| Spec de consenso tipo Pol.is | especificación | `minimax/MiniMax-M3` | n/d | Entregada y correcta | — | 0 | — |
| Implementación de la deliberación | implementación crítica | subagente `task` | n/d | Entregado; **reportó el hueco de `actor: 'system'`** en vez de taparlo | 91 reportadas | 0 | — |
| Seudónimo por deliberación y matriz de autorización | implementación crítica | `codex/gpt-5.6-terra`, high | n/d | Entregado; **se atacó a sí mismo con éxito** y demostró que el arreglo no resiste al administrador | 116 reportadas | 0 | El hueco quedó declarado en ADR-0046, no tapado |
| Métodos de escrutinio, 1er intento | implementación crítica | `codex/gpt-5.6-sol`, high | n/d | **Paró y pidió autorización** en vez de meter un cast: el recorte del orquestador estaba mal. Refutó con contraejemplos los dos invariantes falsos de `gemini/pro` | — | 0 | Recorte corregido y relanzado |
| Métodos de escrutinio, 2º intento | implementación crítica | `codex/gpt-5.6-sol`, high | n/d | **Timeout de transporte, pero el trabajo quedó escrito en disco** | — | 0 | Consolidado por un subagente auditor |
| Consenso, implementación | implementación | `minimax/MiniMax-M3` | n/d | **Timeout**; `src/` escrito y utilizable, `test/` vacío | — | 0 | Consolidado por un subagente auditor |
| Consolidación del escrutinio | auditoría + implementación | subagente `task` | n/d | 12 defectos del trabajo heredado y **2 bugs reales**; verificó sus propios tests por **mutación dirigida** y halló un fallo en su propia prueba | 1 006 totales | 0 | — |
| Consolidación del consenso | auditoría + implementación | subagente `task` | n/d | 10 defectos, 3 graves; determinismo frente a permutar participantes **exacto por construcción** | 65 | 0 | — |
| Revisión adversarial del esquema de seudónimo | adversarial read-only | `claude/opus` | n/d | **No ejecutada: timeout de transporte.** No se atribuye ningún resultado | — | 0 | **Queda pendiente**; ADR-0046 lo declara sin aprobar |

### 8.1 Tres reglas de ruteo que deja la sesión

**1. El trabajo SÍ sobrevive al timeout. Antes de relanzar nada, se inspecciona el disco.**

Esto **corrige** lo que afirma `HANDOFF.md` §9 —«el trabajo NO sobrevive al timeout»—, que se
estableció en la sesión del 2026-08-21 y hoy es falso. El MCP corta la llamada, pero **el CLI delegado
sigue corriendo y escribiendo**. Las dos tareas que cayeron por timeout —los métodos de escrutinio y
el consenso— **dejaron código utilizable en disco**, y una de ellas dejó el paquete entero salvo los
tests.

La pauta correcta, por tanto, no es «volver a lanzar»: es **inspeccionar el disco tras un timeout
antes de relanzar nada**, y encargar la consolidación a un agente que **audite lo heredado en vez de
rehacerlo**. Rehacer habría costado dos generaciones largas más y habría perdido los doce y diez
defectos que la auditoría encontró precisamente por mirar código ajeno con desconfianza.

**2. El umbral del transporte es por DURACIÓN, no por proveedor.**

Las tres generaciones largas de **diseño** —miles de palabras cada una, lanzadas en paralelo a
`gemini/pro`, `codex/terra` y `minimax`— **completaron sin problema**. Las dos **implementaciones
largas que además corren tests** cayeron, una de Codex y otra de MiniMax. No hay un proveedor malo:
hay un techo de tiempo de llamada, y lo que lo supera es ejecutar herramientas durante minutos, no
escribir texto.

> **Regla:** **diseño y revisión a `delegar_a_cloud`; implementación larga con pruebas a subagentes
> `task`.** Esto también reasigna el reparto: las specs, las revisiones adversariales y los análisis
> de contexto largo son el trabajo natural de los proveedores externos, y el ciclo
> escribir-correr-arreglar es el de los subagentes.

**3. Un modelo caro que se NIEGA a trabajar puede valer más que uno que entrega.**

`codex/gpt-5.6-sol` no escribió una sola línea en su primer intento y **fue la entrega más valiosa de
la ronda**: descubrió que el recorte de ficheros que le habían dado era imposible de cumplir, paró, y
de paso refutó con contraejemplos numéricos los dos invariantes falsos que venían de otro modelo. Si
hubiera «resuelto» el recorte con un cast, esos dos invariantes falsos habrían entrado al arnés como
propiedades generales y el paso siguiente habría sido tocar el escrutinio hasta ponerlas en verde.

Es la **regla 2 de §1** funcionando tal como está escrita —«si el agente necesita un fichero que no
está en la lista, se para y se corrige el recorte, no se amplía por cuenta propia»—, y la primera vez
que se puede señalar el episodio concreto en que pagó. La contrapartida declarada en §2 también se
cumplió: **el recorte estaba mal y la culpa era de quien recortó**, no del agente.

### 8.2 Lo que la sesión confirma de §4.1

El patrón se repite por cuarta vez, ahora sobre una especificación producida por un modelo y no por
una persona: **implementar encontró once errores de la spec 30 en la parte que menos se había
ejercitado, y dos afirmaciones falsas de la spec nueva**. Ninguna revisión por lectura las había
visto. Y los tres bugs propios de la ronda (`00-contradicciones-resueltas.md`, B1–B3) comparten otra
vez la firma de E1: **no fallan, sabotean en silencio** — un histograma con rechazos que nadie emitió,
un codec que mata la configuración al releerla, y unos números correctos colgando de la afirmación
equivocada.

Novedad de método que conviene repetir: **la consolidación del escrutinio verificó sus propios tests
por mutación dirigida** —romper la implementación a propósito y comprobar que la prueba se pone en
rojo— y así encontró un fallo en su propia prueba. Es la única técnica de la sesión que auditó al
auditor.

## 9. Registro de ruteo — sesión 2026-08-22, segunda mitad (ADR-0049, ADR-0050 y publicación)

Continúa la sesión de §8, después de que ADR-0046/0047/0048 quedaran integrados. La segunda mitad
tuvo un reparto distinto: **los subagentes `task` para lo que hay que escribir y correr, y
`delegar_a_cloud` para revisar, especificar y auditar** — que es exactamente la regla que §8.1 dejó
enunciada, aplicada por primera vez a propósito y no por accidente.

Los contadores de tokens siguen sin exponerse por el runtime: `n/d` en vez de inventarlos.

| TASK | TIPO | MODELO | TOKENS | RESULTADO | TESTS | REINTENTOS | ESCALAMIENTO |
|---|---|---|---:|---|---|---:|---|
| Corte vertical de deliberación: contratos, API e interfaz | implementación larga con pruebas | subagente `task` | n/d | Entregado. Encontró **ejecutando** una **escalada horizontal en `supersedes`**: cualquiera podía sustituir —y por tanto silenciar— el aporte de cualquier otro | **1 207** en el repositorio, **55** e2e | 0 | La escalada se corrigió en un commit propio (`bf01277`) |
| Democracia líquida — PARTE C completa | implementación crítica con propiedades | subagente `task` | n/d | Entregado. **Once erratas de spec, E36–E46, tres autodestructivas** | **+104** | 0 | Las tres autodestructivas se resolvieron dentro de la misma entrega, no se elevaron |
| Revisión adversarial de la autoría por etapa | adversarial read-only | `gemini/pro` | n/d | **Recomendó ELIMINAR el ocultamiento de autoría**, por engañoso | — | 0 | **Aceptada parcialmente:** se retiró la retención del export, se mantuvo la regla de acceso (ADR-0049) |
| QA exploratorio estático del árbol | exploración read-only | **3 × `minimax/MiniMax-M3` en paralelo** | n/d | **31 hallazgos con cita literal, 4 bloqueantes**. ⚠ **Uno de los tres devolvió vacío al primer intento y hubo que relanzarlo** | — | **1** | Los 4 bloqueantes se repararon antes de publicar |
| ADR-0050 — umbral de no-facción revisado | especificación | `gemini/flash` | n/d | Entregado | — | 0 | Queda **Propuesto**, no aceptado |
| Publicación en GitHub | infraestructura + auditoría | subagente `task` | n/d | **Barrido de secretos sobre las 21 revisiones y los 596 blobs** del historial: **limpio**. Repo creado, push por **SSH**, verificado comparando SHA local y remoto | — | 0 | — |

### 9.1 Las dos reglas de ruteo que deja la segunda mitad

**1. El QA exploratorio estático en paralelo con MiniMax funciona, es barato — y hay que comprobar
que respondió.**

Es el trabajo que `HANDOFF.md` §9 llevaba dos sesiones señalando como «el primer trabajo que debe
irse a MiniMax cuando el transporte se arregle», y por fin se le encargó: **tres instancias de
`minimax/MiniMax-M3` en paralelo**, cada una con un recorte distinto del árbol, en modo lectura.
Devolvieron **31 hallazgos con cita literal del código, cuatro de ellos bloqueantes**. Encaja con lo
que §8.1 predijo: es **lectura y generación de texto**, no ejecutar herramientas durante minutos, así
que no toca el techo de duración del transporte.

⚠ **Pero uno de los tres devolvió respuesta vacía al primer intento**, sin error, sin timeout y sin
aviso. Se relanzó y respondió normal. **Un reintento de cada tres es la tasa observada**, sobre una
muestra de tres, que es poco — pero el modo de fallo importa más que la tasa: **la llamada
«completa» con contenido vacío es indistinguible de un recorte que no tenía nada que reportar**. Si
el orquestador no mira la respuesta, el resultado es un tercio del árbol declarado limpio sin que
nadie lo haya mirado.

> **Regla:** en un fan-out a MiniMax, **comprobar que cada respuesta trae contenido antes de darla
> por buena**, y relanzar la que venga vacía. Es la versión barata de la regla de §5.2 —«exigir
> salida real pegada»— aplicada a un proveedor que a veces no pega nada. Vale para todo fan-out, no
> sólo para MiniMax: un agente que no responde y un agente que responde «todo bien» **se ven igual en
> la tabla de resultados**, y sólo uno de los dos miró.

**2. Una revisión adversarial que recomienda ELIMINAR sigue valiendo aunque se acepte a medias.**

`gemini/pro` revisó el esquema de autoría por etapa y no propuso mejoras: **propuso quitarlo**, con
el argumento de que ocultar la autoría promete una protección que el sistema no da. Se aceptó
**parcialmente** —se retiró la retención del export, que era la parte indefendible; se mantuvo la
regla de acceso, que sí protege frente a los pares— y **la discrepancia quedó escrita en ADR-0049 en
vez de resuelta a favor de quien decidía**.

Es el caso simétrico del de §8.1 punto 3 («un modelo caro que se niega a trabajar»): allí el valor
estuvo en que un implementador **no implementara**; aquí, en que un revisor **no revisara dentro del
marco dado** sino que atacara el marco. Las dos entregas son incómodas y las dos cambiaron el
resultado. La consecuencia de ruteo es la misma en ambas: **al revisor adversarial hay que darle
permiso explícito para recomendar que no se haga**, porque si el prompt pregunta «cómo mejorar X»,
lo que no se va a recibir nunca es «X no debería existir».

### 9.2 El reparto que ya se puede dar por validado

Tres sesiones de datos bastan para dejar de tratarlo como hipótesis:

| Tipo de trabajo | A quién va | Evidencia |
|---|---|---|
| Implementación larga con pruebas (escribir-correr-arreglar) | **subagentes `task`** | Las cuatro entregas grandes de esta sesión completaron; las dos que se intentaron por `delegar_a_cloud` en §8 cayeron por duración |
| Especificación y diseño | `gemini/pro`, `codex/*`, `minimax` | Completan; el techo es de duración, no de palabras (§8.1 punto 2) |
| Revisión adversarial | `gemini/pro`, `codex/*` nativo | Cambió el resultado en las tres sesiones registradas |
| **QA exploratorio estático y masivo, en paralelo** | **`minimax/MiniMax-M3`, varias instancias** | 31 hallazgos con cita literal en esta sesión. **Comprobar que la respuesta no viene vacía** |
| Orquestación, síntesis, decisiones sobre discrepancias | **el orquestador** | Las tres discrepancias del día —E24 retirada, la recomendación de `gemini/pro`, la errata de T-09— las cerró el orquestador, y una de las tres fue contra sí mismo |

## 10. Registro de ruteo — sesión 2026-08-23, rediseño de interfaz y despliegue

| TASK | TIPO | MODELO | TOKENS | RESULTADO | TESTS | REINTENTOS | ESCALAMIENTO |
|---|---|---|---:|---|---|---:|---|
| Despliegue en la VPS e inventario previo | infraestructura | subagentes `task` | n/d | **Excelente.** El inventario en solo lectura fue lo que hizo el despliegue seguro | — | 0 | — |
| Capturas y auditoría de la interfaz desplegada | auditoría | subagente `task` | n/d | 30 capturas a 360 y 1280 px, peso de red medido, y un juicio honesto: la barra de 13 enlaces ocupaba 284 px de 800 y costaba 73 KiB de precarga | — | 0 | — |
| Rediseño del sistema visual | UI / diseño | `claude/opus` | n/d | Recorrido numerado + grupo «Consultar» plegable, escala fluida, `--medida: 64ch`, borde de control a 3,43:1, pie anclado. Portada: `h1` de 373 → 198 px | — | 0 | — |
| Corrección de la regresión del rediseño | UI / corrección | `claude/opus` | n/d | Su propio cambio dejaba el `h1` de las pantallas de consulta en `y=648` de 800 (81%), peor que el problema original. Lo midió, lo reconoció y lo bajó a 286 px | — | 0 | — |
| 21 defectos de texto (concordancia, punto doble, millares) | corrección | `minimax/MiniMax-M3` | n/d | Los 21, verificados con tsc, eslint y prettier | — | 0 | — |
| Contrato del 401 en `/auth/yo` | contratos | `codex/gpt-5.6-sol` | n/d | Recomendó rutas de estado separadas y advirtió del riesgo de oráculo de enumeración de padrón | — | 0 | — |
| Reestructuración de `/verificar` | diseño | `gemini/pro` + subagente `task` | n/d | Jerarquía invertida: veredicto ámbar primero, seis comprobaciones plegadas, comprobación externa como acción principal | — | 0 | — |
| Barridos de QA por pantallas | QA | 4× `minimax/MiniMax-M3` en paralelo | n/d | Doble envío sin proteger en tres pantallas, callejón sin salida en la pantalla de resultado, y que la lista de deliberaciones mentía por omisión sobre la autoría | — | 0 | — |
| Resucitar las pruebas de `/verificar` | tests | subagente `task` | n/d | La prueba de que la manipulación se denuncia estaba **muerta**; volvió a correr y **con aserciones más fuertes**, no más débiles | — | 0 | — |

### 10.1 Aprendizajes de ruteo

1. **El límite de `delegar_a_cloud` no es la cuota sino la duración de cada llamada.** MiniMax y Gemini estuvieron todo el tiempo por encima del 90% y 67% libres. Una ola de nueve llamadas simultáneas las tumbó todas. **Paralelizar bien es hacer más llamadas y más cortas, no llamadas más grandes.**
2. **Corrección a un aprendizaje anterior**: se registró que «el trabajo sobrevive al timeout». Es cierto pero incompleto — **sobrevive SIN VERIFICAR**. Cuatro ficheros de prueba escritos por agentes caídos quedaron en disco con 20 errores de tipos y 17 pruebas fallando: nunca se ejecutaron. La pauta correcta es **auditar lo heredado antes de darlo por bueno**.
3. **Un parte de errores caduca.** Se encargó reparar una colisión con 14 errores de tipos; el agente comprobó antes de tocar, vio que ya estaban resueltos y **auditó la fusión en vez de rehacerla**. Comprobar antes de reparar es parte del encargo.
4. **Dos agentes sobre el mismo fichero vuelven a costar caro.** `apps/web/app/iniciativas/[id]/page.tsx` lo tocaron a la vez el de puntuación y el de doble envío. Es la misma regla que el repositorio ya tenía escrita: **particionar por fichero y decirlo explícitamente en el encargo**.
5. **Ruteo por fortaleza, confirmado con evidencia**: Opus para juicio de interfaz; Codex para corrección dura y seguridad; Gemini para lectura larga y análisis; MiniMax para volumen acotado. El mejor rendimiento del día fue MiniMax en trabajo mecánico bien recortado.
