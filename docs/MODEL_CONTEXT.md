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
