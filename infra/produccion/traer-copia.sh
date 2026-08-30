#!/usr/bin/env bash
# Trae la copia de seguridad más reciente desde la VPS a ESTA máquina, y comprueba su huella.
#
# QUÉ resuelve: `copia-de-seguridad.sh` deja las copias en /opt/koinonia/copias, o sea en el
# mismo disco que protegen. Eso cubre «alguien borró una tabla» y «una migración salió mal», y NO
# cubre «se perdió la VPS»: fuego, disco irrecuperable, o el proveedor dando de baja la cuenta se
# llevan la base y sus catorce copias a la vez. Los dos NVMe del host están en RAID1, así que ni
# siquiera hay un segundo volumen donde poner algo distinto: es un solo sistema de ficheros.
#
# POR QUÉ ESTO Y NO UN DESTINO EXTERNO DE VERDAD: un NAS o un S3 es mejor y es lo que dice
# COPIAS.md §8. Necesita credenciales de un destino que quien escribe esto no tiene y no debe
# inventar — un guion de subida a un sitio que nadie pudo probar es exactamente la «copia que da
# confianza sin respaldo» que ese documento existe para evitar. Esto usa el acceso SSH que ya
# existe, no pide credenciales nuevas, y convierte «se pierde todo» en «se pierde lo de hoy».
# No es un sistema de copias fuera de sitio y no hay que llamarlo así.
#
# CÓMO falla: `set -euo pipefail`. Si la huella no cuadra, el fichero descargado se BORRA y el
# guion sale con error — una copia corrupta guardada como si fuera buena es peor que no tenerla.
#
# AVISO QUE NO ES DE FORMA: el volcado lleva el padrón con datos personales (`identity.member`,
# `identity.private_material`). La máquina donde caiga tiene que sostener el mismo cuidado que la
# VPS: disco cifrado, y fuera de carpetas sincronizadas con servicios de terceros. Si eso no se
# puede sostener, es mejor no bajarlo y apurar el destino externo de COPIAS.md §8.

set -euo pipefail

SERVIDOR="${KOINONIA_SERVIDOR:-root@167.114.118.213}"
ORIGEN="${KOINONIA_COPIA_ORIGEN:-/opt/koinonia/copias}"
DESTINO="${KOINONIA_COPIA_LOCAL:-$HOME/copias-koinonia}"
# Cuántas conservar acá. Menos que en la VPS a propósito: esto es el último recurso, no el
# archivo histórico, y el disco de una máquina personal no es el de un servidor.
RETENCION="${KOINONIA_COPIA_LOCAL_RETENCION:-7}"

decir() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"; }

trap 'decir "FALLÓ al traer la copia (línea $LINENO). No se conservó nada a medias."' ERR

mkdir -p "$DESTINO"

# ── 1. Cuál es la más reciente ────────────────────────────────────────────────────────────────
# Se pregunta al servidor en vez de adivinar por fecha local: el nombre lleva su propio instante
# y el reloj de esta máquina no tiene por qué coincidir con el de allá.
ULTIMA="$(ssh -o BatchMode=yes "$SERVIDOR" "ls -t $ORIGEN/*.dump 2>/dev/null | head -1")"
if [[ -z "$ULTIMA" ]]; then
  decir "no hay ninguna copia en $SERVIDOR:$ORIGEN — ¿corrió alguna vez koinonia-copia.service?"
  exit 1
fi
NOMBRE="$(basename "$ULTIMA")"

if [[ -f "$DESTINO/$NOMBRE" ]]; then
  decir "ya estaba: $NOMBRE. Nada que traer."
  exit 0
fi

# ── 2. Traerla, junto a su huella ─────────────────────────────────────────────────────────────
decir "trayendo $NOMBRE…"
scp -q -o BatchMode=yes "$SERVIDOR:$ULTIMA" "$DESTINO/$NOMBRE"
scp -q -o BatchMode=yes "$SERVIDOR:$ULTIMA.sha256" "$DESTINO/$NOMBRE.sha256"

# ── 3. Comprobar la huella ACÁ ────────────────────────────────────────────────────────────────
# Se recalcula sobre el fichero ya descargado. Comprobarla en el servidor no diría nada de lo que
# llegó: lo que puede corromperse es el viaje.
ESPERADA="$(cut -d' ' -f1 <"$DESTINO/$NOMBRE.sha256")"
OBTENIDA="$(sha256sum "$DESTINO/$NOMBRE" | cut -d' ' -f1)"
if [[ "$ESPERADA" != "$OBTENIDA" ]]; then
  rm -f "$DESTINO/$NOMBRE" "$DESTINO/$NOMBRE.sha256"
  decir "HUELLA DISTINTA: se esperaba $ESPERADA y llegó $OBTENIDA. Se borró lo descargado."
  exit 1
fi

chmod 600 "$DESTINO/$NOMBRE" "$DESTINO/$NOMBRE.sha256"
decir "huella OK: $NOMBRE ($(du -h "$DESTINO/$NOMBRE" | cut -f1))"

# ── 4. Rotación ───────────────────────────────────────────────────────────────────────────────
# Se cuentan sólo las que tienen huella al lado: una sin comprobar no cuenta como copia y no debe
# desplazar a una buena.
mapfile -t VALIDAS < <(ls -t "$DESTINO"/*.dump 2>/dev/null | while read -r f; do
  [[ -f "$f.sha256" ]] && echo "$f"
done)
if ((${#VALIDAS[@]} > RETENCION)); then
  for viejo in "${VALIDAS[@]:RETENCION}"; do
    rm -f "$viejo" "$viejo.sha256"
    decir "rotada: $(basename "$viejo")"
  done
fi

decir "listo. ${#VALIDAS[@]} copias en $DESTINO (se conservan $RETENCION)."
