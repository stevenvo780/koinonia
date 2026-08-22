/**
 * Cliente **IMAP** mínimo para recoger del buzón de anclaje lo que vuelve: acuses y rebotes.
 *
 * ═══ Por qué hay que recoger, y no esperar a que alguien mire ═══
 *
 * El anclaje por testigos se cierra cuando llegan los acuses firmados. Si esos acuses viven en un
 * buzón que sólo abre una persona, el anclaje depende de que esa persona abra el buzón, y el modelo
 * de amenaza ya dice qué pasa cuando una garantía depende de que alguien se acuerde. Recoger es lo
 * que convierte «cinco personas contestaron» en un dato del recibo.
 *
 * ═══ Alcance, dicho a la cara ═══
 *
 * Es IMAP4rev1 de lo básico: `LOGIN`, `SELECT`, `UID SEARCH`, `UID FETCH BODY.PEEK[]`, `LOGOUT`. No
 * hay IDLE, ni CONDSTORE, ni gestión de carpetas, ni SASL más allá de `LOGIN`. Es lo que hace falta
 * para leer un buzón pequeño una vez por ciclo, y nada más. `BODY.PEEK[]` en vez de `BODY[]` para no
 * marcar como leído lo que todavía no leyó nadie: quien audite el buzón a mano tiene derecho a
 * distinguir lo que vio una persona de lo que tocó un proceso.
 */

import { type Conectar, LineReader } from './socket.js';

const CRLF = '\r\n';

export class ImapError extends Error {
  constructor(detail: string) {
    super(`IMAP: ${detail}`);
    this.name = 'ImapError';
  }
}

/** Una respuesta lógica: el texto con los literales ya sustituidos y recogidos aparte. */
export interface LineaImap {
  readonly texto: string;
  readonly literales: readonly string[];
}

export interface RespuestaImap {
  readonly ok: boolean;
  readonly lineas: readonly LineaImap[];
  readonly detalle: string;
}

const LITERAL_AL_FINAL = /\{(\d+)\}$/u;

/**
 * Lee una línea completa resolviendo los literales `{n}`.
 *
 * Un literal es la forma que tiene IMAP de mandar bytes arbitrarios —el mensaje entero, sin ir más
 * lejos— sin preocuparse de comillas ni de saltos de línea. Leerlo mal desplaza el resto del
 * diálogo y todo lo que venga después se interpreta como basura.
 */
export async function leerLineaImap(reader: LineReader): Promise<LineaImap | undefined> {
  const primera = await reader.readLine();
  if (primera === undefined) return undefined;

  let texto = primera;
  const literales: string[] = [];

  for (;;) {
    const marca = LITERAL_AL_FINAL.exec(texto);
    if (marca === null) break;
    const tamano = Number(marca[1]);
    if (!Number.isSafeInteger(tamano) || tamano < 0) {
      throw new ImapError(`literal de tamaño ilegible: ${String(marca[1])}`);
    }
    literales.push(await reader.readExactly(tamano));
    const continuacion = await reader.readLine();
    if (continuacion === undefined) break;
    texto = `${texto.replace(LITERAL_AL_FINAL, '')}${continuacion}`;
  }

  return { texto, literales };
}

/** Acumula respuestas sin etiqueta hasta la línea etiquetada, que dice si la orden salió bien. */
export async function leerHastaEtiqueta(
  reader: LineReader,
  etiqueta: string,
): Promise<RespuestaImap> {
  const lineas: LineaImap[] = [];
  for (;;) {
    const linea = await leerLineaImap(reader);
    if (linea === undefined) throw new ImapError('la conexión se cerró antes de responder');
    if (linea.texto.startsWith(`${etiqueta} `)) {
      const resto = linea.texto.slice(etiqueta.length + 1);
      return { ok: /^OK\b/iu.test(resto), lineas, detalle: resto.trim() };
    }
    lineas.push(linea);
  }
}

/** Identificadores de `* SEARCH 3 7 12`. */
export function parsearSearch(lineas: readonly LineaImap[]): readonly number[] {
  const out: number[] = [];
  for (const linea of lineas) {
    const encontrado = /^\*\s+SEARCH\b(.*)$/iu.exec(linea.texto);
    if (encontrado === null) continue;
    for (const trozo of (encontrado[1] ?? '').trim().split(/\s+/u)) {
      const n = Number(trozo);
      if (Number.isSafeInteger(n) && n > 0) out.push(n);
    }
  }
  return out;
}

/** Los mensajes crudos de las respuestas `* n FETCH (… BODY[] {N} …)`. */
export function parsearFetch(lineas: readonly LineaImap[]): readonly string[] {
  return lineas
    .filter((linea) => /^\*\s+\d+\s+FETCH\b/iu.test(linea.texto))
    .flatMap((l) => l.literales);
}

/** Escapa una cadena para un literal entrecomillado de IMAP. */
export function entrecomillar(valor: string): string {
  return `"${valor.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

export interface ImapOptions {
  readonly host: string;
  readonly port: number;
  /** `true` ⇒ TLS desde el primer byte (993). `false` ⇒ se intenta `STARTTLS`. */
  readonly tls: boolean;
  readonly user: string;
  readonly pass: string;
  readonly mailbox?: string;
  readonly connect: Conectar;
  /** Cota de mensajes por recogida. Un buzón inundado no debe tumbar el ciclo de anclaje. */
  readonly maxMensajes?: number;
}

/**
 * Abre el buzón, busca por criterio y devuelve los mensajes crudos.
 *
 * El criterio va tal cual a `UID SEARCH`. Se usa `TEXT` sobre el `Message-ID` del anclaje porque
 * atrapa las dos cosas que hay que recoger: las **respuestas** de los testigos —que lo llevan en
 * `In-Reply-To`— y los **rebotes** —que lo llevan dentro del mensaje original adjunto—. Buscar sólo
 * por cabecera encontraría los acuses y perdería los rebotes, que es justo la mitad que nadie mira.
 */
export async function recogerMensajes(
  options: ImapOptions,
  criterio: string,
): Promise<readonly string[]> {
  const duplex = await options.connect({
    host: options.host,
    port: options.port,
    tls: options.tls,
  });
  const reader = new LineReader(duplex);
  let contador = 0;

  const ordenar = async (orden: string): Promise<RespuestaImap> => {
    contador++;
    const etiqueta = `k${String(contador).padStart(3, '0')}`;
    await duplex.write(Uint8Array.from(Buffer.from(`${etiqueta} ${orden}${CRLF}`, 'binary')));
    return leerHastaEtiqueta(reader, etiqueta);
  };

  try {
    const saludo = await leerLineaImap(reader);
    if (saludo === undefined || !/^\*\s+OK\b/iu.test(saludo.texto)) {
      throw new ImapError(`saludo inesperado: ${saludo?.texto ?? '(nada)'}`);
    }

    if (!options.tls) {
      const seguro = await ordenar('STARTTLS');
      if (!seguro.ok) throw new ImapError(`STARTTLS rechazado: ${seguro.detalle}`);
      await duplex.upgradeToTls();
    }

    const sesion = await ordenar(
      `LOGIN ${entrecomillar(options.user)} ${entrecomillar(options.pass)}`,
    );
    // El detalle de un LOGIN fallido puede traer la credencial de vuelta en algunos servidores.
    if (!sesion.ok) throw new ImapError('las credenciales del buzón de anclaje no sirven');

    const buzon = options.mailbox ?? 'INBOX';
    const seleccion = await ordenar(`SELECT ${entrecomillar(buzon)}`);
    if (!seleccion.ok) throw new ImapError(`no se pudo abrir ${buzon}: ${seleccion.detalle}`);

    const busqueda = await ordenar(`UID SEARCH ${criterio}`);
    if (!busqueda.ok) throw new ImapError(`la búsqueda falló: ${busqueda.detalle}`);

    const uids = parsearSearch(busqueda.lineas).slice(0, options.maxMensajes ?? 200);
    const mensajes: string[] = [];
    for (const uid of uids) {
      const traida = await ordenar(`UID FETCH ${String(uid)} (BODY.PEEK[])`);
      if (!traida.ok) continue;
      mensajes.push(...parsearFetch(traida.lineas));
    }

    await ordenar('LOGOUT');
    return mensajes;
  } finally {
    await duplex.close();
  }
}
