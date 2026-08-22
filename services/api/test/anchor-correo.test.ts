/**
 * Transporte de correo del anclaje: **DKIM**, **SMTP con rebotes por destinatario**, **DSN** e
 * **IMAP**.
 *
 * Ninguna de estas pruebas abre un socket. El socket es un puerto y aquí se le da un guion con las
 * respuestas exactas de un servidor real, incluidas las de varias líneas y un `RCPT TO` rechazado en
 * medio de la sesión. Lo que queda sin cubrir es `nodeConnect()`, cuarenta líneas sin lógica que
 * están marcadas como tales en `socket.ts`.
 *
 * Las canonicalizaciones de DKIM se contrastan contra los ejemplos del propio RFC 6376 y contra los
 * dos `bh=` de cuerpo vacío que todo el mundo conoce de memoria. Es la única parte de DKIM que se
 * puede equivocar en silencio: una firma mal canonicalizada se entrega igual, sin autenticar, y sólo
 * se nota meses después cuando el correo empieza a caer en spam y ya nadie recuerda qué cambió.
 */

import type { Witness } from '@koinonia/anchor';
import { createHash, generateKeyPairSync, verify as verifyRaw } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  canonicalizarCabecera,
  canonicalizarCuerpo,
  cuerpoDecodificado,
  enviarPorSmtp,
  entrecomillar,
  extraerAcuse,
  firmarDkim,
  hashDeCuerpo,
  instruccionesDeAcuse,
  LineReader,
  leerLineaImap,
  mensajeOriginalDe,
  OCTETO_DE_DOMINIO_OCTAL,
  parsearFetch,
  parsearMensaje,
  parsearRebotes,
  parsearRespuestaSmtp,
  parsearSearch,
  padronDesde,
  recogerMensajes,
  rellenarPuntos,
  sinDireccionesIp,
  smtpWitnessTransport,
  socketGuionizado,
  SmtpError,
  type SocketGuionizado,
} from '../src/anchor/index.js';

const CRLF = '\r\n';
const AHORA = '2026-08-21T04:00:00.000Z';

const TESTIGOS: readonly Witness[] = [
  { id: 'docente_uno', address: 'ana@correo.example', publicKey: 'AAAA' },
  { id: 'externa', address: 'carla@externa.example', publicKey: 'BBBB' },
];

// ═════════════════════════════════════════════════════════════════════════════════════════════
// DKIM
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('canonicalización DKIM (RFC 6376 §3.4.5)', () => {
  it('cabeceras `relaxed`: el ejemplo literal del RFC', () => {
    expect(canonicalizarCabecera('A', ' X')).toBe('a:X');
    expect(canonicalizarCabecera('B', 'Y\t\r\n   Z  ')).toBe('b:Y Z');
  });

  it('cuerpo `relaxed` y `simple`: el ejemplo literal del RFC', () => {
    const cuerpo = ' C \r\nD \t E\r\n\r\n\r\n';
    expect(canonicalizarCuerpo(cuerpo, 'relaxed')).toBe(' C\r\nD E\r\n');
    expect(canonicalizarCuerpo(cuerpo, 'simple')).toBe(' C \r\nD \t E\r\n');
  });

  it('cuerpo vacío: los dos `bh=` que todo verificador conoce', () => {
    // Si estos dos valores no salen, la canonicalización está mal y toda firma que salga de aquí
    // será rechazada por el mundo entero sin decir por qué.
    expect(hashDeCuerpo('', 'relaxed')).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(hashDeCuerpo('', 'simple')).toBe('frcCV1k9oG9oKj3dpUqdJg1PxRT2RSN/XKdLCPjaYaY=');
  });

  it('las líneas vacías del final no cambian el hash, y las de en medio sí', () => {
    expect(hashDeCuerpo('hola\r\n', 'relaxed')).toBe(hashDeCuerpo('hola\r\n\r\n\r\n', 'relaxed'));
    expect(hashDeCuerpo('hola\r\n\r\nadios\r\n', 'relaxed')).not.toBe(
      hashDeCuerpo('hola\r\nadios\r\n', 'relaxed'),
    );
  });
});

describe('firma DKIM', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  const cabeceras = [
    { nombre: 'From', valor: 'Anclaje <anclaje@udea.example>' },
    { nombre: 'To', valor: 'ana@correo.example' },
    { nombre: 'Subject', valor: 'Koinonía — resumen de integridad' },
    { nombre: 'Date', valor: 'Fri, 21 Aug 2026 04:00:00 +0000' },
    { nombre: 'Message-ID', valor: '<abc@anclaje.koinonia>' },
  ];

  it('la firma verifica con una comprobación independiente, sobre el material declarado', () => {
    const firma = firmarDkim(cabeceras, 'cuerpo del anclaje\r\n', {
      domain: 'udea.example',
      selector: 'anclaje2026',
      algorithm: 'ed25519-sha256',
      privateKey,
      timestamp: 1_787_000_000,
    });

    const b = /b=([A-Za-z0-9+/=\s]+)$/u.exec(firma.header.replace(/\r\n /gu, ''))?.[1] ?? '';
    const resumen = createHash('sha256').update(firma.signedMaterial, 'utf8').digest();
    expect(verifyRaw(null, resumen, publicKey, Buffer.from(b.replace(/\s/gu, ''), 'base64'))).toBe(
      true,
    );
  });

  it('el material firmado termina en la propia cabecera con `b=` vacío y SIN CRLF', () => {
    const firma = firmarDkim(cabeceras, 'x\r\n', {
      domain: 'udea.example',
      selector: 's',
      algorithm: 'ed25519-sha256',
      privateKey,
      timestamp: 1_787_000_000,
    });
    expect(firma.signedMaterial).toMatch(/dkim-signature:v=1;[^\n]*b=$/u);
    expect(firma.signedMaterial.endsWith('\r\n')).toBe(false);
    expect(firma.signedMaterial).toContain('from:Anclaje <anclaje@udea.example>\r\n');
  });

  it('con el mismo instante, dos firmas son idénticas: el reloj entra como dato', () => {
    const opciones = {
      domain: 'udea.example',
      selector: 's',
      algorithm: 'ed25519-sha256' as const,
      privateKey,
      timestamp: 1_787_000_000,
    };
    expect(firmarDkim(cabeceras, 'x\r\n', opciones).header).toBe(
      firmarDkim(cabeceras, 'x\r\n', opciones).header,
    );
  });

  it('se niega a firmar sin `From`: una firma que no autentica al remitente no sirve de nada', () => {
    expect(() =>
      firmarDkim([{ nombre: 'Subject', valor: 'x' }], 'x', {
        domain: 'd',
        selector: 's',
        algorithm: 'ed25519-sha256',
        privateKey,
        timestamp: 1,
      }),
    ).toThrow(/DKIM exige firmar `From`/u);
  });

  it('ninguna línea de la cabecera pasa de 998 octetos (RFC 5322)', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const firma = firmarDkim(cabeceras, 'x\r\n', {
      domain: 'udea.example',
      selector: 'anclaje2026',
      algorithm: 'rsa-sha256',
      privateKey: rsa.privateKey,
      timestamp: 1_787_000_000,
    });
    for (const linea of firma.header.split(CRLF)) expect(linea.length).toBeLessThan(998);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SMTP
// ═════════════════════════════════════════════════════════════════════════════════════════════

function conectarCon(socket: SocketGuionizado) {
  return { conectar: () => Promise.resolve(socket), socket };
}

const SALUDO = `220 mail.udea.example ESMTP Postfix${CRLF}`;
const EHLO_OK = `250-mail.udea.example${CRLF}250-STARTTLS${CRLF}250-AUTH PLAIN LOGIN${CRLF}250 8BITMIME${CRLF}`;

describe('SMTP', () => {
  it('interpreta una respuesta de varias líneas y saca el código ampliado', () => {
    const respuesta = parsearRespuestaSmtp(['550-5.1.1 no existe', '550 5.1.1 fin']);
    expect(respuesta.code).toBe(550);
    expect(respuesta.status).toBe('5.1.1');
    expect(respuesta.lines).toHaveLength(2);
  });

  it('rellena los puntos al principio de línea', () => {
    expect(rellenarPuntos(`hola${CRLF}.oculto${CRLF}fin`)).toBe(`hola${CRLF}..oculto${CRLF}fin`);
  });

  it('diálogo completo con STARTTLS, autenticación y entrega', async () => {
    const { conectar, socket } = conectarCon(
      socketGuionizado({
        saludo: SALUDO,
        respuestas: [
          EHLO_OK,
          `220 2.0.0 Ready to start TLS${CRLF}`,
          `250-mail.udea.example${CRLF}250 AUTH PLAIN${CRLF}`,
          `235 2.7.0 Authentication successful${CRLF}`,
          `250 2.1.0 Ok${CRLF}`,
          `250 2.1.5 Ok${CRLF}`,
          `354 End data with <CR><LF>.<CR><LF>${CRLF}`,
          `250 2.0.0 Ok: queued as 4A2B${CRLF}`,
          `221 2.0.0 Bye${CRLF}`,
        ],
      }),
    );

    const entregas = await enviarPorSmtp(
      {
        host: 'mail.udea.example',
        port: 587,
        tls: 'starttls',
        helo: 'anclaje.udea.example',
        auth: { user: 'anclaje', pass: 'secreto' },
        connect: conectar,
        envelopeFrom: 'rebotes@udea.example',
      },
      [{ to: 'ana@correo.example', data: `Subject: x${CRLF}${CRLF}hola${CRLF}` }],
    );

    expect(entregas).toStrictEqual([
      { to: 'ana@correo.example', aceptado: true, rechazo: undefined },
    ]);
    expect(socket.elevadoATls()).toBe(true);
    expect(socket.cerrado()).toBe(true);
    expect(socket.escrito[0]).toBe(`EHLO anclaje.udea.example${CRLF}`);
    expect(socket.escrito[1]).toBe(`STARTTLS${CRLF}`);
    expect(socket.escrito.at(-1)).toBe(`QUIT${CRLF}`);
    // La credencial va en base64 con los separadores nulos, como manda AUTH PLAIN.
    expect(socket.escrito[3]).toBe(
      `AUTH PLAIN ${Buffer.from('\0anclaje\0secreto').toString('base64')}${CRLF}`,
    );
  });

  it('un destinatario rechazado NO tumba la sesión: se hace RSET y sigue el siguiente', async () => {
    const { conectar, socket } = conectarCon(
      socketGuionizado({
        saludo: SALUDO,
        respuestas: [
          `250-mail${CRLF}250 8BITMIME${CRLF}`,
          `250 2.1.0 Ok${CRLF}`,
          `550 5.1.1 <ana@correo.example>: Recipient address rejected: User unknown${CRLF}`,
          `250 2.0.0 Ok${CRLF}`, // RSET
          `250 2.1.0 Ok${CRLF}`, // MAIL FROM del segundo
          `250 2.1.5 Ok${CRLF}`,
          `354 go ahead${CRLF}`,
          `250 2.0.0 Ok: queued${CRLF}`,
          `221 Bye${CRLF}`,
        ],
      }),
    );

    const entregas = await enviarPorSmtp(
      {
        host: 'mail',
        port: 25,
        tls: 'ninguna',
        helo: 'anclaje',
        connect: conectar,
        envelopeFrom: 'rebotes@udea.example',
      },
      [
        { to: 'ana@correo.example', data: `Subject: x${CRLF}${CRLF}a${CRLF}` },
        { to: 'carla@externa.example', data: `Subject: x${CRLF}${CRLF}b${CRLF}` },
      ],
    );

    expect(entregas[0]?.aceptado).toBe(false);
    expect(entregas[0]?.rechazo?.kind).toBe('permanente');
    expect(entregas[0]?.rechazo?.status).toBe('5.1.1');
    expect(entregas[0]?.rechazo?.detail).toMatch(/User unknown/u);
    expect(entregas[1]?.aceptado).toBe(true);
    expect(socket.escrito).toContain(`RSET${CRLF}`);
  });

  it('un 4xx es transitorio, no permanente: el testigo no se da por perdido', async () => {
    const { conectar } = conectarCon(
      socketGuionizado({
        saludo: SALUDO,
        respuestas: [
          `250 mail${CRLF}`,
          `250 Ok${CRLF}`,
          `450 4.2.2 <ana@correo.example>: Mailbox full${CRLF}`,
          `250 Ok${CRLF}`,
          `221 Bye${CRLF}`,
        ],
      }),
    );
    const entregas = await enviarPorSmtp(
      {
        host: 'm',
        port: 25,
        tls: 'ninguna',
        helo: 'a',
        connect: conectar,
        envelopeFrom: 'r@x.example',
      },
      [{ to: 'ana@correo.example', data: `Subject: x${CRLF}${CRLF}a${CRLF}` }],
    );
    expect(entregas[0]?.rechazo?.kind).toBe('transitorio');
    expect(entregas[0]?.rechazo?.status).toBe('4.2.2');
  });

  it('si se pidió STARTTLS y el servidor no lo anuncia, se ABORTA en vez de degradar', async () => {
    const { conectar } = conectarCon(
      socketGuionizado({ saludo: SALUDO, respuestas: [`250 mail.sin.tls${CRLF}`] }),
    );
    await expect(
      enviarPorSmtp(
        {
          host: 'm',
          port: 587,
          tls: 'starttls',
          helo: 'a',
          connect: conectar,
          envelopeFrom: 'r@x.example',
        },
        [],
      ),
    ).rejects.toThrow(/se pidió STARTTLS y el servidor no lo anuncia/u);
  });

  it('un saludo que no es 220 se rechaza', async () => {
    const { conectar } = conectarCon(
      socketGuionizado({ saludo: `421 Service not available${CRLF}`, respuestas: [] }),
    );
    await expect(
      enviarPorSmtp(
        {
          host: 'm',
          port: 25,
          tls: 'ninguna',
          helo: 'a',
          connect: conectar,
          envelopeFrom: 'r@x.example',
        },
        [],
      ),
    ).rejects.toThrow(SmtpError);
  });

  it('la IP que devuelve un servidor ajeno NO acaba en el recibo (C17)', () => {
    expect(sinDireccionesIp('550 5.7.1 rejected by 192.0.2.10, see policy')).toBe(
      '550 5.7.1 rejected by [ip omitida], see policy',
    );
    expect(sinDireccionesIp('relay 2001:db8::1 refused')).toBe('relay [ip omitida] refused');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Rebotes (RFC 3464)
// ═════════════════════════════════════════════════════════════════════════════════════════════

const REBOTE_POSTFIX = [
  'From: MAILER-DAEMON@correo.example',
  'To: rebotes@udea.example',
  'Subject: Undelivered Mail Returned to Sender',
  'Content-Type: multipart/report; report-type=delivery-status; boundary="XYZ"',
  '',
  '--XYZ',
  'Content-Type: text/plain; charset=us-ascii',
  '',
  'This is the mail system at host correo.example.',
  '',
  '--XYZ',
  'Content-Type: message/delivery-status',
  '',
  'Reporting-MTA: dns; correo.example',
  '',
  'Final-Recipient: rfc822; ana@correo.example',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550 5.1.1 <ana@correo.example>: Recipient address rejected:',
  ' User unknown in local recipient table (relay 192.0.2.10)',
  '',
  '--XYZ',
  'Content-Type: message/rfc822',
  '',
  'Message-ID: <koinonia-abc-0@anclaje.koinonia>',
  'References: <koinonia-abc@anclaje.koinonia>',
  'Subject: Koinonía',
  '',
  '--XYZ--',
].join('\r\n');

describe('rebotes', () => {
  const padron = padronDesde(TESTIGOS);

  it('un rebote de Postfix se lee entero: testigo, código, motivo y sin IP', () => {
    const rebotes = parsearRebotes(REBOTE_POSTFIX, padron);
    expect(rebotes).toHaveLength(1);
    expect(rebotes[0]).toMatchObject({
      witness: 'docente_uno',
      address: 'ana@correo.example',
      kind: 'permanente',
      status: '5.1.1',
    });
    expect(rebotes[0]!.detail).toMatch(/User unknown in local recipient table/u);
    expect(rebotes[0]!.detail).not.toMatch(/192\.0\.2\.10/u);
    expect(rebotes[0]!.detail).toMatch(/\[ip omitida\]/u);
  });

  it('recupera el `Message-ID` del mensaje original que rebotó', () => {
    expect(mensajeOriginalDe(REBOTE_POSTFIX)).toBe('<koinonia-abc-0@anclaje.koinonia>');
  });

  it('un 4.x.x es TRANSITORIO: no se echa del padrón a quien sigue ahí', () => {
    const rebotes = parsearRebotes(
      REBOTE_POSTFIX.replace('Status: 5.1.1', 'Status: 4.2.2').replace(
        'Action: failed',
        'Action: delayed',
      ),
      padron,
    );
    expect(rebotes[0]?.kind).toBe('transitorio');
  });

  it('`Action: delivered` no es un rebote', () => {
    const rebotes = parsearRebotes(
      REBOTE_POSTFIX.replace('Action: failed', 'Action: delivered').replace(
        'Status: 5.1.1',
        'Status: 2.0.0',
      ),
      padron,
    );
    expect(rebotes).toStrictEqual([]);
  });

  it('un rebote sin informe estructurado se registra como transitorio y lo DICE', () => {
    const prosa = [
      'From: postmaster@externa.example',
      'Subject: Delivery Status Notification (Failure)',
      '',
      'No se pudo entregar el mensaje a carla@externa.example.',
    ].join('\r\n');

    const rebotes = parsearRebotes(prosa, padron);
    expect(rebotes).toHaveLength(1);
    expect(rebotes[0]?.kind).toBe('transitorio');
    expect(rebotes[0]?.witness).toBe('externa');
    expect(rebotes[0]?.detail).toMatch(/sin informe estructurado/u);
    expect(rebotes[0]?.detail).toMatch(/hay que mirarlo a mano/u);
  });

  it('un acuse normal NO se confunde con un rebote', () => {
    const acuse = ['From: ana@correo.example', 'Subject: Re: Koinonía', '', 'recibido'].join(
      '\r\n',
    );
    expect(parsearRebotes(acuse, padron)).toStrictEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// IMAP
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('IMAP', () => {
  it('lee un literal `{n}` sin desplazar el resto del diálogo', async () => {
    const cuerpo = 'Subject: hola\r\n\r\ncontenido\r\n';
    const socket = socketGuionizado({
      saludo: `* 1 FETCH (UID 7 BODY[] {${String(cuerpo.length)}}\r\n${cuerpo})\r\n`,
      respuestas: [],
    });
    const linea = await leerLineaImap(new LineReader(socket));
    expect(linea?.literales).toStrictEqual([cuerpo]);
    expect(linea?.texto).toMatch(/^\* 1 FETCH \(UID 7 BODY\[\] \)$/u);
    expect(parsearFetch([linea!])).toStrictEqual([cuerpo]);
  });

  it('lee los identificadores de una búsqueda', () => {
    expect(parsearSearch([{ texto: '* SEARCH 3 7 12', literales: [] }])).toStrictEqual([3, 7, 12]);
    expect(parsearSearch([{ texto: '* SEARCH', literales: [] }])).toStrictEqual([]);
  });

  it('entrecomilla escapando lo que hay que escapar', () => {
    expect(entrecomillar('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it('sesión completa: login, select, search, fetch y logout', async () => {
    const mensaje = 'From: ana@correo.example\r\n\r\nrecibido\r\n';
    const socket = socketGuionizado({
      saludo: `* OK [CAPABILITY IMAP4rev1] Dovecot ready.\r\n`,
      respuestas: [
        `k001 OK Logged in\r\n`,
        `* FLAGS (\\Answered \\Seen)\r\n* 3 EXISTS\r\nk002 OK [READ-WRITE] Select completed\r\n`,
        `* SEARCH 9\r\nk003 OK Search completed\r\n`,
        `* 3 FETCH (UID 9 BODY[] {${String(mensaje.length)}}\r\n${mensaje})\r\nk004 OK Fetch completed\r\n`,
        `k005 OK Logout completed\r\n`,
      ],
    });

    const mensajes = await recogerMensajes(
      {
        host: 'imap.udea.example',
        port: 993,
        tls: true,
        user: 'anclaje',
        pass: 'secreto',
        connect: () => Promise.resolve(socket),
      },
      'TEXT "<koinonia-abc@anclaje.koinonia>"',
    );

    expect(mensajes).toStrictEqual([mensaje]);
    expect(socket.escrito[0]).toBe('k001 LOGIN "anclaje" "secreto"\r\n');
    expect(socket.escrito[1]).toBe('k002 SELECT "INBOX"\r\n');
    expect(socket.escrito[2]).toBe('k003 UID SEARCH TEXT "<koinonia-abc@anclaje.koinonia>"\r\n');
    // `BODY.PEEK[]` y no `BODY[]`: leer con un proceso no debe marcar como visto lo que no vio nadie.
    expect(socket.escrito[3]).toBe('k004 UID FETCH 9 (BODY.PEEK[])\r\n');
    expect(socket.escrito[4]).toBe('k005 LOGOUT\r\n');
  });

  it('unas credenciales malas no se repiten en el error', async () => {
    const socket = socketGuionizado({
      saludo: `* OK ready\r\n`,
      respuestas: [`k001 NO [AUTHENTICATIONFAILED] Authentication failed for anclaje/secreto\r\n`],
    });
    const error = await recogerMensajes(
      {
        host: 'i',
        port: 993,
        tls: true,
        user: 'anclaje',
        pass: 'secreto',
        connect: () => Promise.resolve(socket),
      },
      'ALL',
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secreto');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Acuses e instrucciones
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('acuses recogidos del buzón', () => {
  const ARMADURA = [
    '-----BEGIN SSH SIGNATURE-----',
    'U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAg',
    'AAAAB2tvaW5vbmlhAAAAAAAAAAZzaGE1MTIAAABTAAAA',
    '-----END SSH SIGNATURE-----',
  ].join('\n');

  function respuesta(cuerpo: string, extra: Readonly<Record<string, string>> = {}): string {
    return [
      'From: Ana <ana@correo.example>',
      'To: anclaje@udea.example',
      'Subject: Re: Koinonía',
      'In-Reply-To: <koinonia-abc@anclaje.koinonia>',
      ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
      '',
      cuerpo,
    ].join('\r\n');
  }

  it('extrae testigo, instante y firma de una respuesta normal', () => {
    const acuse = extraerAcuse(
      respuesta(`koinonia-visto: ${AHORA}\n\n${ARMADURA}\n`),
      '<koinonia-abc@anclaje.koinonia>',
      TESTIGOS,
    );
    expect(acuse).toMatchObject({
      witness: 'docente_uno',
      address: 'ana@correo.example',
      seenAt: AHORA,
    });
    expect(acuse?.signature).toBe(ARMADURA);
  });

  it('deshace el sangrado `>` que meten los clientes al citar', () => {
    const citada = ARMADURA.split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    const acuse = extraerAcuse(
      respuesta(`koinonia-visto: ${AHORA}\n\n${citada}\n`),
      '<koinonia-abc@anclaje.koinonia>',
      TESTIGOS,
    );
    expect(acuse?.signature).toBe(ARMADURA);
  });

  it('una respuesta SIN firma se registra igual, como informativa', () => {
    const acuse = extraerAcuse(
      respuesta(`recibido, gracias\nkoinonia-visto: ${AHORA}\n`),
      '<koinonia-abc@anclaje.koinonia>',
      TESTIGOS,
    );
    expect(acuse?.signature).toBeUndefined();
    expect(acuse?.witness).toBe('docente_uno');
  });

  it('quien no está en el padrón no produce acuse, aunque conteste', () => {
    const ajena = respuesta(`koinonia-visto: ${AHORA}\n`).replace(
      'ana@correo.example',
      'intrusa@otro.example',
    );
    expect(extraerAcuse(ajena, '<koinonia-abc@anclaje.koinonia>', TESTIGOS)).toBeUndefined();
  });

  it('una respuesta a OTRO anclaje no cuenta para éste', () => {
    expect(
      extraerAcuse(respuesta(`koinonia-visto: ${AHORA}\n`), '<otro@anclaje.koinonia>', TESTIGOS),
    ).toBeUndefined();
  });

  it('el cuerpo en base64 se decodifica antes de buscar la firma', () => {
    const cuerpo = `koinonia-visto: ${AHORA}\n\n${ARMADURA}\n`;
    const codificado = [
      'From: Ana <ana@correo.example>',
      'In-Reply-To: <koinonia-abc@anclaje.koinonia>',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(cuerpo, 'utf8').toString('base64'),
    ].join('\r\n');

    expect(extraerAcuse(codificado, '<koinonia-abc@anclaje.koinonia>', TESTIGOS)?.seenAt).toBe(
      AHORA,
    );
  });
});

describe('instrucciones de firma que se le mandan al testigo', () => {
  it('fabrican el fichero con el octeto de dominio, que un copiar-y-pegar destruiría', () => {
    const texto = instruccionesDeAcuse({
      witness: TESTIGOS[0]!,
      checkpointHash: 'a'.repeat(64),
      messageId: '<koinonia-abc@anclaje.koinonia>',
      seenAt: AHORA,
    });

    expect(OCTETO_DE_DOMINIO_OCTAL).toBe('\\020');
    expect(texto).toContain(`printf '\\020%s'`);
    expect(texto).toContain(
      'ssh-keygen -Y sign -f ~/.ssh/id_ed25519 -n koinonia-anclaje acuse.json',
    );
    // El JSON va canónico (JCS): claves en orden alfabético y sin espacios.
    expect(texto).toContain(
      `{"address":"ana@correo.example","checkpointHash":"${'a'.repeat(64)}",` +
        `"messageId":"<koinonia-abc@anclaje.koinonia>","seenAt":"${AHORA}","witness":"docente_uno"}`,
    );
    expect(texto).toContain(`koinonia-visto: ${AHORA}`);
  });
});

describe('transporte completo', () => {
  it('manda UN mensaje por testigo, y ninguno enseña la dirección del otro', async () => {
    const socket = socketGuionizado({
      saludo: SALUDO,
      respuestas: [
        `250 mail${CRLF}`,
        `250 Ok${CRLF}`,
        `250 Ok${CRLF}`,
        `354 go${CRLF}`,
        `250 Ok${CRLF}`,
        `250 Ok${CRLF}`,
        `250 Ok${CRLF}`,
        `354 go${CRLF}`,
        `250 Ok${CRLF}`,
        `221 Bye${CRLF}`,
      ],
    });

    const transporte = smtpWitnessTransport({
      witnesses: TESTIGOS,
      from: 'Anclaje <anclaje@udea.example>',
      envelopeFrom: 'rebotes@udea.example',
      smtp: {
        host: 'm',
        port: 25,
        tls: 'ninguna',
        helo: 'anclaje.udea.example',
        connect: () => Promise.resolve(socket),
      },
      now: () => AHORA,
    });

    const informe = await transporte.send({
      messageId: '<koinonia-abc@anclaje.koinonia>',
      subject: 'Koinonía — resumen',
      body: `Este correo es un anclaje.\n\nkoinonia-checkpoint: ${'a'.repeat(64)}\n`,
      recipients: TESTIGOS.map((w) => w.address),
    });

    expect(informe.accepted).toStrictEqual(['ana@correo.example', 'carla@externa.example']);
    expect(informe.bounced).toStrictEqual([]);

    const cuerpos = socket.escrito.filter((linea) => linea.includes('Subject: Koinonía'));
    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[0]).toContain('To: ana@correo.example');
    expect(cuerpos[0]).not.toContain('carla@externa.example');
    expect(cuerpos[1]).toContain('To: carla@externa.example');
    expect(cuerpos[1]).not.toContain('ana@correo.example');
    // El `Message-ID` del anclaje va en `References`: es lo que ata acuses y rebotes al recibo.
    expect(cuerpos[0]).toContain('References: <koinonia-abc@anclaje.koinonia>');
  });

  it('el rechazo se atribuye al testigo del padrón, no a una dirección suelta', async () => {
    const socket = socketGuionizado({
      saludo: SALUDO,
      respuestas: [
        `250 mail${CRLF}`,
        `250 Ok${CRLF}`,
        `550 5.1.1 User unknown${CRLF}`,
        `250 Ok${CRLF}`,
        `221 Bye${CRLF}`,
      ],
    });

    const transporte = smtpWitnessTransport({
      witnesses: TESTIGOS,
      from: 'Anclaje <anclaje@udea.example>',
      envelopeFrom: 'rebotes@udea.example',
      smtp: {
        host: 'm',
        port: 25,
        tls: 'ninguna',
        helo: 'a',
        connect: () => Promise.resolve(socket),
      },
      now: () => AHORA,
    });

    const informe = await transporte.send({
      messageId: '<koinonia-abc@anclaje.koinonia>',
      subject: 'Koinonía — resumen',
      body: `koinonia-checkpoint: ${'a'.repeat(64)}\n`,
      recipients: ['ana@correo.example'],
    });

    expect(informe.bounced).toHaveLength(1);
    expect(informe.bounced[0]?.witness).toBe('docente_uno');
    expect(informe.bounced[0]?.kind).toBe('permanente');
  });
});

describe('MIME', () => {
  it('despliega cabeceras continuadas', () => {
    const mensaje = parsearMensaje(
      'Subject: una cosa\r\n  y otra\r\nFrom: a@b.example\r\n\r\ncuerpo',
    );
    expect(mensaje.headers.get('subject')).toStrictEqual(['una cosa y otra']);
    expect(cuerpoDecodificado(mensaje)).toBe('cuerpo');
  });

  it('deshace quoted-printable', () => {
    const mensaje = parsearMensaje(
      'Content-Transfer-Encoding: quoted-printable\r\n\r\nma=C3=B1ana=\r\n y m=C3=A1s',
    );
    expect(Buffer.from(cuerpoDecodificado(mensaje), 'binary').toString('utf8')).toBe(
      'mañana y más',
    );
  });
});
