/**
 * El transporte de correo del anclaje, enchufado: **SMTP con DKIM** para enviar e **IMAP** para
 * recoger.
 *
 * Implementa los dos puertos que `packages/anchor` define y no puede implementar —`EmailTransport` y
 * `AckCollector`— porque implica I/O.
 *
 * ═══ La errata que apareció al escribir esto ═══
 *
 * `ackSignedBytes()` antepone el octeto de separación de dominio `0x10` al JCS del acuse. Está bien
 * que lo haga: sin él, un acuse firmado podría reinterpretarse como otra cosa firmada. Pero la
 * instrucción que el propio paquete documenta —«firmalo con `ssh-keygen -Y sign … acuse.json`»— firma
 * **el fichero tal cual**, así que `acuse.json` tiene que empezar por un byte de control 0x10. Eso no
 * se copia y se pega desde un correo: el editor lo pierde, el cliente de correo lo destroza, y el
 * testigo firma 34 bytes que no son los que el verificador comprueba.
 *
 * La solución está en las instrucciones que se mandan: una orden `printf '\020%s'` que **fabrica** el
 * fichero con el byte correcto. Se genera aquí, con el octeto sacado de `ANCHOR_DOMAIN`, para que el
 * día que cambie no queden instrucciones mintiendo en los buzones de cinco personas.
 */

import {
  ackPreimage,
  ANCHOR_DOMAIN,
  type AckCollection,
  type AckCollector,
  type EmailDeliveryReport,
  type EmailTransport,
  type Witness,
  type WitnessAck,
  type WitnessBounce,
  WITNESS_SIGNATURE_NAMESPACE,
} from '@koinonia/anchor';
import { canonicalizeToBytes } from '@koinonia/crypto';

import { firmarDkim, type DkimOptions } from './dkim.js';
import { type ImapOptions, recogerMensajes } from './imap.js';
import {
  cabecera,
  cuerpoDecodificado,
  direccionesDe,
  ensamblar,
  parsearMensaje,
  todasLasPartes,
} from './mime.js';
import { padronDesde, parsearRebotes, respondeA } from './rebotes.js';
import { enviarPorSmtp, type MensajeSmtp, type SmtpOptions } from './smtp.js';

const ARMADURA = /-----BEGIN SSH SIGNATURE-----[\s\S]*?-----END SSH SIGNATURE-----/u;

const VISTO = /^koinonia-visto:\s*(\S+)\s*$/mu;

/** El octeto de dominio en octal, tal como lo entiende `printf`: `0x10` → `\020`. */
export const OCTETO_DE_DOMINIO_OCTAL = `\\0${ANCHOR_DOMAIN.emailAck.toString(8).padStart(2, '0')}`;

export interface CorreoDeAnclajeOptions {
  readonly witnesses: readonly Witness[];
  /** Cabecera `From` completa: `Anclaje Koinonía <anclaje@udea.edu.co>`. */
  readonly from: string;
  /** Remitente del sobre. Es a donde vuelven los rebotes; puede diferir del `From`. */
  readonly envelopeFrom: string;
  readonly smtp: Omit<SmtpOptions, 'envelopeFrom'>;
  readonly dkim?: Omit<DkimOptions, 'timestamp'>;
  /**
   * Instante del envío, RFC 3339 UTC. **Entra como dato**: dos ejecuciones con el mismo instante
   * producen el mismo correo byte a byte, que es lo que permite probar la firma DKIM.
   */
  readonly now: () => string;
  /** Dominio para los `Message-ID` por destinatario. */
  readonly messageIdDomain?: string;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Envío
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** El `acuse.json` exacto que el testigo debe firmar, y la orden que lo fabrica sin perder el 0x10. */
export function instruccionesDeAcuse(input: {
  readonly witness: Witness;
  readonly checkpointHash: string;
  readonly messageId: string;
  readonly seenAt: string;
}): string {
  const preimagen = ackPreimage({
    address: input.witness.address,
    checkpointHash: input.checkpointHash,
    messageId: input.messageId,
    seenAt: input.seenAt,
    witness: input.witness.id,
  });
  const json = Buffer.from(canonicalizeToBytes(preimagen)).toString('utf8');

  return [
    'Para que tu acuse cuente como prueba hace falta tu firma. Son dos órdenes en tu equipo:',
    '',
    `  printf '${OCTETO_DE_DOMINIO_OCTAL}%s' '${json}' > acuse.json`,
    `  ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n ${WITNESS_SIGNATURE_NAMESPACE} acuse.json`,
    '',
    'Después respondé a este correo pegando el contenido de acuse.json.sig y esta línea:',
    '',
    `  koinonia-visto: ${input.seenAt}`,
    '',
    'El `printf` no es un capricho: el fichero tiene que empezar por un byte de control que un',
    'copiar-y-pegar destruiría, y una firma sobre el fichero equivocado no vale. Si preferís',
    `atestiguar otro instante, cambiá ${input.seenAt} en LOS DOS sitios: dentro del JSON y en la`,
    'línea `koinonia-visto`. Tienen que coincidir.',
    '',
    'Si no querés firmar, respondé igual: tu acuse queda registrado como informativo. No cuenta',
    'para el umbral, pero sirve si algún día exhibís tu propia copia de este correo.',
  ].join('\n');
}

function fechaRfc5322(iso: string): string {
  return new Date(iso).toUTCString().replace(/GMT$/u, '+0000');
}

/**
 * `EmailTransport` real. **Un mensaje por testigo**, y el motivo está en `smtp.ts`: atribuir el
 * rechazo sin interpretación, y no repartir el padrón de testigos entre los propios testigos.
 */
export function smtpWitnessTransport(options: CorreoDeAnclajeOptions): EmailTransport {
  const dominio = options.messageIdDomain ?? 'anclaje.koinonia';

  return {
    async send(message): Promise<EmailDeliveryReport> {
      const ahora = options.now();
      const fecha = fechaRfc5322(ahora);
      const hex = /koinonia-checkpoint: ([0-9a-f]{64})/u.exec(message.body)?.[1] ?? '';

      const mensajes: MensajeSmtp[] = [];
      for (const [indice, address] of message.recipients.entries()) {
        const witness = options.witnesses.find(
          (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
        );
        const propio = `<${message.messageId.replace(/^<|>$/gu, '')}-${String(indice)}@${dominio}>`;

        const cuerpo =
          witness === undefined
            ? message.body
            : [
                message.body,
                '',
                '───────────────────────────────────────────────────────────',
                '',
                instruccionesDeAcuse({
                  witness,
                  checkpointHash: hex,
                  messageId: message.messageId,
                  seenAt: ahora,
                }),
              ].join('\n');

        const cabeceras = [
          { nombre: 'From', valor: options.from },
          { nombre: 'To', valor: address },
          { nombre: 'Subject', valor: message.subject },
          { nombre: 'Date', valor: fecha },
          { nombre: 'Message-ID', valor: propio },
          // El `Message-ID` del anclaje va en `References`: es lo que ata el acuse —y el rebote,
          // que lleva el mensaje original adjunto— al recibo que lo espera.
          { nombre: 'References', valor: message.messageId },
          { nombre: 'MIME-Version', valor: '1.0' },
          { nombre: 'Content-Type', valor: 'text/plain; charset=utf-8' },
          { nombre: 'Content-Transfer-Encoding', valor: '8bit' },
          // Sin esto, un lector de correo que conteste automáticamente generaría un bucle con el
          // buzón de anclaje, que además está siendo leído por un proceso.
          { nombre: 'Auto-Submitted', valor: 'auto-generated' },
        ];

        const conFirma =
          options.dkim === undefined
            ? cabeceras
            : [
                {
                  nombre: 'DKIM-Signature',
                  valor: firmarDkim(cabeceras, cuerpo, {
                    ...options.dkim,
                    timestamp: Math.floor(new Date(ahora).getTime() / 1000),
                  }).header,
                },
                ...cabeceras,
              ];

        mensajes.push({ to: address, data: ensamblar(conFirma, cuerpo) });
      }

      const entregas = await enviarPorSmtp(
        { ...options.smtp, envelopeFrom: options.envelopeFrom },
        mensajes,
      );

      const padron = padronDesde(options.witnesses);
      const bounced: WitnessBounce[] = [];
      for (const entrega of entregas) {
        if (entrega.rechazo === undefined) continue;
        bounced.push({
          ...entrega.rechazo,
          witness: padron.get(entrega.to.toLowerCase()),
        });
      }

      return {
        accepted: entregas.filter((e) => e.aceptado).map((e) => e.to),
        bounced,
      };
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Recogida
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Extrae el acuse de una respuesta.
 *
 * `seenAt` se toma **literal** de la línea `koinonia-visto`, sin normalizar. Normalizarlo —quitar
 * milisegundos, cambiar el huso— cambiaría la preimagen y rompería una firma legítima. Lo que el
 * testigo firmó es lo que el verificador tiene que ver.
 */
export function extraerAcuse(
  raw: string,
  messageId: string,
  witnesses: readonly Witness[],
): WitnessAck | undefined {
  const mensaje = parsearMensaje(raw);
  if (!respondeA(mensaje, messageId)) return undefined;

  const remitentes = direccionesDe(cabecera(mensaje, 'from'));
  const witness = witnesses.find((candidate) =>
    remitentes.includes(candidate.address.toLowerCase()),
  );
  if (witness === undefined) return undefined;

  const texto = todasLasPartes(mensaje)
    .map((parte) => cuerpoDecodificado(parte))
    .join('\n');

  const seenAt = VISTO.exec(texto)?.[1];
  if (seenAt === undefined) return undefined;

  const firma = ARMADURA.exec(texto)?.[0];
  return {
    witness: witness.id,
    address: witness.address,
    seenAt,
    // Una respuesta sin firma se registra igual: no cuenta para el umbral y sí demuestra, si algún
    // día hace falta, que la persona tuvo el correo. Descartarla sería tirar información.
    ...(firma === undefined ? {} : { signature: desangrar(firma) }),
  };
}

/**
 * Deshace el sangrado que meten los clientes de correo al citar.
 *
 * Un `> ` delante de cada línea de la armadura la deja ilegible para `parseSshSignature`, y el acuse
 * de un testigo que hizo todo bien se descartaría por culpa de su cliente de correo.
 */
function desangrar(armadura: string): string {
  return armadura
    .split('\n')
    .map((linea) => linea.replace(/^[>\s]*(?=[A-Za-z0-9+/=-])/u, '').trimEnd())
    .join('\n');
}

export interface RecogidaOptions {
  readonly witnesses: readonly Witness[];
  readonly imap: Omit<ImapOptions, 'connect'> & Pick<ImapOptions, 'connect'>;
}

/** `AckCollector` real: abre el buzón una vez y saca de ahí los acuses **y** los rebotes. */
export function imapAckCollector(options: RecogidaOptions): AckCollector {
  const padron = padronDesde(options.witnesses);

  return {
    async collect(messageId: string): Promise<AckCollection> {
      const crudos = await recogerMensajes(options.imap, `TEXT ${JSON.stringify(messageId)}`);

      const acks: WitnessAck[] = [];
      const bounces: WitnessBounce[] = [];

      for (const raw of crudos) {
        const rebotes = parsearRebotes(raw, padron);
        if (rebotes.length > 0) {
          bounces.push(...rebotes);
          continue;
        }
        const acuse = extraerAcuse(raw, messageId, options.witnesses);
        if (acuse !== undefined) acks.push(acuse);
      }

      // El último acuse de cada testigo gana: si alguien contesta dos veces —porque se equivocó al
      // firmar la primera—, vale el que mandó después.
      const porTestigo = new Map<string, WitnessAck>();
      for (const acuse of acks) porTestigo.set(acuse.witness, acuse);

      return { acks: [...porTestigo.values()], bounces };
    },
  };
}
