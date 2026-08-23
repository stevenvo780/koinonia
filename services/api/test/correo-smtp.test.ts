/**
 * El adaptador de correo por SMTP: **el único camino por el que alguien puede entrar**.
 *
 * Koinonía no tiene contraseñas. La puerta es un enlace de un solo uso que llega al buzón
 * institucional, así que un fallo callado aquí no es «un correo que no salió»: es la plataforma
 * cerrada con llave y respondiendo `202` como si todo fuera bien.
 *
 * Ninguna de estas pruebas abre un socket. Se usa el mismo doble guionizado que `anchor-correo.test.ts`
 * —`socketGuionizado`, de `anchor/socket.ts`— con las respuestas exactas de un servidor real,
 * incluidas la de autenticación fallida y la de destinatario rechazado.
 *
 * Las dos propiedades que estas pruebas existen para sostener, y que son de seguridad y no de
 * funcionamiento:
 *
 *  1. **Un fallo de envío no cambia nada de lo que se ve desde fuera.** `app.ts` hace
 *     `await ports.mailer.send(...)` sin protección y responde `202` con un cuerpo idéntico exista o
 *     no la cuenta. Si el adaptador lanzara al recibir un `550 5.1.1 User unknown`, las direcciones
 *     inexistentes darían `500` y las buenas `202`: un oráculo para averiguar quién está registrado
 *     probando nombres contra un dominio fijo.
 *  2. **El token no se escribe en el registro.** `consoleMailer` sí lo imprime, y ésa es su razón de
 *     ser en desarrollo. En un despliegue significa que quien lee el registro puede tomar la sesión
 *     de otra persona durante los quince minutos que vive el enlace.
 */

import { describe, expect, it } from 'vitest';

import { socketGuionizado, type SocketGuionizado } from '../src/anchor/socket.js';
import {
  cabeceraCodificada,
  consoleMailer,
  mensajeDeEntrada,
  remitenteCodificado,
  sinCredenciales,
  smtpMailer,
} from '../src/http/adapters.js';
import type { ClockPort, MailerPort, RandomPort } from '../src/http/ports.js';

const CRLF = '\r\n';

const INSTANTE = Date.parse('2026-08-22T04:00:00.000Z');

const reloj: ClockPort = { now: () => INSTANTE };

const azar: RandomPort = {
  bytes: (n: number) => new Uint8Array(n),
  opaqueId: () => 'f'.repeat(32),
  uuid: () => '00000000-0000-4000-8000-000000000001',
};

/** El correo literal que `app.ts` manda, con un token que no debe aparecer en ningún registro. */
const TOKEN = '9b7c1d3e5f7a9b1c3d5e7f9a1b3c5d7e';
const ENLACE = `https://koinonia.udea.edu.co/entrar/confirmar?token=${TOKEN}`;
const CORREO_DE_ENTRADA = {
  to: 'ana@udea.edu.co',
  subject: 'Tu enlace para entrar a Koinonía',
  text:
    `Hola.\n\nEste enlace te deja entrar a Koinonía. Sirve UNA sola vez y vence en ` +
    `15 minutos:\n\n${ENLACE}\n\n` +
    `Si no lo pediste vos, no hace falta que hagas nada: sin abrirlo, no pasa nada.\n\n` +
    `Koinonía no es un órgano de la Universidad de Antioquia ni la representa.\n`,
} as const;

const SALUDO = `220 mail.udea.edu.co ESMTP Postfix${CRLF}`;
const EHLO_OK = `250-mail.udea.edu.co${CRLF}250-STARTTLS${CRLF}250-AUTH PLAIN LOGIN${CRLF}250 8BITMIME${CRLF}`;
const EHLO_TRAS_TLS = `250-mail.udea.edu.co${CRLF}250 AUTH PLAIN${CRLF}`;

interface Montaje {
  readonly mailer: MailerPort;
  readonly socket: SocketGuionizado;
  readonly diario: string[];
}

function montar(
  respuestas: readonly string[],
  extra: {
    readonly tls?: 'starttls' | 'ninguna' | 'implicita';
    readonly auth?: { readonly user: string; readonly pass: string } | undefined;
    readonly from?: string;
    readonly saludo?: string;
  } = {},
): Montaje {
  const socket = socketGuionizado({ saludo: extra.saludo ?? SALUDO, respuestas });
  const diario: string[] = [];
  const mailer = smtpMailer({
    host: 'mail.udea.edu.co',
    port: 587,
    tls: extra.tls ?? 'starttls',
    from: extra.from ?? 'Koinonía <koinonia@udea.edu.co>',
    // `Object.hasOwn` y no `??`: pasar `auth: undefined` a propósito tiene que significar «sin
    // credenciales», no «poneme las de siempre».
    auth: Object.hasOwn(extra, 'auth')
      ? extra.auth
      : { user: 'koinonia', pass: 'secreto-de-la-vps' },
    connect: () => Promise.resolve(socket),
    clock: reloj,
    random: azar,
    diario: (linea) => diario.push(linea),
  });
  return { mailer, socket, diario };
}

/** Un relé de la casa: sin cifrar y sin credenciales. */
const SIN_TLS_NI_AUTH = { tls: 'ninguna', auth: undefined } as const;

/** El guion de una entrega que sale bien: STARTTLS, autenticación y `250` en cada paso. */
const ENTREGA_BUENA: readonly string[] = [
  EHLO_OK,
  `220 2.0.0 Ready to start TLS${CRLF}`,
  EHLO_TRAS_TLS,
  `235 2.7.0 Authentication successful${CRLF}`,
  `250 2.1.0 Ok${CRLF}`,
  `250 2.1.5 Ok${CRLF}`,
  `354 End data with <CR><LF>.<CR><LF>${CRLF}`,
  `250 2.0.0 Ok: queued as 4A2B${CRLF}`,
  `221 2.0.0 Bye${CRLF}`,
];

function mensajeEscrito(socket: SocketGuionizado): string {
  const escrito = socket.escrito.find((linea) => linea.includes('Subject:'));
  expect(escrito).toBeDefined();
  return escrito ?? '';
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Envío correcto
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('envío correcto', () => {
  it('diálogo completo: STARTTLS, AUTH PLAIN, sobre y mensaje', async () => {
    const { mailer, socket } = montar(ENTREGA_BUENA);

    await mailer.send(CORREO_DE_ENTRADA);

    expect(socket.elevadoATls()).toBe(true);
    expect(socket.cerrado()).toBe(true);
    // El HELO sale del dominio del remitente: es lo más parecido a la verdad que hay con las
    // variables que existen, y un `localhost` se lo comen pocos servidores serios.
    expect(socket.escrito[0]).toBe(`EHLO udea.edu.co${CRLF}`);
    expect(socket.escrito[1]).toBe(`STARTTLS${CRLF}`);
    expect(socket.escrito[2]).toBe(`EHLO udea.edu.co${CRLF}`);
    expect(socket.escrito[3]).toBe(
      `AUTH PLAIN ${Buffer.from('\0koinonia\0secreto-de-la-vps').toString('base64')}${CRLF}`,
    );
    expect(socket.escrito[4]).toBe(`MAIL FROM:<koinonia@udea.edu.co>${CRLF}`);
    expect(socket.escrito[5]).toBe(`RCPT TO:<ana@udea.edu.co>${CRLF}`);
    expect(socket.escrito[6]).toBe(`DATA${CRLF}`);
    expect(socket.escrito.at(-1)).toBe(`QUIT${CRLF}`);
  });

  it('el mensaje lleva las cabeceras que un receptor serio exige', async () => {
    const { mailer, socket } = montar(ENTREGA_BUENA);
    await mailer.send(CORREO_DE_ENTRADA);
    const mensaje = mensajeEscrito(socket);

    expect(mensaje).toContain(`From: =?utf-8?B?${Buffer.from('Koinonía').toString('base64')}?=`);
    expect(mensaje).toContain('<koinonia@udea.edu.co>');
    expect(mensaje).toContain(`To: ana@udea.edu.co${CRLF}`);
    expect(mensaje).toContain(`Date: Sat, 22 Aug 2026 04:00:00 +0000${CRLF}`);
    expect(mensaje).toContain(`Message-ID: <${'f'.repeat(32)}@udea.edu.co>${CRLF}`);
    expect(mensaje).toContain(`MIME-Version: 1.0${CRLF}`);
    expect(mensaje).toContain(`Content-Type: text/plain; charset=utf-8${CRLF}`);
    // RFC 3834: sin esto, cada respuesta automática de vacaciones vuelve al buzón del remitente.
    expect(mensaje).toContain(`Auto-Submitted: auto-generated${CRLF}`);
    // El `DATA` se cierra como manda el RFC 5321.
    expect(mensaje.endsWith(`${CRLF}.${CRLF}`)).toBe(true);
  });

  it('el cuerpo llega ENTERO y con las tildes bien: ni una «í» rota por el camino', async () => {
    const { mailer, socket } = montar(ENTREGA_BUENA);
    await mailer.send(CORREO_DE_ENTRADA);
    const mensaje = mensajeEscrito(socket);

    const cuerpo = mensaje
      .slice(mensaje.indexOf(`${CRLF}${CRLF}`) + 4)
      .replace(`${CRLF}.${CRLF}`, '');
    expect(Buffer.from(cuerpo.replaceAll(CRLF, ''), 'base64').toString('utf8')).toBe(
      CORREO_DE_ENTRADA.text,
    );
  });

  it('por el cable NO viaja ni un octeto de más de siete bits', async () => {
    // `enviarPorSmtp` escribe con `Buffer.from(texto, "binary")`, que trunca cada carácter a un
    // octeto. Con el cuerpo en base64 y el asunto en palabras codificadas no hay nada que truncar:
    // el mensaje entero es ASCII y no depende de que el servidor anuncie 8BITMIME.
    const { mailer, socket } = montar(ENTREGA_BUENA);
    await mailer.send(CORREO_DE_ENTRADA);

    for (const escrito of socket.escrito) {
      for (const caracter of escrito) {
        expect(caracter.codePointAt(0) ?? 0).toBeLessThan(0x80);
      }
    }
  });

  it('lo deja anotado sin el enlace: destinatario y Message-ID, que es lo que se cruza con el MTA', async () => {
    const { mailer, diario } = montar(ENTREGA_BUENA);
    await mailer.send(CORREO_DE_ENTRADA);

    expect(diario).toHaveLength(1);
    expect(diario[0]).toContain('entregado a ana@udea.edu.co');
    expect(diario[0]).toContain(`<${'f'.repeat(32)}@udea.edu.co>`);
  });

  it('sin credenciales configuradas no manda AUTH', async () => {
    const { mailer, socket } = montar(
      [
        `250 mail.udea.edu.co${CRLF}`,
        `250 2.1.0 Ok${CRLF}`,
        `250 2.1.5 Ok${CRLF}`,
        `354 go ahead${CRLF}`,
        `250 2.0.0 Ok: queued${CRLF}`,
        `221 Bye${CRLF}`,
      ],
      SIN_TLS_NI_AUTH,
    );
    await mailer.send(CORREO_DE_ENTRADA);

    expect(socket.escrito.some((linea) => linea.startsWith('AUTH'))).toBe(false);
    expect(socket.elevadoATls()).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Los tres fallos, y el silencio hacia fuera que exige la pantalla de entrada
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Guion de una autenticación rechazada: se llega hasta el `AUTH` y el servidor dice que no. */
const AUTENTICACION_RECHAZADA: readonly string[] = [
  EHLO_OK,
  `220 2.0.0 Ready to start TLS${CRLF}`,
  EHLO_TRAS_TLS,
  `535 5.7.8 Error: authentication failed: bad credentials${CRLF}`,
];

/** Guion de un destinatario rechazado: `RCPT TO` con `550`, `RSET` y salida limpia. */
const DESTINATARIO_RECHAZADO: readonly string[] = [
  `250 mail.udea.edu.co${CRLF}`,
  `250 2.1.0 Ok${CRLF}`,
  `550 5.1.1 <ana@udea.edu.co>: Recipient address rejected: User unknown in local recipient table${CRLF}`,
  `250 2.0.0 Ok${CRLF}`,
  `221 Bye${CRLF}`,
];

describe('fallo de autenticación', () => {
  it('NO lanza: la promesa se cumple igual que si hubiera salido', async () => {
    const { mailer } = montar(AUTENTICACION_RECHAZADA);
    await expect(mailer.send(CORREO_DE_ENTRADA)).resolves.toBeUndefined();
  });

  it('lo grita en el registro, con el código del servidor y las consecuencias', async () => {
    const { mailer, diario } = montar(AUTENTICACION_RECHAZADA);
    await mailer.send(CORREO_DE_ENTRADA);

    expect(diario).toHaveLength(1);
    expect(diario[0]).toMatch(/FALLÓ el envío a ana@udea\.edu\.co/u);
    expect(diario[0]).toMatch(/la autenticación falló/u);
    expect(diario[0]).toMatch(/535/u);
    expect(diario[0]).toMatch(/NO va a recibir su enlace/u);
  });

  it('la contraseña no se repite en el registro aunque el servidor la eche por delante', async () => {
    const credencial = Buffer.from('\0koinonia\0secreto-de-la-vps').toString('base64');
    const { mailer, diario } = montar([
      EHLO_OK,
      `220 2.0.0 Ready to start TLS${CRLF}`,
      EHLO_TRAS_TLS,
      `535 5.7.8 rejected AUTH PLAIN ${credencial} for user koinonia pass secreto-de-la-vps${CRLF}`,
    ]);
    await mailer.send(CORREO_DE_ENTRADA);

    expect(diario[0]).not.toContain('secreto-de-la-vps');
    expect(diario[0]).not.toContain(credencial);
    expect(diario[0]).toContain('[credencial omitida]');
  });

  it('un servidor que ni saluda tampoco tumba nada', async () => {
    const { mailer, diario } = montar([], { saludo: `421 Service not available${CRLF}` });
    await expect(mailer.send(CORREO_DE_ENTRADA)).resolves.toBeUndefined();
    expect(diario[0]).toMatch(/no saludó con 220/u);
  });

  it('si se pidió STARTTLS y el servidor no lo anuncia, se aborta y se dice; no se degrada', async () => {
    // Degradar a texto plano en silencio es exactamente lo que quiere quien está en la red: el
    // enlace de entrada viajaría legible. `enviarPorSmtp` ya aborta; aquí se comprueba que el
    // adaptador no lo convierte en un éxito silencioso.
    const { mailer, diario, socket } = montar([`250 mail.sin.tls${CRLF}`]);
    await expect(mailer.send(CORREO_DE_ENTRADA)).resolves.toBeUndefined();
    expect(diario[0]).toMatch(/se pidió STARTTLS y el servidor no lo anuncia/u);
    expect(socket.elevadoATls()).toBe(false);
  });
});

describe('rechazo del destinatario', () => {
  it('NO lanza, y anota a quién rechazaron y por qué', async () => {
    const { mailer, diario } = montar(DESTINATARIO_RECHAZADO, SIN_TLS_NI_AUTH);

    await expect(mailer.send(CORREO_DE_ENTRADA)).resolves.toBeUndefined();

    expect(diario).toHaveLength(1);
    expect(diario[0]).toMatch(/RECHAZÓ a ana@udea\.edu\.co/u);
    expect(diario[0]).toMatch(/User unknown in local recipient table/u);
    expect(diario[0]).toMatch(/NO va a recibir su enlace/u);
  });

  it('la IP que devuelve un servidor ajeno no acaba en el registro (C17)', async () => {
    const { mailer, diario } = montar(
      [
        `250 mail.udea.edu.co${CRLF}`,
        `250 2.1.0 Ok${CRLF}`,
        `550 5.7.1 rejected by 192.0.2.10, see policy${CRLF}`,
        `250 2.0.0 Ok${CRLF}`,
        `221 Bye${CRLF}`,
      ],
      SIN_TLS_NI_AUTH,
    );
    await mailer.send(CORREO_DE_ENTRADA);

    expect(diario[0]).not.toContain('192.0.2.10');
    expect(diario[0]).toContain('[ip omitida]');
  });
});

describe('la pantalla de entrada sigue sin revelar quién tiene cuenta', () => {
  /**
   * Modelo fiel de lo que hace `app.ts`: `await ports.mailer.send(...)` **sin protección** y después
   * `202` con un cuerpo que no depende del resultado del envío. Si el adaptador rechazara, Fastify
   * respondería `500` y la diferencia entre `500` y `202` diría si la dirección existe.
   */
  async function comoLoLlamaAppTs(
    mailer: MailerPort,
  ): Promise<{ estado: number; cuerpo: unknown }> {
    await mailer.send(CORREO_DE_ENTRADA);
    return { estado: 202, cuerpo: { enviado: true, duraMinutos: 15 } };
  }

  it('los cuatro desenlaces del envío dan EXACTAMENTE la misma respuesta HTTP', async () => {
    const desenlaces = [
      montar(ENTREGA_BUENA), // la dirección existe y el correo sale
      montar(DESTINATARIO_RECHAZADO, SIN_TLS_NI_AUTH), // «esa dirección no existe»
      montar(AUTENTICACION_RECHAZADA), // el servidor no nos deja entrar
      montar([], { saludo: `421 Service not available${CRLF}` }), // el servidor está caído
    ];

    const respuestas = await Promise.all(desenlaces.map(({ mailer }) => comoLoLlamaAppTs(mailer)));

    const esperada = { estado: 202, cuerpo: { enviado: true, duraMinutos: 15 } };
    for (const respuesta of respuestas) expect(respuesta).toStrictEqual(esperada);
  });

  it('una dirección con salto de línea no llega ni a abrir la conexión', async () => {
    // Un `CRLF` dentro del destinatario escribe cabeceras ajenas en nuestro mensaje —un `Bcc:`, por
    // ejemplo— y órdenes en la sesión SMTP. Se descarta antes de conectar, y sin lanzar.
    const { mailer, socket, diario } = montar(ENTREGA_BUENA);

    await expect(
      mailer.send({
        ...CORREO_DE_ENTRADA,
        to: 'ana@udea.edu.co\r\nBcc: intrusa@otro.example',
      }),
    ).resolves.toBeUndefined();

    expect(socket.escrito).toStrictEqual([]);
    expect(diario[0]).toMatch(/no es una dirección/u);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El token no se escribe en ninguna parte
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el registro no reparte sesiones ajenas', () => {
  it('ni el token, ni el enlace, ni el cuerpo, en ninguno de los desenlaces', async () => {
    const casos: readonly Montaje[] = [
      montar(ENTREGA_BUENA),
      montar(DESTINATARIO_RECHAZADO, SIN_TLS_NI_AUTH),
      montar(AUTENTICACION_RECHAZADA),
      montar([], { saludo: `421 Service not available${CRLF}` }),
    ];

    for (const caso of casos) await caso.mailer.send(CORREO_DE_ENTRADA);

    for (const caso of casos) {
      expect(caso.diario.length).toBeGreaterThan(0);
      const registro = caso.diario.join('\n');
      expect(registro).not.toContain(TOKEN);
      expect(registro).not.toContain(ENLACE);
      expect(registro).not.toContain('/entrar/confirmar');
      expect(registro).not.toContain('Sirve UNA sola vez');
    }
  });

  it('`consoleMailer` SÍ lo imprime, y eso es justo lo que lo hace inservible en producción', async () => {
    // No es un descuido suyo: su razón de ser es que en desarrollo se pueda leer el enlace sin
    // servidor de correo. Se comprueba el contraste para que la diferencia quede escrita.
    const original = process.stdout.write.bind(process.stdout);
    const salida: string[] = [];
    process.stdout.write = (texto: string): boolean => {
      salida.push(texto);
      return true;
    };
    try {
      await consoleMailer.send(CORREO_DE_ENTRADA);
    } finally {
      process.stdout.write = original;
    }

    expect(salida.join('')).toContain(TOKEN);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las piezas sueltas: codificación de cabeceras y tapado de credenciales
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('codificación de cabeceras (RFC 2047)', () => {
  it('lo que ya es ASCII se deja tal cual', () => {
    expect(cabeceraCodificada('Your link to enter')).toBe('Your link to enter');
  });

  it('lo que no lo es va en palabras codificadas que decodifican al original', () => {
    const codificado = cabeceraCodificada('Tu enlace para entrar a Koinonía');
    expect(codificado.startsWith('=?utf-8?B?')).toBe(true);
    expect(Buffer.from(codificado.slice(10, -2), 'base64').toString('utf8')).toBe(
      'Tu enlace para entrar a Koinonía',
    );
  });

  it('un asunto largo se pliega en varias palabras, ninguna de más de 75 octetos', () => {
    const codificado = cabeceraCodificada('ñ'.repeat(200));
    const palabras = codificado.split(`${CRLF} `);
    expect(palabras.length).toBeGreaterThan(1);
    for (const palabra of palabras) expect(palabra.length).toBeLessThanOrEqual(75);
  });

  it('no parte un carácter multibyte entre dos palabras: nada de «í» a medias', () => {
    // 45 octetos no caen en frontera de carácter con «ñ» (dos octetos cada una) ni con «€» (tres),
    // así que si el troceo fuera por octetos ciego, aparecería U+FFFD al decodificar.
    for (const relleno of ['ñ', '€', '𝄞']) {
      const codificado = cabeceraCodificada(relleno.repeat(120));
      const recompuesto = codificado
        .split(`${CRLF} `)
        .map((palabra) => Buffer.from(palabra.slice(10, -2), 'base64').toString('utf8'))
        .join('');
      expect(recompuesto).toBe(relleno.repeat(120));
      expect(recompuesto).not.toContain('\uFFFD');
    }
  });

  it('un salto de línea en el valor no parte la cabecera', () => {
    expect(cabeceraCodificada('asunto\r\nBcc: intrusa@otro.example')).toBe(
      'asunto Bcc: intrusa@otro.example',
    );
  });
});

describe('remitente', () => {
  it('el nombre visible se codifica y la dirección se deja legible', () => {
    expect(remitenteCodificado('Koinonía <koinonia@udea.edu.co>')).toBe(
      `=?utf-8?B?${Buffer.from('Koinonía').toString('base64')}?= <koinonia@udea.edu.co>`,
    );
  });

  it('una dirección a secas se deja como está', () => {
    expect(remitenteCodificado('koinonia@udea.edu.co')).toBe('koinonia@udea.edu.co');
  });

  it('un nombre ASCII con especiales se entrecomilla en vez de romper la cabecera', () => {
    expect(remitenteCodificado('Koinonia, Instituto <k@udea.edu.co>')).toBe(
      '"Koinonia, Instituto" <k@udea.edu.co>',
    );
  });

  it('el cuerpo va en base64 aunque el texto sea puro ASCII: un solo camino, no dos', () => {
    const mensaje = mensajeDeEntrada({
      from: 'koinonia@udea.edu.co',
      to: 'ana@udea.edu.co',
      subject: 'plain subject',
      text: 'hola\n',
      messageId: '<a@b>',
      instante: INSTANTE,
    });
    expect(mensaje).toContain(`Content-Transfer-Encoding: base64${CRLF}`);
    expect(mensaje.endsWith(Buffer.from('hola\n', 'utf8').toString('base64'))).toBe(true);
  });
});

describe('tapado de credenciales', () => {
  it('tapa usuario, contraseña y el base64 de AUTH PLAIN', () => {
    const auth = { user: 'koinonia', pass: 'secreto' };
    const credencial = Buffer.from('\0koinonia\0secreto').toString('base64');
    const tapado = sinCredenciales(`rechazado ${credencial} de koinonia con secreto`, auth);
    expect(tapado).not.toContain(credencial);
    expect(tapado).not.toContain('secreto');
    expect(tapado).not.toContain('koinonia');
  });

  it('sin credenciales configuradas no toca nada', () => {
    expect(sinCredenciales('550 5.1.1 User unknown', undefined)).toBe('550 5.1.1 User unknown');
  });
});
