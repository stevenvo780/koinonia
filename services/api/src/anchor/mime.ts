/**
 * Lo mínimo de MIME y RFC 5322 que hace falta para leer un buzón de anclaje.
 *
 * No es una librería de correo: no decodifica `quoted-printable` de cuerpos arbitrarios, no maneja
 * juegos de caracteres exóticos ni `message/partial`. Hace tres cosas —desplegar cabeceras, partir
 * un `multipart` y decodificar `base64`/`quoted-printable` cuando lo dice `Content-Transfer-Encoding`—
 * porque son las tres que separan «leer un acuse firmado» de «no leerlo».
 *
 * Se escribe a mano en vez de traer una dependencia por la razón de siempre en este repositorio:
 * cada dependencia de tiempo de ejecución del anclaje es código que hay que auditar y que puede
 * cambiar bajo los pies del proyecto. Ochenta líneas legibles valen más que un paquete de 40 000.
 */

const CRLF = '\r\n';

export interface MensajeCorreo {
  /** Nombre en minúsculas → valores, en orden de aparición. Una cabecera puede repetirse. */
  readonly headers: ReadonlyMap<string, readonly string[]>;
  /** Cuerpo tal cual, **sin** decodificar. Usá `cuerpoDecodificado()`. */
  readonly body: string;
}

/** Parte un mensaje en cabeceras y cuerpo, desplegando las líneas continuadas. */
export function parsearMensaje(raw: string): MensajeCorreo {
  const normalizado = raw.replace(/\r\n/gu, '\n');
  const corte = normalizado.indexOf('\n\n');
  const cabeceraTexto = corte === -1 ? normalizado : normalizado.slice(0, corte);
  const body = corte === -1 ? '' : normalizado.slice(corte + 2);

  const headers = new Map<string, string[]>();
  let actual: { readonly nombre: string; valor: string } | undefined;

  const guardar = (): void => {
    if (actual === undefined) return;
    const clave = actual.nombre.toLowerCase();
    const lista = headers.get(clave) ?? [];
    lista.push(actual.valor.trim());
    headers.set(clave, lista);
  };

  for (const linea of cabeceraTexto.split('\n')) {
    if (/^[ \t]/u.test(linea) && actual !== undefined) {
      actual.valor += ` ${linea.trim()}`;
      continue;
    }
    guardar();
    const dosPuntos = linea.indexOf(':');
    actual =
      dosPuntos === -1
        ? undefined
        : { nombre: linea.slice(0, dosPuntos), valor: linea.slice(dosPuntos + 1) };
  }
  guardar();

  return { headers, body };
}

export function cabecera(mensaje: MensajeCorreo, nombre: string): string | undefined {
  return mensaje.headers.get(nombre.toLowerCase())?.[0];
}

/** Valor de un parámetro de una cabecera estructurada: `boundary` de `Content-Type`, por ejemplo. */
export function parametro(valor: string, nombre: string): string | undefined {
  const patron = new RegExp(`;\\s*${nombre}\\s*=\\s*("([^"]*)"|([^;\\s]+))`, 'iu');
  const encontrado = patron.exec(valor);
  return encontrado?.[2] ?? encontrado?.[3];
}

export function tipoDeContenido(mensaje: MensajeCorreo): string {
  const valor = cabecera(mensaje, 'content-type') ?? 'text/plain';
  return (valor.split(';')[0] ?? 'text/plain').trim().toLowerCase();
}

/** Partes de un `multipart/*`. Vacío si no lo es o si falta el `boundary`. */
export function partesMime(mensaje: MensajeCorreo): readonly MensajeCorreo[] {
  const contentType = cabecera(mensaje, 'content-type');
  if (contentType === undefined || !/^multipart\//iu.test(contentType.trim())) return [];
  const frontera = parametro(contentType, 'boundary');
  if (frontera === undefined || frontera === '') return [];

  const marca = `--${frontera}`;
  const lineas = mensaje.body.split('\n');
  const bloques: string[][] = [];
  let actual: string[] | undefined;

  for (const linea of lineas) {
    const limpia = linea.replace(/\r$/u, '');
    if (limpia === marca) {
      if (actual !== undefined) bloques.push(actual);
      actual = [];
      continue;
    }
    if (limpia === `${marca}--`) {
      if (actual !== undefined) bloques.push(actual);
      actual = undefined;
      break;
    }
    actual?.push(linea);
  }
  if (actual !== undefined) bloques.push(actual);

  return bloques.map((bloque) => parsearMensaje(bloque.join('\n')));
}

/** Recorre el árbol de partes, incluido el propio mensaje. */
export function todasLasPartes(mensaje: MensajeCorreo): readonly MensajeCorreo[] {
  const partes = partesMime(mensaje);
  if (partes.length === 0) return [mensaje];
  return [mensaje, ...partes.flatMap((parte) => todasLasPartes(parte))];
}

/** Cuerpo con `base64` o `quoted-printable` deshecho, según diga `Content-Transfer-Encoding`. */
export function cuerpoDecodificado(mensaje: MensajeCorreo): string {
  const codificacion = (cabecera(mensaje, 'content-transfer-encoding') ?? '7bit')
    .trim()
    .toLowerCase();

  if (codificacion === 'base64') {
    return Buffer.from(mensaje.body.replace(/\s+/gu, ''), 'base64').toString('utf8');
  }
  if (codificacion === 'quoted-printable') {
    return mensaje.body
      .replace(/=\r?\n/gu, '')
      .replace(/=([0-9A-Fa-f]{2})/gu, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
  }
  return mensaje.body;
}

/** Direcciones de una cabecera `From`/`To`: `Ana <ana@x.example>` → `ana@x.example`. */
export function direccionesDe(valor: string | undefined): readonly string[] {
  if (valor === undefined) return [];
  const conAngulos = [...valor.matchAll(/<([^>]+)>/gu)].map((m) => m[1] ?? '');
  if (conAngulos.length > 0) return conAngulos.map((d) => d.trim().toLowerCase());
  return valor
    .split(',')
    .map((parte) => parte.trim().toLowerCase())
    .filter((parte) => parte.includes('@'));
}

/** Ensambla un mensaje con `CRLF`, como exige SMTP. */
export function ensamblar(
  cabeceras: readonly { readonly nombre: string; readonly valor: string }[],
  cuerpo: string,
): string {
  const lineas = cabeceras.map(({ nombre, valor }) => `${nombre}: ${valor}`);
  const cuerpoCrlf = cuerpo.replace(/\r\n/gu, '\n').replace(/\n/gu, CRLF);
  return `${lineas.join(CRLF)}${CRLF}${CRLF}${cuerpoCrlf}`;
}
