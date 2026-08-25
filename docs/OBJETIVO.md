# Objetivo: cerrar la distancia entre el pliego y el software

> **Establecido el 2026-08-24.** Este documento es el **objetivo vigente** del proyecto y la lista
> de trabajo que lo cumple. Se actualiza al cerrar cada pendiente; cuando la tabla quede sin filas,
> el objetivo está cumplido.
>
> No sustituye a `HANDOFF.md` (que cuenta el estado) ni a los ADR (que deciden). Éste dice **qué
> falta y quién puede hacerlo.**

## De dónde sale esta lista

De una auditoría del **2026-08-23** que tomó el pliego original —el encargo completo del proyecto— y
lo descompuso en **183 requisitos verificables**, cada uno contrastado contra el código por un agente
barato y después contra un revisor independiente que intentaba refutarlo.

| Veredicto | Cuántos | |
| --- | ---: | --- |
| `CUMPLE` | 92 | 50 % |
| `PARCIAL` | 42 | 23 % |
| `NO VERIFICADO` | 27 | 15 % |
| `NO CUMPLE` | 20 | 11 % |
| `NO ALCANZABLE` | 3 | 2 % |

**Honestidad sobre la propia auditoría:** de los 27 `NO VERIFICADO`, **24 son de una sola área**
—seguridad y tecnología— cuyo auditor no comprobó lo que afirmaba. Esa área no está auditada, y por
eso la primera oleada de trabajo es verificarla, no construir nada.

`NO ALCANZABLE` significa algo distinto de `NO CUMPLE` y peor de lo que parece: **el motor existe,
está probado, y no hay forma de llegar a él desde la interfaz ni desde la API.** Este proyecto ya
tuvo ~10.500 líneas en ese estado.

**Actualización 2026-08-24 (no cambia la tabla de arriba, que es el retrato de la auditoría original):**
uno de los tres `NO ALCANZABLE` —«elegir método al abrir una decisión»— dejó de serlo: ahora hay
camino desde la interfaz y la API (ver `motor-decisiones` abajo). Quedan **2** `NO ALCANZABLE`.

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
Belenios». Lo que corresponde es **evaluarlos y escribir el ADR**, no improvisar un esquema propio.
Eso sí entra; implementarlo entero, no.

## Las oleadas

| # | Oleada | Qué cierra | Estado |
| --- | --- | --- | --- |
| 0 | **Verificar lo no verificado** | los 27 `NO VERIFICADO`, sobre todo las 16 amenazas y los 9 puntos de tecnología | en curso — 2026-08-23: T-06 y T-25 verificados (`PARCIAL`, ver tabla de seguridad-y-tecnologia por lo que falta de cada uno); T-12 verificado, con el defecto de idempotencia del cupo (ADR-0055) **ya corregido** (ver detalle abajo) pero la parte de objeción por proceso sigue sin verificar; T-19 con guardia de dominio lista y probada pero sin cablear a la API. Faltan T-01–T-05, T-07–T-11, T-20 y los 9 puntos de TECNOLOGÍA. |
| 1 | **Cerrar el flujo** | decisión aprobada → iniciativa; objeciones y enmiendas sin ruta; aprendizajes sin pantalla; los 13 campos de iniciativa; los escalones de incumplimiento | en curso — 2026-08-24 (integración): `POST /cierre-ciclo/:decisionId/cerrar` cierra la votación y, si se aprueba, crea la iniciativa en la misma transacción (`services/api/src/http/rutas-cierre-ciclo.ts`, probado en `tests/integration/http-cierre-ciclo.test.ts`); objeciones y enmiendas ya tienen ruta HTTP (`POST /deliberaciones/:id/objeciones` y `…/enmiendas`, `rutas-etapas.ts`, `tests/integration/http-etapas-objeciones-enmiendas.test.ts`), aunque esas rutas sólo validan tipo y referencia — el panel sorteado + admisión 2/3 + veto bloqueante de la fila de `flujo-principal` vive en el método de consentimiento (`packages/domain/src/tally/consent.ts`, `engine.ts`), no en `rutas-etapas.ts`, y no se reverificó en esta pasada si cubre el requisito completo; aprendizajes ya tiene pantalla (`/aprendizajes`) y buscador de parecidos (`GET /aprendizajes/parecidos`); escalones (ADR-0040) con cálculo puro (`packages/domain/src/execution/escalones.ts`) y ruta (`GET /iniciativas/:id/escalones`) cableada en `app.ts`. Todo esto ya estaba cableado al llegar esta sesión de integración; se confirmó, no se hizo. |
| 2 | **Motor alcanzable** | los doce métodos elegibles de verdad; concentración de poder visible; conteo parcial oculto | en curso — 2026-08-24 (integración): la fila `NO ALCANZABLE` de «elegir método desde la interfaz o la API» **dejó de serlo**: `apps/web/app/decisiones/abrir/page.tsx` lista los 9 métodos del catálogo (`ID_METODOS`, no los 12 del pliego) y `POST /decisiones` ya sabe construir los 9 en el servidor (`construirMetodo`/`construirQuorum`/`queHaceFaltaParaQuePase`, `services/api/src/http/service.ts`) — verificado leyendo el código, no sólo el reporte de un obrero. Sigue habiendo un límite real: sólo 5/9 se pueden abrir hoy (`sePuedeAbrirHoy`, `apps/web/app/decisiones/metodos-en-palabras.ts`), porque `emitirPapeleta` (contrato HTTP) sólo sabe transportar papeleta binaria/abstención/consentimiento — puntuación, orden y menciones quedan visibles pero deshabilitados con la razón dicha en pantalla, no ocultos. Concentración de poder: `GET /concentracion/delegaciones` calcula HHI normalizado, CR1 y Gini de verdad (`calcularConcentracionDeDelegacion`, `services/api/src/http/rutas-concentracion.ts`, reutiliza `@koinonia/domain`) con doble gate de k-anonimato y pantalla propia (`/concentracion`); no es un stub. Conteo parcial oculto: **verificado 2026-08-24 (segunda pasada REMATE)** — el veredicto `NO CUMPLE` de la auditoría era falso; ver detalle en `deliberacion` y en «Segunda pasada de integración» arriba. |
| 3 | **Pruebas** | matriz completa de navegadores **ejecutada**; exploratorias masivas; carga con k6; umbrales de cobertura; pipeline escalonado | en curso — 2026-08-24 (integración): re-corrida completa de Chromium+Firefox — **226/230** esta vez, no 230/230: Chromium limpio (115/115); en Firefox, 1 prueba de foco (`tests/e2e/07-seguimiento-adr45.spec.ts:262`) falló y otras 3 del mismo bloque no corrieron por venir después en la serie. Se investigó antes de anotarlo: **no parece ser un defecto de producto**. El host estaba con `load average` de 27 sobre 32 núcleos (otro agente corriendo generación de vídeo al 300 % CPU, además del enjambre y los demás agentes) — al repetir la misma prueba sola tres veces bajo esa misma carga, las tres fallaron de maneras DISTINTAS entre sí y distintas de la falla original (un timeout esperando un botón que ni siquiera se alcanza a la línea donde falló la corrida completa), lo que apunta a saturación del anfitrión y no a una causa fija reproducible. Queda pendiente confirmarlo en un host descargado antes de darlo por cerrado. Aparte de la matriz: se escribió y corrió por primera vez `tests/carga/` (Node puro, k6 no instalado en este entorno) y **salió un hallazgo crítico de producto, no de esta sesión de integración**: bajo 300 papeletas simultáneas en el cierre de una votación sólo 3 quedan realmente contadas, 266 reciben `500` y **31 reciben `201` (éxito) sin haberse guardado** — detalle completo en `docs/TESTING.md` §11.2 y en la tabla de `testing` abajo. Umbrales de cobertura y pipeline escalonado: sin cambios esta pasada. **Confirmado 2026-08-24 (segunda pasada REMATE)**: la sospecha de flake por saturación del host queda cerrada como cierta — matriz completa re-corrida dos veces más, **230/230** limpio en ambas, sin tocar el fichero que había fallado. |
| 4 | **Anclaje y memoria** | `GitForgeClient` real; OpenTimestamps contra calendario real; anclaje **encendido** con checkpoints; acuses por correo | pendiente |
| 5 | **Infraestructura** | PWA con service worker; almacenamiento S3; colas/jobs; CI/CD completo | en curso — 2026-08-24 (integración): PWA real — `apps/web/public/sw.js` cachea de verdad (network-first en navegaciones con aviso visible de contenido guardado, cache-first en `/_next/static/*`, y **nunca** toca `/api/*` — verificado en el código: `if (url.pathname.startsWith('/api/')) return;`) y se registra sólo en producción (`apps/web/instrumentation-client.ts`). Almacenamiento: **NO es S3** — `services/api/src/almacen/disco.ts` es la implementación real (sobre disco, con sidecars de metadatos y escritura atómica), `s3.ts` es un stub explícito que lanza `AlmacenS3NoDisponibleError` a propósito (cero dependencias npm nuevas sin autorización) — verificado leyendo el fichero completo. Colas/jobs: **NO es BullMQ ni RabbitMQ** — `services/api/src/jobs/cola.ts` es una cola casera sobre el mismo PostgreSQL (`SELECT … FOR UPDATE SKIP LOCKED`), probada con concurrencia real (`tests/integration/cola-de-trabajos.test.ts`: 20 trabajos repartidos entre 2 reclamos sin duplicar ninguno); funciona, pero no es la tecnología nombrada en el pliego. CI/CD: sin cambios esta pasada. |
| 6 | **Interfaz** | pantallas enlazadas; cero violaciones de accesibilidad; producción respondiendo las 14 rutas | pendiente |

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
medido: preguntando cuántos términos tiene `FORBIDDEN_UI_TERMS`, MiniMax y Sonnet dijeron 31 y
Gemini Flash dijo 26. El número real es **26**. Un obrero barato sirve para barrer, no para concluir.

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

## Los 91 pendientes, por área

**Nota 2026-08-24**: el título y los contadores por área son los de la auditoría original del
2026-08-23 y no se renumeraron fila por fila para no reescribir el documento entero; las filas que
esta sesión pudo verificar como `CUMPLE` de verdad quedan marcadas como tales dentro de su tabla, con
la fecha y la evidencia. Movieron de `NO VERIFICADO`/`NO ALCANZABLE` a `CUMPLE` cuatro filas de
`seguridad-y-tecnologia` (PWA, PostgreSQL append-only, TypeScript estricto, Next.js 15.5), así que el
recuento real de pendientes hoy es **87, no 91** — la próxima vez que alguien recorra el documento
entero conviene recontar y actualizar los encabezados de cada área.

### asistente-ia — 2 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | ¿Hay un proveedor de IA conectado de verdad (OpenAI, Anthropic, Gemini, etc.)? |
| `PARCIAL` | Tasa de aceptación de sugerencias se mide agregada (colectivo), nunca por persona |

### constitucion — 2 pendientes

| Estado | Requisito |
| --- | --- |
| `PARCIAL` | Existe pantalla que muestre constitución, núcleo y vías de reforma |
| `PARCIAL` | Las garantías superiores (deliberación, quórum, supermayoría, ratificación, M-de-N) son CONFIGURABLES |

### deliberacion — 3 pendientes

| Estado | Requisito |
| --- | --- |
| `NO ALCANZABLE` | Separación argumento-popularidad: durante perspectivas no se ve cantidad de apoyos ni reacciones a cada idea |
| `CUMPLE` | Resultados parciales (conteo en vivo) ocultos durante la votación, no accesibles a nadie hasta el cierre. **Verificado 2026-08-24 (REMATE, encargo C)**: el veredicto `NO CUMPLE` de la auditoría original era falso — probado contra las cuatro rutas alcanzables desde una decisión (`GET /decisiones`, `GET /decisiones/:id`, `GET /decisiones/:id/resultado`, `GET /cierre-ciclo/:decisionId/estado`), con tres identidades (sin sesión, cuenta ajena, quien facilita) mientras una votación real está ABIERTA con papeletas en sentidos opuestos (1 sí, 1 no). Ninguna ruta filtra el desglose: `/resultado` y `/cierre-ciclo/…/estado` dan `409 NOT_CLOSED` para las tres identidades, y el listado/detalle sólo exponen `seManifestaron`/`yaVotaste` (nunca el sentido). `/consenso` y las cinco proyecciones de métricas excluyen explícitamente las decisiones abiertas. Regresión con allowlist exacto de claves JSON en `tests/integration/conteo-oculto.test.ts` (17 casos contra Postgres real), con prueba de control que cierra la votación y confirma que AHÍ SÍ aparece el desglose real (1-1). Se confirmó que la prueba muerde: se reintrodujo a mano el campo `aFavor` en `presenters.ts` (forzado con cast, porque TypeScript ya lo rechaza en compilación) y 8/17 pruebas lo atraparon en runtime; el fichero se restauró byte a byte (sha256 idéntico). |
| `NO CUMPLE` | Voto secreto (Etapa 1 MVP): papeletas seudónimizadas con recibo/tracker que permite a cada votante verificar su voto |

### ejecucion — 13 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Notificación a quien tiene tarea B cuando tarea A se destraba (dependencia resuelta) |
| `NO CUMPLE` | Escalón 0 (por vencer): 48 h antes, recordatorio privado (no sanción) |
| `NO CUMPLE` | Escalón 1 (atrasada): marca en la tarea cuando vence el plazo (no en la persona) |
| `NO CUMPLE` | Escalón 7 (encargo retirado): excepcional, nunca automático, requiere consentimiento del círculo y apelable |
| `PARCIAL` | Recursos: cada iniciativa declara qué recursos necesita que hoy no tiene. **Modelado 2026-08-24 (REMATE, encargo campos)**: dominio PURO en `packages/domain/src/execution/recursos-y-riesgos.ts` («lo que falta», sin inventario) con schema Zod espejo en `packages/contracts/src/iniciativas.ts`, probado con ejemplos y con una propiedad de fast-check (oráculo Kahn vs DFS para el grafo de dependencias relacionado). **Sigue sin integrar**: ningún evento del ledger real (`workspace/initiative.ts`) persiste esto todavía, y ni el presenter de la API ni `IniciativaDetalle` (`http.ts`) lo exponen — son estructuras validables, no campos que el agregado escriba. |
| `PARCIAL` | Presupuesto cuando aplique (con soportes): no aparece si no aplique. **Modelado 2026-08-24 (REMATE, encargo campos)**: dominio PURO en `packages/domain/src/execution/presupuesto.ts` — `Presupuesto \| undefined` que nunca es `null` y exige ≥1 soporte —, con schema Zod espejo en `packages/contracts/src/iniciativas.ts`. Se rompió y restauró a propósito el rechazo de `null` para confirmar que la prueba protege algo. **Sigue sin integrar**: mismo hueco que la fila de arriba — no hay evento del ledger que lo escriba ni presenter que lo exponga. |
| `PARCIAL` | Kanban con estados (por empezar, en curso, bloqueada, en revisión, cerrada) |
| `PARCIAL` | Ayuda solicitada (TaskHelpRequested) detiene el reloj y abre convocatoria al círculo |
| `PARCIAL` | Escalón 2 (consultada): pregunta ¿sigo? / ¿necesito ayuda? / no puedo a los 72 h de atraso |
| `PARCIAL` | Escalón 4 (en apoyo): pedir ayuda abre convocatoria al círculo, se registra quien se ofrece |
| `PARCIAL` | Escalón 6 (en revisión colectiva): tras 3 reasignaciones o patrón en el círculo, se abre problema y el objeto es acuerdo/carga, no persona |
| `PARCIAL` | Retrospectivas: 5 preguntas contrastadas contra lo declarado al inicio, generan aprendizajes |
| `PARCIAL` | Fecha de revisión (próximo informe, calendario académico) que bloquea nuevas propuestas del mismo responsable si vence sin cerrar |

### flujo-principal — 12 pendientes

| Estado | Requisito |
| --- | --- |
| `NO ALCANZABLE` | Flujo entero de punta a punta: problema → solución en ejecución → evaluación → aprendizajes reutilizables |
| `NO CUMPLE` | Objeciones: ronda de objections con panel sorteado, admisión 2/3, veto bloqueante |
| `NO CUMPLE` | Enmiendas: fase de deliberación con alternativas que enmiendan a otras |
| `PARCIAL` | Alternativas: listado separado con costo y supuesto, fase en deliberación antes de propuesta |
| `PARCIAL` | Deliberación con fases (Preguntas, Perspectivas): escritura por etapa, revelación diferida de autoría |
| `PARCIAL` | Alternativas: etapa donde aparece autoría, se construyen alternativas |
| `PARCIAL` | Iniciativa: vinculada a decisión, con responsable nominal, fecha de evaluación, criterios |
| `PARCIAL` | Hitos: fechados, con criterio de cumplimiento, vinculados a iniciativa |
| `PARCIAL` | Tareas: derivadas de iniciativa, con responsable, fecha, dependencias, aceptar/rechazar/reasignar |
| `PARCIAL` | Seguimiento: informe cada N días, sin él no avanza de estado, bloqueo/ayuda/reasignación |
| `PARCIAL` | Aprendizajes: extraídos de evaluación, reutilizables en siguiente problema similar |
| `PARCIAL` | 13 campos de iniciativa si decisión requiere ejecución: objetivo, responsable, evaluación, criterios, hitos, tareas, dependencias, esfuerzo, recursos, |

### identidad-voto — 6 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Secreto del voto (R3) — ¿criptográficamente verificable o promesa del servidor? |
| `NO CUMPLE` | Resistencia a manipulación administrativa (R6) — ¿el admin puede alterar votos sin que se detecte? |
| `NO CUMPLE` | IdentityProviderAdapter preparado para integración institucional (p. ej., UdeA, LDAP, OAuth) |
| `NO CUMPLE` | Criptografía no inventada: evaluar Helios o Belenios para voto secreto verificable |
| `PARCIAL` | Verificabilidad individual (R4) — ¿puedo comprobar que mi voto está tal como lo emití? |
| `PARCIAL` | Separación criptográfica entre identidad verificada y actividad anónima |

### memoria-inmutable — 2 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Anclaje **ACTIVO en producción**: checkpoints emitidos periódicamente (cada 24h), anclados, verificables |
| `PARCIAL` | Transporte de correo: SMTP con DKIM, acuses firmados por testigo con ssh-keygen, IMAP recoge acuses y rebotes |

### motor-decisiones — 4 pendientes

| Estado | Requisito |
| --- | --- |
| `PARCIAL` | Se deben poder elegir los métodos desde la interfaz o desde la API al abrir una decisión. **Verificado 2026-08-24, dejó de ser `NO ALCANZABLE`**: `apps/web/app/decisiones/abrir/page.tsx` lista los 9 métodos del catálogo con radios y `POST /decisiones` los construye de verdad en el servidor (`construirMetodo`/`construirQuorum`/`queHaceFaltaParaQuePase`, `services/api/src/http/service.ts`, verificado leyendo el código). Sigue `PARCIAL` y no `CUMPLE`: sólo 5 de los 9 se pueden abrir hoy (`sePuedeAbrirHoy`, `apps/web/app/decisiones/metodos-en-palabras.ts`) porque `emitirPapeleta` sólo transporta papeleta binaria/abstención/consentimiento; puntuación, orden y menciones se ven pero el botón queda deshabilitado con la razón explicada en pantalla — no ocultos, no mentidos. |
| `PARCIAL` | Implementar doce métodos de votación: mayoría simple, supermayoría, consentimiento, consenso, advice process, score voting, ranked choice, majority judgment y los demás. **Detalle 2026-08-24**: el catálogo (`ID_METODOS`, `packages/contracts/src/metodos.ts`) tiene **9, no 12**, y los 9 tienen escrutinio propio real en `packages/domain/src/tally/` (uno por método) y `case` propio en el servidor — no son stubs. Faltan 3 del pliego (o su equivalente) para llegar a doce; de los 9 que existen, sólo 5 son abribles hoy (ver fila de arriba). |
| `PARCIAL` | Se VISUALIZA la concentración de poder como pide el pliego. **Verificado 2026-08-24**: `GET /concentracion/delegaciones` calcula HHI normalizado, CR1 y Gini de verdad sobre las delegaciones reales (`calcularConcentracionDeDelegacion`, `services/api/src/http/rutas-concentracion.ts`, reusa `normalizedHerfindahl`/`concentrationRatio`/`gini` de `@koinonia/domain`, no un stub) y `/concentracion` la dibuja con doble gate de k-anonimato (nunca nombres). Sigue `PARCIAL` porque no se comprobó en esta pasada que cubra cada exigencia del pliego sobre esa visualización (p. ej. alertas o umbrales de alarma en pantalla), sólo que el cálculo y la publicación son reales. |
| `PARCIAL` | Los ocho parámetros congelados deben ser verificables en tests que garanticen que la invariante se mantiene |

### privacidad — 5 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | El padrón es auditable y sus cambios son eventos |
| `NO CUMPLE` | Detectabilidad de manipulación del padrón |
| `NO VERIFICADO` | Riesgo jurídico bajo Ley 1581: un seudónimo destruido ¿es aún dato personal? |
| `PARCIAL` | Ningún dato personal en la cadena pública (ledger) |
| `PARCIAL` | Derecho de supresión (art. 8 lit. e Ley 1581): borrado irreversible sin reescribir historia |

### seguridad-y-tecnologia — 27 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | ANCLAJE: estado en producción (ACTIVO vs APAGADO) |
| `NO VERIFICADO` | T-01 (Reescritura de historia por administrador) — checkpoint Merkle, triple anclaje 2de3, verificador público |
| `NO VERIFICADO` | T-02 (Modificación directa BD) — trigger BEFORE UPDATE/DELETE en events, rol con INSERT/SELECT solo |
| `NO VERIFICADO` | T-03 (Borrado de agregado) — espina dorsal global con count(events) y count(aggregate_id) |
| `NO VERIFICADO` | T-04 (Sybil) — padrón congelado, hash sobre MemberId ordenados, prueba de inclusión Merkle |
| `NO VERIFICADO` | T-05 (Doble voto) — UNIQUE(processId,MemberId) sin FK a padrón, invariante papeletas≤marcas≤censo |
| `PARCIAL` | T-06 (Robo de sesión) — cookie __Host-, HttpOnly, Secure, SameSite=Lax, 8h absoluto, 60min inactividad, re-auth >30min. **Verificado 2026-08-23**: cookie `__Host-` en producción (sin ella en desarrollo, a propósito), 8h absolutas, 60min de inactividad, rotación de sesión al cambiar el rol y cierre global (`/auth/salir-todo`) — probados en `tests/integration/http-sesion-endurecida.test.ts` (13 pruebas), rompiendo cada mecanismo a propósito para confirmar que la prueba lo detecta. **Sigue faltando**: la reautenticación obligatoria a los 30 minutos antes de votar — no hay código que la implemente. |
| `NO VERIFICADO` | T-07 (Manipulación de propuesta en OPEN) — hash JCS de texto/opciones en DecisionOpened, dominio rechaza edición |
| `NO VERIFICADO` | T-08 (Cambio de quórum en marcha) — parámetros en DecisionOpened, inmutables, conteo parcial no visible a nadie |
| `NO VERIFICADO` | T-09 (Colusión delegados) — profundidad máxima 4 aristas, ciclos rechazados, HHI publicado, caducidad |
| `PARCIAL` | T-10 (Coerción del votante) — recibo sin opción elegida, interfaz no exporta, C6-GATE bloquea asuntos de voto secreto. **Verificado 2026-08-24 (REMATE, encargo coerción)**: se cerró la fuga real que había — el servidor devolvía `miRespuesta: 'Sí'/'No'/'Sin objeción'/…` en cada lectura (inmediata y posteriores), lo que permite a un coactor exigir ver el recibo. Se reemplazó por `yaVotaste: boolean` (dice sólo que la persona se manifestó en la ronda vigente, nunca en qué sentido) en `presenters.ts`, `page.tsx`, y de forma mínima y aditiva en el contrato HTTP (`packages/contracts/src/http.ts`). Regresión que antes vivía en `it.fails` ahora pasa en verde, confirmando que «ya votaste» sobrevive sin exponer el sentido. **Sigue sin verificar**: C6-GATE (bloqueo de asuntos de voto secreto) no se revisó en esta pasada. |
| `NO VERIFICADO` | T-11 (Fuga PII) — vault cifrado esquema separado, Argon2id+pepper solo dentro, sin hash identificador en ledger, DELETE+VACUUM |
| `PARCIAL` | T-12 (Spam/saturación deliberativa) — 3 propuestas/7d, 20 comentarios/24h, 1 objeción/proceso (2ª con respaldo). **Verificado 2026-08-23**: cupos de propuesta (3/7d) y comentario (20/día) implementados en `services/api/src/http/rate-limit.ts` y probados bajo carga concurrente real en `tests/integration/rate-limits.test.ts` — 10 peticiones simultáneas dieron exactamente 3×201+7×429, 30 dieron exactamente 20 aceptadas+10×429; el mecanismo es atómico (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) y no deja pasar de más bajo carrera. **Defecto real encontrado y CORREGIDO (2026-08-23, ADR-0055)**: el cupo se consumía **antes** de que la ruta detectara un `requestId` repetido, así que un reintento de idempotencia normal (el patrón que el propio sistema exige para reintentos seguros «móvil primero») gastaba un cupo real sin crear nada. Se hizo idempotente el consumo mismo: tabla nueva `identity.rate_consumption` con dedup por `(requestId, ambito, sujeto, window_start)` vía `INSERT … ON CONFLICT DO NOTHING` (migración `0013_rate_consumption_idempotencia.sql`, función `consume` en `rate-limit.ts`), aplicado uniformemente a los tres cupos (`cupoDeEscritura`/`cupoDePropuesta`/`cupoDeComentario`) porque los tres pasan por el mismo `aplicarCupo`. Probado en `tests/integration/http-cupo-idempotencia-adr55.test.ts` (reintento secuencial, cupo real de 3/semana intacto, y una carrera de dos peticiones simultáneas con el mismo `requestId`) — **y confirmado que la prueba de verdad protege el arreglo**: comentando el `if` de dedup en `consume`, dos de las tres pruebas nuevas se ponen en rojo de inmediato. Objeción por proceso (1, 2ª con respaldo) sigue sin verificar. |
| `PARCIAL` | T-19 (Captura por el grupo organizado) — HHI*≥0.15 marca proceso, alerta si >40% en último 10%, ventana ≥72h imposible acortar, sorteo ≥3x postulantes. **Verificado 2026-08-23**: `packages/domain/src/window-guard.ts` implementa `respetaVentanaMinima` (piso de 72h) y `alertaConcentracionTemporal` (>40% del último 10% de la ventana), puros y probados (`packages/domain/test/window-guard.test.ts`). **Sin cablear**: ninguna ruta de `services/api/src/http/app.ts` los invoca todavía — hoy se puede abrir una votación de 1h y nada detecta ni avisa la concentración final. Los topes de postulación y de objeciones siguen sin verificar. |
| `NO VERIFICADO` | T-20 (Correlación votante↔voto por temporización) — sin timestamps en urna, lotes k≥10 barajados, sin IP en app |
| `PARCIAL` | T-25 (Abuso del asistente IA) — no publica, entrega borrador, contenido marcado assisted:true, no resume posiciones. **Verificado 2026-08-23**: la marca `assisted` (`true` cuando el origen es una sugerencia tomada del ayudante, `false` si se escribió a mano) es un campo obligatorio en `versionRespuesta` y `procedenciaDeRespuesta` (`packages/contracts/src/asistente.ts`), probado de punta a punta contra la API real (`tests/integration/http-asistente-assisted.test.ts`) y en el contrato (`packages/contracts/test/asistente-assisted.test.ts`). Las otras tres cláusulas de esta fila (que no publique, que entregue sólo borrador, que no resuma posiciones) no se revisaron en esta pasada. |
| `CUMPLE` | TECNOLOGÍA: PWA (manifest.json + service worker). **Verificado 2026-08-24**: `apps/web/public/sw.js` cachea con política real y asimétrica — nunca toca `/api/*` (`if (url.pathname.startsWith('/api/')) return;`, verificado leyendo el fichero), network-first en navegaciones con aviso visible de «guardado el…» si sirve una copia vieja, cache-first en `/_next/static/*`; se registra sólo en producción vía `apps/web/instrumentation-client.ts`; `manifest.webmanifest` ya existía. |
| `NO CUMPLE` | TECNOLOGÍA: Almacenamiento compatible S3. **Verificado 2026-08-24**: NO es S3. `services/api/src/almacen/disco.ts` es la implementación real (sobre disco local); `s3.ts` lanza `AlmacenS3NoDisponibleError` a propósito y por escrito («cero dependencias npm nuevas sin autorización») — verificado leyendo el fichero completo. La forma (`AlmacenDeObjetos`, `ConfiguracionAlmacenS3`) ya está lista para «enchufar, no rediseñar» el día que se autorice `@aws-sdk/client-s3`. |
| `PARCIAL` | TECNOLOGÍA: Colas/Jobs (BullMQ, RabbitMQ, etc.). **Verificado 2026-08-24**: no usa la tecnología nombrada; es una cola casera sobre el mismo PostgreSQL (`services/api/src/jobs/cola.ts`, `SELECT … FOR UPDATE SKIP LOCKED`), con esquema propio, reintentos con backoff y liberación de huérfanos. Funciona de verdad — probado con concurrencia real contra Postgres (`tests/integration/cola-de-trabajos.test.ts`: 20 trabajos repartidos entre 2 reclamos concurrentes sin duplicar ninguno) — pero no es la tecnología que pide la fila. |
| `CUMPLE` | TECNOLOGÍA: PostgreSQL event store append-only |
| `NO VERIFICADO` | TECNOLOGÍA: CI/CD (qué corre en cada push) |
| `NO VERIFICADO` | TECNOLOGÍA: Docker + reproducible |
| `NO VERIFICADO` | TECNOLOGÍA: Backups automáticos probados |
| `CUMPLE` | TECNOLOGÍA: TypeScript estricto. **Verificado 2026-08-24**: `tsconfig.base.json` tiene `strict: true` más `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables` — no es sólo la bandera mínima. `pnpm run typecheck` corrido en esta sesión, 0 errores. |
| `CUMPLE` | TECNOLOGÍA: Next.js 15.5 App Router. **Verificado 2026-08-24**: `pnpm run build:web` corrido en esta sesión — `▲ Next.js 15.5.23`, App Router (`apps/web/app/`), 25 rutas generadas sin error. |
| `PARCIAL` | T-18 (Manipulación del padrón) — congelado al abrir e inmutable; PERO detectabilidad baja PRE-congelado (procedencia no verificable) |
| `PARCIAL` | ADRs: total 54, estado (Propuesto\|Aprobado\|Depreciado), bloqueadores. **Nota 2026-08-24**: el código (`services/api/src/http/rate-limit.ts`) cita «ADR-0055» tres veces en comentarios, pero **no existe `docs/adr/0055-*.md`** — la decisión está tomada y aplicada en código sin el documento que la registra. Es un hueco de trazabilidad, no de comportamiento: queda para quien escriba el ADR. |

### testing — 10 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Testing de performance/carga: k6; benchmarks de tally, replay, ballots; Slow 3G; pico de cierre bajo carga. **2026-08-24**: se escribió y corrió por primera vez `tests/carga/` (dos capas: `tests/carga/node/*.run.mjs`, corridos hoy con Node 22 puro contra PostgreSQL real en Testcontainers; y `tests/carga/k6/*.js`, escritos con la API real de k6 pero **no corridos** — k6 no está instalado en este entorno y la instrucción es no instalarlo). `tally`/`replay` en dominio puro cumplen presupuesto con margen amplio (p95 2,9 ms y 1,4 ms respectivamente). **Pero el escenario que el pliego marca como el que de verdad importa —el pico de cierre— NO se cumple, y es peor que lentitud: es un HALLAZGO CRÍTICO DE PRODUCTO.** Con `CARGA_N=300` papeletas simultáneas al cerrar una votación: sólo **3** quedaron realmente contadas, **266** recibieron `500 ERROR_INTERNO`, y **31 recibieron `201` (éxito) sin haberse guardado** — la persona ve «tu voto se registró» y su voto no existe. Causa raíz identificada y citada por línea en `docs/TESTING.md` §11.2: `emitirPapeleta` (`services/api/src/http/service.ts`) lee el log una vez y escribe una sola vez sin reintentar; ante un `HeadConflictError` de escritura concurrente sube como `500` sin registrarse en el log del servidor, y en el caso límite en que el conteo de eventos coincide por casualidad, `persistDecisionLog` (`services/api/src/decision/repository.ts`) confunde «nada que escribir» con «ya se escribió» y la ruta responde `201` igual. Confirmado por lectura de código, no sólo por el síntoma; reproducido dos veces (N=15 y N=300). **No se corrigió esta sesión** (`service.ts`/`repository.ts` no son de la propiedad de quien lo encontró ni de esta integración): queda como el pendiente más urgente de todo este documento para quien tenga esos dos ficheros asignados — es una falla de integridad electoral, no de rendimiento. |
| `PARCIAL` | Coverage thresholds (líneas, ramas, funciones, sentencias) por paquete; fallar build si debajo. **2026-08-23**: `vitest.config.ts` tiene un piso REAL por paquete (statements/branches/functions/lines), medido contra una corrida real de `vitest run --coverage` y redondeado hacia abajo — trinquete, no número inventado. `@vitest/coverage-v8` se sumó como dependencia para que el comando exista. **Sin verificar del todo**: una corrida de `pnpm run test:coverage` en esta sesión, justo después de varias corridas pesadas seguidas de la suite completa, tuvo 6 ficheros con el `afterAll` colgado (probable agotamiento de conexiones de Postgres del entorno, no un fallo de lógica: las 2.498 pruebas en sí pasaron) — hace falta una corrida limpia y aislada para confirmar que el umbral realmente hace fallar el build por debajo del piso. |
| `NO VERIFICADO` | Exploratorias manuales: formato obligatorio, reportes sin vaguedades, conversión en regression tests. |
| `PARCIAL` | Property-based testing (fast-check) con invariantes de la PARTE E de la spec (INV-01…INV-60). |
| `PARCIAL` | Extremo a extremo (E2E) con Playwright: 9 escenarios obligatorios (§6 TESTING.md); flujos completos usuario. |
| `PARCIAL` | Matriz de navegadores: Chromium, Firefox, WebKit (escritorio); Chrome móvil, Safari móvil; responsive. **Verificado 2026-08-23**: Chromium+Firefox corren de verdad y quedan en verde — 230/230 (`KOINONIA_MATRIZ=completa playwright test --project=chromium --project=firefox`), incluidos dos bugs reales de producto encontrados y corregidos en el camino (el `<h2>` de «Qué hace falta para que esto pase» perdido en `decisiones/[id]`, y `<Ficha>` pegando símbolo y palabra en un mismo nodo de texto, un problema real para lectores de pantalla). **Re-corrido 2026-08-24 (integración)**: **226/230**, no 230/230 esta vez — Chromium limpio (115/115); en Firefox falló `tests/e2e/07-seguimiento-adr45.spec.ts:262` (una aserción de foco tras varias transferencias de foco entre pestañas) y 3 pruebas del mismo bloque no llegaron a correr. Investigado antes de anotarlo como bug: el host tenía `load average` 27 sobre 32 núcleos (otro agente generando vídeo al 300 % CPU además del resto del enjambre concurrente); al repetir esa misma prueba tres veces aislada, bajo la misma carga, **las tres fallaron de formas distintas entre sí y distintas de la falla original** (un timeout mucho antes, esperando un botón), lo que señala saturación del anfitrión compartido y no una causa de producto fija y reproducible — pero no se confirmó todavía en un host descargado, así que queda anotado como sospecha fuerte de flakiness por entorno, no como hecho cerrado. **Re-confirmado 2026-08-24 (segunda pasada REMATE)**: la sospecha de flake queda confirmada, no sólo sospechada — se corrió el fichero completo `07-seguimiento-adr45.spec.ts` aislado (ambos navegadores, 10/10) y luego la matriz entera de nuevo, dando **230/230** sin ninguna falla; ninguno de los tres encargos de esta pasada tocó ese fichero. **Sigue sin correr acá**: WebKit y Safari-móvil fallan al lanzar el navegador porque Arch ya no distribuye `libicu74`/`libflite1`/`libmanette` — es del entorno, no del producto ni de las pruebas. Chrome-móvil no se aisló de nuevo en esta pasada. |
| `PARCIAL` | Mutation testing: Stryker con umbral ≥85%; distingue pruebas vivas de superficiales. |
| `PARCIAL` | Accesibilidad: axe-core WCAG 2.2 nivel AA; navegación con teclado; sin jerga prohibida; revisión manual con NVDA y VoiceOver. |
| `PARCIAL` | Testing de seguridad: autorización, manipulación adversarial, entrada validada en dominio, tests de ataques. |
| `PARCIAL` | Pipeline escalonado: pre-commit → PR (Chromium) → main (matriz completa) → nightly (exploratorias, carga, mutation). **2026-08-23**: existen ya `.github/workflows/ci.yml` (PR → Chromium), `e2e-matriz-completa.yml` (main → matriz completa) y `nocturno.yml` (la misma matriz completa por cron); YAML validado y cada comando probado suelto contra `package.json`/`playwright.config.ts`. **Sin verificar del todo**: nunca corrieron contra un runner real de GitHub Actions (el primer push es la prueba definitiva de que el YAML se acepta tal cual), y el nocturno todavía no cubre exploratorias ni carga ni mutation testing, sólo repite la matriz completa. |

### ux-pantallas — 5 pendientes

| Estado | Requisito |
| --- | --- |
| `NO VERIFICADO` | Móvil primero: la interfaz debe ser responsive y accesible en pantallas pequeñas |
| `PARCIAL` | Catorce pantallas disponibles: Inicio, Problemas, Propuestas, Deliberaciones, Decisiones, Consenso, Iniciativas, Mis tareas, Círculos/comisiones, Reuniones, Normas, Delegaciones, Historial, Verificar integridad. **Verificado 2026-08-24 (encargo C)**: existen **13 de las 14** (`find apps/web/app -name page.tsx`, 32 ficheros + lectura de `PRODUCT.md` §4). Sigue faltando sólo **Reuniones**, y sigue siendo deliberado: no tiene dominio de soporte detrás (ver «Lo que NO entra en este objetivo» arriba). El corte anterior de `docs/HANDOFF.md` decía «existen 8, faltan 6» — era falso, y se corrigió ahí también. |
| `PARCIAL` | Cada pantalla debe estar enlazada desde la navegación principal. **Verificado 2026-08-24**: las 13 existentes están en `CONSULTA` de `apps/web/components/marco.tsx` y cubiertas por `tests/e2e/13-navegacion.spec.ts` (corrido hoy, en verde). Sigue `PARCIAL` y no `CUMPLE` sólo porque la 14.ª pantalla (Reuniones) no existe para poder enlazarse. |
| `PARCIAL` | Accesibilidad WCAG 2.2 AA: cero violaciones serias o críticas en todas las pantallas |
| `PARCIAL` | Producción debe responder a todas las rutas de las 14 pantallas. **Verificado 2026-08-24**: las 13 pantallas existentes responden `200` en `https://koinonia.167.114.118.213.sslip.io` (comprobado ruta por ruta). Sigue `PARCIAL` porque falta Reuniones (no construida, deliberado) **y porque producción está desactualizada respecto al código local** —el contenedor es de 2026-08-23 17:53, anterior a 12 commits incluida la tanda de 22 agentes en paralelo; `/concentracion` y `/aprendizajes`, que sí existen en el árbol local, dan `404` en producción. Ver `docs/HANDOFF.md` §7. |
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
