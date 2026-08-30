# Estrategia de pruebas de Koinonía

> **Estado:** normativo. Documenta una estrategia **en marcha**, no un plan. Hoy el repositorio tiene
> **2 495 pruebas en verde repartidas en 151 ficheros** (`pnpm exec vitest run`, 2026-08-23) —el
> desglose exacto por paquete varía con cada PR; `pnpm run test:coverage` deja el conteo y el
> porcentaje vigentes en `coverage/coverage-summary.json` en vez de fijarlo aquí, donde envejece sin
> que nadie lo note—, entre ellas las **propiedades de fast-check** mapeadas a un invariante de la
> PARTE E de la spec 30. A eso se suman los 14 ficheros de especificación de extremo a extremo en
> `tests/e2e/` (Playwright, §6-§7).
>
> **Fecha:** 2026-08-23 · Lo exigido a `packages/*`, a `services/api` y al corte vertical ya se
> cumple; `apps/web` se cubre por extremo a extremo y no tiene suite unitaria propia (§3).

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

## 0bis. Dónde corre esto hoy: NO en GitHub

Conviene saberlo antes de leer el resto, porque cambia qué garantiza cada cosa de acá.

`.github/workflows/ci.yml` está escrito y no ha ejecutado ni un paso desde hace semanas: la cuenta
tiene la facturación bloqueada, y cada trabajo muere en tres segundos con «The job was not started
because your account is locked due to a billing issue». Cuarenta y ocho corridas, cero verdes, cero
pasos. Se comprueba con `gh run view <id>` — no hay pasos que mirar, no es que fallen.

O sea que **lo que impide que algo roto llegue a `main` es lo que se corra en la máquina de quien
empuja**, y nada más. Mientras eso siga así, hay un gancho de `pre-push` en `.githooks/pre-push` que
corre lo mismo que el trabajo principal de CI —tipos, estilo, pureza del dominio y la suite—:

```bash
git config core.hooksPath .githooks    # una vez por clon; git NO lo hereda al clonar
```

Lo que ese gancho **no** es: no es CI. Corre en una sola máquina, con las dependencias de esa
máquina, y se salta con `git push --no-verify`. Si no hay Docker levantado, avisa y corre sólo lo
que no necesita PostgreSQL — lo dice, no lo esconde. Lo único que resuelve es que el camino fácil,
`git push`, sea también el que comprueba, en vez de depender de acordarse.

Cuando la facturación se desbloquee, esto no estorba: CI vuelve a ser la autoridad y el gancho pasa
a ser una red de seguridad más rápida que además corre antes de gastar minutos de máquina ajena.

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

Configurados de verdad en `vitest.config.ts` (`test.coverage.thresholds`, una entrada por *glob* de
paquete) desde el 2026-08-23, **remedidos el 2026-08-25**. Fallar el umbral **falla el build**: lo
ejecuta `pnpm run test:coverage`, que reemplaza a `pnpm run test` en el job `verificar` de
`.github/workflows/ci.yml`.

**Cada piso es la cobertura REAL medida ese día** (`pnpm exec vitest run --coverage`), **redondeada
hacia abajo al entero** — nunca un número aspiracional puesto de antemano. Dos razones, las dos
aprendidas por las malas en otros proyectos: un piso más alto que lo real bloquea el primer PR
después de escribirlo por algo que nadie rompió; y un piso puesto «a ojo» sin medir esconde
exactamente lo que este mecanismo existe para mostrar — qué paquete está peor probado. El umbral es
**por paquete**, no global, por la misma razón: un número único promedia `packages/contracts` (99 %)
con `services/api` (80 %) y el promedio no dice cuál de los dos hay que mirar. Es un **trinquete**:
sólo sube cuando alguien escribe pruebas de verdad, y sólo baja en un PR que lo declare y justifique
por qué (§14).

**Remedición del 2026-08-25** (2 824 tests en verde en 179 ficheros, dos días después de la medición
original, con el resto del equipo escribiendo en paralelo): siete de los ocho paquetes no superaron
el redondeo de la medición anterior y el piso queda igual. Dos sí lo superaron con pruebas nuevas y
reales —no ruido de redondeo— y el trinquete subió con ellos: `packages/contracts` pasó de 95 %/97 %
a **96 %/98 %** de ramas/funciones (`packages/contracts/test/consultas-de-estado.test.ts`, nuevo) y
`services/api` pasó de 79 %/67 %/82 %/81 % a **80 %/68 %/83 %/82 %**
(`tests/integration/http-estado-sesion.test.ts`, nuevo). Ninguna baja: `pnpm exec vitest run
--coverage` con los umbrales ya actualizados sale en verde (código de salida 0) contra el mismo
código que dejó esta remedición.

La medición cubre **sólo `src/**`** de cada paquete — `coverage.exclude` saca `**/test/**`, donde
viven los ayudantes (`arbitraries.ts`, `fabrica.ts`, `matrices.ts`, `datos.ts`, `testigos.ts`,
`tally-helpers.ts`): no son código de producción, y contarlos infla el número sin proteger nada.

| Paquete | Sentencias | Ramas | Funciones | Líneas | Notas |
|---|---|---|---|---|---|
| `packages/crypto` | 94 % | 89 % | 100 % | 96 % | congelado para décadas; ver más abajo |
| `packages/domain` | 90 % | 83 % | 96 % | 91 % | el motor de la gobernanza; ver más abajo |
| `packages/contracts` | 99 % | 96 % | 98 % | 99 % | casi todo son tipos; ya cubierto de sobra |
| `packages/anchor` | 88 % | 78 % | 96 % | 91 % | anclaje externo (Git, OpenTimestamps, correo testigo) |
| `packages/consensus` | 97 % | 72 % | 94 % | 97 % | análisis de consenso (factorización, k-means, PCA) |
| `packages/metrics` | 97 % | 92 % | 100 % | 97 % | métricas colectivas (ADR-0039/0040: nunca por persona) |
| `packages/verifier-cli` | 87 % | 76 % | 95 % | 87 % | el verificador independiente de línea de comandos |
| `services/api` | 80 % | 68 % | 83 % | 82 % | el paquete peor cubierto: ver nota abajo |
| `apps/web` | — | — | — | — | **no tiene umbral de Vitest**: no hay ninguna suite unitaria que lo instrumente (ninguna prueba bajo `apps/web/` corre con Vitest — `vitest.config.ts` no lo incluye), y su cobertura real es E2E (§6), que Vitest no mide. Ponerle un número aquí sería inventarlo. |

**Por qué ramas altas en `crypto` y `domain` importan aunque el piso no sea 100 %.** `crypto` son
~600 líneas que deben quedar congeladas durante décadas —cambiarlas invalida toda la historia
anclada— y son lo que se publica como verificador independiente; `domain` está lleno de decisiones
binarias que **son** la gobernanza: `strict ? '>' : '≥'`, `abstentionBlocks`, `silenceMeans`,
`onFailure`. Cada rama sin cubrir en cualquiera de los dos es una regla que nadie ejecutó nunca, y la
cobertura de líneas no las ve: un `return strict ? c > 0 : c >= 0` se cubre entero con un solo caso.
El piso de hoy (89 % y 83 % de ramas respectivamente) no es el objetivo final — es de dónde no se
puede bajar sin decirlo.

**Por qué `services/api` está más bajo que el resto.** No es indiferencia: `server.ts` (60 % de
líneas, sin cambios en la remedición del 2026-08-25) es el `bin` que arranca el proceso —listeners,
señales de apagado— y se ejerce por E2E, no por unidad; `db/client.ts` y varios adaptadores de
anclaje (`socket.ts`, `tarea.ts`) tienen ramas de reconexión y reintento de red que sólo se disparan
bajo fallos de infraestructura reales. Subir el
piso ahí a la fuerza sería exactamente la trampa que §14 prohíbe: cobertura fabricada con `as any`
sobre estados que no ocurren en una prueba honesta.

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

Para ADR-0045, dos aceptaciones sobre el mismo último cupo y la carrera aceptar-versus-bajar
capacidad se ejecutan con transacciones distintas: el orden `ledger → miembro` evita deadlock, no
duplica carga y bloquea la siguiente aceptación. Evidencia y resumen se cifran y comprometen en el
mismo commit que el evento; ciphertext, contexto o compromiso alterados fallan cerrados. Las pruebas
de lectura comparan recurso real e inventado para un tercero y para el aportante cuya membresía fue
retirada. Otra integración fuerza el mismo `eventId` en dos agregados y comprueba que PostgreSQL
revierte también el puntero de la espina y conserva el ledger verificable. Las regresiones
adversariales quitan después ese índice y exigen que tanto el verificador del servidor como el CLI
independiente detecten el duplicado semánticamente; dos lecturas privadas concurrentes se sincronizan
para demostrar que no ascienden `FOR SHARE` a `FOR UPDATE`; textos de 1 byte y 16 KiB producen el
mismo ciphertext de 131 088 bytes; y `/integridad` queda rojo ante apertura alterada, faltante o
huérfana sin incluir texto ni identificadores privados en el informe.
La pareja de supresión crea una apertura real, exige solicitud propia desde una sesión de diez
minutos o menos y comprueba que el ejecutor sólo recibe el agregado: seq 1 enlaza ID y hash de seq 0,
borra físicamente al sujeto y mantiene verde la comprobación local. Se prueban schema estricto sin
`subjectId`, confirmación irreversible, sesión vieja, replay, dos solicitudes concurrentes y dos
ejecutores concurrentes. Otras regresiones fuerzan un identificador inválido después del `DELETE`
para demostrar rollback, borran una solicitud todavía pendiente y fabrican `DELETE` más un tombstone
exacto sin solicitud; todos los caminos no autorizados quedan rojos sin filtrar texto, material ID,
correo ni token. También se afirma que la página no presenta esta auditoría local como algo que el
export público pueda reproducir.

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
   misma clave y no duplica el hecho (ADR-0044). La persona declara capacidad privada, comienza,
   bloquea, pide ayuda, reanuda, agrega evidencia y entrega; el responsable pide cambios, recibe otra
   entrega y la acepta. Se prueba por API que otra cuenta no puede leer capacidad o evidencia
   restringida, que una dependencia pendiente impide empezar y que dos aceptaciones sobre el último
   cupo dejan una sola confirmada (ADR-0045).
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

**Lo que corre hoy, verificado contra `playwright.config.ts` y contra los tres flujos de trabajo de
`.github/workflows/` (`ci.yml`, `e2e-matriz-completa.yml`, `nocturno.yml`).** Los cinco proyectos de
la tabla son los ÚNICOS que existen — no hay proyecto de tableta ni de móvil-pequeño-con-Chromium:
esa fila, que este documento tuvo en versiones anteriores, describía algo que nunca se implementó.

| Proyecto (`--project=`) | Motor · dispositivo | En cada PR (`e2e-pr`) | Al integrar en `main` (`e2e-main`) | De noche (`nocturno.yml`) |
|---|---|---|---|---|
| `chromium` | Chromium escritorio | ✅ toda `tests/e2e/*.spec.ts` | ✅ | ✅ |
| `firefox` | Firefox escritorio | — | ✅ | ✅ |
| `webkit` | WebKit escritorio | — | ✅ | ✅ |
| `chrome-movil` | Chromium · Pixel 7 (`devices['Pixel 7']`) | — | ✅ | ✅ |
| `safari-movil` | WebKit · iPhone 14 (`devices['iPhone 14']`) | — | ✅ | ✅ |

**Por qué el PR corre sólo Chromium.** El ciclo de revisión tiene que caber en el tiempo que alguien
está dispuesto a esperar mirando la pestaña, y la mayoría de las regresiones aparecen en el primer
navegador. `firefox`/`webkit`/`chrome-movil`/`safari-movil` sólo existen como proyectos de Playwright
cuando `KOINONIA_MATRIZ=completa` (`playwright.config.ts:26-41`); `e2e-pr` no fija esa variable, así
que en un PR esos cuatro proyectos **ni siquiera se crean** — no es que se salten, es que no existen
para esa corrida.

**Qué NO se ejecuta, y por qué.**

- **WebKit fuera de CI, nunca.** `playwright install --with-deps` en las máquinas del equipo
  (Arch/CachyOS) usa `apt-get` para las dependencias del sistema que WebKit necesita
  (`libicu`, `libxml2`, `libflite1`, `libmanette`, entre otras), y Arch dejó de distribuir las
  versiones exactas que pide. El navegador se descarga pero no arranca. CI (`ubuntu-latest`) es el
  único sitio donde WebKit corre, y por eso ningún paso de `e2e-matriz-completa.yml` lleva
  `continue-on-error`: si el único lugar donde se prueba además perdona sus fallos, deja de estar
  probado y nadie se entera.
- **Firefox, Chrome móvil y Safari móvil, fuera de `main` y de la corrida nocturna.** Misma
  limitación de `--with-deps` que WebKit (Firefox además necesita las librerías del sistema), y
  duplicar la matriz completa en cada PR no cabe en el tiempo de revisión.
- **Viewports de tableta y de móvil pequeño con Chromium.** No existen como proyecto de Playwright
  — sólo los cinco de la tabla. Si hace falta cubrir esos anchos, se prueban dentro de un escenario
  existente con `page.setViewportSize`, no como proyecto nuevo, salvo que se decida lo contrario.

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

### Sesión real — 2026-08-24

Primera corrida de verdad de este mecanismo: nunca se había lanzado ni un obrero. Se levantó la
interfaz de desarrollo real (web en `:3199`, API en `:3001`, el mismo PostgreSQL de siempre detrás,
sin dobles) y se lanzaron **10 obreros MiniMax en paralelo** (`enjambre.sh minimax`), cada uno con
una misión concreta de una sola área — problemas, propuestas y enmiendas, votación, autorización
horizontal/vertical, deliberaciones, delegaciones, iniciativas/capacidad, mensajes de error y jerga
prohibida, navegación/enlaces rotos, sesión — usando exactamente la plantilla de arriba y el modo de
entrar por `enlaceDeDesarrollo` (sin servidor de correo).

**Lo que pasó con el enjambre, dicho tal cual, no lo que se esperaba que pasara.** De los 10, 8
terminaron sin reporte: 6 por *timeout* del propio obrero (`ENJAMBRE-TIMEOUT`, ni una línea de
salida recuperable — el intérprete bufferiza toda la salida y un `timeout` la mata sin volcarla) y 2
por un error interno de la herramienta de MiniMax a mitad de sesión (`Failed to execute statement`,
en un caso además un límite de tasa del propio proveedor). **Ninguno de los 10 entregó la tabla en
el formato exigido.** Esto no es «no había nada que encontrar»: es que la infraestructura del
enjambre barato falló ese día más de lo que el pliego asumía — dato real para quien decida cuánto
confiarle a esta vía sin supervisión, y contradice el «MiniMax sobra, gastalo sin miedo» de la
consigna operativa: hoy no sobró, se agotó a media sesión más de una vez.

Dos de los ocho fallidos (`misión 2`: propuestas/enmiendas; `misión 4`: autorización horizontal)
alcanzaron a dejar una transcripción parcial larga (37-47 KB de `curl` real contra el entorno) antes
de caerse. Ninguna de las dos aportó un hallazgo nuevo: ambas **confirmaron** por su cuenta lo mismo
que la verificación directa de abajo — enmendar con el mismo contenido se rechaza
(`VERSION_UNCHANGED`), y B no puede retirar evidencia de A (403). Se descartan como reporte formal
(no llegaron a la tabla final ni se verificaron dos veces por el propio obrero, que es la regla), y
se usan sólo como corroboración de segunda mano de algo ya verificado de primera mano.

**Por eso, siguiendo la regla del pliego («el comando que decide lo corrés vos»), la sesión se
completó con exploración directa**, mismas reglas exactas del guion (camino feliz una vez, después
valores límite, dobles envíos, emoji y texto de derecha a izquierda, IDs inventados, API directa
saltando la interfaz, cada hallazgo verificado dos veces) — primero a mano contra la interfaz de
desarrollo real con `curl`, después convertido en prueba hermética sobre PostgreSQL real
(Testcontainers, el mismo patrón de `tests/integration/`) para que quede como regresión permanente y
no como una nota.

**Hallazgos reales — un solo hallazgo, el resto son protecciones confirmadas (ver más abajo):**

| escenario | pasos | esperado | obtenido | evidencia | severidad |
|---|---|---|---|---|---|
| Alguien vota en una decisión con voto abierto (no `secret-ballot`) y quiere que su propia respuesta deje de ser recuperable más tarde, igual que un recibo que no delata la opción elegida | 1. Julián entra con su enlace mágico. 2. `POST /decisiones/:id/papeletas` con `{"respuesta":{"tipo":"binary","aprueba":false}}` → 201. 3. En una petición **posterior e independiente** (otra sesión de lectura, ej. Julián vuelve a abrir la pantalla al día siguiente, o alguien le pide que la abra delante suyo): `GET /decisiones/:id` con la sesión de Julián | Que `miRespuesta` no aparezca, o que sólo aparezca en la confirmación inmediata del propio envío — así lo describe ADR-0010 para el recibo del voto («…sin la opción elegida») y así lo exige C6-GATE/T-10 del modelo de amenazas contra la coerción | ~~`GET /decisiones/:id` devuelve `"miRespuesta":"No"` en texto plano, en cualquier lectura posterior mientras la decisión siga `Open`, indefinidamente — no sólo en el instante del envío~~ **CORREGIDO**: `miRespuesta` se retiró del contrato; `DecisionDetalle` ahora trae `yaVotaste: boolean`, que dice si esta persona ya se manifestó en la ronda vigente sin decir en qué sentido, ni en la confirmación inmediata ni en ninguna lectura posterior | `tests/exploratorias/decisiones-secreto-y-limites.test.ts` (la prueba dejó de ser `it.fails` y quedó en verde normal, con una segunda prueba que confirma que `yaVotaste` sí sobrevive); código: `services/api/src/http/presenters.ts` función `yaVotasteEnEstaRonda`, expuesta en `decisionDetalleDto`; contrato: `packages/contracts/src/http.ts` (`decisionDetalle`); pantalla: `apps/web/app/decisiones/[id]/page.tsx` | **S1 — corregido.** Tocaba el secreto del voto y la coerción del votante (T-10), así que el piso era S1 aunque el defecto viviera en presentación y no en el ledger (regla 2 de arriba). Coincidió con un hallazgo independiente de otra sesión de verificación de `docs/THREAT_MODEL.md` T-10 el mismo día: dos vías distintas llegaron al mismo defecto. |

**Protecciones confirmadas** (se probó activamente romperlas; no se rompieron; cada una es ahora una
prueba de regresión permanente — ver `tests/exploratorias/*.test.ts`, cada archivo corrido en verde
con `KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run tests/exploratorias/`, y cada aserción clave
invertida a mano una vez para comprobar que la prueba SÍ se pone roja si la protección se rompe,
según manda la regla 1 de la casa):

| Área | Qué se intentó | Qué hizo el sistema |
|---|---|---|
| Problemas | Círculo inventado (32 hex que no existe) | `404 NO_ENCONTRADO`, nunca un problema fantasma |
| Problemas | Título de 10 000 caracteres | `400 DATOS_INVALIDOS`, nunca un `500` |
| Problemas | Emoji y texto árabe (derecha a izquierda) en título y cuerpo | `201`, texto conservado byte a byte de ida y vuelta por PostgreSQL |
| Problemas | «Me pasa lo mismo» dos veces con la misma persona, con el mismo `requestId` repetido y con uno nuevo cada vez | `422 ALREADY_ME_TOO` en ambos casos; el contador sólo sube una vez |
| Propuestas | Plan con `revisarEn` en el pasado, y con `revisarEn = 0` (el epoch) | `422 EXECUTION_PLAN_REVIEW_NOT_FUTURE` en los dos casos, sin tratar el epoch como especial |
| Propuestas | Plan con `criteriosDeExito: []` | `400 DATOS_INVALIDOS`, rechazado por el contrato antes de llegar al dominio |
| Propuestas | Enmendar con el mismo contenido exacto que la versión vigente (`requestId` nuevo cada vez) | `422 VERSION_UNCHANGED`, no crea una versión repetida |
| Votación | `POST /decisiones/:id/papeletas` sin `Authorization` | `401`, nunca se cuenta como abstención silenciosa |
| Votación | Una cuenta con rol `member` intenta `POST /decisiones` (abrir votación) por API directa | `403` en el servidor, no sólo un botón oculto en pantalla |
| Votación | `GET /decisiones/:id` y `GET /decisiones/:id/resultado` con la votación todavía `Open` y votos ya cargados | Ni desglose ni `desenlace` ni `tablas`; el resultado no da `200` |
| Votación | Doble voto de la misma persona, con dos respuestas distintas | Una sola persona manifestada (INV-07: la última papeleta reemplaza, no se suma) |

Nota aparte, sin prueba propia: al pasar por `/mi/capacidad` contra la instancia compartida de
desarrollo (no la hermética de las pruebas) se encontró un `503 CAPACITY_SERVICE_UNAVAILABLE`
persistente. Verificado por lectura de código (`services/api/src/anchor` no; `services/api/src/server.ts`
función `vaultFromEnvironment`) que es **exactamente lo esperado**: esa instancia compartida no tenía
`KOINONIA_VAULT_MASTER_KEY` en su entorno, y en modo desarrollo sin esa variable el sistema falla
cerrado a propósito (nunca sirve ni guarda capacidad sin cifrar) en vez de fingir que funciona. No es
un hallazgo del producto; es una nota de configuración de esa instancia de desarrollo puntual.

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

| Métrica | Presupuesto | Medido 2026-08-25 |
|---|---|---|
| `tally` con `N = 300` sin delegación | < 50 ms (p95) | **✓ 4,2 ms (p95)** — §11.3 |
| `tally` con `N = 300` y grafo denso (`maxDepth = 4`) | < 200 ms (p95) | no medido esta sesión (§11.4) |
| `replay` de un log de 1 000 eventos | < 150 ms (p95) | **✓ 2,5 ms (p95)**, log de 1 002 — §11.3 |
| Verificación completa del ledger, 100 000 eventos | < 60 s | 5 000 reales en 0,39 s; **100 000 no se corrió**, extrapolación ≈ 7,8 s (§11.3) |
| `POST /ballots` con 100 usuarios concurrentes | p95 < 400 ms, p99 < 1 s, 0 errores | ver pico de cierre abajo — el problema no es la latencia |
| Pico de cierre: 300 papeletas en los últimos 60 s | 0 rechazos por *timeout*; `seq` sin huecos | **✗ NO SE CUMPLE — hallazgo crítico, sigue abierto, §11.2** |
| Pantalla de votación en Slow 3G | LCP < 2,5 s · INP < 200 ms · CLS < 0,1 | no medido esta sesión (fuera del alcance de `tests/carga`) |
| Bundle inicial de `apps/web` | < 250 kB comprimido | no medido esta sesión |

**El escenario que de verdad importa es el pico de cierre.** El uso de una asamblea no es uniforme:
casi nadie vota el primer día y mucha gente vota en la última hora, porque la ventana es dura y no hay
gracia. Una degradación a las 17:59 no es un problema de rendimiento: es **privación del derecho a
votar**, y la papeleta rechazada por *timeout* a las 18:00:00 no se recupera nunca.

**2026-08-24: se escribieron y se corrieron pruebas de carga por primera vez** (`tests/carga/`, este
encargo). Antes de esta fecha el pliego pedía carga con k6 y **no existía ningún guion**, corrido o
sin correr. Ahora existen dos capas — ver §11.1 — y correrlas encontró que el escenario que "de verdad
importa" **no se cumple hoy**, por una causa mucho más grave que la latencia: §11.2.

**2026-08-25: remedición completa contra el código de hoy**, dos días y decenas de commits después
(el resto del equipo trabajando en paralelo sobre el mismo repositorio, incluidas rutas de HTTP y
contratos). Se corrieron los cuatro guiones Node de nuevo, sin cambiar ninguno — el objetivo era
comprobar si el hallazgo de §11.2 seguía siendo real o era un artefacto de aquella corrida, no
escribir pruebas nuevas. **El hallazgo se reproduce, y con esta ráfaga se ve peor, no mejor**: los
números de §11.2 y §11.3 de aquí en adelante son de la corrida de HOY, y sustituyen a los del
2026-08-24 (que quedan citados donde aportan comparación). Se corroboró también por lectura del
código (`grep -rn HeadConflictError services/api/src`, fuera de `services/api/src/ledger/` y de su
reexportación en `services/api/src/index.ts`, sigue sin dar ningún resultado) que la causa raíz
descrita abajo no fue tocada por ningún commit posterior — consistente con que `services/api/src/http/service.ts`
y `services/api/src/decision/repository.ts` no son propiedad de este encargo.

### 11.1 Qué existe y cómo correrlo

`tests/carga/` es la propiedad exclusiva de este encargo. Dos capas, porque el pliego pide k6
explícitamente y k6 **no está instalado en este entorno** (`which k6` → nada) y la instrucción es no
instalarlo — así que la carga real de esta sesión se corrió con Node puro, y k6 queda escrito para el
día que el binario esté disponible:

- **`tests/carga/node/*.run.mjs`** — ejecutables HOY, sin instalar nada: Node 22 + `fetch()` +
  `perf_hooks` bastan para percentiles con concurrencia real. Cuando hace falta PostgreSQL, lo
  levantan ellos mismos con Testcontainers (igual que `tests/integration/`) — nadie tiene que tener
  nada corriendo de antemano. Cuatro guiones:
  - `01-tiempos-api-navegacion-consultas.run.mjs` — tiempos de API en serie, carga inicial
    (`/portada` de golpe), navegación (sesión secuencial por pantallas) y consultas sostenidas.
  - `02-pico-cierre-y-escrutinio.run.mjs` — **el escenario que más importa**: `CARGA_N` personas
    matriculadas de verdad, una decisión abierta por HTTP, el reloj de la API (un puerto
    controlable, ADR-0001) adelantado hasta el último minuto de la ventana, y `CARGA_N` papeletas
    disparadas TODAS A LA VEZ contra el servidor real. Encontró el hallazgo de §11.2.
  - `03-tally-y-replay-dominio.run.mjs` — `packages/domain` puro (sin red, sin base): construye un
    `DecisionLog` real con las mismas funciones de producción (`draftDecision`, `openDecision`,
    `castBallot`, `closeDecision`) y cronometra `computeResult`/`replay`/`verifyLog`. Existe porque
    §11.2 hace que un log de N=300 papeletas REALES sea imposible de conseguir por el camino HTTP
    concurrente — así que este guion lo construye por el camino secuencial, sin la carrera.
  - `04-ledger-a-escala.run.mjs` — `governance.event` con miles de eventos reales (Testcontainers):
    escritura en volumen, `readStream`/`verifyAggregate` de un agregado y `verifyLedger` de la tabla
    completa.
  - Todos aceptan variables de entorno para ajustar `N`/concurrencia/repeticiones — ver el
    encabezado de cada fichero. Todos imprimen, al final, un bloque JSON listo para pegar en esta
    sección la próxima vez que alguien vuelva a correrlos.
- **`tests/carga/k6/*.js`** — escritos con la API real de k6 (`scenarios`, `thresholds`, `Trend`,
  `Counter`, `ramping-vus`, `shared-iterations`), **NO corridos en este entorno**. Tres guiones que
  cubren el mismo terreno que los de Node pero por el camino que el pliego nombró (`k6 run
  tests/carga/k6/<archivo>.js` contra `BASE_URL`): `01-tiempos-api-y-carga-inicial.js`,
  `02-navegacion-y-consultas.js`, `03-pico-cierre-votacion.js`. Este último documenta en su propia
  cabecera por qué, contra un servidor real, no puede acortar la ventana mínima de una hora
  (`duracionHoras` ≥ 1 en el contrato) como sí puede el guion Node vía el reloj-puerto: admite
  apuntar a una decisión ya abierta (`DECISION_ID`, `HUELLA_VERSION`, `CIERRA_EN_MS`) o esperar la
  hora completa contra un servidor de desarrollo.

Corridos el 2026-08-24 (primera vez) y de nuevo el **2026-08-25** (remedición, arriba) contra:
PostgreSQL 16 en un contenedor Testcontainers efímero (no la base compartida de `docker compose`),
Node 22.23.1, host CachyOS de 32 núcleos **compartido con otros agentes trabajando a la vez**
(`free -h` marcaba ~98 GiB de 125 GiB en uso el 2026-08-25, ~102 GiB el 2026-08-24) — así que los
números de latencia absoluta tienen ruido de vecino ruidoso y **no** son los de un servidor de
producción dedicado; el hallazgo estructural de §11.2, en cambio, no depende de la máquina: es una
carrera de escritura que existe en el código, se reproduce igual de mal con poca o mucha carga
ambiental, y se confirmó **tres** veces por separado en dos sesiones distintas dos días aparte
(`N=15` y `N=300` el 2026-08-24, `N=300` de nuevo el 2026-08-25 — resultados abajo, §11.2).

### 11.2 El pico de cierre perdía votos, y una parte los perdía EN SILENCIO — ARREGLADO el 2026-08-25

> **Estado: cerrado.** Lo que sigue es el hallazgo tal como se midió, y al final cómo quedó
> después del arreglo (commit «El voto que dice que se contó, se cuenta»). Se conserva entero
> porque el diagnóstico es la parte que costó, y porque los números de antes son la única forma
> de saber qué tan grave era.


**Comando:** `KOINONIA_REQUIRE_DOCKER=1 node tests/carga/node/02-pico-cierre-y-escrutinio.run.mjs`
(por defecto `CARGA_N=300`). Corrido dos veces el 2026-08-24 y **una tercera vez el 2026-08-25**
—remedición contra el código de hoy, dos días y decenas de commits después—, con el mismo patrón las
tres veces:

| Corrida | Papeletas HTTP 201 | Realmente persistidas (`participacion.emitidas`) | 500 explícito | **Fantasma (201 pero perdida)** |
|---|---|---|---|---|
| N=15 (2026-08-24) | 1 / 15 | 1 | 14 | 0 |
| N=300 (2026-08-24) | 34 / 300 | 3 | 266 | 31 |
| **N=300 (2026-08-25, remedición)** | **176 / 300** | **2** | **124** | **174** |

La corrida de hoy es sobre el mismo mecanismo —no es un hallazgo distinto— pero **el reparto salió
peor, no mejor**: de 300 personas votando en el mismo minuto sólo **2 votos quedaron realmente
contados**, 124 recibieron un 500 explícito (`ERROR_INTERNO`, «Algo se rompió de nuestro lado») y
**174 de las 176 que recibieron un `201`** — "tu voto se registró" — **eran falsas: nunca llegaron a
la base**. Nadie que reciba un 201 tiene ninguna señal de que su voto no cuenta, y hoy esa fracción
fue casi todo el tráfico aceptado (174/176), no una minoría como el 2026-08-24 (31/34): el resultado
exacto de la carrera depende del entrelazado de las promesas en cada corrida —es una condición de
carrera, no un número fijo—, pero el defecto en sí, no.

Esto **no es lentitud**: las respuestas —éxito, error o fantasma— vuelven en cientos de milisegundos,
muy por debajo de cualquier *timeout* razonable (ver percentiles completos en §11.3). Es un defecto de
**concurrencia de escritura** en el camino que persiste una papeleta, con dos síntomas distintos y la
misma raíz:

**Causa raíz — releída y reverificada línea por línea el 2026-08-25 contra el código de hoy, no
asumida igual porque lo era el 2026-08-24** (los números de línea se movieron con los commits
intermedios; el mecanismo no). `emitirPapeleta()` (`services/api/src/http/service.ts:1256-1295`) lee
el `DecisionLog` UNA vez (`verDecision`), construye la papeleta en memoria contra esa lectura
(`castBallotBy`) y llama **una sola vez, sin reintentar**, a `persistDecisionLog()`
(`services/api/src/decision/repository.ts:51-107`, línea de la llamada: `service.ts:1295`). Cuando
dos o más personas votan en la misma decisión casi al mismo tiempo, todas leen el mismo estado y
todas intentan escribir contra la misma cabeza esperada — y sólo puede ganar una:

- **Camino del 500 explícito.** Si, para cuando esta papeleta llega a escribir, el ledger ya avanzó
  MÁS de lo que esta papeleta esperaba, `append()` (`services/api/src/ledger/event-store.ts`) lanza
  `HeadConflictError`. La propia función documenta por qué **no** la reintenta sola («un conflicto de
  cabeza con expectativa EXPLÍCITA es una respuesta del dominio, no un problema de infraestructura:
  reintentarlo escribiría sobre un estado que el llamante nunca vio» — comentario en
  `event-store.ts:350-352`, con el que este informe está de acuerdo). El problema no es esa decisión
  de diseño: es que **nadie, ni `emitirPapeleta` ni la ruta HTTP, vuelve a intentarlo con el estado
  fresco**. Reconfirmado el 2026-08-25: `grep -rn HeadConflictError services/api/src` fuera de
  `services/api/src/ledger/` da SOLO su reexportación en `services/api/src/index.ts:79` — ningún
  llamador la atrapa. El error sube sin que nadie lo atrape, cae en el manejador genérico
  (`services/api/src/http/app.ts`, función `errorDe`, líneas 369-498) y sale como `500 ERROR_INTERNO`
  en su rama final (línea 498) — sin siquiera registrar la causa real en el log del servidor (ningún
  `catch` de `app.ts` llama a `app.log.error`).
- **Camino de la papeleta FANTASMA — el más grave de los dos.** Si, en cambio, el ledger avanzó
  EXACTAMENTE lo mismo que el largo del log de esta papeleta (`persisted === log.length`, el caso
  límite en el que la cuenta cuadra por pura coincidencia aritmética aunque el CONTENIDO no sea el
  mismo), `persistDecisionLog()` entra a su rama de «nada pendiente que escribir»
  (`repository.ts:76-78`, `if (pending.length === 0) return { appended: 0, ... }`) **sin comparar el
  contenido contra lo que de verdad hay en la base**. Esa rama existe para el reintento idempotente
  legítimo (la MISMA petición, con el MISMO `requestId`, que ya se persistió) — pero aquí dispara
  también cuando la papeleta de OTRA persona ocupó por casualidad ese mismo número de posición: la
  propia papeleta de quien llamó **nunca se escribió**, y sin embargo `emitirPapeleta` no distingue
  el caso y responde `201` con el estado que YA tenía en memoria (`service.ts:1296`, `return { id:
  decisionIdRaw, log: siguiente, ... }` — `siguiente` es el log en memoria, no lo confirmado en
  base), que dice que el voto se contó. La ruta HTTP (`app.ts:1185-1201`) tampoco inspecciona
  `appended`: siempre manda `201` con `decisionDetalleDto(...)` de forma incondicional (línea 1198).

**Por qué esto es más grave que «0 rechazos por *timeout*».** El presupuesto original de esta tabla
sólo pedía que nadie se quedara esperando. Lo que se encontró es peor en dos sentidos: (1) el rechazo
no es un *timeout*, es una respuesta de error definitiva bajo un patrón de tráfico completamente
esperable (cualquier ráfaga de más de un puñado de personas votando la misma decisión casi a la vez
—no hace falta llegar a 300—); y (2) una fracción de esos "rechazos" en realidad **no se comunican
como rechazo**: la persona ve la confirmación de que votó y su voto no existe. En un sistema de
gobernanza esto es una falla de integridad electoral, no sólo de rendimiento.

**Qué NO es esto.** No es un artefacto del guion de carga: se leyó el código fuente de
`persistDecisionLog`, `append` y el manejador de errores para confirmar la causa exacta antes de
escribir este párrafo (líneas citadas arriba), no sólo se infirió del síntoma. No es tampoco cuestión
de que la máquina esté ocupada (§11.1): el mecanismo es una carrera lógica que existe con cualquier
velocidad de red, y se reprodujo igual en la corrida de N=15.

**Cómo se arregló, y por qué así.** No con un bucle de reintentos —que era lo primero que se
propuso desde acá— sino moviendo el cerrojo que ya existía. Toda escritura del historial toma un
cerrojo global de escritura (`lockLedgerWithin`), sólo que lo tomaba **dentro** de `append`, es
decir después de que el llamante hubiera leído. Ahora `escribirSobreDecision`
(`services/api/src/http/service.ts`) lo toma **antes de leer**, y la lectura del log, el evento del
dominio y la escritura ocurren en la misma transacción. Un bucle de reintentos habría necesitado, en
el peor caso, tantos intentos como personas votando a la vez, y habría dejado la corrección
dependiendo de un número máximo elegido a ojo. Las tres escrituras sobre una decisión que tenían la
carrera —emitir papeleta, prestar el voto y recuperarlo— pasan por ahí.

Y como red de seguridad para quien llame a `persistDecisionLog` sin ese cerrojo, la rama de «nada
pendiente que escribir» ya no da por escrito lo que no escribió: compara el evento que de verdad
está en la cabeza con el último del log y, si es de otro, lanza un conflicto de cabeza en vez de
fingir éxito.

Lo protegen dos pruebas, las dos validadas rompiendo lo que protegen:
`tests/integration/papeleta-concurrente.test.ts` (diez personas votando a la vez, en menos de tres
segundos y sin red real; la cuenta testigo es el escrutinio, no lo que la API dice al votar) y
`tests/integration/papeleta-fantasma.test.ts` (la red del repositorio, incluido el caso legítimo de
volver a guardar el mismo log, que era lo más fácil de romper al arreglar esto).

**Cómo quedó — remedición del 2026-08-25, mismo guion, misma máquina, N=300:**

| Corrida | Papeletas HTTP 201 | Realmente persistidas | 500 explícito | **Fantasma (201 pero perdida)** |
|---|---|---|---|---|
| N=300 (2026-08-25, antes) | 176 / 300 | 2 | 124 | 174 |
| **N=300 (2026-08-25, después)** | **300 / 300** | **300** | **0** | **0** |

`loadDecisionLog` releyó los 304 eventos del agregado sin un solo hueco de `seq`, y
`participacion.emitidas` del escrutinio coincide exacto con las papeletas aceptadas por HTTP.

**Lo que cuesta, dicho sin adornos.** Las 300 papeletas ahora se serializan de verdad: la ráfaga
entera tarda 5,6 s y las latencias individuales suben a p50 5,12 s · p95 5,23 s · p99 5,55 s (antes
volvían en cientos de milisegundos, sólo que la mayoría volvían mal). Son ~53 papeletas/s en una
máquina compartida con otros agentes trabajando. Para 300 personas votando en el mismo instante,
todo el mundo recibe una respuesta correcta en menos de seis segundos, y ninguna es mentira. Si
alguna vez hiciera falta más caudal, el sitio donde mirar es el alcance del cerrojo —hoy es global
para todo el historial, no por decisión—, no volver a leer fuera de él.

### 11.3 Números reales medidos, 2026-08-24 y 2026-08-25 (remedición)

**Tiempos de API, carga inicial, navegación, consultas** —
`node tests/carga/node/01-tiempos-api-navegacion-consultas.run.mjs` (valores por defecto). Fila
2026-08-24 y fila **2026-08-25 (remedición)** una debajo de la otra; ambas cumplen cómodamente
cualquier presupuesto razonable, y la variación entre ellas es ruido de máquina compartida, no una
tendencia — por eso §11 no les puso presupuesto propio, a diferencia del pico de cierre:

| Medición | n | p50 | p95 | p99 |
|---|---|---|---|---|
| `GET /portada` (serie) — 24/**25** | 50 | 10,4 / **7,9 ms** | 22,2 / **10,9 ms** | 29,8 / **12,3 ms** |
| `GET /decisiones` (serie) — 24/**25** | 50 | 2,9 / **2,3 ms** | 4,9 / **3,0 ms** | 7,6 / **3,4 ms** |
| `GET /problemas` (serie) — 24/**25** | 50 | 9,7 / **6,8 ms** | 12,5 / **9,7 ms** | 15,6 / **11,6 ms** |
| `GET /circulos` (serie) — **25** | 50 | **2,0 ms** | **2,9 ms** | **3,1 ms** |
| Carga inicial: `/portada` × 300 a la vez — 24/**25** | 300 | — | 764,0 / **710,1 ms** | 764,5 / **711,7 ms** (0 errores; 383/**414** req/s) |
| Navegación: `/portada` (60 sesiones, concurrencia 15) — 24/**25** | 60 | 39,8 / **21,2 ms** | 48,5 / **29,3 ms** | 52,2 / **33,6 ms** |
| Navegación: detalle de propuesta — 24/**25** | 60 | 18,0 / **11,6 ms** | 33,8 / **18,3 ms** | 34,5 / **20,7 ms** |
| Consultas mezcladas × 600 (concurrencia 20) — 24/**25** | 600 | 9,4 / **7,3 ms** | 59,8 / **45,3 ms** | 103,0 / **60,8 ms** (0 errores ambas veces) |

**Tally y replay puros (dominio, sin red)** — `node tests/carga/node/03-tally-y-replay-dominio.run.mjs`
(valores por defecto, 300 repeticiones). 2026-08-24: `computeResult` con N=300 → p95 2,9 ms, p99
3,6 ms; `replay` de un log de 1 002 eventos → p95 1,4 ms, p99 1,7 ms. **2026-08-25 (remedición):**
`computeResult` con N=300 → **p95 4,2 ms, p99 4,6 ms** (presupuesto < 50 ms, cumple con margen
amplio); `verifyLog` (recomputa toda la cadena de hashes) con N=300 → **p95 20,9 ms**; `replay` de un
log de 1 002 eventos (padrón sintético de 1 000, mayor a las ~300 personas reales, a propósito) →
**p95 2,5 ms, p99 2,7 ms** (presupuesto < 150 ms). Ambas corridas cumplen los dos presupuestos con
margen amplio; la diferencia entre ellas es ruido de la máquina compartida (§11.1), no una tendencia.

**Ledger a escala** — `node tests/carga/node/04-ledger-a-escala.run.mjs`. 2026-08-24: con 5 000
eventos reales repartidos en 500 agregados, `verifyLedger()` completo tomó 349 ms; con 20 000 eventos
(mismos 500 agregados, 40 eventos cada uno), 955 ms; escritura sostenida ~500 eventos/s en ambas
corridas; extrapolación lineal a 100 000 eventos: entre 4,8 s y 7,0 s. **2026-08-25 (remedición, un
único punto de 5 000 eventos — no se repitió la corrida de 20 000 por tiempo):**
`verifyLedger()` completo con los mismos 5 000 eventos / 500 agregados tomó **388 ms** —consistente
con los 349 ms de hace dos días—, escritura sostenida **475 eventos/s** (5 000 eventos en 10,5 s),
consistente con que `attemptAppend` toma un `pg_advisory_xact_lock` de ALCANCE GLOBAL sobre el
ledger (`services/api/src/ledger/event-store.ts`, comentario «(1) Cerrojo de escritura del ledger.
Orden total») — cada escritura, sea del agregado que sea, serializa contra todas las demás.
Extrapolando LINEALMENTE este único punto a 100 000 eventos: **≈ 7,8 s**, dentro del rango de hace dos
días (4,8-7,0 s) y muy por debajo del presupuesto de 60 s — pero sigue siendo una extrapolación desde
5 000, no una medición a 100 000; correrlo a esa escala de verdad son ≈ 200 s sólo de escritura al
ritmo medido (§11.4), y no entró en el tiempo de esta remedición tampoco.

**Pico de cierre y escrutinio** — ver §11.2 para los números completos, incluida la remedición del
2026-08-25; es la corrida más importante de esta sesión y merece su propia sección, no un renglón de
tabla.

### 11.4 Lo que quedó sin medir

Sigue exactamente igual en la remedición del 2026-08-25 que el 2026-08-24 — nada de esto se acortó ni
se cerró en el intervalo, y se revisó punto por punto que la razón siga vigente antes de dejarlo
igual (no es que no se haya vuelto a mirar):

- **`tally` con grafo denso de delegación (`maxDepth = 4`)**: el motor lo soporta
  (`packages/domain/src/delegation.ts`, probado en `packages/domain/test/delegation.test.ts`) pero
  armar el escenario (una cadena de delegaciones válida además del padrón) no entró en el tiempo de
  esta sesión. `tests/carga/node/03-tally-y-replay-dominio.run.mjs` es el lugar natural para
  agregarlo — reutiliza las mismas funciones de producción que ya usa para el caso sin delegación.
- **Web vitals de la pantalla de votación en Slow 3G** y **tamaño del *bundle*** de `apps/web`: son
  medición de frontend (Lighthouse/`chrome-devtools`), no de API/base; quedan fuera del alcance de
  `tests/carga`, que es donde este encargo tiene propiedad de escritura.
- **Verificación del ledger a 100 000 eventos de verdad** (no la extrapolación de §11.3): el guion
  (`04-ledger-a-escala.run.mjs`) ya admite el tamaño por variable de entorno
  (`CARGA_AGREGADOS`/`CARGA_POR_AGREGADO`); sólo hace falta el tiempo de máquina para correrlo (la
  escritura, no la verificación, es la parte lenta: al ritmo medido de ~500 eventos/s, 100 000
  eventos son ≈ 200 s sólo de escritura).
- **Los tres guiones de k6** (§11.1): escritos con la API real de k6, no corridos — k6 no está
  instalado en este entorno y la instrucción del encargo es no instalarlo.

**Cuándo.** Microbenchmarks de `domain` y `crypto` en cada PR que los toque: regresión > 20 % frente a
`main` **falla el build**; entre 10 % y 20 % avisa. Nada de esto corre todavía en un flujo de trabajo
de `.github/workflows/` (§13 ya lo marca así para k6 nightly, y sigue siendo cierto para los guiones
Node de `tests/carga/node/`): existen y se corrieron a mano hoy, pero integrarlos al pipeline —
CI, nightly, antes de cada *release*— es trabajo pendiente de quien tenga esos flujos de trabajo
asignados. Web vitals en cada PR que toque `apps/web`. Ledger a escala, nightly.

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

**Reverificado el 2026-08-25 leyendo `.github/workflows/` entero** (no reconstruido de memoria) y
contrastado contra la API real de GitHub (`gh api repos/.../actions/...`), no sólo contra el YAML.
Tres tramos, cada uno más caro y más completo que el anterior:

### En cada propuesta de cambio (`pull_request` → `ci.yml`)

- **`verificar`:** pureza del dominio (`scripts/check-domain-purity.mjs`, ADR-0001) → `typecheck` →
  `lint` → **`test:coverage`** (los 2 495 tests con Docker real vía Testcontainers,
  `KOINONIA_REQUIRE_DOCKER=1`, contra los pisos de cobertura por paquete de §3) → `build` →
  `build:web`.
- **`e2e-pr`:** toda `tests/e2e/*.spec.ts` en **un solo navegador, Chromium** (§7).

Nada de esto corre condicionado al diff: **todo el mono-repo se verifica en cada PR**, toque lo que
toque. Más abajo se explica por qué esto es deliberado y no un descuido.

### Al integrar en `main` (`push` a `main` → `ci.yml`)

Los mismos dos jobs de arriba (`verificar` corre igual, sin condición de rama), **más** `e2e-main`,
que llama al flujo de trabajo reutilizable `e2e-matriz-completa.yml`: los cinco proyectos de §7
—Chromium, Firefox, WebKit, Chrome móvil, Safari móvil— completos, con `playwright install
--with-deps` para traer las librerías del sistema que Firefox y WebKit necesitan.

### De noche (`schedule` → `nocturno.yml`)

07:00 UTC (02:00 en Bogotá), independiente de que haya habido push: la MISMA matriz completa que
`e2e-main`, llamando al mismo `e2e-matriz-completa.yml` — no una copia que pudiera divergir. Es la
red de seguridad contra la deriva del entorno (una imagen `ubuntu-latest` nueva, una versión de
navegador distinta) que ningún push dispararía por sí sola. Junto a ella corre `carga-nocturna`
(mismo `nocturno.yml`, job aparte sin `needs:` para no bloquear ni demorar la matriz): los cuatro
guiones de `tests/carga/node/*.run.mjs` vía `pnpm run carga` — el tercer pilar que el pliego pide
para la noche («regresión completa, mutación, carga») y que hasta el 2026-08-25 no tenía disparador
en ningún flujo de trabajo (§11.1 ya documentaba los guiones; sólo faltaba engancharlos). Sigue sin
existir un guion `k6` real porque el binario no está instalado en este entorno y la instrucción es no
instalarlo — los tres guiones de `tests/carga/k6/*.js` quedan escritos para el día que lo esté.
Por separado, `mutacion.yml` corre a las 06:30 UTC la mutación de `crypto` + `tally` + reglas (§10) —
**no engancha a los PR todavía**, y su propia cabecera explica por qué: con la puntuación de `domain`
(resto) y `services/api` todavía por debajo del 85 %, un guardián en el PR bloquearía cambios sin
relación con el motivo del rojo.

### ⚠ HALLAZGO — los 4 flujos de trabajo están bien escritos y NUNCA han corrido con éxito

Verificado el 2026-08-25 contra la API real, no contra suposiciones: `gh api
repos/stevenvo780/koinonia/actions/workflows` lista los 4 flujos (`ci.yml`, `e2e-matriz-completa.yml`,
`mutacion.yml`, `nocturno.yml`) como `state: active`, y su YAML analiza limpio (`yaml.safe_load` sobre
los cuatro ficheros, sin excepción). Pero **cada uno de los cuatro tiene `total_count: 0` corridas
propias** (`.../actions/workflows/{id}/runs`), y `gh run list` —que sí trae filas— muestra que
**absolutamente todas** las corridas desde que el repositorio tiene flujos de trabajo (`push` a
`main` y los `schedule` de `mutacion.yml`/`nocturno.yml` por igual, del 22 al 25 de agosto) terminan
en `conclusion: startup_failure` con **0 jobs creados** y duración `0s`.

La causa no es el contenido de los YAML de hoy: TODAS esas corridas están asociadas a un
**`workflow_id` fantasma** (`340226574`) que `gh api .../actions/workflows/340226574` describe como
`"name": "", "path": "BuildFailed", "state": "deleted"` — creado el 2026-08-22 a las 15:34:09,
**4 segundos después** de que se registrara el `ci.yml` real (`id 340226555`, 15:34:05). Es decir: en
algún momento de ese primer registro, GitHub creó un flujo de trabajo fantasma («no pude construir un
grafo de jobs a partir de esto») y desde entonces **toda corrida posterior, para los 4 flujos y para
`push` y `schedule` por igual, se sigue asociando a ese fantasma en vez de al flujo real** —incluidas
las corridas de `e2e-matriz-completa.yml` y `nocturno.yml`, creados dos días después, el 24 de
agosto, cuando el `ci.yml` de esa fecha ya era el de hoy. `gh run view <id>` lo resume como «This run
likely failed because of a workflow file issue», que es el mensaje genérico de la CLI para
`startup_failure` y no una lectura del contenido — el contenido de hoy sí parsea.

Esto es corrupción del **registro de GitHub Actions para este repositorio**, no un defecto de este
YAML: no hay manera de arreglarlo editando ficheros de `.github/workflows/` (ya se intentó, dos veces,
con `e2e-matriz-completa.yml` y `nocturno.yml` creados de cero el 24 de agosto, y el fantasma los
absorbió igual). Las dos vías de remediación conocidas —deshabilitar y volver a habilitar cada flujo
desde `Settings → Actions`, o retirar `.github/workflows/` por completo en un commit y reintroducirlo
en otro— caen fuera del alcance de escritura de este encargo (el primero es un cambio de
configuración de la cuenta de GitHub, no un fichero del repositorio; el segundo exige un commit, que
este encargo tiene prohibido hacer) y de la instrucción explícita de no ejecutar Actions desde aquí.
Queda para quien tenga permiso de administrar el repositorio en GitHub: **sin esa reparación, el
pipeline de abajo es correcto sobre el papel y no ha protegido nunca un solo push real.**

### Lo que este documento describía en versiones anteriores y NO está implementado

Tres ideas de diseño que valen la pena pero que ningún fichero de `.github/workflows/` ejecuta hoy —
dejarlas escritas en presente, como si corrieran, es precisamente el problema que este documento ya
tuvo una vez (cita de fichero inexistente) en otra forma: afirmar un mecanismo que no existe.

- **Selección de suites por el grafo de dependencias del *workspace*** (`pnpm --filter
  '...[origin/main]'`), para no correr todo en cada PR. Hoy `ci.yml` corre el mono-repo entero
  siempre, sin condicionar nada al diff — más lento, pero no hay una regla de selección a medias que
  alguien pueda confiar en que existe y que en realidad no filtra nada.
- **Escalado de `FC_RUNS`** (100 en `--watch`, 200 en un *hook* de pre-commit, 1000 en PR, 10000 de
  noche). Sólo la variable existe (`packages/domain/test/arbitraries.ts` y los ficheros de
  `test/props/`, con default 1000); ningún flujo de trabajo la fija, así que **toda corrida usa
  siempre el default, 1000** — PR, `main` y nocturno por igual.
- **Un *hook* de pre-commit local.** No hay `.husky/`, ni `simple-git-hooks`, ni ningún script
  `prepare` en `package.json` que instale uno. Lo único que corre antes del PR es lo que cada quien
  ejecute a mano.

El despliegue a *staging* y el orden aleatorio de E2E de noche (`--shuffle`) tampoco existen — ningún
paso los ejecuta, ni hay proyecto de *staging* configurado. La carga nocturna con k6 sigue sin el
binario real (arriba), pero **el equivalente en Node ya corre cada noche** desde el 2026-08-25
(`carga-nocturna` en `nocturno.yml`), así que ese punto deja de estar en esta lista.

Quien retome cualquiera de los puntos de arriba: conviértalo primero en un paso real de
`.github/workflows/` y **después** vuelva este apartado a describirlo en presente. Mientras tanto,
queda aquí como lo que es — trabajo pendiente, no comportamiento vigente.

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
- `docs/MODEL_CONTEXT.md` · `docs/adr/0001-monorepo-typescript-con-dominio-puro.md` ·
  `scripts/check-domain-purity.mjs`
- `.github/workflows/ci.yml`, `.github/workflows/e2e-matriz-completa.yml`,
  `.github/workflows/nocturno.yml`, `.github/workflows/mutacion.yml` — el pipeline escalonado
  vigente que §13 documenta (PR → main → nocturno), y la mutación nocturna aparte (§10).
- `vitest.config.ts` (`test.coverage.thresholds`) — los pisos de cobertura por paquete de §3.
