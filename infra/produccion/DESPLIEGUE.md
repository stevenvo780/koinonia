# Despliegue de Koinonía en producción

Esta carpeta es la copia versionada de lo que hoy vive SÓLO en la VPS, en `/opt/koinonia/`. Si esa
máquina desapareciera, esto es lo que hace falta para levantar el sistema de nuevo desde cero:
`Dockerfile`, `Dockerfile.web`, `docker-compose.yml` y `.env.ejemplo` (plantilla del `.env` real,
que NUNCA está en git — ver más abajo). Este documento es el procedimiento; está escrito para
alguien que llega sin contexto a las 3 de la mañana con el sitio caído.

**Estado de solo lectura:** quien escribió esto sólo pudo leer la VPS por SSH, no escribir en ella.
Todo lo que sigue está verificado por lectura directa de los ficheros y los logs de build que ya
existen en `/opt/koinonia/`, no inventado. Donde no se pudo verificar algo, se dice explícitamente.

## 0. El panorama en una frase

Dos contenedores propios (`koinonia-api`, `koinonia-web`) más un PostgreSQL (`koinonia-postgres`),
los tres en la red docker `koinonia_net`, sólo alcanzables desde el host por `127.0.0.1` en los
puertos 18090/18091, y Caddy (que corre en el host, no en Docker) hace de proxy TLS hacia esos dos
puertos para los dos dominios públicos. Nada de esto usa Nginx, Kubernetes ni un balanceador: es
`docker compose` liso y un `Caddyfile` compartido con otros proyectos del mismo host.

## 1. Los ficheros de esta carpeta y de dónde salieron

| Fichero              | Origen en la VPS                                       | Qué es                           |
| -------------------- | ------------------------------------------------------ | -------------------------------- |
| `Dockerfile`         | `/opt/koinonia/Dockerfile`                             | Imagen de la API (Fastify)       |
| `Dockerfile.web`     | `/opt/koinonia/Dockerfile.web`                         | Imagen de la interfaz (Next.js)  |
| `docker-compose.yml` | `/opt/koinonia/docker-compose.yml`                     | Los tres servicios de producción |
| `.env.ejemplo`       | Calco de `/opt/koinonia/.env` con secretos sustituidos | Ver §4                           |

Los tres primeros son copia literal, comentarios incluidos: esos comentarios documentan decisiones
reales (por qué la base es `node:22.17.0-alpine3.22` y no `latest`, por qué `chmod -R a+rX` antes de
cambiar a `USER node`, por qué el healthcheck de la interfaz pega a `/entrar` y no a `/`). Si tocás
estos ficheros en la VPS, traé la copia actualizada de vuelta a este directorio — hoy no hay
ningún mecanismo automático que los mantenga sincronizados; la sincronización es manual y humana.

## 2. Construir una imagen nueva desde un commit

Esto es lo que **realmente se hizo** para producir las imágenes que corren hoy
(`koinonia-api:20260823-e9c68d9` y `koinonia-web:20260823-e9c68d9`), reconstruido a partir de
`/opt/koinonia/build-api-e9c68d9.log` y `/opt/koinonia/build-web-e9c68d9.log`, del contenido de
`/opt/koinonia/repo/` y de los comentarios de los propios Dockerfiles. Los logs de build no
registran la línea de comando exacta (no hay `set -x` ni eco del comando, sólo la salida de
`buildx`), así que el comando de abajo es la reconstrucción más fiel posible, no una transcripción
literal de un log.

### 2.1. Llevar el código a la VPS

`/opt/koinonia/repo/` **no es un `git clone`** — no tiene `.git/`. Es un árbol traído por `rsync`,
como dicen los propios Dockerfiles: _"El contexto de build es /opt/koinonia/repo, que llega por
rsync sin node_modules, sin dist y sin \*.tsbuildinfo"_ (y, para la interfaz, tampoco `.next/`).
Eso importa porque un `.tsbuildinfo` viejo sin su `dist/` hace que `tsc --build` se crea al día y no
compile nada — el síntoma sería una imagen que arranca pero sirve código de una versión anterior.

Desde tu checkout local, apuntando al commit que querés desplegar:

```bash
git -C /ruta/a/koinonia status --short   # que no haya cambios sin commitear
git -C /ruta/a/koinonia rev-parse --short HEAD   # el <commit corto> que va en el tag

rsync -a --delete \
  --exclude node_modules --exclude '**/node_modules' \
  --exclude dist --exclude '**/dist' \
  --exclude '.next' --exclude '**/.next' \
  --exclude '*.tsbuildinfo' \
  /ruta/a/koinonia/ root@167.114.118.213:/opt/koinonia/repo/
```

(`--delete` importa: sin él, un fichero borrado en el commit nuevo seguiría en `/opt/koinonia/repo`
y podría colarse en el build.)

### 2.2. Construir las dos imágenes

Ya en la VPS, con `AAAAMMDD` la fecha de hoy y `<commit>` el corto de `git rev-parse --short HEAD`:

```bash
cd /opt/koinonia
docker build -f Dockerfile     -t koinonia-api:AAAAMMDD-<commit> repo/  2>&1 | tee build-api-<commit>.log
docker build -f Dockerfile.web -t koinonia-web:AAAAMMDD-<commit> repo/  2>&1 | tee build-web-<commit>.log
echo "EXIT_API=${PIPESTATUS[0]}"   # comprobar 0 después de cada build
```

El contexto de build es `repo/` completo (no un subdirectorio): es un monorepo pnpm y ambos
Dockerfiles necesitan ver los workspaces enteros para que `pnpm install --frozen-lockfile` resuelva
las dependencias internas (`@koinonia/contracts`, `@koinonia/domain`, etc.).

Cosas que los logs existentes confirman y vale la pena saber antes de que sorprendan:

- **Ambos builds tardan bastante en el paso `chmod -R a+rX /app`** (158 s la API, 166 s la
  interfaz, en los logs de referencia): no es que se haya colgado.
- Los `[WARN] Failed to create bin at ...` de pnpm durante el build de la API son ruido esperado
  (intenta enlazar binarios de paquetes que aún no compilaron su `dist/`) y no hacen fallar el build
  — lo que importa es el `EXIT_API=0` / `EXIT_WEB=0` al final.
- Los nombres de log anteriores en `/opt/koinonia/` (`build-api-b.log`, `build-web-c.log`,
  `build-api-2260823.log`...) usan sufijos sueltos que no siguen ninguna convención — sólo los dos
  más recientes (`-e9c68d9`) usan el hash corto del commit. Usá el hash corto: así un log se puede
  cruzar sin ambigüedad con `git log` y con el tag de la imagen.

### 2.3. La convención de etiquetado

```
koinonia-api:AAAAMMDD-<commit corto>
koinonia-web:AAAAMMDD-<commit corto>
```

`AAAAMMDD` es la fecha en que se construyó la imagen (no la del commit), y `<commit corto>` es la
salida de `git rev-parse --short HEAD` en el commit que se construyó. Verificado contra el estado
real: las imágenes desplegadas hoy son `koinonia-api:20260823-e9c68d9` y
`koinonia-web:20260823-e9c68d9`, y `e9c68d9` es, en efecto, un commit real del historial
(`e9c68d9 Rondas sexta y séptima del registro: catorce erratas más...`).

`docker images | grep koinonia` en la VPS muestra además tags viejos sin esta convención
(`koinonia-api:20260823`, `koinonia-api:20260823b`, `koinonia-web:20260823c`...): son de iteraciones
anteriores del mismo día, antes de que se fijara la convención del hash corto. No los borres sin
pensarlo — son exactamente lo que usa el rollback (§5).

## 3. Levantar los contenedores

`docker-compose.yml` referencia los tags por su nombre literal en el `image:` de cada servicio — no
hay variable de entorno para la versión. Para desplegar una imagen nueva hay que **editar el
`image:`** de `api` y/o `web` en `/opt/koinonia/docker-compose.yml` antes de `up`:

```bash
cd /opt/koinonia
cp docker-compose.yml "docker-compose.yml.bak-antes-$(date +%Y%m%dT%H%M%SZ)"   # como ya se venía haciendo
# editar a mano las líneas `image: koinonia-api:...` / `image: koinonia-web:...`
docker compose up -d
```

`docker compose up -d` sólo recrea los contenedores cuyo `image:` cambió (o cuya definición cambió);
Postgres sigue igual si no se tocó. El orden de arranque lo impone el `depends_on: condition:
service_healthy` del propio fichero: Postgres tiene que pasar su healthcheck antes de que arranque
la API, y la API antes que la interfaz — no hace falta orquestarlo a mano.

`docker compose` lee `/opt/koinonia/.env` automáticamente por estar en el mismo directorio que el
`docker-compose.yml` (eso es lo que resuelve `${POSTGRES_PASSWORD:?...}` en la definición de
Postgres). Es un mecanismo _distinto_ del `env_file:` que sólo tiene el servicio `api` — ver el
comentario dentro de `docker-compose.yml` sobre por qué `web` no lleva `env_file`.

## 4. El `.env` real: cómo se genera, por qué no está en git

`/opt/koinonia/.env` tiene permisos 600, dice en su primera línea _"Generado en la propia VPS con
openssl"_ y NUNCA debe copiarse al repositorio ni imprimirse en un log. `.env.ejemplo` en esta
misma carpeta es la plantilla: mismas variables, mismos comentarios, cada secreto real sustituido
por un marcador `<ENTRE_ÁNGULOS>`. Antes de dar por buena esta plantilla se releyó a mano buscando
cualquier cadena que pareciera una clave, contraseña o cadena de conexión con credenciales, y se
comparó carácter por carácter contra los cinco secretos reales para confirmar que ninguno quedó.

Para reconstruir el `.env` real desde cero (por ejemplo, en una VPS nueva):

1. Copiá `.env.ejemplo` a `/opt/koinonia/.env` y ponele permisos `chmod 600`.
2. Generá cada secreto con `openssl` en la propia VPS (nunca en tu máquina, nunca por un canal que
   lo pueda dejar en un historial de shell compartido) y reemplazá el marcador correspondiente:
   - `POSTGRES_PASSWORD` (y su copia dentro de `DATABASE_URL`): una cadena aleatoria; en el `.env`
     real es hexadecimal, obtenible con `openssl rand -hex 24` o similar. **Las dos apariciones
     tienen que coincidir** — el propio comentario del fichero lo advierte.
   - `KOINONIA_RATE_PEPPER`: hexadecimal largo, p. ej. `openssl rand -hex 32`.
   - `KOINONIA_VAULT_MASTER_KEY`: base64, p. ej. `openssl rand -base64 32`.
   - `KOINONIA_DB_APP_PASSWORD` (y su copia dentro de `KOINONIA_DATABASE_URL_APP`): igual criterio
     que `POSTGRES_PASSWORD`, es la contraseña del rol `koinonia_app` que crea la migración 0003.
   - `KOINONIA_SMTP_PASS`: no se genera, es la contraseña real de la cuenta SASL
     `koinonia@stevenvallejo.com` en el Postfix del host — hay que pedirla, no inventarla.
3. Completá `KOINONIA_FACILITADORES` / `KOINONIA_GARANTIAS` con correos reales `@udea.edu.co` (el
   adaptador de identidad rechaza cualquier otro dominio: un correo mal puesto aquí queda escrito
   en el `.env` y nunca podrá entrar al sistema — revisalo dos veces).
4. Dejá `KOINONIA_ANCLAJE=false` a propósito salvo que de verdad quieras que el servicio salga a
   OpenTimestamps y a las forjas en cada ciclo (el valor por defecto del código es _encendido_).

**El `.gitignore` del repositorio** ya bloquea `.env` y `.env.*` en general (para que nadie meta un
`.env` real por accidente); se añadió una excepción puntual sólo para
`infra/produccion/.env.ejemplo`, que es la plantilla sin secretos. Verificado con
`git check-ignore`: un `.env` real en `infra/produccion/` sigue bloqueado; la plantilla no.

## 5. Comprobar que quedó bien

```bash
# 1. Los tres contenedores, sanos:
docker ps --filter name=koinonia --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
# Se espera "healthy" en los tres, no sólo "Up". El healthcheck de la API pega a /salud
# (services/api) y el de la interfaz a /entrar (esa ruta no depende de sesión ni de que la API
# responda: un 200 ahí sólo dice "el proceso de Next está vivo").

# 2. Los puertos internos responden (desde la propia VPS, por loopback):
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18090/salud
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18091/entrar

# 3. Los dos dominios públicos, de punta a punta (desde donde sea):
curl -sS -o /dev/null -w '%{http_code}\n' https://api.167.114.118.213.sslip.io/salud
curl -sS -o /dev/null -w '%{http_code}\n' https://koinonia.167.114.118.213.sslip.io/entrar

# 4. Que la interfaz de verdad llega a la API por la red interna y no por Internet:
docker logs koinonia-web --tail 50 | grep -i error   # sin errores de conexión a KOINONIA_API_URL
```

Si el paso 3 falla pero el 2 no, el problema está en Caddy (§6), no en los contenedores.

## 6. Volver atrás

Como el `image:` de cada servicio es un tag fijo y las imágenes anteriores no se borran, revertir
es **no reconstruir nada**: apuntar el compose al tag viejo y recrear.

```bash
cd /opt/koinonia
docker images | grep koinonia   # confirmar que el tag anterior sigue ahí
cp docker-compose.yml "docker-compose.yml.bak-antes-rollback-$(date +%Y%m%dT%H%M%SZ)"
# editar `image:` de vuelta al tag anterior conocido-bueno (p. ej. koinonia-api:20260823b)
docker compose up -d
# repetir las comprobaciones del §5
```

Si el problema es de datos (una migración salió mal) y no de código, esto NO alcanza: la base
`koinonia-postgres` no se toca al recrear `api`/`web`. Restaurar datos está fuera del alcance de
este documento — no hay hoy un procedimiento de backup/restore de `koinonia-pgdata` verificado por
quien escribe esto; documentarlo es trabajo pendiente, no algo que se pueda dar por hecho.

## 7. Caddy: el proxy TLS, y por qué hay que tratarlo con cuidado

**Koinonía sirve DOS dominios**, ambos definidos como bloques al final de
`/etc/caddy/Caddyfile`:

| Dominio                             | Reenvía a                          | Para qué              |
| ----------------------------------- | ---------------------------------- | --------------------- |
| `api.167.114.118.213.sslip.io`      | `127.0.0.1:18090` (`koinonia-api`) | La API sola           |
| `koinonia.167.114.118.213.sslip.io` | `127.0.0.1:18091` (`koinonia-web`) | La interfaz (Next.js) |

Hacen falta los dos: el enlace de acceso que manda el correo apunta a
`/entrar/confirmar?token=…`, que es una pantalla de Next, no un endpoint de la API — servida desde
el dominio de la API daba 404. Y el navegador nunca habla con la API directamente: la interfaz
expone `/api/*` y lo reenvía **por la red docker interna** (`koinonia_net`, contenedor a
contenedor) a `koinonia-api:3001`, así la cookie de sesión es de primera parte y no hace falta CORS
con credenciales ni `SameSite=None`.

### ADVERTENCIA — el Caddyfile es UN SOLO fichero compartido

`/etc/caddy/Caddyfile` no usa `import` ni un directorio `conf.d/`: es un único fichero con **todos**
los sitios del host — en la lectura que dio pie a este documento había más de una decena de bloques
de sitio, la enorme mayoría de proyectos que no son Koinonía (`vault.humanizar-dev.cloud`,
`consola.humanizar.tech`, `mail.stevenvallejo.com`, el certificado de `ns512213.ip-167-114-118.net`
del que dependen dos timers de sincronización de certificados, y varios más). **Un `caddy reload`
es global**: si el fichero completo no valida, no sólo no se aplica el cambio de Koinonía — se
puede tumbar el proxy de los diez y pico sitios ajenos a la vez.

Antes de tocar el Caddyfile, siempre, sin excepción:

```bash
cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-koinonia-$(date -u +%Y%m%dT%H%M%SZ)"
# ... editar ...
caddy validate --config /etc/caddy/Caddyfile
# sólo si validate no da error:
systemctl reload caddy
```

`systemctl reload caddy` (no `restart`) ejecuta internamente `caddy reload --config
/etc/caddy/Caddyfile --force`, que es sin caída de conexiones — pero sólo si el fichero es válido.
Revertir es `cp` del backup más reciente con el prefijo del bloque que tocaste y volver a
`reload`. Los propios bloques de Koinonía en el Caddyfile llevan esta misma instrucción de reversión
en su comentario, con el nombre de backup exacto que corresponde a cada uno
(`Caddyfile.bak-koinonia-*` para el bloque de la API, `Caddyfile.bak-koinonia-web-*` para el de la
interfaz).

## 8. Referencia rápida: qué NO hacer

- No publiques el puerto de PostgreSQL en `docker-compose.yml` de producción. Ni siquiera en
  `127.0.0.1`: hoy no lo necesita nadie fuera del propio contenedor de la API, que lo alcanza por
  nombre en `koinonia_net`. (El compose de **desarrollo**, `infra/docker/docker-compose.yml`, sí
  publica un puerto — a propósito, y sólo pensado para un portátil, nunca para esta VPS: lleva su
  propia advertencia sobre eso.)
- No le agregues `env_file` al servicio `web`. No necesita la contraseña de Postgres, ni la clave
  del baúl, ni la pimienta de cupos — lo que un proceso no tiene no lo puede filtrar.
- No hagas `docker compose down` seguido de `up` "para reiniciar todo": `down` se lleva por delante
  los TRES contenedores a la vez, incluido `koinonia-postgres` (aunque la red `koinonia_net`, por
  ser `external: true`, y el volumen `koinonia-pgdata` sobreviven — verificado: `down` no toca lo
  que no creó). Es más caída de la necesaria para desplegar una imagen nueva de `api` o de `web`.
  Usá `docker compose restart <servicio>` o, tras editar el `image:`, `docker compose up -d` sin
  más: sólo recrea lo que cambió.
- No reutilices `ufw` o reglas de firewall de otro proyecto del host para "arreglar" un puerto
  expuesto por error: la protección real aquí es el `127.0.0.1:` delante de cada `ports:` — sin él,
  con `ufw` inactivo y la cadena `DOCKER-USER` vacía, cualquier puerto publicado es público al
  instante.

## 9. Registro de acceso y cabeceras de seguridad (pendiente de aplicar; borrador 2026-08-23, revisado y validado de verdad el 2026-08-24)

**Estado hoy, comprobado en la propia VPS:** Caddy no registra una sola petición para ninguno de los
dos dominios de Koinonía (`grep -n "log " /etc/caddy/Caddyfile` no da nada), y la API corre con el
registrador en `warn` (sin `KOINONIA_LOG` en `/opt/koinonia/.env`, que es el único fichero que lo
fija). En una plataforma donde se vota, eso significa que un incidente —una sesión robada, un pico
de 500, un abuso del control de cupos— no se puede investigar después: no queda ni una línea. Esta
sección cierra ese hueco en dos frentes, API y Caddy, y dice cómo aplicar el segundo sin arriesgar
los otros 14 sitios ajenos del fichero compartido.

### 9.1. Lado API: ya en el código, falta encenderlo en el despliegue

`services/api/src/http/app.ts` ya trae el cambio (ver el comentario de cabecera del archivo para el
razonamiento completo): un registro propio por petición —método, **patrón** de ruta sin
identificadores de recurso, estado, duración—, con la emisión de papeleta (`POST
/decisiones/:id/papeletas`) explícitamente excluida porque asociarle una hora reconstruye el momento
del voto (THREAT_MODEL.md T-20; ADR-0014). Por código el nivel sigue siendo `warn` —las pruebas y el
desarrollo local quedan silenciosos, sin que nadie tenga que acordarse de nada—; lo que lo enciende
en producción es una línea nueva en el `.env` real, ya reflejada en la plantilla:

```bash
# En /opt/koinonia/.env, junto al resto de KOINONIA_*:
KOINONIA_LOG=info
```

Aplicar esto no es un cambio de Caddy: es una imagen nueva de `koinonia-api` (el `.ts` cambió, hay
que reconstruir) más esa línea de `.env`. Seguir el procedimiento ya existente de este documento —
**§2** para construir la imagen, **§4** para editar el `.env` real, **§3** y **§5** para levantar y
comprobar—; no hace falta nada distinto de lo que ya describen. Una vez arriba, `docker logs
koinonia-api --tail 20` debería mostrar líneas `{"...,"msg":"peticion",...}` por cada petición nueva,
sin `req`, sin cuerpo, sin cabeceras.

### 9.2. Lado Caddy: el bloque exacto, en `Caddyfile.fragmento-registro-y-cabeceras`

El contenido completo con el que hay que reemplazar los dos bloques de sitio de Koinonía está en
[`Caddyfile.fragmento-registro-y-cabeceras`](./Caddyfile.fragmento-registro-y-cabeceras), en esta
misma carpeta, con un comentario de cabecera largo que explica cada pieza. En resumen agrega, a cada
uno de los dos dominios:

| Pieza                                                                                   | Qué hace                                                                                                                                                                              | Por qué                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skip_log @papeletas` | La emisión de papeleta no genera línea de log, en ninguno de los dos dominios | T-20 (proxy logs es una de sus tres precondiciones) y ADR-0014 — **no** la cita de THREAT_MODEL.md «línea 286» de una versión anterior de este documento: esa frase no existe en el fichero, corregida al revisar esto (ver cabecera del fragmento) |
| `log { … format filter … }`                                                             | Registro a fichero en `/var/log/caddy/`, con IP, `Cookie`, `Authorization` y `Set-Cookie` **borrados** (no ofuscados) del JSON antes de escribirlo, y la cadena de consulta recortada | C17 (ninguna IP, en ningún componente) y el mismo criterio de `redact`/`remove` que ya usa la API                                                         |
| `roll_size 10MiB` / `roll_keep 5` / `roll_keep_for 720h` | Tope de 50 MB por sitio, purga a 30 días | Mismo tope que ya fija `docker-compose.yml` para los tres contenedores (verificado); 30 días sigue la convención que THREAT_MODEL.md usa para `consent_logs`, **no** una práctica ya en producción — esa purga automática está marcada como no implementada (T-11) |
| `header { Strict-Transport-Security … X-Frame-Options … Cross-Origin-Opener-Policy … }` | Tres cabeceras de la lista de THREAT_MODEL.md §6 que hoy faltan (en modo obligatorio: son estáticas, no dependen de la aplicación) | `next.config.mjs` ya sirve las otras tres de esa misma lista (verificado) |
| `Content-Security-Policy-Report-Only` (sólo en el dominio de la interfaz)               | La CSP estricta de THREAT_MODEL.md §6, sin nonce (apps/web no lo genera hoy), en modo **de sólo informe**: nunca bloquea, sólo reporta a la consola del navegador                     | apps/web usa Next.js, que normalmente mete script/estilo en línea; aplicarla obligatoria sin haber mirado qué reporta puede dejar la aplicación en blanco |

### 9.2bis. Antes de aplicar esto: activa una revisión obligatoria de THREAT_MODEL.md

Esto no es sólo un cambio de infraestructura. THREAT_MODEL.md §9, riesgo aceptado **RA-8**
(«Correlación por metadatos fuera de la aplicación»), fija como condición que obliga a revisarlo,
literalmente: **«Logs de proxy conservados más allá de la sesión»**. Este cambio crea exactamente
eso — 30 días de retención contra 8 horas de sesión máxima (§6, «Sesiones»). El diseño ya lo
compensa (sin IP, sin cookie, sin cuerpo, con la ruta de papeleta excluida — verificado en §9.2), pero
la condición se cumple igual, textualmente, y por §10 («Disparadores obligatorios», inciso b: «se
acepte, modifique o venza cualquier riesgo del §9») eso activa la obligación de traer RA-8 a
revisión, que aprueba la asamblea por consentimiento (§10, «Quién»), no una decisión técnica
unilateral. **Aplicar el Caddyfile no sustituye pedir esa revisión** — son dos pasos distintos, y
sólo el primero está en el alcance técnico de este documento.

**Verificación ya hecha, fuera de la VPS, el 2026-08-24 — con el binario real, no sólo revisado a
ojo:** una versión anterior de esta sección afirmaba una validación que, al revisar esto, no se
encontró evidencia de que se hubiera ejecutado — el directorio de trabajo no tenía ningún binario de
Caddy ni rastro de haberlo descargado. Se repitió desde cero: se descargó el binario oficial de Caddy
**2.6.2** —la misma versión exacta que corre en la VPS, reconfirmado por ssh hoy— y con él,
localmente:

1. Se tomó el `/etc/caddy/Caddyfile` **real** de la VPS de hoy (14 sitios ajenos + los 2 de
   Koinonía, 194 líneas) y se le reemplazaron los dos bloques de Koinonía por el fragmento completo.
   `caddy validate` sobre ese fichero **completo**, no sólo sobre los dos bloques aislados: `Valid
   configuration`. (A los otros dos bloques que usan certificados de fichero —`vpn2` y `vault`— hubo
   que darles un par de certificados autofirmados de prueba sólo para que `validate` pudiera leerlos;
   no se tocó nada de esos dos sitios más allá de eso.)
2. `caddy fmt --diff` sobre ese mismo fichero completo sí avisa que el fichero "no está formateado"
   — pero el diff muestra que es por los 14 sitios ajenos (indentación de 2 espacios); ni una línea
   de los dos bloques de Koinonía, con tabulador, cambia.
3. `caddy run` real (sin TLS, en puertos locales, contra dos backends de prueba), con el fragmento
   final tal cual queda en `Caddyfile.fragmento-registro-y-cabeceras`, y peticiones de verdad: la
   ruta de papeleta (en los dos dominios, directa y con el prefijo `/api`) **no generó ninguna línea**
   en ninguno de los dos ficheros de log — 0 líneas frente a las peticiones normales que sí quedaron
   registradas; una petición con `Cookie`, `Authorization`, `X-Forwarded-For` y `X-Real-Ip` puestas a
   mano llegó al log **sin esos cuatro campos** (el objeto `headers` de la línea registrada ni los
   menciona); una con `?token=secreto` en la URL quedó **sin la cadena de consulta**; y las cabeceras
   (HSTS, `X-Frame-Options`, COOP, y `Content-Security-Policy-Report-Only` sólo en el dominio de la
   interfaz) salieron en las respuestas reales.

Eso prueba la sintaxis contra el fichero real completo y el comportamiento contra el binario real.
Lo que **no** se pudo probar —porque la VPS es de sólo lectura para quien escribió esto— es aplicar
el fragmento **dentro de la VPS misma**, con sus certificados ACME reales y sus 14 sitios ajenos tal
como estén el día en que alguien lo aplique, que puede no ser este mismo día: el propio
`consola.humanizar.tech` es prueba de que ese fichero cambia bajo otras manos sin avisar en el sitio
que se toca — su comentario dice que el backend real es `100.64.0.6:8444`, pero la directiva
`reverse_proxy` que sí ejecuta Caddy apunta hoy a `100.64.0.11:8444`; el comentario quedó desactualizado
y nadie lo corrigió. Es exactamente el motivo por el que este documento insiste en releer el
Caddyfile real antes de tocar nada, no confiar en una copia ni en lo que dice un comentario. Para eso
está el `caddy validate` del paso 4 de abajo: es la red de seguridad que reemplaza esa última milla
que no se pudo ensayar aquí.

### 9.3. Procedimiento para aplicarlo (reutiliza el de §7, con las comprobaciones propias de este cambio)

```bash
# 1. Copia de seguridad fechada — siempre, sin excepción (§7):
cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-koinonia-registro-$(date -u +%Y%m%dT%H%M%SZ)"

# 2. Confirmar que /var/log/caddy admite escritura de Caddy (dueño caddy:caddy, 755 — comprobado
#    por ssh el 2026-08-23 y reconfirmado el 2026-08-24; repetir el chequeo igual, por si cambió) y
#    que el disco tiene margen: el mismo día 24 el disco daba 53 GB libres / 89 % usado (467 GB
#    totales) — 28 GB menos que los 81 GB del día anterior. 100 MB de tope duro para estos dos logs
#    no cambia esa cuenta, pero si `df -h /` sigue cayendo a ese ritmo es una señal a escalar aparte
#    de este cambio, no algo que este cambio cause:
ls -la /var/log/caddy
df -h /

# 3. Editar /etc/caddy/Caddyfile a mano: reemplazar el bloque completo de
#    `api.167.114.118.213.sslip.io` y el de `koinonia.167.114.118.213.sslip.io` por el contenido de
#    Caddyfile.fragmento-registro-y-cabeceras (los bloques completos, no un parche — el fragmento ya
#    los trae enteros para pegar sin ambigüedad).

# 4. Validar ANTES de recargar — si esto falla, el Caddyfile real queda intacto, no se llegó a
#    aplicar nada:
caddy validate --config /etc/caddy/Caddyfile

# 5. Sólo si el paso 4 no dio error:
systemctl reload caddy

# 6. Comprobar que TODOS los sitios ajenos siguen respondiendo, no sólo los dos de Koinonía. La
#    lista de abajo es la que había en /etc/caddy/Caddyfile al escribir esto (2026-08-23) — antes de
#    tocar nada, releer el fichero real (`grep -oP '^\S+(?=\s*\{)' /etc/caddy/Caddyfile`) y usar ESA
#    lista si difiere, porque para cuando se aplique esto puede haber cambiado:
for d in vpn2.prisma-enterprice.cloud vault.humanizar-dev.cloud nav4.humanizar.tech \
         nav1.humanizar.tech nav2.humanizar.tech nav3.humanizar.tech \
         navgoogle1.humanizar.tech navgoogle2.humanizar.tech navopenai.humanizar.tech \
         consola-preview.humanizar.tech consola.humanizar.tech \
         navopenai2.prisma-enterprice.cloud mail.stevenvallejo.com \
         ns512213.ip-167-114-118.net; do
  printf '%-40s ' "$d"
  curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 "https://$d/" || echo "FALLÓ"
done

# 7. Verificar el cambio propio: la papeleta no deja rastro, las cabeceras sí aparecen:
curl -sS -D - -o /dev/null https://koinonia.167.114.118.213.sslip.io/entrar \
  | grep -i "strict-transport\|x-frame\|cross-origin-opener\|content-security-policy"
tail -5 /var/log/caddy/koinonia-api-acceso.log /var/log/caddy/koinonia-web-acceso.log
# (después de una votación real de prueba, si hay una decisión abierta) confirmar que
# "papeletas" no aparece en ninguno de los dos ficheros.
```

**Revertir:** `cp` del backup del paso 1 sobre `/etc/caddy/Caddyfile` y `systemctl reload caddy` de
nuevo — el mismo mecanismo que ya describe §7, con el prefijo `Caddyfile.bak-koinonia-registro-*`.

### 9.4. Cuándo volver obligatoria la CSP

La cabecera queda en `-Report-Only` a propósito (§9.2). Antes de quitarle el sufijo: abrir la
interfaz un tiempo con las herramientas de desarrollo del navegador abiertas, revisar qué violaciones
reporta la consola, y decidir con quien mantenga `apps/web` si hace falta `'unsafe-inline'`, un nonce
real (lo que exige THREAT_MODEL.md §6 y hoy no existe en el código), o ninguna de las dos. Aplicarla
obligatoria sin haber mirado esos informes es el error que el modo de sólo informe existe para evitar.
