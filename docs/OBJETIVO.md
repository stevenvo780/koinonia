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
| 1 | **Cerrar el flujo** | decisión aprobada → iniciativa; objeciones y enmiendas sin ruta; aprendizajes sin pantalla; los 13 campos de iniciativa; los escalones de incumplimiento | pendiente |
| 2 | **Motor alcanzable** | los doce métodos elegibles de verdad; concentración de poder visible; conteo parcial oculto | pendiente |
| 3 | **Pruebas** | matriz completa de navegadores **ejecutada**; exploratorias masivas; carga con k6; umbrales de cobertura; pipeline escalonado | en curso — 2026-08-23: Chromium+Firefox verificados en verde de verdad (230/230, comando real `KOINONIA_MATRIZ=completa playwright test --project=chromium --project=firefox`); WebKit/Safari-móvil siguen bloqueados por dependencias de sistema ausentes en este host (no es un fallo de prueba). Umbrales de cobertura por paquete y un pipeline escalonado (PR→Chromium, main/nocturno→matriz completa) quedaron configurados, con detalle y salvedades en la tabla de testing. |
| 4 | **Anclaje y memoria** | `GitForgeClient` real; OpenTimestamps contra calendario real; anclaje **encendido** con checkpoints; acuses por correo | pendiente |
| 5 | **Infraestructura** | PWA con service worker; almacenamiento S3; colas/jobs; CI/CD completo | pendiente |
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

## Los 91 pendientes, por área


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
| `NO CUMPLE` | Resultados parciales (conteo en vivo) ocultos durante la votación, no accesibles a nadie hasta el cierre |
| `NO CUMPLE` | Voto secreto (Etapa 1 MVP): papeletas seudónimizadas con recibo/tracker que permite a cada votante verificar su voto |

### ejecucion — 13 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Notificación a quien tiene tarea B cuando tarea A se destraba (dependencia resuelta) |
| `NO CUMPLE` | Escalón 0 (por vencer): 48 h antes, recordatorio privado (no sanción) |
| `NO CUMPLE` | Escalón 1 (atrasada): marca en la tarea cuando vence el plazo (no en la persona) |
| `NO CUMPLE` | Escalón 7 (encargo retirado): excepcional, nunca automático, requiere consentimiento del círculo y apelable |
| `NO CUMPLE` | Recursos: cada iniciativa declara qué recursos necesita que hoy no tiene |
| `NO CUMPLE` | Presupuesto cuando aplique (con soportes): no aparece si no aplique |
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
| `NO ALCANZABLE` | Se deben poder elegir los métodos desde la interfaz o desde la API al abrir una decisión |
| `PARCIAL` | Implementar doce métodos de votación: mayoría simple, supermayoría, consentimiento, consenso, advice process, score voting, ranked choice, majority ju |
| `PARCIAL` | Se VISUALIZA la concentración de poder como pide el pliego |
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
| `NO VERIFICADO` | T-10 (Coerción del votante) — recibo sin opción elegida, interfaz no exporta, C6-GATE bloquea asuntos de voto secreto |
| `NO VERIFICADO` | T-11 (Fuga PII) — vault cifrado esquema separado, Argon2id+pepper solo dentro, sin hash identificador en ledger, DELETE+VACUUM |
| `PARCIAL` | T-12 (Spam/saturación deliberativa) — 3 propuestas/7d, 20 comentarios/24h, 1 objeción/proceso (2ª con respaldo). **Verificado 2026-08-23**: cupos de propuesta (3/7d) y comentario (20/día) implementados en `services/api/src/http/rate-limit.ts` y probados bajo carga concurrente real en `tests/integration/rate-limits.test.ts` — 10 peticiones simultáneas dieron exactamente 3×201+7×429, 30 dieron exactamente 20 aceptadas+10×429; el mecanismo es atómico (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) y no deja pasar de más bajo carrera. **Defecto real encontrado y CORREGIDO (2026-08-23, ADR-0055)**: el cupo se consumía **antes** de que la ruta detectara un `requestId` repetido, así que un reintento de idempotencia normal (el patrón que el propio sistema exige para reintentos seguros «móvil primero») gastaba un cupo real sin crear nada. Se hizo idempotente el consumo mismo: tabla nueva `identity.rate_consumption` con dedup por `(requestId, ambito, sujeto, window_start)` vía `INSERT … ON CONFLICT DO NOTHING` (migración `0013_rate_consumption_idempotencia.sql`, función `consume` en `rate-limit.ts`), aplicado uniformemente a los tres cupos (`cupoDeEscritura`/`cupoDePropuesta`/`cupoDeComentario`) porque los tres pasan por el mismo `aplicarCupo`. Probado en `tests/integration/http-cupo-idempotencia-adr55.test.ts` (reintento secuencial, cupo real de 3/semana intacto, y una carrera de dos peticiones simultáneas con el mismo `requestId`) — **y confirmado que la prueba de verdad protege el arreglo**: comentando el `if` de dedup en `consume`, dos de las tres pruebas nuevas se ponen en rojo de inmediato. Objeción por proceso (1, 2ª con respaldo) sigue sin verificar. |
| `PARCIAL` | T-19 (Captura por el grupo organizado) — HHI*≥0.15 marca proceso, alerta si >40% en último 10%, ventana ≥72h imposible acortar, sorteo ≥3x postulantes. **Verificado 2026-08-23**: `packages/domain/src/window-guard.ts` implementa `respetaVentanaMinima` (piso de 72h) y `alertaConcentracionTemporal` (>40% del último 10% de la ventana), puros y probados (`packages/domain/test/window-guard.test.ts`). **Sin cablear**: ninguna ruta de `services/api/src/http/app.ts` los invoca todavía — hoy se puede abrir una votación de 1h y nada detecta ni avisa la concentración final. Los topes de postulación y de objeciones siguen sin verificar. |
| `NO VERIFICADO` | T-20 (Correlación votante↔voto por temporización) — sin timestamps en urna, lotes k≥10 barajados, sin IP en app |
| `PARCIAL` | T-25 (Abuso del asistente IA) — no publica, entrega borrador, contenido marcado assisted:true, no resume posiciones. **Verificado 2026-08-23**: la marca `assisted` (`true` cuando el origen es una sugerencia tomada del ayudante, `false` si se escribió a mano) es un campo obligatorio en `versionRespuesta` y `procedenciaDeRespuesta` (`packages/contracts/src/asistente.ts`), probado de punta a punta contra la API real (`tests/integration/http-asistente-assisted.test.ts`) y en el contrato (`packages/contracts/test/asistente-assisted.test.ts`). Las otras tres cláusulas de esta fila (que no publique, que entregue sólo borrador, que no resuma posiciones) no se revisaron en esta pasada. |
| `NO VERIFICADO` | TECNOLOGÍA: PWA (manifest.json + service worker) |
| `NO VERIFICADO` | TECNOLOGÍA: Almacenamiento compatible S3 |
| `NO VERIFICADO` | TECNOLOGÍA: Colas/Jobs (BullMQ, RabbitMQ, etc.) |
| `NO VERIFICADO` | TECNOLOGÍA: PostgreSQL event store append-only |
| `NO VERIFICADO` | TECNOLOGÍA: CI/CD (qué corre en cada push) |
| `NO VERIFICADO` | TECNOLOGÍA: Docker + reproducible |
| `NO VERIFICADO` | TECNOLOGÍA: Backups automáticos probados |
| `NO VERIFICADO` | TECNOLOGÍA: TypeScript estricto |
| `NO VERIFICADO` | TECNOLOGÍA: Next.js 15.5 App Router |
| `PARCIAL` | T-18 (Manipulación del padrón) — congelado al abrir e inmutable; PERO detectabilidad baja PRE-congelado (procedencia no verificable) |
| `PARCIAL` | ADRs: total 54, estado (Propuesto\|Aprobado\|Depreciado), bloqueadores |

### testing — 10 pendientes

| Estado | Requisito |
| --- | --- |
| `NO CUMPLE` | Testing de performance/carga: k6; benchmarks de tally, replay, ballots; Slow 3G; pico de cierre bajo carga. |
| `PARCIAL` | Coverage thresholds (líneas, ramas, funciones, sentencias) por paquete; fallar build si debajo. **2026-08-23**: `vitest.config.ts` tiene un piso REAL por paquete (statements/branches/functions/lines), medido contra una corrida real de `vitest run --coverage` y redondeado hacia abajo — trinquete, no número inventado. `@vitest/coverage-v8` se sumó como dependencia para que el comando exista. **Sin verificar del todo**: una corrida de `pnpm run test:coverage` en esta sesión, justo después de varias corridas pesadas seguidas de la suite completa, tuvo 6 ficheros con el `afterAll` colgado (probable agotamiento de conexiones de Postgres del entorno, no un fallo de lógica: las 2.498 pruebas en sí pasaron) — hace falta una corrida limpia y aislada para confirmar que el umbral realmente hace fallar el build por debajo del piso. |
| `NO VERIFICADO` | Exploratorias manuales: formato obligatorio, reportes sin vaguedades, conversión en regression tests. |
| `PARCIAL` | Property-based testing (fast-check) con invariantes de la PARTE E de la spec (INV-01…INV-60). |
| `PARCIAL` | Extremo a extremo (E2E) con Playwright: 9 escenarios obligatorios (§6 TESTING.md); flujos completos usuario. |
| `PARCIAL` | Matriz de navegadores: Chromium, Firefox, WebKit (escritorio); Chrome móvil, Safari móvil; responsive. **Verificado 2026-08-23**: Chromium+Firefox corren de verdad y quedan en verde — 230/230 (`KOINONIA_MATRIZ=completa playwright test --project=chromium --project=firefox`), incluidos dos bugs reales de producto encontrados y corregidos en el camino (el `<h2>` de «Qué hace falta para que esto pase» perdido en `decisiones/[id]`, y `<Ficha>` pegando símbolo y palabra en un mismo nodo de texto, un problema real para lectores de pantalla). **Sigue sin correr acá**: WebKit y Safari-móvil fallan al lanzar el navegador porque Arch ya no distribuye `libicu74`/`libflite1`/`libmanette` — es del entorno, no del producto ni de las pruebas. Chrome-móvil no se aisló de nuevo en esta pasada (queda fuera del alcance de este pase, que se limitó a Chromium y Firefox). |
| `PARCIAL` | Mutation testing: Stryker con umbral ≥85%; distingue pruebas vivas de superficiales. |
| `PARCIAL` | Accesibilidad: axe-core WCAG 2.2 nivel AA; navegación con teclado; sin jerga prohibida; revisión manual con NVDA y VoiceOver. |
| `PARCIAL` | Testing de seguridad: autorización, manipulación adversarial, entrada validada en dominio, tests de ataques. |
| `PARCIAL` | Pipeline escalonado: pre-commit → PR (Chromium) → main (matriz completa) → nightly (exploratorias, carga, mutation). **2026-08-23**: existen ya `.github/workflows/ci.yml` (PR → Chromium), `e2e-matriz-completa.yml` (main → matriz completa) y `nocturno.yml` (la misma matriz completa por cron); YAML validado y cada comando probado suelto contra `package.json`/`playwright.config.ts`. **Sin verificar del todo**: nunca corrieron contra un runner real de GitHub Actions (el primer push es la prueba definitiva de que el YAML se acepta tal cual), y el nocturno todavía no cubre exploratorias ni carga ni mutation testing, sólo repite la matriz completa. |

### ux-pantallas — 5 pendientes

| Estado | Requisito |
| --- | --- |
| `NO VERIFICADO` | Móvil primero: la interfaz debe ser responsive y accesible en pantallas pequeñas |
| `PARCIAL` | Catorce pantallas disponibles: Inicio, Problemas, Propuestas, Deliberaciones, Decisiones, Consenso, Iniciativas, Mis tareas, Círculos/comisiones, Reun |
| `PARCIAL` | Cada pantalla debe estar enlazada desde la navegación principal |
| `PARCIAL` | Accesibilidad WCAG 2.2 AA: cero violaciones serias o críticas en todas las pantallas |
| `PARCIAL` | Producción debe responder a todas las rutas de las 14 pantallas |