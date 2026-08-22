/**
 * Cliente **SMTP** para el correo de anclaje, con `STARTTLS`, autenticación y —lo que importa aquí—
 * **atribución del rechazo al destinatario concreto**.
 *
 * ═══ La decisión de diseño: un mensaje por testigo ═══
 *
 * Un solo correo con cinco destinatarios sería más barato y sería peor por dos motivos:
 *
 *  1. **Atribución.** Con cinco `RCPT TO` en la misma transacción, un `550` en el tercero deja el
 *     resto de la entrega en un estado que hay que deducir. Con una transacción por testigo, el
 *     rechazo es de quien es, sin interpretación.
 *  2. **Privacidad.** Un `To:` con las cinco direcciones le enseña a cada testigo quiénes son los
 *     otros cuatro. El padrón de testigos de un colectivo político no es una lista de correo: es
 *     información sobre con quién cuenta ese colectivo, y no hay ninguna razón para repartirla.
 *
 * La sesión SMTP sí se comparte: una conexión, varias transacciones. Lo caro es el saludo y el TLS.
 *
 * ═══ Qué se prueba sin red ═══
 *
 * Todo lo de este fichero. El socket entra como puerto (`socket.ts`) y las pruebas le dan un guion
 * con las respuestas exactas de un servidor real, incluidas las de varias líneas y los rechazos.
 */

import type { WitnessBounce } from '@koinonia/anchor';

import { sinDireccionesIp } from './http.js';
import { type Conectar, LineReader } from './socket.js';

const CRLF = '\r\n';

export interface RespuestaSmtp {
  readonly code: number;
  /** Las líneas del texto, ya sin el código. */
  readonly lines: readonly string[];
  /** Código ampliado RFC 3463 si venía (`5.1.1`). */
  readonly status: string | undefined;
}

export class SmtpError extends Error {
  readonly reply: RespuestaSmtp | undefined;

  constructor(detail: string, reply?: RespuestaSmtp) {
    super(
      reply === undefined ? detail : `${detail}: ${String(reply.code)} ${reply.lines.join(' ')}`,
    );
    this.name = 'SmtpError';
    this.reply = reply;
  }
}

const CODIGO_AMPLIADO = /^([245]\.\d{1,3}\.\d{1,3})\b/u;

/** Interpreta una respuesta ya recogida línea a línea (`250-...` continúa, `250 ...` termina). */
export function parsearRespuestaSmtp(lineas: readonly string[]): RespuestaSmtp {
  const primera = lineas[0];
  if (primera === undefined) throw new SmtpError('el servidor no respondió');
  const code = Number(primera.slice(0, 3));
  if (!Number.isInteger(code) || code < 100 || code > 599) {
    throw new SmtpError(`respuesta SMTP sin código válido: ${JSON.stringify(primera)}`);
  }
  const textos = lineas.map((linea) => linea.slice(4));
  const ampliado = CODIGO_AMPLIADO.exec(textos[0] ?? '');
  return { code, lines: textos, status: ampliado?.[1] };
}

async function leerRespuesta(reader: LineReader): Promise<RespuestaSmtp> {
  const lineas: string[] = [];
  for (;;) {
    const linea = await reader.readLine();
    if (linea === undefined) {
      if (lineas.length === 0) throw new SmtpError('la conexión se cerró sin respuesta');
      break;
    }
    lineas.push(linea);
    if (linea.charAt(3) !== '-') break;
  }
  return parsearRespuestaSmtp(lineas);
}

export type ModoTls = 'implicita' | 'starttls' | 'ninguna';

export interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly tls: ModoTls;
  /** Nombre con el que nos presentamos. Debe resolver al servidor: si no, medio mundo lo rechaza. */
  readonly helo: string;
  readonly auth?: { readonly user: string; readonly pass: string };
  readonly connect: Conectar;
  /** Remitente del sobre (`MAIL FROM`). Es a donde vuelven los rebotes. */
  readonly envelopeFrom: string;
}

export interface MensajeSmtp {
  readonly to: string;
  /** Mensaje completo: cabeceras, línea en blanco y cuerpo, ya con `CRLF`. */
  readonly data: string;
}

export interface EntregaSmtp {
  readonly to: string;
  readonly aceptado: boolean;
  readonly rechazo: WitnessBounce | undefined;
}

/**
 * `.` al principio de línea se duplica (RFC 5321 §4.5.2).
 *
 * Si no se hace, un cuerpo con una línea que empiece por punto **termina el mensaje ahí**: el
 * destinatario recibe medio correo y el resto se interpreta como órdenes SMTP. La línea de
 * compromiso del checkpoint no empieza por punto, pero el mensaje lo escribe una plantilla y las
 * plantillas cambian.
 */
export function rellenarPuntos(data: string): string {
  return data
    .split(CRLF)
    .map((linea) => (linea.startsWith('.') ? `.${linea}` : linea))
    .join(CRLF);
}

function clasificar(to: string, reply: RespuestaSmtp, fase: string): WitnessBounce {
  const detalle = sinDireccionesIp(
    `${fase}: ${String(reply.code)} ${reply.lines.join(' ').trim()}`,
  );
  return {
    witness: undefined,
    address: to,
    kind: reply.code >= 500 ? 'permanente' : 'transitorio',
    ...(reply.status === undefined ? {} : { status: reply.status }),
    detail: detalle,
  };
}

/**
 * Manda los mensajes en una sola sesión y devuelve qué pasó con cada destinatario.
 *
 * Un rechazo **no aborta la sesión**: se hace `RSET` y se sigue con el siguiente testigo. Abortar
 * convertiría una dirección caducada en la pérdida del anclaje entero, que es exactamente la
 * fragilidad que el umbral por dominios existe para evitar.
 */
export async function enviarPorSmtp(
  options: SmtpOptions,
  mensajes: readonly MensajeSmtp[],
): Promise<readonly EntregaSmtp[]> {
  const duplex = await options.connect({
    host: options.host,
    port: options.port,
    tls: options.tls === 'implicita',
  });
  const reader = new LineReader(duplex);
  const escribir = (texto: string): Promise<void> =>
    duplex.write(Uint8Array.from(Buffer.from(texto, 'binary')));

  const ordenar = async (texto: string): Promise<RespuestaSmtp> => {
    await escribir(`${texto}${CRLF}`);
    return leerRespuesta(reader);
  };

  const entregas: EntregaSmtp[] = [];

  try {
    const saludo = await leerRespuesta(reader);
    if (saludo.code !== 220) throw new SmtpError('el servidor no saludó con 220', saludo);

    let capacidades = await ordenar(`EHLO ${options.helo}`);
    if (capacidades.code !== 250) throw new SmtpError('EHLO rechazado', capacidades);

    if (options.tls === 'starttls') {
      const anuncia = capacidades.lines.some((linea) => /^STARTTLS\b/iu.test(linea.trim()));
      if (!anuncia) {
        // Degradar a texto plano en silencio sería justo lo que un atacante en la red quiere.
        throw new SmtpError('se pidió STARTTLS y el servidor no lo anuncia', capacidades);
      }
      const listo = await ordenar('STARTTLS');
      if (listo.code !== 220) throw new SmtpError('STARTTLS rechazado', listo);
      await duplex.upgradeToTls();
      capacidades = await ordenar(`EHLO ${options.helo}`);
      if (capacidades.code !== 250)
        throw new SmtpError('EHLO tras STARTTLS rechazado', capacidades);
    }

    const auth = options.auth;
    if (auth !== undefined) {
      const credencial = Buffer.from(`\0${auth.user}\0${auth.pass}`, 'utf8').toString('base64');
      const resultado = await ordenar(`AUTH PLAIN ${credencial}`);
      if (resultado.code !== 235) throw new SmtpError('la autenticación falló', resultado);
    }

    for (const mensaje of mensajes) {
      const remitente = await ordenar(`MAIL FROM:<${options.envelopeFrom}>`);
      if (remitente.code !== 250) throw new SmtpError('MAIL FROM rechazado', remitente);

      const destinatario = await ordenar(`RCPT TO:<${mensaje.to}>`);
      if (destinatario.code !== 250 && destinatario.code !== 251) {
        entregas.push({
          to: mensaje.to,
          aceptado: false,
          rechazo: clasificar(mensaje.to, destinatario, 'RCPT TO'),
        });
        await ordenar('RSET');
        continue;
      }

      const abrir = await ordenar('DATA');
      if (abrir.code !== 354) throw new SmtpError('DATA rechazado', abrir);

      await escribir(`${rellenarPuntos(mensaje.data)}${CRLF}.${CRLF}`);
      const aceptado = await leerRespuesta(reader);
      if (aceptado.code !== 250) {
        entregas.push({
          to: mensaje.to,
          aceptado: false,
          rechazo: clasificar(mensaje.to, aceptado, 'DATA'),
        });
        continue;
      }
      entregas.push({ to: mensaje.to, aceptado: true, rechazo: undefined });
    }

    await ordenar('QUIT');
  } finally {
    await duplex.close();
  }

  return entregas;
}
