# El anclaje externo — qué es, qué protege, y cómo encenderlo

> Este documento vive junto a `.env.ejemplo` y `DESPLIEGUE.md`. Es la pieza que faltaba: los otros
> dos dicen CÓMO se levanta el sistema; éste dice qué pasa —y qué NO pasa— cuando se enciende el
> anclaje. Escrito el 2026-08-24, tras la primera ejecución real de OpenTimestamps contra los cuatro
> calendarios de producción (ver §5).

## 1. Qué es, en una frase

El anclaje registra, **fuera de este servidor**, el resumen (raíz Merkle) del historial completo de
decisiones, a intervalos regulares. La pregunta que responde no es «¿el historial es coherente
consigo mismo?» —eso ya lo comprueba `/integridad` sin salir a ningún lado— sino **«¿alguien con
acceso a la base de datos pudo reescribir el pasado sin que quede rastro?»**.

## 2. Qué protege exactamente, y de quién

El adversario no es un desconocido: es **el administrador técnico de esta misma plataforma**, o
cualquiera que consiga sus credenciales (rotación de personal sin revocar claves, un `.env`
filtrado, una sesión SSH a las 3 a. m.). `docs/THREAT_MODEL.md` lo llama **F-1** y es explícito en
que la respuesta **no es prevención, es detección**: quien tiene `root` en la VPS puede, en
principio, conectarse a PostgreSQL con el rol de migración y `UPDATE`/`DELETE` sobre
`governance.event` — el trigger append-only de la migración 0002 lo impide en marcha normal, pero
ese mismo rol puede desactivar el trigger. Contra ESE adversario, ninguna comprobación que viva
dentro del propio servidor prueba nada: si reescribe los datos y recalcula la cadena, la cadena
recalculada es internamente perfecta. `docs/THREAT_MODEL.md` T-01 lo dice con la palabra exacta:

> Detectab. alta **sólo si el anclaje funciona** — la raíz recalculada no coincide con OTS, git ni
> testigos; **nula sin anclaje operativo**.

El anclaje es lo único del sistema que no depende de este servidor para ser cierto: registra el
resumen en sitios que el administrador de Koinonía no controla. Si después reescribe la historia, el
resumen nuevo que calcula ya **no coincide** con el que quedó registrado afuera en la fecha vieja —y
eso sí es comprobable por cualquiera, sin confiar en el servidor.

Lo que el anclaje **no** hace, y no hay que dejar que se lea de más: no impide la manipulación (eso
es competencia de la etapa 2, con papeletas firmadas — ADR-0018). No prueba que un evento concreto
sea "verdadero" en ningún sentido de contenido. Sólo prueba que un resumen concreto existía, sin
alterar, en una fecha concreta.

## 3. Las tres clases de independencia, y dónde está cada una hoy

`packages/anchor` implementa tres proveedores, uno por clase (ADR-0016, `packages/anchor/src/types.ts`):

| Clase           | Proveedor                | Qué prueba                                                                                                                               | Estado hoy                                                                                                                                               |
| --------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockchain`    | `OpenTimestampsProvider` | El resumen existía antes de cierto bloque de Bitcoin                                                                                     | **Operativo de punta a punta.** Verificado hoy contra los 4 calendarios reales (§5).                                                                     |
| `vcs`           | `SignedGitProvider`      | Un commit firmado por la veeduría, con el resumen en el mensaje, publicado en dos forjas independientes que coinciden en el mismo objeto | **No operativo.** El código funciona (probado con firmantes y forjas simuladas); falta el repositorio real de anclaje con firmas de la veeduría. Ver §7. |
| `human-witness` | `WitnessEmailProvider`   | Varias personas de dominios distintos acusaron recibo de un correo firmado (DKIM) con el resumen                                         | **No operativo.** El código funciona; falta designar testigos y configurar SMTP/IMAP/DKIM del anclaje. Ver §7.                                           |

`independenceClass` no es decorativa: dos proveedores de la misma clase sólo cuentan como un testigo
(`packages/anchor/src/quorum.ts`, motivo `clase-repetida`). Que las tres sean de naturaleza distinta
— una prueba criptoeconómica pública, un repositorio de código con firma personal, y personas de
carne y hueso — es lo que hace falso que "controlar una cosa" baste para falsificar el quórum.

## 4. El quórum: por qué hacen falta DOS, no una

`evaluateQuorum()` (`packages/anchor/src/quorum.ts`) exige confirmación de **dos clases distintas**
para declarar un checkpoint `FIRME`. El mínimo (`MIN_INDEPENDENCE_CLASSES = 2`) no es configurable a
la baja en producción — está fijado en el código, no en una variable de entorno, precisamente para
que nadie pueda relajarlo desde el `.env`.

Sin quórum, el estado es uno de tres, según cuánto tiempo lleva sin lograrse:

- **`NO_ANCLADO`** — el estado normal en las primeras 24 h tras cada checkpoint. No es alarma.
- **`NO_ANCLADO_ALERTA`** — 24 h sin quórum.
- **`NO_ANCLADO_CRITICO`** — 72 h sin quórum. La política (documentada, no forzada por código: ver
  §6) dice que las decisiones de ese lapso quedan "pendientes de confirmación de integridad".

Este cálculo se ejecuta de verdad, cada ciclo, y su resultado se escribe como evento
`AnclajeEstadoPublicado` en el agregado `#anclaje` del ledger (`packages/anchor/src/cycle.ts:188`,
`packages/anchor/src/events.ts:125`) — es decir, **queda registrado siempre**, encienda lo que
encienda. Lo que hace cada clase adicional es cambiar QUÉ se registra ahí.

## 5. Lo ya verificado hoy: OpenTimestamps funciona de verdad

Se ejecutó `services/api/src/anchor/verificacion-manual.ts sellar` contra los cuatro calendarios
reales de producción (`alice.btc.calendar.opentimestamps.org`, `bob.btc.calendar.opentimestamps.org`,
`finney.calendar.eternitywall.com`, `btc.calendar.catallaxy.com` — los mismos que trae por defecto el
cliente oficial, y de tres operadores distintos, no uno solo repetido). El `.ots` resultante se
contrastó con el **cliente oficial** (`ots info`), que no ha visto nunca este repositorio: mismo
`sha256`, mismas cuatro atestaciones pendientes. Es la primera vez que esto corre en la historia del
proyecto — hasta hoy, `httpCalendar()` nunca se había ejecutado contra un calendario real (era la
tarea 3 de `docs/HANDOFF.md`, ver §5 más abajo del propio HANDOFF; corregida en este mismo cambio).

Lo que esto prueba: el diálogo HTTP con OpenTimestamps funciona, produce un `.ots` que el cliente
oficial reconoce como legítimo, y nuestro verificador (`packages/anchor/src/providers/opentimestamps.ts`)
lo lee correctamente. Lo que esto **no** prueba: que un sello concreto haya madurado hasta un bloque
de Bitcoin — eso tarda entre 1 y 6 horas y no se esperó, a propósito, porque la comprobación que
importaba era el diálogo, no la espera.

También están verificadas por lectura HTTP real (no simulacro) las forjas: `codebergForge().head()`
devolvió el SHA real de un repositorio público de prueba. El token de forja es **opcional** — sólo
hace falta para repositorios privados o para no toparse con el límite de 60 peticiones/hora sin
autenticar.

El correo con testigos **no se pudo probar**: no hay SMTP/IMAP/DKIM disponibles en el entorno donde
se hizo esta verificación.

## 6. Qué se gana encendiendo SOLO OpenTimestamps hoy — y qué NO se gana

Esta es la pregunta central de este documento, y la respuesta tiene dos mitades igual de
importantes.

### Lo que SÍ se gana

Una reescritura silenciosa del historial deja de ser indetectable **en principio**. Hoy, sin ningún
anclaje activo, un administrador que altera `governance.event` con el trigger desactivado y
recalcula la cadena produce un historial internamente perfecto: nada en el propio servidor puede
distinguirlo del real. Con OpenTimestamps encendido, cada checkpoint que se sella queda registrado en
Bitcoin — un libro que el administrador de Koinonía no controla ni puede reescribir. Si después
altera la historia, el resumen que recalcula ya no coincide con el que Bitcoin atestigua para esa
fecha, y **cualquiera que compare los dos números, sin confiar en el servidor, lo nota**. Ese
contraste es real hoy: `packages/verifier-cli` (el verificador independiente, con implementación
propia, no reutilizada del servidor) lo hace y emite el código `ANCLAJE_NO_CORRESPONDE` — severidad
**alarma** — exactamente cuando eso pasa.

Además, cada checkpoint sellado con OpenTimestamps queda registrado en el propio ledger, dentro del
agregado append-only `#anclaje` (`AnclajeIntentado` / `AnclajeConfirmado` / `AnclajeFallido`): borrar
esa constancia exige la misma alteración de la cadena que el anclaje existe para detectar. Es una
capa más de coste para quien quiera encubrir algo, aunque por sí sola —sin la clase externa
confirmada— no cierre el caso.

### Lo que NO se gana

**No hay quórum de firma, nunca.** Con una sola clase activa, `evaluateQuorum()` jamás puede alcanzar
las dos clases distintas que exige `FIRME` — es aritméticamente imposible, no un defecto de
configuración. En la práctica esto significa que **todo checkpoint, para siempre, escalará** de
`NO_ANCLADO` a `NO_ANCLADO_ALERTA` (24 h) y a `NO_ANCLADO_CRITICO` (72 h), aunque el sello de
OpenTimestamps en sí mismo haya madurado perfectamente hasta Bitcoin. Esto **no es un fallo**: es el
sistema diciendo la verdad sobre su propia cobertura. Si al mirar el ledger o correr el verificador
aparece `NO_ANCLADO_CRITICO` con sólo OpenTimestamps activo, eso es exactamente lo esperado y no una
avería que arreglar.

**Nadie lo ve sin buscarlo.** No existe hoy ninguna alarma automática: se buscó en todo el
repositorio (`docs/THREAT_MODEL.md`, corrección del 2026-08-24 sobre T-17) cualquier tarea
programada que compare la edad del último checkpoint con un umbral y avise a alguien, y no existe
ninguna. Tampoco hay una fila de anclaje en `/integridad` ni en `/portada`: ese endpoint enumera seis
comprobaciones (cadena, material privado, textos, resultados, conversaciones, ejecución) y ninguna es
sobre el anclaje (`services/api/src/http/app.ts:1601`). El evento `AnclajeEstadoPublicado` sí se
escribe cada ciclo — el comentario en `packages/anchor/src/events.ts:16` dice "es lo que la portada
lee", pero hoy **nada en `services/api/src/http` lee el agregado `#anclaje`**: ese enunciado describe
una intención, no el estado actual del código. La única manera de ver el veredicto hoy es exportar el
historial y correr `@koinonia/verificador` a mano (§8).

**No protege la última hora.** Con los valores por defecto (checkpoint cada 60 min, maduración de
OpenTimestamps entre 1 y 6 h), siempre hay una ventana móvil de varias horas en la que lo más
reciente todavía no tiene un sello externo maduro. Un administrador que actuara dentro de esa
ventana, y que además lograra revertir el checkpoint recién cortado antes de que madurara, dejaría
una oportunidad — acotada, pero real — que el anclaje por sí solo no cierra.

**No añade las otras dos clases.** git y correo siguen sin infraestructura (§7). Mientras tanto el
anclaje real de este despliegue es de una sola pata, y así hay que decirlo en cualquier conversación
sobre "¿está protegido el historial?": **detectable si alguien mira, no protegido para efectos de
gobernanza** (el quórum es lo que activa la consecuencia de "decisiones pendientes de confirmación
de integridad", y eso exige la segunda clase).

## 7. Qué falta para las otras dos clases

### 7.1. Clase `vcs` — el repositorio de anclaje

`SignedGitProvider` (`packages/anchor/src/providers/signed-git.ts`) **nunca firma en el servidor** —
por diseño: si la clave privada viviera en la VPS, este anclaje sería teatro, porque el mismo
administrador que reescribiera la historia podría firmar la versión falsa. En cambio, cada ciclo
produce una **solicitud de firma** (recibo `pendiente`) con las instrucciones exactas:

> "En el equipo de la veeduría: añadí la línea de compromiso a `CHECKPOINTS.txt`, firmá el commit con
> la clave SSH del padrón y empujalo a las forjas declaradas."

Lo que hace falta montar, fuera de este servidor, en el equipo de alguien de la veeduría:

1. **Un repositorio de anclaje** (uno en Codeberg y uno en GitHub, mismo contenido, dos forjas de
   dueños distintos — nunca sólo una: es punto único de fallo y así lo avisa
   `services/api/src/anchor/configuracion.ts:358`). Con un fichero `CHECKPOINTS.txt` que vaya
   acumulando, por checkpoint, la línea `koinonia-checkpoint: <hex del checkpointHash>`
   (`checkpointBindingLine()`, `packages/anchor/src/providers/signed-git.ts:58`).
2. **Un par de claves SSH Ed25519** que NO viva en la VPS — en el portátil de un miembro de la
   veeduría, o en un gestor de secretos externo. Esa persona, cada vez que el anclaje del ciclo
   anterior deje una solicitud pendiente, añade la línea a `CHECKPOINTS.txt`, hace commit firmado con
   `git commit -S` usando esa clave SSH (no GPG), y empuja el mismo commit a las dos forjas.
3. **El padrón de firmantes** en el `.env` de la API: `KOINONIA_ANCLAJE_FIRMANTES`, con la clave
   pública (nunca la privada) de cada persona autorizada — ver el bloque en `.env.ejemplo`.
4. **`KOINONIA_ANCLAJE_CLAVE_FUERA_DEL_SERVIDOR=si`** — declarado explícitamente. Su valor por
   defecto es `false` a propósito (§2 de `configuracion.ts`): sin esta línea, el anclaje de git se
   arma igual pero **no cuenta para el quórum**, y el arranque lo dice cada vez. No la pongas en `si`
   si la clave privada, en algún momento, tocó esta máquina.
5. **`KOINONIA_ANCLAJE_CODEBERG_REPO`** y **`KOINONIA_ANCLAJE_GITHUB_REPO`** (formato
   `propietario/repositorio`), y opcionalmente un token por forja si el repositorio es privado o para
   no toparse con el límite de peticiones sin autenticar.

Sin repositorio real, `git` en la configuración queda con `repos: []`, y el arranque avisa: "se
verificará la firma del commit, pero NADIE comprobará que está publicado". Esa combinación —firmantes
puestos, repos vacíos— no es un estado intermedio útil: hace falta lo uno y lo otro.

### 7.2. Clase `human-witness` — los testigos de correo

`WitnessEmailProvider` manda un correo firmado (DKIM) con el resumen a un padrón de testigos, y
cuenta acuses de recibo de **dominios distintos** (mínimo configurable, por defecto 3). Hace falta:

1. **Un padrón de testigos reales**: personas de la veeduría, con perfiles enfrentados a propósito
   (§8.4 de `THREAT_MODEL.md`: si dos coluden o ninguno verifica, el anclaje es decorativo), al menos
   uno externo al Instituto. Se declara en `KOINONIA_ANCLAJE_TESTIGOS`
   (`id|correo|clave-pública-opcional;...`, ver `.env.ejemplo`).
2. **SMTP saliente** para el anclaje — puede ser el mismo Postfix que ya usa Koinonía para el correo
   de entrada (`KOINONIA_SMTP_*`), con variables **separadas** (`KOINONIA_ANCLAJE_SMTP_*`) porque el
   remitente del anclaje no tiene por qué ser el mismo buzón que el de las sesiones.
3. **IMAP para recoger los acuses** (`KOINONIA_ANCLAJE_IMAP_*`). Sin esto el correo sale pero nadie
   recoge las respuestas, y el anclaje nunca pasa de `pendiente` — el arranque lo avisa.
4. **DKIM** (`KOINONIA_ANCLAJE_DKIM_*`): una clave privada RSA o Ed25519 propia del anclaje, **en un
   fichero, nunca en una variable de entorno** (una clave en el entorno acaba en `docker inspect` y en
   el registro del orquestador). Sin DKIM el correo sale sin firmar y una parte previsible acaba en
   spam, que se parece mucho a un testigo que calla.

### 7.3. Una brecha operativa que conviene conocer antes de decidir el resto

El verificador independiente (`@koinonia/verificador`, `packages/verifier-cli`) necesita un paquete
completo — eventos, checkpoints, cabeceras de Bitcoin, manifiesto — que produce `buildExport()`
(`services/api/src/ledger/export.ts`). **Hoy esa función no está conectada a ninguna ruta HTTP.** La
única exportación que expone el servidor, `GET /integridad/exportar`, usa `exportarTodo()`
(`services/api/src/http/service.ts:3446`), que sólo trae la lista de eventos — sin checkpoints ni
recibos de anclaje — y que el verificador **no puede leer** (le faltan los ficheros que exige su
manifiesto). Hoy, `buildExport()` sólo se invoca desde las pruebas de integración
(`tests/integration/anclaje-y-export.test.ts`, `http-deliberacion.test.ts`). Para que alguien de la
veeduría pueda correr el verificador contra producción sin acceso directo a la base, hace falta o (a)
exponer `buildExport()` en una ruta HTTP nueva, o (b) un script que lo invoque directamente contra
`DATABASE_URL` de producción y escriba el paquete a disco. Ninguna de las dos existe todavía; es
trabajo de código, fuera del alcance de este encargo, y queda anotado aquí para no perderlo.

## 8. Cómo encenderlo

1. En `/opt/koinonia/.env`, cambiá `KOINONIA_ANCLAJE=false` por `KOINONIA_ANCLAJE=true` (o borrá la
   línea entera: el valor por defecto en producción ya es encendido — ver el comentario de esa línea
   en `.env.ejemplo`). Con eso solo, arranca únicamente la clase `blockchain`; git y correo se quedan
   apagados y el arranque dice por qué, línea por línea.
2. `cd /opt/koinonia && docker compose up -d`. Hace falta `up -d`, no `restart`: el contenedor de la
   API toma sus variables de `env_file: /opt/koinonia/.env` **al crearse**, y `restart` reinicia el
   mismo contenedor sin releer el fichero. `up -d` sólo recrea `koinonia-api` (postgres y web no
   cambiaron).
3. `docker logs koinonia-api --tail 80`. Buscá, en este orden:
   - La línea de arranque general (correo, base de datos) — ya conocida, sin cambios.
   - Líneas con prefijo `[anclaje]`. Si sigue apagado verías `APAGADO. Se enciende con
KOINONIA_ANCLAJE=1…`; con esta variable en `true` verías en cambio, por cada motivo de ausencia
     de git y correo, una línea explicando por qué (p. ej. "anclaje por git APAGADO: sin
     KOINONIA_ANCLAJE_FIRMANTES…"), y al final: `encendido: corte cada 60 min, maduración cada 60
min, 4 calendarios, 0 anclaje(s) de git y 0 de correo`.
4. **El primer checkpoint tarda hasta `KOINONIA_ANCLAJE_CHECKPOINT_MINUTOS` (60 min por defecto) en
   cortarse** — el arranque no fuerza uno inmediato, sólo arma el temporizador. En cuanto se corta,
   el ciclo de anclaje se dispara al instante (sin esperar al `poll`), y aparece una línea
   `[anclaje] checkpoint <N>: NO_ANCLADO (ninguna clase confirmada)` — es exactamente lo esperado:
   OpenTimestamps acaba de sellar, y un sello recién sellado está `pendiente`, nunca `confirmado`.
5. **La maduración hasta Bitcoin tarda entre 1 y 6 horas.** Cada `KOINONIA_ANCLAJE_POLL_MINUTOS` (60
   min por defecto) se reintenta madurar los checkpoints pendientes. Cuando un sello madura, aparece
   `cabeceras de bloque guardadas para el checkpoint <N>: … — el verificador independiente ya puede
cerrar el sello`. El estado publicado en el ledger seguirá siendo `NO_ANCLADO` (y, pasadas 24 y 72
   horas desde la EMISIÓN del checkpoint, `NO_ANCLADO_ALERTA` y `NO_ANCLADO_CRITICO`) mientras sólo
   haya una clase — eso ya está explicado en §6 y no hay que tratarlo como una avería.
6. Para comprobar que el propio sello es legítimo, sin confiar en nuestro código: instalá el cliente
   oficial (`pipx install opentimestamps-client`) y corré `ots info <ots recién sellado>` — pero el
   `.ots` en sí sólo se escribe a disco corriendo `verificacion-manual.js` a mano (§5); en producción,
   el recibo vive dentro de `governance.anchor_attempt`, columna `receipt` (texto, no jsonb —
   comentario de la migración 0006). Para inspeccionarlo desde la base:

   ```sql
   -- Estado de los intentos, más recientes primero:
   SELECT tree_size, provider, independence_class, state, updated_at
     FROM governance.anchor_attempt
    ORDER BY tree_size DESC, provider;

   -- Los checkpoints emitidos (nota: la columna `firm` NUNCA se pone en true — koinonia_app
   -- sólo tiene SELECT/INSERT sobre esta tabla, ver docs/HANDOFF.md tarea 10 — lo autoritativo
   -- es siempre el evento AnclajeEstadoPublicado, no esta columna):
   SELECT tree_size, issued_at, firm FROM governance.checkpoint ORDER BY tree_size DESC LIMIT 10;
   ```

### Señales de que funcionó

- El arranque imprime `encendido: …` y no `APAGADO`.
- Tras el primer corte, `governance.anchor_attempt` tiene una fila `provider = 'ots'`,
  `independence_class = 'blockchain'`, `state = 'PENDIENTE'`.
- Tras 1-6 h y el siguiente ciclo de maduración, esa misma fila pasa a `state = 'CONFIRMADO'` y
  aparece la línea de "cabeceras de bloque guardadas" en el registro.
- El anclaje **nunca** debería aparecer como `FALLIDO` de forma sostenida — un fallo puntual (un
  calendario caído) es tolerable (`minCalendarios` por defecto es 1, basta con que uno responda);
  fallos repetidos en TODOS los calendarios sí ameritan mirar conectividad saliente de la VPS.

### Señales de que hay que apagarlo

- Fallos sostenidos en los cuatro calendarios a la vez (posible bloqueo de salida HTTPS desde la
  VPS, o los cuatro servicios caídos a la vez — improbable pero no imposible).
- Si en algún momento se activa la clase `vcs` o `human-witness` y aparece un
  `ANCLAJE_NO_CORRESPONDE` o `ANCLAJE_INVALIDO` al correr el verificador — eso NO se arregla
  apagando el anclaje, se arregla siguiendo el protocolo de `THREAT_MODEL.md` §8.4
  ("Administrador acusado de manipular"): apagar el anclaje en ese momento sería destruir la
  evidencia, no una respuesta razonable.
- Ninguna otra razón debería llevar a apagarlo: es un proceso de fondo, no bloquea el arranque
  (`server.ts`: `app.listen()` corre antes que `anclaje.arrancar()`), y un fallo del ciclo de
  anclaje no tumba el servidor — sólo queda escrito en el registro y se reintenta en el ciclo
  siguiente (`services/api/src/anchor/tarea.ts`, función `enCola`).

## 9. Cómo apagarlo

1. En `/opt/koinonia/.env`, poné `KOINONIA_ANCLAJE=false` explícitamente (no basta con borrar la
   línea: el valor por defecto en producción es encendido).
2. `cd /opt/koinonia && docker compose up -d` (mismo motivo que al encender: hace falta recrear el
   contenedor para que relea el `.env`).
3. `docker logs koinonia-api --tail 20` debería volver a mostrar `[anclaje] APAGADO…`.
4. Nada se pierde: los checkpoints ya emitidos y sus recibos siguen en `governance.checkpoint` y
   `governance.anchor_attempt`, y los eventos ya escritos siguen en el ledger, append-only, como
   todo lo demás. Apagar el anclaje detiene los ciclos futuros; no borra ni desancla nada de lo ya
   hecho.
