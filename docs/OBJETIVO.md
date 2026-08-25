# Objetivo: cerrar la distancia entre el pliego y el software

> **Establecido el 2026-08-24.** Este documento es el **objetivo vigente** del proyecto y la lista
> de trabajo que lo cumple. Se actualiza al cerrar cada pendiente; cuando la tabla quede sin filas,
> el objetivo está cumplido.
>
> **Reauditado el 2026-08-25** contra el commit `3ef178d`: seis auditores independientes, cada uno
> sobre un área del pliego, recorrieron una por una las **91 filas pendientes** de la tabla de abajo
> contra el código de hoy — no contra lo que este documento decía que había. Este documento refleja
> ese resultado, con la misma regla de siempre: si nadie trajo evidencia de una fila, esa fila no
> pasa a `CUMPLE`.
>
> No sustituye a `HANDOFF.md` (que cuenta el estado) ni a los ADR (que deciden). Éste dice **qué
> falta y quién puede hacerlo.**

## De dónde sale esta lista

De una auditoría del **2026-08-23** que tomó el pliego original —el encargo completo del proyecto— y
lo descompuso en **183 requisitos verificables**, cada uno contrastado contra el código por un agente
barato y después contra un revisor independiente que intentaba refutarlo. Desde entonces el árbol
cambió mucho sin que nadie recorriera la tabla fila por fila; el **2026-08-25** seis auditores lo
hicieron.

| Veredicto | 2026-08-23 (entonces) | 2026-08-25 (hoy) | Movimiento |
| --- | ---: | ---: | --- |
| `CUMPLE` | 92 | **120** | **+28** |
| `PARCIAL` | 41 | **46** | +5 |
| `NO VERIFICADO` | 27 | **0** | **−27** |
| `NO CUMPLE` | 21 | **16** | −5 |
| `NO ALCANZABLE` | 3 | **1** | −2 |
| **Total** | 184* | 183 | |

\* *el total «de entonces» ya no cuadraba con 183 en el propio documento original (sobraba 1); se
deja la cifra tal como estaba, con esta aclaración, en vez de corregirla con retroactividad.*

**Los 27 `NO VERIFICADO` ya no existen.** Verificar reveló pendientes reales que estaban escondidos
bajo esa etiqueta cómoda — y eso es información buena aunque incomode:

- **Hallazgo nuevo, el más serio de esta ronda**: la CI de GitHub Actions **nunca corrió con éxito ni
  una sola vez**. Los 4 workflows activos (`ci.yml`, `e2e-matriz-completa.yml`, `mutacion.yml`,
  `nocturno.yml`) tienen **0 ejecuciones registradas cada uno** (`gh api
  repos/.../actions/workflows/<id>/runs` → `total_count: 0`, confirmado en vivo). Pasa de
  `NO VERIFICADO` a `NO CUMPLE`.
- **Verificabilidad individual del voto (R4) BAJA** de `PARCIAL` a `NO CUMPLE`: el propio arreglo de
  coerción del 2026-08-24 quitó el único campo (`miRespuesta`) que aún se parecía a una confirmación
  de voto, y hoy la API no devuelve nada —ni `ballotId` ni tracker— que permita a quien votó
  comprobar después que su voto quedó tal cual lo emitió. El arreglo de un problema (coerción)
  destapó otro (verificabilidad) que un recibo bien diseñado evitaría.
- A cambio, **15 de los 27** resultaron tener código y pruebas reales de punta a punta y pasan a
  `CUMPLE` sin reservas (T-02, T-03, T-05, T-07, T-08, T-09, T-10, T-25, Docker reproducible, Backups
  automáticos probados, entre otros — ver `seguridad-y-tecnologia` abajo). Los **10** restantes
  quedan en `PARCIAL`, cada uno con el hueco concreto que le falta.

**`NO ALCANZABLE`** —el motor existe, está probado, y no hay forma de llegar a él desde la interfaz
ni la API— tenía 2 filas abiertas desde el 2026-08-24 (flujo entero de punta a punta; separación
argumento-popularidad). **Las dos se resolvieron esta vuelta**: el flujo de punta a punta sí es
recorrible hoy por la interfaz (sube a `PARCIAL`: sólo faltan dos eslabones que **no existen**, no que
estén inalcanzables), y la separación argumento-popularidad resultó no tener nada que separar —no
existe ningún mecanismo de apoyos/reacciones en el sistema, así que su ausencia total satisface el
requisito tal como está escrito (sube a `CUMPLE`). Pero **apareció un caso nuevo**: el motor de
objeciones valida panel/2-3/motivación de verdad, pero no existe ninguna ruta HTTP ni botón de UI para
**desestimar** una objeción —sólo para levantarla—, así que ese requisito baja de `NO CUMPLE` a
`NO ALCANZABLE`. Queda **1**.

## Lo que NO entra en este objetivo, y por qué

Cuatro cosas no las puede cerrar un agente, y fingir que sí sería el peor resultado posible:

| Pendiente | Por qué no |
| --- | --- |
| **ADR-0054 — procedencia del padrón** | Es una decisión jurídica y política sobre qué promete la plataforma. El propio ADR dice que no la toma un agente: la toma la comunidad, informada por un abogado. |
| **Dirección real de facilitación** | Hoy el único miembro es `operador@udea.edu.co`, que no existe, y por eso **nadie puede entrar a producción**. Hace falta un `@udea.edu.co` real. |
| **Pantalla «Reuniones»** | Es la 14.ª del pliego y **no tiene dominio detrás**. Inventarla sería construir una fachada. Primero se decide qué es una reunión en este sistema. |
| **Conectar un proveedor de IA** | El puerto existe y es incapaz de decidir por construcción de tipos (ADR-0052). Falta elegir proveedor, presupuesto y política de datos: es una decisión de gobierno, no de código. |

Y una quinta que sí es técnica pero **no se improvisa**: el **voto secreto verificable**. El pliego
dice literalmente «no inventes criptografía: evalúa protocolos/sistemas maduros como Helios o
Belenios». Lo que corresponde es **evaluarlos y escribir el ADR** —ya escrito, ver ADR-0010 y
ADR-0018— e **implementarlos**, no improvisar un esquema propio. La evaluación documental está hecha;
la implementación (Belenios, según el propio ADR-0018) no ha empezado.

## Las oleadas

| # | Oleada | Qué cierra | Estado — 2026-08-25 |
| --- | --- | --- | --- |
| 0 | **Verificar lo no verificado** | los 27 `NO VERIFICADO`, sobre todo las 16 amenazas y los 9 puntos de tecnología | **cerrada.** Los 27 quedaron verificados uno por uno: 15 pasaron a `CUMPLE`, 10 a `PARCIAL` con hueco concreto, y 2 a `NO CUMPLE` con evidencia directa (CI/CD nunca corrió; T-01 con anclaje real pero sin el quórum 2-de-3 que exige el pliego). No queda ningún `NO VERIFICADO` en este documento. |
| 1 | **Cerrar el flujo** | decisión aprobada → iniciativa; objeciones y enmiendas sin ruta; aprendizajes sin pantalla; los 13 campos de iniciativa; los escalones de incumplimiento | en curso. Enmiendas, iniciativa (4 campos), hitos y tareas quedaron `CUMPLE` de punta a punta esta ronda. **Objeciones se degrada a `NO ALCANZABLE`**: el motor valida panel/2-3/motivación, pero falta la ruta HTTP y el botón de UI para desestimar. El flujo entero problema→aprendizajes sí es recorrible por la interfaz, pero le faltan dos eslabones que el pliego pide y que **no existen en absoluto**: el informe periódico que bloquea avance de estado, y la extracción automática de aprendizajes al cerrar una evaluación (hoy es un formulario manual). |
| 2 | **Motor alcanzable** | los doce métodos elegibles de verdad; concentración de poder visible; conteo parcial oculto | en curso, sin cambios de veredicto esta ronda pero con un matiz importante: el umbral de alarma HHI (0,15) **sí se visualiza** en pantalla, pero la alerta temporal de `window-guard.ts` (>40% de concentración en el último 10% de la ventana) **sigue sin cablear a ninguna ruta**. Siguen siendo 9 métodos de 12, y de esos 9 sólo 5 se pueden abrir hoy desde la interfaz. |
| 3 | **Pruebas** | matriz completa de navegadores **ejecutada**; exploratorias masivas; carga con k6; umbrales de cobertura; pipeline escalonado | en curso. La matriz Chromium+Firefox se re-confirmó **230/230** de nuevo (el foco fallido de `07-seguimiento-adr45.spec.ts` era saturación del host, no defecto de producto — confirmado, no sólo sospechado). **Nuevo dato cuantificado**: el mutation score real (recalculado desde el JSON crudo con Python) es **77,67%**, por debajo del piso de ruptura de 85% que `stryker.config.mjs` exige — el build debería estar fallando y nadie lo corrió contra el código de hoy desde el 23-ago. El hallazgo crítico de carga en el cierre de una votación (`emitirPapeleta`/`persistDecisionLog`) **sigue exactamente igual, sin corregir**: es el pendiente más urgente de todo este documento. |
| 4 | **Anclaje y memoria** | `GitForgeClient` real; OpenTimestamps contra calendario real; anclaje **encendido** con checkpoints; acuses por correo | **objetivo central cumplido.** El anclaje está **ENCENDIDO y anclando de verdad** en producción: 13 checkpoints, 15 cabeceras de bloque de Bitcoin (963933–963995), comprobado criptográficamente contra un servicio externo (ver «Estado del despliegue» abajo). Falta el quórum 2-de-3 —sólo la clase `blockchain` está activa; git y correo se apagan solos por falta de padrón de veeduría y testigos designados—, que es una designación humana, no una tarea de código. |
| 5 | **Infraestructura** | PWA con service worker; almacenamiento S3; colas/jobs; CI/CD completo | en curso. Docker + reproducible y Backups automáticos probados pasan a `CUMPLE` esta ronda (antes `NO VERIFICADO`). Almacenamiento S3 sigue siendo un stub a propósito sobre disco real. Colas/jobs funcionan (cola casera sobre PostgreSQL, probada con concurrencia real) pero no son la tecnología nombrada. **CI/CD es ahora el hallazgo más serio de la oleada**: 0 corridas exitosas registradas en ninguno de los 4 workflows desde que existen. |
| 6 | **Interfaz** | pantallas enlazadas; cero violaciones de accesibilidad; producción respondiendo las 14 rutas | en curso, cerca del final. Producción quedó redesplegada (`koinonia-{api,web}:20260824-906f4bb`) y las 16 rutas —incluidas `/concentracion` y `/aprendizajes`, antes en 404— responden `200`. Sólo falta la 14.ª pantalla del pliego (Reuniones, deliberadamente sin construir) y accesibilidad automatizada en las 3 pantallas nuevas. |

## Reparto de modelos

El trabajo pesado no lo hace Opus. La flota disponible y su uso:

| Motor | Vía | Para qué |
| --- | --- | --- |
| **MiniMax M3** | `opencode run --model minimax/MiniMax-M3` | barrer, leer, inventariar, generar casos, exploratorias |
| **Gemini Flash / Pro** | `agy --print` | contexto largo, análisis, revisión independiente |
| **Claude Sonnet 4.6** | `agy --print` (cuota Antigravity, **separada** de las Max) | implementación acotada |
| **Codex GPT-5.6** | `codex` | lo difícil: concurrencia, seguridad, criptografía |
| **Opus 5** | sesión | orquestar, decidir, integrar, y nada más |

Todo lo que produce el enjambre barato **se cruza o se comprueba con un comando**. Precedente
medido: preguntando cuántos términos tiene `FORBIDDEN_UI_TERMS`, dos de tres modelos dijeron 31; el
real es **26**, reconfirmado el 2026-08-25 recontando directo de `packages/contracts/src/glossary.ts`
línea por línea. Un obrero barato sirve para barrer, no para concluir.

---

## Sesión de integración — 2026-08-24 (REMATE)

Después de que 22 agentes trabajaran en paralelo sobre este árbol, esta pasada fue de integración
final: correr todo, confirmar qué de lo nuevo está de verdad cableado (no sólo escrito), y dejar el
objetivo dicho con la verdad. Los siete comandos de verificación, en orden:

1. `pnpm exec prettier --write .` — sin cambios, todo el árbol ya estaba formateado.
2. `pnpm run typecheck` — **0 errores** (`tsc -p tsconfig.check.json && tsc --build packages/contracts services/api && tsc -p tests/e2e/tsconfig.json`).
3. `pnpm run lint` — **0 errores** (eslint + `prettier --check` + `scripts/check-domain-purity.mjs`, pureza del dominio correcta).
4. `KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run --reporter=dot` — **2 746 pasaron + 1 fallo esperado (`it.fails` a propósito, ver hallazgo de secreto del voto en `docs/TESTING.md`) = 2 747, en 173 ficheros.** Subió de la base de 2 498/152 por el trabajo nuevo de esta tanda (métodos, concentración, escalones, aprendizajes, cierre de ciclo, almacén, colas, exploratorias, carga).
5. `pnpm run build` y `pnpm run build:web` — **ambos en verde**; Next.js 15.5.23, 25 rutas generadas.
6. `KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox` — **226/230** (Chromium 115/115 limpio; 1 falla + 3 sin correr en Firefox, ver fila de «Matriz de navegadores» en `testing` — indicio fuerte de saturación del host compartido, no confirmado como bug de producto).
7. Glosario ADR-0041 sobre todo el texto nuevo de pantalla — replicado el analizador de `tests/e2e/09-glosario.spec.ts` (extendido además a `services/api` y `packages/contracts` en `.harness/detector-glosario.mjs`, que ya existía en el árbol) y **validado por falsación antes de confiar en él**: se inyectó a mano la palabra «ledger» en `apps/web/app/decisiones/abrir/page.tsx`, el detector la encontró, se restauró el fichero y el detector volvió a marcar cero. Resultado sobre el árbol real: **cero apariciones de jerga prohibida.**

**Lo más importante de esta pasada no es lo que se escribió — ya estaba escrito por otras 22
sesiones — sino lo que se confirmó y lo que se encontró al confirmarlo:**

- Todas las rutas nuevas (`rutas-escalones`, `rutas-concentracion`, `rutas-metodos`, `rutas-aprendizajes`,
  `rutas-cierre-ciclo`, `rutas-etapas`) **ya estaban cableadas en `services/api/src/http/app.ts`** al
  llegar esta sesión — algunos comentarios dentro de esos ficheros todavía dicen «pendiente del
  integrador», pero son comentarios del autor original sin actualizar, no el estado real; se verificó
  contra `app.ts` directamente, no contra el comentario.
- Elegir método de votación desde la interfaz/API **dejó de ser `NO ALCANZABLE`** (motor-decisiones).
- La concentración de poder por delegación **se calcula de verdad** (HHI/CR1/Gini reales, no un stub).
- PWA con service worker **es real y cumple** (antes `NO VERIFICADO`).
- Almacenamiento S3 **sigue sin ser S3**: es un stub explícito sobre disco real, a propósito.
- Colas/jobs **funcionan pero no son la tecnología nombrada**: cola casera sobre PostgreSQL, probada
  con concurrencia real.
- **Hallazgo crítico nuevo, no de esta sesión de integración sino de la sesión de carga que la
  precedió hoy mismo**: bajo carga concurrente real en el cierre de una votación, el sistema pierde
  votos — algunos con un `500` explícito, y una fracción **en silencio, respondiendo `201` como si el
  voto se hubiera contado**. Ver el detalle completo, con causa raíz citada por línea, en la fila de
  `Testing de performance/carga` de la tabla de `testing` y en `docs/TESTING.md` §11.2. Es el
  pendiente más urgente de todo este documento.

---

## Segunda pasada de integración — 2026-08-24 (REMATE)

Tres agentes trabajaron en paralelo sobre tres encargos distintos (T-10 coerción del votante,
los 13 campos de iniciativa, y el conteo oculto de la Etapa 1). Esta pasada corrió los seis
comandos de verificación sobre el resultado combinado:

1. `pnpm exec prettier --write .` — sin cambios de fondo; sólo formateó el fichero nuevo
   `tests/integration/conteo-oculto.test.ts` (10ms, cambio cosmético).
2. `pnpm run typecheck` — **0 errores**.
3. `pnpm run lint` — **0 errores** (eslint + `prettier --check` + `scripts/check-domain-purity.mjs`,
   pureza del dominio correcta). Los 38 errores `@typescript-eslint/no-confusing-void-expression` que
   el encargo `campos` había dejado pendientes en `recursos-y-riesgos.test.ts` ya no aparecen.
4. `KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run --reporter=dot` — **2 824 pasaron, 0 fallaron, en
   179 ficheros** (subió de 2 747/173). **Ya no queda ningún `it.fails` en el árbol** —
   `grep -rn "\.fails(" tests packages services` da vacío—: el encargo de coerción cerró el hueco de
   `it.fails` que dejó el encargo A original, sustituyendo la comprobación en rojo a propósito por una
   aserción real en verde de que `yaVotaste` sobrevive sin exponer el sentido del voto.
5. `pnpm run build` y `pnpm run build:web` — **ambos en verde**; Next.js 15.5.23, 25 rutas generadas.
6. `KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox` —
   **230/230 en la corrida definitiva**. La primera corrida completa de esta pasada dio 228/230 (1
   falla + 1 sin correr, por el `mode: 'serial'` de `tests/e2e/07-seguimiento-adr45.spec.ts`: cuando
   falla una prueba de la serie, la siguiente del mismo fichero no llega a correr). Se investigó antes
   de anotarlo: `tests/e2e/07-seguimiento-adr45.spec.ts` no fue tocado por ninguno de los tres
   encargos. Se corrió el fichero completo aislado (ambos navegadores) — **10/10** — y luego se repitió
   la matriz completa entera — **230/230** de nuevo, sin ninguna falla. La causa más probable es un
   flake sensible a la carga del sistema (el fichero depende de estado construido en orden por las
   pruebas anteriores de la misma serie), no una regresión introducida por los tres encargos: ninguno
   tocó ese fichero, `mis-tareas` ni el manejo de foco.

**Lo que cerraron los tres encargos, confirmado contra el código, no contra sus propios reportes:**

- **Coerción (T-10)**: la fuga real que había — el servidor devolvía `miRespuesta: 'Sí'/'No'/…` en
  cada lectura, inmediata y posteriores — se cerró con `yaVotaste: boolean` (dice sólo que la persona
  ya se manifestó, nunca en qué sentido). Tocó `presenters.ts`, `page.tsx` (propiedad exclusiva del
  encargo), y de forma mínima y aditiva el contrato HTTP, arreglando en consecuencia las pruebas
  preexistentes que dependían de la forma vieja. Ver fila T-10 actualizada en `seguridad-y-tecnologia`.
- **Campos (13 campos de iniciativa)**: de los 13, 9 ya existían; los 4 que genuinamente faltaban
  (recursos, riesgos, presupuesto condicional, equipo explícito) quedaron modelados en dominio PURO
  (`packages/domain/src/execution/`) con schemas Zod espejo en `packages/contracts/src/iniciativas.ts`
  y 68 pruebas nuevas, incluida una propiedad de fast-check con oráculo independiente (Kahn vs DFS)
  para el rechazo de ciclos en dependencias. **No están integrados**: el ledger real
  (`workspace/initiative.ts`) no escribe estos campos todavía, y el presenter/DTO de la API no los
  expone — son piezas de dominio y frontera listas para usarse, no funcionalidad de punta a punta. Ver
  filas de `recursos` y `presupuesto` actualizadas en `ejecucion`.
- **Conteo oculto**: el veredicto `NO CUMPLE` de la auditoría original sobre «resultados parciales
  ocultos durante la votación» era **falso**. Probado contra las cuatro rutas alcanzables desde una
  decisión abierta, con tres identidades y papeletas en sentidos opuestos: ninguna filtra el desglose.
  Regresión de 17 casos contra Postgres real en `tests/integration/conteo-oculto.test.ts`, con prueba
  de control (cierre real → SÍ aparece el desglose) para que la garantía no sea un cascarón. Ver fila
  actualizada en `deliberacion`.

**Lo que sigue exactamente igual, sin tocar en esta pasada**: el hallazgo crítico de carga en el pico
de cierre de votación (`service.ts`/`repository.ts`, ver `testing` abajo) — sigue siendo el pendiente
más urgente de todo este documento.

---

## Pasada de documentación — 2026-08-24 (encargo C)

Esta pasada no tocó código: **corrigió `docs/OBJETIVO.md`, `docs/HANDOFF.md` y `README.md`** contra
lo que hay hoy en el árbol, sobre el mismo commit `6251d60` de la segunda pasada REMATE. `HANDOFF.md`
llevaba **dos días** afirmando cosas falsas (pantallas que ya existían dadas por faltantes,
`GitForgeClient` dado por sin implementar en un corte previo) y quedó corregido con salida de
comandos pegada, no parafraseada — el detalle está en `docs/HANDOFF.md` §12.0-bis.

**Los siete comandos de verificación se corrieron de nuevo, completos, hoy:**

1. `pnpm run typecheck` — **0 errores**.
2. `pnpm run lint` — **0 errores** (eslint + `prettier --check` + `scripts/check-domain-purity.mjs`).
3. `pnpm run build` — **verde**.
4. `pnpm run build:web` — **verde**, Next.js 15.5.23, 34 rutas (25 estáticas + 9 dinámicas).
5. `KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run` — **`Test Files 179 passed (179)` ·
   `Tests 2824 passed (2824)`**, 0 fallos, contra PostgreSQL 16 real. Coincide exactamente con la
   cifra que este documento y `HANDOFF.md` venían citando de la pasada anterior — **hoy además se
   ejecutó, no se heredó**.
6. `KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox` —
   **`230 passed (2.6m)`, 0 fallos.** El flake de `07-seguimiento-adr45.spec.ts` que preocupaba a las
   dos pasadas anteriores no se reprodujo hoy tampoco.
7. `grep -rn "\.fails(\|\.skip(" tests packages services` — **vacío**: sigue sin quedar ningún
   `it.fails` ni `skip` en el árbol.

**Un hallazgo nuevo, de infraestructura, no de código:** producción está **desactualizada**. Por SSH
de sólo lectura (`docker inspect`, `docker exec … psql`, y `curl` contra las URLs públicas) se
confirmó que el contenedor `koinonia-api` se creó el **2026-08-23 17:53**, antes de que existiera
`docs/OBJETIVO.md` (creado a las 21:24 ese mismo día) y antes de los 22 agentes en paralelo de la
pasada REMATE. Tiene aplicadas sólo **11 de las 13** migraciones (`0001`–`0011`; faltan
`0012_sesion_endurecida` y `0013_rate_consumption_idempotencia`), y las rutas `/concentracion` y
`/aprendizajes` —que sí existen en el árbol local— dan `404` en producción. Las 13 pantallas que
**sí** estaban antes de ese corte responden `200`. Detalle en `docs/HANDOFF.md` §7 y en la fila de
`ux-pantallas` abajo. No es un pendiente de código de este documento: es información para quien
decida cuándo redesplegar (fuera del alcance de un agente sobre esta VPS).

**Lo que este documento no re-verificó hoy**, para ser honesto sobre el límite de esta pasada: las
**87** filas de la tabla de abajo **no se recorrieron una por una otra vez**. Se comprobaron
puntualmente las filas de `ux-pantallas` (pantallas, navegación, producción) porque eran las que
`HANDOFF.md` citaba mal, y quedan corregidas con su propia evidencia. El resto de la tabla queda tal
como la dejó la segunda pasada REMATE (2026-08-24, más arriba), que ya citaba comandos y líneas de
código para cada verificación marcada como tal.

---

## Sesión de reauditoría — 2026-08-25 (seis auditores, un consolidador)

Esta pasada tampoco tocó código: **seis auditores** —cada uno propietario exclusivo de un área—
recorrieron las 91 filas pendientes de la tabla de abajo, una por una, contra el commit `3ef178d`.
El rastreo mecánico (grep, conteo, listado de workflows) se delegó a un enjambre en paralelo
(`enjambre.sh flash`/`flash-alto`/`pro`); **cada conclusión se comprobó a mano** antes de firmarla —
citando fichero y línea, no repitiendo el reporte de un obrero barato. En dos casos la comprobación
directa cambió lo que el enjambre había resumido de forma más optimista (la desaparición de
`miRespuesta` en R4, y el estado real —no verificable por código— de la pregunta de Ley 1581).

**Los seis reportes, resumidos:**

- **`flujo-principal`** (12 filas): 4 pasan a `CUMPLE` (enmiendas, iniciativa con 4 campos, hitos,
  tareas). Objeciones baja de `NO CUMPLE` a `NO ALCANZABLE` — el motor valida de verdad pero no hay
  ruta ni botón para desestimar. El flujo de punta a punta sube de `NO ALCANZABLE` a `PARCIAL`: es
  recorrible por la interfaz, pero le faltan dos eslabones que **no existen en absoluto** (informe
  periódico, extracción automática de aprendizajes). Persisten 3 `PARCIAL` genuinos con hueco
  concreto (alternativas sin costo, autoría oculta a medias, seguimiento sin informe).
- **`deliberacion` + `motor-decisiones`** (6 filas no-`CUMPLE`): 1 pasa a `CUMPLE` (separación
  argumento-popularidad — no hay nada que ocultar porque el mecanismo de apoyos no existe). Las otras
  5 mantienen veredicto con evidencia fresca; matiz importante en concentración de poder: el umbral
  HHI **sí** se visualiza, la alerta temporal de ventana **sigue sin cablear**.
- **`ejecucion`** (13 filas): 4 pasan a `CUMPLE` (escalones 0, 1, 2 y 6, integrados de punta a
  punta: dominio puro, ruta `GET /iniciativas/:id/escalones`, pintados en `/mis-tareas`). El kanban de
  4 estados funciona pero el pliego pide 5 y el quinto («cerrada») no tiene hecho de dominio que lo
  sostenga — sigue `PARCIAL`, no `CUMPLE`, por ser fiel al requisito literal. 7 quedan sin cerrar,
  entre ellos retrospectivas de 5 preguntas, que **no existe** (lo más cercano son 4 categorías
  libres del módulo de aprendizajes de ADR-0053).
- **`seguridad-y-tecnologia`** (27 filas, área completa): **hallazgo nuevo relevante** — la CI de
  GitHub Actions nunca corrió con éxito ni una sola vez, verificado con `gh` en vivo. Pasa de
  `NO VERIFICADO` a `NO CUMPLE`. El resto de amenazas T-01 a T-20 se rastreó con el enjambre y se
  verificó a mano por muestreo; casi todas tienen código y test real, con huecos puntuales concretos
  (Argon2id nunca implementado pese al ADR, VACUUM ausente, T-19 sin cablear a rutas HTTP, T-01 con
  código y tests pero sin quórum real 2-de-3 en producción hoy).
- **`testing` + `ux-pantallas`** (15 filas): producción quedó redesplegada y las 16 rutas responden
  `200`. La matriz de navegadores se reconfirmó **230/230** (el flake de foco era saturación del
  host, no defecto de producto). El hallazgo crítico de `emitirPapeleta`/`persistDecisionLog` sigue
  sin corregir línea por línea. **Nuevo dato cuantificado**: el mutation score real es **77,67%**,
  por debajo del piso de ruptura de 85% configurado. El E2E cubre por contenido sólo 5-6 de los 9
  escenarios obligatorios del §6 de `TESTING.md` — voto secreto y privacidad/PII-Vault no tienen
  ningún spec dedicado. Las 3 pantallas nuevas (`/concentracion`, `/aprendizajes`, `/asistente`) no
  tienen ni un test de navegación ni de axe.
- **`privacidad` + `identidad-voto` + `memoria-inmutable` + `constitucion` + `asistente-ia`**
  (17 filas): «Derecho de supresión» sube a `CUMPLE` — prueba de integración real end-to-end contra
  Postgres que borra físicamente PII y confirma que `/integridad` sigue verde. «Anclaje ACTIVO en
  producción» sube a `CUMPLE`, apoyado en el estado ya medido (13 checkpoints, 15 cabeceras de
  Bitcoin verificadas) más el código real de la tarea periódica. Y **«Verificabilidad individual del
  voto (R4)» BAJA** de `PARCIAL` a `NO CUMPLE`: el arreglo de coerción del 2026-08-24 quitó el único
  campo que aún se parecía a un recibo, y hoy no queda ningún medio de comprobar el voto propio. Nota
  de esquema: Ley 1581 estaba `NO VERIFICADO` en el documento original, valor que la tabla de este
  formulario no admite; se mapea a `NO CUMPLE` sólo por esa restricción — la sustancia real es que
  sigue siendo una pregunta jurídica abierta, no una falla de código.

No se tocó código en ninguno de los seis reportes: sólo lectura y comandos de sólo lectura (grep,
`gh run`/`gh api`, `curl`, `ls`, corridas de test aisladas).

---

## Los 63 pendientes, por área

**Nota 2026-08-25**: de las 91 filas evaluadas, **28 llegaron a `CUMPLE`** (23 esta ronda, 5 que ya
lo habían alcanzado en pasadas anteriores) y **quedan 63 abiertas**. Siguiendo la instrucción de este
encargo, las que llegaron a `CUMPLE` **no se listan fila por fila** —se resumen al inicio de cada
área— porque esa lista ya no es trabajo pendiente; las 63 que siguen abiertas **sí se listan una por
una, con qué falta**, porque ésa es la lista de trabajo de quien continúe.

### asistente-ia — 2 pendientes

Sin cambios de veredicto esta ronda.

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | ¿Hay un proveedor de IA conectado de verdad (OpenAI, Anthropic, Gemini, etc.)? `services/api/src/http/app.ts:1853-1855` configura `puertoIA: undefined, destinoIA: undefined` a mano, con comentario explícito de que la ausencia es intencional. **Falta**: adaptador real + decisión de proveedor, presupuesto y política de datos (gobierno, no código — ver «Lo que NO entra»). |
| `PARCIAL` | Tasa de aceptación de sugerencias se mide agregada (colectivo), nunca por persona. `tasaDeAceptacionColectiva` (`packages/domain/src/assistant/types.ts:1101-1129`) opera puramente sobre conteos agregados, con mínimo de borradores antes de calcular — el diseño ya protege el anonimato. **Falta**: engancharla a un endpoint real sobre datos de producción y a una pantalla que la muestre. |

### constitucion — 2 pendientes

Sin cambios de veredicto esta ronda.

| Estado | Requisito |
| --- | --- |
| `PARCIAL` | Existe pantalla que muestre constitución, núcleo y vías de reforma. `apps/web/app/normas/page.tsx` consume `GET /normas` y renderiza núcleo intangible y vías de reforma. **Falta**: un acto fundacional real en producción (`POST /normas/fundacion`, ejecutado por una persona con autoridad) para que la pantalla muestre una constitución vigente en vez del estado pre-fundación. |
| `PARCIAL` | Las garantías superiores (deliberación, quórum, supermayoría, ratificación, M-de-N) son CONFIGURABLES. `ReformRequirements` (`packages/domain/src/constitution/types.ts:116-138`) modela los 5 parámetros como datos versionados, probado en dominio y API. **Falta**: una pantalla en `apps/web` que permita proponer una reforma tocando `requisitos` — hoy sólo es alcanzable desde dominio y API, no desde la interfaz — y, antes que eso, el acto fundacional de la fila de arriba. |

### deliberacion — 1 pendiente

**2 pasan a `CUMPLE` esta ronda** y ya no se listan: separación argumento-popularidad (no existe
ningún mecanismo de apoyos/reacciones en el sistema, confirmado por grep exhaustivo sin falsos
negativos — si el pliego quería un mecanismo de reacciones que se oculte sólo durante perspectivas,
eso es un requisito distinto, aún por construir) y resultados parciales ocultos durante la votación
(ya confirmado en la pasada del 2026-08-24 con regresión de 17 casos contra Postgres real).

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Voto secreto (Etapa 1 MVP): papeletas seudónimizadas con recibo/tracker que permite a cada votante verificar su voto. `grep -rn 'recibo|tracker|verificar.*voto|voteReceipt'` en dominio, API y web: los únicos resultados son de proyecciones internas del ledger, no un mecanismo de recibo para quien vota. **Falta**: un identificador/hash de la papeleta emitida (sin el sentido del voto) que el sistema devuelva a quien vota y que permita comprobar después, contra el tally publicado, que la papeleta propia fue contada tal cual se emitió — hoy no existe ningún campo, tabla ni endpoint para esto en ninguna de las tres capas. Relacionado directamente con R4 en `identidad-voto` abajo. |

### ejecucion — 9 pendientes

**4 pasan a `CUMPLE` esta ronda** y ya no se listan: escalón 0 (por-vencer, 48h antes), escalón 1
(atrasada, marcada en la tarea no en la persona), escalón 2 (consultada, a las 72h) y escalón 6
(en-revisión-colectiva, tras 3 reasignaciones o patrón en el círculo) — los cuatro con cálculo puro
en `packages/domain/src/execution/escalones.ts`, ruta `GET /iniciativas/:id/escalones` cableada en
`app.ts`, y pintados en `apps/web/app/mis-tareas/page.tsx`.

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Notificación a quien tiene tarea B cuando tarea A se destraba (dependencia resuelta). `grep -rln "DependencyResolved\|dependencia.*resuelta\|notifica.*dependenc"` en dominio, contratos y API: sin resultados. **Falta**: el evento de dominio (p. ej. `TaskUnblockedByDependency`) que dispare cuando la tarea A se complete y exista una tarea B con `dependsOn=A`, más el canal que se lo entregue a quien tiene B — hoy no existe ni el disparador ni el transporte. |
| `NO CUMPLE` | Escalón 7 (encargo retirado): excepcional, nunca automático, requiere consentimiento del círculo y apelable. `puedeSuspenderDominio()` en `escalones.ts` es una función pura que sólo devuelve `true`/`false` — no emite ningún evento. **Falta**: el evento de dominio real en `workspace/initiative.ts` que retire el encargo (con el consentimiento del círculo como precondición dura) y la ruta/pantalla que lo dispare y lo haga apelable; hoy sólo existe el predicado de elegibilidad, aislado. |
| `NO CUMPLE` | Retrospectivas: 5 preguntas contrastadas contra lo declarado al inicio, generan aprendizajes. No existe: lo más cercano es el módulo de aprendizajes de ADR-0053, con 4 categorías libres, no 5 preguntas contrastadas contra lo declarado al inicio del encargo. **Falta**: construir el formulario de 5 preguntas estructuradas que el pliego pide, distinto del formulario libre actual. |
| `PARCIAL` | Recursos: cada iniciativa declara qué recursos necesita que hoy no tiene. Dominio PURO en `packages/domain/src/execution/recursos-y-riesgos.ts` con schema Zod espejo en `packages/contracts/src/iniciativas.ts`, probado. **Falta**: ningún evento del ledger real (`workspace/initiative.ts`) persiste esto todavía, y ni el presenter de la API ni `IniciativaDetalle` lo exponen — falta conectar el dominio puro ya probado con el agregado y con la respuesta HTTP. |
| `PARCIAL` | Presupuesto cuando aplique (con soportes): no aparece si no aplica. Dominio PURO en `packages/domain/src/execution/presupuesto.ts` (`Presupuesto \| undefined`, nunca `null`, exige ≥1 soporte), con schema Zod espejo. **Falta**: mismo hueco que «Recursos» — no hay evento del ledger que lo escriba ni presenter que lo exponga en `IniciativaDetalle`. |
| `PARCIAL` | Kanban con estados (por empezar, en curso, bloqueada, en revisión, cerrada). `apps/web/app/iniciativas/page.tsx` agrupa tarjetas en 4 secciones reales. **Falta**: la quinta columna, «cerrada» — no existe ningún hecho de gobierno de cierre de iniciativa en `workspace/initiative.ts` que `EstadoTableroIniciativa` pueda derivar honestamente; hace falta primero ese evento de dominio antes de poder pintar la quinta columna. |
| `PARCIAL` | Ayuda solicitada (`TaskHelpRequested`) detiene el reloj y abre convocatoria al círculo. El reducer pone `status='en-apoyo'`, excluido del reloj activo (confirmado); el círculo puede VER el estado vía `GET /iniciativas/:id/escalones`. **Falta**: no hay ninguna «convocatoria» activa (notificación) ni mecanismo para que alguien del círculo se registre como quien se ofrece a ayudar — sólo queda registrado quién pidió ayuda, no quién respondió. |
| `PARCIAL` | Escalón 4 (en-apoyo): pedir ayuda abre convocatoria al círculo, se registra quien se ofrece. Misma evidencia que la fila anterior: `status='en-apoyo'` visible al círculo, pero **falta** el evento/endpoint para que un miembro del círculo se registre como voluntario en una tarea en-apoyo — hoy el estado es visible pero no hay ninguna acción de «ofrecerse». |
| `PARCIAL` | Fecha de revisión (próximo informe, calendario académico) que bloquea nuevas propuestas del mismo responsable si vence sin cerrar. Existe únicamente un campo `proximaRevisionEn`/`nextReviewAt` en la escalada de decisiones (ADR-0033). **Falta**: ninguna lógica de bloqueo de nuevas propuestas del mismo responsable cuando ese campo vence sin cerrar — hoy el campo existe, la consecuencia no. |

### flujo-principal — 7 pendientes

**5 pasan a `CUMPLE` esta ronda** y ya no se listan: enmiendas (fase de deliberación que enmienda
alternativas, cableada de dominio a UI), autoría visible en la etapa de construcción de alternativas,
iniciativa vinculada a decisión con responsable/fecha/criterios, hitos fechados con criterio, y
tareas con dependencias y aceptar/rechazar/reasignar con UI completa.

| Estado | Requisito |
| --- | --- |
| `NO ALCANZABLE` | Objeciones: ronda con panel sorteado, admisión 2/3, veto bloqueante. El motor SÍ valida de verdad (`packages/domain/src/engine.ts:480-514`, caso `ObjectionDismissed`): tamaño de panel exacto, excluye a quien objeta, exige 2/3 y motivación no vacía. **Falta**: una ruta HTTP (p. ej. `POST /decisiones/:id/objeciones/:objectionId/desestimar`) que emita `ObjectionDismissed`, un algoritmo real de sorteo del círculo (hoy `panelSelection:'sortition'` es sólo una etiqueta), y la pantalla donde el panel sorteado vote y publique la motivación. |
| `PARCIAL` | Flujo entero de punta a punta: problema → solución en ejecución → evaluación → aprendizajes reutilizables. La UI recorre casi toda la cadena (`apps/web/app/decisiones/[id]/page.tsx` → `POST /decisiones/:id/cerrar` → cierre e iniciativa en la misma transacción). **Falta**: dos eslabones del pliego que **no existen en absoluto**, no que sean inalcanzables: (1) el informe cada N días que bloquea avance de estado (grep vacío en `execution` y `app.ts`); (2) la extracción automática de aprendizajes al cerrar una evaluación — hoy se escribe a mano en un formulario. |
| `PARCIAL` | Alternativas: listado separado con costo y supuesto, fase en deliberación antes de propuesta. `AlternativeBody` (`packages/domain/src/deliberation/types.ts:179-186`) sólo tiene `problemId`, `sourcePositionIds`, `text` — sin campo de costo. **Falta**: agregar un campo de costo a `AlternativeBody` (dominio + contrato Zod + UI), y una regla de dominio o de servicio que impida crear una propuesta sin una deliberación en `listo_para_decidir` que la origine. |
| `PARCIAL` | Deliberación con fases (Preguntas, Perspectivas): escritura por etapa, revelación diferida de autoría. `STAGE_TRANSITIONS`/`STAGE_RULES` regulan bien qué se escribe en cada etapa. La ocultación de autoría (`access.ts:383`) sólo aplica `deniedDuringStage: 'perspectivas'`. **Falta**: decidir si el pliego pide ocultar la autoría también en `preguntas_aclaratorias` (la etapa donde se hacen las preguntas) y no sólo en `perspectivas`; si sí, ampliar `deniedDuringStage` a ambas etapas. |
| `PARCIAL` | Seguimiento: informe cada N días, sin él no avanza de estado, bloqueo/ayuda/reasignación. Sólo existe la escalada temporal de tareas individuales (`packages/domain/src/execution/escalones.ts`). **Falta**: el «informe cada N días» como requisito de avance de estado de la iniciativa (evento + ruta + regla de dominio que bloquee la transición si no se rindió), distinto de la escalada de tareas individuales que ya existe. |
| `PARCIAL` | Aprendizajes: extraídos de evaluación, reutilizables en siguiente problema similar. La reutilización SÍ es real: `GET /aprendizajes/parecidos` usa un algoritmo léxico genuino (normaliza texto, quita tildes y palabras vacías). **Falta**: que al cerrar una evaluación el sistema proponga o derive un aprendizaje automáticamente a partir del `evaluationReport`, en vez de depender enteramente de que una persona lo redacte a mano. |
| `PARCIAL` | 13 campos de iniciativa si decisión requiere ejecución: objetivo, responsable, evaluación, criterios, hitos, tareas, dependencias, esfuerzo, recursos, riesgos, presupuesto, equipo, plazo. Sin cambios esta ronda respecto a la fila `recursos`/`presupuesto` de `ejecucion`: 9 de 13 ya están integrados de punta a punta (varios subieron a `CUMPLE` esta ronda como filas propias), 4 siguen modelados en dominio puro sin escribir al ledger real. |

### identidad-voto — 6 pendientes

Ningún `CUMPLE` nuevo esta ronda. Al contrario: una fila **baja** de veredicto.

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Verificabilidad individual (R4) — ¿puedo comprobar que mi voto está tal como lo emití? **Baja de `PARCIAL` a `NO CUMPLE`**: ADR-0010 diseña un recibo/tracker de 160 bits que nunca se construyó, y el propio arreglo de coerción (T-10, 2026-08-24) quitó el único campo (`miRespuesta`) que aún se parecía a una confirmación de voto — hoy la API no devuelve nada, ni `ballotId` ni tracker, que permita verificar el voto propio. **Falta**: implementar el recibo/tracker del ADR-0010 (o equivalente, p. ej. nullifier de Belenios) que permita verificar el voto SIN exponer el sentido a quien coacciona. |
| `NO CUMPLE` | Secreto del voto (R3) — ¿criptográficamente verificable o promesa del servidor? `packages/crypto/src/index.ts:14-76` sólo trae JCS, SHA-256, cadenas de hash y árboles Merkle de auditoría — nada de ElGamal, mixnet ni ZKP. **Falta**: cifrado homomórfico verificable (ElGamal con descifrado de umbral, tipo Belenios) o mixnet — hoy la plataforma ni siquiera permite ABRIR una decisión que pida secreto duro, la deriva a papel. |
| `NO CUMPLE` | Resistencia a manipulación administrativa (R6) — ¿el admin puede alterar votos sin que se detecte? `Ballot.voter: MemberId` viaja en claro dentro de cada evento, sin credencial ciega ni nullifier. **Falta**: credencial ciega o nullifier (línea Belenios de ADR-0018) que haga que fabricar o alterar una papeleta sea detectable estructuralmente, no sólo por comparación posterior contra un ancla externa. |
| `NO CUMPLE` | `IdentityProviderAdapter` preparado para integración institucional (UdeA, LDAP, OAuth). La interfaz existe (`services/api/src/http/ports.ts:78-81`), pero la única implementación real es `udeaIdentityAdapter`, que valida en memoria sólo el sufijo del dominio del correo. **Falta**: un adaptador real que hable con un IdP institucional (LDAP/SAML/OAuth de la UdeA) en vez de validar sólo el sufijo del correo. |
| `NO CUMPLE` | Criptografía no inventada: evaluar Helios o Belenios para voto secreto verificable. Helios/Belenios sólo aparecen en documentos (ADR-0010, ADR-0018) — la evaluación documental está hecha. **Falta**: implementar de verdad la ruta que el propio ADR-0018 ya recomienda (Belenios) para la Etapa 2 — la evaluación está hecha, la implementación no ha empezado. |
| `PARCIAL` | Separación criptográfica entre identidad verificada y actividad anónima. Hay separación real por diseño de aplicación: `MemberId` es CSPRNG de 128 bits jamás derivado de PII, y `identity.ts` es la única frontera que traduce correo↔MemberId. **Falta**: credencial ciega o firma ciega que impida INCLUSO a quien administra la API reconstruir el vínculo identidad↔actividad — hoy la separación es de capas de código (defendible pero reversible por quien tiene acceso al vault), no criptográfica. |

### memoria-inmutable — 1 pendiente

**El requisito central pasa a `CUMPLE` esta ronda**: Anclaje ACTIVO en producción (checkpoints
emitidos periódicamente, anclados, verificables) — ver la sección protegida «Estado del despliegue»
más abajo para el detalle completo, comprobado criptográficamente contra Bitcoin.

| Estado | Requisito |
| --- | --- |
| `PARCIAL` | Transporte de correo: SMTP con DKIM, acuses firmados por testigo con ssh-keygen, IMAP recoge acuses y rebotes. Implementación real, no stub: `smtpWitnessTransport` (`services/api/src/anchor/correo.ts:121-208`) firma DKIM real y envía por socket. **Falta**: designar testigos reales (padrón de correos institucionales de distintos dominios) y configurar SMTP/IMAP/DKIM en producción — el código está listo y probado, falta la operación humana de designación. |

### motor-decisiones — 4 pendientes

Sin cambios de veredicto esta ronda; evidencia actualizada, con un matiz nuevo en concentración de
poder.

| Estado | Requisito |
| --- | --- |
| `PARCIAL` | Se deben poder elegir los métodos desde la interfaz o desde la API al abrir una decisión. `apps/web/app/decisiones/abrir/page.tsx` lista los 9 métodos del catálogo con radios reales. **Falta**: extender el contrato `emitirPapeleta` con ramas de papeleta para puntuación (score), orden (ranked-choice/condorcet) y menciones (majority-judgment), y habilitar en el servidor la apertura de decisiones sobre varias opciones — hoy una votación se abre sobre un solo texto — para que los 4 métodos restantes del catálogo de 9 dejen de estar deshabilitados en la pantalla de apertura. |
| `PARCIAL` | Implementar doce métodos de votación: mayoría simple, supermayoría, consentimiento, consenso, advice process, score voting, ranked choice, majority judgment y los demás. `ID_METODOS` (`packages/contracts/src/metodos.ts:47-56`) tiene exactamente **9, no 12**. **Falta**: los 3 métodos restantes del pliego original de doce (o una justificación documentada de por qué se reduce a 9) — y de los 9 existentes, sólo 5 son abribles hoy desde la interfaz. |
| `PARCIAL` | Se VISUALIZA la concentración de poder como pide el pliego. `GET /concentracion/delegaciones` calcula HHI normalizado, CR1 y Gini de verdad, y la alarma se muestra cuando HHI normalizado ≥ 0,15 (`HIGH_CONCENTRATION_HHI`), coincidiendo con el umbral del pliego — **esto sí se visualiza**. **Falta**: cablear `alertaConcentracionTemporal` y `respetaVentanaMinima` (`packages/domain/src/window-guard.ts`) a una ruta de la API para que la alerta de concentración temporal (>40% en el último 10% de la ventana) y el piso de 72h se apliquen y se muestren en pantalla igual que ya se hace con el umbral HHI/CR1; también sigue sin comprobarse el tope de postulantes/objeciones que menciona T-19. |
| `PARCIAL` | Los ocho parámetros congelados deben ser verificables en tests que garanticen que la invariante se mantiene. No existe en el código ninguna lista explícita de «ocho parámetros congelados» — sólo la propia fila de este documento la menciona. **Falta**: identificar en el código o en un ADR cuáles son exactamente los ocho parámetros congelados que exige el pliego, y escribir una prueba que los enumere y verifique uno por uno — hoy sólo hay una prueba genérica de `Object.freeze` sobre todo el objeto más 2-3 pruebas puntuales de que ciertos campos entran en el hash, sin cubrir explícitamente los ocho. |

### privacidad — 4 pendientes

**Derecho de supresión pasa a `CUMPLE` esta ronda**: prueba de integración real end-to-end contra
Postgres (`tests/integration/http-tareas-adr44.test.ts:940-1030`) que sella la solicitud, suprime PII
físicamente y confirma que `/integridad` sigue verde antes y después.

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | El padrón es auditable y sus cambios son eventos. `upsertMember` (`services/api/src/http/identity.ts:190-224`) hace `INSERT ... ON CONFLICT DO UPDATE` directo sobre `identity.member`, sin emitir ningún evento al ledger. **Falta**: emitir eventos versionados (p. ej. `MemberAdmitted`/`MemberWithdrawn`) para cada alta/baja/cambio de rol, tal como propone ADR-0054 — hoy es sólo una recomendación no aceptada, el código sigue mutando la tabla en silencio. |
| `NO CUMPLE` | Detectabilidad de manipulación del padrón. `rollHash` (`packages/domain/src/electorate.ts:97-99`) sólo protege el padrón ya CONGELADO al abrir una decisión. **Falta**: versionar el padrón vivo con historial detectable (ADR-0054) — hoy `rollHash` sólo detecta sustitución POSTERIOR al congelamiento, no manipulación previa a la apertura, que es exactamente el vector descrito en el ADR. |
| `NO CUMPLE` | Riesgo jurídico Ley 1581: ¿un seudónimo destruido sigue siendo dato personal? El veredicto real es «pregunta jurídica abierta, no verificable por código» (mapeado a `NO CUMPLE` sólo por restricción de esquema de esta tabla). **Falta**: un concepto formal de la SIC (Delegatura de Protección de Datos) o dictamen de abogado especializado en habeas data sobre si un seudónimo con clave destruida deja de ser «determinable» bajo el art. 3 lit. c de la Ley 1581. No es tarea de ingeniería. |
| `PARCIAL` | Ningún dato personal en la cadena pública (ledger). `packages/domain/src/ids.ts:14-19` documenta la decisión: 128 bits de CSPRNG, jamás derivados de PII; el dominio no conoce nombres ni correos. **Falta**: una prueba de regresión que recorra el esquema completo de tipos de evento del ledger (o su serialización JSON) buscando patrones de email/nombre y falle si aparece alguno, para convertir la garantía de disciplina en invariante verificada. |

### seguridad-y-tecnologia — 12 pendientes

Área revisada entera (27 filas). **15 pasan a `CUMPLE` esta ronda** y ya no se listan: ANCLAJE
(estado en producción), T-02 (BD append-only), T-03 (borrado de agregado), T-05 (doble voto), T-07
(manipulación de propuesta en OPEN), T-08 (cambio de quórum en marcha), T-09 (colusión de delegados),
T-10 (coerción del votante — nota: el arreglo de esta fila es lo que hizo bajar R4 en
`identidad-voto`), T-25 (abuso del asistente IA), Docker + reproducible, Backups automáticos
probados, más las 4 que ya eran `CUMPLE` de pasadas anteriores (PWA, PostgreSQL append-only,
TypeScript estricto, Next.js 15.5).

**Hallazgo nuevo y el más serio de esta pasada**: la CI de GitHub Actions nunca corrió con éxito ni
una sola vez — verificado en vivo con `gh api`, 0 ejecuciones en cada uno de los 4 workflows activos.

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | TECNOLOGÍA: CI/CD (qué corre en cada push). `gh api repos/stevenvallejo780/koinonia/actions/workflows` lista 4 workflows activos (`ci.yml`, `e2e-matriz-completa.yml`, `mutacion.yml`, `nocturno.yml`) con **0 ejecuciones registradas cada uno**; las corridas que aparecen en `gh run list` son todas `startup_failure` (`BuildFailed`) de IDs de workflow huérfanos de commits anteriores. **Falta**: diagnosticar por qué GitHub rechaza el arranque de los 4 workflows vigentes (revisar el run más reciente en la UI de Actions, posible límite de minutos/gasto de la cuenta) y lograr al menos una corrida real y verde antes de afirmar que la CI corre nada en cada push — hoy literalmente no corre. |
| `NO CUMPLE` | TECNOLOGÍA: Almacenamiento compatible S3. `services/api/src/almacen/s3.ts` sigue lanzando `AlmacenS3NoDisponibleError` a propósito; `disco.ts` es la implementación real sobre disco local. **Falta**: autorizar `@aws-sdk/client-s3` e implementar `s3.ts` de verdad — la forma ya está lista, falta la implementación (y la autorización de la dependencia nueva). |
| `PARCIAL` | T-01 (Reescritura de historia por administrador) — checkpoint Merkle, triple anclaje 2de3, verificador público. Código y tests SÍ existen (`services/api/src/ledger/checkpoint.ts`, `packages/anchor/src/quorum.ts:47` con `MIN_INDEPENDENCE_CLASSES = 2`, `packages/verifier-cli/src/verificar.ts`). **Falta**: activar padrón de veeduría y/o testigos de correo para tener ≥2 clases de anclaje simultáneas en producción; hoy el mecanismo está probado pero no operando con quórum real. |
| `PARCIAL` | T-04 (Sybil) — padrón congelado, hash sobre `MemberId` ordenados, prueba de inclusión Merkle. `freezeElectorate`/`computeRollHash` existen y están probados. **Falta**: conectar una prueba de inclusión Merkle real del padrón congelado — hoy sólo existe el hash global, no una prueba por miembro. |
| `PARCIAL` | T-06 (Robo de sesión) — reautenticación obligatoria a los 30 minutos antes de votar. Sin cambios desde 2026-08-23: `grep -rn "30.*min\|reautent\|REAUTH"` no encontró código de reautenticación antes de votar. **Falta**: implementar la reautenticación obligatoria a los 30 minutos antes de emitir papeleta — sigue sin existir ningún código para esto. |
| `PARCIAL` | T-11 (Fuga PII) — vault cifrado esquema separado, Argon2id+pepper solo dentro, sin hash identificador en ledger, DELETE+VACUUM. Esquema `identity` separado, cifrado AES-256-GCM real y probado; `MemberId` es aleatorio de 128 bits, no hash de PII. **Falta**: implementar Argon2id de verdad para lo que hoy el ADR promete (el pepper existe, Argon2id no); programar VACUUM/VACUUM FULL tras el borrado físico — hoy es sólo una tarea operativa documentada, no código. |
| `PARCIAL` | T-12 (Spam/saturación) — objeción por proceso (1, 2ª con respaldo) sigue sin verificar. Sin cambios desde 2026-08-23: cupos de propuesta/comentario ya verificados y con el defecto de idempotencia corregido (ADR-0055 en comentarios de código, aunque el fichero ADR no existe). **Falta**: verificar el cupo de 1 objeción por proceso (2ª con respaldo) — no se tocó en esta ronda. |
| `PARCIAL` | T-19 (Captura por grupo organizado) — topes de postulación y de objeciones sin verificar. `respetaVentanaMinima` y `alertaConcentracionTemporal` existen y están probados, pero ninguna ruta de `app.ts` los invoca. **Falta**: cablear `window-guard.ts` a la apertura/cierre de decisión en `app.ts`; sigue siendo motor sin ruta que lo llame — inalcanzable desde la API hoy. |
| `PARCIAL` | T-20 (Correlación votante↔voto por temporización) — sin timestamps en urna, lotes k≥10 barajados, sin IP en app. Verificado: NO hay lotes barajados — `emitirPapeleta` persiste síncrono e inmediato evento a evento. **Falta**: implementar el lote de tamaño k≥10 barajado antes de persistir, y quitar/no exponer el timestamp de emisión por papeleta — hoy la mitigación real es sólo la ausencia de IP, no la anonimización temporal. |
| `PARCIAL` | TECNOLOGÍA: Colas/Jobs (BullMQ, RabbitMQ, etc.). Sin cambios: `services/api/src/jobs/cola.ts` es una cola casera sobre PostgreSQL (`SELECT … FOR UPDATE SKIP LOCKED`), no la tecnología nombrada. **Falta**: sigue sin ser BullMQ/RabbitMQ; funciona pero no es lo que pide la fila literalmente. |
| `PARCIAL` | T-18 (Manipulación del padrón) — procedencia no verificable PRE-congelado. `grep -n "procedencia\|origen\|source\|provenance"` en `electorate.ts` no encontró ningún campo de procedencia en el padrón; el commit `c89e3b9` registra el hueco pero no lo cierra. **Falta**: añadir procedencia verificable de altas del padrón antes de congelarlo — sigue sin existir en `electorate.ts`. |
| `PARCIAL` | ADRs: total 54, estado (Propuesto\|Aprobado\|Depreciado), bloqueadores. Confirmado por `ls docs/adr/`: **no existe `0055-*.md` ni `0056-*.md`**, mismo hueco de trazabilidad que antes (el commit más reciente, `c89e3b9`, es ADR-0054, no 0055). **Falta**: escribir el ADR-0055 que documente la decisión de idempotencia del cupo ya aplicada en código — sigue sin existir el fichero. |

### testing — 10 pendientes

Ningún `CUMPLE` nuevo esta ronda. La única fila que cambia de veredicto es «Exploratorias manuales»
(de `NO VERIFICADO` a `PARCIAL`, ya con evidencia). El hallazgo crítico de carga sigue **exactamente
igual, sin corregir**: es el pendiente más urgente de todo este documento.

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Testing de performance/carga (k6; tally/replay/ballots; Slow 3G; pico de cierre). Bajo 300 papeletas simultáneas al cerrar, sólo 3 quedan contadas, 266 dan `500`, 31 dan `201` sin guardarse. Causa: `emitirPapeleta` no reintenta ante `HeadConflictError`, y `persistDecisionLog` confunde «nada que escribir» con «ya se escrito». **Falta**: reescribir `emitirPapeleta` con reintento acotado ante `HeadConflictError` (releer cabeza, reaplicar el comando, no asumir éxito silencioso) y corregir `persistDecisionLog` para que «pending.length===0 por escritura concurrente» no se confunda con «nada que escribir porque el cliente ya estaba al día»; después repetir la corrida de `tests/carga/node` con `CARGA_N=300` y confirmar 300/300 contadas, 0 fantasmas. |
| `PARCIAL` | Coverage thresholds por paquete, falla el build debajo del piso. `vitest.config.ts` tiene piso real por paquete, pero una corrida de `test:coverage` tuvo 6 ficheros con `afterAll` colgado (agotamiento de conexiones Postgres), sin confirmar una corrida limpia. **Falta**: correr `pnpm run test:coverage` completo en un host descargado, aislado, y confirmar que ningún paquete cae debajo de su piso y que el comando efectivamente sale con código distinto de 0 si se fuerza una caída de cobertura de prueba. |
| `PARCIAL` | Exploratorias manuales: formato obligatorio, reportes sin vaguedades, conversión en regression tests. `docs/TESTING.md:411-415` define el formato obligatorio de tabla y documenta un hallazgo real convertido en regresión (fuga de `miRespuesta` en voto). **Falta**: el proceso existe y produjo al menos un hallazgo real convertido en regresión, pero sólo cubre 3 escenarios de límites/secreto; falta una ronda exploratoria sistemática sobre el resto de la superficie (deliberación, ejecución, delegación) con el mismo formato, y evidencia de que se repite como práctica, no como evento único. |
| `PARCIAL` | Property-based testing (fast-check) con invariantes INV-01…INV-60 de la PARTE E. `grep -rnE 'INV-[0-9]{2}'` da 59 de 60 (falta INV-48, confirmado también contra docs/). **Falta**: escribir el test de propiedad para INV-48 (MJ: unanimidad de mención implica esa mención mayoritaria) — es el único de los 60 sin cobertura. |
| `PARCIAL` | E2E con Playwright: 9 escenarios obligatorios de §6 TESTING.md. `find tests/e2e -name '*.spec.ts'` → 14 ficheros, pero por contenido cubren sólo 5-6 de los 9. **Falta**: escribir specs E2E dedicados a voto secreto (`privacy:'secret-ballot'`, inspección de tráfico) y a privacidad/PII Vault (borrado físico + ledger íntegro), y completar delegación (cadena de dos saltos, tope de concentración LIFO) y recuperación (restaurar backup y verificar cadena de punta a punta) que hoy sólo están descritos en TESTING.md pero no ejercitados por ningún fichero. |
| `PARCIAL` | Matriz de navegadores: Chromium, Firefox, WebKit, Chrome móvil, Safari móvil, responsive. Chromium+Firefox reconfirmados en **230/230** tras confirmar que la falla de foco en `07-seguimiento-adr45` era flake por saturación del host, no defecto de producto. WebKit no corre por `libicu74`/`libflite1`/`libmanette` faltantes en Arch. Chrome-móvil no se aisló de nuevo. **Falta**: repetir en un host sin contención: aislar chrome-móvil y confirmar en verde; WebKit y safari-móvil siguen bloqueados por libs ausentes en Arch — resolver en CI, no localmente. |
| `PARCIAL` | Mutation testing: Stryker con umbral ≥85%. `stryker.config.mjs:71-73` fija `break: 85`. El reporte más reciente (23-ago, anterior al commit actual), recalculado desde el JSON crudo con Python, da **77,67%** — por debajo del piso de ruptura. **Falta**: o se sube la cobertura de mutación de los ficheros con `NoCoverage`/`Survived` hasta pasar 85%, o se reconoce que el build debería estar fallando en este punto y no lo está porque nadie corrió `pnpm run mutation` con el código de hoy desde el 23-ago; hace falta una corrida fresca contra `3ef178d`. |
| `PARCIAL` | Accesibilidad: axe-core WCAG 2.2 AA, navegación con teclado, sin jerga prohibida, revisión manual NVDA/VoiceOver. `grep -rn AxeBuilder tests/e2e` → 6 ficheros cubriendo 21 rutas/pantallas únicas. `FORBIDDEN_UI_TERMS` reconfirmado en 26 (no 31). **Falta**: 1) la revisión manual real con NVDA+Firefox y VoiceOver+Safari sobre el escenario 1 (hoy sólo está en el plan de TESTING.md, no ejecutada); 2) agregar tests de axe a `/concentracion`, `/aprendizajes` y `/asistente`, las únicas 3 pantallas alcanzables desde la navegación que hoy no tienen ninguna cobertura de accesibilidad automatizada. |
| `PARCIAL` | Testing de seguridad: autorización, manipulación adversarial, entrada validada, tests de ataques. 12 ficheros de integración cubren casos reales concretos en verde. **Falta**: cobertura real de casos concretos existe y corre en verde, pero sigue siendo `PARCIAL` porque no hay un inventario formal contra una checklist de ataques (OWASP-style) que demuestre exhaustividad — lo que hay es orgánico, no sistemático; falta un documento que enumere qué vectores están cubiertos y cuáles no. |
| `PARCIAL` | Pipeline escalonado: pre-commit → PR (Chromium) → main (matriz completa) → nightly (exploratorias, carga, mutation). `nocturno.yml` sólo invoca la matriz completa por cron; `mutacion.yml` sí tiene cron propio (06:30 UTC), no documentado antes. **Falta**: un workflow (o extender `nocturno.yml`) que corra `tests/carga/node` y `tests/exploratorias/` de forma programada — hoy ninguno de los dos tiene disparador nocturno. Sigue sin confirmarse una corrida contra un runner real de GitHub Actions (ver CI/CD arriba: el primer push exitoso sigue siendo la prueba pendiente). |

### ux-pantallas — 5 pendientes

«Móvil primero» pasa de `NO VERIFICADO` a `PARCIAL`. Producción quedó redesplegada: las 16 rutas
(las 13 del pliego + `/concentracion`, `/aprendizajes`, `/asistente`) responden `200` — eso cierra la
parte de «producción desactualizada» que preocupaba a la pasada anterior.

| Estado | Requisito |
| --- | --- |
| `PARCIAL` | Móvil primero: responsive y accesible en pantallas pequeñas. `apps/web/app/layout.tsx` declara viewport sin `maximumScale` (no bloquea zoom, requisito WCAG); `globals.css` usa media queries mobile-first. **Falta**: confirmar en esta pasada una corrida verde del proyecto `chrome-movil` (bloqueada por `EADDRINUSE` del entorno compartido) ni de `safari-movil` (bloqueado por libs de WebKit ausentes) — falta esa corrida aislada para subir a `CUMPLE`. |
| `PARCIAL` | Catorce pantallas: Inicio, Problemas, Propuestas, Deliberaciones, Decisiones, Consenso, Iniciativas, Mis tareas, Círculos, Reuniones, Normas, Delegaciones, Historial, Verificar integridad. 13 de 14 existen (`find apps/web/app -name page.tsx`); falta sólo Reuniones (deliberado, sin dominio detrás — ver «Lo que NO entra»). |
| `PARCIAL` | Cada pantalla debe estar enlazada desde la navegación principal. Las 13 existentes están en `CONSULTA` de `marco.tsx`, cubiertas por `tests/e2e/13-navegacion.spec.ts`. **Falta**: Reuniones sigue sin construirse (bloquea el `CUMPLE` final). Además, `13-navegacion.spec.ts` quedó desactualizado — no incluye `/concentracion` ni `/aprendizajes` en su arreglo de consulta, así que esos dos enlaces nuevos de la barra no tienen verificación automatizada de alcanzabilidad ni de foco por teclado. |
| `PARCIAL` | Accesibilidad WCAG 2.2 AA: cero violaciones serias o críticas en todas las pantallas. `AxeBuilder` cubre 21 rutas/pantallas únicas. **Falta**: agregar revisión axe a `/concentracion`, `/aprendizajes` y `/asistente` (y sus subrutas) — son alcanzables desde producción hoy y no tienen ninguna verificación de accesibilidad automatizada. |
| `PARCIAL` | Producción debe responder a todas las rutas de las 14 pantallas. Las 13 rutas del pliego + las 3 nuevas responden todas `200` hoy — producción ya está al día. **Falta**: sólo la 14.ª pantalla (Reuniones), que no existe todavía en ningún entorno — no es un problema de despliegue, es de alcance. |

---

## Estado del despliegue — 2026-08-24

Lo que sigue está **aplicado y comprobado en producción**, no preparado:

| Qué | Estado | Comprobación |
| --- | --- | --- |
| Código en producción | `koinonia-{api,web}:20260824-906f4bb` | los tres contenedores `healthy`; migraciones `0012` y `0013` aplicadas al arrancar |
| **Anclaje externo** | **ENCENDIDO Y ANCLANDO DE VERDAD** | ver abajo: 13 checkpoints, 15 cabeceras de bloque de Bitcoin, y una comprobación criptográfica contra una fuente independiente |
| Las 16 rutas de la interfaz | 200 | incluidas `/aprendizajes`, `/asistente` y `/propuestas`, que antes no existían o daban 404 |
| Service worker | 200 en `/sw.js` | la aplicación ya puede funcionar sin conexión |
| Copia de seguridad | diaria, y **restauración probada** | la copia previa al despliegue verificó sus 20 tablas |
| Registro de accesos en Caddy | aplicado | y comprobado: cero secretos en el log, cero rastro de la ruta de papeleta, la cadena de consulta recortada |
| Repositorio publicado | `main` en `origin` | local y remoto coinciden por SHA |

### El anclaje, comprobado contra la cadena real

No es que el proceso arranque: es que **la historia de Koinonía ya está anclada en Bitcoin**.

A las catorce horas de encenderlo, en producción hay **13 checkpoints** y **15 cabeceras de bloque**
guardadas (de la 963933 a la 963995). El registro lo dice cuando cierra el sello:

```
[anclaje] cabeceras de bloque guardadas para el checkpoint 121: 963995 —
          el verificador independiente ya puede cerrar el sello
```

La comprobación que lo demuestra sin creerle a nadie: se tomó la cabecera cruda de 80 bytes que
Koinonía guardó para el bloque 963995, se le aplicó el doble SHA-256 y se invirtió —que es como se
calcula el identificador de un bloque de Bitcoin—, y se comparó con lo que responde un servicio
externo que no tiene nada que ver con este servidor:

```
desde la cabecera guardada : 00000000000000000001917aacd522d044ed1a6e3ffab34bf91670b0878b5ada
blockstream.info (externo) : 00000000000000000001917aacd522d044ed1a6e3ffab34bf91670b0878b5ada
```

Coinciden. El servidor no se lo puede inventar: para falsificar esa cabecera habría que falsificar
Bitcoin.

**Qué significa el `NO_ANCLADO (blockchain)` que aparece en el registro.** No es un fallo: es la
honestidad del quórum. `blockchain` es la clase que **sí** confirmó; `NO_ANCLADO` dice que todavía no
hay las **dos de tres** clases que la firma exige. Es exactamente lo que está documentado: con una
sola clase, una reescritura del pasado pasa de indetectable a detectable, pero no hay quórum. El
sistema prefiere decir «no anclado» a decir «anclado» de más, y eso es lo correcto en una garantía.

### Lo que el anclaje protege HOY, dicho sin inflarlo

Sólo **OpenTimestamps** está operativo: el arranque apaga por su cuenta las clases de git y de correo
—«sin padrón de la veeduría no hay firmantes, y un padrón vacío admitiría cualquier firma»—, que es
exactamente lo que debe hacer. Eso significa:

- **Sí se gana:** una reescritura del pasado pasa de *indetectable* a *detectable*, porque el
  checkpoint queda anclado en Bitcoin y cualquiera puede contrastarlo por su cuenta.
- **No se gana:** el quórum de firma, que exige **dos clases de tres**. Para eso hacen falta el
  repositorio de anclaje con firmas SSH y los testigos de correo — qué montar está en
  `infra/produccion/ANCLAJE.md` §7.

### Una obligación que no cierra ningún agente

Encender el registro de accesos es **literalmente** la condición que `THREAT_MODEL.md` RA-8 fija para
traer ese riesgo aceptado a revisión: «logs de proxy conservados más allá de la sesión». Se aplicó
ahora porque hoy no hay una sola persona usando la plataforma cuyos metadatos se puedan correlacionar.
**Antes de que la haya, esa revisión hay que pedirla.**

### Lo que sigue esperando a una persona

| Pendiente | Por qué no lo cierra un agente |
| --- | --- |
| **ADR-0054 — procedencia del padrón** | Decisión jurídica y política sobre qué promete la plataforma |
| **Dirección real de facilitación** | El único miembro es `operador@udea.edu.co`, que no existe: **hoy nadie puede entrar** |
| **Pantalla «Reuniones»** | No tiene dominio detrás; inventarla sería una fachada |
| **Proveedor de IA** | El puerto existe y es incapaz de decidir por tipos; falta elegir proveedor y política de datos |
| **Las otras dos clases de anclaje** | Repositorio de anclaje con firmas SSH y testigos de correo |
| **Revisión de RA-8** | Ver arriba |

---

## Lo que de verdad queda

63 filas siguen abiertas (1 `NO ALCANZABLE`, 16 `NO CUMPLE`, 46 `PARCIAL`). Ordenadas por urgencia,
separando lo que puede resolver un agente con acceso al repositorio de lo que necesita que una
persona decida, autorice o designe algo fuera del código.

### Lo que puede cerrar un agente

1. **[CRÍTICO]** Arreglar `emitirPapeleta`/`persistDecisionLog`: bajo carga real en el cierre de una
   votación, 266/300 papeletas caen con `500` y 31/300 responden `201` sin haberse guardado —falla
   de integridad electoral, no de rendimiento (`services/api/src/http/service.ts`,
   `services/api/src/decision/repository.ts`).
2. Diagnosticar y arreglar la CI de GitHub Actions — 0 corridas exitosas jamás en los 4 workflows
   vigentes; hoy no hay ninguna prueba automática corriendo en ningún push.
3. Construir la ruta HTTP y el botón de UI para **desestimar** una objeción (el motor ya valida
   panel/2-3/motivación), más un sorteo real del panel — cierra el `NO ALCANZABLE` nuevo.
4. Subir el mutation score real (77,67%) hasta el piso de ruptura configurado (85%), o hacer que el
   build efectivamente falle mientras esté por debajo — hoy no falla y debería.
5. Cablear `window-guard.ts` (alerta de concentración temporal, piso de 72h) a una ruta HTTP real —
   T-19, motor sin ruta que lo llame.
6. Escribir el test de propiedad para INV-48 — el único de los 60 invariantes sin cobertura.
7. Escribir specs E2E dedicados a voto secreto y a privacidad/PII-Vault; completar delegación
   (cadena de dos saltos) y recuperación (restaurar backup, verificar cadena íntegra).
8. Agregar axe a `/concentracion`, `/aprendizajes` y `/asistente`; actualizar
   `13-navegacion.spec.ts` para incluir las dos rutas nuevas de la barra.
9. Implementar la notificación de dependencia destrabada (`TaskUnblockedByDependency`).
10. Implementar el evento de retiro de encargo del Escalón 7 (consentimiento del círculo como
    precondición dura) y su ruta apelable.
11. Conectar recursos y presupuesto (dominio ya probado con 68 pruebas) al ledger real
    (`workspace/initiative.ts`) y exponerlos en el presenter/DTO de la API.
12. Endpoint para que un miembro del círculo se registre como voluntario en una tarea en-apoyo.
13. Implementar el informe periódico que bloquea avance de estado de la iniciativa (distinto de la
    escalada de tareas individuales, que ya existe).
14. Implementar la extracción automática (o propuesta) de un aprendizaje al cerrar una evaluación.
15. Agregar campo de costo a `AlternativeBody` y una fase de alternativas separada antes de la
    propuesta.
16. Reescribir retrospectivas con las 5 preguntas contrastadas que exige el pliego (hoy son 4
    categorías libres).
17. Implementar lógica de bloqueo real cuando vence la fecha de revisión (`proximaRevisionEn`) — hoy
    sólo existe el campo, no la consecuencia.
18. Escribir el ADR-0055 que documente la decisión de idempotencia del cupo ya aplicada en código.
19. Prueba de inclusión Merkle por miembro del padrón (T-04) — hoy sólo hay hash global.
20. Programar VACUUM/VACUUM FULL tras el borrado físico de PII (T-11).
21. Prueba de regresión que recorra el esquema del ledger buscando patrones de PII y falle si
    aparece alguno.
22. Cablear `tasaDeAceptacionColectiva` a un endpoint real y a una pantalla.
23. Construir la pantalla en `apps/web` para proponer una reforma constitucional tocando
    `requisitos` (una vez exista el acto fundacional — ver lista humana).
24. Correr `pnpm run test:coverage` completo en un host descargado y confirmar el piso.
25. Identificar los ocho parámetros congelados exactos y escribir la prueba que los enumera uno por
    uno.
26. Kanban: escribir el evento de dominio de cierre de iniciativa para poder pintar la quinta columna
    («cerrada»).

### Lo que necesita una decisión humana

1. **ADR-0054 — procedencia del padrón**: decisión jurídica y política sobre qué promete la
   plataforma; la toma la comunidad, informada por un abogado.
2. **Dirección real de facilitación**: hoy el único miembro es `operador@udea.edu.co`, que no
   existe — nadie puede entrar a producción hasta que exista un `@udea.edu.co` real.
3. **Pantalla «Reuniones»**: falta decidir qué es una reunión en este sistema antes de construir
   dominio — construirla sin esa decisión sería una fachada.
4. **Conectar un proveedor de IA real**: decisión de presupuesto y política de datos, no de código.
5. **Evaluar e implementar Belenios** (voto secreto criptográficamente verificable): alcance grande,
   «no se inventa criptografía» — requiere decidir cuánto tiempo y presupuesto invertir en la
   Etapa 2 que el propio ADR-0018 ya recomienda.
6. **Concepto jurídico formal** (SIC o abogado especializado en habeas data) sobre si un seudónimo
   con clave destruida sigue siendo dato personal bajo la Ley 1581 — no es tarea de ingeniería.
7. **Designar testigos reales de correo institucional** y un padrón de veeduría para alcanzar el
   quórum de anclaje 2-de-3 — el código y la infraestructura ya están listos y probados.
8. **Implementar un `IdentityProviderAdapter` real** contra LDAP/SAML/OAuth de la UdeA — requiere
   acceso y autorización institucional, no sólo escribir código.
9. **Autorizar la dependencia `@aws-sdk/client-s3`** para implementar el almacenamiento S3 real — la
   política del repo exige autorización explícita para dependencias npm nuevas.
10. **Aceptar formalmente el ADR-0054** (o uno equivalente) antes de versionar el padrón vivo con
    eventos de auditoría — hoy es una recomendación no aceptada.
11. **Decidir cuáles son los 3 métodos de votación que faltan** para llegar a doce, o documentar por
    qué se reduce a nueve — decisión de producto/alcance.
12. **Revisión de RA-8** (logs de proxy conservados más allá de la sesión) — pedirla antes de que
    haya una sola persona real usando la plataforma (ver sección protegida arriba).
