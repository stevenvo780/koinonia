# Handoff de sesión — Koinonía

> **Fecha:** 2026-08-21 · **Destinatario:** la próxima sesión de trabajo, que no vio nada de lo
> anterior.
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

Todo lo verificable se comprobó contra el repositorio el 2026-08-21 antes de escribir y se volvió a
actualizar después de integrar ADR-0043. Las cifras de pruebas y rutas de esta sección sustituyen las
del corte anterior. Lo que no se pudo verificar se marca explícitamente como *no verificado*.

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

| Dato | Valor verificado |
|---|---|
| Rama | `main` |
| Último commit funcional | `5e93f44` — *Vincula decisiones aprobadas con iniciativas atómicas* |
| Árbol de trabajo | Limpio (`git status --porcelain` sin salida) |
| Gestor de paquetes | `pnpm@11.20.0` · Node `>=22` |
| Licencia | AGPL-3.0-or-later |

Últimos commits relevantes (nueve en total):

```
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

### 2.2 Resultado real de los comandos (ejecutados el 2026-08-21)

| Comando | Resultado | Detalle |
|---|---|---|
| `pnpm build` | **verde** (código de salida 0) | `tsc --build`, sin diagnósticos |
| `pnpm typecheck` | **verde** | `tsconfig.check.json` + `contracts`/`api` + `tests/e2e` |
| `pnpm lint` | **verde** | ESLint + Prettier (`All matched files use Prettier code style!`) + `check-domain-purity.mjs` (`Pureza del dominio: correcta`) |
| `pnpm test` | **verde** | `Test Files 47 passed (47)` · `Tests 646 passed (646)` · 5,30 s; integración real contra PostgreSQL disponible |
| `pnpm e2e` (solo chromium) | **verde** | `31 passed (24.6s)` |
| Firefox + Chrome móvil | **verde** | `62 passed (45.8s)`; 31 por proyecto |
| WebKit / Safari móvil | **bloqueo de host conocido** | El navegador no arranca por librerías ausentes — ver §2.4; no se silenció |

Los **122 tests de integración corrieron de verdad contra PostgreSQL 16**: con
`KOINONIA_REQUIRE_DOCKER=1`, si Testcontainers no puede levantar Docker el arnés **lanza** en vez de
saltarse la suite (`tests/integration/helpers/ledger-env.ts:81`). Un verde con esa variable puesta no
puede ser un verde vacío. La imagen es `postgres:16-alpine`.

### 2.3 Desglose por paquete (verificado uno por uno)

| Paquete | Tests | Qué contiene |
|---|---:|---|
| `packages/crypto` | **108** | Canonicalización JCS (RFC 8785), SHA-256 sobre WebCrypto, cadena de hashes por agregado, Merkle RFC 6962 con pruebas de inclusión y de consistencia. Sin dependencias de runtime. |
| `packages/domain` | **279** | `DecisionEngine` puro y agregados de trabajo: añade plan de ejecución versionado, iniciativa enlazada e invariantes de borrador/configuración. Propiedades con fast-check y semillas fijas. |
| `packages/anchor` | **80** | `AnchorProvider` enchufable, OpenTimestamps (clase `blockchain`), git firmado con SSH —no GPG— (clase `vcs`), correo a testigos (clase `human-witness`), política de quórum **2 de 3 clases de independencia**. |
| `packages/verifier-cli` | **33** | Verificador independiente, en español, que **no depende de nuestro servidor**. Aquí viven los tests de ataque (§6). |
| `packages/contracts` | **6** | Esquemas Zod compartidos, incluida la frontera de planes e iniciativas. |
| `services/api` | **18** unitarios **+ 122** de integración | Event store append-only, replay idempotente por lote canónico, commits multiagregado, auditoría bidireccional, HTTP con Fastify + Zod y enlace mágico. |
| `apps/web` | vía E2E | Next.js PWA. Sin suite unitaria propia, por decisión (`TESTING.md` §1). |
| | **646** | **en 47 ficheros** |

`packages/domain` declara **44** propiedades `fc.property`, repartidas sobre todo en
`test/props/invariants.test.ts` (28) y `test/props/log-invariants.test.ts` (6).

### 2.4 Extremo a extremo

**31 escenarios** en `tests/e2e/` (`01-gobernanza` 1, `02-versionado` 1, `03-permisos` 9,
`04-accesibilidad` 15, `05-inmutabilidad` 5) × **5 proyectos** Playwright = 155 ejecuciones.

Resultado actual verificable: **chromium, firefox y chrome-movil pasan los 31 cada uno (93)**. La
matriz de cinco proyectos no se volvió a presentar como una cifra verde: en **webkit** y
**safari-movil** el proceso del navegador sigue sin arrancar. La última corrida completa anterior,
con 30 escenarios, dejó `106 passed · 10 failed · 34 did not run`; añadir un escenario no convierte
ese bloqueo de infraestructura en un resultado nuevo, por lo que no se inventa un total actualizado.

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

`services/api/migrations/`, seis, todas aplicadas por `migrate()`:

| Fichero | Contenido |
|---|---|
| `0001_governance_ledger.sql` | Tablas `governance.event`, `governance.checkpoint` |
| `0002_append_only_guard.sql` | Trigger `ENABLE ALWAYS` de blindaje append-only |
| `0003_roles_and_grants.sql` | `koinonia_ddl` / `koinonia_app`; el rol de la aplicación sólo tiene `SELECT, INSERT` |
| `0004_projection.sql` | Proyecciones de lectura |
| `0005_identidad.sql` | PII Vault e identidad |
| `0006_anclaje.sql` | `anchor_attempt`, recibos, sellos |

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
| `docs/adr/` | **43 ADR** (`0001`–`0043`) **+ `README.md`** de índice. 44 ficheros en total. |
| `docs/research/30-decision-engine-spec.md` | Especificación del motor de decisiones. La única pieza de `research/` con rango normativo. ~2 600 líneas, 60 invariantes (`INV-01`–`INV-60`), 7 anti-invariantes. |
| `docs/PRODUCT.md` | Producto y alcance funcional. §6 diseña ejecución y seguimiento. |
| `docs/ARCHITECTURE.md` | Arquitectura del sistema. |
| `docs/TESTING.md` | Estrategia de pruebas. Normativa para lo que se considera «terminado». |
| `docs/MODEL_CONTEXT.md` | Qué contexto recibe un agente al que se delega, y registro de delegaciones. |

`docs/research/` (insumo, salvo el 30):

| Fichero | Tema |
|---|---|
| `00-contradicciones-resueltas.md` | **Registro del proceso**: resoluciones R1–R3, contradicciones C4–C20, errores de implementación E1–E23. Es el documento a leer para entender *por qué* algo es como es. |
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

| | Spec 10 (`crypto`) | Spec 30 (`domain`) | Total |
|---|---:|---:|---:|
| Errores **dentro de la especificación** | 6 (E1–E6) | 14 (E10–E23) | **20** |
| Incoherencias entre ADR y specs | 2 (E7, E8) | — | 2 |
| Hallazgos derivados al propagar | 2 (E1′, E1″) | — | 2 |
| Divergencias elevadas sin cerrar | 1 (E9) | — | 1 |
| **Entradas registradas** | 11 | 14 | **25** |

⚠ **El registro está desactualizado.** Se cerró tras la segunda ronda (`domain`). Las rondas de
`services/api`, `packages/anchor` y `packages/verifier-cli` produjeron **al menos cuatro hallazgos
más** —los tres de §5.2 puntos 2-4 y el bug del verificador de §5.3— que **sólo viven en comentarios
de código y en nombres de test**, y no tienen ficha `E-NN`. Total real ≈ **29 hallazgos**, de los
cuales ≈ 23 son errores de especificación. **Volcarlos al registro es trabajo pendiente** (§7,
tarea 14).

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
| **1** | **Métodos de escrutinio restantes**: score voting, IRV, Majority Judgment (Balinski-Laraki), Condorcet/Schulze, sorteo estratificado verificable | `30-decision-engine-spec.md` **PARTE B.5–B.9** | Invariantes ya escritos y **sin implementar**: `INV-42..51`, `INV-55..57`. ⚠ Incluye el **anti-invariante de no-monotonía de IRV**: el test debe **excluirlo por escrito**, con nombre y razón, **no ignorarlo en silencio** (`TESTING.md` §«El caso de IRV»). Meter IRV en la propiedad general y «arreglar» el motor hasta el verde introduciría un bug real. |
| **2** | **Democracia líquida** | `30-...` **PARTE C**, `INV-23..30` | Delegación temática, revocable; voto directo que anula; detección de ciclos; límite de profundidad; cap de concentración; índice HHI. **El punto de extensión ya existe** en el dominio y los eventos `DelegationGranted`/`DelegationRevoked` **ya están en el codec y en la máquina de estados** (`state-machine.ts:131`), pero son **inalcanzables**: el motor rechaza la delegación. |
| **3** | **OpenTimestamps contra un calendario real** | `packages/anchor/src/ots/` | La **verificación** está completa y probada, pero **`httpCalendar()` (`ots/calendar.ts:55`) nunca se ha ejecutado contra `a.pool.opentimestamps.org`**. Hay que correrlo **una vez** y contrastar el `.ots` con el cliente oficial `ots verify`. Faltan **reintentos con backoff** y **envío a varios calendarios**. |
| **4** | **`GitForgeClient` sin implementar** | `packages/anchor/src/providers/signed-git.ts:72` | Faltan los clientes de **Codeberg** y **GitHub**. Y, sobre todo, **comprobar que las dos forjas devuelven el MISMO objeto**: ahí es donde se detecta un `push --force` en una sola. El propio fichero lo marca (`:162` «VERIFICAR: `GitForgeClient` no tiene implementación real»). |
| **5** | **Transporte de correo** | `packages/anchor/src/providers/witness-email.ts` | Falta **SMTP con DKIM**, gestión de **rebotes** y **recogida por IMAP**. Lo que sostiene la garantía —**verificar los acuses firmados**— **sí está**. |
| **6** | **Ejecución y seguimiento** | `PRODUCT.md` §6 · ADR-0043 · `02-sociocracia-ostrom.md` | **Primer tramo integrado:** cada versión congela objetivo, responsabilidad aceptada, revisión y criterios; un resultado aprobado crea exactamente una iniciativa en el mismo commit y el auditor verifica los vínculos. **Siguiente:** ratificación/activación, hitos, oferta y aceptación/rechazo de tareas, bloqueos, evidencias y seguimiento gradual, sin gamificación tóxica. |
| **7** | **Consenso tipo Pol.is** | `01-decidim-loomio-polis.md` | Matriz participantes × afirmaciones, **PCA + k-means**, afirmaciones puente con `GIC(c) = ∏ p̂_a(g,c)` (fórmula literal en `:140`). **NO EMPEZADO.** |
| **8** | **Asistente de acción sistémica** | `03-deliberativa-sistemas-antipatrones.md` §3.1 | Las **27 preguntas literales** del formulario de teoría del cambio **ya están redactadas** (`:85-125`), con la frase de cierre generada. Sólo dos preguntas son obligatorias (1 y 11). **NO EMPEZADO.** |
| **9** | **Tests propios de `packages/contracts`** | — | **COMPLETADO en ADR-0043:** 6 pruebas de esquemas. Ampliarlos con cada contrato nuevo. |
| **10** | **Decidir qué se hace con `checkpoint.firm`** | `0001_governance_ledger.sql:210` | Es **una columna que no puede ser verdad**: (a) es redundante con el quórum calculado sobre los recibos, (b) **puede contradecirlo en silencio**, y (c) el rol `koinonia_app` sólo tiene `SELECT, INSERT` sobre `governance.checkpoint` (`0003_roles_and_grants.sql:43`), así que **nunca puede ponerse a `true`**. Lo autoritativo es el evento **`AnclajeEstadoPublicado`** (`packages/anchor/src/events.ts:25`). Decisión pendiente: eliminarla o documentarla como no autoritativa. |
| **11** | **Mutation testing con Stryker** | `TESTING.md` §10 | Umbrales **definidos**, **nunca ejecutado**. Nota de la propia spec: en `contracts` casi todo son tipos, que Stryker no muta. |
| **12** | **WebKit / Safari móvil** | §2.4 de este documento | ⚠ **El consejo de Playwright (`apt-get install libicu74 …`) no aplica en esta máquina**: es **CachyOS/Arch**, sin `apt-get`, y `sudo` pide contraseña. Salidas reales: **(a)** correrlo en **CI**, donde `playwright install --with-deps` ya está configurado (`.github/workflows/ci.yml:111`); **(b)** un contenedor Ubuntu; **(c)** en Arch, los equivalentes son `icu`/`libxml2`/`flite`/`libmanette`, pero harían falta las versiones **antiguas** (ICU **74**, `libxml2.so.2`) que Arch ya no distribuye — probablemente vía AUR. **La opción (a) es la sensata.** |
| **13** | **Métricas de salud democrática** | `03-deliberativa-sistemas-antipatrones.md` §6 | Las **cinco** definidas: tasa de cumplimiento de acuerdos y **deuda de acuerdos**; **HHI** de concentración de voz; **cobertura del padrón desagregada por estrato**; **rotación del núcleo activo**; **razón deliberación/votación**. **Ninguna implementada.** ⚠ **Ninguna mide «engagement», deliberadamente** (ver ADR-0040: prohibición de métricas de actividad individual). |
| **14** | **Volcar al registro los hallazgos de las rondas 3 y 4** | `00-contradicciones-resueltas.md` parte 3 | Los cuatro hallazgos de §5.2-5.3 posteriores a `domain` **no tienen ficha `E-NN`**. Además, la cifra «unos 20» de ese documento y de `TESTING.md` §Principio rector quedó corta, y la tabla de `MODEL_CONTEXT.md` §3 conserva conteos históricos (crypto 116, domain 229) que hoy son 108 y 255. |

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

---

## 9. INFRAESTRUCTURA ROTA — corregir antes de continuar

**Esta sección es la razón por la que se interrumpió la sesión.**

### `delegar_a_cloud` (MCP `cloud-offload`) es hoy inservible para trabajo real

| Proveedor | Fallo observado |
|---|---|
| `codex/gpt-5.6-sol`, `codex/gpt-5.6-terra` | **`invalid ID token format`** — es la **autenticación del CLI de Codex**, que está rota. **Hay que re-autenticar el CLI.** |
| `gemini/pro`, `gemini/flash`, `minimax/MiniMax-M3` | **`MCP error -32001: Request timed out`** en todo lo que no sea trivial. |

**Dato empírico del umbral.** La **única** llamada que completó fue a `minimax/MiniMax-M3` con una
salida de **~15 líneas** (crear un esqueleto de directorios). **Todo lo que pedía ≥600 palabras de
generación reventó, incluso troceado.** Se probó a **2800**, a **2000** y a **600-900** palabras: los
tres fallaron.

**El trabajo NO sobrevive al timeout.** Comprobado: tras un timeout se **inspeccionó el disco** y **no
había quedado nada escrito**. El proceso **no continúa en background**.

**Dato útil para el arreglo.** Los CLIs delegados **sí tienen herramientas reales de `bash` y
`write`** — la llamada que funcionó **creó directorios y ficheros en disco**. Es decir: el patrón
«**escribí el resultado a disco y devolveme 5 líneas**» **es viable y ahorraría contexto**, **pero no
salva el timeout**, porque el timeout cubre la llamada entera **incluida la generación**.

**Lo que haría falta:**

1. **Timeout configurable y mucho más largo.**
2. Preferiblemente, **un modo asíncrono de lanzar-y-consultar**: que `delegar_a_cloud` devuelva un
   **identificador de trabajo inmediatamente**, que el proceso **siga corriendo y escribiendo a
   disco aunque el cliente MCP abandone**, y que exista **una segunda herramienta** para consultar
   el estado y recoger el resultado.

### Consecuencia real sobre esta sesión

El plan de ruteo declarado al inicio —**`gemini/pro`** para investigación de contexto largo,
**`codex/sol` con `effort: high`** para la criptografía, **`codex/terra`** para la teoría de la
elección social, **`gemini/flash`** para la normativa— **no sobrevivió al contacto con la
infraestructura**. **Todo terminó ejecutándose en subagentes `task`.**

El **presupuesto abundante de MiniMax**, destinado a **QA exploratorio masivo** y a la **matriz de
navegadores**, quedó **sin usar por transporte, no por criterio**.

> **Cuando el transporte funcione, ese es el primer trabajo que debe irse a MiniMax.**

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

   **Confirmar `Tests 646 passed (646)` en `47` ficheros.** Si no da 646 en verde, **el primer
   trabajo es averiguar por qué**, no seguir adelante. La variable `KOINONIA_REQUIRE_DOCKER=1` es
   obligatoria: sin ella, la ausencia de Docker se convierte en una suite saltada y en un verde que
   no probó nada.

4. **Sólo entonces**, continuar la tarea 6 de §7: `DecisionRatified → InitiativeActivated → hito →
   tarea ofrecida → aceptación/rechazo`, con autorización horizontal en el dominio y commit atómico
   para ratificación/activación. El análisis read-only ya confirmó que la máquina de estados de
   decisión contiene `DecisionRatified`; falta exponer la orden y extender el agregado de iniciativa.

Antes de delegar cualquier cosa: leer `docs/MODEL_CONTEXT.md` §1 —los **siete campos** obligatorios de
toda delegación— y §8 de este documento.

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
| 6 | `packages/domain`: «**40 propiedades** fast-check» | **44** `fc.property` | El 40 procede de `MODEL_CONTEXT.md` §3, escrito cuando `domain` tenía 229 pruebas (hoy 255). La semilla `30_000_821` **sí** es exacta. |

**Estado vigente tras ADR-0043:** rama `main`; commit funcional `5e93f44`; **646 tests en 47
ficheros**, incluidos **122** contra PostgreSQL 16 real; desglose
(**108 / 279 / 80 / 33 / 6 / 18 + 122**); **43 ADR + README**; migraciones **0001–0006** sin una
migración nueva; **31 escenarios** E2E y 93 ejecuciones verdes en los tres proyectos que arrancan;
**50** propiedades `fc.property`/`fc.asyncProperty`; **14** páginas Next más el proxy; licencia
**AGPL-3.0-or-later**. Siguen vigentes la compuerta C6, las 27 preguntas, la fórmula GIC y las cinco
métricas definidas.
