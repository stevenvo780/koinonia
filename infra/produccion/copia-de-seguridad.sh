#!/usr/bin/env bash
# Copia de seguridad de la base de datos de Koinonía en producción.
#
# QUÉ hace: un pg_dump EN FORMATO CUSTOM comprimido, ejecutado DENTRO del contenedor
# koinonia-postgres (`docker exec`). Nunca copia los ficheros del volumen.
#
# POR QUÉ pg_dump y no copiar el volumen: PostgreSQL sigue vivo mientras esto corre.
# Copiar /var/lib/postgresql/data en caliente (tar, rsync, snapshot de ficheros) puede
# capturar páginas de datos a mitad de escribir y WAL sin aplicar todavía: el
# resultado a veces no restaura, y una copia que no se sabe si restaura es peor que no
# tener copia — da una falsa sensación de estar cubiertos. pg_dump, en cambio, toma un
# snapshot MVCC consistente del contenido lógico sin detener nada ni bloquear
# escrituras.
#
# POR QUÉ formato custom (-Fc): es el único formato de pg_dump que pg_restore puede
# INSPECCIONAR con --list sin restaurar nada — es la base de la verificación de más
# abajo. Además viene comprimido, así que no hace falta un gzip aparte.
#
# CÓMO falla: con `set -euo pipefail` y un trap en ERR. Cualquier fallo deja un código
# de salida distinto de 0, que systemd marca como servicio "failed" — visible con
# `systemctl status koinonia-copia.service` y `journalctl -u koinonia-copia.service`.
# Una copia que falla en silencio es peor que ninguna: da confianza sin respaldo real.

set -euo pipefail

# --- Configuración (valores por defecto pensados para /opt/koinonia en la VPS) ---
CONTENEDOR="${KOINONIA_PG_CONTENEDOR:-koinonia-postgres}"
BASE="${KOINONIA_PG_BASE:-koinonia}"
USUARIO_PG="${KOINONIA_PG_USUARIO:-postgres}"
DESTINO="${KOINONIA_COPIA_DESTINO:-/opt/koinonia/copias}"
# Cantidad de copias VÁLIDAS a conservar (no días: ver la nota junto a la rotación).
RETENCION="${KOINONIA_COPIA_RETENCION:-14}"

FECHA="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="koinonia-${FECHA}"
ARCHIVO_TMP="${DESTINO}/.${BASENAME}.dump.tmp"
ARCHIVO_FINAL="${DESTINO}/${BASENAME}.dump"
ARCHIVO_HUELLA="${ARCHIVO_FINAL}.sha256"
RUTA_TEMPORAL_EN_CONTENEDOR="/tmp/verificacion-${BASENAME}.dump"

registro() { echo "[$(date -u +%FT%TZ)] $*"; }
error() { echo "[$(date -u +%FT%TZ)] ERROR: $*" >&2; }

limpiar() {
  # Un fichero .tmp a medio escribir no debe quedar donde la rotación o un operador
  # humano puedan confundirlo con una copia real.
  [ -f "$ARCHIVO_TMP" ] && rm -f "$ARCHIVO_TMP"
  # El fichero que se copió DENTRO del contenedor para poder correr pg_restore
  # --list vive en la capa de escritura efímera del contenedor, no en el volumen de
  # datos — pero igual conviene no dejarlo tirado ahí día tras día.
  docker exec "$CONTENEDOR" rm -f "$RUTA_TEMPORAL_EN_CONTENEDOR" 2>/dev/null || true
}
trap limpiar EXIT
trap 'error "la copia de seguridad terminó en fallo (línea $LINENO). Ver el detalle arriba."' ERR

mkdir -p "$DESTINO"

if ! docker inspect -f '{{.State.Running}}' "$CONTENEDOR" 2>/dev/null | grep -q true; then
  error "el contenedor '$CONTENEDOR' no existe o no está corriendo. No hay de dónde volcar."
  exit 1
fi

registro "iniciando volcado de '$BASE' desde el contenedor '$CONTENEDOR'..."

# Cuántas tablas hay AHORA MISMO, para comparar contra lo que efectivamente quedó
# adentro del volcado. Se toma justo antes del pg_dump: si algo se crea o se borra
# entre esta consulta y el dump la comparación de abajo puede fallar por una sola
# tabla de diferencia — se prefiere una falsa alarma ocasional a dar por buena una
# copia incompleta.
TABLAS_ESPERADAS="$(docker exec "$CONTENEDOR" psql -U "$USUARIO_PG" -d "$BASE" -t -A -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast');")"

if ! [[ "$TABLAS_ESPERADAS" =~ ^[0-9]+$ ]] || [ "$TABLAS_ESPERADAS" -eq 0 ]; then
  error "no se pudo contar las tablas de origen (obtuve: '${TABLAS_ESPERADAS}'). Abortando antes de confiar en el volcado."
  exit 1
fi

docker exec "$CONTENEDOR" pg_dump -U "$USUARIO_PG" -Fc -d "$BASE" > "$ARCHIVO_TMP"

TAMANO=$(stat -c '%s' "$ARCHIVO_TMP" 2>/dev/null || stat -f '%z' "$ARCHIVO_TMP")
if [ "$TAMANO" -lt 1024 ]; then
  error "el volcado dio ${TAMANO} bytes, sospechosamente chico para una base con ${TABLAS_ESPERADAS} tablas. Abortando."
  exit 1
fi

mv "$ARCHIVO_TMP" "$ARCHIVO_FINAL"
registro "volcado escrito: ${ARCHIVO_FINAL} (${TAMANO} bytes)"

# --- Verificación: sin esto, lo de arriba es un fichero, no una copia de seguridad ---
#
# Paso 1: que pg_restore pueda LEER el archivo. Si quedó corrupto (corte de disco,
# proceso matado a mitad de la compresión), --list falla y lo notamos ahora — no el
# día que haga falta restaurar de verdad.
#
# pg_restore vive dentro del contenedor de postgres, no en este host, así que hay que
# copiarle el fichero adentro (`docker cp`) para poder invocarlo. `docker cp` escribe
# en la capa de escritura EFÍMERA del contenedor, no en el volumen de datos: esto no
# toca koinonia-pgdata ni la base real.
docker cp "$ARCHIVO_FINAL" "${CONTENEDOR}:${RUTA_TEMPORAL_EN_CONTENEDOR}"

LISTADO="$(docker exec "$CONTENEDOR" pg_restore --list "$RUTA_TEMPORAL_EN_CONTENEDOR")" || {
  error "pg_restore --list no pudo leer el volcado recién escrito. El archivo está corrupto: ${ARCHIVO_FINAL}"
  mv "$ARCHIVO_FINAL" "${ARCHIVO_FINAL}.SOSPECHOSA"
  exit 1
}

# Paso 2: que el NÚMERO de tablas adentro del volcado coincida con las que había en
# origen. Un pg_dump que termina con código de salida 0 pero con menos tablas de las
# que hay (un permiso denegado silencioso en una tabla puntual, por ejemplo) igual
# sale con éxito aparente; contar es la única manera de notarlo.
TABLAS_EN_VOLCADO="$(printf '%s\n' "$LISTADO" | grep -c ' TABLE DATA ' || true)"

if [ "$TABLAS_EN_VOLCADO" -ne "$TABLAS_ESPERADAS" ]; then
  error "el volcado tiene ${TABLAS_EN_VOLCADO} tablas y la base de origen tenía ${TABLAS_ESPERADAS}. NO coincide."
  mv "$ARCHIVO_FINAL" "${ARCHIVO_FINAL}.SOSPECHOSA"
  exit 1
fi

registro "verificación OK: ${TABLAS_EN_VOLCADO} tablas en el volcado, igual a las ${TABLAS_ESPERADAS} de origen."

sha256sum "$ARCHIVO_FINAL" | awk -v n="$(basename "$ARCHIVO_FINAL")" '{print $1"  "n}' > "$ARCHIVO_HUELLA"
registro "huella escrita: ${ARCHIVO_HUELLA}"

# --- Rotación: por CANTIDAD de copias válidas, no por antigüedad en días ---
#
# Por cantidad y no por fecha para que un día de máquina apagada (el timer no corrió)
# no adelante el borrado de copias antes de que haya suficientes reemplazos, y para
# que una corrida manual extra el mismo día no dispare un borrado prematuro. Las
# copias marcadas .SOSPECHOSA nunca cuentan como válidas y nunca se autoborran: quedan
# para que un humano las mire, hasta que ese humano decida qué hacer con ellas.
#
# Lo mismo aplica a las copias de emergencia que hace restaurar-copia.sh --produccion
# (`koinonia-ANTES-DE-RESTAURAR-<fecha>.dump`, en este mismo directorio): el patrón
# `koinonia-*.dump` las alcanza igual que a cualquier copia nocturna, así que sin este
# `grep -v` de acá una restauración de emergencia real terminaría, con el tiempo,
# borrada por esta MISMA rotación automática — justo el fichero que existe para que un
# humano decida qué hacer si algo sale mal. Se las excluye por el mismo motivo que a
# las .SOSPECHOSA: son evidencia/red de seguridad para un humano, no turnos de la
# rotación.
mapfile -t COPIAS_VALIDAS < <(ls -1t "${DESTINO}"/koinonia-*.dump 2>/dev/null \
  | grep -v '\.SOSPECHOSA$' \
  | grep -v -- '-ANTES-DE-RESTAURAR-' || true)

if [ "${#COPIAS_VALIDAS[@]}" -gt "$RETENCION" ]; then
  for ((i = RETENCION; i < ${#COPIAS_VALIDAS[@]}; i++)); do
    VIEJA="${COPIAS_VALIDAS[$i]}"
    registro "rotando copia vieja: ${VIEJA}"
    rm -f "$VIEJA" "${VIEJA}.sha256"
  done
fi

RESTANTES=$(ls -1 "${DESTINO}"/koinonia-*.dump 2>/dev/null \
  | grep -v '\.SOSPECHOSA$' \
  | grep -vc -- '-ANTES-DE-RESTAURAR-' || true)
registro "copia de seguridad completa. ${RESTANTES} copias válidas en ${DESTINO} (retención configurada: ${RETENCION})."
