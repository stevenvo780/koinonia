#!/usr/bin/env bash
# Restaura una copia de seguridad de Koinonía. Leé esto ANTES de correrlo.
#
# Dos modos. Uno es seguro por defecto; el otro es destructivo y hay que pedirlo a
# propósito.
#
#   ./restaurar-copia.sh <archivo.dump>
#       Modo AISLADO (por defecto). Levanta un contenedor de Postgres NUEVO Y
#       DESCARTABLE — sin tocar koinonia-postgres, koinonia_net ni koinonia-pgdata —,
#       restaura ahí el volcado y lo verifica. Es el modo para el simulacro de
#       restauración que pide COPIAS.md: no arriesga nada de producción. Al terminar
#       borra el contenedor y su volumen temporal (agregá --conservar para dejarlo
#       levantado y explorarlo a mano).
#
#   ./restaurar-copia.sh <archivo.dump> --produccion
#       Modo PRODUCCIÓN (destructivo). BORRA la base 'koinonia' real dentro de
#       koinonia-postgres y la reemplaza por el contenido del volcado. Todo lo que se
#       escribió después de la fecha de esa copia SE PIERDE. Pide una frase de
#       confirmación exacta escrita a mano, y antes de tocar nada hace, a su vez, una
#       copia de emergencia de lo que hay — por si la restauración sale mal y hace
#       falta volver atrás. Rechaza correr si no hay una terminal interactiva
#       delante: esto no es para un cron ni para un script que lo llame sin que haya
#       una persona mirando.
#
# POR QUÉ el modo --produccion no usa `pg_restore --clean` sobre la base real:
# --clean sólo borra los objetos que están LISTADOS en el volcado. Una tabla que
# existía en producción y se borró después de la fecha de esa copia seguiría viva
# tras el --clean: la base "restaurada" sería una MEZCLA de la copia y de lo que
# había antes, no fielmente la copia. Por eso este script borra la base ENTERA
# (DROP DATABASE) y la recrea vacía, con la misma codificación C/UTF8 con la que se
# creó originalmente (ver /opt/koinonia/docker-compose.yml), antes de restaurar: lo
# que queda adentro es exactamente lo que había en el volcado, ni más ni menos.

set -euo pipefail

CONTENEDOR="${KOINONIA_PG_CONTENEDOR:-koinonia-postgres}"
BASE="${KOINONIA_PG_BASE:-koinonia}"
USUARIO_PG="${KOINONIA_PG_USUARIO:-postgres}"
API_CONTENEDOR="${KOINONIA_API_CONTENEDOR:-koinonia-api}"
DESTINO_EMERGENCIA="${KOINONIA_COPIA_DESTINO:-/opt/koinonia/copias}"

registro() { echo "[$(date -u +%FT%TZ)] $*"; }
error() { echo "[$(date -u +%FT%TZ)] ERROR: $*" >&2; }

ARCHIVO="${1:-}"
if [ -z "$ARCHIVO" ]; then
  error "uso: restaurar-copia.sh <archivo.dump> [--produccion] [--conservar]"
  exit 1
fi
if [ ! -f "$ARCHIVO" ]; then
  error "no existe el fichero: $ARCHIVO"
  exit 1
fi
shift

MODO="aislado"
CONSERVAR="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --produccion) MODO="produccion" ;;
    --conservar) CONSERVAR="si" ;;
    *)
      error "opción desconocida: $1"
      exit 1
      ;;
  esac
  shift
done

ARCHIVO_ABS="$(cd "$(dirname "$ARCHIVO")" && pwd)/$(basename "$ARCHIVO")"
ARCHIVO_HUELLA="${ARCHIVO_ABS}.sha256"

verificar_huella() {
  # La huella se genera junto al volcado en copia-de-seguridad.sh. Comprobarla acá
  # detecta un fichero corrompido en tránsito (copiado a medias, disco USB con
  # errores, etc.) ANTES de restaurar nada — mejor que descubrirlo a mitad del
  # DROP DATABASE de producción.
  if [ -f "$ARCHIVO_HUELLA" ]; then
    registro "verificando huella sha256 contra ${ARCHIVO_HUELLA}..."
    if ! (cd "$(dirname "$ARCHIVO_ABS")" && sha256sum -c "$(basename "$ARCHIVO_HUELLA")"); then
      error "la huella NO coincide. El fichero puede estar corrompido o cambiado. Abortando."
      exit 1
    fi
    registro "huella OK."
    return 0
  fi

  error "no encontré ${ARCHIVO_HUELLA} junto al volcado. No puedo confirmar que el fichero esté íntegro."
  if [ "$MODO" = "produccion" ]; then
    error "en modo --produccion esto es fatal: no se pisa la base real con un fichero sin huella verificada."
    exit 1
  fi
  if [ ! -t 0 ]; then
    error "no hay terminal interactiva para pedir confirmación. Abortando."
    exit 1
  fi
  read -r -p "¿Seguir de todos modos, SOLO para el modo aislado de verificación? [escribí 'si']: " RESP
  [ "$RESP" = "si" ] || { registro "cancelado por el operador."; exit 1; }
}

esperar_postgres() {
  local contenedor="$1"
  local intentos=60
  registro "esperando a que '${contenedor}' esté listo..."
  while [ "$intentos" -gt 0 ]; do
    if docker exec "$contenedor" pg_isready -U postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    intentos=$((intentos - 1))
  done
  error "'${contenedor}' no quedó listo a tiempo (60s)."
  exit 1
}

contar_tablas_volcado() {
  local contenedor="$1" ruta="$2"
  docker exec "$contenedor" pg_restore --list "$ruta" | grep -c ' TABLE DATA ' || true
}

contar_tablas_base() {
  local contenedor="$1" base="$2" usuario="$3"
  docker exec "$contenedor" psql -U "$usuario" -d "$base" -t -A -c \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast');"
}

# ============================== MODO AISLADO ==============================
restaurar_aislado() {
  verificar_huella

  local sufijo ruta_temp_en_contenedor esperadas encontradas
  # nombre_temp NO es `local`, a propósito: `limpiar_aislado` corre desde el trap de
  # EXIT, que dispara recién cuando el SCRIPT ENTERO termina — es decir, después de
  # que esta función ya retornó. Una variable `local` ya estaría fuera de alcance en
  # ese momento (bash la trataría como "sin asignar" bajo `set -u`), y el contenedor
  # descartable se quedaría corriendo sin que nadie lo borre. Al no declararla local,
  # queda como variable global del script y el trap la sigue viendo.
  sufijo="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  nombre_temp="koinonia-verificacion-${sufijo}"
  ruta_temp_en_contenedor="/tmp/restaurar-${sufijo}.dump"

  registro "levantando contenedor descartable '${nombre_temp}' (postgres:16-alpine, sin publicar puertos, sin unirse a koinonia_net)..."
  # Sin --network koinonia_net y sin -p: este contenedor no puede alcanzar ni ser
  # alcanzado por nada de producción. Password descartable: el contenedor se destruye
  # al terminar y nunca se expone fuera del host.
  docker run -d --name "$nombre_temp" \
    -e POSTGRES_PASSWORD=verificacion-temporal-no-usar \
    -e POSTGRES_DB=postgres \
    -e LANG=C \
    -e POSTGRES_INITDB_ARGS='--encoding=UTF8 --locale=C' \
    postgres:16-alpine >/dev/null

  limpiar_aislado() {
    if [ "$CONSERVAR" = "si" ]; then
      registro "dejando '${nombre_temp}' levantado por --conservar. Para borrarlo a mano: docker rm -f ${nombre_temp}"
      return 0
    fi
    registro "borrando contenedor descartable '${nombre_temp}'..."
    docker rm -f "$nombre_temp" >/dev/null 2>&1 || true
  }
  trap limpiar_aislado EXIT

  esperar_postgres "$nombre_temp"
  docker exec "$nombre_temp" psql -U postgres -d postgres -c "CREATE DATABASE koinonia;" >/dev/null

  docker cp "$ARCHIVO_ABS" "${nombre_temp}:${ruta_temp_en_contenedor}"

  esperadas="$(printf '%s\n' "$(contar_tablas_volcado "$nombre_temp" "$ruta_temp_en_contenedor")")"
  registro "el volcado trae ${esperadas} tablas. Restaurando..."

  docker exec "$nombre_temp" pg_restore -U postgres -d koinonia --no-owner --no-privileges "$ruta_temp_en_contenedor" || {
    error "pg_restore terminó con errores. Revisá la salida de arriba."
    exit 1
  }

  encontradas="$(contar_tablas_base "$nombre_temp" koinonia postgres)"
  if [ "$encontradas" -ne "$esperadas" ]; then
    error "tras restaurar hay ${encontradas} tablas y el volcado traía ${esperadas}. Algo no restauró bien."
    exit 1
  fi

  registro "verificación OK: ${encontradas} tablas restauradas, igual a las ${esperadas} del volcado."
  registro "conteo de filas por tabla (para mirar que no esté todo en cero cuando no debería):"
  docker exec "$nombre_temp" psql -U postgres -d koinonia -t -A -F ' | ' -c "
    SELECT schemaname || '.' || relname, n_live_tup
    FROM pg_stat_user_tables
    ORDER BY 1;
  "

  if [ "$CONSERVAR" = "si" ]; then
    registro "contenedor '${nombre_temp}' queda levantado. Para explorarlo: docker exec -it ${nombre_temp} psql -U postgres -d koinonia"
  fi
  registro "modo aislado terminado sin tocar producción."
}

# ============================= MODO PRODUCCIÓN =============================
restaurar_produccion() {
  if [ ! -t 0 ] || [ ! -t 1 ]; then
    error "modo --produccion exige una terminal interactiva delante. No corras esto desde un cron, un script sin supervisión, ni un pipe."
    exit 1
  fi

  verificar_huella

  echo
  echo "############################################################"
  echo "#  ESTO VA A BORRAR LA BASE 'koinonia' DE PRODUCCIÓN Y      #"
  echo "#  REEMPLAZARLA POR EL CONTENIDO DE:                         #"
  echo "#    ${ARCHIVO_ABS}"
  echo "#                                                              #"
  echo "#  Todo lo escrito DESPUÉS de esa copia se pierde para        #"
  echo "#  siempre. No hay deshacer más allá de la copia de           #"
  echo "#  emergencia que este script hace ANTES de tocar nada.       #"
  echo "############################################################"
  echo
  read -r -p "Escribí exactamente 'SI, REEMPLAZAR koinonia' para continuar: " CONFIRMACION
  if [ "$CONFIRMACION" != "SI, REEMPLAZAR koinonia" ]; then
    registro "confirmación no coincide. Cancelado, no se tocó nada."
    exit 1
  fi

  if ! docker inspect -f '{{.State.Running}}' "$CONTENEDOR" 2>/dev/null | grep -q true; then
    error "el contenedor '$CONTENEDOR' no existe o no está corriendo. Abortando antes de tocar nada."
    exit 1
  fi

  mkdir -p "$DESTINO_EMERGENCIA"
  local emergencia
  emergencia="${DESTINO_EMERGENCIA}/koinonia-ANTES-DE-RESTAURAR-$(date -u +%Y%m%dT%H%M%SZ).dump"
  registro "haciendo copia de emergencia de lo que hay AHORA, antes de tocar nada: ${emergencia}"
  if ! docker exec "$CONTENEDOR" pg_dump -U "$USUARIO_PG" -Fc -d "$BASE" > "$emergencia"; then
    error "la copia de emergencia falló. NO sigo: sin ese respaldo no hay forma de volver atrás si algo sale mal."
    rm -f "$emergencia"
    exit 1
  fi
  registro "copia de emergencia OK (${emergencia}). Si algo sale mal, restaurá desde ahí."

  local esperadas encontradas
  # ruta_temp_en_contenedor NO es `local`, por la misma razón que en restaurar_aislado:
  # `limpiar_prod` corre desde el trap de EXIT, que dispara después de que esta
  # función ya retornó, y necesita seguir viendo esta variable en ese momento.
  ruta_temp_en_contenedor="/tmp/restaurar-produccion-$$.dump"

  if docker inspect -f '{{.State.Running}}' "$API_CONTENEDOR" 2>/dev/null | grep -q true; then
    registro "deteniendo '${API_CONTENEDOR}' para que nada escriba durante la restauración..."
    docker stop "$API_CONTENEDOR" >/dev/null
  else
    registro "'${API_CONTENEDOR}' ya estaba detenido (o no existe). Sigo."
  fi

  registro "cortando conexiones activas a '${BASE}'..."
  docker exec "$CONTENEDOR" psql -U "$USUARIO_PG" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BASE}' AND pid <> pg_backend_pid();" >/dev/null

  registro "borrando la base '${BASE}' y recreándola vacía (mismo encoding/locale que el original: C / UTF8)..."
  if ! docker exec "$CONTENEDOR" psql -U "$USUARIO_PG" -d postgres -c "DROP DATABASE \"${BASE}\";"; then
    error "DROP DATABASE falló. La base '${BASE}' probablemente sigue existiendo tal cual estaba (el DROP no llegó a aplicarse)."
    error "la copia de emergencia de todas formas quedó hecha en ${emergencia} por si hace falta."
    exit 1
  fi
  # Entre el DROP que acaba de tener éxito y el CREATE de abajo, la base 'koinonia' NO
  # EXISTE en absoluto. Si el CREATE falla acá (disco lleno, permisos, lo que sea), no
  # alcanza con que `set -e` corte el script: sin este chequeo explícito, quien esté
  # mirando la terminal ve un error de SQL genérico y el script termina, sin que nada
  # le diga que la base ya no existe ni que hay una copia de emergencia para recuperarla.
  if ! docker exec "$CONTENEDOR" psql -U "$USUARIO_PG" -d postgres -c \
    "CREATE DATABASE \"${BASE}\" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';"; then
    error "CREATE DATABASE falló DESPUÉS de que el DROP tuvo éxito: la base '${BASE}' YA NO EXISTE en '${CONTENEDOR}'."
    error "recuperala a mano desde la copia de emergencia: ${emergencia}"
    error "  docker exec ${CONTENEDOR} psql -U ${USUARIO_PG} -d postgres -c \"CREATE DATABASE \\\"${BASE}\\\" WITH TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C';\""
    error "  docker cp ${emergencia} ${CONTENEDOR}:/tmp/recuperacion-emergencia.dump"
    error "  docker exec ${CONTENEDOR} pg_restore -U ${USUARIO_PG} -d ${BASE} --no-owner --no-privileges /tmp/recuperacion-emergencia.dump"
    error "la API sigue detenida a propósito. No la levantes hasta terminar esta recuperación."
    exit 1
  fi

  docker cp "$ARCHIVO_ABS" "${CONTENEDOR}:${ruta_temp_en_contenedor}"
  limpiar_prod() {
    docker exec "$CONTENEDOR" rm -f "$ruta_temp_en_contenedor" 2>/dev/null || true
  }
  trap limpiar_prod EXIT

  esperadas="$(contar_tablas_volcado "$CONTENEDOR" "$ruta_temp_en_contenedor")"
  registro "el volcado trae ${esperadas} tablas. Restaurando sobre '${BASE}'..."

  docker exec "$CONTENEDOR" pg_restore -U "$USUARIO_PG" -d "$BASE" --no-owner --no-privileges "$ruta_temp_en_contenedor" || {
    error "pg_restore terminó con errores. La base '${BASE}' puede haber quedado a medio restaurar."
    error "la copia de emergencia sigue en ${emergencia} por si hace falta volver atrás."
    exit 1
  }

  encontradas="$(contar_tablas_base "$CONTENEDOR" "$BASE" "$USUARIO_PG")"
  if [ "$encontradas" -ne "$esperadas" ]; then
    error "tras restaurar hay ${encontradas} tablas y el volcado traía ${esperadas}. Algo no restauró bien."
    error "la API sigue DETENIDA a propósito. No la levantes hasta entender qué pasó."
    error "la copia de emergencia sigue en ${emergencia}."
    exit 1
  fi

  registro "verificación OK: ${encontradas} tablas restauradas, igual a las ${esperadas} del volcado."
  echo
  echo "############################################################"
  echo "#  Restauración completa. La API SIGUE DETENIDA a propósito. #"
  echo "#  Antes de levantarla:                                      #"
  echo "#    docker exec -it ${CONTENEDOR} psql -U ${USUARIO_PG} -d ${BASE}"
  echo "#  y mirá que los datos sean los que esperabas. Cuando estés #"
  echo "#  conforme:                                                 #"
  echo "#    docker start ${API_CONTENEDOR}"
  echo "############################################################"
}

if [ "$MODO" = "produccion" ]; then
  restaurar_produccion
else
  restaurar_aislado
fi
