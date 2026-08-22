# Estrategia de pruebas de Koinonía

> **Estado:** normativo. Documenta una estrategia **en marcha**, no un plan. Hoy el repositorio tiene
> **696 pruebas en verde repartidas en 49 ficheros** —108 en `packages/crypto`, 307 en
> `packages/domain`, 80 en `packages/anchor`, 33 en `packages/verifier-cli`, 16 en
> `packages/contracts`, 18 en `services/api` y 134 de integración contra PostgreSQL real—, entre ellas
> las **propiedades de fast-check** mapeadas a un invariante de la PARTE E de la spec 30. A eso se suman
> los escenarios de extremo a extremo en Playwright, cuyo contador vigente se registra en el handoff.
>
> **Fecha:** 2026-08-21 · Lo exigido a `packages/*`, a `services/api` y al corte vertical ya se
> cumple; `apps/web` se cubre por extremo a extremo y no tiene suite unitaria propia.

## Principio rector

**Una *feature* sin pruebas suficientes no está terminada.** No está «terminada pero pendiente de
tests»: no está terminada. Y el testing **no se deja para el final**, porque aquí escribir las pruebas
es una técnica de diseño y de revisión, no una fase posterior.

No es una preferencia metodológica: es la conclusión que el proyecto ya pagó. **Entre las dos
especificaciones normativas, la implementación encontró unos 20 errores que ninguna revisión por
lectura detectó** (`00-contradicciones-resueltas.md`, parte 3), y ambos documentos habían pasado por
revisión editorial cuidadosa. Dos de ellos —el `resultHash` imposible (E11) y el conteo de `INV-34`
(E14)— **los encontró el arnés de pruebas, no el código de producción**: aparecieron al preguntar «¿qué
generador distingue estas dos ramas?» y «¿cuántos casos son exactamente?».

---

## 1. Definición de «terminado»

Es la condición de merge, y cada punto es verificable:

1. **Funciona** en el camino feliz y en los de error previstos.
2. **Está integrada**, no en una rama muerta ni tras una bandera que nadie enciende.
3. **Los permisos son correctos**: la autorización se comprueba en el servidor, y se ha probado que un
   rol inferior no puede ejecutar la operación.
4. **Tiene las pruebas apropiadas para su naturaleza** (§2): unitarias siempre; propiedades si hay
   invariantes; integración si toca la base; E2E si hay flujo de usuario.
5. **El E2E crítico pasa** (§6) y **no rompe flujos existentes**: pasa la suite completa.
6. **Navegadores relevantes** (§7) y **responsive**: escritorio, tableta y móvil pequeño.
7. **Accesibilidad razonable**: sin violaciones de axe-core, navegable con teclado (§12).
8. **Errores manejados**: nadie queda sin saber qué pasó; ninguna traza técnica llega a la pantalla.
9. **Seguridad considerada**: entradas validadas en el dominio y no sólo en el borde; nada sensible en
   logs.
10. **Documentación al día**: si cambió un contrato, un ADR o una regla de gobernanza, cambió en el
    mismo PR.

**Para componentes críticos** —motor de decisión, ledger, urna, padrón, PII Vault, autorización—
además: **revisión independiente** (§9); **adversarial testing** ejecutado y documentado (§9);
**invariantes** en `test/props/` con su `INV-NN`; **manipulación intencionada** probada —alterar el
log, saltarse la interfaz, reordenar eventos— con detección efectiva; y **verificación de auditoría**:
un tercero recomputa el resultado desde los eventos públicos y obtiene el mismo `resultHash`.

---

## 2. La pirámide y las herramientas

El orden es de coste y alcance: cada nivel prueba lo que el anterior no puede, y sólo eso.

```
unit → property/invariantes → integración → funcional → E2E → seguridad → exploratoria
```

| Nivel | Qué prueba | Herramienta | Dónde |
|---|---|---|---|
| Unitarias | funciones puras, fronteras, errores | **Vitest** | `packages/*/test/` |
| Propiedades | invariantes universales sobre entradas generadas | **fast-check** | `packages/domain/test/props/` |
| Integración | dominio + PostgreSQL real, transacciones, concurrencia | **Testcontainers** | `tests/integration/` |
| Funcional | casos de uso completos sin navegador | Vitest + Supertest | `tests/integration/` |
| E2E | flujos de usuario en navegador | **Playwright** | `tests/e2e/` |
| Seguridad | autorización, manipulación, mutación | Playwright + **Stryker** | nightly |
| Exploratoria | lo que no se nos ocurrió | agentes con el guion de §8 | `reportes/` |

**Vitest** ya es el corredor del repo: ESM nativo —el monorepo es `"type": "module"` y `crypto` usa
WebCrypto— y comparte los alias de resolución con el build (`vitest.config.ts:9-11`), así que las
pruebas ejercitan el mismo grafo de módulos que producción. **fast-check**, además de generar,
**minimiza** el contraejemplo; sin eso, un fallo en un log de 200 eventos es inaccionable.
**Testcontainers** levanta un PostgreSQL efímero por suite: una base compartida obligaría a limpiar
entre pruebas, y la limpieza es donde se cuelan las dependencias de orden. **Playwright** da los tres
motores con un solo API, trazas al fallar y contexto aislado por sesión — lo que hace escribibles «voto
secreto» y «permisos por rol», que necesitan varias sesiones simultáneas. **Stryker** responde lo único
que la cobertura no responde (§10); **axe-core** aporta el motor WCAG (§12); **k6** permite versionar
los escenarios de carga junto al código (§11).

**Qué NO usamos.** *Jest*: exige transformación para ESM y duplicaría la configuración de módulos.
*Cypress*: no corre WebKit y complica el escenario de dos sesiones simultáneas, aquí obligatorio.
*Selenium*: más lento y más frágil. *Mocks de base de datos*: prohibidos, §5. *Snapshot testing
masivo*: un snapshot grande no afirma nada y cuando cambia la reacción humana es actualizarlo; se
admite sólo para artefactos con significado propio —la `Proof` renderizada, el JSON canónico de un
evento— y con aserciones al lado. *Cucumber/Gherkin*: traduce sin verificar; la legibilidad para no
técnicos se resuelve en la `Proof`. *Insignias de cobertura*: una puntuación pública se optimiza.

---

## 3. Unitarias y cobertura

Cubren funciones puras, **casos frontera explícitos** y errores. La regla de las fronteras se
aprendió cara: tres de los seis errores de la primera ronda fueron el caso degenerado (`m = 0`, «el
primero de la serie», `n ≥ 2³¹`). **Toda recursión declara su caso base y se prueba con él; todo
dominio numérico se ejercita en `0`, `1`, el máximo y el máximo + 1.**

### Umbrales por paquete

Configurados en `coverage.thresholds`. Fallar el umbral **falla el build**.

| Paquete | Líneas | **Ramas** | Funciones | Sentencias | Notas |
|---|---|---|---|---|---|
| `packages/crypto` | **100 %** | **100 %** | **100 %** | **100 %** | `perFile: true`, sin excepciones |
| `packages/domain` | **95 %** | **95 %** | **98 %** | **95 %** | `perFile: true` en `src/tally/**`, `quorum.ts`, `window.ts`, `state-machine.ts` |
| `packages/contracts` | 80 % | 70 % | 85 % | 80 % | casi todo son tipos; se cubren los mapeadores |
| `services/api` | 85 % | 78 % | 90 % | 85 % | **100 % de ramas** en autorización y validación |
| `apps/web` | 70 % | 60 % | 75 % | 70 % | la UI se verifica por E2E; subirlo empujaría a tests de render sin valor |

**Por qué 100 % de ramas en `crypto`.** Son ~600 líneas que deben quedar congeladas durante décadas
—cambiarlas invalida toda la historia anclada— y son lo que se publica como verificador independiente.
Una rama sin cubrir ahí nadie la volverá a mirar en años.

**Por qué ramas altas en `domain`.** El motor está lleno de decisiones binarias que **son** la
gobernanza: `strict ? '>' : '≥'`, `abstentionBlocks`, `silenceMeans`, `onFailure`. Cada rama sin cubrir
es una regla del reglamento que nadie ejecutó nunca, y la cobertura de líneas no las ve: un
`return strict ? c > 0 : c >= 0` se cubre entero con un solo caso.

### Contra la cobertura artificial

**Prohibido escribir pruebas cuyo único efecto sea mover el porcentaje:** invocar una función sin
afirmar nada sobre el resultado; sustituir la aserción real por `not.toThrow()`; cubrir una rama
defensiva inalcanzable fabricando un estado imposible con `as any` —si es inalcanzable, se elimina o
se marca `c8 ignore` **con el comentario que explique por qué**—; y bajar un umbral para que pase un
PR, que se hace en su propio PR, justificado y aprobado por alguien que no lo necesita.

Criterio positivo: **una prueba vale si su fallo enseña algo.** La comprobación empírica no es la
cobertura sino el mutation testing (§10).

---

## 4. Property-based testing

Es el corazón de la estrategia. La PARTE E de la spec 30 no es un anexo: es el **contrato
ejecutable**, con 60 invariantes (`INV-01`…`INV-60`) y 7 anti-invariantes (`A-01`…`A-07`).

### Los 40 ya implementados

Viven en `packages/domain/test/props/`, cada bloque etiquetado con su `INV-NN`, y cubren **35 de los
60** invariantes:

| Fichero | `INV-NN` cubiertos |
|---|---|
| `props/invariants.test.ts` | **E.1** 01–06 · **E.2** 07, 08, 10, 11, 12 · **E.3** 14, 15, 16 (+ variante fuerte), 17, 20 · **E.4** 21, 22, 31, 32, 33 · **E.5** 34, 36, 37 · **E.6** 39, 40, 41, 52, 53 |
| `props/log-invariants.test.ts` | 19, 34, 35, 38, 58, 59, 60 |

Los segundos necesitan un log **legal** —máquina de estados respetada, `seq` denso, `prevHash`
encadenado— que después se agrede: borrar un evento, insertar otro, reordenar, inyectar uno ilegal.
Construir ese generador produjo tres de los catorce errores de la segunda ronda: **no se puede generar
un log legal contra una máquina de estados incompleta.** Cuatro invariantes más (`INV-09`, `INV-13`
parcial, `INV-18`, `INV-54`) están cubiertos por pruebas **de ejemplo**.

### Los 25 que faltan, y por qué

Ninguno falta por olvido: **todos corresponden a código que todavía no existe.** `INV-23`…`INV-30`
(delegación) porque la PARTE C no está implementada; `INV-42` (IRV), `INV-43`…`INV-45` (Schulze),
`INV-46`…`INV-49` (menciones) y `INV-50`–`INV-51` (puntuación) porque no existen esos escrutadores;
`INV-55`…`INV-57` porque no hay sorteo ni faro; `INV-13` completo porque la cascada de `TieBreakPolicy`
está sólo parcialmente implementada.

Está escrito en la cabecera del propio fichero (`props/invariants.test.ts:5-7`), y la razón es una
regla general:

> **Un invariante verde sobre código ausente es peor que un invariante ausente.**

Miente dos veces —dice que la propiedad se cumple y que alguien la comprobó— y miente hacia el futuro:
quien implemente Schulze dentro de seis meses verá `INV-43` en verde y creerá que su código lo
satisface, cuando lo verde era un `it()` sobre una función que devolvía `undefined`. Una casilla vacía
es información correcta; una verde falsa es desinformación con la autoridad de la suite detrás. Por eso
la cobertura de invariantes **se declara y se sigue** —35 de 60— y ningún PR que implemente un
escrutador se acepta sin los suyos.

### El caso de IRV: la propiedad que NO se cumple

`INV-40` exige monotonía: mejorar la posición del ganador no puede hacerle perder. Es verdadera para
umbral, aprobación, puntuación, menciones y Schulze. **Es falsa para IRV**, no por un defecto de
implementación sino por construcción del método: hay perfiles donde subir al ganador `B` en cuatro
papeletas hace ganar a `C` (contraejemplo numérico en §B.6).

Por eso el test de monotonía **excluye `irv` explícitamente**, con filtro visible
(`method.kind !== 'irv'`) y remisión a `A-01`. Y por eso `INV-42` exige además un test **positivo**: que
el contraejemplo de B.6 siga produciendo la no monotonía, más una búsqueda aleatoria que encuentre al
menos uno en 10 000 corridas. El desastre que previene es concreto: incluir IRV en la propiedad, ver el
rojo y «arreglar» el motor hasta el verde, metiendo un bug real para satisfacer una propiedad que el
método no tiene.

> **Una propiedad que un método no cumple se excluye por escrito, con nombre, razón y prueba
> positiva de la exclusión. Nunca en silencio, nunca con `skip`, nunca borrando el caso que la
> contradice.**

Igual con los otros seis anti-invariantes, entre ellos `A-03` (revocar una delegación **reduce** `|E|`)
y `A-06` (el escrutinio no es asociativo por lotes).

### Política de semillas

La semilla está **fija**: `30_000_821` (`test/arbitraries.ts:607`), de modo que un contraejemplo se
reproduce entre ejecuciones, máquinas y ramas. Las corridas son **escalables por variable de entorno**:

```ts
export const RUNS = Number(process.env['FC_RUNS'] ?? '1000');
export const FC = { numRuns: RUNS, seed: 30_000_821, verbose: 0 } as const;
```

PR y `main`: `1000`. Nocturno: `10000`. Local durante la implementación: `100`, y nunca para dar nada
por terminado. El auxiliar `runs(n)` escala proporcionalmente los casos caros con un piso de 5.

**Por qué fija y no aleatoria:** una semilla aleatoria convierte la suite en un *flaky* estructural que
falla una vez de cada cincuenta, en el PR de otro, con un caso irreproducible. Se explora más espacio
con **más corridas**, no con más azar. Todo contraejemplo minimizado se **congela como test de
regresión determinista** junto al invariante que lo encontró. Y los generadores de cadenas **deben**
producir caracteres fuera del BMP: lección de `E7`, donde una batería de sólo-ASCII habría dado verde
indefinidamente sobre la regla de ordenación equivocada.

---

## 5. Integración

Contra **PostgreSQL real** levantado con Testcontainers, con el mismo esquema y las mismas restricciones
que producción: `UNIQUE(decision_id, seq)`, los `CHECK` de formato (`^[0-9a-f]{32}$`), las columnas
`char(32)`, los índices y los tipos exactos.

**Se mockea** el proveedor de correo (el enlace mágico de ADR-0012 va a un buzón en memoria), el
**anclaje externo** y el **faro de aleatoriedad**, estos dos con dobles deterministas: precisamente
porque el faro debe ser impredecible en producción, en pruebas tiene que ser fijo, o el sorteo no es
reproducible. El reloj no es un mock: el instante **entra como dato**, y el dominio tiene prohibido
leer `Date.now()` por lint y por `scripts/check-domain-purity.mjs`.

**No se mockea nunca la base de datos.** Ni en memoria, ni SQLite, ni repositorio falso.

> **Los mocks de base de datos habrían ocultado el error de tipos que hacía que el sistema se
> acusara a sí mismo de manipulación.**

Es `E1`. La spec declaraba `actor` y `aggregateId` como «32 hex minúsculas» y el DDL los definía como
columnas `uuid`. PostgreSQL **acepta** 32 hex en una columna `uuid` —normaliza en silencio— y
**devuelve siempre** la forma canónica de 36 caracteres con guiones. Al rehidratar el evento para
reverificarlo, el `actor` ya no era el que se hasheó: cambiaba la preimagen, cambiaba el `eventHash`, y
el sistema declaraba **«historia alterada» sin que nadie la hubiera alterado**. Un repositorio en
memoria devuelve el objeto que le diste: habría pasado. SQLite no tiene tipo `uuid`: habría pasado.
**Sólo lo ve un PostgreSQL real haciendo el viaje de ida y vuelta.** De ahí dos reglas: toda prueba que
afirme algo sobre un hash o un checkpoint **debe** escribir, leer y verificar sobre lo leído; y la suite
incluye un caso de **restauración** (`pg_dump` → `pg_restore` → verificación completa), que es donde
`E1` se habría manifestado.

Cubre además **concurrencia** (dos `BallotCast` simultáneos obtienen `seq` distintos; el reintento
optimista converge; nunca hay huecos), **el tick de cierre** (INV-38) y **migraciones** (cada una sobre
una base con datos, verificando que el ledger sigue íntegro).

Para ADR-0044, tres respuestas de tarea lanzadas desde la misma revisión —aceptar, rechazar y pedir
reasignación— compiten contra PostgreSQL real: exactamente una escribe y las otras reciben conflicto.
Un intento posterior sólo puede avanzar con la revisión nueva. Las pruebas leen luego el payload
persistido y demuestran que ni un campo extra de texto libre ni su valor llegan al ledger.

---

## 6. E2E con Playwright

Nueve escenarios **obligatorios**. Si uno falla, no hay release.

1. **Gobernanza completa.** Redactar → abrir (el padrón se congela, se publica `rollHash`) → deliberar
   → votar desde varias sesiones → cerrar por ventana → computar → ventana de impugnación → ratificar.
   Se afirma: el `resultHash` publicado coincide con el recomputado; las cifras de la `Proof` cuadran
   con las papeletas; `cast` y `represented` se muestran por separado (`E23`).
2. **Ejecución.** La propuesta exige plan previo; cambiar sólo el plan crea otra versión; una decisión
   aprobada crea exactamente una iniciativa enlazada con fecha y criterios, y el resultado conduce a
   ella. Abrir y cerrar se recorren también desde la interfaz de facilitación (ADR-0043). Tras la
   ventana real de impugnación, ratificar activa esa misma iniciativa; se crea un hito, se ofrece una
   tarea y otra sesión la acepta. Antes de aceptar no aparece responsable. Una respuesta a la oferta
   anterior tras reofertar falla sin cambiar la vigente. Aceptar exige una elección sin valor
   predeterminado. Si el servidor guarda una orden y se pierde sólo la respuesta, el reintento usa la
   misma clave y no duplica el hecho (ADR-0044).
3. **Inmutabilidad.** Se altera el ledger **por debajo de la aplicación** —`UPDATE` directo sobre el
   payload de un evento intermedio— y la verificación **lo denuncia**: señala el `seq` exacto donde se
   rompe la cadena y la decisión queda en cuarentena. La prueba simétrica es igual de obligatoria: sin
   alteración, **no** denuncia nada.
4. **Versionado.** V1 se enmienda a V2 (`ObjectionIntegrated` con `signedBy`, `E17`) y se abre nueva
   ronda. **V1 sigue intacta y consultable**, sus papeletas no se arrastraron (INV-09), y el enlace
   entre versiones es navegable en los dos sentidos.
5. **Permisos por rol.** Matriz de roles × operaciones. Cada celda prohibida se intenta **dos veces**:
   desde la interfaz (control oculto) y **por llamada directa a la API** con la sesión del rol inferior
   (403, sin ejecutar nada). El segundo intento es el que vale.
6. **Voto secreto.** Con `privacy:'secret-ballot'`: el detalle nominal no aparece en ninguna respuesta
   de la API, ni para un administrador; los agregados sí; la delegación está prohibida por
   configuración y la interfaz lo explica (INV-32, ADR-0030). Se inspecciona el tráfico de red.
7. **Delegación.** Conceder, revocar, cadena de dos saltos, cadena rota con su aviso obligatorio
   (C.4.3), tope de concentración con devolución LIFO. Revocar **antes** del cierre cambia el
   resultado; **después**, no.
8. **Privacidad.** Supresión de datos personales: la PII desaparece del PII Vault (borrado físico,
   ADR-0009) y **el historial sobrevive** — eventos intactos, cadena de hashes íntegra, resultados
   recomputables, y donde había un nombre hay un `MemberId` sin significado. Suprimir PII no puede
   romper la verificación: es lo que ADR-0007 y ADR-0008 garantizan.
9. **Recuperación.** Restaurar un backup completo y verificar el ledger de punta a punta: cadena por
   agregado, checkpoints, `heads_root`, y el re-shred de retención de ADR-0020.

**Datos y aislamiento.** Cada escenario **construye su propio universo** por llamadas a la API (no
`INSERT` directos) desde una base vacía; sin *fixtures* globales, que son la fuente principal de
acoplamiento en E2E. Una base por *worker*; un contexto de navegador por sesión; identificadores con
prefijo único por ejecución. Cualquier escenario debe poder correr solo, lo que se verifica con
`--shuffle`. El reloj es inyectable: los que dependen de ventanas **lo avanzan**, no esperan.

---

## 7. Matriz de navegadores

| Navegador | Viewport | Cuándo | Qué corre |
|---|---|---|---|
| **Chromium** | escritorio 1440×900 | cada PR | los 9 escenarios |
| **Firefox** | escritorio 1440×900 | cada PR | 1, 3, 5, 6 |
| **WebKit** | escritorio 1440×900 | cada PR | 1, 3, 5, 6 |
| **Mobile Chrome** (Pixel 7) | 412×915 táctil | nightly + release | 1, 5, 6, 7 |
| **Mobile Safari** (iPhone 14) | 390×844 táctil | nightly + release | 1, 5, 6, 7 |
| Chromium | tableta 820×1180 | nightly | 1, 4 |
| Chromium | móvil pequeño 360×640 | nightly | 1 |

**Condiciones adicionales.** *Red lenta*: Slow 3G (400 kbps, 400 ms RTT) sobre el escenario 1; la
papeleta debe poder emitirse y el estado de «enviando» debe ser inequívoco. No es hipotético: el
campus tiene zonas con mala conectividad y la ventana es dura (`castAt < closesAt`, sin gracia).
*Teclado*: escenario 1 completo sin tocar el ratón, con foco visible y sin trampas. *Táctil*:
escenarios 1 y 7 con gestos reales y objetivos ≥ 24×24 px (WCAG 2.2).

**Por qué WebKit en cada PR y móvil sólo en nightly:** las divergencias de motor (`Intl`, fechas,
`:has()`, formularios) son de corrección lenta y hay que verlas pronto; las diferencias móviles son de
disposición y gesto, se detectan en revisión visual y no justifican duplicar cada PR.

---

## 8. Exploratorias con agentes

Formato de reporte **obligatorio**:

```
escenario | pasos | esperado | obtenido | evidencia | severidad
```

**Se rechazan sin discusión los reportes vagos.** «La interfaz es confusa» o «parece que hay un
problema con los permisos» no son hallazgos: son impresiones. Un hallazgo sin pasos reproducibles no se
confirma, no se corrige y no se convierte en test de regresión, que es lo único que impide que el bug
vuelva. Un reporte fuera de formato se devuelve; no se «interpreta caritativamente» — la misma regla
que el motor aplica a las papeletas malformadas.

### Plantilla literal del prompt

```text
Sos un tester exploratorio de Koinonía, una plataforma de gobernanza colectiva para el
Instituto de Filosofía de la Universidad de Antioquia. Tu trabajo es ENCONTRAR FALLOS, no
confirmar que funciona. Si terminás sin hallazgos, el resultado esperado es que digas
exactamente qué probaste y por qué creés que no hay nada ahí — no que digas «todo bien».

CONTEXTO
- URL del entorno: {URL}
- Credenciales: rol {ROL}: {USUARIO} / {CLAVE}  (usá SOLO este rol salvo indicación)
- Área a explorar: {AREA}
- Qué hace esa área: {DESCRIPCION_FUNCIONAL_EN_3_LINEAS}
- Qué NO debe poder pasar nunca ahí: {INVARIANTES_DE_NEGOCIO}
- Documentos aplicables: {ADR_Y_SECCIONES}

REGLAS
1. No modifiques código ni base de datos. Sos un usuario, no un desarrollador.
2. Probá el camino feliz UNA vez para orientarte. El resto del tiempo, salite de él.
3. Buscá específicamente: valores límite (0, 1, vacío, máximo, máximo+1), el instante exacto
   del cierre, dobles envíos, dos pestañas con la misma cuenta, el botón atrás, recargar a
   mitad de un formulario, sesiones que caducan, campos con emoji y con texto de derecha a
   izquierda, pegar 10 000 caracteres, y toda operación intentada por llamada directa a la
   API saltándote la interfaz.
4. Cuando encuentres algo raro, PARÁ y minimizá: cuál es la secuencia más corta que lo
   reproduce. Un hallazgo con 12 pasos de los cuales 9 sobran es medio hallazgo.
5. Verificá cada hallazgo DOS veces antes de reportarlo. Si no se reproduce, decilo.

FORMATO DE REPORTE — obligatorio, una fila por hallazgo, sin excepciones:

| escenario | pasos | esperado | obtenido | evidencia | severidad |

- escenario: una frase, qué estabas intentando hacer.
- pasos: numerados, literales, reproducibles por alguien que no estuvo. Incluí los datos
  exactos que usaste.
- esperado: qué debía pasar y de dónde sale esa expectativa (documento y sección, o
  «comportamiento evidente» si es obvio).
- obtenido: qué pasó exactamente. Mensajes literales, códigos HTTP literales.
- evidencia: captura, traza de red, id del evento, o el `curl` que lo reproduce.
- severidad: S0 | S1 | S2 | S3 | S4 según la rúbrica. Ante la duda entre dos niveles,
  elegí el MAYOR y decí por qué dudás.

PROHIBIDO: reportes sin pasos; «parece que»; «podría ser»; agrupar tres hallazgos en una
fila; inventar una severidad sin justificarla; reportar como fallo algo que el documento
aplicable declara comportamiento correcto (si creés que el documento está mal, reportalo
como hallazgo de DOCUMENTO, con la cita literal y la sección exacta).
```

### Rúbrica de severidad

| Nivel | Criterio | Ejemplos | Qué desencadena |
|---|---|---|---|
| **S0 — Crítica** | El resultado puede alterarse o falsificarse; el ledger acepta historia alterada **o denuncia falsamente manipulación**; se rompe el secreto del voto; se filtra PII fuera del PII Vault; alguien vota sin estar en el padrón, dos veces o fuera de la ventana | `E1`; papeleta aceptada con `castAt === closesAt`; detalle nominal visible en `secret-ballot`; cierre manual sin firmas (`E19`) | **Congela la release.** Se corrige antes que nada. Test de regresión + revisión adversarial independiente + nota en `reportes/` |
| **S1 — Grave** | Pérdida de función esencial sin alternativa; autorización horizontal o vertical rota sin alterar resultados; datos correctos presentados de forma que inducen a error sobre el desenlace; caída bajo carga esperada | ver el borrador de otro círculo; no poder votar en el último minuto; `Proof` cuyas cifras no cuadran con su tabla | **Bloquea el merge** y la release |
| **S2 — Moderada** | Función degradada con rodeo posible; error mal manejado; incumplimiento AA en flujo no crítico; presupuesto de rendimiento excedido sin romper | 500 con *stack trace* al subir un adjunto; contraste insuficiente en la lista de acuerdos | Se corrige en el sprint; no bloquea si el rodeo está documentado |
| **S3 — Menor** | Molestia sin pérdida de función; textos inconsistentes; tabulación subóptima | «Cerrar» y «Finalizar» para la misma acción | Backlog priorizado |
| **S4 — Cosmética** | Estética, alineación, redacción | margen de 3 px | Backlog |

**Tres reglas innegociables.** (1) **Ante la duda entre dos niveles gana el mayor**, y se anota la
duda. (2) **Si el hallazgo toca el ledger, el padrón, el escrutinio, la autorización o el secreto del
voto, el piso es S1** aunque parezca cosmético: ahí no existe «cosmético», y un texto que describe mal
el denominador de un umbral es un problema de legitimidad, no de redacción (B.1.a obliga a mostrar esa
frase **en la papeleta**). (3) **La severidad la propone quien reporta y la confirma quien hace
triage**, que no es la misma persona; bajarla exige justificación escrita en el mismo reporte.

---

## 9. Adversarial testing

**Quien implementa no es quien revisa.** No es desconfianza: quien escribió el código ya decidió, sin
darse cuenta, qué casos son «razonables», y esa decisión es la que hay que atacar. La revisión la hace
otra persona —u otro agente, con contexto distinto y sin acceso al razonamiento del implementador— y su
objetivo declarado es **romper**. Obligatoria en motor de decisión, ledger, urna, padrón, PII Vault y
autorización.

| Vector | Qué se intenta | Qué debe pasar |
|---|---|---|
| **Concurrencia** | N votando a la vez; N prórrogas y un cierre simultáneos | `seq` denso y único; exactamente un cierre; ningún hueco |
| **Carreras** | votar en `closesAt − 1 ms` con latencia inducida; alta en el milisegundo de `frozenAt` | la frontera semiabierta decide, siempre igual (`E16`) |
| **Doble envío** | «votar» dos veces; reintento de red; dos pestañas | una sola papeleta efectiva (INV-08); la última manda (INV-07) |
| **Replay** | reenviar un evento ya aceptado | rechazo por `seq`/`prevHash`; el estado no se mueve |
| **Cambios de reloj** | cliente adelantado/atrasado; salto del reloj del servidor | ningún efecto: `castAt` lo asigna el servidor (D.3.c) y el escrutinio no lee el reloj (INV-15) |
| **Entradas malformadas** | score `7`, ranking con repetidos, `grades` incompleto, `object` sin objeción, 10 000 caracteres, emoji, RTL, nulos | rechazo, **nunca normalización silenciosa** (INV-01, INV-12) |
| **IDs manipulados** | 36 caracteres, mayúsculas, base32, ajenos, inventados | rechazo por el `CHECK` y el validador (`E1`) |
| **Autorización horizontal** | recursos de otro miembro o círculo cambiando el id en la URL | 403, sin filtrar si el recurso existe |
| **Autorización vertical** | operaciones de administrador con sesión de miembro | 403 en el servidor, no sólo botón oculto |
| **API directa** | todo lo anterior por `curl` | idéntico: la interfaz no es capa de seguridad |
| **Orden y duplicados** | `seq` no denso; evento ilegal en posición aleatoria; terminal seguido de otro | `IllegalTransitionError`, estado inalterado (INV-34, INV-36) |
| **Corrupción del ledger** | `UPDATE` de un payload; borrar; reordenar; recalcular un hash «bien» | detección con el `seq` exacto; cuarentena; imposible ratificar |

Cada vector que produce un hallazgo se convierte en **test permanente**, no en una nota.

---

## 10. Mutation testing

La cobertura dice qué líneas se ejecutaron; la mutación dice si **las aserciones sirven de algo**.

> **Si mutar una regla fundamental no rompe ningún test, los tests son insuficientes** — por mucho
> que la cobertura diga 100 %.

| Objetivo | Umbral de fallo | Objetivo | Cuándo |
|---|---|---|---|
| `packages/crypto` (todo) | **85 %** | 95 % | nightly y en todo PR que lo toque |
| `packages/domain/src/tally/**` | **85 %** | 92 % | nightly y en todo PR que lo toque |
| `packages/domain/src/{quorum,window,state-machine,electorate,ballot}.ts` | **85 %** | 92 % | ídem |
| `packages/domain` (resto) | **75 %** | 85 % | nightly |
| `services/api` (sólo autorización y validación) | **60 %** | 75 % | nightly |
| `packages/contracts`, `apps/web` | no se ejecuta | — | — |

**Dónde es rentable.** Es cara —multiplica el tiempo de la suite por decenas— y sólo paga donde el
código es **denso en decisiones y pobre en efectos**: umbrales, límites de ventana, operadores
estrictos, fronteras. `crypto` y `domain/src/tally/` son eso. En `apps/web` las mutaciones caen sobre
marcado y estilos y no informan; en `contracts` casi todo son tipos, que Stryker no muta.

**Mutantes especialmente vigilados** (si sobreviven es un hallazgo, no una estadística):
`strict ? c > 0 : c >= 0` —la diferencia entre aprobar y rechazar «200 de 300» con umbral 2/3—;
`castAt < closesAt` → `<=`, el milisegundo del cierre; `enrolledAt < frozenAt` → `<=`, que es `E16`;
`den > 0 && approve === den` sin guarda, la unanimidad vacía (INV-52); y `Math.floor(W/2)` → `ceil` en
la mediana, INV-49. Los mutantes equivalentes se declaran con `// Stryker disable next-line` **y un
comentario que explique por qué lo son**; sin comentario, la exclusión no pasa revisión.

---

## 11. Rendimiento

| Métrica | Presupuesto |
|---|---|
| `tally` con `N = 300` sin delegación | < 50 ms (p95) |
| `tally` con `N = 300` y grafo denso (`maxDepth = 4`) | < 200 ms (p95) |
| `replay` de un log de 1 000 eventos | < 150 ms (p95) |
| Verificación completa del ledger, 100 000 eventos | < 60 s |
| `POST /ballots` con 100 usuarios concurrentes | p95 < 400 ms, p99 < 1 s, 0 errores |
| Pico de cierre: 300 papeletas en los últimos 60 s | 0 rechazos por *timeout*; `seq` sin huecos |
| Pantalla de votación en Slow 3G | LCP < 2,5 s · INP < 200 ms · CLS < 0,1 |
| Bundle inicial de `apps/web` | < 250 kB comprimido |

**El escenario que de verdad importa es el pico de cierre.** El uso de una asamblea no es uniforme:
casi nadie vota el primer día y mucha gente vota en la última hora, porque la ventana es dura y no hay
gracia. Una degradación a las 17:59 no es un problema de rendimiento: es **privación del derecho a
votar**, y la papeleta rechazada por *timeout* a las 18:00:00 no se recupera nunca.

**Cuándo.** Microbenchmarks de `domain` y `crypto` en cada PR que los toque: regresión > 20 % frente a
`main` **falla el build**; entre 10 % y 20 % avisa. k6 nightly y antes de cada release. Web vitals en
cada PR que toque `apps/web`. Ledger a escala, nightly.

---

## 12. Accesibilidad

**Mínimo obligatorio: WCAG 2.2 nivel AA.** Un sistema que decide en nombre de todos y que una parte de
esos todos no puede usar no mide la voluntad colectiva: mide la de quienes pueden usarlo.

**axe-core**, integrado en Playwright, corre en **cada pantalla de cada escenario E2E** con **cero
violaciones** de nivel A y AA — sin umbral parcial. Se comprueban también los estados —modales,
formularios con error, listas vacías, cargas—, donde vive la mayoría de las violaciones reales.

**Revisión manual**, trimestral y en toda pantalla nueva del flujo de voto: recorrido sólo con teclado
(orden lógico, foco visible, sin trampas, `Escape` cierra); lector de pantalla con **NVDA + Firefox** y
**VoiceOver + Safari** sobre el escenario 1; zoom al 200 % y 400 % sin pérdida de contenido ni función;
`prefers-reduced-motion` respetado; objetivos táctiles ≥ 24×24 px.

Y lo no automatizable: **la papeleta debe decir en castellano común qué pasa con las abstenciones y
cuál es el denominador** (B.1.a). Que un lector de pantalla lea «umbral de supermayoría sobre base
*cast* con política *exclude*» no sirve de nada. La prohibición de jerga (0.A, ADR-0041) es un
requisito de accesibilidad cognitiva y se verifica leyéndolo.

---

## 13. Pipeline escalonado

**Durante la implementación** (local, segundos): `vitest --watch` sobre el paquete tocado con
`FC_RUNS=100`. Este nivel **no autoriza a dar nada por terminado**.

**Antes del commit** (local, < 60 s), sobre los ficheros *staged*: `prettier --check` y `eslint`;
`tsc -p tsconfig.check.json` completo —rápido, y ataja el 80 % de lo que rompería CI—;
`node scripts/check-domain-purity.mjs` (ADR-0001); y las suites de los paquetes tocados con
`FC_RUNS=200`. El hook **no se salta con `--no-verify`**: si hay que saltárselo es que el hook está mal,
y se arregla el hook.

**En el PR** (< 10 min): lo que ya hace `.github/workflows/ci.yml` (pureza → typecheck → lint → test →
build) más unitarias y propiedades con `FC_RUNS=1000` y los umbrales de §3; integración con
Testcontainers; E2E en Chromium (los 9) y Firefox/WebKit (1, 3, 5, 6); axe-core en cada pantalla;
mutación **si el diff toca `packages/crypto` o `packages/domain/src/tally/`**; y microbenchmarks si toca
`domain` o `crypto`.

**En `main`:** todo lo del PR sin recortes, más despliegue a *staging* y el escenario 9 contra el
backup nocturno real. **Nightly:** `FC_RUNS=10000`; mutación completa; E2E en la matriz móvil y de
viewports; k6; verificación de ledger a escala con ciclo `pg_dump`/`pg_restore`; y la suite E2E en
**orden aleatorio** para detectar acoplamientos.

**Paralelización, caché y sharding.** Vitest en *threads*, un *worker* por núcleo; Playwright con
`fullyParallel` y base efímera por *worker*; E2E en 4 *shards* repartidos por duración histórica. Caché
de `pnpm`, `.tsbuildinfo`, imágenes de Testcontainers por dígest y navegadores por versión; la clave
incluye `pnpm-lock.yaml` y `.nvmrc`.

**Cómo se determina que un cambio no puede afectar a una suite.** Por el **grafo de dependencias del
workspace**, nunca por intuición ni por nombre de carpeta: `pnpm --filter '...[origin/main]'` incluye
cada paquete tocado y todo lo que depende de él. Sobre eso, cuatro reglas duras:

1. **Un cambio en `packages/crypto` invalida todo.** Es la hoja del grafo (ADR-0001, `E8`): todo depende
   de él. No se salta ninguna suite, nunca.
2. **Si el diff toca `packages/domain/src/`, las propiedades corren completas**, sin selección.
3. **Cambios sólo en `docs/`, `*.md` o `reportes/`:** lint de formato y **verificador de citas del
   corpus** —toda cita entre documentos debe existir literalmente en el documento citado, lección de
   `C4`—. No corre la suite de código.
4. **Cambios sólo en `apps/web/`:** no corren las propiedades ni `crypto`; sí E2E, axe y bundle size.
   Si el diff toca además cualquier `packages/`, la excepción se anula.

Regla de cierre: **ante la duda, corre todo.** Una suite de más cuesta minutos; una de menos, un `E1`
en producción.

---

## 14. Regla sobre los fallos — innegociable

Cuando un test falla hay exactamente dos posibilidades: **bug del producto** o **bug del test**.
Determinar cuál es el primer paso y no es opcional.

**Lo prohibido, sin excepciones.** Nunca se borra un test porque falla. Nunca se rebaja una aserción
(`toEqual` → `toBeDefined`, quitar un campo, ampliar una tolerancia). Nunca se usa `skip`, `only` ni
`todo` en silencio: un `skip` sin incidencia y sin fecha es deuda invisible que se vuelve permanente.
**Nunca se cambia comportamiento correcto para satisfacer un test incorrecto** — el fallo que la spec
documenta con IRV y la monotonía (§4). Y nunca se baja un umbral en el mismo PR que lo incumple.

**Ante un test rojo.**

1. **Reproducir localmente** —con propiedades la semilla fija lo garantiza— y **leer el contraejemplo
   antes de tocar nada**: suele decir exactamente qué regla se violó.
2. **Decidir de qué lado está el error, y escribirlo en el PR:**
   - **Bug de producto** → se corrige el producto; el test se queda **igual**, y si el contraejemplo
     era aleatorio se congela además como caso determinista.
   - **Bug de test** → se corrige el test, y el PR **explica por qué la expectativa anterior era
     incorrecta**, con sección exacta y cita literal del documento normativo. «El test estaba mal» sin
     cita no pasa revisión.
   - **Bug de especificación** → ninguno de los dos arreglos vale. Se eleva: se registra en
     `00-contradicciones-resueltas.md`, decide el arquitecto, se corrige el pasaje exacto y **después**
     se ajustan código y test. Es lo que se hizo con los 20 errores de la parte 3, y hay que usar este
     camino: un tercio de los fallos de este proyecto han sido de esta clase.
3. **`main` roto es la máxima prioridad del equipo.** Nadie fusiona sobre rojo; si la corrección no es
   inmediata se revierte el commit que lo rompió. Revertir no es un fracaso: restaura la línea base.

**Ante un test inestable.** Uno que pasa a veces es **peor que uno que falla siempre**: entrena a la
gente a reintentar, y reintentar es la forma más eficiente de ignorar un bug real de concurrencia.

1. **No se reintenta para taparlo.** `retries` en CI está prohibido como política; sólo se admite
   temporalmente y con incidencia abierta.
2. **Se cuantifica:** 100 ejecuciones (`--repeat-each=100`), registrando la tasa de fallo.
3. **Se busca la causa en este orden:** reloj real; orden entre pruebas; estado compartido sin limpiar;
   espera por tiempo en vez de por condición; concurrencia real del sistema bajo prueba.
4. **La quinta causa es un hallazgo, no un problema del test:** si es inestable porque el sistema tiene
   una carrera, el test está haciendo su trabajo y la corrección va en el producto.
5. **Si en 48 h no se ha diagnosticado**, se marca `skip` **con** enlace a la incidencia, tasa de fallo
   medida, fecha límite y responsable. Sin esas cuatro cosas, se revierte en la revisión.

---

## Referencias

- `docs/research/30-decision-engine-spec.md` — PARTE E: 60 invariantes y 7 anti-invariantes.
- `docs/research/00-contradicciones-resueltas.md` — parte 3: los ~20 errores de la implementación.
- `docs/MODEL_CONTEXT.md` · `docs/adr/0001-...md` · `scripts/check-domain-purity.mjs`
- `.github/workflows/ci.yml` — el pipeline vigente, que §13 extiende.
