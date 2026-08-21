# Koinonía

Plataforma de gobernanza colectiva del estudiantado del Instituto de Filosofía de la Universidad de
Antioquia. Software libre, ~300 personas, español, móvil primero.

> Koinonía **no es un órgano de la Universidad de Antioquia ni la representa.**

Se escribe un problema, se discute con plazo, se decide con una regla dicha de antemano, y queda una
constancia que **cualquiera puede recalcular por su cuenta sin confiar en quien administra el
servidor**. Ver `docs/PRODUCT.md` (qué es y para quién), `docs/GOVERNANCE.md` (quién decide qué y con
qué regla) y `docs/adr/` (por qué cada decisión técnica es la que es).

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
la consola, así que no hace falta un servidor de correo.

Para que una cuenta pueda **abrir y cerrar votaciones** —que es un encargo, no un derecho general—
hay que decirlo al arrancar:

```sh
KOINONIA_FACILITADORES=lucia@udea.edu.co pnpm run dev
```

### Variables de entorno

| Variable                 | Para qué                                                    | Por defecto                                               |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`           | PostgreSQL                                                  | `postgresql://postgres:koinonia@localhost:55432/koinonia` |
| `PORT`                   | Puerto del servicio                                         | `3001`                                                    |
| `PUERTO_WEB`             | Puerto de la interfaz                                       | `3000`                                                    |
| `KOINONIA_FACILITADORES` | Correos con el encargo de facilitación                      | vacío                                                     |
| `KOINONIA_GARANTIAS`     | Correos del Círculo de Garantías                            | vacío                                                     |
| `KOINONIA_RATE_PEPPER`   | Secreto del control de abuso. **Obligatorio en producción** | uno de desarrollo                                         |
| `KOINONIA_WEB_URL`       | Base pública, para armar el enlace del correo               | `http://localhost:3000`                                   |
| `KOINONIA_API_URL`       | A dónde apunta el proxy de la interfaz                      | `http://127.0.0.1:3001`                                   |

---

## Comandos

```sh
pnpm run typecheck   # tsc estricto sobre fuentes, pruebas y extremo a extremo
pnpm run lint        # eslint + prettier + pureza del dominio
pnpm run test        # vitest: unitarias, de propiedad y de integración contra PostgreSQL real
pnpm run e2e         # Playwright: el corte vertical por la interfaz
pnpm run build       # tsc --build con project references
pnpm run build:web   # la interfaz
pnpm run verify      # typecheck + lint + test
```

---

## Estructura

| Ruta                 | Qué es                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/crypto`    | Canonicalización JCS, SHA-256, cadena de eventos y árbol Merkle. Sin dependencias de runtime.                        |
| `packages/domain`    | Dominio puro: motor de decisiones, agregados de trabajo y **autorización**. Sin I/O, sin reloj, sin azar (ADR-0001). |
| `packages/contracts` | Los esquemas Zod de la frontera y el léxico de la interfaz. Una sola definición para servidor y cliente.             |
| `services/api`       | Adaptadores: ledger sobre PostgreSQL, bóveda de identidad y capa HTTP con Fastify. Lo único que hace I/O.            |
| `apps/web`           | Interfaz: Next.js, móvil primero, español de Colombia, WCAG 2.2 AA.                                                  |
| `tests/integration`  | Contra PostgreSQL real, con Testcontainers.                                                                          |
| `tests/e2e`          | Playwright: el corte vertical por la interfaz y por la API.                                                          |
| `infra/docker`       | PostgreSQL de desarrollo.                                                                                            |
| `docs/`              | Investigación, ADR, producto y gobernanza.                                                                           |

La dirección de dependencia la verifica CI (`scripts/check-domain-purity.mjs`), no la revisión de
código.

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
pnpm run e2e                              # Chromium
KOINONIA_MATRIZ=completa pnpm exec playwright test   # matriz completa
```

En un pull request corre **sólo Chromium**; en `main`, la matriz entera (Chromium, Firefox, WebKit,
Chrome móvil, Safari móvil). Está en `.github/workflows/ci.yml`.

Firefox y WebKit necesitan librerías del sistema que Playwright instala con
`pnpm exec playwright install --with-deps`. **Sin ellas los navegadores se descargan pero no
arrancan**, y el error es un aviso de dependencias del anfitrión, no un fallo de los tests.

---

## Licencia

AGPL-3.0-or-later. Es una plataforma de gobernanza autoalojable: si alguien la modifica y la
despliega como servicio, las modificaciones vuelven a la comunidad que la usa. Ver `LICENSE`.
