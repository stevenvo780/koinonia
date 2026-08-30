# Copias de seguridad de Koinonía en producción

Hasta el día en que se escribió esto no existía ninguna copia del volumen `koinonia-pgdata`, ni
ninguna tarea programada que la hiciera. Era el riesgo más grave del despliegue — y lo era en
especial en este proyecto: la plataforma le promete a cada estudiante que puede recalcular la
historia por su cuenta (ADR-0053, ADR-0054), y esa promesa depende, en última instancia, de que la
historia exista en algún disco. Este documento y los cuatro ficheros que lo acompañan
(`copia-de-seguridad.sh`, `restaurar-copia.sh`, `koinonia-copia.service`, `koinonia-copia.timer`)
son la respuesta a eso.

**Estado de solo lectura:** igual que `DESPLIEGUE.md`, esto se escribió pudiendo leer la VPS por
SSH pero sin poder escribir en ella. Los números de este documento (tamaño de la base, espacio en
disco, tablas existentes) están medidos en vivo contra la VPS real, no inventados — ver §7. Los
scripts en sí NO se corrieron en la VPS: se probaron localmente contra un contenedor Postgres
descartable (mismo `postgres:16-alpine`, misma lógica de `pg_dump -Fc` / `pg_restore --list`) para
confirmar que el mecanismo de verificación por conteo de tablas realmente detecta lo que dice
detectar. Instalarlos en la VPS de verdad, correrlos ahí por primera vez y confirmar que el timer
dispara, es trabajo que le queda a quien aplique esto — ver §4 y §6.

## 0. En una frase

Todas las noches, `koinonia-copia.timer` corre `pg_dump` DENTRO de `koinonia-postgres`, en formato
custom comprimido, lo guarda con fecha y huella sha256 en `/opt/koinonia/copias/`, verifica que
`pg_restore` pueda leerlo y que el número de tablas coincida con el de la base real, y rota lo
viejo. Si cualquier paso falla, el servicio queda "failed" en systemd — no falla en silencio.

## 1. Qué se copia

Un `pg_dump -Fc` de la base `koinonia` completa, ejecutado con `docker exec koinonia-postgres
pg_dump ...`. Eso incluye los cuatro schemas de aplicación que existen hoy —
`governance` (8 tablas: `event`, `checkpoint`, `aggregate_head`, `append_request`,
`bitcoin_header`, `anchor_attempt`, `clause_text`, `ledger_cursor`), `identity` (8 tablas, entre
ellas `member`, `private_material`, `session`, `magic_link`), `projection` (3 tablas) y
`koinonia_meta` (la tabla `migration`) — sin necesidad de listarlos a mano: `pg_dump` sin
`--schema` vuelca la base entera, todos los schemas que tenga en ese momento. Si en el futuro se
agrega un schema nuevo, esta copia lo incluye sin que haga falta tocar el script.

**Por qué `pg_dump` y no una copia del volumen `koinonia-pgdata`:** Postgres sigue vivo mientras se
copia. Copiar los ficheros de un PostgreSQL en caliente (tar, rsync, snapshot de disco) puede
capturar páginas de datos a mitad de escribir y WAL sin aplicar todavía — el resultado a veces no
restaura, y una copia que no se sabe si restaura es peor que no tener copia: da confianza sin
respaldo real. `pg_dump` toma un snapshot MVCC lógico y consistente sin detener nada.

## 2. Qué NO se copia (y por qué)

| No incluido                                                                                                | Por qué no                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/koinonia/.env` (contraseñas, `KOINONIA_VAULT_MASTER_KEY`, `KOINONIA_RATE_PEPPER`, credenciales SMTP) | Es un secreto, no un dato a preservar por generaciones — y mezclarlo con las copias de datos multiplicaría el daño de una fuga: quien accediera a una copia vieja tendría además las claves para descifrar `identity.private_material` de **cualquier** copia. Se reconstruye siguiendo `DESPLIEGUE.md` §4, con secretos nuevos generados en el momento. |
| Las imágenes Docker (`koinonia-api:*`, `koinonia-web:*`)                                                   | Son código compilado, no datos: se reconstruyen desde el commit correspondiente del repositorio (`DESPLIEGUE.md` §2). Guardarlas en la rotación de copias sólo gastaría disco compartido con 66 contenedores ajenos sin agregar nada que un `git checkout` + build no reproduzca.                                                                        |
| El volumen `koinonia-pgdata` en sí (ficheros crudos)                                                       | A propósito — ver §1. Una copia de ficheros en caliente es justamente lo que este mecanismo evita.                                                                                                                                                                                                                                                       |
| El `Caddyfile` y los certificados TLS                                                                      | No son de Koinonía: son compartidos con una decena de sitios ajenos del mismo host y ya deberían tener su propio respaldo fuera del alcance de este proyecto.                                                                                                                                                                                            |
| El código fuente                                                                                           | Vive en git, no en la VPS. Perder la VPS no lo pierde.                                                                                                                                                                                                                                                                                                   |

## 3. Cada cuánto y dónde queda

- **Diario**, a las 02:45 UTC (`koinonia-copia.timer`), antes de los otros respaldos ya programados
  en este host (Demeter a las 03h/15h, Cauce V3 a las 03:30h — ver `systemctl list-timers`) para no
  competir por IO con ellos.
- `Persistent=true`: si la máquina estuvo apagada a esa hora, el timer dispara al arrancar en vez de
  saltearse el día entero.
- Queda en `/opt/koinonia/copias/`, en la MISMA máquina que la base que respalda. **Eso es una
  limitación real, no un detalle — ver §8.**
- Cada copia son dos ficheros: `koinonia-<fecha-UTC>.dump` (el volcado) y
  `koinonia-<fecha-UTC>.dump.sha256` (su huella). Si la verificación de una corrida falla, el
  `.dump` se conserva con el sufijo `.SOSPECHOSA` en vez de borrarse o de contar como copia válida
  — queda ahí para que alguien lo mire, y la rotación nunca lo toca.
- Se conservan **14 copias válidas** por defecto (`KOINONIA_COPIA_RETENCION`, configurable en
  `koinonia-copia.service`). Es un conteo de copias, no de días: así un día sin corrida (máquina
  apagada) no adelanta el borrado de las que sí hay, y una corrida manual extra el mismo día no
  dispara un borrado prematuro.

## 4. Cómo se aplica (instalación en la VPS)

Nadie corrió esto en la VPS todavía — son los pasos exactos para hacerlo, y cómo deshacerlos.

> [!IMPORTANT]
> **`/opt/koinonia/infra` es un ENLACE a `/opt/koinonia/repo/infra`, desde el 2026-08-30.** No se
> copian ficheros a mano. La instrucción de más abajo hacía lo contrario y se deja escrita, tachada,
> porque conviene saber por qué se dio la vuelta.
>
> El razonamiento original era bueno: `/opt/koinonia/repo/` se reescribe con `--delete` en cada
> despliegue, y eso no parece sitio para algo que un `timer` de systemd invoca por ruta fija. Lo que
> no previó es el otro fallo, que es el que pasó de verdad: **dos copias del mismo guion que nadie
> mantiene iguales**. El de restauración se arregló en el repositorio el 2026-08-29 —para que dejara
> de perder los permisos de `koinonia_app` sobre `governance.event`— y la copia del servidor se
> quedó como estaba, siete días. Una auditoría lo encontró corriendo los dos contra el volcado real:
>
> - el del repositorio deja la base usable y dice `privilegios OK`;
> - el del servidor deja una base **sin los roles `koinonia_ddl` y `koinonia_app` y sin ni un
>   privilegio** —la aplicación no podría ni conectarse— y aun así imprime `verificación OK`.
>
> Una copia de seguridad que no restaura no es una copia de seguridad, y el modo en que fallaba era
> el peor: en silencio y con un mensaje de éxito. El riesgo del enlace es real pero menor y ruidoso
> —si el árbol perdiera esos ficheros, el `timer` fallaría a la vista—; el de las dos copias es
> callado y sólo se descubre el día que hace falta restaurar. Se elige el ruidoso.
>
> `rsync` escribe cada fichero en un temporal y lo renombra, así que un guion nunca queda a medias
> ni desaparece durante un despliegue: los cinco ficheros están en el repositorio, y `--delete` sólo
> borra lo que ya no está en el origen.
>
> Comprobación después de cualquier despliegue, y va en `DESPLIEGUE.md` §5:
>
> ```bash
> ssh root@167.114.118.213 'readlink /opt/koinonia/infra && md5sum /opt/koinonia/infra/produccion/restaurar-copia.sh'
> ```
>
> Tiene que decir `/opt/koinonia/repo/infra` y la misma huella que `md5sum
infra/produccion/restaurar-copia.sh` en el repositorio. Si difieren, el enlace se deshizo.

<details>
<summary>La instalación original, de cuando eran dos copias (ya no se hace así)</summary>

```bash
# 1. Llevar estos cinco ficheros a una ubicación ESTABLE, separada del árbol que trae el
#    rsync de build (/opt/koinonia/repo/ se reescribe con --delete en cada build — ver
#    DESPLIEGUE.md §2.1 — no es lugar para algo que un timer de systemd va a invocar por
#    ruta fija).
#    OJO: hoy (2026-08-23) NO existe /opt/koinonia/infra/ en la VPS — sólo /opt/koinonia/.
#    `rsync -a` crea COMO MUCHO el último componente que falte del destino; con dos
#    niveles faltantes (infra/ y produccion/) falla con "mkdir ... failed: No such file
#    or directory" (probado localmente: rsync 3.4.4, mismo comportamiento documentado
#    para versiones anteriores). Por eso el mkdir explícito primero:
ssh root@167.114.118.213 'mkdir -p /opt/koinonia/infra/produccion'
rsync -a \
  infra/produccion/copia-de-seguridad.sh \
  infra/produccion/restaurar-copia.sh \
  infra/produccion/koinonia-copia.service \
  infra/produccion/koinonia-copia.timer \
  infra/produccion/COPIAS.md \
  root@167.114.118.213:/opt/koinonia/infra/produccion/

# 2. En la VPS: permisos de ejecución y las unidades en su sitio.
ssh root@167.114.118.213 '
  chmod 750 /opt/koinonia/infra/produccion/copia-de-seguridad.sh \
            /opt/koinonia/infra/produccion/restaurar-copia.sh
  cp /opt/koinonia/infra/produccion/koinonia-copia.service /etc/systemd/system/
  cp /opt/koinonia/infra/produccion/koinonia-copia.timer   /etc/systemd/system/
  systemctl daemon-reload
'

```

</details>

```bash
# 3. Una corrida manual ANTES de confiarle esto al timer — que la primera copia real
#    del sistema no sea a las 02:45 sin nadie mirando.
ssh root@167.114.118.213 'systemctl start koinonia-copia.service && systemctl status koinonia-copia.service'
ssh root@167.114.118.213 'journalctl -u koinonia-copia.service --no-pager -n 50'
ssh root@167.114.118.213 'ls -la /opt/koinonia/copias/'

# 4. Recién si el paso 3 salió bien, activar el timer.
ssh root@167.114.118.213 'systemctl enable --now koinonia-copia.timer'
ssh root@167.114.118.213 'systemctl list-timers koinonia-copia.timer'
```

**Cómo se revierte cada paso:**

```bash
# Desactivar el timer (deja de correr; no borra copias ya hechas):
ssh root@167.114.118.213 'systemctl disable --now koinonia-copia.timer'

# Sacar las unidades de systemd por completo:
ssh root@167.114.118.213 '
  systemctl disable --now koinonia-copia.timer koinonia-copia.service 2>/dev/null
  rm -f /etc/systemd/system/koinonia-copia.service /etc/systemd/system/koinonia-copia.timer
  systemctl daemon-reload
'

# Los scripts y las copias en /opt/koinonia/ quedan intactos hasta que alguien decida
# borrarlos a mano — desinstalar el timer no borra el histórico de copias.
```

## 5. Cómo se restaura

`restaurar-copia.sh` tiene dos modos — leé el encabezado del script, tiene el detalle completo:

- **Modo aislado (por defecto)**: `./restaurar-copia.sh <archivo.dump>`. Levanta un contenedor
  Postgres nuevo y descartable — sin tocar `koinonia-postgres`, sin unirse a `koinonia_net`, sin
  publicar puertos — restaura ahí el volcado, verifica que el número de tablas coincida y muestra un
  conteo de filas por tabla. No arriesga nada de producción. Es el modo que usa el simulacro de §6.
- **Modo producción (destructivo)**: `./restaurar-copia.sh <archivo.dump> --produccion`. Reemplaza
  la base `koinonia` real. Antes de tocar nada: exige una terminal interactiva (se niega a correr
  sin una persona delante), pide escribir a mano la frase exacta `SI, REEMPLAZAR koinonia`, y hace
  — a su vez — una copia de emergencia de lo que había, por si la restauración sale mal. Detiene
  `koinonia-api` antes de restaurar y **no la vuelve a levantar sola**: el último paso, revisar los
  datos y correr `docker start koinonia-api`, queda a propósito en manos de una persona. Esa copia
  de emergencia (`koinonia-ANTES-DE-RESTAURAR-<fecha>.dump`) queda en el mismo `/opt/koinonia/copias/`
  pero **la rotación automática de `copia-de-seguridad.sh` la ignora a propósito** — igual que a las
  `.SOSPECHOSA`, no cuenta para las 14 copias válidas y nunca se autoborra; queda ahí hasta que un
  humano decida qué hacer con ella.

Una copia que nadie sabe restaurar no es una copia — por eso el modo aislado no es sólo para una
catástrofe: es barato de correr (un contenedor descartable, unos segundos) y es exactamente lo que
hace falta para el simulacro de abajo.

## 6. Cómo se comprueba que la copia sirve (el simulacro)

Una copia que se genera pero nunca se restauró es una promesa sin probar. La verificación que hace
`copia-de-seguridad.sh` cada noche (§0) prueba que el **fichero** es legible y tiene la cantidad de
tablas esperada — no prueba que el **contenido** sea el que un humano reconocería como correcto.
Eso sólo lo prueba una restauración real.

**Procedimiento** (con la copia más reciente de `/opt/koinonia/copias/`):

```bash
ssh root@167.114.118.213
cd /opt/koinonia/infra/produccion
./restaurar-copia.sh /opt/koinonia/copias/koinonia-<la-más-reciente>.dump
```

Revisar a mano, en la salida:

1. Que "verificación OK" aparezca (el número de tablas restauradas coincide con el del volcado).
2. Que el conteo de filas por tabla que imprime al final tenga sentido: si `identity.member` da 0
   filas y se sabe que hay personas registradas, algo está mal aunque la cuenta de _tablas_ haya
   dado bien — la cuenta de tablas no puede detectar una base vacía con el esquema correcto.
3. Que no haya quedado ningún contenedor `koinonia-verificacion-*` corriendo después (el script los
   borra solo salvo que se use `--conservar`; confirmar con `docker ps -a | grep koinonia-verificacion`).

**Periodicidad recomendada: una vez al mes.** No hace falta más seguido — el mecanismo de
verificación automática de cada noche (§0) ya cubre "¿el fichero está sano?"; lo que el simulacro
mensual cubre es "¿sigue siendo cierto que alguien en este equipo sabe restaurar, y que el
procedimiento escrito sigue siendo el procedimiento real?" (versiones de Postgres que cambian,
scripts que se editan y no se vuelven a probar, etc.). Un simulacro que nunca se corre es
indistinguible, en la práctica, de no tener copias.

## 7. Números reales, medidos el 2026-08-23 contra la VPS

Todo lo de esta sección se midió por SSH, en lectura, contra la máquina real — no son estimaciones.

| Medición                                                                       | Valor                                                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Tamaño lógico de la base (`pg_database_size`)                                  | 8575 kB (~8,4 MiB)                                                               |
| Tamaño en disco del volumen `koinonia-pgdata` completo (datos + índices + WAL) | 48 MiB                                                                           |
| Tamaño de un `pg_dump -Fc` real de la base de hoy                              | **55.515 bytes (~54,2 KiB)** — comprimido, formato custom                        |
| Tablas en schemas de aplicación                                                | 20 (`governance`: 8, `identity`: 8, `projection`: 3, `koinonia_meta`: 1)         |
| Espacio libre en el disco de la VPS (`/`, `/dev/md3`)                          | 81 GiB libres de 467 GiB (82% usado) — **compartido con 66 contenedores ajenos** |
| `pg_dump`/`pg_restore` disponibles dentro de `koinonia-postgres`               | Sí, versión 16.14 (imagen `postgres:16-alpine`)                                  |

**Con la retención por defecto (14 copias):** 14 × ~54 KiB ≈ **760 KiB** — irrelevante frente a los
81 GiB libres. Incluso si la base creciera 1000× desde hoy (algo que llevaría años de uso real al
ritmo actual: hoy son sólo 20 tablas de gobernanza para un instituto, no una red social), 14 copias
de ~54 MiB cada una seguirían siendo ~760 MiB, menos del 1% del espacio libre de hoy. La retención
de 14 copias tiene margen de sobra para crecer sin revisarse — si algún día la base crece órdenes de
magnitud más que esto (una migración de datos histórica masiva, por ejemplo), vale la pena volver a
mirar este número, pero no antes.

## 8. La limitación honesta: esto vive en la MISMA máquina

**Una copia en el mismo disco que protege no protege de perder la máquina entera.** Si el VPS
`167.114.118.213` se vuelve irrecuperable — disco roto, proveedor que da de baja la cuenta, fuego —
`/opt/koinonia/copias/` desaparece exactamente al mismo tiempo que `koinonia-pgdata`. Este mecanismo
resuelve "alguien borró una tabla por error" o "una migración salió mal" (que, dicho sea de paso, es
el caso que `DESPLIEGUE.md` §6 marcaba explícitamente como no cubierto). **No resuelve "se perdió la
VPS."**

**A dónde debería salir la copia — propuesta, sin implementar:**

Este mismo host ya tiene el patrón resuelto para otros proyectos: `demeter-backup.service` y
`cauce-v3-control-plane-backup.service` envían sus respaldos a un NAS fuera de la VPS (se puede leer
en sus propias unidades systemd, ya instaladas). Lo más simple sería sumar un tercer paso al final
de `copia-de-seguridad.sh` que haga `rsync`/`scp` de la copia recién verificada hacia ese mismo NAS,
si Koinonía tiene (o puede tener) credenciales para alcanzarlo — o, si no, un destino tipo
Backblaze B2 / S3-compatible con `rclone`, que es lo mismo que el patrón del NAS pero fuera de la
red del proveedor de la VPS (protege además contra un incidente del lado del proveedor, no sólo
del hardware).

**No lo implementé** porque no tengo forma de verificar por SSH, en lectura, si Koinonía ya tiene
acceso a ese NAS, ni credenciales de ningún destino externo — y un script de subida a un destino que
no pude probar es exactamente el tipo de "copia que da confianza sin respaldo" que este documento
existe para evitar. Es una decisión que le toca a una persona con esas credenciales en la mano.

Un matiz adicional para quien tome esa decisión: `identity.member`, `identity.private_material`,
`identity.magic_link` y `identity.session` contienen datos personales del padrón (la propia
ADR-0042 hace de la ESAL estudiantil la responsable del tratamiento de esos datos). Sacar una copia
de la VPS no es sólo un problema de logística — cualquier destino externo tiene que sostener, como
mínimo, el mismo nivel de acceso restringido y cifrado en tránsito/reposo que hoy sostiene la propia
VPS. Eso es parte de por qué esta decisión no se tomó por defecto acá.

### 8.1. Lo que SÍ se puede hacer hoy, sin credenciales de nadie

Todo lo de arriba sigue en pie: el destino externo definitivo es una decisión con credenciales que
esta documentación no puede tomar. Pero mientras tanto hay algo que reduce el riesgo de golpe y no
depende de nadie más — **traerse la copia a una máquina propia**:

```bash
# La más reciente, verificando su huella al llegar.
ssh root@167.114.118.213 'ls -t /opt/koinonia/copias/*.dump | head -1' \
  | xargs -I{} scp root@167.114.118.213:{} .
ssh root@167.114.118.213 'ls -t /opt/koinonia/copias/*.dump.sha256 | head -1' \
  | xargs -I{} scp root@167.114.118.213:{} .
sha256sum -c ./*.dump.sha256
```

Con eso, perder la VPS pasa de «se pierde todo» a «se pierde lo de hoy». No es un sistema de copias
fuera de sitio y no hay que llamarlo así: es una persona acordándose. Pero una copia en otra máquina
vale infinitamente más que ninguna, y cuesta un minuto.

**Con la misma advertencia de arriba, y va en serio:** ese fichero lleva el padrón con datos
personales. La máquina a la que lo traigas tiene que sostener el mismo cuidado que sostiene la VPS
—disco cifrado, y no dejarlo en una carpeta compartida ni en un servicio de sincronización— o el
remedio abre un agujero peor que el que cierra. Si no podés sostener eso, es mejor no bajarlo y
apurar el destino externo.

## 9. Referencia rápida: qué NO hacer

- No corras `restaurar-copia.sh --produccion` fuera de una terminal interactiva con una persona
  mirando — el script se niega solo, pero no confíes en eso como única barrera.
- No borres a mano un fichero `.SOSPECHOSA`: es evidencia de que algo falló en esa corrida
  puntual. Mirá `journalctl -u koinonia-copia.service` para esa fecha antes de decidir qué hacer con
  él.
- No cambies `KOINONIA_COPIA_RETENCION` a un número muy alto "por las dudas" sin mirar §7 primero:
  el disco es compartido con 66 contenedores ajenos.
- No asumas que porque el timer corrió anoche sin error la copia sirve para algo — eso es lo que
  cubre el simulacro mensual de §6, no una suposición.
- No pongas estos scripts a correr desde `/opt/koinonia/repo/`: ese árbol se reescribe con
  `rsync --delete` en cada build (`DESPLIEGUE.md` §2.1) y un `koinonia-copia.service` que apunte ahí
  puede quedarse sin el fichero que invoca en medio de un despliegue de código.
