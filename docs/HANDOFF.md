# Handoff de sesión — Koinonía

> **Fecha:** 2026-08-22 (actualiza el corte del 2026-08-21) · **Destinatario:** la próxima sesión de
> trabajo, que no vio nada de lo anterior.
>
> Este documento es **autocontenido**. No hace falta haber estado en la sesión previa ni recordar
> nada: aquí está el estado del repositorio, las decisiones vinculantes, lo que falta, lo que se
> aprendió y lo que está roto. Se lee entero **antes** de tocar código.
>
> **Estado:** informativo, no normativo. Cuando este documento y un ADR discrepen, manda el ADR
> (jerarquía en §3). Lo único que aquí es vinculante son las decisiones de §4, y lo son porque están
> recogidas en los ADR y en las especificaciones, no por estar escritas aquí.

---

## 0. Verificación de este documento

Todo lo verificable se comprobó contra el repositorio el 2026-08-22, después de integrar ADR-0046,
ADR-0047 y ADR-0048. Las cifras de pruebas y rutas de esta sección sustituyen las del corte anterior.
Lo que no se pudo verificar se marca explícitamente como *no verificado*.

⚠ **Nada de git se verificó en esta actualización.** La escribió un agente de documentación mientras
otro agente commiteaba en paralelo, con prohibición expresa de ejecutar cualquier comando de git.
Todos los datos de commit, rama y árbol de trabajo de §2.1 son **los del corte anterior** y hay que
volver a comprobarlos antes de apoyarse en ellos.

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
| Rama | `main` *(no reverificado el 2026-08-22)* |
| Último commit funcional | `286db3d` — *Seguimiento, capacidad privada y entrega revisable (ADR-0045)*. **El trabajo de ADR-0046 a ADR-0048 se estaba commiteando mientras se escribía esto: el hash resultante no está registrado aquí** |
| Árbol de trabajo | *No verificado el 2026-08-22* |
| Remoto | **Ninguno configurado** en el corte anterior; `main` sin upstream. El repositorio existe **sólo en disco local**. Sigue siendo el riesgo de custodia más grave del proyecto |
| Gestor de paquetes | `pnpm@11.20.0` · Node `>=22` · **9 proyectos** en el workspace (era 8; entra `@koinonia/consensus`) |
| Licencia | AGPL-3.0-or-later |

Últimos commits relevantes:

```
286db3d Seguimiento, capacidad privada y entrega revisable (ADR-0045)
e98bc1b Actualiza el handoff tras ADR 0044
2eea322 Activa iniciativas y ofrece tareas con consentimiento
872834b Actualiza el handoff tras ADR 0043
5e93f44 Vincula decisiones aprobadas con iniciativas atomicas
427297d Documento de traspaso de sesión y registro de ruteo del 2026-08-21
36b37c2 Integra el anclaje externo y el verificador independiente con el corte vertical
d46cd3c Configuración de raíz para los cinco paquetes y documentación pendiente
529157a Corte vertical: capa HTTP, interfaz y extremo a extremo
af423f5 Anclaje externo con quórum 2-de-3 y verificador independiente
d731607 Capa de persistencia del ledger en services/api sobre PostgreSQL
32c6c3e Núcleo de packages/domain: motor de decisiones (PARTE A, B.1–B.4, PARTE D)
2f73136 Andamiaje del monorepo y packages/crypto completo
```

> **Incidente de custodia, 2026-08-22.** Este documento afirmaba hasta hoy que el último commit era
> `2eea322` y que el árbol estaba limpio. **Las dos cosas eran falsas.** La sesión de ADR-0045 dejó
> **70 entradas sin commitear** (47 ficheros modificados y 23 sin rastrear: migraciones 0008-0010,
> `private-material.ts`, `apps/web/app/mis-tareas/`, los cuatro módulos HTTP de capacidad y material
> privado, 11 ficheros de test nuevos y el propio ADR-0045). Se commiteó en `286db3d`
> —**+13 699 / −219** sobre 70 ficheros— **antes** de verificar nada, para no arriesgar la pérdida.
> Como **no hay remoto**, un `git clean` o un borrado del directorio habría destruido el trabajo sin
> copia posible. **Configurar un remoto es la tarea de infraestructura más urgente del proyecto.**

### 2.2 Resultado real de los comandos (ejecutados el 2026-08-22, tras ADR-0046/0047/0048)

Salida copiada literalmente:

| Comando | Salida | Detalle |
|---|---|---|
| `docker compose … ps` | **código 0** | `koinonia-postgres … Up 16 hours (healthy)`, puerto `55432` |
| `pnpm run typecheck` | **código 0** | `tsconfig.check.json` + `contracts`/`api` + `tests/e2e`, sin diagnósticos |
| `pnpm run lint` | **código 0** | `All matched files use Prettier code style!` · `Pureza del dominio: correcta (packages/domain, packages/crypto y packages/consensus sin dependencias de runtime).` |
| `KOINONIA_REQUIRE_DOCKER=1 pnpm run test` | **código 0** | `Test Files  77 passed (77)` · `Tests  1006 passed (1006)` · `Duration 8.02s` |

**No re-ejecutados en esta actualización:** `pnpm install` y `pnpm run build`. Sus resultados son los
del corte anterior y no deben leerse como medición de hoy. El dato que sí cambió y sí está
comprobado es el alcance del workspace: **9 proyectos**, porque entra `@koinonia/consensus`.

**Un dato nuevo del linter de pureza, que importa:** `scripts/check-domain-purity.mjs` ya cubre
`packages/consensus`. El paquete admite punto flotante (ADR-0048) pero **no admite dependencias de
runtime**, igual que `domain` y `crypto`.

**Docker arrancó de verdad.** No es una inferencia del código de salida; se comprobó por tres vías
independientes:

1. `docker compose ps` da `Up 14 hours (healthy)`, y `psql -U postgres -d koinonia` responde
   `PostgreSQL 16.15 on x86_64-pc-linux-musl`.
2. Muestreando `docker ps` cada segundo **durante** la corrida se observaron hasta **10 contenedores
   `postgres:16-alpine` simultáneos** (1 del compose + 9 levantados por Testcontainers). Los 16
   ficheros de `tests/integration/` están dentro del glob `tests/**/*.test.ts` de `vitest.config.ts`,
   y hoy hay exactamente **77** ficheros `*.test.ts` en el repositorio: los 77 que corrieron **son**
   todos, integración incluida.
3. **Prueba de falsación**, que es la que de verdad cierra la cuestión: con `DOCKER_HOST` apuntando a
   un puerto muerto y `KOINONIA_REQUIRE_DOCKER=1`, la suite **falla** —
   `Error: Testcontainers no pudo levantar Docker: Could not find a working container runtime
   strategy. KOINONIA_REQUIRE_DOCKER=1 exige que corran de verdad.` en
   `tests/integration/helpers/api-env.ts:131`. Un verde que sobreviviera a romper Docker sería un
   verde vacío; éste no sobrevive, luego no lo es. La falsación la ejecutó el subagente de rescate de
   ADR-0045 **sobre su propio verde**, que es la forma correcta de usarla.

**Delta sobre el corte anterior: +208 pruebas y +16 ficheros** (de 798 en 61 a **1 006 en 77**).

**No reverificado hoy:** los extremos a extremo (`pnpm e2e`) **no se volvieron a ejecutar**. Las
cifras de §2.4 son las del corte del 2026-08-21, y además **ningún escenario E2E cubre lo que se
añadió hoy**: deliberación, escrutinio nuevo y consenso no tienen interfaz, así que tampoco tienen
extremo a extremo.

### 2.3 Desglose por paquete (verificado uno por uno)

| Paquete | Tests | Qué contiene |
|---|---:|---|
| `packages/crypto` | **108** | Canonicalización JCS (RFC 8785), SHA-256 sobre WebCrypto, cadena de hashes por agregado, Merkle RFC 6962 con pruebas de inclusión y de consistencia. Sin dependencias de runtime. |
| `packages/domain` | **481** | `DecisionEngine` puro, agregados de trabajo y, nuevo hoy: **los cinco métodos de escrutinio que faltaban** (`src/tally/`: score, IRV, valoración por menciones, Condorcet/Schulze y sorteo estratificado) y **el agregado de deliberación** (`src/deliberation/`: etapas como ventanas, grafo tipado, compromiso de autoría y seudónimo por deliberación). Propiedades con fast-check y semillas fijas. |
| `packages/anchor` | **80** | `AnchorProvider` enchufable, OpenTimestamps (clase `blockchain`), git firmado con SSH —no GPG— (clase `vcs`), correo a testigos (clase `human-witness`), política de quórum **2 de 3 clases de independencia**. |
| `packages/verifier-cli` | **34** | Verificador independiente, en español, que **no depende de nuestro servidor**. También detecta `eventId` global duplicado aunque el índice SQL haya sido retirado. |
| `packages/contracts` | **24** | Esquemas Zod compartidos, incluida la frontera estricta y self-only de solicitud de supresión. |
| **`packages/consensus`** | **65** | **Paquete nuevo (ADR-0048).** Análisis de consenso transversal: PCA determinista por *power iteration*, k-means con inicialización *furthest-first*, estadísticos con Laplace y afirmaciones puente por `GIC = ∏ p̂`. Admite punto flotante porque su salida es agenda; **sin dependencias de runtime**. |
| `services/api` | **53** unitarios **+ 161** de integración | Event store append-only, replay idempotente, capacidad cifrada, aperturas privadas autenticadas y supresión física ligada a solicitud propia, commits multiagregado, CAS y auditoría interna. |
| `apps/web` | vía E2E | Next.js PWA. Sin suite unitaria propia, por decisión (`TESTING.md` §1). |
| | **1 006** | **en 77 ficheros** |

`packages/domain` declara **102** llamadas `fc.property`/`fc.asyncProperty` (eran 60 en el corte
anterior), y `packages/consensus` otras **11**, con semilla fija `20260822`. Comprobación:

```sh
grep -roh -E "fc\.(property|asyncProperty)" packages/domain/test | wc -l      # 102
grep -roh -E "fc\.(property|asyncProperty)" packages/consensus/test | wc -l   # 11
```

**Cuidado con el patrón al recontar:** `fc\.\(async\)\?property` **no sirve** —busca
`fc.asyncproperty` en minúscula y deja fuera las asíncronas. La `P` de `asyncProperty` es mayúscula.

### 2.4 Extremo a extremo

**44 escenarios** en `tests/e2e/` (`01-gobernanza` 1, `02-versionado` 1, `03-permisos` 9,
`04-accesibilidad` 16, `05-inmutabilidad` 5, `06-ejecucion-inicial` 8,
`07-seguimiento-adr45` 4) × **5 proyectos** Playwright = 220 ejecuciones configuradas.

Resultado actual verificable: **Chromium pasa los 44**. El flujo nuevo de ADR-0045 pasa además sus
cuatro escenarios en **Firefox** y **Chrome móvil** (8 ejecuciones); los cortes anteriores también
estaban verdes en ambos. La matriz de cinco proyectos no se presenta como una cifra
verde: en **WebKit** y **Safari móvil** el proceso del navegador sigue sin arrancar en este host. La
última corrida completa anterior, con 30 escenarios, dejó `106 passed · 10 failed · 34 did not run`;
el bloqueo se resuelve en CI, no inventando un total local.

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
distribuye. Ver §7, tarea 12, para las salidas reales.

**Están configurados y fallando en rojo a propósito.** No se han silenciado ni marcado como
`skip`: un rojo visible es información; un verde que no probó nada es una mentira. Quien vaya a
tocar esto debe mantener esa decisión.

### 2.5 Migraciones

`services/api/migrations/`, diez, todas aplicadas por `migrate()`:

| Fichero | Contenido |
|---|---|
| `0001_governance_ledger.sql` | Tablas `governance.event`, `governance.checkpoint` |
| `0002_append_only_guard.sql` | Trigger `ENABLE ALWAYS` de blindaje append-only |
| `0003_roles_and_grants.sql` | `koinonia_ddl` / `koinonia_app`; el rol de la aplicación sólo tiene `SELECT, INSERT` |
| `0004_projection.sql` | Proyecciones de lectura |
| `0005_identidad.sql` | PII Vault e identidad |
| `0006_anclaje.sql` | `anchor_attempt`, recibos, sellos |
| `0007_append_request_scope.sql` | Namespace separado para claves públicas y consecuencias internas atómicas |
| `0008_capacidad_privada.sql` | DSK por sujeto y capacidad semanal cifrada, self-only |
| `0009_event_id_unico.sql` | Índice único global de identidades causales de eventos |
| `0010_private_material.sql` | Aperturas textuales restringidas con ciphertext de longitud fija |

**Sin cambios en este incremento.** ADR-0046, ADR-0047 y ADR-0048 **no añaden ninguna migración**:
los métodos de escrutinio viven en el dominio, la deliberación todavía no tiene persistencia propia y
`packages/consensus` no toca la base. La única frontera de API que se tocó es el codec de
configuración de decisiones (§5, bug B2), que no cambia el esquema.

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
| `docs/adr/` | **48 ADR** (`0001`–`0048`) **+ `README.md`** de índice. 49 ficheros en total. Los tres últimos son de hoy: **0046** deliberación por etapas, **0047** métodos de escrutinio completos, **0048** consenso transversal como agenda. |
| `docs/research/30-decision-engine-spec.md` | Especificación del motor de decisiones. La única pieza de `research/` con rango normativo. ~2 600 líneas, 60 invariantes (`INV-01`–`INV-60`), 7 anti-invariantes. |
| `docs/PRODUCT.md` | Producto y alcance funcional. §6 diseña ejecución y seguimiento. |
| `docs/ARCHITECTURE.md` | Arquitectura del sistema. |
| `docs/TESTING.md` | Estrategia de pruebas. Normativa para lo que se considera «terminado». |
| `docs/MODEL_CONTEXT.md` | Qué contexto recibe un agente al que se delega, y registro de delegaciones. |

`docs/research/` (insumo, salvo el 30):

| Fichero | Tema |
|---|---|
| `00-contradicciones-resueltas.md` | **Registro del proceso**: resoluciones R1–R3, contradicciones C4–C20, errores de implementación **E1–E35** (con **E24 retirada** por ser error propio del orquestador) y tres bugs autodestructivos del código (B1–B3). Es el documento a leer para entender *por qué* algo es como es. |
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

| | Spec 10 (`crypto`) | Spec 30, 2ª ronda | Spec 30, 3ª ronda | Total |
|---|---:|---:|---:|---:|
| Errores **dentro de la especificación** | 6 (E1–E6) | 14 (E10–E23) | 11 (E25–E35) | **31** |
| Incoherencias entre ADR y specs | 2 (E7, E8) | — | — | 2 |
| Hallazgos derivados al propagar | 2 (E1′, E1″) | — | — | 2 |
| Divergencias elevadas sin cerrar | 1 (E9) | — | — | 1 |
| Entradas **retiradas** (error propio) | — | — | 1 (E24) | 1 |
| Bugs autodestructivos del código | — | — | 3 (B1–B3) | 3 |
| **Entradas registradas** | 11 | 14 | 15 | **40** |

⚠ **El registro sigue incompleto, aunque menos.** La tercera ronda (2026-08-22, métodos B.5–B.9 y
consenso) ya está volcada. Lo que **sigue sin ficha `E-NN`** son las rondas de `services/api`,
`packages/anchor` y `packages/verifier-cli`: los tres hallazgos de §5.2 puntos 2-4 y el bug del
verificador de §5.3, que sólo viven en comentarios de código y en nombres de test. Total real ≈ **44
hallazgos**, de los cuales ≈ 35 son errores de especificación. **La tarea 14 de §7 queda abierta a
medias.**

**La tercera ronda añade un tipo de entrada que no existía: un error del propio orquestador.** E24 se
registró como fallo de la spec y era una directiva equivocada; la spec tenía razón. Está **tachada,
visible y explicada**, porque un registro que borra sus propios errores no sirve para aprender. Su
lección es la de C4 con los papeles invertidos: **una corrección llega con forma de corrección y
recibe menos escrutinio que una afirmación nueva.**

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

## 7. Qué falta — plan de continuación priorizado

| # | Tarea | Dónde está la spec | Notas |
|---:|---|---|---|
| ~~**1**~~ | ~~**Métodos de escrutinio restantes**~~ | `30-...` **PARTE B.5–B.9** | **HECHO el 2026-08-22 (ADR-0047).** Los cinco implementados en `packages/domain/src/tally/` con aritmética exacta. El anti-invariante de IRV se probó **en positivo**, no con `skip`, y aparecieron **dos más** que la spec afirmaba al revés: MJ no satisface *later-no-harm* ni el criterio de mayoría fuerte. Doce erratas de spec registradas (E25–E35, más E24 retirada). |
| **2** | **Democracia líquida** | `30-...` **PARTE C**, `INV-23..30` | Delegación temática, revocable; voto directo que anula; detección de ciclos; límite de profundidad; cap de concentración; índice HHI. **El punto de extensión ya existe** en el dominio y los eventos `DelegationGranted`/`DelegationRevoked` **ya están en el codec y en la máquina de estados** (`state-machine.ts:131`), pero son **inalcanzables**: el motor rechaza la delegación. |
| **3** | **OpenTimestamps contra un calendario real** | `packages/anchor/src/ots/` | La **verificación** está completa y probada, pero **`httpCalendar()` (`ots/calendar.ts:55`) nunca se ha ejecutado contra `a.pool.opentimestamps.org`**. Hay que correrlo **una vez** y contrastar el `.ots` con el cliente oficial `ots verify`. Faltan **reintentos con backoff** y **envío a varios calendarios**. |
| **4** | **`GitForgeClient` sin implementar** | `packages/anchor/src/providers/signed-git.ts:72` | Faltan los clientes de **Codeberg** y **GitHub**. Y, sobre todo, **comprobar que las dos forjas devuelven el MISMO objeto**: ahí es donde se detecta un `push --force` en una sola. El propio fichero lo marca (`:162` «VERIFICAR: `GitForgeClient` no tiene implementación real»). |
| **5** | **Transporte de correo** | `packages/anchor/src/providers/witness-email.ts` | Falta **SMTP con DKIM**, gestión de **rebotes** y **recogida por IMAP**. Lo que sostiene la garantía —**verificar los acuses firmados**— **sí está**. |
| **6** | **Evaluación y aprendizaje** | `PRODUCT.md` §6 · ADR-0043–0045 · `03-deliberativa-sistemas-antipatrones.md` | **Seguimiento integrado:** iniciativa atómica, ratificación, hitos, consentimiento de tareas, capacidad privada, inicio, pausas, ayuda, evidencia restringida, entrega y revisión append-only. **Falta el cierre:** contrastar criterios congelados, registrar resultado real y aprendizajes recuperables; ni una votación ni completar tareas declaran éxito por sí solos. ⚠ **Corrección:** el corte anterior reservaba «ADR-0046» para esto. **ADR-0046 acabó siendo la deliberación por etapas**, así que esta tarea sigue abierta y **sin número de ADR asignado**. |
| ~~**7**~~ | ~~**Consenso tipo Pol.is**~~ | `01-decidim-loomio-polis.md` · ADR-0038 | **HECHO A MEDIAS el 2026-08-22 (ADR-0048).** El cálculo existe en `packages/consensus` con 65 pruebas y determinismo demostrado frente a permutar participantes. **Lo que falta está en la tarea 15:** cinco divergencias con ADR-0038, dos de ellas funcionales, y ninguna conexión con el ledger. |
| **8** | **Asistente de acción sistémica** | `03-deliberativa-sistemas-antipatrones.md` §3.1 | Las **27 preguntas literales** del formulario de teoría del cambio **ya están redactadas** (`:85-125`), con la frase de cierre generada. Sólo dos preguntas son obligatorias (1 y 11). **NO EMPEZADO.** |
| **9** | **Tests propios de `packages/contracts`** | — | **COMPLETADO y mantenido:** 16 pruebas de esquemas y conversión temporal. Ampliarlos con cada contrato nuevo. |
| **10** | **Decidir qué se hace con `checkpoint.firm`** | `0001_governance_ledger.sql:210` | Es **una columna que no puede ser verdad**: (a) es redundante con el quórum calculado sobre los recibos, (b) **puede contradecirlo en silencio**, y (c) el rol `koinonia_app` sólo tiene `SELECT, INSERT` sobre `governance.checkpoint` (`0003_roles_and_grants.sql:43`), así que **nunca puede ponerse a `true`**. Lo autoritativo es el evento **`AnclajeEstadoPublicado`** (`packages/anchor/src/events.ts:25`). Decisión pendiente: eliminarla o documentarla como no autoritativa. |
| **11** | **Mutation testing con Stryker** | `TESTING.md` §10 | Umbrales **definidos**, **nunca ejecutado**. Nota de la propia spec: en `contracts` casi todo son tipos, que Stryker no muta. |
| **12** | **WebKit / Safari móvil** | §2.4 de este documento | ⚠ **El consejo de Playwright (`apt-get install libicu74 …`) no aplica en esta máquina**: es **CachyOS/Arch**, sin `apt-get`, y `sudo` pide contraseña. Salidas reales: **(a)** correrlo en **CI**, donde `playwright install --with-deps` ya está configurado (`.github/workflows/ci.yml:111`); **(b)** un contenedor Ubuntu; **(c)** en Arch, los equivalentes son `icu`/`libxml2`/`flite`/`libmanette`, pero harían falta las versiones **antiguas** (ICU **74**, `libxml2.so.2`) que Arch ya no distribuye — probablemente vía AUR. **La opción (a) es la sensata.** |
| **13** | **Métricas de salud democrática** | `03-deliberativa-sistemas-antipatrones.md` §6 | Las **cinco** definidas: tasa de cumplimiento de acuerdos y **deuda de acuerdos**; **HHI** de concentración de voz; **cobertura del padrón desagregada por estrato**; **rotación del núcleo activo**; **razón deliberación/votación**. **Ninguna implementada.** ⚠ **Ninguna mide «engagement», deliberadamente** (ver ADR-0040: prohibición de métricas de actividad individual). |
| **14** | **Volcar al registro los hallazgos de `api`, `anchor` y `verifier-cli`** | `00-contradicciones-resueltas.md` parte 3 | **Abierta a medias.** La ronda de escrutinio y consenso ya está volcada (E24–E35 y B1–B3, y el acumulado corregido a 31 errores de spec). **Siguen sin ficha `E-NN`** los cuatro hallazgos de §5.2-5.3 posteriores a `domain`. Además, `TESTING.md` §Principio rector conserva la cifra «unos 20» y la tabla de `MODEL_CONTEXT.md` §3 conserva conteos históricos (crypto 116, domain 229) que hoy son 108 y 481. |
| **15** | **Cerrar las cinco divergencias entre `packages/consensus` y ADR-0038** | ADR-0048 §«Divergencias» · ADR-0038 | Tres son de implementación (imputación por la media en vez de factorización enmascarada; `k` hasta 12 y no hasta 5; sin histéresis). **Dos son funcionales y bloquean el uso:** no existe el **umbral de no-facción** (silueta < ~0,25 ⇒ `FaccionesNoDetectadas`), que es lo que la pantalla «Consenso» promete como resultado posible, ni el **filtro `z₁ > 1,2816`** sobre las afirmaciones puente. Además **nada conecta el paquete con el ledger**: no hay snapshot, ni hash de entrada, ni `AgendaDeConsensoCongelada`. **Hasta cerrarlo, la salida no se presenta a la asamblea.** |
| **16** | **Revisión adversarial del esquema de seudónimo de ADR-0046** | ADR-0046 §«El hueco declarado» | **No ejecutada.** Los intentos del 2026-08-22 cayeron por timeout de transporte y **no se atribuye ningún resultado a ellos**. El esquema fue atacado con éxito por el mismo agente que lo implementó —de ahí salió el párrafo del administrador—, pero eso **no es revisión independiente**. Es la tarea de mayor prioridad de las que deja la sesión, porque el ADR está aceptado con un hueco declarado y sin escrutinio externo. |
| **17** | **Las siete pantallas que faltan** | `PRODUCT.md` §4 | El producto define **14 pantallas** y hoy existen **7**: inicio, problemas, propuestas, decisiones, iniciativas, mis tareas y verificar (15 ficheros `page.tsx`, contando detalle y creación, más el proxy). **Faltan: deliberaciones, consenso, círculos y comisiones, reuniones, normas, delegaciones e historial.** Las dos primeras dejan sin interfaz los dos agregados que se acaban de construir, de modo que hoy sólo son alcanzables desde el dominio. |
| **18** | **La constitución digital versionada** | `GOVERNANCE.md` §6 | **Diseñada y sin una línea de código.** «Las reglas son datos versionados»: convierte las normas del colectivo en objetos con su decisión de origen, su fecha de revisión y su procedimiento de reforma —incluido el problema del arranque, que §6 ya resuelve—. De ella cuelga la pantalla «Normas» de la tarea 17. |

---

## 8. Reglas de orquestación aprendidas

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

## 9. Transporte de delegación — historia del fallo y diagnóstico vigente

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
llamada**, y la tarea 16 de §7 la deja explícitamente abierta.

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

## 10. Cómo arrancar la próxima sesión

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

   **Confirmar `Tests 1006 passed (1006)` en `77` ficheros.** Si no da 1 006 en verde, **el primer
   trabajo es averiguar por qué**, no seguir adelante. La variable `KOINONIA_REQUIRE_DOCKER=1` es
   obligatoria: sin ella, la ausencia de Docker se convierte en una suite saltada y en un verde que
   no probó nada.

4. **Comprobar el estado de git antes que nada más.** Esta actualización se escribió con la
   prohibición de tocar git mientras otro agente commiteaba: **rama, commit y limpieza del árbol no
   están verificados** (§0 y §2.1). Y **sigue sin haber remoto configurado**, que es el riesgo de
   custodia más grave del proyecto.

5. **Sólo entonces**, elegir entre las dos cosas que la sesión del 2026-08-22 dejó más urgentes:
   la **tarea 16** —revisión adversarial independiente del esquema de seudónimo de ADR-0046, que está
   aceptado con un hueco declarado y sin escrutinio externo— o la **tarea 15** —cerrar las dos
   divergencias funcionales entre `packages/consensus` y ADR-0038, sin las cuales la salida del
   análisis no puede presentarse a la asamblea—.

Antes de delegar cualquier cosa: leer `docs/MODEL_CONTEXT.md` §1 —los **siete campos** obligatorios de
toda delegación—, su **§8** (registro de ruteo del 2026-08-22, con las tres reglas nuevas) y §8 de
este documento.

---

## 11. Correcciones históricas aplicadas a los datos de partida

Para trazabilidad: seis datos del dictado con el que se redactó este handoff **no coincidían con el
repositorio** y aquí figuran ya corregidos. Esta tabla conserva la comparación del corte anterior;
**no es el contador vigente**, que está en §2 y se resume debajo.

| # | Dato dictado | Valor verificado | Comprobación |
|---|---|---|---|
| 1 | E2E: «**84 pasan** de verdad» | **100 passed · 10 failed · 30 did not run** (de 140) | `pnpm e2e:matriz`. Los 84 son chromium+firefox+chrome-movil completos; se suman **16** de webkit/safari-movil que sólo llaman a la API y no abren navegador. |
| 2 | «~**28 errores** reales en especificaciones» | El registro documenta **25 entradas**, de ellas **20 errores dentro de spec**. Con las rondas 3-4 sin volcar, ≈ **29 hallazgos** / ≈ 23 de spec | Tabla «El dato acumulado» de `00-contradicciones-resueltas.md:1122`. Los 3 peores citados (RULE, `ORDER BY tree_size`, `count=max+1`) **no tienen ficha `E-NN`** → tarea 14 de §7. |
| 3 | Los dos tests emparejados están «en **`packages/anchor`**» | Están en **`packages/verifier-cli/test/ataques.test.ts:310` y `:318`** | Además, sin anclajes el verificador **no calla**: emite `SIN_ANCLAJE` y sale **ámbar**, nunca verde. Matiz recogido en §6. |
| 4 | `apps/web`: «**14 rutas**» | **12** ficheros `page.tsx` **+ 1** route handler proxy (`app/api/[...ruta]/route.ts`) = **13** entradas de enrutado | `find apps/web/app`. |
| 5 | WebKit: instalar «`libicu74 libxml2 libflite1 libmanette-0.2-0`» | Son los **nombres Debian** que sugiere Playwright, **no instalables aquí**: el sistema es **CachyOS/Arch**, sin `apt-get` (`--with-deps` aborta con `spawn apt-get ENOENT`) y `sudo` pide contraseña | `/etc/os-release`; `ldd` sobre `webkit-2336` da los sonames reales (§2.4). Salida sensata: **CI**. |
| 6 | `packages/domain`: «**40 propiedades** fast-check» | **60** `fc.property`/`fc.asyncProperty` | El 40 procede de `MODEL_CONTEXT.md` §3, escrito cuando `domain` tenía 229 pruebas (hoy 255). La semilla `30_000_821` **sí** es exacta. **Corregido el 2026-08-22:** esta fila decía **44** y contradecía el **60** de §2.3 y del resumen de abajo. El recuento real es **60** (13 síncronas + 47 asíncronas), luego el valor equivocado era el 44 de esta fila; §2.3 era correcto. |

**Estado vigente tras ADR-0048** (medido el 2026-08-22): **1 006 tests en 77 ficheros**, incluidos
**161** contra PostgreSQL 16 real; desglose por paquete
(**108 / 481 / 80 / 34 / 24 / 65 / 53 + 161**); **9 proyectos** en el workspace; **48 ADR + README**;
migraciones **0001–0010**, sin cambios; **102** llamadas `fc.property`/`fc.asyncProperty` en dominio y
**11** en consenso; **15** páginas Next más el proxy —**7 de las 14 pantallas** que define el
producto—; licencia **AGPL-3.0-or-later**. Siguen vigentes la compuerta C6, las 27 preguntas, la
fórmula GIC y las cinco métricas definidas. **Rama, commit y limpieza del árbol: sin verificar**
(§0).

Las cifras E2E de §2.4 son del corte del 2026-08-21 y no se re-midieron; nada de lo añadido hoy tiene
cobertura E2E, porque nada de lo añadido hoy tiene interfaz.
