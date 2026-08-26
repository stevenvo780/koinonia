# Handoff de sesión — Koinonía

> **Fecha:** 2026-08-24, actualización de cierre de sesión · **Destinatario:** la próxima sesión de trabajo.
>
> **Despliegue:** El sistema está desplegado en producción sobre VPS y operativo, pero **desactualizado
> respecto al código local** (ver §7).
>
> ⛔ **Lo primero de §8 es la tarea 0, y está por encima de todo lo demás:** el padrón —el
> denominador de todas las reglas de decisión— es el único estado de gobierno que **no está en el
> historial encadenado**. **ADR-0054** lo documenta y **no lo decide**, porque la elección de fondo
> es jurídica y política. Nadie debería empezar una tarea de producto sin haber leído esa fila.
>
> Este documento es **autocontenido**. No hace falta haber estado en la sesión previa ni recordar
> nada: aquí está el estado del repositorio, las decisiones vinculantes, lo que falta, lo que se
> aprendió y lo que está roto. Se lee entero **antes** de tocar código.
>
> **Estado:** informativo, no normativo. Cuando este documento y un ADR discrepen, manda el ADR
> (jerarquía en §3). Lo único que aquí es vinculante son las decisiones de §4, y lo son porque están
> recogidas en los ADR y en las especificaciones, no por estar escritas aquí.
>
> ⚠ **Este documento llevaba dos días atrasado y afirmando cosas falsas** (decía que faltaban seis
> pantallas que ya existían, y en un corte previo llegó a decir que `GitForgeClient` seguía sin
> implementar cuando existe desde `1df5ba8`, 2026-08-22). Entre el commit que este documento citaba
> como vigente (`e9c68d9`) y el actual (`6251d60`) corrieron **22 agentes en paralelo** sobre el
> árbol (ver `docs/OBJETIVO.md`, que sí se mantuvo al día en cada uno de esos commits). Esta
> actualización vuelve a contrastar cada cifra contra el repositorio, **corriendo los comandos, no
> listándolos**.

---

## 0. Verificación de este documento

Todo lo de esta sección se **corrió de verdad hoy, 2026-08-24**, sobre el commit `6251d60`, con el
árbol de trabajo limpio salvo los ficheros de esta misma entrega documental. A diferencia del corte
anterior —que contaba pruebas con `vitest list` sin ejecutarlas—, **las cifras de abajo son la salida
real de correr cada comando**, pegada, no parafraseada:

| Comando | Resultado |
|---|---|
| `pnpm run typecheck` | **0 errores** |
| `pnpm run lint` | **0 errores** (eslint + `prettier --check` + `scripts/check-domain-purity.mjs`) |
| `pnpm run build` | **verde** (`tsc --build`, los siete paquetes) |
| `pnpm run build:web` | **verde** — Next.js 15.5.23, 34 rutas (25 estáticas + 9 dinámicas) |
| `KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run` | **`Test Files 179 passed (179)` · `Tests 2824 passed (2824)`**, 0 fallos, corrido contra PostgreSQL 16 real por Testcontainers |
| `KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox` | **`230 passed (2.6m)`**, 0 fallos — el flake de `07-seguimiento-adr45.spec.ts` que el corte anterior sospechaba por saturación del host **no se reprodujo** en esta corrida |

**Ningún `it.fails` ni `.skip` en el árbol** (`grep -rn "\.fails(\|\.skip(" tests packages services` da
vacío, salvo el uso legítimo de `test.describe.serial`/`test.skip` condicional documentado en
`TESTING.md`). **Cero dependencias npm nuevas** en esta pasada.

**Cifras vigentes, medidas hoy:** **2 824 pruebas en 179 ficheros** de vitest (desglose por paquete en
§2.3); **230 escenarios de extremo a extremo** en **14 ficheros**, los dos navegadores en verde;
**trece migraciones** (`0001`–`0013`); **54 ADR + README**; **10 proyectos** en el workspace (siete
paquetes); **32** ficheros `page.tsx` (34 rutas contando la portada y el proxy de API); **178**
propiedades `fc.property`/`fc.asyncProperty` en dominio, **13** en consenso y **9** en métricas.
**El despliegue a producción está operativo** (§7).

**Git verificado hoy:** `git rev-parse HEAD` da `6251d60a4f4df7f77dce13339eb65effd565eee3`.
`git ls-remote origin refs/heads/main` da `c89e3b9…` — **el remoto está detrás del local**: hay
commits en `main` local (desde `c89e3b9` hasta `6251d60`, la tanda de 22 agentes en paralelo más las
dos pasadas de integración) que **todavía no se empujaron**. No es un incidente de custodia como el
de `ea684c4`: el repositorio tiene remoto y árbol limpio, sólo falta un `git push`. Quien retome debe
comprobarlo de nuevo con los mismos dos comandos antes de asumir que está publicado.

---

## 1. Qué es el proyecto

Koinonía es una **plataforma open source de gobernanza colectiva** para los aproximadamente 300
estudiantes del **Instituto de Filosofía de la Universidad de Antioquia** (Medellín, Colombia).
Licencia **AGPL-3.0-or-later**.

**No es una aplicación de votaciones.** Es la infraestructura de un ciclo completo:

```
problema → evidencia → deliberación → propuesta → decisión → iniciativa
   → responsables → tareas → seguimiento → resultado → aprendizaje → memoria institucional
```

Quien reduzca el proyecto a «votar en línea» va a construir la parte fácil y a romper el resto.

### Principios (en el orden en que mandan)

| # | Principio | Qué implica en la práctica |
|---|---|---|
| 1 | **Asynchronous-first** | La reunión presencial es una herramienta, **no el sistema de gobierno**. Este principio ya mató una funcionalidad: el quórum por asistencia física (§4). |
| 2 | **No todo se resuelve por mayoría** | Consentimiento sociocrático, supermayoría y unanimidad son ciudadanos de primera, no casos raros. |
| 3 | **Separar deliberación, decisión y ejecución** | Son tres actos distintos con reglas distintas. Confundirlos es el error de diseño más común del sector. |
| 4 | **Toda decisión debe poder convertirse en acción rastreable** | Una decisión que no llega a tarea con responsable es una decisión que no ocurrió. |
| 5 | **Toda modificación relevante deja historia** | Event sourcing con cadena de hashes; nada se edita en su sitio. |
| 6 | **La IA asesora, nunca gobierna ni vota** | Sin excepciones y sin banderas de configuración. |
| 7 | **El administrador técnico NO es soberano político** | Tiene `root`; no tiene autoridad. De ahí sale medio modelo de amenaza (C18) y todo el anclaje externo. |
| 8 | **Privacidad e inmutabilidad deben coexistir** | Es la tensión central del diseño: un registro permanente y anclado que además debe permitir suprimir datos personales. |
| 9 | **UX simple, móvil, en español** | Sin jerga técnica en pantalla (ADR-0041). Quien usa esto lo usa en un teléfono. |
| 10 | **Open source y self-hostable** | Un colectivo estudiantil debe poder levantarlo sin depender de nadie. |

---

## 2. Estado del repositorio

### 2.1 Identificación

| Dato | Valor |
|---|---|
| Rama | `main`, con upstream `origin/main` *(verificado el 2026-08-24)* |
| Commit de referencia de este documento | `6251d60` — *El servidor deja de decirte qué votaste* |
| Árbol de trabajo | **Limpio** *(verificado el 2026-08-24, salvo esta misma entrega documental)* |
| Remoto | **`git@github.com:stevenvo780/koinonia.git`, por SSH.** `origin/main` está en `c89e3b9`, **detrás del local** — hace falta un `git push` (ver §0) |
| Gestor de paquetes | `pnpm@11.20.0` · Node `>=22` · **10 proyectos** en el workspace (**siete** paquetes + `services/api` + `apps/web`) |
| Licencia | AGPL-3.0-or-later |

Últimos commits relevantes, del más nuevo al más viejo:

```
6251d60 El servidor deja de decirte qué votaste
e00f948 Veintitrés frentes en paralelo: flujo, motor, infraestructura e interfaz
67c5776 El cupo deja de castigar a quien se le cortó la conexión
9a10f2b El modelo de amenazas deja de prometer lo que no tiene
4a8d5f4 Establece el objetivo: 91 pendientes entre el pliego y el software
afcda2f Aclara que la rotación no se lleva la copia de emergencia
fe2aa06 Le abre la puerta al dominio que nadie podía alcanzar
dc6095d Rehace la interfaz: maqueta de tres patrones y una capa de piezas
82b5c9e Renumera las erratas del ADR-0053 (E90-E96 → E95-E101)
378cb37 Consultas de estado: preguntar si hay sesión deja de ser un 401
cd8a281 Sistema visual: papel cálido, tinta cálida y acento petróleo
c89e3b9 Registra el hueco de procedencia del padrón (ADR-0054)
e9c68d9 Rondas sexta y séptima del registro: catorce erratas más que salieron de escribir el código
625434e Ocho arreglos de pantalla: el destello de la sesión, el punto doble y el botón sin jerarquía
ed6fe4b La constitución se guarda: el texto vive aparte, direccionado por su huella
```

> **Entre `e9c68d9` (la referencia del corte anterior de este documento) y `6251d60` (hoy) corrieron
> 22 agentes en paralelo** sobre el árbol, más dos pasadas de integración (`e00f948`, `6251d60`).
> `docs/OBJETIVO.md` se actualizó en cada uno de esos commits y es la fuente más al día del estado
> del proyecto fila por fila; este documento cuenta el repositorio, no reemplaza esa tabla.

> **El riesgo de custodia está CERRADO.** Los dos cortes anteriores de este documento abrían con la
> misma advertencia —«el repositorio existe **sólo en disco local**; configurar un remoto es la tarea
> de infraestructura más urgente del proyecto»— después de un incidente en el que **70 entradas sin
> commitear** (+13 699 / −219) sobrevivieron de milagro a la sesión de ADR-0045. Ya no aplica.
>
> **Qué se hizo, para que se pueda auditar y no haya que creerlo:** antes de publicar se corrió un
> **barrido de secretos sobre las 21 revisiones y los 596 blobs** del historial completo —no sobre el
> árbol actual, que es la comprobación fácil y la inútil—, buscando claves, tokens, `.env`, material
> del PII Vault y credenciales de Postgres. **Salió limpio.** El repositorio se creó en GitHub, se
> empujó por **SSH**, y el push se verificó comparando `git rev-parse HEAD` con
> `git ls-remote origin refs/heads/main`. La verificación por SHA no es ceremonia: un `git push` que
> imprime `Everything up-to-date` porque empujó otra rama es indistinguible de uno que funcionó, y
> **este proyecto no tiene copia**.
>
> ⚠ **Lo que seguía abierto era distinto y menor, y ya se cerró.** Este bloque se escribió con el
> árbol en `ea684c4` (2026-08-22 15:59), antes de que `1df5ba8` (2026-08-22 17:12) implementara
> `codebergForge()` y `githubForge()` en `services/api/src/anchor/forjas.ts`. **La tarea 4 ya no está
> abierta**: ver su fila, corregida, más abajo. Publicar no sustituye anclar, pero anclar contra las
> dos forjas ya es código, no una tarea pendiente.

### 2.2 Resultado real de los comandos (2026-08-24, sobre `6251d60`)

Salida copiada literalmente, **de comandos que se corrieron, no que se listaron**:

| Comando | Salida |
|---|---|
| `pnpm run typecheck` | `tsc -p tsconfig.check.json && tsc --build packages/contracts services/api && tsc -p tests/e2e/tsconfig.json` → **código 0** |
| `pnpm run lint` | `eslint . && prettier --check . && node scripts/check-domain-purity.mjs` → **código 0**, `Pureza del dominio: correcta` |
| `pnpm run build` | `tsc --build` → **código 0** |
| `pnpm run build:web` | **código 0** — `▲ Next.js 15.5.23`, `Generating static pages (25/25)`, **34 rutas** (25 estáticas `○`, 9 dinámicas `ƒ`) |
| `KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run --reporter=dot` | **código 0** — `Test Files 179 passed (179)` · `Tests 2824 passed (2824)` · `Duration 15.92s` |
| `KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox` | **código 0** — `230 passed (2.6m)` |
| `git rev-parse HEAD` / `git ls-remote origin refs/heads/main` | `6251d60…` / `c89e3b9…` — **no coinciden**: el remoto está detrás, falta un `push` |

**Docker arrancó de verdad**: los 39 ficheros de `tests/integration/` (incluida `tests/carga/node/`)
corrieron contra PostgreSQL 16 real por Testcontainers y pasaron sus 420 pruebas; con
`KOINONIA_REQUIRE_DOCKER=1` la ausencia de Docker sigue siendo un fallo duro, no una suite saltada.
**La prueba de falsación de Docker** —`DOCKER_HOST` a un puerto muerto y la suite falla con
`Error: Testcontainers no pudo levantar Docker…` en `tests/integration/helpers/api-env.ts:131`— no
se repitió hoy, pero sigue en el código y no hay motivo para creer que dejó de valer.

**Delta desde el corte anterior (`e9c68d9` → `6251d60`): +592 pruebas y +47 ficheros** (de 2 232 en
132 a **2 824 en 179**). El reparto exacto por paquete está en §2.3. El grueso vino de la tanda de 22
agentes en paralelo (`e00f948`): métodos elegibles desde la interfaz/API, concentración de poder por
delegación (HHI/CR1/Gini reales), PWA con service worker, cola de trabajos casera sobre PostgreSQL,
`tests/carga/` (hallazgo crítico de pérdida de votos bajo concurrencia, ver `docs/OBJETIVO.md`
sección `testing`), y de la segunda pasada de integración (coerción del votante, campos de
iniciativa, conteo oculto verificado).

⚠ **Un `it.fails` que existía en el corte anterior ya no existe.** `grep -rn "\.fails(" tests
packages services` da vacío hoy: la regresión de coerción del votante (T-10) que vivía en rojo a
propósito ahora pasa en verde, con `yaVotaste: boolean` sustituyendo a `miRespuesta` en las lecturas.

### 2.3 Desglose por paquete (corrido hoy, 2026-08-24, sobre `6251d60`)

**Ejecutado con `vitest run --reporter=json`, no listado**: las once cifras suman exactamente
**2 824** y los once conteos de fichero suman exactamente **179**.

| Paquete / carpeta | Ficheros | Tests | Qué contiene |
|---|---:|---:|---|
| `packages/crypto` | 4 | **108** | Canonicalización JCS (RFC 8785), SHA-256 sobre WebCrypto, cadena de hashes por agregado, Merkle RFC 6962. Sin dependencias de runtime. |
| `packages/domain` | 61 | **1 265** | `DecisionEngine` puro, los métodos de escrutinio (`src/tally/`), deliberación, democracia líquida, constitución versionada, asistente de acción sistémica, ejecución (escalones, evaluación, recursos/riesgos/presupuesto) y autorización. **Es casi la mitad del proyecto: 45 % de las pruebas.** |
| `packages/anchor` | 9 | **128** | `AnchorProvider` enchufable: OpenTimestamps, git firmado (dos forjas), testigos por correo, quórum 2 de 3 clases. |
| `packages/verifier-cli` | 2 | **34** | Verificador independiente, sin hablar con el servidor. |
| `packages/contracts` | 20 | **311** | Esquemas Zod de toda la frontera HTTP: deliberación, métodos, iniciativas (13 campos), asistente, consultas de estado de sesión. |
| `packages/consensus` | 5 | **101** | Análisis de consenso transversal (ADR-0038/0048): PCA, k-means, GIC. Admite punto flotante; sin dependencias de runtime. |
| `packages/metrics` | 9 | **92** | Métricas de salud democrática: acuerdos, concentración, cobertura del padrón, rotación, deliberación, ADR-0040. |
| `services/api` | 25 | **314** | Event store append-only, ledger, capacidad cifrada, sesión endurecida, rate-limit idempotente (ADR-0055), cierre de ciclo, escalones, concentración, cola de trabajos, almacén sobre disco. |
| `tests/integration` | 39 | **420** | Contra **PostgreSQL 16 real** por Testcontainers: sesión endurecida, cupo idempotente, cierre de ciclo, conteo oculto, cola de trabajos, carga (`tests/carga/node/`). |
| `tests/exploratorias` | 3 | **14** | Exploratorias masivas sobre límites de problemas, propuestas y decisiones/secreto. |
| `tests/unit` | 2 | **37** | Métodos y escalones en pantalla (presentación, no dominio). |
| `apps/web` | — | vía E2E | Next.js PWA. Sin suite unitaria propia, por decisión (`TESTING.md` §1). |
| | **179** | **2 824** | |

`packages/domain` declara **178** llamadas `fc.property`/`fc.asyncProperty` (eran 174 en el corte
anterior), `packages/consensus` otras **13**, y `packages/metrics` **9** más (no contadas antes).
Comprobación:

```sh
grep -roh -E "fc\.(property|asyncProperty)" packages/domain/test | wc -l      # 178
grep -roh -E "fc\.(property|asyncProperty)" packages/consensus/test | wc -l   # 13
grep -roh -E "fc\.(property|asyncProperty)" packages/metrics/test | wc -l     # 9
```

**Cuidado con el patrón al recontar:** `fc\.\(async\)\?property` **no sirve** —busca
`fc.asyncproperty` en minúscula y deja fuera las asíncronas. La `P` de `asyncProperty` es mayúscula.

### 2.4 Extremo a extremo

**230 escenarios** en `tests/e2e/`, en **14 ficheros**, corridos hoy de verdad (no listados):
`KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox` dio
**`230 passed (2.6m)`, 0 fallos**, en los dos navegadores. **El corte anterior decía 115 y esa cifra
ya no vale**: entre `e9c68d9` y `6251d60` el número de escenarios se duplicó (aportes de la tanda de
22 agentes en paralelo a `12-pantallas-nuevas` y `13-navegacion`, entre otros) y esta vez sí se
corrió, no sólo se listó.

**La democracia líquida ya tiene escenarios**: `12-pantallas-nuevas.spec.ts` cubre la pantalla
«Delegaciones» (prestar el voto, revocarlo votando directo, doble toque, HORIZONTAL/VERTICAL), a
diferencia del corte anterior que decía que seguía sin ninguno.

La matriz de cinco proyectos **sigue sin presentarse completa**: en **WebKit** y **Safari móvil** el
proceso del navegador sigue sin arrancar en este host, por la razón de siempre (abajo). Sólo se
corrieron **Chromium + Firefox** hoy; el bloqueo se resuelve en CI, no inventando un total local con
los cinco proyectos.

**Por qué no arranca WebKit.** Faltan librerías del sistema. Sonames verificados con `ldd` sobre
`~/.cache/ms-playwright/webkit-2336/`:

```
libicudata.so.74  libicui18n.so.74  libicuuc.so.74   libxml2.so.2
libflite.so.1 (+11 hermanas libflite_*)              libmanette-0.2.so.0
```

Playwright sugiere `sudo apt-get install libicu74 libxml2 libflite1 libmanette-0.2-0`. **Ese consejo
no sirve en este equipo:** el sistema es **CachyOS (`ID_LIKE=arch`)**, no hay `apt-get`
—`playwright install --with-deps` aborta con `Failed to run 'apt-get install -s' … spawn apt-get
ENOENT`— y `sudo` pide contraseña. Además ICU 74 y `libxml2.so.2` son versiones que Arch ya no
distribuye. Ver §8, tarea 12, para las salidas reales.

**Están configurados y fallando en rojo a propósito.** No se han silenciado ni marcado como
`skip`: un rojo visible es información; un verde que no probó nada es una mentira. Quien vaya a
tocar esto debe mantener esa decisión.

### 2.5 Migraciones

`services/api/migrations/`, **trece**, todas aplicadas por `migrate()`:

| Fichero | Contenido |
|---|---|
| `0001_governance_ledger.sql` | Tablas `governance.event`, `governance.checkpoint` |
| `0002_append_only_guard.sql` | Trigger `ENABLE ALWAYS` de blindaje append-only |
| `0003_roles_and_grants.sql` | `koinonia_ddl` / `koinonia_app`; el rol de la aplicación sólo tiene `SELECT, INSERT` |
| `0004_projection.sql` | Proyecciones de lectura |
| `0005_identidad.sql` | PII Vault e identidad. ⚠ **Aquí vive el hueco de la tarea 0**: `identity.member` es mutable (`:31`) y el rol de la aplicación tiene `UPDATE`/`DELETE` sobre ella (`:145`) |
| `0006_anclaje.sql` | `anchor_attempt`, recibos, sellos |
| `0007_append_request_scope.sql` | Namespace separado para claves públicas y consecuencias internas atómicas |
| `0008_capacidad_privada.sql` | DSK por sujeto y capacidad semanal cifrada, self-only |
| `0009_event_id_unico.sql` | Índice único global de identidades causales de eventos |
| `0010_private_material.sql` | Aperturas textuales restringidas con ciphertext de longitud fija |
| `0011_constitucion.sql` | El texto de las reglas direccionado por su huella (ADR-0051), con la regla de tipos del ledger aplicada en el esquema |
| `0012_sesion_endurecida.sql` | **Nueva desde el corte anterior.** Marca de actividad para el corte por inactividad de la sesión (T-06, `docs/THREAT_MODEL.md`) |
| `0013_rate_consumption_idempotencia.sql` | **Nueva desde el corte anterior.** Tabla `identity.rate_consumption`: dedup por `(requestId, ambito, sujeto, window_start)` para que un reintento de idempotencia no gaste un cupo real (ADR-0055, `docs/adr/0055-idempotencia-del-consumo-de-cupo.md` — el fichero se escribió el 2026-08-26, después que el código; el hueco de trazabilidad que esta fila anotaba ya está cerrado) |

**El corte anterior decía once y hoy son trece:** se sumaron `0012_sesion_endurecida.sql` y
`0013_rate_consumption_idempotencia.sql`. El resto del dominio sigue sin tabla propia y eso es
deliberado: los métodos de escrutinio y la democracia líquida viven **enteros en el dominio**,
`packages/consensus` y `packages/metrics` no tocan la base, y la deliberación persiste por el event
store genérico (`services/api/src/workspace/`) sin tabla propia. Las fronteras de API que se tocaron
son codecs y presentadores, que no cambian el esquema.

⚠ **La migración que falta es la de la tarea 0**, y es la más importante de las que no están
escritas: hoy **no hay ninguna migración de padrón**, porque el padrón no es un agregado. Igual que
con la delegación (E36, abajo), **escribirla antes de decidir ADR-0054 sería fijar en el esquema la
respuesta equivocada.**

⚠ **La delegación no tiene persistencia propia, y no es un olvido: es la errata E36.** El evento
`DelegationGranted` está en el catálogo del **agregado decisión**, y una delegación no pertenece a
una decisión —vale para las que todavía no existen—. Hoy el registro de delegaciones **entra al motor
por parámetro**, y la decisión de arquitectura pendiente es si merece un agregado
`DelegationRegistry` con su propia cadena de hashes. Mientras no se decida, **no hay migración que
escribir**, y escribir una antes de decidirlo sería fijar en el esquema la respuesta equivocada. Ver
`00-contradicciones-resueltas.md`, E36.

---

## 3. Documentación existente y jerarquía normativa

### 3.1 El orden de precedencia

Se decidió porque **tres documentos se declaraban autoridad a la vez** y ninguno mandaba (C19). El
orden es:

```
GOVERNANCE.md
  → THREAT_MODEL.md
    → docs/adr/
      → docs/research/30-decision-engine-spec.md
        → resto de docs/research/   ← INSUMO, no normativo
```

**Cuando un documento de `research/` contradice un ADR, gana el ADR y se corrige el research.** No al
revés, y no «se anota la tensión»: se corrige el research.

### 3.2 Inventario

| Documento | Papel |
|---|---|
| `docs/GOVERNANCE.md` | Máxima autoridad. Reglas de gobierno del proyecto y del colectivo. |
| `docs/THREAT_MODEL.md` | Modelo de amenaza. Segunda autoridad. Ver C18 en §4. |
| `docs/adr/` | **54 ADR** (`0001`–`0054`) **+ `README.md`** de índice. 55 ficheros en total *(contado hoy, 2026-08-24: `ls docs/adr | wc -l`)*. El índice está al día hasta el 0054. Los cinco del 2026-08-22 (0046–0050), detallados debajo de esta tabla; los cuatro más nuevos (0051–0054) en §8 y en `docs/OBJETIVO.md`. |
| `docs/research/30-decision-engine-spec.md` | Especificación del motor de decisiones. La única pieza de `research/` con rango normativo. ~2 600 líneas, 60 invariantes (`INV-01`–`INV-60`), 7 anti-invariantes. |
| `docs/PRODUCT.md` | Producto y alcance funcional. §6 diseña ejecución y seguimiento. |
| `docs/ARCHITECTURE.md` | Arquitectura del sistema. |
| `docs/TESTING.md` | Estrategia de pruebas. Normativa para lo que se considera «terminado». |
| `docs/MODEL_CONTEXT.md` | Qué contexto recibe un agente al que se delega, y registro de delegaciones. |

**Los cinco ADR del 2026-08-22**, porque tres de ellos cambian algo que ya estaba escrito:

| ADR | Título | Estado | Qué hay que saber |
|---|---|---|---|
| **0046** | Deliberación estructurada por etapas | Aceptado, **parcialmente sustituido por 0049** | Etapas como ventanas de escritura reales, aportes tipados con aristas obligatorias, grafo acíclico por construcción. **Cae** la autoría sellada (compromiso, seudónimo por deliberación y etapa de revelación); **sigue** todo lo demás. |
| **0047** | Métodos de escrutinio completos | Aceptado | Los cinco que faltaban, con enteros exactos. Tres anti-invariantes demostrados **en positivo**, nunca con `skip`. |
| **0048** | Consenso transversal como agenda | Aceptado | `packages/consensus` admite punto flotante **porque su salida es agenda y no puede alimentar un umbral ni un conteo**. |
| **0049** | Autoría por alcance de etapa | Aceptado | **Sustituye el sellado criptográfico por control de acceso.** El autor va en el evento; lo que se deniega es **leerlo** mientras la etapa `perspectivas` siga vigente. Ver la advertencia de alcance en §8, tarea 19. |
| **0050** | Umbral de no-facción revisado | **Propuesto**, no aceptado | Contraste de hipótesis nula por permutación determinista, para sustituir el umbral de silueta fijo de ADR-0048. **Es una propuesta: no está implementada y no manda todavía.** |

✅ **Corregido:** `docs/adr/README.md` indexa hoy hasta el **0054**, con fila y nota para cada uno
(verificado leyendo el fichero completo el 2026-08-24). Si aparece otro ADR nuevo, la fila del índice
es parte del ADR, no un extra — la advertencia del corte anterior (que el 0050 se había quedado sin
fila) es la razón por la que conviene seguir comprobándolo cada vez.

`docs/research/` (insumo, salvo el 30):

| Fichero | Tema |
|---|---|
| `00-contradicciones-resueltas.md` | **Registro del proceso**: resoluciones R1–R3, contradicciones C4–C20, errores de implementación **E1–E46** en **cuatro rondas** (con **E24 retirada** por ser error propio del orquestador) y tres bugs autodestructivos del código (B1–B3). Es el documento a leer para entender *por qué* algo es como es. |
| `01-decidim-loomio-polis.md` | Plataformas existentes; incluye la especificación de consenso tipo Pol.is |
| `02-sociocracia-ostrom.md` | Sociocracia y principios de Ostrom |
| `03-deliberativa-sistemas-antipatrones.md` | Democracia deliberativa, teoría de sistemas, antipatrones, métricas |
| `10-ledger-inmutable.md` | Especificación del ledger (la «spec 10») |
| `11-privacidad-y-voto-secreto.md` | Privacidad y criptografía de urna |
| `20-normativa-datos-colombia.md` | Ley 1581, SIC, régimen de datos personales |
| `21-normativa-udea.md` | Normativa de la Universidad de Antioquia |

---

## 4. Decisiones del arquitecto — vinculantes

**Esta es la sección más importante del handoff.** Ninguna de estas decisiones se reabre sin un
**motivo nuevo** —un hecho, una norma o un requisito que no existía cuando se decidió—. Estar en
desacuerdo no es un motivo nuevo. Si aparece uno de verdad: se reporta, no se ignora.

| ID | Decisión | Razón |
|---|---|---|
| **R1** | `MemberId` es **aleatorio de 128 bits** (CSPRNG), representado como **32 caracteres hex en minúscula**. **Jamás** derivado del documento, del correo ni de ningún dato personal. | Un identificador derivado es **re-derivable** por quien posea el dato de origen: vuelve ficticio el borrado y permite confirmar la pertenencia por diccionario sobre un espacio de **sólo 300 personas**. Se descartó base32 porque tiene variantes de alfabeto (RFC 4648 vs Crockford) y es sensible a mayúsculas. |
| **R2** | Al Governance Ledger **no entra ningún hash, commitment ni derivación de un identificador personal**. | Consecuencia de R1: el ataque de diccionario desaparece **por construcción**, no por dificultad computacional. Argon2id y el pepper siguen existiendo, pero **para el PII Vault**, no como línea de defensa del ledger. |
| **R3** | **No se apuesta jurídicamente al borrado criptográfico.** Ante una solicitud de supresión se **borra físicamente** el registro del PII Vault. El borrado criptográfico se reserva a **backups y réplicas**, donde el borrado físico es imposible. | No existe doctrina publicada de la SIC que acepte el borrado criptográfico como equivalente a la supresión. No habitamos esa zona gris. |
| **C6** | **El MVP no garantiza el secreto del voto frente al administrador.** En vez de taparlo con un descargo, **los asuntos que exijan secreto duro no se votan en la plataforma**: `openDecision()` rechaza con `HardSecrecyUnsupported` —compuerta **dura**, sin bandera que la desactive, evaluada antes que cualquier otra validación— y esos asuntos van a papel en asamblea hasta que exista un backend Belenios. | Mejor un **hueco declarado** que una garantía fingida. Prometer secreto perpetuo y entregar voto público con control de acceso es peor que no ofrecer secreto, porque induce a confiar. |
| **C10** | El hash del padrón (`rollHash`) se calcula **sólo sobre los `MemberId` ordenados**, nunca sobre atributos. Los estratos se publican **agregados** (conteos), no por miembro; el commitment por estrato se revela **sólo ante impugnación**. | Publicar el padrón con atributos mete cuasi-identificadores en un registro permanente y anclado. No publicarlo convierte el quórum en un acto de fe. Esta es la salida que evita ambas. |
| **C11** | **El género no se usa como eje de estratificación del sorteo.** Ejes: **semestre, jornada, nivel** (pregrado/posgrado) y **participación previa**, todos derivables de la matrícula. | El género es dato sensible del **art. 5 de la Ley 1581**; ligarlo a un identificador estable dentro de un registro anclado expone a **sanción de cierre definitivo**. Si la asamblea quiere paridad, se implementa como **cuota verificada fuera del ledger**. |
| **C12/C13** | Elegir a una persona son **dos actos, no un método**: **(a)** nominación sociocrática abierta y argumentada — es **deliberación** y es **pública**; **(b)** confirmación por **valoración de menciones en voto secreto sin delegación** — es **decisión**. El **sorteo** se reserva a **comisiones deliberativas**, nunca a encargos de responsabilidad. | Los tres documentos que parecían contradecirse describían **actos distintos**, no métodos rivales. ⚠ **Por C6, en el MVP esto no se hace en plataforma.** |
| **C14** | Al ledger van **commitments con nonce aleatorio de 128 bits** guardado en el vault. **Nunca** `sha256(texto)` de un comentario. | El hash desnudo del texto permite el **ataque de confirmación de autoría** a quien ya tenga el texto — sobre contenido que revela orientación política. |
| **C17** | **No se registran direcciones IP en la aplicación.** El rate limiting usa un **hash con pepper rotado a diario**. | Elimina **por construcción** el conflicto entre la retención de 30 días y los backups de 35. Un conflicto que no existe no hay que gestionarlo. |
| **C18** | **Modelo de amenaza canónico**, en este orden de prioridad. Toda decisión de coste-beneficio en seguridad se mide contra él. | Ver desglose debajo. |
| **C19** | **Jerarquía documental** (la de §3). | El corpus tenía tres órdenes de precedencia cruzados y nadie mandaba. |
| **E1** | **Regla de tipos del ledger.** Crítica y de obligado cumplimiento. Ver debajo. | Un tipo que normaliza la representación convierte el sistema en su propio acusador. |
| **E9** | `prevHash` va **fuera** del objeto canónico, como **prefijo binario de 32 bytes de longitud fija**. | Dentro del JSON, el evento **deja de ser canonicalizable sin conocer su posición en la cadena**. |
| **—** | **Quórum `base:'present'` (por asistencia física) eliminado del MVP.** | No es sólo que invocara un evento inexistente (`AttendanceRecorded`): **contradice `asynchronous-first`, que es el primer principio del proyecto**. Si vuelve, deberá venir con justificación **de gobernanza**, no técnica. |
| **—** | **Semilla del sorteo compuesta con faro externo.** Manda B.0.3 sobre A.7. El evento `SeedRevealed` publica **ambas** partes: `seedAdmin` **y** `beaconValue`. | Una semilla que genera el servidor **la elige de hecho el administrador**. Es teatro criptográfico. |

### 4.1 C18 — el modelo de amenaza canónico, en orden

| # | Adversario | Carácter | Estrategia |
|---|---|---|---|
| 1 | **El grupo estudiantil organizado que quiere ganar una decisión** | El **más probable**. Es un ataque de **gobernanza**, no de software. | Reglas de decisión, ventanas, padrón congelado, desconcentración. |
| 2 | **El administrador técnico con agenda política, o presionado** | El **más dañino**: tiene `root`. | **Detección, no prevención.** Es toda la razón de ser del anclaje externo (§6). |
| 3 | **El curioso interno** que quiere saber cómo votó alguien para presionarlo | El **más corrosivo socialmente**. | Minimización, separación ledger/vault, C6, C14. |
| 4 | **El atacante externo oportunista** | El **menos relevante**. | Higiene estándar. |

Que el externo sea el último **no es descuido**: es la conclusión de que en un colectivo de 300
personas el daño real viene de dentro y de arriba, no de fuera.

### 4.2 E1 — la regla de tipos del ledger

> **Ningún valor que forme parte de la preimagen de un hash puede almacenarse en una columna cuyo
> tipo NORMALICE su representación.**

Queda **proscrito**, y cada proscripción tiene su motivo medido:

| Tipo | Qué normaliza | Consecuencia |
|---|---|---|
| `uuid` | Devuelve siempre la forma **con guiones** | Rehidratar cambia el hash |
| `timestamptz` | Cambia separador y zona, **trunca los ceros de los milisegundos** | Idem |
| `numeric` | Normaliza los **ceros a la derecha** | Idem |
| `bigserial` para el índice global | Deja **huecos por rollback** | Le regala al administrador la coartada «fue un rollback» |
| **`jsonb`** | **Reordena las claves** y **ni siquiera es inyectivo** | El caso más grave de todos |

**Lo que sí se usa:** `char(32)` con **`CHECK` anclado** para identificadores, `char(24)` para marcas
ISO-8601, `text` para el payload canónico. Si se necesita consultar el payload, se añade una columna
derivada `jsonb` **marcada como NO autoritativa**, que **jamás** se usa para recomputar un hash.

⚠ **`char(n)` también normaliza** —rellena con espacios a la derecha—. Por eso el `CHECK` anclado
(`^[0-9a-f]{32}$` y equivalentes) **no es una comprobación de higiene: es parte de la regla**.

---

## 5. Errores encontrados al implementar — el resultado metodológico principal

**Implementar la especificación encontró errores reales que ninguna revisión por lectura detectó**, en
documentos que ya habían pasado por revisión editorial cuidadosa. Este es, hasta ahora, el resultado
metodológico más importante del proyecto.

### 5.1 Las cifras exactas

El registro está en **`docs/research/00-contradicciones-resueltas.md`, parte 3**. Su propia tabla de
cierre («El dato acumulado») da el desglose:

| | Spec 10 (`crypto`) | Spec 30, 2ª | Spec 30, 3ª | Spec 30, 4ª | Total |
|---|---:|---:|---:|---:|---:|
| Errores **dentro de la especificación** | 6 (E1–E6) | 14 (E10–E23) | 11 (E25–E35) | 11 (E36–E46) | **42** |
| Incoherencias entre ADR y specs | 2 (E7, E8) | — | — | — | 2 |
| Hallazgos derivados al propagar | 2 (E1′, E1″) | — | — | — | 2 |
| Divergencias elevadas sin cerrar | 1 (E9) | — | — | — | 1 |
| Entradas **retiradas** (error propio) | — | — | 1 (E24) | — | 1 |
| Bugs autodestructivos del código | — | — | 3 (B1–B3) | — | 3 |
| **Entradas registradas** | 11 | 14 | 15 | 11 | **51** |

⚠ **El registro sigue incompleto, aunque menos.** Las rondas tercera y cuarta ya están volcadas. Lo
que **sigue sin ficha `E-NN`** son las rondas de `services/api`, `packages/anchor` y
`packages/verifier-cli`: los tres hallazgos de §5.2 puntos 2-4 y el bug del verificador de §5.3, que
sólo viven en comentarios de código y en nombres de test. Total real ≈ **55 hallazgos**, de los
cuales ≈ 46 son errores de especificación. **La tarea 14 de §8 queda abierta a medias.**

**La tercera ronda añadió un tipo de entrada que no existía: un error del propio orquestador.** E24 se
registró como fallo de la spec y era una directiva equivocada; la spec tenía razón. Está **tachada,
visible y explicada**, porque un registro que borra sus propios errores no sirve para aprender. Su
lección es la de C4 con los papeles invertidos: **una corrección llega con forma de corrección y
recibe menos escrutinio que una afirmación nueva.** Ese episodio es el motivo por el que la errata de
`THREAT_MODEL.md` T-09 corregida hoy —«profundidad máxima 1» y la prueba
`::cadena_de_profundidad_2_es_rechazada`, cuando `GOVERNANCE.md` §5 y ADR-0029 mandan **4**— se
corrigió **también en el nombre de la prueba**: un nombre de test equivocado es la forma más barata
de que alguien «arregle» el motor para que cuadre con el documento.

### 5.1-bis La cuarta ronda: la democracia líquida dio once, y tres son autodestructivas

La PARTE C se abre advirtiendo que «una delegación mal modelada no produce un error visible: produce
un resultado **plausible y falso**, con votos que nadie emitió y poder que nadie confirió». La
advertencia era correcta **y la escribió el mismo documento que contenía las tres erratas que la
materializan**. Las tres, en una línea cada una:

| # | Qué afirmaba la spec | Qué pasaba de verdad |
|---|---|---|
| **E37** | Rechazar al conceder toda arista `A→B` con `B` alcanzando a `A` es una prevención de ciclos **completa** | **Falso**, y el contraejemplo es de dos aristas: `Ana→Beto` global y `Beto→Ana` por tema. Ningún ámbito por separado tiene ciclo; la resolución por especificidad **mezcla ámbitos** y produce `Ana→Beto→Ana`. Resuelto comprobando sobre el grafo **unión** |
| **E38** | El PASO 1 filtra las papeletas por `cfg.currentRound` y `cfg.proposalVersionHash` | `DecisionConfig` **no tiene `currentRound`**, y `proposalVersionHash` es el congelado al abrir. Aplicado literal, **descarta todas las papeletas de la ronda 2 en adelante** ⇒ **no-quórum fantasma en toda decisión sociocrática que integre una objeción**. Y el no-quórum es un desenlace legítimo, así que nadie lo investiga |
| **E42** | La cota de irreversibilidad de D.4.1 acota toda continuación posible | Sus dos supuestos son **falsos con delegación**: revocar sin votar **baja** la participación, y quien vota directo mueve **2** (se lleva su peso y se lo quita a su delegado). El motor firmaría «este resultado ya no puede cambiar» sobre uno que sí puede, y **cerraría la urna**. Resuelto devolviendo `open` siempre que haya delegación |

**El patrón nuevo, que conviene llevarse:** cinco de las once (E36, E37, E38, E41, E42) comparten una
forma que no aparecía en las rondas anteriores — **una sección razona bien dentro de un marco más
chico que el problema**. No son «dos pasajes que no se sostienen juntos»: es **un solo pasaje,
correcto, aplicado fuera de su dominio de validez**. Leerlo no lo delata; un revisor que abra C.4.1 ve
un teorema con su demostración y le da el visto bueno, y hace bien, porque el teorema es cierto. Lo
que no se lee es la hipótesis que otra sección, cincuenta líneas antes, dejó de cumplir. **Lo delata
escribir el segundo caso de prueba.**

El dato cualitativo importa más que la cifra: **la spec 30 es el documento más cuidado del corpus
—2 600 líneas, 60 invariantes formalizados, 7 anti-invariantes— y produjo más del doble de errores
que la spec 10.** Lo que predice los errores no es el descuido sino la **densidad de
correspondencias internas**: nueve de sus catorce errores son **dos pasajes correctos por separado
que no se sostienen juntos**.

### 5.2 Los cuatro peores: eran autodestructivos

Estos cuatro no producían un fallo. Producían un sistema que **se sabotea a sí mismo en silencio**.

1. **`actor uuid` en el DDL.** La spec definía `actor` como «MemberId, 32 hex minúsculas» en §1.1 y
   lo almacenaba en una columna `uuid` en §3.1. PostgreSQL devuelve el `uuid` **con guiones**, así
   que **rehidratar un evento cambiaba su hash**: el sistema **se habría acusado a sí mismo de
   manipulación sin que nadie lo tocara**. De aquí salió la regla **E1** (§4.2).
   *Vive en:* `packages/crypto/test/chain.test.ts`.

2. **`CREATE RULE … ON DELETE DO INSTEAD NOTHING` sobre el trigger append-only.** La spec (§4.2)
   proponía esta regla para reforzar el blindaje. **Medido**: sin la regla, un `DELETE` da
   `ERROR: DELETE rechazado`; **con la regla, da `DELETE 0` — éxito mudo**. La defensa diseñada para
   hacer **ruidosa** la manipulación la volvía **silenciosa**, porque una `RULE` reescribe la
   consulta *antes* de ejecutarla y el `DELETE` nunca llega a la tabla ni al trigger. Y de propina,
   **las reglas no interceptan `TRUNCATE`**.
   *Vive en:* `services/api/migrations/0002_append_only_guard.sql:64` y
   `tests/integration/append-only.test.ts:162` (test titulado «ERROR DE LA SPEC §4.2»).

3. **`ORDER BY tree_size` ordenaba por la columna de salida.** En `SELECT tree_size::text AS
   tree_size … ORDER BY tree_size`, PostgreSQL resuelve el `ORDER BY` contra el **alias de salida**,
   que es `text`. Con diez sellos devolvía **el 9 en vez del 10** y **la cadena de checkpoints se
   bifurcaba en silencio**. La corrección es cualificar la columna con la tabla.
   *Vive en:* `services/api/src/ledger/checkpoint.ts:138` y
   `tests/integration/anclaje-y-export.test.ts:339`.

4. **`count(*) = max(leaf_index) + 1`**, presentada como **la** prueba de contigüidad, **no detecta el
   truncamiento de la cola**: al borrar los últimos *k* eventos, ambos lados bajan a la vez y la
   igualdad sigue dando verde. Sólo detecta **borrados interiores**. Es decir: no detectaba **borrar
   lo que acaba de ocurrir**, que es exactamente el ataque más atractivo.
   *Vive en:* `services/api/src/ledger/verify.ts:136-147` y `docs/ARCHITECTURE.md:298`.

### 5.3 Dos hallazgos sobre el propio método

**Un agente revisor «corrigió» a otro citando una frase que el documento corregido nunca contenía.**
Es el caso **C4**: el documento 11 abrió un bloque titulado «Corrección al documento 20» citando
*«La SIC acepta esto como equivalente a la supresión física del dato personal.»* — **esa frase no
existe en el documento 20**, y el doc 20 sostiene lo contrario. El efecto fue que **la posición
correcta quedó presentada como el error a corregir**.

> La revisión independiente funciona. Pero **un revisor también inventa el error que corrige**, y su
> salida llega con forma de corrección, que es la forma que menos escrutinio recibe.

**El bug del verificador.** `directorySource()` comparaba una **ruta absoluta** contra la ruta **tal
como la tecleó el usuario**: con una ruta relativa no leía nada y acusaba de `EXPORT_INCOMPLETO` a un
paquete **intacto**.

> Un verificador que acusa a los honestos **entrena a la asamblea a ignorarlo**. Para una herramienta
> cuyo único activo es que se le crea, un falso positivo es peor que un falso negativo.

*Vive en:* `packages/verifier-cli/test/programa.test.ts` («ERROR ENCONTRADO: con una RUTA RELATIVA no
leía NADA»).

---

## 6. La demostración empírica de la tesis del proyecto

La tesis del proyecto es que **la coherencia interna no prueba nada frente a quien tiene `root`**. No
es un argumento retórico: está **demostrado con dos tests emparejados** en
`packages/verifier-cli/test/ataques.test.ts`, bajo `ATAQUE 6 — la REESCRITURA DEL PASADO, con todo
recalculado`.

El montaje: el administrador cambia un hecho antiguo y **vuelve a calcular** cadenas, censos, sellos
y pruebas de continuidad. El resultado es una historia **internamente perfecta**.

| Test | Línea | Resultado |
|---|---|---|
| `SIN anclaje externo es INDETECTABLE, y así hay que decirlo` | `:310` | La historia falsa **pasa todas las comprobaciones internas**. El verificador emite exactamente **un** código: `SIN_ANCLAJE`, y sale **ÁMBAR** — nunca verde. |
| `CON anclaje externo se detecta y se nombra ANCLAJE_NO_CORRESPONDE` | `:318` | Salta **`ANCLAJE_NO_CORRESPONDE`**. Y **ninguna** comprobación interna se queja: el test afirma explícitamente que *no* aparecen `REGISTRO_ALTERADO`, `CADENA_ROTA` ni `RAIZ_MERKLE_NO_COINCIDE`. |

Los dos matices que hacen honesto el resultado:

- Sin anclajes el verificador **no dice «todo bien»**: dice **`SIN_ANCLAJE` y se queda en ámbar**. La
  imposibilidad de detectar el ataque **está declarada en la salida**, no escondida en un verde.
- Lo único que desmiente la historia falsa es **lo que ya salió del servidor y él no pudo cambiar**:
  los anclajes de las tres clases de independencia.

> **El anclaje externo no es un adorno: es lo único que cierra el hueco frente al administrador con
> `root`.** Quien proponga simplificar el sistema quitando anclajes está proponiendo quitar la única
> defensa contra el adversario nº 2 del modelo de amenaza.

---

## 7. Despliegue en producción

El despliegue en producción está realizado, configurado y operativo, pero **está desactualizado
respecto al `HEAD` local** — ver el aviso al final de esta sección, verificado hoy por SSH de sólo
lectura, que es la parte nueva de este corte.

*   **Puntos de acceso:** Interfaz en `https://koinonia.167.114.118.213.sslip.io` (**responde `200`**,
    comprobado hoy) y API en `https://api.167.114.118.213.sslip.io`. Ambos contenedores (`koinonia-web`,
    `koinonia-api`) están **`Up` y `healthy`** *(verificado hoy, `docker ps`)*.
*   **Aislamiento y aditividad en VPS:** La máquina aloja contenedores ajenos en producción (**83
    contenedores en total** en el host, contados hoy con `docker ps -q | wc -l`; el corte anterior
    decía 66 — el número ajeno crece con el tiempo porque la máquina es compartida y no está bajo
    control de este proyecto). El despliegue es exclusivamente aditivo, encapsulado en `/opt/koinonia`
    con el prefijo `koinonia-` en sus tres contenedores (`web`, `api`, `postgres`).
*   **Enrutamiento y Proxy:** A cargo de **Caddy** a través de un único `/etc/caddy/Caddyfile`
    compartido con sitios externos, sin directivas `import` ni directorios `conf.d`. Dado que
    cualquier recarga (`reload`) es global y crítica, es obligatorio generar una copia de seguridad y
    ejecutar `caddy validate` antes de aplicar cambios. Los certificados TLS son emitidos por Let's
    Encrypt sobre dominios `sslip.io` (las IPs públicas directas no admiten firma de certificados
    estándar).
*   **Base de datos:** PostgreSQL 16 se ejecuta en un contenedor sin puertos expuestos públicamente al
    host. **Verificado hoy** (`SELECT name FROM koinonia_meta.migration`): tiene **`0001`–`0011`
    aplicadas — **`0012_sesion_endurecida` y `0013_rate_consumption_idempotencia` NO están en
    producción todavía**.
*   **Servicio de correo:** El envío de correos opera mediante credenciales SASL propias sobre el
    puerto 587 de la instancia local preexistente de Postfix. No se modificó la directiva
    `mynetworks` para evitar convertir el servidor en un relay abierto para los contenedores ajenos.
*   **Privilegios mínimos en la API:** La API ya no corre con privilegios de superusuario. Las
    conexiones de base de datos se separaron entre migración y uso de la aplicación
    (`KOINONIA_DATABASE_URL_APP`).
*   **Trampas desactivadas en producción:**
    *   La configuración en `infra/docker/docker-compose.yml` mapeaba originalmente `55432:5432`, lo que expondría la base de datos a internet con las credenciales por defecto del repositorio. Esto fue corregido.
    *   El anclaje externo de firmas viene activado de forma predeterminada para entornos de producción.
    *   La variable `KOINONIA_VAULT_MASTER_KEY` requiere un formato codificado en base64 y no en hexadecimal.

⚠ **Producción está aproximadamente un día detrás del `HEAD` local, y es un hallazgo nuevo de este
corte, no una repetición del anterior.** El contenedor `koinonia-api` se creó el
**2026-08-23 17:53 (-05:00)**, lo que lo ubica entre los commits `afcda2f` (17:45) y `4a8d5f4`
(21:24) — **antes** de que existiera `docs/OBJETIVO.md`, antes de la corrección del modelo de
amenazas (`9a10f2b`), antes del arreglo de idempotencia del cupo (`67c5776`, migración `0013`), y
**antes de toda la tanda de 22 agentes en paralelo** (`e00f948`) y de la corrección de coerción del
votante (`6251d60`, hoy). Comprobado sirviendo tráfico real: `GET /concentracion` y `GET
/aprendizajes` sobre `koinonia.167.114.118.213.sslip.io` devuelven **`404`** — esas pantallas existen
en el árbol local y no en lo desplegado. **No es una regresión ni una avería**: nadie ha vuelto a
desplegar desde entonces, y no hay ninguna automatización que lo haga sola. Es simplemente el estado
real, y quien retome debe decidir cuándo redesplegar (fuera del alcance de un agente: la VPS es de
sólo lectura para el trabajo automatizado, ver la nota de encargo de esta sesión).

---

## 8. Qué falta — plan de continuación priorizado

> ⛔ **La tarea 0 va primero y va sola.** Se añadió el 2026-08-23 y **desplaza a todo lo demás**,
> incluidas las tres candidatas que el corte anterior recomendaba en §11. No es una tarea de
> producto ni de código: es una **decisión de arquitectura que le toca tomar a una persona**, y
> hasta que se tome, cada votación que se abra en producción congela un padrón cuya procedencia
> nadie puede acreditar. **No empieces por las pantallas.**

### Tarea 0 — decidir ADR-0054: la procedencia del padrón

| Campo | Contenido |
|---|---|
| **Estado** | **ABIERTA Y BLOQUEANTE.** El ADR está escrito y en **Propuesto**: `docs/adr/0054-procedencia-del-padron.md` |
| **Qué es** | El padrón —el censo— es el **denominador de todas las reglas de decisión** de `GOVERNANCE.md` §4 («2/3 de 300 son 200», «3/4 son 225», «100 directos», «la mitad del círculo») y es el **único estado de gobierno que no está en el historial encadenado**. Vive en `identity.member`, tabla mutable. El alta no emite ningún evento (`services/api/src/http/identity.ts:132`, invocada desde `app.ts:512`); la aplicación tiene `UPDATE`/`DELETE` sobre la tabla (`migrations/0005_identidad.sql:145`); `registryVersion` es la constante `1` (`service.ts:580`), así que no hay ni continuidad versionada que delate un salto. **Y ninguna línea del código escribe jamás `withdrawn_at`:** dar de baja a alguien sólo es posible por SQL directo |
| **El ataque** | Alterar `identity.member` justo antes de abrir; dejar que la apertura congele esa lectura; restaurar. Bajar 300 a 240 lleva los dos tercios de **200 a 160** y los tres cuartos de **225 a 180**, **y además excluye a los 60**. Coste: una transacción |
| **Por qué no basta lo que hay** | **ADR-0025 (congelar) desplaza la ventana, no la cierra:** protege de cambios posteriores y **conserva para siempre cualquier padrón fraudulento congelado antes**. **El verificador independiente no lo ve:** sus 25 códigos (`packages/verifier-cli/src/hallazgos.ts:19-48`) cubren export, cadena, checkpoints y anclaje, ninguno la procedencia; **saldría verde y certificaría una mentira coherente** |
| **Qué NO falta** | Dos matices que evitan exagerar: cada decisión **sí** guarda su padrón completo dentro de `DecisionOpened` (`services/api/src/decision/codec.ts:254`), así que el padrón histórico de cada votación existe — falta la **procedencia del registro vivo**. Y la supresión autoservicio **sí** deja eventos (`PIIErasureRequested` / **`PIIErased`**, `private-material-store.ts:314-319`) |
| **La decisión** | **(A)** la supresión pasa a ser destrucción irreversible del vínculo identificador↔persona, conservando el seudónimo huérfano — lo que ADR-0008, 0009 y 0021 ya sostienen de facto; o **(B)** se conserva el borrado absoluto y se **declara** que la autenticidad del padrón depende de una autoridad externa cofirmante, no del registro. **Son incompatibles**: un padrón verificable por eventos y el borrado absoluto de la pertenencia pasada no coexisten |
| **Recomendación del ADR** | **(A)**, con el argumento decisivo de que **(B) ya es inalcanzable retroactivamente** —cada `DecisionOpened` ya contiene la lista de `MemberId`, encadenada y anclada— y con el riesgo jurídico escrito y tres preguntas `VERIFICAR` para un abogado |
| **Quién decide** | **No un agente.** Es qué promete la plataforma, jurídica y políticamente, con una sanción disponible que es el cierre definitivo de la operación (Ley 1581 art. 23 lit. d). Decide la comunidad, informada por un abogado |
| **Qué hacer ahora** | 1) Leer ADR-0054 entero. 2) Llevar las tres preguntas `VERIFICAR` a un abogado. 3) Llevar (A) vs (B) a la asamblea. 4) **No escribir la migración de padrón antes de eso**: fijaría en el esquema la respuesta equivocada |
| **Trazabilidad** | El hueco ya estaba registrado como **E93** en `docs/research/00-contradicciones-resueltas.md:2084` y en `services/api/src/constitution/index.ts:95-104`. **Es la tercera vez que se escribe y la primera que se prioriza.** `THREAT_MODEL.md` T-18 quedó corregido el 2026-08-23: decía «detectabilidad alta» y era falso |

### El resto de las tareas

**Lo que se cerró el 2026-08-22, para no volver a abrirlo por descuido:** **democracia líquida**
(tarea 2), **deliberación estructurada** (tarea 20, que nació y murió el mismo día), **métodos de
escrutinio** (tarea 1) y **análisis de consenso** (tarea 7, a medias: falta la tarea 15). Las cuatro
están tachadas abajo con lo que dejaron. Lo que **sigue abierto** son las tareas 3-6, 8, 10-19.

⚠ **La tarea 13 hay que reevaluarla antes de tocarla:** el corte anterior la daba por «cinco
definidas y ninguna implementada», y desde entonces existe `packages/metrics` con **9 ficheros y 92
pruebas** (acuerdos, concentración, cobertura del padrón, rotación, deliberación, sellado, textos y
una prueba dedicada a ADR-0040). **Leer el paquete antes de creer la fila.**

| # | Tarea | Dónde está la spec | Notas |
|---:|---|---|---|
| **0** | **Decidir ADR-0054 — procedencia del padrón** | `docs/adr/0054-procedencia-del-padron.md` | **BLOQUEANTE Y POR ENCIMA DE TODO LO DEMÁS.** Ver la ficha completa arriba. **No es código: es una decisión.** |
| ~~**1**~~ | ~~**Métodos de escrutinio restantes**~~ | `30-...` **PARTE B.5–B.9** | **HECHO el 2026-08-22 (ADR-0047).** Los cinco implementados en `packages/domain/src/tally/` con aritmética exacta. El anti-invariante de IRV se probó **en positivo**, no con `skip`, y aparecieron **dos más** que la spec afirmaba al revés: MJ no satisface *later-no-harm* ni el criterio de mayoría fuerte. Doce erratas de spec registradas (E25–E35, más E24 retirada). |
| ~~**2**~~ | ~~**Democracia líquida**~~ | `30-...` **PARTE C**, `INV-23..30` | **HECHA el 2026-08-22.** Delegación temática con especificidad, caducidad obligatoria y revocación inmediata; voto directo que anula (en los dos sentidos temporales); recorrido de cadenas con `maxDepth = 4`; tope de concentración sobre el censo con devolución LIFO; `HHI*`, Gini y CR1 en aritmética exacta. **+104 pruebas.** Vive en `packages/domain/src/delegation.ts` y `delegation-graph.ts`. Dejó **once erratas, E36–E46, tres de ellas autodestructivas** (§5.1-bis). ⚠ **No tiene interfaz** (tarea 17, pantalla «Delegaciones») **ni persistencia propia** (E36: falta decidir el agregado `DelegationRegistry`), y **desactiva el cierre anticipado por irreversibilidad** mientras esté habilitada (E42). |
| ~~**20**~~ | ~~**Deliberación estructurada por etapas**~~ | ADR-0046 · ADR-0049 | **HECHA el 2026-08-22, de extremo a extremo:** dominio, contratos, API, pantalla y **11 escenarios E2E**. Nació y se cerró el mismo día, así que no llegó a figurar como pendiente. Dejó dos hallazgos: la **escalada horizontal en `supersedes`** —cualquiera podía silenciar el aporte de cualquiera, encontrada **ejecutando**, no leyendo (`bf01277`)— y el cambio de ADR-0049, que **sustituye el sellado criptográfico de la autoría por control de acceso**. La advertencia de alcance está en la tarea 19. |
| ~~**3**~~ | ~~**OpenTimestamps contra un calendario real**~~ | `packages/anchor/src/ots/` | **HECHO el 2026-08-24.** `httpCalendar()` (`ots/calendar.ts:55`) se ejecutó de verdad contra los **cuatro** calendarios reales de producción (`services/api/src/anchor/verificacion-manual.ts sellar`, no `a.pool.opentimestamps.org`: los cuatro nombrados, de tres operadores distintos), y el `.ots` resultante se contrastó con el **cliente oficial** (`ots info`), que no ha visto este repositorio: mismo `sha256`, mismas cuatro atestaciones pendientes. **Esta fila decía lo contrario desde antes de esa ejecución; es la tercera vez que este documento afirma algo falso** — la primera fue `THREAT_MODEL.md` T-18 (corregida 2026-08-23), la segunda esta misma tabla (fila 4, corregida 2026-08-22). Los **reintentos con backoff** y el **envío a varios calendarios** que esta fila daba por faltantes también estaban ya resueltos (`packages/anchor/src/retry.ts`, `ots/pool.ts`, commit `bac4818`, 2026-08-22): la propia fila describía como pendiente un trabajo terminado dos días antes de escribirla. Detalle de la ejecución de hoy, y de qué falta para las otras dos clases de anclaje, en `infra/produccion/ANCLAJE.md`. |
| ~~**4**~~ | ~~**`GitForgeClient` sin implementar**~~ | `services/api/src/anchor/forjas.ts` | **HECHO el 2026-08-22 (`1df5ba8`).** `codebergForge()` (`:253`) y `githubForge()` (`:268`) están implementados, con reconstrucción del commit y contraste de OID entre las dos forjas —la comprobación de que devuelven el MISMO objeto— cubierta por `packages/anchor/test/forjas-cruzadas.test.ts` y `services/api/test/anchor-forjas.test.ts`. **Esta fila decía lo contrario desde antes del commit que la resolvió; es la segunda vez que este documento afirma algo falso: la primera fue `THREAT_MODEL.md` T-18, corregida el 2026-08-23.** |
| ~~**5**~~ | ~~**Transporte de correo**~~ | `services/api/src/anchor/{dkim,correo}.ts` | **HECHO el 2026-08-22 (`1df5ba8`).** SMTP con firma DKIM (`dkim.ts`), rebotes y recogida por IMAP están implementados; probado en `services/api/test/anchor-correo.test.ts` y `packages/anchor/test/correo-rebotes.test.ts`, `correo-testigos.test.ts`. |
| **6** | **Evaluación y aprendizaje** | `PRODUCT.md` §6 · ADR-0043–0045 · `03-deliberativa-sistemas-antipatrones.md` | **Seguimiento integrado:** iniciativa atómica, ratificación, hitos, consentimiento de tareas, capacidad privada, inicio, pausas, ayuda, evidencia restringida, entrega y revisión append-only. **Falta el cierre:** contrastar criterios congelados, registrar resultado real y aprendizajes recuperables; ni una votación ni completar tareas declaran éxito por sí solos. ⚠ **Corrección que hay que repetir porque ya confundió una vez:** un corte anterior reservaba «ADR-0046» para esta tarea. **ADR-0046 acabó siendo la deliberación por etapas**, y desde entonces se han gastado el 0047, el 0048, el 0049 y el 0050. Esta tarea sigue abierta y **sin número de ADR asignado**: el que le toque será el **0051 o posterior**, y **no hay que reservarlo por adelantado** — reservar números fue justamente lo que produjo la confusión. |
| ~~**7**~~ | ~~**Consenso tipo Pol.is**~~ | `01-decidim-loomio-polis.md` · ADR-0038 | **HECHO A MEDIAS el 2026-08-22 (ADR-0048).** El cálculo existe en `packages/consensus`, hoy con **101 pruebas** tras ajustarlo a ADR-0038, y con determinismo demostrado frente a permutar participantes. **Lo que falta está en la tarea 15:** las divergencias con ADR-0038 y **ninguna conexión con el ledger**. |
| **8** | **Asistente de acción sistémica** | `03-deliberativa-sistemas-antipatrones.md` §3.1 | **NO EMPEZADO, y es de las que menos trabajo de diseño quedan.** Las **27 preguntas literales** del formulario de teoría del cambio **ya están redactadas** (`03-...:85-125`), con la frase de cierre generada. Sólo **dos** son obligatorias (la 1 y la 11), y `PRODUCT.md` §4 fija la forma: **una pregunta por pantalla**, y **no es un examen**. Falta todo el código. |
| **9** | **Tests propios de `packages/contracts`** | — | **COMPLETADO y mantenido:** hoy **41** pruebas de esquemas, conversión temporal y contratos de deliberación. Ampliarlos con cada contrato nuevo. |
| **10** | **Decidir qué se hace con `checkpoint.firm`** | `0001_governance_ledger.sql:210` | Es **una columna que no puede ser verdad**: (a) es redundante con el quórum calculado sobre los recibos, (b) **puede contradecirlo en silencio**, y (c) el rol `koinonia_app` sólo tiene `SELECT, INSERT` sobre `governance.checkpoint` (`0003_roles_and_grants.sql:43`), así que **nunca puede ponerse a `true`**. Lo autoritativo es el evento **`AnclajeEstadoPublicado`** (`packages/anchor/src/events.ts:25`). Decisión pendiente: eliminarla o documentarla como no autoritativa. |
| **11** | **Mutation testing con Stryker** | `TESTING.md` §10 | Umbrales **definidos**, **nunca ejecutado**, y con 1 213 pruebas la pregunta «¿cuántas de estas prueban algo?» ya no es retórica. Nota de la propia spec: en `contracts` casi todo son tipos, que Stryker no muta. **Precedente que dice que vale la pena:** la consolidación del escrutinio hizo **mutación dirigida a mano** —romper la implementación a propósito y comprobar que la prueba se pone en rojo— y así encontró un fallo en su propia prueba. Es la única técnica de la sesión que auditó al auditor; automatizarla es esta tarea. |
| **12** | **WebKit / Safari móvil** | §2.4 de este documento | ⚠ **El consejo de Playwright (`apt-get install libicu74 …`) no aplica en esta máquina**: es **CachyOS/Arch**, sin `apt-get`, y `sudo` pide contraseña. Salidas reales: **(a)** correrlo en **CI**, donde `playwright install --with-deps` ya está configurado (`.github/workflows/ci.yml:111`); **(b)** un contenedor Ubuntu; **(c)** en Arch, los equivalentes son `icu`/`libxml2`/`flite`/`libmanette`, pero harían falta las versiones **antiguas** (ICU **74**, `libxml2.so.2`) que Arch ya no distribuye — probablemente vía AUR. **La opción (a) es la sensata.** |
| **13** | **Métricas de salud democrática** | `03-deliberativa-sistemas-antipatrones.md` §6 | Las **cinco** definidas y **ninguna implementada**: tasa de cumplimiento de acuerdos y **deuda de acuerdos**; **HHI** de concentración de voz; **cobertura del padrón desagregada por estrato**; **rotación del núcleo activo**; **razón deliberación/votación**. ⚠ **Ninguna mide «engagement», deliberadamente** (ADR-0040 prohíbe las métricas de actividad individual). **Novedad de hoy que abarata la segunda:** el HHI ya existe, exacto y probado, en `packages/domain/src/tally/common.ts` (`normalizedHerfindahl`, `gini`, `cr1`) — pero es el HHI **de una decisión**; la métrica de §6 es **longitudinal**, sobre la serie de decisiones, y esa parte sigue sin escribirse. |
| **14** | **Volcar al registro los hallazgos de `api`, `anchor` y `verifier-cli`** | `00-contradicciones-resueltas.md` parte 3 | **Abierta a medias.** Las rondas de escrutinio/consenso (E24–E35, B1–B3) y de democracia líquida (E36–E46) ya están volcadas, y el acumulado está corregido a **42** errores de spec. **Siguen sin ficha `E-NN`** los cuatro hallazgos de §5.2-5.3 posteriores a `domain`. Además, `TESTING.md` §Principio rector conserva la cifra «unos 20» y la tabla de `MODEL_CONTEXT.md` §3 conserva conteos históricos (crypto 116, domain 229) que hoy son **108** y **584**. |
| **15** | **Cerrar las divergencias entre `packages/consensus` y ADR-0038** | ADR-0048 §«Divergencias» · ADR-0038 · **ADR-0050** | Parte se cerró en `d3ce8d4` («Ajusta el análisis de consenso a lo que manda ADR-0038»), que subió el paquete de 65 a **101** pruebas. **Lo que queda:** el **umbral de no-facción** —ADR-0050 **propone** sustituir el umbral de silueta fijo por un **contraste de hipótesis nula por permutación determinista**, y está **Propuesto, no aceptado ni implementado**— y, sobre todo, que **nada conecta el paquete con el ledger**: no hay snapshot, ni hash de entrada, ni `AgendaDeConsensoCongelada`. **Hasta cerrar eso, la salida no se presenta a la asamblea.** |
| **16** | **Revisión adversarial del esquema de autoría** | ADR-0046 · **ADR-0049** | **No ejecutada, y el objeto cambió.** ADR-0049 **retiró el esquema de seudónimo y compromiso** que esta tarea iba a auditar; lo que hay que atacar ahora es la **regla de acceso por etapa**, que es más simple y por eso más fácil de auditar de verdad. Sigue sin revisión independiente. Ver la tarea 19, que es la parte de esto que ya se sabe. |
| ~~**17**~~ | ~~**Las seis pantallas que faltan**~~ | `PRODUCT.md` §4 | ⚠ **CORREGIDO el 2026-08-24 — esta fila decía algo falso.** El corte anterior decía «existen 8, faltan 6». **Verificado hoy leyendo el árbol** (`find apps/web/app -name page.tsx`, 32 ficheros) y la navegación (`apps/web/components/marco.tsx`): de las **14 pantallas** de `PRODUCT.md` §4, **13 existen y están enlazadas desde la barra principal** —Inicio, Problemas, Propuestas, Deliberaciones, Decisiones, **Consenso**, Iniciativas, Mis tareas, **Círculos y comisiones**, **Normas**, **Delegaciones**, **Historial**, Verificar integridad—, más tres pantallas que `PRODUCT.md` §4 no numeraba (Asistente, Concentración, Aprendizajes), de ADR-0052/0053. **La única que falta sigue siendo «Reuniones», y sigue siendo deliberado**: no tiene dominio de soporte y no se debe inventar (ver la exclusión explícita en `docs/OBJETIVO.md`). `docs/OBJETIVO.md`, fila `ux-pantallas` (`PARCIAL`, no `CUMPLE`, precisamente por esa única ausencia y porque no se comprobó cada pantalla contra cero violaciones de accesibilidad en esta pasada) es más precisa que esta fila y debe preferirse. |
| **18** | **La constitución digital versionada y su persistencia** | `GOVERNANCE.md` §6 | **Diseñada y sin código.** Falta implementar la persistencia y la lógica del agregado event-sourced para las reglas del §6 de `GOVERNANCE.md` (círculos, normas, etc.). De ella cuelga la pantalla «Normas» de la tarea 17. **Es la pieza de gobernanza más grande que sigue sin empezar.** |
| **19** | **Declarar bien el alcance de la autoría por etapa** | ADR-0049 · `packages/domain/src/access.ts:370` | **Hecho el código, pendiente la consecuencia.** `deliberation:read-authorship` es hoy **`CIRCLE_MEMBER`** con `deniedDuringStage: 'perspectivas'`. Es decir: **cerrar la etapa hace la autoría legible para el CÍRCULO, no para el público.** La revisión adversarial de `gemini/pro` recomendó **eliminar el ocultamiento entero** por engañoso; se aceptó **parcialmente** (se retiró la retención del export, se mantuvo la regla de acceso), y por eso queda esta tarea: **que la interfaz y los textos digan «tu círculo verá quién escribió esto cuando cierre la etapa» y no «se revelará»**. |
| **21** | **Dirección real del facilitador** | — | **BLOQUEANTE PARA USO REAL.** El facilitador configurado es `operador@udea.edu.co`, el cual no existe (Google acepta los correos dirigidos allí pero los rebota). Hasta que no se configure una dirección institucional real, nadie puede ingresar a la plataforma como facilitador. |
| **22** | **Rediseño del sistema visual e interfaz (en curso)** | — | **En curso.** Corregir la desalineación de 272 px en rejillas de escritorio, reducir los 73 KiB de precarga de la barra de 13 enlaces (ocupa 284 px de 800 en vertical, `<h1>` inicia en `y=373`), incorporar `aria-current`, ajustar la escala tipográfica a 360 px y 1280 px para evitar líneas de 85-90 caracteres, y mejorar el contraste de bordes de campos (actualmente 1,58:1, violando WCAG 1.4.11). Se mantiene contraste de texto óptimo (peor caso 7,13:1), cero fuentes web y cero imágenes rasterizadas. |
| **23** | **Mutación de Condorcet-Schulze** | `TESTING.md` §10 | La cobertura de mutación de `condorcet-schulze` está en **77,67%**, aún bajo el umbral establecido. Como referencia, `majority-judgment` llegó a su techo demostrado de **78,60%** tras verificar que no contenía bugs reales, sino 17 fallas en los tests. |


---

## 9. Reglas de orquestación aprendidas

Se pagaron en esta sesión. No son preferencias de estilo.

| Regla | Qué pasó cuando no se siguió |
|---|---|
| **Máximo 2-3 subagentes `task` pesados en paralelo** | Por encima de eso **abortan con `Tool execution aborted`**. Se perdieron **cuatro lanzamientos** aprendiéndolo. |
| **NUNCA dos agentes sobre los mismos ficheros a la vez** | Ocurrió. Dos agentes colisionaron; uno **se refugió en un worktree y commiteó en una rama**; quedaron **migraciones duplicadas**, **lint cruzado** y un **`tsconfig` huérfano**. Costó **una ronda entera de reconciliación**. → **Particionar siempre por fichero, y decirlo explícitamente en el prompt.** |
| **Exigir salida REAL PEGADA**, no parafraseada, de `pnpm test` / `typecheck` / `lint` | Y exigir que digan **sin ambigüedad** si **Docker** o los **navegadores** arrancaron de verdad. Un «todo en verde» sin salida pegada no es información. |
| **Instruir explícitamente: «si un test revela un bug, arreglá la implementación, nunca la aserción»** | Junto con «**prefiero un informe honesto de lo roto a un verde inventado**». **Funcionó**: varios agentes reportaron lo que no pudieron hacer en vez de fingirlo. |
| **Mandar a los implementadores que reporten errores de la spec** | **Es lo más valioso que entregan** (§5). |
| **Pedir escritura por pasadas** | Crear el fichero con las primeras secciones y luego añadir. En documentos largos evita perderlo todo si el agente aborta. *(Este handoff se escribió así.)* |
| **Tras un timeout, inspeccionar el disco ANTES de relanzar** | *(2026-08-22)* El trabajo **sí** sobrevive: el MCP corta la llamada, el CLI sigue escribiendo. Las dos tareas caídas dejaron código utilizable. Relanzar a ciegas habría duplicado el gasto y perdido lo ya escrito. **Y la consolidación se encarga a un agente que audite lo heredado, no que lo rehaga.** |
| **Diseño y revisión a `delegar_a_cloud`; implementación larga con pruebas a subagentes `task`** | *(2026-08-22)* El techo del transporte es de **duración**, no de proveedor ni de palabras: tres generaciones largas de diseño completaron en paralelo, y cayeron las dos implementaciones que además corrían tests durante minutos. |
| **Un agente que se niega a trabajar puede ser la entrega más valiosa** | *(2026-08-22)* `codex/gpt-5.6-sol` no escribió una línea en su primer intento: paró porque el recorte de ficheros era imposible, y de paso refutó dos invariantes falsos que venían de otro modelo. Es la regla 2 de `MODEL_CONTEXT.md` §1 funcionando; **no hay que penalizar el «no se puede», hay que corregir el recorte.** |

---

## 10. Transporte de delegación — historia del fallo y diagnóstico vigente

**Vigente:** el transporte **funciona** y su único límite conocido es la **duración** de la llamada.
Ir directo al «Diagnóstico corregido el 2026-08-22», dos apartados más abajo; lo que viene primero es
el historial, que se conserva para no volver a diagnosticar mal lo mismo.

### Historial — `delegar_a_cloud` (MCP `cloud-offload`) fue inservible durante dos sesiones

| Proveedor | Fallo observado (2026-08-21) |
|---|---|
| `codex/gpt-5.6-sol`, `codex/gpt-5.6-terra` | **`invalid ID token format`** — autenticación del CLI de Codex rota. **Ya no se reproduce.** |
| `gemini/pro`, `gemini/flash`, `minimax/MiniMax-M3` | **`MCP error -32001: Request timed out`** en todo lo que no fuera trivial. |

**Actualización durante ADR-0044:** en el runtime actual `delegar_a_cloud` y el MCP
`cloud-offload` ni siquiera aparecen en el catálogo de herramientas. Se hicieron **cero llamadas** a
MiniMax o Gemini; no se atribuye a esos modelos ningún resultado de esta ronda. Es un fallo de
transporte distinto de los timeouts históricos de la tabla.

**Actualización 2026-08-22 — el transporte se reprobó y responde.** `delegar_a_cloud` vuelve a estar
en el catálogo de herramientas y **los tres proveedores respondieron** a una llamada trivial
(«respondé únicamente con la palabra PONG»): **`minimax/MiniMax-M3`**, **`gemini/flash`** y
**`codex/gpt-5.6-sol`** (con `effort: low`) devolvieron `PONG` los tres, sin timeout y sin el
`invalid ID token format` que la tabla de arriba atribuía a Codex. El fallo de catálogo de ADR-0044 y
la autenticación rota de Codex **ya no se reproducen**.

### Diagnóstico corregido el 2026-08-22 — el transporte funciona, y falla por duración

La sesión del 2026-08-22 usó `delegar_a_cloud` en serio por primera vez y **corrige dos afirmaciones
de esta sección que eran falsas**. El detalle está en `MODEL_CONTEXT.md` §8.1.

**Corrección 1 — el trabajo SÍ sobrevive al timeout.** Esta sección afirmaba, en mayúsculas, que
«tras un timeout se inspeccionó el disco y no había quedado nada escrito». **Hoy es falso.** El MCP
corta la llamada, pero **el CLI delegado sigue corriendo y escribiendo**. Las dos tareas que cayeron
por timeout —los métodos de escrutinio y el paquete de consenso— **dejaron código utilizable en
disco**; una de ellas dejó el paquete completo salvo los tests.

> **La pauta correcta ante un timeout es inspeccionar el disco ANTES de relanzar nada**, y encargar
> la consolidación a un agente que **audite lo heredado en vez de rehacerlo**. Rehacer habría costado
> dos generaciones largas más y habría perdido los veintidós defectos que las dos auditorías
> encontraron precisamente por mirar código ajeno con desconfianza.

**Corrección 2 — el umbral es por DURACIÓN de la llamada, no por proveedor ni por número de
palabras.** Las **tres generaciones largas de diseño** —miles de palabras cada una, lanzadas en
paralelo a `gemini/pro`, `codex/gpt-5.6-terra` y `minimax/MiniMax-M3`— **completaron sin problema**,
lo que refuta el «todo lo que pedía ≥600 palabras reventó» del corte anterior. Lo que cayó fueron las
**dos implementaciones largas que además corren tests**, una de Codex y otra de MiniMax. No hay
proveedor malo: hay un techo de tiempo de llamada, y lo que lo supera es ejecutar herramientas durante
minutos, no escribir texto.

> **Regla de reparto que queda: diseño, especificación y revisión adversarial a `delegar_a_cloud`;
> implementación larga con pruebas a subagentes `task`.**

**Lo que sigue haciendo falta**, sin cambios respecto al corte anterior:

1. **Timeout configurable y mucho más largo.**
2. Preferiblemente, **un modo asíncrono de lanzar-y-consultar**: que `delegar_a_cloud` devuelva un
   **identificador de trabajo inmediatamente** y que exista **una segunda herramienta** para consultar
   el estado y recoger el resultado. Ahora se sabe que el proceso **sí sigue vivo**, así que este
   modo asíncrono es sobre todo una forma de dejar de perder la salida, no de salvar el trabajo.

**Lo que quedó sin ejecutar por transporte en esta sesión:** la **revisión adversarial independiente
del esquema de seudónimo** de ADR-0046 (`claude/opus`). **No se atribuye ningún resultado a esa
llamada**, y la tarea 16 de §8 la deja explícitamente abierta.

### Consecuencia real sobre la sesión del 2026-08-21

El plan de ruteo declarado al inicio —**`gemini/pro`** para investigación de contexto largo,
**`codex/sol` con `effort: high`** para la criptografía, **`codex/terra`** para la teoría de la
elección social, **`gemini/flash`** para la normativa— **no sobrevivió al contacto con la
infraestructura**. **Todo terminó ejecutándose en subagentes `task`.**

El **presupuesto abundante de MiniMax**, destinado a **QA exploratorio masivo** y a la **matriz de
navegadores**, quedó entonces **sin usar por transporte, no por criterio**. El 2026-08-22 MiniMax ya
entregó una especificación correcta y un paquete completo, así que ese pendiente **ya no es de
transporte**: el QA exploratorio masivo y la matriz de navegadores siguen siendo el trabajo natural
para él, y ahora sí se le puede encargar.

---

## 11. Cómo arrancar la próxima sesión

1. **Leer este handoff entero.**
2. **Leer `docs/ARCHITECTURE.md` y `docs/adr/README.md`.** Los ADR no se reabren; si uno parece mal,
   se reporta.
3. **Reproducir el verde antes de tocar nada:**

   ```bash
   pnpm install
   docker compose -f infra/docker/docker-compose.yml up -d
   pnpm build
   KOINONIA_REQUIRE_DOCKER=1 pnpm test
   ```

   **Confirmar `Test Files 179 passed (179)` · `Tests 2824 passed (2824)`**, que es lo que `6251d60`
   tiene commiteado y lo que esta sesión **corrió de verdad hoy** (§0 y §2.2, no una cuenta de
   `vitest list`). Si da **menos**, o si algo está en rojo, **el primer trabajo es averiguar por
   qué**, no seguir adelante. La variable `KOINONIA_REQUIRE_DOCKER=1` es obligatoria: sin ella, la
   ausencia de Docker se convierte en una suite saltada y en un verde que no probó nada.

   ⚠ **No uses `--reporter=basic`:** no existe en vitest 4 y el comando aborta antes de correr nada.
   Usá `--reporter=dot` o el default.

4. **Comprobar el estado de git antes que nada más.** Hoy (2026-08-24) **local está adelante del
   remoto**: `git rev-parse HEAD` da `6251d60…` y `git ls-remote origin refs/heads/main` da
   `c89e3b9…` — falta empujar los commits de la tanda de 22 agentes en paralelo y de las dos pasadas
   de integración. **No asumas que coinciden**: comprobalo de nuevo con esos dos comandos, porque
   pudo haber cambiado desde que se escribió esta frase.

5. **Leer la tarea 0 de §8 y ADR-0054**, antes de elegir nada. Es una decisión pendiente, no una
   tarea de código, y condiciona lo que tenga sentido construir encima: cada votación que se abra
   mientras tanto congela un padrón cuya procedencia nadie puede acreditar.

6. **Sólo entonces, elegir entre lo demás — y para eso `docs/OBJETIVO.md` es la fuente que hay que
   leer, no la lista de abajo.** Las «tres candidatas» que este documento recomendaba desde el
   2026-08-22 ya se resolvieron: pantallas «Consenso» y «Delegaciones» **existen y están enlazadas**
   (tarea 17, corregida arriba); la tarea 19 (alcance de la autoría) y la tarea 16 (revisión
   adversarial) siguen sin cerrar, pero `docs/OBJETIVO.md` las tiene reflejadas fila por fila, con
   fecha y evidencia, dentro de un inventario de **87 pendientes** más disciplinado que esta sección.
   El pendiente más urgente de todo el proyecto **hoy** es otro y no estaba aquí: bajo carga
   concurrente real en el cierre de una votación el sistema **pierde votos** —algunos con `500`
   explícito, una fracción con `201` de éxito falso—, hallazgo de `tests/carga/` documentado en
   `docs/TESTING.md` §11.2 y en la fila de `testing` de `docs/OBJETIVO.md`. Es una falla de
   integridad electoral, no de rendimiento, y no se corrigió en ninguna de las pasadas de
   integración porque no era propiedad de quien la encontró.

Antes de delegar cualquier cosa: leer `docs/MODEL_CONTEXT.md` §1 —los **siete campos** obligatorios de
toda delegación—, su **§8** (registro de ruteo del 2026-08-22, con las tres reglas nuevas) y §9 de
este documento.

---

## 12. Estado vigente y correcciones aplicadas a los datos de partida

**Estado vigente en `6251d60`** (corrido de verdad el 2026-08-24, no contado): **2 824 tests en 179
ficheros, todos en verde**, incluidos **420** contra PostgreSQL 16 real; desglose por paquete
(crypto 108 / domain 1 265 / anchor 128 / verifier-cli 34 / contracts 311 / consensus 101 /
metrics 92 / services/api 314 / tests/integration 420 / exploratorias 14 / unit 37); **10 proyectos**
en el workspace (siete paquetes); **54 ADR + README**, índice al día; migraciones **0001–0013**
(**trece**); **178** llamadas `fc.property`/`fc.asyncProperty` en dominio, **13** en consenso y **9**
en métricas; **32** ficheros `page.tsx` (**34** rutas); **230 escenarios E2E** en **14 ficheros**,
Chromium+Firefox en verde; `pnpm run typecheck`, `lint`, `build` y `build:web` en verde, corridos
hoy; **despliegue en producción operativo pero desactualizado** —tiene sólo `0001`–`0011` de las
trece migraciones y falta toda la tanda de 22 agentes en paralelo (§7)—; **local adelante del
remoto**, falta un `push` (§0); licencia **AGPL-3.0-or-later**. Siguen vigentes la compuerta C6, las
27 preguntas y la fórmula GIC.

**Lo que se corrió hoy y lo que no.** Al contrario que el corte del 2026-08-23 —que sólo contaba con
`vitest list` y `playwright --list`—, **este corte tiene verde propio**: se ejecutaron
`pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run build:web`,
`KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run` (con reporter `dot` y luego `json`, para el desglose
exacto) y `KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox`,
todos de verdad, con salida pegada en §0 y §2.2. Lo que **no** se corrió esta vez: WebKit y Safari
móvil (bloqueados por librerías del sistema, sin cambios, §2.4), `pnpm run test:coverage`, Stryker, y
no se redesplegó producción (sólo se leyó por SSH, de sólo lectura para este trabajo).

### 12.0-bis Correcciones aplicadas hoy (2026-08-24) a lo que este documento venía afirmando

El encargo de esta pasada fue explícitamente «que la documentación diga la verdad de hoy», porque
este documento **llevaba dos días afirmando cosas falsas**. Lo que se corrigió, cada uno contra un
comando o una lectura de código, no contra el reporte de una sesión anterior:

| # | Lo que este documento afirmaba | Lo verificado hoy | Comprobación |
|---|---|---|---|
| 1 | Tarea 17: «existen 8 pantallas, faltan 6» | **Falso.** Existen 13 de las 14 de `PRODUCT.md` §4, todas enlazadas desde la navegación; sólo falta «Reuniones», deliberadamente | `find apps/web/app -name page.tsx` (32 ficheros) + lectura de `apps/web/components/marco.tsx` (lista `CONSULTA`) |
| 2 | §0/§2.2: los conteos de pruebas y E2E son «lo que se contó con `vitest list`/`--list`, no lo que se ejecutó» | Esta vez se **ejecutaron**: `2 824` pruebas en `179` ficheros (vitest) y `230` escenarios E2E (Chromium+Firefox), los dos en verde | `KOINONIA_REQUIRE_DOCKER=1 pnpm exec vitest run` y `KOINONIA_MATRIZ=completa pnpm exec playwright test --project=chromium --project=firefox`, salida pegada en §0/§2.2 |
| 3 | §2.5: «once migraciones» | **Son trece.** `0012_sesion_endurecida.sql` y `0013_rate_consumption_idempotencia.sql` no estaban contadas | `ls services/api/migrations \| wc -l` |
| 4 | §3.2: «50 ADR, 51 ficheros, índice hasta el 0049» | **Son 54 ADR + README (55 ficheros), índice al día hasta el 0054** | `ls docs/adr \| wc -l` + lectura de `docs/adr/README.md` |
| 5 | §7: el despliegue en producción se describía como si reflejara el código de hoy | **No lo refleja.** El contenedor se creó el 2026-08-23 17:53, antes de 22 commits incluidos el de la tanda de 22 agentes en paralelo; tiene sólo 11 de las 13 migraciones, y `/concentracion` y `/aprendizajes` dan `404` en producción | `docker inspect koinonia-api --format '{{.Created}}'`, `SELECT name FROM koinonia_meta.migration`, y `curl` contra las dos rutas |
| 6 | README.md: tabla de «Estructura» con cinco paquetes | **Son siete.** Faltaban `packages/consensus` y `packages/metrics`, que existen desde el 2026-08-22 | `ls packages/` |
| 7 | *(no dictado, hallado al verificar)* | `git ls-remote origin refs/heads/main` **no coincide** con `git rev-parse HEAD`: el remoto (`c89e3b9`) está detrás del local (`6251d60`) en 12 commits, sin empujar | Los dos comandos, comparados |

*(Se numera «12.0-bis» y no «12.0» para no reordenar los números de las subsecciones existentes, que
otros documentos podrían citar por número.)*

### 12.1 Correcciones aplicadas a los datos con los que se dictó la actualización del 2026-08-23

Se conserva la regla de C4 —«un revisor también inventa el error que corrige»— para quien dicta:

| # | Dato dictado | Valor verificado | Comprobación |
|---|---|---|---|
| 1 | La supresión deja los eventos `PIIErasureRequested` / **`PIIErasureExecuted`** | El segundo **no existe con ese nombre**. Se llama **`PIIErased`** | `services/api/src/http/private-material-store.ts:317` (`PII_ERASURE_EXECUTED_EVENT = 'PIIErased'`), y coincide con ADR-0021, `ARCHITECTURE.md:302` y la fila 0021 de `docs/adr/README.md` |
| 2 | `service.ts:577` — «`registryVersion` está fijado siempre a `1`» | **El hecho es cierto; la línea no.** `:577` es la firma de `congelarPadron()`; el literal `registryVersion: 1` está en **`:580`** | `rg -n "registryVersion" services/api/src` |
| 3 | `electorate.ts:93` y `:134` — «el `rollHash` y el congelado» | **Son líneas de comentario, no de código.** Las funciones están en **`:97`** (`computeRollHash`) y **`:141`** (`freezeElectorate`); `:92-99` y `:134-140` son sus bloques de documentación | Lectura del fichero |
| 4 | «`pnpm run lint` incluye `prettier --check` de los `.md`» | **Falso para `docs/`.** `.prettierignore` contiene la línea `docs/`, así que **prettier no revisa ni uno solo de estos ficheros**. `pnpm run lint` sí corre y sí pasa, pero no está validando el formato de esta entrega | `cat .prettierignore` |
| 5 | *(no dictado, hallado al verificar)* | **`withdrawn_at` no lo escribe nunca ninguna línea de `services/api/src`.** Las únicas escrituras sobre `identity.member` son el `upsert` (`identity.ts:139`) y el `DELETE` de la supresión (`private-material-erasure.ts:271`). **La baja del padrón no tiene camino de aplicación** | `rg -n "identity\.member" services/api/src` |
| 6 | *(no dictado, hallado al verificar)* | **Colisión de numeración de erratas.** `E90`–`E93` están usados **dos veces** con contenidos distintos: en `docs/research/00-contradicciones-resueltas.md:2041-2096` (constitución) y en la tabla de `docs/adr/0053-evaluacion-resultado-y-aprendizajes.md:277-280` (evaluación). Citar «E93» hoy es ambiguo | Lectura de los dos ficheros |

### 12.2 Correcciones a los datos con los que se dictó la actualización del 2026-08-22

*(Numeradas «11.1» y «11.2» hasta el 2026-08-23 por un error de rotulado: colgaban de la §12, no de
la §11. Se renumeran; el contenido no se toca.)*

Cuatro datos del dictado del 2026-08-22 **no coincidían con el repositorio**. Se corrigieron antes de
escribirlos, y se dejan aquí porque la regla de C4 —«un revisor también inventa el error que
corrige»— vale igual para quien dicta:

| # | Dato dictado | Valor verificado | Comprobación |
|---|---|---|---|
| 1 | «corré `npx vitest run --reporter=basic`» | **El comando no existe.** Vitest 4.1.11 retiró el reporter `basic`: aborta con `Failed to load custom Reporter from basic` sin correr una sola prueba | Se usó `--reporter=dot`. Anotado también en §2.2 y §10 |
| 2 | El corte vertical de deliberación dejó «**1 207 tests**» | **1 207 es el total DESPUÉS de la democracia líquida, no después del corte vertical.** El corte vertical dejó ≈ **1 102**; la democracia líquida sumó los +104 que llevan a 1 206-1 207; la corrección de la escalada horizontal (`bf01277`) añadió los últimos ~6 hasta los **1 213** de hoy | Deltas de `it(`/`test(` por commit: `64cb797` +42, `4671c7c` +104, `bf01277` +7. Los tres ficheros nuevos de delegación suman **101** pruebas medidas |
| 3 | «**55** escenarios e2e» | **55 era exacto en `64cb797`**, y hoy son **56**: `ea684c4` añadió el escenario que comprueba que «Deliberaciones» es alcanzable desde la navegación | `git grep -c "^\s*test(" <rev> -- tests/e2e/` |
| 4 | Faltan «las pantallas de consenso, círculos, reuniones, normas, delegaciones e historial» | **Correcto, son seis**, pero el corte anterior de este documento decía «**siete**, incluida deliberaciones». **Deliberaciones ya existe** desde `64cb797`; la fila 17 estaba desactualizada | `fd page.tsx apps/web/app` → 17 ficheros |

### 12.3 Correcciones históricas del corte del 2026-08-21 (se conservan por trazabilidad)

**No son el contador vigente**, que está en §2 y en el resumen de arriba.

| # | Dato dictado | Valor verificado | Comprobación |
|---|---|---|---|
| 1 | E2E: «**84 pasan** de verdad» | **100 passed · 10 failed · 30 did not run** (de 140) | `pnpm e2e:matriz`. Los 84 son chromium+firefox+chrome-movil completos; se suman **16** de webkit/safari-movil que sólo llaman a la API y no abren navegador. |
| 2 | «~**28 errores** reales en especificaciones» | Entonces: **25 entradas**, **20 errores dentro de spec**. **Hoy son 51 entradas y 42 errores de spec** (§5.1) | Tabla «El dato acumulado» de `00-contradicciones-resueltas.md`. Los 3 peores citados (RULE, `ORDER BY tree_size`, `count=max+1`) **siguen sin ficha `E-NN`** → tarea 14 de §7. |
| 3 | Los dos tests emparejados están «en **`packages/anchor`**» | Están en **`packages/verifier-cli/test/ataques.test.ts:310` y `:318`** | Además, sin anclajes el verificador **no calla**: emite `SIN_ANCLAJE` y sale **ámbar**, nunca verde. Matiz recogido en §6. |
| 4 | `apps/web`: «**14 rutas**» | Entonces **12** `page.tsx` + 1 proxy = **13**. **Hoy son 17 + 1 = 18** | `fd page.tsx apps/web/app`. |
| 5 | WebKit: instalar «`libicu74 libxml2 libflite1 libmanette-0.2-0`» | Son los **nombres Debian** que sugiere Playwright, **no instalables aquí**: el sistema es **CachyOS/Arch**, sin `apt-get` (`--with-deps` aborta con `spawn apt-get ENOENT`) y `sudo` pide contraseña | `/etc/os-release`; `ldd` sobre `webkit-2336` da los sonames reales (§2.4). Salida sensata: **CI**. |
| 6 | `packages/domain`: «**40 propiedades** fast-check» | Entonces **60**. **Hoy 124** | La semilla `30_000_821` **sí** es exacta y sigue siéndolo, incluida la de las propiedades de delegación. |
