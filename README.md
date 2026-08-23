# Koinonía

Plataforma de gobernanza colectiva del estudiantado del Instituto de Filosofía de la Universidad de
Antioquia. Software libre, ~300 personas, español, móvil primero.

> Koinonía **no es un órgano de la Universidad de Antioquia ni la representa.**

Se escribe un problema, se discute con plazo, se decide con una regla dicha de antemano, y queda una
constancia que **cualquiera puede recalcular por su cuenta sin confiar en quien administra el
servidor**. Ver `docs/PRODUCT.md` (qué es y para quién), `docs/GOVERNANCE.md` (quién decide qué y con
qué regla), `docs/ARCHITECTURE.md` (cómo encajan las piezas) y `docs/adr/` (por qué cada decisión
técnica es la que es).

Ese «sin confiar en quien administra el servidor» no es una figura retórica: el historial se ancla
fuera —Bitcoin vía OpenTimestamps, un commit firmado en dos forjas y testigos por correo, con
**quórum de 2 clases independientes de 3**— y hay un **verificador que se ejecuta por separado y no
habla con este servidor** (`packages/verifier-cli`). Cómo usarlo está más abajo, en
[«Comprobarlo sin confiar en nosotros»](#comprobarlo-sin-confiar-en-nosotros).

---

## Levantarlo

### Requisitos

- **Node 22** (está en `.nvmrc`) y **pnpm**. Con `corepack enable` basta.
- **Docker**, para PostgreSQL. Las pruebas de integración y las de extremo a extremo levantan su
  propio contenedor con Testcontainers; para desarrollo hay un `docker compose`.

### Cuatro pasos

```sh
# 1. Dependencias
pnpm install

# 2. PostgreSQL (puerto 55432, no 5432, para no chocar con el del sistema)
docker compose -f infra/docker/docker-compose.yml up -d

# 3. Compilar los paquetes que la interfaz y el servicio consumen
pnpm run build

# 4. Servicio + interfaz, juntos
pnpm run dev
```

Queda la interfaz en **http://localhost:3000** y el servicio en **http://localhost:3001**. Las
migraciones se aplican solas al arrancar el servicio: no hay un paso aparte que se pueda olvidar.

### Entrar

No hay contraseñas. Se pide un enlace al correo institucional en `/entrar`, con cualquier dirección
que termine en `@udea.edu.co`. **En desarrollo el enlace aparece en la propia pantalla** y también en
la consola, así que no hace falta un servidor de correo. **En un despliegue sí hace falta**, y sin él
nadie puede entrar: ver [Envío de correo](#envío-de-correo).

Para que una cuenta pueda **abrir y cerrar votaciones** —que es un encargo, no un derecho general—
hay que decirlo al arrancar:

```sh
KOINONIA_FACILITADORES=lucia@udea.edu.co pnpm run dev
```

### Variables de entorno

| Variable                    | Para qué                                                                          | Por defecto                                               |
| --------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`              | PostgreSQL, **con permisos de DDL**. Sólo para migrar: ver abajo                  | `postgresql://postgres:koinonia@localhost:55432/koinonia` |
| `PORT`                      | Puerto del servicio                                                               | `3001`                                                    |
| `PUERTO_WEB`                | Puerto de la interfaz                                                             | `3000`                                                    |
| `KOINONIA_FACILITADORES`    | Correos con el encargo de facilitación                                            | vacío                                                     |
| `KOINONIA_GARANTIAS`        | Correos del Círculo de Garantías                                                  | vacío                                                     |
| `KOINONIA_RATE_PEPPER`      | Secreto del control de abuso. **Obligatorio en producción**                       | uno de desarrollo                                         |
| `KOINONIA_WEB_URL`          | Base pública, para armar el enlace del correo                                     | `http://localhost:3000`                                   |
| `KOINONIA_API_URL`          | A dónde apunta el proxy de la interfaz                                            | `http://127.0.0.1:3001`                                   |
| `KOINONIA_VAULT_MASTER_KEY` | Clave maestra del material privado, base64 de 32 B. **Obligatoria en producción** | sin bóveda (el material privado no se puede abrir)        |

#### Dos conexiones a la base

La API **no se conecta como superusuario**. Usa dos conexiones distintas y las anuncia al arrancar:

- una **de migración**, con permisos de DDL, que aplica las migraciones y **se cierra en cuanto
  terminan** —un pool con permiso de `ALTER TABLE` abierto mientras el servicio atiende es una
  conexión esperando a que un bug la use—;
- una **de aplicación**, como `koinonia_app`, que sirve todas las peticiones. Sobre
  `governance.event` ese rol tiene exactamente `SELECT` e `INSERT`: ni `UPDATE`, ni `DELETE`, ni
  `TRUNCATE`, ni la propiedad de la tabla, así que tampoco puede apagar el trigger append-only.

Hasta la versión anterior había **un solo pool**: como la migración `0003` necesita crear roles, ese
pool era `postgres`, y la separación de privilegios que la `0003` describe existía en el esquema y no
estaba en vigor en ejecución. La comprobación no se hace mirando la cadena de conexión sino
preguntándole al catálogo quién es y qué puede: si la conexión de aplicación resulta ser superusuario
—o tener `UPDATE`/`DELETE`/`TRUNCATE` sobre `governance.event`—, **el arranque se niega**.

| Variable                          | Para qué                                                                                                     | Por defecto                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `KOINONIA_DATABASE_URL_APP`       | Conexión de la aplicación, como `koinonia_app`. **Obligatoria en producción**                                | vacío ⇒ ver abajo                               |
| `KOINONIA_DATABASE_URL_MIGRACION` | Conexión con permisos de DDL, sólo para migrar                                                               | `DATABASE_URL`                                  |
| `KOINONIA_DB_APP_PASSWORD`        | Si está, el arranque le fija esa contraseña a `koinonia_app` con la conexión de migración, antes de conectar | vacío ⇒ la contraseña ya tiene que estar puesta |

**Si falta `KOINONIA_DATABASE_URL_APP`, en producción el arranque falla** y dice qué falta; fuera de
producción avisa por `stderr` —con la línea que empieza por `⚠ Base de datos: SIN SEPARAR`— y sigue
con la conexión de migración, para que `pnpm run dev` funcione contra una base recién creada. Se
eligió fallar cerrado en producción porque este hueco fue exactamente un despliegue que nadie miró:
una defensa cuya activación dependa de que alguien lea una línea del registro ya falló una vez así.

La migración `0003` crea `koinonia_app` **sin contraseña** a propósito —una contraseña en un `.sql`
acaba en el repositorio, en el historial y en todo `pg_dump`—, así que en una base nueva hay que
ponérsela. Lo más corto es dejar que lo haga el arranque:

```sh
DATABASE_URL='postgresql://postgres:…@localhost:5432/koinonia'          # migra, y se cierra
KOINONIA_DATABASE_URL_APP='postgresql://koinonia_app:LA_CLAVE@localhost:5432/koinonia'
KOINONIA_DB_APP_PASSWORD='LA_CLAVE'                                      # opcional: la fija él
```

`KOINONIA_DB_APP_PASSWORD` y la contraseña de `KOINONIA_DATABASE_URL_APP` tienen que coincidir; si no,
el arranque se cae ahí y lo dice, en vez de fijar una y entrar con la otra y dejar un «autenticación
fallida» que apunta a cualquier sitio menos al de verdad. Ninguna de las dos aparece en el registro.

#### Envío de correo

**Sin esto no entra nadie.** No hay contraseñas: la única puerta es un enlace de un solo uso que
llega al buzón institucional. Sin un servidor SMTP configurado, la API responde `202` a cada
solicitud, no sale ni un correo, y el enlace se queda **impreso en el registro** —donde cualquiera
que lo lea puede tomar esa sesión durante los quince minutos que vive—. Es lo que hace falta en
desarrollo y es una avería en producción.

Basta `KOINONIA_SMTP_HOST` para pasar a mandar de verdad. El arranque escribe en la primera línea
por qué adaptador optó, y con qué servidor, puerto, cifrado y remitente; si es el de consola en
producción, o si el SMTP va sin cifrar, esa línea sale por `stderr`.

| Variable             | Para qué                                                                                                                | Por defecto                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `KOINONIA_SMTP_HOST` | Servidor de salida. **Presente ⇒ se manda de verdad; ausente ⇒ adaptador de consola**                                   | vacío ⇒ **no sale ningún correo**                   |
| `KOINONIA_SMTP_PORT` | Puerto TCP                                                                                                              | `587`, o `465` con TLS implícito, o `25` sin cifrar |
| `KOINONIA_SMTP_USER` | Usuario de `AUTH PLAIN`. Va junta con `_PASS` o no va                                                                   | vacío ⇒ sin autenticar                              |
| `KOINONIA_SMTP_PASS` | Contraseña de `AUTH PLAIN`                                                                                              | vacío ⇒ sin autenticar                              |
| `KOINONIA_SMTP_FROM` | Remitente: `Koinonía <koinonia@udea.edu.co>` o la dirección a secas. **Obligatoria si hay `_HOST`**                     | sin defecto: el arranque falla y lo dice            |
| `KOINONIA_SMTP_TLS`  | STARTTLS `sí`/`no`. Además admite `implicita` para los servidores que sólo escuchan en 465 con TLS desde el primer byte | `sí` (STARTTLS)                                     |

El `MAIL FROM` del sobre y el nombre del `EHLO` salen de `KOINONIA_SMTP_FROM`: la dirección para el
primero y su dominio para el segundo. Con `KOINONIA_SMTP_TLS=sí` (el defecto) un servidor que **no**
anuncie `STARTTLS` hace que el envío se **aborte**, no que se degrade a texto plano: degradar en
silencio es exactamente lo que quiere quien esté escuchando la red, porque el enlace de entrada
viajaría legible.

Un fallo de envío —destinatario rechazado, autenticación caída, servidor apagado— **no cambia la
respuesta HTTP**: queda registrado en `stderr` y la API sigue contestando lo mismo que contestaría si
hubiera salido. Es deliberado: la pantalla de entrada no revela quién tiene cuenta, y un `500` para
las direcciones inexistentes frente a un `202` para las buenas sería justo el oráculo que esa
propiedad existe para negar. Con SMTP configurado, **el registro no contiene el token ni el enlace**.

#### Anclaje externo (§8.4)

El anclaje corta un checkpoint, lo sella contra Bitcoin, contra dos forjas y contra un padrón de
testigos, y guarda las cabeceras de bloque que el verificador independiente necesita. **Por defecto
está encendido en producción y apagado fuera**: encenderlo en cada portátil pondría al equipo a
sellar contra los calendarios públicos, y apagarlo por defecto en producción sería peor —un
despliegue sin anclaje y sin que nadie se entere—.

Lo que no se configure **no se arranca a medias**: el proveedor se queda fuera y la tarea escribe por
qué al arrancar. Con sólo OpenTimestamps el veredicto no será firme, porque §8.2 pide dos clases de
independencia distintas, y eso se publica como evento en vez de disimularse.

| Variable                                             | Para qué                                                                                                                                    | Por defecto                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `KOINONIA_ANCLAJE`                                   | Enciende o apaga la tarea entera                                                                                                            | encendido si `NODE_ENV=production`                    |
| `KOINONIA_ANCLAJE_CHECKPOINT_MINUTOS`                | Cada cuánto se corta un checkpoint. `0` ⇒ no se emiten desde aquí                                                                           | `60`                                                  |
| `KOINONIA_ANCLAJE_POLL_MINUTOS`                      | Cada cuánto se repasan los anclajes pendientes con `poll`                                                                                   | `60`                                                  |
| `KOINONIA_ANCLAJE_PENDIENTES`                        | Cuántos checkpoints hacia atrás se siguen madurando                                                                                         | `24`                                                  |
| `KOINONIA_ANCLAJE_CALENDARIOS`                       | Calendarios OpenTimestamps, separados por comas                                                                                             | los cuatro públicos                                   |
| `KOINONIA_ANCLAJE_CALENDARIOS_MINIMO`                | Cuántos tienen que sellar para dar el envío por bueno                                                                                       | `1`                                                   |
| `KOINONIA_ANCLAJE_BLOQUES_URL`                       | API de bloques de Bitcoin, estilo Esplora. Con nodo propio, apuntá aquí                                                                     | `https://blockstream.info/api`                        |
| `KOINONIA_ANCLAJE_FIRMANTES`                         | Padrón de la veeduría: `identidad\|clave-base64`, entradas separadas por `;`. También acepta una línea de `allowed_signers` pegada tal cual | vacío ⇒ **sin anclaje de git**                        |
| `KOINONIA_ANCLAJE_CLAVE_FUERA_DEL_SERVIDOR`          | Declara que la clave de la veeduría **no** vive en esta máquina                                                                             | `no` ⇒ el anclaje de git **no cuenta para el quórum** |
| `KOINONIA_ANCLAJE_FORJAS`                            | Forjas donde debe estar el commit, separadas por comas                                                                                      | `codeberg,github`                                     |
| `KOINONIA_ANCLAJE_FORJAS_MINIMO`                     | Cuántas forjas bastan                                                                                                                       | todas las declaradas                                  |
| `KOINONIA_ANCLAJE_CODEBERG_REPO` / `_GITHUB_REPO`    | `propietario/repositorio` donde se empuja el commit firmado                                                                                 | vacío ⇒ nadie comprueba que esté publicado            |
| `KOINONIA_ANCLAJE_CODEBERG_RAMA` / `_GITHUB_RAMA`    | Rama de anclaje                                                                                                                             | `anclaje`                                             |
| `KOINONIA_ANCLAJE_CODEBERG_TOKEN` / `_GITHUB_TOKEN`  | Token de **sólo lectura**, para subir el límite de peticiones                                                                               | vacío                                                 |
| `KOINONIA_ANCLAJE_TESTIGOS`                          | Padrón de testigos: `id\|correo\|clave-base64`, entradas separadas por `;`. La clave puede ir vacía: ese testigo acusa pero no cuenta       | vacío ⇒ **sin anclaje de correo**                     |
| `KOINONIA_ANCLAJE_DOMINIOS_MINIMOS`                  | Cuántos dominios distintos hacen falta (§8.2)                                                                                               | `3`                                                   |
| `KOINONIA_ANCLAJE_DOMINIOS_PROPIOS`                  | Dominios de la casa: un testigo propio no es independiente                                                                                  | vacío                                                 |
| `KOINONIA_ANCLAJE_CORREO_FROM`                       | Cabecera `From` completa: `Anclaje Koinonía <anclaje@udea.edu.co>`                                                                          | vacío ⇒ **sin anclaje de correo**                     |
| `KOINONIA_ANCLAJE_CORREO_REMITENTE`                  | Remitente del sobre, a donde vuelven los rebotes                                                                                            | la dirección del `From`                               |
| `KOINONIA_ANCLAJE_CORREO_DOMINIO_ID`                 | Dominio de los `Message-ID`                                                                                                                 | `anclaje.koinonia`                                    |
| `KOINONIA_ANCLAJE_SMTP_HOST`                         | Servidor de salida                                                                                                                          | vacío ⇒ **sin anclaje de correo**                     |
| `KOINONIA_ANCLAJE_SMTP_PUERTO`                       | Puerto SMTP                                                                                                                                 | `587`                                                 |
| `KOINONIA_ANCLAJE_SMTP_TLS`                          | `implicita`, `starttls` o `ninguna`                                                                                                         | `starttls`                                            |
| `KOINONIA_ANCLAJE_SMTP_HELO`                         | Nombre con el que nos presentamos; debe resolver                                                                                            | `localhost`                                           |
| `KOINONIA_ANCLAJE_SMTP_USUARIO` / `_CLAVE`           | Credenciales SMTP. Van juntas o no van                                                                                                      | vacío                                                 |
| `KOINONIA_ANCLAJE_IMAP_HOST` / `_USUARIO` / `_CLAVE` | Buzón donde se recogen acuses y rebotes. Sin él, los correos salen pero **nadie recoge nada** y el anclaje no pasa de pendiente             | vacío                                                 |
| `KOINONIA_ANCLAJE_IMAP_PUERTO`                       | Puerto IMAP                                                                                                                                 | `993`                                                 |
| `KOINONIA_ANCLAJE_IMAP_TLS`                          | TLS desde el primer byte                                                                                                                    | `sí`                                                  |
| `KOINONIA_ANCLAJE_IMAP_BUZON`                        | Buzón a abrir                                                                                                                               | el que use `imap.ts`                                  |
| `KOINONIA_ANCLAJE_DKIM_DOMINIO` / `_SELECTOR`        | Firma DKIM de los correos a los testigos                                                                                                    | vacío ⇒ salen sin firmar                              |
| `KOINONIA_ANCLAJE_DKIM_CLAVE_FICHERO`                | **Ruta** al fichero de la clave privada. Nunca la clave: una clave privada en el entorno acaba en `docker inspect`                          | vacío                                                 |
| `KOINONIA_ANCLAJE_DKIM_ALGORITMO`                    | `rsa-sha256` o `ed25519-sha256`                                                                                                             | `rsa-sha256`                                          |

⚠ **El commit firmado sigue siendo manual, y no es un olvido.** `SignedGitProvider.submit()` no
firma porque no puede: la clave de la veeduría no está en el servidor, y ése es exactamente el
punto. Alguien de la veeduría firma en su equipo, empuja a las dos forjas, y la tarea lo recoge en
el siguiente repaso.

---

## Comandos

```sh
pnpm run typecheck   # tsc estricto sobre fuentes, pruebas y extremo a extremo
pnpm run lint        # eslint + prettier + pureza del dominio
pnpm run test        # vitest: unitarias, de propiedad y de integración contra PostgreSQL real
pnpm run e2e         # Playwright: el corte vertical por la interfaz
pnpm run build       # tsc --build con project references (los cinco paquetes)
pnpm run build:web   # la interfaz
pnpm run verify      # typecheck + lint + test
```

---

## Estructura

Cinco paquetes, un servicio y una interfaz:

| Ruta                    | Qué es                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/crypto`       | Canonicalización JCS (RFC 8785), SHA-256, cadena de eventos y árbol Merkle (RFC 6962). Sin dependencias de runtime.                                                                                                                                  |
| `packages/domain`       | Dominio puro: motor de decisiones, agregados de trabajo y **autorización**. Sin I/O, sin reloj, sin azar (ADR-0001).                                                                                                                                 |
| `packages/contracts`    | Los esquemas Zod de la frontera y el léxico de la interfaz. Una sola definición para servidor y cliente.                                                                                                                                             |
| `packages/anchor`       | **Anclaje externo**: `AnchorProvider` con tres implementaciones de clases de independencia distintas —OpenTimestamps sobre Bitcoin, commit firmado con SSH en dos forjas, testigos por correo— y la política de quórum **2 clases de 3** (ADR-0016). |
| `packages/verifier-cli` | **Verificador independiente** (`@koinonia/verificar`). Comprueba un paquete exportado **sin hablar con este servidor**, reimplementando los algoritmos por su cuenta.                                                                                |
| `services/api`          | Adaptadores: ledger sobre PostgreSQL, bóveda de identidad, anclaje, export y capa HTTP con Fastify. Lo único que hace I/O.                                                                                                                           |
| `apps/web`              | Interfaz: Next.js, móvil primero, español de Colombia, WCAG 2.2 AA.                                                                                                                                                                                  |
| `tests/integration`     | Contra PostgreSQL real, con Testcontainers.                                                                                                                                                                                                          |
| `tests/e2e`             | Playwright: el corte vertical por la interfaz y por la API.                                                                                                                                                                                          |
| `infra/docker`          | PostgreSQL de desarrollo.                                                                                                                                                                                                                            |
| `docs/`                 | Investigación, ADR, arquitectura, producto, gobernanza y estrategia de pruebas.                                                                                                                                                                      |

El orden de dependencia es total y sin ciclos, con **dos ramas deliberadamente separadas** que sólo
comparten la hoja `crypto`:

```
crypto ← domain ← contracts ← { services/api, apps/web }
crypto ← anchor ← verifier-cli
```

El verificador no conoce las reglas de decisión y no importa nada de `services/api`: los algoritmos
del ledger están **reimplementados** en él, y que las dos implementaciones coincidan es parte de la
prueba. `services/api` sí depende de `verifier-cli`, pero **sólo para el formato del export**: el
contrato del fichero lo define quien lo va a leer.

La dirección de dependencia la verifica CI (`scripts/check-domain-purity.mjs`), no la revisión de
código.

### Migraciones

SQL plano numerado en `services/api/migrations/`, aplicado en orden por un runner propio
(`services/api/src/db/migrate.ts`) que **registra el hash de cada fichero**: editar una migración ya
aplicada deja de ser invisible. Dos ficheros con el mismo número son un error duro, no un
desempate arbitrario, porque el orden tiene que ser total.

| Migración                   | Qué crea                                                                     |
| --------------------------- | ---------------------------------------------------------------------------- |
| `0001_governance_ledger`    | `governance`: eventos, cabezas de agregado, cursor, checkpoints.             |
| `0002_append_only_guard`    | El trigger `ENABLE ALWAYS` que rechaza `UPDATE`, `DELETE` y `TRUNCATE`.      |
| `0003_roles_and_grants`     | `koinonia_ddl` y `koinonia_app`, con la asimetría de privilegios.            |
| `0004_projection`           | Proyecciones desechables con offset transaccional.                           |
| `0005_identidad`            | `identity`: bóveda de datos personales, **físicamente separada** (ADR-0008). |
| `0006_anclaje`              | `governance.anchor_attempt` y `governance.bitcoin_header`.                   |
| `0007_append_request_scope` | Separa claves de idempotencia públicas de consecuencias internas atómicas.   |

---

## Tres cosas que conviene saber antes de tocar el código

### 1. La autorización vive en el dominio, no en la ruta

El fallo más repetido del software de gobernanza es poner la comprobación en un `preHandler`: la
ruta queda protegida, y seis meses después alguien añade otra ruta y se olvida. Aquí ninguna orden
del dominio construye un evento sin llamar antes a `authorize` (`packages/domain/src/access.ts`), y
las comprobaciones **horizontales** —que un miembro no toque el recurso de otro miembro con su mismo
rol— se comprueban además **en el replay**, que es el único sitio por el que pasa todo log venga de
donde venga. Saltarse la interfaz no sirve; `tests/e2e/03-permisos.spec.ts` lo hace a propósito.

### 2. No se registran direcciones IP

Ni en el historial, ni en la bóveda de identidad, ni en los registros del servidor. En una comunidad
de 300 personas que se conectan desde la misma facultad, una IP con marca temporal es un dato de
ubicación de una persona identificable, y este sistema existe para que la gente pueda objetar sin
miedo. El control de abuso usa un contador por sujeto con **pimienta rotada a diario**
(`services/api/src/http/rate-limit.ts`), que caduca solo y no se puede revertir.

### 3. El resultado es un dato derivado

Una decisión no guarda una conclusión: guarda los hechos. El resultado se **vuelve a calcular** desde
las respuestas cada vez que alguien lo pide, y si el número no coincide con el publicado, la decisión
entra en cuarentena y el hecho se publica. Un fallo de conteo tiene que ser una alarma pública, nunca
un fraude silencioso.

---

## Pruebas

### Integración: PostgreSQL real, cero dobles

`tests/integration/` corre contra PostgreSQL levantado con Testcontainers. No hay ni un mock de la
base: todo lo que esas pruebas comprueban es comportamiento de PostgreSQL —que `uuid` devuelve la
forma con guiones, que `jsonb` reordena las claves, que un trigger `ENABLE ALWAYS` sobrevive a
`session_replication_role`, que un `UPDATE … WHERE head_hash = $esperado` devuelve `rowCount = 0`
cuando pierde la carrera—, y un doble reproduciría exactamente aquello en lo que ya creíamos.

Si Docker no está disponible, las suites se **saltan** con el motivo escrito en el nombre del bloque,
para que quede en la salida y nadie confunda «no corrió» con «pasó». Para que sea un fallo y no un
salto —en CI lo es—:

```sh
KOINONIA_REQUIRE_DOCKER=1 pnpm test
```

### Extremo a extremo

```sh
pnpm run e2e                                         # Chromium
KOINONIA_MATRIZ=completa pnpm exec playwright test   # matriz completa
```

En un pull request corre **sólo Chromium**; en `main`, la matriz entera (Chromium, Firefox, WebKit,
Chrome móvil, Safari móvil). Está en `.github/workflows/ci.yml`.

WebKit —y por tanto también `safari-movil`, que lo usa— necesita librerías del sistema
(`libicu74`, `libxml2`, `libflite1`, `libmanette-0.2-0`) que Playwright instala con
`sudo pnpm exec playwright install-deps`. **Sin ellas el navegador se descarga pero no arranca**, y
lo que se ve es un aviso de dependencias del anfitrión, no un fallo del producto. Los proyectos
quedan configurados igualmente: se prefiere un fallo visible a una matriz recortada que nadie note.

---

## Comprobarlo sin confiar en nosotros

Todo lo anterior lo ejecuta quien administra el servidor. Esta parte, no.

`packages/verifier-cli` es un programa aparte que lee un **paquete exportado** y comprueba la
historia entera —canonicalización, cadena de resúmenes por expediente, contigüidad del índice
global, raíces de Merkle, continuidad entre sellos y los comprobantes de anclaje externo— **sin
hacer ni una petición de red**. Habla en castellano, no enseña un hash hasta el detalle final, y
lleva dentro `README-VERIFICACION.txt`, que describe el algoritmo completo en prosa para que
cualquiera lo reimplemente desde cero y no tenga que fiarse ni de este programa.

### 1. Producir el paquete

El paquete autocontenido lo arma `buildExport()` de `@koinonia/api`. Con el servicio ya levantado
(los cuatro pasos de arriba) y desde la raíz del repositorio:

```sh
cat > exportar.mjs <<'FIN'
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildExport, createPool } from '@koinonia/api';

const pool = createPool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://postgres:koinonia@localhost:55432/koinonia',
});
const cliente = await pool.connect();
try {
  const paquete = await buildExport(cliente, {
    generatedAt: new Date().toISOString(),
    // Padrón que viaja DENTRO del paquete. Prueba menos que uno obtenido por otro canal, y el
    // verificador lo dice: levanta el aviso RAIZ_DE_CONFIANZA_DEL_EXPORT cuando usa éste.
    trust: {
      gitSigners: [],
      witnesses: [],
      minDistinctDomains: 2,
      forges: ['codeberg', 'github'],
      gitSigningKeyOffHost: false,
    },
  });
  for (const [nombre, contenido] of paquete) {
    const ruta = join('export', nombre);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, contenido);
  }
  console.log(`${paquete.size} ficheros en export/`);
} finally {
  cliente.release();
  await pool.end();
}
FIN

node exportar.mjs
```

### 2. Comprobarlo

```sh
node packages/verifier-cli/dist/cli.js export            # tras `pnpm run build`
node packages/verifier-cli/dist/cli.js export --explicar # y que además explique cada paso
```

Publicado como paquete npm, la orden es `npx @koinonia/verificar <ruta-al-paquete>`, que es la que
va en el cartel de la asamblea. El padrón de firmantes **obtenido por otro canal** —que es el que
prueba de verdad— se pasa con `--confianza <fichero>`.

El **código de salida** es la conclusión, para poder encadenarlo:

| Código | Qué significa                                                  |
| ------ | -------------------------------------------------------------- |
| `0`    | VERDE: todo cuadra y el resumen está registrado fuera.         |
| `1`    | Error de uso (faltan argumentos, la ruta no existe).           |
| `2`    | El paquete no se puede leer o le faltan piezas.                |
| `3`    | ÁMBAR: íntegro por dentro, pero falta la confirmación externa. |
| `4`    | Un comprobante externo es falso o registra otra historia.      |
| `5`    | Los sellos periódicos no cuadran con la historia.              |
| `6`    | ROJO: la historia está manipulada por dentro.                  |

Un paquete recién generado sobre una base vacía sale **ÁMBAR**, y eso es correcto: sin sellos
anclados fuera, la coherencia interna la puede fabricar quien controla el servidor. El verificador
lo dice con esas palabras en vez de dar un verde que no se ha ganado.

---

## Licencia

AGPL-3.0-or-later. Es una plataforma de gobernanza autoalojable: si alguien la modifica y la
despliega como servicio, las modificaciones vuelven a la comunidad que la usa. Ver `LICENSE`.
