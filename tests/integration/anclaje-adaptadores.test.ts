/**
 * **El ciclo de anclaje entero, con los adaptadores reales enchufados.**
 *
 * Las pruebas unitarias comprueban cada pieza por separado: el retroceso, la fusión de sellos, la
 * comparación entre forjas, el diálogo SMTP, el parseo de un rebote. Lo que se comprueba aquí es que
 * **encajan**: que el cliente HTTP de OpenTimestamps habla con el `OpenTimestampsProvider`, que el
 * cliente de Codeberg produce bytes que el `SignedGitProvider` sabe verificar, que lo que sale del
 * buzón por IMAP se convierte en un acuse que el verificador acepta, y que el quórum cuenta lo que
 * tiene que contar.
 *
 * Y, sobre todo: que **una discrepancia entre las dos forjas tumba el anclaje y queda escrita en el
 * ledger**. Ese es el caso que justifica que la clase `vcs` exista.
 *
 * Nada de esto sale a la red. El `fetch` y los sockets entran inyectados, con las respuestas exactas
 * que darían los servicios reales. Lo que sí salió a la red una vez, a mano, está documentado en
 * `services/api/src/anchor/verificacion-manual.ts`.
 */

import {
  ackPreimage,
  ackSignedBytes,
  ANCHOR_CONFIRMED,
  ANCHOR_FAILED,
  ANCHOR_STATE_PUBLISHED,
  armorSshSignature,
  buildCommitBytes,
  buildSshSignatureBlob,
  calendarPool,
  checkpointBindingLine,
  checkpointRefFromHex,
  commitOid,
  DEFAULT_BACKOFF,
  FakeOtsCalendar,
  httpCalendar,
  immediateClock,
  OpenTimestampsProvider,
  parseCommit,
  parseDetachedTimestamp,
  retryingCalendar,
  runAnchorCycle,
  serializeDetachedTimestamp,
  SignedGitProvider,
  sshPublicKeyBlob,
  sshSignedBlob,
  staticHeaders,
  toBase64,
  walk,
  WitnessEmailProvider,
  type AnchorProvider,
  type FetchLike,
  type OtsTimestamp,
  type Witness,
} from '@koinonia/anchor';
import { sha256, toHex } from '@koinonia/crypto';
import { describe, expect, it } from 'vitest';

import {
  codebergForge,
  esReintentable,
  githubForge,
  imapAckCollector,
  smtpWitnessTransport,
  socketGuionizado,
} from '../../services/api/src/anchor/index.js';

const CRLF = '\r\n';
const CHECKPOINT = new Uint8Array(32).fill(0x9c);
const HEX = toHex(CHECKPOINT);
const EMISION = '2026-08-21T03:00:00.000Z';
const AHORA = '2026-08-21T04:00:00.000Z';
const PREFIJO_DETACHED = 65;

const subtle = globalThis.crypto.subtle;
/** `CryptoKey` no está en `lib: ES2022`; se deriva del propio WebCrypto en vez de declararla. */
type Clave = Awaited<ReturnType<typeof subtle.importKey>>;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Utillaje: claves, commits y calendarios de mentira que hablan HTTP de verdad
// ═════════════════════════════════════════════════════════════════════════════════════════════

interface Firmante {
  readonly publicKey: string;
  firmar(namespace: string, message: Uint8Array): Promise<string>;
}

async function nuevoFirmante(): Promise<Firmante> {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as {
    readonly privateKey: Clave;
    readonly publicKey: Clave;
  };
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const publicKeyBlob = sshPublicKeyBlob('ssh-ed25519', raw);
  return {
    publicKey: toBase64(publicKeyBlob),
    async firmar(namespace, message) {
      const blob = await sshSignedBlob(namespace, new Uint8Array(0), 'sha512', message);
      const signature = new Uint8Array(
        await subtle.sign({ name: 'Ed25519' }, pair.privateKey, blob),
      );
      return armorSshSignature(
        buildSshSignatureBlob({
          publicKeyBlob,
          namespace,
          hashAlgorithm: 'sha512',
          signatureType: 'ssh-ed25519',
          signature,
        }),
      );
    },
  };
}

const AUTOR = 'Veeduría <veeduria@ejemplo.org> 1787000000 +0000';
const ARBOL = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

async function commitFirmado(firmante: Firmante, mensaje: string): Promise<Uint8Array> {
  const base = { tree: ARBOL, author: AUTOR, committer: AUTOR, message: mensaje };
  const armadura = await firmante.firmar('git', buildCommitBytes(base));
  return buildCommitBytes({ ...base, signature: armadura });
}

/** La respuesta JSON de una forja para un commit ya firmado. */
function respuestaDeForja(bytes: Uint8Array, estilo: 'github' | 'codeberg'): unknown {
  const commit = parseCommit(bytes);
  const verification = {
    verified: true,
    signature: commit.signature,
    payload: new TextDecoder().decode(commit.signedPayload),
  };
  return estilo === 'github' ? { sha: 'x', verification } : { sha: 'x', commit: { verification } };
}

function fetchDeForjas(rutas: Readonly<Record<string, unknown>>): typeof globalThis.fetch {
  return ((url: string) =>
    Promise.resolve(
      rutas[url] === undefined
        ? new Response('{"message":"Not Found"}', { status: 404 })
        : new Response(JSON.stringify(rutas[url]), { status: 200 }),
    )) as unknown as typeof globalThis.fetch;
}

/** Busca el nodo del árbol cuyo mensaje es `msg`. Hace falta para simular el `upgrade` real. */
function subarbolEn(nodo: OtsTimestamp, msg: string): OtsTimestamp | undefined {
  if (toHex(nodo.msg) === msg) return nodo;
  for (const rama of nodo.ops) {
    const encontrado = subarbolEn(rama.timestamp, msg);
    if (encontrado !== undefined) return encontrado;
  }
  return undefined;
}

function suelto(detached: Uint8Array): Uint8Array {
  return detached.slice(PREFIJO_DETACHED);
}

/**
 * Un calendario HTTP de verdad —`httpCalendar`— contra un servidor de mentira que se comporta como
 * un calendario real: `POST /digest` devuelve un sello pendiente y `GET /timestamp/{compromiso}`
 * devuelve el camino hasta el bloque, indexado **por compromiso**, que es como funciona el protocolo.
 */
async function servidorDeCalendario(
  uri: string,
  fake: FakeOtsCalendar,
  fileDigest: Uint8Array,
  opciones: { readonly maduro: boolean },
): Promise<FetchLike> {
  const pendiente = await fake.stamp(fileDigest);
  const arbolPendiente = (await parseDetachedTimestamp(pendiente)).timestamp;
  const compromisos = walk(arbolPendiente)
    .filter((h) => h.attestation.kind === 'pending')
    .map((h) => toHex(h.digest));

  const maduros = new Map<string, Uint8Array>();
  if (opciones.maduro) {
    const arbolMaduro = (await parseDetachedTimestamp((await fake.upgrade(pendiente))!)).timestamp;
    for (const compromiso of compromisos) {
      const rama = subarbolEn(arbolMaduro, compromiso);
      if (rama === undefined) continue;
      maduros.set(
        compromiso,
        suelto(
          serializeDetachedTimestamp({
            majorVersion: 1,
            fileHashOp: { kind: 'sha256' },
            fileDigest: rama.msg,
            timestamp: rama,
          }),
        ),
      );
    }
  }

  const responder = (bytes: Uint8Array, status = 200) => {
    const copia = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copia).set(bytes);
    return { ok: status < 300, status, arrayBuffer: () => Promise.resolve(copia) };
  };

  return (url) => {
    if (url === `${uri}/digest`) return Promise.resolve(responder(suelto(pendiente)));
    const compromiso = url.startsWith(`${uri}/timestamp/`)
      ? url.slice(`${uri}/timestamp/`.length)
      : undefined;
    const rama = compromiso === undefined ? undefined : maduros.get(compromiso);
    if (rama === undefined) return Promise.resolve(responder(new Uint8Array(0), 404));
    return Promise.resolve(responder(rama));
  };
}

function checkpoint() {
  return checkpointRefFromHex({
    treeSize: 12_480n,
    rootHash: 'a'.repeat(64),
    headsRoot: 'b'.repeat(64),
    checkpointHash: HEX,
    issuedAt: EMISION,
  });
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// OpenTimestamps por HTTP, de punta a punta
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('OpenTimestamps: del cliente HTTP al quórum', () => {
  it('dos calendarios sellan, uno madura, y la clase `blockchain` cuenta', async () => {
    const fileDigest = await sha256(CHECKPOINT);
    const alice = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });
    const bob = new FakeOtsCalendar({ uri: 'https://bob.invalid', nonceLabel: 'b' });

    const pool = calendarPool([
      retryingCalendar(
        httpCalendar(
          'https://alice.invalid',
          await servidorDeCalendario('https://alice.invalid', alice, fileDigest, { maduro: true }),
        ),
        { policy: DEFAULT_BACKOFF, clock: immediateClock(), retryable: esReintentable },
      ),
      retryingCalendar(
        httpCalendar(
          'https://bob.invalid',
          await servidorDeCalendario('https://bob.invalid', bob, fileDigest, { maduro: false }),
        ),
        { policy: DEFAULT_BACKOFF, clock: immediateClock(), retryable: esReintentable },
      ),
    ]);

    const proveedor = new OpenTimestampsProvider({
      calendar: pool,
      headers: {
        get: (altura) => alice.headers().get(altura) ?? bob.headers().get(altura),
      },
      clock: () => AHORA,
    });

    const recibo = await proveedor.poll(await proveedor.submit(CHECKPOINT));
    const resultado = await proveedor.verify(recibo, CHECKPOINT);

    expect(resultado.status).toBe('confirmado');
    // La rama del calendario que no maduró sigue ahí: es con la que se reintenta mañana.
    expect(
      resultado.checks.filter((c) => c.name === 'atestacion_pendiente').length,
    ).toBeGreaterThan(0);
    expect(resultado.residualClaims.some((r) => /es realmente [0-9a-f]{64}/u.test(r.claim))).toBe(
      true,
    );
  });

  it('si TODOS los calendarios se caen, el ciclo lo escribe en el ledger y no lo tapa', async () => {
    const caido: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 503,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });

    const proveedor = new OpenTimestampsProvider({
      calendar: calendarPool([
        retryingCalendar(httpCalendar('https://alice.invalid', caido), {
          policy: { ...DEFAULT_BACKOFF, attempts: 2 },
          clock: immediateClock(),
          retryable: esReintentable,
        }),
        retryingCalendar(httpCalendar('https://bob.invalid', caido), {
          policy: { ...DEFAULT_BACKOFF, attempts: 2 },
          clock: immediateClock(),
          retryable: esReintentable,
        }),
      ]),
      clock: () => AHORA,
    });

    const resultado = await runAnchorCycle({
      checkpoint: checkpoint(),
      providers: [proveedor],
      now: AHORA,
    });

    const fallidos = resultado.events.filter((e) => e.eventType === ANCHOR_FAILED);
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0]!.payload['motivo']).toMatch(/alice\.invalid/u);
    expect(fallidos[0]!.payload['motivo']).toMatch(/bob\.invalid/u);
    expect(resultado.verdict.firm).toBe(false);
    expect(resultado.events.at(-1)?.eventType).toBe(ANCHOR_STATE_PUBLISHED);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Las dos forjas, por su API real
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('forjas: Codeberg y GitHub contra el mismo checkpoint', () => {
  const mensaje = (titulo: string): string =>
    [titulo, '', checkpointBindingLine(HEX), ''].join('\n');

  async function proveedorGit(
    firmante: Firmante,
    codeberg: Uint8Array,
    github: Uint8Array,
  ): Promise<AnchorProvider> {
    const oidC = await commitOid(codeberg);
    const oidG = await commitOid(github);
    return new SignedGitProvider({
      allowedSigners: [{ identity: 'Veeduría 2026-2', publicKey: firmante.publicKey }],
      signingKeyOffHost: true,
      forges: ['codeberg', 'github'],
      clock: () => AHORA,
      forgeClients: [
        codebergForge({
          owner: 'instituto',
          repo: 'anclaje',
          branch: 'anclaje',
          http: {
            fetchImpl: fetchDeForjas({
              'https://codeberg.org/api/v1/repos/instituto/anclaje/branches/anclaje': {
                commit: { id: oidC },
              },
              [`https://codeberg.org/api/v1/repos/instituto/anclaje/git/commits/${oidC}`]:
                respuestaDeForja(codeberg, 'codeberg'),
            }),
          },
        }),
        githubForge({
          owner: 'instituto',
          repo: 'anclaje',
          branch: 'anclaje',
          http: {
            fetchImpl: fetchDeForjas({
              'https://api.github.com/repos/instituto/anclaje/git/ref/heads/anclaje': {
                object: { sha: oidG },
              },
              [`https://api.github.com/repos/instituto/anclaje/git/commits/${oidG}`]:
                respuestaDeForja(github, 'github'),
            }),
          },
        }),
      ],
    });
  }

  it('las dos con el MISMO commit: la clase `vcs` se confirma', async () => {
    const firmante = await nuevoFirmante();
    const commit = await commitFirmado(firmante, mensaje('Checkpoint 12480'));
    const proveedor = await proveedorGit(firmante, commit, commit);

    const resultado = await runAnchorCycle({
      checkpoint: checkpoint(),
      providers: [proveedor],
      now: AHORA,
      poll: true,
    });

    expect(resultado.attempts[0]?.outcome?.status).toBe('confirmado');
    expect(resultado.events.some((e) => e.eventType === ANCHOR_CONFIRMED)).toBe(true);
    expect(resultado.verdict.confirmedClasses).toStrictEqual(['vcs']);
    // Una sola clase no basta: la regla no se relaja porque la forja diga que sí.
    expect(resultado.verdict.firm).toBe(false);
  });

  it('UNA forja reescrita: el ciclo NO confirma y la discrepancia queda en el ledger', async () => {
    const firmante = await nuevoFirmante();
    const legitimo = await commitFirmado(firmante, mensaje('Checkpoint 12480'));
    const reescrito = await commitFirmado(firmante, mensaje('Checkpoint 12480 rehecho'));
    const proveedor = await proveedorGit(firmante, legitimo, reescrito);

    const resultado = await runAnchorCycle({
      checkpoint: checkpoint(),
      providers: [proveedor],
      now: AHORA,
      poll: true,
    });

    const fallidos = resultado.events.filter((e) => e.eventType === ANCHOR_FAILED);
    expect(fallidos).toHaveLength(1);
    expect(fallidos[0]!.payload['motivo']).toMatch(/las forjas discrepan/u);
    expect(fallidos[0]!.payload['motivo']).toMatch(/push --force/u);
    expect(resultado.events.some((e) => e.eventType === ANCHOR_CONFIRMED)).toBe(false);
    expect(resultado.verdict.confirmedClasses).toStrictEqual([]);
    expect(resultado.verdict.state).toBe('NO_ANCLADO');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// El correo, del socket al quórum
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('testigos por correo: del buzón IMAP al acuse verificado', () => {
  const DIRECCIONES: readonly (readonly [string, string])[] = [
    ['docente_uno', 'ana@correo.example'],
    ['docente_dos', 'bruno@otrocorreo.example'],
    ['externa', 'carla@externa.example'],
  ];

  async function padron(): Promise<{
    readonly witnesses: readonly Witness[];
    readonly firmantes: ReadonlyMap<string, Firmante>;
  }> {
    const witnesses: Witness[] = [];
    const firmantes = new Map<string, Firmante>();
    for (const [id, address] of DIRECCIONES) {
      const firmante = await nuevoFirmante();
      firmantes.set(id, firmante);
      witnesses.push({ id, address, publicKey: firmante.publicKey });
    }
    return { witnesses, firmantes };
  }

  async function respuestaFirmada(
    witness: Witness,
    firmante: Firmante,
    messageId: string,
  ): Promise<string> {
    const armadura = await firmante.firmar(
      'koinonia-anclaje',
      ackSignedBytes(
        ackPreimage({
          address: witness.address,
          checkpointHash: HEX,
          messageId,
          seenAt: AHORA,
          witness: witness.id,
        }),
      ),
    );
    return [
      `From: ${witness.address}`,
      'To: anclaje@udea.example',
      'Subject: Re: Koinonía',
      `In-Reply-To: ${messageId}`,
      '',
      `koinonia-visto: ${AHORA}`,
      '',
      armadura,
      '',
    ].join(CRLF);
  }

  function guionSmtp(destinatarios: number, rechazar: number = -1) {
    const respuestas = [`250-mail${CRLF}250 8BITMIME${CRLF}`];
    for (let i = 0; i < destinatarios; i++) {
      respuestas.push(`250 Ok${CRLF}`); // MAIL FROM
      if (i === rechazar) {
        respuestas.push(`550 5.1.1 <destino>: Recipient address rejected: User unknown${CRLF}`);
        respuestas.push(`250 Ok${CRLF}`); // RSET
        continue;
      }
      respuestas.push(`250 Ok${CRLF}`); // RCPT TO
      respuestas.push(`354 go${CRLF}`);
      respuestas.push(`250 Ok: queued${CRLF}`);
    }
    respuestas.push(`221 Bye${CRLF}`);
    return socketGuionizado({ saludo: `220 mail ESMTP${CRLF}`, respuestas });
  }

  function guionImap(mensajes: readonly string[]) {
    const respuestas = [
      `k001 OK Logged in${CRLF}`,
      `* 3 EXISTS${CRLF}k002 OK Select completed${CRLF}`,
      `* SEARCH ${mensajes.map((_, i) => String(i + 1)).join(' ')}${CRLF}k003 OK done${CRLF}`,
    ];
    mensajes.forEach((mensaje, i) => {
      respuestas.push(
        `* ${String(i + 1)} FETCH (UID ${String(i + 1)} BODY[] {${String(mensaje.length)}}${CRLF}` +
          `${mensaje})${CRLF}k${String(i + 4).padStart(3, '0')} OK Fetch completed${CRLF}`,
      );
    });
    respuestas.push(`k${String(mensajes.length + 4).padStart(3, '0')} OK Logout${CRLF}`);
    return socketGuionizado({ saludo: `* OK Dovecot ready.${CRLF}`, respuestas });
  }

  it('tres acuses firmados de tres dominios distintos confirman la clase `human-witness`', async () => {
    const p = await padron();
    const smtp = guionSmtp(3);

    const proveedorEnvio = new WitnessEmailProvider({
      witnesses: p.witnesses,
      clock: () => AHORA,
      transport: smtpWitnessTransport({
        witnesses: p.witnesses,
        from: 'Anclaje <anclaje@udea.example>',
        envelopeFrom: 'rebotes@udea.example',
        smtp: {
          host: 'm',
          port: 25,
          tls: 'ninguna',
          helo: 'anclaje.udea.example',
          connect: () => Promise.resolve(smtp),
        },
        now: () => AHORA,
      }),
    });

    const enviado = await proveedorEnvio.submit(CHECKPOINT);
    expect(enviado.raw['accepted']).toHaveLength(3);

    const respuestas: string[] = [];
    for (const witness of p.witnesses) {
      respuestas.push(
        await respuestaFirmada(witness, p.firmantes.get(witness.id)!, enviado.externalRef),
      );
    }

    const proveedorRecogida = new WitnessEmailProvider({
      witnesses: p.witnesses,
      clock: () => AHORA,
      collector: imapAckCollector({
        witnesses: p.witnesses,
        imap: {
          host: 'i',
          port: 993,
          tls: true,
          user: 'anclaje',
          pass: 'x',
          connect: () => Promise.resolve(guionImap(respuestas)),
        },
      }),
    });

    const recibo = await proveedorRecogida.poll(enviado);
    const resultado = await proveedorRecogida.verify(recibo, CHECKPOINT);

    expect(resultado.status).toBe('confirmado');
    expect(resultado.checks.filter((c) => c.name === 'acuse' && c.ok)).toHaveLength(3);
    expect(resultado.detail).toMatch(/3 personas de dominios de correo distintos/u);
  });

  it('un rechazo en el acto se atribuye al testigo y deja el umbral sin alcanzar', async () => {
    const p = await padron();
    const smtp = guionSmtp(3, 1);

    const proveedor = new WitnessEmailProvider({
      witnesses: p.witnesses,
      clock: () => AHORA,
      transport: smtpWitnessTransport({
        witnesses: p.witnesses,
        from: 'Anclaje <anclaje@udea.example>',
        envelopeFrom: 'rebotes@udea.example',
        smtp: {
          host: 'm',
          port: 25,
          tls: 'ninguna',
          helo: 'a',
          connect: () => Promise.resolve(smtp),
        },
        now: () => AHORA,
      }),
    });

    const recibo = await proveedor.submit(CHECKPOINT);
    const resultado = await proveedor.verify(recibo, CHECKPOINT);

    expect(recibo.raw['accepted']).toStrictEqual(['ana@correo.example', 'carla@externa.example']);
    expect(resultado.checks.some((c) => c.name === 'rebote' && /docente_dos/u.test(c.detail))).toBe(
      true,
    );
    expect(resultado.status).toBe('pendiente');
    expect(
      resultado.residualClaims.some((r) =>
        /quedan 2 dominios alcanzables y hacen falta 3/u.test(r.verifyBy),
      ),
    ).toBe(true);
  });

  it('el buzón trae a la vez un acuse y un rebote, y los separa', async () => {
    const p = await padron();
    const ana = p.witnesses[0]!;
    const messageId = `<koinonia-${HEX.slice(0, 32)}@anclaje.koinonia>`;

    const rebote = [
      'From: MAILER-DAEMON@otrocorreo.example',
      'Subject: Undelivered Mail Returned to Sender',
      'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
      '',
      '--B',
      'Content-Type: message/delivery-status',
      '',
      'Final-Recipient: rfc822; bruno@otrocorreo.example',
      'Action: failed',
      'Status: 5.1.1',
      'Diagnostic-Code: smtp; 550 5.1.1 User unknown',
      '',
      '--B--',
    ].join(CRLF);

    const acuse = await respuestaFirmada(ana, p.firmantes.get(ana.id)!, messageId);
    const proveedor = new WitnessEmailProvider({
      witnesses: p.witnesses,
      minDistinctDomains: 1,
      clock: () => AHORA,
      collector: imapAckCollector({
        witnesses: p.witnesses,
        imap: {
          host: 'i',
          port: 993,
          tls: true,
          user: 'anclaje',
          pass: 'x',
          connect: () => Promise.resolve(guionImap([acuse, rebote])),
        },
      }),
    });

    const base = {
      provider: 'correo',
      independenceClass: 'human-witness' as const,
      checkpointHash: HEX,
      externalRef: messageId,
      submittedAt: EMISION,
      raw: { acks: [], recipients: p.witnesses.map((w) => w.address) },
    };

    const recibo = await proveedor.poll(base);
    const resultado = await proveedor.verify(recibo, CHECKPOINT);

    expect((recibo.raw['acks'] as readonly unknown[]).length).toBe(1);
    expect((recibo.raw['bounces'] as readonly unknown[]).length).toBe(1);
    expect(resultado.status).toBe('confirmado');
    expect(resultado.checks.some((c) => c.name === 'rebote' && /docente_dos/u.test(c.detail))).toBe(
      true,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Los tres a la vez
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe('el quórum con los tres proveedores enchufados', () => {
  it('Bitcoin + forjas confirman dos clases distintas y el checkpoint queda FIRME', async () => {
    const fileDigest = await sha256(CHECKPOINT);
    const alice = new FakeOtsCalendar({ uri: 'https://alice.invalid', nonceLabel: 'a' });

    const ots = new OpenTimestampsProvider({
      calendar: calendarPool([
        httpCalendar(
          'https://alice.invalid',
          await servidorDeCalendario('https://alice.invalid', alice, fileDigest, { maduro: true }),
        ),
      ]),
      headers: staticHeaders([...alice.headers()]),
      clock: () => AHORA,
    });

    const firmante = await nuevoFirmante();
    const commit = await commitFirmado(
      firmante,
      ['Checkpoint 12480', '', checkpointBindingLine(HEX), ''].join('\n'),
    );
    const oid = await commitOid(commit);

    const git = new SignedGitProvider({
      allowedSigners: [{ identity: 'Veeduría 2026-2', publicKey: firmante.publicKey }],
      signingKeyOffHost: true,
      forges: ['codeberg', 'github'],
      clock: () => AHORA,
      forgeClients: (['codeberg', 'github'] as const).map((nombre) =>
        nombre === 'codeberg'
          ? codebergForge({
              owner: 'i',
              repo: 'a',
              branch: 'anclaje',
              http: {
                fetchImpl: fetchDeForjas({
                  'https://codeberg.org/api/v1/repos/i/a/branches/anclaje': { commit: { id: oid } },
                  [`https://codeberg.org/api/v1/repos/i/a/git/commits/${oid}`]: respuestaDeForja(
                    commit,
                    'codeberg',
                  ),
                }),
              },
            })
          : githubForge({
              owner: 'i',
              repo: 'a',
              branch: 'anclaje',
              http: {
                fetchImpl: fetchDeForjas({
                  'https://api.github.com/repos/i/a/git/ref/heads/anclaje': {
                    object: { sha: oid },
                  },
                  [`https://api.github.com/repos/i/a/git/commits/${oid}`]: respuestaDeForja(
                    commit,
                    'github',
                  ),
                }),
              },
            }),
      ),
    });

    const resultado = await runAnchorCycle({
      checkpoint: checkpoint(),
      providers: [ots, git],
      now: AHORA,
      poll: true,
    });

    expect(resultado.verdict.firm).toBe(true);
    expect(resultado.verdict.state).toBe('FIRME');
    expect(resultado.verdict.confirmedClasses).toStrictEqual(['blockchain', 'vcs']);
    expect(resultado.events.filter((e) => e.eventType === ANCHOR_CONFIRMED)).toHaveLength(2);
    expect(resultado.verdict.explanation).toMatch(/Bitcoin y un repositorio público firmado/u);
  });
});
