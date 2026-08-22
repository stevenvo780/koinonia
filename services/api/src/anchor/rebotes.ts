/**
 * **Interpretación de rebotes**: convertir un informe de no entrega en una falla de anclaje.
 *
 * ═══ Por qué esto no es fontanería ═══
 *
 * El anclaje por testigos se sostiene sobre un padrón de personas alcanzables. Ese padrón se
 * degrada solo —gente que se va, direcciones institucionales que caducan, dominios que cambian de
 * manos— y la degradación es **silenciosa**: el correo se manda igual, nadie lo recibe, y el número
 * de testigos posibles baja sin que ninguna pantalla cambie de color. El día que hagan falta tres
 * dominios y sólo queden dos, nadie sabrá desde cuándo.
 *
 * Leer el rebote es lo que convierte esa degradación en un dato con fecha.
 *
 * ═══ La regla conservadora ═══
 *
 * Un rebote **estructurado** (RFC 3464) con `Status: 5.x.x` es permanente: esa dirección no existe.
 * Todo lo demás —`4.x.x`, `Action: delayed`, o un aviso de rebote sin informe legible— se marca
 * **transitorio**. Dar por muerto a un testigo por un mensaje que no se entendió del todo sería
 * echar del padrón a quien sigue ahí, y el padrón es lo que sostiene el umbral.
 */

import type { WitnessBounce } from '@koinonia/anchor';

import { sinDireccionesIp } from './http.js';
import {
  cabecera,
  cuerpoDecodificado,
  direccionesDe,
  type MensajeCorreo,
  parsearMensaje,
  tipoDeContenido,
  todasLasPartes,
} from './mime.js';

/** Padrón mínimo que hace falta para atribuir un rebote: dirección → identificador del testigo. */
export type PadronDeTestigos = ReadonlyMap<string, string>;

export function padronDesde(
  witnesses: readonly { readonly id: string; readonly address: string }[],
): PadronDeTestigos {
  return new Map(witnesses.map((w) => [w.address.toLowerCase(), w.id]));
}

const ESTADO = /^\s*([245])\.(\d{1,3})\.(\d{1,3})\s*$/u;

const ASUNTOS_DE_REBOTE =
  /(undeliverable|returned mail|delivery status notification|failure notice|mail delivery failed|no se pudo entregar|devuelto al remitente)/iu;

/** Un grupo de campos del `message/delivery-status`, ya desplegado. */
function gruposDeCampos(texto: string): readonly ReadonlyMap<string, string>[] {
  const grupos: Map<string, string>[] = [];
  let actual = new Map<string, string>();
  let ultimo: string | undefined;

  for (const linea of texto.replace(/\r\n/gu, '\n').split('\n')) {
    if (linea.trim() === '') {
      if (actual.size > 0) grupos.push(actual);
      actual = new Map();
      ultimo = undefined;
      continue;
    }
    if (/^[ \t]/u.test(linea) && ultimo !== undefined) {
      actual.set(ultimo, `${actual.get(ultimo) ?? ''} ${linea.trim()}`);
      continue;
    }
    const corte = linea.indexOf(':');
    if (corte === -1) continue;
    ultimo = linea.slice(0, corte).trim().toLowerCase();
    actual.set(ultimo, linea.slice(corte + 1).trim());
  }
  if (actual.size > 0) grupos.push(actual);
  return grupos;
}

/** `rfc822; ana@correo.example` → `ana@correo.example`. */
function direccionDeCampo(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  const sinTipo = valor.includes(';') ? (valor.split(';')[1] ?? '') : valor;
  const limpia = sinTipo.trim().replace(/^<|>$/gu, '').toLowerCase();
  return limpia.includes('@') ? limpia : undefined;
}

/**
 * Extrae los rebotes de un mensaje.
 *
 * Devuelve vacío si el mensaje no parece un rebote en absoluto. Que devuelva vacío para un correo
 * normal es lo correcto: los acuses de los testigos pasan por la misma recogida.
 */
export function parsearRebotes(raw: string, padron: PadronDeTestigos): readonly WitnessBounce[] {
  const mensaje = parsearMensaje(raw);
  const partes = todasLasPartes(mensaje);

  const estructurados = partes.filter(
    (parte) => tipoDeContenido(parte) === 'message/delivery-status',
  );
  const salida: WitnessBounce[] = [];

  for (const parte of estructurados) {
    for (const grupo of gruposDeCampos(cuerpoDecodificado(parte))) {
      const direccion =
        direccionDeCampo(grupo.get('final-recipient')) ??
        direccionDeCampo(grupo.get('original-recipient'));
      if (direccion === undefined) continue;

      const accion = (grupo.get('action') ?? '').toLowerCase();
      if (accion === 'delivered' || accion === 'relayed' || accion === 'expanded') continue;

      const estado = grupo.get('status');
      const coincide = estado === undefined ? undefined : ESTADO.exec(estado);
      const clase = coincide?.[1];
      const permanente = accion === 'failed' && clase === '5';

      const diagnostico = grupo.get('diagnostic-code') ?? grupo.get('status') ?? accion;
      const codigo = coincide === null ? undefined : estado?.trim();
      salida.push({
        witness: padron.get(direccion),
        address: direccion,
        kind: permanente ? 'permanente' : 'transitorio',
        ...(codigo === undefined ? {} : { status: codigo }),
        detail: sinDireccionesIp(recorte(diagnostico)),
      });
    }
  }

  if (salida.length > 0) return salida;

  // Sin informe estructurado. Muchos servidores mandan sólo prosa; si el asunto delata un rebote y
  // en el cuerpo aparece una dirección del padrón, se registra como transitorio y se dice que no se
  // pudo interpretar. Tirarlo sería perder el aviso; darlo por permanente sería echar a un testigo
  // por un correo que no se entendió.
  const asunto = cabecera(mensaje, 'subject') ?? '';
  if (!ASUNTOS_DE_REBOTE.test(asunto)) return [];

  const texto = partes
    .map((parte) => cuerpoDecodificado(parte))
    .join('\n')
    .toLowerCase();
  for (const [direccion, id] of padron) {
    if (!texto.includes(direccion)) continue;
    salida.push({
      witness: id,
      address: direccion,
      kind: 'transitorio',
      detail: sinDireccionesIp(
        `rebote sin informe estructurado (asunto: ${recorte(asunto, 80)}). No se pudo determinar ` +
          'si la dirección desapareció: hay que mirarlo a mano',
      ),
    });
  }
  return salida;
}

/** `Message-ID` del mensaje original que rebotó, si el informe lo devuelve adjunto. */
export function mensajeOriginalDe(raw: string): string | undefined {
  for (const parte of todasLasPartes(parsearMensaje(raw))) {
    const tipo = tipoDeContenido(parte);
    if (tipo !== 'message/rfc822' && tipo !== 'text/rfc822-headers') continue;
    const original = parsearMensaje(cuerpoDecodificado(parte));
    const id = cabecera(original, 'message-id');
    if (id !== undefined) return id.trim();
  }
  return undefined;
}

/** ¿Este mensaje es una respuesta al anclaje `messageId`? Mira `In-Reply-To` y `References`. */
export function respondeA(mensaje: MensajeCorreo, messageId: string): boolean {
  const enRespuestaA = cabecera(mensaje, 'in-reply-to') ?? '';
  const referencias = cabecera(mensaje, 'references') ?? '';
  return enRespuestaA.includes(messageId) || referencias.includes(messageId);
}

export { direccionesDe };

function recorte(texto: string, max = 300): string {
  const limpio = texto.replace(/\s+/gu, ' ').trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
}
